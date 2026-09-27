import { readFile, writeFile, mkdir } from 'fs/promises';
import * as path from 'path';
import type { Hono } from 'hono';
import { runJob, getJob } from './jobs';

// ---------- Script library + scheduler + inbound webhooks ----------
// Named one-tap commands runnable from the UI, on a schedule, or from a
// secret URL. Every run goes through the job runner (live log + history +
// notification).

export interface Script {
  id: string;
  name: string;
  cmd: string;
  user: 'user' | 'root';
  schedule?: string;
  hookToken: string;
  lastRun?: { t: number; jobId: string; ok: boolean };
  enabled: boolean;
}

export type ScriptSource = 'manual' | 'schedule' | 'hook';

const FILE = path.join(
  path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),
  'scripts.json'
);

let scripts: Script[] = [];
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

// scriptId → jobId currently running
const runningByScript = new Map<string, string>();
// scriptId → last minute-slot fired (epoch minutes); prevents double-fires
const lastFired = new Map<string, number>();

// ---------- Persistence (same debounced pattern as heartbeats.ts) ----------

async function loadScripts(): Promise<void> {
  try {
    const raw = await readFile(FILE, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.scripts)) {
      scripts = obj.scripts.filter(
        (s: Script) => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.cmd === 'string'
      );
      for (const s of scripts) {
        if (!s.hookToken) s.hookToken = crypto.randomUUID();
        if (s.user !== 'root') s.user = 'user';
        if (typeof s.enabled !== 'boolean') s.enabled = true;
      }
      return;
    }
  } catch { /* missing or corrupt — seed below */ }
  seedScripts();
}

function seedScripts(): void {
  scripts = [
    {
      id: crypto.randomUUID(),
      name: 'Actualizar sistema (apt)',
      cmd: 'apt update && apt upgrade -y',
      user: 'root',
      schedule: '03:00',
      hookToken: crypto.randomUUID(),
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      name: 'Liberar espacio Docker',
      cmd: 'docker system prune -f',
      user: 'root',
      hookToken: crypto.randomUUID(),
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      name: 'Backup config',
      cmd: 'tar czf /tmp/config-backup-$(date +%F).tgz -C "$HOME/server-stack" .',
      user: 'user',
      hookToken: crypto.randomUUID(),
      enabled: true,
    },
  ];
  saveSoon();
}

function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeQueue = writeQueue.then(async () => {
      try {
        await mkdir(path.dirname(FILE), { recursive: true });
        await writeFile(FILE, JSON.stringify({ scripts }, null, 2));
      } catch { /* best-effort */ }
    });
  }, 4000);
  (saveTimer as { unref?: () => void })?.unref?.();
}

await loadScripts();

// ---------- Schedule parsing ----------
// Supported formats (documented for the UI):
//   */N      → every N minutes, aligned to wall clock (*/15 → :00 :15 :30 :45)
//   HH:MM    → once a day at that local time
//   M H      → cron-lite, two fields "minute hour"; each field supports
//              `*`, `*/N`, plain numbers and comma lists (`3,15`, `*/10,45`)

const FIELD_RE = /^(\*|\*\/\d+|\d+)(,(\*|\*\/\d+|\d+))*$/;

function fieldNumbersOk(field: string, max: number): boolean {
  return field.split(',').every((part) => {
    const p = part.trim();
    if (p === '*') return true;
    const m = p.match(/^\*\/(\d+)$/);
    if (m) return parseInt(m[1], 10) >= 1;
    const n = parseInt(p, 10);
    return Number.isInteger(n) && n >= 0 && n <= max;
  });
}

export function validSchedule(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/^\*\/\d+$/.test(t)) return parseInt(t.slice(2), 10) >= 1;
  const hm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return parseInt(hm[1], 10) <= 23 && parseInt(hm[2], 10) <= 59;
  const parts = t.split(/\s+/);
  if (parts.length !== 2) return false;
  return (
    FIELD_RE.test(parts[0]) && FIELD_RE.test(parts[1]) &&
    fieldNumbersOk(parts[0], 59) && fieldNumbersOk(parts[1], 23)
  );
}

function fieldMatches(field: string, value: number): boolean {
  return field.split(',').some((raw) => {
    const p = raw.trim();
    if (p === '*') return true;
    const step = p.match(/^\*\/(\d+)$/);
    if (step) {
      const n = parseInt(step[1], 10);
      return n >= 1 && value % n === 0;
    }
    return parseInt(p, 10) === value;
  });
}

