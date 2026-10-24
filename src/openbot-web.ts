import type { Hono } from 'hono';
import { body, only, protect } from './storage/http';
import { MaintenanceError } from './storage/types';
import { CONTAINER, DIR, VOLUME, asRoot, homeDir, jobRunning, q, runWithStdin, safeJson, sh, sleep, startJob, waitReady, withHeavy } from './openbot-shared';

/* Cuentas web: el navegador que usan los agentes de OpenBot guarda sus sesiones en una partición
 * persistente (Partitions/openbot-browser, base de cookies de Chromium dentro del volumen de datos).
 * Listar es de solo lectura sobre una copia. Importar o borrar cookies exige parar OpenBot unos
 * segundos: Chromium mantiene las cookies en memoria y pisaría cualquier cambio externo. */

export const COOKIE_DB = '.config/OpenBot/Partitions/openbot-browser/Cookies';
const MAX_COOKIES = 5000;
const BIG_BODY = 8_000_000;
const DAY = 86_400;

export interface NormCookie { name: string; value: string; domain: string; path: string; expires: number; session: boolean; secure: boolean; httpOnly: boolean; sameSite: -1 | 0 | 1 | 2 }
export interface ParseResult { cookies: NormCookie[]; skipped: string[] }

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f]/;
const NAME = /^[^\s;=\u0000-\u001f\u007f]{1,256}$/;
const HOST = /^\.?[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;

function sameSite(v: unknown): -1 | 0 | 1 | 2 {
  const s = String(v ?? '').toLowerCase();
  if (s === 'no_restriction' || s === 'none') return 0;
  if (s === 'lax') return 1;
  if (s === 'strict') return 2;
  return -1;
}

function normalize(raw: Record<string, unknown>, now: number, hostOnlyHint?: boolean): { cookie?: NormCookie; skip?: string } {
  const name = typeof raw.name === 'string' ? raw.name : '';
  const value = raw.value === undefined || raw.value === null ? '' : String(raw.value);
  if (!NAME.test(name)) return { skip: `nombre inválido (${name.slice(0, 30) || 'vacío'})` };
  if (CTRL.test(value) || value.length > 8192) return { skip: `${name}: valor inválido o demasiado largo` };
  let domain = typeof raw.domain === 'string' ? raw.domain : typeof raw.host === 'string' ? raw.host : '';
  if (!domain && typeof raw.url === 'string') { try { domain = new URL(raw.url).hostname; } catch { /* sin dominio */ } }
  domain = domain.trim().toLowerCase();
  const hostOnly = raw.hostOnly === true ? true : raw.hostOnly === false ? false : hostOnlyHint;
  if (hostOnly === true) domain = domain.replace(/^\./, ''); else if (hostOnly === false && domain && !domain.startsWith('.')) domain = '.' + domain;
  const bare = domain.replace(/^\./, '');
  if (!HOST.test(domain) || !bare.includes('.') || bare.includes('..')) return { skip: `${name}: dominio inválido (${domain.slice(0, 40) || 'vacío'})` };
  const path = typeof raw.path === 'string' && raw.path ? raw.path : '/';
  if (!path.startsWith('/') || path.length > 512 || CTRL.test(path)) return { skip: `${name}: ruta inválida` };
  let exp = Number(raw.expirationDate ?? raw.expires ?? raw.expiry ?? raw.expiresDate ?? 0);
  if (!Number.isFinite(exp)) exp = 0;
  if (exp > 1e12) exp = exp / 1000;                       // milisegundos
  const session = raw.session === true || exp <= 0;
  if (!session && exp <= now) return { skip: `${name} (${bare}): ya venció` };
  // Una cookie de sesión no sobreviviría al reinicio de OpenBot; se guarda 30 días. Chromium limita a ~400 días.
  const expires = Math.min(session ? now + 30 * DAY : exp, now + 399 * DAY);
  const secure = raw.secure === true || raw.secure === 'TRUE' || raw.secure === 1;
  const httpOnly = raw.httpOnly === true || raw.httpOnly === 'TRUE' || raw.http_only === true || raw.httpOnly === 1;
  let ss = sameSite(raw.sameSite ?? raw.same_site);
  if (ss === 0 && !secure) ss = -1;                       // SameSite=None exige Secure
  return { cookie: { name, value, domain, path, expires: Math.floor(expires), session, secure, httpOnly, sameSite: ss } };
}

/** Acepta JSON (Cookie-Editor / EditThisCookie / storageState de Playwright) o texto Netscape (cookies.txt). */
export function parseCookies(input: string, now = Math.floor(Date.now() / 1000)): ParseResult {
  const text = input.trim();
  const skipped: string[] = []; const out: NormCookie[] = [];
  if (!text) return { cookies: [], skipped: ['No pegaste nada'] };
  if (text.startsWith('[') || text.startsWith('{')) {
    const data = safeJson<unknown>(text);
    const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as any).cookies) ? (data as any).cookies : null;
    if (!list) return { cookies: [], skipped: ['JSON no reconocido: se espera una lista de cookies'] };
    for (const item of list) {
      if (!item || typeof item !== 'object') { skipped.push('elemento que no es una cookie'); continue; }
      const r = normalize(item as Record<string, unknown>, now);
      if (r.cookie) out.push(r.cookie); else if (r.skip) skipped.push(r.skip);
    }
  } else {
    for (const rawLine of text.split(/\r?\n/)) {
      let line = rawLine.trim(); if (!line) continue;
      let httpOnly = false;
      if (line.startsWith('#HttpOnly_')) { httpOnly = true; line = line.slice('#HttpOnly_'.length); } else if (line.startsWith('#')) continue;
      const f = line.includes('\t') ? line.split('\t') : line.split(/\s+/);
      if (f.length < 7) { skipped.push('línea que no es Netscape'); continue; }
      const [domain, flag, path, secure, expires, name, ...rest] = f;
      const r = normalize({ domain, hostOnly: flag.toUpperCase() !== 'TRUE', path, secure: secure.toUpperCase() === 'TRUE', expires: Number(expires), name, value: rest.join('\t'), httpOnly }, now);
      if (r.cookie) out.push(r.cookie); else if (r.skip) skipped.push(r.skip);
    }
  }
  if (out.length > MAX_COOKIES) { skipped.push(`se importan solo las primeras ${MAX_COOKIES}`); out.length = MAX_COOKIES; }
  return { cookies: out, skipped: skipped.slice(0, 20) };
}

