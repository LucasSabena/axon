# Read-only, fd-relative bounded inventory. The host never receives a deletion instruction.
import os, sys, json, stat, time, resource, re, hashlib
cpu_start=resource.getrusage(resource.RUSAGE_SELF)
req=json.loads(sys.stdin.read(131072)); start=time.monotonic(); errors=[]; seen=set(); count=0
try: os.nice(10)
except OSError: pass
# Linux idle I/O class. Failure affects performance, never permission.
try:
 import ctypes
 libc=ctypes.CDLL(None); machine=os.uname().machine
 if machine in ('x86_64','aarch64'): libc.syscall(251 if machine=='x86_64' else 30,1,0,3<<13)
except Exception: pass
limits=req.get('limits',{}); max_entries=min(int(limits.get('entries',50000)),100000); seconds=min(float(limits.get('seconds',12)),20)
excluded=req.get('exclusions',[]); root=req['root']; root_path=root['path']; max_depth=min(root.get('depth',40),60)
flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
protected=re.compile(r'(^|/)(\.ssh|\.gnupg|\.git|node_modules|\.env(?:\.[^/]*)?|credentials?|secrets?)(/|$)',re.I)
def blocked(p): return bool(protected.search(p)) or any(p==x or p.startswith(x.rstrip('/')+'/') for x in excluded)
def anchor(p):
 if not p.startswith('/') or '\0' in p or any(x in ('.','..') for x in p.split('/')): raise ValueError('path')
 fd=os.open('/',flags)
 try:
  for part in p.split('/'):
   if part:
    nxt=os.open(part,flags,dir_fd=fd);os.close(fd);fd=nxt
  return fd
 except: os.close(fd);raise
def unescape(p): return re.sub(r'\\([0-7]{3})',lambda m:chr(int(m[1],8)),p)
mounts=[]
for line in open('/proc/self/mountinfo'):
 a,b=line.rstrip().split(' - ',1);f=a.split();t=b.split()[0];p=unescape(f[4]); medium='ram' if t in ('tmpfs','ramfs') else 'disk' if t in ('ext4','ext3','xfs','btrfs','zfs','vfat','exfat') else 'excluded'
 m={'id':f[0],'path':p,'device':f[2],'type':t,'medium':medium}
 if medium!='excluded':
  try: v=os.statvfs(p);m.update(freeBytes=str(v.f_bavail*v.f_frsize),totalBytes=str(v.f_blocks*v.f_frsize))
  except OSError: pass
 mounts.append(m)
def mount(p): return max((m for m in mounts if p==m['path'] or p.startswith(m['path'].rstrip('/')+'/')),key=lambda m:len(m['path']))
def identity(p,s): return dict(canonicalPath=p,device=str(s.st_dev),inode=str(s.st_ino),mountId=mount(p)['id'],size=str(s.st_size),mtimeNs=str(s.st_mtime_ns),ownerUid=s.st_uid,kind='symlink' if stat.S_ISLNK(s.st_mode) else 'directory' if stat.S_ISDIR(s.st_mode) else 'file')
def limited(): return count>=max_entries or time.monotonic()-start>=seconds
def measure(fd,name,p,dev,depth):
 global count
 if limited(): return 0,0,False,0,['Límite del análisis alcanzado']
 count+=1
 try: s=os.stat(name,dir_fd=fd,follow_symlinks=False)
 except OSError: return 0,0,False,1,['No se pudo leer el elemento']
 if blocked(p): return 0,0,False,1,['Ruta excluida por política']
 if s.st_dev!=dev or mount(p)['medium']=='excluded': return 0,0,False,1,['Otro filesystem o montaje excluido']
 if stat.S_ISLNK(s.st_mode): return s.st_size,s.st_blocks*512,True,1,['Enlace simbólico: no se siguió; revisar destino']
 key=(s.st_dev,s.st_ino); logical=s.st_size;allocated=s.st_blocks*512
 if key in seen: logical=allocated=0
 else: seen.add(key)
 complete=True;n=1;notes=[]
 if stat.S_ISDIR(s.st_mode):
  if depth>=max_depth:return logical,allocated,False,n,['Profundidad limitada; tamaño parcial']
  child=None
  try:
   child=os.open(name,flags,dir_fd=fd)
   if os.fstat(child).st_ino!=s.st_ino:raise OSError('changed')
   with os.scandir(child) as it:
    for entry in it:
     if limited():complete=False;notes=['Límite del análisis alcanzado'];break
     l,a,c,num,msg=measure(child,entry.name,p+'/'+entry.name,dev,depth+1);logical+=l;allocated+=a;complete=complete and c;n+=num
     if msg and len(notes)<4:notes+=msg[:1]
  except OSError: complete=False;notes=['Permiso denegado o carpeta modificada']
  finally:
   if child is not None: os.close(child)
 return logical,allocated,complete,n,list(dict.fromkeys(notes))
def read_private(fd,name):
 f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
 try:
  if not stat.S_ISREG(os.fstat(f).st_mode) or os.fstat(f).st_size>262144: raise ValueError('metadata')
  return os.read(f,262145).decode('utf8')
 finally:os.close(f)
