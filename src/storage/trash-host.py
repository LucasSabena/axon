# Shared XDG / legacy operations. No recursive deletion, no shell, no cross-device fallback.
import os,sys,json,stat,time,ctypes,errno,fcntl,uuid,hashlib
from urllib.parse import quote,unquote
changed=False
req=json.loads(sys.stdin.read(262145));home=req['home'];action=req['action'];D=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
class Guard(Exception): pass
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
def read(fd,name):
 f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
 try:
  s=os.fstat(f)
  if not stat.S_ISREG(s.st_mode) or s.st_size>262144:raise Guard('Metadatos demasiado grandes o inválidos')
  return os.read(f,262145).decode('utf8')
 finally:os.close(f)
def write(fd,name,text):
 f=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=fd)
 try:
  data=text.encode();off=0
  while off<len(data):off+=os.write(f,data[off:])
  os.fsync(f)
 finally:os.close(f)
 os.fsync(fd)
def identity(s):return dict(device=str(s.st_dev),inode=str(s.st_ino),size=str(s.st_size),mtimeNs=str(s.st_mtime_ns),ownerUid=s.st_uid,kind='directory' if stat.S_ISDIR(s.st_mode) else 'symlink' if stat.S_ISLNK(s.st_mode) else 'file')
def rename(src,name,dest,new):
 global changed
 libc=ctypes.CDLL(None,use_errno=True)
 if not hasattr(libc,'renameat2'):raise Guard('El host no admite renameat2; operación deshabilitada')
 if libc.renameat2(src,name.encode(),dest,new.encode(),1)!=0:
  e=ctypes.get_errno()
  if e==errno.EXDEV:raise Guard('Otro filesystem: se conserva el original. Copia entre mounts todavía no verificada.')
  if e==errno.EEXIST:raise Guard('El destino ya existe; no se sobrescribió')
  raise OSError(e,'No se pudo mover')
 changed=True
 os.fsync(src);os.fsync(dest)
def valid_id(s):return isinstance(s,str) and s not in ('','.','..') and '/' not in s and '\0' not in s and len(s)<250
tops={}
def xdg(origin):return origin=='xdg' or origin.startswith('volume-')
def meta(origin,fd,name,info=None):
 if xdg(origin):
  if info is None:raise Guard('Metadatos ausentes')
  lines=read(info,name+'.trashinfo').splitlines()
  if not lines or lines[0]!='[Trash Info]':raise Guard('Metadatos inválidos')
  ps=[x[5:] for x in lines if x.startswith('Path=')];ds=[x[13:] for x in lines if x.startswith('DeletionDate=')]
  if len(ps)!=1 or len(ds)!=1:raise Guard('Metadatos inválidos')
  import re
  if re.search(r'%(?![a-fA-F0-9]{2})',ps[0]):raise Guard('Ruta codificada inválida')
  p=unquote(ps[0],errors='strict');time.strptime(ds[0],'%Y-%m-%dT%H:%M:%S');date=ds[0]
  if origin in tops:
   if not p or '\0' in p or any(x in ('.','..') for x in p.split('/')):raise Guard('Origen relativo inválido')
   p=p if p.startswith('/') else tops[origin]+'/'+p
   if not p.startswith(tops[origin].rstrip('/')+'/'):raise Guard('Origen fuera del disco de la papelera')
 else:
  data=json.loads(read(fd,'.manifest.json'))
  if not isinstance(data,list) or any(not isinstance(e,dict) for e in data):raise Guard('Manifiesto inválido')
  entries=[e for e in data if isinstance(e,dict) and e.get('id')==name]
  if len(entries)!=1:raise Guard('No hay un origen inequívoco')
  p=entries[0]['orig'];date=time.strftime('%Y-%m-%dT%H:%M:%S',time.localtime(entries[0]['ts']/1000))
 if not isinstance(p,str) or not p.startswith('/') or '\0' in p or any(x in ('.','..') for x in p.split('/')):raise Guard('Origen inválido')
 return p,date
