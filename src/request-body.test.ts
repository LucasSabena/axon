import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { boundedRequestBody, requestBodyLimit } from './request-body';

test('streamed control bodies are capped in bytes before any handler buffers or parses them', async () => {
  const app = new Hono(); let handled = 0, cancelled = false, chunks = 0;
  app.use('*', boundedRequestBody);
  app.post('/api/login', async c => { handled++; return c.json({ text: await c.req.text() }); });
  const stream = new ReadableStream({ pull(c) { chunks++; c.enqueue(new Uint8Array(4096)); }, cancel() { cancelled = true; } });
  const response = await app.request('/api/login', { method: 'POST', body: stream });
  expect(response.status).toBe(413); expect(handled).toBe(0); expect(cancelled).toBe(true); expect(chunks).toBeLessThanOrEqual(4);
});

test('declared lengths cannot bypass actual byte bounds and small JSON remains available to handlers', async () => {
  const app = new Hono(); let handled = 0;
  app.use('*', boundedRequestBody);
  app.post('/api/login', async c => { handled++; return c.json(await c.req.json()); });
  const bad = await app.request('/api/login', { method: 'POST', headers: { 'content-length': '1' }, body: 'x'.repeat(8193) });
  expect(bad.status).toBe(413); expect(handled).toBe(0);
  const good = await app.request('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'fixture', password: 'contraseña' }) });
  expect(await good.json()).toEqual({ username: 'fixture', password: 'contraseña' }); expect(handled).toBe(1);
});

test('public shares and pairing have small limits; chunked uploads remain streamed with their existing per-block bounds', async () => {
  for (const route of ['/pair', '/s/id/unlock', '/s/id/activity', '/x/drop/id', '/api/onboarding/setup', '/api/auth/password']) expect(requestBodyLimit(route, 'POST')).toBe(8192);
  const app = new Hono(); let sameBody = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } });
  app.use('*', boundedRequestBody);
  app.put('/api/files/upload/id', c => { sameBody = c.req.raw.body === stream; return c.body(c.req.raw.body); });
  const response = await app.request('/api/files/upload/id', { method: 'PUT', body: stream });
  expect(sameBody).toBe(true); expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  for (const route of ['/api/files/upload/id', '/api/library/upload/id', '/api/v1/cloud/uploads/id']) expect(requestBodyLimit(route, 'PUT')).toBeNull();
  expect(requestBodyLimit('/api/library/upload/init', 'POST')).toBe(8 * 1024 * 1024);
  expect(requestBodyLimit('/api/drop/file', 'POST')).toBeGreaterThan(50 * 1024 * 1024);
});

test('interrupted bodies fail visibly without invoking a mutation', async () => {
  const app = new Hono(); let handled = 0;
  app.use('*', boundedRequestBody); app.post('/pair', c => { handled++; return c.json({ ok: true }); });
  const body = new ReadableStream({ start(c) { c.error(new Error('fixture disconnect')); } });
  expect((await app.request('/pair', { method: 'POST', body })).status).toBe(400); expect(handled).toBe(0);
});
