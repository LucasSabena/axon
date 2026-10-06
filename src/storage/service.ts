import type { Actor, Candidate, CleanupPlan, Scan, ScanResult, ScanRoot, Receipt } from './types';
import { MaintenanceError } from './types';
import { MaintenanceRepository } from './repository';
import { hash, policyRevision, exclusions, CAPABILITIES } from './policy';
import type {HostCleaner} from './cleaner';
export interface FixtureExecutor { revalidate(c: Candidate): Promise<boolean>; execute(c: Candidate): Promise<Omit<Receipt,'stepId'>> }
export class StorageService {
  private aborts=new Map<string,AbortController>();
  constructor(readonly repo: MaintenanceRepository, readonly roots: ()=>Promise<ScanRoot[]>, private scanner:(r:ScanRoot,e:string[],s:AbortSignal)=>Promise<ScanResult>, private fixture?: FixtureExecutor,private cleaner?:HostCleaner) { repo.reconcile(); }
  policy() { return this.repo.get<string[]>('settings','exclusions') || []; }
  setPolicy(value:unknown) { const paths=exclusions(value);this.repo.put('settings','exclusions',paths);return paths; }
  capabilities() { return CAPABILITIES; }
  async scan(rootId:string) {
    const root=(await this.roots()).find(r=>r.id===rootId);if(!root)throw new MaintenanceError('Ubicación desconocida',400);
    const policy=this.policy(); const scan:Scan={id:crypto.randomUUID(),at:new Date().toISOString(),state:'running',rootId,policyRevision:policyRevision(policy)};
    this.repo.exclusive(scan.id,['storage:scan'],()=>this.repo.put('scan',scan.id,scan,'running'));
    const controller=new AbortController();this.aborts.set(scan.id,controller);
    void (async()=>{
      try { const result=await this.scanner(root,policy,controller.signal);this.repo.put('scan',scan.id,{...scan,state:controller.signal.aborted?'interrupted':'verified',result},controller.signal.aborted?'interrupted':'verified'); }
      catch { this.repo.put('scan',scan.id,{...scan,state:'interrupted',error:controller.signal.aborted?'Análisis cancelado. No se modificaron archivos.':'Análisis incompleto: permiso, límite o herramienta no disponible.'},'interrupted'); }
      finally {this.aborts.delete(scan.id);this.repo.release(scan.id);this.repo.retainScans();}
    })().catch(()=>{/* Durable running intent remains uncertain if the ledger fails. */});
    return scan;
  }
  cancel(id:string) {
    const scan=this.repo.get<Scan>('scan',id);if(!scan)throw new MaintenanceError('Análisis no encontrado',404);
    if(scan.state!=='running')return scan;
    this.repo.put('scan',id,{...scan,state:'cancel-requested'},'cancel-requested');this.aborts.get(id)?.abort();return {...scan,state:'cancel-requested'};
  }
  plan(scanId:string,ids:unknown,actor:Actor) {
    if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new MaintenanceError('Selección inválida',400);
    const scan=this.repo.get<Scan>('scan',scanId);const revision=policyRevision(this.policy());
    if(!scan?.result||scan.state!=='verified'||scan.policyRevision!==revision)throw new MaintenanceError('El análisis cambió o no está listo. Volvé a analizar.');
    if(Date.now()-Date.parse(scan.at)>30*60_000)throw new MaintenanceError('El análisis venció. Volvé a analizar.');
    const candidates=ids.map(id=>scan.result!.candidates.find(c=>c.id===id));
    if(candidates.some(c=>!c))throw new MaintenanceError('La selección no pertenece al análisis',400);
    const chosen=candidates as Candidate[];
    const plan:CleanupPlan={id:crypto.randomUUID(),...actor,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+5*60_000).toISOString(),inventoryRevision:scanId,policyRevision:revision,digest:'',state:'planned',selectedCandidateIds:ids,steps:chosen.map(c=>({id:crypto.randomUUID(),adapterId:c.adapterId,actionId:this.fixture&&c.adapterId==='fixture'&&c.complete&&!c.blockers.length?'fixture-unlink':'review-only',candidate:c,locks:[`inode:${c.identity.device}:${c.identity.inode}`],interruptions:[],expectedRecovery:c.recovery}))};
    plan.digest=hash({...plan,digest:undefined});this.repo.put('plan',plan.id,plan);return plan;
  }
  async preparePlan(scanId:string,ids:unknown,actor:Actor){
    const plan=this.plan(scanId,ids,actor);if(!this.cleaner)return plan;
    const scan=this.repo.get<Scan>('scan',scanId)!;const root=(await this.roots()).find(r=>r.id===scan.rootId);
    if(!root)return plan;
    for(const step of plan.steps){
      const prepared=await this.cleaner.prepare(step.candidate,root);
      if('taskId' in prepared){step.actionId='host-clean';step.taskId=prepared.taskId;step.expectedRecovery='none';step.locks.push('files:transfer',await this.cleaner.lockResource());}
      else step.candidate={...step.candidate,blockers:[...step.candidate.blockers,prepared.blocker]};
    }
    plan.digest=hash({...plan,digest:undefined});this.repo.put('plan',plan.id,plan);return plan;
  }
  async execute(id:string,digest:string,actor:Actor) {
    const plan=this.repo.get<CleanupPlan>('plan',id);
    if(!plan||plan.actorId!==actor.actorId||plan.sessionId!==actor.sessionId||plan.digest!==digest)throw new MaintenanceError('El plan no corresponde a esta sesión',403);
    if(hash({...plan,digest:undefined,state:'planned'})!==plan.digest)throw new MaintenanceError('La integridad del plan no coincide. Prepará una revisión nueva.');
    if(plan.state!=='planned')return {plan,receipts:this.repo.receipts(id)};
    if(Date.parse(plan.expiresAt)<Date.now()||plan.policyRevision!==policyRevision(this.policy()))throw new MaintenanceError('El plan venció o cambió la política');
    if(plan.steps.some(s=>s.actionId==='review-only'))throw new MaintenanceError('El plan es de revisión: no hay garantía de ejecución para todos los elementos. No se realizó ningún efecto.');
    if(!this.fixture&&!this.cleaner)throw new MaintenanceError('Las mutaciones del host no están habilitadas',503);
    this.repo.exclusive(id,plan.steps.flatMap(s=>s.locks),()=>{
      if(this.repo.get<CleanupPlan>('plan',id)?.state!=='planned')throw new MaintenanceError('El plan ya fue utilizado');
      plan.state='running';this.repo.put('plan',id,plan,'running');
    });
    if(plan.steps.some(s=>s.actionId==='host-clean')){
      void this.runHost(plan).catch(()=>{/* Durable running intent retains every lock. */});
      return {plan,receipts:this.repo.receipts(id)};
    }
    let all=true;
    try {
      for(const step of plan.steps){
        if(this.repo.get<{cancel:boolean}>('plan-control',plan.id)?.cancel){all=false;this.repo.receipt(plan.id,step.id,{stepId:step.id,state:'skipped',message:'Cancelado antes de iniciar este paso'});continue;}
        if(plan.policyRevision!==policyRevision(this.policy())||!await this.fixture.revalidate(step.candidate)){all=false;this.repo.receipt(id,step.id,{stepId:step.id,state:'skipped',message:'Cambió la identidad o el contenido. Volvé a analizar.'});continue;}
        this.repo.receipt(id,step.id,{stepId:step.id,state:'running',message:'Intención persistida antes del efecto'});
        const receipt=await this.fixture.execute(step.candidate);this.repo.receipt(id,step.id,{...receipt,stepId:step.id});if(receipt.state!=='verified')all=false;
      }
      plan.state=all?'verified':'skipped';this.repo.put('plan',id,plan,plan.state);this.repo.release(id);
    } catch {plan.state='interrupted';this.repo.put('plan',id,plan,'interrupted');/* Retain locks; outcome is uncertain. */}
    return {plan,receipts:this.repo.receipts(id)};
  }
  private async runHost(plan:CleanupPlan){
    let all=true;const scan=this.repo.get<Scan>('scan',plan.inventoryRevision)!,root=(await this.roots()).find(r=>r.id===scan.rootId);
    try{
      for(const step of plan.steps){
        if(this.repo.get<{cancel:boolean}>('plan-control',plan.id)?.cancel){all=false;this.repo.receipt(plan.id,step.id,{stepId:step.id,state:'skipped',message:'Cancelado antes de iniciar este paso'});continue;}
        if(!root||plan.policyRevision!==policyRevision(this.policy())||!await this.cleaner!.revalidate(step,root)){all=false;this.repo.receipt(plan.id,step.id,{stepId:step.id,state:'skipped',message:'Cambió el uso, la política o la cobertura. No se ejecutó este paso.'});continue;}
        this.repo.receipt(plan.id,step.id,{stepId:step.id,state:'running',message:'Intención guardada antes de iniciar el worker',taskId:step.taskId});
        await this.cleaner!.start(step);let receipt=await this.cleaner!.status(step);
        while(receipt.state==='running'){await Bun.sleep(500);receipt=await this.cleaner!.status(step);this.repo.receipt(plan.id,step.id,receipt);}
        this.repo.receipt(plan.id,step.id,receipt);
        if(receipt.state==='interrupted'){plan.state='interrupted';this.repo.put('plan',plan.id,plan,'interrupted');return;}
        if(receipt.state!=='verified')all=false;
      }
      plan.state=all?'verified':'skipped';this.repo.put('plan',plan.id,plan,plan.state);this.repo.release(plan.id);
    }catch{plan.state='interrupted';try{this.repo.put('plan',plan.id,plan,'interrupted');}catch{}}
  }
  async reconcilePlan(id:string,actor:Actor){
    const plan=this.repo.get<CleanupPlan>('plan',id);
    if(!plan||plan.actorId!==actor.actorId)throw new MaintenanceError('Plan no encontrado',404);
    const saved=this.repo.receipts(id) as {stepId:string;state:string}[];
    let running=false,all=true;
    for(const step of plan.steps){
      const receipt=saved.find(r=>r.stepId===step.id);
      if(!receipt){all=false;continue;}
      if(step.taskId&&this.cleaner&&['running','interrupted'].includes(receipt.state)){
        const current=await this.cleaner.status(step);this.repo.receipt(id,step.id,current);
        if(current.state==='running'||current.state==='interrupted')running=true;
        if(current.state!=='verified')all=false;
      }else if(receipt.state==='interrupted'){running=true;all=false;}
      else if(receipt.state!=='verified')all=false;
    }
    if(!running&&plan.state==='interrupted'){plan.state=all?'verified':'skipped';this.repo.put('plan',id,plan,plan.state);this.repo.releaseReconciled(id);}
    return {plan,receipts:this.repo.receipts(id)};
  }
  async recoverPlan(id:string,actor:Actor){
    const plan=this.repo.get<CleanupPlan>('plan',id);if(!plan||plan.actorId!==actor.actorId||!this.cleaner)throw new MaintenanceError('Plan no encontrado',404);
    if(plan.state==='running')throw new MaintenanceError('El plan sigue trabajando; cancelá y comprobá su resultado primero');
    plan.state='interrupted';this.repo.exclusiveRecovery(id,plan.steps.flatMap(s=>s.locks),()=>this.repo.put('plan',id,plan,'interrupted'));
    const saved=this.repo.receipts(id) as Receipt[];
    for(const step of plan.steps)if(!saved.some(r=>r.stepId===step.id))this.repo.receipt(id,step.id,{stepId:step.id,state:'skipped',message:'Este paso no se inició; no se reanuda durante la recuperación'});
    for(const step of plan.steps)if(step.taskId&&saved.some(r=>r.stepId===step.id&&['interrupted','skipped'].includes(r.state))){try{this.repo.receipt(id,step.id,await this.cleaner.recover(step));}catch(e){throw new MaintenanceError(e instanceof Error?e.message:'Recuperación incompleta');}}
    const receipts=this.repo.receipts(id) as Receipt[];
    if(receipts.length===plan.steps.length&&receipts.every(r=>['restored','verified','skipped','failed'].includes(r.state))&&receipts.some(r=>r.state==='restored')){plan.state='restored';this.repo.put('plan',id,plan,'restored');this.repo.releaseReconciled(id);}
    else if(receipts.length===plan.steps.length&&receipts.every(r=>r.state==='verified')){plan.state='verified';this.repo.put('plan',id,plan,'verified');this.repo.releaseReconciled(id);}
    return {plan,receipts};
  }
  async cancelPlan(id:string,actor:Actor){
    const plan=this.repo.get<CleanupPlan>('plan',id);
    if(!plan||plan.actorId!==actor.actorId)throw new MaintenanceError('Plan no encontrado',404);
    this.repo.put('plan-control',id,{cancel:true});
    for(const step of plan.steps){const receipts=this.repo.receipts(id) as Receipt[];if(step.taskId&&receipts.some(r=>r.stepId===step.id&&r.state==='running'))await this.cleaner?.cancel(step);}
    return {plan,receipts:this.repo.receipts(id)};
  }
}
export function publicCandidate(c:Candidate){const {identity,...rest}=c;return {...rest,path:identity.canonicalPath};}
