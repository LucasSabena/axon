"""Bounded file edit with inode/content revision and atomic no-overwrite publication."""
import os,sys,json,stat,hashlib,uuid,ctypes,fcntl,time
r=json.loads(sys.argv[1]);D=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW;fd=None;stage=None;capture=None
class Conflict(Exception):pass
def revision(data,s,parent):
 value={'dev':str(s.st_dev),'ino':str(s.st_ino),'size':str(s.st_size),'mtimeNs':str(s.st_mtime_ns),'mode':str(s.st_mode),'parentDev':str(parent.st_dev),'parentIno':str(parent.st_ino),'sha':hashlib.sha256(data).hexdigest()}
 return hashlib.sha256(json.dumps(value,separators=(',',':')).encode()).hexdigest()
def read(name):
 f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
 try:
  s=os.fstat(f)
  if not stat.S_ISREG(s.st_mode) or s.st_size>524288 or s.st_uid!=os.getuid():raise Conflict()
  data=os.read(f,524289);after=os.fstat(f)
  if (s.st_size,s.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise Conflict()
  return data,s
 finally:os.close(f)
def rename(old,new):
 libc=ctypes.CDLL(None,use_errno=True)
 if libc.renameat2(fd,old.encode(),fd,new.encode(),1):raise Conflict()
 os.fsync(fd)
try:
 data=sys.stdin.buffer.read(524289)
 if len(data)>524288 or len(data)!=r['size']:raise Conflict()
 p=r['path'];fd=os.open('/',D)
 for part in os.path.dirname(p).split('/'):
  if not part:continue
  if part in ('.','..'):raise Conflict()
  n=os.open(part,D,dir_fd=fd);os.close(fd);fd=n
 # All AXON writers serialize on the stable directory inode. A second worker
 # must not capture a just-published file while the first reads its receipt.
 # External writers still use the revision/no-overwrite checks below.
 # Bounded wait: a stuck editor must not block every later save forever.
 deadline=time.monotonic()+30
 while True:
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);break
  except BlockingIOError:
   if time.monotonic()>=deadline:raise
   time.sleep(0.2)
 name=os.path.basename(p);parent=os.fstat(fd);old=None;s=None
 # A crash between the capture and publish renames leaves the original hidden in
 # '.axon-edit-*.previous' with the visible name absent: restore the newest such
 # capture. Stale edit leftovers are garbage-collected after a week.
 try:os.stat(name,dir_fd=fd,follow_symlinks=False);present=True
 except FileNotFoundError:present=False
 captures=[];now=time.time()
 for entry in os.listdir(fd):
  if not entry.startswith('.axon-edit-'):continue
  try:es=os.stat(entry,dir_fd=fd,follow_symlinks=False)
  except FileNotFoundError:continue
  if entry.endswith('.previous') and not present:captures.append((es.st_mtime_ns,entry))
  elif now-es.st_mtime>604800:
   try:os.unlink(entry,dir_fd=fd)
   except OSError:pass
 if captures:
  captures.sort()
  try:rename(captures[-1][1],name);present=True
  except Conflict:pass
 try:old,s=read(name)
 except FileNotFoundError:
  if r['revision']!='missing':raise Conflict()
 if old is not None and revision(old,s,parent)!=r['revision']:raise Conflict()
 stage='.axon-edit-'+uuid.uuid4().hex;out=os.open(stage,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
 try:
  off=0
  while off<len(data):off+=os.write(out,data[off:])
  os.fchmod(out,stat.S_IMODE(s.st_mode) if s else 0o600);os.fsync(out)
 finally:os.close(out)
 if old is not None:
  capture=stage+'.previous';rename(name,capture);actual,current=read(capture)
  if revision(actual,current,parent)!=r['revision']:
   try:rename(capture,name);capture=None
   except:pass
   raise Conflict()
 try:rename(stage,name);stage=None
 except:
  if capture:
   try:rename(capture,name);capture=None
   except:pass
  raise
 if capture:os.unlink(capture,dir_fd=fd);capture=None;os.fsync(fd)
 actual,s=read(name);print(json.dumps({'ok':True,'revision':revision(actual,s,parent)}))
except Conflict:print(json.dumps({'ok':False,'conflict':True,'error':'El archivo, contenido o destino cambió. Se conservó la edición concurrente; recargá y compará antes de guardar.'}))
except:print(json.dumps({'ok':False,'error':'No se pudo publicar la edición de forma atómica. Revisá permisos y cualquier original conservado.'}))
finally:
 if fd is not None:
  if stage:
   try:os.unlink(stage,dir_fd=fd)
   except:pass
  os.close(fd)
