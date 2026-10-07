import { test, expect } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { PlatformStore } from '../platform/store';
import { machineApi, registerPlatformRoutes } from '../platform/api';
import { ProjectHub } from '../platform/projects';
import { Diagnostics } from '../platform/diagnostics';
import { CloudAgents, UPLOAD_CHUNK, boundedBytes } from './agents';
import { CloudVault } from './vault';
import { Dropbox, UploadRejected, dropboxContentHash, type CloudEntry } from './dropbox';
import type { CloudUploadProvider } from './provider';

class Provider implements CloudUploadProvider {
  connection='account-one'; write=true; connected=true; commits=0; loseAppend=false; loseCommit=false;
  files=new Map<string,Uint8Array>(); sessions=new Map<string,Uint8Array[]>();
  status(owner:string){return {configured:true,serverConfigured:false,connected:this.connected&&owner==='owner',account:{name:'Fixture',email:''},sources:[{id:'account',name:'Mi Dropbox',type:'account'}],uploadSupported:true,uploadGranted:this.write};}
  connectionIdentity(){return this.connection;}
  authorize(){return '';}
  async callback(){}
  async disconnect(){this.connected=false;}
  source(){}
  validateRemotePath(){}
  async list(_owner:string,_source:string,p:string,cursor?:string){return {entries:[...this.files].filter(([v])=>v.startsWith(p+'/')).map(([v])=>this.entry(v)),cursor:cursor?null:'upstream-private-cursor'};}
  entry(p:string):CloudEntry{return {name:p.split('/').pop()||'root',path:p,type:this.files.has(p)?'file':'dir',size:this.files.get(p)?.length||0,modified:null,revision:'revision:'+p,hash:this.files.has(p)?dropboxContentHash(this.files.get(p)!):undefined,downloadable:true};}
  async metadata(_owner:string,_source:string,p:string){return this.entry(p);}
  async content(_owner:string,_source:string,p:string,_revision?:string,range?:string){const b=this.files.get(p)!;const part=range?b.subarray(0,65536):b;return new Response(new Uint8Array(part),{status:range?206:200});}
  async beginUpload(){const id=crypto.randomUUID();this.sessions.set(id,[]);return id;}
  async appendUpload(_owner:string,session:string,offset:number,b:Uint8Array){const chunks=this.sessions.get(session)!,received=chunks.reduce((n,b)=>n+b.length,0);if(offset!==received)return received;chunks.push(b.slice());if(this.loseAppend){this.loseAppend=false;throw new Error('lost response');}return offset+b.length;}
  async finishUpload(_owner:string,session:string,_offset:number,p:string){this.commits++;if(this.files.has(p))throw new UploadRejected('El archivo ya existe',409);this.files.set(p,Buffer.concat(this.sessions.get(session)!));if(this.loseCommit){this.loseCommit=false;throw new Error('lost commit response');}return this.entry(p);}
}
async function fixture(fn:(f:any)=>Promise<void>){
  const root=await mkdtemp(path.join(tmpdir(),'axon-cloud-agent-')),store=new PlatformStore(path.join(root,'state')),vault=new CloudVault(path.join(root,'cloud'));
  const provider=new Provider(),cloud=new CloudAgents(store,{dropbox:provider},vault);
  const hub=new ProjectHub(store,{projects:()=>[],processes:async()=>[],containers:async()=>[],domains:()=>[],home:async()=>root,chats:async()=>({items:[]}),consumption:async()=>({})} as any),diagnostics=new Diagnostics(hub);
  const deps={store,hub,diagnostics,logs:async()=>[],cloud},app=machineApi(deps);
  const make=async(scopes=['cloud:read','cloud:upload'],folder='/allowed',owner='owner')=>store.createToken({name:'Videos',days:1,grants:[],cloudGrants:await cloud.grants(owner,[{provider:'dropbox',source:'account',root:folder,scopes}])},owner,[]);
  const key=await make(),identity=key.identity;
  const request=(route:string,method='GET',body?:any,token=key.token,headers:any={})=>app.request('http://localhost'+route,{method,headers:{Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':body instanceof Uint8Array?'application/octet-stream':'application/json'}:{}),...headers},body:body instanceof Uint8Array?new Uint8Array(body):body===undefined?undefined:JSON.stringify(body)});
  try{await fn({root,store,vault,provider,cloud,key,identity,make,app,deps,request});}finally{store.close();await rm(root,{recursive:true,force:true});}
}
const start=(f:any,size:number,p='/allowed/video.mp4')=>f.cloud.start(f.identity,'dropbox',{source:'account',path:p,size,requestId:crypto.randomUUID()});

test('Cloud credentials are owner/account/root/action scoped; token hashing and legacy API isolation are retained',async()=>fixture(async f=>{
  f.provider.files.set('/allowed/note.txt',new TextEncoder().encode('text'));f.provider.files.set('/other/private.txt',new Uint8Array([1]));
  expect((await f.request('/cloud/dropbox/list?path=/allowed')).status).toBe(200);
  for(const p of ['/other','/allowed-evil','/allowed/../other','/allowed//other'])expect((await f.request('/cloud/dropbox/list?path='+encodeURIComponent(p))).status).toBeGreaterThanOrEqual(400);
  expect((await f.request('/cloud/onedrive/list?path=/allowed')).status).toBe(403);
  expect((await f.request('/config')).status).toBe(404);
  expect((await f.app.request('/cloud/connections',{headers:{Cookie:'axon_session=fake'}})).status).toBe(401);
  const read=await f.make(['cloud:read']);expect((await f.request('/cloud/dropbox/uploads','POST',{path:'/allowed/a',size:1,requestId:crypto.randomUUID()},read.token)).status).toBe(403);
  expect(JSON.stringify(f.store.tokens())).not.toContain(f.key.token);
  await expect(f.make(['cloud:upload'],'','different-owner')).rejects.toThrow('Conexión');
  f.provider.connection='another-account';expect((await f.request('/cloud/dropbox/list?path=/allowed')).status).toBe(403);expect(f.cloud.connections(f.identity)).toEqual([]);
  f.provider.connection='account-one';f.store.revoke(f.identity.id,'owner');expect((await f.request('/cloud/connections')).status).toBe(401);
}));

test('Opaque cursors bind to token, account, source and folder; arbitrary revision cannot escape a folder grant',async()=>fixture(async f=>{
  f.provider.files.set('/allowed/note.txt',new TextEncoder().encode('hello'));
  const page=await f.cloud.list(f.identity,'dropbox','account','/allowed');expect(page.cursor).not.toContain('upstream-private-cursor');
  const other=await f.make();await expect(f.cloud.list(other.identity,'dropbox','account','/allowed',page.cursor)).rejects.toThrow('otro token');
  await expect(f.cloud.list(f.identity,'dropbox','account','/allowed/sub',page.cursor)).rejects.toThrow('carpeta');
  expect((await f.cloud.list(f.identity,'dropbox','account','/allowed',page.cursor)).cursor).toBeNull();
  expect((await f.request('/cloud/dropbox/content?path=/allowed/note.txt&revision=revision:/other/private.txt')).status).toBe(409);
  const r=await f.request('/cloud/dropbox/content?path=/allowed/note.txt');expect(r.headers.get('content-type')).toBe('application/octet-stream');expect(r.headers.get('content-disposition')).toStartWith('attachment;');expect(await r.text()).toBe('hello');
}));

test('Concurrent downloads hold transfer slots while navigation stays available',async()=>fixture(async f=>{
  f.provider.files.set('/allowed/note.txt',new Uint8Array([1,2,3]));
  const opened:Response[]=[];
  try{
    for(let n=0;n<3;n++){const r=await f.request('/cloud/dropbox/content?path=/allowed/note.txt');expect(r.status).toBe(200);expect(r.headers.get('X-Axon-Limit-Lane')).toBe('transfer');opened.push(r);}
    const blocked=await f.request('/cloud/dropbox/content?path=/allowed/note.txt');expect(blocked.status).toBe(429);expect(await blocked.json()).toMatchObject({lane:'transfer',reason:'concurrency',retryAfter:1});
    const page=await f.request('/cloud/dropbox/list?path=/allowed');expect(page.status).toBe(200);expect(page.headers.get('X-Axon-Limit-Lane')).toBe('read');
    await opened[0].arrayBuffer();const next=await f.request('/cloud/dropbox/content?path=/allowed/note.txt');expect(next.status).toBe(200);opened.push(next);
  }finally{for(const r of opened)if(!r.bodyUsed)await r.body?.cancel();}
}));

test('Chunked multi-block upload requires exact offsets/size/hash and survives lost acknowledgements without duplicate bytes',async()=>fixture(async f=>{
  const bytes=new Uint8Array(UPLOAD_CHUNK+17).fill(53),u=await start(f,bytes.length);
  expect(JSON.stringify(f.cloud.ownerUploads('owner','dropbox'))).not.toContain('sealed');
  expect(JSON.stringify(f.store.get('cloud-agent-upload',u.id))).not.toContain([...f.provider.sessions.keys()][0]);
  expect((await f.cloud.start(f.identity,'dropbox',{path:u.path,size:u.size,requestId:u.id})).id).toBe(u.id);
  await expect(f.cloud.append(f.identity,u.id,0,new Uint8Array([1]))).rejects.toThrow('tamaño');
  f.provider.loseAppend=true;await expect(f.cloud.append(f.identity,u.id,0,bytes.subarray(0,UPLOAD_CHUNK))).rejects.toThrow();
  await expect(f.cloud.append(f.identity,u.id,0,new Uint8Array(UPLOAD_CHUNK))).rejects.toThrow('mismo bloque');
  expect((await f.cloud.append(f.identity,u.id,0,bytes.subarray(0,UPLOAD_CHUNK))).received).toBe(UPLOAD_CHUNK);
  expect((await f.cloud.append(f.identity,u.id,0,bytes.subarray(0,UPLOAD_CHUNK))).received).toBe(UPLOAD_CHUNK);
  await f.cloud.append(f.identity,u.id,UPLOAD_CHUNK,bytes.subarray(UPLOAD_CHUNK));
  await expect(f.cloud.finish(f.identity,u.id,{hash:'0'.repeat(64)})).rejects.toThrow('hash');expect(f.provider.commits).toBe(0);
  const done=await f.cloud.finish(f.identity,u.id,{hash:dropboxContentHash(bytes)});expect(done.state).toBe('complete');expect(f.provider.files.get(u.path)).toEqual(bytes);expect(f.provider.commits).toBe(1);
  expect((await f.cloud.finish(f.identity,u.id,{hash:dropboxContentHash(bytes)})).state).toBe('complete');expect(f.provider.commits).toBe(1);
  expect(f.store.audit().entries.some((e:any)=>e.action==='cloud.upload.complete'&&e.credentialId===f.identity.id&&e.operationId===u.id)).toBe(true);
}));

test('Conflicts preserve originals; uncertain commit is reconciled after restart, not blindly re-published',async()=>fixture(async f=>{
  const bytes=new Uint8Array([1,2,3]);f.provider.files.set('/allowed/exists.mp4',new Uint8Array([9]));
  const conflict=await start(f,3,'/allowed/exists.mp4');await f.cloud.append(f.identity,conflict.id,0,bytes);await expect(f.cloud.finish(f.identity,conflict.id,{hash:dropboxContentHash(bytes)})).rejects.toThrow('existe');expect((await f.cloud.status(f.identity,conflict.id)).state).toBe('failed');expect(f.provider.files.get(conflict.path)).toEqual(new Uint8Array([9]));
  const u=await start(f,3);await f.cloud.append(f.identity,u.id,0,bytes);f.provider.loseCommit=true;
  await expect(f.cloud.finish(f.identity,u.id,{hash:dropboxContentHash(bytes)})).rejects.toThrow();
  const restarted=new CloudAgents(f.store,{dropbox:f.provider},f.vault);expect((await restarted.status(f.identity,u.id)).state).toBe('complete');expect(f.provider.commits).toBe(2);
}));

test('Empty uploads, cancellation, ownership and revocation prevent unauthorized publication',async()=>fixture(async f=>{
  const u=await start(f,0);expect((await f.cloud.finish(f.identity,u.id,{hash:dropboxContentHash(new Uint8Array())})).state).toBe('complete');
  const c=await start(f,1,'/allowed/cancel');await f.cloud.cancel(f.identity,c.id);await expect(f.cloud.append(f.identity,c.id,0,new Uint8Array([1]))).rejects.toThrow('estado');
  const next=await start(f,1,'/allowed/next'),other=await f.make();await expect(f.cloud.status(other.identity,next.id)).rejects.toThrow('encontrada');
  f.store.revoke(f.identity.id,'owner');await expect(f.cloud.append(f.identity,next.id,0,new Uint8Array([1]))).rejects.toThrow('revocado');expect(f.provider.files.has(next.path)).toBe(false);
  expect(f.cloud.ownerUploads('owner','dropbox').find((u:any)=>u.id===next.id).state).toBe('cancelled');
  expect(f.cloud.ownerUploads('other','dropbox')).toEqual([]);
}));

test('Bearer REST and MCP enforce schemas; bounded streams reject oversize, text reads truncate safely',async()=>fixture(async f=>{
  const catalog=await(await f.request('/capabilities')).json();expect(catalog.permissions.cloud[0].root).toBe('/allowed');expect(catalog.routes.some((r:any)=>r.path==='/api/v1/cloud/dropbox/uploads')).toBe(true);expect(catalog.routes.some((r:any)=>r.path.startsWith('/api/v1/projects'))).toBe(false);expect(catalog.coverage.administrativeAccess).toBe(false);
  const mcp=async(method:string,params:any={})=>(await (await f.request('/mcp','POST',{jsonrpc:'2.0',id:1,method,params},f.key.token,{Accept:'application/json, text/event-stream'})).json());
  expect((await mcp('initialize',{protocolVersion:'2025-11-25'})).result.serverInfo.name).toBe('axon');
  expect((await mcp('tools/list')).result.tools.map((t:any)=>t.name)).toContain('axon_cloud_read_text');
  expect((await mcp('tools/call',{name:'axon_cloud_list',arguments:{provider:'dropbox',path:'/other'}})).result.isError).toBe(true);
  expect((await mcp('tools/call',{name:'axon_cloud_list',arguments:{provider:'dropbox',path:'/allowed',owner:'other'}})).result.isError).toBe(true);
  f.provider.files.set('/allowed/text.txt',new Uint8Array(70000).fill(65));const text=await mcp('tools/call',{name:'axon_cloud_read_text',arguments:{provider:'dropbox',path:'/allowed/text.txt'}});expect(text.result.structuredContent.text.length).toBe(65536);expect(text.result.structuredContent.truncated).toBe(true);
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(5));c.close();}});await expect(boundedBytes(stream,4)).rejects.toThrow('grande');
  const u=await start(f,1);expect((await f.request('/cloud/uploads/'+u.id+'?offset=0','PUT',new Uint8Array([2]))).status).toBe(200);expect((await f.request('/cloud/uploads/'+u.id+'/finish','POST',{hash:dropboxContentHash(new Uint8Array([2])),overwrite:true})).status).toBe(400);
  const admin=new Hono();admin.use('*',async(c,next)=>{c.set('user','owner');await next();});registerPlatformRoutes(admin,f.deps);
  const forged=await admin.request('/api/access/tokens',{method:'POST',body:JSON.stringify({name:'forged',days:1,grants:[],cloudGrants:[{provider:'dropbox',source:'account',root:'',scopes:['cloud:read'],connectionId:'arbitrary'}]})});expect(forged.status).toBe(400);
}));

