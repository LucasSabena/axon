import { resolveHostPath, hostHome } from './host-storage';
import type { Context, Hono } from 'hono';
import { mkdir, writeFile, unlink, stat, realpath, readdir } from 'fs/promises';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import { hostToContainer, containerToHost, hostSpawnInteractive, killHostProc } from './host';
import { recordEvent } from './events';
import { notify } from './notify';

// ---------- PAIR-DROP ----------
// File + text handoff between the owner's devices and the server.
// Metadata ring buffer in data/drops.json; file bodies live in data/drops/<id>.
// Public one-token-per-file URLs are mounted OUTSIDE /api (/x/drop/:id) so no
// cookie is needed — the random UUID in the URL is the capability.

export interface Drop {
  id: string;
  t: number;                    // created, epoch ms
  kind: 'file' | 'text' | 'serve';
  name?: string;                // file name / serve basename
  size?: number;                // bytes
  text?: string;                // inline text (kind=text only)
  hostPath?: string;            // kind=serve: existing host file to stream
  expires: number;              // epoch ms
  pw?: string;                  // sha256 hex of the optional link password
  max?: number;                 // optional download cap
  dl?: number;                  // downloads served so far
}

const DATA_DIR = path.dirname(process.env.CONFIG_PATH || '/app/data/config.json');
const DROPS_FILE = path.join(DATA_DIR, 'drops.json');
const DROPS_DIR = path.join(DATA_DIR, 'drops');

const MAX_DROPS = 100;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_TEXT_CHARS = 1_000_000;        // ~1 MB of text
const MAX_JSON_BODY = 8 * 1024 * 1024;   // worst-case JSON-encoded 1M-char text
const TTL_MS = 24 * 60 * 60 * 1000;      // 24 h
const TTL_MIN = 5 * 60 * 1000;           // 5 min
const TTL_MAX = 7 * 24 * 60 * 60 * 1000; // 7 d
const MAX_DOWNLOADS = 10_000;
const CLIP_FILE = path.join(DATA_DIR, 'drop-clip.json');

let drops: Drop[] = [];
let writeQueue: Promise<void> = Promise.resolve();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Latest clipboard text pushed from a device — kept in memory only.
let clip = { text: '', t: 0 };

// Drop ids join file paths — anything outside this charset is dropped.
const ID_RE = /^[A-Za-z0-9_-]+$/;

function loadSync(): void {
  try {
    const arr = JSON.parse(readFileSync(DROPS_FILE, 'utf-8'));
    if (Array.isArray(arr)) {
      drops = arr
        .filter(
          (d) =>
            d && typeof d.id === 'string' && ID_RE.test(d.id) && Number.isFinite(d.expires) &&
            ['file', 'text', 'serve'].includes(d.kind) &&
            (d.kind !== 'serve' || (typeof d.hostPath === 'string' && d.hostPath.startsWith('/')))
        )
        .map((d) => ({
          ...d,
          pw: typeof d.pw === 'string' && /^[a-f0-9]{64}$/.test(d.pw) ? d.pw : undefined,
          max: Number.isInteger(d.max) && d.max >= 1 && d.max <= MAX_DOWNLOADS ? d.max : undefined,
          dl: Number.isInteger(d.dl) && d.dl >= 0 ? d.dl : 0,
        }));
    }
  } catch { /* missing/corrupt — start empty */ }
  try {
    const c = JSON.parse(readFileSync(CLIP_FILE, 'utf-8'));
    if (c && typeof c.text === 'string') clip = { text: c.text.slice(0, MAX_TEXT_CHARS), t: Number(c.t) || 0 };
  } catch { /* no persisted clipboard */ }
}
loadSync();
// Persisted serve entries are trusted bytes from disk: re-run the allowlist
// on each one so a hand-edited drops.json can't mint a public URL for an
// arbitrary host file. Invalid entries are dropped async after load.
void (async () => {
  const bad: Drop[] = [];
  for (const d of drops) {
    if (d.kind === 'serve' && d.hostPath && !(await normalizeServePath(d.hostPath))) bad.push(d);
  }
  if (bad.length) {
    drops = drops.filter((d) => !bad.includes(d));
    saveSoon();
  }
  void reconcileOrphans();
})();

