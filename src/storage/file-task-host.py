"""Owned, durable host workers. No shell, no overwrite, fd-relative traversal.
prepare/start/status/cancel; transfers retain a cross-device original for recovery.
"""
import os,sys,json,stat,time,hashlib,ctypes,errno,uuid,fcntl,signal
D=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
class Guard(Exception):
 def __init__(self,message,blockers=None):super().__init__(message);self.blockers=blockers
class Cancelled(Exception):pass
def error_reason(error):
 if isinstance(error,Guard):return str(error)
 if isinstance(error,OSError):
  return {errno.EACCES:'No tenés permisos para acceder al origen o al destino',errno.EPERM:'El sistema no permite esta operación',errno.ENOENT:'El origen, el destino o el registro ya no existe',errno.ENOSPC:'No hay espacio suficiente en el destino',errno.ELOOP:'La ruta contiene un enlace simbólico que no se puede recorrer con seguridad',errno.EBUSY:'El recurso está ocupado'}.get(error.errno,'No se pudo acceder al archivo o al registro de la operación')
 return 'El registro de la operación no es válido'
req=json.loads(sys.stdin.read(300001));handles=[];task=None;opfd=None
def anchor(p,create=False):
 if not isinstance(p,str) or not p.startswith('/') or '\0' in p or any(x in ('.','..') for x in p.split('/')):raise Guard('Ruta inválida')
 fd=os.open('/',D)
 try:
  for part in p.split('/'):
   if not part:continue
   if create:
    try:os.mkdir(part,0o700,dir_fd=fd)
    except FileExistsError:pass
   nxt=os.open(part,D,dir_fd=fd);os.close(fd);fd=nxt
  return fd
 except:os.close(fd);raise
def ident(s):return [str(s.st_dev),str(s.st_ino),str(s.st_size),str(s.st_mtime_ns),s.st_uid,s.st_mode,s.st_nlink]
def parent_ident(fd):
 # mnt_id detects a different mount of the same filesystem as well as unplug/replug.
 with open('/proc/self/fdinfo/%d'%fd) as stream:mount=next((line.split(':',1)[1].strip() for line in stream if line.startswith('mnt_id:')),None)
 s=os.fstat(fd);return [str(s.st_dev),str(s.st_ino),mount]
def filesystem(fd):
 mount=parent_ident(fd)[2]
 with open('/proc/self/mountinfo') as stream:
  for line in stream:
   fields=line.split()
   if fields[0]==mount:return fields[fields.index('-')+1]
 raise Guard('No se pudo comprobar el formato del destino')
def check_link_support(rows,source,destfd):
 kind=filesystem(destfd)
 if kind not in ('exfat','vfat','msdos'):return
 links=[r for r in rows if stat.S_ISLNK(r['identity'][5])]
 if links:
  blockers=[{'path':source+('/'+r['rel'] if r['rel'] else ''),'reason':'El destino '+kind+' no admite enlaces simbólicos'} for r in links]
  raise Guard('El destino '+kind+' no admite '+str(len(links))+' enlace'+('s' if len(links)!=1 else '')+' simbólico'+('s' if len(links)!=1 else '')+'. Usá un disco con formato compatible o resolvé esos enlaces antes de transferir',blockers)
 seen=set();duplicate=False
 for r in rows:
  if stat.S_ISREG(r['identity'][5]):
   key=tuple(r['identity'][:2]);duplicate=duplicate or key in seen;seen.add(key)
 if duplicate:raise Guard('El destino '+kind+' no admite los enlaces duros de esta carpeta. Usá un formato compatible para conservarlos')
def same(a,b):return a[:6]==b[:6]
def read_json(fd,name):
 f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
 try:
  s=os.fstat(f)
  if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_size>8*1024*1024:raise Guard('Registro privado no válido')
  return json.loads(os.read(f,s.st_size+1))
 finally:os.close(f)
def save(value):
 temp='.state-'+uuid.uuid4().hex;f=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=opfd)
 try:
  data=json.dumps(value,ensure_ascii=True).encode();off=0
  while off<len(data):off+=os.write(f,data[off:])
  os.fsync(f)
 finally:os.close(f)
 os.replace(temp,'state.json',src_dir_fd=opfd,dst_dir_fd=opfd);os.fsync(opfd)
