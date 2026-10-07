import { readdir,readFile,readlink,open } from 'node:fs/promises';
import { hostToContainer } from '../host';
import { within } from './policy';
export interface ProcessReference {pid:number;source:'exe'|'cwd'|'fd'|'maps'|'cmdline';resourceId:string}
export interface ActivityEvidence {complete:boolean;references:ProcessReference[];unknownProcesses:number;examined:number;elapsedMs:number;tools?:{pid:number;tool:string}[]}
export function procFields(stat:string){const end=stat.lastIndexOf(')');const parts=stat.slice(end+2).split(' ');return {ppid:Number(parts[1]),start:parts[19]};}
export function scannerAncestors(processes:{pid:number;ppid:number}[],self:number):Set<number>{const map=new Map(processes.map(p=>[p.pid,p.ppid]));const excluded=new Set<number>();let current=self;while(current>0&&!excluded.has(current)){excluded.add(current);current=map.get(current)||0;}return excluded;}
export function matchingResource(target:string,roots:string[]):string|null{const clean=target.replace(/ \(deleted\)$/,'');return roots.find(root=>within(clean,root))||null;}
/** No cmdline, map content, environment or opened file content escapes this collector. */
export async function activityEvidence(roots:string[],procRoot=hostToContainer('/proc'),self=process.pid,limitMs=8000):Promise<ActivityEvidence>{
 const start=Date.now();const refs:ProcessReference[]=[],tools:{pid:number;tool:string}[]=[];let unknownProcesses=0,examined=0,complete=true;
 const all=(await readdir(procRoot)).filter(s=>/^\d+$/.test(s));if(all.length>4096)complete=false;
 const pids=all.slice(0,4096);const processes:{pid:number;ppid:number;start:string}[]=[];
 for(const id of pids){if(Date.now()-start>limitMs){complete=false;break;}try{const fields=procFields(await readFile(`${procRoot}/${id}/stat`,'utf8'));processes.push({pid:Number(id),...fields});}catch{unknownProcesses++;}}
 const excluded=scannerAncestors(processes,self);
 for(const p of processes){if(excluded.has(p.pid))continue;if(Date.now()-start>limitMs){complete=false;break;}examined++;let unknown=false;const base=`${procRoot}/${p.pid}`;
  const inspect=async(source:'exe'|'cwd'|'fd',name:string)=>{try{const target=await readlink(name);const resourceId=matchingResource(target,roots);if(resourceId&&refs.length<2000)refs.push({pid:p.pid,source,resourceId});}catch(e:any){if(e.code!=='ENOENT')unknown=true;}};
  await inspect('exe',base+'/exe');await inspect('cwd',base+'/cwd');
  try{const fds=await readdir(base+'/fd');if(fds.length>512)unknown=true;for(const fd of fds.slice(0,512)){if(Date.now()-start>limitMs){unknown=true;break;}await inspect('fd',base+'/fd/'+fd);}}catch(e:any){if(e.code!=='ENOENT')unknown=true;}
  for(const source of ['maps','cmdline'] as const){try{const file=await open(base+'/'+source,'r');let content:string;try{const buf=Buffer.alloc(2*1024*1024+1);const {bytesRead}=await file.read(buf,0,buf.length,0);if(bytesRead>2*1024*1024){unknown=true;continue;}content=buf.subarray(0,bytesRead).toString('utf8');}finally{await file.close();}if(source==='cmdline'){const known=new Set(['pip','pip3','uv','uvx','pnpm','cargo','rustc','snap','apt','apt-get','dpkg','code','code-server']);for(const arg of content.split('\0')){const token=arg.split('/').at(-1)||'';if(known.has(token)&&!tools.some(t=>t.pid===p.pid&&t.tool===token))tools.push({pid:p.pid,tool:token==='pip3'?'pip':token==='uvx'?'uv':token});}}for(const resourceId of roots){const found=source==='cmdline'?content.split('\0').some(arg=>{
   let value=arg.includes('=')?arg.slice(arg.indexOf('=')+1):arg;
   // Joined compiler/linker flags: -I<path> -L<path> -B<path> -isystem<path> -iquote<path> -o<path>
   for(const flag of ['-isystem','-iquote','-I','-L','-B','-o'])if(value.startsWith(flag)){value=value.slice(flag.length);break;}
   return value===resourceId||value.startsWith(resourceId+'/');}):content.split('\n').some(line=>matchingResource(line.split(/\s+/).slice(5).join(' '),[resourceId]));if(found&&refs.length<2000)refs.push({pid:p.pid,source,resourceId});}}catch(e:any){if(e.code!=='ENOENT')unknown=true;}}
  try{if(procFields(await readFile(base+'/stat','utf8')).start!==p.start)unknown=true;}catch{unknown=true;}
  if(unknown)unknownProcesses++;
 }
 return {complete:complete&&unknownProcesses===0&&refs.length<2000,references:refs.slice(0,2000),unknownProcesses,examined,elapsedMs:Date.now()-start,tools};
}
