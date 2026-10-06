import { readFile, open } from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { HOST_USER, hostExec, hostToContainer } from './host';
import { runJob, runningJobs, type JobStep } from './jobs';
import {softwareIcons,type IconInfo} from './software-icons';
import {bodyLimit} from 'hono/body-limit';

export interface SoftwareSource {
  id:string; manager:string; scope:string; user:string; root?:string; available:boolean; complete:boolean;
  updateState:string; policy?:{minutes:number;excludes:string[]}; checkedAt?:number; metadataAt?:number; error?:string; note?:string;
}
export interface SoftwareInstallation {
  id:string; manager:string; scope:string; uid:number; user:string; root:string; packageName:string;
  architecture?:string; name:string; version:string|null; description?:string; kind:string; sourceId?:string;
  executables:string[]; executablePath?:string; applicationId?:string; integrationId?:string; desktopFile?:string;
  iconFile?:string; iconSource?:string; iconUrl?:string; origin?:string; policy?:{minutes:number;excludes:string[]};
  iconName?:string;iconInfo?:IconInfo;sourceName?:string;homepage?:string;projectName?:string;
  canUpdate:boolean; updateState:string; reason:string; targetVersion?:string; targetCommit?:string; targetRevision?:string;
}
export interface SoftwareSnapshot {ok:true; installations:SoftwareInstallation[]; sources:SoftwareSource[]; checkedAt:number; user:string; home:string; canAdministerSystem:boolean; checking?:boolean; error?:string}
export interface SoftwareTransaction {manager:string;scope:string;user:string;root:string;items:SoftwareInstallation[];argv:string[];effects:string;simulation:{complete:boolean;changes:{packageName:string;targetVersion:string}[];removals:string[]}}
export interface SoftwarePlan {ok:true;id?:string;createdAt:number;expiresAt?:number;transactions:SoftwareTransaction[]}
type Runner = (req:Record<string,unknown>)=>Promise<any>;
const DATA = path.dirname(process.env.CONFIG_PATH || '/app/data/config.json');
const shq=(s:string)=>`'${s.replace(/'/g,`'"'"'`)}'`;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const validPackage=(s:string)=>/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(s);

let script:Promise<string>;
const scriptText=()=>script ||= readFile(new URL('./software-host.py',import.meta.url),'utf8');
export async function nativeSoftwareRunner(request:Record<string,unknown>) {
  if(Array.isArray(request.items))request={...request,items:request.items.map(p=>({id:p.id,version:p.version,targetVersion:p.targetVersion,targetRevision:p.targetRevision,targetCommit:p.targetCommit}))};
  const encoded=Buffer.from(JSON.stringify(request)).toString('base64');
  if(encoded.length>70000)throw new Error('El plan es demasiado grande; seleccioná menos instalaciones');
  const result=await hostExec(`python3 -c ${shq(await scriptText())} ${shq(encoded)}`,{user:'root',timeoutMs:180_000});
  let parsed:any;
  try {parsed=JSON.parse(result.stdout);} catch {throw new Error('La lectura del inventario del host no pudo completarse');}
  if(!result.ok||!parsed.ok)throw new Error(parsed.error || 'El gestor no pudo completar la operación');
  return parsed;
}

export async function softwareCommand(request:Record<string,unknown>):Promise<string> {
  const text=await scriptText(), hash=digest(text).slice(0,20);
  // A host-owned immutable helper, shared by all AXON instances on this host.
  const bootstrap="import os,pathlib,base64,stat,sys;d=pathlib.Path('/var/tmp/axon-software-'+str(os.getuid()));d.mkdir(mode=0o700,exist_ok=True);s=d.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==os.getuid() and not s.st_mode&0o077;f=d/sys.argv[1];b=base64.b64decode(sys.argv[2]);fd=os.open(str(f),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600) if not f.exists() else None;os.write(fd,b) if fd is not None else None;os.close(fd) if fd is not None else None;assert f.is_file() and not f.is_symlink() and f.read_bytes()==b;print(f)";
  const result=await hostExec(`python3 -c ${shq(bootstrap)} ${shq(hash+'.py')} ${shq(Buffer.from(text).toString('base64'))}`,{user:'root',timeoutMs:15000});
  if(!result.ok||!/^\/var\/tmp\/axon-software-\d+\/[a-f0-9]+\.py$/.test(result.stdout.trim()))throw new Error('No se pudo preparar el executor de software');
  const encoded=Buffer.from(JSON.stringify(request)).toString('base64');if(encoded.length>110000)throw new Error('El plan es demasiado grande; seleccioná menos instalaciones');
  return `python3 ${shq(result.stdout.trim())} ${shq(encoded)}`;
}