def incarnation(pid):
 try:
  with open('/proc/%d/stat'%pid) as f:s=f.read()
  with open('/proc/sys/kernel/random/boot_id') as f:boot=f.read().strip()
  return '%s:%d:%s'%(boot,pid,s[s.rfind(')')+2:].split()[19])
 except:return None
def rename(src,name,dst,new):
 libc=ctypes.CDLL(None,use_errno=True)
 if not hasattr(libc,'renameat2'):raise Guard('renameat2 no disponible')
 if libc.renameat2(src,name.encode(),dst,new.encode(),1):
  e=ctypes.get_errno()
  if e==errno.EEXIST:raise Guard('El destino existe; no se sobrescribió')
  raise OSError(e,'Movimiento rechazado')
 os.fsync(src);os.fsync(dst)
def snapshot(parent,name):
 result=[];start=time.monotonic();device=os.stat(name,dir_fd=parent,follow_symlinks=False).st_dev
 def walk(fd,n,rel,depth):
  if len(result)>=10000 or depth>40 or time.monotonic()-start>15:raise Guard('Árbol excedido: seleccioná una carpeta más pequeña')
  s=os.stat(n,dir_fd=fd,follow_symlinks=False)
  if s.st_dev!=device:raise Guard('El árbol cruza un montaje; seleccioná cada filesystem por separado')
  if not (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode) or stat.S_ISLNK(s.st_mode)):raise Guard('El árbol contiene archivos especiales; operación bloqueada')
  row={'rel':rel,'identity':ident(s),'blocks':str(s.st_blocks*512)}
  if stat.S_ISLNK(s.st_mode):row['link']=os.readlink(n,dir_fd=fd)
  result.append(row)
  if stat.S_ISDIR(s.st_mode):
   child=os.open(n,D,dir_fd=fd)
   try:
    for entry in sorted(os.listdir(child)):walk(child,entry,rel+'/'+entry if rel else entry,depth+1)
    if not same(ident(os.fstat(child)),row['identity']):raise Guard('El directorio cambió durante la revisión')
   finally:os.close(child)
 walk(parent,name,'',0);return result
def fingerprint(rows):return hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()
def cancelled():
 try:os.stat('cancel',dir_fd=opfd);raise Cancelled()
 except FileNotFoundError:pass
def progress(n):
 task['copiedBytes']=str(int(task.get('copiedBytes','0'))+n)
 if time.monotonic()-progress.last>0.3:save(task);progress.last=time.monotonic()
