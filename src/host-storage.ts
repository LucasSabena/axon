import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { FileVolumes, fixtureVolumes, volumeContains, uniqueVolumes } from './file-volumes';
import { HOST_USER, hostToContainer, containerToHost, readHostFile } from './host';
import { MaintenanceError } from './storage/types';

export let hostVolumes = new FileVolumes(undefined,undefined,path.join(path.dirname(process.env.CONFIG_PATH||'/app/data/config.json'),'volume-mounts.json'));
let fixtureRoot:string|undefined;
export function initHostStorage(qa?:string,volumes?:FileVolumes){fixtureRoot=qa;hostVolumes=volumes||(qa?fixtureVolumes(qa):new FileVolumes(undefined,undefined,path.join(path.dirname(process.env.CONFIG_PATH||'/app/data/config.json'),'volume-mounts.json')));}
const ROOTS=['/home','/etc','/var','/opt','/srv','/tmp','/mnt','/media','/run/media','/data','/boot','/usr'];
let accountHome:{user:string;path:string}|undefined;
export async function hostHome(){
  if(fixtureRoot)return fixtureRoot;
  if(accountHome?.user===HOST_USER)return accountHome.path;
  const record=(await readHostFile('/etc/passwd')).split('\n').map(l=>l.split(':')).find(r=>r[0]===HOST_USER);
  const home=record?.[5]?.startsWith('/')?record[5]:(HOST_USER==='root'?'/root':`/home/${HOST_USER}`);
  accountHome={user:HOST_USER,path:home};return home;
}

// One mount-aware policy for every user-selected host path. Root is browsable
// exactly; virtual kernel trees never become writable just because / is a disk.
export async function resolveHostPath(input:string,options:{roots?:string[];root?:boolean;directory?:boolean;fresh?:boolean}={}){
  if(typeof input!=='string'||input.includes('\0')||input.length>4096)throw new MaintenanceError('Ruta inválida',400);
  const home=await hostHome();
  let raw=input.trim();if(raw==='~')raw=home;else if(raw.startsWith('~/'))raw=home+raw.slice(1);
  if(!raw.startsWith('/'))throw new MaintenanceError('La ruta debe ser absoluta',400);
  const p=path.posix.resolve(raw),mounted=await hostVolumes.roots(p,options.fresh);
  const roots=fixtureRoot?[fixtureRoot]:(options.roots||[home,...ROOTS,...mounted]);
  const inside=(q:string)=>(options.root&&q==='/'&&!fixtureRoot)||roots.some(r=>volumeContains(q,r));
  if(!inside(p))throw new MaintenanceError('Ruta fuera de los directorios permitidos',403);
  let probe=p;const tail:string[]=[];
  while(true){
    let real:string;
    try{real=containerToHost(await realpath(hostToContainer(probe)));}
    catch(e:any){if(!['ENOENT','ENOTDIR'].includes(e?.code))throw new MaintenanceError('No se puede acceder a la carpeta',403);const parent=path.posix.dirname(probe);if(parent===probe)throw new MaintenanceError('No existe la ruta',400);tail.unshift(path.posix.basename(probe));probe=parent;continue;}
    const full=path.posix.join(real,...tail);
    if(!inside(full))throw new MaintenanceError('Ruta fuera de los directorios permitidos',403);
    await hostVolumes.roots(full);
    if(options.directory&&!(await stat(hostToContainer(full)).catch(()=>null))?.isDirectory())throw new MaintenanceError('No existe la carpeta seleccionada',400);
    return full;
  }
}
export async function availableStorage(){const snapshot=await hostVolumes.snapshot();return {...snapshot,disks:uniqueVolumes(snapshot.volumes)};}
// Discovery stays bounded and skips duplicate mount aliases. Library still
// indexes only the folders the user selects, never an entire disk by surprise.
export async function projectSearchRoots(configured:string[]=[]){
  const home=await hostHome();
  const candidates=[...(configured.length?configured:[home+'/Proyectos',home+'/server-stack']),...(await availableStorage().catch(()=>({disks:[]}))).disks.filter(v=>v.path&&v.path!=='/').map(v=>v.path!)];
  const roots:string[]=[];const identities=new Set<string>();
  for(const p of candidates)try{const full=await resolveHostPath(p,{directory:true});const s=await stat(hostToContainer(full));const key=s.dev+':'+s.ino;if(!identities.has(key)){identities.add(key);roots.push(full);}}catch{/* disconnected or unreadable roots keep their saved configuration */}
  return roots;
}
