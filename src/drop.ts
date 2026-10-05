import type { Context, Hono } from 'hono';
import { mkdir, writeFile, unlink, stat, realpath } from 'fs/promises';
import { readFileSync } from 'fs';
import * as path from 'path';
import { hostToContainer, containerToHost, hostSpawnInteractive } from './host';

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
}

const DATA_DIR = path.dirname(process.env.CONFIG_PATH || '/app/data/config.json');
const DROPS_FILE = path.join(DATA_DIR, 'drops.json');
const DROPS_DIR = path.join(DATA_DIR, 'drops');

const MAX_DROPS = 100;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_TEXT_CHARS = 1_000_000;        // ~1 MB of text
const TTL_MS = 24 * 60 * 60 * 1000;      // 24 h
const SERVE_ROOTS = ['/home', '/tmp', '/srv', '/opt', '/mnt'];

let drops: Drop[] = [];
let writeQueue: Promise<void> = Promise.resolve();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Latest clipboard text pushed from a device — kept in memory only.
let clip = { text: '', t: 0 };

function loadSync(): void {
  try {
    const arr = JSON.parse(readFileSync(DROPS_FILE, 'utf-8'));
    if (Array.isArray(arr)) {
      drops = arr.filter((d) => d && typeof d.id === 'string' && Number.isFinite(d.expires));
    }
  } catch { /* missing/corrupt — start empty */ }
}
loadSync();

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

// Serve paths must be absolute, normalized, and under a writable-ish root.
// The lexical check alone is not enough — a symlink under an allowed root
// would otherwise serve/write outside the allowlist, so the resolved real
// path is re-checked against SERVE_ROOTS.
async function normalizeServePath(input: string): Promise<string | null> {
  if (!input || typeof input !== 'string') return null;
  const norm = path.resolve(input.trim());
  const under = (p: string) => SERVE_ROOTS.some((r) => p === r || p.startsWith(r + '/'));
  let probe = norm;
  const tail: string[] = [];
  while (true) {
    try {
      const real = await realpath(hostToContainer(probe));
      const full = tail.length ? path.join(containerToHost(real), ...tail.reverse()) : containerToHost(real);
      return under(full) ? full : null;
    } catch {
      tail.push(path.basename(probe));
      const parent = path.dirname(probe);
      if (parent === probe) return null;
      probe = parent;
    }
  }
}

// Write bytes to a host path. The host fs is mounted read-only at /hostfs, so
// bytes are streamed through stdin of a host-side `cat > dest` (nsenter).
async function writeToHost(hostPath: string, data: Uint8Array): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const proc = hostSpawnInteractive(`cat > ${shq(hostPath)}`, { user: 'user' });
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
    const [code, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    ]);
    if (code === 0) return { ok: true, path: hostPath };
    return { ok: false, error: stderr.trim().slice(0, 500) || `exit ${code}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------- Public pages (/x/drop/:id) ----------

const PAGE_CSS =
  'background:#0b0e14;color:#e6e9ef;font-family:ui-monospace,Menlo,monospace;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box';

function notFoundPage(c: Context) {
  return c.html(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="${PAGE_CSS}"><div style="text-align:center"><h2>Este drop venció o no existe</h2><p style="opacity:.6">Los links duran 24 h. Generá uno nuevo desde el dashboard.</p></div>`,
    404
  );
}

