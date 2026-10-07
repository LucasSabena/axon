import {userInfo} from 'node:os';
import {mkdir,writeFile,open} from 'node:fs/promises';
import path from 'node:path';
import {importHomepage} from '../src/home-links';
import {setHostUser} from '../src/host';
import {scanRoot} from '../src/storage/scan';
import {dockerInstallations} from '../src/installation-inventory';
import {nativeToolInventory} from '../src/storage/tool-inventory';
setHostUser(userInfo().username);
const scanned=await scanRoot({id:'apt',path:'/var/cache/apt/archives',title:'Descargas APT',adapterId:'packages'},[]);
const [containers,tools]=await Promise.allSettled([dockerInstallations(),nativeToolInventory()]);
let homepageAudit:unknown={available:false,reason:'Montaje de configuración no identificado'};
if(containers.status==='fulfilled'){
 const root=containers.value.find(i=>i.name==='homepage')?.container?.mounts.find(m=>m.destination==='/app/config')?.source;
 if(root){const files=[];for(const filename of ['services.yaml','bookmarks.yaml']){let handle:Awaited<ReturnType<typeof open>>|undefined;try{handle=await open(path.join(root,filename),'r');const stat=await handle.stat();if(!stat.isFile()||stat.size>250000)throw new Error();const source=await handle.readFile('utf8');const result=importHomepage(source);files.push({file:filename,validLinks:result.links.length,groups:new Set(result.links.map(l=>l.group)).size,skipped:result.skipped,widgetsExcluded:true});}catch{files.push({file:filename,error:'Ausente, no legible o formato no admitido; no se importó'});}finally{await handle?.close();}}homepageAudit={available:true,files,imported:false};}
}
const report={at:new Date().toISOString(),mode:'read-only',mutations:0,homepageAudit,scan:{root:'/var/cache/apt/archives',complete:scanned.complete,count:scanned.candidates.length,errors:scanned.errors,metrics:scanned.metrics,mounts:scanned.mounts.filter(m=>['/','/home','/tmp'].includes(m.path))},applications:containers.status==='fulfilled'?containers.value.filter(i=>['homepage','filebrowser','portainer'].includes(i.name)).map(i=>({name:i.name,backend:i.backend,state:i.container?.state,composeProject:i.container?.project,composeService:i.container?.service,configFiles:i.container?.configFiles.length,mounts:i.container?.mounts.map(m=>({type:m.type,destination:m.destination})),blockers:i.blockers})): {error:'Docker no disponible para esta identidad; no se infiere ausencia de instalaciones'},tools:tools.status==='fulfilled'?tools.value:{error:'Herramientas no disponibles'},spaceRecoveredBytes:null};
await mkdir('docs/qa',{recursive:true});await writeFile('docs/qa/maintenance-readonly.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
