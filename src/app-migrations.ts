import type { Hono } from 'hono';
import { MaintenanceRepository } from './storage/repository';
import { MaintenanceError } from './storage/types';
import { protect, body, only, textField } from './storage/http';
import { hash } from './storage/policy';
import type {MigrationRetirement} from './migration-retirement';
import type {HomepageMigration} from './homepage-migration';
import {actor} from './storage/http';
import type { Installation } from './installation-inventory';
export const MIGRATIONS={
  homepage:{title:'Homepage',route:'/',coverage:['Accesos, grupos, favoritos, búsqueda, importación revisada y exportación'],gaps:['Comparar todos los accesos y widgets en uso','Probar cada acceso con su autenticación','Resolver dominios y dependientes; preparar rollback del servicio']},
  filebrowser:{title:'Filebrowser',route:'/archivos',coverage:['Editor con revisión, subidas por bloques, Biblioteca y enlaces compartidos existentes'],gaps:['Auditar usuarios, roots, permisos granulares y shares de Filebrowser','Verificar los roots y shares personales con copy/move durable y recuperación','Probar envío y restauración XDG con los permisos reales de esta instalación','Conservar originales y datos de Filebrowser para rollback']},
  portainer:{title:'Portainer',route:'/compose',coverage:['Docker local, estado, logs y Compose existente; borrador separado'],gaps:['Auditar endpoints remotos, RBAC, Swarm y stacks en uso','Verificar perfiles, overrides, env files y recuperación de imágenes','Probar la aplicación y recuperación del stack real; fixtures de archivo único verificadas','Un backup del panel no respalda datos de sus aplicaciones']},
} as const;
type AppId=keyof typeof MIGRATIONS;
export interface MigrationRecord { app:AppId;at:string;state:'detected'|'compared'|'imported'|'verified'|'ready'|'retired'|'data-pending';revision:string;installations:Installation[];gaps:string[];evidence:{at:string;check:string;result:'pending'|'passed'|'failed';source:'user'}[];diskSavingsBytes:null;importReceipt?:string;retirementReceipt?:string }
export class Migrations {
  constructor(readonly repo:MaintenanceRepository,private inventory:()=>Promise<Installation[]> ){}
  list(){return Object.entries(MIGRATIONS).map(([app,def])=>({...def,app,record:this.repo.get<MigrationRecord>('migration',app)||null}));}
  async compare(app:AppId){
    const all=await this.inventory();const matches=all.filter(i=>i.container&&(i.name.toLowerCase()===app||i.container.service.toLowerCase()===app||i.container.image.toLowerCase().includes('/'+app+':')));
    const previous=this.repo.get<MigrationRecord>('migration',app);
    const revision=hash(matches);const record:MigrationRecord={app,at:new Date().toISOString(),state:previous?.revision===revision?previous.state:'compared',importReceipt:previous?.revision===revision?previous.importReceipt:undefined,retirementReceipt:previous?.retirementReceipt,revision,installations:matches,gaps:[...MIGRATIONS[app].gaps,...(!matches.length?['No se identificó una instalación inequívoca. Ausencia no demuestra retirada.']:[])],evidence:previous?.revision===revision?previous.evidence:[],diskSavingsBytes:null};
    if(previous?.retirementReceipt&&!matches.length&&this.repo.get<{status:{state:string}}>('compose-release',previous.retirementReceipt)?.status.state==='verified')record.state='data-pending';
    this.repo.put('migration',app,record);return record;
  }
  evidence(app:AppId,revision:unknown,check:unknown,result:unknown){
    const record=this.repo.get<MigrationRecord>('migration',app);if(!record||revision!==record.revision)throw new MaintenanceError('Compará nuevamente la instalación antes de registrar una prueba');
    if(typeof check!=='string'||!record.gaps.includes(check)||!['pending','passed','failed'].includes(String(result)))throw new MaintenanceError('Prueba no válida',400);
    // A reported check is evidence, never implicit authorization to retire a service.
    record.evidence=record.evidence.filter(e=>e.check!==check);record.evidence.push({at:new Date().toISOString(),check,result:result as 'pending',source:'user'});record.state=record.gaps.every(g=>record.evidence.some(e=>e.check===g&&e.result==='passed'))&&record.installations.length===1?'verified':record.importReceipt?'imported':'compared';this.repo.put('migration',app,record);return record;
  }
}
export function registerMigrationRoutes(app:Hono,service:Migrations,inventory:()=>Promise<Installation[]>,homepage?:HomepageMigration,retirement?:MigrationRetirement){
  protect(app,'/api/maintenance');
  app.post('/api/maintenance/migrations/homepage/import-preview',async c=>{only(await body(c),[]);if(!homepage)throw new MaintenanceError('Importación automática no disponible',503);return c.json({ok:true,plan:await homepage.preview(actor(c))});});
  app.post('/api/maintenance/migrations/homepage/import/:id',async c=>{const b=await body(c);only(b,['digest']);if(!homepage)throw new MaintenanceError('Importación no disponible',503);return c.json({ok:true,receipt:await homepage.execute(c.req.param('id'),textField(b.digest),actor(c))});});
  app.post('/api/maintenance/migrations/:app/retirement-plans',async c=>{only(await body(c),[]);const id=c.req.param('app');if(!Object.hasOwn(MIGRATIONS,id))throw new MaintenanceError('Aplicación no admitida',400);if(!retirement)throw new MaintenanceError('Retirada no disponible en este contexto',503);return c.json({ok:true,operation:await retirement.prepare(id as AppId,actor(c))});});
  app.get('/api/maintenance/retirements/:id',async c=>{if(!retirement)throw new MaintenanceError('Motor no disponible',503);return c.json({ok:true,operation:await retirement.status(c.req.param('id'),actor(c))});});
  app.post('/api/maintenance/retirements/:id/:action',async c=>{const b=await body(c);only(b,['digest']);if(!retirement)throw new MaintenanceError('Motor no disponible',503);const action=c.req.param('action');if(!['apply','rollback'].includes(action))throw new MaintenanceError('Acción desconocida',400);return c.json({ok:true,operation:await retirement.apply(c.req.param('id'),textField(b.digest),actor(c),action==='rollback')},202);});
  app.get('/api/maintenance/installations',async c=>c.json({ok:true,installations:await inventory(),coverage:'Instalaciones físicas de programas registrados, Docker, Flatpak system/user y AppImage en ubicaciones conocidas. Gestores y rutas no resueltos permanecen marcados; no se infiere paridad ni ausencia.'}));
  app.get('/api/maintenance/migrations',c=>c.json({ok:true,apps:service.list()}));
  app.post('/api/maintenance/migrations/:app/compare',async c=>{only(await body(c),[]);const id=c.req.param('app');if(!Object.hasOwn(MIGRATIONS,id))throw new MaintenanceError('Aplicación no admitida',400);return c.json({ok:true,record:await service.compare(id as AppId)});});
  app.post('/api/maintenance/migrations/:app/evidence',async c=>{const b=await body(c);only(b,['revision','check','result']);const id=c.req.param('app');if(!Object.hasOwn(MIGRATIONS,id))throw new MaintenanceError('Aplicación no admitida',400);return c.json({ok:true,record:service.evidence(id as AppId,b.revision,b.check,b.result)});});
  app.get('/api/maintenance/migrations/export',c=>{c.header('Content-Disposition','attachment; filename="axon-migraciones.json"');return c.json({version:1,apps:service.list()});});
}
