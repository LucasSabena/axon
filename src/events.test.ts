import { test, expect } from 'bun:test';
import { Hono } from 'hono';
import { clearEvents, recordEvent, listEvents, unreadCount, markAllRead, registerEventRoutes } from './events';

test('read acknowledgements only affect the observed events, including concurrent arrivals', async () => {
  clearEvents();recordEvent('info','First');const first=listEvents()[0];
  recordEvent('info','Arrived while reading');markAllRead([first.id]);expect(unreadCount()).toBe(1);
  expect(listEvents().find(e=>e.id===first.id)?.read).toBe(true);
  const app=new Hono();registerEventRoutes(app);
  const invalid=await app.request('/api/events/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:'bad'})});expect(invalid.status).toBe(400);expect(unreadCount()).toBe(1);
  const result=await app.request('/api/events/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[]})});expect((await result.json()).unread).toBe(1);
  clearEvents();
});

test('live events send the current unread count and a change without polling', async () => {
  clearEvents();const app=new Hono();registerEventRoutes(app);
  const response=await app.request('/api/events/stream');expect(response.headers.get('Content-Type')).toContain('text/event-stream');
  const reader=response.body!.getReader(), decoder=new TextDecoder();
  expect(decoder.decode((await reader.read()).value)).toContain('"unread":0');
  recordEvent('job','Done');expect(decoder.decode((await reader.read()).value)).toContain('"unread":1');
  await reader.cancel();clearEvents();
});

test('remote revocation closes a live event stream without waiting for a heartbeat', async () => {
  const { recordSession, revokeSession } = await import('./sessions');
  const sid = crypto.randomUUID();
  await recordSession(sid, 'fixture', 'fixture');
  // The route is ordinarily protected by requireAuth. This fixture supplies
  // the already validated identity without a production signing secret.
  const token = Buffer.from(JSON.stringify({jti:sid})).toString('base64') + '.fixture';
  const app = new Hono(); registerEventRoutes(app);
  const response = await app.request('/api/events/stream', {headers:{cookie:'axon_session='+token}});
  const reader = response.body!.getReader(); await reader.read();
  await revokeSession(sid);
  const result = await Promise.race([reader.read(), Bun.sleep(500).then(()=>({done:false}))]);
  expect(result.done).toBe(true);
  await reader.cancel();
});
