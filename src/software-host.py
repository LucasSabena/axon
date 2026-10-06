"""Native software inventory and verified transactions. No arbitrary executable probing.

The request is server-owned. Catalog metadata never supplies commands. Scan only
reads package databases and desktop/AppStream metadata; mutations require a plan.
"""
import base64
import configparser
import fcntl
import fnmatch
try:
    import tomllib
except ImportError:
    tomllib = None
import gzip
import hashlib
import json
import os
import pathlib
import pwd
import re
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

LIMIT = 12 * 1024 * 1024
PACKAGE = re.compile(r"^[A-Za-z0-9@][A-Za-z0-9@+._:/-]{0,240}$")


def identity(manager, scope, uid, root, package, arch=""):
    return "pkg-" + hashlib.sha256(json.dumps([manager, scope, uid, root, package, arch], separators=(",", ":")).encode()).hexdigest()[:28]


def context(user, settings=None):
    account = pwd.getpwnam(user)
    settings = settings or {}
    home = account.pw_dir
    paths = settings.get("paths", []) + [home + p for p in ["/.local/share/pnpm/bin", "/.local/share/pnpm", "/.bun/bin", "/.local/bin", "/.cargo/bin", "/.nix-profile/bin", "/.linuxbrew/bin"]]
    paths += os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin").split(":")
    env = {"HOME": home, "USER": user, "LOGNAME": user, "PATH": ":".join(dict.fromkeys(p for p in paths if p.startswith("/"))), "LC_ALL": "C", "LANG": "C", "DEBIAN_FRONTEND": "noninteractive"}
    for key in ["PNPM_HOME", "BUN_INSTALL", "CARGO_HOME", "RUSTUP_HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "UV_TOOL_DIR", "PIPX_HOME"]:
        value = settings.get("environment", {}).get(key)
        if value and value.startswith("/"): env[key] = value
    extra = [env.get("PNPM_HOME"), env.get("BUN_INSTALL", "") + "/bin", env.get("CARGO_HOME", "") + "/bin"]
    env["PATH"] = ":".join(dict.fromkeys([p for p in extra if p and p != "/bin"] + env["PATH"].split(":")))
    return {"uid": account.pw_uid, "user": user, "home": home, "env": env}


def command(argv, ctx=None, timeout=25, accepted=(0,), stream=False, inherited=()):
    env = ctx["env"] if ctx else {**os.environ, "LC_ALL": "C", "LANG": "C", "DEBIAN_FRONTEND": "noninteractive"}
    if ctx and ctx["uid"] != os.getuid():
        if os.getuid() != 0: raise RuntimeError("No se puede leer el ámbito de otro usuario")
        argv = ["runuser", "-u", ctx["user"], "--", "env", "-i"] + [k + "=" + v for k, v in env.items()] + argv
    proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=None if stream else subprocess.PIPE, stderr=None if stream else subprocess.PIPE, env=env, cwd=ctx["home"] if ctx else "/", start_new_session=True, pass_fds=tuple(inherited))
    try:
        out, error = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL); proc.communicate()
        raise RuntimeError("El gestor excedió el tiempo de comprobación")
    if proc.returncode not in accepted:
        raise RuntimeError((error or b"Package manager operation failed").decode(errors="replace")[-1200:])
    if stream: return ""
    if len(out) > LIMIT: raise RuntimeError("Inventario demasiado grande; no se publica como completo")
    return out.decode(errors="replace")


def tool(name, ctx=None):
    return shutil.which(name, path=ctx["env"]["PATH"] if ctx else os.environ.get("PATH"))


def record(manager, scope, ctx, root, package, version, **extra):
    uid = ctx["uid"] if ctx else 0
    arch = extra.pop("arch", "")
    return {"id": identity(manager, scope, uid, root, package, arch), "manager": manager, "scope": scope, "uid": uid,
            "user": ctx["user"] if ctx else "root", "root": root, "packageName": package, "architecture": arch,
            "name": package, "version": version or None, "kind": "package", "executables": [], "canUpdate": False,
            "updateState": "unchecked", "reason": "Comprobación pendiente", **extra}


def source(manager, scope, ctx, root, enabled):
    return {"id": manager + ":" + scope + ":" + str(ctx["uid"] if ctx else 0) + ":" + root,
            "manager": manager, "scope": scope, "user": ctx["user"] if ctx else "root", "root": root,
            "available": enabled, "complete": False, "updateState": "unchecked" if enabled else "unavailable", "checkedAt": None}


def global_dependencies(output):
    """Only direct package records; nested dependency versions are not globals."""
    clean = "\n".join(line for line in output.splitlines() if not line.startswith("[WARN]"))
    data = json.loads(clean)
    nodes = data if isinstance(data, list) else [data]
    result = {}
    for node in nodes:
        for key in ("dependencies", "unsavedDependencies", "devDependencies"):
            for name, info in node.get(key, {}).items():
                if isinstance(info, dict) and isinstance(info.get("version"), str): result[name] = info
    return result, (nodes[0].get("path", "") if nodes else "")


def apt_updates(output):
    return {m[1]: m[2] for m in re.finditer(r"^Inst (\S+)(?: \[[^\]]+\])? \((\S+)", output, re.M)}


def attach_updates(rows, candidates, held=()):
    for row in rows:
        target = candidates.get(row["packageName"], candidates.get(row["packageName"].split(":")[0]))
        row["updateState"] = "held" if row["packageName"].split(":")[0] in held else "available" if target else "current"
        row["targetVersion"] = target
        row["canUpdate"] = bool(target) and row["updateState"] != "held"
        row["reason"] = "Retenido por el gestor" if row["updateState"] == "held" else "" if target else "Sin actualizaciones en los índices consultados"


def package_bins(info):
    folder = info.get("path")
    if not folder: return []
    try:
        data = json.loads((pathlib.Path(folder) / "package.json").read_text())
        bins = data.get("bin", {})
        return list(bins) if isinstance(bins, dict) else [data.get("name", "").split("/")[-1]] if isinstance(bins, str) else []
    except (OSError, ValueError): return []


