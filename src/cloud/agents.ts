import { createHash } from 'node:crypto';
import { PlatformError, type PlatformStore, type ApiIdentity, type CloudGrant, type CloudScope } from '../platform/store';
import { MaintenanceError } from '../storage/types';
import type { CloudProvider, CloudUploadProvider } from './provider';
import type { CloudEntry } from './dropbox';
import type { CloudVault } from './vault';
import { drivePath } from './drive';
import { UploadRejected } from './dropbox';

export const CLOUD_NAMES = {dropbox:'Dropbox',gdrive:'Google Drive',onedrive:'OneDrive'};
export const UPLOAD_CHUNK = 8 * 1024 * 1024;
const BLOCK = 4 * 1024 * 1024, KIND = 'cloud-agent-upload';
type UploadState = 'starting'|'running'|'committing'|'complete'|'failed'|'cancelled'|'uncertain';
interface Upload {
  id:string; owner:string; credentialId:string; agent:string; provider:string; source:string; path:string; size:number;
  received:number; state:UploadState; at:number; updated:number; connectionId:string; sealed?:string;
  inflight?:{offset:number;size:number;hash:string}; last?:{offset:number;size:number;hash:string};
  hash?:string; result?:CloudEntry; error?:string;
}
export function agentPath(value:unknown):string {
  if(typeof value!=='string'||value.length>4096||/[\x00-\x1f\x7f\\]/.test(value)||(value&&(!value.startsWith('/')||value.endsWith('/')||value.includes('//')))||value.split('/').some(v=>v==='.'||v==='..'))throw new PlatformError('Ruta remota inválida');
  return value;
}
const within=(provider:string,p:string,root:string)=>{if(provider==='dropbox'){p=p.toLowerCase();root=root.toLowerCase();}return !root||p===root||p.startsWith(root+'/');};
export function cloudError(e:unknown):PlatformError {return e instanceof PlatformError?e:e instanceof MaintenanceError?new PlatformError(e.message,e.status):new PlatformError('No se pudo completar la operación en la nube',503);}
const exact=(v:any,keys:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw new PlatformError('Campo no permitido');};
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');

