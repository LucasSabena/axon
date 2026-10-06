import { $ } from 'bun';
import { readFile, writeFile, mkdir } from 'fs/promises';
import * as path from 'path';
import type { Hono } from 'hono';
import { getServerStats } from './stats';
import { hostExec } from './host';
import { notify } from './notify';
import { recordEvent } from './events';

// Threshold watcher — fires outbound notifications (ntfy/Discord/Gotify via
// notify.ts) AND appends to the persisted event feed (events.ts) when the
// server drifts into a bad state: disk full, sustained CPU, RAM pressure,
// crash-looping containers, failed systemd units, SMART degradation.

export interface AlertThresholds {
  diskPct: number;   // disk usage % that triggers an alert
  cpuPct: number;    // cpu % that must be sustained...
  cpuMinutes: number; // ...for this many consecutive minutes
  memPct: number;    // ram usage %
}

export interface ActiveAlert {
  key: string;
  title: string;
  detail: string;
  since: number; // epoch ms when it started firing
  severity: 'warning' | 'critical';
}

const FILE = path.join(
  path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),
  'alerts.json'
);
const TICK_MS = 60_000;
const NOTIFY_COOLDOWN_MS = 30 * 60_000; // re-notify at most every 30 min per key

const DEFAULT_THRESHOLDS: AlertThresholds = {
  diskPct: 85,
  cpuPct: 90,
  cpuMinutes: 10,
  memPct: 90,
};

let thresholds: AlertThresholds = { ...DEFAULT_THRESHOLDS };
const active = new Map<string, ActiveAlert>();
const lastFired = new Map<string, number>(); // key → last notify ts
const knownFailedUnits = new Set<string>(); // systemd units we've already alerted on
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let ticking = false;

// --- persistence (alerts.json holds thresholds + the firing set so a restart
// doesn't re-spam notifications for alerts that were already firing) ---

function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeQueue = writeQueue.then(async () => {
      try {
        await mkdir(path.dirname(FILE), { recursive: true });
        const payload = {
          thresholds,
          active: Array.from(active.values()).map((a) => ({
            ...a,
            lastFired: lastFired.get(a.key) || a.since,
          })),
        };
        await writeFile(FILE, JSON.stringify(payload, null, 2));
      } catch { /* best-effort */ }
    });
  }, 3000);
  (saveTimer as { unref?: () => void })?.unref?.();
}

async function loadAlerts(): Promise<void> {
  try {
    const raw = await readFile(FILE, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      thresholds = { ...DEFAULT_THRESHOLDS, ...(obj.thresholds || {}) };
      if (Array.isArray(obj.active)) {
        for (const a of obj.active) {
          if (a && typeof a.key === 'string' && a.title) {
            active.set(a.key, {
              key: a.key,
              title: a.title,
              detail: a.detail || '',
              since: typeof a.since === 'number' ? a.since : Date.now(),
              severity: a.severity === 'critical' ? 'critical' : 'warning',
            });
            if (typeof a.lastFired === 'number') lastFired.set(a.key, a.lastFired);
            // Don't treat still-firing systemd units as "new" after a restart.
            if (a.key.startsWith('systemd:')) knownFailedUnits.add(a.key.slice('systemd:'.length));
          }
        }
      }
    }
  } catch { /* missing/corrupt file — start with defaults */ }
}

// --- firing / recovery ---
// Checks push candidates into `current`; `silent` holds keys that should be
// tracked as active but must NOT notify (e.g. a systemd unit that stays
// failed — we alert once when it's first seen, then just keep it listed).

function fire(candidate: ActiveAlert, doNotify: boolean): void {
  const prev = active.get(candidate.key);
  active.set(candidate.key, { ...candidate, since: prev?.since ?? candidate.since });

  if (!doNotify) return;
  const last = lastFired.get(candidate.key) ?? 0;
  if (Date.now() - last < NOTIFY_COOLDOWN_MS) return; // still cooling down

  lastFired.set(candidate.key, Date.now());
  notify(candidate.title, candidate.detail, candidate.severity === 'critical' ? 5 : 4).catch(() => {});
  recordEvent('alert', candidate.title, candidate.detail);
}

function reconcile(current: Map<string, ActiveAlert>, silent: Set<string>): void {
  let dirty = false;
  for (const [key, cand] of current) {
    const had = active.has(key);
    fire(cand, !silent.has(key));
    if (!had) dirty = true;
  }
  for (const [key, prev] of Array.from(active.entries())) {
    if (!current.has(key)) {
      active.delete(key);
      lastFired.delete(key);
      recordEvent('info', `${prev.title} — recuperado`, prev.detail);
      dirty = true;
    }
  }
  if (dirty) saveSoon();
}