def roots(create=False,source=None):
 result=[]
 def add(origin,p,make=False):
  fd=info=trash=None
  try:
   fd=anchor(p,make)
   if xdg(origin):
    trash=anchor(os.path.dirname(p),make)
    for private in (trash,fd):
     s=os.fstat(private)
     if s.st_uid!=os.getuid() or s.st_mode&0o077:raise Guard('La papelera requiere propietario y permisos privados; usá un formato compatible')
    try:info=anchor(os.path.dirname(p)+'/info',make)
    except FileNotFoundError:info=None
    if info is not None:
     s=os.fstat(info)
     if s.st_uid!=os.getuid() or s.st_mode&0o077:raise Guard('Los metadatos de papelera necesitan permisos privados')
   result.append((origin,p,fd,info));fd=info=None
  except FileNotFoundError:pass
  finally:
   for opened in (fd,info,trash):
    if opened is not None:os.close(opened)
 add('xdg',home+'/.local/share/Trash/files',create)
 add('legacy',home+'/.local/share/axon-trash')
 homefd=anchor(home)
 try:home_dev=os.fstat(homefd).st_dev
 finally:os.close(homefd)
 # Paths come only from the server's physical-volume inventory, never the request body.
 candidates=sorted(req.get('volumes',[])[:128],key=lambda v:(not bool(source and source.startswith(v['path'].rstrip('/')+'/')),-len(v['path'])))
 seen=set()
 for volume in candidates:
  root=volume['path'];vfd=None
  try:
   vfd=anchor(root);vs=os.fstat(vfd)
   if vs.st_dev==home_dev or vs.st_dev in seen:continue
   if volume.get('mountId'):
    with open('/proc/self/fdinfo/%d'%vfd) as stream:mid=next((line.split(':',1)[1].strip() for line in stream if line.startswith('mnt_id:')),None)
    if mid!=volume['mountId']:raise Guard('El disco cambió o fue desconectado')
   seen.add(vs.st_dev);selected=bool(create and source and source.startswith(root.rstrip('/')+'/'))
   shared=root.rstrip('/')+'/.Trash';fallback=root.rstrip('/')+'/.Trash-'+str(os.getuid());choices=[]
   try:
    sharedfd=os.open('.Trash',D,dir_fd=vfd)
    try:
     if os.fstat(sharedfd).st_mode&stat.S_ISVTX:choices.append(shared+'/'+str(os.getuid()))
    finally:os.close(sharedfd)
   except OSError:pass
   choices.append(fallback);created=False
   for base in choices:
    prefix='volume-'+hashlib.sha256(base.encode()).hexdigest()[:20];tops[prefix]=root.rstrip('/')
    try:
     add(prefix,base+'/files',selected and not created)
     if any(r[0]==prefix for r in result):created=True
    except (Guard,OSError):
     if base==fallback and selected:raise Guard('No se pudo crear una papelera privada en este disco. El original se conserva')
   if selected and not created:raise Guard('No se pudo abrir la papelera del disco; el original se conserva')
  except (FileNotFoundError,PermissionError):
   if create and source and source.startswith(root.rstrip('/')+'/'):raise Guard('El disco no está disponible para la papelera')
  finally:
   if vfd is not None:os.close(vfd)
 return result
def trash_for(rs,path,device):
 matches=[r for r in rs if xdg(r[0]) and str(os.fstat(r[2]).st_dev)==str(device) and (r[0]=='xdg' or path.startswith(tops[r[0]]+'/'))]
 if not matches:raise Guard('Otro filesystem sin papelera privada disponible: se conserva el original')
 return matches[0]
def trash_path(origin,path):return os.path.relpath(path,tops[origin]) if origin in tops else path
def under(path,base):return path==base or path.startswith(base+'/')
def protected_trash(path,rs):
 # XDG/volume roots point at the files/ subdir: protect its parent (files + info).
 # The legacy root is the trash dir itself, not a parent to strip.
 return any(under(path,r[1] if r[0]=='legacy' else os.path.dirname(r[1])) for r in rs)
def listing(rs):
 result=[];complete=True
 for origin,p,fd,info in rs:
  with os.scandir(fd) as it:
   for e in it:
    if origin=='legacy' and (e.name=='.manifest.json' or e.name.startswith('.manifest-')):continue
    if len(result)>=2000:complete=False;break
    s=os.stat(e.name,dir_fd=fd,follow_symlinks=False);item=dict(id=origin+':'+e.name,key=e.name,origin='xdg' if xdg(origin) else origin,volumePath=tops.get(origin),path=p+'/'+e.name,identity=identity(s),name=e.name,orig=None,ts=None,canRestore=False,allocatedBytes=str(s.st_blocks*512) if not stat.S_ISDIR(s.st_mode) else None)
    try:item['orig'],item['ts']=meta(origin,fd,e.name,info);item['name']=os.path.basename(item['orig']);item['canRestore']=True
    except Exception:item['error']='Metadatos inválidos o ausentes; conservar para revisión'
    result.append(item)
 return dict(items=result,complete=complete,dirs=[r[1] for r in rs])
