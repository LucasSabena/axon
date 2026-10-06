"""Read-only physical installation metadata. Never read auth/config/environment files."""
import os,sys,json,subprocess,shutil,hashlib,stat,re,pwd
req=json.loads(sys.stdin.read(300001));home=pwd.getpwuid(os.getuid()).pw_dir;rows=[];warnings=[]
search=os.pathsep.join([home+'/.local/share/pnpm/bin',home+'/.local/share/pnpm',home+'/.bun/bin',home+'/.local/bin',home+'/.cargo/bin','/usr/local/bin','/usr/bin','/bin'])
def query(args):
 try:
  p=subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5)
  if p.returncode or len(p.stdout)>1048576:return None
  return p.stdout.decode(errors='replace')
 except:return None
def add(name,backend,scope,version,executable=None,refs=[],location=None):
 identity='|'.join([backend,scope,name,location or executable or ''])
 rows.append({'id':hashlib.sha256(identity.encode()).hexdigest()[:24],'name':name,'backend':backend,'scope':scope,'version':version,'executablePath':executable,'coverage':'Axon usa su ejecutable' if refs else 'Inventario nativo; reemplazo no validado','references':refs,'blockers':['Desinstalación requiere simulación de dependencias y selección exacta; este inventario no autoriza retirar datos.']})
for p in req.get('programs',[])[:80]:
 cmd=p.get('command');refs=p.get('references') or ['programs:'+p.get('id','')]
 if not isinstance(cmd,str) or not re.fullmatch('[a-zA-Z0-9_.+-]+',cmd):continue
 exe=shutil.which(cmd,path=search)
 if not exe:continue
 physical=os.path.realpath(exe);owner=query(['dpkg-query','-S',physical]);package=None
 if owner:package=owner.split(': ',1)[0].split('\n')[0]
 backend=p.get('backend','manual');version=p.get('version')
 if package and re.fullmatch('[a-zA-Z0-9.+:-]+',package):
  backend='apt';version=(query(['dpkg-query','-W','-f=${Version}',package]) or '').strip() or version
 add(package or p.get('name',cmd),backend,'system' if backend in ('apt','snap') else 'user',version,physical,refs)
# Both installation scopes are explicit, not inferred from a desktop shortcut.
flatpak=shutil.which('flatpak',path=search)
if flatpak:
 for scope in ('system','user'):
  result=query([flatpak,'list','--'+scope,'--app','--columns=application,version,branch'])
  if result is None:warnings.append('Flatpak '+scope+': no se pudo leer');continue
  for line in result.strip().split('\n')[:200]:
   parts=line.split('\t')
   if len(parts)>=3 and re.fullmatch('[A-Za-z0-9_.-]+',parts[0]):
    refs=['store:'+c['id'] for c in req.get('catalog',[]) if c.get('package')==parts[0]] if scope=='system' else []
    add(parts[0],'flatpak',scope,parts[1] or None,refs=refs,location=parts[2])
else:warnings.append('Flatpak no está disponible')
# AppImages are never executed to discover a version.
for folder in (home+'/Applications',home+'/.local/bin'):
 try:
  for name in os.listdir(folder)[:500]:
   if not name.endswith('.AppImage'):continue
   p=os.path.join(folder,name);s=os.lstat(p)
   if stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid():add(name,'appimage','user',None,p)
 except FileNotFoundError:pass
 except:warnings.append('AppImage: lectura incompleta')
# Deduplicate a physical package shared by multiple catalog entries.
merged={}
for row in rows:
 if row['id'] in merged:merged[row['id']]['references']+=row['references']
 else:merged[row['id']]=row
print(json.dumps({'installations':list(merged.values()),'warnings':warnings,'complete':not any('incompleta' in w or 'no se pudo' in w for w in warnings)}))
