import type { Actor, Candidate, CleanupPlan, Scan, ScanResult, ScanRoot, Receipt, Step } from './types';
import { MaintenanceError } from './types';
import { MaintenanceRepository } from './repository';
import { hash, policyRevision, exclusions, CAPABILITIES } from './policy';
import type {HostCleaner} from './cleaner';
export interface FixtureExecutor { revalidate(c: Candidate): Promise<boolean>; execute(c: Candidate): Promise<Omit<Receipt,'stepId'>> }
export class StorageService {
  private aborts=new Map<string,AbortController>();
  private reconcileCache=new Map<string,{at:number;value:Promise<{plan:CleanupPlan;receipts:unknown[]}>}>();
  constructor(readonly repo: MaintenanceRepository, readonly roots: ()=>Promise<ScanRoot[]>, private scanner:(r:ScanRoot,e:string[],s:AbortSignal)=>Promise<ScanResult>, private fixture?: FixtureExecutor,private cleaner?:HostCleaner) { repo.reconcile(); if(this.cleaner)void this.cleaner.sweep(); }
  private invalidate(id:string){for(const key of [...this.reconcileCache.keys()])if(key.split(' ')[0]===id)this.reconcileCache.delete(key);}
  private retire(step:Step,state:string){if(step.taskId&&['verified','skipped','failed','restored'].includes(state))void this.cleaner?.cleanup(step.taskId);}
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
    })().catch(()=>{
      // A ledger failure inside the worker must not leave a 'running' scan forever.
      try{this.repo.put('scan',scan.id,{...scan,state:'interrupted',error:'El análisis terminó con un resultado incierto por una falla del registro.'},'interrupted');}
      catch(e){console.error('[storage] No se pudo registrar el resultado del análisis',scan.id,e);}
    });
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
    try{
      for(const step of plan.steps){
        const prepared=await this.cleaner.prepare(step.candidate,root);
        if('taskId' in prepared){step.actionId='host-clean';step.taskId=prepared.taskId;step.expectedRecovery='none';step.locks.push('files:transfer',await this.cleaner.lockResource());}
        else step.candidate={...step.candidate,blockers:[...step.candidate.blockers,prepared.blocker]};
      }
    }catch(e){
      // A mid-prepare failure leaves a 'planned' plan with orphaned task dirs
      // and a stale digest — mark it failed so it doesn't linger unusable.
      plan.state='failed';this.repo.put('plan',plan.id,plan,'failed');
      throw e;
    }
    // The 5-minute window must start after host preparation, not before it.
    plan.expiresAt=new Date(Date.now()+5*60_000).toISOString();
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
    this.invalidate(id);
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
      plan.state=all?'verified':'skipped';this.repo.put('plan',id,plan,plan.state);this.repo.release(id);this.invalidate(id);
    } catch {plan.state='interrupted';this.repo.put('plan',id,plan,'interrupted');this.invalidate(id);/* Retain locks; outcome is uncertain. */}
    return {plan,receipts:this.repo.receipts(id)};
  }
  private async runHost(plan:CleanupPlan){
    let all=true;
    try{
      const scan=this.repo.get<Scan>('scan',plan.inventoryRevision)!,root=(await this.roots()).find(r=>r.id===scan.rootId);
      for(const step of plan.steps){
        if(this.repo.get<{cancel:boolean}>('plan-control',plan.id)?.cancel){all=false;this.repo.receipt(plan.id,step.id,{stepId:step.id,state:'skipped',message:'Cancelado antes de iniciar este paso'});this.retire(step,'skipped');continue;}
        if(!root||plan.policyRevision!==policyRevision(this.policy())||!await this.cleaner!.revalidate(step,root)){all=false;this.repo.receipt(plan.id,step.id,{stepId:step.id,state:'skipped',message:'Cambió el uso, la política o la cobertura. No se ejecutó este paso.'});this.retire(step,'skipped');continue;}
        this.repo.receipt(plan.id,step.id,{stepId:step.id,state:'running',message:'Intención guardada antes de iniciar el worker',taskId:step.taskId});
        await this.cleaner!.start(step);let receipt=await this.cleaner!.status(step);
        // A live-but-wedged worker must not hold the plan locks and the polling
        // task forever — past the bound the step reads interrupted and the
        // locks stay until reconcile settles the receipt against the worker.
        const deadline=Date.now()+30*60_000;
        while(receipt.state==='running'&&Date.now()<deadline){await Bun.sleep(500);receipt=await this.cleaner!.status(step);this.repo.receipt(plan.id,step.id,receipt);}
        if(receipt.state==='running')receipt={...receipt,state:'interrupted',message:'La limpieza excedió el tiempo previsto; el bloqueo se conserva hasta reconciliar el resultado real.'};
        this.repo.receipt(plan.id,step.id,receipt);
        if(receipt.state==='interrupted'){plan.state='interrupted';this.repo.put('plan',plan.id,plan,'interrupted');this.invalidate(plan.id);void this.cleaner!.sweep();return;}
        if(receipt.state!=='verified')all=false;
        this.retire(step,receipt.state);
      }
      plan.state=all?'verified':'skipped';this.repo.put('plan',plan.id,plan,plan.state);this.repo.release(plan.id);this.invalidate(plan.id);void this.cleaner!.sweep();
    }catch{plan.state='interrupted';try{this.repo.put('plan',plan.id,plan,'interrupted');this.invalidate(plan.id);}catch{}void this.cleaner?.sweep();}
  }
  async reconcilePlan(id:string,actor:Actor){
    // Host status checks spawn a worker per pending step; coalesce and briefly
    // cache results so polling clients do not cause process churn.
    const key=id+' '+actor.actorId,hit=this.reconcileCache.get(key);
    if(hit&&Date.now()-hit.at<1500)return hit.value;
    const value=this.reconcilePlanOnce(id,actor);
    this.reconcileCache.set(key,{at:Date.now(),value});
    value.catch(()=>{if(this.reconcileCache.get(key)?.value===value)this.reconcileCache.delete(key);});
    return value;
  }
  private async reconcilePlanOnce(id:string,actor:Actor){
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
        this.retire(step,current.state);
      }else if(['interrupted','running'].includes(receipt.state)){running=true;all=false;}
      else{this.retire(step,receipt.state);if(receipt.state!=='verified')all=false;}
    }
    // Settle 'interrupted' plans — and 'running' plans wedged by a failed
    // ledger write — once every step carries a terminal receipt. A plan
    // mid-run always has a live 'running' receipt (running=true above), so
    // this never settles an operation still in flight.
    const settled=plan.steps.every(s=>{const r=saved.find(x=>x.stepId===s.id);return !!r&&!['running','interrupted'].includes(r.state);});
    // 'recovering' pins the plan out of settling while recoverPlan holds the
    // re-acquired locks mid-rename.
    if(!running&&settled&&!(plan as any).recovering&&['interrupted','running'].includes(plan.state)){plan.state=all?'verified':'skipped';this.repo.put('plan',id,plan,plan.state);this.repo.releaseReconciled(id);this.invalidate(id);}
    return {plan,receipts:this.repo.receipts(id)};
  }
  async recoverPlan(id:string,actor:Actor){
    const plan=this.repo.get<CleanupPlan>('plan',id);if(!plan||plan.actorId!==actor.actorId||!this.cleaner)throw new MaintenanceError('Plan no encontrado',404);
    if(plan.state==='running')throw new MaintenanceError('El plan sigue trabajando; cancelá y comprobá su resultado primero');
    if(plan.state!=='interrupted')throw new MaintenanceError('No hay una operación interrumpida que recuperar',409);
    // 'recovering' keeps reconcilePlanOnce from settling the plan — and
    // dropping these re-acquired locks — while the recover worker is mid-rename.
    this.repo.exclusiveRecovery(id,plan.steps.flatMap(s=>s.locks),()=>this.repo.put('plan',id,{...plan,recovering:true},'interrupted'));
    try{
      const saved=this.repo.receipts(id) as Receipt[];
      for(const step of plan.steps)if(!saved.some(r=>r.stepId===step.id))this.repo.receipt(id,step.id,{stepId:step.id,state:'skipped',message:'Este paso no se inició; no se reanuda durante la recuperación'});
      for(const step of plan.steps){
        const receipt=saved.find(r=>r.stepId===step.id);
        if(!step.taskId||!receipt||!['interrupted','skipped','running'].includes(receipt.state))continue;
        // Never-launched or already-terminal tasks have nothing to restore; a
        // 'skipped' receipt is terminal unless the worker still holds leftovers.
        const current=await this.cleaner.status(step);this.repo.receipt(id,step.id,current);
        if(current.state!=='interrupted'&&!(current.state==='skipped'&&current.partialPath)){this.retire(step,current.state);continue;}
        try{const after=await this.cleaner.recover(step);this.repo.receipt(id,step.id,after);this.retire(step,after.state);}catch(e){throw new MaintenanceError(e instanceof Error?e.message:'Recuperación incompleta');}
      }
      const receipts=this.repo.receipts(id) as Receipt[];
      if(receipts.length===plan.steps.length&&receipts.every(r=>['restored','verified','skipped','failed'].includes(r.state))&&receipts.some(r=>r.state==='restored')){plan.state='restored';delete (plan as any).recovering;this.repo.put('plan',id,plan,'restored');this.repo.releaseReconciled(id);}
      else if(receipts.length===plan.steps.length&&receipts.every(r=>r.state==='verified')){plan.state='verified';delete (plan as any).recovering;this.repo.put('plan',id,plan,'verified');this.repo.releaseReconciled(id);}
      else this.repo.put('plan',id,{...this.repo.get<CleanupPlan>('plan',id)!,state:'interrupted',recovering:undefined},'interrupted');
      this.invalidate(id);void this.cleaner.sweep();
      return {plan,receipts};
    }catch(e){
      this.repo.put('plan',id,{...this.repo.get<CleanupPlan>('plan',id)!,state:'interrupted',recovering:undefined},'interrupted');this.invalidate(id);
      throw e;
    }
  }
  /** Escape hatch for locks retained by an interrupted plan the admin already reviewed. */
  async releaseLocks(id:string,actor:Actor){
    const plan=this.repo.get<CleanupPlan>('plan',id);
    if(!plan||plan.actorId!==actor.actorId)throw new MaintenanceError('Plan no encontrado',404);
    if(plan.state==='running')throw new MaintenanceError('El plan sigue trabajando; cancelá y comprobá su resultado primero');
    // A ledger 'interrupted' can hide a live detached worker (a transient
    // status timeout marks it, the worker keeps purging). Freeing inode locks
    // while it runs would let a doomed second op be prepared on the same tree.
    // The 'recovering' flag extends that doubt: the recover worker renames
    // staged leftovers while its receipt still reads 'interrupted'.
    const recovering=!!(plan as any).recovering;
    if(this.cleaner)for(const step of plan.steps){
      if(!step.taskId)continue;
      try{
        const current=await this.cleaner.status(step);
        if(current.state==='running'||(recovering&&current.state==='interrupted'))throw new MaintenanceError('El worker del host sigue activo; no se liberan los bloqueos',409);
      }catch(e){if(e instanceof MaintenanceError)throw e;}
    }
    this.repo.releaseReconciled(id);this.invalidate(id);
    return {plan,receipts:this.repo.receipts(id)};
  }
  async cancelPlan(id:string,actor:Actor){
    const plan=this.repo.get<CleanupPlan>('plan',id);
    if(!plan||plan.actorId!==actor.actorId)throw new MaintenanceError('Plan no encontrado',404);
    this.repo.put('plan-control',id,{cancel:true});this.invalidate(id);
    for(const step of plan.steps){
      const receipts=this.repo.receipts(id) as Receipt[];
      // Probe any step with a live taskId — a worker may still be alive under
      // an 'interrupted' receipt (transient status timeout), not just 'running'.
      if(step.taskId&&receipts.some(r=>r.stepId===step.id&&['running','interrupted'].includes(r.state)))await this.cleaner?.cancel(step);
    }
    return {plan,receipts:this.repo.receipts(id)};
  }
}
export function publicCandidate(c:Candidate){const {identity,...rest}=c;return {...rest,path:identity.canonicalPath};}