def scan(req):
    ctx = context(req["user"], req.get("settings"))
    rows, sources = [], []
    updates = req.get("updates", False)
    def read(manager, scope, userctx, root, enabled, reader):
        src = source(manager, scope, userctx, root, enabled); sources.append(src)
        if not enabled: return
        try:
            found = reader(src)
            for row in found:
                row["sourceId"] = src["id"]
            rows.extend(found); src["complete"] = True; src["checkedAt"] = int(time.time() * 1000)
            if updates and src["updateState"] == "unchecked": src["updateState"] = "ok"
        except Exception as e:
            src["error"] = str(e); src["updateState"] = "error"

    def apt(src):
        output = command(["dpkg-query", "-W", "-f=${binary:Package}\t${db:Status-Status}\t${Version}\t${Architecture}\t${binary:Summary}\t${source:Package}\t${Homepage}\n"])
        items = []
        manual = set(command(["apt-mark", "showmanual"]).splitlines())
        for line in output.splitlines():
            fields = line.split("\t")
            if len(fields) >= 4 and fields[1] == "installed":
                items.append(record("apt", "system", None, "/", fields[0], fields[2], arch=fields[3], description=fields[4] if len(fields) > 4 else "", sourceName=fields[5] if len(fields)>5 else fields[0].split(":")[0], homepage=fields[6] if len(fields)>6 else "", kind="package" if fields[0].split(":")[0] in manual else "dependency"))
        stamps = [p.stat().st_mtime for p in pathlib.Path("/var/lib/apt/lists").glob("*Packages*") if p.is_file()]
        src["metadataAt"] = int(max(stamps) * 1000) if stamps else None
        src["note"] = "Se consultan los índices locales de APT; actualizar índices no instala paquetes."
        if updates:
            try:
                held = set(command(["apt-mark", "showhold"]).splitlines())
                attach_updates(items, apt_updates(command(["apt-get", "-s", "upgrade"])), held)
            except Exception as e: src["error"] = str(e); src["updateState"] = "error"
        return items
    read("apt", "system", None, "/", bool(tool("dpkg-query") and tool("apt-get")), apt)

    def rpm(src):
        items = []
        for line in command(["rpm", "-qa", "--qf", "%{NAME}\t%{EPOCHNUM}:%{VERSION}-%{RELEASE}\t%{ARCH}\t%{SUMMARY}\n"]).splitlines():
            f = line.split("\t", 3)
            if len(f) == 4: items.append(record("dnf", "system", None, "/", f[0], f[1], arch=f[2], description=f[3]))
        if updates:
            try:
                candidates = {}
                for line in command(["dnf", "-q", "repoquery", "--upgrades", "--qf", "%{name}\t%{epoch}:%{version}-%{release}\t%{arch}"]).splitlines():
                    f = line.split("\t")
                    if len(f) == 3: candidates[(f[0], f[2])] = f[1]
                for row in items:
                    row["targetVersion"] = candidates.get((row["packageName"], row["architecture"]))
                    row["updateState"] = "unsupported" if row["targetVersion"] else "current"
                    row["reason"] = "Actualización detectada; ejecución DNF no habilitada sin simulación de dependencias" if row["targetVersion"] else "Sin actualizaciones detectadas"
            except Exception as e: src["error"] = str(e); src["updateState"] = "error"
        return items
    read("dnf", "system", None, "/", bool(tool("rpm") and tool("dnf")), rpm)

    def pacman(src):
        items = [record("pacman", "system", None, "/", f[0], f[1]) for line in command(["pacman", "-Q"]).splitlines() if len(f := line.split()) == 2]
        if updates:
            candidates = {f[0]: f[3] for line in command(["pacman", "-Qu"], accepted=(0, 1)).splitlines() if len(f := line.split()) == 4 and f[2] == "->"}
            for row in items:
                row["targetVersion"] = candidates.get(row["packageName"])
                row["updateState"] = "unsupported" if row["targetVersion"] else "current"
                row["reason"] = "Arch requiere una actualización completa del sistema; operación todavía no habilitada" if row["targetVersion"] else "Sin actualizaciones en los índices locales"
        return items
    read("pacman", "system", None, "/", bool(tool("pacman")), pacman)

    def snap(src):
        items = []
        for line in command(["snap", "list"]).splitlines()[1:]:
            f = line.split()
            if len(f) >= 6: items.append(record("snap", "system", None, "/var/lib/snapd", f[0], f[1], revision=f[2], channel=f[3], held="held" in f[-1]))
        if updates:
            candidates = {}
            for line in command(["snap", "refresh", "--list"], timeout=45).splitlines()[1:]:
                f = line.split()
                if len(f) >= 3: candidates[f[0]] = (f[1], f[2])
            for row in items:
                candidate = candidates.get(row["packageName"])
                row["targetVersion"] = candidate[0] if candidate else None
                row["targetRevision"] = candidate[1] if candidate else None
                row["updateState"] = "held" if row["held"] else "available" if candidate else "current"
                row["canUpdate"] = bool(candidate) and not row["held"]
                row["reason"] = "Retenido por snapd" if row["held"] else ""
        return items
    read("snap", "system", None, "/var/lib/snapd", bool(tool("snap")), snap)

    flatpak_scopes = [("system", None, "--system", "/var/lib/flatpak"), ("user", ctx, "--user", ctx["env"].get("XDG_DATA_HOME", ctx["home"] + "/.local/share") + "/flatpak")]
    for file in pathlib.Path("/etc/flatpak/installations.d").glob("*.conf"):
        cfg = configparser.ConfigParser(interpolation=None, strict=False)
        try:
            cfg.read(file)
            for section in cfg.sections():
                match = re.fullmatch(r'Installation "([A-Za-z0-9_.-]+)"', section)
                root = cfg.get(section, "Path", fallback="")
                if match and root.startswith("/"): flatpak_scopes.append(("system", None, "--installation=" + match[1], root))
        except (OSError, configparser.Error): pass
    for scope, userctx, flag, location in flatpak_scopes:
        def flatpak(src, scope=scope, userctx=userctx, flag=flag):
            items = []
            for kind, prefix in [("app", "application"), ("runtime", "runtime")]:
                for line in command(["flatpak", "list", flag, "--" + kind, "--all", "--columns=ref:full,version:full,origin:full"], userctx).splitlines():
                    f = line.split("\t")
                    if len(f) >= 3:
                        ref = f[0] if f[0].startswith(("app/", "runtime/")) else kind + "/" + f[0]
                        if len(ref.split("/")) != 4: continue
                        appid = ref.split("/")[1]
                        items.append(record("flatpak", scope, userctx, src["root"], ref, f[1], applicationId=appid, origin=f[2], kind=prefix, selector=flag))
            if updates:
                masks = command(["flatpak", "mask", flag], userctx).splitlines()
                candidates = {}
                for line in command(["flatpak", "remote-ls", flag, "--updates", "--columns=ref:full,commit:full,origin:full"], userctx, timeout=45).splitlines():
                    f = line.split("\t")
                    if len(f) == 3: candidates[(f[0], f[2])] = f[1]
                for row in items:
                    row["targetCommit"] = candidates.get((row["packageName"], row["origin"]), candidates.get((row["packageName"].split("/", 1)[1], row["origin"])))
                    row["updateState"] = "available" if row["targetCommit"] else "current"
                    masked = any(fnmatch.fnmatchcase(row["packageName"], mask) or fnmatch.fnmatchcase(row["packageName"].split("/", 1)[1], mask) or fnmatch.fnmatchcase(row["applicationId"], mask) for mask in masks)
                    row["canUpdate"] = bool(row["targetCommit"]) and not masked
                    if masked: row["updateState"] = "held"
                    row["reason"] = "Retenido mediante flatpak mask" if masked else ""
            return items
        read("flatpak", scope, userctx, location, bool(tool("flatpak", userctx)), flatpak)

    def pnpm(src):
        dependencies, root = global_dependencies(command([tool("pnpm", ctx), "list", "-g", "--depth=0", "--json"], ctx))
        src["root"] = root or command([tool("pnpm", ctx), "root", "-g"], ctx).strip()
        version = command([tool("pnpm", ctx), "--version"], ctx).strip()
        policy = {"minutes": 1440 if int(version.split(".")[0]) >= 11 else 0, "excludes": []}
        try:
            age = command([tool("pnpm", ctx), "--dir", src["root"], "config", "get", "minimumReleaseAge"], ctx).strip()
            if re.fullmatch(r"\d+(?:\.\d+)?", age): policy["minutes"] = float(age)
            excludes = command([tool("pnpm", ctx), "--dir", src["root"], "config", "get", "minimumReleaseAgeExclude"], ctx).strip()
            try:
                parsed = json.loads(excludes)
                if isinstance(parsed, list): policy["excludes"] = [p for p in parsed if isinstance(p, str)]
            except ValueError: policy["excludes"] = re.findall(r'"([^"\n]+)"', excludes)
        except RuntimeError as e:
            src["error"] = "No se pudo comprobar la política pnpm: " + str(e); src["updateState"] = "error"
        registry = command([tool("pnpm", ctx), "config", "get", "registry"], ctx).strip()
        if registry not in ("undefined", "", "https://registry.npmjs.org/", "https://registry.npmjs.org"):
            src.update(error="Registro pnpm personalizado: actualización no habilitada para esta fuente", updateState="error")
        for scope in {name.split("/")[0] for name in dependencies if name.startswith("@")}:
            scoped = command([tool("pnpm", ctx), "config", "get", scope + ":registry"], ctx).strip()
            if scoped not in ("undefined", "", "https://registry.npmjs.org/", "https://registry.npmjs.org"):
                src.update(error="Registro pnpm por scope: actualización no habilitada para esta fuente", updateState="error")
        src["policy"] = policy
        items = [record("pnpm", "user", ctx, src["root"], name, info["version"], executables=package_bins(info), kind="tool", policy=policy) for name, info in dependencies.items()]
        for row in items:
            origin = dependencies[row["packageName"]].get("from", row["packageName"])
            if any(marker in origin for marker in ["link:", "file:", "workspace:", "git:", "git+", "https:", "npm:"]) or origin != row["packageName"] and not origin.startswith(row["packageName"] + "@"): row.update(updateState="unmanaged", reason="Fuente pnpm local, alias o git: conservar el origen de instalación")
        return items  # Candidate selection uses the shared pnpm release policy in TypeScript.
    read("pnpm", "user", ctx, ctx["home"], bool(tool("pnpm", ctx)), pnpm)

    def bun(src):
        base = pathlib.Path(ctx["env"].get("BUN_INSTALL", ctx["home"] + "/.bun")) / "install/global"
        settingsfiles = [pathlib.Path(ctx["env"].get("XDG_CONFIG_HOME", ctx["home"] + "/.config")) / "bunfig.toml", pathlib.Path(ctx["home"]) / ".bunfig.toml", pathlib.Path(ctx["home"]) / "bunfig.toml"]
        install = {}
        for settingsfile in settingsfiles:
            if not settingsfile.exists(): continue
            if not tomllib: raise ValueError("La configuración Bun requiere Python 3.11 para preservar su ámbito")
            config = tomllib.loads(settingsfile.read_text())
            install.update(config.get("install", {}))
            if install.get("globalDir"): base = pathlib.Path(install["globalDir"].replace("~/", ctx["home"] + "/", 1))
            if install.get("minimumReleaseAge") or install.get("security"):
                src.update(error="Bun usa una política de publicación o scanner personalizado; resolución automática no habilitada", updateState="error")
            if install.get("registry") or install.get("scopes"):
                src.update(error="Registro Bun personalizado: actualización no habilitada para esta fuente", updateState="error")
        for configfile in [pathlib.Path(ctx["home"]) / ".npmrc", pathlib.Path(ctx["home"]) / "bunfig.toml", pathlib.Path(ctx["env"].get("XDG_CONFIG_HOME", ctx["home"] + "/.config")) / "bunfig.toml"]:
            if configfile.exists() and re.search(r"(?:registry\s*=|\[install\.scopes\])", configfile.read_text()):
                src.update(error="Configuración de registro Bun personalizada: comprobar su fuente antes de actualizar", updateState="error")
        manifest = base / "package.json"
        if not manifest.is_file(): return []
        data = json.loads(manifest.read_text()); items = []
        for name in data.get("dependencies", {}):
            info = json.loads((base / "node_modules" / name / "package.json").read_text())
            row = record("bun", "user", ctx, str(base), name, info.get("version"), kind="tool", executables=package_bins({"path": str(base / "node_modules" / name)}))
            declared = str(data["dependencies"][name])
            if info.get("name") != name or any(marker in declared for marker in ["link:", "file:", "workspace:", "git:", "git+", "https:", "npm:"]): row.update(updateState="unmanaged", reason="Fuente Bun local, alias o git: conservar el origen de instalación")
            items.append(row)
        return items
    read("bun", "user", ctx, ctx["home"], bool(tool("bun", ctx)), bun)

    def pipx(src):
        data = json.loads(command([tool("pipx", ctx), "list", "--json"], ctx)); items = []
        for key, info in data.get("venvs", {}).items():
            main = info.get("metadata", {}).get("main_package", {})
            items.append(record("pipx", "user", ctx, ctx["env"].get("PIPX_HOME", ctx["home"] + "/.local/share/pipx"), key, main.get("package_version"), executables=main.get("apps", []), kind="tool", updateState="unsupported", reason="Herramienta pipx detectada; su fuente y restricciones requieren un plan específico"))
        src["updateState"] = "unsupported"; return items
    read("pipx", "user", ctx, ctx["home"], bool(tool("pipx", ctx)), pipx)

    def uv(src):
        items = []
        for line in command([tool("uv", ctx), "tool", "list"], ctx).splitlines():
            match = re.match(r"^(\S+) v(\S+)", line)
            if match: items.append(record("uv", "user", ctx, ctx["env"].get("UV_TOOL_DIR", ctx["home"] + "/.local/share/uv/tools"), match[1], match[2], kind="tool", updateState="unsupported", reason="Herramienta uv detectada; no se actualizan entornos temporales ni proyectos"))
        src["updateState"] = "unsupported"; return items
    read("uv", "user", ctx, ctx["home"], bool(tool("uv", ctx)), uv)

    def cargo(src):
        root = pathlib.Path(ctx["env"].get("CARGO_HOME", ctx["home"] + "/.cargo")); manifest = root / ".crates2.json"
        if not manifest.exists(): return []
        items = []
        for key, info in json.loads(manifest.read_text()).get("installs", {}).items():
            f = key.split(" ", 2)
            if len(f) >= 2: items.append(record("cargo", "user", ctx, str(root), f[0], f[1], executables=info.get("bins", []), origin=f[2] if len(f) > 2 else "", kind="tool", updateState="unsupported", reason="Crate registrado; conservar fuente registry/git/path antes de actualizar"))
        src["updateState"] = "unsupported"; return items
    read("cargo", "user", ctx, ctx["home"], bool(tool("cargo", ctx)), cargo)

    def brew(src):
        data = json.loads(command([tool("brew", ctx), "info", "--json=v2", "--installed"], ctx, timeout=45))
        items = []
        for kind in ["formulae", "casks"]:
            for info in data.get(kind, []):
                installed = info.get("installed", [])
                version = installed[0].get("version") if isinstance(installed, list) and installed and isinstance(installed[0], dict) else installed if isinstance(installed, str) else None
                items.append(record("brew", "user", ctx, ctx["home"], info.get("full_name", info.get("token", info.get("name", ""))), version, kind="application" if kind == "casks" else "tool", updateState="unsupported", reason="Paquete Homebrew registrado; actualización no habilitada"))
        src["updateState"] = "unsupported"; return items
    read("brew", "user", ctx, ctx["home"], bool(tool("brew", ctx)), brew)

    def rustup(src):
        src["updateState"] = "unsupported"
        return [record("rustup", "user", ctx, ctx["env"].get("RUSTUP_HOME", ctx["home"] + "/.rustup"), line.split()[0], None, kind="toolchain", updateState="unsupported", reason="Toolchain Rust registrado; conservar su canal antes de actualizar") for line in command([tool("rustup", ctx), "toolchain", "list"], ctx).splitlines() if line.strip() and not line.startswith("no installed")]
    read("rustup", "user", ctx, ctx["home"], bool(tool("rustup", ctx)), rustup)

    def mise(src):
        data = json.loads(command([tool("mise", ctx), "ls", "--json"], ctx)); items = []
        for name, versions in data.items():
            for info in versions:
                if not info.get("installed"): continue
                items.append(record("mise", "user", ctx, info.get("install_path") or ctx["home"], name + ":" + str(info.get("version", "")), info.get("version"), kind="toolchain", updateState="unsupported", reason="Versión gestionada por mise; no se cambian los proyectos que la seleccionan"))
        src["updateState"] = "unsupported"; return items
    read("mise", "user", ctx, ctx["home"], bool(tool("mise", ctx)), mise)

    def nix(src):
        data = json.loads(command([tool("nix", ctx), "profile", "list", "--json"], ctx)); items = []
        for name, info in data.get("elements", data).items():
            if not isinstance(info, dict): continue
            for storepath in info.get("storePaths", []):
                items.append(record("nix", "user", ctx, ctx["home"] + "/.nix-profile", name, None, origin=info.get("originalUrl", ""), kind="tool", updateState="unsupported", reason="Perfil Nix registrado; conservar flake, atributos y generación"))
        src["updateState"] = "unsupported"; return items
    read("nix", "user", ctx, ctx["home"], bool(tool("nix", ctx)), nix)
    if tool("asdf", ctx):
        src = source("asdf", "user", ctx, ctx["home"], True)
        src.update(updateState="unsupported", note="Gestor detectado; adaptador de inventario no habilitado")
        sources.append(src)
    enrich(rows, ctx, req.get("settings", {}), sources)
    local_executables(rows, ctx, req.get("settings", {}), sources)
    # Optional integration metadata enriches records; it never limits enumeration.
    for item in req.get("integrations", []):
        binary = item.get("binary", "")
        if not re.fullmatch(r"[A-Za-z0-9_.+-]+", binary): continue
        executable = tool(binary, ctx)
        matches = [p for p in rows if item.get("package") == p["packageName"] or binary in p["executables"]]
        if not matches and executable:
            for manager, args in [("apt", ["dpkg-query", "-S", executable]), ("dnf", ["rpm", "-qf", "--qf", "%{NAME}", executable]), ("pacman", ["pacman", "-Qqo", executable])]:
                if not tool(args[0]): continue
                try:
                    owner = command(args, timeout=3).strip().split(": ", 1)[0].split(":")[0]
                    matches = [p for p in rows if p["manager"] == manager and p["packageName"].split(":")[0] == owner]
                except RuntimeError: continue
                if matches: break
        if not matches and executable:
            row = record("manual", "user", ctx, str(pathlib.Path(executable).resolve()), binary, None, kind="tool", updateState="unmanaged", reason="Ejecutable detectado; gestor de instalación no comprobado", executablePath=str(pathlib.Path(executable).resolve()))
            rows.append(row); matches = [row]
        for row in matches:
            row.update(integrationId=item["id"], name=item["name"])
            if executable: row.setdefault("executablePath", str(pathlib.Path(executable).resolve()))
    if os.getuid() != 0:
        for row in rows:
            if row["scope"] == "system" and row["canUpdate"]:
                row.update(canUpdate=False, reason="La ejecución requiere permisos de administración del host")
    return {"ok": True, "installations": rows, "sources": sources, "checkedAt": int(time.time() * 1000), "user": ctx["user"], "home": ctx["home"], "canAdministerSystem": os.getuid() == 0}