// ---------------------------------------------------------------- servicios conocidos
export interface ServiceDef { id: string; name: string; login: string; domains: string[] }
export const SERVICES: ServiceDef[] = [
  { id: 'google', name: 'Google', login: 'https://accounts.google.com/', domains: ['google.com', 'google.com.ar', 'youtube.com', 'gstatic.com', 'googleusercontent.com'] },
  { id: 'cloudflare', name: 'Cloudflare', login: 'https://dash.cloudflare.com/login', domains: ['cloudflare.com'] },
  { id: 'neon', name: 'Neon', login: 'https://console.neon.tech/', domains: ['neon.tech', 'neon.com'] },
  { id: 'github', name: 'GitHub', login: 'https://github.com/login', domains: ['github.com'] },
  { id: 'vercel', name: 'Vercel', login: 'https://vercel.com/login', domains: ['vercel.com'] },
  { id: 'shopify', name: 'Shopify', login: 'https://accounts.shopify.com/', domains: ['shopify.com', 'myshopify.com'] },
  { id: 'meta', name: 'Meta (Facebook / Instagram)', login: 'https://business.facebook.com/', domains: ['facebook.com', 'instagram.com', 'meta.com'] },
  { id: 'microsoft', name: 'Microsoft', login: 'https://login.microsoftonline.com/', domains: ['microsoft.com', 'live.com', 'microsoftonline.com', 'office.com'] },
  { id: 'openai', name: 'OpenAI', login: 'https://platform.openai.com/', domains: ['openai.com', 'chatgpt.com'] },
  { id: 'anthropic', name: 'Anthropic', login: 'https://console.anthropic.com/', domains: ['anthropic.com', 'claude.ai'] },
  { id: 'dropbox', name: 'Dropbox', login: 'https://www.dropbox.com/login', domains: ['dropbox.com'] },
  { id: 'mercadolibre', name: 'Mercado Libre / Pago', login: 'https://www.mercadolibre.com.ar/', domains: ['mercadolibre.com.ar', 'mercadolibre.com', 'mercadopago.com.ar', 'mercadopago.com'] },
  { id: 'linkedin', name: 'LinkedIn', login: 'https://www.linkedin.com/login', domains: ['linkedin.com'] },
  { id: 'x', name: 'X (Twitter)', login: 'https://x.com/i/flow/login', domains: ['x.com', 'twitter.com'] },
  { id: 'tiktok', name: 'TikTok', login: 'https://www.tiktok.com/login', domains: ['tiktok.com'] },
  { id: 'opencode', name: 'OpenCode', login: 'https://opencode.ai/auth', domains: ['opencode.ai'] },
];
export function serviceFor(host: string): ServiceDef | null {
  const h = host.replace(/^\./, '').toLowerCase();
  return SERVICES.find((s) => s.domains.some((d) => h === d || h.endsWith('.' + d))) || null;
}
/** Dominio "registrable" aproximado para agrupar lo que no está en el catálogo. */
export function groupKey(host: string): string {
  const parts = host.replace(/^\./, '').toLowerCase().split('.');
  const second = ['com', 'net', 'org', 'gov', 'edu', 'co'];
  return parts.length > 2 && second.includes(parts[parts.length - 2]) ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}

