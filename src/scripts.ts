import { readFile, writeFile, mkdir } from 'fs/promises';
import * as path from 'path';
import type { Hono } from 'hono';
import { runJob, getJob, killJob } from './jobs';

// ---------- Script library + scheduler + inbound webhooks ----------
// Named one-tap commands runnable from the UI, on a schedule, or from a
// secret URL. Every run goes through the job runner (live log + history +
// notification).

export interface Script {
  id: string;
  name: string;
  cmd: string;
  description?: string;
  user: 'user' | 'root';
  schedule?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMin?: number; // vacío/undefined → default del job runner (30m)
  hookToken: string;
  lastRun?: { t: number; jobId: string; ok: boolean };
  history?: { t: number; jobId: string; ok: boolean }[]; // últimas N ejecuciones
  enabled: boolean; // false = pausado: sin schedule ni webhook; manual sigue
}

const HISTORY_MAX = 10;

// Límites server-side del payload (el cliente valida también, esto manda).
const LIMITS = { name: 80, cmd: 8000, description: 300, schedule: 40, cwd: 300, envCount: 32, envVal: 2000 };
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

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
      let migrated = false;
      for (const s of scripts) {
        if (!s.hookToken) s.hookToken = crypto.randomUUID();
        if (s.user !== 'root') s.user = 'user';
        if (typeof s.enabled !== 'boolean') s.enabled = true;
        if (s.env && typeof s.env !== 'object') s.env = undefined;
        if (s.history && !Array.isArray(s.history)) s.history = undefined;
        // Migración 2026-10-06: el seed "Actualizar sistema (apt)" venía
        // programado a las 03:00 y corría `apt upgrade -y` desatendido cada
        // noche. Se desprograma — el usuario puede reactivarlo explícitamente.
        if (s.name === SEED_APT.name && s.cmd === SEED_APT.cmd && s.schedule === '03:00') {
          s.schedule = undefined;
          migrated = true;
        }
      }
      if (migrated) saveSoon();
      return;
    }
  } catch { /* missing or corrupt — seed below */ }
  seedScripts();
}

// Seed de actualización: SIN programación por defecto — correr `apt upgrade
// -y` desatendido cada noche es riesgoso; programarlo requiere opt-in
// explícito editando el script.
const SEED_APT = { name: 'Actualizar sistema (apt)', cmd: 'apt update && apt upgrade -y' };

