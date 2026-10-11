import { readFile } from 'node:fs/promises';
import { HOST_USER, ON_HOST } from '../host';
import { boundedCommand } from './host-argv';
import { MaintenanceError, type Actor } from './types';
import type { Hono } from 'hono';
import { actor, body, only, protect, textField } from './http';
import { hostVolumes, diskVisibility } from '../host-storage';

export interface DiskPartition {id:string;number:number;device:string;majorMinor:string;size:number;startBytes:number;filesystem:string|null;name:string;uuid:string|null;partuuid:string|null;parttype?:string|null;technical:boolean;readOnly:boolean;mounts:{path:string;namespace:string;id:string;root:string}[];hidden?:boolean;visibilityKey?:string}
export interface ManagedDisk {id:string;device:string;byId:string|null;name:string;serial:string;wwn:string;size:number;table:string|null;external:boolean;appendableBytes?:number;partitions:DiskPartition[];canEdit:boolean;editReason:string;blockers:string[];hidden?:boolean;visibilityKey?:string;identity?:unknown;revision?:string}
export interface DiskInventory {ok:true;disks:ManagedDisk[];formats:{id:string;name:string;description:string;available:boolean}[];canPartition:boolean;canAutoMount?:boolean;privileged:boolean;fixture?:boolean}
export interface DiskSpec {diskId:string;operation:string;partitionId?:string;partitions?:{name:string;filesystem:string;sizeMiB:number|null}[];name?:string;filesystem?:string;autoMount?:boolean}
export interface DiskOperation {id:string;state:string;createdAt:number;expiresAt:number;diskId:string;diskName:string;device:string;serial:string;digest:string;confirmation:string;spec:DiskSpec;steps:{at:number;message:string}[];message:string;paths?:string[];fixture?:boolean}
export type DiskRunner=(request:Record<string,unknown>)=>Promise<any>;
export class DiskManager {
  constructor(private run:DiskRunner=async request=>{
    const source=await readFile(new URL('./disks-host.py',import.meta.url),'utf8');
    const command=['python3','-c',source];
    const argv=ON_HOST?command:['nsenter','-t','1','-m','-u','-i','-n','-p','--',...command];
    try{return JSON.parse(await boundedCommand(argv,JSON.stringify({...request,user:HOST_USER}),undefined,45_000));}
    catch{throw new MaintenanceError('El servicio de discos no respondió. Comprobá el historial antes de volver a intentar.',503);}
  }){}
  private async request(b:Record<string,unknown>,a?:Actor){const r=await this.run({...b,...(a?{actor:a.actorId+':'+a.sessionId}:{})});if(r?.ok!==true)throw new MaintenanceError(r?.error||'El servicio de discos devolvió una respuesta inválida.',409);return r;}
  async inventory():Promise<DiskInventory>{return this.request({action:'inventory'});}
  async plan(spec:DiskSpec,a:Actor):Promise<{ok:true;plan:DiskOperation}>{return this.request({action:'plan',...spec},a);}
  async start(id:string,digest:string,confirmation:string,a:Actor):Promise<{ok:true;operation:DiskOperation}>{return this.request({action:'start',id,digest,confirmation},a);}
  async status(id:string,a:Actor):Promise<{ok:true;operation:DiskOperation}>{return this.request({action:'status',id},a);}
  async history(a:Actor):Promise<{ok:true;operations:DiskOperation[]}>{return this.request({action:'history'},a);}
}
/** Never invoke host helpers in QA; the demo only changes its own in-memory inventory. */
export function fixtureDiskRunner():DiskRunner{
  const store=new Map<string,{actor:string;plan:DiskOperation}>();
  const disks:ManagedDisk[]=[
    {id:'fixture-system',device:'/dev/fixture-system',byId:null,name:'Disco del sistema (prueba)',serial:'QA-SYSTEM',wwn:'',size:256*2**30,table:'gpt',external:false,canEdit:false,editReason:'Disco del sistema: sólo se puede cambiar su visibilidad.',blockers:['Disco del sistema protegido.'],partitions:[{id:'fixture-efi',number:1,device:'/dev/fixture-efi',majorMinor:'0:3',size:512*2**20,startBytes:2**20,filesystem:'vfat',name:'EFI',uuid:'qa-efi',partuuid:'qa-efi-part',technical:true,readOnly:false,mounts:[{path:'/boot/efi',namespace:'fixture',id:'efi',root:'/'}]}]},
    {id:'fixture-new',device:'/dev/fixture-new',byId:'/dev/disk/by-id/fixture-new',name:'Disco nuevo (prueba)',serial:'QA-NEW-001',wwn:'',size:100*2**30,table:null,external:true,partitions:[],canEdit:true,editReason:'',blockers:[]}
  ];
  return async request=>{
    const inventory=()=>({ok:true,fixture:true,privileged:true,canPartition:true,disks:structuredClone(disks),formats:[{id:'ext4',name:'ext4',description:'Para el servidor Linux; conserva permisos y enlaces.',available:true},{id:'exfat',name:'exFAT',description:'Para compartir con Windows y macOS; sin permisos Linux ni enlaces.',available:true}]});
    if(request.action==='inventory')return inventory();
    if(request.action==='history')return {ok:true,operations:[...store.values()].filter(v=>v.actor.split(':')[0]===String(request.actor).split(':')[0]).map(v=>v.plan).sort((a,b)=>b.createdAt-a.createdAt)};
    if(request.action==='plan'){
      const d=disks.find(d=>d.id===request.diskId);if(!d||!d.canEdit)return {ok:false,error:'El disco está protegido o cambió.'};
      if(!['layout','append','format','delete','mount','unmount','configure'].includes(String(request.operation)))return {ok:false,error:'Operación inválida.'};
      const {action,actor,...spec}=request;
      const p:DiskOperation={id:crypto.randomUUID().replaceAll('-',''),state:'planned',createdAt:Date.now()/1000,expiresAt:Date.now()/1000+600,diskId:d.id,diskName:d.name,device:d.device,serial:d.serial,digest:crypto.randomUUID(),confirmation:['layout','format','delete'].includes(String(spec.operation))?'BORRAR '+d.serial:'CONFIRMAR',spec:{...spec,partitions:spec.partitions||[]} as unknown as DiskSpec,steps:[],message:'Simulación: no se modifica ningún disco real.',fixture:true};store.set(p.id,{actor:String(actor),plan:p});return {ok:true,plan:p};
    }
    const saved=store.get(String(request.id));if(!saved||(request.action==='status'?saved.actor.split(':')[0]!==String(request.actor).split(':')[0]:saved.actor!==request.actor))return {ok:false,error:'Operación de otra sesión o no disponible.'};
    const p=saved.plan;
    if(request.action==='start'){
      if(p.state!=='planned'||p.digest!==request.digest||p.confirmation!==request.confirmation||p.expiresAt<Date.now()/1000)return {ok:false,error:'La revisión venció, cambió o ya fue utilizada.'};
      p.state='verified';p.message='Simulación finalizada. No se modificó ningún disco real.';p.steps.push({at:Date.now()/1000,message:p.message});
      return {ok:true,operation:p};
    }
    if(request.action==='status')return {ok:true,operation:p};return {ok:false,error:'Acción inválida.'};
  };
}
export function registerDiskRoutes(app:Hono,manager:DiskManager){
  protect(app,'/api/storage/disks');
  app.get('/api/storage/disks',async c=>{
    const [data,volumes]=await Promise.all([manager.inventory(),diskVisibility.apply(await hostVolumes.snapshot(true))]);
    // Keep all partitions for management, decorate with the same presentation policy as Files.
    const disks=data.disks.map(d=>{const physical=volumes.devices.find(v=>v.device===d.device);return {...d,identity:undefined,revision:undefined,visibilityKey:physical?.visibilityKey,hidden:physical?.hidden||false,partitions:d.partitions.map(p=>{const v=volumes.volumes.find(v=>v.device===p.device);return {...p,visibilityKey:v?.visibilityKey,hidden:v?.hidden??p.technical};})};});
    return c.json({...data,disks,volumes});
  });
  app.post('/api/storage/disks/visibility',async c=>{const b=await body(c);only(b,['key','hidden']);if(typeof b.hidden!=='boolean')throw new MaintenanceError('Visibilidad inválida',400);await diskVisibility.set(textField(b.key),b.hidden,await hostVolumes.snapshot(true));return c.json({ok:true});});
  app.post('/api/storage/disks/plans',async c=>{const b=await body(c);only(b,['diskId','operation','partitionId','partitions','name','filesystem','autoMount']);textField(b.diskId);textField(b.operation);if(b.autoMount!==undefined&&typeof b.autoMount!=='boolean')throw new MaintenanceError('Montaje automático inválido',400);return c.json(await manager.plan(b as unknown as DiskSpec,actor(c)),201);});
  app.post('/api/storage/disks/plans/:id/execute',async c=>{const b=await body(c);only(b,['digest','confirmation']);return c.json(await manager.start(textField(c.req.param('id')),textField(b.digest),textField(b.confirmation),actor(c)),202);});
  app.get('/api/storage/disks/operations/:id',async c=>c.json(await manager.status(textField(c.req.param('id')),actor(c))));
  app.get('/api/storage/disks/history',async c=>c.json(await manager.history(actor(c))));
}
