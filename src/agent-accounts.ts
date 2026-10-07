import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { hostSpawnInteractive, killHostProc } from './host';
import { runJob } from './jobs';
import { protect, body as readBody, only } from './storage/http';

const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
// A path/command shape only — quoting at the call sites already neutralizes
// injection, so a hostile value degrades to command-not-found. Whitespace or
// args ('python3 -I') would break every worker AND the shebang; surface it
// once at load instead of a confusing per-request 503.
if (process.env.AXON_AGENT_PYTHON && !/^[A-Za-z0-9_/.-]+$/.test(process.env.AXON_AGENT_PYTHON)) {
  console.warn('[agents] AXON_AGENT_PYTHON tiene un formato inválido (solo ruta o nombre de binario, sin espacios ni argumentos). Los workers pueden fallar.');
}
const PYTHON = process.env.AXON_AGENT_PYTHON || 'python3';
// The installed launchers run via their shebang — env python3 may resolve to
// a different interpreter than the one AXON_AGENT_PYTHON picked for workers.
// A shebang cannot carry a whitespace-containing interpreter — the kernel
// splits at the first space. Workers still honor AXON_AGENT_PYTHON via shell
// quoting; only the installed launchers fall back to PATH python3.
const SHEBANG = /\s/.test(PYTHON)
  ? '#!/usr/bin/env python3'
  : PYTHON.startsWith('/') ? `#!${PYTHON}` : `#!/usr/bin/env ${PYTHON}`;
const withShebang = (code: string) => SHEBANG === '#!/usr/bin/env python3' ? code : code.replace(/^#!.*\n/, `${SHEBANG}\n`);
let source: Promise<string> | undefined;
let serverSource: Promise<string> | undefined;
// A rejected read must not poison the cache — the next call retries.
function workerSource() {
  if (!source) source = readFile(new URL('../scripts/agent-accounts.py', import.meta.url), 'utf8')
    .catch((e) => { source = undefined; throw e; });
  return source;
}
function codexServerSource() {
  if (!serverSource) serverSource = readFile(new URL('../scripts/codex-server-account.py', import.meta.url), 'utf8')
    .catch((e) => { serverSource = undefined; throw e; });
  return serverSource;
}

export async function accountWorker(home: string, request: Record<string, unknown>) {
  const code = await workerSource();
  const serverCode = await codexServerSource();
  const child = hostSpawnInteractive(`${quote(PYTHON)} -c ${quote(code)}`, { user: 'user' });
  (child.stdin as Bun.FileSink).write(JSON.stringify({ ...request, home, source: withShebang(code), serverSource: withShebang(serverCode) }));
  (child.stdin as Bun.FileSink).end();
  const timer = setTimeout(() => killHostProc(child), 20_000);
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
  for (const action of ['activate', 'rename', 'install', 'enable-server', 'delete']) {
    app.post(`/api/agent-accounts/:agent/${action}`, async c => {
      const b = await readBody(c); only(b, action === 'rename' ? ['id', 'label'] : ['activate', 'delete'].includes(action) ? ['id'] : []);
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
