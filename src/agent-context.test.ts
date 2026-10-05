import { test, expect } from 'bun:test';
import { Hono } from 'hono';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { registerAgentContext } from './agent-context';

test('native context adapters: transcript fidelity, incremental search, SQLite versions, memory conflict checks, backups and Engram PATCH', async () => {
  const child=Bun.spawn(['python3','scripts/agent-context-store-test.py'],{stdout:'pipe',stderr:'pipe'});
  const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  expect(code, out+err).toBe(0);
},30_000);

test('context GET query strings cannot invoke memory mutations; responses are private and uncached',async()=>{
  const home=await mkdtemp(path.join(tmpdir(),'axon-context-http-'));
  try{
    const file=path.join(home,'.codex/memories/MEMORY.md');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'Original');
    const app=new Hono();registerAgentContext(app,()=>home);
    const listing=await app.request('/api/agent-context/memories');expect(listing.status).toBe(200);expect(listing.headers.get('cache-control')).toBe('private, no-store');
    const id=(await listing.json()).items[0].id;
    const detail=await (await app.request('/api/agent-context/memories/'+id)).json();
    const query=new URLSearchParams({action:'save',kind:'memories',id,revision:detail.item.revision,content:'Hijacked'});
    const result=await app.request('/api/agent-context/memories/'+id+'?'+query);expect(result.status).toBe(200);expect(await readFile(file,'utf8')).toBe('Original');
    const saved=await app.request('/api/agent-context/memories/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:detail.item.revision,content:'Updated'})});expect(saved.status).toBe(200);expect(await readFile(file,'utf8')).toBe('Updated');
    const conflict=await app.request('/api/agent-context/memories/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:detail.item.revision,content:'Stale'})});expect(conflict.status).toBe(409);expect(await readFile(file,'utf8')).toBe('Updated');
  }finally{await rm(home,{recursive:true,force:true});}
});