// ---------------------------------------------------------------- scripts de base de datos
const b64 = (s: string) => Buffer.from(s).toString('base64');

// Lee metadatos (nunca valores) de una COPIA de la base de cookies.
const LIST_PY = String.raw`
import json, sqlite3, sys, time
db = sqlite3.connect(sys.argv[1])
EPOCH = 11644473600
now = time.time()
def u(v): return (v / 1e6 - EPOCH) if v else 0
rows = db.execute("select host_key, count(*), max(expires_utc), max(last_access_utc), sum(is_persistent), sum(length(encrypted_value) > 0), sum(is_secure) from cookies group by host_key").fetchall()
out = [dict(host=r[0], count=r[1], expires=u(r[2]) if u(r[2]) < 4e9 else 0, lastAccess=u(r[3]), persistent=r[4] or 0, encrypted=r[5] or 0, secure=r[6] or 0) for r in rows]
print(json.dumps(dict(ok=True, now=now, hosts=out)))
`;

// Inserta cookies en la base REAL (con OpenBot detenido). Valores en texto plano: Chromium los lee y los
// vuelve a cifrar cuando las actualiza. Reemplaza las que tengan el mismo dominio, nombre y ruta.
export const IMPORT_PY = String.raw`
import json, sqlite3, sys, time
EPOCH = 11644473600
path = sys.argv[1]; data = json.load(sys.stdin)
db = sqlite3.connect(path)
cols = [r[1] for r in db.execute("pragma table_info(cookies)")]
now = int((time.time() + EPOCH) * 1e6)
n = 0
for c in data["cookies"]:
    host = c["domain"]
    db.execute("delete from cookies where host_key = ? and name = ? and path = ?", (host, c["name"], c["path"]))
    row = dict(creation_utc=now + n, host_key=host, top_frame_site_key="", name=c["name"], value=c["value"], encrypted_value=b"",
               path=c["path"], expires_utc=int((c["expires"] + EPOCH) * 1e6), is_secure=int(c["secure"]), is_httponly=int(c["httpOnly"]),
               last_access_utc=now + n, has_expires=1, is_persistent=1, priority=1, samesite=c["sameSite"],
               source_scheme=2 if c["secure"] else 1, source_port=443 if c["secure"] else 80, last_update_utc=now + n, source_type=0,
               has_cross_site_ancestor=0)
    row = {k: v for k, v in row.items() if k in cols}
    db.execute("insert or replace into cookies (%s) values (%s)" % (",".join(row), ",".join("?" * len(row))), list(row.values()))
    n += 1
db.commit(); db.execute("pragma wal_checkpoint(truncate)"); db.close()
print(json.dumps(dict(ok=True, imported=n)))
`;

// Borra cookies por dominio exacto (host_key) en la base REAL, con OpenBot detenido.
export const DELETE_PY = String.raw`
import json, sqlite3, sys
path = sys.argv[1]; hosts = json.load(sys.stdin)["hosts"]
db = sqlite3.connect(path); n = 0
for h in hosts:
    n += db.execute("delete from cookies where host_key = ?", (h,)).rowcount
db.commit(); db.execute("pragma wal_checkpoint(truncate)"); db.close()
print(json.dumps(dict(ok=True, deleted=n)))
`;

