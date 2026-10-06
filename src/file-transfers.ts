import {readFile} from 'node:fs/promises';
import type {Actor,OperationState} from './storage/types';
import {MaintenanceError} from './storage/types';
import {MaintenanceRepository} from './storage/repository';
import {hostArgv,boundedCommand} from './storage/host-argv';
import {hash} from './storage/policy';
import type {TransferReview} from './library-transfer-review';
export interface TransferStatus {
  id:string;state:OperationState;mode:'copy'|'move';from:string;to:string;owner?:string;
  launched?:boolean;snapshotRevision:string;logicalBytes:string;allocatedBytes:string;copiedBytes:string;entries:number;
  partialPath?:string;recoveryPath?:string;message?:string;phase?:string;referencesPending?:boolean;
}
export interface TransferPlan extends TransferStatus,Actor {createdAt:string;expiresAt:string;digest:string;review?:TransferReview}
interface TransferRecord {id:string;actorId:string;state:OperationState;plan:TransferPlan;status?:TransferStatus;referencesUpdated?:boolean}
export type TransferRunner=(input:Record<string,unknown>)=>Promise<TransferStatus&{ok:boolean;error?:string;blockers?:{path:string;reason:string}[]}>;
export class FileTransfers {
  private changed?: (mode:'copy'|'move',from:string,to:string,review?:TransferReview)=>Promise<void>;
  private review?: (mode:'copy'|'move',from:string,to:string)=>Promise<TransferReview|undefined>;
  private guard?: (mode:'copy'|'move',from:string,to:string)=>Promise<void>;
  private statusFlights=new Map<string,Promise<TransferStatus>>();
  private reconcileFlight?:Promise<void>;
  constructor(readonly repo:MaintenanceRepository,private home:()=>Promise<string>,private runner:TransferRunner=async payload=>{
    const script=await readFile(new URL('./storage/file-task-host.py',import.meta.url),'utf8');
    return JSON.parse(await boundedCommand(hostArgv('python3',['-c',script]),JSON.stringify(payload)));
  }){}
  onChanged(callback:(mode:'copy'|'move',from:string,to:string,review?:TransferReview)=>Promise<void>){this.changed=callback;}
  onValidate(callback:(mode:'copy'|'move',from:string,to:string)=>Promise<void>){this.guard=callback;}
  onReview(callback:(mode:'copy'|'move',from:string,to:string)=>Promise<TransferReview|undefined>){this.review=callback;}
  async plan(mode:'copy'|'move',from:string,to:string,actor:Actor,expected:{sourceMountId?:string;destinationMountId?:string}={}):Promise<TransferPlan>{
    if(!['copy','move'].includes(mode)||typeof from!=='string'||typeof to!=='string'||from.length>4096||to.length>4096)throw new MaintenanceError('Transferencia inválida',400);
    await this.guard?.(mode,from,to);
    const id=crypto.randomUUID(),result=await this.runner({action:'prepare',home:await this.home(),id,mode,from,to,...expected});
    if(!result.ok)throw new TransferBlocked(result.error||'No se pudo revisar el origen',result.blockers);
    const {ok,error,...summary}=result;
    const review=await this.review?.(mode,from,to);
    const plan:TransferPlan={...summary,...(review?{review}:{}),...actor,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+5*60_000).toISOString(),digest:''};
    plan.digest=hash({...plan,digest:undefined});this.repo.put('transfer-plan',id,plan);return plan;
  }
  async execute(id:string,digest:string,actor:Actor,reviewDigest?:string){
    const plan=this.repo.get<TransferPlan>('transfer-plan',id);
    if(!plan||plan.actorId!==actor.actorId||plan.sessionId!==actor.sessionId||plan.digest!==digest||hash({...plan,digest:undefined})!==digest)throw new MaintenanceError('El plan no corresponde a esta sesión',403);
    const existing=this.repo.get<TransferRecord>('transfer',id);
    if(existing)return this.status(id,actor);
    if(Date.parse(plan.expiresAt)<Date.now())throw new MaintenanceError('La revisión venció. Prepará otra transferencia.');
    await this.guard?.(plan.mode,plan.from,plan.to);
    const current=await this.review?.(plan.mode,plan.from,plan.to);
    if(current?.revision!==plan.review?.revision)throw new MaintenanceError('Las referencias de AXON cambiaron. Revisá el movimiento otra vez.');
    if(plan.review?.needsConfirmation&&reviewDigest!==plan.review.revision)throw new TransferReviewRequired(plan);
    await this.reconcilePending();
    const record:TransferRecord={id,actorId:actor.actorId,state:'running',plan};
    // Serialize all transfers and trash effects, including other SQLite connections.
    const home=await this.home();
    this.repo.exclusive(id,[`files:trash:${hash(home)}`,'files:transfer'],()=>{
      if(this.repo.get('transfer',id))throw new MaintenanceError('La transferencia ya se inició');
      this.repo.put('transfer',id,record,'running');
    },actor.actorId);
    try {
      const status=await this.runner({action:'start',home,id});
      if(!status.ok)throw new Error('No se pudo confirmar el inicio');
      this.repo.put('transfer',id,{...record,status},'running');
      // The host receipt, not the web process, is the source of truth after a restart.
      return this.status(id,actor);
    } catch {
      try{this.repo.put('transfer',id,{...record,state:'interrupted'},'interrupted');}catch{}
      throw new MaintenanceError('Inicio interrumpido. El bloqueo y la intención se conservan; comprobá el trabajo antes de repetirlo.',503);
    }
  }
  async status(id:string,actor:Actor):Promise<TransferStatus>{
    const record=this.repo.get<TransferRecord>('transfer',id);
    if(!record||record.actorId!==actor.actorId)throw new MaintenanceError('Transferencia no encontrada',404);
    const existing=this.statusFlights.get(id);if(existing)return existing;
    const flight=this.readStatus(record,actor).finally(()=>{if(this.statusFlights.get(id)===flight)this.statusFlights.delete(id);});
    this.statusFlights.set(id,flight);return flight;
  }
  private async readStatus(record:TransferRecord,actor:Actor):Promise<TransferStatus>{
    const id=record.id;
    const result=await this.runner({action:'status',home:await this.home(),id});
    if(!result.ok)throw new MaintenanceError('Recibo del host no disponible. Se conserva el bloqueo.',503);
    const {ok,error,...status}=result;
    if(status.state==='planned')status.state=status.launched?'running':'skipped';
    const next={...record,state:status.state,status};this.repo.put('transfer',id,next,status.state);
    if(status.state==='verified'&&!record.referencesUpdated){
      try {
        await this.changed?.(status.mode,status.from,status.to,record.plan.review);
        this.repo.put('transfer',id,{...next,referencesUpdated:true},status.state);
      } catch {status.referencesPending=true;status.message=(status.message||'')+' Biblioteca necesita actualizar sus referencias; volvé a consultar el trabajo.';return status;}
    }
    if(['verified','restored','failed','skipped'].includes(status.state))this.repo.releaseReconciled(id);
    return status;
  }
  // Only host receipts can release an effects lock. A browser closing, elapsed
  // time or a dead web process never authorizes release or repeats an effect.
  reconcilePending():Promise<void>{
    if(this.reconcileFlight)return this.reconcileFlight;
    const flight=(async()=>{
      for(const id of this.repo.lockedOperations('transfer')){
        const record=this.repo.get<TransferRecord>('transfer',id);if(!record)continue;
        try{await this.status(id,{actorId:record.actorId,sessionId:record.plan.sessionId});}catch{/* Missing or uncertain receipts keep their locks. */}
      }
    })().finally(()=>{if(this.reconcileFlight===flight)this.reconcileFlight=undefined;});
    this.reconcileFlight=flight;return flight;
  }
  async cancel(id:string,actor:Actor){
    const op=this.repo.get<TransferRecord>('transfer',id);
    if(!op||op.actorId!==actor.actorId)throw new MaintenanceError('Transferencia no encontrada',404);
    await this.runner({action:'cancel',home:await this.home(),id});return this.status(id,actor);
  }
  async recover(id:string,actor:Actor){
    const r=this.repo.get<TransferRecord>('transfer',id);if(!r||r.actorId!==actor.actorId)throw new MaintenanceError('Transferencia no encontrada',404);
    await this.guard?.('move',r.plan.to,r.plan.from);
    const home=await this.home();this.repo.exclusiveRecovery(id,['files:transfer',`files:trash:${hash(home)}`],()=>this.repo.put('transfer',id,{...r,state:'running'},'running'));
    const result=await this.runner({action:'recover',home,id});if(!result.ok)throw new MaintenanceError('No se pudo recuperar: proceso vivo, origen ocupado o identidad cambiada. Se conservó el contenido.');
    if(result.state==='restored'&&r.referencesUpdated){await this.changed?.('move',r.plan.to,r.plan.from);this.repo.put('transfer',id,{...r,referencesUpdated:false,state:'restored'},'restored');}
    return this.status(id,actor);
  }
  async quick(mode:'copy'|'move',from:string,to:string,actor:Actor){
    const plan=await this.plan(mode,from,to,actor);let status=await this.execute(plan.id,plan.digest,actor);
    const until=Date.now()+25_000;
    while(['planned','running'].includes(status.state)&&Date.now()<until){await Bun.sleep(100);status=await this.status(plan.id,actor);}
    if(status.state!=='verified')throw new MaintenanceError(`La operación ${status.id} sigue pendiente o requiere revisión. Abrí el historial de transferencias.`,409);
    return status;
  }
  async list(actor:Actor){const records=this.repo.list<TransferRecord>('transfer',50).filter(r=>r.actorId===actor.actorId);return Promise.all(records.map(async r=>{if(['running','interrupted','cancel-requested'].includes(r.state)||!r.referencesUpdated&&r.state==='verified'){try{return await this.status(r.id,actor);}catch{}}return r.status||{id:r.id,state:r.state,mode:r.plan.mode,from:r.plan.from,to:r.plan.to,message:'Recibo pendiente de reconciliación'};}));}
}
export function publicTransferPlan(plan:TransferPlan){const {actorId,sessionId,owner,...rest}=plan;return rest;}
export function legacyTransferProgress(status:TransferStatus){
  const done=!status.referencesPending&&['verified','restored','failed','skipped','interrupted'].includes(status.state),total=BigInt(status.logicalBytes||'0'),copied=BigInt(status.copiedBytes||'0');
  return {ok:true,...status,done,pct:status.state==='verified'&&!status.referencesPending?100:total>0n?Number(copied*100n/total>99n?99n:copied*100n/total):0,error:done&&status.state!=='verified'?(status.message||'Operación pendiente de revisión'):null};
}

export class TransferReviewRequired extends MaintenanceError {
  constructor(readonly plan:TransferPlan){super('Este movimiento necesita revisar sus referencias de AXON.');}
  override getResponse(){return Response.json({ok:false,error:this.message,code:'transfer-review-required',plan:publicTransferPlan(this.plan)},{status:this.status,headers:{'Cache-Control':'private, no-store'}});}
}
export class TransferBlocked extends MaintenanceError {
  constructor(message:string,readonly blockers?:{path:string;reason:string}[]){super(message);}
  override getResponse(){return Response.json({ok:false,error:this.message,...(this.blockers?{blockers:this.blockers}:{})},{status:this.status,headers:{'Cache-Control':'private, no-store'}});}
}