def local_executables(rows, ctx, settings, sources, systemdir="/usr/local/bin"):
    unmanaged = source("manual", "user", ctx, ctx["home"], True)
    warnings, examined, dangling = [], 0, 0
    registered = {binary for row in rows if row["scope"] == "user" and row["user"] == ctx["user"] for binary in row["executables"]}
    known_paths = {row.get("executablePath") for row in rows}
    dirs = list(dict.fromkeys(settings.get("paths", []) + [ctx["home"] + suffix for suffix in ["/.local/bin", "/.bun/bin", "/.cargo/bin", "/.local/share/pnpm/bin"]] + ([systemdir] if systemdir else [])))
    for directory in dirs:
        try:
            files = list(pathlib.Path(directory).iterdir())
        except FileNotFoundError: continue
        except OSError: warnings.append("No se pudo leer " + directory); continue
        if examined + len(files) > 2000: warnings.append("Exploración de ejecutables locales limitada a 2000 entradas"); break
        examined += len(files)
        for file in files:
            if directory != systemdir and file.name in registered: continue
            try:
                resolved = file.resolve()
                info = resolved.stat()
                if not stat.S_ISREG(info.st_mode) or not info.st_mode & 0o111 or (directory != systemdir and file.name in registered) or str(resolved) in known_paths or not PACKAGE.fullmatch(file.name): continue
                known_paths.add(str(resolved))
                row = record("manual", "system" if directory == systemdir else "user", None if directory == systemdir else ctx, str(resolved), file.name, None, kind="tool", executablePath=str(resolved), executables=[file.name], updateState="unmanaged", reason="Ejecutable local sin registro de paquete; versión y actualización no comprobadas", sourceId=unmanaged["id"])
                rows.append(row)
            except FileNotFoundError: dangling += 1
            except OSError: warnings.append("No se pudo inspeccionar " + file.name)
    unmanaged.update(complete=not warnings, updateState="unsupported" if not warnings else "error", note="; ".join(warnings) or "Los ejecutables locales se enumeran sin ejecutarlos; no se adivinan versiones ni comandos", checkedAt=int(time.time() * 1000))
    if dangling: unmanaged["note"] += "; " + str(dangling) + " accesos locales apuntan a archivos ausentes"
    if warnings: unmanaged["error"] = "; ".join(warnings)
    sources.append(unmanaged)