// ---------------------------------------------------------------- lectura
export interface HostRow { host: string; count: number; expires: number; lastAccess: number; persistent: number; encrypted: number; secure: number }
export interface Account { id: string; name: string; known: boolean; login: string | null; domains: string[]; cookies: number; expires: number | null; lastAccess: number | null; state: 'active' | 'expiring' | 'expired' }

export function buildAccounts(hosts: HostRow[], now = Date.now() / 1000): Account[] {
  const groups = new Map<string, Account>();
  for (const h of hosts) {
    const svc = serviceFor(h.host);
    const id = svc ? svc.id : groupKey(h.host);
    const g = groups.get(id) || { id, name: svc ? svc.name : id, known: !!svc, login: svc ? svc.login : null, domains: [], cookies: 0, expires: null, lastAccess: null, state: 'active' as const };
    g.domains.push(h.host); g.cookies += h.count;
    if (h.expires) g.expires = Math.max(g.expires ?? 0, h.expires);
    if (h.lastAccess) g.lastAccess = Math.max(g.lastAccess ?? 0, h.lastAccess);
    groups.set(id, g);
  }
  const list = [...groups.values()];
  for (const g of list) {
    g.domains.sort();
    // Sin vencimiento persistente => cookie de sesión (se pierde al cerrar). Vencida o por vencer en una semana => aviso.
    g.state = g.expires !== null && g.expires < now ? 'expired' : g.expires !== null && g.expires < now + 7 * DAY ? 'expiring' : 'active';
  }
  return list.sort((a, b) => Number(b.known) - Number(a.known) || b.cookies - a.cookies);
}

export function catalog(accounts: Account[]) {
  const have = new Set(accounts.map((a) => a.id));
  return SERVICES.map((s) => ({ id: s.id, name: s.name, login: s.login, connected: have.has(s.id) }));
}

const COPY_COOKIES = (dest: string) => `docker cp ${CONTAINER}:/data/${COOKIE_DB} ${dest}/Cookies >/dev/null 2>&1 && docker cp ${CONTAINER}:/data/${COOKIE_DB}-wal ${dest}/Cookies-wal >/dev/null 2>&1; test -s ${dest}/Cookies`;

export async function readAccounts() {
  const r = await sh(`T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; ${COPY_COOKIES('"$T"')} || { echo '{"ok":false}'; exit 0; }; echo ${b64(LIST_PY)} | base64 -d | python3 - "$T/Cookies"`, 40_000);
  const data = safeJson<{ ok: boolean; now: number; hosts: HostRow[] }>(r.stdout.trim().split('\n').pop() || '');
  if (!data?.ok) throw new MaintenanceError('No se pudo leer la base de cookies del navegador de OpenBot', 503);
  const accounts = buildAccounts(data.hosts, data.now);
  // Pestañas abiertas por agente (para saber en qué sitios está trabajando cada uno).
  const tabsRaw = await sh(`docker exec ${CONTAINER} cat /data/.config/OpenBot/openbot-browser-state-v1.json 2>/dev/null`, 15_000);
  const state = safeJson<{ tabs?: { url?: string; ownerAgentId?: string }[] }>(tabsRaw.stdout);
  const tabs = (state?.tabs || []).map((t) => { try { const u = new URL(String(t.url)); return { host: u.hostname, path: u.pathname.slice(0, 60), agent: t.ownerAgentId || null }; } catch { return null; } }).filter(Boolean).slice(0, 40);
  return { accounts, catalog: catalog(accounts), tabs, totalCookies: data.hosts.reduce((n, h) => n + h.count, 0) };
}

// ---------------------------------------------------------------- escritura (para OpenBot unos segundos)
const STAMP = /^\d{8}T\d{6}Z$/;
const stampNow = () => new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

/** Para OpenBot, aplica `script` (python) sobre la base REAL con respaldo previo y lo vuelve a levantar.
 *  Pase lo que pase OpenBot vuelve a arrancar; si el script falla se restaura el respaldo. */