function scheduleMatches(schedule: string, d: Date): boolean {
  const t = schedule.trim();
  const m = d.getMinutes();
  const h = d.getHours();
  if (t.startsWith('*/')) {
    const n = parseInt(t.slice(2), 10);
    return n >= 1 && (h * 60 + m) % n === 0;
  }
  const parts = t.split(/\s+/);
  if (parts.length === 1 && parts[0].includes(':')) {
    const [hh, mm] = parts[0].split(':').map(Number);
    return h === hh && m === mm;
  }
  if (parts.length === 2) {
    return fieldMatches(parts[0], m) && fieldMatches(parts[1], h);
  }
  return false;
}

// ---------- Run ----------

export function runScript(
  s: Script,
  source: ScriptSource = 'manual'
): { job: ReturnType<typeof runJob>; already: boolean } {
  const existing = runningByScript.get(s.id);
  const existingJob = existing ? getJob(existing) : undefined;
  if (existingJob && existingJob.status === 'running') {
    return { job: existingJob, already: true };
  }
  const job = runJob(`Script: ${s.name}`, [
    { label: `${s.name}${source !== 'manual' ? ` (${source === 'schedule' ? 'programado' : 'webhook'})` : ''}`, cmd: s.cmd, user: s.user },
  ]);
  runningByScript.set(s.id, job.id);
  void watchJob(s.id, job.id);
  return { job, already: false };
}

async function watchJob(scriptId: string, jobId: string): Promise<void> {
  try {
    // Poll until the job leaves 'running' — no cap: a hard timeout would
    // clear the concurrency guard and record a bogus lastRun while the job
    // still executes.
    while (true) {
      await new Promise((r) => setTimeout(r, 1500));
      const job = getJob(jobId);
      if (!job || job.status !== 'running') break;
    }
  } finally {
    const job = getJob(jobId);
    // Only release the guard when the job is really done; a pruned/missing
    // job record also releases (nothing left to wait for).
    if (!job || job.status !== 'running') runningByScript.delete(scriptId);
    const s = scripts.find((x) => x.id === scriptId);
    if (s) {
      s.lastRun = { t: Date.now(), jobId, ok: job?.status === 'ok' };
      saveSoon();
    }
  }
}

// ---------- Routes ----------

function fail(c: any, status: number, error: string, extra?: Record<string, unknown>) {
  return c.json({ ok: false, error, ...extra }, status);
}

function normalizeUser(u: unknown): 'user' | 'root' {
  return u === 'root' ? 'root' : 'user';
}

function validateBody(body: any, partial: boolean): { ok: boolean; error?: string } {
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return { ok: false, error: 'El nombre es obligatorio' };
    }
  }
  if (!partial || body.cmd !== undefined) {
    if (typeof body.cmd !== 'string' || !body.cmd.trim()) {
      return { ok: false, error: 'El comando es obligatorio' };
    }
  }
  if (body.user !== undefined && body.user !== 'user' && body.user !== 'root') {
    return { ok: false, error: "El usuario debe ser 'user' o 'root'" };
  }
  if (body.schedule !== undefined && body.schedule !== null && body.schedule !== '') {
    if (typeof body.schedule !== 'string' || !validSchedule(body.schedule)) {
      return {
        ok: false,
        error: 'Programación inválida — formatos: */N (cada N minutos), HH:MM (diario), o "M H" (minuto hora; soporta *, */N y listas como 3,15)',
      };
    }
  }
  return { ok: true };
}

function publicScript(s: Script) {
  return { ...s, hookPath: `/x/hook/${s.hookToken}` };
}

function hookHandler(c: any) {
  const token = c.req.param('token');
  const s = scripts.find((x) => x.hookToken === token);
  if (!s) return fail(c, 404, 'URL de webhook desconocida');
  if (!s.enabled) return fail(c, 403, 'Este script está desactivado');
  const { job, already } = runScript(s, 'hook');
  return c.json({ ok: true, script: s.name, jobId: job.id, already });
}