export function dropPathReferences(){
  return drops.filter(d=>d.kind==='serve'&&d.hostPath&&d.expires>Date.now()).map(d=>({title:`Drop: ${d.name||'Archivo compartido'}`,path:d.hostPath!,detail:'Este link de Drop seguirá buscando el archivo en el origen y puede dejar de funcionar. Volvé a compartirlo desde el destino.'}));
}

function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeQueue = writeQueue.then(async () => {
      try {
        await mkdir(DATA_DIR, { recursive: true });
        await writeFile(DROPS_FILE, JSON.stringify(drops), 'utf-8');
      } catch { /* disk errors are non-fatal */ }
    });
  }, 2000);
  (saveTimer as { unref?: () => void })?.unref?.();
}

function dropFilePath(id: string): string {
  return path.join(DROPS_DIR, id);
}

async function removeDropFile(id: string): Promise<void> {
  await unlink(dropFilePath(id)).catch(() => {});
}

// Files left in data/drops/ by a crash or a hand-edited drops.json are never
// referenced again — remove them once they're old enough to not be an
// in-flight upload (uploads write the file before the metadata entry).
async function reconcileOrphans(): Promise<void> {
  try {
    const live = new Set(drops.map((d) => d.id));
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const f of await readdir(DROPS_DIR)) {
      if (!ID_RE.test(f) || live.has(f)) continue;
      const st = await stat(path.join(DROPS_DIR, f)).catch(() => null);
      if (st?.isFile() && st.mtimeMs < cutoff) await unlink(path.join(DROPS_DIR, f)).catch(() => {});
    }
  } catch { /* DROPS_DIR may not exist yet */ }
}

async function sweep(): Promise<void> {
  const now = Date.now();
  const dead = drops.filter((d) => d.expires <= now);
  if (!dead.length) return;
  drops = drops.filter((d) => d.expires > now);
  for (const d of dead) await removeDropFile(d.id);
  saveSoon();
}

async function addDrop(d: Drop): Promise<void> {
  drops.push(d);
  while (drops.length > MAX_DROPS) {
    const old = drops.shift()!;
    await removeDropFile(old.id);
  }
  saveSoon();
}

function findDrop(id: string): Drop | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
  const d = drops.find((x) => x.id === id);
  if (!d || d.expires <= Date.now()) return undefined;
  return d;
}

function fail(c: Context, status: number, error: string, extra?: Record<string, unknown>) {
  return c.json({ ok: false, error, ...extra }, status as never);
}

function dropUrl(c: Context, id: string): string {
  // The configured public origin wins — a reverse proxy can rewrite Host, and
  // the link is meant to be opened from other devices anyway.
  const conf = process.env.AXON_PUBLIC_ORIGIN;
  if (conf) {
    try { return `${new URL(conf).origin}/x/drop/${id}`; } catch { /* malformed — fall back to Host */ }
  }
  const url = new URL(c.req.url);
  const proto = (c.req.header('x-forwarded-proto') || url.protocol.replace(':', '')).split(',')[0].trim();
  return `${proto}://${c.req.header('host') || url.host}/x/drop/${id}`;
}

