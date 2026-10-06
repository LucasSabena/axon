import { createHash, randomBytes } from 'node:crypto';
import { PlatformStore } from '../platform/store';
import { MaintenanceError, type Actor } from '../storage/types';
import { CloudVault } from './vault';

export interface CloudEntry { name: string; path: string; type: 'file' | 'dir'; size: number; modified: string | null; revision?: string; hash?: string; checksum?:{algorithm:'md5'|'sha1'|'sha256';value:string}; webUrl?:string; downloadable: boolean }
interface Account { generation: string; clientId: string; refresh: string; access: string; expires: number; accountId: string; name: string; email: string; rootNamespace?:string; appFolder?:boolean; uploadGranted?:boolean }
interface Shared { id: string; name: string; url: string; type: 'file' | 'dir'; root: CloudEntry }
interface Stored { sealed: string; generation: string }
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
class AppFolderRootError extends Error {}
export class UploadRejected extends MaintenanceError {}
export const headerJson = (value: unknown) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
export function cloudPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f\\]/.test(value) || (value && (!value.startsWith('/') || value.endsWith('/'))) || value.split('/').some(v => v === '.' || v === '..')) throw new MaintenanceError('Ruta de Dropbox inválida', 400);
  return value;
}
export function cloudName(value: unknown): string {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[/\\\x00-\x1f\x7f]/.test(value) || Buffer.byteLength(value) > 255) throw new MaintenanceError('La plataforma devolvió un nombre no compatible con el disco', 400);
  return value;
}
export function sharedUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new MaintenanceError('Enlace inválido', 400);
  let u: URL; try { u = new URL(value); } catch { throw new MaintenanceError('Enlace inválido', 400); }
  if (u.protocol !== 'https:' || !['www.dropbox.com', 'dropbox.com'].includes(u.hostname) || u.username || u.password || u.port || !/^\/(s\/|sh\/|scl\/(fi|fo)\/)/.test(u.pathname)) throw new MaintenanceError('Pegá un enlace compartido de Dropbox', 400);
  u.hash = ''; u.searchParams.delete('dl'); u.searchParams.delete('raw'); return u.toString();
}
export class Dropbox {
  private refreshes = new Map<string, Promise<Account>>();
  constructor(readonly store: PlatformStore, private vault: CloudVault, private http: typeof fetch = fetch, private envClient = process.env.DROPBOX_CLIENT_ID || '') {}
  clientId(owner: string): string { return this.envClient || this.store.get<{clientId:string}>('dropbox-app', owner)?.clientId || ''; }
  configure(owner: string, value: unknown) {
    if (this.envClient) throw new MaintenanceError('La aplicación está configurada por el servidor', 409);
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{5,100}$/.test(value)) throw new MaintenanceError('App key inválida', 400);
    if (this.record(owner)) throw new MaintenanceError('Desconectá la cuenta antes de cambiar la aplicación', 409);
    this.store.put('dropbox-app', owner, {clientId:value});
  }
  private record(owner:string) { return this.store.get<Stored>('dropbox-account', owner); }
  private account(owner:string): Account {
    const r = this.record(owner); if (!r?.sealed) throw new MaintenanceError('Conectá tu cuenta de Dropbox', 409);
    return this.vault.open<Account>(r.sealed, 'account:'+owner);
  }
  private save(owner:string, a:Account) { this.store.put('dropbox-account', owner, {generation:a.generation,sealed:this.vault.seal(a,'account:'+owner)}); }
  status(owner:string) {
    const a = this.record(owner)?.sealed ? this.account(owner) : null;
    return {configured:!!this.clientId(owner),serverConfigured:!!this.envClient,clientId:this.clientId(owner),connected:!!a,appFolder:!!a?.appFolder,uploadSupported:true,uploadGranted:!!a?.uploadGranted,account:a ? {name:a.name,email:a.email} : null,sources:a ? [{id:'account',name:a.appFolder?'Carpeta de la aplicación':'Mi Dropbox',type:'account'},...this.shares(owner).map(s=>({id:s.id,name:s.name,type:'shared'}))] : []};
  }
  connectionIdentity(owner:string){const a=this.account(owner);return digest(a.clientId+':'+a.accountId+':'+(a.rootNamespace||''));}
  validateRemotePath(owner:string,source:string,p:string){this.source(owner,source);cloudPath(p);}
  authorize(by:Actor, origin:string,upload=false) {
    const clientId = this.clientId(by.actorId); if (!clientId) throw new MaintenanceError('Configurá primero la aplicación de Dropbox', 409);
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    const redirect = origin+'/api/files/dropbox/oauth/callback';
    const version=crypto.randomUUID();this.store.put('dropbox-auth-version',by.actorId,{version});
    this.store.put('dropbox-oauth', digest(state), {owner:by.actorId,session:by.sessionId,version,expires:Date.now()+600000,sealed:this.vault.seal({verifier,clientId,redirect,upload},'oauth:'+digest(state))});
    this.store.db.query("DELETE FROM records WHERE kind='dropbox-oauth' AND json_extract(payload,'$.expires') < ?").run(Date.now());
    const u = new URL('https://www.dropbox.com/oauth2/authorize');
    u.search = new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirect,state,code_challenge:digestBase64(verifier),code_challenge_method:'S256',token_access_type:'offline',scope:'account_info.read files.metadata.read files.content.read sharing.read'+(upload?' files.content.write':'')}).toString();
    return u.toString();
  }
  async callback(by:Actor, state:unknown, code:unknown, denied=false) {
    if (typeof state !== 'string' || !/^[\w-]{43}$/.test(state)) throw new MaintenanceError('La conexión expiró. Volvé a conectar.', 400);
    const key = digest(state);
    const record = this.store.db.transaction(()=>{
      const r=this.store.get<{owner:string;session:string;version:string;expires:number;sealed:string}>('dropbox-oauth',key);
      if (!r || r.owner!==by.actorId || r.session!==by.sessionId || r.expires<Date.now()) throw new MaintenanceError('La conexión expiró o pertenece a otra sesión',400);
      this.store.db.query("DELETE FROM records WHERE kind='dropbox-oauth' AND id=?").run(key); return r;
    }).immediate();
    if (denied) return;
    if (typeof code !== 'string' || !code || code.length>2000) throw new MaintenanceError('Código de autorización inválido',400);
    const {verifier,clientId,redirect,upload}=this.vault.open<{verifier:string;clientId:string;redirect:string;upload?:boolean}>(record.sealed,'oauth:'+key);
    if (clientId!==this.clientId(by.actorId)) throw new MaintenanceError('Cambió la aplicación de Dropbox. Volvé a conectar.',409);
    const token = await this.token({grant_type:'authorization_code',code,code_verifier:verifier,client_id:clientId,redirect_uri:redirect});
    if (!token.refresh_token) throw new MaintenanceError('Dropbox no autorizó una conexión persistente. Volvé a conectar.',502);
    const info = await this.rpcWith(token.access_token,'users/get_current_account',null);
    if(typeof info.account_id!=='string'||!info.account_id||info.account_id.length>200)throw new MaintenanceError('Dropbox no confirmó la identidad de la cuenta',502);
    if(this.store.get<{version:string}>('dropbox-auth-version',by.actorId)?.version!==record.version || clientId!==this.clientId(by.actorId))throw new MaintenanceError('La conexión fue cancelada o cambió. Volvé a conectar.',409);
    const uploadGranted=!!upload&&(typeof token.scope==='string'?token.scope.split(' ').includes('files.content.write'):true);
    if(upload&&!uploadGranted)throw new MaintenanceError('Dropbox no concedió permiso para subir. Habilitá files.content.write en la aplicación y autorizá de nuevo.',409);
    const a:Account={generation:crypto.randomUUID(),clientId,refresh:token.refresh_token,access:token.access_token,expires:Date.now()+token.expires_in*1000,accountId:info.account_id,name:info.name?.display_name || 'Dropbox',email:info.email || '',rootNamespace:info.root_info?.root_namespace_id,uploadGranted};
    this.save(by.actorId,a);
    this.store.append({actor:by.actorId,action:'dropbox.connect',resource:a.accountId,status:'ok'});
  }
  async disconnect(owner:string) {
    const a=this.account(owner);
    this.store.put('dropbox-auth-version',owner,{version:crypto.randomUUID()});
    // Remove locally first: network failures must not resurrect credentials.
    this.store.db.query("DELETE FROM records WHERE (kind='dropbox-account' OR kind='dropbox-shared') AND (id=? OR json_extract(payload,'$.owner')=?)").run(owner,owner);
    this.store.db.query("DELETE FROM records WHERE kind='dropbox-oauth' AND json_extract(payload,'$.owner')=?").run(owner);
    await this.rpcWith(a.access,'auth/token/revoke',null).catch(()=>{});
    this.store.append({actor:owner,action:'dropbox.disconnect',resource:a.accountId,status:'ok'});
  }
  private async token(params:Record<string,string>) {
    const r=await this.http('https://api.dropboxapi.com/oauth2/token',{method:'POST',body:new URLSearchParams(params),redirect:'error',signal:AbortSignal.timeout(30000)});
    if (!r.ok) {await r.body?.cancel();throw new MaintenanceError('Dropbox no autorizó la conexión. Revisá la aplicación y volvé a conectar.',409);}
    const v:any=await r.json(); if (typeof v.access_token!=='string' || !Number.isFinite(v.expires_in)) throw new MaintenanceError('Respuesta de autorización inválida',502); return v;
  }
  private async access(owner:string):Promise<Account> {
    const a=this.account(owner); if (a.expires>Date.now()+60000) return a;
    if (this.refreshes.has(owner)) return this.refreshes.get(owner)!;
    const work=(async()=>{
      const t=await this.token({grant_type:'refresh_token',refresh_token:a.refresh,client_id:a.clientId});
      if (this.record(owner)?.generation!==a.generation) throw new MaintenanceError('La conexión cambió. Actualizá Dropbox.',409);
      const updated={...a,access:t.access_token,expires:Date.now()+t.expires_in*1000};this.save(owner,updated);return updated;
    })();this.refreshes.set(owner,work);
    try {return await work;} finally {this.refreshes.delete(owner);}
  }
  private async check(r:Response) {
    if (r.ok) return;
    await r.body?.cancel();
    if (r.status===401) throw new MaintenanceError('Dropbox necesita que vuelvas a conectar tu cuenta',409);
    if (r.status===429) throw new MaintenanceError('Dropbox limitó temporalmente las consultas. Esperá un momento y reintentá.',429);
    throw new MaintenanceError(r.status===409 || r.status===403 ? 'El contenido no está disponible o no tenés permiso en Dropbox' : 'Dropbox no respondió. Volvé a intentar.',r.status===409?409:502);
  }
  private async rpcWith(access:string, method:string, body:unknown, rootNamespace?:string) {
    const r=await this.http('https://api.dropboxapi.com/2/'+method,{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json',...(rootNamespace?{'Dropbox-API-Path-Root':headerJson({'.tag':'root',root:rootNamespace})}:{})},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
    if(rootNamespace&&r.status===400&&(await r.clone().text()).includes('path root is not supported for sandbox app')){await r.body?.cancel();throw new AppFolderRootError();}
    await this.check(r);return r.json() as Promise<any>;
  }
  async rpc(owner:string, method:string, body:unknown) {
    const a=await this.access(owner);
    try{return await this.rpcWith(a.access,method,body,a.appFolder?undefined:a.rootNamespace);}catch(e){
      if(!(e instanceof AppFolderRootError))throw e;
      if(this.record(owner)?.generation!==a.generation)throw new MaintenanceError('La conexión cambió. Actualizá Dropbox.',409);
      // App Folder applications cannot use Path-Root. Keep their limited scope;
      // dropping this header does not grant access beyond the app directory.
      this.save(owner,{...this.account(owner),appFolder:true});
      return this.rpcWith(a.access,method,body);
    }
  }
  private shares(owner:string):Shared[] {return this.store.list<{owner:string;sealed:string;id:string}>('dropbox-shared').filter(r=>r.owner===owner).map(r=>this.vault.open<Shared>(r.sealed,'shared:'+r.id));}
  source(owner:string,id:string):Shared|undefined {
    this.account(owner);if(id==='account')return;
    const r=this.store.get<{owner:string;sealed:string}>('dropbox-shared',id);if(!r||r.owner!==owner)throw new MaintenanceError('Ubicación de Dropbox no encontrada',404);
    return this.vault.open<Shared>(r.sealed,'shared:'+id);
  }
  async addShared(owner:string,url:unknown) {
    if(this.shares(owner).length>=30)throw new MaintenanceError('Ya hay 30 enlaces guardados. Quitá uno para agregar otro.',409);
    const valid=sharedUrl(url),m=await this.rpc(owner,'sharing/get_shared_link_metadata',{url:valid});
    if (!['file','folder'].includes(m['.tag'])) throw new MaintenanceError('El enlace no apunta a un archivo o carpeta',400);
    const id=crypto.randomUUID(),root=entry(m,'');const s:Shared={id,name:root.name,url:valid,type:root.type,root};
    this.store.put('dropbox-shared',id,{id,owner,sealed:this.vault.seal(s,'shared:'+id)});return {id,name:s.name};
  }
  removeShared(owner:string,id:string) {this.source(owner,id);this.store.db.query("DELETE FROM records WHERE kind='dropbox-shared' AND id=?").run(id);}
  async list(owner:string,id:string,p:string,cursor?:string) {
    cloudPath(p);const s=this.source(owner,id);
    if (s?.type==='file') {if(p || cursor)throw new MaintenanceError('El enlace contiene un solo archivo',400);return {entries:[s.root],cursor:null};}
    if (cursor && (cursor.length>12000 || typeof cursor!=='string')) throw new MaintenanceError('Cursor inválido',400);
    // Bind opaque upstream cursors to account, source and directory.
    let raw:string|undefined;
    if(cursor)try {const c=this.vault.open<{owner:string;generation:string;source:string;path:string;cursor:string}>(cursor,'cursor');if(c.owner!==owner||c.generation!==this.account(owner).generation||c.source!==id||c.path!==p)throw new Error();raw=c.cursor;}catch{throw new MaintenanceError('La página de Dropbox expiró. Actualizá la carpeta.',400);}
    const result=await this.rpc(owner,raw?'files/list_folder/continue':'files/list_folder',raw?{cursor:raw}:{path:p,limit:500,...(s?{shared_link:{url:s.url}}:{})});
    return {entries:result.entries.filter((m:any)=>['file','folder'].includes(m['.tag'])).map((m:any)=>entry(m,s?(p+'/'+m.name):m.path_display)),cursor:result.has_more?this.vault.seal({owner,generation:this.account(owner).generation,source:id,path:p,cursor:result.cursor},'cursor'):null};
  }
  async metadata(owner:string,id:string,p:string):Promise<CloudEntry> {
    cloudPath(p);const s=this.source(owner,id);
    const m=await this.rpc(owner,s?'sharing/get_shared_link_metadata':'files/get_metadata',s?{url:s.url,...(p?{path:p}:{})}:{path:p});return entry(m,p);
  }
  async content(owner:string,id:string,p:string,revision?:string,range?:string,signal?:AbortSignal) {
    cloudPath(p); const s=this.source(owner,id),a=await this.access(owner);
    if(range&&!/^bytes=\d*-\d*$/.test(range))throw new MaintenanceError('Rango inválido',400);
    const args=s?{url:s.url,...(p?{path:p}:{})}:{path:revision?'rev:'+revision:p};
    const r=await this.http('https://content.dropboxapi.com/2/'+(s?'sharing/get_shared_link_file':'files/download'),{method:'POST',headers:{Authorization:'Bearer '+a.access,'Dropbox-API-Arg':headerJson(args),...(a.rootNamespace&&!a.appFolder?{'Dropbox-API-Path-Root':headerJson({'.tag':'root',root:a.rootNamespace})}:{}),...(range?{Range:range}:{})},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(86400000)]):AbortSignal.timeout(86400000)});
    if(r.status===416)return r;
    await this.check(r);return r;
  }
  private async uploadCall(owner:string,method:string,args:unknown,data:Uint8Array,signal?:AbortSignal){
    const a=await this.access(owner);if(!a.uploadGranted)throw new MaintenanceError('Habilitá las subidas de Dropbox desde Conexiones y autorizá files.content.write',409);
    const r=await this.http('https://content.dropboxapi.com/2/files/'+method,{method:'POST',headers:{Authorization:'Bearer '+a.access,'Content-Type':'application/octet-stream','Dropbox-API-Arg':headerJson(args),...(a.rootNamespace&&!a.appFolder?{'Dropbox-API-Path-Root':headerJson({'.tag':'root',root:a.rootNamespace})}:{})},body:data as BodyInit,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});
    if(this.record(owner)?.generation!==a.generation){await r.body?.cancel();throw new MaintenanceError('La conexión cambió durante la subida. Consultá su estado antes de reintentar.',409);}
    if(a.rootNamespace&&!a.appFolder&&r.status===400&&(await r.clone().text()).includes('path root is not supported for sandbox app')){await r.body?.cancel();this.save(owner,{...this.account(owner),appFolder:true});return this.uploadCall(owner,method,args,data,signal);}
    return r;
  }
  async beginUpload(owner:string){const r=await this.uploadCall(owner,'upload_session/start',{close:false},new Uint8Array());await this.check(r);const d=await r.json() as any;if(typeof d.session_id!=='string'||d.session_id.length>2000)throw new MaintenanceError('Respuesta de subida inválida',502);return d.session_id as string;}
  async appendUpload(owner:string,session:string,offset:number,data:Uint8Array,signal?:AbortSignal){
    const r=await this.uploadCall(owner,'upload_session/append_v2',{cursor:{session_id:session,offset},close:false,content_hash:dropboxContentHash(data)},data,signal);
    if(r.status===409){const d=await r.json().catch(()=>null) as any;if(d?.error?.['.tag']==='incorrect_offset'&&Number.isSafeInteger(d.error.correct_offset))return d.error.correct_offset as number;throw new MaintenanceError('Dropbox rechazó el bloque de subida',409);}
    await this.check(r);await r.body?.cancel();return offset+data.length;
  }
  async finishUpload(owner:string,session:string,offset:number,p:string,signal?:AbortSignal){
    cloudPath(p);if(!p)throw new MaintenanceError('Elegí un archivo de destino',400);
    const r=await this.uploadCall(owner,'upload_session/finish',{cursor:{session_id:session,offset},commit:{path:p,mode:'add',autorename:false,strict_conflict:true},content_hash:dropboxContentHash(new Uint8Array())},new Uint8Array(),signal);
    if(r.status===409){await r.body?.cancel();throw new UploadRejected('Dropbox rechazó la publicación: revisá si existe el destino o falta su carpeta. No se reemplazan archivos.',409);}
    await this.check(r);return entry(await r.json(),p);
  }
}
export function dropboxContentHash(data:Uint8Array){const hash=createHash('sha256');for(let i=0;i<data.length;i+=4194304)hash.update(createHash('sha256').update(data.subarray(i,i+4194304)).digest());return hash.digest('hex');}
const digestBase64=(s:string)=>createHash('sha256').update(s).digest('base64url');
function entry(m:any,p:string):CloudEntry {
  const type=m['.tag']==='folder'?'dir':'file';
  return {name:cloudName(m.name),path:cloudPath(p),type,size:type==='dir'?0:Number(m.size)||0,modified:m.server_modified || null,revision:m.rev,hash:m.content_hash,downloadable:type==='dir'||m.is_downloadable!==false};
}
