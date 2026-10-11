import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,rename,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Hono} from 'hono';
import {PlatformStore} from './platform/store';
import {FileCatalog,registerFileCatalogRoutes} from './file-catalog';
import {initHostStorage} from './host-storage';

async function fixture(){const dir=await mkdtemp(tmpdir()+'/axon-catalog-test-');initHostStorage(dir);const store=new PlatformStore(dir+'/state'),catalog=new FileCatalog(store),app=new Hono();app.use('*',async(c,next)=>{c.set('user',c.req.header('x-owner')||'owner');await next();});registerFileCatalogRoutes(app,catalog);await mkdir(dir+'/folder');await mkdir(dir+'/folder/sub');await writeFile(dir+'/folder/sub/notes.txt','Original');const patch=(paths:string[],value:any,owner='owner')=>app.request('/api/file-catalog',{method:'PATCH',headers:{'x-owner':owner},body:JSON.stringify({paths,patch:value})});return {dir,store,catalog,app,patch,close:async()=>{store.close();initHostStorage();await rm(dir,{recursive:true,force:true});}};}
test('Shared durable annotations are personal and batch patches merge tags without changing original bytes',async()=>{const f=await fixture();try{
  const file=f.dir+'/folder/sub/notes.txt',folder=f.dir+'/folder';expect((await f.patch([file],{tags:['Trabajo','Fotos'],color:'blue',favorite:true,pinned:true})).status).toBe(200);
  expect((await f.patch([folder],{tags:['Cliente'],liked:true})).status).toBe(200);
  expect((await f.patch([file,folder],{addTags:['Pendiente'],saved:true})).status).toBe(200);
  const d=await(await f.app.request('/api/file-catalog')).json(),m=d.entries.find((r:any)=>r.path===file).metadata;expect(m.tags).toEqual(['trabajo','fotos','pendiente']);expect(m.favorite).toBe(true);expect(m.saved).toBe(true);
  expect((await f.patch([file],{revision:1,color:'red'})).status).toBe(409);
  expect((await f.patch([file,folder],{color:'bad'})).status).toBe(400);
  expect((await f.patch([file],{favorite:'yes'})).status).toBe(400);
  expect((await(await f.app.request('/api/file-catalog',{headers:{'x-owner':'other'}})).json()).entries).toEqual([]);
  expect(await Bun.file(file).text()).toBe('Original');const restarted=new PlatformStore(f.dir+'/state');expect(new FileCatalog(restarted).entries('owner',[]).find(r=>r.path===file)!.metadata.saved).toBe(true);restarted.close();
}finally{await f.close();}});
test('Verified folder moves rewrite descendant annotations for all owners and do not match adjacent prefixes',async()=>{const f=await fixture();try{
  const from=f.dir+'/folder',to=f.dir+'/renamed',file=from+'/sub/notes.txt';await f.patch([from,file],{favorite:true,pinned:true});await f.patch([file],{tags:['Privado']},'other');await mkdir(from+'-adjacent');await f.patch([from+'-adjacent'],{color:'red'});
  await rename(from,to);await f.catalog.change('move',from,to);await f.catalog.change('move',from,to);
  const d=await(await f.app.request('/api/file-catalog')).json();expect(d.entries.find((r:any)=>r.path===to+'/sub/notes.txt').metadata.favorite).toBe(true);expect(d.entries.some((r:any)=>r.path===file)).toBe(false);expect(d.entries.find((r:any)=>r.path===from+'-adjacent').metadata.color).toBe('red');
  expect((await(await f.app.request('/api/file-catalog',{headers:{'x-owner':'other'}})).json()).entries[0].metadata.tags).toEqual(['privado']);
  await f.catalog.change('copy',to,from);expect((await(await f.app.request('/api/file-catalog')).json()).entries.some((r:any)=>r.path===from)).toBe(false);
}finally{await f.close();}});
test('Metadata routes reject outside roots and escaping links; favorite import never resurrects an unmarked item',async()=>{const f=await fixture();try{
  const p=f.dir+'/folder/sub/notes.txt';await symlink('/etc',f.dir+'/escape');expect((await f.patch(['/etc/passwd'],{favorite:true})).status).toBe(403);expect((await f.patch([f.dir+'/escape/passwd'],{favorite:true})).status).toBe(403);
  await f.catalog.migrateFavorites('owner',[p]);expect((await(await f.app.request('/api/file-catalog')).json()).entries[0].metadata.favorite).toBe(true);await f.patch([p],{favorite:false});await f.catalog.migrateFavorites('owner',[p]);expect((await(await f.app.request('/api/file-catalog')).json()).entries[0].metadata.favorite).toBe(false);
}finally{await f.close();}});
