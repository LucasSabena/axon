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
