"""Scoped Compose releases. Private resolved checkpoints; no shell or daemon prune.
The worker survives the API restart. It never prints resolved environments or logs.
"""
import os,sys,json,stat,time,hashlib,uuid,subprocess,fcntl,signal,ctypes,errno
req=json.loads(sys.stdin.read(300001));D=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW;opfd=None;task=None
class Guard(Exception):pass
def anchor(p):
 if not isinstance(p,str) or not p.startswith('/') or any(x in ('.','..') for x in p.split('/')) or '\0' in p:raise Guard('Ruta inválida')
 fd=os.open('/',D)
 try:
  for part in p.split('/'):
   if part:n=os.open(part,D,dir_fd=fd);os.close(fd);fd=n
  return fd
 except:os.close(fd);raise
def read(fd,name,limit=262144):
 f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
 try:
  s=os.fstat(f)
  if not stat.S_ISREG(s.st_mode) or s.st_size>limit or s.st_uid!=os.getuid():raise Guard('Archivo no regular, ajeno o demasiado grande')
  return os.read(f,limit+1),s
 finally:os.close(f)
def write(fd,name,data):
 f=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
 try:
  off=0
  while off<len(data):off+=os.write(f,data[off:])
  os.fsync(f)
 finally:os.close(f)
 os.fsync(fd)
def digest(data):return hashlib.sha256(data).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def save():
 n='.state-'+uuid.uuid4().hex;write(opfd,n,canonical(task));os.replace(n,'state.json',src_dir_fd=opfd,dst_dir_fd=opfd);os.fsync(opfd)
def incarnation(pid):
 try:
  with open('/proc/%d/stat'%pid) as f:s=f.read()
  with open('/proc/sys/kernel/random/boot_id') as f:b=f.read().strip()
  return '%s:%d:%s'%(b,pid,s[s.rfind(')')+2:].split()[19])
 except:return None
def run(args,timeout=20):
 # All Docker output stays private. Bounded reads prevent config/log amplification.
 out=__import__('tempfile').TemporaryFile();err=__import__('tempfile').TemporaryFile()
 try:
  p=subprocess.Popen(['docker']+args,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True,env={k:v for k,v in os.environ.items() if k not in ('COMPOSE_FILE','COMPOSE_PROFILES','COMPOSE_PROJECT_NAME','COMPOSE_ENV_FILES')})
  try:p.wait(timeout=timeout)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=5);raise Guard('Docker no terminó dentro del límite; comprobá el estado antes de repetir')
  out.seek(0);data=out.read(1048577)
  if p.returncode or len(data)>1048576:raise Guard('Docker no pudo validar o verificar este contexto; sus credenciales y logs no se muestran')
  return data
 finally:out.close();err.close()
def model(file,base,project=None):
 args=['compose','--project-directory',base,'-f',file]
 if project:args+=['-p',project]
 return json.loads(run(args+['config','--format','json']))
def check(model):
 if any(k in model for k in ('include','secrets','configs')):raise Guard('Includes, secrets y configs necesitan checkpoints adicionales; este contexto queda en revisión')
 for s in model.get('services',{}).values():
  if s.get('profiles') or not s.get('image') or s.get('scale',1)!=1 or s.get('deploy',{}).get('replicas',1)!=1:raise Guard('Profiles, builds sin imagen o réplicas múltiples no están certificados')
def containers(project,services):
 ids=run(['ps','-aq','--filter','label=com.docker.compose.project='+project]).decode().split()
 if len(ids)>100:raise Guard('Demasiados contenedores para este checkpoint')
 result={}
 if ids:
  rows=json.loads(run(['inspect']+ids))
  for c in rows:
   label=c.get('Config',{}).get('Labels',{}) or {};name=label.get('com.docker.compose.service')
   if name not in services or label.get('com.docker.compose.oneoff','false').lower()=='true':continue
   if name in result:raise Guard('Servicio con varias instancias: requiere un checkpoint distinto')
   result[name]={'id':c['Id'],'image':c['Image'],'running':bool(c['State']['Running']),'configFiles':label.get('com.docker.compose.project.config_files','').split(',')}
 return result