function textDropPage(c: Context, d: Drop) {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return c.html(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drop — texto</title></head>
<body style="${PAGE_CSS}"><div style="width:min(760px,100%)">
<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
<span style="font-size:13px;opacity:.7">drop · texto · ${new Date(d.t).toLocaleString('es-AR')}</span>
<button id="cp" style="background:#5e6ad2;color:#fff;border:0;border-radius:6px;padding:7px 14px;font:inherit;font-size:13px;cursor:pointer">Copiar</button>
</div>
<pre id="t" style="background:#12151d;border:1px solid #262c3a;border-radius:8px;padding:14px;margin:0;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.55;max-height:75vh;overflow:auto">${esc(d.text || '')}</pre>
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
    return new Response(f as unknown as BodyInit, {
      headers: {
        'Content-Type': f.type || 'application/octet-stream',
        'Content-Length': String(f.size),
        'Content-Disposition': contentDisposition(name),
        'Cache-Control': 'no-store',
      },
    });
  });
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
        })),
    });
  });

  app.post('/api/drop/text', async (c) => {
    await sweep();
    const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
    const text = String(body.text ?? '');
    if (!text.trim()) return fail(c, 400, 'Texto vacío');
    if (text.length > MAX_TEXT_CHARS) return fail(c, 413, 'Texto demasiado largo (máx. 1 MB)');
    const id = crypto.randomUUID();
    await addDrop({ id, t: Date.now(), kind: 'text', text, size: text.length, expires: Date.now() + TTL_MS });
    return c.json({ ok: true, id, url: dropUrl(c, id) });
  });

  app.post('/api/drop/file', async (c) => {
    await sweep();
    const body = await c.req.parseBody().catch(() => null);
    const raw = body?.file;
    const file = (Array.isArray(raw) ? raw[0] : raw) as File | undefined;
    if (!file || typeof file.arrayBuffer !== 'function') return fail(c, 400, 'Falta el archivo (campo "file")');
    if (file.size > MAX_FILE_BYTES) return fail(c, 413, 'El archivo supera el máximo de 50 MB');

    const id = crypto.randomUUID();
    const buf = new Uint8Array(await file.arrayBuffer());
    await mkdir(DROPS_DIR, { recursive: true });
    await Bun.write(dropFilePath(id), buf);
    const name = sanitizeName(file.name || 'archivo');
    await addDrop({ id, t: Date.now(), kind: 'file', name, size: buf.length, expires: Date.now() + TTL_MS });

    // Optional: also land the file at a host path (?saveTo=/home/u/dir/ or full path)
    let saved: { ok: boolean; path?: string; error?: string } | undefined;
    const saveTo = (c.req.query('saveTo') || '').trim();
    if (saveTo) {
      const dest = await normalizeServePath(saveTo.endsWith('/') ? saveTo + name : saveTo);
      saved = dest
        ? await writeToHost(dest, buf)
        : { ok: false, error: 'Ruta no permitida — solo bajo /home /tmp /srv /opt /mnt' };
    }
    return c.json({ ok: true, id, url: dropUrl(c, id), name, size: buf.length, saved });
  });

  app.delete('/api/drop/:id', async (c) => {
    const id = c.req.param('id');
    const idx = drops.findIndex((d) => d.id === id);
    if (idx < 0) return fail(c, 404, 'Drop no encontrado');
    drops.splice(idx, 1);
    await removeDropFile(id);
    saveSoon();
    return c.json({ ok: true });
  });

  // Register a drop pointing at an EXISTING host file (server → device pull).
  app.post('/api/drop/serve', async (c) => {
    await sweep();
    const body = await c.req.json<{ path?: string }>().catch(() => ({} as { path?: string }));
    const hostPath = await normalizeServePath(String(body.path || ''));
    if (!hostPath) return fail(c, 400, 'Ruta no permitida — solo bajo /home /tmp /srv /opt /mnt');
    const fsPath = hostToContainer(hostPath);
    const st = await stat(fsPath).catch(() => null);
    if (!st || !st.isFile()) return fail(c, 404, 'El archivo no existe en el servidor');

    // Dedupe: an identical live serve drop reuses its link.
    const existing = drops.find((d) => d.kind === 'serve' && d.hostPath === hostPath && d.expires > Date.now());
    if (existing) {
      return c.json({ ok: true, id: existing.id, url: dropUrl(c, existing.id), name: existing.name, size: existing.size, deduped: true });
    }

    const id = crypto.randomUUID();
    const name = path.basename(hostPath);
    await addDrop({ id, t: Date.now(), kind: 'serve', name, size: st.size, hostPath, expires: Date.now() + TTL_MS });
    return c.json({ ok: true, id, url: dropUrl(c, id), name, size: st.size });
  });

  // Server-side clipboard: "Enviar al servidor" / "Traer".
  app.post('/api/drop/clip', async (c) => {
    const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
    clip = { text: String(body.text ?? '').slice(0, MAX_TEXT_CHARS), t: Date.now() };
    return c.json({ ok: true, t: clip.t });
  });

  app.get('/api/drop/clip', (c) => c.json({ ok: true, text: clip.text, t: clip.t }));

  // ---------- Public (no cookie) ----------

  app.get('/x/drop/:id/meta', async (c) => {
    await sweep();
    const d = findDrop(c.req.param('id'));
    if (!d) return fail(c, 404, 'Drop no encontrado o vencido');
    return c.json({ ok: true, kind: d.kind, name: d.name, size: d.size, t: d.t, expires: d.expires });
  });

  app.get('/x/drop/:id', async (c) => {
    await sweep();
    const d = findDrop(c.req.param('id'));
    if (!d) return notFoundPage(c);
    if (d.kind === 'text') return textDropPage(c, d);
    if (d.kind === 'serve') {
      if (!d.hostPath) return notFoundPage(c);
      return streamFile(c, hostToContainer(d.hostPath), d.name || path.basename(d.hostPath));
    }
    return streamFile(c, dropFilePath(d.id), d.name || 'archivo');
  });
}

// Hourly janitor for expired drops — unref'd so it never holds the process.
export function startDropSweeper(): void {
  setInterval(() => {
    sweep().catch(() => {});
  }, 60 * 60 * 1000).unref();
  sweep().catch(() => {});
}

// Keeps DROPS_DIR discoverable for debugging/tests.
export function dropsDir(): string {
  return DROPS_DIR;
}