// --- individual checks: each pushes candidates into `current` ---

let cpuOverMinutes = 0;

async function checkResources(current: Map<string, ActiveAlert>): Promise<void> {
  const stats = await getServerStats();

  if (stats.diskPercent >= thresholds.diskPct) {
    current.set('disk', {
      key: 'disk',
      title: `Disco casi lleno (${stats.diskPercent}%)`,
      detail: `Usados ${stats.diskUsedGb}GB de ${stats.diskTotalGb}GB — umbral ${thresholds.diskPct}%`,
      since: Date.now(),
      severity: 'critical',
    });
  }

  if (stats.cpuPercent >= thresholds.cpuPct) cpuOverMinutes++;
  else cpuOverMinutes = 0;
  if (cpuOverMinutes >= thresholds.cpuMinutes) {
    current.set('cpu', {
      key: 'cpu',
      title: `CPU alta sostenida (${stats.cpuPercent}%)`,
      detail: `Por encima del ${thresholds.cpuPct}% durante ${cpuOverMinutes} minutos seguidos`,
      since: Date.now(),
      severity: 'warning',
    });
  }

  if (stats.memoryPercent >= thresholds.memPct) {
    current.set('mem', {
      key: 'mem',
      title: `RAM casi llena (${stats.memoryPercent}%)`,
      detail: `Usados ${stats.memoryUsedMb}MB de ${stats.memoryTotalMb}MB — umbral ${thresholds.memPct}%`,
      since: Date.now(),
      severity: 'warning',
    });
  }
}

const lastRestartCounts = new Map<string, number>();

const DOCKER_ID_SAFE = /^[a-zA-Z0-9_.-]+$/;
const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

