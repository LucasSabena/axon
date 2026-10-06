import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, stat, rename } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { PlatformStore } from '../platform/store';
import { CloudVault } from './vault';
import { Dropbox, cloudPath, sharedUrl, headerJson } from './dropbox';
import { CloudDownloads } from './downloads';
import { registerDropboxRoutes } from './routes';
import { initHostStorage } from '../host-storage';
import { setHostUser } from '../host';

const by={actorId:'qa',sessionId:'qa-session'},origin='http://localhost';
const hash=(data:Uint8Array)=>{const whole=createHash('sha256');for(let i=0;i<data.length;i+=4194304)whole.update(createHash('sha256').update(data.subarray(i,i+4194304)).digest());return whole.digest('hex');};
async function fixture(fn:(v:any)=>Promise<void>) {
  const root=await mkdtemp(path.join(tmpdir(),'axon-dropbox-test-'));await mkdir(path.join(root,'private'),{mode:0o700});await mkdir(path.join(root,'destination'));
  const store=new PlatformStore(path.join(root,'private/platform')),vault=new CloudVault(path.join(root,'private/cloud'));
  const calls:{url:string;args:any;headers:Headers}[]=[],files=new Map<string,Uint8Array>(),folders=new Map<string,string[]>();
  let refreshCount=0,slow=false;
  const metadata=(p:string)=>folders.has(p)?{'.tag':'folder',name:p.split('/').pop(),path_display:p}:{'.tag':'file',name:p.split('/').pop(),path_display:p,size:files.get(p)?.length||0,rev:'rev-'+p,content_hash:hash(files.get(p)||new Uint8Array()),is_downloadable:true};
  const http=async(url:any,init:any={})=>{
    const headers=new Headers(init.headers),args=headers.has('Dropbox-API-Arg')?JSON.parse(headers.get('Dropbox-API-Arg')!):init.body instanceof URLSearchParams?Object.fromEntries(init.body):JSON.parse(init.body||'null');calls.push({url:String(url),args,headers});
    if(String(url).endsWith('/oauth2/token')){if(args.grant_type==='refresh_token')refreshCount++;return Response.json({access_token:'fixture-access-secret',refresh_token:'fixture-refresh-secret',expires_in:3600});}
    if(String(url).endsWith('/users/get_current_account'))return Response.json({account_id:'fixture-account',name:{display_name:'Cuenta de prueba'},email:'qa@example.test'});
    if(String(url).endsWith('/auth/token/revoke'))return Response.json(null);
    if(String(url).endsWith('/sharing/get_shared_link_metadata'))return Response.json(metadata('/Compartida'));
    if(String(url).endsWith('/files/get_metadata'))return Response.json(metadata(args.path));
    if(String(url).endsWith('/files/list_folder'))return Response.json({entries:(folders.get(args.path)||[]).map(metadata),has_more:false});
    if(String(url).endsWith('/files/download')||String(url).endsWith('/sharing/get_shared_link_file')){
      const p=args.path?.startsWith('rev:rev-')?args.path.slice(8):args.path,data=files.get(p)||new Uint8Array();
      let part=data,status=200;const h:Record<string,string>={'Dropbox-API-Result':JSON.stringify(metadata(p))};
      const range=headers.get('range');if(range){const [a,b]=range.slice(6).split('-').map(Number),end=Math.min(b,data.length-1);part=data.subarray(a,end+1);status=206;h['Content-Range']=`bytes ${a}-${end}/${data.length}`;}
      h['Content-Length']=String(part.length);
      if(slow){let timer:any;const stream=new ReadableStream({start(c){timer=setTimeout(()=>{c.enqueue(part);c.close();},2000);},cancel(){clearTimeout(timer);}});init.signal?.addEventListener('abort',()=>stream.cancel().catch(()=>{}));return new Response(stream,{status,headers:h});}
      return new Response(part,{status,headers:h});
    }
    return Response.json({error:'fixture missing'}, {status:409});
  };
  const dbx=new Dropbox(store,vault,http as typeof fetch,'');dbx.configure(by.actorId,'fixture-client');
  const connect=async(actor=by)=>{const u=new URL(dbx.authorize(actor,origin));await dbx.callback(actor,u.searchParams.get('state'),'fixture-code');return u;};
  setHostUser(userInfo().username);initHostStorage(root);
  try{await fn({root,store,vault,dbx,http,calls,files,folders,metadata,connect,get refreshCount(){return refreshCount;},set slow(v:boolean){slow=v;}});}finally{store.close();initHostStorage();await rm(root,{recursive:true,force:true});}
}
async function done(downloads:CloudDownloads,id:string){for(let i=0;i<200;i++){const j=downloads.get(by.actorId,id);if(!['planning','running'].includes(j.state))return j;await Bun.sleep(25);}throw new Error('Download did not finish');}

