import type { Hono } from 'hono';
import { hostExec, hostSpawnDetached, hostSpawnInteractive, killHostProc } from './host';
import { body, only, protect } from './storage/http';
import { MaintenanceError } from './storage/types';
import { CONTAINER, DIR, clean, currentJob, heavyBusy, jobRunning, lastLines, q, safeJson, sleep, startJob, stripAnsi } from './openbot-shared';

/* "Bots": gestión de la instancia de OpenBot que corre en Docker en el host.
 * Todo pasa por comandos fijos del host (docker / scripts de ~/openbot-server);
 * ninguna entrada del navegador se interpola en un shell sin validar y citar. */

export { stripAnsi } from './openbot-shared';

export const BIG_BODY = 8_000_000;   // solo las rutas de cookies leen cuerpos grandes; el resto sigue en 300 KB
export const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
export const CODE = /^[A-Za-z0-9-]{4,24}$/;

export interface OpenBotStatus {
  version: string | null;
  account: string | null;
  signedIn: boolean;
  server: string | null;
  online: boolean;
  memory: string | null;
  concurrency: string | null;
}

export function parseStatus(text: string): OpenBotStatus {
  const lines = stripAnsi(text).split('\n').map((l) => l.trim());
  const pick = (re: RegExp) => lines.map((l) => l.match(re)).find(Boolean)?.[1] ?? null;
  const account = pick(/^Account:\s*(.+)$/);
  const server = pick(/^Server:\s*(.+)$/);
  const signedIn = !!account && !/^signed out/i.test(account);
  return {
    version: pick(/^OpenBot\s+(\d+\.\d+\.\d+)/),
    account: signedIn ? account : null,
    signedIn,
    server,
    online: !!server && /\(online\)/i.test(server),
    memory: pick(/^Memory:\s*(.+)$/),
    concurrency: pick(/^Turns at the same time:\s*(.+)$/),
  };
}

/** El CLI dibuja el QR con medio-bloques y colores ANSI (fondo claro, módulos oscuros, y alguna fila con
 *  el color invertido). Se interpretan los colores, no solo los glifos, y se devuelve la matriz de módulos:
 *  una cadena por fila con '1' = oscuro y '0' = claro. */
export function parseQr(text: string): string[] {
  const rows: string[][] = [];
  for (const raw of text.split('\n')) {
    const plain = stripAnsi(raw).replace(/\r$/, '');
    if (plain.length < 20 || !/^[ ▀▄█]+$/.test(plain)) continue;
    let fg: boolean | null = null, bg: boolean | null = null; // true = oscuro
    const top: string[] = [], bottom: string[] = [];
    const re = /\u001b\[([0-9;]*)m|([ ▀▄█])/g; let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      if (m[2] === undefined) {
        for (const code of (m[1] || '0').split(';').map(Number)) {
          if (code === 0) { fg = null; bg = null; }
          else if (code === 39) fg = null;
          else if (code === 49) bg = null;
          else if (code >= 30 && code <= 37) fg = code === 30;
          else if (code >= 40 && code <= 47) bg = code === 40;
          else if (code >= 90 && code <= 97) fg = false;
          else if (code >= 100 && code <= 107) bg = false;
        }
        continue;
      }
      const f = fg ?? false, b = bg ?? false;
      const [t, u] = m[2] === ' ' ? [b, b] : m[2] === '█' ? [f, f] : m[2] === '▀' ? [f, b] : [b, f];
      top.push(t ? '1' : '0'); bottom.push(u ? '1' : '0');
    }
    rows.push(top, bottom);
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.filter((r) => r.length === width && width >= 20).map((r) => r.join(''));
}

export { usageCommand } from './openbot-usage';
import { readUsage } from './openbot-usage';

// ---------------------------------------------------------------- login interactivo
interface LoginSession {
  child: ReturnType<typeof hostSpawnInteractive>;
  email: string; output: string; exited: boolean; exitCode: number | null; startedAt: number; timer: ReturnType<typeof setTimeout>; attempts?: number;
}
let login: LoginSession | null = null;
const LOGIN_TTL = 10 * 60_000;

function endLogin() {
  if (!login) return;
  clearTimeout(login.timer);
  if (!login.exited) { try { killHostProc(login.child); } catch { /* ya terminó */ } }
  login = null;
}
async function pump(stream: ReadableStream | number | undefined, s: LoginSession) {
  if (!stream || typeof stream === 'number') return;
  const reader = (stream as ReadableStream<Uint8Array>).getReader(); const dec = new TextDecoder();
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; s.output += dec.decode(value); if (s.output.length > 20_000) s.output = s.output.slice(-20_000); } } catch { /* cerrado */ }
}
async function waitFor(s: LoginSession, test: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end && !test()) await sleep(150);
}