def resolve_icon(name, roots, theme="hicolor"):
    if not name or "\x00" in name or ".." in pathlib.PurePath(name).parts: return None
    roots = [pathlib.Path(p) for p in roots]
    def valid(file):
        try:
            real = file.resolve()
            if real.suffix.lower() not in [".svg", ".png", ".webp", ".jpg", ".jpeg"] or not real.is_file() or real.stat().st_size > 1024 * 1024: return None
            if any(real.is_relative_to(root.resolve()) for root in roots): return str(real)
        except OSError: pass
        return None
    if name.startswith("/"): return valid(pathlib.Path(name))
    visited = set()
    def lookup(current):
        if current in visited or len(visited) > 20: return None
        visited.add(current)
        for root in roots:
            directory = root / current
            cfg = configparser.ConfigParser(interpolation=None, strict=False)
            try: cfg.read(directory / "index.theme")
            except configparser.Error: continue
            dirs = cfg.get("Icon Theme", "Directories", fallback="").split(",")
            dirs = sorted(set(dirs + ["scalable/apps", "128x128/apps", "64x64/apps", "48x48/apps", "256x256/apps"]))
            for child in dirs:
                if child.startswith("/") or ".." in pathlib.PurePath(child).parts: continue
                for ext in ["", ".svg", ".png", ".webp", ".xpm"]:
                    found = valid(directory / child / (name + ext))
                    if found: return found
            for parent in cfg.get("Icon Theme", "Inherits", fallback="").split(","):
                if parent and re.fullmatch(r"[A-Za-z0-9_.-]+", parent):
                    found = lookup(parent)
                    if found: return found
        return None
    found = lookup(theme) or lookup("hicolor") or lookup("Adwaita") or lookup("Yaru") or lookup("gnome")
    if found: return found
    for root in roots:
        for ext in ["", ".svg", ".png", ".webp", ".xpm"]:
            found = valid(root / (name + ext))
            if found: return found
    return None


