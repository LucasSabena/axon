import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Hono} from 'hono';
import {PlatformStore} from './store';
import {apiPolicy} from './api-policy';
import {machineApi,registerPlatformRoutes} from './api';
import {usageRoute} from './api-usage';

async function fixture(){const dir=await mkdtemp(path.join(tmpdir(),'axon-access-test-')),store=new PlatformStore(dir+'/state');const hub:any={sources:{projects:()=>[{id:'one',name:'Uno'},{id:'two',name:'Dos'}]},project:(id:string)=>({id}),resources:async()=>({project:{id:'one'}})};const deps:any={store,hub,diagnostics:{},logs:async()=>[]};const app=new Hono();app.use('/api/access/*',async(c,next)=>{c.set('user',c.req.header('x-test-owner')||'owner');await next();});registerPlatformRoutes(app,deps);app.route('/api/v1',machineApi(deps));const made=store.createToken({name:'Agent',days:30,grants:[{projectId:'one',scopes:['projects:read']}]},'owner',['one','two']);const call=(p:string,options:RequestInit={})=>app.request('/api/v1'+p,{...options,headers:{authorization:'Bearer '+made.token,...options.headers}});return {dir,store,app,made,call,close:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};}
test('Configuration preserves secret, validates all permissions and rejects stale or foreign writes',async()=>{const f=await fixture();try{
  const id=f.made.identity.id;
  const update=(body:any,owner='owner')=>f.app.request('/api/access/tokens/'+id,{method:'PATCH',headers:{'content-type':'application/json','x-test-owner':owner},body:JSON.stringify(body)});
  expect((await update({revision:1,name:'changed'},'other')).status).toBe(404);
  expect((await update({revision:1,policy:{dailyRequests:-1}})).status).toBe(400);
  expect(f.store.authenticate(f.made.token)?.name).toBe('Agent');
  const r=await update({revision:1,name:'Agent nuevo',description:'CI',grants:[{projectId:'two',scopes:['logs:read']}],policy:{limits:{read:{perMinute:10,burst:2,concurrent:1}},dailyRequests:3}});expect(r.status).toBe(200);
  const identity=f.store.authenticate(f.made.token)!;expect(identity.revision).toBe(2);expect(identity.grants[0].projectId).toBe('two');expect(identity.policy?.dailyRequests).toBe(3);
  expect((await update({revision:1,name:'stale'})).status).toBe(409);
  expect((await f.call('/projects/one')).status).toBe(403);
  expect((await update({revision:2,paused:true})).status).toBe(200);expect((await f.call('/projects')).status).toBe(401);
  expect((await update({revision:3,paused:false})).status).toBe(200);expect(f.store.authenticate(f.made.token)).not.toBeNull();
}finally{await f.close();}});
test('Rotation replaces hash immediately, preserves history and never returns the secret from reads',async()=>{const f=await fixture();try{
  await f.call('/projects');const id=f.made.identity.id;
  const r=await f.app.request('/api/access/tokens/'+id+'/rotate',{method:'POST',body:JSON.stringify({revision:1})}),d=await r.json();expect(r.status).toBe(200);expect(d.token).not.toBe(f.made.token);expect(f.store.authenticate(f.made.token)).toBeNull();expect(f.store.authenticate(d.token)?.id).toBe(id);
  expect(()=>f.store.assertActive(f.made.identity)).toThrow();
  const report=await(await f.app.request('/api/access/tokens')).json();expect(JSON.stringify(report)).not.toContain(d.token);expect(report.tokens[0].usage.totals.requests).toBe(1);
  expect((await f.app.request('/api/access/usage?token='+id,{headers:{'x-test-owner':'other'}})).status).toBe(404);
  f.store.revoke(id,'owner');expect(f.store.authenticate(d.token)).toBeNull();expect(()=>f.store.rotateToken(id,2,'owner')).toThrow();
}finally{await f.close();}});
test('Daily quota is exact across restarts; telemetry counts JSON/MCP errors without secrets or URL parameters',async()=>{const f=await fixture();try{
  const id=f.made.identity.id;f.store.updateToken(id,{revision:1,policy:{dailyRequests:3}},'owner',['one','two']);
  await f.call('/projects?token=PRIVATE');
  await f.call('/projects/two');
  await f.call('/mcp',{method:'POST',headers:{accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bad_PRIVATE'}})});
  const blocked=await f.call('/projects');expect(blocked.status).toBe(429);expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  const report:any=f.store.usage.report([id]);expect(report.totals.requests).toBe(4);expect(report.totals.errors).toBe(3);expect(report.totals.limited).toBe(1);expect(report.totals.bytesOut).toBeGreaterThan(0);expect(JSON.stringify(report)).not.toContain('PRIVATE');expect(JSON.stringify(report)).not.toContain(f.made.token);
  const restarted=new PlatformStore(f.dir+'/state');expect(()=>restarted.usage.reserve(id,3)).toThrow();expect(restarted.usage.report([id]).totals).toEqual(report.totals);restarted.close();
}finally{await f.close();}});
test('Configured rate buckets and validation apply to REST, MCP and capability discovery',async()=>{const f=await fixture();try{
  expect(()=>apiPolicy({limits:{read:{perMinute:1,burst:2,concurrent:1}}})).toThrow();
  expect(()=>apiPolicy({limits:{root:{perMinute:1}}})).toThrow();
  f.store.updateToken(f.made.identity.id,{revision:1,policy:{limits:{read:{perMinute:1,burst:1,concurrent:1}}}},'owner',['one','two']);
  const d=await(await f.call('/capabilities')).json();expect(d.limits.lanes.read.perMinute).toBe(1);expect((await f.call('/projects')).status).toBe(429);
  expect(usageRoute('GET','/projects/private-id/logs')).toBe('GET /projects/:id/logs');expect(usageRoute('GET','/unknown/PRIVATE')).toBe('GET unknown');
}finally{await f.close();}});
test('Download accounting measures streamed bytes once on completion and cancellation',async()=>{const f=await fixture();try{
  const cloud:any={content:async()=>({response:new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([1,2,3,4]));c.close();}})),metadata:{name:'fixture.bin'}})};
  const api=machineApi({store:f.store,hub:{} as any,diagnostics:{} as any,logs:async()=>[],cloud});
  const r=await api.request('/cloud/dropbox/content?path=/PRIVATE',{headers:{authorization:'Bearer '+f.made.token}});expect(f.store.usage.report([f.made.identity.id]).totals).toMatchObject({requests:0});expect(new Uint8Array(await r.arrayBuffer())).toHaveLength(4);
  const report:any=f.store.usage.report([f.made.identity.id]);expect(report.totals.bytesOut).toBe(4);expect(report.totals.requests).toBe(1);expect(JSON.stringify(report)).not.toContain('PRIVATE');
  const cancelled=await api.request('/cloud/dropbox/content',{headers:{authorization:'Bearer '+f.made.token}});await cancelled.body!.cancel();expect(f.store.usage.report([f.made.identity.id]).totals).toMatchObject({requests:2,bytesOut:4});
}finally{await f.close();}});
