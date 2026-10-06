import {readFile} from 'node:fs/promises';
import {programById} from './programs';
import {STORE_APPS} from './app-store';
import { hash } from './storage/policy';
import { hostArgv, boundedCommand } from './storage/host-argv';
import type { ProgramView } from './types';
export interface Installation {id:string;name:string;backend:string;scope:string;version:string|null;executablePath:string|null;coverage:string;references:string[];container?:{id:string;project:string;service:string;state:string;mounts:{source:string;destination:string;type:string}[];configFiles:string[];image:string};blockers:string[]}
export function programInstallation(p:ProgramView):Installation {
  const backend=p.channel||'manual';
  return {id:hash({backend,scope:backend==='apt'||backend==='snap'?'system':'user',id:p.id}).slice(0,24),name:p.name,backend,scope:backend==='apt'||backend==='snap'?'system':'user',version:p.version||null,executablePath:null,coverage:'Axon administra actualizaciones; el ejecutable sigue siendo necesario',references:[`programs:${p.id}`],blockers:['Ruta ejecutable e instalación exacta pendientes de resolver. Desinstalación desde este inventario bloqueada.']};
}
export async function dockerInstallations():Promise<Installation[]> {
  const ids=(await boundedCommand(hostArgv('docker',['ps','-aq','--no-trunc']),'' )).trim().split(/\s+/).filter(Boolean);
  if(ids.length>250||ids.some(id=>!/^[a-f0-9]{64}$/.test(id)))throw new Error('Inventario de contenedores excedido o inválido');
  if(!ids.length)return [];
  // Deliberately exclude Env, command arguments, secrets and labels outside this allowlist.
  const template='{{json .Id}}\t{{json .Name}}\t{{json .Config.Image}}\t{{json .State.Status}}\t{{json (index .Config.Labels "com.docker.compose.project")}}\t{{json (index .Config.Labels "com.docker.compose.service")}}\t{{json (index .Config.Labels "com.docker.compose.project.config_files")}}\t{{json .Mounts}}';
  const out=await boundedCommand(hostArgv('docker',['inspect','--format',template,...ids]),'');
  return out.trim().split('\n').map(line=>{
    const [id,rawName,image,state,project,service,configs,mounts]=line.split('\t').map(s=>JSON.parse(s));const name=String(rawName).replace(/^\//,'');
    return {id:hash({backend:'docker',id}).slice(0,24),name,backend:'docker',scope:'host',version:null,executablePath:null,coverage:'Axon cubre parte de su administración',references:[`docker:${id}`],container:{id,project:project||'',service:service||'',state,mounts:(mounts||[]).map((m:any)=>({source:m.Source,destination:m.Destination,type:m.Type})),configFiles:String(configs||'').split(',').filter(Boolean),image},blockers:!project?['Origen docker run o no reconstruible: sólo lectura']:['Profiles, overrides y env files necesitan comparación antes de migrar']};
  });
}

export async function physicalInstallations(programs:ProgramView[]):Promise<Installation[]>{
 const supported=programs.filter(p=>p.installed).map(p=>{const d=programById(p.id);const command=d?.detect.map(v=>v.cmd.match(/^command -v ([a-zA-Z0-9_.+-]+)$/)?.[1]).find(Boolean);return {id:p.id,name:p.name,version:p.version,backend:p.channel,command};});
 const store=STORE_APPS.filter(p=>p.bin).map(p=>({id:p.id,name:p.name,backend:p.backend,command:p.bin,references:[`store:${p.id}`]}));
 const script=await readFile(new URL('./storage/installations-host.py',import.meta.url),'utf8');
 let found:Installation[]=[];
 try{const result=JSON.parse(await boundedCommand(hostArgv('python3',['-c',script]),JSON.stringify({programs:[...supported,...store],catalog:STORE_APPS.filter(p=>p.backend==='flatpak').map(p=>({id:p.id,package:p.package}))})));found=result.installations;}catch{/* Explicit unresolved records remain visible below. */}
 const represented=new Set(found.flatMap(i=>i.references));
 return [...found,...programs.filter(p=>p.installed&&!represented.has(`programs:${p.id}`)).map(programInstallation)];
}
