import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { hostSpawnInteractive, killHostProc } from './host';
import { body, only, protect } from './storage/http';

const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
const PYTHON = process.env.AXON_AGENT_PYTHON || 'python3';
let sources: Promise<string[]> | undefined;
export async function usageWorker(home: string, agent: string, refresh = false, extra: Record<string, unknown> = {}) {
  // A rejected read must not poison the cache — the next call retries.
  if (!sources) sources = Promise.all([
    readFile(new URL('../scripts/agent-usage.py', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/agent-accounts.py', import.meta.url), 'utf8'),
  ]).catch((e) => { sources = undefined; throw e; });
  const [code, accountsSource] = await sources;
  const child = hostSpawnInteractive(`${quote(PYTHON)} -c ${quote(code)}`, { user: 'user' });
  (child.stdin as Bun.FileSink).write(JSON.stringify({ ...extra, home, agent, refresh, accountsSource }));
  (child.stdin as Bun.FileSink).end();
  const timeout = setTimeout(() => killHostProc(child), 30_000);
  try {
    const [output, , status] = await Promise.all([
      new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text(), child.exited,
    ]);
    if (status) throw new Error('Lector de cuotas no disponible');
    return JSON.parse(output);
  } finally { clearTimeout(timeout); }
}

export function registerAgentUsage(app: Hono, home: () => Promise<string>, run = usageWorker) {
  protect(app, '/api/agent-usage');
  const read = async (c: any, refresh: boolean) => {
    if (!['codex', 'claude', 'opencode', 'openchamber', 'devin'].includes(c.req.param('agent'))) return c.json({ ok: false, error: 'Agente sin lector de cuotas' }, 404);
    try {
      const result = await run(await home(), c.req.param('agent'), refresh);
      return c.json(result, result.ok ? 200 : result.status || 503);
    } catch { return c.json({ ok: false, error: 'No se pudieron consultar las cuotas. Reintentá en unos minutos.' }, 503); }
  };
  app.get('/api/agent-usage/:agent', c => read(c, false));
  app.post('/api/agent-usage/:agent/refresh', async c => {
    only(await body(c), []);
    return read(c, true);
  });
  for (const action of ['connect', 'disconnect']) {
    app.post(`/api/agent-usage/devin/${action}`, async c => {
      const input = await body(c);
      only(input, action === 'connect' ? ['label', 'organization', 'accessToken'] : ['id']);
      try {
        const result = await run(await home(), 'devin', false, { ...input, action });
        return c.json(result, result.ok ? 200 : result.status || 400);
      } catch { return c.json({ ok: false, error: 'No se pudo guardar la conexión de consulta' }, 503); }
    });
  }
}
