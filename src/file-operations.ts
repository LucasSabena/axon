import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { HOST_USER, readHostFile } from './host';
import { MaintenanceRepository } from './storage/repository';
import { hostArgv, boundedCommand } from './storage/host-argv';
import { hash, policyRevision, within } from './storage/policy';
import { MaintenanceError, type Actor, type Identity, type Candidate, type ScanRoot, type Step } from './storage/types';
import type { HostCleaner } from './storage/cleaner';
import type { Hono } from 'hono';
import { protect,actor,body,only,requestOrigin } from './storage/http';
export interface TrashItem { id:string;key:string;origin:'xdg'|'legacy';volumePath?:string|null;path:string;identity:Omit<Identity,'canonicalPath'|'mountId'>;name:string;orig:string|null;ts:string|null;canRestore:boolean;allocatedBytes:string|null;error?:string }
export interface FileOperation {id:string;actorId:string;sessionId:string;state:string;at:string;action:'send'|'restore'|'migrate'|'purge';path?:string;item?:TrashItem;receipt?:HelperResult;intent?:Record<string,unknown> }
export interface TrashMigrationPlan {id:string;actorId:string;sessionId:string;createdAt:string;expiresAt:string;policyRevision:string;digest:string;steps:{id:string;key:string;item:TrashItem}[]}
interface HelperResult {ok:boolean;error?:string;state?:'verified'|'restored'|'interrupted'|'failed'|'skipped';identity?:TrashItem['identity'];items?:TrashItem[];dirs?:string[];complete?:boolean;id?:string;fromPath?:string;toPath?:string;retiredBytes?:string;message?:string}
type Runner=(payload:Record<string,unknown>)=>Promise<HelperResult>;
interface FileReceipt extends HelperResult {operationId:string}
export class FileOperations {
 private volumes?:()=>Promise<{path:string;mountId:string|null}[]>;
 onVolumes(callback:()=>Promise<{path:string;mountId:string|null}[]>){this.volumes=callback;}
 private async run(payload:Record<string,unknown>){return this.runner({...payload,volumes:await this.volumes?.()||[]});}
 private beforeWrite?:()=>Promise<void>;
 onBeforeWrite(callback:()=>Promise<void>){this.beforeWrite=callback;}
 private changed?: (action:'send'|'restore'|'purge',from:string,to:string)=>Promise<void>;
 onChanged(callback:(action:'send'|'restore'|'purge',from:string,to:string)=>Promise<void>){this.changed=callback;}
 private purger?:HostCleaner;
 useCleaner(cleaner:HostCleaner){this.purger=cleaner;}
 constructor(readonly repo:MaintenanceRepository,private home:()=>Promise<string>,private runner:Runner=async payload=>{
  const script=await readFile(new URL('./storage/trash-host.py',import.meta.url),'utf8');return JSON.parse(await boundedCommand(hostArgv('python3',['-c',script]),JSON.stringify(payload)));
 }){}
 async location(){return this.home();}
 async list(){const result=await this.run({action:'list',home:await this.home()});if(!result.ok)throw new MaintenanceError(result.error,409);return result as {ok:true;items:TrashItem[];dirs?:string[];complete:boolean};}
 async send(p:string,by:Actor){const home=await this.home();const probe=await this.run({action:'probe',home,path:p});if(!probe.ok)throw new MaintenanceError(probe.error);return this.perform({action:'send',path:p,identity:probe.identity,key:crypto.randomUUID(),home},by);}
 async restore(id:string,by:Actor){const list=await this.list();const found=list.items.filter(i=>i.id===id||i.key===id);if(found.length!==1||!found[0].canRestore)throw new MaintenanceError('No hay un elemento restaurable inequívoco');return this.perform({action:'restore',home:await this.home(),item:found[0]},by);}
 private async resolveItems(ids:unknown){
  if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(i=>typeof i!=='string')||new Set(ids).size!==ids.length)throw new MaintenanceError('Selección inválida',400);
  const listed=await this.list();
  return ids.map(id=>{const m=listed.items.filter(i=>i.id===id||i.key===id);if(m.length!==1)throw new MaintenanceError('El elemento ya no está en la papelera o es ambiguo',409);return m[0];});
 }
 async purge(ids:unknown,by:Actor){
  if(!this.purger)throw new MaintenanceError('El borrado permanente no está habilitado en esta instalación',503);
  const items=await this.resolveItems(ids);const home=await this.home();const id=crypto.randomUUID();
  const op:FileOperation={id,...by,state:'running',at:new Date().toISOString(),action:'purge',intent:{action:'purge',tasks:items.map(i=>({itemId:i.id,path:i.path,taskId:null}))}};
  await this.beforeWrite?.();
  this.repo.exclusive(id,[`files:trash:${hash(home)}`,'files:transfer',...items.map(i=>`inode:${i.identity.device}:${i.identity.inode}`)],()=>this.repo.put('file-operation',id,op,'running'),by.actorId);
  void this.runPurge(id,items).catch(()=>{/* La intención durable conserva los bloqueos; reconcile los asienta. */});
  return {ok:true,operation:{id,state:'running',total:items.length}};
 }
 async empty(root:unknown,by:Actor){
  if(typeof root!=='string')throw new MaintenanceError('Selección inválida',400);
  const home=await this.home();const listed=await this.list();
  const known=[home+'/.local/share/Trash/files',home+'/.local/share/axon-trash',...(listed.dirs||[])];
  if(!known.includes(root))throw new MaintenanceError('Papelera desconocida; actualizá la vista e intentá de nuevo',400);
  const ids=listed.items.filter(i=>path.posix.dirname(i.path)===root).map(i=>i.id);
  if(!ids.length)return {ok:true,operation:null,message:'La papelera ya está vacía.'};
  return this.purge(ids,by);
 }
 private async runPurge(opId:string,items:TrashItem[]){
  let done=0,all=true;
  try{
   for(const item of items){
    const stepId=crypto.randomUUID();
    const root:ScanRoot={id:'trash-purge',path:path.posix.dirname(item.path),title:'Papelera',adapterId:item.origin==='legacy'?'trash-legacy':'trash-xdg'};
    const candidate:Candidate={id:item.id,adapterId:root.adapterId,adapterVersion:1,category:'Papelera',title:item.name,reason:'',complete:true,blockers:[],entries:0,
     identity:{...item.identity,canonicalPath:item.path,mountId:''},allocatedBytes:item.allocatedBytes,logicalBytes:null,reclaimableBytes:null,
     estimateConfidence:'exact',risk:'sensitive',recovery:'none',references:[],requiredCapabilities:[]};
    const prepared=await this.purger!.prepare(candidate,root,{metadata:item.canRestore,quiet:false});
    if('blocker' in prepared){all=false;this.repo.receipt(opId,stepId,{stepId,state:'skipped',message:`${item.name}: ${prepared.blocker}`});continue;}
    const op=this.repo.get<FileOperation>('file-operation',opId)!;
    const tasks=((op.intent!.tasks as {itemId:string;taskId:string|null}[])).map(t=>t.itemId===item.id?{...t,taskId:prepared.taskId}:t);
    this.repo.put('file-operation',opId,{...op,intent:{action:'purge',tasks}},'running');
    this.repo.receipt(opId,stepId,{stepId,state:'running',taskId:prepared.taskId,message:'Intención durable antes del borrado'});
    const step:Step={id:stepId,adapterId:root.adapterId,actionId:'host-clean',candidate,locks:[],interruptions:[],expectedRecovery:'none',taskId:prepared.taskId};
    await this.purger!.start(step);
    let receipt=await this.purger!.status(step);
    while(receipt.state==='running'){await Bun.sleep(400);receipt=await this.purger!.status(step);}
    this.repo.receipt(opId,stepId,receipt);
    if(receipt.state==='interrupted'){
     const current=this.repo.get<FileOperation>('file-operation',opId)!;
     this.repo.put('file-operation',opId,{...current,state:'interrupted',receipt:{ok:false,state:'interrupted',message:'Borrado interrumpido: el bloqueo se conserva. Comprobá el resultado real antes de reintentar.'}},'interrupted');
     return;
    }
    if(receipt.state!=='verified')all=false;else{done++;try{await this.changed?.('purge',item.path,'');}catch{/* El recibo queda; el evento es secundario. */}}
   }
   const op=this.repo.get<FileOperation>('file-operation',opId)!;
   const state=all?'verified':'skipped';
   this.repo.put('file-operation',opId,{...op,state,receipt:{ok:all,state,retiredBytes:'0',message:all?`Borrado definitivo verificado: ${done} ${done===1?'elemento':'elementos'}. Irreversible.`:`Borrado parcial: ${done} de ${items.length} eliminados; el resto se conservó para revisar.`}},state);
   this.repo.release(opId);
  }catch{
   try{const op=this.repo.get<FileOperation>('file-operation',opId);if(op)this.repo.put('file-operation',opId,{...op,state:'interrupted',receipt:{ok:false,state:'interrupted',message:'Borrado interrumpido. Se conserva la intención y el bloqueo.'}},'interrupted');}catch{/* Ledger unavailable. */}
  }
 }
 async operationStatus(id:string,by:Actor){
  const op=this.repo.get<FileOperation>('file-operation',id);
  if(!op||op.actorId!==by.actorId||op.sessionId!==by.sessionId)throw new MaintenanceError('Operación no encontrada para esta sesión',404);
  let receipts=this.repo.receipts(id) as ({stepId:string;state:string;taskId?:string;message:string}&Record<string,unknown>)[];
  if(op.action==='purge'&&op.state==='running'&&this.purger){
   for(const r of receipts){
    if(r.state!=='running'||!r.taskId)continue;
    try{
     const fresh=await this.purger.status({id:r.stepId,taskId:r.taskId} as Step);
     if(fresh.state!=='running')this.repo.receipt(id,r.stepId,{...r,...fresh,stepId:r.stepId});
    }catch{/* status indisponible; conservar el recibo */}
   }
   receipts=this.repo.receipts(id) as typeof receipts;
  }
  const {actorId,sessionId,intent,...pub}=op;
  return {operation:pub,receipts:receipts.map(({taskId,...r})=>r)};
 }
 async planMigration(ids:unknown,by:Actor):Promise<TrashMigrationPlan>{
  if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(i=>typeof i!=='string')||new Set(ids).size!==ids.length)throw new MaintenanceError('Selección inválida',400);
  const listed=await this.list(),excluded=this.repo.get<string[]>('settings','exclusions')||[];
  const items=ids.map(id=>listed.items.find(i=>i.id===id));
  if(items.some(i=>!i||i.origin!=='legacy'||!i.canRestore))throw new MaintenanceError('Seleccioná sólo elementos legacy con origen válido');
  if(items.some(i=>excluded.some(p=>within(i!.path,p)||!!i!.orig&&within(i!.orig,p))))throw new MaintenanceError('La selección contiene una ruta excluida');
  const plan:TrashMigrationPlan={id:crypto.randomUUID(),...by,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+5*60_000).toISOString(),policyRevision:policyRevision(excluded),digest:'',steps:(items as TrashItem[]).map(item=>({id:crypto.randomUUID(),key:crypto.randomUUID(),item}))};
  plan.digest=hash({...plan,digest:undefined});this.repo.put('trash-migration-plan',plan.id,plan);return plan;
 }
 async executeMigration(id:string,digest:string,by:Actor){
  const plan=this.repo.get<TrashMigrationPlan>('trash-migration-plan',id);
  if(!plan||plan.actorId!==by.actorId||plan.sessionId!==by.sessionId||plan.digest!==digest)throw new MaintenanceError('El plan no corresponde a esta sesión',403);
  if(hash({...plan,digest:undefined})!==digest)throw new MaintenanceError('La integridad del plan cambió');
  const existing=this.repo.get<FileOperation>('file-operation',id);
  if(existing)return {operation:existing,receipts:this.repo.receipts(id)};
  const policy=()=>policyRevision(this.repo.get<string[]>('settings','exclusions')||[]);
  if(Date.parse(plan.expiresAt)<Date.now()||plan.policyRevision!==policy())throw new MaintenanceError('El plan venció o cambió la política');
  const home=await this.home();let op:FileOperation={id,...by,state:'running',at:new Date().toISOString(),action:'migrate'};
  await this.beforeWrite?.();
  this.repo.exclusive(id,[`files:trash:${hash(home)}`],()=>{
    if(this.repo.get('file-operation',id))throw new MaintenanceError('El plan ya fue utilizado');
    this.repo.put('file-operation',id,op,'running');
  },by.actorId);
  try {
    for(const step of plan.steps){
      if(plan.policyRevision!==policy()){
        op={...op,state:'skipped',receipt:{ok:false,state:'failed',message:'Cambió la política. Se conservaron los elementos restantes; revisá los pasos ya verificados.'}};
        this.repo.put('file-operation',id,op,'skipped');this.repo.release(id);return {operation:op,receipts:this.repo.receipts(id)};
      }
      const intent={action:'migrate',home,item:step.item,key:step.key};op={...op,intent};
      this.repo.put('file-operation',id,op,'running');
      this.repo.receipt(id,step.id,{stepId:step.id,state:'running',message:'Intención durable antes del movimiento'});
      const receipt=await this.run(intent);
      this.repo.receipt(id,step.id,{...receipt,stepId:step.id});
      if(!receipt.ok||receipt.state!=='verified'){
        const state=receipt.state==='failed'?'skipped':'interrupted';op={...op,state,receipt};this.repo.put('file-operation',id,op,state);
        if(state==='skipped')this.repo.release(id);
        return {operation:op,receipts:this.repo.receipts(id)};
      }
    }
    op={...op,state:'verified',receipt:{ok:true,state:'verified',retiredBytes:'0',message:`Migración verificada: ${plan.steps.length} ${plan.steps.length===1?'elemento':'elementos'}. Origen y fecha conservados; no se liberó espacio.`}};
    this.repo.put('file-operation',id,op,'verified');this.repo.release(id);
  } catch {
    op={...op,state:'interrupted',receipt:{ok:false,state:'interrupted',message:'Migración interrumpida. No se repite automáticamente; revisá el resultado real.'}};
    try{this.repo.put('file-operation',id,op,'interrupted');}catch{/* Durable running intent and lock remain. */}
    throw new MaintenanceError('Migración interrumpida: se conserva la intención y el bloqueo',503);
  }
  return {operation:op,receipts:this.repo.receipts(id)};
 }
 async reconcile(id:string,by:Actor){
  const op=this.repo.get<FileOperation>('file-operation',id);
  if(!op||op.actorId!==by.actorId||op.state!=='interrupted')throw new MaintenanceError('No hay una operación interrumpida verificable para este usuario');
  if(!op.intent){
    if(op.action!=='migrate')throw new MaintenanceError('No hay una intención verificable');
    const receipt:HelperResult={ok:true,state:'failed',message:'Se interrumpió antes de guardar la intención del primer paso. No se inició ningún movimiento.'};
    this.repo.put('file-operation',id,{...op,state:'failed',receipt},'failed');this.repo.releaseReconciled(id);return {...receipt,operationId:id};
  }
  if(op.action==='purge'){
   // Asienta cada paso con recibo vivo contra el worker real; los restos
   // conservados vuelven a su lugar en la papelera sin sobrescribir.
   if(!this.purger)throw new MaintenanceError('El borrado permanente no está habilitado en esta instalación',503);
   const tasks=(op.intent.tasks as {itemId:string;taskId:string|null;path:string}[])||[];
   const receipts=this.repo.receipts(id) as ({stepId:string;state:string;taskId?:string}&Record<string,unknown>)[];
   let uncertain=false;
   for(const r of receipts){
    if(!r.taskId||!['running','interrupted'].includes(r.state))continue;
    try{
     let fresh=await this.purger.status({id:r.stepId,taskId:r.taskId} as Step);
     if(fresh.state==='interrupted'){
      try{fresh=await this.purger.recover({id:r.stepId,taskId:r.taskId} as Step);}catch{/* recuperación incierta */}
     }
     this.repo.receipt(id,r.stepId,{...r,...fresh,stepId:r.stepId});
     if(fresh.state==='interrupted')uncertain=true;
    }catch{uncertain=true;}
   }
   const settled=(this.repo.receipts(id) as {state:string}[]).filter(r=>r.state!=='running');
   const done=settled.filter(r=>r.state==='verified').length;
   const state:'interrupted'|'verified'|'skipped'=uncertain?'interrupted':done===tasks.filter(t=>t.taskId).length&&tasks.every(t=>t.taskId)?'verified':'skipped';
   const receipt:HelperResult={ok:state==='verified',state,retiredBytes:'0',message:state==='verified'
    ?`Borrado definitivo reconciliado: ${done} elementos eliminados.`
    :uncertain?'Resultado incierto: el bloqueo se conserva para otra revisión.'
    :`Borrado reconciliado: ${done} eliminados, el resto se conservó en la papelera.`};
   if(state!=='interrupted')this.repo.releaseReconciled(id);
   this.repo.put('file-operation',id,{...op,state,receipt},state);
   return {...receipt,operationId:id};
  }
  const receipt=await this.run({action:'reconcile',home:await this.home(),intent:op.intent});
  if(!receipt.ok||!['verified','restored','failed'].includes(receipt.state||''))throw new MaintenanceError('Todavía no se puede determinar el resultado. El bloqueo se conserva.');
  const state=op.action==='migrate'?'skipped':receipt.state as 'verified'|'restored'|'failed';
  if(op.action==='migrate'){
    const step=this.repo.get<TrashMigrationPlan>('trash-migration-plan',id)?.steps.find(s=>s.key===op.intent!.key);
    if(step)this.repo.receipt(id,step.id,{...receipt,stepId:step.id});
    receipt.message='Se reconcilió el paso interrumpido. El lote no se reanudó; revisá ambas papeleras y prepará otro plan para los elementos restantes.';
  }
  this.repo.put('file-operation',id,{...op,state,receipt},state);this.repo.releaseReconciled(id);
  if(op.action!=='migrate'&&state!=='failed'&&receipt.fromPath&&receipt.toPath)await this.changed?.(op.action,receipt.fromPath,receipt.toPath);
  return {...receipt,operationId:id};
 }
 private async perform(payload:Record<string,unknown>,by:Actor):Promise<FileReceipt>{
  await this.beforeWrite?.();
  const id=crypto.randomUUID();const op:FileOperation={id,...by,state:'running',at:new Date().toISOString(),action:payload.action as 'send'|'restore',path:payload.path as string|undefined,item:payload.item as TrashItem|undefined,intent:payload};
  this.repo.exclusive(id,[`files:trash:${hash(payload.home)}`],()=>this.repo.put('file-operation',id,{...op,intent:payload},'running'),by.actorId);
  try {
   const receipt=await this.run(payload);
   if(!receipt.ok){const failure=receipt.state==='failed'?'failed':'interrupted';this.repo.put('file-operation',id,{...op,state:failure,receipt},failure);if(failure==='failed')this.repo.release(id);throw new MaintenanceError(receipt.error||'Resultado incierto; revisar antes de reintentar');}
   const state=receipt.state==='verified'?'verified':receipt.state==='restored'?'restored':'interrupted';
   this.repo.put('file-operation',id,{...op,state,receipt},state);
   if(state!=='interrupted'){this.repo.release(id);if(op.action!=='migrate'&&receipt.fromPath&&receipt.toPath&&this.changed){try{await this.changed(op.action,receipt.fromPath,receipt.toPath);}catch{receipt.message=(receipt.message||'')+' La operación se verificó; Biblioteca necesita actualizar su índice.';this.repo.put('file-operation',id,{...op,state,receipt},state);}}}
   return {...receipt,operationId:id};
  }catch(e){if(e instanceof MaintenanceError)throw e;try{this.repo.put('file-operation',id,{...op,state:'interrupted'},'interrupted');}catch{/* Ledger unavailable: running intent remains for restart reconciliation. */}throw new MaintenanceError('Operación interrumpida: la intención y el bloqueo se conservan',503);}
 }
}
export async function fileHostHome(){const row=(await readHostFile('/etc/passwd')).split('\n').map(l=>l.split(':')).find(r=>r[0]===HOST_USER);if(!row?.[5]?.startsWith('/')||row[0]==='root')throw new MaintenanceError('Se requiere usuario del host no privilegiado',503);return row[5];}
export function registerSharedTrashRoutes(app:Hono,operations:FileOperations){
 protect(app,'/api/files/trash');
 // Exact send route is not covered by a trailing wildcard on all routers.
 app.use('/api/files/trash',async(c,next)=>{c.header('Cache-Control','private, no-store');actor(c);if(c.req.method==='POST'&&c.req.header('origin')!==requestOrigin(c))return c.json({ok:false,error:'Origen no permitido'},403);await next();});
 app.get('/api/files/trash/info',async c=>{const r=await operations.list();const home=await operations.location();return c.json({...r,items:r.items.map(({identity,...item})=>item),dir:home+'/.local/share/Trash/files',dirs:[...new Set([home+'/.local/share/Trash/files',home+'/.local/share/axon-trash',...(r.dirs||[])])],count:r.items.length});});
 app.post('/api/files/trash',async c=>{const b=await body(c);only(b,['paths']);if(!Array.isArray(b.paths)||!b.paths.length||b.paths.length>100||b.paths.some(p=>typeof p!=='string'||!p.startsWith('/')||p.length>4096))throw new MaintenanceError('Selección inválida',400);const items:unknown[]=[],failed:unknown[]=[];
  for(const p of b.paths){try{const r=await operations.send(p,actor(c));if(r.state!=='verified')throw new Error();items.push({orig:p,trashed:r.id,name:p.split('/').pop(),operationId:r.operationId});}catch(e){failed.push({path:p,...(e instanceof MaintenanceError?await e.getResponse().json():{error:'Resultado pendiente de revisión'})});break;}}
  return c.json({ok:true,items,failed});
 });
 app.post('/api/files/trash/restore',async c=>{const b=await body(c);only(b,['ids']);if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>100||b.ids.some(id=>typeof id!=='string'))throw new MaintenanceError('Selección inválida',400);const restored:unknown[]=[],failed:unknown[]=[];
  for(const id of b.ids){try{const r=await operations.restore(id,actor(c));restored.push({from:r.fromPath,to:r.toPath,operationId:r.operationId});}catch(e){failed.push({id,...(e instanceof MaintenanceError?await e.getResponse().json():{error:'Resultado pendiente de revisión'})});break;}}
  return c.json({ok:true,restored,failed});
 });
 app.post('/api/files/trash/purge',async c=>{const b=await body(c);only(b,['ids']);return c.json(await operations.purge(b.ids,actor(c)),202);});
 app.get('/api/files/trash/operations/:id',async c=>c.json(await operations.operationStatus(c.req.param('id'),actor(c))));
 app.post('/api/files/trash/empty',async c=>{const b=await body(c);only(b,['root']);return c.json(await operations.empty(b.root,actor(c)),202);});
}
