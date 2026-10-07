import { resolveHostPath } from './host-storage';
import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { hostSpawnInteractive, killHostProc } from './host';
import { getProjects } from './projects';
import { recordEvent } from './events';
import { body as readBody, only } from './storage/http';

const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
const PYTHON = process.env.AXON_AGENT_PYTHON || 'python3';
let source: Promise<string> | undefined;
let configuredRoots:()=>{agent:string;root:string}[]=()=>[];
// Execute on the host as its user: SQLite WALs and native memory APIs remain
// on the same filesystem/network as their owning agents, including in Docker.
export async function contextWorker(home: string, request: Record<string, unknown>) {
  // A rejected read must not poison the cache — the next call retries.
  if (!source) source = readFile(new URL('../scripts/agent-context-store.py', import.meta.url), 'utf8')
    .catch((e) => { source = undefined; throw e; });
  const roots=[];for(const r of configuredRoots())try{await resolveHostPath(r.root,{directory:true});roots.push(r);}catch{/* disconnected or absent store */}
  const child = hostSpawnInteractive(`${quote(PYTHON)} -c ${quote(await source)}`, { user: 'user' });
  (child.stdin as Bun.FileSink).write(JSON.stringify({ ...request, home, agentRoots:roots, projects: getProjects().map(p => ({name:p.name,cwd:p.cwd})) }));
  (child.stdin as Bun.FileSink).end();
  const timer = setTimeout(() => killHostProc(child), 60_000);
  try {
    const [output, , code] = await Promise.all([new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text(), child.exited]);
    if (code) throw new Error('No se pudo leer el almacén local de contexto');
    return JSON.parse(output);
  } finally { clearTimeout(timer); }
}

export function registerAgentContext(app: Hono, home: () => string,roots?:()=>{agent:string;root:string}[]) {
  if(roots)configuredRoots=roots;
  app.use('/api/agent-context/*', async (c,next) => { c.header('Cache-Control','private, no-store'); await next(); });
  const run = async (c: any, request: Record<string, unknown>) => {
    try {
      const result = await contextWorker(home(), request);
      if (!result.ok) return c.json(result, result.status || 400);
      return c.json(result);
    } catch (e) { return c.json({ok:false,error:(e as Error).message},503); }
  };
  app.get('/api/agent-context/chats/indexing', c => run(c, {action:'index',kind:'chats'}));
  app.get('/api/agent-context/:kind', c => run(c, {q:c.req.query('q'),agent:c.req.query('agent'),project:c.req.query('project'),type:c.req.query('type'),offset:c.req.query('offset'),action:'list',kind:c.req.param('kind')}));
  app.get('/api/agent-context/:kind/:id', c => run(c, {offset:c.req.query('offset'),action:'detail',kind:c.req.param('kind'),id:c.req.param('id')}));
  app.get('/api/agent-context/chats/:id/export', async c => {
    try {
      const result = await contextWorker(home(), {action:'export',kind:'chats',id:c.req.param('id')});
      if (!result.ok) return c.json(result, result.status || 400);
      c.header('Content-Disposition', 'attachment; filename="chat-contexto.md"');
      c.header('Cache-Control','private, no-store');
      return c.body(result.markdown,200,{'Content-Type':'text/markdown; charset=utf-8'});
    } catch { return c.json({ok:false,error:'No se pudo exportar la conversación'},503); }
  });
  app.post('/api/agent-context/memories/:id', async c => {
    let body: Record<string, unknown>;
    try { body = await readBody(c); only(body, ['content', 'title', 'revision']); }
    catch { return c.json({ok:false,error:'Contenido inválido'},400); }
    if (typeof body.content !== 'string' || body.content.length > 300_000 || typeof body.revision !== 'string')
      return c.json({ok:false,error:'Contenido o revisión inválidos'},400);
    const response = await run(c, {action:'save',kind:'memories',id:c.req.param('id'),content:body.content,title:body.title,revision:body.revision});
    if (response.status < 300) recordEvent('agent','Memoria editada desde Axon',undefined,{section:'agents',params:{id:'__memories',entry:c.req.param('id')}});
    return response;
  });
}
