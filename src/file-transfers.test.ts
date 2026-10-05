import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,lstat,link,open,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MaintenanceRepository} from './storage/repository';
import {boundedCommand} from './storage/host-argv';
import {FileTransfers,type TransferRunner} from './file-transfers';
const actor={actorId:'qa',sessionId:'fixture-session'};
async function fixture(){
 const home=await mkdtemp(path.join(tmpdir(),'axon-transfer-fixture-'));const repo=new MaintenanceRepository(home+'/ledger');
 const script=await readFile(new URL('./storage/file-task-host.py',import.meta.url),'utf8');
 const run:TransferRunner=async payload=>{if(payload.home!==home)throw new Error('Fixture home confinement');if(payload.action==='prepare'&&![payload.from,payload.to].every(p=>typeof p==='string'&&(p.startsWith(home+'/')||p.startsWith('/dev/shm/axon-transfer-fixture-'))))throw new Error('Fixture source confinement');return JSON.parse(await boundedCommand(['python3','-c',script],JSON.stringify(payload)));};
 const transfers=new FileTransfers(repo,async()=>home,run);
 return {home,repo,run,transfers,async clean(){repo.close();await rm(home,{recursive:true,force:true});}};
}
async function finished(f:Awaited<ReturnType<typeof fixture>>,id:string){let s=await f.transfers.status(id,actor);const until=Date.now()+15000;while(['running','planned'].includes(s.state)&&Date.now()<until){await Bun.sleep(40);s=await f.transfers.status(id,actor);}return s;}
test('durable copy verifies content, symlinks and hardlinks without following links or overwriting destinations',async()=>{
 const f=await fixture();try{
  await mkdir(f.home+'/source');await writeFile(f.home+'/source/a $() ;\nñ.txt',Buffer.alloc(2*1024*1024,37));await link(f.home+'/source/a $() ;\nñ.txt',f.home+'/source/hard');await symlink('/not-a-real-fixture-target',f.home+'/source/broken');
  const plan=await f.transfers.plan('copy',f.home+'/source',f.home+'/copied',actor);expect(plan.entries).toBe(4);expect(BigInt(plan.logicalBytes)).toBe(4n*1024n*1024n);
  await f.transfers.execute(plan.id,plan.digest,actor);const done=await finished(f,plan.id);expect(done.state).toBe('verified');expect(await readFile(f.home+'/copied/a $() ;\nñ.txt')).toEqual(await readFile(f.home+'/source/a $() ;\nñ.txt'));expect((await lstat(f.home+'/copied/hard')).ino).toBe((await lstat(f.home+'/copied/a $() ;\nñ.txt')).ino);expect((await lstat(f.home+'/copied/broken')).isSymbolicLink()).toBe(true);
  await expect(f.transfers.plan('copy',f.home+'/source',f.home+'/copied',actor)).rejects.toThrow();
 }finally{await f.clean();}
});
test('selected move survives reopening the ledger, updates references once and never repeats the host effect',async()=>{
 const f=await fixture();try{
  await writeFile(f.home+'/from','fixture');let updated=0;f.transfers.onChanged(async()=>{updated++;});const p=await f.transfers.plan('move',f.home+'/from',f.home+'/to',actor);
  await expect(f.transfers.execute(p.id,p.digest,{...actor,sessionId:'different'})).rejects.toThrow('sesión');
  const starts=await Promise.allSettled([f.transfers.execute(p.id,p.digest,actor),f.transfers.execute(p.id,p.digest,actor)]);expect(starts.some(r=>r.status==='fulfilled')).toBe(true);expect((await finished(f,p.id)).state).toBe('verified');
  expect(await readFile(f.home+'/to','utf8')).toBe('fixture');expect(await lstat(f.home+'/from').then(()=>true,()=>false)).toBe(false);
  const other=new MaintenanceRepository(f.home+'/ledger');try{const reopened=new FileTransfers(other,async()=>f.home,f.run);expect((await reopened.status(p.id,actor)).state).toBe('verified');expect((await reopened.execute(p.id,p.digest,actor)).state).toBe('verified');}finally{other.close();}
  expect(updated).toBeGreaterThanOrEqual(1);expect(f.repo.db.query('SELECT COUNT(*) AS n FROM locks').get()).toMatchObject({n:0});
 }finally{await f.clean();}
});
test('cross filesystem move retains a verified original for recovery and preserves sparse allocation',async()=>{
 const f=await fixture();let target:string|undefined;try{
  try{target=await mkdtemp('/dev/shm/axon-transfer-fixture-');}catch{return;}
  if((await lstat(target)).dev===(await lstat(f.home)).dev)return;
  const h=await open(f.home+'/sparse','w');await h.truncate(4*1024*1024);await h.write(Buffer.from('end'),0,3,4*1024*1024-3);await h.close();
  const p=await f.transfers.plan('move',f.home+'/sparse',target+'/sparse',actor);await f.transfers.execute(p.id,p.digest,actor);const done=await finished(f,p.id);expect(done.state).toBe('verified');expect(done.recoveryPath).toBeDefined();expect(await readFile(done.recoveryPath!)).toEqual(await readFile(target+'/sparse'));expect((await lstat(target+'/sparse')).blocks*512).toBeLessThan(4*1024*1024);expect(await lstat(f.home+'/sparse').then(()=>true,()=>false)).toBe(false);
 }finally{if(target)await rm(target,{recursive:true,force:true});await f.clean();}
});
test('inode, content, new entries and ancestor symlink changes after review preserve originals',async()=>{
 const f=await fixture();try{
  await mkdir(f.home+'/source');await writeFile(f.home+'/source/a','before');const p=await f.transfers.plan('copy',f.home+'/source',f.home+'/target',actor);await writeFile(f.home+'/source/new','arrived after plan');await f.transfers.execute(p.id,p.digest,actor);expect((await finished(f,p.id)).state).toBe('failed');expect(await readFile(f.home+'/source/new','utf8')).toBe('arrived after plan');expect(await lstat(f.home+'/target').then(()=>true,()=>false)).toBe(false);
  await mkdir(f.home+'/actual');await writeFile(f.home+'/actual/a','keep');await symlink('actual',f.home+'/alias');await expect(f.transfers.plan('copy',f.home+'/alias/a',f.home+'/b',actor)).rejects.toThrow();
  const p2=await f.transfers.plan('move',f.home+'/actual/a',f.home+'/b',actor);await rm(f.home+'/actual/a');await symlink('/etc/passwd',f.home+'/actual/a');await f.transfers.execute(p2.id,p2.digest,actor);expect((await finished(f,p2.id)).state).toBe('failed');expect((await lstat(f.home+'/actual/a')).isSymbolicLink()).toBe(true);
 }finally{await f.clean();}
});
test('ledger failure before launch and changed reference policy never start a worker',async()=>{
 const f=await fixture();try{
  await writeFile(f.home+'/original','keep');const p=await f.transfers.plan('move',f.home+'/original',f.home+'/target',actor);const put=f.repo.put.bind(f.repo);f.repo.put=()=>{throw new Error('ledger unavailable');};await expect(f.transfers.execute(p.id,p.digest,actor)).rejects.toThrow('ledger');f.repo.put=put;expect(await readFile(f.home+'/original','utf8')).toBe('keep');
  f.transfers.onValidate(async()=>{throw new Error('reference conflict');});await expect(f.transfers.execute(p.id,p.digest,actor)).rejects.toThrow('reference');expect(await readFile(f.home+'/original','utf8')).toBe('keep');
 }finally{await f.clean();}
});
test('cancellation keeps the original and reports any partial copy instead of deleting a target',async()=>{
 const f=await fixture();try{
  const h=await open(f.home+'/large','w');await h.truncate(256*1024*1024);await h.close();const p=await f.transfers.plan('copy',f.home+'/large',f.home+'/target',actor);await f.transfers.execute(p.id,p.digest,actor);await f.transfers.cancel(p.id,actor);const done=await finished(f,p.id);expect(['skipped','verified']).toContain(done.state);expect((await lstat(f.home+'/large')).size).toBe(256*1024*1024);if(done.state==='skipped'){expect(await lstat(f.home+'/target').then(()=>true,()=>false)).toBe(false);if(done.partialPath)expect(await lstat(done.partialPath).then(()=>true,()=>false)).toBe(true);}
 }finally{await f.clean();}
});
test('selected fixture purge removes only its frozen tree and records real filesystem measurements',async()=>{
 const f=await fixture();try{
  await mkdir(f.home+'/cache');await writeFile(f.home+'/cache/selected','fixture cache');await writeFile(f.home+'/preserve','never selected');const id=crypto.randomUUID();
  const prepared=await f.run({action:'prepare',mode:'purge',home:f.home,id,from:f.home+'/cache',to:f.home+'/cache.purged-'+id,adapter:'fixture',allowedRoot:f.home});expect(prepared.ok).toBe(true);
  await f.run({action:'start',home:f.home,id});let receipt:any;for(let i=0;i<100;i++){receipt=await f.run({action:'status',home:f.home,id});if(!['planned','running'].includes(receipt.state))break;await Bun.sleep(25);}
  expect(receipt.state).toBe('verified');expect(receipt.freeBytesBefore).toMatch(/^\d+$/);expect(receipt.freeBytesAfter).toMatch(/^\d+$/);expect(await lstat(f.home+'/cache').then(()=>true,()=>false)).toBe(false);expect(await readFile(f.home+'/preserve','utf8')).toBe('never selected');
 }finally{await f.clean();}
});
test('new fixture content after a purge plan is never included in its deletion',async()=>{
 const f=await fixture();try{
  await mkdir(f.home+'/cache');await writeFile(f.home+'/cache/old','old fixture');const id=crypto.randomUUID();await f.run({action:'prepare',mode:'purge',home:f.home,id,from:f.home+'/cache',to:f.home+'/unused-'+id,adapter:'fixture',allowedRoot:f.home});await writeFile(f.home+'/cache/new','arrived after review');await f.run({action:'start',home:f.home,id});let result:any;for(let i=0;i<100;i++){result=await f.run({action:'status',home:f.home,id});if(!['planned','running'].includes(result.state))break;await Bun.sleep(25);}expect(result.state).toBe('failed');expect(await readFile(f.home+'/cache/new','utf8')).toBe('arrived after review');expect(await readFile(f.home+'/cache/old','utf8')).toBe('old fixture');
 }finally{await f.clean();}
});

