import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { VolumeSnapshot } from '../file-volumes';
import { MaintenanceError } from './types';

export function visibilityKey(kind: 'disk'|'volume', item: {uuid?:string|null;partuuid?:string|null;serial?:string|null;wwn?:string|null;device:string;majorMinor?:string}) {
  const identity=kind==='disk'?(item.wwn||item.serial||item.device):(item.partuuid||item.uuid||item.device);
  return kind+':'+createHash('sha256').update(identity).digest('hex');
}
export function technicalVolume(v: {path:string|null;parttype?:string|null}) {
  return !!(v.path&&/^\/(boot|efi)(\/|$)/.test(v.path))||['c12a7328-f81f-11d2-ba4b-00a0c93ec93b','21686148-6449-6e6f-744e-656564454649'].includes(v.parttype?.toLowerCase()||'');
}
/** Presentation only: never filter the inventory used to validate host paths. */
export class DiskVisibility {
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private file:string){}
  private async read():Promise<Record<string,boolean>> {
    try {const r=JSON.parse(await readFile(this.file,'utf8'));if(r.version!==1||!r.overrides||typeof r.overrides!=='object'||Array.isArray(r.overrides)||Object.entries(r.overrides).some(([k,v])=>! /^(disk|volume):[a-f0-9]{64}$/.test(k)||typeof v!=='boolean'))throw new Error();return r.overrides;}
    catch(e:any){if(e?.code==='ENOENT')return {};throw new MaintenanceError('No se pudo leer la visibilidad de los discos. Se conservó la configuración.',503);}
  }
  async apply(snapshot:VolumeSnapshot):Promise<VolumeSnapshot>{
    const saved=await this.read();
    const devices=snapshot.devices.map(d=>{const key=visibilityKey('disk',d);return {...d,visibilityKey:key,hidden:saved[key]??false};});
    return {...snapshot,devices,volumes:snapshot.volumes.map(v=>{const key=visibilityKey('volume',v),technical=technicalVolume(v);return {...v,visibilityKey:key,technical,hidden:(devices.find(d=>d.id===v.diskId)?.hidden||false)||(saved[key]??technical)};})};
  }
  async set(key:string,hidden:boolean,snapshot:VolumeSnapshot){
    if(typeof hidden!=='boolean'||![...snapshot.devices.map(d=>visibilityKey('disk',d)),...snapshot.volumes.map(v=>visibilityKey('volume',v))].includes(key))throw new MaintenanceError('El disco cambió. Actualizá la lista antes de cambiar su visibilidad.',409);
    const write=async()=>{const overrides=await this.read();overrides[key]=hidden;await mkdir(path.dirname(this.file),{recursive:true});const temp=this.file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({version:1,overrides}),{mode:0o600});await rename(temp,this.file);};
    const job=this.queue.then(write);this.queue=job.catch(()=>{});await job;
  }
}
