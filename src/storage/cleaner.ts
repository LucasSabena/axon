import {readFile,lstat,readlink} from 'node:fs/promises';
import path from 'node:path';
import {hostToContainer} from '../host';
import {hostArgv,boundedCommand} from './host-argv';
import {activityEvidence,type ActivityEvidence} from './activity';
import type {Candidate,ScanRoot,Step,Receipt} from './types';
import {PROTECTED,within,hash} from './policy';
interface WorkerReceipt {ok:boolean;state:string;id:string;snapshotRevision:string;message?:string;retiredBytes?:string;freeBytesBefore?:string;freeBytesAfter?:string;partialPath?:string;copiedBytes?:string;removedEntries?:number;launched?:boolean}
type Runner=(input:Record<string,unknown>)=>Promise<WorkerReceipt>;
export class HostCleaner {
 constructor(private home:()=>Promise<string>,private observe:(roots:string[])=>Promise<ActivityEvidence>=activityEvidence,private run:Runner=async payload=>{
  const script=await readFile(new URL('./file-task-host.py',import.meta.url),'utf8');return JSON.parse(await boundedCommand(hostArgv('python3',['-c',script]),JSON.stringify(payload)));
 },private fixtureRoot?:string){}
 private async eligibility(c:Candidate,root:ScanRoot){
  if(!c.complete||c.blockers.length||!within(c.identity.canonicalPath,root.path)||c.identity.canonicalPath===root.path)throw new Error('La identidad o cobertura está incompleta');
  const home=await this.home(),p=c.identity.canonicalPath;
  if(this.fixtureRoot){if(!within(p,this.fixtureRoot)||!within(root.path,this.fixtureRoot))throw new Error('Fuera de la fixture propia');return;}
  if(!['trash-xdg','trash-legacy','packages','builds','remote'].includes(root.adapterId))throw new Error('Esta categoría sólo permite revisión');
  if(root.adapterId==='packages'&&within(root.path,path.join(home,'.cache','uv')))throw new Error('uv requiere su gestor nativo: no se modifica su caché directamente; la selección permanece en revisión');
  if(root.adapterId==='packages'&&!within(root.path,path.join(home,'.cache','pip')))throw new Error('APT necesita una operación privilegiada específica; no se habilita un borrado genérico');
  if(root.adapterId==='builds'&&!/\/target\/(debug|release)\/incremental$/.test(root.path))throw new Error('Sólo está certificado Rust incremental de un proyecto registrado');
  if(root.adapterId==='remote'){
   const name=path.basename(p);
   if(!(/\/\.vscode-server\/bin$/.test(root.path)&&/^[a-f0-9]{40}$/.test(name)||/\/\.vscode-server\/cli\/servers$/.test(root.path)&&/^(Stable|Insiders)-[a-f0-9]{40}$/.test(name)))throw new Error('Layout remoto no certificado; se conservan extensiones, perfiles y Devin');
   for(const ref of ['current','default']){try{const f=path.join(root.path,ref);if((await lstat(hostToContainer(f))).isSymbolicLink()&&path.resolve(root.path,await readlink(hostToContainer(f)))===p)throw new Error('La versión está seleccionada por '+ref);}catch(e:any){if(e.code!=='ENOENT')throw e;}}
  }
  if(!root.adapterId.startsWith('trash-')&&PROTECTED.test(p))throw new Error('Ruta protegida');
 }
 async lockResource(){return `files:trash:${hash(await this.home())}`;}
 async prepare(c:Candidate,root:ScanRoot,opts?:{metadata?:boolean;quiet?:boolean}):Promise<{taskId:string;root:ScanRoot}|{blocker:string}>{
  try{
   await this.eligibility(c,root);if(opts?.quiet!==false)await this.quiet(c,root);
   const taskId=crypto.randomUUID(),payload:Record<string,unknown>={action:'prepare',mode:'purge',id:taskId,home:await this.home(),from:c.identity.canonicalPath,to:c.identity.canonicalPath+'.axon-clean-'+taskId,adapter:this.fixtureRoot?'fixture':root.adapterId,allowedRoot:root.path};
   if(opts?.metadata!==false){
    if(root.adapterId==='trash-xdg')payload.metadataPath=path.join(path.dirname(root.path),'info',path.basename(c.identity.canonicalPath)+'.trashinfo');
    if(root.adapterId==='trash-legacy')payload.metadataPath=path.join(root.path,'.manifest.json');
   }
   const r=await this.run(payload);if(!r.ok)throw new Error('No se pudo congelar el árbol: propietario, permisos, tamaño o metadatos incompatibles');
   return {taskId,root};
  }catch(e){return {blocker:e instanceof Error?e.message:'Precondiciones no verificadas'};}
 }
 private async quiet(c:Candidate,root:ScanRoot){
  const observation=await this.observe([c.identity.canonicalPath]);
  if(!observation.complete)throw new Error('La lectura de procesos está incompleta; no demuestra ausencia de uso');
  if(observation.references.length)throw new Error('Hay un proceso que usa la selección; se conserva');
  const tools=observation.tools||[];
  const relevant=root.adapterId==='packages'?['pip','uv','apt','apt-get','dpkg']:root.adapterId==='builds'?['cargo','rustc']:root.adapterId==='remote'?['code','code-server']:[];
  if(tools.some(t=>relevant.includes(t.tool)))throw new Error('Hay una herramienta de esta categoría trabajando; se conserva');
 }
 async revalidate(step:Step,root:ScanRoot){try{await this.eligibility({...step.candidate,blockers:[]},root);await this.quiet(step.candidate,root);return true;}catch{return false;}}
 async start(step:Step){if(!step.taskId)throw new Error('Paso sin intención del host');const r=await this.run({action:'start',id:step.taskId,home:await this.home()});if(!r.ok)throw new Error('Inicio incierto');return r;}
 async status(step:Step):Promise<Receipt&{partialPath?:string;removedEntries?:number;launched?:boolean}>{
  const r=await this.run({action:'status',id:step.taskId,home:await this.home()});if(!r.ok)throw new Error('Recibo no disponible');
  if(r.state==='planned'&&!r.launched)return {stepId:step.id,state:'skipped',message:'El worker no se inició. No se reanuda automáticamente.'};
  return {stepId:step.id,state:['verified','restored','failed','skipped','interrupted'].includes(r.state)?r.state as Receipt['state']:'running',message:r.message||'El worker sigue trabajando',retiredBytes:r.retiredBytes,freeBytesBefore:r.freeBytesBefore,freeBytesAfter:r.freeBytesAfter,partialPath:r.partialPath,removedEntries:r.removedEntries};
 }
 async recover(step:Step){const r=await this.run({action:'recover',id:step.taskId,home:await this.home()});if(!r.ok)throw new Error('No se pudo recuperar el resto: proceso activo, conflicto o identidad desconocida');return this.status(step);}
 async cancel(step:Step){await this.run({action:'cancel',id:step.taskId,home:await this.home()});}
}
