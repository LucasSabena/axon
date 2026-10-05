import os,sys,json,pwd,shutil,subprocess,re,sqlite3
home=pwd.getpwuid(os.getuid()).pw_dir
search=os.pathsep.join([home+'/.local/share/pnpm/bin',home+'/.local/share/pnpm',home+'/.bun/bin',home+'/.local/bin',home+'/.cargo/bin','/usr/local/bin','/usr/bin','/bin'])
rows=[]
raw=sys.stdin.read(300001);request=json.loads(raw) if raw else {}
def query(argv):
 try:
  p=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5,env={'PATH':search,'HOME':home,'LC_ALL':'C','PNPM_HOME':home+'/.local/share/pnpm'})
  if p.returncode or len(p.stdout)>262144:return None
  return p.stdout.decode(errors='replace').strip()
 except:return None
if request.get('only')=='pnpm':
 exe=shutil.which('pnpm',path=search);store=query([exe,'store','path','--silent']) if exe else None
 print(json.dumps({'storePath':store if store and store.startswith(home+'/') and '\n' not in store else None}));sys.exit(0)
for name,args in [('pnpm',['--version']),('uv',['--version']),('pip',['--version']),('restic',['version']),('opencode',['--version']),('journalctl',['--version'])]:
 exe=shutil.which(name,path=search);version=query([exe]+args) if exe else None
 item={'name':name,'available':bool(version),'version':(version.split('\n')[0][:120] if version else None),'canClean':False,'reason':'Sólo inventario; no se ejecutan comandos de limpieza aproximados'}
 if name=='pnpm' and exe:
  store=query([exe,'store','path','--silent'])
  if store and store.startswith(home+'/') and '\n' not in store:item['storePath']=store
  item['reason']='Sin dry-run exacto. Se protegen globals y procesos de store/links; no se poda desde este inventario.'
 if name=='restic':item['reason']='Restic necesita un repositorio configurado y acceso autorizado. Sus archivos internos no son candidatos sueltos.'
 if name=='journalctl':item['reason']='La retención elimina historial de logs. Necesita una política explícita y un adapter privilegiado.'
 if name=='uv':item['reason']='Sólo su gestor nativo puede modificar la caché; no se borra directamente.'
 rows.append(item)
# Schema detection only: no messages, titles, contents or user-supplied SQL.
db=home+'/.local/share/opencode/opencode.db';agent={'available':False,'canDelete':False,'canCompact':False}
try:
 if os.path.islink(db):raise ValueError()
 c=sqlite3.connect('file:'+db+'?mode=ro',uri=True,timeout=1);c.execute('PRAGMA query_only=ON');c.set_progress_handler(lambda:1 if __import__('time').monotonic()-start>2 else 0,10000);start=__import__('time').monotonic()
 tables={r[0] for r in c.execute("SELECT name FROM sqlite_schema WHERE type='table'")};recognized=[t for t in ('session_v2','session') if t in tables]
 counts={}
 for table in recognized:
  columns={r[1] for r in c.execute('PRAGMA table_info('+table+')')}
  if {'id','time_updated'}.issubset(columns):counts[table]=c.execute('SELECT count(*) FROM '+table).fetchone()[0]
 agent={'available':True,'tables':recognized,'representations':counts,'uniqueConversations':None,'canDelete':False,'canCompact':False,'reason':'No se suman tablas migradas. El contrato de borrado/descendientes y recuperación no está certificado para esta versión; no se ejecuta SQL de mantenimiento.'};c.close()
except:agent['reason']='Base ausente, ocupada o esquema no certificado; no se afirma tamaño cero ni se modifica.'
print(json.dumps({'tools':rows,'agentHistory':agent}))
