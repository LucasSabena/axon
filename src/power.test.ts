import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerPowerRoutes, fixturePowerRunner } from './power';

test('power API rejects invalid modes, schedules and stale edits', async () => {
  const app = new Hono(); registerPowerRoutes(app, fixturePowerRunner());
  const request = (body: unknown) => app.request('/api/power', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const body of [
    { mode: 'max', revision: 0 },
    { mode: 'quiet', revision: -1 },
    { mode: 'quiet', revision: 0, path: '/sys' },
    { schedule: [{ start: '23:00', end: '08:00', mode: 'quiet', extra: 1 }], revision: 0 },
    { schedule: [{ start: '23:60', end: '08:00', mode: 'quiet' }], revision: 0 },
    { schedule: [{ start: '23:00', end: '23:00', mode: 'quiet' }], revision: 0 },
    { schedule: [{ start: '23:00', end: '08:00', mode: 'quiet', days: [] }], revision: 0 },
    { schedule: [{ start: '23:00', end: '08:00', mode: 'quiet', days: [8] }], revision: 0 },
    { schedule: new Array(11).fill({ start: '01:00', end: '02:00', mode: 'quiet' }), revision: 0 },
    { revision: 0 },
  ]) expect((await request(body)).status).toBe(400);
  expect((await request({ mode: 'quiet', revision: 0 })).status).toBe(200);
  expect((await request({ mode: 'auto', revision: 2 })).status).toBe(409);
  const r = await request({ schedule: [{ start: '23:00', end: '08:00', mode: 'quiet', days: [0, 1, 2] }], revision: 1 });
  expect(r.status).toBe(200); expect((await r.json()).schedule).toHaveLength(1);
});
