#!/usr/bin/env python3
"""AXON account registry and SSH launcher. Never return credentials to the UI.

The native profile stays in place; managed homes have their own auth, history
and runtime. Only explicitly listed configuration is shared with the native
home. A launch snapshots the selected account, never a mutable auth symlink.
"""
import base64
import contextlib
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import time

AGENTS = {
    'codex': {'bin': 'codex', 'root': '.codex', 'env': 'CODEX_HOME',
              'shared': ['config.toml', 'AGENTS.md', 'skills', 'plugins', 'rules']},
    'claude': {'bin': 'claude', 'root': '.claude', 'env': 'CLAUDE_CONFIG_DIR',
               'shared': ['settings.json', 'CLAUDE.md', 'skills', 'plugins']},
}
class Failure(Exception):
    def __init__(self, message, status=400): super().__init__(message); self.status = status

def safe(path):
    path = Path(path)
    for p in [path, *path.parents]:
        if p.is_symlink(): raise Failure('Ruta con enlace simbólico no admitida', 409)
    return path

def private_dir(path):
    safe(path).mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)

def atomic(path, content, mode=0o600):
    safe(path)
    fd, tmp = tempfile.mkstemp(prefix='.axon-', dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'w') as f: f.write(content); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def read_json(path):
    safe(path)
    if not path.exists(): return {}
    if path.stat().st_size > 2_000_000: raise Failure('Archivo de cuenta demasiado grande', 409)
    try: return json.loads(path.read_text())
    except (ValueError, OSError): raise Failure('No se pudo leer la configuración de cuentas', 409)

