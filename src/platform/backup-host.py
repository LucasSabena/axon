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
import threading
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

def atomic_text(p, text):
    tmp = p.parent / (p.name + '.' + secrets.token_hex(8) + '.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f: f.write(text); f.flush(); os.fsync(f.fileno())
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

def capture_backup(argv, env, report, timeout=7200):
    """Persist bounded progress while restic runs, without buffering its output."""
    summary = None
    with subprocess.Popen(argv, env={**env, 'RESTIC_PROGRESS_FPS': '1'},
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
        expired = threading.Event()
        def expire():
            expired.set()
            try: process.kill()
            except ProcessLookupError: pass
        timer = threading.Timer(timeout, expire); timer.start()
        try:
            for line in process.stdout:
                try: row = json.loads(line)
                except ValueError: continue
                if not isinstance(row, dict): continue
                if row.get('message_type') == 'summary': summary = row
                elif row.get('message_type') == 'status':
                    progress = {key: value for key in ('bytes_done', 'total_bytes', 'files_done', 'total_files', 'seconds_elapsed', 'seconds_remaining', 'error_count')
                                if isinstance(value := row.get(key), (int, float)) and not isinstance(value, bool) and 0 <= value < 2**53}
                    report(progress)
            code = process.wait()
            if expired.is_set(): raise RuntimeError('La copia excedió el tiempo máximo y se detuvo.')
            return code, summary
        finally:
            timer.cancel()
            if process.poll() is None: process.kill()
            process.wait(); process.stdout.close()

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
        # Link the completed file into place atomically: a concurrent caller
        # loses the link race and never observes a half-written credential.
        tmp = base / (password.name + '.' + secrets.token_hex(8) + '.tmp')
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, 'w') as f: f.write(secrets.token_urlsafe(48))
            try: os.link(tmp, password)
            except FileExistsError: pass
        finally:
            try: tmp.unlink()
            except OSError: pass
    if password.is_symlink() or password.stat().st_mode & 0o077: raise ValueError('Credencial de backup no válida')
    return dict(os.environ, RESTIC_REPOSITORY=repository or str(base / 'repository'), RESTIC_PASSWORD_FILE=str(password),
                RESTIC_CACHE_DIR=str(private(base / 'cache')))

def file_sources(policy):
    return policy.get('sources') or ([policy['source']] if policy.get('source') else [])

def validate_policy(policy, base):
    if not isinstance(policy, dict) or policy.get('kind') not in ('files', 'configuration', 'postgres'): raise ValueError('Configuración inválida')
    if not re.fullmatch('[A-Za-z0-9_-]{1,80}', policy.get('id', '')): raise ValueError('ID de backup inválido')
    repo = safe_path(policy['repository']) if policy.get('repository') else base / 'repository'
    if repo == Path('/'): raise ValueError('Elegí una carpeta de destino')
    if policy['kind'] in ('files', 'configuration'):
        sources = file_sources(policy)
        if not sources or len(sources) > 20: raise ValueError('Elegí las carpetas de origen')
        for raw in sources:
            source = safe_path(raw)
            if not source.is_dir() or (source == Path('/') and not policy.get('diskMode')) or any(str(source) == p or str(source).startswith(p + '/') for p in ['/proc', '/sys', '/dev', '/run']): raise ValueError('Origen de backup no compatible')
            if source == base or base in source.parents or (policy['kind'] == 'files' and (source == repo or (source in repo.parents and not policy.get('diskMode')))):
                raise ValueError('El origen contiene el repositorio de backups')
            if policy['kind'] == 'files' and policy.get('diskMode'):
                existing_repo = repo
                while not existing_repo.exists(): existing_repo = existing_repo.parent
                if existing_repo.stat().st_dev == source.stat().st_dev: raise ValueError('El backup de un disco completo necesita otro disco de destino')
            if policy['kind'] == 'files' and not policy.get('diskMode'):
                identity = (source.stat().st_dev, source.stat().st_ino)
                for ancestor in [repo, *repo.parents]:
                    if ancestor.exists():
                        info = ancestor.stat()
                        if (info.st_dev, info.st_ino) == identity: raise ValueError('El origen contiene el repositorio de backups a través de otro montaje')
            # Legacy implicit repositories cannot be safely nested in a source.
            if policy['kind'] == 'files' and not policy.get('repository') and source in base.parents: raise ValueError('El origen contiene el repositorio de backups')
    else:
        info, _ = postgres(policy['containerId'])
        selected = policy.get('databases')
        if not isinstance(selected, list) or not selected or len(selected) > 30: raise ValueError('Seleccioná las bases')
        if any(n not in database_names(info['Id']) for n in selected): raise ValueError('Base no encontrada')
    exclusions = policy.get('exclusions', EXCLUDES)
    if not isinstance(exclusions, list) or len(exclusions) > 50 or any(not isinstance(p, str) or not p or len(p) > 4096 or '\0' in p for p in exclusions): raise ValueError('Exclusiones inválidas')
    if any(not re.sub(r'[\s/*?\[\]{}!^,\\]', '', p) for p in exclusions): raise ValueError('Una exclusión descartaría todo el contenido')
    retention = policy.get('retentionDays', 0)
    if not isinstance(retention, int) or retention < 0 or retention > 3650: raise ValueError('Conservación inválida')

def check_mount(raw, expected):
    if not raw or expected is None: return
    p = safe_path(raw)
    while not p.exists(): p = p.parent
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY)
    try:
        fields = Path('/proc/self/fdinfo/' + str(fd)).read_text().splitlines()
        actual = next(x.split(':', 1)[1].strip() for x in fields if x.startswith('mnt_id:'))
        if actual != str(expected): raise ValueError('El disco cambió o fue desconectado; la copia no se confirma')
    finally: os.close(fd)