test('Recovery returns a moved original without overwrite and releases its own retained lock',async()=>{
 const f=await fixture();try{await writeFile(f.home+'/source','preserved');const p=await f.transfers.plan('move',f.home+'/source',f.home+'/destination',actor);await f.transfers.execute(p.id,p.digest,actor);for(let i=0;i<100;i++){if((await f.transfers.status(p.id,actor)).state==='verified')break;await Bun.sleep(20);}expect((await f.transfers.recover(p.id,actor)).state).toBe('restored');expect(await readFile(f.home+'/source','utf8')).toBe('preserved');await expect(lstat(f.home+'/destination')).rejects.toThrow();}finally{await f.clean();}
});
test('Cancelled purge recovers only its remaining fixture contents and never promises deleted data',async()=>{
 const f=await fixture();try{const cache=f.home+'/cache';await mkdir(cache);for(let i=0;i<300;i++)await writeFile(cache+'/'+String(i).padStart(4,'0'),'fixture');const id=crypto.randomUUID();expect((await f.run({action:'prepare',id,mode:'purge',from:cache,to:f.home+'/unused',home:f.home,adapter:'fixture',allowedRoot:f.home})).ok).toBe(true);await f.run({action:'start',id,home:f.home});let receipt:any;for(let i=0;i<100;i++){receipt=await f.run({action:'status',id,home:f.home});if(receipt.removedEntries>0)break;await Bun.sleep(10);}await f.run({action:'cancel',id,home:f.home});for(let i=0;i<100;i++){receipt=await f.run({action:'status',id,home:f.home});if(receipt.state!=='running')break;await Bun.sleep(10);}expect(receipt.removedEntries).toBeGreaterThan(0);expect(receipt.removedEntries).toBeLessThan(301);const recovered=await f.run({action:'recover',id,home:f.home});expect(recovered.ok).toBe(true);expect(recovered.state).toBe('restored');expect((await readdir(cache)).length).toBeGreaterThan(0);expect(recovered.message).toContain('no se recupera');}finally{await f.clean();}
});
