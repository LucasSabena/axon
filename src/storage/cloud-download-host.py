"""Unprivileged streaming sink. Private staging, no symlinks, no overwrite.
Protocol: JSON lines; a file command is followed by exactly size raw bytes.
"""
import sys, os, json, stat, hashlib, shutil, errno, ctypes, signal

def cancelled(signum, frame):
    raise ValueError('Copia cancelada')

signal.signal(signal.SIGTERM, cancelled)
signal.signal(signal.SIGINT, cancelled)

def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)

def guard(ok, message):
    if not ok: raise ValueError(message)

def directory(p):
    guard(p.startswith('/') and '\x00' not in p, 'Destino inválido')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in p.split('/'):
            if not part: continue
            guard(part not in ('.', '..'), 'Destino inválido')
            new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = new
        return fd
    except:
        os.close(fd); raise

def parts(p):
    guard(isinstance(p, str), 'Ruta inválida')
    a = p.split('/')
    guard(all(v and v not in ('.', '..') and '\\' not in v and not any(ord(c)<32 or ord(c)==127 for c in v) and len(v.encode())<=255 for v in a), 'Ruta inválida')
    # '.axon-' names are the worker's private namespace at the STAGE ROOT
    # (live-pid markers) and the destination root (sweepable stage dirs). A
    # first-level item with that prefix could mask the marker or get its
    # published copy swept as an orphaned stage — deeper components are safe.
    guard(not a[0].startswith('.axon-'), 'Ruta reservada')
    guard(a[0] in roots, 'Ruta fuera de la selección')
    return a

def parent(p):
    a=parts(p); fd=os.dup(stage_fd)
    try:
        for part in a[:-1]:
            new=os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd);fd=new
        return fd,a[-1]
    except:
        os.close(fd);raise

def absent(fd,name):
    try: os.stat(name,dir_fd=fd,follow_symlinks=False)
    except FileNotFoundError: return True
    return False

def rmtree_fd(rootfd):
    # fd-relative recursive removal compatible with Python 3.10
    # (shutil.rmtree(dir_fd=) needs 3.12). Never follows symlinks, and never
    # crosses a mount boundary — a planted bind/FUSE mount inside the tree
    # would otherwise have its target's contents unlinked.
    root_dev=os.fstat(rootfd).st_dev
    stack=[(rootfd,None)]
    while stack:
        d,name=stack[-1]
        pushed=False
        with os.scandir(d) as it:
            for e in it:
                try:
                    if e.is_dir(follow_symlinks=False):
                        try:child=os.open(e.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=d)
                        except FileNotFoundError:continue
                        if os.fstat(child).st_dev!=root_dev:os.close(child);continue
                        stack.append((child,e.name));pushed=True;break
                    os.unlink(e.name,dir_fd=d)
                except FileNotFoundError:pass
        if not pushed:
            stack.pop()
            if d is not rootfd:
                os.close(d)
                try:os.rmdir(name,dir_fd=stack[-1][0])
                except OSError:pass

def no_replace(srcfd,name,dstfd):
    libc=ctypes.CDLL(None,use_errno=True)
    guard(hasattr(libc,'renameat2'), 'El sistema no permite publicar sin sobrescribir')
    if libc.renameat2(srcfd,name.encode(),dstfd,name.encode(),1)!=0:
        n=ctypes.get_errno();raise OSError(n,os.strerror(n))

