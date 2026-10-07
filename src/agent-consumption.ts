import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { hostSpawnInteractive, killHostProc } from './host';
import { body, only, protect } from './storage/http';

const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
const PYTHON = process.env.AXON_AGENT_PYTHON || 'python3';
let source: Promise<string> | undefined;
export async function consumptionWorker(home: string, input: Record<string, unknown>) {
  // A rejected read must not poison the cache — the next call retries.
  if (!source) source = readFile(new URL('../scripts/agent-consumption.py', import.meta.url), 'utf8')
    .catch((e) => { source = undefined; throw e; });
  const code = await source;
  const child = hostSpawnInteractive(`${quote(PYTHON)} -c ${quote(code)}`, { user: 'user' });
  (child.stdin as Bun.FileSink).write(JSON.stringify({ ...input, home }));
  (child.stdin as Bun.FileSink).end();
  const timeout = setTimeout(() => killHostProc(child), 35_000);
  try {
    const [output, , status] = await Promise.all([
      new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text(), child.exited,
    ]);
    if (status) throw new Error('Historial no disponible');
    return JSON.parse(output);
  } finally { clearTimeout(timeout); }
}

export function registerAgentConsumption(app: Hono, home: () => Promise<string>, run = consumptionWorker) {
  protect(app, '/api/agent-consumption');
  const read = async (c: any, refreshPrices = false) => {
    const query = c.req.query();
    if (Object.keys(query).some(k => !['agent', 'period', 'tz', 'provider', 'model', 'account'].includes(k))) return c.json({ ok: false, error: 'Filtro no permitido' }, 400);
    const input = { agent: 'all', period: '7', tz: 'America/Argentina/Buenos_Aires', ...query, refreshPrices };
    if (!['all', 'codex', 'claude', 'opencode', 'openchamber', 'gemini', 'devin'].includes(input.agent) || !['today', '7', '15', '30', 'all'].includes(input.period)) return c.json({ ok: false, error: 'Período o agente no válido' }, 400);
    try { new Intl.DateTimeFormat('es-AR', { timeZone: input.tz }); }
    catch { return c.json({ ok: false, error: 'Zona horaria no válida' }, 400); }
    if (Object.values(query).some(v => typeof v !== 'string' || v.length > 240 || /[\u0000-\u001f]/.test(v))) return c.json({ ok: false, error: 'Filtro no válido' }, 400);
    try {
      const result = await run(await home(), input);
      return c.json(result, result.ok ? 200 : result.status || 503);
    } catch { return c.json({ ok: false, error: 'No se pudo actualizar el consumo. Podés reintentar conservando la última lectura.' }, 503); }
  };
  app.get('/api/agent-consumption', c => read(c));
  app.post('/api/agent-consumption/prices/refresh', async c => { only(await body(c), []); return read(c, true); });
}