def snapshot_selection(paths):
    if paths is None: return None
    if not isinstance(paths, list) or not paths or len(paths) > 50: raise ValueError('Selección inválida')
    for value in paths:
        if not isinstance(value, str) or not value.startswith('/') or len(value) > 4096 or '\0' in value or os.path.normpath(value) != value: raise ValueError('Selección inválida')
    return paths

def verify_by_reading(snapshot, env):
    # A full disk backup must be verifiable even when the source disk cannot
    # accommodate a second full copy. Restic reads and hashes every data pack.
    run(['restic', 'check', '--read-data'], env, timeout=7200)
    # `timeout` bounds the producer itself — a hung restic (dead destination
    # disk, D-state I/O) cannot block the stdout loop forever.
    process = subprocess.Popen(['timeout', '-k', '10', '7200', 'restic', 'ls', '--json', '--recursive', snapshot], env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    chosen = None
    try:
        for line in process.stdout:
            try: node = json.loads(line)
            except ValueError: continue
            if node.get('struct_type') == 'node' and node.get('type') == 'file':
                chosen = node['path']; break
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=10)
        rc = process.returncode or 0
    if chosen is None and rc: raise RuntimeError('La copia no pudo leerse para comprobar su contenido')
    if chosen:
        # Exercise the recovery pipeline with actual bytes, without filling SSD.
        with open(os.devnull, 'wb') as sink:
            run(['restic', 'dump', snapshot, chosen], env, stdout=sink, timeout=7200)
    return chosen

def cleanup_jobs(base):
    jobs = base / 'jobs'
    if not jobs.is_dir(): return
    now = time.time()
    receipts = set(); terminal = set()
    for p in jobs.glob('*.json'):
        if p.name.endswith('.input.json'): continue
        receipts.add(p.stem)
        try: receipt = read(p)
        except Exception:
            # An unreadable receipt is 'unknown', not terminal — a live worker
            # may still hold it. Apply the same 24h age guard before GCing.
            try:
                if now - p.stat().st_mtime > 86400: terminal.add(p.stem)
            except OSError: pass
            continue
        if receipt.get('state') in ('verified', 'failed', 'interrupted', 'cancelled') and now - (receipt.get('endedAt') or receipt.get('createdAt') or 0) / 1000 > 86400: terminal.add(p.stem)
    for p in list(jobs.glob('*.input.json')) + list(jobs.glob('*.log')):
        rid = p.name.split('.', 1)[0]
        try:
            if rid in terminal or (rid not in receipts and now - p.stat().st_mtime > 86400): p.unlink()
        except OSError: pass
    for folder in (jobs, base):
        for p in folder.glob('*.tmp'):
            try:
                if now - p.stat().st_mtime > 3600: p.unlink()
            except OSError: pass
    # Orphaned staging/verification trees from SIGKILLed workers or reboots.
    for kind in ('staging', 'verification'):
        d = base / kind
        if not d.is_dir(): continue
        for p in d.iterdir():
            try:
                if p.is_symlink() or not p.is_dir(): continue
                if p.name in terminal or (p.name not in receipts and now - p.stat().st_mtime > 86400): shutil.rmtree(p)
            except OSError: pass
    # Orphaned verification containers: --rm only reaps on exit, so a SIGKILLed
    # worker leaves its axon-backup-verify-* container running forever. A live
    # worker always has a receipt, so only terminal/receipt-less names go.
    try:
        out = subprocess.run(['docker', 'ps', '-a', '--filter', 'name=axon-backup-verify-', '--format', '{{.Names}}'],
                             capture_output=True, text=True, timeout=30)
        for name in out.stdout.split():
            rid = name.rsplit('axon-backup-verify-', 1)[-1]
            if rid in terminal or rid not in receipts:
                subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    except Exception: pass