test('Python CLI and MCP transfer binary files end to end, preserve local originals, and never print credentials',async()=>fixture(async f=>{
  const bytes=new Uint8Array(UPLOAD_CHUNK+31).fill(49);f.provider.files.set('/allowed/source.mp4',bytes);await writeFile(path.join(f.root,'input.mp4'),bytes);
  const serverApp=new Hono();serverApp.route('/api/v1',f.app);const server=Bun.serve({port:0,fetch:serverApp.fetch});
  const env={...process.env,AXON_URL:'http://127.0.0.1:'+server.port,AXON_TOKEN:f.key.token,AXON_CONFIG:path.join(f.root,'not-used.json')};
  const run=async(args:string[],stdin?:string)=>{const child=Bun.spawn(['python3',path.resolve('public/axon-cloud.py'),...args],{env,stdout:'pipe',stderr:'pipe',stdin:stdin===undefined?'ignore':new TextEncoder().encode(stdin)});const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect(out+err).not.toContain(f.key.token);return {out,err,code};};
  try{
    const upload=await run(['upload','dropbox',path.join(f.root,'input.mp4'),'/allowed/render.mp4']);expect(upload.code).toBe(0);expect(JSON.parse(upload.out).state).toBe('complete');expect(f.provider.files.get('/allowed/render.mp4')).toEqual(bytes);
    const catalog=await run(['capabilities']);expect(catalog.code).toBe(0);expect(JSON.parse(catalog.out).tools.some((t:any)=>t.name==='axon_capabilities')).toBe(true);
    const partial=await start(f,bytes.length,'/allowed/resume.mp4');await f.cloud.append(f.identity,partial.id,0,bytes.subarray(0,UPLOAD_CHUNK));
    const resumed=await run(['upload','dropbox',path.join(f.root,'input.mp4'),'/allowed/resume.mp4','--resume',partial.id]);expect(resumed.code).toBe(0);expect(f.provider.files.get('/allowed/resume.mp4')).toEqual(bytes);
    const destination=path.join(f.root,'download.mp4');expect((await run(['download','dropbox','/allowed/source.mp4',destination])).code).toBe(0);expect(new Uint8Array(await readFile(destination))).toEqual(bytes);expect((await stat(destination)).mode&0o077).toBe(0);
    expect((await run(['download','dropbox','/allowed/source.mp4',destination])).code).toBe(1);expect(new Uint8Array(await readFile(destination))).toEqual(bytes);
    await symlink(path.join(f.root,'input.mp4'),path.join(f.root,'link'));expect((await run(['upload','dropbox',path.join(f.root,'link'),'/allowed/link'])).code).toBe(1);
    const requests=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'axon_cloud_download_file',arguments:{provider:'dropbox',remotePath:'/allowed/render.mp4',localPath:path.join(f.root,'mcp.mp4')}}}];
    const mcp=await run(['mcp'],requests.map(v=>JSON.stringify(v)).join('\n')+'\n'),responses=mcp.out.trim().split('\n').map(v=>JSON.parse(v));expect(mcp.code).toBe(0);expect(responses.length).toBe(3);expect(responses[1].result.tools.map((t:any)=>t.name)).toContain('axon_cloud_upload_file');expect(responses[2].result.isError).toBe(false);expect(new Uint8Array(await readFile(path.join(f.root,'mcp.mp4')))).toEqual(bytes);
  }finally{server.stop(true);}
}),30000);

