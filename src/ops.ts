import { Hono } from 'hono';
import { readFile, writeFile, mkdir } from 'fs/promises';
import * as path from 'path';
import { hostExec } from './host';
import { loadConfig } from './config';

// ---------- Ops: salud del servidor + Wake-on-LAN + energía programada ----------
// Self-contained feature module — index.ts only calls registerOpsRoutes(app).
// Every health check is isolated so a single failure degrades to {error}
// instead of killing the whole /api/ops response.

function fail(c: any, status: number, error: string, extra?: Record<string, unknown>) {
  return c.json({ ok: false, error, ...extra }, status);
}

// ---------- WoL + power persistence (mirrors heartbeats.ts pattern) ----------

interface WolDevice { name: string; mac: string; addedAt: string }
interface WolWake { t: number; mac: string; name?: string; broadcast?: string; method?: string }
interface ScheduledPower { action: 'reboot' | 'shutdown'; minutes: number; scheduledAt: string; fireAt: string }
interface WolFile { devices: WolDevice[]; wakes: WolWake[]; power: ScheduledPower | null }

const WOL_FILE = path.join(
  path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),
  'wol.json'
);
const MAX_WAKES = 50;
const store: WolFile = { devices: [], wakes: [], power: null };
let storeLoaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function loadWolStore(): Promise<void> {
  if (storeLoaded) return;
  storeLoaded = true;
  try {
    const obj = JSON.parse(await readFile(WOL_FILE, 'utf-8'));
    if (Array.isArray(obj?.devices)) {
      store.devices = obj.devices.filter((d: any) => d && typeof d.mac === 'string').slice(0, 100);
    }
    if (Array.isArray(obj?.wakes)) store.wakes = obj.wakes.slice(-MAX_WAKES);
    if (obj?.power && typeof obj.power.fireAt === 'string') store.power = obj.power;
  } catch { /* missing/corrupt file — start fresh */ }
}

function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeQueue = writeQueue.then(async () => {
      try {
        await mkdir(path.dirname(WOL_FILE), { recursive: true });
        await writeFile(WOL_FILE, JSON.stringify(store, null, 2));
      } catch { /* best-effort */ }
    });
  }, 2000);
  (saveTimer as { unref?: () => void })?.unref?.();
}

const MAC_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;
const BCAST_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function normMac(mac: string): string {
  return mac.replace(/-/g, ':').toLowerCase();
}

function magicPacket(mac: string): Buffer {
  const bytes = Buffer.from(mac.replace(/[:-]/g, ''), 'hex');
  const packet = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) bytes.copy(packet, 6 + i * 6);
  return packet;
}

