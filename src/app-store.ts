import type {Hono} from 'hono';
import * as path from 'node:path';
import {stat} from 'node:fs/promises';
import {hostExec,hostToContainer} from './host';
import {resolveHostPath} from './host-storage';
import {listJobs} from './jobs';
import {software,softwareCommand,runSoftwareJob,nativeSoftwareRunner,softwareIcon} from './software';
import {HOST_USER} from './host';
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

// ---------- Instaladores subidos por el usuario ----------
// Un archivo subido a la carpeta de staging se detecta por extensión (o por
// `file` cuando la extensión no alcanza) y se convierte en un job con los
// pasos nativos de cada formato. El paso final elimina el instalador; como
// comparte el grupo 'store', una falla lo saltea y conserva el archivo para
// reintentar en modo forzado.
export type InstallerKind='deb'|'flatpak'|'appimage'|'archive'|'rpm'|'snap'|'run';
const INSTALLER_EXT=/\.(appimage|flatpakref|flatpak|deb|rpm|snap|run|sh|bin|zip|tgz|txz|tbz2|tar\.gz|tar\.xz|tar\.bz2|tar\.zst|tar)$/i;
const ARCHIVE_EXT=/\.(zip|tar|tgz|txz|tbz2|tar\.gz|tar\.xz|tar\.bz2|tar\.zst)$/i;
const FOREIGN_EXT=/\.(exe|msi|msix|appx|dmg|pkg|apk|ipa)$/i;
export function detectInstaller(name:string,fileDesc=''):{kind:InstallerKind|null;error?:string}{
 const n=name.toLowerCase();
 if(FOREIGN_EXT.test(n))return{kind:null,error:'Este instalador es para otro sistema (Windows, macOS o Android)'};
 if(/\.deb$/.test(n))return{kind:'deb'};
 if(/\.(flatpak|flatpakref)$/.test(n))return{kind:'flatpak'};
 if(/\.appimage$/.test(n))return{kind:'appimage'};
 if(/\.snap$/.test(n))return{kind:'snap'};
 if(/\.rpm$/.test(n))return{kind:'rpm'};
 if(ARCHIVE_EXT.test(n))return{kind:'archive'};
 if(/\.(run|sh|bin)$/.test(n))return{kind:'run'};
 const d=fileDesc.toLowerCase();
 if(!d)return{kind:null};
 if(/debian binary package/.test(d))return{kind:'deb'};
 if(/flatpak/.test(d))return{kind:'flatpak'};
 if(/\brpm\b/.test(d))return{kind:'rpm'};
 if(/squashfs/.test(d))return{kind:'appimage'};
 if(/elf \d+-bit/.test(d)||/(shell|bash|python|perl) script|script text executable|a .* script text executable|commands text/.test(d))return{kind:'run'};
 if(/zip archive|tar archive|posix tar|gzip compressed|xz compressed|bzip2 compressed|zstd compressed/.test(d))return{kind:'archive'};
 return{kind:null,error:'No reconozco el tipo de instalador. Soportados: .deb, .AppImage, .flatpak, .run, .sh, .rpm, .snap, .zip, .tar.gz…'};
}
export function installerSlug(file:string):string{
 const s=file.replace(INSTALLER_EXT,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
 return s||'programa';
}
const installerName=(file:string)=>file.replace(INSTALLER_EXT,'').replace(/[-_.]+/g,' ').trim()||'Programa';
const KIND_LABEL:Record<InstallerKind,string>={deb:'Paquete Debian (.deb)',flatpak:'Flatpak (.flatpak / .flatpakref)',appimage:'AppImage',archive:'Archivo comprimido con el programa',rpm:'Paquete RPM (se convierte con alien)',snap:'Paquete snap local',run:'Instalador ejecutable'};
const KIND_WARN:Partial<Record<InstallerKind,string>>={
 run:'Los instaladores ejecutables pueden pedir confirmaciones (licencia, opciones). Si se interrumpe vas a poder revisar el log y reintentar respondiendo "sí" a todo.',
 rpm:'RPM no es nativo de este sistema: se convierte con alien (best-effort).',
 snap:'Se instala sin firma (--dangerous) y puede pedir --classic si la primera pasada falla.',
 archive:'El ejecutable principal se detecta por heurística; verificá el resultado en el log.',
 appimage:'Se copia a /opt/appimages con un acceso en el menú de aplicaciones.',
};
function appImageInstallScript(src:string,slug:string,name:string):string{
 const dest=`/opt/appimages/${slug}.AppImage`;
 return ['set -e',
  `install -D -m0755 -- ${quote(src)} ${quote(dest)}`,
  `tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT`,
  `(cd "$tmp" && timeout 60 ${quote(dest)} --appimage-extract >/dev/null 2>&1) || true`,
  `desk=$(find "$tmp" -type f -name '*.desktop' | head -n1)`,
  `icn=$(find "$tmp" -type f \\( -name '.DirIcon' -o -name '*.png' -o -name '*.svg' \\) -printf '%s %p\\n' 2>/dev/null | sort -rn | head -n1 | cut -d' ' -f2-)`,
  `if [ -n "$icn" ]; then case "$icn" in *.svg) ext=svg;; *) ext=png;; esac; cp "$icn" ${quote('/usr/share/pixmaps/'+slug+'.')}"$ext"; fi`,
  `if [ -n "$desk" ]; then sed -e 's|^Exec=.*|Exec=${dest}|' -e 's|^Icon=.*|Icon=${slug}|' "$desk" > ${quote('/usr/share/applications/'+slug+'.desktop')}; else printf '[Desktop Entry]\\nType=Application\\nName=%s\\nExec=%s\\nIcon=%s\\nCategories=Utility;\\n' ${quote(name)} ${quote(dest)} ${quote(slug)} > ${quote('/usr/share/applications/'+slug+'.desktop')}; fi`,
  `command -v update-desktop-database >/dev/null && update-desktop-database /usr/share/applications >/dev/null 2>&1 || true`,
 ].join('\n');
}
function archiveInstallScript(src:string,slug:string,name:string):string{
 return ['set -e',
  `dest=${quote('/opt/'+slug)}`,
  `rm -rf "$dest"; mkdir -p "$dest"`,
  `case ${quote(src)} in *.zip) unzip -q ${quote(src)} -d "$dest";; *) tar -xf ${quote(src)} -C "$dest";; esac`,
  `bin=$(find "$dest" -type f -perm -u+x ! -name '*.so*' -printf '%s\\t%f\\t%p\\n' 2>/dev/null | awk -F'\\t' -v s=${quote(slug)} '{n=tolower($2);s2=$1;if(n==s||index(n,s)==1)s2+=1e15;if(s2>b){b=s2;p=$3}}END{print p}')`,
  `if [ -z "$bin" ]; then echo 'No encontré un ejecutable dentro del archivo' >&2; exit 1; fi`,
  `chmod +x "$bin" 2>/dev/null || true; ln -sf "$bin" ${quote('/usr/local/bin/'+slug)}`,
  `printf '[Desktop Entry]\\nType=Application\\nName=%s\\nExec=\\"%s\\"\\nIcon=application-x-executable\\nCategories=Utility;\\n' ${quote(name)} "$bin" > ${quote('/usr/share/applications/'+slug+'.desktop')}`,
  `echo "Ejecutable detectado: $bin — acceso '${slug}'"`,
 ].join('\n');
}
export function installerSteps(hostPath:string,kind:InstallerKind,opts:{force?:boolean}={}):JobStep[]{
 const dir=path.posix.dirname(hostPath),base=path.posix.basename(hostPath);
 const slug=installerSlug(base),name=installerName(base);
 const steps:JobStep[]=[];
 const push=(label:string,cmd:string)=>{steps.push({label,user:'root' as const,group:'store',cmd});};
 const aptEnsure=(bin:string,pkg:string,label:string)=>push(label,`command -v ${bin} >/dev/null || { apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg}; }`);
 switch(kind){
  case 'deb':push('Instalar el paquete y resolver dependencias',`DEBIAN_FRONTEND=noninteractive apt-get install -y -- ${quote(hostPath)}`);break;
  case 'flatpak':steps.push(...setupSteps());push('Instalar la aplicación desde el archivo',`flatpak install --system --noninteractive -y -- ${quote(hostPath)}`);break;
  case 'appimage':push('Instalar en /opt/appimages y crear el acceso',appImageInstallScript(hostPath,slug,name));break;
  case 'archive':
   if(/\.zip$/i.test(base))aptEnsure('unzip','unzip','Preparar unzip para extraer el archivo');
   if(/\.zst$/i.test(base))aptEnsure('zstd','zstd','Preparar zstd para extraer el archivo');
   push(`Extraer en /opt/${slug} y crear el acceso`,archiveInstallScript(hostPath,slug,name));break;
  case 'rpm':aptEnsure('alien','alien','Preparar el conversor de paquetes RPM');push('Convertir e instalar el paquete',`alien --install --scripts ${quote(hostPath)}`);break;
  case 'snap':aptEnsure('snap','snapd','Preparar snapd');push('Instalar el paquete snap local',`snap install --dangerous ${quote(hostPath)} || snap install --dangerous --classic ${quote(hostPath)}`);break;
  case 'run':
   push('Hacer ejecutable el instalador',`chmod +x -- ${quote(hostPath)}`);
   push(opts.force?'Ejecutar el instalador respondiendo sí a las confirmaciones':'Ejecutar el instalador',
    `cd ${quote(dir)} && ${opts.force?'yes | ':''}timeout 3600 ${/\.sh$/i.test(base)?'bash ':''}./${quote(base)}${opts.force?'':' < /dev/null'}`);break;
 }
 push('Eliminar el instalador',`rm -f -- ${quote(hostPath)}`);
 return steps;
}
async function resolveInstaller(input:unknown):Promise<{hostPath?:string;size?:number;error?:string;status?:number}>{
 const raw=typeof input==='string'?input.trim():'';
 if(!raw)return{error:'Indicá la ruta del instalador',status:400};
 let hostPath:string;
 try{hostPath=await resolveHostPath(raw);}catch(e){return{error:e instanceof Error?e.message:'Ruta no permitida',status:403};}
 const st=await stat(hostToContainer(hostPath)).catch(()=>null);
 if(!st?.isFile())return{error:'El archivo no existe en el servidor',status:404};
 return{hostPath,size:st.size};
}
async function detectFor(hostPath:string):Promise<{kind:InstallerKind|null;error?:string}>{
 const base=path.posix.basename(hostPath);
 let det=detectInstaller(base);
 if(!det.kind&&!det.error){
  const f=await hostExec(`file -b -- ${quote(hostPath)}`,{user:'user',timeoutMs:10_000});
  det=detectInstaller(base,f.stdout);
 }
 if(!det.kind&&!det.error)det={kind:null,error:'No reconozco el tipo de instalador. Soportados: .deb, .AppImage, .flatpak, .run, .sh, .rpm, .snap, .zip, .tar.gz…'};
 return det;
}
export function invalidateStoreCache(){cache.clear();searchCache.clear();}
async function storeJob(title:string,steps:JobStep[],expected?:{manager:string;packageName:string}) {
 const cmd=await softwareCommand({action:'recipe',user:HOST_USER,steps:steps.map(s=>({label:s.label,cmd:s.cmd})),expected});
 cache.clear();return runSoftwareJob(title,[{label:steps.map(s=>s.label).join(' → '),cmd,displayCommand:'Instalador del catálogo · locks nativos · comprobación posterior',user:'root',group:'software:store'}]);
}
async function snapshot(){
 const native=await software.get();
 const installedFlatpak=Object.fromEntries(native.installations.filter(p=>p.manager==='flatpak'&&p.kind==='application').map(p=>[p.applicationId,p.version||'Instalada']));
 const apps=STORE_APPS.map(a=>{
  const installations=native.installations.filter(p=>p.manager===a.backend&&(p.packageName.split(':')[0]===a.package||p.applicationId===a.package));
  const detected=native.installations.some(p=>a.bin&&(p.executables.includes(a.bin)||p.executablePath?.split('/').pop()===a.bin));
  return {...a,installed:installations.length>0,detected,version:installations[0]?.version||null,iconUrl:installations[0]?.iconUrl,installations:installations.map(p=>({id:p.id,user:p.user,scope:p.scope,manager:p.manager,version:p.version,canUpdate:p.canUpdate}))};
 });
 return {ok:true,canAdministerSystem:native.canAdministerSystem,flatpak:native.sources.some(s=>s.manager==='flatpak'&&s.scope==='system'&&s.available),apt:native.sources.some(s=>s.manager==='apt'&&s.available),checkedAt:native.checkedAt,installedFlatpak,apps,installedApplications:native.installations.filter(p=>['application','tool'].includes(p.kind)),sources:native.sources,checking:native.checking,error:native.error,jobs:listJobs().filter(j=>j.status==='running'&&(j.title.startsWith('Tienda:')||j.steps.some(s=>s.group?.startsWith('software:')))).map(j=>({id:j.id,title:j.title}))};
}
const catalogIconCache=new Map<string,{at:number;file:string|null}>();
export function registerStoreRoutes(app:Hono){
 app.get('/api/store/icons/:id',async c=>{
  const entry=STORE_APPS.find(a=>a.id===c.req.param('id'))||discovered.get(c.req.param('id'));
  if(!entry)return c.json({ok:false,error:'Aplicación desconocida'},404);
  let file=(await stat(path.resolve('public/store-icons',entry.id+'.png')).catch(()=>null))?.isFile()?path.resolve('public/store-icons',entry.id+'.png'):null;
  const localFile=file;
  if(!file&&entry.backend==='flatpak'){
   let cached=catalogIconCache.get(entry.package);
   if(!cached||Date.now()-cached.at>3600000){const value=await nativeSoftwareRunner({action:'icon',applicationId:entry.package,user:HOST_USER}).catch(()=>({iconFile:null}));cached={at:Date.now(),file:value.iconFile||null};catalogIconCache.set(entry.package,cached);if(catalogIconCache.size>500)catalogIconCache.delete(catalogIconCache.keys().next().value!);}
   file=cached.file;
  }
  return softwareIcon({name:entry.name,packageName:entry.package,iconFile:localFile?undefined:file||undefined} as any,localFile||undefined);
 });
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
 app.get('/api/store',async c=>{if(c.req.query('refresh')==='1'){cache.clear();await software.get(true);}return c.json(await snapshot());});
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
 app.post('/api/store/setup',async c=>{try{const current=await snapshot();if(!current.canAdministerSystem)return c.json({ok:false,error:'La instalación de sistema requiere permisos de administración del host'},409);if(!current.apt&&!current.flatpak)return c.json({ok:false,error:'Instalá Flatpak con el gestor de este host antes de preparar Flathub'},409);return c.json({ok:true,jobId:(await storeJob('Tienda: preparar Flathub',setupSteps())).id});}catch(e){return c.json({ok:false,error:(e as Error).message},409);}});
 app.post('/api/store/installer/inspect',async c=>{
  const b=await c.req.json<{path?:string}>().catch(()=>null);
  const r=await resolveInstaller(b?.path);
  if(!r.hostPath)return c.json({ok:false,error:r.error},r.status as never);
  const det=await detectFor(r.hostPath);
  if(!det.kind)return c.json({ok:false,error:det.error||'Tipo no reconocido'},422);
  const base=path.posix.basename(r.hostPath);
  const steps=installerSteps(r.hostPath,det.kind);
  return c.json({ok:true,plan:{kind:det.kind,kindLabel:KIND_LABEL[det.kind],name:installerName(base),file:base,path:r.hostPath,size:r.size,slug:installerSlug(base),canForce:det.kind==='run',steps:steps.map(s=>s.label),warning:KIND_WARN[det.kind]||null}});
 });
 app.post('/api/store/installer/install',async c=>{
  const b=await c.req.json<{path?:string;force?:boolean}>().catch(()=>null);
  const r=await resolveInstaller(b?.path);
  if(!r.hostPath)return c.json({ok:false,error:r.error},r.status as never);
  const det=await detectFor(r.hostPath);
  if(!det.kind)return c.json({ok:false,error:det.error||'Tipo no reconocido'},422);
  if(!(await software.get()).canAdministerSystem)return c.json({ok:false,error:'Este instalador requiere administrar el host'},409);
  const force=det.kind==='run'&&!!b?.force;
  if(listJobs().some(j=>j.status==='running'&&j.title.startsWith('Tienda:')))return c.json({ok:false,error:'Hay otra operación de la tienda en curso'},409);
  let job;try{job=await storeJob(`Tienda: instalar ${installerName(path.posix.basename(r.hostPath))}`,installerSteps(r.hostPath,det.kind,{force}));}catch(e){return c.json({ok:false,error:(e as Error).message},409);}
  return c.json({ok:true,jobId:job.id,kind:det.kind,force});
 });
 app.post('/api/store/:id/:action',async c=>{
  const entry=STORE_APPS.find(a=>a.id===c.req.param('id')) || discovered.get(c.req.param('id'));const action=c.req.param('action');
  if(!entry||!['install','update','remove'].includes(action))return c.json({ok:false,error:'Aplicación o acción desconocida'},400);
  if(action==='remove')return c.json({ok:false,error:'Revisá la instalación y dependencias antes de desinstalar. El executor durable de este gestor todavía no está habilitado; no se ejecutó ningún cambio.',preview:'/api/store/'+encodeURIComponent(entry.id)+'/removal-preview'},409);
  if(entry.backend==='external')return c.json({ok:false,error:'Usá la descarga oficial del fabricante'},400);
  if(listJobs().some(j=>j.status==='running'&&j.title.startsWith('Tienda:')))return c.json({ok:false,error:'Hay otra operación de la tienda en curso'},409);
  // Preflight is read-only. Recheck the job lock after its await.
  const current=await snapshot();
  if(action==='install'&&!current.canAdministerSystem)return c.json({ok:false,error:'La instalación de sistema requiere permisos de administración del host'},409);
  if(!current.apt && (entry.backend==='apt'||!current.flatpak))return c.json({ok:false,error:'Este host necesita apt para preparar esta instalación'},409);
  const installed=current.apps.find((a:any)=>a.id===entry.id)?.installed || !!current.installedFlatpak[entry.package];
  if(action==='update'){
   const candidates=(await software.settled()).installations.filter(p=>p.manager===entry.backend&&(p.packageName.split(':')[0]===entry.package||p.applicationId===entry.package));
   const body=await c.req.json().catch(()=>({}));if(body.review!==true)return c.json({ok:false,error:'Recargá AXON para revisar esta actualización'},409);const selected=body.installationId?candidates.filter(p=>p.id===body.installationId):candidates;
   if(selected.length!==1)return c.json({ok:false,error:'Elegí una instalación concreta desde Programas'},409);
   try{return c.json({ok:true,plan:await software.plan([selected[0].id])});}catch(e){return c.json({ok:false,error:(e as Error).message},409);}
  }
  if(installed)return c.json({ok:false,error:'Esta aplicación ya está instalada. Revisá sus instalaciones en Programas.'},409);
  try{const job=await storeJob(`Tienda: instalar ${entry.name}`,storeSteps(entry,'install'),{manager:entry.backend,packageName:entry.package});return c.json({ok:true,jobId:job.id});}catch(e){return c.json({ok:false,error:(e as Error).message},409);}

 });
}