interface SoftwareConfig {users?:string[]; contexts?:Record<string,{paths?:string[];environment?:Record<string,string>;iconTheme?:string}>; hooks?:Record<string,string>; ignored?:string[]}
export async function softwareConfig():Promise<SoftwareConfig> {
  try {
    const parsed=JSON.parse(await readFile(path.join(DATA,'software.json'),'utf8'));
    if(!parsed||typeof parsed!=='object')throw new Error();
    if(parsed.users && (!Array.isArray(parsed.users)||parsed.users.length>8||parsed.users.some((u:any)=>typeof u!=='string'||!/^[a-z_][a-z0-9_-]*[$]?$/i.test(u))))throw new Error();
    for(const c of Object.values(parsed.contexts || {}) as any[]) {
      if(c.paths && (!Array.isArray(c.paths)||c.paths.length>20||c.paths.some((p:any)=>typeof p!=='string'||!p.startsWith('/')||/[\n\0:]/.test(p))))throw new Error();
      for(const [key,value] of Object.entries(c.environment || {}))if(!['PNPM_HOME','BUN_INSTALL','CARGO_HOME','RUSTUP_HOME','XDG_DATA_HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','UV_TOOL_DIR','PIPX_HOME'].includes(key)||typeof value!=='string'||!value.startsWith('/')||/[\n\0]/.test(value))throw new Error();
      if(c.iconTheme && !/^[A-Za-z0-9_.-]+$/.test(c.iconTheme))throw new Error();
    }
    if(parsed.hooks && Object.entries(parsed.hooks).some(([p,c])=>!validPackage(p)||typeof c!=='string'||c.length>2000||c.includes('\0')))throw new Error();
    if(parsed.ignored && (!Array.isArray(parsed.ignored)||parsed.ignored.some((id:any)=>typeof id!=='string')))throw new Error();
    return parsed;
  } catch(e:any) {if(e.code==='ENOENT')return {};throw new Error('software.json no es válido; no se aplican recetas ni ámbitos aproximados');}
}

// Metadata only: optional integrations do not decide which packages exist.
async function integrations() {
  const { programDefinitions }=await import('./programs');
  return programDefinitions().flatMap(p=>{
    const binary=p.detect.map(d=>d.cmd.match(/^command -v ([A-Za-z0-9_.+-]+)$/)?.[1]).find(Boolean);
    return binary && !['apt','snap','pnpm-globals','cargo-tools'].includes(p.id)?[{id:p.id,name:p.name,binary,package:p.npmPkg}]:[];
  });
}

