#!/usr/bin/env python3
"""AXON's Linux installer/updater. Only Python's standard library is required."""
import argparse
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import shlex
import socket
import subprocess
import sys
import tarfile
import time
import urllib.request
import uuid

REPOSITORY = 'https://github.com/LucasSabena/axon.git'
DEFAULT_ROOT = Path.home() / '.local/share/axon-install'


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def atomic(path, content, mode=0o600):
    temp = path.with_name(path.name + '.' + secrets.token_hex(6) + '.tmp')
    try:
        fd = os.open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, mode)
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def read_state(root):
    return json.loads((root / 'installation.json').read_text())


def save_state(root, state):
    atomic(root / 'installation.json', json.dumps(state, indent=2) + '\n')


@contextmanager
def lock(root):
    with (root / 'update.lock').open('a') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Ya hay una instalación o actualización en curso.')
        yield


def preflight():
    if not sys.platform.startswith('linux'):
        raise RuntimeError('El instalador requiere Linux. Para Windows/macOS usá un servidor o VM Linux.')
    for command in ['git', 'docker', 'python3']:
        if not shutil.which(command):
            raise RuntimeError(f'Falta {command}. Instalalo antes de continuar.')
    run(['docker', 'info'], stdout=subprocess.DEVNULL)
    version = run(['docker', 'compose', 'version', '--short'], capture_output=True, text=True).stdout
    numbers = re.search(r'(\d+)\.(\d+)', version)
    if not numbers or tuple(map(int, numbers.groups())) < (2, 20):
        raise RuntimeError('Se requiere Docker Compose 2.20 o posterior.')


def compose(root, manifest, *args):
    run(['docker', 'compose', '--project-name', 'axon-' + hashlib.sha256(str(root).encode()).hexdigest()[:12], '-f', manifest, *args])


def manifest(root, state, release):
    # JSON is valid YAML. Paths and user-provided values never become shell syntax.
    service = {
        'image': release['image'], 'container_name': state['name'], 'restart': 'unless-stopped',
        'pid': 'host', 'network_mode': 'host', 'privileged': True,
        'env_file': [str(root / '.env')],
        'environment': {'CONFIG_PATH': '/app/data/config.json', 'PORT': str(state['port']),
            'AXON_BIND_HOST': state['bind'], 'HOST_USER': state['hostUser'],
            'AXON_PUBLIC_ORIGIN': state['origin'], 'AXON_VERSION': release['version'],
            'AXON_REVISION': release['revision'], 'AXON_CONTAINER_NAME': state['name']},
        'labels': {'io.axon.installation': str(root)},
        'volumes': [{'type': 'bind', 'source': str(root / 'data'), 'target': '/app/data'},
            {'type': 'bind', 'source': '/var/run/docker.sock', 'target': '/var/run/docker.sock'},
            {'type': 'bind', 'source': '/', 'target': '/hostfs', 'read_only': True, 'bind': {'propagation': 'rslave'}}],
        'healthcheck': {'test': ['CMD', 'bun', '-e',
            f"const r=await fetch('http://127.0.0.1:{state['port']}/api/health');const d=await r.json();if(!r.ok||d.ok!==true||d.revision!==process.env.AXON_REVISION)process.exit(1)"],
            'interval': '5s', 'timeout': '5s', 'retries': 12, 'start_period': '15s'},
    }
    if state.get('agentPython'):
        service['environment']['AXON_AGENT_PYTHON'] = state['agentPython']
    if state.get('cloudflaredConfig'):
        service['volumes'].append({'type': 'bind', 'source': state['cloudflaredConfig'], 'target': '/app/cloudflared-config.yml'})
    return json.dumps({'services': {'axon': service}}, indent=2) + '\n'


def check_owner(root, name):
    result = subprocess.run(['docker', 'inspect', name], capture_output=True, text=True)
    if result.returncode:
        return
    labels = json.loads(result.stdout)[0].get('Config', {}).get('Labels', {}) or {}
    if labels.get('io.axon.installation') != str(root):
        raise RuntimeError(f'El contenedor {name} pertenece a otra instalación. Elegí otro --name.')