export async function loginStart(email: string) {
  endLogin();
  // El CLI exige una terminal real ("Run openbot login in a terminal"): `script` le da un pty.
  const inner = `docker exec -it ${CONTAINER} openbot login ${q(email)}`;
  const child = hostSpawnInteractive(`script -qfec ${q(inner)} /dev/null`, { user: 'user' });
  const s: LoginSession = { child, email, output: '', exited: false, exitCode: null, startedAt: Date.now(), timer: setTimeout(endLogin, LOGIN_TTL) };
  login = s;
  void pump(child.stdout as ReadableStream, s); void pump(child.stderr as ReadableStream, s);
  void child.exited.then((code) => { s.exited = true; s.exitCode = code; });
  await waitFor(s, () => s.exited || /\bCode:\s*$/.test(clean(s.output)), 25_000);
  const text = clean(s.output);
  if (s.exited) {
    if (login === s) login = null; clearTimeout(s.timer);
    const already = s.exitCode === 0 && /Account:\s*\S+@/i.test(text) && !/signed out/i.test(text);
    return already ? { ok: true, stage: 'done' as const, message: 'Ya había una sesión abierta con esa cuenta.' } : { ok: true, stage: 'error' as const, message: lastLines(text) || 'No se pudo iniciar el login' };
  }
  return { ok: true, stage: 'code' as const, message: `OpenBot envió un código a ${email}. Pegalo acá (vence en 10 minutos).` };
}

export async function loginCode(code: string) {
  const s = login;
  if (!s || s.exited) { endLogin(); return { ok: true, stage: 'error' as const, message: 'No hay un login en curso. Empezá de nuevo.' }; }
  const before = s.output.length;
  (s.child.stdin as Bun.FileSink).write(code + '\n'); (s.child.stdin as Bun.FileSink).flush?.();
  const fresh = () => clean(s.output.slice(before)).split(code).join('·····');
  await waitFor(s, () => s.exited || /signed in|incorrect|expired|invalid|too many|try again/i.test(fresh()), 45_000);
  const text = fresh();
  if (/signed in/i.test(text)) {
    await waitFor(s, () => s.exited, 30_000);       // "Publishing the server…" y salida
    if (login === s) { clearTimeout(s.timer); login = null; }
    return { ok: true, stage: 'done' as const, message: 'Sesión iniciada.' };
  }
  // El CLI vuelve a pedir el código: dejamos la sesión viva para reintentar (máx. 5 intentos).
  s.attempts = (s.attempts || 0) + 1;
  const message = /expired/i.test(text) ? 'El código venció. Pedí uno nuevo.' : /too many/i.test(text) ? 'Demasiados intentos. Esperá unos minutos.' : 'Código incorrecto. Revisalo e intentá de nuevo.';
  if (s.exited || s.attempts >= 5 || /expired|too many/i.test(text)) { endLogin(); return { ok: true, stage: 'error' as const, message }; }
  return { ok: true, stage: 'code' as const, message };
}

// ---------------------------------------------------------------- acciones
export const ACTIONS = ['restart', 'start', 'stop', 'backup', 'update'] as const;
export type Action = typeof ACTIONS[number];
let busy: { action: Action; at: number } | null = null;
const BUSY_MS: Record<Action, number> = { restart: 120_000, start: 60_000, stop: 120_000, backup: 600_000, update: 1_800_000 };
export const actionBusy = (): Action | null => (busy && Date.now() - busy.at < BUSY_MS[busy.action] ? busy.action : null);
let homeCache: string | undefined;
async function home() {
  if (!homeCache) homeCache = (await hostExec('echo "$HOME"', { user: 'user', timeoutMs: 10_000 })).stdout.trim();
  return homeCache;
}

