import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { PlatformStore } from '../platform/store';
import { CloudVault } from './vault';
import { Drive, drivePath, type DriveId } from './drive';
import { registerCloudRoutes } from './routes';
import { CloudDownloads } from './downloads';
import { initHostStorage } from '../host-storage';
import { setHostUser } from '../host';

const by={actorId:'qa',sessionId:'session'},origin='http://localhost';
async function fixture(id:DriveId,fn:(v:any)=>Promise<void>){
  const root=await mkdtemp(path.join(tmpdir(),'axon-cloud-test-'));await mkdir(path.join(root,'destination'));
  const store=new PlatformStore(path.join(root,'private')),vault=new CloudVault(path.join(root,'cloud')),calls:any[]=[];
  const bytes=new TextEncoder().encode('contenido de prueba');let badUrl=false,refreshes=0,rotate=false;
  const md5=createHash('md5').update(bytes).digest('hex'),sha1=createHash('sha1').update(bytes).digest('hex');
  const file=(fileId='f1')=>id==='gdrive'?{id:fileId,name:'nota.txt',parents:[fileId==='f1'?'folder1':'real-root'],mimeType:'text/plain',size:bytes.length,version:'1',md5Checksum:md5,capabilities:{canDownload:true}}:{id:fileId,name:'nota.txt',parentReference:{id:fileId==='f1'?'folder1':'real-root'},size:bytes.length,eTag:'"1"',file:{hashes:{sha1Hash:sha1}},'@microsoft.graph.downloadUrl':badUrl?'https://127.0.0.1/private':'https://fixture.files.1drv.com/signed-fixture'};
  const folder=id==='gdrive'?{id:'folder1',name:'Fotos',parents:['real-root'],mimeType:'application/vnd.google-apps.folder'}:{id:'folder1',name:'Fotos',parentReference:{id:'real-root'},folder:{childCount:1}};
  const http=async(raw:any,init:any={})=>{const u=new URL(raw),h=new Headers(init.headers),args=init.body instanceof URLSearchParams?Object.fromEntries(init.body):null;calls.push({url:u.href,headers:h,args});
    if(u.pathname.endsWith('/token')){if(args?.grant_type==='refresh_token')refreshes++;return Response.json({access_token:'access-private',refresh_token:rotate?'rotated-private':'refresh-private',expires_in:3600});}
    if(u.pathname.endsWith('/revoke'))return new Response('');
    if(u.pathname.endsWith('/about'))return Response.json({user:{displayName:'Google QA',emailAddress:'qa@example.test',permissionId:'qa1'}});
    if(u.pathname==='/v1.0/me')return Response.json({id:'qa1',displayName:'Microsoft QA',userPrincipalName:'qa@example.test'});
    if(u.hostname.endsWith('.1drv.com')||u.searchParams.get('alt')==='media')return new Response(bytes,{headers:{'Content-Length':String(bytes.length)}});
    if(u.pathname.endsWith('/children'))return Response.json({value:u.pathname.includes('folder1')?[file()]:[folder,file(),'@fixture'],...(u.searchParams.has('$skiptoken')?{}:{'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=private-cursor'})});
    if(u.pathname==='/drive/v3/files')return Response.json({files:u.searchParams.get('q')?.includes('folder1')?[file()]:[folder,file(),file('f2')],nextPageToken:u.searchParams.has('pageToken')?undefined:'private-cursor'});
    if(u.pathname.endsWith('/folder1'))return Response.json(folder);
    if(u.pathname.endsWith('/root'))return Response.json({...folder,id:'real-root'});
    return Response.json(file(u.pathname.split('/').pop()));
  };
  // Remove intentionally malformed placeholder from normal Microsoft listings.
  const wrapped=async(url:any,init:any={})=>{const r=await http(url,init);if(id==='onedrive'&&new URL(url).pathname.endsWith('/children')){const d:any=await r.json();d.value=d.value.filter((v:any)=>typeof v==='object');return Response.json(d);}return r;};
  const drive=new Drive(id,store,vault,wrapped);drive.configure(by.actorId,'fixture-client.apps.example','client-secret-private');
  const connect=async()=>{const u=new URL(drive.authorize(by,origin));await drive.callback(by,u.searchParams.get('state'),'code');return u;};
  try{await fn({root,store,vault,drive,calls,bytes,connect,get refreshes(){return refreshes;},set badUrl(v:boolean){badUrl=v;},set rotate(v:boolean){rotate=v;}});}finally{store.close();initHostStorage();await rm(root,{recursive:true,force:true});}
}
for(const id of ['gdrive','onedrive'] as DriveId[]){
 test(id+' verifies real parent IDs so a forged path cannot bypass a folder grant',async()=>fixture(id,async v=>{
   await v.connect();await v.drive.validateRemotePath('qa','account','/folder1/f1');
   await expect(v.drive.validateRemotePath('qa','account','/folder1/f2')).rejects.toThrow('carpeta autorizada');
   await expect(v.drive.validateRemotePath('qa','account','/f1')).rejects.toThrow('carpeta autorizada');
 }));
 test(id+' OAuth is read-only, PKCE/session-bound, single-use; credentials never leave the vault',async()=>fixture(id,async v=>{
   const u=new URL(v.drive.authorize(by,origin));expect(u.searchParams.get('code_challenge_method')).toBe('S256');expect(u.searchParams.get('scope')).not.toContain('Write');expect(u.searchParams.get('redirect_uri')).toBe(origin+'/api/files/'+id+'/oauth/callback');
   await expect(v.drive.callback({...by,sessionId:'other'},u.searchParams.get('state'),'code')).rejects.toThrow('sesión');await v.drive.callback(by,u.searchParams.get('state'),'code');await expect(v.drive.callback(by,u.searchParams.get('state'),'code')).rejects.toThrow();
   expect(v.drive.status(by.actorId).connected).toBe(true);expect(v.drive.status('other').connected).toBe(false);expect(JSON.stringify(v.drive.status(by.actorId))).not.toContain('private');expect(JSON.stringify(v.store.list('cloud-app'))).not.toContain('client-secret-private');expect(JSON.stringify(v.store.list('cloud-account'))).not.toContain('access-private');
   expect(v.calls.some((c:any)=>c.args?.client_secret==='client-secret-private'&&c.args?.code_verifier)).toBe(true);
   await v.drive.disconnect(by.actorId);expect(v.drive.status(by.actorId).connected).toBe(false);
 }));
 test(id+' lists IDs and names without downloading; cursors are bound and refresh is deduplicated',async()=>fixture(id,async v=>{
   await v.connect();v.calls.length=0;const p=await v.drive.list(by.actorId,'account','');expect(p.entries[0].name).toBe('Fotos');expect(p.entries[0].path).toBe('/folder1');expect(v.calls.every((c:any)=>!c.url.includes('alt=media')&&!c.url.includes('.1drv.com'))).toBe(true);expect(p.cursor).not.toContain('private-cursor');
   await expect(v.drive.list(by.actorId,'account','/folder1',p.cursor)).rejects.toThrow('expiró');await expect(v.drive.list('other','account','',p.cursor)).rejects.toThrow();await v.drive.list(by.actorId,'account','',p.cursor);
   const r=v.store.get('cloud-account',id+':qa'),a=v.vault.open(r.sealed,'account:'+id+':qa');a.expires=0;v.store.put('cloud-account',id+':qa',{...r,sealed:v.vault.seal(a,'account:'+id+':qa')});v.rotate=true;
   await Promise.all([v.drive.list(by.actorId,'account',''),v.drive.list(by.actorId,'account','')]);expect(v.refreshes).toBe(1);expect(v.vault.open(v.store.get('cloud-account',id+':qa').sealed,'account:'+id+':qa').refresh).toBe('rotated-private');
   expect(await v.drive.breadcrumbs(by.actorId,'/folder1')).toEqual([{name:'Fotos',path:'/folder1'}]);
 }));
 test(id+' safely copies through the real host worker and verifies provider checksums',async()=>fixture(id,async v=>{
   await v.connect();initHostStorage(v.root);setHostUser(userInfo().username);const d=new CloudDownloads(v.store,v.drive,id),j=await d.start('qa','account',['/f1'],path.join(v.root,'destination'),'fixture-internal:fixture');
   for(let n=0;n<200&&['planning','running'].includes(d.get('qa',j).state);n++)await Bun.sleep(20);
   expect(d.get('qa',j).state).toBe('complete');expect(new Uint8Array(await readFile(path.join(v.root,'destination/nota.txt')))).toEqual(v.bytes);expect(await readdir(path.join(v.root,'destination'))).toEqual(['nota.txt']);expect(new CloudDownloads(v.store,v.drive,id==='gdrive'?'onedrive':'gdrive').list('qa')).toEqual([]);
 }));
}
test('OneDrive signed downloads never receive OAuth headers; foreign URLs and changed revisions are rejected',async()=>fixture('onedrive',async v=>{
 await v.connect();await v.drive.content('qa','account','/f1','"1"','bytes=0-2');const signed=v.calls.find((c:any)=>c.url.includes('.1drv.com'));expect(signed.headers.has('authorization')).toBe(false);expect(signed.headers.get('range')).toBe('bytes=0-2');
 await expect(v.drive.content('qa','account','/f1','"old"')).rejects.toThrow('cambió');v.badUrl=true;await expect(v.drive.content('qa','account','/f1')).rejects.toThrow('dirección');
 for(const p of ['/../etc','/id?url=http://127.0.0.1','https://evil.test','/id\\name'])expect(()=>drivePath(p)).toThrow();
}));
test('Connections visibility is owner-scoped, persistent, authenticated and CSRF protected',async()=>fixture('gdrive',async v=>{
 await v.connect();const app=new Hono();app.use('*',async(c,next)=>{if(c.req.header('cookie'))c.set('user',c.req.header('x-test-user')||'qa');await next();});registerCloudRoutes(app,v.store,path.join(v.root,'cloud'),{gdrive:v.drive});
 const headers={Cookie:'axon_session=fixture',Origin:origin,'Content-Type':'application/json'};
 expect((await app.request(origin+'/api/connections')).status).toBe(401);
 expect((await app.request(origin+'/api/connections/gdrive/visibility',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:'{"visible":false}'})).status).toBe(403);
 expect((await app.request(origin+'/api/connections/gdrive/visibility',{method:'POST',headers,body:'{"visible":false}'})).status).toBe(200);
 const r=await app.request(origin+'/api/connections',{headers}),d:any=await r.json();expect(r.headers.get('cache-control')).toContain('no-store');expect(d.providers.find((p:any)=>p.id==='gdrive')).toMatchObject({connected:true,visible:false});expect(JSON.stringify(d)).not.toContain('client-secret-private');
 const other:any=await(await app.request(origin+'/api/connections',{headers:{...headers,'x-test-user':'other'}})).json();expect(other.providers.find((p:any)=>p.id==='gdrive')).toMatchObject({connected:false,visible:true});expect(v.drive.status('qa').connected).toBe(true);
}));
