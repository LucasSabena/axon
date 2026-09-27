import { readFile, writeFile, mkdir } from 'fs/promises';
import * as path from 'path';
import type { Hono } from 'hono';

// Persisted event feed — "what happened while I was away".
// Ring buffer of the last 500 events, saved next to config.json,
// same persistence pattern as heartbeats.ts / jobs.ts.
export interface AppEvent {
  id: string;
  t: number; // epoch ms
  type: 'alert' | 'job' | 'domain' | 'system' | 'info';
  title: string;
  detail?: string;
  read?: boolean;
}

const FILE = path.join(
  path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),
  'events.json'
);
const MAX_EVENTS = 500;

let events: AppEvent[] = []; // newest last
let loaded = false;
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
  detail?: string
): void {
  events.push({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    t: Date.now(),
    type,
    title,
    detail,
    read: false,
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  saveSoon();
}

// Newest first. unreadOnly filters to events not yet marked read.
export function listEvents(limit = 100, unreadOnly = false): AppEvent[] {
  const src = unreadOnly ? events.filter((e) => !e.read) : events;
  const n = Math.max(1, Math.min(limit, MAX_EVENTS));
  return src.slice(-n).reverse();
}

export function markAllRead(): void {
  let dirty = false;
  for (const e of events) {
    if (!e.read) { e.read = true; dirty = true; }
  }
  if (dirty) saveSoon();
}

export function unreadCount(): number {
  let n = 0;
  for (const e of events) if (!e.read) n++;
  return n;
}

export function clearEvents(): void {
  events = [];
  saveSoon();
}

export function registerEventRoutes(app: Hono): void {
  app.get('/api/events', (c) => {
    const limit = parseInt(c.req.query('limit') || '100', 10) || 100;
    const unreadOnly = c.req.query('unread') === '1' || c.req.query('unread') === 'true';
    return c.json({ ok: true, events: listEvents(limit, unreadOnly), unread: unreadCount() });
  });

  app.post('/api/events/read', (c) => {
    markAllRead();
    return c.json({ ok: true, unread: 0 });
  });

  app.post('/api/events/clear', (c) => {
    clearEvents();
    return c.json({ ok: true, events: [], unread: 0 });
  });
}
