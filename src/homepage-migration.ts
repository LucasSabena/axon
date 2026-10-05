import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {hostToContainer} from './host';
import {HomeLinks,importHomepage,type HomeLink} from './home-links';
import {hash} from './storage/policy';
import type {Actor} from './storage/types';
import {MaintenanceError} from './storage/types';
import type {Migrations,MigrationRecord} from './app-migrations';
interface Source {file:string;revision:string;links:HomeLink[];skipped:number}
interface Plan extends Actor {id:string;digest:string;expiresAt:string;installationRevision:string;linkRevision:string;sources:Source[]}
export async function homepageSources(record:MigrationRecord):Promise<Source[]>{
 if(record.installations.length!==1)throw new MaintenanceError('Se necesita una única instalación de Homepage identificada');
 const mounts=record.installations[0].container?.mounts.filter(m=>m.destination==='/app/config'&&m.type==='bind')||[];
 if(mounts.length!==1)throw new MaintenanceError('Montaje de configuración no identificado; usá la importación manual en Inicio');
 const root=hostToContainer(mounts[0].source),sources:Source[]=[];
 if(await realpath(root)!==root)throw new MaintenanceError('El montaje usa enlaces no certificados; importá un archivo revisado manualmente');
 for(const file of ['services.yaml','bookmarks.yaml']){
  let handle:Awaited<ReturnType<typeof open>>|undefined;
  try{handle=await open(path.join(root,file),constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();if(!stat.isFile()||stat.size>250000)throw new MaintenanceError('Configuración no legible o demasiado grande');const content=await handle.readFile('utf8');const result=importHomepage(content);sources.push({file,revision:createHash('sha256').update(content).digest('hex'),links:result.links,skipped:result.skipped});}
  catch(e:any){if(e.code!=='ENOENT')throw e;}finally{await handle?.close();}
 }
 if(!sources.length)throw new MaintenanceError('No se encontraron archivos compatibles. No se importó ni descartó contenido.');return sources;
}
export class HomepageMigration {
 constructor(private migrations:Migrations,private links:HomeLinks,private sources=homepageSources){}
 async preview(actor:Actor){
  const record=await this.migrations.compare('homepage'),sources=await this.sources(record);
  const plan:Plan={...actor,id:crypto.randomUUID(),digest:'',expiresAt:new Date(Date.now()+300000).toISOString(),installationRevision:record.revision,linkRevision:this.links.get().revision,sources};plan.digest=hash({...plan,digest:undefined});this.migrations.repo.put('homepage-import-plan',plan.id,plan);
  return {id:plan.id,digest:plan.digest,expiresAt:plan.expiresAt,sources:sources.map(({revision,...s})=>s),warnings:['Se importan nombre, grupo y URL sin credenciales ni parámetros. Se omiten widgets. Los accesos personalizados ya existentes se conservan.']};
 }
 async execute(id:string,digest:string,actor:Actor){
  const repo=this.migrations.repo,p=repo.get<Plan>('homepage-import-plan',id);
  if(!p||p.actorId!==actor.actorId||p.sessionId!==actor.sessionId||p.digest!==digest||hash({...p,digest:undefined})!==digest)throw new MaintenanceError('La revisión no corresponde a esta sesión',403);
  const prior=repo.get('homepage-import-receipt',id);if(prior)return prior;
  if(Date.parse(p.expiresAt)<Date.now())throw new MaintenanceError('La revisión venció');
  const record=await this.migrations.compare('homepage');if(record.revision!==p.installationRevision)throw new MaintenanceError('La instalación cambió; compará nuevamente');
  const sources=await this.sources(record);if(hash(sources)!==hash(p.sources))throw new MaintenanceError('Cambió una configuración. Volvé a revisar antes de importar');
  return repo.db.transaction(()=>{const imported=this.links.importLinks(sources.flatMap(s=>s.links),p.linkRevision);record.state='imported';record.importReceipt=id;repo.put('migration','homepage',record);const result={state:'imported',count:imported.links.length,skipped:sources.reduce((sum,s)=>sum+s.skipped,0),message:'Accesos importados. Revisá widgets omitidos, autenticación y dependientes antes de retirar Homepage.'};repo.put('homepage-import-receipt',id,result,'verified');return result;}).immediate();
 }
}