def desktop_entries(dirs):
    entries = {}; warnings = []
    for directory in dirs:
        try:
            files = sorted(pathlib.Path(directory).glob("*.desktop"))
            for file in files:
                if file.name in entries: continue
                cfg = configparser.ConfigParser(interpolation=None, strict=False); cfg.optionxform = str
                try:
                    if file.stat().st_size > 128000: continue
                    cfg.read(file); data = dict(cfg["Desktop Entry"])
                    entries[file.name] = (str(file), data)
                except (OSError, KeyError, configparser.Error): warnings.append("No se pudo leer " + file.name)
        except OSError: warnings.append("Lectura incompleta de accesos de escritorio")
    return entries, warnings


def enrich(rows, ctx, settings, sources):
    data = ctx["env"].get("XDG_DATA_HOME", ctx["home"] + "/.local/share")
    bases = [data, "/usr/local/share", "/usr/share"]
    roots = [p + "/icons" for p in bases] + [p + "/pixmaps" for p in bases] + ["/var/lib/snapd/desktop/icons", "/snap", "/var/cache/swcatalog/icons", "/var/cache/app-info/icons", "/var/lib/app-info/icons", "/var/lib/flatpak", data + "/flatpak"]
    roots += [src["root"] for src in sources if src["manager"] == "flatpak" and src.get("root")]
    directories = [data + "/applications", data + "/flatpak/exports/share/applications", "/usr/local/share/applications", "/usr/share/applications", "/var/lib/flatpak/exports/share/applications", "/var/lib/snapd/desktop/applications"]
    directories += [src["root"] + "/exports/share/applications" for src in sources if src["manager"] == "flatpak" and src.get("root")]
    entries, warnings = desktop_entries(directories)
    owners = {}
    if tool("dpkg-query") and entries:
        try:
            output = command(["dpkg-query", "-S"] + [item[0] for item in entries.values()], timeout=12, accepted=(0, 1))
            for line in output.splitlines():
                package, separator, filename = line.partition(": ")
                if separator: owners[filename] = package.split(":")[0]
        except RuntimeError: warnings.append("No se pudo vincular todo el escritorio a sus paquetes")
    bypackage = {(p["manager"], p["packageName"].split(":")[0]): p for p in rows}
    binaries = {name: p for p in rows for name in p["executables"]}
    byappid = {}
    for p in rows:
        if p.get("applicationId"): byappid.setdefault(p["applicationId"], []).append(p)
    for file, (filename, meta) in entries.items():
        if meta.get("Hidden") == "true" or meta.get("Type", "Application") != "Application": continue
        name = meta.get("Name"); appid = file.removesuffix(".desktop")
        if not name: continue
        row = next((p for p in rows if p.get("applicationId") == appid and p["scope"] == ("user" if filename.startswith(data + "/") else "system")), None)
        if row is None and meta.get("X-SnapInstanceName"):
            row = bypackage.get(("snap", meta["X-SnapInstanceName"]))
        if row is None: row = bypackage.get(("apt", owners.get(filename)))
        if row is None:
            for manager, argv in [("dnf", ["rpm", "-qf", "--qf", "%{NAME}", filename]), ("pacman", ["pacman", "-Qqo", filename])]:
                if not tool(argv[0]): continue
                try:
                    owner = command(argv, timeout=3).strip()
                    if "\n" not in owner: row = bypackage.get((manager, owner))
                except RuntimeError: pass
                if row is not None: break
        if row is None:
            try:
                cmd = shlex.split(meta.get("TryExec") or meta.get("Exec", ""))[0]
                row = binaries.get(pathlib.Path(cmd).name)
            except (ValueError, IndexError): pass
        if row is None and meta.get("NoDisplay") != "true":
            row = record("manual", "user" if filename.startswith(data + "/") else "system", ctx if filename.startswith(data + "/") else None, str(pathlib.Path(filename).parent), file, None, kind="application", updateState="unmanaged", reason="Acceso de escritorio detectado; origen de instalación no comprobado", applicationId=appid)
            rows.append(row)
        if row:
            if not row.get("desktopFile"): row.update(name=name, applicationId=appid, desktopFile=filename, description=meta.get("Comment", row.get("description", "")), kind="application")
            if row["manager"] != "flatpak":
                try:
                    args = shlex.split(meta.get("TryExec") or meta.get("Exec", ""))
                    if args and args[0] == "env": args = [a for a in args[1:] if "=" not in a and not a.startswith("-")]
                    executable = args[0] if args and args[0].startswith("/") else tool(args[0], ctx) if args else None
                    if executable and pathlib.Path(executable).is_file():
                        row.setdefault("executablePath", str(pathlib.Path(executable).resolve()))
                        binary = pathlib.Path(executable).name
                        if binary not in row["executables"]: row["executables"].append(binary)
                except (ValueError, OSError): pass
            row.setdefault("iconName", meta.get("Icon", ""))
            icon = resolve_icon(meta.get("Icon"), roots, settings.get("iconTheme", "hicolor"))
            if icon: row.update(iconFile=icon, iconSource="desktop")
    # AppStream enrichment is bounded and independent of installation detection.
    metadata = []
    for directory in ["/usr/share/metainfo", "/usr/share/appdata", "/var/cache/swcatalog/xml", "/var/lib/swcatalog/xml", "/var/lib/app-info/xmls"]:
        metadata.extend(pathlib.Path(directory).glob("*.xml*"))
    for base in [pathlib.Path("/var/lib/flatpak"), pathlib.Path(data + "/flatpak")]: metadata.extend(base.glob("appstream/*/*/active/appstream.xml.gz"))
    if len(metadata) > 2500: warnings.append("Metadatos AppStream parcialmente consultados")
    for file in metadata[:2500]:
        try:
            if file.stat().st_size > LIMIT: continue
            with gzip.open(file, "rb") if file.suffix == ".gz" else open(file, "rb") as stream: content = stream.read(LIMIT + 1)
            if len(content) > LIMIT or b"<!DOCTYPE" in content: continue
            tree = ET.fromstring(content)
            for component in [tree] if tree.tag == "component" else tree.findall("component"):
                appid = component.findtext("id", "").removesuffix(".desktop")
                packages = [n.text for n in component.findall("pkgname")]
                matched = list({p["id"]: p for p in byappid.get(appid, []) + [bypackage[(manager, pkg)] for manager in ["apt", "dnf", "pacman"] for pkg in packages if (manager, pkg) in bypackage]}.values())
                for row in matched:
                    row.update(applicationId=appid, name=component.findtext("name") or row["name"], description=component.findtext("summary") or row.get("description", ""))
                    for icon in component.findall("icon"):
                        if row.get("iconFile"): break
                        candidate = icon.text or ""
                        if icon.get("type") == "stock": found = resolve_icon(candidate, roots, settings.get("iconTheme", "hicolor"))
                        elif icon.get("type") == "cached":
                            if "/" in candidate or ".." in candidate: continue
                            origin = tree.get("origin", "")
                            choices = [file.parent / "icons" / size / candidate for size in ["128x128", "64x64"]]
                            if re.fullmatch(r"[A-Za-z0-9_.-]+", origin): choices += [pathlib.Path(r) / origin / size / candidate for r in roots for size in ["128x128", "64x64"]]
                            found = next((resolve_icon(str(p), roots) for p in choices if p.is_file()), None)
                        else: found = None
                        if found: row.update(iconFile=found, iconSource="appstream")
        except (OSError, ValueError, ET.ParseError): continue
    sources.append({"id": "metadata:" + str(ctx["uid"]), "manager": "metadata", "scope": "host", "user": ctx["user"], "available": True, "complete": not warnings, "updateState": "ok" if not warnings else "error", "note": "; ".join(warnings), "checkedAt": int(time.time() * 1000)})