def checkout(root, state, ref):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,127}', ref) or '..' in ref:
        raise RuntimeError('Referencia Git inválida.')
    repo = root / 'repository.git'
    if not repo.exists():
        run(['git', 'clone', '--bare', state['repository'], repo])
    run(['git', '--git-dir', repo, 'remote', 'set-url', 'origin', state['repository']])
    # Fetch exactly the requested branch/tag/revision; no working tree is reset.
    run(['git', '--git-dir', repo, 'fetch', '--force', 'origin', ref])
    revision = run(['git', '--git-dir', repo, 'rev-parse', 'FETCH_HEAD'], capture_output=True, text=True).stdout.strip()
    dest = root / 'releases' / revision
    if not dest.exists():
        dest.mkdir(parents=True)
        archive = root / 'source.tar'
        try:
            with archive.open('wb') as out:
                run(['git', '--git-dir', repo, 'archive', revision], stdout=out)
            with tarfile.open(archive) as tar:
                # Avoid symlink or path traversal even with an explicitly supplied repository.
                for member in tar.getmembers():
                    if not (member.isfile() or member.isdir()) or Path(member.name).is_absolute() or '..' in Path(member.name).parts:
                        raise RuntimeError('Archivo de publicación inválido.')
                if sys.version_info >= (3, 12): tar.extractall(dest, filter='data')
                else: tar.extractall(dest)
        except Exception:
            shutil.rmtree(dest)
            raise
        finally:
            archive.unlink(missing_ok=True)
    version = json.loads((dest / 'package.json').read_text())['version']
    return {'revision': revision, 'version': version, 'image': 'axon-local:' + revision}, dest


def build(release, source):
    run(['docker', 'build', '--build-arg', 'AXON_VERSION=' + release['version'], '--build-arg', 'AXON_REVISION=' + release['revision'], '-t', release['image'], source])


def backup(root, old):
    stamp = time.strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(3)
    dest = root / 'backups' / stamp
    dest.mkdir(parents=True, mode=0o700)
    for filename in ['.env', 'installation.json', 'compose.json']:
        shutil.copy2(root / filename, dest / filename)
        os.chmod(dest / filename, 0o600)
    # The old application has stopped. An isolated container can read root-owned
    # files without changing host permissions or copying a live SQLite journal.
    fd = os.open(dest / 'data.tar', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'python3',
            '--mount', f'type=bind,source={root / "data"},target=/data,readonly', old['image'], '-c',
            'import sys,tarfile; t=tarfile.open(fileobj=sys.stdout.buffer,mode="w|"); t.add("/data",arcname="data"); t.close()'], stdout=stream)
    return str(dest)


def migrate_data(root, state, release):
    source = state.get('pendingMigration')
    if not source: return
    # Older AXON containers own private files as root. Copy in an isolated
    # container instead of weakening permissions or requiring sudo on the host.
    worker = """import base64,json,shutil
from pathlib import Path
source=Path('/source'); target=Path('/target')
config=json.loads((source/'config.json').read_text())
auth=config.get('auth',{})
password=auth.get('passwordHash','')
if not isinstance(auth.get('username'),str) or not auth['username'] or ':' not in password:
    raise RuntimeError('La configuración original no tiene un login válido.')
salt,hashed=password.split(':',1)
if not salt or len(base64.b64decode(hashed,validate=True))!=32:
    raise RuntimeError('El hash del login original es inválido.')
shutil.copytree(source,target,symlinks=True,dirs_exist_ok=True)
"""
    run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'python3',
        '--mount', f'type=bind,source={source},target=/source,readonly',
        '--mount', f'type=bind,source={root / "data"},target=/target', release['image'], '-c', worker])
    state['migratedFrom'] = state.pop('pendingMigration')
    save_state(root, state)


def verify(state, release):
    # Exact revision check also detects an occupied port or stale frontend/backend.
    with urllib.request.urlopen(f'http://127.0.0.1:{state["port"]}/api/health', timeout=10) as response:
        health = json.load(response)
    if health.get('ok') is not True or health.get('revision') != release['revision']:
        raise RuntimeError('La versión publicada no respondió correctamente.')


