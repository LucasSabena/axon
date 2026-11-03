import type { Hono } from 'hono';
import { hostExec } from './host';

// ---------- Navegador del servidor ----------
// Dos Google Chrome nativos del host, cada uno en su pantalla virtual y con su
// propio visor noVNC, para que nada de lo que hacen los agentes quede invisible:
//
//   servidor → :88, noVNC 5800, CDP 9222, perfil navegador-chrome (sesiones reales)
//   agentes  → :89, noVNC 5801, CDP 9223, perfil playwright-agents (sin sesiones)
//
// AXON lista las pestañas por CDP, marca la que está al frente y la que el
// agente acaba de navegar, y puede traerla al frente o congelarla.
// navegador-watchdog.timer limpia lo que los agentes dejan colgado y deja su
// registro en ~/.local/state/navegador.

const BROWSERS = {
  server: {
    cdp: 'http://127.0.0.1:9222',
    port: 9222,
    unit: 'navegador.service',
    mcp: 'playwright-navegador-mcp.service',
    view: 5800,
    label: 'Navegador del servidor',
  },
  agents: {
    cdp: 'http://127.0.0.1:9223',
    port: 9223,
    unit: 'navegador-agents.service',
    mcp: 'playwright-agents-mcp.service',
    view: 5801,
    label: 'Playwright de agentes',
  },
} as const;

type Which = keyof typeof BROWSERS;

const WATCHDOG_UNIT = 'navegador-watchdog.service';
const USER_ENV = 'export XDG_RUNTIME_DIR=/run/user/$(id -u);';

type Fail = (c: any, status: number, error: string, extra?: Record<string, unknown>) => Response;

interface UnitInfo { unit: string; present: boolean; active: string; memoryMb: number | null; cpuPct: number | null; since: string | null }
interface CdpClient { pid: number; label: string; detail: string; kind: 'mcp' | 'session' | 'other'; ageSec: number }
interface TabInfo {
  id: string; title: string; url: string;
  active: boolean;            // es la pestaña que está al frente en la pantalla
  jsPct: number | null;       // trabajo de JS de la pestaña (no incluye pintado)
  heapMb: number | null;
  idleSec: number;            // hace cuánto que no cambia de URL
  frozen: boolean;            // la congelamos nosotros
  recent: boolean;            // navegó en los últimos 60 s
}

// CPUUsageNSec es acumulado; el % sale de la diferencia entre dos consultas.
const lastCpu = new Map<string, { ns: number; at: number }>();

// Estado por pestaña entre consultas: sirve para detectar navegación (seguir al
// agente) y para calcular el % de JS de cada pestaña.
interface TabState { url: string; title: string; changedAt: number; task: number; taskAt: number }
const tabState = new Map<string, TabState>();
const frozenTabs = new Set<string>();
const follow: Record<Which, boolean> = { server: true, agents: true };
const lastFollow = new Map<string, number>();
const primed = new Set<Which>();

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

function describeClient(args: string): { label: string; detail: string; kind: 'mcp' | 'session' | 'other' } {
  const daemon = args.match(/cliDaemon\.js\s+([^\s-][^\s]*)/);
  if (daemon) return { label: 'playwright-cli', detail: `sesión "${daemon[1]}"`, kind: 'session' };
  if (/@playwright[/+]mcp/.test(args)) return { label: 'Playwright MCP', detail: 'conectado por CDP', kind: 'mcp' };
  const bin = (args.split(' ')[0] || '?').split('/').pop() || '?';
  return { label: bin, detail: args.slice(0, 160), kind: 'other' };
}

async function cdpClients(port: number): Promise<CdpClient[]> {
  // Conexiones TCP establecidas HACIA el puerto CDP: cada una es un agente o
  // script con el navegador enganchado (Chrome mismo es el lado que escucha).
  const res = await hostExec(
    `for p in $(ss -Htnp state established '( dport = :${port} )' 2>/dev/null | grep -oP 'pid=\\K[0-9]+' | sort -u); do ` +
      `printf '%s\\t%s\\t' "$p" "$(ps -o etimes= -p "$p" | tr -d ' ')"; tr '\\0' ' ' < /proc/$p/cmdline | cut -c1-600; echo; done`,
    { user: 'user', timeoutMs: 8_000 },
  );
  return res.stdout.split('\n').filter(Boolean).map((line) => {
    const [pid, age, ...rest] = line.split('\t');
    const args = rest.join('\t').trim();
    return { pid: Number(pid), ageSec: Number(age) || 0, ...describeClient(args) };
  }).filter((c) => c.pid > 0);
}

