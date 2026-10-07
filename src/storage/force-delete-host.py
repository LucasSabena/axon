# Permanent delete as root for the file manager. No shell, no symlink following, never crosses mounts.
import os,sys,json,stat,re
try:req=json.loads(sys.stdin.read(300001))
except:req={}
if not isinstance(req,dict):req={}
HOME=req.get('home') if isinstance(req.get('home'),str) else ''
# A trailing slash would disable every home-scoped guard below.
HOME=HOME.rstrip('/')
NEVER={'/','/bin','/sbin','/lib','/lib32','/lib64','/libx32','/usr','/etc','/boot','/dev','/proc','/sys','/run','/var','/root','/home','/mnt','/media','/opt','/srv','/snap','/tmp','/lost+found',HOME,HOME+'/.local',HOME+'/.local/share',HOME+'/.local/share/Trash',HOME+'/.local/share/Trash/files',HOME+'/.local/share/Trash/info',HOME+'/.local/share/axon',HOME+'/.local/share/axon-trash',HOME+'/.config',HOME+'/.ssh',HOME+'/.gnupg'}
NEVER_UNDER=('/boot/','/proc/','/sys/','/dev/','/run/','/var/','/usr/','/bin/','/sbin/','/lib/','/lib32/','/lib64/','/libx32/','/etc/','/opt/','/snap/','/srv/','/root/','/home/','/mnt/','/media/','/tmp/','/lost+found/')
# Home-scoped prefixes whose *contents* stay protected — NEVER only covers the
# exact dir, but the axon state tree (locks, receipts) and trash payloads must
# never be deleted directly. format-backups is the documented carve-out.
HOME_NEVER_UNDER=(HOME+'/.local/share/axon/',HOME+'/.local/share/axon-trash/',HOME+'/.local/share/Trash/')
HOME_NEVER_EXCEPT=(HOME+'/.local/share/axon/format-backups/',)
D=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
class Skip(Exception):pass
# renameat2(RENAME_NOREPLACE): the capture/restore renames must never clobber
# an entry a racing writer placed at the name. The glibc wrapper is missing
# before 2.28 even on capable kernels, so call the syscall directly — on a
# kernel without it (pre-3.15) the syscall fails ENOSYS and the delete fails
# closed rather than degrading to a clobbering rename.
import ctypes
_libc=ctypes.CDLL(None,use_errno=True)
_SYS_renameat2={'x86_64':316,'i386':353,'i686':353,'aarch64':276,'armv6l':382,'armv7l':382,'ppc64':357,'ppc64le':357,'s390x':347,'riscv64':276,'loongarch64':276}.get(os.uname().machine)
def rename_noreplace(src,dst,fd):
 if _SYS_renameat2 is None:raise OSError(38,'renameat2 no disponible en esta arquitectura')
 if _libc.syscall(_SYS_renameat2,fd,src.encode(),fd,dst.encode(),1)!=0:
  e=ctypes.get_errno();raise OSError(e,os.strerror(e))
def unescape(p):return re.sub(r'\\([0-7]{3})',lambda m:chr(int(m.group(1),8)),p)
def mounts():
 # Returns (all mountpoints, mounts on devices other than the root fs).
 # A bind mount keeps its backing device — comparing major:minor against the
 # '/' mount rejects `mount --bind / /mnt/x` AND `mount --bind /etc /mnt/x`
 # (whose mountinfo root fields are '/' and '/etc' on the same device). A
 # subvolume of *another* disk keeps its distinct device and stays a valid
 # volume root regardless of its mountinfo root.
 out=set();entries=[];root_dev=None
 for line in open('/proc/self/mountinfo'):
  f=line.split()
  if len(f)>4:
   mp=unescape(f[4]);out.add(mp);entries.append((f[2],mp))
   if f[4]=='/':root_dev=f[2]
 return out,{mp for dev,mp in entries if root_dev is not None and dev!=root_dev}
def under(path,base):return path==base or path.startswith(base.rstrip('/')+'/')
def allowed_roots(M):
 # Allowlist: the host user's home plus real mounted volume roots. Caller-provided
 # roots are honoured only when they are the home tree or a live mount point.
 out=[]
 h=HOME.rstrip('/')
 if h.startswith('/'):out.append(h)
 for m in M:
  if m.startswith(('/mnt/','/media/','/run/media/')):out.append(m)
 extra=req.get('allowed_roots')
 if isinstance(extra,list):
  for a in extra[:64]:
   if not isinstance(a,str) or not a.startswith('/') or '\0' in a or any(x in ('.','..','') for x in a.split('/')[1:]):continue
   a=a.rstrip('/')
   if not a or a=='/':continue
   if (out and (a==out[0] or a.startswith(out[0]+'/'))) or (a in M and a.startswith(('/mnt/','/media/','/run/media/'))):out.append(a)
 return out
def mnt_id(fd):
 try:
  with open('/proc/self/fdinfo/%d'%fd) as s:
   for line in s:
    if line.startswith('mnt_id:'):return line.split(':',1)[1].strip()
 except OSError:pass
 return None
