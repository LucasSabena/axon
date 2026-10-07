"""Dedicated graphical session; fixed server-owned commands and private X auth."""
import fcntl
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

DISPLAY = ':117'
VNC_PORT = 5917
WS_PORT = 6117
DEFAULT_GEOMETRY = '1440x900'
GEOM_MIN_W, GEOM_MAX_W = 640, 3840
GEOM_MIN_H, GEOM_MAX_H = 480, 2160

def parse_geometry(value):
    if value in (None, ''): return DEFAULT_GEOMETRY
    m = re.fullmatch(r'([1-9]\d{2,3})x([1-9]\d{2,3})', str(value))
    if not m: raise ValueError('Resolución inválida (usá ANCHOxALTO)')
    w, h = int(m.group(1)), int(m.group(2))
    if not (GEOM_MIN_W <= w <= GEOM_MAX_W and GEOM_MIN_H <= h <= GEOM_MAX_H):
        raise ValueError('Resolución fuera de rango (mínimo %dx%d, máximo %dx%d)' % (GEOM_MIN_W, GEOM_MIN_H, GEOM_MAX_W, GEOM_MAX_H))
    return '%dx%d' % (w, h)
APPS = {'terminal': ['/usr/bin/xterm'], 'browser': ['/usr/bin/google-chrome'], 'files': ['/usr/bin/thunar'],
        'editor': ['/usr/bin/mousepad'], 'firefox': ['/usr/bin/firefox']}

def folder(home):
    home = Path(home)
    if not home.is_absolute() or str(home) != os.path.normpath(str(home)) or not home.is_dir() or home.stat().st_uid != os.getuid(): raise ValueError('Identidad de escritorio inválida')
    base = home / '.local/share/axon/desktop'
    for p in [base, *base.parents]:
        if p.is_symlink(): raise ValueError('Escritorio enlazado no permitido')
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    if base.stat().st_uid != os.getuid() or base.stat().st_mode & 0o077: raise ValueError('Estado de escritorio no privado')
    os.environ.update(HOME=str(home), XDG_RUNTIME_DIR='/run/user/' + str(os.getuid()),
                      DBUS_SESSION_BUS_ADDRESS='unix:path=/run/user/' + str(os.getuid()) + '/bus')
    return base

PHYSICAL = ':0'

def physical_authority():
    uid = os.getuid()
    for candidate in (Path('/run/user/%d/gdm/Xauthority' % uid), Path(os.path.expanduser('~/.Xauthority'))):
        if candidate.is_file() and not candidate.is_symlink() and candidate.stat().st_uid == uid and Path('/tmp/.X11-unix/X0').exists(): return candidate
    return None

