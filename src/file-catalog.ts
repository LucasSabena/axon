import type { Hono } from 'hono';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { hostToContainer } from './host';
import { hostVolumes, resolveHostPath } from './host-storage';
import { volumeForPath, type FileVolume } from './file-volumes';
import { PlatformError, type PlatformStore } from './platform/store';

export const FILE_COLORS=['red','orange','yellow','green','blue','purple','pink','gray'] as const;
export interface FileMetadata { color:string; tags:string[]; favorite:boolean; liked:boolean; saved:boolean; pinned:boolean; revision:number; updatedAt:number }
export const emptyFileMetadata=():FileMetadata=>({color:'',tags:[],favorite:false,liked:false,saved:false,pinned:false,revision:0,updatedAt:0});
const inTree=(p:string,r:string)=>p===r||p.startsWith(r.replace(/\/$/,'')+'/');
const diskFor=(p:string,volumes:FileVolume[])=>{const v=volumeForPath(volumes,p);return v?(v.uuid||v.id):'host';};
function tags(value:unknown):string[]{
  if(!Array.isArray(value)||value.length>20||value.some(t=>typeof t!=='string'||!t.trim()||t.length>40||/[\u0000-\u001f\u007f,]/.test(t)))throw new PlatformError('Usá hasta 20 etiquetas de 40 caracteres, sin comas');
  return [...new Set(value.map(t=>t.trim().normalize('NFC').toLocaleLowerCase('es')))];
}
export function metadataPatch(current:FileMetadata,input:any):FileMetadata {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['color','tags','addTags','removeTags','favorite','liked','saved','pinned','revision'].includes(k)))throw new PlatformError('Organización inválida');
  if(input.revision!==undefined&&input.revision!==current.revision)throw new PlatformError('El elemento cambió. Volvé a abrir su organización.',409);
  const next={...current,tags:[...current.tags],revision:current.revision+1,updatedAt:Date.now()};
  if(input.color!==undefined){if(input.color!==''&&!FILE_COLORS.includes(input.color))throw new PlatformError('Color inválido');next.color=input.color;}
  for(const k of ['favorite','liked','saved','pinned'] as const)if(input[k]!==undefined){if(typeof input[k]!=='boolean')throw new PlatformError('Marca inválida');next[k]=input[k];}
  if(input.tags!==undefined)next.tags=tags(input.tags);
  if(input.addTags!==undefined)next.tags=tags([...new Set([...next.tags,...tags(input.addTags)])]);
  if(input.removeTags!==undefined){const remove=tags(input.removeTags);next.tags=next.tags.filter(t=>!remove.includes(t));}
  return next;
}
/** Personal annotations stay in AXON's private database; original bytes stay untouched. */
export class FileCatalog {
  constructor(private store:PlatformStore){store.db.exec('CREATE TABLE IF NOT EXISTS file_catalog(owner TEXT NOT NULL,path TEXT NOT NULL,disk TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner,path,disk));');}
  revision(owner:string){return (this.store.db.query("SELECT COALESCE(SUM(json_extract(payload,'$.revision')),0) revision FROM file_catalog WHERE owner=?").get(owner) as any).revision as number;}
  get(owner:string,p:string,disk:string):FileMetadata {const r=this.store.db.query('SELECT payload FROM file_catalog WHERE owner=? AND path=? AND disk=?').get(owner,p,disk) as any;return r?JSON.parse(r.payload):emptyFileMetadata();}
  entries(owner:string,volumes:FileVolume[]){return (this.store.db.query('SELECT path,disk,kind,payload FROM file_catalog WHERE owner=? ORDER BY path LIMIT 20000').all(owner) as any[]).map(r=>({path:r.path,kind:r.kind,available:diskFor(r.path,volumes)===r.disk,metadata:JSON.parse(r.payload) as FileMetadata}));}
  patch(owner:string,entries:{path:string;disk:string;kind:string}[],input:any){
    return this.store.db.transaction(()=>entries.map(e=>{const metadata=metadataPatch(this.get(owner,e.path,e.disk),input);this.store.db.query('INSERT INTO file_catalog VALUES(?,?,?,?,?) ON CONFLICT(owner,path,disk) DO UPDATE SET kind=excluded.kind,payload=excluded.payload').run(owner,e.path,e.disk,e.kind,JSON.stringify(metadata));return {path:e.path,metadata};}))();
  }
  async change(action:string,from:string,to:string){
    if(!['move','restore'].includes(action))return;
    const inventory=await hostVolumes.snapshot();
    const rows=this.store.db.query('SELECT owner,path,disk,kind,payload FROM file_catalog').all() as any[];
    this.store.db.transaction(()=>{for(const r of rows){if(!inTree(r.path,from)||r.disk!==diskFor(r.path,inventory.volumes))continue;const target=to+r.path.slice(from.length),disk=diskFor(target,inventory.volumes),metadata={...JSON.parse(r.payload),revision:JSON.parse(r.payload).revision+1,updatedAt:Date.now()};this.store.db.query('INSERT INTO file_catalog VALUES(?,?,?,?,?) ON CONFLICT(owner,path,disk) DO UPDATE SET payload=excluded.payload,kind=excluded.kind').run(r.owner,target,disk,r.kind,JSON.stringify(metadata));this.store.db.query('DELETE FROM file_catalog WHERE owner=? AND path=? AND disk=?').run(r.owner,r.path,r.disk);}})();
  }
  async migrateFavorites(owner:string,paths:string[]){
    if(this.store.get('file-catalog-migration',owner))return;
    const volumes=(await hostVolumes.snapshot()).volumes;
    this.store.db.transaction(()=>{for(const p of paths){const disk=diskFor(p,volumes);if(!this.get(owner,p,disk).revision)this.patch(owner,[{path:p,disk,kind:'file'}],{favorite:true});}this.store.put('file-catalog-migration',owner,{at:Date.now()});})();
  }
}
async function availableEntries(catalog:FileCatalog,owner:string){
  const entries=catalog.entries(owner,(await hostVolumes.snapshot()).volumes),deadline=Date.now()+8000;
  let next=0;
  await Promise.all(Array.from({length:Math.min(24,entries.length)},async()=>{while(next<entries.length){const e=entries[next++];if(!e.available)continue;if(Date.now()>deadline){e.available=false;continue;}
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{const s=await Promise.race([stat(hostToContainer(e.path)),new Promise<null>(r=>{timer=setTimeout(()=>r(null),750);})]).catch(()=>null);e.available=!!s&&(s.isDirectory()||s.isFile());}finally{clearTimeout(timer);}
  }}));return entries;
}
export function registerFileCatalogRoutes(app:Hono,catalog:FileCatalog){
  const handle=(fn:(c:any)=>Promise<any>)=>async(c:any)=>{c.header('Cache-Control','private, no-store');try{return await fn(c);}catch(e:any){return c.json({ok:false,error:e.status?e.message:'No se pudo guardar la organización'},e.status||503);}};
  app.get('/api/file-catalog',handle(async c=>c.json({ok:true,entries:await availableEntries(catalog,c.get('user')),colors:FILE_COLORS,revision:catalog.revision(c.get('user'))})));
  app.patch('/api/file-catalog',handle(async c=>{
    if(Number(c.req.header('content-length')||0)>65536)throw new PlatformError('Solicitud demasiado grande',413);
    const raw=await c.req.text();if(raw.length>65536)throw new PlatformError('Solicitud demasiado grande',413);
    let body:any;try{body=JSON.parse(raw);}catch{throw new PlatformError('JSON inválido');}
    if(!body||Object.keys(body).some(k=>!['paths','patch'].includes(k))||!Array.isArray(body.paths)||!body.paths.length||body.paths.length>200||body.paths.some((p:any)=>typeof p!=='string'))throw new PlatformError('Seleccioná de 1 a 200 elementos');
    const volumes=(await hostVolumes.snapshot()).volumes,entries=[];
    for(const p of [...new Set<string>(body.paths)]){const resolved=await resolveHostPath(p,{root:true});const s=await stat(hostToContainer(resolved)).catch(()=>null);if(!s||(!s.isDirectory()&&!s.isFile()))throw new PlatformError('El elemento no está disponible',404);entries.push({path:resolved,disk:diskFor(resolved,volumes),kind:s.isDirectory()?'dir':'file'});}
    return c.json({ok:true,entries:catalog.patch(c.get('user'),entries,body.patch)});
  }));
}