handles=[];lock=None
def reason(e):
 if isinstance(e,BlockingIOError):return 'Hay otra operación de archivos en curso; esperá unos segundos y reintentá'
 if isinstance(e,PermissionError):return 'Sin permiso: el elemento pertenece a otro usuario (por ejemplo root) o su carpeta no es modificable. Axon no lo mueve a la papelera'
 if isinstance(e,FileNotFoundError):return 'El elemento ya no existe; actualizá la vista'
 if isinstance(e,OSError):return 'El sistema rechazó la operación: '+(e.strerror or str(e))
 return 'Metadatos de la papelera inválidos o incompletos; revisalos antes de reintentar'
try:
 if action=='probe':
  p=req['path'];fd=anchor(os.path.dirname(p));handles.append(fd);s=os.stat(os.path.basename(p),dir_fd=fd,follow_symlinks=False);out={'ok':True,'identity':identity(s)}
 elif action=='list':
  rs=roots();handles += [f for r in rs for f in r[2:] if f is not None];out={'ok':True,**listing(rs)}
 else:
  lockdir=anchor(home+'/.local/share/axon',True);handles.append(lockdir)
  lock=os.open('file-operations.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=lockdir);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  rs=roots(action in ('send','migrate'),req.get('path'));handles += [f for r in rs for f in r[2:] if f is not None]
  if action=='reconcile':
   intent=req['intent']
   if intent['action']=='send':
    srcpath=intent['path'];expected=intent['identity'];destination_root=trash_for(rs,srcpath,expected['device']);dstpath=destination_root[1]+'/'+intent['key'];state='verified'
   elif intent['action']=='restore':
    srcpath=intent['item']['path'];dstpath=intent['item']['orig'];expected=intent['item']['identity'];state='restored'
   elif intent['action']=='migrate':
    srcpath=intent['item']['path'];dstpath=home+'/.local/share/Trash/files/'+intent['key'];expected=intent['item']['identity'];state='verified'
   else:raise Guard('Intención desconocida')
   def observed(p):
    fd=None
    try:
     fd=anchor(os.path.dirname(p));return identity(os.stat(os.path.basename(p),dir_fd=fd,follow_symlinks=False))
    except FileNotFoundError:return None
    finally:
     if fd is not None:os.close(fd)
   srcvalue,dstvalue=observed(srcpath),observed(dstpath)
   if srcvalue is None and dstvalue==expected:
    if state=='verified':
     origin,_,f,i=destination_root if intent['action']=='send' else next(r for r in rs if r[0]=='xdg');original,observed_date=meta(origin,f,intent['key'],i)
     expected_original=intent['item']['orig'] if intent['action']=='migrate' else srcpath
     if original!=expected_original:raise Guard('Metadatos no reconciliados')
     if intent['action']=='migrate' and observed_date!=intent['item']['ts']:raise Guard('La fecha de origen cambió; revisar antes de reconciliar')
    out=dict(ok=True,state=state,fromPath=srcpath,toPath=dstpath,retiredBytes='0',message='Estado real reconciliado; no se reejecutó el movimiento. Revisá metadatos residuales antes de descartarlos.')
   elif srcvalue==expected and dstvalue is None:out=dict(ok=True,state='failed',message='El original sigue en su ubicación. No se reejecutó el movimiento; pueden quedar metadatos sin archivo.')
   else:raise Guard('Resultado incierto: se conservan datos y bloqueo')
  elif action=='send':
   p=req['path'];name=os.path.basename(p)
   if any(x in ('.ssh','.gnupg') for x in p.split('/')):raise Guard('Ruta de acceso protegida')
   private_root=home+'/.local/share/axon';recovery=private_root+'/format-backups'
   if len(p.split('/'))<4 or p==home or under(p,home+'/.local/share/Trash') or under(p,home+'/.local/share/axon-trash') or (under(p,private_root) and not under(p,recovery)):raise Guard('Ruta protegida')
   src=anchor(os.path.dirname(p));handles.append(src);s=os.stat(name,dir_fd=src,follow_symlinks=False)
   if identity(s)!=req['identity']:raise Guard('El elemento cambió desde la revisión')
   origin,destpath,dest,info=trash_for(rs,p,s.st_dev);key=req['key']
   if protected_trash(p,rs):raise Guard('La papelera está protegida; seleccioná su contenido para restaurarlo')
   if not valid_id(key):raise Guard('Identificador inválido')
   if s.st_dev!=os.fstat(dest).st_dev:raise Guard('Otro filesystem: no se mueve ni se borra el original')
   write(info,key+'.trashinfo','[Trash Info]\nPath='+quote(trash_path(origin,p),safe='/')+'\nDeletionDate='+time.strftime('%Y-%m-%dT%H:%M:%S')+'\n')
   try:rename(src,name,dest,key)
   except:os.unlink(key+'.trashinfo',dir_fd=info);os.fsync(info);raise
   matched=identity(os.stat(key,dir_fd=dest,follow_symlinks=False))==req['identity']
   out=dict(ok=True,state='verified' if matched else 'interrupted',fromPath=p,toPath=destpath+'/'+key,id=origin+':'+key,retiredBytes='0',message='Enviado a papelera. No libera espacio.' if matched else 'El elemento cambió durante el movimiento; se conservó en papelera y requiere revisión.')
  elif action=='migrate':
   selection=req['item'];key=req['key'];origin,old=selection['id'].split(':',1)
   if origin!='legacy' or not valid_id(old) or not valid_id(key):raise Guard('Sólo se migran elementos legacy seleccionados')
   _,srcpath,src,_=next(r for r in rs if r[0]=='legacy');_,destpath,dest,info=next(r for r in rs if r[0]=='xdg')
   original,date=meta('legacy',src,old)
   if original!=selection['orig'] or date!=selection['ts'] or identity(os.stat(old,dir_fd=src,follow_symlinks=False))!=selection['identity']:raise Guard('El elemento o sus metadatos cambiaron desde el plan')
   if os.fstat(src).st_dev!=os.fstat(dest).st_dev:raise Guard('Otro filesystem: se conserva la papelera original')
   write(info,key+'.trashinfo','[Trash Info]\nPath='+quote(original,safe='/')+'\nDeletionDate='+date+'\n')
   try:rename(src,old,dest,key)
   except:os.unlink(key+'.trashinfo',dir_fd=info);os.fsync(info);raise
   if identity(os.stat(key,dir_fd=dest,follow_symlinks=False))!=selection['identity']:raise Guard('El elemento cambió durante la migración; se conserva y requiere revisión')
   manifest=json.loads(read(src,'.manifest.json'))
   entries=[e for e in manifest if isinstance(e,dict) and e.get('id')==old]
   if len(entries)!=1 or entries[0].get('orig')!=original:raise Guard('El manifiesto cambió durante el movimiento; revisar antes de continuar')
   remaining=[e for e in manifest if e.get('id')!=old];temp='.manifest-'+uuid.uuid4().hex;write(src,temp,json.dumps(remaining));os.rename(temp,'.manifest.json',src_dir_fd=src,dst_dir_fd=src);os.fsync(src)
   out=dict(ok=True,state='verified',id='xdg:'+key,fromPath=srcpath+'/'+old,toPath=destpath+'/'+key,retiredBytes='0',message='Migrado a papelera del escritorio. Conserva origen y fecha; no libera espacio.')
  elif action=='restore':
   selection=req['item'];origin,key=selection['id'].split(':',1)
   if not valid_id(key):raise Guard('Identificador inválido')
   _,p,src,info=next(r for r in rs if r[0]==origin);original,date=meta(origin,src,key,info)
   if original!=selection['orig'] or identity(os.stat(key,dir_fd=src,follow_symlinks=False))!=selection['identity']:raise Guard('El elemento o sus metadatos cambiaron')
   if protected_trash(original,rs):raise Guard('Origen inválido dentro de papelera')
   private_root=home+'/.local/share/axon';recovery=private_root+'/format-backups'
   if len(original.split('/'))<4 or original==home or any(x in ('.ssh','.gnupg') for x in original.split('/')) or (under(original,private_root) and not under(original,recovery)):raise Guard('Destino de restauración protegido')
   dest=anchor(os.path.dirname(original));handles.append(dest);rename(src,key,dest,os.path.basename(original))
   matched=identity(os.stat(os.path.basename(original),dir_fd=dest,follow_symlinks=False))==selection['identity']
   if not matched:raise Guard('El elemento cambió durante la restauración; revisar recibo antes de reintentar')
   if xdg(origin):os.unlink(key+'.trashinfo',dir_fd=info);os.fsync(info)
   else:
    manifest=json.loads(read(src,'.manifest.json'));manifest=[e for e in manifest if e.get('id')!=key];temp='.manifest-'+uuid.uuid4().hex;write(src,temp,json.dumps(manifest));os.rename(temp,'.manifest.json',src_dir_fd=src,dst_dir_fd=src);os.fsync(src)
   out=dict(ok=True,state='restored',fromPath=p+'/'+key,toPath=original,id=selection['id'],retiredBytes='0',message='Original restaurado sin sobrescribir archivos.')
  else:raise Guard('Operación no admitida')
except (Guard,OSError,ValueError,KeyError,StopIteration) as e:
 out={'ok':False,'state':'interrupted' if changed else 'failed','error':str(e) if isinstance(e,Guard) else reason(e)}
finally:
 for fd in handles:
  try:os.close(fd)
  except OSError:pass
 if lock is not None:os.close(lock)
print(json.dumps(out,ensure_ascii=True))