def activate(root, state, release, source):
    current, previous = state.get('current'), state.get('previous')
    old_text = (root / 'compose.json').read_text() if current else None
    candidate = root / 'candidate.json'
    atomic(candidate, manifest(root, state, release))
    compose(root, candidate, 'config', '--quiet')
    state.update(operation='activating', error=None)
    save_state(root, state)
    stopped = False
    try:
        if current:
            stopped = True
            compose(root, root / 'compose.json', 'stop', '--timeout', '60')
            state['lastBackup'] = backup(root, current)
            save_state(root, state)
        os.replace(candidate, root / 'compose.json')
        compose(root, root / 'compose.json', 'up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120')
        verify(state, release)
    except BaseException as error:
        if current and (stopped or old_text):
            atomic(root / 'compose.json', old_text)
            try:
                compose(root, root / 'compose.json', 'up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120')
                verify(state, current)
                state['operation'] = 'rolled-back'
            except BaseException as recovery:
                state['operation'] = 'recovery-required'
                state['recoveryError'] = str(recovery)
        else:
            state['operation'] = 'failed'
            # Stop only this newly installed, labeled container after failed health.
            if (root / 'compose.json').exists():
                try: compose(root, root / 'compose.json', 'stop')
                except Exception: pass
        state['current'], state['previous'], state['error'] = current, previous, str(error)
        save_state(root, state)
        raise
    state.update(current=release, previous=current if current != release else previous, operation='ready', error=None, updatedAt=time.strftime('%Y-%m-%dT%H:%M:%S%z'))
    save_state(root, state)
    # Stable launcher location; the currently running updater keeps its own code.
    if source and (source / 'deployment/axon.py').is_file():
        atomic(root / 'manager.py', (source / 'deployment/axon.py').read_text(), 0o700)
    print(f'AXON {release["version"]} listo en {state["origin"]} ({release["revision"][:12]}).', flush=True)


def update(root, ref, rollback=False):
    with lock(root):
        preflight()
        state = read_state(root)
        check_owner(root, state['name'])
        try:
            if rollback:
                release = state.get('previous')
                if not release: raise RuntimeError('No hay una versión anterior para recuperar.')
                source = root / 'releases' / release['revision']
            else:
                state.update(operation='building', error=None)
                save_state(root, state)
                release, source = checkout(root, state, ref)
                if release == state.get('current'):
                    state.update(operation='ready', error=None)
                    save_state(root, state)
                    print('Ya tenés la última versión solicitada.'); return
                build(release, source)
                if not state.get("current"): migrate_data(root, state, release)
            activate(root, state, release, source)
        except BaseException as error:
            if state.get('operation') not in ['rolled-back', 'recovery-required', 'failed']:
                state.update(operation='failed', error=str(error))
                save_state(root, state)
            raise


def install(args):
    preflight()
    root = args.root
    if root.exists() and any(root.iterdir()):
        raise RuntimeError('La carpeta de instalación ya contiene archivos. Usá axon update o elegí otro --root.')
    if ',' in str(root) or '\n' in str(root):
        raise RuntimeError('La ruta de instalación no puede contener comas o saltos de línea.')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}', args.name):
        raise RuntimeError('Nombre de contenedor inválido.')
    if not 1024 <= args.port <= 65535: raise RuntimeError('Usá un puerto entre 1024 y 65535.')
    check_owner(root, args.name)
    with socket.socket() as test: test.bind((args.bind, args.port))
    user = pwd.getpwnam(args.host_user)
    origin = args.origin or f'http://localhost:{args.port}'
    if not re.fullmatch(r'https?://[^/\s]+', origin): raise RuntimeError('Usá un origen completo sin ruta final, por ejemplo https://axon.example.com.')
    if args.existing_data and not args.existing_data.is_dir(): raise RuntimeError('La carpeta --existing-data no existe.')
    if args.existing_data and ',' in str(args.existing_data): raise RuntimeError('La ruta de datos no puede contener comas.')
    cloudflared = str(args.cloudflared_config.resolve(strict=True)) if args.cloudflared_config else None
    env = args.env_file.read_text() if args.env_file else ''
    if not re.search(r'^SESSION_SECRET=.+$', env, re.M): env += '\nSESSION_SECRET=' + secrets.token_urlsafe(48) + '\n'
    root.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(root, 0o700)
    data = root / 'data'
    data.mkdir(mode=0o700)
    atomic(root / '.env', env)
    password = None
    if not args.existing_data:
        password = secrets.token_urlsafe(24)
        salt = str(uuid.uuid4())
        hashed = salt + ':' + base64.b64encode(hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000, dklen=32)).decode()
        cfg = {'auth': {'username': 'admin', 'passwordHash': hashed}, 'domains': [], 'projects': [],
               'settings': {'hostUser': user.pw_name, 'scanDirs': [], 'scanIntervalMs': 5000, 'protectedPids': [1], 'protectedPorts': [22, 80, 443, args.port, 9090, 9443]}}
        atomic(data / 'config.json', json.dumps(cfg, indent=2) + '\n')
        atomic(root / 'initial-password.txt', password + '\n')
    state = {'schema': 1, 'repository': args.repository, 'name': args.name, 'port': args.port, 'bind': args.bind,
             'origin': origin, 'hostUser': user.pw_name, 'current': None, 'previous': None, 'operation': 'new'}
    if args.existing_data: state['pendingMigration'] = str(args.existing_data.resolve())
    if cloudflared: state['cloudflaredConfig'] = cloudflared
    save_state(root, state)
    atomic(root / 'manager.py', Path(__file__).read_text(), 0o700)
    atomic(root / 'axon', '#!/bin/sh\nexec python3 ' + shlex.quote(str(root / 'manager.py')) + ' --root ' + shlex.quote(str(root)) + ' \"$@\"\n', 0o700)
    bin_dir = Path.home() / '.local/bin'
    bin_dir.mkdir(parents=True, exist_ok=True)
    link = bin_dir / 'axon'
    if not args.no_link and not link.exists() and not link.is_symlink(): link.symlink_to(root / 'axon')
    update(root, args.ref)
    if password: print(f'Usuario: admin. Contraseña inicial guardada en {root / "initial-password.txt"} (sólo tu usuario puede leerla).')
    print(f'Actualizar: {root / "axon"} update\nEstado y registro: {root / "axon"} status\nInstalaciones existentes: los datos originales se conservan.')