rows=[]; complete=True; fd=None; info=None; legacy=None
try:
 if blocked(root_path):raise ValueError('excluded')
 if mount(root_path)['medium']=='excluded':raise ValueError('mount')
 fd=anchor(root_path)
 if root['adapterId']=='trash-xdg':
  try:info=anchor(os.path.dirname(root_path)+'/info')
  except OSError:errors.append('Papelera XDG: metadatos no disponibles')
 if root['adapterId']=='trash-legacy':
  try:
   legacy=json.loads(read_private(fd,'.manifest.json'))
   if not isinstance(legacy,list):raise ValueError('manifest')
  except Exception:legacy=None;errors.append('Papelera Axon: manifiesto ausente o inválido')
 with os.scandir(fd) as entries:
  for e in entries:
   if len(rows)>=1000 or limited():complete=False;errors.append('Cobertura parcial: límite del análisis');break
   if e.name=='.manifest.json' and root['adapterId']=='trash-legacy':continue
   p=root_path.rstrip('/')+'/'+e.name
   try:s=os.stat(e.name,dir_fd=fd,follow_symlinks=False)
   except OSError: errors.append('Un elemento cambió o no se pudo leer');complete=False;continue
   l,a,c,n,notes=measure(fd,e.name,p,os.fstat(fd).st_dev,0)
   ident=identity(p,s);adapter=root['adapterId']; blockers=notes
   row=dict(id=hashlib.sha256((adapter+'\0'+p+'\0'+str(s.st_ino)).encode()).hexdigest()[:24],adapterId=adapter,adapterVersion=1,category=root['title'],title=e.name,identity=ident,logicalBytes=str(l) if c else None,allocatedBytes=str(a) if c else None,reclaimableBytes=None,estimateConfidence='unknown',risk='review',recovery='none',references=[],blockers=blockers,requiredCapabilities=['host-fd-mutation','activity-proof'],complete=c,entries=n,reason='Tamaño observado. No detectar referencias no demuestra que esté sin uso.')
   if adapter in ('packages','builds'):row.update(risk='rebuildable',recovery='regenerate',reason='Artefactos potencialmente regenerables. La próxima descarga o compilación tiene un costo; confirmar uso y versión.')
   if adapter.startswith('trash'):
    try:
     if adapter=='trash-xdg':
      if info is None:raise ValueError('info')
      text=read_private(info,e.name+'.trashinfo');lines=text.splitlines()
      if not lines or lines[0]!='[Trash Info]':raise ValueError('header')
      from urllib.parse import unquote
      paths=[x[5:] for x in lines if x.startswith('Path=')];dates=[x[13:] for x in lines if x.startswith('DeletionDate=')]
      if len(paths)!=1 or len(dates)!=1:raise ValueError('duplicate')
      if re.search(r'%(?![0-9A-Fa-f]{2})',paths[0]):raise ValueError('encoding')
      original=unquote(paths[0],errors='strict');date=dates[0];time.strptime(date,'%Y-%m-%dT%H:%M:%S')
      if root.get('trashTop'):
       if not original or '\0' in original or any(x in ('.','..') for x in original.split('/')):raise ValueError('relative path')
       original=original if original.startswith('/') else root['trashTop'].rstrip('/')+'/'+original
       if not original.startswith(root['trashTop'].rstrip('/')+'/'):raise ValueError('outside volume')
     else:
      matches=[x for x in (legacy or []) if isinstance(x,dict) and x.get('id')==e.name]
      if len(matches)!=1:raise ValueError('manifest')
      original=matches[0]['orig'];date=time.strftime('%Y-%m-%dT%H:%M:%S',time.localtime(matches[0]['ts']/1000))
     if not isinstance(original,str) or not original.startswith('/') or '\0' in original or any(x in ('.','..') for x in original.split('/')):raise ValueError('path')
     row.update(originalPath=original,deletedAt=date,reason='Elemento de papelera con origen registrado. Vaciarlo sería irreversible; moverlo no libera espacio.',recovery='none',risk='sensitive')
    except Exception:row['blockers'].append('Metadatos de restauración inválidos o ausentes: conservar para revisión')
   if not c and 'Hay elementos incompletos; revisá sus condiciones' not in errors:errors.append('Hay elementos incompletos; revisá sus condiciones')
   rows.append(row);complete=complete and c
except FileNotFoundError:errors.append('La ubicación no existe');complete=False
except (OSError,ValueError):errors.append('Ubicación inaccesible, enlazada, excluida o montaje no admitido');complete=False
finally:
 if fd is not None:os.close(fd)
 if info is not None:os.close(info)
usage=resource.getrusage(resource.RUSAGE_SELF);io={};peak_rss=0
try:
 status=dict(line.strip().split(':',1) for line in open('/proc/self/status') if ':' in line)
 peak_rss=int(status['VmHWM'].strip().split()[0])*1024
except (OSError,KeyError,ValueError):peak_rss=usage.ru_maxrss*1024
try:io=dict(line.strip().split(': ') for line in open('/proc/self/io'))
except OSError:pass
print(json.dumps(dict(candidates=rows,mounts=mounts,complete=complete,errors=errors,metrics=dict(elapsedMs=round((time.monotonic()-start)*1000),cpuMs=round((usage.ru_utime+usage.ru_stime-cpu_start.ru_utime-cpu_start.ru_stime)*1000),peakRssBytes=peak_rss,readBytes=io.get('read_bytes','0'),entries=count)),ensure_ascii=True))