def image_known(image):run(['image','inspect',image,'--format','{{.Id}}'])
def rename(fd,old,new):
 libc=ctypes.CDLL(None,use_errno=True)
 if libc.renameat2(fd,old.encode(),fd,new.encode(),1):raise Guard('Conflicto al publicar: se conservan los archivos para recuperación')
 os.fsync(fd)
def publish(expected,content):
 parent=anchor(os.path.dirname(task['path']));name=os.path.basename(task['path']);stage='.axon-compose-'+task['id']+'-'+uuid.uuid4().hex
 try:
  data,s=read(parent,name)
  if digest(data)!=expected:raise Guard('El archivo cambió después de la revisión; no se sobrescribió')
  if os.statvfs(os.path.dirname(task['path'])).f_bavail*os.statvfs(os.path.dirname(task['path'])).f_frsize<len(content)*3+1048576:raise Guard('Espacio insuficiente para publicación recuperable')
  write(parent,stage,content);os.chmod(stage,stat.S_IMODE(s.st_mode),dir_fd=parent,follow_symlinks=False)
  # Capture the current inode atomically before checking it again. Unknown arrivals remain intact.
  backup=stage+'.previous';rename(parent,name,backup)
  captured,_=read(parent,backup)
  if digest(captured)!=expected:
   try:rename(parent,backup,name)
   except:pass
   raise Guard('Edición concurrente conservada; publicación detenida')
  task['capturedPath']=os.path.join(os.path.dirname(task['path']),backup);save()
  try:rename(parent,stage,name)
  except:
   try:rename(parent,backup,name)
   except:pass
   raise
  # A verified private original exists in the checkpoint, so remove only our captured duplicate.
  os.unlink(backup,dir_fd=parent);os.fsync(parent);task.pop('capturedPath',None)
 finally:os.close(parent)
def public():
 return {k:task[k] for k in ('id','path','project','state','message','changed','active','inactive','createdAt','expiresAt','digest','phase','canRollback','capturedPath','retire','diskFreeBefore','diskFreeAfter') if k in task}
def prepare(home,rootfd):
 p=req['path'];parent=anchor(os.path.dirname(p))
 try:before,_=read(parent,os.path.basename(p))
 finally:os.close(parent)
 content=req.get('content','').encode()
 if len(content)>262144:raise Guard('Borrador demasiado grande')
 original=model(p,os.path.dirname(p));check(original);project=original.get('name')
 if not project or not __import__('re').fullmatch('[a-z0-9][a-z0-9_-]*',project):raise Guard('Identidad Compose desconocida')
 temp=os.path.join(home,'.local/share/axon/compose-releases',req['id'],'draft.yaml');write(opfd,'draft.yaml',content)
 after=model(temp,os.path.dirname(p),project);check(after)
 removed=set(original['services'])-set(after['services']);retire=req.get('retire')
 if removed and removed!={retire}:raise Guard('Retirar servicios requiere una migración separada; el editor no elimina huérfanos')
 if retire and (removed!={retire} or retire=='axon' or set(after['services'])-set(original['services'])):raise Guard('Selección de retirada inválida')
 if any(original.get(k)!=after.get(k) for k in set(original)|set(after) if k not in ('services',)):raise Guard('Cambios de redes, volúmenes o identidad del proyecto requieren un plan específico')
 names=sorted(n for n in after['services'] if canonical(original['services'].get(n))!=canonical(after['services'][n]))
 if retire:
  if names:raise Guard('La retirada no puede modificar servicios vecinos')
  names=[retire]
 if not names:raise Guard('No hay cambios efectivos para aplicar')
 before_containers=containers(project,names)
 for c in before_containers.values():
  if c['configFiles']!=[p]:
   files=c['configFiles'];prefix=home+'/.local/share/axon/compose-releases/'
   if len(files)!=1 or not files[0].startswith(prefix) or os.path.basename(files[0]) not in ('after.json','rollback.json'):raise Guard('El servicio usa overrides u otro archivo Compose; queda en revisión')
   priorfd=anchor(os.path.dirname(files[0]))
   try:
    priorraw,_=read(priorfd,'state.json',1048576);prior=json.loads(priorraw)
    expected=prior.get('beforeRevision') if os.path.basename(files[0])=='rollback.json' else prior.get('afterRevision')
    if prior.get('path')!=p or prior.get('project')!=project or prior.get('state') not in ('verified','restored') or expected!=digest(before):raise Guard('El checkpoint previo no coincide con el archivo actual; revisá su recuperación')
   finally:os.close(priorfd)
  image_known(c['image'])
 for n in names:image_known(original['services'][n]['image'] if retire else after['services'][n]['image'])
 if retire and retire not in before_containers:raise Guard('Contenedor seleccionado no identificado')
 # Env files are resolved into the private checkpoint; absolute binds are preserved.
 write(opfd,'before.json',canonical(original));write(opfd,'after.json',canonical(after));write(opfd,'original.yaml',before)
 rollback=json.loads(json.dumps(original))
 for n,c in before_containers.items():rollback['services'][n]['image']=c['image'];rollback['services'][n].pop('build',None);rollback['services'][n]['pull_policy']='never'
 write(opfd,'rollback.json',canonical(rollback))
 active=sorted(n for n,c in before_containers.items() if c['running'])
 task={'id':req['id'],'path':p,'project':project,'state':'planned','message':'Docker validó un archivo único. Sólo se reinician servicios que ya estaban encendidos.','changed':[{'name':n,'fields':sorted(k for k in set(original['services'].get(n,{}))|set(after['services'].get(n,{})) if original['services'].get(n,{}).get(k)!=after['services'].get(n,{}).get(k)),'image':original['services'][n]['image'] if retire else after['services'][n]['image']} for n in names],'active':active,'inactive':[n for n in names if n not in active],'containers':before_containers,'beforeRevision':digest(before),'afterRevision':digest(content),'modelRevision':digest(canonical(after)),'createdAt':int(time.time()*1000),'expiresAt':int((time.time()+300)*1000),'canRollback':False}
 if retire:task['retire']=retire;task['message']='Retirada seleccionada: se quita sólo este servicio del Compose y su contenedor. Se conservan imágenes, montajes y volúmenes; recuperación disponible.'
 task['digest']=digest(canonical(task));return task
