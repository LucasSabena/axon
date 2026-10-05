import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { hostSpawnInteractive } from './host';
import { runJob } from './jobs';
import { protect, body as readBody, only } from './storage/http';

const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
let source: Promise<string>;
let serverSource: Promise<string>;
function workerSource() { return source ||= readFile(new URL('../scripts/agent-accounts.py', import.meta.url), 'utf8'); }

export async function accountWorker(home: string, request: Record<string, unknown>) {
  const code = await workerSource();
  const serverCode = await (serverSource ||= readFile(new URL('../scripts/codex-server-account.py', import.meta.url), 'utf8'));
  const child = hostSpawnInteractive(`${quote(process.env.AXON_AGENT_PYTHON || "python3")} -c ${quote(code)}`, { user: 'user' });
  (child.stdin as Bun.FileSink).write(JSON.stringify({ ...request, home, source: code, serverSource: serverCode }));
  (child.stdin as Bun.FileSink).end();
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [output, , status] = await Promise.all([new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text(), child.exited]);
    if (status) throw new Error('No se pudo acceder al registro de cuentas');
    return JSON.parse(output);
  } finally { clearTimeout(timer); }
}

export function registerAgentAccounts(app: Hono, home: () => Promise<string>, changed: () => void) {
  protect(app, '/api/agent-accounts');
  const run = async (c: any, request: Record<string, unknown>) => {
    try {
      const result = await accountWorker(await home(), request);
      if (!result.ok) return c.json(result, result.status || 400);
      if (request.action !== 'list') changed();
      return c.json(result);
    } catch { return c.json({ ok: false, error: 'No se pudo acceder al registro de cuentas' }, 503); }
  };
  app.get('/api/agent-accounts/:agent', c => run(c, { action: 'list', agent: c.req.param('agent') }));
  app.post('/api/agent-accounts/:agent', async c => {
    const b = await readBody(c); only(b, ['label']);
    return run(c, { action: 'create', agent: c.req.param('agent'), label: b.label });
  });
  for (const action of ['activate', 'rename', 'install', 'enable-server']) {
    app.post(`/api/agent-accounts/:agent/${action}`, async c => {
      const b = await readBody(c); only(b, action === 'rename' ? ['id', 'label'] : action === 'activate' ? ['id'] : []);
      return run(c, { action, agent: c.req.param('agent'), id: b.id, label: b.label });
    });
  }
  app.post('/api/agent-accounts/:agent/login', async c => {
    const agent = c.req.param('agent'), body = await readBody(c); only(body, ['id']);
    try {
      const accountHome = await home();
      const list = await accountWorker(accountHome, { action: 'list', agent });
      if (!list.ok) return c.json(list, list.status || 400);
      const profile = list.profiles.find((p: any) => p.id === body.id);
      if (!profile) return c.json({ ok: false, error: 'Cuenta no encontrada' }, 404);
      if (profile.loginBusy) return c.json({ ok: false, error: 'Ya hay un login en curso para esta cuenta' }, 409);
      const installed = await accountWorker(accountHome, { action: 'install', agent });
      if (!installed.ok) return c.json(installed, installed.status || 400);
      const command = `${quote(accountHome + '/.local/bin/axon-agent')} login ${quote(agent)} ${quote(profile.id)}`;
      // Claude can require pasted input, so use the real interactive terminal.
      if (agent === 'claude') return c.json({ ok: true, terminalCommand: command, label: `Claude · ${profile.label}` });
      const job = runJob(`Codex · Conectar ${profile.label}`, [{ label: 'Iniciar sesión con ChatGPT', cmd: command, user: 'user' }], { transient: true });
      return c.json({ ok: true, job });
    } catch { return c.json({ ok: false, error: 'No se pudo iniciar el login' }, 503); }
  });
}
