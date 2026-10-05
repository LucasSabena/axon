import {test,expect} from 'bun:test';
import {Hono} from 'hono';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MaintenanceRepository} from './storage/repository';
import {HomeLinks,importHomepage,safeLink,registerHomeLinkRoutes,knownHomeLinks} from './home-links';
import {ComposeDrafts} from './compose-drafts';
import {Migrations} from './app-migrations';
import {hash} from './storage/policy';
const setup=async()=>{const dir=await mkdtemp(path.join(tmpdir(),'axon-maint-test-'));const r=new MaintenanceRepository(dir);return {r,async clean(){r.close();await rm(dir,{recursive:true,force:true});}};};
test('Homepage import allowlists navigation metadata and strips query secrets',()=>{
 const result=importHomepage('- Personal:\n  - App:\n      href: https://app.example/path?token=private#secret\n      widget:\n        password: dont-copy\n  - Bad:\n      href: javascript:alert(1)\n');
 expect(result.links).toHaveLength(1);expect(result.skipped).toBe(1);expect(result.links[0].url).toBe('https://app.example/path');expect(JSON.stringify(result)).not.toContain('dont-copy');expect(()=>safeLink('https://user:password@example.com')).toThrow();expect(()=>importHomepage('- [bad')).toThrow();
});
test('bookmarks keep order and favorites after reopen; stale edits cannot overwrite another tab',async()=>{
 const db=await setup();try{const links=new HomeLinks(db.r);const original=links.get();const next=links.save([{name:'App',url:'https://example.test',group:'Personal',favorite:true}],original.revision);expect(new HomeLinks(db.r).get()).toEqual(next);expect(()=>links.save([],original.revision)).toThrow('otra pestaña');}finally{await db.clean();}
});
test('Homepage bookmarks sequences import supported leaves and preserve existing customization',async()=>{
 const source='- Trabajo:\n  - Docs:\n    - abbr: DO\n      href: https://docs.example.test/?token=secret\n      widget:\n        href: https://must-not-import.test\n  - Bad:\n    - href: javascript:alert(1)\n  - Empty: []\n- Personal:\n  - New:\n    - href: https://new.example.test/\n';
 const preview=importHomepage(source);expect(preview.links).toHaveLength(2);expect(preview.skipped).toBe(2);expect(JSON.stringify(preview)).not.toContain('secret');expect(JSON.stringify(preview)).not.toContain('must-not-import');
 const db=await setup();try{
  const service=new HomeLinks(db.r);const original=service.save([{name:'Mi nombre',url:'https://docs.example.test/',group:'Favoritos',favorite:true}],service.get().revision);
  const imported=service.importLinks(preview.links,original.revision);expect(imported.links[0]).toEqual(original.links[0]);expect(imported.links[1].name).toBe('New');
  expect(service.importLinks(preview.links,imported.revision)).toEqual(imported);expect(()=>service.importLinks(preview.links,original.revision)).toThrow('otra pestaña');
 }finally{await db.clean();}
});
test('known access status uses existing bounded observations and never promotes stale or malformed evidence',()=>{
 const now=Date.now(),domain={id:'domain',fullDomain:'app.example.test',projectName:'Proyecto',processType:'docker',target:'private backend'} as any;
 const fresh=knownHomeLinks([domain],{domain:[{t:now-1000,s:'up'}]},now);expect(fresh[0]).toMatchObject({status:'up',group:'Proyecto',source:'domain',serviceType:'docker'});expect(JSON.stringify(fresh)).not.toContain('private backend');
 expect(knownHomeLinks([domain],{domain:[{t:now-181000,s:'up'}]},now)[0].status).toBe('unknown');
 expect(knownHomeLinks([domain],{domain:[{t:now+10000,s:'up'}]},now)[0].status).toBe('unknown');
 expect(knownHomeLinks([domain],{},now)[0].observedAt).toBeNull();expect(knownHomeLinks([{...domain,fullDomain:'user:secret@example.test'}],{},now)).toEqual([]);
});
test('invalid Compose stays a draft, never changes original, protects concurrent base and saves',async()=>{
 const db=await setup();try{const service=new ComposeDrafts(db.r),original='services:\n  app:\n    image: example:1\n';const p='/tmp/compose.yml';const draft=service.save(p,'services: [',original,hash(original));expect(draft.validation.ok).toBe(false);expect(service.preview(p,original)).toMatchObject({before:original,after:'services: [',canApply:false});expect(()=>service.save(p,'new',original,'stale')).toThrow();expect(()=>service.save(p,'new',original+'# concurrent',draft.revision)).toThrow('host cambió');}finally{await db.clean();}
});
test('discarding a Compose draft requires its revision and never removes another draft or reads host files',async()=>{
 const db=await setup();try{
  const service=new ComposeDrafts(db.r),original='services:\n  app:\n    image: example:1\n';
  const first=service.save('/missing/a.yml','services: [',original,hash(original)),second=service.save('/missing/b.yml',original,original,hash(original));
  expect(()=>service.discard('/missing/a.yml','old')).toThrow('cambió');expect(service.get('/missing/a.yml')).toEqual(first);
  expect(service.discard('/missing/a.yml',first.revision)).toEqual({discarded:true,applied:false});expect(service.get('/missing/a.yml')).toBeUndefined();expect(service.get('/missing/b.yml')).toEqual(second);
 }finally{await db.clean();}
});
test('migration never claims retirement from absence, reported tests or unchanged comparison',async()=>{
 const db=await setup();try{const service=new Migrations(db.r,async()=>[]);const r=await service.compare('filebrowser');expect(r.state).toBe('compared');expect(r.gaps.join()).toContain('No se identificó');for(const g of r.gaps)service.evidence('filebrowser',r.revision,g,'passed');expect(service.list().find(a=>a.app==='filebrowser')!.record!.state).toBe('compared');expect(service.list().find(a=>a.app==='filebrowser')!.record!.diskSavingsBytes).toBeNull();}finally{await db.clean();}
});
test('new mutations require authenticated actor, same origin and strict JSON fields; all responses no-store',async()=>{
 const db=await setup();try{const app=new Hono();app.use('*',async(c,next)=>{if(c.req.header('cookie'))c.set('user','qa');await next();});registerHomeLinkRoutes(app,new HomeLinks(db.r));
 const post=(headers:Record<string,string>,body:unknown)=>app.request('http://localhost/api/home/links',{method:'POST',headers,body:JSON.stringify(body)});
 expect((await post({'content-type':'application/json',origin:'http://localhost'},{})).status).toBe(401);
 expect((await post({'content-type':'application/json',origin:'https://evil.test',cookie:'axon_session=qa'},{})).status).toBe(403);
 const r=await post({'content-type':'application/json',origin:'http://localhost',cookie:'axon_session=qa'},{path:'/etc/passwd'});expect(r.status).toBe(400);expect(r.headers.get('cache-control')).toBe('private, no-store');
 }finally{await db.clean();}
});
test('Compose routes preserve deployable fixture on invalid save and block up with a pending draft',async()=>{
 const db=await setup();const {writeFile,readFile,mkdtemp,rm}=await import('node:fs/promises');const folder=await mkdtemp(path.join(tmpdir(),'axon-compose-fixture-'));
 try{
  const {registerComposeRoutes}=await import('./compose');const app=new Hono();app.use('*',async(c,next)=>{c.set('user','qa');await next();});registerComposeRoutes(app,{drafts:new ComposeDrafts(db.r)});
  const original='services:\n  only-fixture:\n    image: unavailable:fixture\n',file=folder+'/compose.yml';await writeFile(file,original);
  const headers={'content-type':'application/json',origin:'http://localhost',cookie:'axon_session=fixture'};const post=(url:string,body:unknown)=>app.request('http://localhost'+url,{method:'POST',headers,body:JSON.stringify(body)});
  const read=await (await app.request('http://localhost/api/compose/file?path='+encodeURIComponent(file),{headers})).json();expect(read.revision).toBe(hash(original));
  const saved=await post('/api/compose/save',{path:file,content:'services: [',revision:read.revision});expect(saved.status).toBe(200);expect(await saved.json()).toMatchObject({draft:true,applied:false,validation:{ok:false}});expect(await readFile(file,'utf8')).toBe(original);
  const up=await post('/api/compose/up',{path:file});expect(up.status).toBe(409);expect(await readFile(file,'utf8')).toBe(original);
  expect((await post('/api/compose/draft-preview',{path:file})).status).toBe(200);
 }finally{await rm(folder,{recursive:true,force:true});await db.clean();}
});
