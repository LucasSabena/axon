import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, access, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Hono } from 'hono';
import { registerAgentArchives } from './agent-archives';
const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function fixture(installed=false) {
  const home=await mkdtemp(path.join(tmpdir(),'axon-archive-'));dirs.push(home);
  // The archive manifest lives next to CONFIG_PATH — in dev .env points at
  // the container path /app/data, which isn't writable outside the container.
  process.env.CONFIG_PATH=path.join(home,'config.json');
  const root=home+'/.config/residual';await mkdir(root,{recursive:true});await writeFile(root+'/config.json','secret fixture');
  const app=new Hono();registerAgentArchives(app,{home:()=>home,agents:()=>[{id:'residual',name:'Residual',root}],installed:async()=>installed,changed:()=>{}});
  return {home,root,app};
}
const post=(app:Hono,url:string,body={})=>app.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('residual cleanup preserves configuration and restore never overwrites another configuration',async()=>{
  const {root,app}=await fixture();expect((await post(app,'/api/agents/residual/archive')).status).toBe(400);
  const response=await post(app,'/api/agents/residual/archive',{confirm:true});expect(response.status).toBe(200);
  const {archive}=await response.json();expect(await readFile(archive.destination+'/config.json','utf8')).toBe('secret fixture');expect(await access(root).then(()=>true,()=>false)).toBe(false);
  await mkdir(root);await writeFile(root+'/config.json','new configuration');
  expect((await post(app,`/api/agent-archives/${archive.id}/restore`)).status).toBe(400);expect(await readFile(root+'/config.json','utf8')).toBe('new configuration');
  await rm(root,{recursive:true});expect((await post(app,`/api/agent-archives/${archive.id}/restore`)).status).toBe(200);expect(await readFile(root+'/config.json','utf8')).toBe('secret fixture');
});
test('installed agents and symlink roots cannot be archived',async()=>{
  const active=await fixture(true);expect((await post(active.app,'/api/agents/residual/archive',{confirm:true})).status).toBe(400);
  const linked=await fixture();await rm(linked.root,{recursive:true});await symlink(active.root,linked.root);
  expect((await post(linked.app,'/api/agents/residual/archive',{confirm:true})).status).toBe(400);expect(await readFile(active.root+'/config.json','utf8')).toBe('secret fixture');
});
test('archive and restore refuse symlinked backup paths',async()=>{
  const linked=await fixture(), other=await fixture();
  await mkdir(linked.home+'/.local/share/axon',{recursive:true});await symlink(other.home,linked.home+'/.local/share/axon/agent-archives');
  expect((await post(linked.app,'/api/agents/residual/archive',{confirm:true})).status).toBe(400);expect(await readFile(linked.root+'/config.json','utf8')).toBe('secret fixture');
  const active=await fixture();const {archive}=await (await post(active.app,'/api/agents/residual/archive',{confirm:true})).json();
  await rm(archive.destination,{recursive:true});await symlink(other.root,archive.destination);
  expect((await post(active.app,`/api/agent-archives/${archive.id}/restore`)).status).toBe(400);expect(await readFile(other.root+'/config.json','utf8')).toBe('secret fixture');
});

async function batchFixture(installed:(id:string)=>Promise<boolean>=async()=>false){
  const home=await mkdtemp(path.join(tmpdir(),'axon-archive-batch-'));dirs.push(home);
  const agents=[{id:'one',name:'One',root:home+'/.config/one'},{id:'two',name:'Two',root:home+'/.config/two'}];
  for(const a of agents){await mkdir(a.root,{recursive:true});await writeFile(a.root+'/config.json',a.id+' original');}
  const app=new Hono();registerAgentArchives(app,{home:()=>home,agents:()=>agents,installed,changed:()=>{}});
  return {home,agents,app};
}
test('batch archives each unique selected residual and every backup is recoverable',async()=>{
  const {agents,app}=await batchFixture();
  const preview=await (await app.request('/api/agent-residuals')).json();expect(preview.residuals.map((r:any)=>r.eligible)).toEqual([true,true]);
  const result=await (await post(app,'/api/agent-residuals/archive',{confirm:true,ids:['one','two','one']})).json();expect(result.ok).toBe(true);expect(result.archives.length).toBe(2);expect(result.failures).toEqual([]);
  for(const archive of result.archives){expect(await readFile(archive.destination+'/config.json','utf8')).toBe(archive.agentId+' original');expect(await access(archive.source).then(()=>true,()=>false)).toBe(false);expect((await post(app,`/api/agent-archives/${archive.id}/restore`)).status).toBe(200);}
  for(const agent of agents)expect(await readFile(agent.root+'/config.json','utf8')).toBe(agent.id+' original');
});
test('a batch with an invalid or installed selection never moves its valid first item',async()=>{
  for(const ids of [['one','unknown'],['one','two']]){
    const {agents,app}=await batchFixture(async id=>id==='two');
    expect((await post(app,'/api/agent-residuals/archive',{confirm:true,ids})).status).toBe(400);
    for(const a of agents)expect(await readFile(a.root+'/config.json','utf8')).toBe(a.id+' original');
  }
});
test('batch validates confirmation, limits and IDs before touching any folder',async()=>{
  const {agents,app}=await batchFixture();
  for(const body of [null,{ids:['one']},{confirm:true,ids:[]},{confirm:true,ids:['one',23]},{confirm:true,ids:Array(51).fill('one')},{confirm:true,ids:'one'}])expect((await post(app,'/api/agent-residuals/archive',body)).status).toBe(400);
  expect(await readFile(agents[0].root+'/config.json','utf8')).toBe('one original');
});
test('an agent installed during the batch is preserved and the result reports partial completion',async()=>{
  let checks=0;
  const {agents,app}=await batchFixture(async id=>id==='two'&&++checks>1);
  const result=await (await post(app,'/api/agent-residuals/archive',{confirm:true,ids:['one','two']})).json();expect(result.archives.map((r:any)=>r.agentId)).toEqual(['one']);expect(result.failures.map((r:any)=>r.id)).toEqual(['two']);expect(result.failures[0].error).toContain('instalado');expect(await readFile(agents[1].root+'/config.json','utf8')).toBe('two original');
});
test('residual list identifies a shared root as blocked and batch cleanup preserves it',async()=>{
  const {home,agents}=await batchFixture();
  const nested=agents[0].root+'/shared';await mkdir(nested);await writeFile(nested+'/config.json','shared original');
  const app=new Hono();registerAgentArchives(app,{home:()=>home,agents:()=>[...agents,{id:'shared',name:'Shared',root:nested,shared:true}],installed:async()=>false,changed:()=>{}});
  const {residuals}=await (await app.request('/api/agent-residuals')).json();expect(residuals.find((r:any)=>r.id==='one').eligible).toBe(false);expect(residuals.find((r:any)=>r.id==='one').reason).toContain('comparte');expect((await post(app,'/api/agent-residuals/archive',{confirm:true,ids:['one','two']})).status).toBe(400);expect(await readFile(nested+'/config.json','utf8')).toBe('shared original');expect(await readFile(agents[1].root+'/config.json','utf8')).toBe('two original');
});
test('bulk and single cleanup share the same lock and cannot archive a folder twice',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  const {app}=await batchFixture(async()=>{entered();await gate;return false;});
  const batch=post(app,'/api/agent-residuals/archive',{confirm:true,ids:['one','two']});await started;
  expect((await post(app,'/api/agents/one/archive',{confirm:true})).status).toBe(409);expect((await post(app,'/api/agent-residuals/archive',{confirm:true,ids:['one']})).status).toBe(409);
  release();expect((await batch).status).toBe(200);
});
