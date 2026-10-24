import type { Hono } from 'hono';
import { hostExec } from './host';

// ---------- Navegador del servidor ----------
// Google Chrome nativo del host (navegador.service, systemd --user) con
// noVNC en 127.0.0.1:5800 y CDP en 127.0.0.1:9222. Los agentes se enganchan
// por CDP; el Chrome headless de Playwright MCP es aparte
// (playwright-agents-mcp.service). navegador-watchdog.timer limpia lo que los
// agentes dejan colgado y deja su registro en ~/.local/state/navegador.

const CDP = 'http://127.0.0.1:9222';
const BROWSER_UNIT = 'navegador.service';
const AGENTS_UNIT = 'playwright-agents-mcp.service';
const WATCHDOG_UNIT = 'navegador-watchdog.service';
const USER_ENV = 'export XDG_RUNTIME_DIR=/run/user/$(id -u);';

type Fail = (c: any, status: number, error: string, extra?: Record<string, unknown>) => Response;

interface UnitInfo { unit: string; present: boolean; active: string; memoryMb: number | null; cpuPct: number | null; since: string | null }
interface CdpClient { pid: number; label: string; detail: string; ageSec: number }

// CPUUsageNSec es acumulado; el % sale de la diferencia entre dos consultas.
const lastCpu = new Map<string, { ns: number; at: number }>();

