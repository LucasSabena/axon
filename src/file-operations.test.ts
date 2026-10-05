import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MaintenanceRepository} from './storage/repository';
import {FileOperations} from './file-operations';
import {boundedCommand} from './storage/host-argv';
const actor={actorId:'qa',sessionId:'fixture-session'};
async function fixture(){const home=await mkdtemp(path.join(tmpdir(),'axon-file-ops-'));await mkdir(home+'/state',{mode:0o700});const repo=new MaintenanceRepository(home+'/state');const script=await readFile(new URL('./storage/trash-host.py',import.meta.url),'utf8');const operations=new FileOperations(repo,async()=>home,async payload=>{
 if(payload.home!==home)throw new Error('Fixture confinement');return JSON.parse(await boundedCommand(['python3','-c',script],JSON.stringify(payload)));
});return {home,repo,operations,async clean(){repo.close();await rm(home,{recursive:true,force:true});}};}
test('shared file service sends to XDG and restores without overwriting, metadata and ledger survive reopen',async()=>{
 const f=await fixture();try{
  const p=f.home+'/name $() ;\n ñ.txt';await writeFile(p,'original fixture');const sent=await f.operations.send(p,actor);expect(sent.state).toBe('verified');expect(sent.retiredBytes).toBe('0');expect(await lstat(p).then(()=>true,()=>false)).toBe(false);
  let list=await f.operations.list();expect(list.items).toHaveLength(1);expect(list.items[0].orig).toBe(p);expect(list.items[0].origin).toBe('xdg');expect(list.items[0].canRestore).toBe(true);
  await writeFile(p,'concurrent');await expect(f.operations.restore(sent.id,actor)).rejects.toThrow('existe');expect(await readFile(p,'utf8')).toBe('concurrent');expect((await f.operations.list()).items).toHaveLength(1);
  await rm(p);const restored=await f.operations.restore(sent.id,actor);expect(restored.state).toBe('restored');expect(await readFile(p,'utf8')).toBe('original fixture');expect((await f.operations.list()).items).toHaveLength(0);
  expect(f.repo.list<any>('file-operation').some(op=>op.state==='restored')).toBe(true);expect(f.repo.db.query('SELECT COUNT(*) AS n FROM locks').get()).toMatchObject({n:0});
 }finally{await f.clean();}
});
test('legacy manifests remain restorable; corruption is visible and cannot authorize operations',async()=>{
 const f=await fixture();try{
  const legacy=f.home+'/.local/share/axon-trash';await mkdir(legacy,{recursive:true,mode:0o700});await writeFile(legacy+'/old','keep');await writeFile(legacy+'/.manifest.json',JSON.stringify([{id:'old',name:'original',orig:f.home+'/original',type:'file',ts:Date.now()}]));
  expect((await f.operations.list()).items[0].origin).toBe('legacy');await f.operations.restore('legacy:old',actor);expect(await readFile(f.home+'/original','utf8')).toBe('keep');expect(JSON.parse(await readFile(legacy+'/.manifest.json','utf8'))).toEqual([]);
  await writeFile(legacy+'/unknown','keep');await writeFile(legacy+'/.manifest.json','corrupt');expect((await f.operations.list()).items[0].canRestore).toBe(false);await expect(f.operations.restore('legacy:unknown',actor)).rejects.toThrow('restaurable');
 }finally{await f.clean();}
});
test('symlink payload is moved as a link, linked ancestor and invalid restore parent are rejected',async()=>{
 const f=await fixture();try{
  await writeFile(f.home+'/target','untouched');await symlink('target',f.home+'/link');const sent=await f.operations.send(f.home+'/link',actor);expect(await readFile(f.home+'/target','utf8')).toBe('untouched');await f.operations.restore(sent.id,actor);expect((await lstat(f.home+'/link')).isSymbolicLink()).toBe(true);
  await mkdir(f.home+'/real');await writeFile(f.home+'/real/file','preserve');await symlink('real',f.home+'/alias');await expect(f.operations.send(f.home+'/alias/file',actor)).rejects.toThrow();expect(await readFile(f.home+'/real/file','utf8')).toBe('preserve');
  const one=await f.operations.send(f.home+'/real/file',actor);await rm(f.home+'/real',{recursive:true});await symlink('/tmp',f.home+'/real');await expect(f.operations.restore(one.id,actor)).rejects.toThrow();expect((await f.operations.list()).items).toHaveLength(1);
 }finally{await f.clean();}
});
test('interruption after a real fixture move can be reconciled without repeating the effect',async()=>{
 const f=await fixture();try{
  const p=f.home+'/reconcile';await writeFile(p,'fixture');const script=await readFile(new URL('./storage/trash-host.py',import.meta.url),'utf8');let lost=true;
  const service=new FileOperations(f.repo,async()=>f.home,async payload=>{const receipt=JSON.parse(await boundedCommand(['python3','-c',script],JSON.stringify(payload)));if(payload.action==='send'&&lost){lost=false;throw new Error('lost response');}return receipt;});
  await expect(service.send(p,actor)).rejects.toThrow('interrumpida');const op=f.repo.list<any>('file-operation')[0];expect(op.state).toBe('interrupted');expect(op.intent.identity).toBeDefined();expect((await service.list()).items).toHaveLength(1);
  const r=await service.reconcile(op.id,actor);expect(r.state).toBe('verified');expect(f.repo.db.query('SELECT COUNT(*) AS n FROM locks').get()).toMatchObject({n:0});expect((await service.list()).items).toHaveLength(1);
 }finally{await f.clean();}
});
test('cross-filesystem trash fails visibly and preserves the source',async()=>{
 const f=await fixture();let cross:string|undefined;try{
  try{cross=await mkdtemp('/dev/shm/axon-file-ops-cross-');}catch{return;}
  if((await lstat(cross)).dev===(await lstat(f.home)).dev)return;
  const p=cross+'/original';await writeFile(p,'cross-device fixture');await expect(f.operations.send(p,actor)).rejects.toThrow('filesystem');expect(await readFile(p,'utf8')).toBe('cross-device fixture');expect((await f.operations.list()).items).toHaveLength(0);
 }finally{if(cross)await rm(cross,{recursive:true,force:true});await f.clean();}
});
test('shared trash HTTP contract returns stable XDG IDs, hides identities and restores from Files selection',async()=>{
 const f=await fixture();try{
  const {Hono}=await import('hono');const {registerSharedTrashRoutes}=await import('./file-operations');const app=new Hono();app.use('*',async(c,next)=>{c.set('user','qa');await next();});registerSharedTrashRoutes(app,f.operations);
  const p=f.home+'/http fixture';await writeFile(p,'fixture');const headers={'content-type':'application/json',origin:'http://localhost',cookie:'axon_session=fixture'};const post=(route:string,b:unknown)=>app.request('http://localhost'+route,{method:'POST',headers,body:JSON.stringify(b)});
  const sent=await (await post('/api/files/trash',{paths:[p]})).json();expect(sent.items[0].trashed).toMatch(/^xdg:/);expect(sent.items[0].operationId).not.toBe(sent.items[0].trashed);
  const listed=await (await app.request('http://localhost/api/files/trash/info',{headers})).json();expect(listed.items[0].identity).toBeUndefined();expect(listed.dirs).toHaveLength(2);
  const restored=await (await post('/api/files/trash/restore',{ids:[sent.items[0].trashed]})).json();expect(restored.restored[0].to).toBe(p);expect(await readFile(p,'utf8')).toBe('fixture');
  expect((await post('/api/files/trash/empty',{confirm:true})).status).toBe(409);
 }finally{await f.clean();}
});
test('XDG files without an info directory stay visible as metadata-invalid items',async()=>{
 const f=await fixture();try{await mkdir(f.home+'/.local/share/Trash/files',{recursive:true,mode:0o700});await writeFile(f.home+'/.local/share/Trash/files/orphan','fixture');const r=await f.operations.list();expect(r.items).toHaveLength(1);expect(r.items[0].canRestore).toBe(false);expect(r.items[0].error).toContain('Metadatos');}finally{await f.clean();}
});
test('desktop trash preserves hidden names and never treats them as internal metadata',async()=>{
 const f=await fixture();try{const root=f.home+'/.local/share/Trash';await mkdir(root+'/files',{recursive:true,mode:0o700});await mkdir(root+'/info',{mode:0o700});await writeFile(root+'/files/.hidden','fixture');await writeFile(root+'/info/.hidden.trashinfo','[Trash Info]\nPath='+f.home+'/.original\nDeletionDate=2026-10-04T12:00:00\n');const list=await f.operations.list();expect(list.items[0].id).toBe('xdg:.hidden');await f.operations.restore('xdg:.hidden',actor);expect(await readFile(f.home+'/.original','utf8')).toBe('fixture');}finally{await f.clean();}
});
async function legacyFixture(f:Awaited<ReturnType<typeof fixture>>,names:string[]){
 const legacy=f.home+'/.local/share/axon-trash';await mkdir(legacy,{recursive:true,mode:0o700});
 const entries=names.map(id=>({id,orig:f.home+'/'+id,type:'file',ts:Date.now()-86400000}));
 for(const entry of entries)await writeFile(legacy+'/'+entry.id,'fixture '+entry.id);
 await writeFile(legacy+'/.manifest.json',JSON.stringify(entries));return {legacy,entries};
}
test('reviewed legacy migration preserves dates, selected IDs and new arrivals; migrated data restores through XDG',async()=>{
 const f=await fixture();try{
  const {legacy,entries}=await legacyFixture(f,['a $() ñ','conservar']);
  const before=(await f.operations.list()).items.find(i=>i.key===entries[0].id)!;
  const plan=await f.operations.planMigration([before.id],actor);
  await writeFile(legacy+'/new','new fixture');await writeFile(legacy+'/.manifest.json',JSON.stringify([...entries,{id:'new',orig:f.home+'/new',ts:Date.now()}]));
  await expect(f.operations.executeMigration(plan.id,plan.digest,{...actor,sessionId:'other'})).rejects.toThrow('sesión');
  const result=await f.operations.executeMigration(plan.id,plan.digest,actor);expect(result.operation.state).toBe('verified');expect(result.operation.receipt?.retiredBytes).toBe('0');
  const listed=await f.operations.list();const moved=listed.items.find(i=>i.origin==='xdg')!;expect(moved.orig).toBe(before.orig);expect(moved.ts).toBe(before.ts);
  expect(listed.items.filter(i=>i.origin==='legacy').map(i=>i.key).sort()).toEqual(['conservar','new']);
  expect(JSON.parse(await readFile(legacy+'/.manifest.json','utf8')).map((e:any)=>e.id).sort()).toEqual(['conservar','new']);
  expect((await f.operations.executeMigration(plan.id,plan.digest,actor)).operation.state).toBe('verified');
  await f.operations.restore(moved.id,actor);expect(await readFile(before.orig!,'utf8')).toBe('fixture '+entries[0].id);
 }finally{await f.clean();}
});
test('legacy migration rejects changed metadata, stale policy and invalid selections without moving payloads',async()=>{
 const f=await fixture();try{
  const {legacy,entries}=await legacyFixture(f,['item']);const id='legacy:item';
  await expect(f.operations.planMigration(['missing'],actor)).rejects.toThrow();
  const plan=await f.operations.planMigration([id],actor);entries[0].orig=f.home+'/changed';await writeFile(legacy+'/.manifest.json',JSON.stringify(entries));
  expect((await f.operations.executeMigration(plan.id,plan.digest,actor)).operation.state).toBe('skipped');expect(await readFile(legacy+'/item','utf8')).toBe('fixture item');
  const next=await f.operations.planMigration([id],actor);f.repo.put('settings','exclusions',[f.home]);await expect(f.operations.executeMigration(next.id,next.digest,actor)).rejects.toThrow('política');await expect(f.operations.planMigration([id],actor)).rejects.toThrow('excluida');
 }finally{await f.clean();}
});
test('legacy migration reconciles a lost receipt without moving remaining items or repeating effects',async()=>{
 const f=await fixture();try{
  await legacyFixture(f,['first','second']);const script=await readFile(new URL('./storage/trash-host.py',import.meta.url),'utf8');let moves=0;
  const service=new FileOperations(f.repo,async()=>f.home,async payload=>{
   if(payload.home!==f.home)throw new Error('Fixture confinement');
   const result=JSON.parse(await boundedCommand(['python3','-c',script],JSON.stringify(payload)));
   if(payload.action==='migrate'){moves++;throw new Error('lost receipt');}return result;
  });
  const plan=await service.planMigration(['legacy:first','legacy:second'],actor);
  await expect(service.executeMigration(plan.id,plan.digest,actor)).rejects.toThrow('interrumpida');
  expect((await service.executeMigration(plan.id,plan.digest,actor)).operation.state).toBe('interrupted');expect(moves).toBe(1);
  await service.reconcile(plan.id,actor);expect(moves).toBe(1);expect(f.repo.get<any>('file-operation',plan.id).state).toBe('skipped');
  const listed=await service.list();expect(listed.items.filter(i=>i.origin==='xdg')).toHaveLength(1);expect(listed.items.find(i=>i.id==='legacy:second')).toBeDefined();
  expect(f.repo.receipts(plan.id)[0]).toMatchObject({state:'verified'});expect(f.repo.db.query('SELECT COUNT(*) AS n FROM locks').get()).toMatchObject({n:0});
 }finally{await f.clean();}
});
test('migration ledger failure before a step prevents its host effect',async()=>{
 const f=await fixture();try{
  const {legacy}=await legacyFixture(f,['stay']);const plan=await f.operations.planMigration(['legacy:stay'],actor);
  const put=f.repo.put.bind(f.repo);f.repo.put=()=>{throw new Error('disk full');};
  await expect(f.operations.executeMigration(plan.id,plan.digest,actor)).rejects.toThrow('disk full');f.repo.put=put;
  expect(await readFile(legacy+'/stay','utf8')).toBe('fixture stay');expect(f.repo.db.query('SELECT COUNT(*) AS n FROM locks').get()).toMatchObject({n:0});
 }finally{await f.clean();}
});
test('storage migration HTTP freezes identities on the server and ignores unselected filesystem entries',async()=>{
 const f=await fixture();try{
  const {Hono}=await import('hono'),{registerStorageRoutes}=await import('./storage/routes'),{StorageService}=await import('./storage/service');
  await legacyFixture(f,['chosen','untouched']);const service=new StorageService(f.repo,async()=>[],async()=>{throw new Error('unused scanner');});
  const app=new Hono();app.use('*',async(c,next)=>{c.set('user','qa');await next();});registerStorageRoutes(app,service,f.operations);
  const headers={'content-type':'application/json',origin:'http://localhost',cookie:'axon_session=fixture'};
  const post=(url:string,data:unknown)=>app.request('http://localhost'+url,{method:'POST',headers,body:JSON.stringify(data)});
  expect((await post('/api/storage/trash/migration-plans',{ids:['legacy:chosen'],path:'/etc/passwd'})).status).toBe(400);
  const planned=await post('/api/storage/trash/migration-plans',{ids:['legacy:chosen']});expect(planned.status).toBe(201);expect(planned.headers.get('cache-control')).toBe('private, no-store');
  const {plan}=await planned.json();expect(plan.steps[0].item.identity).toBeUndefined();expect(plan.sessionId).toBeUndefined();
  const applied=await post(`/api/storage/trash/migration-plans/${plan.id}/execute`,{digest:plan.digest});const result=await applied.json();expect(result.operation.state).toBe('verified');expect(result.operation.intent).toBeUndefined();
  expect((await f.operations.list()).items.find(i=>i.id==='legacy:untouched')).toBeDefined();
 }finally{await f.clean();}
});
test('concurrent migration execution moves each selected fixture once and keeps directories intact',async()=>{
 const f=await fixture();try{
  const {legacy,entries}=await legacyFixture(f,['folder']);await rm(legacy+'/folder');await mkdir(legacy+'/folder');await writeFile(legacy+'/folder/nested','preserve nested');
  const plan=await f.operations.planMigration(['legacy:folder'],actor);
  const results=await Promise.allSettled([f.operations.executeMigration(plan.id,plan.digest,actor),f.operations.executeMigration(plan.id,plan.digest,actor)]);
  expect(results.some(r=>r.status==='fulfilled'&&r.value.operation.state==='verified')).toBe(true);
  const listed=await f.operations.list();expect(listed.items).toHaveLength(1);expect(listed.items[0].origin).toBe('xdg');
  await f.operations.restore(listed.items[0].id,actor);expect(await readFile(entries[0].orig+'/nested','utf8')).toBe('preserve nested');
 }finally{await f.clean();}
});
