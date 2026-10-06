import { readFile, writeFile, mkdir } from 'fs/promises';
import * as path from 'path';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

// Persisted event feed — "what happened while I was away".
// Ring buffer of the last 500 events, saved next to config.json,
// same persistence pattern as heartbeats.ts / jobs.ts.
export interface AppEvent {
  id: string;
  t: number; // epoch ms
  type: 'auth' | 'alert' | 'job' | 'domain' | 'system' | 'info' | 'file' | 'agent';
  title: string;
  detail?: string;
  read?: boolean;
  target?: { section: string; params?: Record<string, string> };
}

const FILE = path.join(
  path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),
  'events.json'
);
const MAX_EVENTS = 500;

let events: AppEvent[] = []; // newest last
let loaded = false;
let revision = 0;
const subscribers = new Set<() => void>();
function changed() { revision++; for (const listener of subscribers) listener(); }
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export async function loadEvents(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await readFile(FILE, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      events = arr
        .filter((e) => e && typeof e.id === 'string' && typeof e.t === 'number' && typeof e.title === 'string')
        .slice(-MAX_EVENTS);
    }
  } catch { /* missing/corrupt file — start fresh */ }
}

function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeQueue = writeQueue.then(async () => {
      try {
        await mkdir(path.dirname(FILE), { recursive: true });
        await writeFile(FILE, JSON.stringify(events));
      } catch { /* best-effort */ }
    });
  }, 5000);
  (saveTimer as { unref?: () => void })?.unref?.();
}

export function recordEvent(
  type: AppEvent['type'],
  title: string,
  detail?: string,
  target?: AppEvent['target']
): void {
  events.push({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    t: Date.now(),
    type,
    title,
    detail,
    target,
    read: false,
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  saveSoon();
  changed();
}

// Newest first. unreadOnly filters to events not yet marked read.
export function listEvents(limit = 100, unreadOnly = false): AppEvent[] {
  const src = unreadOnly ? events.filter((e) => !e.read) : events;
  const n = Math.max(1, Math.min(limit, MAX_EVENTS));
  return src.slice(-n).reverse();
}

export function markAllRead(ids?: string[]): void {
  const selected = ids ? new Set(ids) : null;
  let dirty = false;
  for (const e of events) {
    if (!e.read && (!selected || selected.has(e.id))) { e.read = true; dirty = true; }
  }
  if (dirty) { saveSoon(); changed(); }
}

export function unreadCount(): number {
  let n = 0;
  for (const e of events) if (!e.read) n++;
  return n;
}

export function clearEvents(): void {
  events = [];
  saveSoon();
  changed();
}

export function registerEventRoutes(app: Hono): void {
  app.get('/api/events/stream', c => {
    c.header('Cache-Control', 'private, no-store, no-transform');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async stream => {
      let wake: (() => void) | null = null;
      const changed = () => wake?.();
      subscribers.add(changed);
      stream.onAbort(changed);
      let last = -1;
      try {
        while (!stream.aborted && !stream.closed) {
          if (last !== revision) {
            last = revision;
            await stream.writeSSE({ event:'change', id:String(revision), data:JSON.stringify({unread:unreadCount()}) });
          } else await stream.write(': heartbeat\n\n');
          await new Promise<void>(resolve => {
            const timer = setTimeout(done, 20_000);
            function done() { clearTimeout(timer); wake=null; resolve(); }
            wake=done;
            if (stream.aborted || revision !== last) done();
          });
        }
      } finally { subscribers.delete(changed); }
    });
  });
  app.get('/api/events', (c) => {
    const limit = parseInt(c.req.query('limit') || '100', 10) || 100;
    const unreadOnly = c.req.query('unread') === '1' || c.req.query('unread') === 'true';
    return c.json({ ok: true, events: listEvents(limit, unreadOnly), unread: unreadCount() });
  });

  app.post('/api/events/read', async (c) => {
    const body = await c.req.json<{ids?: string[]}>().catch(() => ({} as {ids?: string[]}));
    if (body.ids != null && (!Array.isArray(body.ids) || body.ids.some(id => typeof id !== 'string') || body.ids.length > MAX_EVENTS)) return c.json({ok:false,error:'Lista de eventos inválida'},400);
    markAllRead(body.ids);
    return c.json({ ok: true, unread: unreadCount() });
  });

  app.post('/api/events/clear', (c) => {
    clearEvents();
    return c.json({ ok: true, events: [], unread: 0 });
  });
}
