"""AXON-owned durable Restic worker. All subprocesses use argv, never a shell.

Backing up and restoring always use explicit snapshots. Recovery targets are
fresh directories; this worker never replaces a live source or drops a database.
"""
import fcntl
import json
import os
import re
import secrets
import shutil
import sqlite3
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path

CONFIG_FILES = ['config.json', 'scripts.json', 'sessions.json', 'agent-archives.json', 'optimizer.json',
                'optimizer-history.json', 'alerts.json', 'home-links.json', 'library/state.json']
EXCLUDES = ['node_modules', '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.turbo', 'target', 'dist', 'build']

def safe_path(raw):
    if not isinstance(raw, str) or not raw.startswith('/') or '\0' in raw or len(raw) > 4096:
        raise ValueError('Ruta inválida')
    p = Path(raw)
    if str(p) != os.path.normpath(raw): raise ValueError('Ruta no normalizada')
    for parent in [p, *p.parents]:
        if parent.is_symlink(): raise ValueError('No se permiten rutas enlazadas')
    return p

def private(p):
    safe_path(str(p)); p.mkdir(parents=True, exist_ok=True, mode=0o700)
    if p.stat().st_uid != os.getuid() or p.stat().st_mode & 0o077: raise ValueError('Estado privado no válido')
    return p

