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

def no_replace(srcfd,name,dstfd):
    libc=ctypes.CDLL(None,use_errno=True)
    guard(hasattr(libc,'renameat2'), 'El sistema no permite publicar sin sobrescribir')
    if libc.renameat2(srcfd,name.encode(),dstfd,name.encode(),1)!=0:
        n=ctypes.get_errno();raise OSError(n,os.strerror(n))

dest_fd=stage_fd=None;stage=None;published=[]
try:
    req=json.loads(sys.stdin.buffer.readline(1000000))
    dest_fd=directory(req['directory']); identity=os.fstat(dest_fd)
    guard(str(identity.st_dev)==req['dev'] and str(identity.st_ino)==req['ino'],'El destino cambió')
    roots={r['name']:r['type'] for r in req['roots']}
    guard(len(roots)==len(req['roots']) and 0<len(roots)<=100,'Selección inválida')
    for name,t in roots.items():
        parts(name);guard(t in ('file','dir'),'Selección inválida');guard(absent(dest_fd,name),'Ya existe un archivo o carpeta con ese nombre')
    disk=os.fstatvfs(dest_fd)
    guard(req['bytes'] <= disk.f_bavail*disk.f_frsize, 'No hay espacio suficiente en el disco')
    stage='.axon-cloud-'+req['id']
    guard(len(req['id'])==36 and all(c in '0123456789abcdef-' for c in req['id']),'Operación inválida')
    os.mkdir(stage,mode=0o700,dir_fd=dest_fd)
    stage_fd=os.open(stage,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=dest_fd)
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
            size=cmd['size'];guard(isinstance(size,int) and 0<=size<=req['bytes'],'Tamaño inválido')
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
            os.fsync(fd)
            emit({'ok':True,'bytes':size})
        finally:os.close(fd)
except Exception as e:
    message=str(e) if isinstance(e,ValueError) else ('Ya existe un archivo o carpeta con ese nombre' if isinstance(e,OSError) and e.errno==errno.EEXIST else 'No se pudo guardar el contenido. Revisá permisos, espacio y conexión del disco.')
    emit({'ok':False,'error':message,'published':published})
finally:
    if stage_fd is not None:os.close(stage_fd)
    if stage is not None and dest_fd is not None:
        # The fd remains on the original disk even if its mount path changes.
        try:shutil.rmtree(stage,dir_fd=dest_fd)
        except Exception:pass
    if dest_fd is not None:os.close(dest_fd)