def retain_verified(base, policy, snapshot, env):
    days = policy.get('retentionDays', 0)
    # Only delete old versions whose successful restoration has a durable receipt.
    # The snapshot listing is already scoped to this repository by policy tag,
    # so a remounted destination path must not exclude the old receipts.
    verified = set(); failed = set(); protected = set()
    now = time.time()
    for receipt_path in (base / 'jobs').glob('*.json'):
        if receipt_path.name.endswith('.input.json'): continue
        try: old = read(receipt_path)
        except Exception: continue
        snap = old.get('snapshot')
        if not snap: continue
        stale_terminal = old.get('state') in ('failed', 'interrupted') and now - (old.get('endedAt') or old.get('createdAt') or 0) / 1000 > 86400
        if old.get('mode') == 'backup' and old.get('policy', {}).get('id') == policy['id'] and old.get('state') == 'verified': verified.add(snap)
        elif old.get('mode') == 'backup' and old.get('policy', {}).get('id') == policy['id'] and stale_terminal: failed.add(snap)
        # Only an in-flight receipt pins a snapshot — terminal restore/verify
        # receipts used to protect their snapshot forever (unbounded retention).
        elif old.get('state') in ('queued', 'running'): protected.add(snap)
    failed -= verified | protected
    # A dead backup leaves unreferenced pack data no snapshot names; forget
    # cannot reach it — only prune can. Run it while a recent failed/
    # interrupted receipt exists, independent of the retention window.
    tainted = bool(failed)
    if not tainted:
        for receipt_path in (base / 'jobs').glob('*.json'):
            if receipt_path.name.endswith('.input.json'): continue
            try: old = read(receipt_path)
            except Exception: continue
            if old.get('mode') == 'backup' and old.get('policy', {}).get('id') == policy['id'] and old.get('state') in ('failed', 'interrupted') and now - (old.get('endedAt') or old.get('createdAt') or 0) / 1000 < 7 * 86400:
                tainted = True; break
    if not days and not failed and not tainted: return [], None
    snapshots = json.loads(run(['restic', 'snapshots', '--json', '--tag', 'axon-policy:' + policy['id']], env))
    from datetime import datetime
    cutoff = now - days * 86400
    expired = [row['id'] for row in snapshots if row['id'] != snapshot and
               (row['id'] in failed or (days and row['id'] in verified and datetime.fromisoformat(row['time'].replace('Z', '+00:00')).timestamp() < cutoff))]
    if expired:
        run(['restic', 'forget', '--', *expired], env, timeout=7200)
        # Restic's supported pruning preserves every still-referenced snapshot.
        try: run(['restic', 'prune'], env, timeout=7200)
        except Exception: return expired, 'La copia está comprobada. Las versiones vencidas se retiraron, pero la liberación de espacio quedó pendiente.'
    elif tainted:
        try: run(['restic', 'prune'], env, timeout=7200)
        except Exception: pass
    return expired, None


def worker_alive(base, job_id):
    # True only when the spawned worker is found by argv — a probe failure is
    # not proof of death.
    try:
        intent = str(base / 'jobs' / (job_id + '.input.json')).encode()
        for pid in os.listdir('/proc'):
            if not pid.isdigit(): continue
            try: cmd = Path('/proc/' + pid + '/cmdline').read_bytes()
            except OSError: continue
            if b'backup-worker.py' in cmd and intent in cmd: return True
    except OSError: pass
    return False