test('Dropbox adapter requests write scope explicitly and sends sequential sessions with per-call content hashes and strict conflicts',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'axon-dropbox-upload-')),store=new PlatformStore(path.join(root,'state')),vault=new CloudVault(path.join(root,'cloud')),calls:any[]=[];
  const http=async(url:any,options:any={})=>{
    const headers=new Headers(options.headers),arg=headers.has('Dropbox-API-Arg')?JSON.parse(headers.get('Dropbox-API-Arg')!):null;calls.push({url:String(url),arg,body:options.body,headers});
    if(String(url).endsWith('/oauth2/token'))return Response.json({access_token:'private-access',refresh_token:'private-refresh',expires_in:3600,scope:'account_info.read files.metadata.read files.content.read sharing.read files.content.write'});
    if(String(url).endsWith('/users/get_current_account'))return Response.json({account_id:'account',name:{display_name:'Fixture'}});
    if(String(url).endsWith('/upload_session/start'))return Response.json({session_id:'private-session'});
    if(String(url).endsWith('/upload_session/append_v2'))return new Response(null);
    if(String(url).endsWith('/upload_session/finish'))return Response.json({'.tag':'file',name:'final.mp4',size:3,rev:'r1',content_hash:dropboxContentHash(new Uint8Array([1,2,3]))});
    throw new Error('Unexpected fixture endpoint');
  };
  try{
    const dbx=new Dropbox(store,vault,http,''),by={actorId:'owner',sessionId:'session'};dbx.configure('owner','fixture-key');const read=new URL(dbx.authorize(by,'http://localhost'));expect(read.searchParams.get('scope')).not.toContain('write');await dbx.callback(by,read.searchParams.get('state'),'code');expect(dbx.status('owner').uploadGranted).toBe(false);await expect(dbx.beginUpload('owner')).rejects.toThrow('subidas');
    const before=dbx.connectionIdentity('owner'),write=new URL(dbx.authorize(by,'http://localhost',true));expect(write.searchParams.get('scope')).toContain('files.content.write');await dbx.callback(by,write.searchParams.get('state'),'code');expect(dbx.connectionIdentity('owner')).toBe(before);
    const session=await dbx.beginUpload('owner'),b=new Uint8Array([1,2,3]);await dbx.appendUpload('owner',session,0,b);await dbx.finishUpload('owner',session,3,'/final.mp4');
    const append=calls.find(c=>c.url.endsWith('append_v2'));expect(append.arg.content_hash).toBe(dropboxContentHash(b));const finish=calls.find(c=>c.url.endsWith('/finish'));expect(finish.arg.commit).toEqual({path:'/final.mp4',mode:'add',autorename:false,strict_conflict:true});expect(finish.arg.content_hash).toBeUndefined();expect(JSON.stringify(store.list('dropbox-account'))).not.toContain('private-access');
  }finally{store.close();await rm(root,{recursive:true,force:true});}
});