function seedScripts(): void {
  scripts = [
    {
      id: crypto.randomUUID(),
      name: SEED_APT.name,
      cmd: SEED_APT.cmd,
      description: 'Actualiza los paquetes del sistema. Manual por defecto: asignale una programación solo si aceptás upgrades desatendidos.',
      user: 'root',
      timeoutMin: 60,
      hookToken: crypto.randomUUID(),
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      name: 'Liberar espacio Docker',
      cmd: 'docker system prune -f',
      description: 'Borra contenedores parados, redes y builds sin uso.',
      user: 'root',
      timeoutMin: 15,
      hookToken: crypto.randomUUID(),
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      name: 'Backup config',
      cmd: 'tar czf /tmp/config-backup-$(date +%F).tgz -C "$HOME/compose" .',
      description: 'Comprime la carpeta de compose en /tmp.',
      user: 'user',
      timeoutMin: 30,
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
  }, 1500);
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
  const parts = t.split(/\s+/);
  // Fast-path only a bare "*/N" (single field). "*/15 3" is a two-field
  // cron-lite expression — it must fall through to fieldMatches below or it
  // would fire every 15 min all day instead of only during hour 3.
  if (parts.length === 1 && t.startsWith('*/')) {
    const n = parseInt(t.slice(2), 10);
    return n >= 1 && (h * 60 + m) % n === 0;
  }
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

const shq = (v: string) => `'${v.replace(/'/g, `'"'"'`)}'`;

// Wraps the user command with its env exports and cwd. All values are
// shell-quoted; the wrapper runs under the same `bash -lc` as the command.
function buildStepCmd(s: Script): string {
  const pre: string[] = [];
  for (const [k, v] of Object.entries(s.env || {})) pre.push(`export ${k}=${shq(v)};`);
  // `|| exit` evita correr el comando en el cwd equivocado si el cd falla.
  if (s.cwd) pre.push(`cd ${shq(s.cwd)} || exit 1;`);
  pre.push(s.cmd);
  return pre.join(' ');
}

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
    {
      label: `${s.name}${source !== 'manual' ? ` (${source === 'schedule' ? 'programado' : 'webhook'})` : ''}`,
      cmd: buildStepCmd(s),
      displayCommand: s.cmd, // el log muestra el comando del usuario, no el wrapper
      user: s.user,
      // Timeout por script; undefined → default generoso del job runner.
      timeoutMs: s.timeoutMin && s.timeoutMin > 0 ? s.timeoutMin * 60_000 : undefined,
    },
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
    // Only release the guard when the job is really done AND the guard still
    // belongs to this job — a newer run may have claimed it while this
    // watcher slept; deleting unconditionally would drop the new run's lock.
    if ((!job || job.status !== 'running') && runningByScript.get(scriptId) === jobId) {
      runningByScript.delete(scriptId);
    }
    const s = scripts.find((x) => x.id === scriptId);
    if (s) {
      s.lastRun = { t: Date.now(), jobId, ok: job?.status === 'ok' };
      s.history = [...(s.history || []), s.lastRun].slice(-HISTORY_MAX);
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

// ''/null/{} → undefined (los campos opcionales se borran mandándolos vacíos).
function cleanOpt(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function validCwd(cwd: string): boolean {
  // Ruta absoluta del host, una sola línea y sin atravesar directorios.
  return /^\/[^\r\n]*$/.test(cwd) && !cwd.split('/').includes('..');
}

function validateBody(body: any, partial: boolean): { ok: boolean; error?: string } {
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return { ok: false, error: 'El nombre es obligatorio' };
    }
    if (body.name.length > LIMITS.name || /[\r\n]/.test(body.name)) {
      return { ok: false, error: `El nombre no puede superar ${LIMITS.name} caracteres ni tener saltos de línea` };
    }
  }
  if (!partial || body.cmd !== undefined) {
    if (typeof body.cmd !== 'string' || !body.cmd.trim()) {
      return { ok: false, error: 'El comando es obligatorio' };
    }
    if (body.cmd.length > LIMITS.cmd) {
      return { ok: false, error: `El comando no puede superar ${LIMITS.cmd} caracteres` };
    }
  }
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string' || body.description.length > LIMITS.description || /[\r\n]/.test(body.description)) {
      return { ok: false, error: `La descripción debe ser una línea de hasta ${LIMITS.description} caracteres` };
    }
  }
  if (body.user !== undefined && body.user !== 'user' && body.user !== 'root') {
    return { ok: false, error: "El usuario debe ser 'user' o 'root'" };
  }
  if (body.schedule !== undefined && body.schedule !== null && body.schedule !== '') {
    if (typeof body.schedule !== 'string' || body.schedule.length > LIMITS.schedule || !validSchedule(body.schedule)) {
      return {
        ok: false,
        error: 'Programación inválida — formatos: */N (cada N minutos), HH:MM (diario), o "M H" (minuto hora; soporta *, */N y listas como 3,15)',
      };
    }
  }
  if (body.cwd !== undefined && body.cwd !== null && body.cwd !== '') {
    if (typeof body.cwd !== 'string' || body.cwd.length > LIMITS.cwd || !validCwd(body.cwd.trim())) {
      return { ok: false, error: 'El directorio debe ser una ruta absoluta del host (sin "..")' };
    }
  }
  if (body.env !== undefined && body.env !== null) {
    if (typeof body.env !== 'object' || Array.isArray(body.env)) {
      return { ok: false, error: 'env debe ser un objeto CLAVE=valor' };
    }
    const entries = Object.entries(body.env);
    if (entries.length > LIMITS.envCount) {
      return { ok: false, error: `Máximo ${LIMITS.envCount} variables de entorno` };
    }
    for (const [k, v] of entries) {
      if (!ENV_KEY_RE.test(k)) return { ok: false, error: `Nombre de variable inválido: "${k}"` };
      if (typeof v !== 'string' || v.length > LIMITS.envVal || /[\r\n]/.test(v)) {
        return { ok: false, error: `El valor de "${k}" debe ser una línea de hasta ${LIMITS.envVal} caracteres` };
      }
    }
  }
  if (body.timeoutMin !== undefined && body.timeoutMin !== null && body.timeoutMin !== '') {
    const n = body.timeoutMin;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 1440) {
      return { ok: false, error: 'El timeout debe ser un número entero de minutos entre 1 y 1440' };
    }
  }
  return { ok: true };
}