def check(p):
 if not isinstance(p,str) or not p.startswith('/') or '\0' in p or any(x in ('.','..','') for x in p.split('/')[1:]):raise Skip('Ruta inválida')
 q=p.rstrip('/') or '/'
 M,Mfull=mounts();allowed=allowed_roots(Mfull)
 if q in NEVER or any(x in ('.ssh','.gnupg') for x in q.split('/')):raise Skip('Ruta del sistema protegida: no se borra desde Archivos')
 for x in NEVER_UNDER:
  if (q.startswith(x) or q+'/'==x) and not any(under(q,a) and under(a,x.rstrip('/')) for a in allowed):raise Skip('Ruta del sistema protegida: no se borra desde Archivos')
 for x in HOME_NEVER_UNDER:
  if q.startswith(x) and not any(q.startswith(e) for e in HOME_NEVER_EXCEPT):raise Skip('Ruta del estado interno de AXON: no se borra desde Archivos')
 if q in M:raise Skip('Es un punto de montaje (un disco): no se borra desde Archivos')
 if any(m.startswith(q+'/') for m in M):raise Skip('Contiene un disco montado: no se borra desde Archivos')
 # Anything inside a mount that is not itself an allowed root (bind-mount
 # aliases, FUSE mounts outside the allowlist) is off limits — EXCEPT mounts
 # that are ancestors-or-self of an allowed root: a separate /home filesystem
 # or a tmpfs /media must not reject every delete beneath it (they never widen
 # the reachable set — the allowed-root check below still bounds the target).
 if any(m!='/' and m not in allowed and under(q,m) and not any(under(a,m) for a in allowed) for m in M):raise Skip('Dentro de un montaje no permitido: no se borra desde Archivos')
 if not allowed or any(q==a for a in allowed) or not any(q.startswith(a.rstrip('/')+'/') for a in allowed):raise Skip('Fuera de las ubicaciones permitidas para borrado')
 return q
def anchor(p):
 # Every component is opened fd-relative with O_NOFOLLOW: a symlink anywhere in
 # the path (not only the last component) fails instead of redirecting the delete.
 fd=os.open('/',D)
 try:
  for part in p.split('/'):
   if not part:continue
   nxt=os.open(part,D,dir_fd=fd);os.close(fd);fd=nxt
  return fd
 except:os.close(fd);raise
def rm_children(rootfd,dev):
 # Iterative post-order traversal; deep trees cannot exhaust the call stack.
 count=0;base=mnt_id(rootfd);stack=[(rootfd,None)]
 try:
  while stack:
   fd,name=stack[-1];pushed=False
   with os.scandir(fd) as it:
    for e in it:
     try:st=e.stat(follow_symlinks=False)
     except FileNotFoundError:continue
     if stat.S_ISDIR(st.st_mode):
      if st.st_dev!=dev:raise Skip('Hay un montaje dentro: se conserva')
      cfd=os.open(e.name,D,dir_fd=fd)
      mid=mnt_id(cfd)
      if base is not None and mid is not None and mid!=base:os.close(cfd);raise Skip('Hay un montaje dentro: se conserva')
      stack.append((cfd,e.name));pushed=True;break
     try:os.unlink(e.name,dir_fd=fd)
     except FileNotFoundError:continue
     count+=1
   if pushed:continue
   stack.pop()
   if name is not None:
    os.close(fd)
    try:os.rmdir(name,dir_fd=stack[-1][0])
    except FileNotFoundError:pass
    count+=1
  return count
 finally:
  while stack:
   fd,_=stack.pop()
   if fd is not rootfd:
    try:os.close(fd)
    except OSError:pass
def remove(p):
 q=check(p);parent,name=os.path.split(q)
 pfd=anchor(parent)
 try:
  # Defense in depth: re-run every check on the resolved path of the opened
  # parent so a swapped ancestor cannot widen the allowed scope.
  resolved=os.readlink('/proc/self/fd/%d'%pfd)
  if resolved.endswith(' (deleted)'):raise Skip('La carpeta cambió durante el borrado')
  check((resolved.rstrip('/') or '')+'/'+name)
  st=os.stat(name,dir_fd=pfd,follow_symlinks=False);n=1
  # Leaf-name TOCTOU: a cooperating writer could rename-swap the entry between
  # stat and delete. Capture it under a private name first, verify identity,
  # then remove — the swap then fails EEXIST/ENOENT instead of hitting the
  # wrong inode.
  cap='.axon-capture-%s'%os.urandom(4).hex()
  rename_noreplace(name,cap,pfd)
  try:
   cap_st=os.stat(cap,dir_fd=pfd,follow_symlinks=False)
   if (cap_st.st_dev,cap_st.st_ino)!=(st.st_dev,st.st_ino):raise Skip('La entrada cambió durante el borrado')
   if stat.S_ISDIR(st.st_mode):
    cfd=os.open(cap,D,dir_fd=pfd)
    try:
     pm,cm=mnt_id(pfd),mnt_id(cfd)
     if pm is not None and cm is not None and cm!=pm:raise Skip('Es un punto de montaje (un disco): no se borra desde Archivos')
     n+=rm_children(cfd,st.st_dev)
    finally:os.close(cfd)
    os.rmdir(cap,dir_fd=pfd)
   else:os.unlink(cap,dir_fd=pfd)
  except Exception:
   # Restore the captured entry — but never over a name a racing writer
   # recreated; the orphaned capture is swept by a later parent pass.
   try:os.stat(name,dir_fd=pfd,follow_symlinks=False)
   except FileNotFoundError:
    try:rename_noreplace(cap,name,pfd)
    except OSError:pass
   except OSError:pass
   raise
  return n
 finally:os.close(pfd)
done=[];failed=[]
paths=req.get('paths')
if isinstance(paths,list):
 for p in paths:
  try:done.append({'path':p,'entries':remove(p)})
  except Skip as e:failed.append({'path':p,'error':str(e)})
  except FileNotFoundError:failed.append({'path':p,'error':'Ya no existe'})
  except OSError as e:failed.append({'path':p,'error':'El sistema rechazó el borrado: '+(e.strerror or str(e))})
  except Exception:failed.append({'path':p,'error':'Error inesperado; lo restante se conservó'})
try:
 if not isinstance(paths,list):print(json.dumps({'ok':False,'error':'Solicitud inválida','done':done,'failed':failed}))
 else:print(json.dumps({'ok':True,'done':done,'failed':failed}))
except Exception:pass