def worker(action):
 global task
 lockfd=os.open('compose-release.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600,dir_fd=rootfd)
 try:
  fcntl.flock(lockfd,fcntl.LOCK_EX|fcntl.LOCK_NB);task['owner']=incarnation(os.getpid());task['state']='running';task['phase']=action;save()
  base=os.path.join(home,'.local/share/axon/compose-releases',task['id']);directory=os.path.dirname(task['path'])
  if action=='apply':
   if time.time()*1000>task['expiresAt']:raise Guard('El plan venció antes del inicio')
   names=[s['name'] for s in task['changed']]
   if containers(task['project'],names)!=task['containers']:raise Guard('Los contenedores o su estado cambiaron; revisá de nuevo')
   current=model(task['path'],directory,task['project']);saved,_=read(opfd,'before.json',1048576)
   if digest(canonical(current))!=digest(saved):raise Guard('Cambió la configuración resuelta o un env file; prepará otra revisión')
   draft,_=read(opfd,'draft.yaml');resolved=model(base+'/draft.yaml',directory,task['project'])
   if digest(canonical(resolved))!=task['modelRevision']:raise Guard('Cambió la resolución del borrador; prepará otra revisión')
   space=os.statvfs(directory);task['diskFreeBefore']=str(space.f_bavail*space.f_frsize);save()
   publish(task['beforeRevision'],draft);task['canRollback']=True;task['phase']='config-published';save();configfile=base+'/after.json'
  else:
   now=containers(task['project'],task['active'])
   if task.get('retire'):
    if any(now.get(n) and now[n]['id']!=task['containers'][n]['id'] for n in task['active']):raise Guard('El servicio retirado reapareció con otra identidad; no se toca')
   elif any(not now.get(n,{}).get('running') for n in task['active']):raise Guard('Un servicio fue apagado después de aplicar; no se lo reinicia automáticamente')
   if not task.get('canRollback'):raise Guard('No hay una configuración publicada para recuperar')
   original,_=read(opfd,'original.yaml');publish(task['afterRevision'],original);task['phase']='config-restored';save();configfile=base+'/rollback.json'
  # No build, no pull, no orphan removal, no volumes removed, no stopped service started.
  if action=='apply' and task.get('retire'):
   cid=task['containers'][task['retire']]['id'];task['phase']='retiring-selected-container';save()
   run(['update','--restart=no',cid])
   if task['retire'] in task['active']:run(['stop','--time','20',cid],timeout=30)
   run(['rm',cid]);task['phase']='selected-container-removed';save()
   if containers(task['project'],[task['retire']]):raise Guard('El servicio reapareció; revisá su controlador')
  elif task['active']:
   run(['compose','--project-directory',directory,'-p',task['project'],'-f',configfile,'up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','60']+task['active'],timeout=75)
   now=containers(task['project'],task['active'])
   if any(not now.get(n,{}).get('running') for n in task['active']):raise Guard('No se pudo comprobar salud; recuperación disponible')
  space=os.statvfs(directory);task['diskFreeAfter']=str(space.f_bavail*space.f_frsize)
  task['state']='restored' if action=='rollback' else 'verified';task['message']=('Retirada verificada: datos y volúmenes pendientes, conservados para recuperación. ' if action=='apply' and task.get('retire') else '')+'Configuración y servicios seleccionados verificados. Los servicios apagados siguen apagados. Los datos y migraciones de las apps no se revierten.';task['canRollback']=action!='rollback';save()
 except:
  task['state']='interrupted';task['message']='La operación requiere revisión. Consultá el estado real; el checkpoint conserva la configuración y las imágenes anteriores. No se borraron volúmenes.'
  try:save()
  except:pass
 finally:os.close(lockfd)
try:
 home=req['home'];root=home+'/.local/share/axon/compose-releases'
 # Only owned private storage; no symlink ancestor can redirect writes.
 fd=anchor(home)
 for part in ('.local','share','axon','compose-releases'):
  try:os.mkdir(part,0o700,dir_fd=fd)
  except FileExistsError:pass
  nxt=os.open(part,D,dir_fd=fd);os.close(fd);fd=nxt
 rootfd=fd
 s=os.fstat(rootfd)
 if s.st_uid!=os.getuid() or s.st_mode&0o077:raise Guard('Checkpoint sin permisos privados')
 if not __import__('re').fullmatch('[0-9a-f-]{36}',req['id']):raise Guard('Operación inválida')
 if req['action']=='prepare':
  if len(os.listdir(rootfd))>=20:raise Guard('Límite de 20 checkpoints: exportá y revisá los anteriores antes de crear más')
  os.mkdir(req['id'],0o700,dir_fd=rootfd);opfd=os.open(req['id'],D,dir_fd=rootfd);task=prepare(home,rootfd);save()
 else:
  opfd=os.open(req['id'],D,dir_fd=rootfd);data,_=read(opfd,'state.json',1048576);task=json.loads(data)
  if req['action'] in ('apply','rollback'):
   marker='launched-'+req['action']
   try:
    write(opfd,marker,b'1');pid=os.fork()
    if pid==0:
     os.setsid();signal.signal(signal.SIGHUP,signal.SIG_IGN);null=os.open('/dev/null',os.O_RDWR)
     for stream in (0,1,2):os.dup2(null,stream)
     worker(req['action']);os._exit(0)
   except FileExistsError:pass
  elif req['action']=='status' and task['state']=='running' and incarnation(int(task['owner'].split(':')[1]))!=task['owner']:
   task['state']='interrupted';task['message']='El worker se interrumpió; el checkpoint sigue disponible para comprobar y recuperar';save()
 if req['action']=='status' and task['state']=='planned' and 'launched-apply' in os.listdir(opfd) and time.time()-os.stat('launched-apply',dir_fd=opfd).st_mtime>10:
  task['state']='interrupted';task['message']='El inicio se interrumpió antes de publicar un recibo; no se reejecuta automáticamente';save()
 print(json.dumps({'ok':True,**public()}))
except Guard as e:print(json.dumps({'ok':False,'error':str(e)}))
except:print(json.dumps({'ok':False,'error':'No se pudo preparar o leer el checkpoint. No se confirmó ningún efecto.'}))