test('OAuth uses PKCE, exact redirect, read scopes, one-time session-bound state and encrypted persistent credentials',async()=>fixture(async v=>{
  const u=new URL(v.dbx.authorize(by,origin));expect(u.searchParams.get('code_challenge_method')).toBe('S256');expect(u.searchParams.get('scope')).not.toContain('write');expect(u.searchParams.get('redirect_uri')).toBe(origin+'/api/files/dropbox/oauth/callback');
  await expect(v.dbx.callback({...by,sessionId:'another'},u.searchParams.get('state'),'code')).rejects.toThrow('otra sesión');
  await v.dbx.callback(by,u.searchParams.get('state'),'code');await expect(v.dbx.callback(by,u.searchParams.get('state'),'code')).rejects.toThrow('expiró');
  expect(v.dbx.status(by.actorId).connected).toBe(true);const records=JSON.stringify(v.store.list('dropbox-account'));expect(records).not.toContain('fixture-access-secret');expect(records).not.toContain('fixture-refresh-secret');
  const another=new Dropbox(v.store,new CloudVault(path.join(v.root,'private/cloud')),async()=>{throw new Error('not used');},'');expect(another.status(by.actorId).account.name).toBe('Cuenta de prueba');
  expect((await stat(path.join(v.root,'private/cloud/vault.key'))).mode & 0o077).toBe(0);
  const sealed=v.vault.seal({secret:'value'},'one');expect(()=>v.vault.open(sealed,'two')).toThrow();
}));

test('Expired authorizations fail; cancelled OAuth never connects and credentials are isolated by owner',async()=>fixture(async v=>{
  const u=new URL(v.dbx.authorize(by,origin)),key=createHash('sha256').update(u.searchParams.get('state')!).digest('hex');const r=v.store.get('dropbox-oauth',key);v.store.put('dropbox-oauth',key,{...r,expires:0});
  await expect(v.dbx.callback(by,u.searchParams.get('state'),'code')).rejects.toThrow('expiró');
  const next=new URL(v.dbx.authorize(by,origin));await v.dbx.callback(by,next.searchParams.get('state'),undefined,true);expect(v.dbx.status(by.actorId).connected).toBe(false);
  await v.connect();expect(v.dbx.status('another').connected).toBe(false);await v.dbx.disconnect(by.actorId);expect(v.dbx.status(by.actorId).connected).toBe(false);
}));

test('Directory browsing transfers metadata only and concurrent refresh requests renew once',async()=>fixture(async v=>{
  v.folders.set('', ['/Fotos']);v.folders.set('/Fotos',[]);await v.connect();v.calls.length=0;
  const page=await v.dbx.list(by.actorId,'account','');expect(page.entries[0].name).toBe('Fotos');expect(v.calls.every((c:any)=>!c.url.includes('content.dropboxapi'))).toBe(true);
  const r=v.store.get('dropbox-account',by.actorId),a=v.vault.open(r.sealed,'account:'+by.actorId);a.expires=0;v.store.put('dropbox-account',by.actorId,{...r,sealed:v.vault.seal(a,'account:'+by.actorId)});
  await Promise.all([v.dbx.list(by.actorId,'account',''),v.dbx.list(by.actorId,'account','')]);expect(v.refreshCount).toBe(1);
}));

test('Shared links remain private, owner-scoped, and cannot become arbitrary network targets',async()=>fixture(async v=>{
  v.folders.set('/Compartida',[]);await v.connect();const s=await v.dbx.addShared(by.actorId,'https://www.dropbox.com/scl/fo/token/folder?rlkey=fixture-secret&dl=0');
  expect(JSON.stringify(v.dbx.status(by.actorId))).not.toContain('fixture-secret');expect(JSON.stringify(v.store.list('dropbox-shared'))).not.toContain('fixture-secret');expect(()=>v.dbx.source('other',s.id)).toThrow();
  for(const u of ['http://www.dropbox.com/s/id/file','https://dropbox.com.evil.test/s/id/file','https://user:pass@www.dropbox.com/s/id/file','https://127.0.0.1/s/id/file'])expect(()=>sharedUrl(u)).toThrow();
  for(const p of ['../a','/a/../b','/a\\b','/a\0','/a/'])expect(()=>cloudPath(p)).toThrow();
  expect(headerJson({path:'/Música/ñ.mp3'})).not.toMatch(/[^\x00-\x7e]/);
}));

