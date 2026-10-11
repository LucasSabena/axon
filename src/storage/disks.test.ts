import {test,expect} from 'bun:test';
import {DiskManager,fixtureDiskRunner,registerDiskRoutes} from './disks';
import {Hono} from 'hono';
const actor={actorId:'qa',sessionId:'session'};
test('QA plans are session bound and single use, with explicit physical confirmation',async()=>{
 const manager=new DiskManager(fixtureDiskRunner()),inventory=await manager.inventory();expect(inventory.fixture).toBe(true);
 await expect(manager.plan({diskId:'fixture-system',operation:'layout'},actor)).rejects.toThrow('protegido');
 const {plan}=await manager.plan({diskId:'fixture-new',operation:'layout',partitions:[{name:'DATOS',filesystem:'ext4',sizeMiB:null}]},actor);
 await expect(manager.start(plan.id,plan.digest,'CONFIRMAR',actor)).rejects.toThrow('revisión');
 await expect(manager.start(plan.id,plan.digest,plan.confirmation,{...actor,sessionId:'other'})).rejects.toThrow('sesión');
 expect((await manager.start(plan.id,plan.digest,plan.confirmation,actor)).operation.state).toBe('verified');
 await expect(manager.start(plan.id,plan.digest,plan.confirmation,actor)).rejects.toThrow('revisión');
 expect((await manager.history(actor)).operations).toHaveLength(1);
});
test('disk mutation APIs reject unauthenticated, cross-origin and unexpected fields before helper',async()=>{
 let calls=0;const manager=new DiskManager(async()=>{calls++;return {ok:true};});
 const app=new Hono();app.use('*',async(c,next)=>{if(c.req.header('cookie'))c.set('user','qa');await next();});registerDiskRoutes(app,manager);
 const req=(cookie:string|undefined,origin:string|undefined,b:unknown)=>app.request('http://localhost/api/storage/disks/plans',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:JSON.stringify(b)});
 expect((await req(undefined,'http://localhost',{})).status).toBe(401);
 expect((await req('axon_session=test','https://foreign.example',{})).status).toBe(403);
 expect((await req('axon_session=test','http://localhost',{diskId:'test',operation:'layout',command:'mkfs'})).status).toBe(400);
 expect(calls).toBe(0);
});