progress.last=0
def copy_tree(src,sname,dst,dname,rows):
 expected={r['rel']:r for r in rows};hardlinks={}
 def copy(fd,name,out,new,rel):
  cancelled();r=expected[rel];s=os.stat(name,dir_fd=fd,follow_symlinks=False)
  if not same(ident(s),r['identity']):raise Guard('El origen cambió desde el plan')
  if stat.S_ISLNK(s.st_mode):
   target=os.readlink(name,dir_fd=fd)
   if target!=r['link']:raise Guard('El enlace cambió')
   os.symlink(target,new,dir_fd=out);os.fsync(out);return
  if stat.S_ISDIR(s.st_mode):
   os.mkdir(new,0o700,dir_fd=out);a=os.open(name,D,dir_fd=fd);b=os.open(new,D,dir_fd=out)
   try:
    for child in sorted(os.listdir(a)):
     cr=rel+'/'+child if rel else child
     if cr not in expected:raise Guard('Hay contenido nuevo; se conserva el original')
     copy(a,child,b,child,cr)
    os.fsync(b);os.fchmod(b,stat.S_IMODE(s.st_mode)&0o777)
   finally:os.close(a);os.close(b)
   os.utime(new,ns=(s.st_atime_ns,s.st_mtime_ns),dir_fd=out,follow_symlinks=False);return
  key=(s.st_dev,s.st_ino)
  if key in hardlinks:
   previous=hardlinks[key];os.link(previous,new,dst_dir_fd=out,follow_symlinks=False);progress(s.st_size);return
  a=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd);b=os.open(new,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=out)
  try:
   if not same(ident(os.fstat(a)),r['identity']):raise Guard('El archivo cambió al abrirlo')
   digest=hashlib.sha256();remaining=s.st_size
   while remaining:
    cancelled();chunk=os.read(a,min(262144,remaining))
    if not chunk:raise Guard('Lectura incompleta')
    digest.update(chunk)
    # Zero blocks remain sparse. Final truncate preserves logical length.
    if not any(chunk):os.lseek(b,len(chunk),os.SEEK_CUR)
    else:
     off=0
     while off<len(chunk):off+=os.write(b,chunk[off:])
    remaining-=len(chunk);progress(len(chunk))
   os.ftruncate(b,s.st_size);os.fsync(b);os.fchmod(b,stat.S_IMODE(s.st_mode)&0o777)
   if not same(ident(os.fstat(a)),r['identity']):raise Guard('El archivo cambió durante la copia')
   os.lseek(b,0,os.SEEK_SET);check=hashlib.sha256()
   while True:
    cancelled();chunk=os.read(b,262144)
    if not chunk:break
    check.update(chunk)
   if check.digest()!=digest.digest():raise Guard('La copia no coincide con el original')
  finally:os.close(a);os.close(b)
  os.utime(new,ns=(s.st_atime_ns,s.st_mtime_ns),dir_fd=out,follow_symlinks=False)
  hardlinks[key]=task['partialPath']+('/'+rel if rel else '')
 copy(src,sname,dst,dname,'');os.fsync(dst)