// Send the magic packet. Container runs network_mode:host, so a broadcast
// from inside the container lands on the LAN directly. Order: Bun.udpSocket
// → wakeonlan/etherwake binary on host → python3 one-liner on host.
async function sendMagicPacket(mac: string, broadcast: string): Promise<{ ok: boolean; method?: string; error?: string }> {
  const packet = magicPacket(mac);
  const attempts: string[] = [];

  // 1) Bun's native UDP socket (Bun 1.1.x+) — SO_BROADCAST via setBroadcast().
  try {
    const sock: any = await (Bun as any).udpSocket({});
    try {
      sock.setBroadcast?.(true);
      const sent = sock.send(packet, 9, broadcast);
      try { sock.close(); } catch { /* ignore */ }
      if (sent === false) throw new Error('send() devolvió false');
      return { ok: true, method: 'bun-udp' };
    } catch (err) {
      try { sock.close(); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    attempts.push(`bun-udp: ${String(err).slice(0, 120)}`);
  }

  // 2) wakeonlan / etherwake installed on the host
  const which = await hostExec('command -v wakeonlan || command -v etherwake || true', { user: 'root', timeoutMs: 8000 });
  const bin = which.stdout.trim().split('\n').filter(Boolean)[0] || '';
  if (bin) {
    const cmd = bin.endsWith('wakeonlan')
      ? `${bin} -i ${broadcast} ${mac}`
      : `${bin} -b ${mac}`;
    const res = await hostExec(cmd, { user: 'root', timeoutMs: 10_000 });
    if (res.ok) return { ok: true, method: path.basename(bin) };
    attempts.push(`${path.basename(bin)}: ${(res.stderr || res.stdout || `exit ${res.code}`).slice(0, 120)}`);
  }

  // 3) python3 on the host — sends raw bytes, always works if python exists
  const hex = packet.toString('hex');
  const py =
    `python3 -c 'import socket;` +
    `s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);` +
    `s.setsockopt(socket.SOL_SOCKET,socket.SO_BROADCAST,1);` +
    `s.sendto(bytes.fromhex("${hex}"),("${broadcast}",9))'`;
  const res = await hostExec(py, { user: 'root', timeoutMs: 10_000 });
  if (res.ok) return { ok: true, method: 'python3' };
  attempts.push(`python3: ${(res.stderr || res.stdout || `exit ${res.code}`).slice(0, 200)}`);

  return { ok: false, error: `No se pudo enviar el paquete WoL. ${attempts.join(' | ')}` };
}

// ---------- Health checks (each returns data or throws; wrapped per-section) ----------

interface FailedUnit { unit: string; scope: 'user' | 'system' }

async function checkUnits(): Promise<FailedUnit[]> {
  const parse = (out: string, scope: 'user' | 'system'): FailedUnit[] =>
    out.split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^0 units/i.test(l))
      .map((l) => l.replace(/^●\s+/, '').split(/\s+/)[0])
      .filter((u) => /^[A-Za-z0-9_.@:-]+\.(service|socket|timer|scope|mount|path|slice|target)$/.test(u))
      .map((unit) => ({ unit, scope }));

  const [userRes, sysRes] = await Promise.all([
    hostExec(
      'export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user list-units --failed --no-legend --plain 2>/dev/null || true',
      { user: 'user', timeoutMs: 15_000 }
    ),
    hostExec(
      'systemctl list-units --failed --no-legend --plain 2>/dev/null || true',
      { user: 'root', timeoutMs: 15_000 }
    ),
  ]);
  return [...parse(userRes.stdout, 'user'), ...parse(sysRes.stdout, 'system')];
}

async function checkSsh(): Promise<{ failed24h: number | null; source?: string }> {
  // grep -c exits 1 when the count is 0 — judge by stdout, not by exit code.
  const j = await hostExec(
    "journalctl _COMM=sshd --since '24 hours ago' -o cat --no-pager 2>/dev/null | grep -c 'Failed password'",
    { user: 'root', timeoutMs: 20_000 }
  );
  const jn = parseInt(j.stdout.trim(), 10);
  if (!Number.isNaN(jn)) return { failed24h: jn, source: 'journalctl' };

  const lb = await hostExec("lastb -n 50 2>/dev/null | grep -cv '^\\s*$'", { user: 'root', timeoutMs: 10_000 });
  const ln = parseInt(lb.stdout.trim(), 10);
  if (!Number.isNaN(ln)) return { failed24h: ln, source: 'lastb' };

  return { failed24h: null };
}

async function checkUpdates(): Promise<{ total: number; security: number }> {
  const res = await hostExec(
    `u=$(apt list --upgradable 2>/dev/null | tail -n +2); ` +
    `echo "TOTAL:$(printf '%s\\n' "$u" | grep -c .)"; ` +
    `echo "SEC:$(printf '%s\\n' "$u" | grep -ci secur)"`,
    { user: 'root', timeoutMs: 30_000 }
  );
  const total = parseInt(res.stdout.match(/TOTAL:(\d+)/)?.[1] || '', 10);
  const security = parseInt(res.stdout.match(/SEC:(\d+)/)?.[1] || '', 10);
  if (Number.isNaN(total)) throw new Error('apt no respondió');
  return { total, security: Number.isNaN(security) ? 0 : security };
}

interface CertInfo {
  domain: string;
  daysLeft: number | null;
  warn: 'ok' | 'warn' | 'bad' | 'error';
  notAfter?: string;
  error?: string;
}

async function probeCert(domain: string): Promise<CertInfo> {
  const res = await hostExec(
    `timeout 10 openssl s_client -connect ${domain}:443 -servername ${domain} </dev/null 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null`,
    { user: 'root', timeoutMs: 15_000 }
  );
  const m = res.stdout.match(/notAfter=(.+)/);
  if (!m) return { domain, daysLeft: null, warn: 'error', error: 'Sin certificado TLS' };
  const exp = Date.parse(m[1].trim());
  if (Number.isNaN(exp)) return { domain, daysLeft: null, warn: 'error', error: 'Fecha inválida' };
  const daysLeft = Math.floor((exp - Date.now()) / 86_400_000);
  return { domain, daysLeft, warn: daysLeft < 7 ? 'bad' : daysLeft < 14 ? 'warn' : 'ok', notAfter: m[1].trim() };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

async function checkCerts(): Promise<CertInfo[]> {
  const cfg = await loadConfig();
  const domains = (cfg.domains || [])
    .map((d) => d.fullDomain)
    // Domain labels must not start/end with a dash — a leading '-' would be
    // parsed as an openssl flag in probeCert's -connect argument.
    .filter((d) => /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(d))
    .slice(0, 20);
  return mapLimit(domains, 4, (d) => probeCert(d).catch((): CertInfo => ({ domain: d, daysLeft: null, warn: 'error', error: 'No se pudo verificar' })));
}

async function checkSystem(): Promise<{ uptime: string; since: string; bootTime: string; seconds: number }> {
  const res = await hostExec(
    `echo "SINCE:$(uptime -s 2>/dev/null || who -b 2>/dev/null | sed 's/^.* //')"; ` +
    `echo "PRETTY:$(uptime -p 2>/dev/null)"; ` +
    `echo "SECS:$(cut -d' ' -f1 /proc/uptime 2>/dev/null)"`,
    { user: 'root', timeoutMs: 10_000 }
  );
  const get = (k: string) => res.stdout.match(new RegExp(`${k}:(.*)`))?.[1]?.trim() || '';
  return { uptime: get('PRETTY') || '-', since: get('SINCE'), bootTime: get('SINCE'), seconds: parseFloat(get('SECS')) || 0 };
}

interface ResourceInfo {
  disks: { mount: string; pcent: number }[];
  diskPct: number | null;
  memPct: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  temps: { label: string; c: number }[];
}

async function checkResources(): Promise<ResourceInfo> {
  const res = await hostExec(
    `echo '==DF=='; df -h / /home --output=pcent,target 2>/dev/null || df -h / /home 2>/dev/null; ` +
    `echo '==MEM=='; free -m 2>/dev/null; ` +
    `echo '==TEMP=='; command -v sensors >/dev/null 2>&1 && sensors 2>/dev/null || true`,
    { user: 'root', timeoutMs: 15_000 }
  );
  const out = res.stdout;
  const seg = (name: string, next: string) => out.split(`==${name}==`)[1]?.split(`==${next}==`)[0] || '';

  const disks: { mount: string; pcent: number }[] = [];
  for (const line of seg('DF', 'MEM').split('\n')) {
    const m = line.trim().match(/^(\d+)%\s+(\S+)$/);
    if (m && !disks.some((d) => d.mount === m[2])) disks.push({ mount: m[2], pcent: parseInt(m[1], 10) });
  }
  const root = disks.find((d) => d.mount === '/') || disks[0];

  let memPct: number | null = null, memUsedMb: number | null = null, memTotalMb: number | null = null;
  for (const line of seg('MEM', 'TEMP').split('\n')) {
    const m = line.match(/^Mem:\s+(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s+(\d+)/);
    if (m) {
      memTotalMb = parseInt(m[1], 10);
      const avail = parseInt(m[3], 10);
      memUsedMb = memTotalMb - avail;
      memPct = memTotalMb ? Math.round((memUsedMb / memTotalMb) * 100) : null;
    }
  }

  const temps: { label: string; c: number }[] = [];
  for (const line of seg('TEMP', 'X').split('\n')) {
    const m = line.match(/^\s*([^:(]{2,40}?):\s+\+?(-?\d+(?:\.\d+)?)°C/);
    if (m && temps.length < 8) temps.push({ label: m[1].trim(), c: parseFloat(m[2]) });
  }

  return { disks, diskPct: root?.pcent ?? null, memPct, memUsedMb, memTotalMb, temps };
}

async function checkTunnel(): Promise<{ status: string; source: string; detail?: string }> {
  // `systemctl is-active` prints "inactive" for a missing unit too, so ask
  // LoadState first and only report a systemd state when a unit is loaded.
  const s = await hostExec('systemctl show cloudflared.service -p LoadState,ActiveState --value 2>/dev/null || true', { user: 'root', timeoutMs: 8_000 });
  const [load, state] = s.stdout.trim().split('\n');
  if (load === 'loaded') {
    return { status: state || 'inactive', source: 'systemd' };
  }
  const d = await hostExec(
    "docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -i cloudflared | head -3",
    { user: 'root', timeoutMs: 10_000 }
  );
  const line = d.stdout.trim();
  if (line) {
    const healthy = /up/i.test(line) && !/unhealthy|restarting/i.test(line);
    return { status: healthy ? 'active' : 'warn', source: 'docker', detail: line };
  }
  return { status: 'unknown', source: 'none' };
}

// ---------- Routes ----------

export function registerOpsRoutes(app: Hono): void {
  // Lazily restore persisted WoL devices/wakes/power on first request.
  const ensureStore = () => loadWolStore();

  app.get('/api/ops', async (c) => {
    const [units, ssh, updates, certs, system, resources, tunnel] = await Promise.allSettled([
      checkUnits(),
      checkSsh(),
      checkUpdates(),
      checkCerts(),
      checkSystem(),
      checkResources(),
      checkTunnel(),
    ]);
    const unwrap = <T>(r: PromiseSettledResult<T>, msg: string): T | { error: string } =>
      r.status === 'fulfilled' ? r.value : { error: `${msg}: ${String(r.reason).slice(0, 200)}` };
    return c.json({
      ok: true,
      sections: {
        units: unwrap(units, 'No se pudo listar unidades'),
        ssh: unwrap(ssh, 'No se pudo leer el log SSH'),
        updates: unwrap(updates, 'No se pudo consultar apt'),
        certs: unwrap(certs, 'No se pudieron verificar certificados'),
        system: unwrap(system, 'No se pudo leer uptime'),
        resources: unwrap(resources, 'No se pudieron leer recursos'),
        tunnel: unwrap(tunnel, 'No se pudo verificar el túnel'),
      },
    });
  });

  // Reiniciar una unidad fallida (user o system scope).
  app.post('/api/ops/unit/restart', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const unit = String(body.unit || '');
    const scope = body.scope === 'system' ? 'system' : 'user';
    if (!/^[A-Za-z0-9_.@:-]+\.(service|socket|timer|scope|mount|path|slice|target)$/.test(unit)) {
      return fail(c, 400, 'Nombre de unidad inválido');
    }
    const cmd = scope === 'user'
      ? `export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user restart ${unit}`
      : `systemctl restart ${unit}`;
    const res = await hostExec(cmd, { user: scope === 'user' ? 'user' : 'root', timeoutMs: 30_000 });
    if (!res.ok) {
      return fail(c, 500, `No se pudo reiniciar ${unit}`, { detail: (res.stderr || res.stdout || `exit ${res.code}`).slice(0, 2000) });
    }
    return c.json({ ok: true, unit, scope });
  });

  // ---------- Wake-on-LAN ----------

  app.post('/api/ops/wol', async (c) => {
    await ensureStore();
    const body = await c.req.json().catch(() => ({}));
    const mac = normMac(String(body.mac || ''));
    if (!MAC_RE.test(mac)) return fail(c, 400, 'MAC inválida — formato aa:bb:cc:dd:ee:ff');
    let broadcast = String(body.broadcast || '255.255.255.255').trim();
    if (!BCAST_RE.test(broadcast)) broadcast = '255.255.255.255';
    const name = typeof body.name === 'string' ? body.name.slice(0, 60) : undefined;

    const result = await sendMagicPacket(mac, broadcast);
    if (!result.ok) return fail(c, 500, 'Falló el envío WoL', { detail: result.error });
    store.wakes.push({ t: Date.now(), mac, name, broadcast, method: result.method });
    if (store.wakes.length > MAX_WAKES) store.wakes.splice(0, store.wakes.length - MAX_WAKES);
    saveSoon();
    return c.json({ ok: true, mac, broadcast, method: result.method });
  });

  app.get('/api/ops/wol/devices', async (c) => {
    await ensureStore();
    return c.json({ ok: true, devices: store.devices, wakes: store.wakes.slice(-10).reverse() });
  });

  app.post('/api/ops/wol/devices', async (c) => {
    await ensureStore();
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || '').trim().slice(0, 60);
    const mac = normMac(String(body.mac || ''));
    if (!name) return fail(c, 400, 'Falta el nombre');
    if (!MAC_RE.test(mac)) return fail(c, 400, 'MAC inválida — formato aa:bb:cc:dd:ee:ff');
    const existing = store.devices.find((d) => d.mac === mac);
    if (existing) { existing.name = name; }
    else store.devices.push({ name, mac, addedAt: new Date().toISOString() });
    saveSoon();
    return c.json({ ok: true, devices: store.devices });
  });

  app.delete('/api/ops/wol/devices/:mac', async (c) => {
    await ensureStore();
    const mac = normMac(decodeURIComponent(c.req.param('mac')));
    const before = store.devices.length;
    store.devices = store.devices.filter((d) => d.mac !== mac);
    if (store.devices.length === before) return fail(c, 404, 'Dispositivo no encontrado');
    saveSoon();
    return c.json({ ok: true, devices: store.devices });
  });

  // ---------- Energía programada ----------

  // shutdown -h/-r +M — complements the immediate /api/system/power.
  app.post('/api/ops/power/schedule', async (c) => {
    await ensureStore();
    const body = await c.req.json().catch(() => ({}));
    const action = body.action;
    if (action !== 'reboot' && action !== 'shutdown') return fail(c, 400, 'Acción inválida — usá reboot o shutdown');
    const delaySec = Math.min(Math.max(Number(body.delaySec) || 0, 60), 7 * 86_400);
    const minutes = Math.max(1, Math.round(delaySec / 60));
    const flag = action === 'reboot' ? '-r' : '-h';
    const res = await hostExec(
      `shutdown ${flag} +${minutes} "Ports Manager: ${action === 'reboot' ? 'reinicio' : 'apagado'} programado"`,
      { user: 'root', timeoutMs: 10_000 }
    );
    if (!res.ok) {
      return fail(c, 500, 'No se pudo programar', { detail: (res.stderr || res.stdout || `exit ${res.code}`).slice(0, 1000) });
    }
    store.power = {
      action,
      minutes,
      scheduledAt: new Date().toISOString(),
      fireAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    };
    saveSoon();
    return c.json({ ok: true, power: store.power });
  });

  app.post('/api/ops/power/cancel', async (c) => {
    await ensureStore();
    const res = await hostExec('shutdown -c', { user: 'root', timeoutMs: 10_000 });
    store.power = null;
    saveSoon();
    // shutdown -c exits non-zero if there was nothing scheduled — still OK.
    return c.json({ ok: true, cancelled: true, detail: res.ok ? undefined : (res.stderr || res.stdout).slice(0, 500) });
  });

  app.get('/api/ops/power', async (c) => {
    await ensureStore();
    // Reconcile in-memory state with the host. On systemd `shutdown -h +M`
    // exits immediately and records the pending event in logind's
    // /run/systemd/shutdown/scheduled file; non-systemd hosts keep a
    // `shutdown -[rh] +M` process alive — check both.
    const [sched, ps] = await Promise.all([
      hostExec('cat /run/systemd/shutdown/scheduled 2>/dev/null || true', { user: 'root', timeoutMs: 8_000 }),
      hostExec('ps -eo args 2>/dev/null || true', { user: 'root', timeoutMs: 8_000 }),
    ]);
    // A pending shutdown shows argv[0] basename `shutdown` — not a random
    // arg containing the word (e.g. --enable-remote-auto-shutdown).
    const detected = ps.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^(?:\S*\/)?shutdown\s/.test(l));
    const pending = !!sched.stdout.trim() || detected.length > 0;
    if (store.power && (!pending || Date.now() > Date.parse(store.power.fireAt) + 5 * 60_000)) {
      store.power = null;
      saveSoon();
    }
    return c.json({ ok: true, power: store.power, hostPending: pending, detected: detected.slice(0, 5) });
  });
}