def atomic(p, value):
    tmp = p.parent / (p.name + '.' + secrets.token_hex(8) + '.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, p)
    fd = os.open(p.parent, os.O_DIRECTORY); os.fsync(fd); os.close(fd)

def read(p):
    if p.is_symlink(): raise ValueError('Recibo enlazado no permitido')
    return json.loads(p.read_text())

def run(argv, env=None, timeout=120, stdout=None, stdin=None):
    result = subprocess.run(argv, env=env, stdin=stdin, stdout=stdout or subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode: raise RuntimeError('La herramienta no pudo completar la operación: ' + Path(argv[0]).name)
    return result.stdout or b''

def incarnation(pid):
    try:
        raw = Path('/proc/' + str(pid) + '/stat').read_text()
        return Path('/proc/sys/kernel/random/boot_id').read_text().strip() + ':' + str(pid) + ':' + raw[raw.rfind(')')+2:].split()[19]
    except (OSError, ValueError, IndexError): return None

def postgres(container):
    if not isinstance(container, str) or not re.fullmatch('[a-f0-9]{64}', container): raise ValueError('Contenedor inválido')
    info = json.loads(run(['docker', 'inspect', container]))[0]
    if info['Id'] != container or info['State']['Status'] != 'running': raise ValueError('El contenedor cambió o está detenido')
    image = info['Config']['Image']
    if not re.search(r'(?:^|/)postgres(?:[:@]|$)', image):
        metadata = json.loads(run(['docker', 'image', 'inspect', info['Image']]))[0]
        if not any(re.search(r'(?:^|/)postgres(?:[:@]|$)', tag) for tag in metadata.get('RepoTags', [])):
            raise ValueError('El contenedor no tiene un adapter PostgreSQL compatible')
    values = dict(e.split('=', 1) for e in info['Config'].get('Env', []) if '=' in e)
    user = values.get('POSTGRES_USER', 'postgres')
    if not re.fullmatch('[A-Za-z_][A-Za-z0-9_.-]{0,62}', user): raise ValueError('Usuario PostgreSQL no compatible')
    return info, user

def database_names(container):
    info, user = postgres(container)
    output = run(['docker', 'exec', container, 'psql', '-At', '--username=' + user, '--dbname=postgres',
                  '--command=SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname'])
    return [n for n in output.decode().splitlines() if re.fullmatch('[A-Za-z_][A-Za-z0-9_.-]{0,62}', n)]

def base_for(request):
    home = safe_path(request['home'])
    if not home.is_dir(): raise ValueError('Home no encontrado')
    return private(home / '.local/share/axon/backups')

def restic_env(base, repository=None):
    password = base / 'repository-password'
    if not password.exists():
        fd = os.open(password, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as f: f.write(secrets.token_urlsafe(48))
    if password.is_symlink() or password.stat().st_mode & 0o077: raise ValueError('Credencial de backup no válida')
    return dict(os.environ, RESTIC_REPOSITORY=repository or str(base / 'repository'), RESTIC_PASSWORD_FILE=str(password),
                RESTIC_CACHE_DIR=str(private(base / 'cache')))

def validate_policy(policy, base):
    if not isinstance(policy, dict) or policy.get('kind') not in ('files', 'configuration', 'postgres'): raise ValueError('Política inválida')
    if not re.fullmatch('[A-Za-z0-9_-]{1,80}', policy.get('id', '')): raise ValueError('ID de política inválido')
    if policy['kind'] in ('files', 'configuration'):
        source = safe_path(policy['source'])
        if not source.is_dir() or source == Path('/') or any(str(source) == p or str(source).startswith(p + '/') for p in ['/proc', '/sys', '/dev']): raise ValueError('Origen de backup no compatible')
        repo = safe_path(policy['repository']) if policy.get('repository') else base / 'repository'
        if source == base or base in source.parents or (policy['kind'] == 'files' and (source in base.parents or source == repo or source in repo.parents)): raise ValueError('El origen contiene el repositorio de backups')
        if policy['kind'] == 'files':
            identity = (source.stat().st_dev, source.stat().st_ino)
            for ancestor in [repo, *repo.parents]:
                if ancestor.exists():
                    info = ancestor.stat()
                    if (info.st_dev, info.st_ino) == identity: raise ValueError('El origen contiene el repositorio de backups a través de otro montaje')
    else:
        info, _ = postgres(policy['containerId'])
        selected = policy.get('databases')
        if not isinstance(selected, list) or not selected or len(selected) > 30: raise ValueError('Seleccioná las bases')
        if any(n not in database_names(info['Id']) for n in selected): raise ValueError('Base no encontrada')

def status(base, job_id):
    if not re.fullmatch('[a-f0-9-]{36}', job_id): raise ValueError('ID inválido')
    p = base / 'jobs' / (job_id + '.json'); receipt = read(p)
    if receipt['state'] in ('running', 'queued') and receipt.get('owner') and incarnation(receipt.get('pid')) != receipt['owner']:
        receipt.update(state='interrupted', phase='interrupted', message='El worker terminó sin confirmar la operación. El snapshot y los recibos se conservan.')
        atomic(p, receipt)
    return receipt

def start(request):
    base = base_for(request); private(base / 'jobs')
    job_id = request['id']
    if not re.fullmatch('[a-f0-9-]{36}', job_id): raise ValueError('ID inválido')
    lockfd = os.open(base / 'launch.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lockfd, fcntl.LOCK_EX)
        target = base / 'jobs' / (job_id + '.json')
        if target.exists(): return status(base, job_id)
        if request.get('mode', 'backup') == 'backup': validate_policy(request['policy'], base)
        else:
            original = status(base, request['originalId'])
            if not original.get('snapshot') or original.get('state') not in ('verified', 'failed', 'interrupted'): raise ValueError('Snapshot no disponible')
            request['snapshot'] = original['snapshot']; request['policy'] = original['policy']; request['dumpImage'] = original.get('dumpImage')
        receipt = dict(id=job_id, policy=request['policy'], mode=request.get('mode', 'backup'), state='queued',
                       phase='starting', createdAt=int(time.time()*1000), message='Preparando worker del host.',
                       snapshot=request.get('snapshot'), originalId=request.get('originalId'), dumpImage=request.get('dumpImage'))
        atomic(target, receipt)
        worker = base / 'backup-worker.py'; code = Path(__file__).read_text() if '__file__' in globals() and Path(__file__).is_file() else request['workerSource']
        fd = os.open(worker, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as f: f.write(code)
        intent = base / 'jobs' / (job_id + '.input.json'); atomic(intent, {**request, 'workerSource': None})
        log = os.open(base / 'jobs' / (job_id + '.log'), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        child = subprocess.Popen([sys.executable, str(worker), 'worker', str(intent)], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, close_fds=True)
        os.close(log)
        receipt.update(pid=child.pid, owner=incarnation(child.pid)); atomic(target, receipt)
        return receipt
    finally: os.close(lockfd)

def worker(request):
    base = base_for(request); target = base / 'jobs' / (request['id'] + '.json')
    # Wait for launcher to durably record this process identity before updating.
    launchfd = os.open(base / 'launch.lock', os.O_RDWR | os.O_NOFOLLOW)
    fcntl.flock(launchfd, fcntl.LOCK_EX); receipt = read(target); os.close(launchfd)
    lockfd = os.open(base / 'repository.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    def update(**values): receipt.update(values); atomic(target, receipt)
    staging = None; verify_container = None; repo_fd = None
    try:
        try: fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('Otro backup o restauración utiliza el repositorio. Reintentá al terminar.')
        policy = receipt['policy']; mode = receipt['mode']
        def check_mount(raw, expected):
            if not raw or expected is None: return
            p = safe_path(raw)
            while not p.exists(): p = p.parent
            fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY)
            try:
                fields = Path('/proc/self/fdinfo/' + str(fd)).read_text().splitlines()
                actual = next(x.split(':', 1)[1].strip() for x in fields if x.startswith('mnt_id:'))
                if actual != str(expected): raise ValueError('El disco cambió o fue desconectado; no se inició el respaldo')
            finally: os.close(fd)
        check_mount(policy.get('source'), request.get('sourceMountId'))
        check_mount(policy.get('repository'), request.get('repositoryMountId'))
        repository = safe_path(policy['repository']) if policy.get('repository') else base / 'repository'
        repository.mkdir(parents=True, exist_ok=True)
        repo_fd = os.open(repository, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        # Restic follows this pinned directory in the worker, so a removed
        # mount never turns its repository into a directory on the system disk.
        env = restic_env(base, '/proc/' + str(os.getpid()) + '/fd/' + str(repo_fd))
        if not (repository / 'config').exists(): run(['restic', 'init'], env)
        update(state='running', phase='capture', message='Capturando el respaldo.')
        if mode == 'backup':
            validate_policy(policy, base)
            sources = []
            if policy['kind'] == 'files': sources = [str(safe_path(policy['source']))]
            else:
                staging = private(base / 'staging' / request['id'])
                if policy['kind'] == 'configuration':
                    source = safe_path(policy['source']); covered = []
                    for name in CONFIG_FILES:
                        p = source / name
                        if p.is_symlink(): raise ValueError('Configuración enlazada no permitida')
                        if p.is_file():
                            dest = staging / name; dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                            shutil.copy2(p, dest); covered.append(name)
                    if 'config.json' not in covered: raise ValueError('La configuración principal no está disponible')
                    for name in ['maintenance/maintenance.sqlite', 'platform/platform.sqlite']:
                        p = source / name
                        if not p.exists(): continue
                        safe_path(str(p)); dest = staging / name; dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                        original = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True); backup = sqlite3.connect(dest)
                        try: original.backup(backup)
                        finally: backup.close(); original.close()
                        os.chmod(dest, 0o600); covered.append(name)
                    update(covered=covered)
                else:
                    info, user = postgres(policy['containerId']); update(dumpImage=info['Image'], covered=policy['databases'])
                    for name in policy['databases']:
                        dest = staging / (name + '.dump')
                        with dest.open('xb') as f: run(['docker', 'exec', info['Id'], 'pg_dump', '--format=custom', '--no-owner', '--no-acl', '--username=' + user, '--dbname=' + name], stdout=f, timeout=7200)
                        os.chmod(dest, 0o600)
                sources = [str(staging)]
            args = ['restic', 'backup', '--json', '--tag', 'axon-policy:' + policy['id'], '--tag', 'axon-job:' + request['id']]
            if policy['kind'] == 'files':
                for name in EXCLUDES: args += ['--exclude', name]
            args += ['--', *sources]
            output = run(args, env, timeout=7200)
            summary = next((json.loads(line) for line in reversed(output.decode().splitlines()) if json.loads(line).get('message_type') == 'summary'), None)
            if not summary or not summary.get('snapshot_id'): raise RuntimeError('Restic no confirmó un snapshot')
            update(snapshot=summary['snapshot_id'], bytes=summary.get('total_bytes_processed', 0), files=summary.get('total_files_processed', 0), sourcePaths=sources,
                   exclusions=EXCLUDES if policy['kind'] == 'files' else [], phase='verify', message='Restaurando el snapshot en una carpeta nueva para verificar sus datos.')
        snapshot = receipt['snapshot']
        if not re.fullmatch('[a-f0-9]{8,64}', snapshot): raise ValueError('Snapshot inválido')
        # Verify repository metadata, then cryptographically verify all restored
        # files of this snapshot, rather than claiming a log is a restore test.
        run(['restic', 'check'], env, timeout=7200)
        if mode == 'restore':
            recovery_root = safe_path(request['home']) / 'AXON-Restauraciones'
            if not recovery_root.exists(): recovery_root.mkdir(mode=0o700)
            safe_path(str(recovery_root)); restored = recovery_root / request['id']; restored.mkdir(mode=0o700)
        else: restored = private(base / 'verification') / request['id']; restored.mkdir(mode=0o700)
        run(['restic', 'restore', snapshot, '--target', str(restored), '--verify'], env, timeout=7200)
        if policy['kind'] == 'configuration':
            for p in restored.rglob('*.sqlite'):
                db = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True)
                try:
                    if db.execute('pragma integrity_check').fetchone()[0] != 'ok': raise RuntimeError('SQLite restaurado no válido')
                finally: db.close()
        if policy['kind'] == 'postgres':
            image = receipt.get('dumpImage')
            if not isinstance(image, str) or not re.fullmatch('sha256:[a-f0-9]{64}', image): raise ValueError('Imagen de verificación inválida')
            verify_container = 'axon-backup-verify-' + request['id']
            update(phase='database-verify', message='Importando los dumps en PostgreSQL temporal, sin puertos ni volúmenes del servidor.')
            run(['docker', 'run', '-d', '--rm', '--name', verify_container, '--network', 'none', '--memory', '768m', '--cpus', '1',
                 '--tmpfs', '/var/lib/postgresql/data:rw,size=2g', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_USER=axon_verify', image])
            ready = False
            for _ in range(60):
                main_process = subprocess.run(['docker', 'exec', verify_container, 'cat', '/proc/1/comm'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                result = subprocess.run(['docker', 'exec', verify_container, 'pg_isready', '-U', 'axon_verify'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if not result.returncode and main_process.stdout.strip() == b'postgres': ready = True; break
                time.sleep(.5)
            if not ready: raise RuntimeError('PostgreSQL de verificación no inició')
            verified_databases = []
            for i, name in enumerate(policy['databases']):
                dump = next(restored.rglob(name + '.dump'), None)
                if dump is None: raise RuntimeError('Dump ausente en la restauración')
                dbname = 'verify_' + str(i)
                run(['docker', 'exec', verify_container, 'createdb', '-U', 'axon_verify', dbname])
                with dump.open('rb') as f: run(['docker', 'exec', '-i', verify_container, 'pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '-U', 'axon_verify', '--dbname=' + dbname], stdin=f, timeout=7200)
                run(['docker', 'exec', verify_container, 'psql', '-At', '-U', 'axon_verify', '--dbname=' + dbname, '--command=SELECT count(*) FROM pg_catalog.pg_class'])
                verified_databases.append(name)
            update(verifiedDatabases=verified_databases)
        if mode == 'restore':
            owner = Path(request['home']).stat()
            for directory, dirs, files in os.walk(restored, followlinks=False):
                os.chown(directory, owner.st_uid, owner.st_gid)
                for name in files + dirs: os.chown(Path(directory) / name, owner.st_uid, owner.st_gid, follow_symlinks=False)
            os.chown(recovery_root, owner.st_uid, owner.st_gid)
            update(restoredPath=str(restored))
        else: shutil.rmtree(restored)
        update(state='verified', phase='done', verifiedAt=int(time.time()*1000), endedAt=int(time.time()*1000),
               message='Restauración aislada comprobada. Los originales permanecen en su ubicación.' if mode == 'restore' else 'Snapshot y restauración de prueba verificados.',
               destination='local', disasterRecovery=False)
    except Exception as error:
        update(state='failed', phase=receipt.get('phase', 'unknown'), endedAt=int(time.time()*1000), message=str(error)[:240])
    finally:
        if verify_container:
            subprocess.run(['docker', 'rm', '-f', verify_container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if staging and staging.is_dir() and not staging.is_symlink(): shutil.rmtree(staging)
        if repo_fd is not None: os.close(repo_fd)
        os.close(lockfd)

def main(request):
    action = request.get('action')
    if action == 'databases': return dict(ok=True, databases=database_names(request['containerId']))
    if action == 'start': return dict(ok=True, **start(request))
    if action == 'status': return dict(ok=True, **status(base_for(request), request['id']))
    if action == 'availability':
        return dict(ok=True, restic=bool(shutil.which('restic')), destination='local', root=str(base_for(request)))
    raise ValueError('Acción no permitida')

if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'worker': worker(read(Path(sys.argv[2])))
    else:
        try: print(json.dumps(main(json.load(sys.stdin))))
        except Exception as e: print(json.dumps(dict(ok=False, error=str(e)[:240])))