export async function runAction(action: Action) {
  if (busy && Date.now() - busy.at < BUSY_MS[busy.action]) throw new MaintenanceError(`Ya hay una acción en curso (${busy.action}). Esperá a que termine.`, 409);
  busy = { action, at: Date.now() };
  const done = () => { if (busy?.action === action) busy = null; };
  try {
    if (action === 'restart') {
      const r = await hostExec(`cd ${DIR} && rm -f state/manual-stop; docker restart -t 60 ${CONTAINER}`, { user: 'user', timeoutMs: 100_000 });
      done(); return { ok: r.ok, message: r.ok ? 'OpenBot reiniciado' : 'No se pudo reiniciar' };
    }
    if (action === 'start') {
      const r = await hostExec(`cd ${DIR} && rm -f state/manual-stop; docker start ${CONTAINER}`, { user: 'user', timeoutMs: 60_000 });
      done(); return { ok: r.ok, message: r.ok ? 'OpenBot iniciado' : 'No se pudo iniciar' };
    }
    if (action === 'stop') {
      const r = await hostExec(`cd ${DIR} && mkdir -p state && touch state/manual-stop && docker stop -t 60 ${CONTAINER}`, { user: 'user', timeoutMs: 100_000 });
      done(); return { ok: r.ok, message: r.ok ? 'OpenBot detenido. El vigilante no lo levanta hasta que lo inicies.' : 'No se pudo detener' };
    }
    // backup / update: largos y con el contenedor parado un rato; corren desacoplados con su propio log.
    const h = await home();
    const script = action === 'backup' ? './bin/backup.sh' : './bin/safe-update.sh';
    const log = `${h}/openbot-server/state/panel-${action}.log`;
    const r = await hostSpawnDetached(`{ echo "=== $(date -u +%FT%TZ) ${action} desde AXON ==="; ${script}; }`, `${h}/openbot-server`, log, 'user');
    if (!r.ok) { done(); return { ok: false, message: 'No se pudo lanzar la tarea' }; }
    setTimeout(done, BUSY_MS[action]);
    return { ok: true, message: action === 'backup' ? 'Backup en curso (el bot se detiene ~1 minuto y vuelve solo)' : 'Chequeando actualización: hace backup, prueba en copia y aplica solo si es seguro' };
  } catch (e) { done(); throw e; }
}

// ---------------------------------------------------------------- estado
const STATUS_CMD = [
  `docker inspect ${CONTAINER} --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.Config.Image}}|{{.State.StartedAt}}|{{.RestartCount}}' 2>/dev/null || echo 'missing'`,
  `echo '@@STATUS'; timeout 20 docker exec ${CONTAINER} openbot status 2>&1`,
  `echo '@@UPDATE'; cat ${DIR}/state/update-status.json 2>/dev/null`,
  `echo '@@ALERTS'; tail -n 5 ${DIR}/state/alerts.ndjson 2>/dev/null`,
  `echo '@@BACKUP'; ls -1d ${DIR}/backups/2* 2>/dev/null | tail -n 1; test -e ${DIR}/state/manual-stop && echo MANUAL_STOP`,
  `echo '@@TIMER'; XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus systemctl --user list-timers openbot-update.timer --no-legend 2>/dev/null | head -n 1`,
].join('; ');

export function parseOverview(raw: string) {
  const parts = raw.split(/^@@(\w+)$/m);
  const sections: Record<string, string> = { HEAD: parts[0] };
  for (let i = 1; i < parts.length; i += 2) sections[parts[i]] = (parts[i + 1] || '').replace(/^\n/, '');
  const head = sections.HEAD.trim().split('\n')[0] || 'missing';
  const [state, health, image, startedAt, restarts] = head.split('|');
  const container = head === 'missing' ? { exists: false } : { exists: true, state, health: health || null, image, startedAt, restarts: Number(restarts) || 0 };
  const status = parseStatus(sections.STATUS || '');
  const update = safeJson<Record<string, string>>((sections.UPDATE || '').trim());
  const alerts = (sections.ALERTS || '').trim().split('\n').filter(Boolean).map((l) => safeJson<{ at: string; msg: string }>(l)).filter(Boolean).slice(-5);
  const backupLines = (sections.BACKUP || '').trim().split('\n').filter(Boolean);
  const manualStop = backupLines.includes('MANUAL_STOP');
  const lastBackup = backupLines.find((l) => /\/2\d{7}T/.test(l))?.match(/(2\d{7}T\d{6}Z)/)?.[1] ?? null;
  const timerLine = (sections.TIMER || '').trim();
  const nextUpdate = timerLine.match(/^\w{3}\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)?.[1] ?? null;
  return { container, status, update, alerts, lastBackup, manualStop, nextUpdate };
}

const PERIODS = ['today', '7', '30', 'all'];

