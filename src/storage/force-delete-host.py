# Permanent delete as root for the file manager. No shell, no symlink following, never crosses mounts.
import os,sys,json,stat
req=json.loads(sys.stdin.read(300001))
HOME=req['home']
NEVER={'/','/bin','/sbin','/lib','/lib32','/lib64','/libx32','/usr','/etc','/boot','/dev','/proc','/sys','/run','/var','/root','/home','/mnt','/media','/opt','/srv','/snap','/tmp','/lost+found',HOME,HOME+'/.local',HOME+'/.local/share',HOME+'/.config',HOME+'/.ssh',HOME+'/.gnupg'}
NEVER_UNDER=('/boot/','/proc/','/sys/','/dev/','/run/','/var/lib/docker/','/usr/bin/','/usr/sbin/','/usr/lib/','/bin/','/sbin/','/lib/','/lib64/','/etc/')
class Skip(Exception):pass
def mounts():
 out=set()
 for line in open('/proc/self/mountinfo'):
  f=line.split()
  if len(f)>4:out.add(f[4].replace('\\040',' '))
 return out
M=mounts()
def check(p):
 if not isinstance(p,str) or not p.startswith('/') or '\0' in p or any(x in ('.','..','') for x in p.split('/')[1:]):raise Skip('Ruta inválida')
 q=p.rstrip('/') or '/'
 if q in NEVER or any(q.startswith(x) or q+'/'==x for x in NEVER_UNDER):raise Skip('Ruta del sistema protegida: no se borra desde Archivos')
 if q in M:raise Skip('Es un punto de montaje (un disco): no se borra desde Archivos')
 if any(m.startswith(q+'/') for m in M):raise Skip('Contiene un disco montado: no se borra desde Archivos')
 return q
def rm_children(fd,dev):
 count=0
 for name in os.listdir(fd):
  st=os.stat(name,dir_fd=fd,follow_symlinks=False)
  if stat.S_ISDIR(st.st_mode):
   if st.st_dev!=dev:raise Skip('Hay un montaje dentro: se conserva')
   cfd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
   try:count+=rm_children(cfd,dev)
   finally:os.close(cfd)
   os.rmdir(name,dir_fd=fd)
  else:os.unlink(name,dir_fd=fd)
  count+=1
 return count
def remove(p):
 q=check(p);parent,name=os.path.split(q)
 pfd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  st=os.stat(name,dir_fd=pfd,follow_symlinks=False);n=1
  if stat.S_ISDIR(st.st_mode):
   cfd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=pfd)
   try:n+=rm_children(cfd,st.st_dev)
   finally:os.close(cfd)
   os.rmdir(name,dir_fd=pfd)
  else:os.unlink(name,dir_fd=pfd)
  return n
 finally:os.close(pfd)
done=[];failed=[]
for p in req['paths']:
 try:done.append({'path':p,'entries':remove(p)})
 except Skip as e:failed.append({'path':p,'error':str(e)})
 except FileNotFoundError:failed.append({'path':p,'error':'Ya no existe'})
 except OSError as e:failed.append({'path':p,'error':'El sistema rechazó el borrado: '+(e.strerror or str(e))})
print(json.dumps({'ok':True,'done':done,'failed':failed}))
