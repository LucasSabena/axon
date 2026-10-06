import {describe,test,expect} from 'bun:test';
import {Hono} from 'hono';
import {SoftwareService,registryCandidate,registerSoftwareRoutes,softwareIcon,type SoftwareSnapshot,type SoftwareInstallation} from './software';
const row=(overrides:Partial<SoftwareInstallation>={}):SoftwareInstallation=>({id:'native-unlisted',manager:'pnpm',scope:'user',uid:1001,user:'any-user',root:'/srv/home/custom/global',packageName:'unlisted-tool',name:'Unlisted tool',version:'1.0.0',kind:'tool',executables:['tool'],canUpdate:false,updateState:'unchecked',reason:'',sourceId:'prefix',...overrides});
const snapshot=(installations:SoftwareInstallation[],errors=false):SoftwareSnapshot=>({ok:true,installations,sources:[{id:'prefix',manager:'pnpm',scope:'user',user:'any-user',available:true,complete:!errors,updateState:errors?'error':'ok',error:errors?'Source unavailable':undefined}],checkedAt:Date.now(),home:'/srv/home/custom',user:'any-user',canAdministerSystem:false});
const metadata=async()=>({'dist-tags':{latest:'1.2.0'},time:{'1.2.0':'2020-01-01T00:00:00Z'}});
describe('native software discovery and update contract',()=>{
 test('white vendor marks remain visible in both themes without recoloring native artwork',async()=>{
  const response=await softwareIcon(row({packageName:'@openai/codex'}));
  expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
  const svg=await response.text();expect(svg).toContain('fill="#26333b"');expect(svg).toContain('fill="#FFFFFF"');
  const colored=await softwareIcon(row({packageName:'@shopify/cli'}));expect(await colored.text()).toContain('fill="#7AB55C"');
 });
 test('a program absent from all catalogs is inventoried and gets a native candidate',async()=>{
  const service=new SoftwareService(async()=>snapshot([row()]),async()=>({}),async()=>[],metadata);
  const current=await service.settled();
  expect(current.installations).toHaveLength(1);expect(current.installations[0].canUpdate).toBe(true);
  expect(current.installations[0].targetVersion).toBe('1.2.0');expect(current.installations[0].iconUrl).toStartWith('/api/software/icons/native-unlisted?v=');
 });
 test('system packages deduplicate across accounts, but identical user tools retain separate identities',async()=>{
  const service=new SoftwareService(async req=>snapshot([row({id:'system',manager:'apt',scope:'system'}),row({id:'user:'+req.user,user:String(req.user)})]),async()=>({users:['second-user']}),async()=>[],metadata);
  const current=await service.settled();expect(current.installations.filter(p=>p.id==='system')).toHaveLength(1);expect(current.installations.filter(p=>p.id.startsWith('user:'))).toHaveLength(2);
 });
 test('an inventory refresh preserves checked candidates until the next version check',async()=>{
  const service=new SoftwareService(async()=>snapshot([row()]),async()=>({}),async()=>[],metadata);
  await service.settled();
  // Simulate the inventory TTL expiring while registry results remain valid.
  (service as any).snapshot.checkedAt=Date.now()-61000;
  const current=await service.get();expect(current.installations[0].canUpdate).toBe(true);expect(current.installations[0].targetVersion).toBe('1.2.0');
 });
 test('a failing source retains its last installations and disables execution',async()=>{
  const service=new SoftwareService(async req=>snapshot(req.updates?[]:[row()],!!req.updates),async()=>({}),async()=>[],metadata);
  const current=await service.settled();expect(current.installations).toHaveLength(1);expect(current.installations[0].canUpdate).toBe(false);expect(current.installations[0].updateState).toBe('error');
 });
 test('a failed inventory refresh also retains the last source records',async()=>{
  let failure=false;
  const service=new SoftwareService(async()=>snapshot(failure?[]:[row()],failure),async()=>({}),async()=>[],metadata);
  await service.settled();failure=true;(service as any).snapshot.checkedAt=Date.now()-61000;
  const current=await service.get();expect(current.installations).toHaveLength(1);expect(current.installations[0].updateState).toBe('error');expect(current.installations[0].canUpdate).toBe(false);
 });
 test('registry failure is visible and does not claim the package is current',async()=>{
  const service=new SoftwareService(async()=>snapshot([row()]),async()=>({}),async()=>[],async()=>{throw Error('Network failure');});
  const current=await service.settled();expect(current.installations[0].updateState).toBe('error');expect(current.sources[0].updateState).toBe('error');
 });
 test('registry candidates never cause a downgrade, and unknown or local origins cannot update',async()=>{
  const service=new SoftwareService(async()=>snapshot([row({version:'9.0.0'}),row({id:'linked',updateState:'unmanaged'}),row({id:'unknown',version:null})]),async()=>({}),async()=>[],metadata);
  const current=await service.settled();expect(current.installations.every(p=>!p.canUpdate)).toBe(true);expect(current.installations.find(p=>p.id==='unknown')?.updateState).toBe('unmanaged');
 });
 test('plans use selected physical identities and exact targets, and reject missing IDs or local holds',async()=>{
  const requests:any[]=[];
  const service=new SoftwareService(async req=>{requests.push(req);return req.action==='plan'?{ok:true,transactions:[{manager:'pnpm',scope:'user',user:'any-user',root:'/srv/home/custom/global',items:req.items,argv:[],effects:'',simulation:{complete:false,changes:[],removals:[]}}]}:snapshot([row(),row({id:'held'})]);},async()=>({ignored:['held']}),async()=>[],metadata);
  await expect(service.plan(['missing'])).rejects.toThrow('instalación');
  await expect(service.plan(['held'])).rejects.toThrow('instalación');
  const plan=await service.plan(['native-unlisted','native-unlisted']);
  expect(plan.id).toBeTruthy();expect(plan.transactions[0].items).toHaveLength(1);expect(plan.transactions[0].items[0].targetVersion).toBe('1.2.0');
  expect(requests.findLast(r=>r.action==='plan').settings).toEqual({});
 });
 test('invalid or expired plan IDs never reach a host executor',async()=>{
  let calls=0;const service=new SoftwareService(async()=>{calls++;return snapshot([row()]);},async()=>({}),async()=>[],metadata);
  await expect(service.execute('invented-plan')).rejects.toThrow('plan');expect(calls).toBe(0);
 });
 test('the routes expose native records and reject caller-supplied commands',async()=>{
  const service=new SoftwareService(async()=>snapshot([row()]),async()=>({}),async()=>[],metadata),app=new Hono();registerSoftwareRoutes(app,service);
  expect((await (await app.request('/api/software')).json()).installations[0].packageName).toBe('unlisted-tool');
  const r=await app.request('/api/software/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd:'touch /host/file',planId:'forged'})});expect(r.status).toBe(409);
 });
});
describe('pnpm native publication policies',()=>{
 const data={'dist-tags':{latest:'2.1.0'},time:{'2.0.0':'2026-10-01T00:00:00Z','2.1.0':'2026-10-06T12:00:00Z','3.0.0':'2026-10-01T00:00:00Z'}},now=Date.parse('2026-10-06T13:00:00Z');
 test('minimumReleaseAge chooses an eligible version at or below the latest tag',()=>expect(registryCandidate(data,{packageName:'tool',version:'1.0.0',policy:{minutes:1440,excludes:[]}},now)).toBe('2.0.0'));
 test('package and version glob exclusions are respected',()=>{
  expect(registryCandidate(data,{packageName:'@org/tool',version:'1.0.0',policy:{minutes:1440,excludes:['@org/*']}},now)).toBe('2.1.0');
  expect(registryCandidate(data,{packageName:'tool',version:'1.0.0',policy:{minutes:1440,excludes:['tool@2.*']}},now)).toBe('2.1.0');
 });
 test('missing publication data produces no guessed candidate',()=>expect(registryCandidate({'dist-tags':{latest:'2.1.0'}},{packageName:'tool',version:'1.0.0',policy:{minutes:1440,excludes:[]}},now)).toBeNull());
});
