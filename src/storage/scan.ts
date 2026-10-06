import { availableStorage } from '../host-storage';
import { readFile,lstat } from 'node:fs/promises';
import path from 'node:path';
import { HOST_USER, readHostFile,hostToContainer } from '../host';
import { hostArgv, boundedCommand } from './host-argv';
import type { ScanRoot, ScanResult } from './types';
export async function scanRoot(root: ScanRoot, exclusions: string[], signal?: AbortSignal, runner=hostArgv): Promise<ScanResult> {
  const script=await readFile(new URL('./scan-host.py',import.meta.url),'utf8');
  const data=JSON.stringify({root,exclusions});
  const out=await boundedCommand(runner('python3',['-c',script]),data,signal);
  const result=JSON.parse(out) as ScanResult;
  if(!Array.isArray(result.candidates)||!Array.isArray(result.mounts)||!result.metrics)throw new Error('Inventario no válido');
  return result;
}
let storeCache:{path?:string;at:number}|undefined;
export async function scanRoots(projects: {cwd:string;name:string}[]=[]): Promise<ScanRoot[]> {
  const account=(await readHostFile('/etc/passwd')).split('\n').map(x=>x.split(':')).find(x=>x[0]===HOST_USER);
  if(!account?.[5]?.startsWith('/')||account[0]==='root')throw new Error('Configurá un usuario del host no privilegiado para analizar');
  const home=account[5];
  let pnpmStore:string|undefined;
  if(storeCache&&Date.now()-storeCache.at<300000)pnpmStore=storeCache.path;
  else try{const script=await readFile(new URL('./versions-host.py',import.meta.url),'utf8'),result=JSON.parse(await boundedCommand(hostArgv('python3',['-c',script]),JSON.stringify({only:'pnpm'})));pnpmStore=result.storePath;storeCache={path:pnpmStore,at:Date.now()};}catch{storeCache={at:Date.now()};}
  const defs:[string,string,string,string,number?][]=[
    ['home',home,'Carpetas del usuario (primer nivel)','review',0],
    ['xdg',path.join(home,'.local/share/Trash/files'),'Papelera del escritorio','trash-xdg'],
    ['legacy',path.join(home,'.local/share/axon-trash'),'Papelera de Axon','trash-legacy'],
    ['apt','/var/cache/apt/archives','Descargas APT','packages'],
    ['pip',path.join(home,'.cache/pip'),'Caché pip','packages'],['uv',path.join(home,'.cache/uv'),'Caché uv','packages'],
    ['pnpm',pnpmStore||path.join(home,'.local/share/pnpm/store'),pnpmStore?'Almacén pnpm · ubicación del gestor':'Almacén pnpm (ubicación convencional; sin resolver)','pnpm'],
    ['vscode',path.join(home,'.vscode-server/bin'),'Versiones remotas VS Code (commits)','remote'],
    ['vscode-cli',path.join(home,'.vscode-server/cli/servers'),'Servidores VS Code CLI','remote'],
    ['devin',path.join(home,'.devin'),'Versiones remotas Devin (revisión)','remote',1],
    ['models',path.join(home,'.cache/huggingface'),'Modelos Hugging Face · Biblioteca','backups',1],
  ];
  for(const [i,p] of projects.slice(0,50).entries())if(path.isAbsolute(p.cwd))defs.push([`rust-${i}`,path.join(p.cwd,'target/debug/incremental'),`Rust incremental · ${p.name}`,'builds']);
  const roots:ScanRoot[]=defs.map(([id,p,title,adapterId,depth])=>({id,path:p,title,adapterId,depth}));
  for(const v of (await availableStorage()).disks)if(v.path&&v.path!=='/'&&v.readable){
    roots.push({id:'disk-'+v.id,path:v.path,title:`${v.name} · ${v.path} (revisión)`,adapterId:'review',depth:0});
    const shared=await lstat(hostToContainer(path.join(v.path,'.Trash'))).catch(()=>null);
    const trashDirs=[path.join(v.path,`.Trash-${account[2]}`),...(shared?.isDirectory()&&(shared.mode&0o1000)?[path.join(v.path,'.Trash',account[2])]:[])];
    for(const [i,dir] of trashDirs.entries()){
      const info=await lstat(hostToContainer(dir)).catch(()=>null);
      if(info?.isDirectory()&&info.uid===Number(account[2])&&!(info.mode&0o077))roots.push({id:`trash-${v.id}-${i}`,path:path.join(dir,'files'),title:`Papelera de ${v.name} · ${dir}`,adapterId:'trash-xdg',trashTop:v.path});
    }
  }
  return roots;
}