function parseUnits(block: string): UnitInfo[] {
  return block.trim().split(/\n\s*\n/).filter(Boolean).map((chunk) => {
    const kv = Object.fromEntries(chunk.split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    const ns = Number(kv.CPUUsageNSec), now = Date.now(), prev = lastCpu.get(kv.Id);
    let cpuPct: number | null = null;
    if (Number.isFinite(ns) && kv.ActiveState === 'active') {
      if (prev && ns >= prev.ns && now > prev.at) cpuPct = Math.round(((ns - prev.ns) / 1e6 / (now - prev.at)) * 100);
      lastCpu.set(kv.Id, { ns, at: now });
    }
    const mem = Number(kv.MemoryCurrent);
    return {
      unit: kv.Id,
      present: kv.LoadState === 'loaded',
      active: kv.ActiveState || 'unknown',
      memoryMb: Number.isFinite(mem) && mem < 2 ** 62 ? Math.round(mem / 1048576) : null,
      cpuPct,
      since: kv.ActiveState === 'active' && kv.ActiveEnterTimestamp ? kv.ActiveEnterTimestamp : null,
    };
  });
}

function describeClient(args: string): { label: string; detail: string } {
  const daemon = args.match(/cliDaemon\.js\s+([^\s-][^\s]*)/);
  if (daemon) return { label: 'playwright-cli', detail: `sesión "${daemon[1]}"` };
  if (/@playwright[/+]mcp/.test(args)) return { label: 'Playwright MCP', detail: 'conectado por CDP' };
  const bin = (args.split(' ')[0] || '?').split('/').pop() || '?';
  return { label: bin, detail: args.slice(0, 160) };
}

async function cdpClients(): Promise<CdpClient[]> {
  // Conexiones TCP establecidas HACIA el 9222: cada una es un agente o script
  // con el navegador enganchado (Chrome mismo es el lado que escucha).
  const res = await hostExec(
    `for p in $(ss -Htnp state established '( dport = :9222 )' 2>/dev/null | grep -oP 'pid=\\K[0-9]+' | sort -u); do ` +
      `printf '%s\\t%s\\t' "$p" "$(ps -o etimes= -p "$p" | tr -d ' ')"; tr '\\0' ' ' < /proc/$p/cmdline | cut -c1-600; echo; done`,
    { user: 'user', timeoutMs: 8_000 },
  );
  return res.stdout.split('\n').filter(Boolean).map((line) => {
    const [pid, age, ...rest] = line.split('\t');
    const args = rest.join('\t').trim();
    return { pid: Number(pid), ageSec: Number(age) || 0, ...describeClient(args) };
  }).filter((c) => c.pid > 0);
}

async function tabs() {
  const res = await fetch(`${CDP}/json/list`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!res?.ok) return null;
  const list = (await res.json().catch(() => [])) as { id: string; type: string; title: string; url: string }[];
  return list.filter((t) => t.type === 'page').map(({ id, title, url }) => ({ id, title, url }));
}

export function registerServerBrowserRoutes(app: Hono, opts: { fail: Fail; fixture: boolean }) {
  const { fail, fixture } = opts;

  app.get('/api/browser/status', async (c) => {
    if (fixture) return c.json({ ok: true, available: false, fixture: true });
    const response = await fetch('http://127.0.0.1:5800/', { signal: AbortSignal.timeout(4000) }).catch(() => null);
    await response?.body?.cancel().catch(() => {});
    return c.json({ ok: true, available: !!response?.ok });
  });

  app.get('/api/browser/info', async (c) => {
    if (fixture) return c.json({ ok: true, fixture: true, units: [], tabs: [], clients: [], log: [] });
    const [unitsRes, tabList, clients] = await Promise.all([
      hostExec(
        `${USER_ENV} systemctl --user show ${BROWSER_UNIT} ${AGENTS_UNIT} -p Id,LoadState,ActiveState,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp; ` +
          `echo @@LOG; tail -n 20 ~/.local/state/navegador/watchdog.log 2>/dev/null`,
        { user: 'user', timeoutMs: 8_000 },
      ),
      tabs(),
      cdpClients(),
    ]);
    const [unitBlock, logBlock = ''] = unitsRes.stdout.split('@@LOG');
    const units = parseUnits(unitBlock);
    return c.json({
      ok: true,
      browser: units.find((u) => u.unit === BROWSER_UNIT) || null,
      agents: units.find((u) => u.unit === AGENTS_UNIT && u.present) || null,
      tabs: tabList,
      clients,
      log: logBlock.split('\n').map((l) => l.trim()).filter(Boolean).reverse(),
    });
  });

  app.post('/api/browser/restart', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const unit = body.target === 'agents' ? AGENTS_UNIT : BROWSER_UNIT;
    // Chrome se cierra ordenado (hasta 20 s) para guardar las cookies.
    const res = await hostExec(`${USER_ENV} systemctl --user restart ${unit}`, { user: 'user', timeoutMs: 60_000 });
    if (!res.ok) return fail(c, 500, `No se pudo reiniciar ${unit}`, { detail: (res.stderr || res.stdout).slice(0, 2000) });
    return c.json({ ok: true, unit });
  });

  app.post('/api/browser/cleanup', async (c) => {
    const res = await hostExec(`${USER_ENV} systemctl --user start ${WATCHDOG_UNIT}`, { user: 'user', timeoutMs: 60_000 });
    if (!res.ok) return fail(c, 500, 'No se pudo correr la limpieza', { detail: (res.stderr || res.stdout).slice(0, 2000) });
    return c.json({ ok: true });
  });

  app.post('/api/browser/tabs/close', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!/^[A-Za-z0-9]{8,64}$/.test(id)) return fail(c, 400, 'Pestaña inválida');
    const res = await fetch(`${CDP}/json/close/${id}`, { method: 'PUT', signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (!res?.ok) return fail(c, 502, 'El navegador no cerró la pestaña', { detail: res ? `CDP ${res.status}` : 'sin conexión a 127.0.0.1:9222' });
    return c.json({ ok: true });
  });

  app.post('/api/browser/clients/disconnect', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const pid = Number(body.pid);
    // Solo procesos que ahora mismo tienen el CDP enganchado: este endpoint no
    // puede usarse para matar cualquier otro proceso del usuario.
    if (!(await cdpClients()).some((cl) => cl.pid === pid)) return fail(c, 404, 'Ese proceso ya no está conectado al navegador');
    const res = await hostExec(`kill -TERM ${pid}`, { user: 'user', timeoutMs: 5_000 });
    if (!res.ok) return fail(c, 500, 'No se pudo desconectar', { detail: (res.stderr || res.stdout).slice(0, 500) });
    return c.json({ ok: true });
  });

  // Abre una URL dentro del navegador del servidor. Comparte la red del host,
  // así que localhost:* son los servicios del propio servidor.
  app.post('/api/browser/open', async (c) => {
    const body = await c.req.json<{ url?: string }>().catch(() => ({} as { url?: string }));
    let u: URL;
    try { u = new URL((body.url || '').trim()); } catch { return fail(c, 400, 'URL inválida'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail(c, 400, 'Solo se pueden abrir URLs http/https');
    const res = await fetch(`${CDP}/json/new?${encodeURIComponent(u.toString())}`, { method: 'PUT', signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!res || !res.ok) {
      return fail(c, 502, 'El navegador del servidor no responde', { detail: res ? `CDP ${res.status}` : 'sin conexión a 127.0.0.1:9222' });
    }
    // json/new abre la pestaña de fondo: activarla para que el visor la muestre.
    const target = (await res.json().catch(() => ({}))) as { id?: string };
    if (target.id) {
      await fetch(`${CDP}/json/activate/${target.id}`, { method: 'PUT', signal: AbortSignal.timeout(3000) }).catch(() => {});
    }
    return c.json({ ok: true });
  });
}