def unit(command):
    p = subprocess.run(['systemctl', '--user', *command], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
    if p.returncode: raise RuntimeError('No se pudo gestionar la sesión gráfica del usuario')
    return p.stdout.decode()

def connected(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1): return True
    except OSError: return False

def vnc_secret(base):
    try:
        p = base / 'vnc-password'
        if p.is_file() and not p.is_symlink(): return p.read_text().splitlines()[0].strip() or None
    except (OSError, IndexError): pass
    return None

def status(home):
    base = folder(home)
    p = subprocess.run(['systemctl', '--user', 'show', 'axon-desktop.service', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'LoadState'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    props = dict(line.split('=', 1) for line in p.stdout.decode().splitlines() if '=' in line)
    # shutil.which, not a subprocess to /usr/bin/which — its absence would
    # raise FileNotFoundError and permanently 503 /api/desktop.
    mirror = physical_authority()
    missing = [name for name in (['x11vnc', 'websockify'] if mirror else ['Xvfb', 'x11vnc', 'websockify', 'openbox', 'xauth']) if not shutil.which(name)]
    try: pid = int(props.get('MainPID') or '0')
    except ValueError: pid = 0
    state = 'not-installed' if props.get('LoadState', 'loaded') == 'not-found' else props.get('ActiveState', 'not-installed')
    return dict(ok=True, state=state, pid=pid, connected=connected(WS_PORT) and connected(VNC_PORT), vncPassword=vnc_secret(base),
                applications=[dict(id=k, name={'terminal':'Terminal', 'browser':'Chrome', 'files':'Archivos', 'editor':'Editor de texto', 'firefox':'Firefox'}[k]) for k,v in APPS.items() if Path(v[0]).is_file()],
                missing=missing, mirror=bool(mirror), display=PHYSICAL if mirror else DISPLAY, session='Pantalla real del servidor' if mirror else 'Sesión dedicada de AXON', websocketPort=WS_PORT)

def install(home, source, geometry=DEFAULT_GEOMETRY):
    base = folder(home)
    geometry = parse_geometry(geometry)
    current = status(home)
    if current['missing']: raise ValueError('Faltan herramientas gráficas: ' + ', '.join(current['missing']))
    script = base / 'session.py'
    if script.is_symlink(): raise ValueError('Launcher enlazado no permitido')
    temp = base / ('session.' + secrets.token_hex(8) + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f: f.write(source)
    os.replace(temp, script)
    units = Path(home) / '.config/systemd/user'; units.mkdir(parents=True, exist_ok=True)
    for p in [units, *units.parents]:
        if p.is_symlink(): raise ValueError('Ruta de unidades enlazada')
    service = units / 'axon-desktop.service'
    if service.is_symlink() or (service.exists() and '# AXON dedicated desktop v1' not in service.read_text()): raise ValueError('Existe una unidad ajena a AXON')
    # systemd quotes arguments inside "..." and expands % specifiers; escape both.
    def quoted(v): return '"' + str(v).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
    service.write_text('# AXON dedicated desktop v1\n[Unit]\nDescription=AXON dedicated graphical desktop\nAfter=default.target\n\n[Service]\nType=simple\nExecStart=/usr/bin/python3 ' + quoted(script) + ' supervise ' + quoted(home) + ' ' + quoted(geometry) + '\nRestart=on-failure\nRestartSec=3\nKillMode=control-group\nTimeoutStopSec=10\n\n[Install]\nWantedBy=default.target\n')
    os.chmod(service, 0o600); unit(['daemon-reload']); unit(['enable', 'axon-desktop.service'])
    if current.get('state') == 'active':
        # An already-running unit keeps its old session.py generation;
        # enable --now would not bounce it onto the script just written.
        unit(['try-restart', 'axon-desktop.service'])
    # 'start' is a no-op on an active unit — it covers the race where the
    # service exited cleanly between status() and try-restart.
    unit(['start', 'axon-desktop.service'])
    return status(home)

def orphan_pids():
    # Children of a SIGKILLed supervisor keep holding the display and ports.
    # Under the exclusive session lock, matches can only be AXON orphans.
    uid = os.getuid(); found = []
    try: entries = os.listdir('/proc')
    except OSError: return found
    for entry in entries:
        if not entry.isdigit() or int(entry) == os.getpid(): continue
        proc = Path('/proc') / entry
        try:
            if proc.stat().st_uid != uid: continue
            cmd = (proc / 'cmdline').read_bytes()
        except OSError: continue
        hit = (b'Xvfb' in cmd and DISPLAY.encode() in cmd) or (b'x11vnc' in cmd and str(VNC_PORT).encode() in cmd) or (b'websockify' in cmd and str(WS_PORT).encode() in cmd)
        if not hit and b'openbox' in cmd:
            try: hit = ('DISPLAY=' + DISPLAY).encode() in (proc / 'environ').read_bytes()
            except OSError: pass
        if hit: found.append(int(entry))
    return found

def x_server_live(display):
    socket_path = '/tmp/.X11-unix/X' + display.lstrip(':')
    if not Path(socket_path).exists(): return False
    try:
        if subprocess.run(['xdpyinfo', '-display', display], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3).returncode == 0: return True
    except (OSError, subprocess.SubprocessError): pass
    try:
        with socket.socket(socket.AF_UNIX) as probe:
            probe.settimeout(1); probe.connect(socket_path); return True
    except OSError: return False

def supervise(home, geometry=DEFAULT_GEOMETRY):
    # A hand-edited unit file must not crash-loop the service; fall back to
    # the default instead of propagating a ValueError.
    try: geometry = parse_geometry(geometry)
    except ValueError: geometry = DEFAULT_GEOMETRY
    base = folder(home); lock = os.open(base / 'session.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    # Reclaim orphaned children of a previous supervisor, then stale sockets.
    for pid in orphan_pids():
        try: os.kill(pid, signal.SIGTERM)
        except OSError: pass
    deadline = time.monotonic() + 3
    while orphan_pids() and time.monotonic() < deadline: time.sleep(.1)
    for pid in orphan_pids():
        try: os.kill(pid, signal.SIGKILL)
        except OSError: pass
    deadline = time.monotonic() + 2
    while orphan_pids() and time.monotonic() < deadline: time.sleep(.05)
    if not x_server_live(DISPLAY):
        for stale in (Path('/tmp/.X11-unix/X117'), Path('/tmp/.X117-lock')):
            try:
                if stale.is_symlink() or stale.exists(): stale.unlink()
            except OSError: pass
    if x_server_live(DISPLAY) or connected(VNC_PORT) or connected(WS_PORT): raise RuntimeError('El display o puerto de AXON está ocupado por otra sesión')
    mirror = physical_authority()
    children = []
    def cleanup():
        for child in reversed(children):
            if child.poll() is None: child.terminate()
        deadline = time.monotonic()+5
        for child in children:
            try: child.wait(timeout=max(.1,deadline-time.monotonic()))
            except subprocess.TimeoutExpired: child.kill()
    def stop(*_):
        cleanup(); sys.exit(0)
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    try:
        if mirror:
            env = dict(os.environ, DISPLAY=PHYSICAL, XAUTHORITY=str(mirror))
        else:
            authority = base / 'Xauthority'
            if authority.is_symlink(): raise ValueError('Xauthority enlazado no permitido')
            authority.touch(mode=0o600, exist_ok=True); os.chmod(authority, 0o600)
            # The cookie goes over stdin so it is never visible in ps(1).
            subprocess.run(['xauth', '-f', str(authority)], input='add ' + DISPLAY + ' . ' + secrets.token_hex(16) + '\n',
                           check=True, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
            env = dict(os.environ, DISPLAY=DISPLAY, XAUTHORITY=str(authority))
            children.append(subprocess.Popen(['Xvfb', DISPLAY, '-screen', '0', geometry + 'x24', '-nolisten', 'tcp', '-auth', str(authority)], env=env))
            for _ in range(50):
                if Path('/tmp/.X11-unix/X117').exists(): break
                if children[0].poll() is not None: raise RuntimeError('Xvfb no inició')
                time.sleep(.1)
            children.append(subprocess.Popen(['openbox'], env=env))
        # A per-launch password is required for RFB auth; without one, any local
        # process could inject keystrokes into the session. The panel reads it
        # from the authenticated status response.
        password_file = base / 'vnc-password'
        if password_file.is_symlink(): password_file.unlink()
        fd = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as f: f.write(secrets.token_urlsafe(24) + '\n')
        os.chmod(password_file, 0o600)
        children.append(subprocess.Popen(['x11vnc', '-display', env['DISPLAY'], '-auth', env['XAUTHORITY'], '-localhost', '-rfbport', str(VNC_PORT), '-forever', '-shared', '-passwdfile', str(password_file), '-quiet', '-noxdamage'], env=env))
        children.append(subprocess.Popen(['websockify', '--heartbeat', '30', '127.0.0.1:' + str(WS_PORT), '127.0.0.1:' + str(VNC_PORT)], env=env))
        while all(child.poll() is None for child in children): time.sleep(1)
        raise RuntimeError('Una herramienta de la sesión gráfica terminó')
    finally: cleanup()

def _xrandr(env, *args):
    return subprocess.run(['xrandr', *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, text=True)

def _modeline(width, height):
    # Prefer the system's timing tools; Xvfb has no physical monitor, so the
    # fallback timings only need to be plausible for RandR to accept them.
    for tool in ('cvt', 'gtf'):
        path = shutil.which(tool)
        if not path: continue
        try:
            p = subprocess.run([path, str(width), str(height), '60'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5, text=True)
        except (OSError, subprocess.SubprocessError): continue
        for line in p.stdout.splitlines():
            fields = line.strip().split('"')
            if fields and fields[0].strip() == 'Modeline' and len(fields) >= 3: return fields[2].strip().split()
    htotal = ((width + width * 3 // 20) // 8 + 1) * 8
    hsync_start = width + (htotal - width) // 3
    hsync_end = hsync_start + (htotal - width) // 3
    vtotal = height + 40
    clock = '%.2f' % (htotal * vtotal * 60 / 1e6)
    return [clock, str(width), str(hsync_start), str(hsync_end), str(htotal), str(height), str(height + 3), str(height + 8), str(vtotal)]

def resize(home, resolution):
    base = folder(home)
    if physical_authority(): raise ValueError('El cambio de tamaño no aplica a la pantalla física del servidor')
    geom = parse_geometry(resolution)
    width, height = (int(v) for v in geom.split('x'))
    if not x_server_live(DISPLAY): raise ValueError('La sesión dedicada no está en ejecución')
    if not shutil.which('xrandr'): raise ValueError('Falta xrandr en el servidor para cambiar el tamaño en caliente')
    env = dict(os.environ, DISPLAY=DISPLAY, XAUTHORITY=str(base / 'Xauthority'))
    listing = _xrandr(env, '-display', DISPLAY).stdout
    output = next((line.split()[0] for line in listing.splitlines() if ' connected' in line), None)
    if not output: raise ValueError('No se encontró la salida de pantalla virtual')
    mode = 'axon-' + geom
    if not any(line.strip().startswith(mode) for line in listing.splitlines()):
        if _xrandr(env, '--display', DISPLAY, '--newmode', mode, *_modeline(width, height)).returncode: raise RuntimeError('xrandr no aceptó la resolución pedida')
        if _xrandr(env, '--display', DISPLAY, '--addmode', output, mode).returncode: raise RuntimeError('xrandr no pudo registrar la resolución')
    if _xrandr(env, '--display', DISPLAY, '--fb', geom, '--output', output, '--mode', mode).returncode: raise RuntimeError('No se pudo aplicar el tamaño de pantalla')
    return dict(ok=True, resolution=geom)

def main(request):
    home = request['home']; base = folder(home); action = request.get('action')
    if action == 'status': return status(home)
    if action == 'start': return install(home, request['workerSource'], request.get('resolution'))
    if action == 'resize': return resize(home, request.get('resolution'))
    if action == 'stop':
        # Stopping a unit that was never installed fails; make stop idempotent.
        probe = subprocess.run(['systemctl', '--user', 'show', 'axon-desktop.service', '-p', 'LoadState', '--value'],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
        if probe.stdout.decode().strip() == 'loaded': unit(['stop', 'axon-desktop.service'])
        return status(home)
    if action == 'launch':
        if not status(home)['connected']: raise ValueError('El escritorio todavía no está conectado')
        app = request.get('app')
        if app not in APPS or not Path(APPS[app][0]).is_file(): raise ValueError('Aplicación no disponible')
        argv = list(APPS[app])
        if app == 'browser': argv += ['--user-data-dir=' + str(base / 'chrome'), '--no-first-run', '--disable-session-crashed-bubble']
        if app == 'firefox':
            profile = base / 'firefox'; profile.mkdir(exist_ok=True, mode=0o700); argv += ['--no-remote', '--profile', str(profile)]
        mirror = physical_authority()
        disp, auth = (PHYSICAL, str(mirror)) if mirror else (DISPLAY, str(base / 'Xauthority'))
        env = dict(os.environ, DISPLAY=disp, XAUTHORITY=auth)
        name = 'axon-desktop-app-' + secrets.token_hex(8)
        result = subprocess.run(['systemd-run', '--user', '--collect', '--quiet', '--unit=' + name,
                                 '--property=BindsTo=axon-desktop.service', '--property=After=axon-desktop.service',
                                 '/usr/bin/env', 'DISPLAY=' + disp, 'XAUTHORITY=' + auth, *argv],
                                env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        if result.returncode: raise RuntimeError('La aplicación no pudo abrirse')
        return dict(ok=True, app=app, unit=name)
    raise ValueError('Acción inválida')

if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'supervise': supervise(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else DEFAULT_GEOMETRY)
    else:
        try: print(json.dumps(main(json.load(sys.stdin))))
        except Exception as e: print(json.dumps(dict(ok=False,error=str(e)[:240])))
