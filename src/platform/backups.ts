import { resolveHostPath, hostVolumes } from '../host-storage';
import { volumeForPath } from '../file-volumes';
import { readFile } from 'node:fs/promises';
import { hostSpawnInteractive, ON_HOST } from '../host';
import { PlatformError, type PlatformStore } from './store';
import type { ProjectHub } from './projects';
import type { Hono } from 'hono';

export interface BackupPolicy {
  id:string;name:string;projectId?:string;kind:'files'|'configuration'|'postgres';source?:string;repository?:string;
  containerId?:string;databases?:string[];dailyAt?:string;enabled:boolean;
}
export interface BackupJob {id:string;policy:BackupPolicy;mode:'backup'|'restore'|'verify';state:string;phase?:string;actor:string;credentialId?:string;createdAt:number;snapshot?:string;message?:string;verifiedAt?:number;restoredPath?:string;bytes?:number;files?:number}
export type BackupRunner = (request:Record<string,unknown>) => Promise<any>;
let workerSource:Promise<string>;
export async function backupWorker(request:Record<string,unknown>) {
  const source = await (workerSource ||= readFile(new URL('./backup-host.py',import.meta.url),'utf8'));
  const quote = (s:string) => `'${s.replace(/'/g,`'"'"'`)}'`;
  const p = hostSpawnInteractive('python3 -c '+quote(source),{user:'root'});
  (p.stdin as Bun.FileSink).write(JSON.stringify({...request,workerSource:source}));(p.stdin as Bun.FileSink).end();
  const timer = setTimeout(() => p.kill(),25000);
  try {
    const [out,,code] = await Promise.all([new Response(p.stdout as ReadableStream).text(),new Response(p.stderr as ReadableStream).text(),p.exited]);
    if (code || out.length > 2_000_000) throw new PlatformError('No se pudo consultar el worker de backups',503);
    const result = JSON.parse(out);if (!result.ok) throw new PlatformError(result.error || 'Backup no disponible',409);return result;
  } finally {clearTimeout(timer);}
}
export async function hostDataDirectory(configDir:string):Promise<string> {
  if (ON_HOST) return configDir;
  // AXON shares the host UTS namespace, so HOSTNAME names the host, not Docker.
  const p = Bun.spawn(['docker','inspect',process.env.AXON_CONTAINER_NAME || 'axon','--format','{{json .Mounts}}'],{stdout:'pipe',stderr:'pipe'});
  const [out,,code] = await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
  if (code) throw new Error('No se pudo resolver el montaje de configuración');
  const mounts = JSON.parse(out) as {Destination:string;Source:string;Type:string}[];
  const mount = mounts.find(m => m.Type === 'bind' && (configDir === m.Destination || configDir.startsWith(m.Destination+'/')));
  if (!mount) throw new Error('La configuración requiere un montaje de host conocido para respaldarse');
  return mount.Source+configDir.slice(mount.Destination.length);
}
export class Backups {
  constructor(readonly store:PlatformStore,readonly hub:ProjectHub,private home:() => Promise<string>,private configDir:() => Promise<string>,private run:BackupRunner=backupWorker) {}
  policies(projectId?:string) {return this.store.list<BackupPolicy>('backup-policy').filter(p => !projectId || p.projectId === projectId);}
  async ensureConfiguration() {
    if (!this.store.get('backup-policy','server-configuration')) this.store.put('backup-policy','server-configuration',{id:'server-configuration',name:'Configuración de AXON',kind:'configuration',source:await this.configDir(),dailyAt:'04:00',enabled:true} satisfies BackupPolicy);
  }
  async save(input:any,actor:string) {
    if (!input || Object.keys(input).some(k => !['id','name','kind','projectId','containerId','databases','dailyAt','enabled','repository'].includes(k))) throw new PlatformError('Política inválida');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || !['files','postgres','configuration'].includes(input.kind) || typeof input.enabled !== 'boolean') throw new PlatformError('Nombre, tipo o estado inválidos');
    if (input.dailyAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.dailyAt)) throw new PlatformError('Horario inválido');
    const existing = input.id ? this.store.get<BackupPolicy>('backup-policy',input.id) : undefined;
    if (input.id && !existing) throw new PlatformError('Política no encontrada',404);
    const policy:BackupPolicy = {id:existing?.id || crypto.randomUUID(),name:input.name.trim(),kind:input.kind,enabled:input.enabled,dailyAt:input.dailyAt || undefined};
    if(input.repository){policy.repository=await resolveHostPath(input.repository,{fresh:true});if(policy.repository==='/home'||policy.repository==='/mnt')throw new PlatformError('Elegí una carpeta para el repositorio');}
    if (input.kind === 'configuration') {policy.source=await this.configDir();}
    else {
      const project = this.hub.project(input.projectId);policy.projectId=project.id;
      if (input.kind === 'files') policy.source=project.cwd;
      else {
        const container = (await this.hub.sources.containers()).find(c => c.id === input.containerId);
        if (!container || container.state !== 'running' || !/(?:^|\/)postgres(?:[:@]|$)/.test(container.image)) throw new PlatformError('PostgreSQL compatible no encontrado');
        const available = await this.run({action:'databases',containerId:container.id});
        if (!Array.isArray(input.databases) || !input.databases.length || input.databases.some((d:any) => !available.databases.includes(d))) throw new PlatformError('Seleccioná bases válidas');
        policy.containerId=container.id;policy.databases=[...new Set<string>(input.databases)];
      }
    }
    this.store.put('backup-policy',policy.id,policy);this.store.append({actor,action:'backup.policy.save',resource:policy.id,projectId:policy.projectId,status:'ok'});return policy;
  }
  async availability() {return this.run({action:'availability',home:await this.home()});}
  async databases(containerId:string) {
    const container=(await this.hub.sources.containers()).find(c => c.id === containerId);
    if (!container) throw new PlatformError('Contenedor no encontrado',404);return this.run({action:'databases',containerId});
  }
  async start(policyId:string,actor:string,credentialId?:string) {
    const policy=this.store.get<BackupPolicy>('backup-policy',policyId);if (!policy || !policy.enabled) throw new PlatformError('Política ausente o deshabilitada',404);
    if(policy.kind==='files'&&policy.source&&this.run===backupWorker)await resolveHostPath(policy.source,{directory:true});
    if(policy.repository&&this.run===backupWorker)await resolveHostPath(policy.repository,{fresh:true});
    const mounted=this.run===backupWorker?(await hostVolumes.snapshot(true)).volumes:[];
    const externalMount=(p:string|undefined)=>{const v=p?volumeForPath(mounted,p):undefined;return v?.path&&v.path!=='/'?v.mountId:undefined;};
    const home=await this.home(),id=crypto.randomUUID();
    const pending = this.store.list<BackupJob>('backup-job').filter(j => ['queued','running'].includes(j.state));
    for (const job of pending) if (['queued','running'].includes((await this.status(job.id)).state)) throw new PlatformError('Hay un backup o restauración en curso. Esperá a que termine.',409);
    const job:BackupJob={id,policy,actor,credentialId,mode:'backup',state:'queued',createdAt:Date.now()};
    this.store.put('backup-job',id,job);this.store.append({actor,credentialId,action:'backup.start',resource:id,projectId:policy.projectId,status:'running'});
    try { const status = await this.run({action:'start',home,id,policy,sourceMountId:externalMount(policy.source),repositoryMountId:externalMount(policy.repository)});this.store.put('backup-job',id,{...job,...status,actor,credentialId});return this.status(id); }
    catch(e){this.store.put('backup-job',id,{...job,state:'interrupted',message:'El inicio no fue confirmado. Se conserva el intento y no se reejecuta automáticamente.'});throw e;}
  }
  async status(id:string) {
    const job=this.store.get<BackupJob>('backup-job',id);if (!job) throw new PlatformError('Backup no encontrado',404);
    let status:any;
    try{status=await this.run({action:'status',home:await this.home(),id});}
    catch {return {...job,message:'El recibo del host no está disponible. No se afirma que el trabajo haya terminado.'};}
    const value={...job,...status,actor:job.actor,credentialId:job.credentialId};delete value.ok;
    if (value.state !== job.state && ['verified','failed','interrupted'].includes(value.state)) this.store.append({actor:job.actor,credentialId:job.credentialId,action:'backup.'+job.mode+'.result',resource:id,projectId:job.policy.projectId,status:value.state === 'verified' ? 'ok' : value.state === 'interrupted' ? 'interrupted' : 'failed',detail:value.message,recovery:value.snapshot ? {label:'Abrir respaldo',url:'/respaldos?job='+encodeURIComponent(id)} : undefined});
    this.store.put('backup-job',id,value);return value as BackupJob;
  }
  async list(projectId?:string) {
    const jobs=this.store.list<BackupJob>('backup-job').filter(j => !projectId || j.policy.projectId === projectId).slice(0,100);
    return Promise.all(jobs.map(j => ['queued','running','interrupted'].includes(j.state) ? this.status(j.id) : Promise.resolve(j)));
  }
  async forProject(projectId:string,actor:string,credentialId?:string) {
    this.hub.project(projectId);const policies=this.policies(projectId).filter(p => p.enabled);
    const policy=policies.find(p => p.kind === 'files') || policies[0];if (!policy) throw new PlatformError('El proyecto todavía no tiene una política de backup configurada',409);
    return this.start(policy.id,actor,credentialId);
  }
  async recover(originalId:string,mode:'restore'|'verify',actor:string) {
    const original=await this.status(originalId);if (!original.snapshot) throw new PlatformError('El respaldo no tiene un snapshot confirmado',409);
    if(original.policy.repository&&this.run===backupWorker)await resolveHostPath(original.policy.repository,{fresh:true});
    const v=original.policy.repository&&this.run===backupWorker?volumeForPath((await hostVolumes.snapshot(true)).volumes,original.policy.repository):undefined;
    const id=crypto.randomUUID(),job:BackupJob={id,policy:original.policy,mode,state:'queued',actor,createdAt:Date.now()};
    this.store.put('backup-job',id,job);
    const status=await this.run({action:'start',home:await this.home(),id,mode,originalId,repositoryMountId:v?.path&&v.path!=='/'?v.mountId:undefined});this.store.put('backup-job',id,{...job,...status,actor});return this.status(id);
  }
  scheduler() {
    const tick=async() => {
      const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
      const part=(k:string) => parts.find(p => p.type === k)?.value;
      const clock=part('hour')+':'+part('minute'),day=part('year')+'-'+part('month')+'-'+part('day');
      for (const policy of this.policies().filter(p => p.enabled && p.dailyAt === clock)) {
        if (this.store.get('backup-slot',policy.id) === day) continue;
        this.store.put('backup-slot',policy.id,day);
        try{await this.start(policy.id,'scheduler');}catch{this.store.append({actor:'scheduler',action:'backup.schedule',resource:policy.id,projectId:policy.projectId,status:'failed',detail:'No se pudo iniciar el backup programado. Revisá las operaciones en curso.'});}
      }
    };
    const timer=setInterval(() => tick().catch(() => {}),30000);timer.unref();return timer;
  }
}
export function registerBackups(app:Hono,backups:Backups) {
  app.use('/api/backups*',async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
  const handle=(fn:(c:any) => Promise<any>) => async(c:any) => {try{return await fn(c);}catch(e){return c.json({ok:false,error:e instanceof PlatformError ? e.message : 'No se pudo completar el backup'},e instanceof PlatformError ? e.status : 503);}};
  const body=async(c:any) => {const raw=await c.req.text();if(raw.length>16384)throw new PlatformError('Solicitud excedida',413);try{return JSON.parse(raw);}catch{throw new PlatformError('JSON inválido');}};
  app.get('/api/backups',handle(async c => c.json({ok:true,policies:backups.policies(c.req.query('project')),jobs:await backups.list(c.req.query('project')),availability:await backups.availability(),projects:backups.hub.sources.projects().map(({id,name}) => ({id,name})),containers:(await backups.hub.sources.containers()).filter(c => /(?:^|\/)postgres(?:[:@]|$)/.test(c.image)).map(({id,name,state}) => ({id,name,state}))})));
  app.post('/api/backups/policies',handle(async c => c.json({ok:true,policy:await backups.save(await body(c),c.get('user'))},201)));
  app.get('/api/backups/databases/:id',handle(async c => c.json(await backups.databases(c.req.param('id')))));
  app.post('/api/backups/policies/:id/run',handle(async c => {const value=await body(c);if(!value||Object.keys(value).length)throw new PlatformError('No se aceptan parámetros');return c.json({ok:true,job:await backups.start(c.req.param('id'),c.get('user'))},202);}));
  app.get('/api/backups/jobs/:id',handle(async c => c.json({ok:true,job:await backups.status(c.req.param('id'))})));
  app.post('/api/backups/jobs/:id/:mode',handle(async c => {const mode=c.req.param('mode');if(!['restore','verify'].includes(mode))throw new PlatformError('Acción inválida');const value=await body(c);if(!value||Object.keys(value).length)throw new PlatformError('No se aceptan parámetros');return c.json({ok:true,job:await backups.recover(c.req.param('id'),mode,c.get('user'))},202);}));
}