export function registerScriptRoutes(app: Hono): void {
  // ----- Library CRUD (under /api → cookie auth applies) -----

  app.get('/api/scripts', (c) =>
    c.json({
      ok: true,
      scripts: scripts.map(publicScript),
      running: Array.from(runningByScript, ([scriptId, jobId]) => ({ scriptId, jobId })),
    })
  );

  app.post('/api/scripts', async (c) => {
    const body = await c.req.json<any>().catch(() => ({}));
    const v = validateBody(body, false);
    if (!v.ok) return fail(c, 400, v.error!);
    const s: Script = {
      id: crypto.randomUUID(),
      name: body.name.trim(),
      cmd: body.cmd.trim(),
      user: normalizeUser(body.user),
      schedule: body.schedule?.trim() || undefined,
      hookToken: crypto.randomUUID(),
      enabled: body.enabled === false ? false : true,
    };
    scripts.push(s);
    lastFired.delete(s.id);
    saveSoon();
    return c.json({ ok: true, script: publicScript(s) });
  });

  app.put('/api/scripts/:id', async (c) => {
    const s = scripts.find((x) => x.id === c.req.param('id'));
    if (!s) return fail(c, 404, 'Script no encontrado');
    const body = await c.req.json<any>().catch(() => ({}));
    const v = validateBody(body, true);
    if (!v.ok) return fail(c, 400, v.error!);
    if (body.name !== undefined) s.name = body.name.trim();
    if (body.cmd !== undefined) s.cmd = body.cmd.trim();
    if (body.user !== undefined) s.user = normalizeUser(body.user);
    if (body.schedule !== undefined) {
      const sched = (body.schedule || '').trim() || undefined;
      if (sched !== s.schedule) lastFired.delete(s.id); // don't fire right after editing
      s.schedule = sched;
    }
    if (body.enabled !== undefined) s.enabled = !!body.enabled;
    saveSoon();
    return c.json({ ok: true, script: publicScript(s) });
  });

  app.delete('/api/scripts/:id', (c) => {
    const id = c.req.param('id');
    const before = scripts.length;
    scripts = scripts.filter((x) => x.id !== id);
    if (scripts.length === before) return fail(c, 404, 'Script no encontrado');
    lastFired.delete(id);
    saveSoon();
    return c.json({ ok: true });
  });

  app.post('/api/scripts/:id/run', async (c) => {
    const s = scripts.find((x) => x.id === c.req.param('id'));
    if (!s) return fail(c, 404, 'Script no encontrado');
    if (!s.enabled) return fail(c, 403, 'Este script está desactivado');
    const body = await c.req.json<any>().catch(() => ({}));
    const source: ScriptSource =
      body.source === 'schedule' || body.source === 'hook' ? body.source : 'manual';
    const { job, already } = runScript(s, source);
    return c.json({ ok: true, jobId: job.id, job, already });
  });

  app.get('/api/scripts/:id/hook', (c) => {
    const s = scripts.find((x) => x.id === c.req.param('id'));
    if (!s) return fail(c, 404, 'Script no encontrado');
    return c.json({ ok: true, url: `/x/hook/${s.hookToken}`, method: 'POST', alsoAccepts: 'GET' });
  });

  app.post('/api/scripts/:id/hook/rotate', (c) => {
    const s = scripts.find((x) => x.id === c.req.param('id'));
    if (!s) return fail(c, 404, 'Script no encontrado');
    s.hookToken = crypto.randomUUID();
    saveSoon();
    return c.json({ ok: true, url: `/x/hook/${s.hookToken}`, script: publicScript(s) });
  });

  // ----- Inbound webhooks — PUBLIC (intentionally not under /api) -----
  // The cookie-auth middleware only covers /api/* and /p/*, so these secret-
  // token URLs work from a phone bookmark, curl, or an ntfy action button.
  app.post('/x/hook/:token', hookHandler);
  app.get('/x/hook/:token', hookHandler);
}

// ---------- Scheduler ----------

// Checks every 30s. A script fires when its schedule matches the current
// minute and it hasn't already fired in that minute-slot. Scripts never fire
// on boot or right after being created/edited (lastFired initializes to now).
export function startScriptScheduler(): void {
  const timer = setInterval(() => {
    try {
      tickScheduler();
    } catch { /* keep ticking */ }
  }, 30_000);
  timer.unref();
}

function tickScheduler(): void {
  const now = Date.now();
  const slot = Math.floor(now / 60_000);
  const d = new Date(now);
  const ids = new Set(scripts.map((s) => s.id));
  for (const id of lastFired.keys()) {
    if (!ids.has(id)) lastFired.delete(id);
  }
  for (const s of scripts) {
    if (!s.enabled || !s.schedule) continue;
    const last = lastFired.get(s.id);
    if (last === undefined) {
      lastFired.set(s.id, slot);
      continue;
    }
    if (last === slot) continue;
    if (scheduleMatches(s.schedule, d)) {
      lastFired.set(s.id, slot);
      try {
        runScript(s, 'schedule');
      } catch { /* a broken script shouldn't stop the scheduler */ }
    }
  }
}

export function listScripts(): Script[] {
  return scripts;
}
