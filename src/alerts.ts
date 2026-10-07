import { dockerRun } from './docker';
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
        // A probe that fails on the first tick after restart shouldn't be
        // able to tell these apart from "recovered" either.
        lastCurrent = new Map(active);
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

function reconcile(current: Map<string, ActiveAlert>, silent: Set<string>, preserve: Set<string>): void {
  let dirty = false;
  for (const [key, cand] of current) {
    const had = active.has(key);
    fire(cand, !silent.has(key));
    if (!had) dirty = true;
  }
  for (const [key, prev] of Array.from(active.entries())) {
    // Keys in `preserve` come from a check whose probe failed this tick —
    // missing candidates mean "unknown", not "recovered".
    if (!current.has(key) && !preserve.has(key)) {
      active.delete(key);
      lastFired.delete(key);
      recordEvent('info', `${prev.title} — recuperado`, prev.detail);
      dirty = true;
    }
  }
  if (dirty) saveSoon();
}

// --- individual checks: each pushes candidates into `current` ---

// Track the sustained-CPU window by wall clock, not by tick invocations —
// a manual POST /api/alerts/check must not count as a minute.
let cpuOverSince: number | null = null;

async function checkResources(current: Map<string, ActiveAlert>, preserve: Set<string>): Promise<void> {
  const stats = await getServerStats();
  const failed = new Set(stats.failedCollectors || []);
  // A collector that fell back to 0 says "unknown", not "recovered" — keep
  // the previous alert (and its cooldown) out of the delete pass. Per-volume
  // keys share the collector name as prefix ('disk' → 'disk:<mount>').
  for (const k of failed) {
    preserve.add(k);
    for (const key of lastCurrent.keys()) if (key.startsWith(`${k}:`)) preserve.add(key);
  }

  const fireDisk = (key: string, label: string, pct: number, detail: string) => {
    if (pct >= thresholds.diskPct) {
      current.set(key, {
        key,
        title: `Disco casi lleno: ${label} (${pct}%)`,
        detail: `${detail} — umbral ${thresholds.diskPct}%`,
        since: Date.now(),
        severity: 'critical',
      });
    }
  };
  if (!failed.has('disk') && stats.disksError) {
    // Volume inventory failed — "unknown", keep last tick's disk:* alerts.
    preserve.add('disk');
    for (const key of lastCurrent.keys()) if (key.startsWith('disk:')) preserve.add(key);
  } else if (!failed.has('disk')) {
    // Every mounted volume gets its own alert, not just the root filesystem.
    const volumes = (stats.disks || []).filter((v) => v.path && v.size > 0 && v.available != null);
    if (volumes.length) {
      for (const v of volumes) {
        const pct = Math.round(((v.size - v.available!) / v.size) * 100);
        fireDisk(`disk:${v.path}`, v.name || v.path!, pct, `${v.path} queda con ${Math.round(v.available! / (1024 ** 3))}GB libres de ${Math.round(v.size / (1024 ** 3))}GB`);
      }
    } else {
      fireDisk('disk:/', 'raíz', stats.diskPercent, `Usados ${stats.diskUsedGb}GB de ${stats.diskTotalGb}GB`);
    }
  }

  if (failed.has('cpu')) {
    // Unreadable /proc/stat: keep the sustained window instead of resetting it.
  } else if (stats.cpuPercent >= thresholds.cpuPct) {
    if (cpuOverSince === null) cpuOverSince = Date.now();
  } else {
    cpuOverSince = null;
  }
  const cpuOverMinutes = cpuOverSince === null ? 0 : (Date.now() - cpuOverSince) / 60_000;
  if (cpuOverMinutes >= thresholds.cpuMinutes) {
    current.set('cpu', {
      key: 'cpu',
      title: `CPU alta sostenida (${stats.cpuPercent}%)`,
      detail: `Por encima del ${thresholds.cpuPct}% durante ${Math.floor(cpuOverMinutes)} minutos seguidos`,
      since: Date.now(),
      severity: 'warning',
    });
  }

  if (!failed.has('mem') && stats.memoryPercent >= thresholds.memPct) {
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

// The candidates each check produced last tick — a probe failure preserves
// them instead of letting reconcile delete them and clear their cooldowns.
let lastCurrent = new Map<string, ActiveAlert>();

function preserveCheck(prefix: string, preserve: Set<string>): void {
  for (const key of lastCurrent.keys()) {
    if (key.startsWith(prefix)) preserve.add(key);
  }
}

async function checkContainers(current: Map<string, ActiveAlert>, preserve: Set<string>): Promise<void> {
  // One inspect for every container — cheap enough once a minute.
  // Use the bounded command shared with the Docker module. A hung local CLI
  // must not hold `ticking` forever and stop CPU/disk/systemd alerts as well.
  const psRes = await dockerRun('ps -aq', 20_000);
  if (!psRes.ok) { preserveCheck('container:', preserve); return; }
  const ids = psRes.stdout.trim();
  const seen = new Set<string>();
  if (ids) {
    const list = ids.split('\n').map((s) => s.trim()).filter((s) => DOCKER_ID_SAFE.test(s));
    let out = '';
    if (list.length) {
      const fmt = '{{.Name}}|{{.RestartCount}}|{{.State.Status}}';
      const res = await dockerRun(`inspect ${list.map(shq).join(' ')} --format ${shq(fmt)}`, 30_000);
      if (!res.ok) { preserveCheck('container:', preserve); return; }
      out = res.stdout;
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

async function checkSystemd(current: Map<string, ActiveAlert>, silent: Set<string>, preserve: Set<string>): Promise<void> {
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
  const failedScopes = new Set<string>();
  await Promise.all(scopes.map(async ({ scope, user, cmd }) => {
    const res = await hostExec(cmd, { user, timeoutMs: 20_000 });
    // A failed probe can't be told apart from "no failed units" — keep last
    // tick's candidates and don't prune the already-alerted set for it.
    if (!res.ok && !res.stdout) { failedScopes.add(scope); return; }
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
  for (const scope of failedScopes) {
    preserveCheck(`systemd:${scope}:`, preserve);
  }
  for (const k of knownFailedUnits.keys()) {
    if (!failedNow.has(k) && !failedScopes.has(k.slice(0, k.indexOf(':')))) knownFailedUnits.delete(k);
  }
}

let smartctlPath: string | null | undefined; // undefined = not probed yet
let smartctlProbeAt = 0;

async function checkSmart(current: Map<string, ActiveAlert>, preserve: Set<string>): Promise<void> {
  // Re-probe a failed/absent binary every 15 min — a transient hostExec error
  // must not disable SMART monitoring for the process lifetime.
  if (smartctlPath === undefined || (smartctlPath === null && Date.now() - smartctlProbeAt > 15 * 60_000)) {
    smartctlProbeAt = Date.now();
    // `|| true` keeps res.ok true when the binary is absent so smartctlPath
    // becomes null and the 15-min retry gate engages — otherwise a missing
    // binary is indistinguishable from a transport failure and re-probes
    // every tick while preserved `smart:` alerts never clear.
    const res = await hostExec('command -v smartctl || true', { user: 'root', timeoutMs: 10_000 });
    if (!res.ok) { preserveCheck('smart:', preserve); return; }
    smartctlPath = res.stdout.trim() || null;
  }
  if (!smartctlPath) return; // binary missing — skip silently

  // Enumerate every disk, not just /dev/sda: `smartctl --scan` covers
  // SATA/SAS/NVMe/USB; a device glob is the fallback when scan finds nothing.
  const scan = await hostExec(
    `smartctl --scan 2>/dev/null || ls -1 /dev/sd[a-z] /dev/vd[a-z] /dev/hd[a-z] /dev/nvme[0-9]n[0-9] 2>/dev/null || true`,
    { user: 'root', timeoutMs: 15_000 }
  );
  if (!scan.ok) { preserveCheck('smart:', preserve); return; }
  const devices: { dev: string; type?: string }[] = [];
  for (const line of scan.stdout.split('\n')) {
    const m = line.match(/^\s*(\/dev\/[A-Za-z0-9_./-]+)(?:\s+-d\s+([a-zA-Z0-9,-]+))?/);
    if (m && !devices.some((d) => d.dev === m[1])) devices.push({ dev: m[1], type: m[2] });
    if (devices.length >= 8) break;
  }
  if (!devices.length) return; // no disks to probe — stale smart:* keys reconcile away

  // One round-trip per tick: `smartctl -H` reads cached SMART data without
  // waking the drives. A device with no verdict line is simply skipped —
  // absence of output can't be told apart from "unknown" and must not alert.
  const cmd = devices
    .map((d) => `echo '==${d.dev}=='; smartctl -H${d.type ? ` -d ${d.type}` : ''} ${shq(d.dev)} 2>/dev/null | grep -i 'overall-health' || true`)
    .join('; ');
  const res = await hostExec(cmd, { user: 'root', timeoutMs: 60_000 });
  if (!res.ok && !res.stdout) { preserveCheck('smart:', preserve); return; }
  for (const part of res.stdout.split(/^==/m).filter(Boolean)) {
    const nl = part.indexOf('\n');
    const dev = (nl >= 0 ? part.slice(0, nl) : part).replace(/==\s*$/, '').trim();
    const body = nl >= 0 ? part.slice(nl + 1) : '';
    const result = body.match(/overall-health[^:]*:\s*(\w+)/i)?.[1] || '';
    if (dev && !result) preserve.add(`smart:${dev}`);
    if (dev && result && result.toUpperCase() !== 'PASSED') {
      current.set(`smart:${dev}`, {
        key: `smart:${dev}`,
        title: `SMART: ${dev} ${result}`,
        detail: `El disco reporta degradación de salud — revisar smartctl -a ${dev}`,
        since: Date.now(),
        severity: 'critical',
      });
    }
  }
}

// --- main loop ---

async function tick(): Promise<void> {
  if (ticking) return; // previous checks still running
  ticking = true;
  const current = new Map<string, ActiveAlert>();
  const silent = new Set<string>();
  const preserve = new Set<string>();
  try {
    // Prefix of the alert keys each check owns ('' = resource alerts, which
    // have no prefix separator).
    const checks: Array<[string, Promise<void>]> = [
      ['', checkResources(current, preserve)],
      ['container:', checkContainers(current, preserve)],
      ['systemd:', checkSystemd(current, silent, preserve)],
      ['smart:', checkSmart(current, preserve)],
    ];
    const results = await Promise.allSettled(checks.map(([, p]) => p));
    results.forEach((r, i) => {
      // A check that blew up produced no candidates — absence here means
      // "unknown", so keep its previous alerts out of the delete pass too.
      if (r.status !== 'rejected') return;
      const prefix = checks[i][0];
      for (const key of lastCurrent.keys()) {
        if (prefix ? key.startsWith(prefix) : !key.includes(':')) preserve.add(key);
      }
    });
    reconcile(current, silent, preserve);
    // Preserved alerts stay in `lastCurrent` so a check that keeps failing
    // doesn't lose them next tick.
    lastCurrent = new Map(current);
    for (const key of preserve) {
      const alert = active.get(key);
      if (alert) lastCurrent.set(key, alert);
    }
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