const registryCache=new Map<string,{at:number;value:any}>();
function compareVersions(a:string,b:string) {
  const parse=(s:string)=>s.match(/^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/);
  const x=parse(a),y=parse(b);if(!x||!y)return 0;
  for(let i=1;i<=3;i++){const n=Number(x[i])-Number(y[i]);if(n)return n;}
  if(!x[4]&&y[4])return 1;if(x[4]&&!y[4])return -1;
  return (x[4]||'').localeCompare(y[4]||'',undefined,{numeric:true});
}
export function registryCandidate(metadata:any,row:Pick<SoftwareInstallation,'packageName'|'version'|'policy'>,now=Date.now()):string|null {
  const latest=metadata?.['dist-tags']?.latest;
  if(typeof latest!=='string'||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(latest))return null;
  const policy=row.policy || {minutes:0,excludes:[]};
  const excluded=(value:string)=>policy.excludes.some(pattern=>new RegExp('^'+pattern.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(value));
  const exempt=excluded(row.packageName);
  if(!policy.minutes||exempt)return latest;
  const candidates=Object.entries(metadata.time || {}).filter(([v,stamp])=>/^\d+\.\d+\.\d+$/.test(v)&&compareVersions(v,latest)<=0&&(excluded(row.packageName+'@'+v)||Date.parse(String(stamp))<=now-policy.minutes*60000)).map(([v])=>v);
  return candidates.sort((a,b)=>compareVersions(b,a))[0]||null;
}
async function registryMetadata(pkg:string) {
  if(!validPackage(pkg))throw new Error('El paquete usa una fuente que no es un registro compatible');
  const cached=registryCache.get(pkg);if(cached && Date.now()-cached.at<600000)return cached.value;
  const response=await fetch('https://registry.npmjs.org/'+encodeURIComponent(pkg),{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('No se pudo consultar el registro de versiones');
  const reader=response.body?.getReader();if(!reader)throw new Error('Registro vacío');const chunks:Uint8Array[]=[];let length=0;for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>64*1024*1024){await reader.cancel();throw new Error('Metadatos del registro excedidos');}chunks.push(part.value);}const text=Buffer.concat(chunks).toString('utf8');
  const parsed=JSON.parse(text),value={'dist-tags':parsed['dist-tags'],time:parsed.time};registryCache.set(pkg,{at:Date.now(),value});if(registryCache.size>500)registryCache.delete(registryCache.keys().next().value!);
  return value;
}

export class SoftwareService {
  private snapshot?:SoftwareSnapshot;
  private flight?:Promise<SoftwareSnapshot>;
  private updates?:Promise<void>;
  private generation=0;
  private checked=0;
  private plans=new Map<string,{plan:SoftwarePlan;config:SoftwareConfig}>();
  constructor(private run:Runner=nativeSoftwareRunner,private config=softwareConfig,private integrationLoader=integrations,private metadata=registryMetadata){}
  invalidate(){this.generation++;this.flight=undefined;this.updates=undefined;this.checked=0;/* Retain the last snapshot on read failure. */}
  refreshIcons(){if(this.snapshot){softwareIcons.learnNative(this.snapshot.installations);for(const row of this.snapshot.installations){row.iconInfo=softwareIcons.describe(row);row.iconUrl='/api/software/icons/'+encodeURIComponent(row.id)+'?v='+row.iconInfo.version;}}}
  async get(fresh=false):Promise<SoftwareSnapshot>{
    if(fresh)this.invalidate();
    if(!fresh&&this.snapshot&&Date.now()-this.snapshot.checkedAt<60000){this.check();return {...this.snapshot,checking:!!this.updates};}
    if(!this.flight){
      const generation=this.generation;
      const previous=this.snapshot;
      const flight=this.read(false).then(snapshot=>{
        if(previous){
          const failed=new Set(snapshot.sources.filter(s=>s.available&&(!s.complete||s.error)).map(s=>s.id));
          for(const old of previous.installations)if(failed.has(old.sourceId)&&!snapshot.installations.some(p=>p.id===old.id))snapshot.installations.push({...old,canUpdate:false,updateState:'error',reason:'La fuente falló; se conserva la última lectura'});
        }
        if(previous && Date.now()-this.checked<300000){
          for(const row of snapshot.installations){
            const old=previous.installations.find(p=>p.id===row.id),source=snapshot.sources.find(s=>s.id===row.sourceId);
            if(old&&old.version===row.version&&source?.complete&&!source.error&&JSON.stringify(old.policy)===JSON.stringify(row.policy)){
              for(const key of ['canUpdate','updateState','reason','targetVersion','targetRevision','targetCommit'] as const)(row as any)[key]=old[key];
            }
          }
        }
        if(generation===this.generation){this.snapshot=snapshot;this.check();}
        return {...snapshot,checking:generation===this.generation&&!!this.updates};
      }).catch(error=>{if(!this.snapshot)throw error;return {...this.snapshot,error:error.message,checking:false};}).finally(()=>{if(this.flight===flight)this.flight=undefined;});
      this.flight=flight;
    }
    return this.flight;
  }
  private async read(updates:boolean):Promise<SoftwareSnapshot>{
    const cfg=await this.config(), integration=await this.integrationLoader(), users=[...new Set([HOST_USER,...(cfg.users||[])])];
    let combined:SoftwareSnapshot;
    for(const user of users){
      const value:SoftwareSnapshot=await this.run({action:'scan',user,settings:cfg.contexts?.[user]||{},integrations:integration,updates});
      if(!value?.ok||!Array.isArray(value.installations)||!Array.isArray(value.sources))throw new Error('Inventario inválido');
      if(!combined)combined=value;
      else {combined.installations=[...new Map([...combined.installations,...value.installations].map(p=>[p.id,p])).values()];combined.sources=[...new Map([...combined.sources,...value.sources].map(p=>[p.id,p])).values()];}
    }
    softwareIcons.learnNative(combined!.installations);
    for(const row of combined!.installations){
      row.iconInfo=softwareIcons.describe(row);
      row.iconUrl='/api/software/icons/'+encodeURIComponent(row.id)+'?v='+row.iconInfo.version;
      if(cfg.ignored?.includes(row.id)){row.canUpdate=false;row.updateState='held';row.reason='Retenido en la configuración local de AXON';}
    }
    return combined!;
  }
  private check(){
    if(this.updates||!this.snapshot||Date.now()-this.checked<300000)return;
    const generation=this.generation,previous=this.snapshot;
    const flight=this.read(true).then(async next=>{
      const failed=new Set(next.sources.filter(s=>!s.complete||s.updateState==='error').map(s=>s.id));
      for(const old of previous.installations)if(failed.has(old.sourceId)&&!next.installations.some(p=>p.id===old.id))next.installations.push({...old,canUpdate:false,updateState:'error',reason:'No se pudo comprobar esta fuente; se conserva la última lectura'});
      for(const row of next.installations)if(failed.has(row.sourceId)){row.canUpdate=false;row.updateState='error';row.reason=next.sources.find(s=>s.id===row.sourceId)?.error||'No se pudo comprobar esta fuente';}
      const globals=next.installations.filter(p=>['pnpm','bun'].includes(p.manager)&&!failed.has(p.sourceId)&&!['held','unmanaged'].includes(p.updateState));
      let cursor=0;
      await Promise.all(Array.from({length:Math.min(4,globals.length)},async()=>{
        while(cursor<globals.length){const row=globals[cursor++];
          try {const data=await this.metadata(row.packageName),candidate=registryCandidate(data,row);row.targetVersion=candidate||undefined;row.canUpdate=!!candidate&&!!row.version&&compareVersions(candidate,row.version)>0;row.updateState=!row.version||!/^\d+\.\d+\.\d+/.test(row.version)?'unmanaged':row.canUpdate?'available':'current';row.reason=candidate?'Sin actualizaciones permitidas por la política del gestor':'No hay versiones que cumplan la política de publicación';}
          catch(error:any){row.canUpdate=false;row.updateState='error';row.reason=error.message;}
        }
      }));
      for(const source of next.sources.filter(s=>['pnpm','bun'].includes(s.manager)&&!failed.has(s.id))){source.updateState=next.installations.some(p=>p.sourceId===source.id&&p.updateState==='error')?'error':'ok';if(source.updateState==='error')source.error='No se pudieron comprobar todas las versiones del registro';}
      if(generation===this.generation){this.snapshot=next;this.checked=Date.now();}
    }).catch(error=>{if(generation===this.generation){this.snapshot={...previous,error:error.message};this.checked=Date.now();}}).finally(()=>{if(this.updates===flight)this.updates=undefined;});
    this.updates=flight;
  }
  async settled(){await this.get();await this.updates;return {...this.snapshot!,checking:!!this.updates};}
  async plan(ids:string[]):Promise<SoftwarePlan>{
    if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string'))throw new Error('Seleccioná entre 1 y 200 instalaciones');
    await this.get(true);await this.updates;
    const snapshot=await this.get(),cfg=await this.config();
    if(snapshot.error)throw new Error('No se puede planificar con un inventario fallido');
    const items=[...new Set(ids)].map(id=>snapshot.installations.find(p=>p.id===id));
    if(items.some(p=>!p?.canUpdate))throw new Error('Alguna instalación no tiene una actualización gestionada disponible');
    const groups=new Map<string,SoftwareInstallation[]>();
    for(const item of items as SoftwareInstallation[]){const key=item.scope==='system'?HOST_USER:item.user;groups.set(key,[...(groups.get(key)||[]),item]);}
    const transactions:SoftwareTransaction[]=[];
    for(const [user,group] of groups){const value=await this.run({action:'plan',user,settings:cfg.contexts?.[user]||{},integrations:await this.integrationLoader(),hooks:cfg.hooks||{},items:group});transactions.push(...value.transactions);}
    const plan:SoftwarePlan={ok:true,id:randomUUID(),createdAt:Date.now(),expiresAt:Date.now()+600000,transactions};
    this.plans.set(plan.id!,{plan,config:cfg});for(const [id,saved] of this.plans)if(saved.plan.expiresAt!<Date.now())this.plans.delete(id);
    while(this.plans.size>100)this.plans.delete(this.plans.keys().next().value!);
    return plan;
  }
  async execute(id:string) {
    const saved=this.plans.get(id);if(!saved||saved.plan.expiresAt!<Date.now())throw new Error('El plan venció o no existe; generá uno nuevo');
    if(JSON.stringify(await this.config())!==JSON.stringify(saved.config))throw new Error('La configuración cambió; generá un plan nuevo');
    const steps:JobStep[]=[];
    for(const tx of saved.plan.transactions){
      const user=tx.scope==='user'?tx.user:HOST_USER;
      const command=await softwareCommand({action:'execute',user,settings:saved.config.contexts?.[user]||{},integrations:await this.integrationLoader(),hooks:saved.config.hooks||{},plan:{createdAt:saved.plan.createdAt,transactions:[tx]}});
      steps.push({label:tx.items.map(p=>p.name).join(', ')+' · verificar '+tx.manager,cmd:command,displayCommand:tx.argv.join(' '),user:'root',group:'software:'+tx.manager+':'+tx.user});
    }
    const job=runSoftwareJob('Actualizar '+saved.plan.transactions.reduce((n,tx)=>n+tx.items.length,0)+' instalaciones',steps);this.plans.delete(id);this.invalidate();return job;
  }
}
export const software=new SoftwareService();

export async function softwareInstallSpec(pkg:string,user=HOST_USER):Promise<string>{
 if(!validPackage(pkg))throw new Error('Identificador de paquete inválido');
 const snapshot=await software.settled(),source=snapshot.sources.find(s=>s.manager==='pnpm'&&s.user===user&&s.available&&s.complete&&!s.error);
 if(!source)throw new Error('No hay un ámbito pnpm comprobado para instalar este paquete');
 const candidate=registryCandidate(await registryMetadata(pkg),{packageName:pkg,version:null,policy:source.policy});
 if(!candidate)throw new Error('No hay una versión permitida por la política de publicación');
 return pkg+'@'+candidate;
}

// All write surfaces use this coordinator; the host executor also acquires
// process locks. A job is registered synchronously before another request runs.
export function runSoftwareJob(title:string,steps:JobStep[]) {
  if(runningJobs().some(j=>(j.title.startsWith('Tienda:')||j.steps.some(s=>s.group?.startsWith('software:')))))throw new Error('Hay otra operación de software en curso');
  software.invalidate();return runJob(title,steps.map(s=>({...s,group:s.group?.startsWith('software:')?s.group:'software:'+(s.group||'operation')})));
}

export async function softwareIcon(row:SoftwareInstallation,localFile?:string):Promise<Response>{
  const native=localFile || (row.iconFile?hostToContainer(row.iconFile):undefined);
  return softwareIcons.response(localFile?{...row,iconFile:localFile}:row,native||undefined);
}
export function registerSoftwareRoutes(app:Hono, service=software) {
  app.get('/api/software/icon-catalog',async c=>{c.header('Cache-Control','private, no-store');return c.json({ok:true,icons:softwareIcons.search(c.req.query('q')||''),status:softwareIcons.status()});});
  app.get('/api/software/icon-catalog/:id',async c=>{try{return await softwareIcons.catalogResponse(c.req.param('id'));}catch{return c.json({ok:false,error:'El icono no está disponible'},404);}});
  app.put('/api/software/icons/:id',async c=>{try{const row=(await service.get()).installations.find(p=>p.id===c.req.param('id'));if(!row)return c.json({ok:false,error:'Instalación desconocida'},404);const body=await c.req.json();if(body.catalogId!==null&&typeof body.catalogId!=='string')throw Error('Elegí un icono del catálogo');const iconInfo=softwareIcons.setChoice(row,body.catalogId);service.refreshIcons();(await import('./app-store')).invalidateStoreCache();return c.json({ok:true,iconInfo,iconUrl:'/api/software/icons/'+encodeURIComponent(row.id)+'?v='+iconInfo.version});}catch(e:any){return c.json({ok:false,error:e.message},400);}});
  app.post('/api/software/icons/:id/upload',bodyLimit({maxSize:1500000,onError:c=>c.json({ok:false,error:'El icono debe pesar menos de 1 MB'},413)}),async c=>{try{
    if(Number(c.req.header('content-length')||0)>1500000)return c.json({ok:false,error:'El icono debe pesar menos de 1 MB'},413);
    const row=(await service.get()).installations.find(p=>p.id===c.req.param('id'));if(!row)return c.json({ok:false,error:'Instalación desconocida'},404);
    const body=await c.req.json();if(typeof body.base64!=='string'||body.base64.length>1400000||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64))throw Error('Archivo inválido');
    const iconInfo=softwareIcons.upload(row,Buffer.from(body.base64,'base64'),body.format);service.refreshIcons();(await import('./app-store')).invalidateStoreCache();return c.json({ok:true,iconInfo,iconUrl:'/api/software/icons/'+encodeURIComponent(row.id)+'?v='+iconInfo.version});
  }catch(e:any){return c.json({ok:false,error:'No se pudo guardar el icono: '+e.message},400);}});
  app.get('/api/software/icons-status',async c=>{c.header('Cache-Control','private, no-store');return c.json({ok:true,...softwareIcons.status((await service.get()).installations)});});
  app.post('/api/software/icons-sync',async c=>{try{await softwareIcons.refresh();const result=await softwareIcons.warm((await service.get()).installations);service.invalidate();return c.json({ok:true,...result,...softwareIcons.status()});}catch(e:any){return c.json({ok:false,error:'No se pudieron renovar los iconos: '+e.message},503);}});
  app.get('/api/software',async c=>{softwareIcons.autoRefresh();try{return c.json(await service.get(c.req.query('fresh')==='1'));}catch(e:any){return c.json({ok:false,error:e.message},503);}});
  app.post('/api/software/plan',async c=>{try{const body=await c.req.json();return c.json({ok:true,plan:await service.plan(body.ids)});}catch(e:any){return c.json({ok:false,error:e.message},409);}});
  app.post('/api/software/execute',async c=>{try{const body=await c.req.json();return c.json({ok:true,job:await service.execute(body.planId)});}catch(e:any){return c.json({ok:false,error:e.message},409);}});
  app.post('/api/software/refresh-indices',async c=>{try{const snapshot=await service.get();if(!snapshot.canAdministerSystem||!snapshot.sources.some(s=>s.manager==='apt'&&s.available))throw new Error('No hay índices APT gestionables en este host');const cmd=await softwareCommand({action:'refresh',user:HOST_USER});return c.json({ok:true,job:runSoftwareJob('Actualizar índices APT',[{label:'Consultar repositorios sin instalar paquetes',cmd,user:'root',group:'software:apt'}])});}catch(e:any){return c.json({ok:false,error:e.message},409);}});
  app.get('/api/software/icons/:id',async c=>{const snapshot=await service.get(),row=snapshot.installations.find(p=>p.id===c.req.param('id'));return row?softwareIcon(row):c.json({ok:false,error:'Instalación desconocida'},404);});
}
