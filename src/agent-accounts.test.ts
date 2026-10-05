import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { registerAgentAccounts } from './agent-accounts';
import '../public/terminal-tools.js';

test('account credentials, refresh writes, launch selection, locks, shell preservation and path safety', async () => {
  const child = Bun.spawn(['python3', 'scripts/agent-accounts-test.py'], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code, out + err).toBe(0);
}, 30_000);

test('server account switch preserves credential owners and history, waits for idle and verifies desktop identity', async () => {
  const child = Bun.spawn(['python3', 'scripts/codex-server-account-test.py'], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code, out + err).toBe(0);
}, 30_000);

test('account API is uncached, GET cannot mutate, invalid labels and unconnected activation fail', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'axon-accounts-api-'));
  try {
    const app = new Hono(); let changed = 0;
    app.use('*', async (c, next) => { if (c.req.header('cookie')) c.set('user', 'qa'); await next(); });
    registerAgentAccounts(app, async () => home, () => changed++);
    expect((await app.request('/api/agent-accounts/codex')).status).toBe(401);
    const headers = { cookie: 'axon_session=fixture', origin: process.env.AXON_PUBLIC_ORIGIN || 'http://localhost', 'Content-Type': 'application/json' };
    const list = await app.request('/api/agent-accounts/codex?action=create&label=Injected', { headers });
    expect(list.status).toBe(200); expect(list.headers.get('cache-control')).toBe('private, no-store');
    expect((await list.json()).profiles).toHaveLength(1); expect(changed).toBe(0);
    await expect(access(path.join(home, '.local/share/axon/agent-accounts'))).rejects.toThrow();
    const post = (route: string, body: unknown) => app.request(route, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await app.request('/api/agent-accounts/codex', {method:'POST',headers:{...headers,origin:'https://evil.example'},body:'{"label":"Injected"}'})).status).toBe(403);
    expect((await post('/api/agent-accounts/codex', { label: '' })).status).toBe(400);
    const created = await post('/api/agent-accounts/codex', { label: 'Empresa' }); expect(created.status).toBe(200);
    const id = (await created.json()).createdId;
    expect((await post('/api/agent-accounts/codex/activate', { id })).status).toBe(409);
    expect((await post('/api/agent-accounts/codex/rename', { id, label: 'Trabajo' })).status).toBe(200);
    expect((await post('/api/agent-accounts/codex/login', { id: '../../escape' })).status).toBe(404);
    expect((await app.request('/api/agent-accounts/unknown', { headers })).status).toBe(404);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('terminal login output removes ANSI and detects only safe HTTP links without executing markup', () => {
  const tools = (globalThis as any).AxonTerminalTools;
  const text = tools.clean('\x1b[32mAbrí https://auth.openai.com/codex/device.\x1b[0m\r\n<script>alert(1)</script> javascript:alert(1)');
  expect(text).not.toContain('\x1b');
  expect(tools.urls(text).map((x: any) => x.url)).toEqual(['https://auth.openai.com/codex/device']);
  expect(text).toContain('<script>'); // Rendered as text nodes, never HTML.
});

test('terminal links span wrapped lines and copy does not interrupt the process', () => {
  const tools = (globalThis as any).AxonTerminalTools;
  let provider: any, handler: any;
  const lineText = 'URL https://example.test/account/login';
  const cols = 20, lines = [lineText.slice(0, cols), lineText.slice(cols)];
  const term = { cols, buffer: { active: { length: 2, getLine: (i: number) => ({ isWrapped: i === 1, translateToString: () => lines[i] }) } },
    attachCustomKeyEventHandler: (h: any) => handler = h, registerLinkProvider: (p: any) => provider = p, hasSelection: () => false };
  tools.attach(term, { addEventListener() {} });
  let links: any; provider.provideLinks(2, (v: any) => links = v);
  expect(links[0].text).toBe('https://example.test/account/login');
  expect(links[0].range.start).toEqual({ x: 5, y: 1 });
  expect(links[0].range.end.y).toBe(2);
  expect(handler({ key: 'c', type: 'keydown', ctrlKey: true })).toBe(true); // Ctrl+C without a selection still interrupts.
  expect(handler({ key: 'v', type: 'keydown', ctrlKey: true })).toBe(false); // Native browser paste owns this event.
});