def stale_worker(receipt, base, job_id):
    # Conservative liveness: inconclusive evidence never causes a rewrite.
    if receipt.get('state') not in ('running', 'queued'): return False
    if receipt.get('owner') and receipt.get('pid'):
        live = incarnation(receipt['pid'])
        if live is not None: return live != receipt['owner']
        return not Path('/proc/' + str(receipt['pid'])).exists()
    if receipt.get('state') == 'queued' and time.time() * 1000 - (receipt.get('createdAt') or 0) < 60000: return False
    # The worker identity was never recorded; look for the spawned process by
    # its argv so an orphaned but running worker is not declared dead.
    try:
        if worker_alive(base, job_id): return False
    except OSError: return False
    return True

def status(base, job_id):
    if not re.fullmatch('[a-f0-9-]{36}', job_id): raise ValueError('ID inválido')
    p = base / 'jobs' / (job_id + '.json')
    if not p.exists(): return dict(id=job_id, state='interrupted', message='No hay un worker ni un recibo de inicio confirmado. El intento se conserva sin repetirlo.')
    try: receipt = read(p)
    except Exception: receipt = None
    if receipt is None:
        # A corrupt receipt must not wedge the queue forever. Under launch.lock
        # re-read once; still unreadable means either real corruption (replace
        # with interrupted evidence — a live worker's next update() rewrites
        # anyway) or a transient read error (return without writing).
        lockfd = os.open(base / 'launch.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(lockfd, fcntl.LOCK_EX)
            try: receipt = read(p)
            except Exception:
                # A live worker rewrites its own receipt via update() — only
                # stamp 'interrupted' when the worker is provably gone, or TS
                # freezes 'interrupted' for a backup that may still verify.
                if worker_alive(base, job_id):
                    return dict(id=job_id, state='running', message='El recibo no pudo leerse; el worker sigue activo y lo reescribirá.')
                receipt = dict(id=job_id, state='interrupted', phase='interrupted', endedAt=int(time.time()*1000),
                               message='El recibo no pudo leerse; el resultado quedó incierto.')
                try: atomic(p, receipt)
                except OSError: pass
            return receipt
        finally: os.close(lockfd)
    if not stale_worker(receipt, base, job_id): return receipt
    # Serialize with launch.lock and re-verify inside it: a live worker that
    # finished between the read and the rewrite must not be clobbered.
    lockfd = os.open(base / 'launch.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try: fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return receipt
        fresh = read(p)
        if not stale_worker(fresh, base, job_id): return fresh
        fresh.update(state='interrupted', phase='interrupted', message='La operación se interrumpió antes de confirmarse. Conservamos la copia y el registro del intento.')
        atomic(p, fresh)
        return fresh
    finally: os.close(lockfd)

def start(request):
    base = base_for(request); private(base / 'jobs')
    job_id = request['id']
    if not re.fullmatch('[a-f0-9-]{36}', job_id): raise ValueError('ID inválido')
    lockfd = os.open(base / 'launch.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lockfd, fcntl.LOCK_EX)
        target = base / 'jobs' / (job_id + '.json')
        if target.exists():
            # status() re-acquires launch.lock on a new fd — release ours first
            # or a corrupt receipt path deadlocks this call.
            os.close(lockfd); lockfd = -1
            return status(base, job_id)
        try:
            if request.get('mode', 'backup') == 'backup': validate_policy(request['policy'], base)
            else:
                # Same re-entrancy: read the original receipt directly instead of
                # calling status() under launch.lock.
                oid = request.get('originalId')
                if not isinstance(oid, str) or not re.fullmatch('[a-f0-9-]{36}', oid): raise ValueError('ID inválido')
                try: original = read(base / 'jobs' / (oid + '.json'))
                except Exception: raise ValueError('Snapshot no disponible')
                if not original.get('snapshot') or original.get('state') not in ('verified', 'failed', 'interrupted'): raise ValueError('Snapshot no disponible')
                request['snapshot'] = original['snapshot']; request['policy'] = {**original['policy'], 'repository': request.get('policy', {}).get('repository', original['policy'].get('repository'))}; request['dumpImage'] = original.get('dumpImage')
                snapshot_selection(request.get('paths'))
                request['bytes'] = original.get('bytes', 0); request['files'] = original.get('files'); request['sourcePaths'] = original.get('sourcePaths')
                request['partial'] = original.get('partial', False)
        except Exception as e:
            # A deterministic rejection (invalid policy, missing snapshot) is
            # terminal evidence — a durable 'failed' receipt tells TS not to
            # retry it hourly as an ambiguous 'interrupted' launch.
            rejected = dict(id=job_id, policy=request.get('policy'), mode=request.get('mode', 'backup'),
                            state='failed', phase='rejected', createdAt=int(time.time()*1000), endedAt=int(time.time()*1000),
                            message='La copia fue rechazada antes de iniciar: ' + str(e)[:200])
            try: atomic(target, rejected)
            except OSError: pass
            return rejected
        receipt = dict(id=job_id, policy=request['policy'], mode=request.get('mode', 'backup'), state='queued',
                       phase='starting', createdAt=int(time.time()*1000), message='Preparando la copia.',
                       snapshot=request.get('snapshot'), originalId=request.get('originalId'), dumpImage=request.get('dumpImage'), paths=request.get('paths'), bytes=request.get('bytes', 0), files=request.get('files'), sourcePaths=request.get('sourcePaths'), partial=request.get('partial', False))
        atomic(target, receipt)
        worker = base / 'backup-worker.py'; code = Path(__file__).read_text() if '__file__' in globals() and Path(__file__).is_file() else request['workerSource']
        # Replace atomically: a just-spawned worker must never read a partial file.
        atomic_text(worker, code)
        try: cleanup_jobs(base)
        except Exception: pass
        intent = base / 'jobs' / (job_id + '.input.json'); atomic(intent, {**request, 'workerSource': None})
        log = os.open(base / 'jobs' / (job_id + '.log'), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        child = subprocess.Popen([sys.executable, str(worker), 'worker', str(intent)], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, close_fds=True)
        os.close(log)
        receipt.update(pid=child.pid, owner=incarnation(child.pid)); atomic(target, receipt)
        return receipt
    finally:
        if lockfd >= 0: os.close(lockfd)

def worker(request):
    base = base_for(request)
    if not isinstance(request.get('id'), str) or not re.fullmatch('[a-f0-9-]{36}', request['id']): raise ValueError('ID inválido')
    target = base / 'jobs' / (request['id'] + '.json')
    # Wait for launcher to durably record this process identity before updating.
    launchfd = os.open(base / 'launch.lock', os.O_RDWR | os.O_NOFOLLOW)
    fcntl.flock(launchfd, fcntl.LOCK_EX); receipt = read(target); fcntl.flock(launchfd, fcntl.LOCK_UN)
    lockfd = os.open(base / 'repository.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    # Receipt writes serialize with status() rewrites on launch.lock.
    def update(**values):
        values['updatedAt'] = int(time.time()*1000)
        receipt.update(values)
        fcntl.flock(launchfd, fcntl.LOCK_EX)
        try: atomic(target, receipt)
        finally: fcntl.flock(launchfd, fcntl.LOCK_UN)
    staging = None; verify_container = None; repo_fd = None; restored = None; mode = receipt['mode']
    try:
        try: fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('Otro backup o restauración utiliza el repositorio. Reintentá al terminar.')
        policy = receipt['policy']; mode = receipt['mode']
        for source, mount_id in request.get('sourceMounts', {}).items(): check_mount(source, mount_id)
        check_mount(policy.get('repository'), request.get('repositoryMountId'))
        repository = safe_path(policy['repository']) if policy.get('repository') else base / 'repository'
        repository.mkdir(parents=True, exist_ok=True)
        repo_fd = os.open(repository, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        # Restic follows this pinned directory in the worker, so a removed
        # mount never turns its repository into a directory on the system disk.
        env = restic_env(base, '/proc/' + str(os.getpid()) + '/fd/' + str(repo_fd))
        if not (repository / 'config').exists():
            if mode != 'backup': raise ValueError('No se encontró el disco con esta copia')
            if any(repository.iterdir()): raise ValueError('El destino contiene otros archivos. Elegí otra carpeta para guardar las copias')
            run(['restic', 'init'], env)
        update(state='running', phase='capture', message='Capturando el respaldo.')
        if mode == 'backup':
            validate_policy(policy, base)
            sources = []
            if policy['kind'] == 'files': sources = [str(safe_path(p)) for p in file_sources(policy)]
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
            exclusions = policy.get('exclusions', EXCLUDES) if policy['kind'] == 'files' else []
            if policy['kind'] == 'files':
                args += ['--one-file-system']
                for name in exclusions: args += ['--exclude', name]
                # Never ingest our own repository, staging, verification, or recovered copies.
                for name in [str(base), str(repository), str(safe_path(request['home']) / 'AXON-Restauraciones'), 'AXON-Backups', *request.get('excludedRepositories', [])]: args += ['--exclude', name]
                if policy.get('diskMode'):
                    for name in ['/proc', '/sys', '/dev', '/run', '/tmp', '/mnt', '/media', '/hostfs']: args += ['--exclude', name]
                # Exclude nested mounts inside the sources: --one-file-system does
                # not skip same-device bind mounts, which would be ingested twice.
                for line in Path('/proc/self/mountinfo').read_text().splitlines():
                    mount = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), line.split(' - ', 1)[0].split()[4])
                    if mount not in sources and any(mount.startswith(source.rstrip('/') + '/') for source in sources): args += ['--exclude', mount]

            args += ['--', *sources]
            code, summary = capture_backup(args, env, lambda progress: update(progress=progress))
            if code not in (0, 3) or not summary or not summary.get('snapshot_id'): raise RuntimeError('La herramienta no pudo completar la operación: restic')
            if not summary.get('total_files_processed'):
                nonempty = False
                for s in sources:
                    try:
                        with os.scandir(s) as it: nonempty = next(it, None) is not None
                    except OSError: pass
                    if nonempty: break
                if nonempty: raise RuntimeError('La copia no incluyó ningún archivo. Revisá las exclusiones elegidas.')
            update(snapshot=summary['snapshot_id'], bytes=summary.get('total_bytes_processed', 0), files=summary.get('total_files_processed', 0), sourcePaths=sources,
                   partial=code == 3, exclusions=exclusions, phase='verify', message='Restaurando el snapshot en una carpeta nueva para verificar sus datos.' + (' Algunos archivos no pudieron leerse.' if code == 3 else ''))
        for source, mount_id in request.get('sourceMounts', {}).items(): check_mount(source, mount_id)
        check_mount(policy.get('repository'), request.get('repositoryMountId'))
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
        restore_args = ['restic', 'restore', snapshot, '--target', str(restored), '--verify']
        selected = snapshot_selection(receipt.get('paths')) if mode == 'restore' else None
        if selected:
            if policy['kind'] != 'files': raise ValueError('Este tipo de copia se recupera completo')
            for selected_path in selected:
                parent = str(Path(selected_path).parent)
                nodes = [json.loads(line) for line in run(['restic', 'ls', '--json', snapshot, parent], env).decode().splitlines()]
                if not any(node.get('path') == selected_path for node in nodes): raise ValueError('El archivo elegido no está en esta versión')
                pattern = re.sub(r'([\\*?\[\]])', r'\\\1', selected_path)
                restore_args += ['--include', pattern]
        needs_stream_verification = mode != 'restore' and policy['kind'] == 'files' and receipt.get('bytes', 0) > max(0, shutil.disk_usage(restored).free - 64 * 2**20)
        if needs_stream_verification:
            update(phase='verify', message='Comprobando todos los datos y probando la recuperación sin ocupar el disco del servidor.')
            sample = verify_by_reading(snapshot, env)
            if sample is None and receipt.get('files'): raise RuntimeError('La copia verificada no devolvió archivos para la prueba de recuperación')
            update(verification='full-data-read-and-file-recovery', recoveredSample=sample)
        else:
            run(restore_args, env, timeout=7200)
            update(verification='verified-restoration')
        check_mount(policy.get('repository'), request.get('repositoryMountId'))

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
                main_process = subprocess.run(['docker', 'exec', verify_container, 'cat', '/proc/1/comm'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60)
                result = subprocess.run(['docker', 'exec', verify_container, 'pg_isready', '-U', 'axon_verify'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
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
        retention_error = None
        forgotten = []
        if mode == 'backup' and not receipt.get('partial'):
            try: forgotten, retention_error = retain_verified(base, policy, snapshot, env)
            except Exception: retention_error = 'La copia está verificada. No se pudo completar la limpieza de versiones antiguas.'
        update(forgottenSnapshots=forgotten, retentionError=retention_error)
        incomplete = receipt.get('partial') and mode != 'restore'
        update(state='failed' if incomplete else 'verified', phase='partial' if incomplete else 'done', verifiedAt=int(time.time()*1000), endedAt=int(time.time()*1000),
               message='Copia incompleta: algunos archivos no pudieron leerse. Los datos guardados se comprobaron y pueden recuperarse; se conservaron las versiones anteriores.' if incomplete else 'Restauración aislada comprobada. Los originales permanecen en su ubicación.' if mode == 'restore' else 'Copia y recuperación de prueba comprobadas.',
               destination='local', disasterRecovery=False)
    except Exception as error:
        update(state='failed', phase=receipt.get('phase', 'unknown'), endedAt=int(time.time()*1000), message=str(error)[:240])
    finally:
        if verify_container:
            # A failure here must not skip the staging/fd cleanup below.
            try: subprocess.run(['docker', 'rm', '-f', verify_container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
            except Exception:
                try: subprocess.run(['docker', 'kill', verify_container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
                except Exception: pass
        # Each step is individually guarded — a failing cleanup must not skip
        # the rest or leak the lock descriptors.
        if mode != 'restore' and restored:
            try:
                if restored.is_dir() and not restored.is_symlink(): shutil.rmtree(restored)
            except Exception: pass
        if staging:
            try:
                if staging.is_dir() and not staging.is_symlink(): shutil.rmtree(staging)
            except Exception: pass
        if repo_fd is not None:
            try: os.close(repo_fd)
            except OSError: pass
        try: os.close(lockfd)
        except OSError: pass
        try: os.close(launchfd)
        except OSError: pass

def main(request):
    action = request.get('action')
    if action == 'databases': return dict(ok=True, databases=database_names(request['containerId']))
    if action == 'start': return dict(ok=True, **start(request))
    if action == 'status': return dict(ok=True, **status(base_for(request), request['id']))
    if action == 'recovery-kit':
        base = base_for(request); restic_env(base)
        return dict(ok=True, password=(base / 'repository-password').read_text())
    if action == 'browse':
        base = base_for(request); original = status(base, request['id'])
        snapshot = original.get('snapshot')
        if not snapshot or not re.fullmatch('[a-f0-9]{8,64}', snapshot): raise ValueError('Versión no disponible')
        folder = request.get('folder', '/')
        if not isinstance(folder, str) or not folder.startswith('/') or '\0' in folder or os.path.normpath(folder) != folder: raise ValueError('Carpeta inválida')
        offset = request.get('offset', 0)
        if not isinstance(offset, int) or offset < 0 or offset > 100000: raise ValueError('Página inválida')
        repo = safe_path(request.get('repository') or original['policy'].get('repository') or str(base / 'repository'))
        check_mount(str(repo), request.get('repositoryMountId'))
        fd = os.open(repo, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            env = restic_env(base, '/proc/' + str(os.getpid()) + '/fd/' + str(fd))
            rows = [json.loads(line) for line in run(['restic', 'ls', '--json', snapshot, folder], env).decode().splitlines()]
            nodes = [row for row in rows if row.get('struct_type') == 'node' and str(Path(row.get('path', '')).parent) == folder and row.get('path') != folder]
            nodes.sort(key=lambda n: (n.get('type') != 'dir', n.get('name', '').lower()))
            entries = [dict(path=n['path'], name=n['name'], type=n['type'], size=n.get('size', 0)) for n in nodes[offset:offset+200]]
            check_mount(str(repo), request.get('repositoryMountId'))
            return dict(ok=True, folder=folder, entries=entries, nextOffset=offset+200 if offset+200 < len(nodes) else None)
        finally: os.close(fd)
    if action == 'availability':
        return dict(ok=True, restic=bool(shutil.which('restic')), destination='local', root=str(base_for(request)))
    raise ValueError('Acción no permitida')

if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'worker': worker(read(Path(sys.argv[2])))
    else:
        try: print(json.dumps(main(json.load(sys.stdin))))
        except Exception as e: print(json.dumps(dict(ok=False, error=str(e)[:240])))
