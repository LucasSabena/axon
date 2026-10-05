import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerAgentConsumption } from './agent-consumption';

test('consumption normalizes native logs without duplicate billing, prices cache/context, and filters local calendar periods', async () => {
  const child = Bun.spawn(['python3', 'scripts/agent-consumption-test.py'], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code, out + err).toBe(0);
}, 30000);

test('consumption endpoints validate filters and isolate private host paths and price refresh', async () => {
  const app = new Hono(); const calls: any[] = [];
  app.use('*', async (c, next) => { if (c.req.header('cookie')) c.set('user', 'qa'); await next(); });
  registerAgentConsumption(app, async () => '/tmp/owned-consumption', async (...args) => { calls.push(args); return { ok: true }; });
  const headers = { cookie: 'axon_session=qa', origin: process.env.AXON_PUBLIC_ORIGIN || 'http://localhost', 'Content-Type': 'application/json' };
  expect((await app.request('/api/agent-consumption')).status).toBe(401);
  const response = await app.request('/api/agent-consumption?agent=codex&period=15&tz=America%2FArgentina%2FBuenos_Aires', { headers });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(calls[0]).toEqual(['/tmp/owned-consumption', { agent: 'codex', period: '15', tz: 'America/Argentina/Buenos_Aires', refreshPrices: false }]);
  for (const query of ['home=/home/other', 'endpoint=https://evil.test', 'period=999', 'agent=unknown', 'tz=invalid']) expect((await app.request('/api/agent-consumption?' + query, { headers })).status).toBe(400);
  const post = (body: any, more = {}) => app.request('/api/agent-consumption/prices/refresh', { method: 'POST', headers: { ...headers, ...more }, body: JSON.stringify(body) });
  expect((await post({}, { origin: 'https://evil.test' })).status).toBe(403);
  expect((await post({ endpoint: 'https://evil.test' })).status).toBe(400);
  expect((await post({})).status).toBe(200); expect(calls.at(-1)[1].refreshPrices).toBe(true);
});