def label(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 48 or any(ord(c) < 32 for c in value):
        raise Failure('Usá un nombre de cuenta de 1 a 48 caracteres')
    return value.strip()

class Store:
    def __init__(self, home):
        self.home = safe(Path(home).absolute())
        self.root = self.home / '.local/share/axon/agent-accounts'
        self.registry = self.root / 'accounts.json'
    def load(self):
        d = read_json(self.registry)
        if not d: d = {'version': 1, 'agents': {}}
        if d.get('version') != 1 or not isinstance(d.get('agents'), dict): raise Failure('Registro de cuentas incompatible', 409)
        for agent in AGENTS:
            d['agents'].setdefault(agent, {'active': 'current', 'profiles': [{'id': 'current', 'label': 'Actual'}]})
        return d
    @contextlib.contextmanager
    def lock(self):
        private_dir(self.root)
        p = safe(self.root / '.lock')
        fd = os.open(p, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try: fcntl.flock(fd, fcntl.LOCK_EX); yield
        finally: os.close(fd)
    def save(self, d): atomic(self.registry, json.dumps(d, ensure_ascii=False, indent=2) + '\n')
    def profile(self, d, agent, ident):
        if agent not in AGENTS: raise Failure('Este agente todavía no admite varias cuentas', 404)
        if not isinstance(ident, str) or not re.fullmatch(r'current|a-[a-f0-9]{16}', ident): raise Failure('Cuenta inválida')
        p = next((p for p in d['agents'][agent]['profiles'] if p['id'] == ident), None)
        if not p: raise Failure('Cuenta no encontrada', 404)
        return p
    def profile_home(self, agent, ident):
        native = ident == 'current' and not (agent == 'codex' and self.load()['agents']['codex'].get('serverWide'))
        return safe(self.home / AGENTS[agent]['root'] if native else self.root / agent / ident)
    def identity(self, agent, ident):
        root = self.profile_home(agent, ident)
        result = {'connected': False, 'email': None, 'method': None}
        try:
            if agent == 'codex':
                d = read_json(root / 'auth.json'); t = d.get('tokens') or {}
                if t.get('refresh_token') or t.get('access_token'):
                    result.update(connected=True, method='ChatGPT')
                    tok = t.get('id_token') or t.get('access_token') or ''
                    part = tok.split('.')[1]
                    claim = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))
                    result['email'] = claim.get('email') or (claim.get('https://api.openai.com/profile') or {}).get('email')
                elif d.get('OPENAI_API_KEY'): result.update(connected=True, method='API')
            else:
                d = read_json(root / '.credentials.json')
                oauth = d.get('claudeAiOauth') or {}
                result.update(connected=bool(oauth.get('accessToken') or oauth.get('refreshToken')), method='Claude' if oauth else None)
                account_file = self.home / '.claude.json' if ident == 'current' else root / '.claude.json'
                account = read_json(account_file).get('oauthAccount') or {}
                result['email'] = account.get('emailAddress')
        except (ValueError, IndexError, TypeError, Failure): pass
        # This is stored-login availability, not a network entitlement test.
        return result
    def login_busy(self, agent, ident):
        p = self.root / agent / (ident + '.login-lock')
        if not p.exists(): return False
        fd = os.open(safe(p), os.O_RDWR | os.O_NOFOLLOW)
        try:
            try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); return False
            except BlockingIOError: return True
        finally: os.close(fd)
    def listing(self, agent):
        if agent not in AGENTS: raise Failure('Agente no compatible', 404)
        d = self.load(); state = d['agents'][agent]
        return {'ok': True, 'agent': agent, 'active': state['active'],
                'scope': 'server' if state.get('serverWide') else 'terminal',
                'desktop': read_json(self.root / 'desktop-status.json') if agent == 'codex' else None,
                'launcherInstalled': (self.home / '.local/bin/axon-agent').is_file(),
                'profiles': [{**p, **self.identity(agent, p['id']), 'active': p['id'] == state['active'],
                              'loginBusy': self.login_busy(agent, p['id']), 'native': p['id'] == 'current',
                              'home': str(self.profile_home(agent, p['id']))} for p in state['profiles']]}
    def prepare(self, agent, ident):
        root = self.profile_home(agent, ident)
        if root == self.home / AGENTS[agent]['root']: return root
        private_dir(root)
        native = self.home / AGENTS[agent]['root']
        for name in AGENTS[agent]['shared']:
            target, dest = native / name, root / name
            # These are deliberate configuration links, never auth or sessions.
            if dest.is_symlink():
                if os.readlink(dest) != str(target): raise Failure('Configuración compartida modificada', 409)
            elif dest.exists(): raise Failure('Configuración de cuenta en conflicto', 409)
            else: dest.symlink_to(target)
        return root
    def install(self, source, server_source=None):
        if not source.startswith('#!/usr/bin/env python3\n'): raise Failure('Lanzador inválido')
        bin_dir = self.home / '.local/bin'
        safe(bin_dir).mkdir(parents=True, exist_ok=True)
        atomic(bin_dir / 'axon-agent', source, 0o700)
        cfg = self.home / '.config/axon'; private_dir(cfg)
        if server_source:
            if not server_source.startswith('#!/usr/bin/env python3\n'): raise Failure('Selector de servidor inválido')
            atomic(cfg / 'codex-server-account.py', server_source, 0o700)
        shell = '# AXON account launcher: selection is read on every invocation.\n'
        for agent in AGENTS:
            shell += agent + '() { command "$HOME/.local/bin/axon-agent" run ' + agent + ' "$@"; }\n'
        atomic(cfg / 'agent-accounts-shell.sh', shell)
        line = '[ ! -f "$HOME/.config/axon/agent-accounts-shell.sh" ] || . "$HOME/.config/axon/agent-accounts-shell.sh"'
        for name in ['.bashrc', '.zshrc']:
            p = safe(self.home / name)
            old = p.read_text() if p.exists() else ''
            if line not in old:
                mode = stat.S_IMODE(p.stat().st_mode) if p.exists() else 0o600
                if p.exists(): atomic(self.home / (name + '.axon-accounts-' + str(time.time_ns()) + '.bak'), old, mode)
                atomic(p, old.rstrip() + '\n\n# AXON: cuentas de agentes\n' + line + '\n', mode)
    def point_server_auth(self, ident):
        """One credential owner, also used by the desktop's stable CODEX_HOME.

        Codex 0.160 writes auth through OpenOptions, preserving this link.
        Keeping the desktop home stable preserves its threads and projects.
        The personal credential is moved intact before enabling server scope.
        """
        native = safe(self.home / '.codex') / 'auth.json'
        target = self.profile_home('codex', ident) / 'auth.json'
        safe(target)
        if native.is_symlink():
            old = Path(os.readlink(native))
            allowed = [self.root / 'codex' / p['id'] / 'auth.json' for p in self.load()['agents']['codex']['profiles']]
            if old not in allowed: raise Failure('El login del servidor tiene un enlace no administrado', 409)
        else: raise Failure('El login del servidor dejó de usar el selector; revisá la conexión antes de cambiar de cuenta', 409)
        tmp = native.parent / ('.axon-auth-' + secrets.token_hex(8))
        try: tmp.symlink_to(target); os.replace(tmp, native)
        finally:
            if tmp.is_symlink(): tmp.unlink()
    def enable_server(self, d):
        state = d['agents']['codex']
        if state.get('serverWide'): return
        if not safe(self.home / '.config/axon/codex-server-account.py').is_file(): raise Failure('Instalá el selector de servidor antes de habilitarlo', 409)
        # Check dependencies before changing any credential path.
        try: import websockets  # Host-only reconciler; no credentials leave this host.
        except ImportError: raise Failure('Falta la dependencia del selector de servidor. Ejecutá axon setup-agents en el servidor y reintentá.', 503)
        native = safe(self.home / '.codex/auth.json')
        if not native.is_file(): raise Failure('Conectá la cuenta original de Codex antes de habilitar el servidor', 409)
        original = self.root / 'codex/current'; private_dir(original)
        dest = safe(original / 'auth.json')
        if dest.exists(): raise Failure('La cuenta original ya tiene un respaldo administrado; revisá la migración', 409)
        os.rename(native, dest)
        os.chmod(dest, 0o600)
        try: native.symlink_to(dest)
        except OSError: os.rename(dest, native); raise
        state['serverWide'] = True
        # Publish the mapping before preparing the new current profile.
        self.save(d)
        self.prepare('codex', 'current')
    def schedule_desktop(self):
        helper = safe(self.home / '.config/axon/codex-server-account.py')
        if not helper.is_file(): raise Failure('Falta instalar el selector del servidor', 409)
        atomic(self.root / 'desktop-status.json', json.dumps({'state': 'pending', 'selectedId': self.load()['agents']['codex']['active'], 'updatedAt': int(time.time())}) + '\n')
        # A detached child still belongs to AXON's Docker cgroup. A transient
        # user service survives an AXON redeploy while waiting for idle turns.
        manager = shutil.which('systemd-run')
        runtime = Path('/run/user') / str(os.getuid())
        env = {**os.environ, 'XDG_RUNTIME_DIR': str(runtime), 'DBUS_SESSION_BUS_ADDRESS': 'unix:path=' + str(runtime / 'bus')}
        try:
            if not manager or not (runtime / 'bus').exists(): raise OSError('User service manager unavailable')
            result = subprocess.run([manager, '--user', '--collect', '--quiet', '--unit=axon-codex-account-' + secrets.token_hex(8), '--property=Type=exec', '--setenv=PATH=' + os.environ.get('PATH', '/usr/bin:/bin'), sys.executable, str(helper), str(self.home)], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            if result.returncode: raise OSError('User service dispatch failed')
        except (OSError, subprocess.TimeoutExpired):
            atomic(self.root / 'desktop-status.json', json.dumps({'state': 'error', 'selectedId': self.load()['agents']['codex']['active'], 'verified': False, 'reason': 'schedule-failed'}) + '\n')
            raise Failure('No se pudo programar el cambio de cuenta del servidor; reintentá aplicar la cuenta', 503)
    def change(self, req):
        agent, action = req.get('agent'), req.get('action')
        if agent not in AGENTS: raise Failure('Agente no compatible', 404)
        with self.lock():
            d = self.load(); state = d['agents'][agent]
            if action == 'create':
                name = label(req.get('label'))
                if any(p['label'].casefold() == name.casefold() for p in state['profiles']): raise Failure('Ya existe una cuenta con ese nombre', 409)
                if len(state['profiles']) >= 12: raise Failure('Máximo de 12 cuentas por agente')
                p = {'id': 'a-' + secrets.token_hex(8), 'label': name}
                self.prepare(agent, p['id']); state['profiles'].append(p)
            elif action in ['activate', 'rename']:
                p = self.profile(d, agent, req.get('id'))
                if action == 'activate':
                    if not self.identity(agent, p['id'])['connected']: raise Failure('Conectá esta cuenta antes de activarla', 409)
                    if self.login_busy(agent, p['id']): raise Failure('Esperá a que termine el login', 409)
                    state['active'] = p['id']
                else:
                    name = label(req.get('label'))
                    if any(x['id'] != p['id'] and x['label'].casefold() == name.casefold() for x in state['profiles']): raise Failure('Nombre de cuenta duplicado', 409)
                    p['label'] = name
            elif action == 'enable-server':
                if agent != 'codex': raise Failure('La conexión de escritorio sólo aplica a Codex')
                if not self.identity(agent, state['active'])['connected']: raise Failure('Conectá la cuenta antes de habilitarla en el servidor', 409)
                self.enable_server(d)
            elif action != 'install': raise Failure('Acción no admitida')
            if action in ['create', 'install']: self.install(req['source'], req.get('serverSource'))
            self.save(d)
            if agent == 'codex' and state.get('serverWide') and action in ['activate', 'enable-server']:
                self.schedule_desktop()
        return {**self.listing(agent), 'createdId': p['id'] if action == 'create' else None}
    def invocation(self, agent, ident, args, login=False, server_default=False):
        d = self.load(); p = self.profile(d, agent, ident or d['agents'][agent]['active'])
        root = self.profile_home(agent, p['id']); native = root == self.home / AGENTS[agent]['root']
        shared_server = agent == 'codex' and server_default and d['agents']['codex'].get('serverWide')
        if shared_server:
            # The desktop must never block a correctly authenticated terminal.
            # Until its identity is verified, use the chosen profile's own
            # runtime rather than attaching to the old-account daemon.
            status = read_json(self.root / 'desktop-status.json')
            shared_server = status.get('selectedId') == p['id'] and status.get('state') == 'ready' and status.get('verified')
            if shared_server: root = safe(self.home / '.codex')
        if not native:
            # Reject command-line attempts to silently replace account credentials.
            if agent == 'codex' and any('cli_auth_credentials_store' in arg or 'chatgpt_base_url' in arg for arg in args):
                raise Failure('Usá la configuración de la cuenta elegida')
        exe = shutil.which(AGENTS[agent]['bin'])
        if not exe: raise Failure('El agente no está instalado', 404)
        env = dict(os.environ); env['HOME'] = str(self.home)
        if agent == 'claude' and native:
            # With CLAUDE_CONFIG_DIR explicitly set, Claude relocates its
            # .claude.json metadata inside that directory. Keep legacy layout.
            env.pop('CLAUDE_CONFIG_DIR', None)
        else: env[AGENTS[agent]['env']] = str(root)
        if not native:
            if any(env.get(k) for k in ['OPENAI_WIF_PROVIDER_ID', 'OPENAI_WIF_RULE_ID', 'OPENAI_IDENTITY_TOKEN_FILE']):
                raise Failure('El entorno impone identidad federada; abrí una terminal sin esa identidad')
        # An explicitly chosen saved account must not be silently overridden
        # by an API credential inherited from an unrelated shell session.
        for key in ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']:
            env.pop(key, None)
        if agent == 'claude' and not native:
            settings = read_json(self.home / '.claude/settings.json')
            credential_keys = {'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'}
            if credential_keys.intersection((settings.get('env') or {}).keys()) or settings.get('apiKeyHelper'):
                raise Failure('La configuración compartida de Claude impone credenciales de API; separá esa configuración antes de usar una cuenta de suscripción', 409)
        if agent == 'codex':
            # Each invocation owns its runtime; never attach to the other account's daemon.
            args = ([] if shared_server else ['--no-daemon']) + ([] if native and not shared_server else ['-c', 'cli_auth_credentials_store="file"']) + args
        return [exe, *args], env, p

def main():
    if len(sys.argv) > 1:
        action = sys.argv[1]
        agent = sys.argv[2] if len(sys.argv) > 2 else ''
        store = Store(os.path.expanduser('~'))
        if action in ['login', 'run-profile']:
            ident = sys.argv[3] if len(sys.argv) > 3 else ''
            args = sys.argv[4:]
        else: ident, args = None, sys.argv[3:]
        if action == 'status': print(json.dumps(store.listing(agent), ensure_ascii=False)); return
        if action not in ['run', 'run-profile', 'login']: raise Failure('Uso: axon-agent run|run-profile|login|status codex|claude [cuenta]')
        if action == 'login':
            d = store.load(); p = store.profile(d, agent, ident)
            private_dir(store.root / agent)
            fd = os.open(safe(store.root / agent / (ident + '.login-lock')), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            try:
                try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError: raise Failure('Ya hay un login en curso para esta cuenta', 409)
                store.prepare(agent, ident)
                args = ['login', '--device-auth'] if agent == 'codex' else ['auth', 'login', '--claudeai']
                argv, env, p = store.invocation(agent, ident, args, login=True)
                print('Iniciar sesión · ' + p['label'] + '\nCompletá el login en tu navegador. La cuenta predeterminada no cambia.', flush=True)
                code = subprocess.call(argv, env=env)
                if not code and not store.identity(agent, ident)['connected']: raise Failure('El login terminó, pero no se encontró una credencial local. Revisá el almacén nativo.', 409)
                sys.exit(code)
            finally: os.close(fd)
        if action == 'run' and args and args[0] in ['update', 'upgrade']:
            # Preserve the host's existing pnpm-only update routing. Native
            # Codex update may otherwise invoke a different package manager.
            sync = shutil.which('sync-tool')
            if sync: os.execvp(sync, [sync, '--only', agent, *args[1:]])
            manager = shutil.which('pnpm')
            if not manager: raise Failure('pnpm no está disponible para actualizar el agente')
            package = '@openai/codex' if agent == 'codex' else '@anthropic-ai/claude-code'
            os.execvp(manager, [manager, 'add', '-g', package + '@latest'])
        argv, env, p = store.invocation(agent, ident, args, server_default=action == 'run')
        if sys.stderr.isatty() and not any(arg in ['--help', '-h', '--version', '-V'] for arg in args): print('\033[36m' + agent.title() + ' · ' + p['label'] + '\033[0m', file=sys.stderr)
        os.execvpe(argv[0], argv, env)
    else:
        req = json.load(sys.stdin); store = Store(req['home'])
        result = store.listing(req['agent']) if req['action'] == 'list' else store.change(req)
        print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    try: main()
    except Failure as e:
        if len(sys.argv) > 1: print(str(e), file=sys.stderr); sys.exit(1)
        print(json.dumps({'ok': False, 'error': str(e), 'status': e.status}))
    except (OSError, KeyError, TypeError, ValueError):
        if len(sys.argv) > 1: print('No se pudo operar la cuenta; revisá los permisos y el registro.', file=sys.stderr); sys.exit(1)
        print(json.dumps({'ok': False, 'error': 'No se pudo operar el registro de cuentas', 'status': 409}))