export async function editCookieDb(label: string, script: string, payload: unknown): Promise<{ output: Record<string, unknown>; backup: string }> {
  return withHeavy(label, 10 * 60_000, async () => {
    const home = await homeDir();
    const backupDir = `${home}/openbot-server/state/cookie-backups`;
    const backup = `Cookies.${stampNow()}`;
    const stop = await sh(`set -e; cd ${DIR}; mkdir -p state/cookie-backups; chmod 700 state/cookie-backups; touch state/manual-stop; docker stop -t 60 ${CONTAINER} >/dev/null`, 110_000);
    const start = () => sh(`cd ${DIR}; rm -f state/manual-stop; docker start ${CONTAINER} >/dev/null 2>&1`, 40_000);
    if (!stop.ok) { await start(); throw new MaintenanceError('No se pudo detener OpenBot para editar las cookies', 503); }
    let failure: string | null = null; let output: Record<string, unknown> = {};
    try {
      const vol = (await sh(`docker volume inspect ${VOLUME} --format '{{.Mountpoint}}'`, 20_000)).stdout.trim();
      if (!vol.endsWith(`/${VOLUME}/_data`) || !/^\/[\w./-]+\/_data$/.test(vol)) throw new Error('No se encontró el volumen de datos');
      const dbPath = `${vol}/${COOKIE_DB}`;
      const bak = await asRoot(`set -e; test -f ${q(dbPath)}; U=$(stat -c %u ${q(home)}); G=$(stat -c %g ${q(home)}); install -m 600 -o $U -g $G ${q(dbPath)} ${q(`${backupDir}/${backup}`)}; ls -1t ${q(backupDir)} | tail -n +11 | while read f; do rm -f ${q(backupDir)}/"$f"; done`, 40_000);
      if (!bak.ok) throw new Error('No se pudo hacer el respaldo de las cookies');
      const run = await runWithStdin(`S=$(mktemp); echo ${b64(script)} | base64 -d > "$S"; python3 "$S" ${q(dbPath)}; rc=$?; rm -f "$S"; exit $rc`, JSON.stringify(payload), 'root', 60_000);
      output = safeJson<Record<string, unknown>>(run.stdout.trim().split('\n').pop() || '') || {};
      if (!run.ok || output.ok !== true) {
        await asRoot(`install -m 600 -o 1000 -g 1000 ${q(`${backupDir}/${backup}`)} ${q(dbPath)}`, 30_000);
        throw new Error('La edición falló; se restauró el respaldo');
      }
    } catch (e) { failure = e instanceof Error ? e.message : 'Error desconocido'; }
    await start();
    const up = await waitReady(150);
    if (failure) throw new MaintenanceError(`${failure}${up ? '' : '. OpenBot tarda en volver: revisá Diagnóstico'}`, 503);
    if (!up) throw new MaintenanceError('Se aplicó el cambio, pero OpenBot no volvió a responder todavía. Revisá Diagnóstico.', 503);
    return { output, backup };
  });
}