// ---------- Cliente CDP mínimo ----------
// Una conexión por consulta: en loopback el handshake cuesta milisegundos y así
// no quedan sockets colgados si Chrome se reinicia.

interface Cdp {
  call(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<any>;
  close(): void;
}

function cdpOpen(wsUrl: string, timeoutMs = 2500): Promise<Cdp> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    const waiting = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>();

    const call = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<any>((ok, no) => {
      const id = ++seq;
      waiting.set(id, { ok, no });
      try {
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (e) {
        waiting.delete(id);
        no(e as Error);
        return;
      }
      setTimeout(() => { if (waiting.delete(id)) no(new Error('CDP timeout')); }, timeoutMs);
    });

    const openTimer = setTimeout(() => reject(new Error('CDP timeout')), timeoutMs);
    ws.onopen = () => {
      clearTimeout(openTimer);
      ws.onmessage = (e) => {
        let msg: any;
        try { msg = JSON.parse(String(e.data)); } catch { return; }
        if (!msg.id || !waiting.has(msg.id)) return;
        const w = waiting.get(msg.id)!;
        waiting.delete(msg.id);
        msg.error ? w.no(new Error(msg.error.message || 'CDP error')) : w.ok(msg.result);
      };
      resolve({ call, close: () => { try { ws.close(); } catch { /* ya cerrado */ } } });
    };
    ws.onerror = () => { clearTimeout(openTimer); reject(new Error('CDP no responde')); };
  });
}

async function cdpBrowser(which: Which): Promise<Cdp | null> {
  const version = await fetch(`${BROWSERS[which].cdp}/json/version`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.json()).catch(() => null) as { webSocketDebuggerUrl?: string } | null;
  if (!version?.webSocketDebuggerUrl) return null;
  return cdpOpen(version.webSocketDebuggerUrl).catch(() => null);
}

// ---------- Pestañas ----------

async function probe(which: Which): Promise<TabInfo[] | null> {
  const cdp = await cdpBrowser(which);
  if (!cdp) return null;
  const now = Date.now();
  const deadline = now + 4000;
  const firstPass = !primed.has(which);
  const seen = new Set<string>();
  const out: TabInfo[] = [];
  try {
    const { targetInfos } = await cdp.call('Target.getTargets');
    const pages = (targetInfos as any[]).filter((t) => t.type === 'page');
    for (const t of pages) {
      const key = `${which}:${t.targetId}`;
      seen.add(key);
      const prev = tabState.get(key);
      const frozen = frozenTabs.has(key);
      let active = false, task: number | null = null, heap: number | null = null;
      // Una pestaña congelada no responde a Runtime.evaluate: ni lo intentamos.
      if (!frozen && Date.now() < deadline) {
        try {
          const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: t.targetId, flatten: true });
          try {
            const vis = await cdp.call('Runtime.evaluate', {
              expression: 'document.visibilityState', returnByValue: true,
            }, sessionId);
            active = vis?.result?.value === 'visible';
            await cdp.call('Performance.enable', {}, sessionId).catch(() => {});
            const perf = await cdp.call('Performance.getMetrics', {}, sessionId);
            const m = Object.fromEntries((perf?.metrics || []).map((x: any) => [x.name, x.value]));
            if (Number.isFinite(m.TaskDuration)) task = m.TaskDuration;
            if (Number.isFinite(m.JSHeapUsedSize)) heap = m.JSHeapUsedSize;
          } finally {
            await cdp.call('Target.detachFromTarget', { sessionId }).catch(() => {});
          }
        } catch { /* pestaña congelada, cerrada o navegando a mitad de la consulta */ }
      }

      const changed = !prev || prev.url !== t.url;
      const changedAt = changed ? now : prev!.changedAt;
      const jsPct = prev && task != null && now > prev.taskAt
        ? Math.max(0, Math.min(100, Math.round(((task - prev.task) / ((now - prev.taskAt) / 1000)) * 100)))
        : null;
      tabState.set(key, {
        url: t.url, title: t.title, changedAt,
        task: task ?? prev?.task ?? 0, taskAt: now,
      });

      out.push({
        id: t.targetId,
        title: t.title || 'Sin título',
        url: t.url,
        active,
        jsPct,
        heapMb: heap == null ? null : Math.round(heap / 1048576),
        idleSec: Math.round((now - changedAt) / 1000),
        frozen,
        recent: !firstPass && (now - changedAt) / 1000 < 60,
      });
    }
  } finally {
    cdp.close();
  }

  for (const key of tabState.keys()) if (key.startsWith(`${which}:`) && !seen.has(key)) {
    tabState.delete(key);
    frozenTabs.delete(key);
  }

  // Seguir al agente: cuando navega en una pestaña de fondo, la traemos al
  // frente para que el visor muestre lo mismo que ve él. La primera consulta
  // sólo aprende el estado; después seguimos los cambios de URL.
  primed.add(which);
  if (!firstPass && follow[which]) {
    const navigated = out.filter((t) => {
      const key = `${which}:${t.id}`;
      return !t.active && tabState.get(key)?.changedAt === now && (lastFollow.get(key) ?? 0) < now - 3000;
    });
    if (navigated.length === 1) {
      lastFollow.set(`${which}:${navigated[0].id}`, now);
      await activate(which, navigated[0].id).catch(() => {});
    }
  }
  return out;
}