def metadata_signature(t,remove=False):
 p=t.get('metadataPath')
 if not p:return None
 fd=anchor(os.path.dirname(p));name=os.path.basename(p)
 try:
  f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
  try:
   s=os.fstat(f)
   if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_size>262144:raise Guard('Metadatos inválidos')
   content=os.read(f,s.st_size+1)
  finally:os.close(f)
  if t['adapter']=='trash-legacy':
   data=json.loads(content);key=os.path.basename(t['from'])
   if not isinstance(data,list) or any(not isinstance(e,dict) for e in data):raise Guard('Manifiesto inválido')
   matches=[e for e in data if e.get('id')==key]
   if not matches and remove and t.get('phase')=='payload-removed':return None
   if len(matches)!=1:raise Guard('Origen de papelera desconocido')
   signature=hashlib.sha256(json.dumps(matches[0],sort_keys=True).encode()).hexdigest()
   if remove:
    if signature!=t['metadataSignature']:raise Guard('Metadatos cambiaron')
    temp='.manifest-'+uuid.uuid4().hex;out=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
    try:os.write(out,json.dumps([e for e in data if e.get('id')!=key]).encode());os.fsync(out)
    finally:os.close(out)
    capture='.metadata-'+uuid.uuid4().hex;rename(fd,name,fd,capture)
    check=os.open(capture,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
    try:captured=os.read(check,262145)
    finally:os.close(check)
    if captured!=content:
     try:rename(fd,capture,fd,name)
     except:pass
     raise Guard('El manifiesto cambió; se conservó')
    try:rename(fd,temp,fd,name)
    except:
     try:rename(fd,capture,fd,name)
     except:pass
     raise
    os.unlink(capture,dir_fd=fd);os.fsync(fd)
  else:
   signature=hashlib.sha256(content).hexdigest()
   if remove:
    if signature!=t['metadataSignature']:raise Guard('Metadatos cambiaron')
    capture='.metadata-'+uuid.uuid4().hex;rename(fd,name,fd,capture)
    check=os.open(capture,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
    try:captured=os.read(check,262145)
    finally:os.close(check)
    if captured!=content:
     try:rename(fd,capture,fd,name)
     except:pass
     raise Guard('El origen cambió; se conservó')
    os.unlink(capture,dir_fd=fd);os.fsync(fd)
  return signature
 finally:os.close(fd)
def purge_tree(parent,name,rows):
 expected={r['rel']:r for r in rows};seen=set()
 def walk(fd,n,rel):
  cancelled();r=expected[rel];s=os.stat(n,dir_fd=fd,follow_symlinks=False)
  if not same(ident(s),r['identity']):raise Guard('La identidad cambió; no se elimina el sustituto')
  if stat.S_ISDIR(s.st_mode):
   child=os.open(n,D,dir_fd=fd)
   try:
    names=sorted(os.listdir(child))
    if any((rel+'/'+x if rel else x) not in expected for x in names):raise Guard('Llegaron archivos nuevos; se conservan')
    for x in names:walk(child,x,rel+'/'+x if rel else x)
   finally:os.close(child)
   latest=os.stat(n,dir_fd=fd,follow_symlinks=False)
   if (latest.st_dev,latest.st_ino)!=(s.st_dev,s.st_ino):raise Guard('Directorio sustituido; se conserva')
   os.rmdir(n,dir_fd=fd);os.fsync(fd)
  else:
   # Capture the directory entry atomically, then verify the captured inode.
   captured='.axon-delete-'+uuid.uuid4().hex;task['pendingDelete']={'rel':rel,'name':n,'captured':captured,'identity':r['identity']};save(task);rename(fd,n,fd,captured)
   check=os.stat(captured,dir_fd=fd,follow_symlinks=False)
   if not same(ident(check),r['identity']):
    rename(fd,captured,fd,n);raise Guard('El archivo fue sustituido; se conservó')
   os.unlink(captured,dir_fd=fd);os.fsync(fd)
  key=tuple(r['identity'][:2])
  if key not in seen:task['retiredBytes']=str(int(task.get('retiredBytes','0'))+int(r['blocks']));seen.add(key)
  task['removedEntries']=task.get('removedEntries',0)+1;task.pop('pendingDelete',None);save(task)
 walk(parent,name,'')
def run_worker():
 global task
 lockdir=anchor(req['home']+'/.local/share/axon',True);lock=os.open('file-operations.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600,dir_fd=lockdir)
 try:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  task['owner']=incarnation(os.getpid());task['state']='running';save(task)
  source=task['from'];destination=task['to'];src=anchor(os.path.dirname(source));dst=anchor(os.path.dirname(destination));handles.extend([src,dst]);sname=os.path.basename(source);dname=os.path.basename(destination)
  if task.get('sourceParent')!=parent_ident(src) or task.get('destinationParent')!=parent_ident(dst):raise Guard('Un disco o carpeta cambió desde la revisión; se conserva el origen')
  cancelled()
  if fingerprint(snapshot(src,sname))!=task['snapshotRevision']:raise Guard('El origen cambió desde el plan; prepará otro')
  try:os.stat(dname,dir_fd=dst,follow_symlinks=False);raise Guard('El destino existe; no se sobrescribió')
  except FileNotFoundError:pass
  samefs=os.stat(sname,dir_fd=src,follow_symlinks=False).st_dev==os.fstat(dst).st_dev
  stage='.axon-transfer-'+task['id'];task['partialPath']=os.path.dirname(destination)+'/'+stage;task['phase']='prepared';save(task)
  if task['mode']=='purge':
   if metadata_signature(task)!=task.get('metadataSignature'):raise Guard('Los metadatos cambiaron desde el plan')
   before=os.fstatvfs(src);task['freeBytesBefore']=str(before.f_bavail*before.f_frsize);task['retiredBytes']='0';save(task)
   rename(src,sname,dst,stage);task['phase']='purging';save(task)
   if fingerprint(snapshot(dst,stage))!=task['snapshotRevision']:
    rename(dst,stage,src,sname);task['partialPath']=None;raise Guard('El árbol cambió al apartarlo; se conservó')
   purge_tree(dst,stage,task['snapshot']);task['phase']='payload-removed';task['partialPath']=None;save(task)
   metadata_signature(task,True)
   after=os.fstatvfs(src);task['freeBytesAfter']=str(after.f_bavail*after.f_frsize);task['state']='verified';task['message']='Selección eliminada y ausencia verificada. La diferencia de espacio incluye actividad concurrente; no es la suma del plan.';save(task);return
  elif task['mode']=='move' and samefs:
   rename(src,sname,dst,stage);task['phase']='source-staged';save(task)
   if fingerprint(snapshot(dst,stage))!=task['snapshotRevision']:
    rename(dst,stage,src,sname);task['partialPath']=None;raise Guard('El origen cambió al moverlo; se conservó')
  else:
   st=os.statvfs(os.path.dirname(destination));needed=int(task['allocatedBytes'])
   if st.f_bavail*st.f_frsize<needed+16*1024*1024:raise Guard('No hay espacio suficiente para la copia y su verificación')
   copy_tree(src,sname,dst,stage,task['snapshot'])
   if fingerprint(snapshot(src,sname))!=task['snapshotRevision']:raise Guard('El origen cambió; la copia parcial se conserva para revisar')
   task['phase']='copy-verified';save(task);cancelled()
  rename(dst,stage,dst,dname);task['phase']='destination-committed';task['partialPath']=None;save(task)
  if task['mode']=='move' and not samefs:
   if fingerprint(snapshot(src,sname))!=task['snapshotRevision']:raise Guard('Copia verificada; el origen cambió y se conservó en su ubicación')
   backup='.axon-moved-'+task['id'];task['recoveryPath']=os.path.dirname(source)+'/'+backup;save(task);rename(src,sname,src,backup)
   task['phase']='original-retained';save(task)
   if fingerprint(snapshot(src,backup))!=task['snapshotRevision']:raise Guard('El original cambió al apartarlo; se conserva el respaldo y la copia')
  task['state']='verified';task['copiedBytes']=task['logicalBytes'];task['message']='Movimiento verificado.' if task['mode']=='move' else 'Copia verificada por contenido.'
  if task.get('recoveryPath'):task['message']+=' El original entre montajes queda recuperable y sigue ocupando espacio; no se borra automáticamente.'
  save(task)
 except Cancelled:
  # A same-filesystem move staged before cancellation must be returned intact.
  if task.get('phase')=='source-staged':
   try:rename(dst,stage,src,sname);task['partialPath']=None
   except:pass
  if task.get('mode')=='purge' and task.get('phase')=='purging' and not task.get('removedEntries'):
   try:rename(dst,stage,src,sname);task['partialPath']=None
   except:pass
  task['state']='skipped';task['message']='Cancelado entre pasos seguros. Revisá cualquier copia parcial conservada.';save(task)
 except (Guard,OSError,KeyError,ValueError) as error:
  task['state']='interrupted' if task.get('phase') in ('source-staged','destination-committed','original-retained','purging','payload-removed') else 'failed'
  task['message']=error_reason(error)+'. Los originales y las copias parciales se conservan.';save(task)
  if task.get('mode')=='purge':task['message']='Limpieza incompleta. Se conservan los elementos restantes para revisar; lo ya eliminado es irreversible.';save(task)
 finally:
  os.close(lock);os.close(lockdir)
def recover():
 global task
 owner=task.get('owner')
 if owner and incarnation(int(owner.split(':')[1]))==owner:raise Guard('El worker sigue trabajando')
 if task['state']=='restored':return
 lockdir=anchor(req['home']+'/.local/share/axon');lock=os.open('file-operations.lock',os.O_RDWR|os.O_NOFOLLOW,dir_fd=lockdir)
 try:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if task['mode']=='purge' and task.get('phase')=='payload-removed':
   if task.get('adapter')=='trash-xdg' and not os.path.lexists(task.get('metadataPath','')):pass
   else:metadata_signature(task,True)
   src=anchor(os.path.dirname(task['from']))
   try:
    try:os.stat(os.path.basename(task['from']),dir_fd=src,follow_symlinks=False);raise Guard('Llegó contenido nuevo; se conserva')
    except FileNotFoundError:pass
    st=os.fstatvfs(src);task['freeBytesAfter']=str(st.f_bavail*st.f_frsize)
   finally:os.close(src)
   task['state']='verified';task['message']='Ausencia y metadatos reconciliados. No se repitió el borrado.';save(task);return
  location=task.get('recoveryPath') or task.get('partialPath') or (task['to'] if task['mode']=='move' else None)
  if location:
   parent=anchor(os.path.dirname(location));src=anchor(os.path.dirname(task['from']))
   try:
    current=os.stat(os.path.basename(location),dir_fd=parent,follow_symlinks=False);original=task['snapshot'][0]['identity']
    if [str(current.st_dev),str(current.st_ino)]!=original[:2] or current.st_uid!=original[4]:raise Guard('La ubicación de recuperación cambió; se conserva')
    pending=task.get('pendingDelete')
    if pending and task['mode']=='purge':
     directory=anchor(location+('/'+os.path.dirname(pending['rel']) if os.path.dirname(pending['rel']) else ''))
     try:
      try:
       captured=os.stat(pending['captured'],dir_fd=directory,follow_symlinks=False)
       if [str(captured.st_dev),str(captured.st_ino)]!=pending['identity'][:2]:raise Guard('El elemento capturado cambió')
       rename(directory,pending['captured'],directory,pending['name'])
      except FileNotFoundError:pass
     finally:os.close(directory)
    task['recoveryIntent']={'from':location,'to':task['from']};save(task);rename(parent,os.path.basename(location),src,os.path.basename(task['from']))
    task['state']='restored';task['partialPath']=None;task['recoveryPath']=None;task['message']='Contenido restante devuelto al origen sin sobrescribir. Lo ya eliminado no se recupera.' if task['mode']=='purge' else 'Original devuelto al origen sin sobrescribir. Cualquier copia en otro montaje se conserva.';save(task);return
   except FileNotFoundError:pass
   finally:os.close(parent);os.close(src)
  # No unknown effects are called success. A source still present permits a safe omission.
  if task['mode']!='purge':
   src=anchor(os.path.dirname(task['from']))
   try:
    s=os.stat(os.path.basename(task['from']),dir_fd=src,follow_symlinks=False)
    if [str(s.st_dev),str(s.st_ino)]!=task['snapshot'][0]['identity'][:2]:raise Guard('Origen sustituido')
   finally:os.close(src)
   task['state']='skipped';task['message']='Origen conservado; la transferencia no se completó. Revisá la copia o contenido parcial antes de repetir.';save(task);return
  raise Guard('El resultado necesita revisión manual; no se libera un bloqueo incierto')
 finally:os.close(lock);os.close(lockdir)
def public(t):
 return {'launched':bool(opfd is not None and 'launched' in os.listdir(opfd)),**{k:t.get(k) for k in ('id','state','mode','from','to','owner','phase','snapshotRevision','logicalBytes','allocatedBytes','copiedBytes','entries','partialPath','recoveryPath','message','retiredBytes','freeBytesBefore','freeBytesAfter','removedEntries')}}
try:
 home=req['home'];id=req['id']
 if not isinstance(id,str) or str(uuid.UUID(id))!=id:raise Guard('Identificador inválido')
 base=anchor(home+'/.local/share/axon/operations',True);handles.append(base)
 private=os.fstat(base)
 if private.st_uid!=os.getuid() or private.st_mode&0o077:raise Guard('Operaciones requieren directorio privado del usuario')
 action=req['action']
 if action=='prepare':
  if len(os.listdir(base))>=200:raise Guard('Límite de registros: revisá las operaciones anteriores antes de crear más')
  source=req['from'];destination=req['to'];mode=req['mode']
  if mode not in ('copy','move','purge') or source==destination or destination.startswith(source.rstrip('/')+'/'):raise Guard('Transferencia inválida')
  protected=home+'/.local/share/axon'
  if source==protected or source.startswith(protected+'/') or protected.startswith(source.rstrip('/')+'/') or destination==protected or destination.startswith(protected+'/'):raise Guard('El registro de recuperación está protegido; seleccioná una carpeta que no lo contenga')
  src=anchor(os.path.dirname(source));dst=anchor(os.path.dirname(destination));handles.extend([src,dst])
  for key,fd in (('sourceMountId',src),('destinationMountId',dst)):
   if req.get(key) and req[key]!=parent_ident(fd)[2]:raise Guard('El disco fue desconectado o cambió antes de preparar la transferencia')
  try:os.stat(os.path.basename(destination),dir_fd=dst,follow_symlinks=False);raise Guard('El destino existe; no se sobrescribió')
  except FileNotFoundError:pass
  rows=snapshot(src,os.path.basename(source));seen=set();logical=allocated=0
  if mode!='purge' and (mode=='copy' or os.fstat(src).st_dev!=os.fstat(dst).st_dev):check_link_support(rows,source,dst)
  if mode=='purge':
   import re
   if req.get('adapter') not in ('trash-xdg','trash-legacy','packages','builds','remote','fixture'):raise Guard('Adapter desconocido')
   allowed=req.get('allowedRoot','')
   if not allowed.startswith('/') or not source.startswith(allowed.rstrip('/')+'/'):raise Guard('Fuera del alcance del adapter')
   if any(r['identity'][4]!=os.getuid() for r in rows):raise Guard('El usuario del host no es propietario del contenido')
   if req['adapter'] not in ('trash-xdg','trash-legacy','fixture') and any(re.search(r'(?:^|/)(?:\.git|\.ssh|\.gnupg|\.env(?:\.[^/]*)?|node_modules|secrets?)(?:/|$)',r['rel']) for r in rows):raise Guard('Hay fuentes o datos protegidos; no se limpia el árbol')
  for row in rows:
   s=row['identity'];key=tuple(s[:2])
   if stat.S_ISREG(s[5]):logical+=int(s[2])
   if key not in seen:allocated+=int(row['blocks']);seen.add(key)
  os.mkdir(id,0o700,dir_fd=base);opfd=os.open(id,D,dir_fd=base);handles.append(opfd)
  task={'id':id,'state':'planned','mode':mode,'from':source,'to':destination,'snapshot':rows,'snapshotRevision':fingerprint(rows),'logicalBytes':str(logical),'allocatedBytes':str(allocated),'copiedBytes':'0','entries':len(rows),'sourceParent':parent_ident(src),'destinationParent':parent_ident(dst)}
  if mode=='purge':
   task['adapter']=req['adapter'];task['metadataPath']=req.get('metadataPath');task['metadataSignature']=metadata_signature(task)
  save(task);out={'ok':True,**public(task)}
 else:
  opfd=os.open(id,D,dir_fd=base);handles.append(opfd);task=read_json(opfd,'state.json')
  if action=='start':
   if task['state']=='planned':
    launch=os.open('launched',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=opfd);os.fsync(launch);os.close(launch);os.fsync(opfd)
    pid=os.fork()
    if pid==0:
     os.setsid();null=os.open('/dev/null',os.O_RDWR)
     for stream in (0,1,2):os.dup2(null,stream)
     os.close(null);signal.signal(signal.SIGHUP,signal.SIG_IGN);run_worker();os._exit(0)
    out={'ok':True,**public(task),'state':'running','owner':incarnation(pid)}
   else:out={'ok':True,**public(task)}
  elif action=='recover':
   recover();out={'ok':True,**public(task)}
  elif action=='cancel':
   if task['state'] in ('planned','running'):
    f=os.open('cancel',os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600,dir_fd=opfd);os.fsync(f);os.close(f);os.fsync(opfd)
   out={'ok':True,**public(task)}
  elif action=='status':
   if task['state']=='planned':
    try:
     launch=os.stat('launched',dir_fd=opfd)
     if time.time()-launch.st_mtime>10:task['state']='interrupted';task['message']='Inicio sin recibo del worker; no se repite automáticamente.';save(task)
    except FileNotFoundError:pass
   if task['state']=='running' and incarnation(int(task.get('owner','::0').split(':')[1]))!=task.get('owner'):
    task['state']='interrupted';task['message']='El worker terminó sin un recibo final. Revisá las ubicaciones; no se reejecuta automáticamente.';save(task)
   out={'ok':True,**public(task)}
  else:raise Guard('Acción no admitida')
except (Guard,OSError,ValueError,KeyError) as error:out={'ok':False,'error':error_reason(error)+'. Se conservaron los datos.',**({'blockers':error.blockers} if isinstance(error,Guard) and error.blockers else {})}
finally:
 for fd in handles:
  try:os.close(fd)
  except OSError:pass
print(json.dumps(out,ensure_ascii=True))