const HOSTNAME = /^\.?[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;

export function registerOpenBotWeb(app: Hono) {
  protect(app, '/api/openbot/web', BIG_BODY);
  const fail = (c: any, e: unknown, fallback: string) => (e instanceof MaintenanceError ? e.getResponse() : c.json({ ok: false, error: fallback }, 503));

  app.get('/api/openbot/web/accounts', async (c) => {
    try { return c.json({ ok: true, ...(await readAccounts()) }); } catch (e) { return fail(c, e, 'No se pudieron leer las cuentas'); }
  });

  app.post('/api/openbot/web/preview', async (c) => {
    try {
      const b = await body(c, BIG_BODY); only(b, ['text']);
      if (typeof b.text !== 'string') throw new MaintenanceError('Falta el texto de las cookies', 400);
      const r = parseCookies(b.text);
      const byDomain = new Map<string, number>(); for (const k of r.cookies) byDomain.set(k.domain, (byDomain.get(k.domain) || 0) + 1);
      return c.json({ ok: true, count: r.cookies.length, skipped: r.skipped, domains: [...byDomain].map(([domain, n]) => ({ domain, n, service: serviceFor(domain)?.name || null })), sessionToPersistent: r.cookies.filter((k) => k.session).length });
    } catch (e) { return fail(c, e, 'No se pudo analizar el texto'); }
  });

  app.post('/api/openbot/web/import', async (c) => {
    try {
      const b = await body(c, BIG_BODY); only(b, ['text', 'confirm']);
      if (typeof b.text !== 'string') throw new MaintenanceError('Falta el texto de las cookies', 400);
      if (b.confirm !== true) throw new MaintenanceError('Falta la confirmación', 400);
      const parsed = parseCookies(b.text);
      if (!parsed.cookies.length) throw new MaintenanceError(parsed.skipped[0] || 'No hay cookies válidas para importar', 400);
      if (jobRunning()) throw new MaintenanceError('Hay otra tarea en curso. Esperá a que termine.', 409);
      const job = startJob('Importar cookies', async () => {
        const { output, backup } = await editCookieDb('importar cookies', IMPORT_PY, { cookies: parsed.cookies });
        await sleep(15_000);
        const after = await readAccounts().catch(() => null);
        const have = new Set((after?.accounts || []).flatMap((a) => a.domains));
        const wanted = new Set(parsed.cookies.map((k) => k.domain)); let found = 0; for (const d of wanted) if (have.has(d)) found++;
        const warn = found < wanted.size ? ` Atención: ${wanted.size - found} dominio(s) no aparecen todavía; si no funcionan, restaurá el respaldo ${backup.replace('Cookies.', '')}.` : '';
        return { message: `Se importaron ${output.imported ?? parsed.cookies.length} cookies de ${wanted.size} dominio(s).${warn}` };
      });
      return c.json({ ok: true, started: true, job, skipped: parsed.skipped });
    } catch (e) { return fail(c, e, 'No se pudieron importar las cookies'); }
  });

  app.post('/api/openbot/web/remove', async (c) => {
    try {
      const b = await body(c); only(b, ['account', 'confirm']);
      if (typeof b.account !== 'string' || !/^[a-z0-9.-]{1,80}$/.test(b.account)) throw new MaintenanceError('Cuenta no válida', 400);
      if (b.confirm !== true) throw new MaintenanceError('Falta la confirmación', 400);
      const list = await readAccounts();
      const acc = list.accounts.find((a) => a.id === b.account);
      if (!acc) throw new MaintenanceError('Esa cuenta no existe', 404);
      const hosts = acc.domains.filter((d) => HOSTNAME.test(d));
      const job = startJob(`Quitar ${acc.name}`, async () => {
        const { output } = await editCookieDb('quitar cuenta', DELETE_PY, { hosts });
        return { message: `Se quitaron ${output.deleted ?? 0} cookies de ${acc.name}.` };
      });
      return c.json({ ok: true, started: true, job });
    } catch (e) { return fail(c, e, 'No se pudo quitar la cuenta'); }
  });

  app.get('/api/openbot/web/backups', async (c) => {
    const r = await sh(`ls -1t ${DIR}/state/cookie-backups 2>/dev/null | head -n 10`, 15_000);
    return c.json({ ok: true, backups: r.stdout.split('\n').map((l) => l.trim().replace(/^Cookies\./, '')).filter((s) => STAMP.test(s)) });
  });

  app.post('/api/openbot/web/restore', async (c) => {
    try {
      const b = await body(c); only(b, ['stamp', 'confirm']);
      if (typeof b.stamp !== 'string' || !STAMP.test(b.stamp)) throw new MaintenanceError('Respaldo no válido', 400);
      if (b.confirm !== true) throw new MaintenanceError('Falta la confirmación', 400);
      const home = await homeDir();
      const file = `${home}/openbot-server/state/cookie-backups/Cookies.${b.stamp}`;
      const ok = (await sh(`test -f ${q(file)}`, 10_000)).ok;
      if (!ok) throw new MaintenanceError('Ese respaldo no existe', 404);
      // Reutiliza el mismo flujo seguro: el "script" copia el respaldo sobre la base.
      const RESTORE_PY = `import json,shutil,sys\nshutil.copyfile(${JSON.stringify(file)}, sys.argv[1])\nprint(json.dumps(dict(ok=True)))\n`;
      const job = startJob('Restaurar cookies', async () => { await editCookieDb('restaurar cookies', RESTORE_PY, {}); return { message: `Cookies restauradas desde el respaldo ${b.stamp}.` }; });
      return c.json({ ok: true, started: true, job });
    } catch (e) { return fail(c, e, 'No se pudo restaurar el respaldo'); }
  });
}