async function activate(which: Which, id: string): Promise<void> {
  const cdp = await cdpBrowser(which);
  if (!cdp) throw new Error('El navegador no responde');
  try {
    if (frozenTabs.delete(`${which}:${id}`)) await setFrozen(cdp, id, false).catch(() => {});
    await cdp.call('Target.activateTarget', { targetId: id });
  } finally { cdp.close(); }
}

async function setFrozen(cdp: Cdp, id: string, frozen: boolean): Promise<void> {
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: id, flatten: true });
  try {
    await cdp.call('Page.setWebLifecycleState', { state: frozen ? 'frozen' : 'active' }, sessionId);
  } finally {
    await cdp.call('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}

async function freeze(which: Which, id: string, on: boolean): Promise<void> {
  const cdp = await cdpBrowser(which);
  if (!cdp) throw new Error('El navegador no responde');
  try {
    const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: id, flatten: true });
    try {
      // Congelar la pestaña que está al frente deja la ventana sin ninguna
      // visible y Chrome no vuelve a marcar el foco hasta que se activa otra.
      if (on) {
        const vis = await cdp.call('Runtime.evaluate', {
          expression: 'document.visibilityState', returnByValue: true,
        }, sessionId);
        if (vis?.result?.value === 'visible') throw new Error('La pestaña está al frente: cambiá de pestaña antes de congelarla');
      }
      await cdp.call('Page.setWebLifecycleState', { state: on ? 'frozen' : 'active' }, sessionId);
    } finally {
      await cdp.call('Target.detachFromTarget', { sessionId }).catch(() => {});
    }
    on ? frozenTabs.add(`${which}:${id}`) : frozenTabs.delete(`${which}:${id}`);
  } finally { cdp.close(); }
}

const validId = (id: string) => /^[A-Za-z0-9]{8,64}$/.test(id);

// ---------- Vista en vivo (sin WebSocket) ----------
// Una captura de la pestaña por HTTP. Sirve cuando noVNC no puede abrir el
// WebSocket (redes del celular que cortan Upgrade) y como vista rápida: es
// nítida, no hay que escalar un escritorio de 1600x900 y no gasta CPU de VNC.

let shotCache: { key: string; at: number; data: ArrayBuffer } | null = null;

