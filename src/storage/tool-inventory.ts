import {readFile} from 'node:fs/promises';
import {boundedCommand,hostArgv} from './host-argv';
export interface SnapRevision {name:string;version:string;revision:string;disabled:boolean;current:boolean;canRemove:false;reason:string}
export function snapRevisions(output:string):SnapRevision[]{
 const lines=output.trim().split('\n');if(!/^Name\s+Version\s+Rev\s+Tracking\s+Publisher\s+Notes/.test(lines[0]||''))throw new Error('Formato Snap no soportado');
 return lines.slice(1).filter(Boolean).map(line=>{const [name,version,revision,,,notes]=line.trim().split(/\s+/);if(!/^[a-z0-9-]+$/.test(name)||!/^\d+$/.test(revision)||!notes)throw new Error('Revisión Snap desconocida');const disabled=notes.split(',').includes('disabled');return {name,version,revision,disabled,current:!disabled,canRemove:false,reason:disabled?'Revisión deshabilitada; falta verificar referencias y lock de snapd antes de retirar.':'Revisión vigente protegida.'};});
}
export async function nativeToolInventory(){
 const results=await Promise.allSettled([
  boundedCommand(hostArgv('snap',['list','--all']),''),
  boundedCommand(hostArgv('docker',['version','--format','{{.Server.Version}}']),''),
  readFile(new URL('./versions-host.py',import.meta.url),'utf8').then(script=>boundedCommand(hostArgv('python3',['-c',script]),'').then(text=>JSON.parse(text))),
 ]);
 return {at:new Date().toISOString(),native:results[2].status==='fulfilled'?results[2].value:{tools:[],agentHistory:{available:false,reason:'Consulta nativa incompleta; se conservan los datos'}},snap:results[0].status==='fulfilled'?(()=>{try{return {available:true,revisions:snapRevisions(results[0].value)};}catch{return {available:false,error:'Formato de Snap desconocido; no se habilita retiro de revisiones'};}})():{available:false,error:'Snap no disponible o sin permisos'},docker:results[1].status==='fulfilled'?{available:true,version:results[1].value.trim().slice(0,80),cleanup:'Sólo build cache de siete días desde Salud'}:{available:false,error:'Docker no disponible o sin permisos'}};
}