async function checkContainers(current: Map<string, ActiveAlert>): Promise<void> {
  // One inspect for every container — cheap enough once a minute.
  const psRes = await $`docker ps -aq`.quiet().nothrow().catch(() => null);
  let ids = psRes ? psRes.stdout.toString().trim() : '';
  // The docker CLI may only exist on the host — fall back via nsenter when
  // the in-container call fails (empty output with exit 0 = no containers).
  const useHost = !psRes || psRes.exitCode !== 0;
  if (useHost) {
    const res = await hostExec('docker ps -aq', { user: 'user', timeoutMs: 20_000 }).catch(() => null);
    ids = res?.ok ? res.stdout.trim() : '';
  }
  const seen = new Set<string>();
  if (ids) {
    const list = ids.split('\n').map((s) => s.trim()).filter((s) => DOCKER_ID_SAFE.test(s));
    let out = '';
    if (list.length) {
      const fmt = '{{.Name}}|{{.RestartCount}}|{{.State.Status}}';
      if (useHost) {
        const res = await hostExec(`docker inspect ${list.map(shq).join(' ')} --format ${shq(fmt)}`, {
          user: 'user',
          timeoutMs: 30_000,
        }).catch(() => null);
        out = res?.ok ? res.stdout : '';
      } else {
        out = await $`docker inspect ${list} --format ${fmt}`
          .nothrow()
          .text()
          .catch(() => '');
      }
    }
    for (const line of out.split('\n').filter(Boolean)) {
      const [rawName, rawCount, state] = line.split('|');
      const name = (rawName || '').replace(/^\//, '');
      if (!name) continue;
      seen.add(name);
      const count = parseInt(rawCount || '0', 10) || 0;
      const prev = lastRestartCounts.get(name);
      lastRestartCounts.set(name, count);
      const restarting = (state || '').toLowerCase() === 'restarting';
      const grew = prev !== undefined && count > prev;
      if (restarting || grew) {
        current.set(`container:${name}`, {
          key: `container:${name}`,
          title: `Contenedor reiniciándose: ${name}`,
          detail: `Estado "${state || '?'}", ${count} reinicios acumulados`,
          since: Date.now(),
          severity: 'critical',
        });
      }
    }
  }
  // Forget containers that disappeared so their stale counts don't confuse us.
  for (const name of lastRestartCounts.keys()) {
    if (!seen.has(name)) lastRestartCounts.delete(name);
  }
}

async function checkSystemd(current: Map<string, ActiveAlert>, silent: Set<string>): Promise<void> {
  const scopes: Array<{ scope: 'user' | 'system'; cmd: string; user: 'user' | 'root' }> = [
    {
      scope: 'user',
      user: 'user',
      cmd: 'export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user list-units --failed --no-legend --plain --no-pager',
    },
    {
      scope: 'system',
      user: 'root',
      cmd: 'systemctl --system list-units --failed --no-legend --plain --no-pager',
    },
  ];
  const failedNow = new Set<string>();
  await Promise.all(scopes.map(async ({ scope, user, cmd }) => {
    const res = await hostExec(cmd, { user, timeoutMs: 20_000 });
    if (!res.ok && !res.stdout) return;
    for (const line of res.stdout.split('\n').filter(Boolean)) {
      // Lines may start with a ● / * state marker — grab the token that
      // actually looks like a unit name.
      const unit = line
        .trim()
        .split(/\s+/)
        .find((t) => /\.(service|socket|timer|mount|automount|path|scope|slice|device|swap)$/.test(t));
      if (!unit) continue;
      const tag = `${scope}:${unit}`;
      failedNow.add(tag);
      // Keep the alert listed while the unit stays failed, but only notify
      // the first time we see it — a permanently-failed unit shouldn't spam.
      const isNew = !knownFailedUnits.has(tag);
      knownFailedUnits.add(tag);
      if (!isNew) silent.add(`systemd:${tag}`);
      current.set(`systemd:${tag}`, {
        key: `systemd:${tag}`,
        title: `Unidad systemd fallida: ${unit}`,
        detail: `Scope ${scope}. Revisar con: journalctl ${scope === 'user' ? '--user' : ''} -u ${unit}`,
        since: Date.now(),
        severity: 'warning',
      });
    }
  }));
  for (const k of knownFailedUnits.keys()) {
    if (!failedNow.has(k)) knownFailedUnits.delete(k);
  }
}

let smartctlPath: string | null | undefined; // undefined = not probed yet

async function checkSmart(current: Map<string, ActiveAlert>): Promise<void> {
  if (smartctlPath === undefined) {
    const res = await hostExec('command -v smartctl', { user: 'root', timeoutMs: 10_000 });
    smartctlPath = res.ok && res.stdout.trim() ? res.stdout.trim() : null;
  }
  if (!smartctlPath) return; // binary missing — skip silently
  const res = await hostExec(`smartctl -H /dev/sda`, { user: 'root', timeoutMs: 15_000 });
  if (!res.ok && !res.stdout) return;
  const out = res.stdout;
  const result = out.match(/overall-health[^:]*:\s*(\w+)/i)?.[1] || '';
  if (result && result.toUpperCase() !== 'PASSED') {
    current.set('smart:sda', {
      key: 'smart:sda',
      title: `SMART: /dev/sda ${result}`,
      detail: 'El disco reporta degradación de salud — revisar smartctl -a /dev/sda',
      since: Date.now(),
      severity: 'critical',
    });
  }
}

// --- main loop ---

async function tick(): Promise<void> {
  if (ticking) return; // previous checks still running
  ticking = true;
  const current = new Map<string, ActiveAlert>();
  const silent = new Set<string>();
  try {
    await Promise.allSettled([
      checkResources(current),
      checkContainers(current),
      checkSystemd(current, silent),
      checkSmart(current),
    ]);
    reconcile(current, silent);
  } catch { /* a failing check must never kill the loop */ }
  ticking = false;
}

export function startAlertLoop(): void {
  loadAlerts()
    .catch(() => {})
    .finally(() => {
      tick().catch(() => {});
      setInterval(() => { tick().catch(() => {}); }, TICK_MS).unref();
    });
}

export function registerAlertRoutes(app: Hono): void {
  app.get('/api/alerts', (c) => {
    return c.json({
      ok: true,
      alerts: Array.from(active.values()).sort((a, b) => a.since - b.since),
      thresholds,
    });
  });

  app.put('/api/alerts/thresholds', async (c) => {
    const body = await c.req.json<Partial<AlertThresholds>>().catch(() => ({} as Partial<AlertThresholds>));
    const clamp = (v: unknown, min: number, max: number): number | undefined => {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (!Number.isFinite(n)) return undefined;
      return Math.max(min, Math.min(max, Math.round(n)));
    };
    const diskPct = clamp(body.diskPct, 1, 100);
    const cpuPct = clamp(body.cpuPct, 1, 100);
    const memPct = clamp(body.memPct, 1, 100);
    const cpuMinutes = clamp(body.cpuMinutes, 1, 1440);
    if (diskPct !== undefined) thresholds.diskPct = diskPct;
    if (cpuPct !== undefined) thresholds.cpuPct = cpuPct;
    if (memPct !== undefined) thresholds.memPct = memPct;
    if (cpuMinutes !== undefined) thresholds.cpuMinutes = cpuMinutes;
    saveSoon();
    return c.json({ ok: true, thresholds });
  });

  // Manual check-now for the UI / debugging.
  app.post('/api/alerts/check', async (c) => {
    await tick().catch(() => {});
    return c.json({ ok: true, alerts: Array.from(active.values()) });
  });
}
