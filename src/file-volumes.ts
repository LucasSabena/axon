import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { boundedCommand, hostArgv } from './storage/host-argv';
import { MaintenanceError } from './storage/types';
import { HOST_USER, ON_HOST } from './host';
import { userInfo } from 'node:os';

export interface FileVolume {
  id: string; diskId: string; device: string; majorMinor: string; name: string; filesystem: string;
  uuid: string | null; size: number; available: number | null; external: boolean; path: string | null;
  mountId: string | null; readOnly: boolean; readable: boolean; canMount: boolean; used?: number | null;
}
export interface VolumeSnapshot { ok: true; devices: {id:string;name:string;device:string;size:number;external:boolean;transport:string|null}[]; volumes: FileVolume[]; path?: string }
type Runner = (request: Record<string, unknown>) => Promise<VolumeSnapshot | {ok:false;error:string}>;
export const volumeContains = (p: string, root: string) => root === '/' ? p.startsWith('/') : p === root || p.startsWith(root + '/');
export function volumeForPath(volumes: FileVolume[], p: string) {
  return volumes.filter(v => v.path && volumeContains(p,v.path)).sort((a,b) => b.path!.length-a.path!.length)[0];
}
// Keep mount aliases for path validation, but count each filesystem only once.
export function uniqueVolumes(volumes: FileVolume[]): FileVolume[] {
  const seen=new Set<string>();
  return [...volumes].sort((a,b)=>Number(b.path==='/')-Number(a.path==='/') || Number(!!b.path)-Number(!!a.path) || Number(!!a.path?.startsWith('/mnt/axon-disks/'))-Number(!!b.path?.startsWith('/mnt/axon-disks/'))).filter(v=>{
    const key=v.uuid ? `${v.uuid}:${v.majorMinor}` : v.device+':'+v.majorMinor;
    if(seen.has(key))return false;seen.add(key);return true;
  });
}

export class FileVolumes {
  private cached?: {at:number;value:VolumeSnapshot};
  private pending?: Promise<VolumeSnapshot>;
  private known = new Map<string, string>();
  private loaded=false;
  private writes=Promise.resolve();
  constructor(private run:Runner = async request => {
    const script = await readFile(new URL('./storage/volumes-host.py',import.meta.url),'utf8');
    const user=ON_HOST && HOST_USER==='root'?userInfo().username:HOST_USER;
    return JSON.parse(await boundedCommand(hostArgv('python3',['-c',script],user),JSON.stringify(request),undefined,30_000));
  },private mountRun:Runner=async request=>{
    const script=await readFile(new URL('./storage/volumes-host.py',import.meta.url),'utf8');
    // The only privileged action here is the helper's constrained mount branch.
    // All file transfers and inventory checks keep the regular host identity.
    const command=['python3','-c',script];
    const argv=ON_HOST?command:['nsenter','-t','1','-m','-u','-i','-n','-p','--',...command];
    return JSON.parse(await boundedCommand(argv,JSON.stringify({...request,user:HOST_USER}),undefined,30_000));
  },private registry?:string) {}
  async snapshot(fresh=false):Promise<VolumeSnapshot> {
    if(!fresh && this.cached && Date.now()-this.cached.at<3000)return this.cached.value;
    if(this.pending)return this.pending;
    const query = async () => {
      if(!this.loaded){this.loaded=true;if(this.registry)try{const saved=JSON.parse(await readFile(this.registry,'utf8'));for(const p of saved.paths||[])if(typeof p==='string'&&p.startsWith('/')&&p!=='/')this.known.set(p,'');}catch{/* first inventory */}}
      let result;
      try { result = await this.run({action:'list'}); }
      catch { throw new MaintenanceError('No se pudieron consultar los discos. Volvé a intentar.',503); }
      if(result.ok===false)throw new MaintenanceError(result.error,503);
      let changed=false;
      for(const v of result.volumes)if(v.path && v.path!=='/'){if(!this.known.has(v.path))changed=true;this.known.set(v.path,v.id+':'+v.mountId);}
      if(changed&&this.registry){const file=this.registry,data=JSON.stringify({paths:[...this.known.keys()]});this.writes=this.writes.then(async()=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',data,{mode:0o600});await rename(file+'.tmp',file);}).catch(()=>{});}
      await this.writes;
      this.cached={at:Date.now(),value:result};return result;
    };
    this.pending=query();
    try{return await this.pending;}finally{this.pending=undefined;}
  }
  async roots(p:string,fresh=false) {
    let result:VolumeSnapshot;
    try {result=await this.snapshot(fresh);}
    catch(e) {
      if(['/mnt','/media','/run/media',...this.known.keys()].some(root=>volumeContains(p,root)))throw e;
      return []; // existing internal navigation survives a disk-inventory outage
    }
    if(p.startsWith('/mnt/axon-disks/') && !result.volumes.some(v=>v.path?.startsWith('/mnt/axon-disks/') && volumeContains(p,v.path)))
      throw new MaintenanceError('El disco está sin montar o fue desconectado. Montalo desde la lista de discos.',409);
    for(const root of this.known.keys()) {
      if(volumeContains(p,root) && !result.volumes.some(v=>v.path===root))
        throw new MaintenanceError('El disco fue desconectado o cambió su montaje. Actualizá los discos antes de continuar.',409);
    }
    return result.volumes.filter(v=>v.path && v.path!=='/').map(v=>v.path!);
  }
  async validate(p:string,token:unknown) {
    if(token===undefined || token===null)return;
    if(typeof token!=='string')throw new MaintenanceError('Identidad de disco inválida',400);
    const volume=volumeForPath((await this.snapshot(true)).volumes,p);
    if(!volume || volume.id+':'+volume.mountId!==token)throw new MaintenanceError('El disco fue desconectado o cambió. Seleccioná nuevamente el origen y el destino.',409);
    // /tmp and other virtual submounts aren't separate physical disks in this
    // inventory. Their own fd identities are frozen by the transfer worker.
    return volume.path==='/'?undefined:volume.mountId;
  }
  async mount(id:string) {
    if(!/^[a-f0-9]{24}$/.test(id))throw new MaintenanceError('Disco inválido',400);
    const result=await this.mountRun({action:'mount',id});
    this.cached=undefined;
    if(result.ok===false)throw new MaintenanceError(result.error,409);
    const snapshot=await this.snapshot(true);
    return {...snapshot,path:result.path};
  }
}

export function fixtureVolumes(home:string):FileVolumes {
  return new FileVolumes(async()=>({ok:true,devices:[],volumes:[
    {id:'fixture-internal',diskId:'fixture',device:'fixture',majorMinor:'0:0',name:'Disco interno (prueba)',filesystem:'fixture',uuid:null,size:0,available:null,external:false,path:home,mountId:'fixture',readOnly:false,readable:true,canMount:false},
    {id:'fixture-external',diskId:'fixture-external',device:'fixture-external',majorMinor:'0:1',name:'Disco externo (prueba)',filesystem:'fixture',uuid:null,size:0,available:null,external:true,path:home+'/external-drive',mountId:'fixture-external',readOnly:false,readable:true,canMount:false},
  ]}));
}