/** Delegates credentials to AXON, never to a client. All paths are remote identifiers. */
export class CloudAgents {
  private locks = new Set<string>();
  constructor(readonly store:PlatformStore,readonly providers:Record<string,CloudProvider>,private vault:CloudVault) {
    for(const u of store.list<Upload>(KIND))if(u.state==='starting'){
      u.state='failed';u.error='El inicio fue interrumpido. No se publicó el archivo.';this.save(u);
      store.append({actor:u.owner,credentialId:u.credentialId,action:'cloud.upload.interrupted',resource:u.provider+':'+u.path,status:'interrupted',operationId:u.id,detail:u.agent});
    }
  }
  available(owner:string){return Object.entries(this.providers).flatMap(([id,p])=>{const s=p.status(owner);return s.connected?[{id,name:CLOUD_NAMES[id as keyof typeof CLOUD_NAMES],sources:s.sources,uploadSupported:!!s.uploadSupported,uploadGranted:!!s.uploadGranted}]:[];});}
  async grants(owner:string,value:unknown):Promise<CloudGrant[]> {
    if(!Array.isArray(value)||value.length>100)throw new PlatformError('Permisos de conexión inválidos');
    const result:CloudGrant[]=[];
    for(const g of value){
      exact(g,['provider','source','root','scopes']);const p=this.providers[g.provider];
      if(!p?.status(owner).connected||!p.connectionIdentity)throw new PlatformError('Conexión no disponible',409);
      if(typeof g.source!=='string'||!p.status(owner).sources.some(s=>s.id===g.source)||!Array.isArray(g.scopes)||!g.scopes.length||g.scopes.some((s:any)=>!['cloud:read','cloud:upload'].includes(s)))throw new PlatformError('Ubicación o permiso inválido');
      const root=agentPath(g.root),connectionId=p.connectionIdentity(owner);
      await p.validateRemotePath?.(owner,g.source,root);
      if(g.scopes.includes('cloud:upload')&&(g.provider!=='dropbox'||g.source!=='account'||!p.status(owner).uploadGranted))throw new PlatformError('Primero habilitá las subidas de Dropbox desde Conexiones',409);
      if(root&&(await p.metadata(owner,g.source,root)).type!=='dir')throw new PlatformError('Elegí una carpeta existente para limitar el acceso');
      if(connectionId!==p.connectionIdentity(owner))throw new PlatformError('La conexión cambió; volvé a crear el token',409);
      result.push({provider:g.provider,source:g.source,root,scopes:[...new Set<CloudScope>(g.scopes)],connectionId});
    }
    return result;
  }
  connections(identity:ApiIdentity){this.store.assertActive(identity);return this.available(identity.owner).flatMap(p=>{const grants=(identity.cloudGrants||[]).filter(g=>g.provider===p.id&&g.connectionId===this.providers[p.id].connectionIdentity?.(identity.owner));return grants.length?[{...p,sources:p.sources.filter(s=>grants.some(g=>g.source===s.id)),grants:grants.map(({source,root,scopes})=>({source,root,scopes}))}]:[];});}
  private async access(identity:ApiIdentity,provider:string,source:string,path:string,scope:CloudScope){
    this.store.assertActive(identity);agentPath(path);
    const p=this.providers[provider];
    const grants=(identity.cloudGrants||[]).filter(g=>g.provider===provider&&g.source===source&&g.scopes.includes(scope)&&within(provider,path,g.root));
    if(!grants.length||!p)throw new PlatformError('El token no tiene permiso para esta conexión, carpeta y acción',403);
    if(!p.status(identity.owner).connected||!p.connectionIdentity||!grants.some(g=>g.connectionId===p.connectionIdentity!(identity.owner)))throw new PlatformError('La conexión cambió. Creá un token para la cuenta actual',403);
    // Drive routes contain opaque IDs: a string prefix alone does not prove ancestry.
    if(provider==='dropbox'||grants.every(g=>!!g.root))await p.validateRemotePath?.(identity.owner,source,path);
    else drivePath(path);
    this.store.assertActive(identity);return {p,connectionId:p.connectionIdentity(identity.owner)};
  }
  private unchanged(identity:ApiIdentity,provider:string,connectionId:string){this.store.assertActive(identity);if(this.providers[provider].connectionIdentity?.(identity.owner)!==connectionId)throw new PlatformError('La conexión cambió durante la operación',409);}
  private audit(identity:ApiIdentity,action:string,provider:string,path:string,status:'ok'|'running'|'failed'='ok',operationId?:string){this.store.append({actor:identity.owner,credentialId:identity.id,action:'cloud.'+action,resource:provider+':'+path,status,operationId,detail:identity.name});}
  async list(identity:ApiIdentity,provider:string,source:string,path:string,cursor?:string){
    try{
      const {p,connectionId}=await this.access(identity,provider,source,path,'cloud:read');let raw:string|undefined;
      if(cursor){if(cursor.length>24000)throw new PlatformError('Cursor inválido');try{const v=this.vault.open<any>(cursor,'agent-cursor');if(v.token!==identity.id||v.provider!==provider||v.source!==source||v.path!==path||v.connectionId!==connectionId||v.expires<Date.now())throw new Error();raw=v.cursor;}catch{throw new PlatformError('La página expiró o pertenece a otro token o carpeta');}}
      const page=await p.list(identity.owner,source,path,raw);this.unchanged(identity,provider,connectionId);
      // The upstream adapter owns ID ancestry; Dropbox entries still need prefix filtering.
      const entries=page.entries.filter(e=>(identity.cloudGrants||[]).some(g=>g.provider===provider&&g.source===source&&g.scopes.includes('cloud:read')&&within(provider,e.path,g.root)));
      this.audit(identity,'list',provider,path);
      return {...page,entries,cursor:page.cursor?this.vault.seal({token:identity.id,provider,source,path,connectionId,cursor:page.cursor,expires:Date.now()+3600000},'agent-cursor'):null};
    }catch(e){throw cloudError(e);}
  }
  async metadata(identity:ApiIdentity,provider:string,source:string,path:string){try{const {p,connectionId}=await this.access(identity,provider,source,path,'cloud:read');const m=await p.metadata(identity.owner,source,path);this.unchanged(identity,provider,connectionId);this.audit(identity,'metadata',provider,path);return m;}catch(e){throw cloudError(e);}}
  async content(identity:ApiIdentity,provider:string,source:string,path:string,revision?:string,range?:string,signal?:AbortSignal){
    try{const {p,connectionId}=await this.access(identity,provider,source,path,'cloud:read');const m=await p.metadata(identity.owner,source,path);
      if(m.type!=='file'||!m.downloadable)throw new PlatformError('El archivo requiere abrirse o exportarse desde su plataforma',409);
      if(revision!==undefined&&revision!==m.revision)throw new PlatformError('El archivo cambió; consultá sus metadatos de nuevo',409);
      this.unchanged(identity,provider,connectionId);
      const r=await p.content(identity.owner,source,path,m.revision,range,signal);
      try{this.unchanged(identity,provider,connectionId);}catch(e){await r.body?.cancel();throw e;}
      this.audit(identity,'download',provider,path);
      return {response:r,metadata:m};
    }catch(e){throw cloudError(e);}
  }
  async readText(identity:ApiIdentity,provider:string,source:string,path:string){
    if(!/\.(txt|md|csv|json|jsonl|yaml|yml|xml|html|css|js|ts|py|srt|vtt|log|svg)$/i.test(path))throw new PlatformError('Para este archivo usá la descarga binaria');
    const {response,metadata}=await this.content(identity,provider,source,path,undefined,'bytes=0-65535');
    const bytes=await boundedBytes(response.body,65536,true);
    if(bytes.includes(0))throw new PlatformError('El archivo contiene datos binarios');
    return {metadata,text:new TextDecoder('utf-8').decode(bytes),truncated:metadata.size>bytes.length};
  }
  private publicUpload(u:Upload){const {sealed,inflight,last,connectionId,owner,credentialId,...result}=u;return {...result,chunkSize:UPLOAD_CHUNK};}
  retireCredentials(){
    const active=new Set(this.store.tokens().filter(t=>!t.revoked&&t.expiresAt>Date.now()).map(t=>t.id));
    for(const u of this.store.list<Upload>(KIND))if(['starting','running'].includes(u.state)&&!active.has(u.credentialId)){u.state='cancelled';u.error='El token fue revocado o venció. No se publicó el archivo.';this.save(u);this.store.append({actor:u.owner,credentialId:u.credentialId,action:'cloud.upload.credential-expired',resource:u.provider+':'+u.path,status:'interrupted',operationId:u.id});}
  }
  ownerUploads(owner:string,provider:string){this.retireCredentials();return this.store.list<Upload>(KIND).filter(u=>u.owner===owner&&u.provider===provider).slice(0,20).map(u=>this.publicUpload(u));}
  private save(u:Upload){u.updated=Date.now();this.store.put(KIND,u.id,u);}
  private uploadProvider(provider:string):CloudUploadProvider {const p=this.providers[provider] as CloudUploadProvider;if(provider!=='dropbox'||!p?.beginUpload)throw new PlatformError('Las subidas están disponibles para Dropbox',409);return p;}
  private async upload(identity:ApiIdentity,id:string){
    const u=this.store.get<Upload>(KIND,id);if(!u||u.credentialId!==identity.id||u.owner!==identity.owner)throw new PlatformError('Subida no encontrada',404);
    const {connectionId}=await this.access(identity,u.provider,u.source,u.path,'cloud:upload');
    if(connectionId!==u.connectionId)throw new PlatformError('Cambió la conexión de esta subida',403);
    if(Date.now()-u.at>6*86400000&&['starting','running'].includes(u.state)){u.state='failed';u.error='La sesión de subida expiró';this.save(u);}
    return u;
  }
  private async locked<T>(id:string,fn:()=>Promise<T>){if(this.locks.has(id))throw new PlatformError('La subida tiene una operación en curso',409);this.locks.add(id);try{return await fn();}catch(e){throw cloudError(e);}finally{this.locks.delete(id);}}
  async start(identity:ApiIdentity,provider:string,value:any){
    exact(value,['source','path','size','requestId']);const source=value.source||'account',path=agentPath(value.path);
    if(!path||!Number.isSafeInteger(value.size)||value.size<0||value.size>256*1024**3)throw new PlatformError('Indicá un archivo y un tamaño entre 0 y 256 GiB');
    if(typeof value.requestId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId))throw new PlatformError('requestId debe ser un UUID v4');
    return this.locked(value.requestId,async()=>{
      const {connectionId}=await this.access(identity,provider,source,path,'cloud:upload'),p=this.uploadProvider(provider);
      if(source!=='account'||!p.status(identity.owner).uploadGranted)throw new PlatformError('Autorizá las subidas de Dropbox desde Conexiones',409);
      const old=this.store.get<Upload>(KIND,value.requestId);
      if(old){await this.upload(identity,old.id);if(old.provider!==provider||old.source!==source||old.path!==path||old.size!==value.size)throw new PlatformError('requestId ya usado para otro archivo',409);return this.publicUpload(old);}
      this.retireCredentials();
      if(this.store.list<Upload>(KIND).filter(u=>u.owner===identity.owner&&Date.now()-u.at<6*86400000&&['starting','running','committing'].includes(u.state)).length>=3)throw new PlatformError('Ya hay tres subidas en curso',409);
      const u:Upload={id:value.requestId,owner:identity.owner,credentialId:identity.id,agent:identity.name,provider,source,path,size:value.size,received:0,state:'starting',at:Date.now(),updated:Date.now(),connectionId};this.save(u);this.audit(identity,'upload.start',provider,path,'running',u.id);
      try{const session=await p.beginUpload(identity.owner);this.unchanged(identity,provider,connectionId);u.sealed=this.vault.seal({session},'agent-upload:'+u.id);u.state='running';this.save(u);}
      catch(e){u.state='failed';u.error=cloudError(e).message;this.save(u);this.audit(identity,'upload.start',provider,path,'failed',u.id);throw e;}
      return this.publicUpload(u);
    });
  }
  async append(identity:ApiIdentity,id:string,offset:number,bytes:Uint8Array,signal?:AbortSignal){return this.locked(id,async()=>{
    const u=await this.upload(identity,id);if(u.state!=='running')throw new PlatformError('La subida no acepta bloques en este estado',409);
    if(!Number.isSafeInteger(offset)||offset<0||!bytes.length||bytes.length>UPLOAD_CHUNK)throw new PlatformError('Bloque o posición inválidos');
    const chunk={offset,size:bytes.length,hash:sha(bytes)};
    if(offset<u.received){if(u.last&&JSON.stringify(chunk)===JSON.stringify(u.last))return this.publicUpload(u);throw new PlatformError('El bloque ya recibido no coincide',409);}
    if(offset!==u.received||bytes.length!==Math.min(UPLOAD_CHUNK,u.size-offset))throw new PlatformError('El tamaño o la posición no coinciden con la subida',409);
    if(u.inflight&&JSON.stringify(chunk)!==JSON.stringify(u.inflight))throw new PlatformError('Reintentá el mismo bloque para confirmar su recepción',409);
    u.inflight=chunk;this.save(u);
    const {session}=this.vault.open<{session:string}>(u.sealed!,'agent-upload:'+u.id);
    const accepted=await this.uploadProvider(u.provider).appendUpload(identity.owner,session,offset,bytes,signal);
    if(accepted!==offset+bytes.length)throw new PlatformError('Dropbox devolvió una posición diferente; no se publicó el archivo',409);
    this.unchanged(identity,u.provider,u.connectionId);
    this.store.db.transaction(()=>{
      for(let n=0;n<bytes.length;n+=BLOCK)this.store.put('cloud-agent-block',u.id+':'+String(offset+n).padStart(12,'0'),{hash:sha(bytes.subarray(n,n+BLOCK))});
      u.received=accepted;u.last=chunk;delete u.inflight;this.save(u);
    }).immediate();return this.publicUpload(u);
  });}
  private fullHash(u:Upload){const h=createHash('sha256');let count=0;for(const row of this.store.db.query('SELECT payload FROM records WHERE kind=? AND id>=? AND id<? ORDER BY id').iterate('cloud-agent-block',u.id+':',u.id+';') as Iterable<{payload:string}>){h.update(Buffer.from(JSON.parse(row.payload).hash,'hex'));count++;}if(count!==Math.ceil(u.size/BLOCK))throw new PlatformError('Faltan comprobantes de bloques; no se publicó el archivo',409);return h.digest('hex');}
  private complete(identity:ApiIdentity,u:Upload,m:CloudEntry){if(m.type!=='file'||m.size!==u.size||m.hash!==u.hash)throw new PlatformError('No se pudo confirmar la integridad del archivo publicado',409);u.state='complete';u.result=m;delete u.error;this.save(u);this.audit(identity,'upload.complete',u.provider,u.path,'ok',u.id);}
  async status(identity:ApiIdentity,id:string){return this.locked(id,async()=>{const u=await this.upload(identity,id);if(['committing','uncertain'].includes(u.state)){
    try{const m=await this.providers[u.provider].metadata(identity.owner,u.source,u.path);this.unchanged(identity,u.provider,u.connectionId);this.complete(identity,u,m);}catch{u.state='uncertain';u.error='No se confirmó la publicación. Revisá el destino antes de iniciar otra subida.';this.save(u);}
  }return this.publicUpload(u);});}
  async finish(identity:ApiIdentity,id:string,value:any,signal?:AbortSignal){exact(value,['hash']);if(typeof value.hash!=='string'||! /^[0-9a-f]{64}$/.test(value.hash))throw new PlatformError('Indicá el content hash de Dropbox');
    return this.locked(id,async()=>{const u=await this.upload(identity,id);if(u.state==='complete'){if(u.hash!==value.hash)throw new PlatformError('El hash no coincide',409);return this.publicUpload(u);}
      if(u.state!=='running'||u.received!==u.size||u.inflight)throw new PlatformError('La subida no está lista. Consultá su estado antes de reintentar',409);
      if(this.fullHash(u)!==value.hash)throw new PlatformError('El hash del archivo no coincide. No se publicó el archivo',409);
      u.hash=value.hash;u.state='committing';this.save(u);
      const {session}=this.vault.open<{session:string}>(u.sealed!,'agent-upload:'+u.id);
      try{const m=await this.uploadProvider(u.provider).finishUpload(identity.owner,session,u.size,u.path,signal);this.unchanged(identity,u.provider,u.connectionId);this.complete(identity,u,m);}
      catch(e){u.state=e instanceof UploadRejected?'failed':'uncertain';u.error=e instanceof UploadRejected?e.message:'No se confirmó la publicación. Consultá el estado y revisá el destino.';this.save(u);this.audit(identity,'upload.unconfirmed',u.provider,u.path,'failed',u.id);throw e;}
      return this.publicUpload(u);
    });
  }
  async cancel(identity:ApiIdentity,id:string){return this.locked(id,async()=>{const u=await this.upload(identity,id);if(['committing','uncertain','complete'].includes(u.state))throw new PlatformError('La publicación ya comenzó. Consultá su resultado',409);u.state='cancelled';this.save(u);this.audit(identity,'upload.cancel',u.provider,u.path,'ok',u.id);return this.publicUpload(u);});}
}

export async function boundedBytes(body:ReadableStream<Uint8Array>|null,max:number,truncate=false){
  if(!body)return new Uint8Array();const reader=body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;if(size+value.length>max){if(!truncate)throw new PlatformError('Bloque demasiado grande',413);parts.push(value.subarray(0,max-size));size=max;break;}parts.push(value);size+=value.length;if(truncate&&size===max)break;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return bytes;
}
