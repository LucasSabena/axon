import { describe,test,expect } from 'bun:test';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { PlatformStore } from './store';
import { ProjectHub,relate,inside, type HubContainer } from './projects';
import { Diagnostics } from './diagnostics';
import { machineApi,redactLog } from './api';
import { auditMutations } from './audit';

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(),'axon-platform-test-'));
  const store = new PlatformStore(path.join(dir,'state'));
  const projects:any[] = [{id:'demo',name:'Demo',cwd:path.join(dir,'demo'),type:'node',port:1234},{id:'other',name:'Otro',cwd:path.join(dir,'other'),type:'node'}];
  await mkdir(projects[0].cwd);
  const hub = new ProjectHub(store,{projects:() => projects,processes:async() => [],containers:async() => [],domains:() => [],home:async() => dir,chats:async() => ({ok:true,items:[]}),consumption:async() => ({ok:true,summary:{requests:0}})});
  const diagnostics = new Diagnostics(hub,{http:async() => ({ok:false,status:502,ms:1}),tcp:async() => ({ok:false,ms:1,error:'Fixture: puerto cerrado'})});
  const api = machineApi({store,hub,diagnostics,logs:async() => ['API_KEY=private']});
  const token = store.createToken({name:'CI Demo',days:1,grants:[{projectId:'demo',scopes:['projects:read','diagnostics:run','audit:read']}]},'owner',['demo','other']).token;
  const request = (url:string,options:RequestInit = {},credential = token) => api.request(url,{...options,headers:{authorization:`Bearer ${credential}`,...options.headers}});
  return {dir,store,hub,diagnostics,api,token,request,close:async() => {store.close();await rm(dir,{recursive:true,force:true});}};
}
describe('AXON platform isolation and evidence',() => {
  test('Agent discovery documents exact token coverage without turning project access into administration',async()=>{
    const f=await fixture();try{
      const catalog=await(await f.request('/capabilities')).json();expect(catalog.apiVersion).toBe('v1');expect(catalog.permissions.projects.map((p:any)=>p.projectId)).toEqual(['demo']);expect(catalog.coverage.administrativeAccess).toBe(false);expect(catalog.routes.some((r:any)=>r.path.includes('/cloud/'))).toBe(false);expect(catalog.tools.some((t:any)=>t.name==='axon_project_logs')).toBe(false);expect(catalog.tools.some((t:any)=>t.name==='axon_capabilities')).toBe(true);expect(JSON.stringify(catalog)).not.toContain(f.token);
      const call=(method:string,params:any={})=>f.request('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
      expect((await(await call('initialize')).json()).result.instructions).toContain('axon_capabilities');
      const capabilities=await(await call('tools/call',{name:'axon_capabilities',arguments:{}})).json();expect(capabilities.result.structuredContent.routes).toEqual(catalog.routes);
      expect((await(await call('tools/call',{name:'axon_capabilities',arguments:{admin:true}})).json()).error.code).toBe(-32602);
    }finally{await f.close();}
  });
  test('More than 120 rapid REST/MCP reads succeed; exhausted bursts return a short, identifiable retry',async()=>{
    const f=await fixture();try{
      for(let n=0;n<160;n++){const r=await f.request('/projects');expect(r.status).toBe(200);expect(r.headers.get('X-Axon-Limit-Per-Minute')).toBe('1200');}
      for(let n=0;n<500;n++){const r=await f.request('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:n,method:'ping'})});if(r.status===429){expect(r.headers.get('Retry-After')).toBe('1');expect(await r.json()).toMatchObject({code:'axon-api-limit',lane:'read',reason:'rate'});return;}expect(r.status).toBe(200);}
      throw new Error('Expected read burst exhaustion');
    }finally{await f.close();}
  });
  test('tokens are hashed, resource scoped, revocable, durable and never cookie-authenticated',async() => {
    const f = await fixture();
    try {
      expect(JSON.stringify(f.store.tokens())).not.toContain(f.token);
      expect(f.store.authenticate(f.token)?.name).toBe('CI Demo');
      expect((await f.request('/projects')).status).toBe(200);
      expect((await (await f.request('/projects')).json()).projects.map((p:any) => p.id)).toEqual(['demo']);
      expect((await f.request('/projects/other')).status).toBe(403);
      expect((await f.request('/projects/demo/logs')).status).toBe(403);
      f.hub.project('demo').command='TOKEN=PRIVATE launch';
      expect(JSON.stringify(await (await f.request('/projects/demo')).json())).not.toContain('PRIVATE');
      expect((await f.api.request('/projects',{headers:{cookie:'axon_session=fake'}})).status).toBe(401);
      expect((await f.request('/config')).status).toBe(404);
      const identity = f.store.authenticate(f.token)!;f.store.revoke(identity.id,'owner');
      expect((await f.request('/projects')).status).toBe(401);
      const other = new PlatformStore(path.join(f.dir,'state'));expect(other.tokens()[0].revoked).toBe(true);other.close();
    } finally {await f.close();}
  });
  test('expiration and grant validation fail closed',async() => {
    const f = await fixture();try {
      expect(() => f.store.createToken({name:'bad',days:0,grants:[]},'owner',['demo'])).toThrow();
      expect(() => f.store.createToken({name:'bad',days:1,grants:[{projectId:'*',scopes:['projects:read']}]},'owner',['demo'])).toThrow();
      expect(() => f.store.createToken({name:'bad',days:1,grants:[{projectId:'demo',scopes:['shell:root']}]},'owner',['demo'])).toThrow();
      const row = f.store.db.query('SELECT id,payload FROM tokens').get() as any;const payload = JSON.parse(row.payload);payload.expiresAt = Date.now()-1;
      f.store.db.query('UPDATE tokens SET payload=? WHERE id=?').run(JSON.stringify(payload),row.id);
      expect(f.store.authenticate(f.token)).toBeNull();
    } finally {await f.close();}
  });
  test('filesystem links are segment aware and manual relations do not infer unrelated containers',() => {
    expect(inside('/home/u/demo-evil','/home/u/demo')).toBe(false);
    expect(inside('/home/u/demo/api','/home/u/demo')).toBe(true);
    const project:any = {id:'demo',name:'Demo',cwd:'/home/u/demo'};
    const c = (id:string,source:string):HubContainer => ({id,name:id,image:'fixture',state:'running',health:null,ports:[],configFiles:[],mounts:[{source,destination:'/app',type:'bind'}],dependsOn:[]});
    expect(relate(project,[],[c('real','/home/u/demo/data'),c('unrelated','/home/u')],[]).containers.map(c => c.id)).toEqual(['real']);
    expect(relate(project,[],[c('db','/var/lib/docker')],[],{containers:['db'],domains:[]}).containers[0].relation).toBe('manual');
  });
  test('diagnosis checks actual probes, preserves unknown coverage and executes zero mutations',async() => {
    const f = await fixture();try {
      const report = await f.diagnostics.run('demo','owner');expect(report.status).toBe('attention');expect(report.operationalCommandsRun).toBe(0);
      expect(report.checks.find((c:any) => c.key === 'port:1234').state).toBe('fail');
      f.hub.sources.containers = async() => {throw new Error('Offline');};
      const next = await f.diagnostics.run('demo','owner');expect(next.checks.find((c:any) => c.key === 'docker').state).toBe('unknown');
      expect(f.store.audit('demo').entries.length).toBe(2);
    } finally {await f.close();}
  });
  test('MCP tools enforce grants on each call, reject injected params and conform to JSON-RPC transport',async() => {
    const f = await fixture();try {
      const call = (value:any,headers = {}) => f.request('/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...headers},body:JSON.stringify(value)});
      const init = await (await call({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}})).json();expect(init.result.capabilities.tools).toEqual({listChanged:false});
      expect((await call({jsonrpc:'2.0',method:'notifications/initialized'})).status).toBe(202);
      const tools = await (await call({jsonrpc:'2.0',id:2,method:'tools/list'})).json();expect(tools.result.tools.some((t:any) => t.name === 'axon_project_logs')).toBe(false);
      const denied = await (await call({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'axon_project_status',arguments:{projectId:'other'}}})).json();expect(denied.result.isError).toBe(true);
      const injected = await (await call({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'axon_diagnose_project',arguments:{projectId:'demo',command:'rm'}}})).json();expect(injected.error.code).toBe(-32602);
      expect((await call({jsonrpc:'2.0',id:1,method:'ping'},{origin:'https://evil.test'})).status).toBe(403);
      expect((await f.request('/mcp')).status).toBe(405);
      const diag = await (await call({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'axon_diagnose_project',arguments:{projectId:'demo'}}})).json();expect(diag.result.structuredContent.operationalCommandsRun).toBe(0);
    } finally {await f.close();}
  });
  test('audit survives a new connection, paginates and captures actor/results without bodies or URL secrets',async() => {
    const f = await fixture();try {
      const app = new Hono();app.use('*',async(c,next) => {c.set('user','owner');await next();});app.use('*',auditMutations(f.store));
      app.post('/api/action',c => c.json({ok:false},409));
      await app.request('/api/action?token=PRIVATE',{method:'POST',body:'PASSWORD_PRIVATE'});
      const entries = f.store.audit().entries;expect(entries[0].status).toBe('failed');expect(entries[0].actor).toBe('owner');expect(JSON.stringify(entries)).not.toContain('PRIVATE');
      const next = new PlatformStore(path.join(f.dir,'state'));expect(next.audit().entries[0].httpStatus).toBe(409);
      const first = next.audit(undefined,undefined,1);expect(next.audit(undefined,first.next!,1).entries[0].id).not.toBe(first.entries[0].id);next.close();
      expect(redactLog('token=private Authorization: Bearer secret')).not.toContain('private');
      expect(redactLog('Authorization: Bearer PRIVATE')).not.toContain('PRIVATE');
      expect(redactLog('{"token":"PRIVATE"} postgres://u:PRIVATE@localhost/db')).not.toContain('PRIVATE');
    } finally {await f.close();}
  });
});
