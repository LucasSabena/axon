import type {Hono} from 'hono';
import {hostExec} from './host';
import {runJob,listJobs} from './jobs';
import {SnapshotCache} from './snapshot-cache';
import type {JobStep} from './jobs';

export function removalSimulation(output:string){
 const removed=[...output.matchAll(/^Remv ([A-Za-z0-9][A-Za-z0-9+.:_-]*)(?: |$)/gm)].map(m=>m[1]);
 const installed=[...output.matchAll(/^Inst ([A-Za-z0-9][A-Za-z0-9+.:_-]*)(?: |$)/gm)].map(m=>m[1]);
 return {removed:[...new Set(removed)],installed:[...new Set(installed)]};
}

export interface StoreApp {id:string;name:string;description:string;category:string;backend:'flatpak'|'apt'|'external';package:string;url:string;bin?:string}
const fp=(id:string,name:string,description:string,category:string,pkg:string,url:string,bin?:string):StoreApp=>({id,name,description,category,backend:'flatpak',package:pkg,url,bin});
const apt=(id:string,name:string,description:string,category:string,pkg:string,bin=pkg):StoreApp=>({id,name,description,category,backend:'apt',package:pkg,url:'https://packages.ubuntu.com/search?keywords='+pkg,bin});
export const STORE_APPS:StoreApp[]=[
 fp('blender','Blender','Modelado, animación, composición y render 3D.','3D y juegos','org.blender.Blender','https://www.blender.org/','blender'),
 fp('godot','Godot','Motor de juegos 2D y 3D con editor visual.','3D y juegos','org.godotengine.Godot','https://godotengine.org/','godot'),
 {id:'davinci',name:'DaVinci Resolve',description:'Edición de video, color, efectos y audio. Requiere descargar el instalador Linux del fabricante y revisar sus requisitos de GPU.',category:'Video y audio',backend:'external',package:'',url:'https://www.blackmagicdesign.com/products/davinciresolve',bin:'resolve'},
 fp('kdenlive','Kdenlive','Edición de video multipista.','Video y audio','org.kde.kdenlive','https://kdenlive.org/','kdenlive'),
 fp('obs','OBS Studio','Grabación de pantalla y transmisiones.','Video y audio','com.obsproject.Studio','https://obsproject.com/','obs'),
 fp('shotcut','Shotcut','Editor de video con filtros y múltiples formatos.','Video y audio','org.shotcut.Shotcut','https://shotcut.org/','shotcut'),
 fp('audacity','Audacity','Grabación y edición de audio.','Video y audio','org.audacityteam.Audacity','https://www.audacityteam.org/','audacity'),
 fp('handbrake','HandBrake','Conversión y compresión de videos.','Video y audio','fr.handbrake.ghb','https://handbrake.fr/','ghb'),
 fp('gimp','GIMP','Retoque fotográfico y edición de imágenes.','Diseño','org.gimp.GIMP','https://www.gimp.org/','gimp'),
 fp('inkscape','Inkscape','Ilustración y diseño vectorial.','Diseño','org.inkscape.Inkscape','https://inkscape.org/','inkscape'),
 fp('krita','Krita','Ilustración, pintura y animación 2D.','Diseño','org.kde.krita','https://krita.org/','krita'),
 fp('freecad','FreeCAD','Diseño CAD paramétrico.','3D y juegos','org.freecad.FreeCAD','https://www.freecad.org/','FreeCAD'),
 fp('lmms','LMMS','Producción musical e instrumentos virtuales.','Video y audio','io.lmms.LMMS','https://lmms.io/','lmms'),
 fp('vscode','Visual Studio Code','Editor de código con extensiones.','Desarrollo','com.visualstudio.code','https://code.visualstudio.com/','code'),
 fp('vscodium','VSCodium','Editor de código de la comunidad.','Desarrollo','com.vscodium.codium','https://vscodium.com/','codium'),
 fp('dbeaver','DBeaver Community','Cliente para bases de datos.','Desarrollo','io.dbeaver.DBeaverCommunity','https://dbeaver.io/','dbeaver'),
 fp('filezilla','FileZilla','Transferencias FTP y SFTP.','Utilidades','org.filezillaproject.Filezilla','https://filezilla-project.org/','filezilla'),
 fp('libreoffice','LibreOffice','Documentos, planillas y presentaciones.','Productividad','org.libreoffice.LibreOffice','https://www.libreoffice.org/','libreoffice'),
 fp('obsidian','Obsidian','Notas y conocimiento conectado.','Productividad','md.obsidian.Obsidian','https://obsidian.md/','obsidian'),
 fp('vlc','VLC','Reproductor multimedia.','Video y audio','org.videolan.VLC','https://www.videolan.org/','vlc'),
 apt('ffmpeg','FFmpeg','Conversión, procesamiento y análisis multimedia.','Utilidades','ffmpeg'),
 apt('imagemagick','ImageMagick','Procesamiento de imágenes por lotes.','Utilidades','imagemagick','convert'),
 apt('git','Git','Control de versiones.','Desarrollo','git'),
 apt('jq','jq','Procesamiento de datos JSON.','Desarrollo','jq'),
 apt('ripgrep','ripgrep','Búsqueda rápida de texto y archivos.','Desarrollo','ripgrep','rg'),
];
const quote=(s:string)=>"'"+s.replace(/'/g,"'\\''")+"'";
const cache=new SnapshotCache<any>(15_000);
const searchCache=new SnapshotCache<any>(60_000,16);
const discovered=new Map<string,StoreApp>();
const validAppId=(id:string)=>/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*){2,}$/.test(id)&&id.length<=200;
export function storeSteps(app:StoreApp,action:'install'|'update'|'remove'):JobStep[]{
 if(app.backend==='external')throw new Error('Este programa usa el instalador oficial del fabricante');
 const group='store';
 if(app.backend==='apt')return [{label:action==='remove'?'Desinstalar paquete':'Instalar paquete y dependencias',user:'root',group,cmd:action==='remove'?`DEBIAN_FRONTEND=noninteractive apt-get remove -y -- ${quote(app.package)}`:`DEBIAN_FRONTEND=noninteractive apt-get install -y -- ${quote(app.package)}`}];
 const command=action==='install'?`flatpak install --system --noninteractive -y flathub ${quote(app.package)}`:action==='update'?`flatpak update --system --noninteractive -y ${quote(app.package)}`:`flatpak uninstall --system --noninteractive -y ${quote(app.package)}`;
 return [...(action==='install'?setupSteps():[]),{label:action==='remove'?'Desinstalar aplicación conservando sus datos':action==='update'?'Actualizar aplicación':'Descargar e instalar aplicación',user:'root' as const,group,cmd:command}];
}
function setupSteps():JobStep[]{return [
 {label:'Preparar Flatpak en el servidor',user:'root',group:'store',cmd:'command -v flatpak >/dev/null || { apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y flatpak; }'},
 {label:'Configurar Flathub para todos los usuarios',user:'root',group:'store',cmd:"existing=$(flatpak remotes --system --columns=name,url | awk '$1 == \"flathub\" {print $2}'); if [ -n \"$existing\" ] && [ \"$existing\" != 'https://dl.flathub.org/repo/' ] && [ \"$existing\" != 'https://dl.flathub.org/repo' ]; then echo 'El remoto flathub existente no es el oficial. Revisá la configuración.' >&2; exit 1; fi; flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo"},
];}
async function snapshot(){return cache.get('catalog',async()=>{
 const bins=[...new Set(STORE_APPS.map(a=>a.bin).filter(Boolean))] as string[];
 const [fp,dp,commands]=await Promise.all([
  hostExec('if command -v flatpak >/dev/null; then printf "READY\\n"; flatpak list --system --app --columns=application,version; fi',{timeoutMs:8000}),
  hostExec("command -v apt-get >/dev/null && printf 'APT\\n'; dpkg-query -W -f='${binary:Package}\\t${db:Status-Status}\\t${Version}\\n'",{timeoutMs:8000}),
  hostExec(bins.map(b=>`command -v ${quote(b)} >/dev/null && printf '%s\\n' ${quote(b)}`).join('\n')+'\ntrue',{user:'user',timeoutMs:5000})
 ]);
 const flat=new Map(fp.stdout.split('\n').filter(l=>l.includes('\t')).map(l=>l.split('\t').slice(0,2) as [string,string]));
 const packages=new Map(dp.stdout.split('\n').map(l=>l.split('\t')).filter(r=>r[1]==='installed').map(r=>[r[0].split(':')[0],r[2]]));
 const detected=new Set(commands.stdout.trim().split('\n'));
 return {ok:true,flatpak:fp.stdout.startsWith('READY'),apt:dp.stdout.startsWith('APT'),checkedAt:Date.now(),installedFlatpak:Object.fromEntries(flat),apps:STORE_APPS.map(a=>{const version=a.backend==='flatpak'?flat.get(a.package):packages.get(a.package);return {...a,installed:!!version,detected:!!a.bin&&detected.has(a.bin),version:version||null};}),jobs:listJobs().filter(j=>j.title.startsWith('Tienda:')&&j.status==='running').map(j=>({id:j.id,title:j.title}))};
 });}