def setup_agents(root):
    # Optional host dependency, isolated from OS Python and other projects.
    with lock(root):
        state = read_state(root)
        if state['hostUser'] != pwd.getpwuid(os.getuid()).pw_name:
            raise RuntimeError('Ejecutá setup-agents como el usuario HOST_USER dueño de esta instalación.')
        runtime = root / 'agent-runtime'
        run(['python3', '-m', 'venv', runtime])
        python = runtime / 'bin/python'
        run([python, '-m', 'pip', 'install', 'websockets==15.0.1'])
        state['agentPython'] = str(python)
        atomic(root / 'compose.json', manifest(root, state, state['current']))
        compose(root, root / 'compose.json', 'up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120')
        verify(state, state['current'])
        save_state(root, state)
        print('Dependencia para cambiar cuentas de Codex Desktop instalada. Activá el selector desde Agentes.')


def main():
    parser = argparse.ArgumentParser(description='Instalá y actualizá AXON conservando tus datos.')
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    sub = parser.add_subparsers(dest='command', required=True)
    ins = sub.add_parser('install')
    ins.add_argument('--root', type=Path, default=argparse.SUPPRESS)
    ins.add_argument('--no-link', action='store_true', help='No crear el comando en ~/.local/bin; usar la ruta de esta instalación.')
    ins.add_argument('--repository', default=REPOSITORY)
    ins.add_argument('--ref', default='main')
    ins.add_argument('--port', type=int, default=3457)
    ins.add_argument('--name', default='axon-managed')
    ins.add_argument('--bind', choices=['127.0.0.1', '0.0.0.0'], default='127.0.0.1')
    ins.add_argument('--origin')
    ins.add_argument('--host-user', default=pwd.getpwuid(os.getuid()).pw_name)
    ins.add_argument('--existing-data', type=Path)
    ins.add_argument('--env-file', type=Path)
    ins.add_argument('--cloudflared-config', type=Path)
    for cmd in ['update', 'rollback', '_update', '_rollback']:
        p = sub.add_parser(cmd)
        p.add_argument('--ref', default='main')
        p.add_argument('--wait', action='store_true')
    sub.add_parser('status')
    sub.add_parser('setup-agents')
    args = parser.parse_args()
    args.root = args.root.expanduser().resolve()
    if args.command == 'install': install(args); return
    state = read_state(args.root)
    if args.command == 'status':
        print(json.dumps(state, indent=2, ensure_ascii=False))
        print(f'Registro: {args.root / "update.log"}')
    elif args.command == 'setup-agents': setup_agents(args.root)
    elif args.command.startswith('_') or args.wait:
        update(args.root, args.ref, 'rollback' in args.command)
    else:
        fd = os.open(args.root / 'update.log', os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'a') as log:
            child = subprocess.Popen([sys.executable, args.root / 'manager.py', '--root', args.root, '_' + args.command, '--ref', args.ref], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        print(f'Proceso iniciado ({child.pid}). Continúa aunque cierres SSH. Consultá axon status y {args.root / "update.log"}.')


if __name__ == '__main__':
    try: main()
    except (Exception, KeyboardInterrupt) as error:
        print(f'AXON: {error}', file=sys.stderr)
        sys.exit(1)
