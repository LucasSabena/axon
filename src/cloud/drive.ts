import { createHash, randomBytes } from 'node:crypto';
import { PlatformStore } from '../platform/store';
import { MaintenanceError, type Actor } from '../storage/types';
import { CloudVault } from './vault';
import { cloudName, type CloudEntry } from './dropbox';
import type { CloudProvider } from './provider';

export type DriveId='gdrive'|'onedrive';
const SPECS={
  gdrive:{name:'Google Drive',auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scope:'https://www.googleapis.com/auth/drive.readonly',env:'GOOGLE_DRIVE'},
  onedrive:{name:'OneDrive',auth:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',token:'https://login.microsoftonline.com/common/oauth2/v2.0/token',scope:'offline_access https://graph.microsoft.com/Files.Read https://graph.microsoft.com/User.Read',env:'ONEDRIVE'},
};
interface App {clientId:string;clientSecret:string}
interface Account {generation:string;clientId:string;access:string;refresh:string;expires:number;name:string;email:string;id:string}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
/** Paths contain opaque IDs, never names. This preserves duplicate Drive names. */
export function drivePath(value:unknown) {
  if(typeof value!=='string'||value.length>4096||(value&&!/^\/[A-Za-z0-9_!-]+(?:\/[A-Za-z0-9_!-]+)*$/.test(value))||value.split('/').length>51||value.split('/').some(s=>s.length>200))throw new MaintenanceError('Ubicación de la nube inválida',400);
  return value;
}
function downloadUrl(raw:string):URL {
  let u:URL;try{u=new URL(raw);}catch{throw new MaintenanceError('Dirección de descarga inválida',502);}
  const allowed=['1drv.com','onedrive.com','sharepoint.com','sharepointonline.com'];
  if(u.protocol!=='https:'||u.port||u.username||u.password||!allowed.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw new MaintenanceError('OneDrive devolvió una dirección de descarga no admitida',502);
  return u;
}
export class Drive implements CloudProvider {
  private refreshes=new Map<string,Promise<Account>>();
  readonly spec;
  constructor(readonly id:DriveId,private store:PlatformStore,private vault:CloudVault,private http:typeof fetch=fetch){this.spec=SPECS[id];}
  private key(owner:string){return this.id+':'+owner;}
  private app(owner:string):App|undefined {
    const clientId=process.env[this.spec.env+'_CLIENT_ID'],clientSecret=process.env[this.spec.env+'_CLIENT_SECRET'];
    if(clientId&&clientSecret)return {clientId,clientSecret};
    const r=this.store.get<{sealed:string}>('cloud-app',this.key(owner));return r?this.vault.open<App>(r.sealed,'app:'+this.key(owner)):undefined;
  }
  configure(owner:string,clientId:unknown,clientSecret:unknown) {
    if(this.serverConfigured())throw new MaintenanceError('La aplicación está configurada por el servidor',409);
    if(this.record(owner))throw new MaintenanceError('Desconectá la cuenta antes de cambiar la aplicación',409);
    if(typeof clientId!=='string'||!/^[A-Za-z0-9_.-]{5,200}$/.test(clientId))throw new MaintenanceError('ID de aplicación inválido',400);
    const old=this.app(owner);if(clientSecret===''&&old?.clientId===clientId)clientSecret=old.clientSecret;
    if(typeof clientSecret!=='string'||!clientSecret||clientSecret.length>2000||/[\x00-\x20\x7f]/.test(clientSecret))throw new MaintenanceError('Se necesita el secreto de la aplicación',400);
    this.store.put('cloud-app',this.key(owner),{sealed:this.vault.seal({clientId,clientSecret},'app:'+this.key(owner))});
  }
  private serverConfigured(){return !!(process.env[this.spec.env+'_CLIENT_ID']&&process.env[this.spec.env+'_CLIENT_SECRET']);}
  private record(owner:string){return this.store.get<{generation:string;sealed:string}>('cloud-account',this.key(owner));}
  private account(owner:string):Account {const r=this.record(owner);if(!r)throw new MaintenanceError('Conectá tu cuenta de '+this.spec.name,409);return this.vault.open<Account>(r.sealed,'account:'+this.key(owner));}
  private save(owner:string,a:Account){this.store.put('cloud-account',this.key(owner),{generation:a.generation,sealed:this.vault.seal(a,'account:'+this.key(owner))});}
  connectionIdentity(owner:string){const a=this.account(owner);return digest(a.clientId+':'+a.id);}
  async validateRemotePath(owner:string,source:string,p:string){
    this.source(owner,source);drivePath(p);if(!p)return;
    let parent=(await this.json(owner,this.itemUrl(''))).id;
    if(typeof parent!=='string'||!parent)throw new MaintenanceError('La plataforma no confirmó su carpeta raíz',502);
    for(const id of p.split('/').filter(Boolean)){
      const m=await this.json(owner,this.itemUrl('/'+id));
      if(m.id!==id||m.trashed||m.remoteItem||(this.id==='gdrive'?!m.parents?.includes(parent):m.parentReference?.id!==parent))throw new MaintenanceError('El archivo no pertenece a la carpeta autorizada',403);
      parent=m.id;
    }
  }
  status(owner:string){const a=this.record(owner)?this.account(owner):null,config=this.app(owner);return {configured:!!config,serverConfigured:this.serverConfigured(),clientId:config?.clientId||'',connected:!!a,account:a?{name:a.name,email:a.email}:null,sources:a?[{id:'account',name:'Mi '+this.spec.name,type:'account'}]:[]};}
  source(owner:string,id:string){this.account(owner);if(id!=='account')throw new MaintenanceError('Ubicación no encontrada',404);}
  authorize(by:Actor,origin:string){
    const config=this.app(by.actorId);if(!config)throw new MaintenanceError('Configurá primero '+this.spec.name,409);
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url'),version=crypto.randomUUID(),redirect=origin+'/api/files/'+this.id+'/oauth/callback';
    this.store.put('cloud-auth-version',this.key(by.actorId),{version});
    this.store.put('cloud-oauth',digest(state),{provider:this.id,owner:by.actorId,session:by.sessionId,version,expires:Date.now()+600000,sealed:this.vault.seal({verifier,redirect,config},'oauth:'+digest(state))});
    this.store.db.query("DELETE FROM records WHERE kind='cloud-oauth' AND json_extract(payload,'$.expires') < ?").run(Date.now());
    const u=new URL(this.spec.auth);u.search=new URLSearchParams({client_id:config.clientId,response_type:'code',redirect_uri:redirect,state,scope:this.spec.scope,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',...(this.id==='gdrive'?{access_type:'offline',prompt:'consent'}:{response_mode:'query'})}).toString();return u.href;
  }
  async callback(by:Actor,state:unknown,code:unknown,denied=false){
    if(typeof state!=='string'||!/^[\w-]{43}$/.test(state))throw new MaintenanceError('Conexión expirada',400);
    const k=digest(state),r=this.store.db.transaction(()=>{const v=this.store.get<any>('cloud-oauth',k);if(!v||v.provider!==this.id||v.owner!==by.actorId||v.session!==by.sessionId||v.expires<Date.now())throw new MaintenanceError('La conexión expiró o pertenece a otra sesión',400);this.store.db.query("DELETE FROM records WHERE kind='cloud-oauth' AND id=?").run(k);return v;}).immediate();
    if(denied)return;
    if(typeof code!=='string'||!code||code.length>4000)throw new MaintenanceError('Código de autorización inválido',400);
    const {verifier,redirect,config}=this.vault.open<{verifier:string;redirect:string;config:App}>(r.sealed,'oauth:'+k);
    const valid=()=>this.store.get<{version:string}>('cloud-auth-version',this.key(by.actorId))?.version===r.version&&JSON.stringify(this.app(by.actorId))===JSON.stringify(config);
    if(!valid())throw new MaintenanceError('La conexión cambió. Volvé a conectar.',409);
    const t=await this.token(config,{grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:redirect});
    if(!t.refresh_token)throw new MaintenanceError('La plataforma no autorizó acceso persistente. Volvé a conectar.',409);
    const info=await this.jsonWith(t.access_token,this.id==='gdrive'?'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)':'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName');
    if(!valid())throw new MaintenanceError('La conexión fue cancelada. Volvé a conectar.',409);
    const user=this.id==='gdrive'?info.user:info;
    const accountId=user?.permissionId||user?.id;
    if(typeof accountId!=='string'||!accountId||accountId.length>200)throw new MaintenanceError('La plataforma no confirmó la identidad de la cuenta',502);
    this.save(by.actorId,{generation:crypto.randomUUID(),clientId:config.clientId,access:t.access_token,refresh:t.refresh_token,expires:Date.now()+t.expires_in*1000,name:user.displayName||this.spec.name,email:user.emailAddress||user.mail||user.userPrincipalName||'',id:accountId});
    this.store.append({actor:by.actorId,action:this.id+'.connect',resource:user.permissionId||user.id||this.id,status:'ok'});
  }
  async disconnect(owner:string){
    const a=this.record(owner)?this.account(owner):null;
    this.store.put('cloud-auth-version',this.key(owner),{version:crypto.randomUUID()});
    this.store.db.query("DELETE FROM records WHERE kind='cloud-account' AND id=?").run(this.key(owner));
    this.store.db.query("DELETE FROM records WHERE kind='cloud-oauth' AND json_extract(payload,'$.owner')=? AND json_extract(payload,'$.provider')=?").run(owner,this.id);
    if(a&&this.id==='gdrive')await this.http('https://oauth2.googleapis.com/revoke',{method:'POST',body:new URLSearchParams({token:a.refresh}),redirect:'error',signal:AbortSignal.timeout(10000)}).then(r=>r.body?.cancel()).catch(()=>{});
    this.store.append({actor:owner,action:this.id+'.disconnect',resource:a?.id||this.id,status:'ok'});
  }
  private async token(config:App,args:Record<string,string>){
    const r=await this.http(this.spec.token,{method:'POST',body:new URLSearchParams({...args,client_id:config.clientId,client_secret:config.clientSecret,...(this.id==='onedrive'?{scope:this.spec.scope}:{})}),redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok){await r.body?.cancel();throw new MaintenanceError(this.spec.name+' necesita una nueva autorización. Revisá la aplicación y conectá de nuevo.',409);}
    const t:any=await r.json();if(typeof t.access_token!=='string'||!Number.isFinite(Number(t.expires_in))||Number(t.expires_in)<=0)throw new MaintenanceError('Respuesta de autorización inválida',502);return t;
  }
  private async access(owner:string):Promise<Account>{
    const a=this.account(owner);if(a.expires>Date.now()+60000)return a;if(this.refreshes.has(owner))return this.refreshes.get(owner)!;
    const work=(async()=>{const config=this.app(owner);if(!config||config.clientId!==a.clientId)throw new MaintenanceError('Cambió la aplicación. Volvé a conectar.',409);const t=await this.token(config,{grant_type:'refresh_token',refresh_token:a.refresh});if(this.record(owner)?.generation!==a.generation)throw new MaintenanceError('La conexión cambió',409);const next={...a,access:t.access_token,refresh:t.refresh_token||a.refresh,expires:Date.now()+t.expires_in*1000};this.save(owner,next);return next;})();this.refreshes.set(owner,work);try{return await work;}finally{this.refreshes.delete(owner);}
  }
  private async check(r:Response){if(r.ok||r.status===416)return;await r.body?.cancel();throw new MaintenanceError(r.status===401?this.spec.name+' necesita que vuelvas a conectar tu cuenta':r.status===429?'La plataforma limitó las consultas. Esperá y reintentá.':r.status===403||r.status===404?'No tenés acceso a este contenido o ya no está disponible':'La plataforma no respondió. Volvé a intentar.',r.status===401?409:r.status===429?429:r.status===404?404:r.status===403?403:502);}
  private async jsonWith(token:string,url:string){const r=await this.http(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});await this.check(r);return r.json() as Promise<any>;}
  private async json(owner:string,url:string){return this.jsonWith((await this.access(owner)).access,url);}
  private itemUrl(p:string){const id=drivePath(p).split('/').pop();return this.id==='gdrive'?'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id||'root')+'?supportsAllDrives=true&fields=id,name,mimeType,size,modifiedTime,version,md5Checksum,capabilities(canDownload),parents,trashed':'https://graph.microsoft.com/v1.0/me/drive/'+(id?'items/'+encodeURIComponent(id):'root');}
  private entry(m:any,p:string):CloudEntry {
    const folder=this.id==='gdrive'?m.mimeType==='application/vnd.google-apps.folder':!!m.folder;
    const native=this.id==='gdrive'&&m.mimeType?.startsWith('application/vnd.google-apps.')&&!folder;
    const checksum=this.id==='gdrive'&&m.md5Checksum?{algorithm:'md5' as const,value:m.md5Checksum}:m.file?.hashes?.sha1Hash?{algorithm:'sha1' as const,value:m.file.hashes.sha1Hash}:undefined;
    const size=folder?0:Number(m.size)||0;if(!Number.isSafeInteger(size)||size<0)throw new MaintenanceError('Tamaño de archivo no compatible',502);
    return {name:cloudName(m.name),path:drivePath(p),type:folder?'dir':'file',size,modified:m.modifiedTime||m.lastModifiedDateTime||null,revision:String(this.id==='gdrive'?m.version||'':m.eTag||''),checksum,downloadable:folder||(!native&&!m.remoteItem&&(this.id==='gdrive'?m.capabilities?.canDownload!==false:!!m.file)),...(native?{webUrl:'https://drive.google.com/file/d/'+encodeURIComponent(m.id)+'/view'}:{})};
  }
  async metadata(owner:string,source:string,p:string){this.source(owner,source);drivePath(p);const m=await this.json(owner,this.itemUrl(p));return this.entry(m,p);}
  async list(owner:string,source:string,p:string,cursor?:string){
    this.source(owner,source);drivePath(p);let raw:string|undefined;
    if(cursor)try{if(cursor.length>20000)throw new Error();const c=this.vault.open<any>(cursor,'cursor:'+this.id);if(c.owner!==owner||c.generation!==this.account(owner).generation||c.source!==source||c.path!==p)throw new Error();raw=c.raw;}catch{throw new MaintenanceError('La página expiró. Actualizá la carpeta.',400);}
    const parent=p.split('/').pop()||'root';let url:string;
    if(this.id==='gdrive'){const q=new URLSearchParams({q:"'"+parent+"' in parents and trashed = false",pageSize:'500',supportsAllDrives:'true',includeItemsFromAllDrives:'true',fields:'nextPageToken,files(id,name,mimeType,size,modifiedTime,version,md5Checksum,capabilities(canDownload))',...(raw?{pageToken:raw}:{})});url='https://www.googleapis.com/drive/v3/files?'+q;}
    else{url=raw||'https://graph.microsoft.com/v1.0/me/drive/'+(p?'items/'+encodeURIComponent(parent):'root')+'/children?$top=200';const u=new URL(url);if(u.origin!=='https://graph.microsoft.com'||!u.pathname.startsWith('/v1.0/me/drive/'))throw new MaintenanceError('Page de OneDrive inválida',502);}
    const d=await this.json(owner,url),entries=(this.id==='gdrive'?d.files:d.value).map((m:any)=>{if(typeof m.id!=='string'||!/^[A-Za-z0-9_!-]{1,200}$/.test(m.id))throw new MaintenanceError('Identificador de archivo inválido',502);return this.entry(m,p+'/'+m.id);});
    const next=this.id==='gdrive'?d.nextPageToken:d['@odata.nextLink'];
    return {entries,cursor:next?this.vault.seal({owner,generation:this.account(owner).generation,source,path:p,raw:next},'cursor:'+this.id):null};
  }
  async breadcrumbs(owner:string,p:string){drivePath(p);const result:{name:string;path:string}[]=[];let at='';for(const id of p.split('/').filter(Boolean)){at+='/'+id;const e=await this.metadata(owner,'account',at);result.push({name:e.name,path:at});}return result;}
  async content(owner:string,source:string,p:string,revision?:string,range?:string,signal?:AbortSignal){
    this.source(owner,source);drivePath(p);if(!p)throw new MaintenanceError('Seleccioná un archivo',400);if(range&&!/^bytes=\d*-\d*$/.test(range))throw new MaintenanceError('Rango inválido',400);
    const a=await this.access(owner),m=await this.jsonWith(a.access,this.itemUrl(p)),entry=this.entry(m,p);
    if(!entry.downloadable||entry.type!=='file')throw new MaintenanceError('Abrí o exportá este documento desde su plataforma',409);
    if(revision&&revision!==entry.revision)throw new MaintenanceError('El archivo cambió. Actualizá la carpeta y volvé a copiar.',409);
    const timeout=signal?AbortSignal.any([signal,AbortSignal.timeout(86400000)]):AbortSignal.timeout(86400000);
    if(this.id==='gdrive'){
      const u=new URL(this.itemUrl(p));u.search='alt=media&supportsAllDrives=true';const r=await this.http(u.href,{headers:{Authorization:'Bearer '+a.access,...(range?{Range:range}:{})},redirect:'error',signal:timeout});await this.check(r);return r;
    }
    // Graph supplies a short-lived signed URL. Never send OAuth credentials to it.
    if(typeof m['@microsoft.graph.downloadUrl']!=='string')throw new MaintenanceError('OneDrive no entregó una descarga para este archivo',409);
    let u=downloadUrl(m['@microsoft.graph.downloadUrl']);for(let n=0;n<4;n++){const r=await this.http(u.href,{headers:{...(range?{Range:range}:{})},redirect:'manual',signal:timeout});if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');await r.body?.cancel();if(!location)break;u=downloadUrl(new URL(location,u).href);continue;}await this.check(r);return r;}
    throw new MaintenanceError('OneDrive redirigió demasiadas veces la descarga',502);
  }
}