dest_fd=stage_fd=None;stage=None;published=[];received=0
try:
    req=json.loads(sys.stdin.buffer.readline(1000000))
    dest_fd=directory(req['directory']); identity=os.fstat(dest_fd)
    guard(str(identity.st_dev)==req['dev'] and str(identity.st_ino)==req['ino'],'El destino cambió')
    roots={r['name']:r['type'] for r in req['roots']}
    guard(len(roots)==len(req['roots']) and 0<len(roots)<=100,'Selección inválida')
    for name,t in roots.items():
        parts(name);guard(t in ('file','dir'),'Selección inválida');guard(not name.startswith('.axon-'),'Nombre reservado');guard(absent(dest_fd,name),'Ya existe un archivo o carpeta con ese nombre')
    disk=os.fstatvfs(dest_fd)
    guard(req['bytes'] <= disk.f_bavail*disk.f_frsize, 'No hay espacio suficiente en el disco')
    import time
    # Sweep staging dirs orphaned by a SIGKILLed worker (its finally below
    # never runs). A dir is stale only when it's over an hour old AND its
    # live-pid marker is gone or dead — a fresh stage may be mid-creation.
    import re as _re
    for e in os.listdir(dest_fd):
        # Only dirs shaped exactly like a stage this worker creates — a user
        # directory merely sharing the prefix is never swept.
        if not _re.fullmatch(r'\.axon-cloud-[0-9a-f-]{36}',e):continue
        try:efd=os.open(e,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=dest_fd)
        except OSError:continue
        try:
            if time.time()-os.fstat(efd).st_mtime<3600:continue
            live=False;uncertain=False
            # Check EVERY marker — a stray/unreadable first entry must not
            # mask a live worker's real pid marker. Any evaluation failure is
            # uncertain: sweeping a live worker is worse than keeping a stale
            # dir, so only a clean "all markers dead" sweep proceeds.
            try:
                names=os.listdir(efd)
            except OSError:
                names=None;uncertain=True
            markers=[n for n in (names or []) if n.startswith('.axon-live-')]
            for mk in markers:
                try:
                    lfd=os.open(mk,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=efd)
                    try:
                        # Only a regular file shaped like our pid marker
                        # counts — anything else is user content, not
                        # evidence of a live worker (and must not be swept).
                        mst=os.fstat(lfd)
                        if not _re.fullmatch(r'\.axon-live-[0-9]+',mk) or not stat.S_ISREG(mst.st_mode):
                            uncertain=True
                            continue
                        pid=int(os.read(lfd,64).decode()or'0')
                        live=live or (pid>0 and os.path.exists('/proc/%d'%pid))
                    finally:os.close(lfd)
                except (OSError,ValueError):uncertain=True
                if live:break
            if live or uncertain:continue
            # A real orphaned stage either still carries its marker(s) or is
            # empty — a UUID-shaped dir with user content and no marker is a
            # user directory (creatable via the file manager) and is kept.
            if names and not markers:continue
            rmtree_fd(efd);os.rmdir(e,dir_fd=dest_fd)
        except OSError:pass
        finally:os.close(efd)
    stage='.axon-cloud-'+req['id']
    guard(len(req['id'])==36 and all(c in '0123456789abcdef-' for c in req['id']),'Operación inválida')
    os.mkdir(stage,mode=0o700,dir_fd=dest_fd)
    stage_fd=os.open(stage,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=dest_fd)
    # '.axon-live-<pid>' (not 'live') so a cloud item literally named 'live'
    # doesn't collide with the marker.
    lfd=os.open('.axon-live-%d'%os.getpid(),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600,dir_fd=stage_fd)
    try:os.write(lfd,str(os.getpid()).encode())
    finally:os.close(lfd)
    for name,t in roots.items():
        if t=='dir':os.mkdir(name,mode=0o755,dir_fd=stage_fd)
    os.fsync(stage_fd)
    emit({'ok':True,'ready':True})
    while True:
        line=sys.stdin.buffer.readline(1000000)
        guard(bool(line),'Descarga interrumpida; no se publicó contenido parcial')
        cmd=json.loads(line)
        if cmd['action']=='finish':
            fresh=directory(req['directory'])
            try:
                current=os.fstat(fresh)
                guard((current.st_dev,current.st_ino)==(identity.st_dev,identity.st_ino),'El disco fue desconectado o cambió el destino')
            finally:os.close(fresh)
            for name in roots:guard(absent(dest_fd,name),'El destino tiene un conflicto; se conservó el contenido existente')
            for name in roots:
                no_replace(stage_fd,name,dest_fd);published.append(name);os.fsync(dest_fd)
                emit({'ok':True,'published':name})
            emit({'ok':True,'complete':True});break
        fd,name=parent(cmd['path'])
        try:
            if cmd['action']=='mkdir':
                os.mkdir(name,mode=0o755,dir_fd=fd);os.fsync(fd);emit({'ok':True});continue
            guard(cmd['action']=='file','Acción inválida')
            size=cmd['size'];guard(isinstance(size,int) and not isinstance(size,bool) and 0<=size<=req['bytes']-received,'Tamaño inválido')
            mode=0o600 if name=='.env' or name.startswith('.env.') else 0o644
            out=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode,dir_fd=fd)
            checksum=cmd.get('checksum')
            if checksum:guard(checksum.get('algorithm') in ('md5','sha1','sha256'),'Verificación inválida')
            flat=hashlib.new(checksum['algorithm']) if checksum else None
            whole=hashlib.sha256();block=hashlib.sha256();block_n=0;remaining=size
            try:
                while remaining:
                    data=sys.stdin.buffer.read(min(1024*1024,remaining,4*1024*1024-block_n))
                    guard(bool(data),'El archivo llegó incompleto');remaining-=len(data);block.update(data);block_n+=len(data)
                    if flat:flat.update(data)
                    view=memoryview(data)
                    while view:view=view[os.write(out,view):]
                    if block_n==4*1024*1024:
                        whole.update(block.digest());block=hashlib.sha256();block_n=0
                if block_n:whole.update(block.digest())
                if cmd.get('hash'):guard(whole.hexdigest()==cmd['hash'],'La verificación de Dropbox no coincide')
                if flat:guard(flat.hexdigest().lower()==checksum['value'].lower(),'La verificación del archivo no coincide')
                os.fsync(out)
            finally:os.close(out)
            received+=size
            os.fsync(fd)
            emit({'ok':True,'bytes':size})
        finally:os.close(fd)
except Exception as e:
    message=str(e) if isinstance(e,ValueError) else ('Ya existe un archivo o carpeta con ese nombre' if isinstance(e,OSError) and e.errno==errno.EEXIST else 'No se pudo guardar el contenido. Revisá permisos, espacio y conexión del disco.')
    emit({'ok':False,'error':message,'published':published})
finally:
    stage_id=None
    if stage_fd is not None:
        try:
            s=os.fstat(stage_fd);stage_id=(s.st_dev,s.st_ino)
        except OSError:pass
        os.close(stage_fd)
    if stage is not None and dest_fd is not None:
        # Re-open by name only removes the stage this worker created — a
        # directory swapped into its place keeps its contents (the >1h sweep
        # picks up a genuinely orphaned stage later).
        try:
            tfd=os.open(stage,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=dest_fd)
            try:
                s=os.fstat(tfd)
                if stage_id is not None and (s.st_dev,s.st_ino)==stage_id:rmtree_fd(tfd)
                else:raise OSError('stage identity changed')
            finally:os.close(tfd)
            os.rmdir(stage,dir_fd=dest_fd)
        except Exception:pass
    if dest_fd is not None:os.close(dest_fd)
