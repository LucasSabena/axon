import { lstat, realpath, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import * as path from 'node:path';
import type { Hono } from 'hono';
import { hostExec, hostToContainer, hostExists } from './host';
import { recordEvent } from './events';

type Agent = { id: string; name: string; root: string; shared?: boolean };
type Archive = { id: string; agentId: string; name: string; source: string; destination: string; at: number };
const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
export function safeArchiveRoot(root: string, home: string): boolean {
  const normalized = path.posix.normalize(root);
  return normalized === root && root.startsWith(home + '/') &&
    ![home + '/.config', home + '/.local', home + '/.local/share', home + '/.agents'].includes(root) &&
    !root.startsWith(home + '/.local/share/axon') && !root.includes('\0');
}
export function registerAgentArchives(app: Hono, options: {
  home: () => string; agents: () => Agent[]; installed: (id: string) => Promise<boolean>; changed: () => void;
}) {
  const file = path.join(path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'), 'agent-archives.json');
  let flight: Promise<unknown> | null = null;
  const list = async (): Promise<Archive[]> => { try { const arr = JSON.parse(await readFile(file, 'utf8')); return Array.isArray(arr) ? arr : []; } catch { return []; } };
  const save = async (rows: Archive[]) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file+'.tmp',JSON.stringify(rows)); await rename(file+'.tmp',file); };
  async function realDirectory(hostPath: string) {
    const cp = hostToContainer(hostPath), st = await lstat(cp).catch(() => null);
    if (!st?.isDirectory() || st.isSymbolicLink() || await realpath(cp) !== cp) throw new Error('La carpeta no existe o usa un enlace simbólico');
  }
  async function preview(id: string, estimate = true) {
    const agent = options.agents().find(a => a.id === id);
    const home = options.home();
    if (!agent || agent.shared || !safeArchiveRoot(agent.root,home)) throw new Error('Esta carpeta no admite limpieza de residuales');
    if (await options.installed(id)) throw new Error('El agente está instalado; su configuración se conserva');
    await realDirectory(agent.root);
    for (const other of options.agents()) {
      if (other.id !== id && (other.root === agent.root || other.root.startsWith(agent.root+'/') || agent.root.startsWith(other.root+'/')) && await hostExists(other.root)) throw new Error(`La carpeta se comparte con ${other.name}; no se puede archivar`);
    }
    const usage = estimate ? await hostExec(`du -sh -- ${quote(agent.root)}`, {user:'user',timeoutMs:5000}) : null;
    return { agent, size:usage?.ok ? usage.stdout.trim().split(/\s/)[0] : 'Sin estimación' };
  }
  async function archiveOne(agentId: string): Promise<Archive> {
    // Recheck on execution, including after another item in a batch finished.
    const {agent}=await preview(agentId, false);
    const id=crypto.randomUUID(), base=options.home()+'/.local/share/axon/agent-archives';
    const prepared=await hostExec(`mkdir -p -- ${quote(base)}`,{user:'user',timeoutMs:5000});
    if(!prepared.ok)throw new Error('No se pudo preparar la carpeta de respaldos');
    await realDirectory(base);
    const row:Archive={id,agentId:agent.id,name:agent.name,source:agent.root,destination:base+'/'+id,at:Date.now()};
    const rows=await list();
    await save([...rows,row]);
    const result=await hostExec(`mv -T -n -- ${quote(row.source)} ${quote(row.destination)} && test ! -e ${quote(row.source)} && test ! -L ${quote(row.source)}`,{user:'user',timeoutMs:15_000});
    if(!result.ok){
      // Keep recovery information when the move happened but its final check
      // failed; never orphan a backup by blindly removing its manifest row.
      if(!await hostExists(row.destination))await save(rows);
      throw new Error('No se pudo completar el archivo de la carpeta; revisá los respaldos');
    }
    options.changed();recordEvent('agent',`${agent.name}: configuración residual archivada`,row.destination,{section:'agents',params:{id:'__archives'}});
    return row;
  }
  app.get('/api/agent-residuals', async c => {
    const candidates=options.agents().filter(a=>!a.shared&&safeArchiveRoot(a.root,options.home()));
    const residuals: {id:string;name:string;source:string;size?:string;eligible:boolean;reason?:string}[]=[];
    // Bound native probes; each group only reads three configurations at once.
    for(let i=0;i<candidates.length;i+=3){
      const rows=await Promise.all(candidates.slice(i,i+3).map(async agent=>{
        if(!await hostExists(agent.root)||await options.installed(agent.id))return null;
        try{const {size}=await preview(agent.id);return {id:agent.id,name:agent.name,source:agent.root,size,eligible:true};}
        catch(e){return {id:agent.id,name:agent.name,source:agent.root,eligible:false,reason:(e as Error).message};}
      }));
      residuals.push(...rows.filter(Boolean) as typeof residuals);
    }
    return c.json({ok:true,residuals});
  });
  app.post('/api/agent-residuals/archive', async c => {
    if(flight)return c.json({ok:false,error:'Ya hay una operación en curso'},409);
    const body=await c.req.json<{confirm?:boolean;ids?:unknown}>().catch(()=>({} as {confirm?:boolean;ids?:unknown}));
    if(body?.confirm!==true||!Array.isArray(body.ids)||!body.ids.length||body.ids.length>50||body.ids.some(id=>typeof id!=='string'))
      return c.json({ok:false,error:'Seleccioná entre 1 y 50 residuales y confirmá la limpieza'},400);
    if(flight)return c.json({ok:false,error:'Ya hay una operación en curso'},409);
    const ids=[...new Set(body.ids)] as string[];
    const work=(async()=>{
      // An invalid selection never causes the first valid item to move.
      for(const id of ids)await preview(id,false);
      const archives:Archive[]=[],failures:{id:string;name:string;error:string}[]=[];
      for(const id of ids){
        try{archives.push(await archiveOne(id));}
        catch(e){failures.push({id,name:options.agents().find(a=>a.id===id)?.name||id,error:(e as Error).message});}
      }
      return {archives,failures};
    })();flight=work;
    try{return c.json({ok:true,...await work});}catch(e){return c.json({ok:false,error:(e as Error).message},400);}finally{flight=null;}
  });
  app.get('/api/agent-archives', async c => c.json({ok:true, archives:await list()}));
  app.get('/api/agents/:id/archive-preview', async c => {
    try { const {agent,size}=await preview(c.req.param('id'));return c.json({ok:true,name:agent.name,source:agent.root,size}); }
    catch(e){return c.json({ok:false,error:(e as Error).message},400);}
  });
  app.post('/api/agents/:id/archive', async c => {
    if (flight) return c.json({ok:false,error:'Ya hay una limpieza en curso'},409);
    const body=await c.req.json<{confirm?:boolean}>().catch(()=>({} as {confirm?:boolean}));
    if(body?.confirm!==true)return c.json({ok:false,error:'Confirmación requerida'},400);
    if(flight)return c.json({ok:false,error:'Ya hay una limpieza en curso'},409);
    const work=archiveOne(c.req.param('id'));flight=work;
    try{return c.json({ok:true,archive:await work});}catch(e){return c.json({ok:false,error:(e as Error).message},400);}finally{flight=null;}
  });
  app.post('/api/agent-archives/:id/restore', async c => {
    if(flight)return c.json({ok:false,error:'Ya hay una operación en curso'},409);
    const work=(async()=>{
      const rows=await list(), row=rows.find(a=>a.id===c.req.param('id'));
      if(!row || !safeArchiveRoot(row.source,options.home()) || row.destination!==options.home()+'/.local/share/axon/agent-archives/'+row.id || !/^[a-f0-9-]{36}$/.test(row.id))throw new Error('Respaldo inválido');
      if(await lstat(hostToContainer(row.source)).catch(()=>null))throw new Error('Ya existe una configuración en el destino; se conserva');
      const parent=hostToContainer(path.posix.dirname(row.source));
      if(await realpath(parent)!==parent)throw new Error('El destino usa un enlace simbólico');
      await realDirectory(row.destination);
      const result=await hostExec(`mv -T -n -- ${quote(row.destination)} ${quote(row.source)} && test ! -e ${quote(row.destination)} && test ! -L ${quote(row.destination)}`,{user:'user',timeoutMs:15_000});
      if(!result.ok)throw new Error('No se pudo restaurar la carpeta');
      await save(rows.filter(a=>a.id!==row.id));options.changed();recordEvent('agent',`${row.name}: configuración restaurada`,undefined,{section:'agents',params:{id:row.agentId}});
    })();flight=work;
    try{await work;return c.json({ok:true});}catch(e){return c.json({ok:false,error:(e as Error).message},400);}finally{flight=null;}
  });
}
