import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerAgentUsage } from './agent-usage';
import '../public/agent-usage.js';

test('provider quotas preserve identities, reset units, native V2 storage, failure freshness and private account caches', async () => {
  const child = Bun.spawn(['python3', 'scripts/agent-usage-test.py'], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code, out + err).toBe(0);
}, 30_000);

test('usage endpoints require auth, protect refresh/connect origins and never accept client paths or endpoints', async () => {
  const app = new Hono(); const calls: unknown[][] = [];
  app.use('*', async (c, next) => { if (c.req.header('cookie')) c.set('user', 'qa'); await next(); });
  registerAgentUsage(app, async () => '/tmp/owned-usage-test', async (...args) => { calls.push(args); return { ok: true, accounts: [] }; });
  expect((await app.request('/api/agent-usage/codex')).status).toBe(401);
  const headers = { cookie: 'axon_session=fixture', origin: process.env.AXON_PUBLIC_ORIGIN || 'http://localhost', 'Content-Type': 'application/json' };
  const result = await app.request('/api/agent-usage/codex', { headers });
  expect(result.headers.get('cache-control')).toBe('private, no-store');
  expect(calls[0]).toEqual(['/tmp/owned-usage-test', 'codex', false]);
  const post = (url: string, body: unknown, more = {}) => app.request(url, { method: 'POST', headers: { ...headers, ...more }, body: JSON.stringify(body) });
  expect((await post('/api/agent-usage/codex/refresh', {}, { origin: 'https://evil.test' })).status).toBe(403);
  expect((await post('/api/agent-usage/codex/refresh', { home: '/home/other' })).status).toBe(400);
  expect((await post('/api/agent-usage/devin/connect', { label: 'Company', organization: 'org-test', accessToken: 'secret', endpoint: 'https://evil.test' })).status).toBe(400);
  expect((await post('/api/agent-usage/codex/refresh', {})).status).toBe(200);
  expect(calls.at(-1)).toEqual(['/tmp/owned-usage-test', 'codex', true]);
  expect((await app.request('/api/agent-usage/unknown', { headers })).status).toBe(404);
});

test('a displayed countdown never assumes the provider has renewed the quota', () => {
  const usage = (globalThis as any).AxonAgentUsage;
  expect(usage.until(null)).toBe('Reinicio no informado');
  expect(usage.until(99, 100)).toBe('Reinicio pendiente de confirmar');
  expect(usage.until(3760, 100)).toContain('1 h 1 min');
});