test('Authenticated stream supports byte ranges and forces active HTML content to download; writes reject foreign origins',async()=>fixture(async v=>{
  await v.connect();v.files.set('/page.html',new TextEncoder().encode('<script>alert(1)</script>'));
  const app=new Hono();app.use('*',async(c,next)=>{c.set('user','qa');await next();});registerDropboxRoutes(app,v.store,path.join(v.root,'private/cloud'),v.dbx);
  const headers={Cookie:'axon_session=fixture-session'};
  const stream=await app.request(origin+'/api/files/dropbox/stream?path=%2Fpage.html',{headers:{...headers,Range:'bytes=0-5'}});expect(stream.status).toBe(206);expect(stream.headers.get('content-disposition')).toStartWith('attachment;');expect(stream.headers.get('content-range')).toBe('bytes 0-5/25');expect(await stream.text()).toBe('<scrip');
  const write=await app.request(origin+'/api/files/dropbox/connect',{method:'POST',headers:{...headers,Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'});expect(write.status).toBe(403);
  const unauth=new Hono();registerDropboxRoutes(unauth,v.store,path.join(v.root,'private/cloud'),v.dbx);expect((await unauth.request(origin+'/api/files/dropbox/status')).status).toBe(401);
}));

test('Real host worker streams a folder, preserves empty subfolders, verifies Dropbox multi-block hashes and publishes on selected disk',async()=>fixture(async v=>{
  await v.connect();const bytes=new Uint8Array(4194304+123);bytes.fill(37);v.files.set('/Fotos/ñ.txt',bytes);v.folders.set('/Fotos',['/Fotos/ñ.txt','/Fotos/Vacía']);v.folders.set('/Fotos/Vacía',[]);
  const downloads=new CloudDownloads(v.store,v.dbx),id=await downloads.start(by.actorId,'account',['/Fotos'],path.join(v.root,'destination'),'fixture-internal:fixture');const j=await done(downloads,id);
  expect(j.error).toBeUndefined();expect(j.state).toBe('complete');expect(j.received).toBe(bytes.length);expect(j.published).toEqual(['Fotos']);expect(new Uint8Array(await readFile(path.join(v.root,'destination/Fotos/ñ.txt')))).toEqual(bytes);expect((await stat(path.join(v.root,'destination/Fotos/Vacía'))).isDirectory()).toBe(true);
  expect((await readdir(path.join(v.root,'destination'))).some((n:string)=>n.startsWith('.axon-cloud-'))).toBe(false);expect(downloads.list('other')).toEqual([]);expect(()=>downloads.get('other',id)).toThrow();
}));

test('Existing files, changed disk tokens, invalid names and hash corruption never overwrite originals or publish partial bytes',async()=>fixture(async v=>{
  await v.connect();v.files.set('/nota.txt',new TextEncoder().encode('new'));await writeFile(path.join(v.root,'destination/nota.txt'),'original');const d=new CloudDownloads(v.store,v.dbx);
  await expect(d.start(by.actorId,'account',['/nota.txt'],path.join(v.root,'destination'),'wrong')).rejects.toThrow('disco');
  const id=await d.start(by.actorId,'account',['/nota.txt'],path.join(v.root,'destination'),'fixture-internal:fixture');expect((await done(d,id)).state).toBe('failed');expect(await readFile(path.join(v.root,'destination/nota.txt'),'utf8')).toBe('original');
  v.files.set('/bad.txt',new TextEncoder().encode('actual'));
  const real=v.dbx.metadata.bind(v.dbx);v.dbx.metadata=async(...args:any[])=>({...await real(...args),hash:'0'.repeat(64)});
  const bad=await d.start(by.actorId,'account',['/bad.txt'],path.join(v.root,'destination'),'fixture-internal:fixture');expect((await done(d,bad)).state).toBe('failed');expect(await readdir(path.join(v.root,'destination'))).toEqual(['nota.txt']);
}));

test('Cancellation removes staging and leaves no partial file; interrupted jobs do not silently retry',async()=>fixture(async v=>{
  await v.connect();v.files.set('/slow.txt',new TextEncoder().encode('slow'));v.slow=true;const d=new CloudDownloads(v.store,v.dbx),id=await d.start(by.actorId,'account',['/slow.txt'],path.join(v.root,'destination'),'fixture-internal:fixture');
  for(let i=0;i<100&&d.get(by.actorId,id).state==='planning';i++)await Bun.sleep(20);
  d.cancel(by.actorId,id);expect((await done(d,id)).state).toBe('cancelled');expect(await readdir(path.join(v.root,'destination'))).toEqual([]);
  v.store.put('cloud-download','dead',{...d.get(by.actorId,id),id:'dead',state:'running',worker:'dead:999999:dead'});new CloudDownloads(v.store,v.dbx);expect(d.get(by.actorId,'dead').state).toBe('interrupted');
}));

test('A destination replaced during streaming and a file created during streaming are preserved, with no published partial copy',async()=>fixture(async v=>{
  await v.connect();v.files.set('/race.txt',new TextEncoder().encode('new'));v.slow=true;const d=new CloudDownloads(v.store,v.dbx);
  const first=await d.start(by.actorId,'account',['/race.txt'],path.join(v.root,'destination'),'fixture-internal:fixture');
  while(d.get(by.actorId,first).state==='planning')await Bun.sleep(10);
  await writeFile(path.join(v.root,'destination/race.txt'),'original arriving during copy');
  expect((await done(d,first)).state).toBe('failed');expect(await readFile(path.join(v.root,'destination/race.txt'),'utf8')).toBe('original arriving during copy');
  v.files.set('/disk.txt',new TextEncoder().encode('new'));
  const second=await d.start(by.actorId,'account',['/disk.txt'],path.join(v.root,'destination'),'fixture-internal:fixture');
  while(d.get(by.actorId,second).state==='planning')await Bun.sleep(10);
  await rename(path.join(v.root,'destination'),path.join(v.root,'original-disk'));await mkdir(path.join(v.root,'destination'));
  expect((await done(d,second)).state).toBe('failed');expect(await readdir(path.join(v.root,'destination'))).toEqual([]);expect(await readdir(path.join(v.root,'original-disk'))).toEqual(['race.txt']);
}));

test('Cursor ciphertext cannot be used for a different owner, source or folder',async()=>fixture(async v=>{
  await v.connect();const cursor=v.vault.seal({owner:by.actorId,source:'account',path:'/one',cursor:'upstream-private'},'cursor');
  await expect(v.dbx.list(by.actorId,'account','/two',cursor)).rejects.toThrow('expiró');expect(JSON.stringify(v.dbx.status(by.actorId))).not.toContain('upstream-private');
}));

test('Dropbox App Folder applications omit unsupported Path-Root and retain their limited access across restarts',async()=>fixture(async v=>{
  await v.connect();const row=v.store.get('dropbox-account',by.actorId),a=v.vault.open(row.sealed,'account:'+by.actorId);a.rootNamespace='root-fixture';v.store.put('dropbox-account',by.actorId,{...row,sealed:v.vault.seal(a,'account:'+by.actorId)});
  v.files.set('/nota.txt',new TextEncoder().encode('nota'));v.folders.set('',['/nota.txt']);let rejected=0;
  const sandboxHttp=async(url:any,init:any)=>{if(new Headers(init.headers).has('Dropbox-API-Path-Root')){rejected++;return new Response('Error in call to API function "files/list_folder": path root is not supported for sandbox app',{status:400});}return v.http(url,init);};
  const dbx=new Dropbox(v.store,v.vault,sandboxHttp as typeof fetch,'');const page=await dbx.list(by.actorId,'account','');expect(page.entries[0].name).toBe('nota.txt');expect(rejected).toBe(1);expect(dbx.status(by.actorId).appFolder).toBe(true);expect(dbx.status(by.actorId).sources[0].name).toBe('Carpeta de la aplicación');
  await dbx.metadata(by.actorId,'account','/nota.txt');await dbx.content(by.actorId,'account','/nota.txt');expect(rejected).toBe(1);expect(new Dropbox(v.store,v.vault,sandboxHttp as typeof fetch,'').status(by.actorId).appFolder).toBe(true);
}));

test('Full Dropbox keeps Path-Root; unrelated API failures cannot silently change the account scope',async()=>fixture(async v=>{
  await v.connect();const row=v.store.get('dropbox-account',by.actorId),a=v.vault.open(row.sealed,'account:'+by.actorId);a.rootNamespace='root-fixture';v.store.put('dropbox-account',by.actorId,{...row,sealed:v.vault.seal(a,'account:'+by.actorId)});await v.dbx.list(by.actorId,'account','');expect(v.calls.at(-1).headers.get('Dropbox-API-Path-Root')).toContain('root-fixture');
  const fail=new Dropbox(v.store,v.vault,(async()=>new Response('unrelated invalid request',{status:400})) as typeof fetch,'');await expect(fail.list(by.actorId,'account','')).rejects.toThrow();expect(fail.status(by.actorId).appFolder).toBe(false);
}));
