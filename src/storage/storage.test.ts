import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,link,lstat,open,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MaintenanceRepository,incarnation} from './repository';
import {StorageService} from './service';
import {scanRoot} from './scan';
import {policyRevision} from './policy';
import {storageFixture} from '../../scripts/storage-fixture';
import type {Scan,ScanResult,Actor} from './types';
const actor:Actor={actorId:'qa',sessionId:'session-1'};
const repo=async()=>{const dir=await mkdtemp(path.join(tmpdir(),'axon-ledger-test-'));return {dir,r:new MaintenanceRepository(dir),async cleanup(){this.r.close();await rm(dir,{recursive:true,force:true});}};};
const insert=(service:StorageService,result:ScanResult,id=crypto.randomUUID())=>{const s:Scan={id,rootId:'fixture',at:new Date().toISOString(),state:'verified',policyRevision:policyRevision(service.policy()),result};service.repo.put('scan',s.id,s,'verified');return s;};
const readScan=(dir:string,adapterId='review',exclusions:string[]=[])=>scanRoot({id:'test',path:dir,title:'Fixture',adapterId},exclusions,undefined,(_tool,args)=>['python3',...args]);

test('durable plan -> selected fixture deletion -> verified receipt -> reopen, idempotency and cross-session protection',async()=>{
 const f=await storageFixture(),db=await repo();
 try{
  await f.add('cache $() ; ñ\n.txt');await f.add('preservar');const s=new StorageService(db.r,async()=>[],async()=>{throw new Error();},f.executor);
  const scan=insert(s,await f.scan());const selected=scan.result!.candidates.find(c=>c.title.startsWith('cache'))!;const p=s.plan(scan.id,[selected.id],actor);
  await f.add('llegó-después');expect((await lstat(path.join(f.dir,'preservar'))).isFile()).toBe(true);
  await expect(s.execute(p.id,p.digest,{...actor,sessionId:'other'})).rejects.toThrow('sesión');
  const done=await s.execute(p.id,p.digest,actor);expect(done.plan.state).toBe('verified');expect(done.receipts[0]).toMatchObject({state:'verified'});
  expect((await s.execute(p.id,p.digest,actor)).plan.state).toBe('verified');expect(await readFile(path.join(f.dir,'llegó-después'),'utf8')).toBe('fixture-cache');
  const reopened=new MaintenanceRepository(db.dir);expect(reopened.get<any>('plan',p.id).state).toBe('verified');expect(reopened.receipts(p.id)).toHaveLength(1);reopened.close();
 }finally{await f.cleanup();await db.cleanup();}
});
test('changed inode, policy, expired plan and unrecognized selection fail closed',async()=>{
 const f=await storageFixture(),db=await repo();try{
  await f.add('cache');const s=new StorageService(db.r,async()=>[],async()=>{throw new Error();},f.executor);const scan=insert(s,await f.scan());const c=scan.result!.candidates[0];
  expect(()=>s.plan(scan.id,['missing'],actor)).toThrow('selección');const p=s.plan(scan.id,[c.id],actor);
  await rm(c.identity.canonicalPath);await symlink('/etc/passwd',c.identity.canonicalPath);
  expect((await s.execute(p.id,p.digest,actor)).plan.state).toBe('skipped');expect((await lstat(c.identity.canonicalPath)).isSymbolicLink()).toBe(true);
  const expired=s.plan(scan.id,[c.id],actor);expired.expiresAt='2000-01-01T00:00:00Z';expired.digest=(await import('./policy')).hash({...expired,digest:undefined});db.r.put('plan',expired.id,expired);await expect(s.execute(expired.id,expired.digest,actor)).rejects.toThrow('venció');
  s.setPolicy(['/excluded']);expect(()=>s.plan(scan.id,[c.id],actor)).toThrow('análisis');
 }finally{await f.cleanup();await db.cleanup();}
});
test('SQLite locks span connections, retain uncertainty, and never steal a live process lock',async()=>{
 const db=await repo();const other=new MaintenanceRepository(db.dir);try{
  db.r.put('plan','op',{id:'op',state:'running'},'running');db.r.exclusive('op',['pnpm'],()=>{});
  expect(()=>other.exclusive('other',['pnpm'],()=>{})).toThrow('recurso');other.reconcile();expect(other.get<any>('plan','op').state).toBe('running');
  db.r.db.query('UPDATE locks SET owner=?').run('old-boot:999999999:0');other.reconcile();expect(other.get<any>('plan','op').state).toBe('interrupted');expect(()=>other.exclusive('new',['pnpm'],()=>{})).toThrow();expect(incarnation()).not.toBeNull();
 }finally{other.close();await db.cleanup();}
});
test('restarting after a read-only scan releases only its dead owner lock and retains interrupted evidence',async()=>{
 const db=await repo();try{
  db.r.put('scan','scan-interrupted',{id:'scan-interrupted',state:'running'},'running');db.r.exclusive('scan-interrupted',['storage:scan'],()=>{});
  db.r.reconcile();expect(()=>db.r.exclusive('other',['storage:scan'],()=>{})).toThrow();
  db.r.db.query('UPDATE locks SET owner=? WHERE operation=?').run('old-boot:999999999:0','scan-interrupted');
  db.r.reconcile();expect(db.r.get<any>('scan','scan-interrupted')).toMatchObject({state:'interrupted'});expect(db.r.get<any>('scan','scan-interrupted').error).toContain('No modificó');
  expect(()=>db.r.exclusive('next',['storage:scan'],()=>{})).not.toThrow();db.r.release('next');
  db.r.retainScans(0);expect(db.r.get('scan','scan-interrupted')).toBeUndefined();
 }finally{await db.cleanup();}
});
test('failed ledger before effects prevents deletion; after effects remains interrupted with lock retained',async()=>{
 const f=await storageFixture(),db=await repo();try{
  await f.add('cache');let effects=0;const executor={...f.executor,execute:async(c:any)=>{effects++;const receipt=await f.executor.execute(c);throw new Error('receipt failure');return receipt;}};
  const s=new StorageService(db.r,async()=>[],async()=>{throw new Error();},executor);const scan=insert(s,await f.scan());const p=s.plan(scan.id,[scan.result!.candidates[0].id],actor);
  const original=db.r.put.bind(db.r);db.r.put=()=>{throw new Error('disk full');};await expect(s.execute(p.id,p.digest,actor)).rejects.toThrow();expect(effects).toBe(0);db.r.put=original;
  expect((await s.execute(p.id,p.digest,actor)).plan.state).toBe('interrupted');expect(effects).toBe(1);expect(db.r.db.query('SELECT COUNT(*) AS n FROM locks').get()).toMatchObject({n:1});
 }finally{await f.cleanup();await db.cleanup();}
});
test('two simultaneous requests execute a plan only once',async()=>{
 const f=await storageFixture(),db=await repo();try{
  await f.add('cache');let count=0;const s=new StorageService(db.r,async()=>[],async()=>{throw new Error();},{...f.executor,execute:async c=>{count++;await Bun.sleep(10);return f.executor.execute(c);}});
  const scan=insert(s,await f.scan());const p=s.plan(scan.id,[scan.result!.candidates[0].id],actor);
  await Promise.allSettled([s.execute(p.id,p.digest,actor),s.execute(p.id,p.digest,actor)]);expect(count).toBe(1);
 }finally{await f.cleanup();await db.cleanup();}
});
test('bounded scan distinguishes sparse allocation, hardlinks, symlinks, missing and protected paths',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-scan-test-'));try{
  await writeFile(path.join(dir,'a'),'x'.repeat(8192));await link(path.join(dir,'a'),path.join(dir,'b'));await symlink('/does-not-exist',path.join(dir,'broken'));await mkdir(path.join(dir,'.ssh'));await writeFile(path.join(dir,'.ssh','private'),'never read');
  const file=await open(path.join(dir,'sparse'),'w');await file.truncate(20*1024*1024);await file.close();
  const r=await readScan(dir);expect(r.candidates.find(c=>c.title==='broken')!.identity.kind).toBe('symlink');expect(r.candidates.find(c=>c.title==='.ssh')!.allocatedBytes).toBeNull();
  const hard=r.candidates.filter(c=>['a','b'].includes(c.title));expect(hard.reduce((n,c)=>n+BigInt(c.allocatedBytes!),0n)).toBe((await lstat(path.join(dir,'a'),{bigint:true})).blocks*512n);
  const sparse=r.candidates.find(c=>c.title==='sparse')!;expect(BigInt(sparse.logicalBytes!)).toBeGreaterThan(BigInt(sparse.allocatedBytes!));
  expect((await readScan(dir+'/missing')).complete).toBe(false);await symlink(dir,path.join(dir,'alias'));expect((await readScan(path.join(dir,'alias'))).complete).toBe(false);
  expect(r.metrics.entries).toBeGreaterThan(0);expect(r.metrics.readBytes).toMatch(/^\d+$/);expect(r.candidates.every(c=>c.reclaimableBytes===null)).toBe(true);
 }finally{await chmod(path.join(dir,'denied'),0o700).catch(()=>{});await rm(dir,{recursive:true,force:true});}
});
test('XDG and legacy metadata are decoded without following links; corrupt metadata remains visible',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-trash-test-'));try{
  await mkdir(dir+'/files');await mkdir(dir+'/info');await writeFile(dir+'/files/valid','cache');await writeFile(dir+'/info/valid.trashinfo','[Trash Info]\nPath=/tmp/Original%20name\nDeletionDate=2026-10-04T12:00:00\n');await writeFile(dir+'/files/corrupt','keep');
  let r=await readScan(dir+'/files','trash-xdg');expect(r.candidates.find(c=>c.title==='valid')!.originalPath).toBe('/tmp/Original name');expect(r.candidates.find(c=>c.title==='corrupt')!.blockers.join()).toContain('Metadatos');
  await writeFile(dir+'/files/.manifest.json',JSON.stringify([{id:'valid',orig:'/tmp/original',ts:Date.now()}]));r=await readScan(dir+'/files','trash-legacy');expect(r.candidates.find(c=>c.title==='valid')!.originalPath).toBe('/tmp/original');
  await writeFile(dir+'/files/.manifest.json','{broken');r=await readScan(dir+'/files','trash-legacy');expect(r.errors.join()).toContain('manifiesto');expect(r.candidates).toHaveLength(2);
 }finally{await chmod(path.join(dir,'denied'),0o700).catch(()=>{});await rm(dir,{recursive:true,force:true});}
});
test('cancellation records intent and scan state survives navigation-independent execution',async()=>{
 const db=await repo();try{
  const s=new StorageService(db.r,async()=>[{id:'fake',path:'/never',adapterId:'fixture',title:'fake'}],async(r,e,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancel')))));
  const scan=await s.scan('fake');expect(s.cancel(scan.id).state).toBe('cancel-requested');await Bun.sleep(20);expect(db.r.get<any>('scan',scan.id).state).toBe('interrupted');expect(db.r.db.query('SELECT COUNT(*) AS n FROM locks').get()).toMatchObject({n:0});
 }finally{await db.cleanup();}
});
test('large fixture is capped and remote/special mount and denied directories never become zero-sized clean candidates',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-scan-large-'));try{
  await Promise.all(Array.from({length:1200},(_,i)=>writeFile(path.join(dir,'entry-'+i),'fixture')));
  const r=await readScan(dir);expect(r.candidates).toHaveLength(1000);expect(r.complete).toBe(false);expect(r.errors.join()).toContain('límite');expect(r.metrics.peakRssBytes).toBeLessThan(100*1024*1024);
  const excluded=await readScan('/proc');expect(excluded.complete).toBe(false);expect(excluded.candidates).toHaveLength(0);
  const denied=path.join(dir,'denied');await mkdir(denied,{mode:0o000});const permission=await readScan(denied);if(process.getuid?.()!==0)expect(permission.complete).toBe(false);
 }finally{await chmod(path.join(dir,'denied'),0o700).catch(()=>{});await rm(dir,{recursive:true,force:true});}
});
test('unknown host candidates can be reviewed but cannot be executed even with a valid digest',async()=>{
 const f=await storageFixture(),db=await repo();try{
  await f.add('cache');const r=await f.scan();r.candidates[0].adapterId='packages';r.candidates[0].blockers=['Activity unknown'];const s=new StorageService(db.r,async()=>[],async()=>r);const scan=insert(s,r);const plan=s.plan(scan.id,[r.candidates[0].id],actor);expect(plan.steps[0].actionId).toBe('review-only');await expect(s.execute(plan.id,plan.digest,actor)).rejects.toThrow('revisión');expect(await readFile(f.dir+'/cache','utf8')).toBe('fixture-cache');
 }finally{await f.cleanup();await db.cleanup();}
});

test('volume trash scans resolve relative XDG metadata and reject traversal outside the disk',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-volume-scan-'));try{
  const files=dir+'/.Trash-1000/files',info=dir+'/.Trash-1000/info';await mkdir(files,{recursive:true});await mkdir(info);
  await writeFile(files+'/valid','fixture');await writeFile(info+'/valid.trashinfo','[Trash Info]\nPath=folder/Original%20name\nDeletionDate=2026-10-05T12:00:00\n');
  await writeFile(files+'/escape','preserved');await writeFile(info+'/escape.trashinfo','[Trash Info]\nPath=../outside\nDeletionDate=2026-10-05T12:00:00\n');
  const r=await scanRoot({id:'fixture',path:files,title:'Volume fixture',adapterId:'trash-xdg',trashTop:dir},[],undefined,(_tool,args)=>['python3',...args]);
  expect(r.candidates.find(c=>c.title==='valid')!.originalPath).toBe(dir+'/folder/Original name');expect(r.candidates.find(c=>c.title==='escape')!.blockers.join()).toContain('Metadatos');expect(await readFile(files+'/escape','utf8')).toBe('preserved');
 }finally{await rm(dir,{recursive:true,force:true});}
});
