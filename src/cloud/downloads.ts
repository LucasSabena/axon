import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { PlatformStore } from '../platform/store';
import { type CloudEntry } from './dropbox';
import type { CloudProvider } from './provider';
import { resolveHostPath, hostVolumes } from '../host-storage';
import { hostToContainer, HOST_USER, ON_HOST, killHostProc, procStartTime } from '../host';
import { hostArgv } from '../storage/host-argv';
import { volumeForPath } from '../file-volumes';
import { incarnation } from '../storage/repository';
import { MaintenanceError } from '../storage/types';
import { recordEvent } from '../events';

const NAMES:Record<string,string>={dropbox:'Dropbox',gdrive:'Google Drive',onedrive:'OneDrive'};
const HISTORY_LIMIT=40,MAX_RESUMES=3;
// 4xx de permiso/cuota/conflicto no mejora reintentando; red, timeouts y 5xx sí.
const TRANSIENT=new Set([408,429,500,502,503,504]);
const transient=(e:unknown)=>!(e instanceof MaintenanceError)||TRANSIENT.has(e.status);

type Root={name:string;remote:string;bytes?:number;files?:number};
type Item={entry:CloudEntry;relative:string};
type Plan={root:CloudEntry;remote:string;items:Item[];bytes:number;files:number};
export interface CloudDownload {
  id:string; owner:string; worker:string|null; provider?:string; source:string; directory:string; names:string[];
  state:'planning'|'running'|'complete'|'partial'|'failed'|'cancelled'|'interrupted';
  bytes:number; received:number; files:number; completedFiles:number; published:string[];
  roots?:Root[]; volumeToken?:string; failed?:{name:string;error:string}[];
  at:number; updated:number; error?:string;
}
export class CloudDownloads {
  private active=new Map<string,AbortController>();
  constructor(private store:PlatformStore,private dropbox:CloudProvider,private providerId='dropbox') {
    for(const j of store.list<CloudDownload>('cloud-download')) if(['planning','running'].includes(j.state) && (!j.worker || j.worker!==incarnation())) {
      const pid=Number(j.worker?.split(':')[1]);if(j.worker && incarnation(pid)===j.worker)continue;
      const marked={...j,state:'interrupted' as const,error:'AXON se reinició. Podés reintentar los elementos pendientes desde Archivos.'};
      this.save(marked);this.finishEvent(marked);
    }
  }
  private save(j:CloudDownload){j.updated=Date.now();this.store.put('cloud-download',j.id,j);}
  private prune(owner:string){
    const rows=this.store.list<CloudDownload>('cloud-download').filter(j=>j.owner===owner&&(j.provider||'dropbox')===this.providerId).sort((a,b)=>b.at-a.at);
    for(const j of rows.slice(HISTORY_LIMIT))this.store.db.query("DELETE FROM records WHERE kind='cloud-download' AND id=?").run(j.id);
  }
  private publicJob(j:CloudDownload){const {owner,worker,roots,volumeToken,...rest}=j;return {...rest,retryable:!['planning','running'].includes(j.state)&&!!volumeToken&&!!roots?.some(r=>!j.published.includes(r.name))};}
  list(owner:string){return this.store.list<CloudDownload>('cloud-download').filter(j=>j.owner===owner&&(j.provider||'dropbox')===this.providerId).slice(0,30).map(j=>this.publicJob(j));}
  get(owner:string,id:string){const j=this.store.get<CloudDownload>('cloud-download',id);if(!j||j.owner!==owner||(j.provider||'dropbox')!==this.providerId)throw new MaintenanceError('Descarga no encontrada',404);return j;}
  cancel(owner:string,id:string){this.get(owner,id);this.active.get(id)?.abort();}
  cancelOwner(owner:string){for(const [id,c] of this.active)if(this.store.get<CloudDownload>('cloud-download',id)?.owner===owner)c.abort();}
  private async destination(directory:string,token:unknown){
    const dir=await resolveHostPath(directory,{directory:true,fresh:true});
    const volume=volumeForPath((await hostVolumes.snapshot(true)).volumes,dir);
    if(!volume || token!==volume.id+':'+volume.mountId)throw new MaintenanceError('El disco de destino cambió. Iniciá una copia nueva.',409);
    if(volume.readOnly)throw new MaintenanceError('El disco es de sólo lectura',409);
    return dir;
  }
  private claim(owner:string,j:CloudDownload){
    this.store.db.transaction(()=>{
      if(this.store.list<CloudDownload>('cloud-download').some(v=>v.owner===owner&&['planning','running'].includes(v.state)))throw new MaintenanceError('Ya hay una copia desde la nube en curso',409);
      this.save(j);
    }).immediate();
  }
  private launch(j:CloudDownload,specs:Root[],token:unknown){
    const control=new AbortController();this.active.set(j.id,control);
    void this.run(j,specs,token,control.signal).catch(()=>{}).finally(()=>this.active.delete(j.id));
  }
  async start(owner:string,source:string,paths:string[],directory:string,token:unknown) {
    this.dropbox.source(owner,source);
    if(!Array.isArray(paths)||!paths.length||paths.length>100||paths.some(p=>typeof p!=='string'))throw new MaintenanceError('Seleccioná hasta 100 archivos o carpetas',400);
    const dir=await this.destination(directory,token);
    const specs:Root[]=[...new Set(paths as string[])].map(remote=>({remote,name:remote.split('/').pop()||remote}));
    const id=crypto.randomUUID(),j:CloudDownload={id,owner,worker:incarnation(),provider:this.providerId,source,directory:dir,names:[],state:'planning',bytes:0,received:0,files:0,completedFiles:0,published:[],roots:specs,volumeToken:typeof token==='string'?token:undefined,at:Date.now(),updated:Date.now()};
    this.claim(owner,j);
    this.launch(j,specs,token);
    return id;
  }
  /** Re-runs only the roots that never reached the destination; published roots are left untouched. */
  async retry(owner:string,id:string) {
    const j=this.get(owner,id);
    if(['planning','running'].includes(j.state))throw new MaintenanceError('La copia está en curso',409);
    const remaining=(j.roots||[]).filter(r=>!j.published.includes(r.name));
    if(!remaining.length||!j.volumeToken)throw new MaintenanceError('Esta copia no se puede reanudar. Iniciá una copia nueva.',409);
    await this.destination(j.directory,j.volumeToken);
    j.state='planning';j.worker=incarnation();j.error=undefined;this.claim(owner,j);
    this.launch(j,remaining,j.volumeToken);
  }
  private async attempt<T>(fn:()=>Promise<T>,signal:AbortSignal,tries=3):Promise<T>{
    let last:unknown;
    for(let n=0;n<tries;n++){
      if(signal.aborted)throw new Error('cancelled');
      try{return await fn();}catch(e){last=e;if(!transient(e)||n===tries-1)throw e;await Bun.sleep(400*(n+1));}
    }
    throw last;
  }
  private fail(j:CloudDownload,name:string,e:unknown){
    const error=e instanceof MaintenanceError?e.message:'No se pudo copiar este elemento';
    j.failed=[...(j.failed||[]).filter(f=>f.name!==name),{name,error}].slice(-50);
  }
  private async plan(j:CloudDownload,specs:Root[],seen:Set<string>,signal:AbortSignal):Promise<Plan[]>{
    const check=()=>{if(signal.aborted)throw new Error('cancelled');};
    const planned:Plan[]=[];
    for(const spec of specs){
      check();
      let root:CloudEntry;
      try{root=await this.attempt(()=>this.dropbox.metadata(j.owner,j.source,spec.remote),signal);}
      catch(e){if(signal.aborted)throw e;this.fail(j,spec.name,e);continue;}
      spec.name=root.name;
      if(seen.has(root.name.toLowerCase())){this.fail(j,root.name,new MaintenanceError('Hay nombres repetidos en la selección',409));continue;}
      seen.add(root.name.toLowerCase());
      const items:Item[]=[];let bytes=0,files=0;
      try{
        const pending:Item[]=[{entry:root,relative:root.name}];
        for(let n=0;n<pending.length;n++){
          check();if(pending.length>50000)throw new MaintenanceError('La selección supera 50.000 elementos. Copiá carpetas más pequeñas.',413);
          const item=pending[n];items.push(item);
          if(item.entry.type==='file'){
            if(!item.entry.downloadable)throw new MaintenanceError('Incluye documentos que deben abrirse o exportarse desde su plataforma',409);
            bytes+=item.entry.size;files++;if(!Number.isSafeInteger(bytes))throw new MaintenanceError('Selección demasiado grande',413);
          }else{
            let cursor:string|undefined;
            do{check();const page=await this.attempt(()=>this.dropbox.list(j.owner,j.source,item.entry.path,cursor),signal);
              for(const e of page.entries){const relative=item.relative+'/'+e.name;
                if(seen.has(relative.toLowerCase()))throw new MaintenanceError('La selección contiene nombres repetidos dentro de una carpeta. Renombrálos en la nube antes de copiar.',409);
                seen.add(relative.toLowerCase());pending.push({entry:e,relative});
              }
              cursor=page.cursor||undefined;}while(cursor);
          }
        }
      }catch(e){if(signal.aborted)throw e;this.fail(j,root.name,e);continue;}
      spec.bytes=bytes;spec.files=files;j.bytes+=bytes;j.files+=files;
      planned.push({root,remote:spec.remote,items,bytes,files});
    }
    return planned;
  }
  private finishEvent(j:CloudDownload){
    const provider=NAMES[this.providerId]||this.providerId,target={section:'files',params:{source:this.providerId}};
    try{
      if(j.state==='complete')recordEvent('job','Copia de '+provider+' completa',(j.names.length?j.names.join(', ')+' guardada':'Guardada')+' en '+j.directory,target);
      else if(j.state==='partial')recordEvent('job','Copia de '+provider+' incompleta','Se guardaron '+j.published.length+' de '+(j.roots?.length||j.names.length)+' elementos en '+j.directory+'. Reintentá el resto desde Archivos.',target);
      else if(j.state==='failed')recordEvent('job','La copia de '+provider+' falló',j.error||'Revisá la conexión y el destino.',target);
      else if(j.state==='interrupted')recordEvent('job','La copia de '+provider+' se interrumpió','El servidor se reinició durante la copia. Podés reintentar los elementos pendientes.',target);
    }catch{}
  }
  private async run(j:CloudDownload,specs:Root[],token:unknown,signal:AbortSignal) {
    try {
      const check=()=>{if(signal.aborted)throw new Error('cancelled');};
      // Progress accounting counts published roots once; retried roots re-add their share.
      const done=(j.roots||[]).filter(r=>j.published.includes(r.name));
      j.bytes=done.reduce((a,r)=>a+(r.bytes||0),0);j.files=done.reduce((a,r)=>a+(r.files||0),0);
      j.received=j.bytes;j.completedFiles=j.files;
      const planned=await this.plan(j,specs,new Set(j.published.map(n=>n.toLowerCase())),signal);
      if(j.roots)j.names=j.roots.map(r=>r.name);
      j.state='running';this.save(j);
      for(const p of planned){
        check();
        try{await this.copyRoot(j,p,token,signal);j.published.push(p.root.name);j.failed=j.failed?.filter(f=>f.name!==p.root.name);}
        catch(e){if(signal.aborted)throw e;this.fail(j,p.root.name,e);}
        this.save(j);
      }
      const pendingRoots=(j.roots||[]).filter(r=>!j.published.includes(r.name));
      j.state=pendingRoots.length?(j.published.length?'partial':'failed'):'complete';
      j.error=pendingRoots.length?'No se pudieron copiar '+pendingRoots.length+' elemento(s): '+pendingRoots.map(r=>r.name).join(', ')+'. Podés reintentarlos.':undefined;
      this.save(j);this.prune(j.owner);this.finishEvent(j);
    }catch(e){
      j.state=signal.aborted?'cancelled':(j.published.length?'partial':'failed');
      j.error=signal.aborted?'Copia cancelada. Revisá el destino: si estaba finalizando, puede haber elementos completos ya guardados.':e instanceof MaintenanceError?e.message:'Se interrumpió la copia. Revisá la conexión y el destino antes de reintentar.';
      if(!signal.aborted)for(const r of j.roots||[])if(!j.published.includes(r.name)&&!j.failed?.some(f=>f.name===r.name))this.fail(j,r.name,e);
      this.save(j);this.prune(j.owner);this.finishEvent(j);
    }
  }
  /** One worker per selected root keeps the publish step atomic per root: a failure leaves nothing behind and siblings still land. */
  private async copyRoot(j:CloudDownload,p:Plan,token:unknown,signal:AbortSignal) {
    await hostVolumes.validate(j.directory,token);
    const s=await stat(hostToContainer(j.directory));
    const sourceScript=new URL('../storage/cloud-download-host.py',import.meta.url);
    const script=await readFile(existsSync(sourceScript)?sourceScript:new URL('./storage/cloud-download-host.py',import.meta.url),'utf8');
    const user=ON_HOST&&HOST_USER==='root'?userInfo().username:HOST_USER;
    // setsid puts the nsenter/runuser wrapper in its own process group so a
    // kill reaches the host-side python too — killing the wrapper alone
    // would orphan the worker mid-download.
    const proc=Bun.spawn(['setsid',...hostArgv('python3',['-u','-c',script],user)],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});
    // Stamp the spawn so a recycled pid can never masquerade as this worker.
    const st=procStartTime(proc.pid);if(st!==null)(proc as { _axonStart?: number })._axonStart=st;
    const killGroup=(sig:'SIGTERM'|'SIGKILL')=>{try{killHostProc(proc as Parameters<typeof killHostProc>[0],sig);}catch{}};
    const sink=proc.stdin as {write(d:Uint8Array|string):number|Promise<number>;flush():number|Promise<number>;end():void};
    const lines=(proc.stdout as ReadableStream<Uint8Array>).getReader(),decoder=new TextDecoder();let carry='';
    const ack=async()=>{
      while(!carry.includes('\n')){
        // A worker that stays alive but stops responding must not wedge the
        // download forever — bound each read and TERM the group on timeout.
        let timer:ReturnType<typeof setTimeout>|undefined;
        const r=await Promise.race([lines.read(),new Promise<never>((_,rej)=>{timer=setTimeout(()=>{try{killGroup('SIGTERM');}catch{}rej(new Error('El worker dejó de responder'));},300_000);})]).finally(()=>clearTimeout(timer));
        if(r.done)throw new Error('worker stopped');carry+=decoder.decode(r.value,{stream:true});if(carry.length>100000)throw new Error('worker overflow');
      }
      const at=carry.indexOf('\n'),value=JSON.parse(carry.slice(0,at));carry=carry.slice(at+1);if(!value.ok)throw new MaintenanceError(value.error,409);return value;
    };
    // A worker alive but not draining stdin wedges sink.write forever —
    // race each write against an idle deadline that kills the group (the
    // abort listener's TERM alone can't unblock a wedged write either).
    const push=async(d:Uint8Array|string)=>{
      const w=(async()=>{await sink.write(d);await sink.flush();})();
      w.catch(()=>{}); // the deadline may abandon a still-pending write
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{
        await Promise.race([w,new Promise<never>((_,rej)=>{timer=setTimeout(()=>{try{killGroup('SIGKILL');}catch{}rej(new Error('El worker dejó de aceptar datos'));},120_000);})]);
      }finally{clearTimeout(timer);}
    };
    const send=(v:unknown)=>push(JSON.stringify(v)+'\n');
    // Never dump worker stderr: upstream content and secrets stay out of logs.
    const errors=new Response(proc.stderr as ReadableStream<Uint8Array>).text();
    const abort=()=>{try{killGroup('SIGTERM');}catch{}};signal.addEventListener('abort',abort,{once:true});
    try {
      // Fresh stage id per worker: an orphaned stage dir from a killed run
      // would otherwise collide with the next root of the same job.
      await send({directory:j.directory,dev:String(s.dev),ino:String(s.ino),roots:[{name:p.root.name,type:p.root.type}],bytes:p.bytes,id:crypto.randomUUID()});await ack();
      for(const item of p.items){
        if(signal.aborted)throw new Error('cancelled');
        if(item.entry.type==='dir'){if(item.relative!==p.root.name){await send({action:'mkdir',path:item.relative});await ack();}continue;}
        // Fetch upstream BEFORE handing the file to the worker: a failure here
        // never reaches the byte stream, so the worker stays consistent.
        const open=async(range?:string)=>{
          const response=await this.dropbox.content(j.owner,j.source,item.entry.path,item.entry.revision,range,signal);
          const meta=response.headers.get('dropbox-api-result');
          if(meta){const m=JSON.parse(meta);if(item.entry.revision && m.rev!==item.entry.revision){await response.body?.cancel();throw new MaintenanceError('El archivo cambió en la nube. Actualizá la carpeta y volvé a copiar.',409);}}
          if(!response.body)throw new Error('empty response');
          return response;
        };
        let response=await this.attempt(()=>open(),signal);
        await send({action:'file',path:item.relative,size:item.entry.size,hash:item.entry.hash,checksum:item.entry.checksum});
        // The worker consumes exactly `size` bytes and writes them in order, so a
        // dropped stream can resume transparently with a Range request — the
        // checksum the worker verifies still covers the whole file.
        let received=0,resumes=0,lastSaved=0;
        while(true){
          const reader=response.body!.getReader();let failed:unknown;
          try{while(true){if(signal.aborted)throw new Error('cancelled');const r=await reader.read();if(r.done)break;received+=r.value.length;if(received>item.entry.size)throw new Error('size mismatch');await push(r.value);j.received+=r.value.length;if(Date.now()-lastSaved>500){this.save(j);lastSaved=Date.now();}}}catch(e){failed=e;}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
          if(!failed||signal.aborted||received>=item.entry.size)break;
          if(!transient(failed)||++resumes>MAX_RESUMES)throw failed;
          try{response=await this.attempt(()=>open('bytes='+received+'-'),signal);}catch{throw failed;}
        }
        if(signal.aborted)throw new Error('cancelled');
        if(received>item.entry.size)throw new Error('size mismatch');
        if(received!==item.entry.size)throw new MaintenanceError('El archivo llegó incompleto. No se publicó la copia.',502);
        await ack();j.completedFiles++;this.save(j);
      }
      if(signal.aborted)throw new Error('cancelled');
      await hostVolumes.validate(j.directory,token);
      await send({action:'finish'});
      const receipt=await ack();if(typeof receipt.published!=='string'||receipt.published!==p.root.name)throw new Error('missing receipt');this.save(j);
      const final=await ack();if(!final.complete)throw new Error('missing completion');sink.end();
      // 'complete' was already acked — a worker wedged on exit must not
      // stall the job; bound the wait and let the finally reap it.
      const code=await Promise.race([proc.exited,new Promise<number>(res=>setTimeout(()=>res(-1),15_000))]);
      if(code>0)throw new Error('worker failed');await errors;
    }finally{
      signal.removeEventListener('abort',abort);try{sink.end();}catch{};await lines.cancel().catch(()=>{});
      const timer=setTimeout(()=>{try{killGroup('SIGKILL');}catch{}},5000);await proc.exited;clearTimeout(timer);await errors;
    }
  }
}
