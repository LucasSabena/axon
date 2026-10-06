import {load,dump,JSON_SCHEMA} from 'js-yaml';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {hostToContainer} from './host';
import {Migrations,type MigrationRecord} from './app-migrations';
import {ComposeDrafts} from './compose-drafts';
import {ComposeReleases} from './compose-releases';
import {hash} from './storage/policy';
import {MaintenanceError,type Actor} from './storage/types';
export class MigrationRetirement {
 constructor(private migrations:Migrations,private drafts:ComposeDrafts,private releases:ComposeReleases){releases.onBeforeExecute(async(id,rollback)=>{const binding=migrations.repo.get<{app:'homepage'|'filebrowser'|'portainer';installationRevision:string}>('retirement-binding',id);if(binding&&!rollback){const r=await migrations.compare(binding.app);if(r.revision!==binding.installationRevision||!r.gaps.every(g=>r.evidence.some(e=>e.check===g&&e.result==='passed')))throw new MaintenanceError('Cambió la instalación o una prueba necesaria; prepará una revisión nueva');}});}
 async prepare(app:'homepage'|'filebrowser'|'portainer',actor:Actor){
  const r=await this.migrations.compare(app);
  if(r.state!=='verified'||!r.gaps.every(g=>r.evidence.some(e=>e.check===g&&e.result==='passed')))throw new MaintenanceError('Primero compará y registrá las pruebas de funciones, dependientes y recuperación. No se detuvo ningún servicio.');
  if(r.installations.length!==1)throw new MaintenanceError('La instalación seleccionada no es inequívoca');
  const i=r.installations[0],c=i.container;
  if(!c?.project||!c.service||c.configFiles.length!==1)throw new MaintenanceError('Origen docker run, Portainer u overrides no reconstruible. Se mantiene la app hasta preparar una migración específica.');
  if(c.service==='axon'||c.id===process.env.HOSTNAME)throw new MaintenanceError('Axon no puede retirarse a sí mismo');
  const file=c.configFiles[0];if(this.drafts.get(file))throw new MaintenanceError('Hay un borrador pendiente de ese Compose; revisalo antes de preparar la retirada');
  const handle=await open(hostToContainer(file),constants.O_RDONLY|constants.O_NOFOLLOW);let source:string;
  try{const s=await handle.stat();if(!s.isFile()||s.size>262144)throw new MaintenanceError('Configuración no compatible');source=await handle.readFile('utf8');}finally{await handle.close();}
  const doc=load(source,{schema:JSON_SCHEMA}) as {services:Record<string,any>};if(!doc?.services?.[c.service])throw new MaintenanceError('El servicio no pertenece al archivo actual');
  for(const [name,s] of Object.entries(doc.services)){if(name===c.service)continue;const deps=s.depends_on;if(Array.isArray(deps)&&deps.includes(c.service)||deps&&typeof deps==='object'&&Object.hasOwn(deps,c.service))throw new MaintenanceError('Otro servicio depende de la selección; resolvé esa dependencia antes de retirar');}
  delete doc.services[c.service];if(!Object.keys(doc.services).length)throw new MaintenanceError('Retirar el último servicio requiere archivar el stack completo con otro plan');
  const content=dump(doc,{noRefs:true,lineWidth:120});this.drafts.save(file,content,source,hash(source));
  try{
   const operation=await this.releases.prepare(file,actor,c.service);
   this.migrations.repo.put('retirement-binding',operation.id,{app,installationRevision:r.revision});r.state='ready';r.retirementReceipt=operation.id;this.migrations.repo.put('migration',app,r);return operation;
  }catch(e){const draft=this.drafts.get(file);if(draft?.revision===hash(content))this.drafts.discard(file,draft.revision);throw e;}
 }
 async apply(id:string,digest:string,actor:Actor,rollback=false){
  const binding=this.migrations.repo.get<{app:'homepage'|'filebrowser'|'portainer';installationRevision:string}>('retirement-binding',id);if(!binding)throw new MaintenanceError('Plan de retirada no encontrado',404);
  if(!rollback){const latest=await this.migrations.compare(binding.app);if(latest.revision!==binding.installationRevision)throw new MaintenanceError('La instalación cambió; prepará una comparación nueva');}
  return this.releases.execute(id,digest,actor,rollback);
 }
 async status(id:string,actor:Actor){
  const op=await this.releases.status(id,actor),binding=this.migrations.repo.get<{app:'homepage'|'filebrowser'|'portainer'}>('retirement-binding',id);
  if(binding){const record=this.migrations.repo.get<MigrationRecord>('migration',binding.app);if(record){if(op.state==='verified'){record.state='data-pending';record.retirementReceipt=id;}else if(op.state==='restored')record.state='compared';this.migrations.repo.put('migration',binding.app,record);}}
  return op;
 }
}