def main():
    req = json.loads(base64.b64decode(sys.argv[1]))
    if req.get("action", "scan") == "scan": result = scan(req)
    elif req["action"] == "plan": result = plan(req)
    elif req["action"] == "execute": result = execute(req)
    elif req["action"] == "refresh": result = refresh(req)
    elif req["action"] == "recipe": result = recipe(req)
    elif req["action"] == "icon": result = catalog_icon(req)
    elif req["action"] == "install-global": result = install_global(req)
    else: raise ValueError("Acción desconocida")
    print(json.dumps(result, ensure_ascii=False))


def apt_simulation(output):
    added, removed = [], []
    for line in output.splitlines():
        if line.startswith("Remv "): removed.append(line.split()[1])
        elif line.startswith("Inst "):
            name = line.split()[1]
            target = apt_updates(line).get(name)
            added.append({"packageName": name, "targetVersion": target})
    return {"changes": added, "removals": removed, "complete": True}


def build_transaction(items):
    fields = ["id", "manager", "scope", "user", "root", "packageName", "name", "version", "targetVersion", "targetRevision", "targetCommit", "policy", "selector"]
    items = [{key: row[key] for key in fields if key in row} for row in items]
    first = items[0]; manager = first["manager"]
    tx = {"manager": manager, "scope": first["scope"], "user": first["user"], "root": first["root"], "items": items, "effects": "Dependencias resueltas por el gestor", "simulation": {"complete": False, "changes": [], "removals": []}}
    if manager == "apt":
        targets = []
        for row in items:
            if not row.get("targetVersion"): raise ValueError("Paquete sin candidato APT")
            targets.append(row["packageName"] + "=" + row["targetVersion"])
        tx["argv"] = ["apt-get", "install", "--only-upgrade", "--no-remove", "-y", "--"] + targets
        tx["simulation"] = apt_simulation(command(["apt-get", "--simulate", "install", "--only-upgrade", "--no-remove", "--"] + targets))
        if tx["simulation"]["removals"]: raise ValueError("El plan elimina paquetes; operación bloqueada")
        tx["effects"] = "El plan APT incluye todos los cambios de dependencias de su simulación"
    elif manager in ["pnpm", "bun"]:
        if any(not row.get("targetVersion") or not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?", row["targetVersion"]) for row in items): raise ValueError("Candidato pnpm inválido")
        tx["argv"] = ([manager, "--dir", first["root"], "add", "-g"] if manager == "pnpm" else [manager, "add", "-g"]) + [row["packageName"] + "@" + row["targetVersion"] for row in items]
        tx["effects"] = "Versiones exactas de los paquetes seleccionados; el gestor puede actualizar sus dependencias"
    elif manager == "flatpak":
        if len(items) != 1 or not re.fullmatch(r"[a-f0-9]{64}", first.get("targetCommit", "")): raise ValueError("Commit Flatpak inválido")
        tx["argv"] = ["flatpak", "update", first.get("selector", "--" + first["scope"]), "--noninteractive", "--no-related", "--no-deps", "-y", "--commit=" + first["targetCommit"], first["packageName"]]
    elif manager == "snap":
        if len(items) != 1 or not re.fullmatch(r"\d+", first.get("targetRevision", "")): raise ValueError("Revisión Snap inválida")
        tx["argv"] = ["snap", "refresh", first["packageName"], "--revision=" + first["targetRevision"]]
    else: raise ValueError("Actualización no habilitada para este gestor")
    for row in items:
        if not PACKAGE.fullmatch(row["packageName"]): raise ValueError("Identificador de paquete inválido")
    return tx


def plan(req):
    snapshot = scan({**req, "updates": True})
    found = {p["id"]: p for p in snapshot["installations"]}
    selected = req.get("items", [])
    if not selected or len(selected) > 200: raise ValueError("Seleccioná entre 1 y 200 instalaciones")
    items = []
    for expected in selected:
        row = found.get(expected["id"])
        if not row or row["version"] != expected["version"]: raise ValueError("La instalación cambió; volvé a comprobarla")
        if row["manager"] in ["pnpm", "bun"]:
            src = next((s for s in snapshot["sources"] if s["id"] == row.get("sourceId")), None)
            if not src or not src["complete"] or src.get("error") or row["updateState"] in ["unmanaged", "held"]:
                raise ValueError("La fuente o el ámbito del paquete no está comprobado")
            row.update(targetVersion=expected.get("targetVersion"), canUpdate=bool(expected.get("targetVersion")))
        elif not row["canUpdate"]: raise ValueError("La instalación no tiene un candidato gestionado")
        if row["manager"] not in ["pnpm", "bun"] and any(row.get(k) != expected.get(k) for k in ["targetVersion", "targetRevision", "targetCommit"]): raise ValueError("El candidato cambió; volvé a comprobarlo")
        items.append(row)
    groups = {}
    for row in items:
        key = (row["manager"], row["scope"], row["user"], row["root"], row["id"] if row["manager"] in ["flatpak", "snap"] or req.get("hooks", {}).get(row["packageName"]) else "")
        groups.setdefault(key, []).append(row)
    transactions = [build_transaction(group) for group in groups.values()]
    for tx in transactions:
        if len(tx["items"]) == 1 and req.get("hooks", {}).get(tx["items"][0]["packageName"]):
            tx["effects"] += " · Se ejecutará la receta local configurada para este paquete"
    return {"ok": True, "transactions": transactions, "createdAt": int(time.time() * 1000)}


def lock_directory(uid=None):
    uid = os.getuid() if uid is None else uid
    directory = pathlib.Path("/var/tmp/axon-software-" + str(uid))
    try:
        directory.mkdir(mode=0o700)
        if os.getuid() == 0 and uid != 0: os.chown(directory, uid, -1)
    except FileExistsError: pass
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_mode & 0o077: raise RuntimeError("Directorio de coordinación de software inseguro")
    return directory


def acquire(keys):
    handles = []
    try:
        for key in sorted(set(keys)):
            manager, scope, user, *unused = key.split(":")
            uid = pwd.getpwnam(user).pw_uid if scope == "user" else 0
            file = lock_directory(uid) / (hashlib.sha256(key.encode()).hexdigest() + ".lock")
            fd = os.open(file, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            handles.append(fd)
            if os.getuid() == 0 and uid != 0: os.fchown(fd, uid, -1)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handles
    except Exception:
        for fd in handles: os.close(fd)
        raise RuntimeError("Otra operación de software usa este gestor. Reintentá cuando termine.")


def transaction_key(tx):
    # System-wide package managers share one lock. Flatpak scope matters; pnpm
    # also distinguishes prefix. Native locks remain authoritative externally.
    return ":".join([tx["manager"], tx["scope"], tx["user"], tx["root"]])


def execute(req):
    approved = req["plan"]
    if time.time() * 1000 - approved["createdAt"] > 600000: raise ValueError("El plan venció; generá uno nuevo")
    transactions = approved["transactions"]
    handles = acquire(transaction_key(tx) for tx in transactions)
    try:
        items = [p for tx in transactions for p in tx["items"]]
        current = plan({**req, "items": items})
        if current["transactions"] != transactions: raise ValueError("El plan o sus dependencias cambiaron. No se ejecutó la actualización.")
        for tx in transactions:
            ctx = context(tx["user"], req.get("settings")) if tx["scope"] == "user" else None
            argv = tx["argv"][:]
            if ctx:
                executable = tool(argv[0], ctx)
                if not executable: raise ValueError("El gestor dejó de estar disponible")
                argv[0] = executable
            hook = req.get("hooks", {}).get(tx["items"][0]["packageName"]) if len(tx["items"]) == 1 else None
            if hook:
                if tx["manager"] not in ["pnpm", "bun"] or tx["scope"] != "user": raise ValueError("Hook local fuera de su ámbito permitido")
                print("Usando la receta local configurada para " + tx["items"][0]["name"], flush=True)
                ctx["env"].update(AXON_PACKAGE=tx["items"][0]["packageName"], AXON_TARGET_VERSION=tx["items"][0]["targetVersion"])
                argv = ["bash", "-c", hook]
            print("Actualizando " + ", ".join(p["name"] for p in tx["items"]), flush=True)
            command(argv, ctx, timeout=3600, stream=True, inherited=handles)
            verified = {p["id"]: p for p in scan({**req, "updates": False})["installations"]}
            for expected in tx["items"]:
                actual = verified.get(expected["id"])
                if not actual: raise RuntimeError("La instalación no aparece después de actualizar")
                if tx["manager"] == "flatpak":
                    commit = command(["flatpak", "info", expected.get("selector", "--" + tx["scope"]), "--show-commit", expected["packageName"]], ctx).strip()
                    valid = commit == expected["targetCommit"]
                elif tx["manager"] == "snap": valid = actual.get("revision") == expected["targetRevision"]
                else: valid = actual["version"] == expected["targetVersion"]
                if not valid: raise RuntimeError("La versión instalada no coincide con el objetivo aprobado: " + expected["name"])
            print("Instalaciones verificadas en el registro del gestor", flush=True)
        return {"ok": True, "verified": True}
    finally:
        for fd in handles: os.close(fd)


def refresh(req):
    if not tool("apt-get"): raise ValueError("Este host no tiene índices APT")
    handles = acquire(["apt:system:root:/"])
    try:
        command(["apt-get", "update", "--error-on=any"], timeout=300, stream=True, inherited=handles)
        return {"ok": True}
    finally:
        for fd in handles: os.close(fd)


def install_global(req):
    ctx = context(req["user"], req.get("settings"))
    spec = req["spec"]
    if not re.fullmatch(r"(?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+@\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?", spec): raise ValueError("Versión de instalación inválida")
    package, version = spec.rsplit("@", 1)
    current = scan({**req, "updates": False})
    src = next((s for s in current["sources"] if s["manager"] == "pnpm" and s["available"] and s["complete"] and not s.get("error")), None)
    if not src: raise ValueError("No hay un ámbito pnpm comprobado para este usuario")
    handles = acquire(["pnpm:user:" + ctx["user"] + ":" + src["root"]])
    try:
        command([tool("pnpm", ctx), "--dir", src["root"], "add", "-g", spec], ctx, timeout=3600, stream=True, inherited=handles)
        found = next((p for p in scan({**req, "updates": False})["installations"] if p["manager"] == "pnpm" and p["user"] == ctx["user"] and p["packageName"] == package), None)
        if not found or found["version"] != version: raise RuntimeError("La instalación no coincide con la versión objetivo")
        print("Instalación verificada por pnpm", flush=True)
        return {"ok": True, "verified": True}
    finally:
        for fd in handles: os.close(fd)


def catalog_icon(req):
    appid = req["applicationId"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,199}", appid): raise ValueError("ID de aplicación inválido")
    ctx = context(req["user"]); data = ctx["env"].get("XDG_DATA_HOME", ctx["home"] + "/.local/share")
    roots = ["/var/lib/flatpak", data + "/flatpak", "/usr/share/icons", "/usr/share/pixmaps", data + "/icons", "/var/cache/swcatalog/icons", "/var/cache/app-info/icons"]
    for base in roots[:2]:
        for size in ["128x128", "64x64"]:
            for file in pathlib.Path(base).glob("appstream/*/*/active/icons/" + size + "/" + appid + ".*"):
                found = resolve_icon(str(file), roots)
                if found: return {"ok": True, "iconFile": found}
    return {"ok": True, "iconFile": resolve_icon(appid, roots)}


def recipe(req):
    # Recipes come only from AXON's server-side installers, never catalog text.
    handles = acquire(["apt:system:root:/", "flatpak:system:root:/var/lib/flatpak", "snap:system:root:/var/lib/snapd"])
    try:
        for step in req["steps"]:
            print(step["label"], flush=True)
            command(["bash", "-lc", step["cmd"]], timeout=3600, stream=True, inherited=handles)
        expected = req.get("expected")
        if expected:
            rows = scan({"user": req["user"], "updates": False})["installations"]
            if not any(p["manager"] == expected["manager"] and p["scope"] == "system" and (p["packageName"].split(":")[0] == expected["packageName"] or p.get("applicationId") == expected["packageName"]) for p in rows):
                raise RuntimeError("El gestor no confirmó la instalación del paquete esperado")
            print("Instalación confirmada por el gestor nativo", flush=True)
        return {"ok": True}
    finally:
        for fd in handles: os.close(fd)


if __name__ == "__main__":
    try: main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False)); sys.exit(1)