function sanitizeName(name: string): string {
  const clean = String(name || '').replace(/[/\\\0-\x1f<>:"|?*]/g, '_').trim().slice(0, 200);
  return clean || 'archivo';
}

// POSIX single-quote escaping: 'foo'bar' -> 'foo'"'"'bar'
const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

// Serve paths must be absolute, normalized, and under a non-system root.
// Drop-serve produces a PUBLIC URL, so its allowlist is narrower than the
// general host-path policy: user data and mounted volumes only — never
// system trees like /etc, /var, /usr, /boot, /tmp or /opt (transient secret
// staging and app configs).
const DROP_SERVE_ROOTS = ['/home', '/srv', '/mnt', '/media', '/run/media', '/data'];
const SERVE_ROOTS_MSG = 'solo bajo /home /srv /mnt /media /data';

// Even inside an allowed root, a public link must never mint credentials,
// private keys or app secrets (e.g. ~/.ssh, ~/.aws, .env live under /home).
const SERVE_DENY_DIRS = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.gcloud', '.minio', '.password-store']);
const SERVE_DENY_NAME =
  /^(\.env(\..*)?|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.my\.cnf|\.htpasswd|authorized_keys|known_hosts|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|shadow|gshadow|credentials(\..*)?|secrets?\.(json|ya?ml|env|txt)|token\.json|.*\.(pem|key|p12|pfx|jks|keystore|kdbx))$/i;
function sensitiveServePath(p: string): boolean {
  const segs = p.split('/').filter(Boolean);
  if (['root', 'etc', 'var', 'usr', 'boot', 'tmp', 'opt', 'proc', 'sys', 'dev'].includes(segs[0])) return true;
  return segs.some((s, i) => SERVE_DENY_DIRS.has(s) || (i === segs.length - 1 && SERVE_DENY_NAME.test(s)));
}

// The lexical check alone is not enough — a symlink under an allowed root
// would otherwise serve/write outside the allowlist, so the resolved real
// path is re-checked by the shared mount-aware host path policy.
async function normalizeServePath(input: string): Promise<string | null> {
  try {
    const p = await resolveHostPath(input, { roots: [await hostHome(), ...DROP_SERVE_ROOTS] });
    return sensitiveServePath(p) ? null : p;
  } catch { return null; }
}

// Write bytes to a host path. The host fs is mounted read-only at /hostfs, so
// bytes are streamed through stdin of a host-side `cat > dest` (nsenter).
async function writeToHost(hostPath: string, data: Uint8Array): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const proc = hostSpawnInteractive(`cat > ${shq(hostPath)}`, { user: 'user' });
    // Drain BOTH output streams concurrently from the start: a chatty login
    // profile can fill a pipe's buffer and deadlock the child (and us).
    const stdoutDone = new Response(proc.stdout as ReadableStream<Uint8Array>).text().catch(() => '');
    const stderrDone = new Response(proc.stderr as ReadableStream<Uint8Array>).text().catch(() => '');
    // A blocked child (dead pipe, stuck shell) must not hang the upload.
    const deadline = setTimeout(() => {
      try { killHostProc(proc); } catch { /* already gone */ }
    }, 120_000);
    try {
      const stdin = proc.stdin as {
        write(d: Uint8Array | string): number | Promise<number>;
        flush(): number | Promise<number>;
        end(): void;
      };
      try {
        for (let off = 0; off < data.length; off += 1 << 20) {
          await stdin.write(data.subarray(off, off + (1 << 20)));
        }
        await stdin.flush();
      } catch { /* shell may have failed the redirect — report below */ }
      try { stdin.end(); } catch { /* already closed */ }
      const [code, stderr] = await Promise.all([proc.exited, stderrDone]);
      if (code === 0) return { ok: true, path: hostPath };
      return { ok: false, error: stderr.trim().slice(0, 500) || `exit ${code}` };
    } finally {
      clearTimeout(deadline);
      await stdoutDone; // settle the drain (kills any unhandled rejection)
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------- Public pages (/x/drop/:id) ----------

const PAGE_CSS =
  'background:#0b0e14;color:#e6e9ef;font-family:ui-monospace,Menlo,monospace;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box';

// Token-only public routes — defense-in-depth headers cost nothing.
const PUB_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};
const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'";

function pubHeaders(c: Context, page = false): void {
  for (const [k, v] of Object.entries(PUB_HEADERS)) c.header(k, v);
  if (page) c.header('Content-Security-Policy', PAGE_CSP);
}

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtBytes = (n?: number): string =>
  n === undefined ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function notFoundPage(c: Context) {
  pubHeaders(c, true);
  return c.html(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="${PAGE_CSS}"><div style="text-align:center"><h2>Este drop venció o no existe</h2><p style="opacity:.6">Los links duran 24 h. Generá uno nuevo desde el dashboard.</p></div>`,
    404
  );
}

function exhaustedPage(c: Context) {
  pubHeaders(c, true);
  return c.html(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="${PAGE_CSS}"><div style="text-align:center"><h2>Límite de descargas alcanzado</h2><p style="opacity:.6">Este link ya no acepta más descargas. Pedí uno nuevo.</p></div>`,
    410
  );
}

function passwordPage(c: Context, d: Drop) {
  pubHeaders(c, true);
  const failed = c.req.query('pw') !== undefined;
  return c.html(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drop — contraseña</title></head>
<body style="${PAGE_CSS}"><form method="get" style="display:grid;gap:12px;justify-items:center;text-align:center">
<h2 style="margin:0">Este drop pide contraseña</h2>
${failed ? '<p style="color:#f87171;margin:0;font-size:13px">Contraseña incorrecta — probá de nuevo.</p>' : ''}
<input name="pw" type="password" placeholder="Contraseña" autocomplete="off" autofocus style="background:#12151d;border:1px solid #262c3a;border-radius:6px;color:inherit;padding:9px 14px;font:inherit;font-size:14px;width:min(300px,80vw)">
<button style="background:#5e6ad2;color:#fff;border:0;border-radius:6px;padding:9px 20px;font:inherit;font-size:14px;cursor:pointer">Abrir</button>
</form>`);
}

function pwOk(c: Context, d: Drop): boolean {
  return !d.pw || createHash('sha256').update(c.req.query('pw') || '').digest('hex') === d.pw;
}

// Landing page before the actual download: shows what the link carries
// instead of blindly streaming an unknown file onto the visitor's device.
function landingPage(c: Context, d: Drop) {
  pubHeaders(c, true);
  const pw = d.pw ? `&pw=${encodeURIComponent(c.req.query('pw') || '')}` : '';
  const left = d.max ? Math.max(0, d.max - (d.dl || 0)) : undefined;
  return c.html(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drop — ${escHtml(d.name || 'archivo')}</title></head>
<body style="${PAGE_CSS}"><div style="width:min(460px,100%);text-align:center;display:grid;gap:12px;justify-items:center">
<h2 style="margin:0;word-break:break-all">${escHtml(d.name || 'archivo')}</h2>
<p style="opacity:.6;margin:0;font-size:13px">${fmtBytes(d.size)} · vence ${new Date(d.expires).toLocaleString('es-AR')}${left !== undefined ? ` · quedan ${left} descarga${left === 1 ? '' : 's'}` : ''}</p>
<a href="/x/drop/${escHtml(d.id)}?dl=1${pw}" style="background:#5e6ad2;color:#fff;border-radius:6px;padding:10px 26px;font-size:14px;text-decoration:none">Descargar</a>
<p style="opacity:.4;margin:0;font-size:12px">drop · un link = un archivo</p>
</div>`);
}

function textDropPage(c: Context, d: Drop) {
  pubHeaders(c, true);
  return c.html(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drop — texto</title></head>
<body style="${PAGE_CSS}"><div style="width:min(760px,100%)">
<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
<span style="font-size:13px;opacity:.7">drop · texto · ${new Date(d.t).toLocaleString('es-AR')}</span>
<button id="cp" style="background:#5e6ad2;color:#fff;border:0;border-radius:6px;padding:7px 14px;font:inherit;font-size:13px;cursor:pointer">Copiar</button>
</div>
<pre id="t" style="background:#12151d;border:1px solid #262c3a;border-radius:8px;padding:14px;margin:0;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.55;max-height:75vh;overflow:auto">${escHtml(d.text || '')}</pre>
</div>
<script>document.getElementById('cp').onclick=function(){var b=this;navigator.clipboard.writeText(document.getElementById('t').innerText).then(function(){b.textContent='Copiado'},function(){b.textContent='Seleccioná y copiá'})};</script>`);
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function streamFile(c: Context, fsPath: string, name: string): Promise<Response> | Response {
  const f = Bun.file(fsPath);
  return f.exists().then((exists) => {
    if (!exists) return notFoundPage(c);
    const size = f.size;
    const headers: Record<string, string> = {
      ...PUB_HEADERS,
      'Content-Type': f.type || 'application/octet-stream',
      'Content-Disposition': contentDisposition(name),
      'Accept-Ranges': 'bytes',
    };
    const m = /^bytes=(\d*)-(\d*)$/.exec((c.req.header('range') || '').trim());
    if (m && (m[1] || m[2])) {
      const start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
      const end = Math.min(m[2] && m[1] ? parseInt(m[2], 10) : size - 1, size - 1);
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { ...PUB_HEADERS, 'Content-Range': `bytes */${size}` } });
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      headers['Content-Length'] = String(end - start + 1);
      return new Response(f.slice(start, end + 1) as unknown as BodyInit, { status: 206, headers });
    }
    headers['Content-Length'] = String(size);
    return new Response(f as unknown as BodyInit, { headers });
  });
}

// Reject oversized bodies from Content-Length BEFORE parsing — the body
// parsers below buffer the whole request in memory.
function bodyTooLarge(c: Context, limit: number): boolean {
  const len = Number(c.req.header('content-length'));
  return Number.isFinite(len) && len > limit;
}

function parseTtlMs(v: unknown): number {
  const h = Number(v);
  if (!Number.isFinite(h) || h <= 0) return TTL_MS;
  return Math.min(Math.max(h * 3_600_000, TTL_MIN), TTL_MAX);
}

function parseMaxDl(v: unknown): number | undefined {
  const n = Math.floor(Number(v));
  return Number.isInteger(n) && n >= 1 && n <= MAX_DOWNLOADS ? n : undefined;
}

function pwHashOf(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v : '';
  return s && s.length <= 128 ? createHash('sha256').update(s).digest('hex') : undefined;
}

// ---------- Routes ----------
// IMPORTANT (integrator): call registerDropRoutes(app) AFTER
// app.use('/api/*', requireAuth) so /api/drop* inherits cookie auth.
// /x/drop/* lives outside /api and is intentionally public.

export function registerDropRoutes(app: Hono): void {
  app.get('/api/drop', async (c) => {
    await sweep();
    return c.json({
      ok: true,
      drops: drops
        .slice()
        .sort((a, b) => b.t - a.t)
        .map((d) => ({
          id: d.id,
          t: d.t,
          kind: d.kind,
          name: d.name,
          size: d.size,
          hostPath: d.hostPath,
          preview: d.kind === 'text' ? (d.text || '').slice(0, 140) : undefined,
          expires: d.expires,
          protected: !!d.pw,
          max: d.max,
          dl: d.dl || 0,
        })),
    });
  });

  app.post('/api/drop/text', async (c) => {
    await sweep();
    if (bodyTooLarge(c, MAX_JSON_BODY)) return fail(c, 413, 'Texto demasiado largo (máx. 1 MB)');
    const body = (await c.req.json().catch(() => ({}))) as { text?: string; ttl?: number; pw?: string; max?: number };
    const text = String(body.text ?? '');
    if (!text.trim()) return fail(c, 400, 'Texto vacío');
    if (text.length > MAX_TEXT_CHARS) return fail(c, 413, 'Texto demasiado largo (máx. 1 MB)');
    const id = crypto.randomUUID();
    const expires = Date.now() + parseTtlMs(body.ttl);
    const pw = pwHashOf(body.pw);
    const max = parseMaxDl(body.max);
    await addDrop({ id, t: Date.now(), kind: 'text', text, size: text.length, expires, pw, max });
    recordEvent('file', 'Drop de texto creado', `${text.length} caracteres`, { section: 'drop' });
    return c.json({ ok: true, id, url: dropUrl(c, id), expires, protected: !!pw, max });
  });

  app.post('/api/drop/file', async (c) => {
    await sweep();
    if (bodyTooLarge(c, MAX_FILE_BYTES + 65_536)) return fail(c, 413, 'El archivo supera el máximo de 50 MB');
    const body = await c.req.parseBody().catch(() => null);
    const raw = body?.file;
    const file = (Array.isArray(raw) ? raw[0] : raw) as File | undefined;
    if (!file || typeof file.arrayBuffer !== 'function') return fail(c, 400, 'Falta el archivo (campo "file")');
    if (file.size > MAX_FILE_BYTES) return fail(c, 413, 'El archivo supera el máximo de 50 MB');
    const field = (k: string) => {
      const v = body?.[k];
      return Array.isArray(v) ? v[0] : v;
    };
    const expires = Date.now() + parseTtlMs(field('ttl'));
    const pw = pwHashOf(field('pw'));
    const max = parseMaxDl(field('max'));

    const id = crypto.randomUUID();
    const buf = new Uint8Array(await file.arrayBuffer());
    await mkdir(DROPS_DIR, { recursive: true });
    await Bun.write(dropFilePath(id), buf);
    const name = sanitizeName(file.name || 'archivo');
    await addDrop({ id, t: Date.now(), kind: 'file', name, size: buf.length, expires, pw, max });
    recordEvent('file', `Drop creado — ${name}`, fmtBytes(buf.length), { section: 'drop' });
    void notify(`Drop — ${name}`, `Archivo compartido por link público (${fmtBytes(buf.length)})`, 2);

    // Optional: also land the file at a host path (?saveTo=/home/u/dir/ or full path)
    let saved: { ok: boolean; path?: string; error?: string } | undefined;
    const saveTo = (c.req.query('saveTo') || '').trim();
    if (saveTo) {
      const dest = await normalizeServePath(saveTo.endsWith('/') ? saveTo + name : saveTo);
      saved = dest
        ? await writeToHost(dest, buf)
        : { ok: false, error: `Ruta no permitida — ${SERVE_ROOTS_MSG}` };
    }
    return c.json({ ok: true, id, url: dropUrl(c, id), name, size: buf.length, saved, expires, protected: !!pw, max });
  });

  app.delete('/api/drop/:id', async (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return fail(c, 400, 'ID inválido');
    const idx = drops.findIndex((d) => d.id === id);
    if (idx < 0) return fail(c, 404, 'Drop no encontrado');
    const gone = drops.splice(idx, 1)[0];
    await removeDropFile(id);
    saveSoon();
    recordEvent('file', `Drop eliminado — ${gone.name || gone.id}`, undefined, { section: 'drop' });
    return c.json({ ok: true });
  });

  // Register a drop pointing at an EXISTING host file (server → device pull).
  app.post('/api/drop/serve', async (c) => {
    await sweep();
    if (bodyTooLarge(c, 16_384)) return fail(c, 413, 'Solicitud demasiado grande');
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; ttl?: number; pw?: string; max?: number };
    const hostPath = await normalizeServePath(String(body.path || ''));
    if (!hostPath) return fail(c, 400, `Ruta no permitida — ${SERVE_ROOTS_MSG}`);
    const fsPath = hostToContainer(hostPath);
    const st = await stat(fsPath).catch(() => null);
    if (!st || !st.isFile()) return fail(c, 404, 'El archivo no existe en el servidor');

    const pw = pwHashOf(body.pw);
    const max = parseMaxDl(body.max);

    // Dedupe: an identical live serve drop reuses its link (and refreshes the
    // protection options the caller asked for).
    const existing = drops.find((d) => d.kind === 'serve' && d.hostPath === hostPath && d.expires > Date.now());
    if (existing) {
      if (pw !== undefined) { existing.pw = pw; saveSoon(); }
      if (max !== undefined) { existing.max = max; saveSoon(); }
      return c.json({ ok: true, id: existing.id, url: dropUrl(c, existing.id), name: existing.name, size: existing.size, expires: existing.expires, protected: !!existing.pw, max: existing.max, deduped: true });
    }

    const id = crypto.randomUUID();
    const name = path.basename(hostPath);
    const expires = Date.now() + parseTtlMs(body.ttl);
    await addDrop({ id, t: Date.now(), kind: 'serve', name, size: st.size, hostPath, expires, pw, max });
    recordEvent('file', `Drop creado — ${name}`, `${fmtBytes(st.size)} · desde el servidor`, { section: 'drop' });
    void notify(`Drop — ${name}`, `Archivo del servidor compartido por link público (${fmtBytes(st.size)})`, 2);
    return c.json({ ok: true, id, url: dropUrl(c, id), name, size: st.size, expires, protected: !!pw, max });
  });

  // Server-side clipboard: "Enviar al servidor" / "Traer". Global (shared by
  // the owner's devices) but persisted so a restart doesn't lose it.
  app.post('/api/drop/clip', async (c) => {
    if (bodyTooLarge(c, MAX_JSON_BODY)) return fail(c, 413, 'Texto demasiado largo (máx. 1 MB)');
    const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
    clip = { text: String(body.text ?? '').slice(0, MAX_TEXT_CHARS), t: Date.now() };
    void writeFile(CLIP_FILE, JSON.stringify(clip), 'utf-8').catch(() => {});
    return c.json({ ok: true, t: clip.t });
  });

  app.get('/api/drop/clip', (c) => c.json({ ok: true, text: clip.text, t: clip.t }));

  // ---------- Public (no cookie) ----------

  app.get('/x/drop/:id/meta', async (c) => {
    await sweep();
    pubHeaders(c);
    const d = findDrop(c.req.param('id'));
    if (!d) return fail(c, 404, 'Drop no encontrado o vencido');
    // A protected drop doesn't leak its name/size until the password checks out.
    if (d.pw && !pwOk(c, d)) return c.json({ ok: true, protected: true });
    return c.json({ ok: true, kind: d.kind, name: d.name, size: d.size, t: d.t, expires: d.expires, protected: !!d.pw, left: d.max ? Math.max(0, d.max - (d.dl || 0)) : undefined });
  });

  app.get('/x/drop/:id', async (c) => {
    await sweep();
    const d = findDrop(c.req.param('id'));
    if (!d) return notFoundPage(c);
    if (!pwOk(c, d)) return passwordPage(c, d);
    if (d.kind === 'text') return textDropPage(c, d);

    // File kinds land on a small page first — ?dl=1 performs the download.
    if (!c.req.query('dl')) return landingPage(c, d);
    if (d.max && (d.dl || 0) >= d.max) return exhaustedPage(c);

    let fsPath: string;
    let name: string;
    if (d.kind === 'serve') {
      if (!d.hostPath) return notFoundPage(c);
      // Re-resolve + re-check the allowlist at READ time: the file (or a
      // parent dir) may have been replaced by a symlink since the drop was
      // created — the token must not become an arbitrary-file read.
      const hostPath = await normalizeServePath(d.hostPath);
      if (!hostPath) return notFoundPage(c);
      fsPath = hostToContainer(hostPath);
      name = d.name || path.basename(hostPath);
    } else {
      fsPath = dropFilePath(d.id);
      name = d.name || 'archivo';
    }
    if (!(await Bun.file(fsPath).exists())) return notFoundPage(c);
    d.dl = (d.dl || 0) + 1;
    saveSoon();
    return streamFile(c, fsPath, name);
  });
}

// Hourly janitor for expired drops — unref'd so it never holds the process.
export function startDropSweeper(): void {
  setInterval(() => {
    sweep().catch(() => {});
    reconcileOrphans().catch(() => {});
  }, 60 * 60 * 1000).unref();
  sweep().catch(() => {});
  reconcileOrphans().catch(() => {});
}

// Keeps DROPS_DIR discoverable for debugging/tests.
export function dropsDir(): string {
  return DROPS_DIR;
}