// El hookToken es una credencial de ejecución: no viaja en el listado. La URL
// se obtiene on-demand con GET /api/scripts/:id/hook (y /hook/rotate).
function publicScript(s: Script) {
  const { hookToken, ...rest } = s;
  return rest;
}

function hookHandler(c: any) {
  const token = c.req.param('token');
  const s = scripts.find((x) => x.hookToken === token);
  c.header('Cache-Control', 'no-store');
  if (!s) return fail(c, 404, 'URL de webhook desconocida');
  if (!s.enabled) return fail(c, 403, 'Este script está pausado');
  const { job, already } = runScript(s, 'hook');
  return c.json({ ok: true, script: s.name, jobId: job.id, already });
}

// GET never executes — link prefetchers and scanners issue GETs. It only
// reports what a POST would do. no-store evita que un prefetch quede cacheado.
function hookInfoHandler(c: any) {
  const token = c.req.param('token');
  const s = scripts.find((x) => x.hookToken === token);
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  if (!s) return fail(c, 404, 'URL de webhook desconocida');
  return c.json({
    ok: true,
    script: s.name,
    enabled: s.enabled,
    running: !!runningByScript.get(s.id),
    method: 'POST',
    hint: 'Enviá un POST a esta misma URL para ejecutar el script.',
  });
}

export function registerScriptRoutes(app: Hono): void {
  // ----- Library CRUD (under /api → cookie auth applies) -----

  app.get('/api/scripts', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({
      ok: true,
      scripts: scripts.map(publicScript),
      running: Array.from(runningByScript, ([scriptId, jobId]) => ({ scriptId, jobId })),
    });
  });

  app.post('/api/scripts', async (c) => {
    const body = await c.req.json<any>().catch(() => ({}));
    const v = validateBody(body, false);
    if (!v.ok) return fail(c, 400, v.error!);
    const s: Script = {
      id: crypto.randomUUID(),
      name: body.name.trim(),
      cmd: body.cmd.trim(),
      description: cleanOpt(body.description),
      user: normalizeUser(body.user),
      schedule: cleanOpt(body.schedule),
      cwd: cleanOpt(body.cwd),
      env: body.env && Object.keys(body.env).length ? body.env : undefined,
      timeoutMin: typeof body.timeoutMin === 'number' ? body.timeoutMin : undefined,
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
    if (body.description !== undefined) s.description = cleanOpt(body.description);
    if (body.user !== undefined) s.user = normalizeUser(body.user);
    if (body.schedule !== undefined) {
      const sched = cleanOpt(body.schedule);
      if (sched !== s.schedule) lastFired.delete(s.id); // don't fire right after editing
      s.schedule = sched;
    }
    if (body.cwd !== undefined) s.cwd = cleanOpt(body.cwd);
    if (body.env !== undefined) {
      s.env = body.env && typeof body.env === 'object' && Object.keys(body.env).length ? body.env : undefined;
    }
    if (body.timeoutMin !== undefined) {
      s.timeoutMin = typeof body.timeoutMin === 'number' ? body.timeoutMin : undefined;
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
    const body = await c.req.json<any>().catch(() => ({}));
    const source: ScriptSource =
      body.source === 'schedule' || body.source === 'hook' ? body.source : 'manual';
    // "Pausado" frena solo los disparadores automáticos (schedule/webhook);
    // la ejecución manual desde el panel sigue disponible.
    if (!s.enabled && source !== 'manual') return fail(c, 403, 'Este script está pausado');
    const { job, already } = runScript(s, source);
    return c.json({ ok: true, jobId: job.id, job, already, paused: !s.enabled });
  });

  // Cancela la ejecución en curso (mata el árbol de procesos del paso actual).
  app.post('/api/scripts/:id/cancel', (c) => {
    const s = scripts.find((x) => x.id === c.req.param('id'));
    if (!s) return fail(c, 404, 'Script no encontrado');
    const jobId = runningByScript.get(s.id);
    const job = jobId ? getJob(jobId) : undefined;
    if (!job || job.status !== 'running') return fail(c, 409, 'El script no está corriendo');
    if (!killJob(job.id)) return fail(c, 409, 'No se pudo detener el proceso');
    return c.json({ ok: true });
  });

  app.get('/api/scripts/:id/hook', (c) => {
    const s = scripts.find((x) => x.id === c.req.param('id'));
    if (!s) return fail(c, 404, 'Script no encontrado');
    return c.json({ ok: true, url: `/x/hook/${s.hookToken}`, method: 'POST' });
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
  app.get('/x/hook/:token', hookInfoHandler);
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
