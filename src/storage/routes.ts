import type { Hono } from 'hono';
import type { FileOperations, TrashMigrationPlan } from '../file-operations';
import { nativeToolInventory } from './tool-inventory';
import { activityEvidence } from './activity';
import type { Scan, CleanupPlan } from './types';
import { MaintenanceError } from './types';
import { StorageService, publicCandidate } from './service';
import { protect, actor, body, only, textField } from './http';
function summary(scan:Scan){const {result,...rest}=scan;return {...rest,...(result?{result:{...result,candidates:undefined,count:result.candidates.length}}:{})};}
/** Short-TTL memoizers for endpoints that spawn host work (process sweeps, workers). */
function cached<T>(fn:()=>Promise<T>,ms:number){let at=0,v:Promise<T>|null=null;return ()=>{if(!v||Date.now()-at>ms){at=Date.now();v=fn();v.catch(()=>{v=null;});}return v;};}
function cachedBy<T>(fn:(k:string)=>Promise<T>,ms:number){const m=new Map<string,{at:number;v:Promise<T>}>();return (k:string)=>{const h=m.get(k);if(h&&Date.now()-h.at<ms)return h.v;const v=fn(k);v.catch(()=>{if(m.get(k)?.v===v)m.delete(k);});if(m.size>=64)m.delete(m.keys().next().value!);m.set(k,{at:Date.now(),v});return v;};}
export function registerStorageRoutes(app:Hono,service:StorageService,files?:FileOperations){
  protect(app,'/api/storage');
  const tools=cached(()=>nativeToolInventory(),10000);
  const roots=cached(()=>service.roots(),5000);
  const evidence=cachedBy((key:string)=>activityEvidence(JSON.parse(key) as string[]),3000);
  app.post('/api/storage/tools',async c=>{only(await body(c),[]);return c.json({ok:true,...await tools()});});
  app.post('/api/storage/activity',async c=>{const b=await body(c);only(b,['scanId']);const s=service.repo.get<Scan>('scan',textField(b.scanId));if(!s?.result)throw new MaintenanceError('Análisis no disponible');const scanRoots=s.result.candidates.slice(0,50).map(c=>c.identity.canonicalPath);return c.json({ok:true,evidence:await evidence(JSON.stringify(scanRoots)),warning:'Evidencia puntual, no autoriza borrar ni demuestra ausencia futura de uso.'});});
  app.get('/api/storage/trash',async c=>{if(!files)throw new MaintenanceError('Papelera no disponible',503);const result=await files.list();return c.json({...result,items:result.items.map(({identity,...item})=>item)});});
  app.post('/api/storage/file-operations/:id/reconcile',async c=>{if(!files)throw new MaintenanceError('Papelera no disponible',503);only(await body(c),[]);return c.json({ok:true,receipt:await files.reconcile(c.req.param('id'),actor(c))});});
  app.post('/api/storage/trash/restore',async c=>{if(!files)throw new MaintenanceError('Papelera no disponible',503);const b=await body(c);only(b,['id']);return c.json({ok:true,receipt:await files.restore(textField(b.id,300),actor(c))});});
  app.post('/api/storage/trash/migration-plans',async c=>{
    if(!files)throw new MaintenanceError('Papelera no disponible',503);
    const b=await body(c);only(b,['ids']);return c.json({ok:true,plan:publicMigrationPlan(await files.planMigration(b.ids,actor(c)))},201);
  });
  app.post('/api/storage/trash/migration-plans/:id/execute',async c=>{
    if(!files)throw new MaintenanceError('Papelera no disponible',503);
    const b=await body(c);only(b,['digest']);const r=await files.executeMigration(c.req.param('id'),textField(b.digest),actor(c));
    const {id,state,at,action,receipt}=r.operation;return c.json({ok:true,operation:{id,state,at,action,receipt},receipts:r.receipts});
  });
  app.get('/api/storage/overview',async c=>c.json({ok:true,roots:await roots(),capabilities:service.capabilities(),exclusions:service.policy(),scans:service.repo.list<Scan>('scan',20).map(summary)}));
  app.post('/api/storage/scans',async c=>{const b=await body(c);only(b,['rootId']);return c.json({ok:true,scan:await service.scan(textField(b.rootId))},202);});
  app.get('/api/storage/scans/:id',c=>{
    const scan=service.repo.get<Scan>('scan',c.req.param('id'));if(!scan)throw new MaintenanceError('Análisis no encontrado',404);
    const offset=Math.max(0,Math.min(10000,Number(c.req.query('offset'))||0));const q=(c.req.query('q')||'').slice(0,200).toLowerCase();
    const rows=scan.result?.candidates.filter(row=>(row.title+' '+row.category).toLowerCase().includes(q))||[];
    return c.json({ok:true,scan:summary(scan),candidates:rows.slice(offset,offset+50).map(publicCandidate),total:rows.length,offset});
  });
  app.post('/api/storage/scans/:id/cancel',async c=>{only(await body(c),[]);return c.json({ok:true,scan:service.cancel(c.req.param('id'))});});
  app.post('/api/storage/exclusions',async c=>{const b=await body(c);only(b,['paths']);return c.json({ok:true,paths:service.setPolicy(b.paths)});});
  app.post('/api/storage/plans',async c=>{const b=await body(c);only(b,['scanId','ids']);const p=await service.preparePlan(textField(b.scanId),b.ids,actor(c));return c.json({ok:true,plan:publicPlan(p)},201);});
  app.post('/api/storage/plans/:id/execute',async c=>{const b=await body(c);only(b,['digest']);const r=await service.execute(c.req.param('id'),textField(b.digest),actor(c));return c.json({ok:true,plan:publicPlan(r.plan),receipts:r.receipts});});
  app.get('/api/storage/plans/:id',async c=>{
    // reconcilePlan mutates worker state; only same-site fetches may trigger it.
    // Plain navigation (top-level GET, SameSite=Lax cookie) returns stored state.
    const sameSite=c.req.header('x-axon-fetch')!==undefined||c.req.header('sec-fetch-site')==='same-origin';
    if(!sameSite){
      const plan=service.repo.get<CleanupPlan>('plan',c.req.param('id'));
      if(!plan||plan.actorId!==actor(c).actorId)throw new MaintenanceError('Plan no encontrado',404);
      return c.json({ok:true,plan:publicPlan(plan),receipts:service.repo.receipts(plan.id),live:false});
    }
    const r=await service.reconcilePlan(c.req.param('id'),actor(c));return c.json({ok:true,plan:publicPlan(r.plan),receipts:r.receipts});
  });
  app.post('/api/storage/plans/:id/release-locks',async c=>{const b=await body(c);only(b,['confirm']);if(b.confirm!==true)throw new MaintenanceError('Confirmá la liberación de bloqueos',400);const r=await service.releaseLocks(c.req.param('id'),actor(c));return c.json({ok:true,plan:publicPlan(r.plan),receipts:r.receipts});});
  app.post('/api/storage/plans/:id/recover',async c=>{only(await body(c),[]);const r=await service.recoverPlan(c.req.param('id'),actor(c));return c.json({ok:true,plan:publicPlan(r.plan),receipts:r.receipts});});
  app.post('/api/storage/plans/:id/cancel',async c=>{only(await body(c),[]);const r=await service.cancelPlan(c.req.param('id'),actor(c));return c.json({ok:true,plan:publicPlan(r.plan),receipts:r.receipts});});
  app.get('/api/storage/history',c=>c.json({ok:true,fileOperations:service.repo.list<Record<string,unknown>>('file-operation').map(({actorId,sessionId,intent,item,...op})=>({...op,item:item?(({identity,...rest})=>rest)(item as any):undefined})),plans:service.repo.list<CleanupPlan>('plan').map(p=>({...publicPlan(p),receipts:service.repo.receipts(p.id)})),scans:service.repo.list<Scan>('scan').map(summary)}));
}
function publicPlan(p:CleanupPlan){const {actorId,sessionId,steps,...rest}=p;return {...rest,canExecute:steps.every(s=>s.actionId==='fixture-unlink'||s.actionId==='host-clean'),steps:steps.map(({taskId,...s})=>({...s,candidate:publicCandidate(s.candidate)}))};}
function publicMigrationPlan(p:TrashMigrationPlan){const {id,createdAt,expiresAt,digest}=p;return {id,createdAt,expiresAt,digest,steps:p.steps.map(s=>({id:s.id,item:(({identity,...rest})=>rest)(s.item)}))};}