export function registerOpenBot(app: Hono) {
  protect(app, '/api/openbot', BIG_BODY);
  const fail = (c: any, e: unknown, fallback: string) => {
    if (e instanceof MaintenanceError) return e.getResponse();
    return c.json({ ok: false, error: fallback }, 503);
  };

  app.get('/api/openbot/status', async (c) => {
    try {
      const r = await hostExec(STATUS_CMD, { user: 'user', timeoutMs: 40_000 });
      return c.json({ ok: true, ...parseOverview(r.stdout), loginPending: !!login && !login.exited });
    } catch (e) { return fail(c, e, 'No se pudo leer el estado de OpenBot'); }
  });

  app.get('/api/openbot/usage', async (c) => {
    const period = c.req.query('period') || '7';
    if (!PERIODS.includes(period) || Object.keys(c.req.query()).some((k) => k !== 'period')) return c.json({ ok: false, error: 'Período no válido' }, 400);
    try {
      const data = await readUsage(period);
      if (!data?.ok) return c.json({ ok: false, error: data?.error || 'No se pudo leer el consumo' }, 503);
      return c.json(data);
    } catch (e) { return fail(c, e, 'No se pudo leer el consumo'); }
  });

  app.get('/api/openbot/logs', async (c) => {
    const which = c.req.query('source') || 'openbot';
    const sources: Record<string, string> = {
      openbot: `docker logs --tail 200 ${CONTAINER} 2>&1 | grep -v -i -E 'dbus|object_proxy' | tail -n 150`,
      update: `tail -n 120 ${DIR}/state/panel-update.log 2>/dev/null; echo '--- diario ---'; journalctl --user -u openbot-update.service -n 40 --no-pager 2>/dev/null | cat`,
      backup: `tail -n 80 ${DIR}/state/panel-backup.log 2>/dev/null`,
      watchdog: `journalctl --user -u openbot-watchdog.service -n 60 --no-pager 2>/dev/null | cat`,
    };
    if (!sources[which]) return c.json({ ok: false, error: 'Fuente no válida' }, 400);
    try {
      const r = await hostExec(sources[which], { user: 'user', timeoutMs: 20_000 });
      return c.json({ ok: true, text: stripAnsi(r.stdout).slice(-40_000) });
    } catch (e) { return fail(c, e, 'No se pudo leer el log'); }
  });

  app.post('/api/openbot/mobile-connect', async (c) => {
    try {
      only(await body(c), []);
      const r = await hostExec(`timeout 25 docker exec ${CONTAINER} openbot mobile-connect 2>&1`, { user: 'user', timeoutMs: 30_000 });
      const qr = parseQr(r.stdout);
      if (qr.length < 20) return c.json({ ok: false, error: lastLines(r.stdout) || 'OpenBot no mostró el código. ¿Hay sesión iniciada?' }, 409);
      return c.json({ ok: true, qr, expiresInSeconds: 120 });
    } catch (e) { return fail(c, e, 'No se pudo generar el código de conexión'); }
  });

  app.post('/api/openbot/login/start', async (c) => {
    try {
      const b = await body(c); only(b, ['email']);
      const email = typeof b.email === 'string' ? b.email.trim() : '';
      if (!EMAIL.test(email)) throw new MaintenanceError('Email no válido', 400);
      return c.json(await loginStart(email));
    } catch (e) { return fail(c, e, 'No se pudo iniciar el login'); }
  });

  app.post('/api/openbot/login/code', async (c) => {
    try {
      const b = await body(c); only(b, ['code']);
      const code = typeof b.code === 'string' ? b.code.trim() : '';
      if (!CODE.test(code)) throw new MaintenanceError('Código no válido', 400);
      return c.json(await loginCode(code));
    } catch (e) { return fail(c, e, 'No se pudo confirmar el código'); }
  });

  app.post('/api/openbot/login/cancel', async (c) => { try { only(await body(c), []); } catch (e) { return fail(c, e, 'Solicitud no válida'); } endLogin(); return c.json({ ok: true }); });

  app.get('/api/openbot/job', (c) => c.json({ ok: true, job: currentJob() }));

  app.post('/api/openbot/action', async (c) => {
    try {
      const b = await body(c); only(b, ['action']);
      if (typeof b.action !== 'string' || !(ACTIONS as readonly string[]).includes(b.action)) throw new MaintenanceError('Acción no válida', 400);
      const action = b.action as Action;
      const other = heavyBusy();
      if (other || jobRunning()) throw new MaintenanceError(`Hay otra operación en curso (${other || currentJob()?.name}). Esperá a que termine.`, 409);
      // backup y update salen desacoplados (ya son rápidos de lanzar); el resto puede tardar y va como tarea.
      if (action === 'backup' || action === 'update') return c.json(await runAction(action));
      const labels: Record<string, string> = { restart: 'Reiniciar OpenBot', start: 'Iniciar OpenBot', stop: 'Detener OpenBot' };
      return c.json({ ok: true, started: true, job: startJob(labels[action], async () => { const r = await runAction(action); if (!r.ok) throw new MaintenanceError(r.message, 503); return { message: r.message }; }) });
    } catch (e) { return fail(c, e, 'No se pudo ejecutar la acción'); }
  });
}
