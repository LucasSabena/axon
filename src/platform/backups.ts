import { resolveHostPath, hostVolumes } from '../host-storage';
import { volumeForPath, volumeContains, type VolumeSnapshot, type FileVolume } from '../file-volumes';
import { firstBackupAt, followingBackupAt } from './backup-schedule';
import { readFile, readlink } from 'node:fs/promises';
import { hostSpawnInteractive, killHostProc, hostExec, ON_HOST } from '../host';
import { notify } from '../notify';
import { MaintenanceError } from '../storage/types';
import { PlatformError, type PlatformStore } from './store';
import type { ProjectHub } from './projects';
import type { Hono } from 'hono';

export interface BackupDisk { id:string; uuid:string|null; diskId:string; path:string; name:string }
export interface BackupDestination { id:string; path:string; label:string; volume?:BackupDisk; relativePath?:string }
export interface BackupPolicy {
  id:string;name:string;projectId?:string;kind:'files'|'configuration'|'postgres';source?:string;repository?:string;
  sources?:string[];sourceVolumes?:Record<string,BackupDisk>;destinations?:BackupDestination[];
  diskMode?:boolean;exclusions?:string[];intervalDays?:number;retentionDays?:number;createdAt?:number;revision?:string;
  containerId?:string;databases?:string[];dailyAt?:string;enabled:boolean;
}
export interface BackupJob {
  id:string;policy:BackupPolicy;mode:'backup'|'restore'|'verify';state:string;phase?:string;actor:string;credentialId?:string;
  createdAt:number;snapshot?:string;message?:string;verifiedAt?:number;restoredPath?:string;bytes?:number;files?:number;
  destinationId?:string;destinationLabel?:string;batchId?:string;launchedAt?:number;retryAt?:number;scheduledFor?:number;
  forgottenSnapshots?:string[];expired?:boolean;paths?:string[];sourcePaths?:string[];endedAt?:number;
  partial?:boolean;updatedAt?:number;
  progress?:{bytes_done?:number;total_bytes?:number;files_done?:number;total_files?:number;seconds_elapsed?:number;seconds_remaining?:number;error_count?:number};
}
export type BackupRunner = (request:Record<string,unknown>) => Promise<any>;
let workerSource:Promise<string>|undefined;
// The launcher must outlive the worker's own inner deadlines: a postgres
// 'start' runs docker inspects + psql (each up to 120s) before detaching, and
// 'browse' can wait on a cold repository listing.
const launcherTimeouts:Record<string,number>={start:300000,browse:150000,databases:300000};
export async function backupWorker(request:Record<string,unknown>) {
  const source = await (workerSource ??= readFile(new URL('./backup-host.py',import.meta.url),'utf8').catch(e=>{workerSource=undefined;throw e;}));
  const quote = (s:string) => `'${s.replace(/'/g,`'"'"'`)}'`;
  const p = hostSpawnInteractive('python3 -c '+quote(source),{user:'root'});
  (p.stdin as Bun.FileSink).write(JSON.stringify({...request,workerSource:source}));(p.stdin as Bun.FileSink).end();
  const timer = setTimeout(() => killHostProc(p),launcherTimeouts[String(request.action)]||25000);
  // Stop reading (and kill the worker) once a stream exceeds the bound instead
  // of buffering it unbounded until the process ends.
  const bounded=async(stream:ReadableStream<Uint8Array>)=>{let n=0;const chunks:Uint8Array[]=[];for await(const chunk of stream){n+=chunk.length;if(n>2_000_000){killHostProc(p);throw new PlatformError('No se pudo consultar el worker de backups',503);}chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');};
  try {
    const [out,,code] = await Promise.all([bounded(p.stdout as ReadableStream<Uint8Array>),bounded(p.stderr as ReadableStream<Uint8Array>),p.exited]);
    if (code) throw new PlatformError('No se pudo consultar el worker de backups',503);
    const result = JSON.parse(out);if (!result.ok) throw new PlatformError(result.error || 'Backup no disponible',409);return result;
  } finally {clearTimeout(timer);}
}
export async function hostDataDirectory(configDir:string):Promise<string> {
  if (ON_HOST) return configDir;
  // A wedged Docker daemon must not block the serial backup mutation chain;
  // every docker call gets the same kill deadline as the project inventory.
  const docker=async(argv:string[])=>{
    const p=Bun.spawn(argv,{stdout:'pipe',stderr:'pipe'});
    const timer=setTimeout(()=>{try{p.kill();}catch{}},15000);
    try{return await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);}
    finally{clearTimeout(timer);}
  };
  let container=process.env.AXON_CONTAINER_NAME;
  if(!container){
    // A 1.1 updater activates the new image before replacing its own manager,
    // so the first upgrade has no AXON_CONTAINER_NAME yet. Host PID/network
    // mode also makes HOSTNAME/cgroup unreliable. Match our mount namespace.
    const [listed,,listCode]=await docker(['docker','ps','-q']);
    const ids=listed.trim().split(/\s+/).filter(Boolean);
    if(listCode||!ids.length)throw new Error('No se pudo identificar el contenedor de AXON');
    const [inspected,,inspectCode]=await docker(['docker','inspect',...ids,'--format','{{.Id}} {{.State.Pid}}']);
    if(inspectCode)throw new Error('No se pudo identificar el contenedor de AXON');
    const rows=inspected.trim().split('\n');
    const own=await readlink('/proc/self/ns/mnt');
    for(const row of rows){const [id,pid]=row.split(' ');try{if(await readlink('/proc/'+pid+'/ns/mnt')===own){container=id;break;}}catch{/* Container exited during discovery. */}}
    if(!container)throw new Error('No se pudo identificar el montaje propio de AXON');
  }
  const [out,,code] = await docker(['docker','inspect',container,'--format','{{json .Mounts}}']);
  if (code) throw new Error('No se pudo resolver el montaje de configuración');
  const mounts = JSON.parse(out) as {Destination:string;Source:string;Type:string}[];
  const mount = mounts.find(m => m.Type === 'bind' && (configDir === m.Destination || configDir.startsWith(m.Destination+'/')));
  if (!mount) throw new Error('La configuración requiere un montaje de host conocido para respaldarse');
  return mount.Source+configDir.slice(mount.Destination.length);
}
const activeStates=['queued','running','waiting'];
const disk=(v:FileVolume):BackupDisk=>({id:v.id,uuid:v.uuid,diskId:v.diskId,path:v.path!,name:v.name});
const sameDisk=(expected:BackupDisk,v:FileVolume)=>expected.uuid?expected.uuid===v.uuid:expected.id===v.id;
const defaults=['node_modules','.venv','venv','__pycache__','.next','.nuxt','.turbo','target','dist','build'];
export interface BackupEnvironment {
  volumes:()=>Promise<VolumeSnapshot>;
  resolve:(p:string,options?:{directory?:boolean;fresh?:boolean;root?:boolean})=>Promise<string>;
}
export class Backups {
  private draining?:Promise<void>;
  private mutations:Promise<unknown>=Promise.resolve();
  constructor(readonly store:PlatformStore,readonly hub:ProjectHub,private home:() => Promise<string>,private configDir:() => Promise<string>,private run:BackupRunner=backupWorker,
    private environment:BackupEnvironment={volumes:()=>hostVolumes.snapshot(true),resolve:resolveHostPath}) {
    // Old receipts predate the durable application queue and were already launched.
    for(const j of store.list<BackupJob>('backup-job'))if(!j.launchedAt&&((j as any).pid||(!j.destinationId&&['queued','running','interrupted'].includes(j.state))))store.put('backup-job',j.id,{...j,launchedAt:j.createdAt});
  }
  private serial<T>(fn:()=>Promise<T>):Promise<T> {const next=this.mutations.then(fn,fn);this.mutations=next.catch(()=>{});return next;}
  policies(projectId?:string) {return this.store.list<BackupPolicy>('backup-policy').filter(p => !projectId || p.projectId === projectId);}
  targets(policy:BackupPolicy):BackupDestination[] {return policy.destinations?.length?policy.destinations:[{id:'local',path:policy.repository||'',label:policy.repository?'Destino guardado':'Disco del sistema'}];}
  sources(policy:BackupPolicy) {return policy.sources?.length?policy.sources:policy.source?[policy.source]:[];}
  async ensureConfiguration() {
    const source=await this.configDir(),existing=this.store.get<BackupPolicy>('backup-policy','server-configuration');
    if (!existing) this.store.put('backup-policy','server-configuration',{id:'server-configuration',name:'Configuración de AXON',kind:'configuration',source,dailyAt:'04:00',enabled:true} satisfies BackupPolicy);
    else if(existing.kind==='configuration'&&existing.source!==source){
      // Repair the automatically created 1.1 policy after installation/migration.
      // Existing snapshots retain their frozen source/repository for recovery.
      this.cancelPending(existing.id,'La configuración de AXON se copiará desde su montaje actual.');
      this.store.put('backup-policy',existing.id,{...existing,source,sourceVolumes:undefined,revision:crypto.randomUUID()});
    }
  }
  async save(input:any,actor:string) {return this.serial(async()=>{
    if (!input || Object.keys(input).some(k => !['id','name','kind','projectId','containerId','databases','dailyAt','enabled','repository','sources','destinations','intervalDays','retentionDays','exclusions','diskMode','sourceIdentities'].includes(k))) throw new PlatformError('Configuración inválida');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length>100 || /[\x00-\x1f]/.test(input.name) || !['files','postgres','configuration'].includes(input.kind) || typeof input.enabled !== 'boolean') throw new PlatformError('Elegí un nombre y un contenido para el backup');
    if (input.dailyAt && (typeof input.dailyAt!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.dailyAt))) throw new PlatformError('Elegí un horario válido');
    for(const [key,max] of [['intervalDays',365],['retentionDays',3650]] as const)if(input[key]!==undefined&&(!Number.isInteger(input[key])||input[key]<0||input[key]>max))throw new PlatformError(key==='intervalDays'?'La frecuencia debe ser entre 1 y 365 días, o manual':'La conservación debe ser entre 1 y 3650 días, o sin límite');
    if(input.intervalDays>0&&!input.dailyAt)throw new PlatformError('Elegí a qué hora hacer la copia');
    if(input.diskMode!==undefined&&typeof input.diskMode!=='boolean')throw new PlatformError('Contenido inválido');
    if(input.diskMode&&input.kind!=='files')throw new PlatformError('El disco completo sólo admite archivos');
    const existing=input.id?this.store.get<BackupPolicy>('backup-policy',input.id):undefined;
    if(input.id&&!existing)throw new PlatformError('Backup no encontrado',404);
    const policy:BackupPolicy={id:existing?.id||crypto.randomUUID(),name:input.name.trim(),kind:input.kind,enabled:input.enabled,dailyAt:input.dailyAt||undefined,
      intervalDays:input.intervalDays??(input.dailyAt?1:0),retentionDays:input.retentionDays??0,createdAt:existing?.createdAt||Date.now(),revision:crypto.randomUUID()};
    if(input.kind==='configuration'){policy.source=await this.configDir();}
    else if(input.kind==='files'&&input.sources!==undefined){
      if(!Array.isArray(input.sources)||!input.sources.length||input.sources.length>20||input.sources.some((p:any)=>typeof p!=='string'))throw new PlatformError('Elegí entre 1 y 20 carpetas');
      policy.sources=[...new Set<string>(await Promise.all(input.sources.map((p:string)=>this.environment.resolve(p,{directory:true,fresh:true,root:input.diskMode===true}))))];
      if(policy.sources.some((p,i)=>policy.sources!.some((other,j)=>i!==j&&volumeContains(p,other))))throw new PlatformError('Una carpeta ya está incluida dentro de otra. Elegí sólo la carpeta principal');
      policy.source=policy.sources[0];policy.diskMode=input.diskMode===true;
      if(input.projectId){const project=this.hub.project(input.projectId);if(policy.sources.length!==1||policy.source!==project.cwd)throw new PlatformError('Las carpetas no coinciden con el proyecto');policy.projectId=project.id;}
    }else{
      const project=this.hub.project(input.projectId);policy.projectId=project.id;
      if(input.kind==='files'){policy.source=project.cwd;policy.exclusions=defaults;}
      else{
        const container=(await this.hub.sources.containers()).find(c=>c.id===input.containerId);
        if(!container||container.state!=='running'||!/(?:^|\/)postgres(?:[:@]|$)/.test(container.image))throw new PlatformError('Elegí un PostgreSQL en funcionamiento');
        const available=await this.run({action:'databases',containerId:container.id});
        if(!Array.isArray(input.databases)||!input.databases.length||input.databases.some((d:any)=>!available.databases.includes(d)))throw new PlatformError('Elegí al menos una base de datos');
        policy.containerId=container.id;policy.databases=[...new Set<string>(input.databases)];
      }
    }
    if(input.exclusions!==undefined){
      if(!Array.isArray(input.exclusions)||input.exclusions.length>50||input.exclusions.some((p:any)=>typeof p!=='string'||!p.trim()||p.length>4096||/[\x00-\x1f]/.test(p)))throw new PlatformError('Exclusiones inválidas');
      policy.exclusions=[...new Set<string>(input.exclusions.map((p:string)=>p.trim()))];
    }
    if(input.destinations!==undefined){
      if(!Array.isArray(input.destinations)||!input.destinations.length||input.destinations.length>5)throw new PlatformError('Elegí entre 1 y 5 destinos');
      const snapshot=await this.environment.volumes();policy.sourceVolumes={};
      if(input.sourceIdentities!==undefined&&(!input.sourceIdentities||typeof input.sourceIdentities!=='object'||Array.isArray(input.sourceIdentities)))throw new PlatformError('Discos de origen inválidos');
      // Keys are resolved source paths; unknown ones would silently skip the disk-identity check.
      if(input.sourceIdentities&&Object.keys(input.sourceIdentities).some(k=>!this.sources(policy).includes(k)))throw new PlatformError('Discos de origen inválidos');
      for(const p of this.sources(policy)){
        const v=volumeForPath(snapshot.volumes,p);if(!v?.path||!v.readable)throw new PlatformError('No se pudo identificar el disco de origen. Actualizá los discos',409);
        const selected=input.sourceIdentities?.[p];
        if(selected&&((selected.uuid?selected.uuid!==v.uuid:selected.id!==v.id)||Object.keys(selected).some(k=>!['id','uuid'].includes(k))))throw new PlatformError('El disco de origen cambió desde que elegiste la carpeta. Elegila nuevamente',409);
        policy.sourceVolumes[p]=disk(v);
        if(policy.diskMode&&p!==v.path)throw new PlatformError('Para copiar un disco completo, elegí su carpeta principal');
      }
      if(policy.diskMode&&policy.sources?.length!==1)throw new PlatformError('Elegí un disco por backup completo');
      policy.destinations=[];
      const claimedIds=new Set<string>();
      for(const raw of input.destinations){
        if(!raw||typeof raw.path!=='string'||Object.keys(raw).some(k=>!['id','path','label','volumeId','volumeUuid'].includes(k)))throw new PlatformError('Destino inválido');
        // Two entries reusing one id would share a destinationId: the schedule
        // key and the enqueue dedup would merge them and skip a disk.
        if(raw.id!==undefined&&(typeof raw.id!=='string'||claimedIds.has(raw.id)))throw new PlatformError('Destino inválido');
        if(typeof raw.id==='string')claimedIds.add(raw.id);
        const root=await this.environment.resolve(raw.path,{fresh:true,root:true});
        const previous=typeof raw.id==='string'?existing?.destinations?.find(t=>t.id===raw.id):undefined;
        const selectedPath=previous?.path===root?root:root.replace(/\/$/,'')+'/AXON-Backups/'+policy.id;
        const v=volumeForPath(snapshot.volumes,selectedPath);
        if(!v?.path||v.readOnly||!v.readable)throw new PlatformError('Este destino no permite guardar copias',409);
        if((raw.volumeUuid&&raw.volumeUuid!==v.uuid)||(!raw.volumeUuid&&raw.volumeId&&raw.volumeId!==v.id))throw new PlatformError('El disco de destino cambió desde que lo elegiste. Elegilo nuevamente',409);
        if(previous?.volume&&!sameDisk(previous.volume,v))throw new PlatformError('El disco de destino cambió. Elegilo nuevamente',409);
        if(Object.values(policy.sourceVolumes).some(s=>s.diskId===v.diskId))throw new PlatformError('Elegí un disco físico diferente al de las carpetas. Dos carpetas en el mismo disco no protegen ante una falla',409);
        if(policy.destinations.some(t=>t.volume!.diskId===v.diskId))throw new PlatformError('Ese disco ya está elegido. Sumá otro disco para tener otra copia');
        const sources=this.sources(policy);if(!policy.diskMode&&sources.some(p=>volumeContains(selectedPath,p)||volumeContains(p,selectedPath)))throw new PlatformError('El destino debe estar fuera de las carpetas que vas a proteger');
        policy.destinations.push({id:previous?.id||crypto.randomUUID(),path:selectedPath,label:v.name,volume:disk(v),relativePath:selectedPath.slice(v.path==='/'?1:v.path.length+1)});
      }
      policy.repository=policy.destinations[0].path;
    }else if(input.repository){
      policy.repository=await this.environment.resolve(input.repository,{fresh:true});if(['/home','/mnt','/'].includes(policy.repository))throw new PlatformError('Elegí una carpeta para guardar las copias');
    }else if(existing?.destinations?.length)throw new PlatformError('Conservá o elegí los destinos de este backup');
    this.cancelPending(policy.id,'La configuración cambió. El próximo backup usará los nuevos ajustes.');
    this.store.put('backup-policy',policy.id,policy);
    for(const target of this.targets(policy))this.store.put('backup-schedule',policy.id+':'+target.id,{nextAt:policy.intervalDays&&policy.dailyAt?firstBackupAt(Date.now(),policy.dailyAt):null});
    this.store.append({actor,action:'backup.policy.save',resource:policy.id,projectId:policy.projectId,status:'ok'});return policy;
  });}
  private cancelPending(policyId:string,message:string){for(const j of this.store.list<BackupJob>('backup-job').filter(j=>j.policy.id===policyId&&!j.launchedAt&&activeStates.includes(j.state)))this.store.put('backup-job',j.id,{...j,state:'cancelled',message,endedAt:Date.now()});}
  // Deleting a policy keeps every snapshot already made (they remain
  // restorable through their durable job receipts) — only the plan, its
  // schedule and its still-unlaunched queue entries go away.
  async remove(id:string,actor:string){return this.serial(async()=>{
    const policy=this.store.get<BackupPolicy>('backup-policy',id);if(!policy)throw new PlatformError('Backup no encontrado',404);
    this.cancelPending(id,'Backup eliminado. Las copias existentes se conservan.');
    for(const t of this.targets(policy)){this.store.remove('backup-schedule',policy.id+':'+t.id);this.store.remove('backup-retry',policy.id+':'+t.id);}
    this.store.remove('backup-policy',id);
    this.store.append({actor,action:'backup.policy.delete',resource:id,projectId:policy.projectId,status:'ok',detail:policy.name});
    return {deleted:true};
  });}
  // Cancel one job: an unlaunched queue entry is stamped directly; a launched
  // one gets its worker process group killed (start_new_session gives the
  // worker its own pgid, so restic dies with it) and the stale-worker check
  // in status() then records the honest 'interrupted' outcome.
  async cancel(id:string,actor:string){return this.serial(async()=>{
    const job=this.store.get<BackupJob>('backup-job',id);if(!job)throw new PlatformError('Copia no encontrada',404);
    if(!activeStates.includes(job.state))return job;
    if(!job.launchedAt){
      const done={...job,state:'cancelled',message:'Copia cancelada antes de iniciar.',endedAt:Date.now()};
      this.store.put('backup-job',id,done);
      this.store.append({actor,credentialId:job.credentialId,action:'backup.'+job.mode+'.cancel',resource:id,projectId:job.policy.projectId,status:'ok'});
      return done;
    }
    const current:any=await this.status(id).catch(()=>job);
    if(!activeStates.includes(current.state))return current;
    const pid=Number(current.pid||0);
    if(!Number.isInteger(pid)||pid<2)throw new PlatformError('La copia está en curso pero no se pudo identificar su proceso. Se interrumpe cuando el worker pierde contacto.',409);
    await hostExec(`kill -TERM -${pid} 2>/dev/null || kill -TERM ${pid} 2>/dev/null || true`,{user:'root',timeoutMs:10_000}).catch(()=>{});
    this.store.append({actor,credentialId:job.credentialId,action:'backup.'+job.mode+'.cancel',resource:id,projectId:job.policy.projectId,status:'ok',detail:'Proceso detenido'});
    return this.status(id).catch(()=>current);
  });}
  async toggle(id:string,enabled:boolean,actor:string){return this.serial(async()=>{
    const policy=this.store.get<BackupPolicy>('backup-policy',id);if(!policy)throw new PlatformError('Backup no encontrado',404);
    if(typeof enabled!=='boolean')throw new PlatformError('Estado inválido');policy.enabled=enabled;this.store.put('backup-policy',id,policy);
    if(!enabled)this.cancelPending(id,'Backup pausado. Las copias anteriores se conservan.');
    this.store.append({actor,action:'backup.policy.'+(enabled?'resume':'pause'),resource:id,status:'ok'});return policy;
  });}
  async availability(){return this.run({action:'availability',home:await this.home()});}
  async databases(containerId:string){if(!(await this.hub.sources.containers()).some(c=>c.id===containerId))throw new PlatformError('Contenedor no encontrado',404);return this.run({action:'databases',containerId});}
  private enqueue(policy:BackupPolicy,targets:BackupDestination[],actor:string,credentialId?:string,scheduledFor?:number){
    const batchId=crypto.randomUUID();const jobs:BackupJob[]=[];
    for(const target of targets){
      const pending=this.store.list<BackupJob>('backup-job').find(j=>j.mode==='backup'&&j.policy.id===policy.id&&j.destinationId===target.id&&activeStates.includes(j.state));
      if(pending){jobs.push(pending);continue;}
      const id=crypto.randomUUID(),job:BackupJob={id,policy:{...policy,repository:target.path||undefined,destinations:[target]},destinationId:target.id,destinationLabel:target.label,
        batchId,actor,credentialId,mode:'backup',state:'queued',createdAt:Date.now(),scheduledFor,message:'En espera. AXON hará una copia por vez.'};
      this.store.put('backup-job',id,job);this.store.append({actor,credentialId,action:'backup.start',resource:id,projectId:policy.projectId,status:'running'});jobs.push(job);
    }
    return jobs;
  }
  async start(policyId:string,actor:string,credentialId?:string){
    const jobs=await this.serial(async()=>{const p=this.store.get<BackupPolicy>('backup-policy',policyId);if(!p||!p.enabled)throw new PlatformError('Este backup está pausado',409);return this.enqueue(p,this.targets(p),actor,credentialId);});
    await this.drain();return this.status(jobs[0].id);
  }
  async status(id:string){
    const job=this.store.get<BackupJob>('backup-job',id);if(!job)throw new PlatformError('Copia no encontrada',404);
    if(!job.launchedAt&&!['verified','failed','interrupted'].includes(job.state))return job;
    // A worker-confirmed terminal state is authoritative — never re-query it.
    // Only a TS-side unconfirmed-launch interrupt keeps polling the worker.
    if(!['queued','running','interrupted'].includes(job.state)||(job as any).reconciled)return job;
    // A persistently unreachable worker must not spawn a status subprocess on
    // every poll — back off linearly (30s, 60s, … up to 10min).
    if((job as any).statusRetryAt&&Date.now()<(job as any).statusRetryAt)return {...job,message:'Reintentando la consulta de la copia…'} as BackupJob;
    let status:any;try{status=await this.run({action:'status',home:await this.home(),id});}catch{
      // A concurrent status() may have reconciled a terminal state while our
      // query was in flight — merge backoff into the CURRENT record or a
      // stale 'running' write would re-fire the transition and double-audit.
      const cur=this.store.get<BackupJob>('backup-job',id);
      if(!cur||(cur as any).reconciled)return cur||job;
      const fails=((cur as any).statusFails||0)+1;
      const patched={...cur,statusFails:fails,statusRetryAt:Date.now()+Math.min(fails*30_000,600_000)};
      this.store.put('backup-job',id,patched);
      return {...patched,state:['verified','failed','interrupted'].includes(cur.state)?cur.state:'running',message:'No se pudo consultar la copia. Todavía no se confirma que terminó.'};
    }
    const value={...job,...status,actor:job.actor,credentialId:job.credentialId};delete value.ok;delete value.statusFails;delete value.statusRetryAt;
    if(['verified','failed','interrupted'].includes(value.state))(value as any).reconciled=true;
    // The transition must fire on the FIRST worker-confirmed terminal state,
    // not only on a state change — a job stored 'interrupted' by a launch
    // failure still needs its audit entry and retry backoff once confirmed.
    if(['verified','failed','interrupted'].includes(value.state)&&!(job as any).reconciled){
      // Concurrent pollers each reach this transition; only the first observer
      // (store still unreconciled) records receipts. The reads and writes below
      // are synchronous, so this check is atomic.
      const stored=this.store.get<BackupJob>('backup-job',id);
      if(stored&&!(stored as any).reconciled){
      this.store.append({actor:job.actor,credentialId:job.credentialId,action:'backup.'+job.mode+'.result',resource:id,projectId:job.policy.projectId,status:value.state==='verified'?'ok':value.state==='interrupted'?'interrupted':'failed',detail:value.message,recovery:value.snapshot?{label:'Abrir backup',url:'/backups?job='+encodeURIComponent(id)}:undefined});
      this.notifyFailure(job,value.state,value.message);
      if(job.mode==='backup'){
        const current=this.store.get<BackupPolicy>('backup-policy',job.policy.id);
        if(value.state==='verified'&&current?.enabled&&current.revision===job.policy.revision&&current.dailyAt&&(current.intervalDays??1)>0){
          const key=current.id+':'+job.destinationId,slot=this.store.get<{nextAt:number}>('backup-schedule',key);
          this.store.put('backup-schedule',key,{nextAt:!job.scheduledFor&&slot?.nextAt&&slot.nextAt>Date.now()?slot.nextAt:followingBackupAt(job.scheduledFor||slot?.nextAt||firstBackupAt(job.createdAt,current.dailyAt),Date.now(),current.intervalDays??1)});
        // A 'rejected' phase is a deterministic refusal (invalid policy,
        // missing snapshot) — retrying hourly would fail forever.
        }else if(value.state!=='verified'&&value.phase!=='rejected')this.store.put('backup-retry',job.policy.id+':'+job.destinationId,{after:Date.now()+3600000});
      }
      for(const snapshot of value.forgottenSnapshots||[])for(const old of this.store.list<BackupJob>('backup-job').filter(j=>j.snapshot===snapshot&&j.policy.repository===job.policy.repository))this.store.put('backup-job',old.id,{...old,expired:true});
      }
    }
    // A concurrent status() may have reconciled a terminal record while our
    // query was in flight — never let a stale non-terminal snapshot unset
    // `reconciled`, or the transition would fire again (duplicate audit).
    const cur=this.store.get<BackupJob>('backup-job',id);
    if(cur&&(cur as any).reconciled&&!['verified','failed','interrupted'].includes(value.state))return cur;
    this.store.put('backup-job',id,value);return value as BackupJob;
  }
  // A failed/interrupted backup used to surface only in the UI — fire the
  // same outbound channel the alert watcher uses, once per terminal state
  // (both call sites run inside the first-observer reconciliation guard).
  private notifyFailure(job:BackupJob,state:string,message?:string){
    if(job.mode!=='backup'||!['failed','interrupted'].includes(state))return;
    notify(`Backup no completado: ${job.policy.name||'copia'}`,(message||'La copia no terminó.').slice(0,300),4).catch(()=>{});
  }
  private async prepare(job:BackupJob){
    const policy={...job.policy},mounted=(await this.environment.volumes()).volumes;
    const target=policy.destinations?.[0];
    if(target?.volume){
      const v=mounted.find(v=>v.path&&sameDisk(target.volume!,v)&&v.readable&&!v.readOnly);
      if(!v?.path)throw new PlatformError('Esperando el disco '+target.label+'. Conectalo y AXON retomará la copia.',409);
      policy.repository=v.path.replace(/\/$/,'')+'/'+target.relativePath;
      await this.environment.resolve(policy.repository,{fresh:true});
    }else if(policy.repository)await this.environment.resolve(policy.repository,{fresh:true});
    const sourceMounts:Record<string,string>={};
    if(job.mode==='backup')for(const p of this.sources(policy)){
      await this.environment.resolve(p,{directory:true,fresh:true,root:policy.diskMode});
      const v=volumeForPath(mounted,p),expected=policy.sourceVolumes?.[p];
      if(expected&&(!v||!sameDisk(expected,v)))throw new PlatformError('Esperando el disco de origen de '+p+'. No se copiará otra carpeta en su lugar.',409);
      if(v&&target?.volume&&v.diskId===target.volume.diskId)throw new PlatformError('El destino debe estar en otro disco físico que el origen actual.',409);
      if(v?.mountId&&v.filesystem!=='fixture')sourceMounts[p]=v.mountId;
    }
    const repositoryVolume=policy.repository?volumeForPath(mounted,policy.repository):undefined;
    const repositoryMountId=repositoryVolume?.filesystem==='fixture'?undefined:repositoryVolume?.mountId;
    // Freeze the effective destination, independent of future edits/remounts.
    return {policy,sourceMounts,repositoryMountId};
  }
  async drain():Promise<void>{
    if(this.draining){
      // The in-flight pass listed the queue before a concurrent enqueue may
      // have added jobs; run a follow-up pass if eligible work remains.
      return this.draining.then(()=>this.store.list<BackupJob>('backup-job').some(j=>!j.launchedAt&&['queued','waiting'].includes(j.state)&&(!j.retryAt||j.retryAt<=Date.now()))?this.drain():undefined);
    }
    this.draining=this.serial(async()=>{
      const active=this.store.list<BackupJob>('backup-job').filter(j=>j.launchedAt&&['queued','running'].includes(j.state)||(j.launchedAt&&j.state==='interrupted'&&!(j as any).reconciled));
      for(const j of active){const s=await this.status(j.id);if(['queued','running'].includes(s.state))return;}
      const queue=this.store.list<BackupJob>('backup-job').filter(j=>!j.launchedAt&&['queued','waiting'].includes(j.state)&&(!j.retryAt||j.retryAt<=Date.now())).sort((a,b)=>a.createdAt-b.createdAt);
      for(const job of queue){
        if(job.mode==='backup'&&!this.store.get<BackupPolicy>('backup-policy',job.policy.id)?.enabled){this.store.put('backup-job',job.id,{...job,state:'cancelled',message:'Backup pausado.'});continue;}
        let prepared;
        try{prepared=await this.prepare(job);}catch(e){this.store.put('backup-job',job.id,{...job,state:'waiting',message:e instanceof Error?e.message:'Esperando el disco.',retryAt:Date.now()+60000});continue;}
        const launch={...job,policy:prepared.policy,launchedAt:Date.now(),state:'queued'};this.store.put('backup-job',job.id,launch);
        try{
          const result=await this.run({action:'start',home:await this.home(),id:job.id,policy:prepared.policy,mode:job.mode,originalId:(job as any).originalId,paths:job.paths,excludedRepositories:[...new Set([...this.policies().flatMap(p=>this.targets(p).map(t=>t.path)),...this.store.list<BackupJob>('backup-job').map(j=>j.policy.repository)].filter(Boolean))],sourceMounts:prepared.sourceMounts,repositoryMountId:prepared.repositoryMountId});
          const merged:any={...launch,...result,launchedAt:launch.launchedAt};
          // A worker-side deterministic rejection is already terminal —
          // record it reconciled with its audit entry so the transition never
          // re-fires and no backup-retry is scheduled for a permanent refusal.
          if(merged.state==='failed'){
            merged.reconciled=true;
            this.store.put('backup-job',job.id,merged);
            this.store.append({actor:job.actor,credentialId:job.credentialId,action:'backup.'+job.mode+'.result',resource:job.id,projectId:job.policy.projectId,status:'failed',detail:merged.message});
            this.notifyFailure(job,'failed',merged.message);
          }else this.store.put('backup-job',job.id,merged);
        }catch(e){this.store.put('backup-job',job.id,{...launch,state:'interrupted',message:'El inicio no pudo confirmarse. AXON conserva el intento y no lo repite para evitar duplicados.'});}
        return;
      }
    }).finally(()=>{this.draining=undefined;});return this.draining;
  }
  private resolveJobs(jobs:BackupJob[]){return Promise.all(jobs.map(j=>j.launchedAt&&['queued','running'].includes(j.state)||(j.launchedAt&&j.state==='interrupted'&&!(j as any).reconciled)?this.status(j.id):Promise.resolve(j)));}
  async list(projectId?:string){return (await this.jobsPage(projectId,0,500)).jobs;}
  // Paginated variant — the flat 500-job cap used to hide older receipts.
  async jobsPage(projectId:string|undefined,offset:number,limit:number){
    await this.drain();
    const all=this.store.list<BackupJob>('backup-job').filter(j=>!projectId||j.policy.projectId===projectId);
    const jobs=await this.resolveJobs(all.slice(Math.max(0,offset),Math.max(0,offset)+Math.min(500,Math.max(1,limit))));
    return {jobs,total:all.length};
  }
  async forProject(projectId:string,actor:string,credentialId?:string){this.hub.project(projectId);const policies=this.policies(projectId).filter(p=>p.enabled),policy=policies.find(p=>p.kind==='files')||policies[0];if(!policy)throw new PlatformError('El proyecto todavía no tiene un backup configurado',409);return this.start(policy.id,actor,credentialId);}
  async recover(originalId:string,mode:'restore'|'verify',actor:string,paths?:string[]){
    const original=await this.status(originalId);if(!original.snapshot||original.expired||activeStates.includes(original.state))throw new PlatformError('Esta versión no está disponible para recuperar',409);
    if(paths!==undefined&&(!Array.isArray(paths)||!paths.length||paths.length>50||paths.some(p=>typeof p!=='string'||!p.startsWith('/')||p.length>4096||/[\x00-\x1f]/.test(p))))throw new PlatformError('Selección inválida');
    const id=crypto.randomUUID(),job={id,policy:original.policy,destinationId:original.destinationId,destinationLabel:original.destinationLabel,originalId,paths,mode,state:'queued',actor,createdAt:Date.now(),message:'Preparando una copia en una carpeta nueva.'};
    await this.serial(async()=>{this.store.put('backup-job',id,job);this.store.append({actor,action:'backup.'+mode+'.start',resource:id,status:'running'});});await this.drain();return this.status(id);
  }
  async browse(id:string,folder:string,offset=0){
    const job=await this.status(id);if(!job.snapshot||job.expired)throw new PlatformError('Versión no disponible',409);
    const prepared=await this.prepare({...job,mode:'restore'});
    return this.run({action:'browse',home:await this.home(),id,repository:prepared.policy.repository,repositoryMountId:prepared.repositoryMountId,folder,offset});
  }
  async recoveryKit(actor:string){
    const home=await this.home(),value=await this.run({action:'recovery-kit',home});
    const repositories=new Map<string,{name:string;destination:string;path:string;volumeUuid?:string|null}>();
    const record=(p:BackupPolicy,t:BackupDestination)=>{const path=t.path||home+'/.local/share/axon/backups/repository';repositories.set(path,{name:p.name,destination:t.label,path,volumeUuid:t.volume?.uuid});};
    for(const p of this.policies())for(const t of this.targets(p))record(p,t);
    // Include previous destinations: old snapshots remain recoverable after editing a plan.
    for(const j of this.store.list<BackupJob>('backup-job').filter(j=>j.mode==='backup'&&j.snapshot&&!j.expired))for(const t of this.targets(j.policy))record(j.policy,{...t,path:j.policy.repository||t.path});
    this.store.append({actor,action:'backup.recovery-kit.export',resource:'recovery-kit',status:'ok'});
    return {version:1,createdAt:new Date().toISOString(),password:value.password,repositories:[...repositories.values()],instructions:'Guardá este archivo fuera del disco del servidor. Usá Restic con el repositorio y esta contraseña para listar las versiones y restaurar en una carpeta nueva.'};
  }

  async tick(now=Date.now()){
    await this.drain();
    await this.serial(async()=>{
      for(const p of this.policies().filter(p=>p.enabled&&p.dailyAt&&(p.intervalDays??1)>0))for(const target of this.targets(p)){
        const key=p.id+':'+target.id;let slot=this.store.get<{nextAt:number}>('backup-schedule',key);
        if(!slot){slot={nextAt:firstBackupAt(p.createdAt||now-86400000,p.dailyAt!)};this.store.put('backup-schedule',key,slot);}
        if(slot.nextAt>now||(this.store.get<{after:number}>('backup-retry',key)?.after||0)>now)continue;
        this.enqueue(p,[target],'scheduler',undefined,slot.nextAt);
      }
    });await this.drain();
  }
  schedule(policy:BackupPolicy){return this.targets(policy).map(t=>({destinationId:t.id,nextAt:this.store.get<{nextAt:number}>('backup-schedule',policy.id+':'+t.id)?.nextAt||null}));}
  scheduler(){const timer=setInterval(()=>this.tick().catch(()=>{}),30000);timer.unref();void this.tick().catch(()=>{});return timer;}
}
export function registerBackups(app:Hono,backups:Backups){
  app.use('/api/backups*',async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
  const handle=(fn:(c:any)=>Promise<any>)=>async(c:any)=>{try{return await fn(c);}catch(e){return c.json({ok:false,error:e instanceof Error?e.message:'No se pudo completar el backup'},e instanceof PlatformError||e instanceof MaintenanceError?e.status:409);}};
  const body=async(c:any)=>{const raw=await c.req.text();if(raw.length>32768)throw new PlatformError('Solicitud demasiado grande',413);try{return JSON.parse(raw);}catch{throw new PlatformError('Solicitud inválida');}};
  app.get('/api/backups',handle(async c=>{
    const project=c.req.query('project'),policies=backups.policies(project);
    const offset=Number(c.req.query('offset')||0),limit=Number(c.req.query('limit')||120);
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1)throw new PlatformError('Página inválida');
    const page=await backups.jobsPage(project,offset,limit);
    return c.json({ok:true,policies:policies.map(p=>({...p,schedule:backups.schedule(p)})),jobs:page.jobs,jobsTotal:page.total,availability:await backups.availability(),projects:backups.hub.sources.projects().map(({id,name,cwd})=>({id,name,cwd})),containers:(await backups.hub.sources.containers()).filter(c=>/(?:^|\/)postgres(?:[:@]|$)/.test(c.image)).map(({id,name,state})=>({id,name,state}))});
  }));
  app.post('/api/backups/policies',handle(async c=>c.json({ok:true,policy:await backups.save(await body(c),c.get('user'))},201)));
  app.patch('/api/backups/policies/:id',handle(async c=>{const value=await body(c);if(!value||Object.keys(value).some(k=>k!=='enabled'))throw new PlatformError('Solicitud inválida');return c.json({ok:true,policy:await backups.toggle(c.req.param('id'),value.enabled,c.get('user'))});}));
  app.delete('/api/backups/policies/:id',handle(async c=>{const raw=await c.req.text();if(raw)throw new PlatformError('Solicitud inválida');return c.json({ok:true,...await backups.remove(c.req.param('id'),c.get('user'))});}));
  app.get('/api/backups/databases/:id',handle(async c=>c.json(await backups.databases(c.req.param('id')))));
  app.post('/api/backups/policies/:id/run',handle(async c=>{const value=await body(c);if(!value||Object.keys(value).length)throw new PlatformError('No se aceptan parámetros');return c.json({ok:true,job:await backups.start(c.req.param('id'),c.get('user'))},202);}));
  app.get('/api/backups/jobs/:id',handle(async c=>{await backups.drain();return c.json({ok:true,job:await backups.status(c.req.param('id'))});}));
  app.get('/api/backups/jobs/:id/files',handle(async c=>{const offset=Number(c.req.query('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new PlatformError('Página inválida');return c.json(await backups.browse(c.req.param('id'),c.req.query('path')||'/',offset));}));
  app.post('/api/backups/recovery-kit',handle(async c=>{const value=await body(c);if(!value||Object.keys(value).length)throw new PlatformError('Solicitud inválida');c.header('Content-Disposition','attachment; filename="axon-clave-de-recuperacion.json"');return c.json(await backups.recoveryKit(c.get('user')));}));
  app.post('/api/backups/jobs/:id/:mode',handle(async c=>{
    const mode=c.req.param('mode');
    if(mode==='cancel'){const raw=await c.req.text();if(raw)throw new PlatformError('Solicitud inválida');return c.json({ok:true,job:await backups.cancel(c.req.param('id'),c.get('user'))});}
    if(!['restore','verify'].includes(mode))throw new PlatformError('Acción inválida');
    const value=await body(c);if(!value||Object.keys(value).some(k=>k!=='paths')||(mode==='verify'&&Object.keys(value).length))throw new PlatformError('Solicitud inválida');
    return c.json({ok:true,job:await backups.recover(c.req.param('id'),mode,c.get('user'),value.paths)},202);
  }));
}
