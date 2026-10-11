import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerFanRoutes, fixtureFanRunner } from './fans';

test('fan API rejects unbounded values and stale edits; AUTO restores the fixture', async () => {
  const app = new Hono(); registerFanRoutes(app, fixtureFanRunner());
  const request = (body: unknown) => app.request('/api/fans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const body of [{ mode: 'manual', cpu: 0, gpu: 100, revision: 0, minutes: 15 }, { mode: 'manual', cpu: 80, gpu: true, revision: 0, minutes: 15 }, { mode: 'max', revision: 0, path: '/sys' }, { mode: 'auto', revision: -1 }, { mode: 'manual', cpu: 60, gpu: 60, revision: 0, minutes: 999 }]) expect((await request(body)).status).toBe(400);
  expect((await request({mode:'manual',cpu:60,gpu:70,minutes:15,revision:0})).status).toBe(200);
  expect((await request({mode:'max',revision:0})).status).toBe(409);
  const r = await request({mode:'auto',revision:1}); expect(r.status).toBe(200); expect((await r.json()).mode).toBe('auto');
});
