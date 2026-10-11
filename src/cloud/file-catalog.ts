import type { PlatformStore } from '../platform/store';
import { PlatformError } from '../platform/store';
import { emptyFileMetadata, metadataPatch, type FileMetadata } from '../file-catalog';
import type { CloudProvider } from './provider';
/** Annotations belong to the connected account; no provider content is modified or downloaded. */
export class CloudFileCatalog {
  constructor(private store:PlatformStore){store.db.exec('CREATE TABLE IF NOT EXISTS cloud_file_catalog(owner TEXT NOT NULL,provider TEXT NOT NULL,connection TEXT NOT NULL,source TEXT NOT NULL,path TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner,provider,connection,source,path));');}
  list(owner:string,provider:string,connection:string,source:string){return (this.store.db.query('SELECT path,name,kind,payload FROM cloud_file_catalog WHERE owner=? AND provider=? AND connection=? AND source=? ORDER BY path LIMIT 20000').all(owner,provider,connection,source) as any[]).map(r=>({path:r.path,name:r.name,kind:r.kind,metadata:JSON.parse(r.payload) as FileMetadata}));}
  async patch(owner:string,provider:string,p:CloudProvider,source:unknown,paths:unknown,input:unknown){
    if(!p.status(owner).connected||!p.connectionIdentity)throw new PlatformError('La cuenta no está conectada',409);
    if(typeof source!=='string'||!p.status(owner).sources.some(s=>s.id===source))throw new PlatformError('Ubicación inválida');
    if(!Array.isArray(paths)||!paths.length||paths.length>200||paths.some(v=>typeof v!=='string'||v.length>4096||/[\x00-\x1f\x7f]/.test(v)))throw new PlatformError('Seleccioná de 1 a 200 elementos');
    const connection=p.connectionIdentity(owner),entries=[];
    for(const path of [...new Set<string>(paths)]){await p.validateRemotePath?.(owner,source,path);entries.push(await p.metadata(owner,source,path));}
    if(connection!==p.connectionIdentity(owner))throw new PlatformError('La conexión cambió. Volvé a abrir la carpeta.',409);
    const current=new Map(this.list(owner,provider,connection,source).map(r=>[r.path,r.metadata]));
    return this.store.db.transaction(()=>entries.map(e=>{const metadata=metadataPatch(current.get(e.path)||emptyFileMetadata(),input);this.store.db.query('INSERT INTO cloud_file_catalog VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,provider,connection,source,path) DO UPDATE SET name=excluded.name,kind=excluded.kind,payload=excluded.payload').run(owner,provider,connection,source,e.path,e.name,e.type,JSON.stringify(metadata));return {path:e.path,metadata};}))();
  }
}
