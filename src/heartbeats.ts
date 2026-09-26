import { readFile, writeFile, mkdir } from 'fs/promises';
import * as path from 'path';

// Uptime history per domain — capped rolling ticks persisted next to config,
// same pattern as jobs.ts persistence.
export interface Heartbeat {
  t: number; // epoch ms
  s: 'up' | 'warn' | 'down';
  ms?: number; // latency when probed
}

const FILE = path.join(
  path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),
  'heartbeats.json'
);
const MAX_TICKS = 1440; // ~24h at one probe/min
const store = new Map<string, Heartbeat[]>();
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export async function loadHeartbeats(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await readFile(FILE, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      for (const [k, arr] of Object.entries(obj)) {
        if (Array.isArray(arr)) store.set(k, arr.slice(-MAX_TICKS));
      }
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
        await writeFile(FILE, JSON.stringify(Object.fromEntries(store)));
      } catch { /* best-effort */ }
    });
  }, 5000);
}

export function recordHeartbeat(id: string, s: Heartbeat['s'], ms?: number): void {
  const arr = store.get(id) || [];
  arr.push({ t: Date.now(), s, ms });
  if (arr.length > MAX_TICKS) arr.splice(0, arr.length - MAX_TICKS);
  store.set(id, arr);
  saveSoon();
}

export function lastState(id: string): Heartbeat['s'] | null {
  const arr = store.get(id);
  return arr && arr.length ? arr[arr.length - 1].s : null;
}

export function allHeartbeats(): Record<string, Heartbeat[]> {
  return Object.fromEntries(store);
}

// uptime % over the last N ticks
export function uptimePct(id: string, last = 288): number | null {
  const arr = (store.get(id) || []).slice(-last);
  if (!arr.length) return null;
  const up = arr.filter((h) => h.s === 'up').length;
  return Math.round((up / arr.length) * 1000) / 10;
}
