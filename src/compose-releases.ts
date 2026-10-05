import {readFile} from 'node:fs/promises';
import {MaintenanceRepository} from './storage/repository';
import {MaintenanceError,type Actor} from './storage/types';
import {hash} from './storage/policy';
import {boundedCommand,hostArgv} from './storage/host-argv';
import type {ComposeDrafts} from './compose-drafts';
export interface ComposeRelease {id:string;path:string;project:string;state:string;digest:string;createdAt:number;expiresAt:number;message:string;changed:{name:string;fields:string[];image:string}[];active:string[];inactive:string[];canRollback:boolean;phase?:string;capturedPath?:string;retire?:string;diskFreeBefore?:string;diskFreeAfter?:string}
interface Record extends Actor {id:string;state:string;draftRevision:string;status:ComposeRelease}
export type ComposeRunner=(payload:{[key:string]:unknown})=>Promise<ComposeRelease&{ok:boolean;error?:string}>;
export class ComposeReleases {
 private beforeExecute?:(id:string,rollback:boolean)=>Promise<void>;
 onBeforeExecute(check:(id:string,rollback:boolean)=>Promise<void>){this.beforeExecute=check;}
 constructor(private repo:MaintenanceRepository,private drafts:ComposeDrafts,private home:()=>Promise<string>,private runner:ComposeRunner=async payload=>{
  const script=await readFile(new URL('./storage/compose-release-host.py',import.meta.url),'utf8');return JSON.parse(await boundedCommand(hostArgv('python3',['-c',script]),JSON.stringify(payload)));
 }){}
 async prepare(path:string,actor:Actor,retire?:string){
  const draft=this.drafts.get(path);if(!draft?.validation.ok)throw new MaintenanceError('Guardá un borrador válido antes de preparar su aplicación');
  const result=await this.runner({action:'prepare',id:crypto.randomUUID(),home:await this.home(),path,content:draft.content,retire});
  if(!result.ok)throw new MaintenanceError(result.error||'Docker no pudo preparar el contexto');
  const {ok,error,...status}=result;const record:Record={...actor,id:status.id,state:'planned',status,draftRevision:draft.revision};this.repo.put('compose-release',record.id,record);return status;
 }
 private require(id:string,actor:Actor){const r=this.repo.get<Record>('compose-release',id);if(!r||r.actorId!==actor.actorId)throw new MaintenanceError('Operación no encontrada',404);return r;}
 async execute(id:string,digest:string,actor:Actor,rollback=false){
  if(rollback)await this.status(id,actor);
  const r=this.require(id,actor);
  if(rollback&&r.state==='running')throw new MaintenanceError('El worker sigue trabajando; esperá su resultado');
  if(!rollback&&r.sessionId!==actor.sessionId||r.status.digest!==digest)throw new MaintenanceError('La revisión no corresponde a esta sesión',403);
  if(!rollback&&r.state!=='planned')return this.status(id,actor);
  if(!rollback&&Date.now()>r.status.expiresAt)throw new MaintenanceError('El plan venció');
  if(rollback&&!r.status.canRollback)throw new MaintenanceError('No hay una recuperación publicada para esta operación');
  if(!rollback&&this.drafts.get(r.status.path)?.revision!==r.draftRevision)throw new MaintenanceError('El borrador cambió; prepará otra revisión');
  await this.beforeExecute?.(id,rollback);
  const locks=['docker:compose',`compose:${hash(r.status.path)}`];
  // A rollback resumes its own retained lock after an interrupted release.
  (rollback?this.repo.exclusiveRecovery.bind(this.repo):this.repo.exclusive.bind(this.repo))(id,locks,()=>this.repo.put('compose-release',id,{...r,state:'running',status:{...r.status,state:'running'}},'running'));
  const result=await this.runner({action:rollback?'rollback':'apply',id,home:await this.home()});
  if(!result.ok)throw new MaintenanceError('Inicio incierto: conservamos el checkpoint y su bloqueo',503);
  return this.status(id,actor);
 }
 async status(id:string,actor:Actor){
  const r=this.require(id,actor),result=await this.runner({action:'status',id,home:await this.home()});
  if(!result.ok)throw new MaintenanceError('Recibo no disponible; no se liberó el bloqueo',503);
  const {ok,error,...status}=result;
  // A fork may not have published running yet. Never interpret planned as completion.
  if(r.state==='running'&&status.state==='planned')status.state='running';
  this.repo.put('compose-release',id,{...r,status,state:status.state},status.state as any);
  if(['verified','restored','skipped','failed'].includes(status.state)){
   this.repo.releaseReconciled(id);
   if(status.state==='verified'&&this.drafts.get(status.path)?.revision===r.draftRevision)this.drafts.discard(status.path,r.draftRevision);
  }
  return status;
 }
 async list(actor:Actor){const records=this.repo.list<Record>('compose-release',20).filter(r=>r.actorId===actor.actorId);return Promise.all(records.map(async r=>{if(['running','interrupted'].includes(r.state)){try{return await this.status(r.id,actor);}catch{}}return r.status;}));}
}
