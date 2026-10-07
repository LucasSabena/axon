import { HOST_USER, ON_HOST } from '../host';
import { userInfo } from 'node:os';
export type ReadTool = 'python3' | 'snap' | 'pnpm' | 'docker';
/** Server-owned commands only; intentionally not an arbitrary command endpoint. */
export function hostArgv(tool: ReadTool, args: string[], user = HOST_USER): string[] {
  if (!/^[a-z_][a-z0-9_-]*[$]?$/i.test(user) || user==='root') throw new Error('El mantenimiento necesita una identidad no privilegiada explícita');
  if (!['python3','snap','pnpm','docker'].includes(tool) || args.some(a=>a.includes('\0'))) throw new Error('Comando no permitido');
  const command = ['/usr/bin/env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'LC_ALL=C', tool, ...args];
  if (ON_HOST) {
    if (process.getuid?.()===0) return ['runuser','-u',user,'--',...command];
    if (userInfo().username!==user) throw new Error('La identidad solicitada no coincide con el usuario del host');
    return command;
  }
  return ['nsenter','-t','1','-m','-u','-i','-n','-p','--','runuser','-u',user,'--',...command];
}
export async function boundedCommand(argv: string[], stdin: string, signal?: AbortSignal, timeoutMs=22000): Promise<string> {
  // setsid gives the wrapper (nsenter/runuser) its own process group so a timeout
  // can kill the whole group — p.kill() alone would orphan the real worker on the host.
  const p=Bun.spawn(['setsid',...argv],{stdin:new Blob([stdin]),stdout:'pipe',stderr:'pipe',env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}});
  let timedOut=false; const stop=()=>{try{process.kill(-p.pid,'SIGKILL');}catch{try{p.kill('SIGKILL');}catch{}}};
  const timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  const read=async(stream:ReadableStream<Uint8Array>)=>{let n=0;const chunks:Uint8Array[]=[];for await(const chunk of stream){n+=chunk.length;if(n>2*1024*1024){stop();throw new Error('Salida de análisis excedida');}chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');};
  try { const [out,,code]=await Promise.all([read(p.stdout),read(p.stderr),p.exited]);if(signal?.aborted)throw new Error('Análisis cancelado');if(timedOut||code!==0)throw new Error('Análisis interrumpido o permiso insuficiente');return out; }
  finally {clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}