export function registerStoreRoutes(app:Hono){
 app.get('/api/store/:id/removal-preview',async c=>{
  c.header('Cache-Control','private, no-store');
  const entry=STORE_APPS.find(a=>a.id===c.req.param('id'))||discovered.get(c.req.param('id'));
  if(!entry)return c.json({ok:false,error:'Aplicación desconocida'},404);
  const current=await snapshot(),version=current.apps.find((a:any)=>a.id===entry.id)?.version||current.installedFlatpak[entry.package]||null;
  const {physicalInstallations}=await import('./installation-inventory');
  const matches=(await physicalInstallations([])).filter(i=>i.references.includes('store:'+entry.id)&&i.scope==='system'&&i.backend===entry.backend&&(entry.backend!=='apt'||i.name.split(':')[0]===entry.package));
  const blockers=['La desinstalación necesita un adapter durable con locks nativos y comprobación posterior. Esta revisión no ejecuta cambios.'];
  let dependencies:{complete:boolean;removed:string[];installed:string[]}={complete:false,removed:[],installed:[]};
  if(entry.backend==='apt'){
   const result=await hostExec(`LC_ALL=C apt-get --simulate remove -- ${quote(entry.package)}`,{user:'user',timeoutMs:15000});
   if(result.ok){dependencies={complete:true,...removalSimulation(result.stdout)};}else blockers.push('La simulación APT no pudo completarse; dependencias desconocidas.');
   if(['ffmpeg','imagemagick','git','jq','ripgrep'].includes(entry.package))blockers.push('Axon o sus herramientas pueden usar este ejecutable. Resolver sus dependientes antes de retirarlo.');
  }else blockers.push('No hay simulación fiable de dependencias para este backend; no se sustituye por un comando aproximado.');
  if(!version)blockers.push('La Tienda no identificó una instalación system de este paquete. No se selecciona otra instalación por nombre.');
  if(matches.length!==1)blockers.push('La instalación física no se resolvió de forma inequívoca; ID desconocido.');
  return c.json({ok:true,preview:{installationId:matches.length===1?matches[0].id:null,name:entry.name,backend:entry.backend,scope:'system',package:entry.package,version,dependencies,retained:['Datos y perfiles personales','Configuración del usuario','Cachés: requieren otra acción'],canExecute:false,blockers}});
 });
 app.get('/api/store',async c=>{if(c.req.query('refresh')==='1')cache.clear();return c.json(await snapshot());});
 app.get('/api/store/search',async c=>{
  const q=(c.req.query('q')||'').trim();if(q.length<2||q.length>100)return c.json({ok:false,error:'Buscá entre 2 y 100 caracteres'},400);
  const current=await snapshot();if(!current.flatpak)return c.json({ok:false,error:'Prepará Flathub para buscar en su catálogo completo'},409);
  return c.json(await searchCache.get(q,async()=>{
   const result=await hostExec(`flatpak search --system --columns=application,name,description,version,remotes -- ${quote(q)}`,{timeoutMs:30_000});
   if(!result.ok)throw new Error('No se pudo consultar Flathub. Reintentá en unos minutos.');
   const apps=result.stdout.split('\n').map(l=>l.split('\t')).filter(r=>validAppId(r[0])&&r[4]?.split(',').map(s=>s.trim()).includes('flathub')).slice(0,100).map(r=>{
    const a:StoreApp={id:r[0],name:r[1]||r[0],description:r[2]||'Aplicación de Flathub',category:'Flathub',backend:'flatpak',package:r[0],url:'https://flathub.org/en/apps/'+encodeURIComponent(r[0])};
    if(discovered.size>=500)discovered.delete(discovered.keys().next().value!);discovered.set(a.id,a);
    return {...a,installed:!!current.installedFlatpak[a.package],version:current.installedFlatpak[a.package]||null};
   });return {ok:true,apps};
  }).catch(e=>({ok:false,error:e.message})));
 });
 app.post('/api/store/setup',c=>{const pending=listJobs().find(j=>j.status==='running'&&j.title.startsWith('Tienda:'));if(pending)return c.json({ok:false,error:'Hay otra operación de la tienda en curso',jobId:pending.id},409);cache.clear();return c.json({ok:true,jobId:runJob('Tienda: preparar Flathub',setupSteps()).id});});
 app.post('/api/store/:id/:action',async c=>{
  const entry=STORE_APPS.find(a=>a.id===c.req.param('id')) || discovered.get(c.req.param('id'));const action=c.req.param('action');
  if(!entry||!['install','update','remove'].includes(action))return c.json({ok:false,error:'Aplicación o acción desconocida'},400);
  if(action==='remove')return c.json({ok:false,error:'Revisá la instalación y dependencias antes de desinstalar. El executor durable de este gestor todavía no está habilitado; no se ejecutó ningún cambio.',preview:'/api/store/'+encodeURIComponent(entry.id)+'/removal-preview'},409);
  if(entry.backend==='external')return c.json({ok:false,error:'Usá la descarga oficial del fabricante'},400);
  if(listJobs().some(j=>j.status==='running'&&j.title.startsWith('Tienda:')))return c.json({ok:false,error:'Hay otra operación de la tienda en curso'},409);
  // Preflight is read-only. Recheck the job lock after its await.
  const current=await snapshot();
  if(!current.apt && (entry.backend==='apt'||!current.flatpak))return c.json({ok:false,error:'Este host necesita apt para preparar esta instalación'},409);
  const installed=current.apps.find((a:any)=>a.id===entry.id)?.installed || !!current.installedFlatpak[entry.package];
  if(action!=='install'&&!installed)return c.json({ok:false,error:'La tienda no administra esta aplicación instalada'},409);
  if(listJobs().some(j=>j.status==='running'&&j.title.startsWith('Tienda:')))return c.json({ok:false,error:'Hay otra operación de la tienda en curso'},409);
  cache.clear();const job=runJob(`Tienda: ${action==='install'?'instalar':action==='update'?'actualizar':'desinstalar'} ${entry.name}`,storeSteps(entry,action as any));
  return c.json({ok:true,jobId:job.id});
 });
}