async function screenshot(which: Which, id?: string): Promise<ArrayBuffer | null> {
  const cdp = await cdpBrowser(which);
  if (!cdp) return null;
  try {
    const { targetInfos } = await cdp.call('Target.getTargets');
    const pages = (targetInfos as any[]).filter((t) => t.type === 'page' && !frozenTabs.has(`${which}:${t.targetId}`));
    const target = (id && pages.find((t) => t.targetId === id)) || pages[0];
    if (!target) return null;
    const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    try {
      // Escalar a ~900 px de ancho: en un celular se ve igual y pesa un tercio.
      const box = await cdp.call('Page.getLayoutMetrics', {}, sessionId).catch(() => null);
      const view = box?.cssVisualViewport || box?.cssLayoutViewport;
      const w = Number(view?.clientWidth) || 1600;
      const h = Number(view?.clientHeight) || 900;
      const scale = Math.min(1, 900 / w);
      const shot = await cdp.call('Page.captureScreenshot', {
        format: 'jpeg', quality: 55, fromSurface: true,
        clip: { x: 0, y: 0, width: w, height: h, scale },
      }, sessionId);
      if (!shot?.data) return null;
      const bin = atob(shot.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer as ArrayBuffer;
    } finally {
      await cdp.call('Target.detachFromTarget', { sessionId }).catch(() => {});
    }
  } finally { cdp.close(); }
}

export function registerServerBrowserRoutes(app: Hono, opts: { fail: Fail; fixture: boolean }) {
  const { fail, fixture } = opts;
  const whichOf = (v: unknown): Which => (v === 'agents' ? 'agents' : 'server');

  app.get('/api/browser/status', async (c) => {
    if (fixture) return c.json({ ok: true, available: false, agentsAvailable: false, fixture: true });
    const up = async (port: number) => {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
      await res?.body?.cancel().catch(() => {});
      return !!res?.ok;
    };
    const [available, agentsAvailable] = await Promise.all([up(BROWSERS.server.view), up(BROWSERS.agents.view)]);
    return c.json({ ok: true, available, agentsAvailable });
  });

  app.get('/api/browser/info', async (c) => {
    if (fixture) return c.json({ ok: true, fixture: true, units: [], tabs: [], agentTabs: [], clients: [], agentClients: [], follow, log: [] });
    const [unitsRes, serverTabs, agentTabs, clients, agentClients] = await Promise.all([
      hostExec(
        `${USER_ENV} systemctl --user show ${BROWSERS.server.unit} ${BROWSERS.agents.unit} -p Id,LoadState,ActiveState,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp; ` +
          `echo @@LOG; tail -n 20 ~/.local/state/navegador/watchdog.log 2>/dev/null`,
        { user: 'user', timeoutMs: 8_000 },
      ),
      probe('server').catch(() => null),
      probe('agents').catch(() => null),
      cdpClients(BROWSERS.server.port).catch(() => []),
      cdpClients(BROWSERS.agents.port).catch(() => []),
    ]);
    const [unitBlock, logBlock = ''] = unitsRes.stdout.split('@@LOG');
    const units = parseUnits(unitBlock);
    return c.json({
      ok: true,
      browser: units.find((u) => u.unit === BROWSERS.server.unit) || null,
      agents: units.find((u) => u.unit === BROWSERS.agents.unit) || null,
      tabs: serverTabs || [],
      agentTabs: agentTabs || [],
      clients,
      agentClients,
      follow,
      log: logBlock.split('\n').map((l) => l.trim()).filter(Boolean).reverse(),
    });
  });

  // Vista en vivo: una captura JPEG de la pestaña, por HTTP normal. Es el plan
  // B cuando el WebSocket de noVNC no pasa (redes móviles que cortan Upgrade).
  app.get('/api/browser/screenshot', async (c) => {
    if (fixture) return c.body(null, 204);
    const which = whichOf(c.req.query('which'));
    const id = String(c.req.query('id') || '');
    const key = `${which}:${validId(id) ? id : ''}`;
    const now = Date.now();
    const headers = { 'content-type': 'image/jpeg', 'cache-control': 'no-store' };
    if (shotCache && shotCache.key === key && now - shotCache.at < 700) {
      return new Response(shotCache.data, { status: 200, headers });
    }
    const data = await screenshot(which, validId(id) ? id : undefined).catch(() => null);
    if (!data) return fail(c, 404, 'No hay pestaña para mostrar');
    shotCache = { key, at: now, data };
    return new Response(data, { status: 200, headers });
  });

  app.post('/api/browser/restart', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const which = body.target === 'agents' ? 'agents' : 'server';
    // Chrome se cierra ordenado (hasta 20 s) para guardar las cookies. El MCP
    // se reinicia después: su conexión CDP muere con el navegador y no vuelve
    // sola, así que quedaría enganchado a un Chrome que ya no existe.
    const res = await hostExec(
      `${USER_ENV} systemctl --user restart ${BROWSERS[which].unit} && systemctl --user restart ${BROWSERS[which].mcp}`,
      { user: 'user', timeoutMs: 60_000 },
    );
    if (!res.ok) return fail(c, 500, `No se pudo reiniciar ${BROWSERS[which].unit}`, { detail: (res.stderr || res.stdout).slice(0, 2000) });
    return c.json({ ok: true, unit: BROWSERS[which].unit });
  });

  app.post('/api/browser/cleanup', async (c) => {
    const res = await hostExec(`${USER_ENV} systemctl --user start ${WATCHDOG_UNIT}`, { user: 'user', timeoutMs: 60_000 });
    if (!res.ok) return fail(c, 500, 'No se pudo correr la limpieza', { detail: (res.stderr || res.stdout).slice(0, 2000) });
    return c.json({ ok: true });
  });

  app.post('/api/browser/tabs/close', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!validId(id)) return fail(c, 400, 'Pestaña inválida');
    const which = whichOf(body.which);
    const res = await fetch(`${BROWSERS[which].cdp}/json/close/${id}`, { method: 'PUT', signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (!res?.ok) return fail(c, 502, 'El navegador no cerró la pestaña', { detail: res ? `CDP ${res.status}` : `sin conexión a ${BROWSERS[which].cdp}` });
    return c.json({ ok: true });
  });

  app.post('/api/browser/tabs/activate', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!validId(id)) return fail(c, 400, 'Pestaña inválida');
    try {
      await activate(whichOf(body.which), id);
    } catch (e) {
      return fail(c, 502, 'No se pudo traer la pestaña al frente', { detail: String((e as Error).message).slice(0, 500) });
    }
    return c.json({ ok: true });
  });

  // Congelar deja la pestaña abierta pero sin correr nada: sirve para cortar el
  // CPU de una página que quedó girando sin cerrarla ni perder el estado.
  app.post('/api/browser/tabs/freeze', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!validId(id)) return fail(c, 400, 'Pestaña inválida');
    const on = body.frozen !== false;
    try {
      await freeze(whichOf(body.which), id, on);
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 500);
      return fail(c, msg.includes('al frente') ? 409 : 502, on ? 'No se pudo congelar la pestaña' : 'No se pudo descongelar la pestaña', { detail: msg });
    }
    return c.json({ ok: true });
  });

  app.post('/api/browser/follow', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const which = whichOf(body.which);
    follow[which] = body.on !== false;
    return c.json({ ok: true, follow });
  });

  app.post('/api/browser/clients/disconnect', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const pid = Number(body.pid);
    const which = whichOf(body.which);
    // Solo procesos que ahora mismo tienen el CDP enganchado: este endpoint no
    // puede usarse para matar cualquier otro proceso del usuario.
    if (!(await cdpClients(BROWSERS[which].port)).some((cl) => cl.pid === pid)) {
      return fail(c, 404, 'Ese proceso ya no está conectado al navegador');
    }
    const res = await hostExec(`kill -TERM ${pid}`, { user: 'user', timeoutMs: 5_000 });
    if (!res.ok) return fail(c, 500, 'No se pudo desconectar', { detail: (res.stderr || res.stdout).slice(0, 500) });
    return c.json({ ok: true });
  });

  // Abre una URL dentro del navegador del servidor. Comparte la red del host,
  // así que localhost:* son los servicios del propio servidor.
  app.post('/api/browser/open', async (c) => {
    const body = await c.req.json<{ url?: string; which?: string }>().catch(() => ({} as { url?: string; which?: string }));
    let u: URL;
    try { u = new URL((body.url || '').trim()); } catch { return fail(c, 400, 'URL inválida'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail(c, 400, 'Solo se pueden abrir URLs http/https');
    const cdp = BROWSERS[whichOf(body.which)].cdp;
    const res = await fetch(`${cdp}/json/new?${encodeURIComponent(u.toString())}`, { method: 'PUT', signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!res || !res.ok) {
      return fail(c, 502, 'El navegador del servidor no responde', { detail: res ? `CDP ${res.status}` : `sin conexión a ${cdp}` });
    }
    // json/new abre la pestaña de fondo: activarla para que el visor la muestre.
    const target = (await res.json().catch(() => ({}))) as { id?: string };
    if (target.id) {
      await fetch(`${cdp}/json/activate/${target.id}`, { method: 'PUT', signal: AbortSignal.timeout(3000) }).catch(() => {});
    }
    return c.json({ ok: true });
  });
}
