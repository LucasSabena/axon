import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { PlatformStore } from '../platform/store';
import { type CloudEntry } from './dropbox';
import type { CloudProvider } from './provider';
import { resolveHostPath, hostVolumes } from '../host-storage';
import { hostToContainer, HOST_USER, ON_HOST } from '../host';
import { hostArgv } from '../storage/host-argv';
import { volumeForPath } from '../file-volumes';
import { incarnation } from '../storage/repository';
import { MaintenanceError } from '../storage/types';

export interface CloudDownload {
  id:string; owner:string; worker:string|null; provider?:string; source:string; directory:string; names:string[]; state:'planning'|'running'|'complete'|'failed'|'cancelled'|'interrupted';
  bytes:number; received:number; files:number; completedFiles:number; published:string[]; at:number; updated:number; error?:string;
}
type Item={entry:CloudEntry;relative:string};
export class CloudDownloads {
  private active=new Map<string,AbortController>();
  constructor(private store:PlatformStore,private dropbox:CloudProvider,private providerId='dropbox') {
    for(const j of store.list<CloudDownload>('cloud-download')) if(['planning','running'].includes(j.state) && j.worker!==incarnation()) {
      const pid=Number(j.worker?.split(':')[1]);if(j.worker && incarnation(pid)===j.worker)continue;
      this.save({...j,state:'interrupted',error:'AXON se reinició. Revisá el destino antes de volver a copiar; la operación no se reanuda automáticamente.'});
    }
  }
  private save(j:CloudDownload){j.updated=Date.now();this.store.put('cloud-download',j.id,j);}
  list(owner:string){return this.store.list<CloudDownload>('cloud-download').filter(j=>j.owner===owner&&(j.provider||'dropbox')===this.providerId).slice(0,30).map(({owner,worker,...j})=>j);}
  get(owner:string,id:string){const j=this.store.get<CloudDownload>('cloud-download',id);if(!j||j.owner!==owner||(j.provider||'dropbox')!==this.providerId)throw new MaintenanceError('Descarga no encontrada',404);return j;}
  cancel(owner:string,id:string){this.get(owner,id);this.active.get(id)?.abort();}
  cancelOwner(owner:string){for(const [id,c] of this.active)if(this.store.get<CloudDownload>('cloud-download',id)?.owner===owner)c.abort();}
  async start(owner:string,source:string,paths:string[],directory:string,token:unknown) {
    this.dropbox.source(owner,source);
    if(!Array.isArray(paths)||!paths.length||paths.length>100||paths.some(p=>typeof p!=='string'))throw new MaintenanceError('Seleccioná hasta 100 archivos o carpetas',400);
    const dir=await resolveHostPath(directory,{directory:true,fresh:true});
    const volume=volumeForPath((await hostVolumes.snapshot(true)).volumes,dir);
    if(!volume || token!==volume.id+':'+volume.mountId)throw new MaintenanceError('Volvé a seleccionar el disco de destino',409);
    if(volume.readOnly)throw new MaintenanceError('El disco es de sólo lectura',409);
    const id=crypto.randomUUID(),j:CloudDownload={id,owner,worker:incarnation(),provider:this.providerId,source,directory:dir,names:[],state:'planning',bytes:0,received:0,files:0,completedFiles:0,published:[],at:Date.now(),updated:Date.now()};
    this.store.db.transaction(()=>{
      if(this.store.list<CloudDownload>('cloud-download').some(v=>v.owner===owner&&['planning','running'].includes(v.state)))throw new MaintenanceError('Ya hay una copia desde la nube en curso',409);
      this.save(j);
    }).immediate();
    const control=new AbortController();this.active.set(id,control);
    void this.run(j,[...new Set(paths)],token,control.signal).catch(()=>{}).finally(()=>this.active.delete(id));
    return id;
  }
  private async run(j:CloudDownload,paths:string[],token:unknown,signal:AbortSignal) {
    let proc:ReturnType<typeof Bun.spawn>|undefined;
    try {
      const items:Item[]=[],roots:CloudEntry[]=[],seen=new Set<string>();
      const check=()=>{if(signal.aborted)throw new Error('cancelled');};
      for(const p of paths){check();const e=await this.dropbox.metadata(j.owner,j.source,p);if(seen.has(e.name.toLowerCase()))throw new MaintenanceError('Hay nombres repetidos en la selección',409);seen.add(e.name.toLowerCase());roots.push(e);}
      const pending:Item[]=roots.map(e=>({entry:e,relative:e.name}));
      for(let n=0;n<pending.length;n++){
        check();if(pending.length>50000)throw new MaintenanceError('La selección supera 50.000 elementos. Copiá carpetas más pequeñas.',413);
        const item=pending[n];items.push(item);
        if(item.entry.type==='file'){
          if(!item.entry.downloadable)throw new MaintenanceError('La selección incluye documentos que deben abrirse o exportarse desde su plataforma',409);
          j.bytes+=item.entry.size;j.files++;if(!Number.isSafeInteger(j.bytes))throw new MaintenanceError('Selección demasiado grande',413);
        }else{
          let cursor:string|undefined;
          do{check();const page=await this.dropbox.list(j.owner,j.source,item.entry.path,cursor);pending.push(...page.entries.map(e=>({entry:e,relative:item.relative+'/'+e.name})));cursor=page.cursor||undefined;}while(cursor);
        }
      }
      j.names=roots.map(e=>e.name);this.save(j);
      const mount=await hostVolumes.validate(j.directory,token),s=await stat(hostToContainer(j.directory));
      check();const sourceScript=new URL('../storage/cloud-download-host.py',import.meta.url);
      const script=await readFile(existsSync(sourceScript)?sourceScript:new URL('./storage/cloud-download-host.py',import.meta.url),'utf8');
      const user=ON_HOST&&HOST_USER==='root'?userInfo().username:HOST_USER;
      proc=Bun.spawn(hostArgv('python3',['-u','-c',script],user),{stdin:'pipe',stdout:'pipe',stderr:'pipe'});
      const sink=proc.stdin as {write(d:Uint8Array|string):number|Promise<number>;flush():number|Promise<number>;end():void};
      const lines=(proc.stdout as ReadableStream<Uint8Array>).getReader(),decoder=new TextDecoder();let carry='';
      const ack=async()=>{
        while(!carry.includes('\n')){const r=await lines.read();if(r.done)throw new Error('worker stopped');carry+=decoder.decode(r.value,{stream:true});if(carry.length>100000)throw new Error('worker overflow');}
        const at=carry.indexOf('\n'),value=JSON.parse(carry.slice(0,at));carry=carry.slice(at+1);if(!value.ok)throw new MaintenanceError(value.error,409);return value;
      };
      const send=async(v:unknown)=>{await sink.write(JSON.stringify(v)+'\n');await sink.flush();};
      // Never dump worker stderr: upstream content and secrets stay out of logs.
      const errors=new Response(proc.stderr as ReadableStream<Uint8Array>).text();
      const abort=()=>{try{proc?.kill('SIGTERM');}catch{}};signal.addEventListener('abort',abort,{once:true});
      try {
        await send({directory:j.directory,dev:String(s.dev),ino:String(s.ino),roots:roots.map(e=>({name:e.name,type:e.type})),bytes:j.bytes,id:j.id});await ack();
        j.state='running';this.save(j);
        const rootDirs=new Set(roots.filter(e=>e.type==='dir').map(e=>e.name));
        for(const item of items){
          check();
          if(item.entry.type==='dir'){if(!rootDirs.has(item.relative)){await send({action:'mkdir',path:item.relative});await ack();}continue;}
          await send({action:'file',path:item.relative,size:item.entry.size,hash:item.entry.hash,checksum:item.entry.checksum});
          const response=await this.dropbox.content(j.owner,j.source,item.entry.path,item.entry.revision,undefined,signal);
          const meta=response.headers.get('dropbox-api-result');
          if(meta){const m=JSON.parse(meta);if(item.entry.revision && m.rev!==item.entry.revision){await response.body?.cancel();throw new MaintenanceError('El archivo cambió en Dropbox. Actualizá la carpeta y volvé a copiar.',409);}}
          if(!response.body)throw new Error('empty response');
          const reader=response.body.getReader();let received=0,lastSaved=0;
          try{while(true){check();const r=await reader.read();if(r.done)break;received+=r.value.length;if(received>item.entry.size)throw new Error('size mismatch');await sink.write(r.value);await sink.flush();j.received+=r.value.length;if(Date.now()-lastSaved>500){this.save(j);lastSaved=Date.now();}}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
          if(received!==item.entry.size)throw new MaintenanceError('El archivo llegó incompleto. No se publicó la copia.',502);
          await ack();j.completedFiles++;this.save(j);
        }
        check();await hostVolumes.validate(j.directory,token);
        if(mount!==undefined && mount!==await hostVolumes.validate(j.directory,token))throw new MaintenanceError('El disco cambió',409);
        await send({action:'finish'});
        for(const _ of roots){const a=await ack();if(typeof a.published!=='string')throw new Error('missing receipt');j.published.push(a.published);this.save(j);}
        const final=await ack();if(!final.complete)throw new Error('missing completion');sink.end();
        if(await proc.exited!==0)throw new Error('worker failed');await errors;
        j.state='complete';this.save(j);
      }finally{
        signal.removeEventListener('abort',abort);try{sink.end();}catch{};await lines.cancel().catch(()=>{});
        const timer=setTimeout(()=>{try{proc?.kill('SIGKILL');}catch{}},5000);await proc.exited;clearTimeout(timer);await errors;
      }
    }catch(e){
      j.state=signal.aborted?'cancelled':'failed';j.error=signal.aborted?'Copia cancelada. Revisá el destino: si estaba finalizando, puede haber elementos completos ya guardados.':e instanceof MaintenanceError?e.message:'Se interrumpió la copia. Revisá la conexión y el destino antes de reintentar.';this.save(j);
    }
  }
}
