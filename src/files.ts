import { Hono } from 'hono';
import { hostExec, hostSpawnInteractive, hostSpawn, hostToContainer, containerToHost, hostExists, HOST_USER } from './host';
import { readdir, stat, lstat, open, realpath, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// File manager routes — browse / read / edit / upload / download host files.
//
// Reads go through hostToContainer() (the /hostfs read-only mount, or the fs
// directly when running on the host). Writes MUST go through hostExec because
// the mount is read-only. Mutations run as the unprivileged HOST_USER account;
// flip WRITE_USER to 'root' if the panel should be able to edit /etc & co.
// ---------------------------------------------------------------------------

const WRITE_USER: 'user' | 'root' = 'user';

const MAX_READ_BYTES = 512 * 1024; // /api/files/read truncates past this
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024; // /api/files/upload refuses bigger

// Roots a normalized path must live under. $HOME is resolved lazily.
const STATIC_ROOTS = ['/etc', '/var', '/opt', '/srv', '/tmp', '/mnt', '/media', '/home'];

let cachedHome: string | null = null;
async function homeDir(): Promise<string> {
  if (cachedHome) return cachedHome;
  try {
    const res = await hostExec('printf %s "$HOME"', { user: 'user', timeoutMs: 10_000 });
    const h = res.stdout.trim();
    if (res.ok && h.startsWith('/')) {
      cachedHome = h;
      return h;
    }
  } catch { /* fall through to guess */ }
  cachedHome = HOST_USER === 'root' ? '/root' : `/home/${HOST_USER}`;
  return cachedHome;
}

// Normalize + validate a client-supplied path. Returns the resolved absolute
// host path or a Spanish error message.
async function resolveAllowed(input: string | undefined | null): Promise<{ path?: string; error?: string }> {
  const home = await homeDir();
  let raw = (input ?? '').trim();
  if (!raw || raw === '~') raw = home;
  else if (raw.startsWith('~/')) raw = home + raw.slice(1);

  let p: string;
  try {
    p = path.posix.resolve(raw);
  } catch {
    return { error: 'Ruta inválida' };
  }
  const roots = [home, ...STATIC_ROOTS];
  const inside = (q: string) => roots.some((r) => q === r || q.startsWith(r.endsWith('/') ? r : r + '/'));
  if (!inside(p)) return { error: 'Ruta fuera de los directorios permitidos' };
  // Symlink escape guard: resolve the deepest existing ancestor and re-check
  // the allowlist on the resolved location.
  let probe = p;
  const tail: string[] = [];
  while (true) {
    try {
      const real = await realpath(hostToContainer(probe));
      const hostReal = containerToHost(real);
      const full = tail.length ? path.posix.join(hostReal, ...tail.reverse()) : hostReal;
      if (!inside(full)) return { error: 'Ruta fuera de los directorios permitidos' };
      return { path: full };
    } catch {
      tail.push(path.posix.basename(probe));
      const parent = path.posix.dirname(probe);
      if (parent === probe) return { error: 'Ruta fuera de los directorios permitidos' };
      probe = parent;
    }
  }
}

// POSIX single-quote escaping: 'foo'bar' -> 'foo'"'"'bar'
const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

// Write a buffer to a host path. The host fs is mounted read-only at /hostfs,
// so bytes are streamed through stdin of a host-side `cat > dest` (nsenter).
// Command-line payloads hit the 128KB MAX_ARG_STRLEN limit well under
// MAX_UPLOAD_BYTES, so base64 argv chunks are not an option.
async function writeHostFile(
  hostPath: string,
  buf: Buffer
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  try {
    const proc = hostSpawnInteractive(`cat > ${shq(hostPath)}`, { user: WRITE_USER });
    const stdin = proc.stdin as {
      write(d: Uint8Array | string): number | Promise<number>;
      flush(): void | Promise<void>;
      end(): void;
    };
    try {
      for (let off = 0; off < buf.length; off += 1 << 20) {
        await stdin.write(buf.subarray(off, off + (1 << 20)));
      }
      await stdin.flush();
    } catch { /* shell may have failed the redirect — report below */ }
    try { stdin.end(); } catch { /* already closed */ }
    const [code, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    ]);
    if (code === 0) return { ok: true };
    return {
      ok: false,
      error: 'No se pudo escribir el archivo',
      detail: stderr.trim().slice(0, 500) || `exit ${code}`,
    };
  } catch (err) {
    return { ok: false, error: 'No se pudo escribir el archivo', detail: String(err) };
  }
}

const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', csv: 'text/csv',
  txt: 'text/plain', md: 'text/markdown', log: 'text/plain', xml: 'application/xml',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  ts: 'text/typescript', jsx: 'text/javascript', tsx: 'text/typescript',
  json: 'application/json', map: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', avif: 'image/avif',
  bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg',
  weba: 'audio/webm', wma: 'audio/x-ms-wma', mid: 'audio/midi', midi: 'audio/midi',
  aif: 'audio/aiff', aiff: 'audio/aiff', amr: 'audio/amr',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv',
  mts: 'video/mp2t', m2ts: 'video/mp2t',
  mpg: 'video/mpeg', mpeg: 'video/mpeg', '3gp': 'video/3gpp', '3g2': 'video/3gpp2',
  flv: 'video/x-flv', vob: 'video/dvd',
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip',
  tar: 'application/x-tar', wasm: 'application/wasm', woff: 'font/woff',
  woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  eps: 'application/postscript', ps: 'application/postscript',
};

const guessMime = (name: string): string =>
  MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

interface FileEntry {
  name: string;
  type: 'dir' | 'file' | 'link';
  size: number;
  mtime: number; // ms epoch
  mode: string; // octal, e.g. "755"
}

// A promise that resolves to `fb` instead of hanging forever — dead FUSE/NFS
// mounts can block stat() in D state and take the whole listing down with it.
const withTimeout = <T, F>(p: Promise<T>, ms: number, fb: F): Promise<T | F> =>
  Promise.race([p, new Promise<F>((res) => setTimeout(() => res(fb), ms))]);

const STAT_TIMEOUT_MS = 4_000;
const LIST_TIMEOUT_MS = 10_000;

// Extensions the preview endpoint serves inline (whitelisted so text/html
// can't ever become a same-origin XSS vector).
const INLINE_EXTS = new Set(
  ('png jpg jpeg gif svg webp ico bmp avif ' +
    'mp4 m4v webm mov mkv avi wmv mts m2ts mpg mpeg 3gp 3g2 flv vob ' +
    'mp3 wav ogg oga flac m4a aac opus weba wma mid midi aif aiff amr ' +
    'pdf txt md markdown log csv tsv json xml css js mjs cjs ts jsx tsx map ' +
    'yml yaml toml ini conf cfg env sh bash zsh py rs go java c h cc cpp hpp ' +
    'rb php lua pl sql vue svelte swift kt kts properties gitignore ' +
    'editorconfig lock woff woff2 ttf otf wasm').split(' ')
);

// Extensions converted to PNG on the host via ImageMagick (heic, camera raw,
// eps/ps/ai through ghostscript, psd, tiff, xcf...). `magick -list format`
// covers all of these on this box.
const CONVERT_EXTS = new Set(
  'heic heif tiff tif eps ps ai psd xcf raw cr2 cr3 nef arw dng orf rw2 pef sr2 erf mrw kdc x3f'.split(' ')
);
const MAX_CONVERT_BYTES = 400 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 90_000;

// Converted previews are cached on disk keyed by path+size+mtime so revisiting
// a heavy heic/raw doesn't re-run magick.
const PREVIEW_CACHE_DIR = path.join(
  path.dirname(process.env.CONFIG_PATH || 'data/config.json'),
  'preview-cache'
);
const PREVIEW_CACHE_MAX = 150;
let lastCachePrune = 0;

async function prunePreviewCache(): Promise<void> {
  if (Date.now() - lastCachePrune < 10 * 60_000) return;
  lastCachePrune = Date.now();
  try {
    const names = await readdir(PREVIEW_CACHE_DIR);
    if (names.length <= PREVIEW_CACHE_MAX) return;
    const items = (
      await Promise.all(
        names.map(async (n) => {
          const p = path.join(PREVIEW_CACHE_DIR, n);
          try {
            const s = await stat(p);
            return { p, t: s.mtimeMs };
          } catch {
            return null;
          }
        })
      )
    ).filter((x): x is { p: string; t: number } => x !== null);
    items.sort((a, b) => a.t - b.t);
    for (const it of items.slice(0, items.length - PREVIEW_CACHE_MAX)) {
      await unlink(it.p).catch(() => {});
    }
  } catch { /* cache dir missing — nothing to prune */ }
}

async function convertedPreview(
  hostPath: string,
  st: { size: number; mtimeMs: number }
): Promise<{ buf?: Buffer; error?: string; detail?: string }> {
  if (st.size > MAX_CONVERT_BYTES) {
    return { error: 'Archivo demasiado grande para generar vista previa' };
  }
  const key = createHash('sha1')
    .update(`${hostPath}|${st.size}|${Math.floor(st.mtimeMs)}`)
    .digest('hex');
  const cachePath = path.join(PREVIEW_CACHE_DIR, `${key}.png`);
  try {
    const buf = await readFile(cachePath);
    if (buf.length) return { buf };
  } catch { /* miss — convert below */ }

  const tmpHost = `/tmp/axon-prev-${key}.png`;
  // [0] selects the first page/frame (eps/ps/ai/pdf-like, psd composite).
  const res = await hostExec(
    `magick ${shq(hostPath + '[0]')} -auto-orient -resize '2400x2400>' ${shq('png:' + tmpHost)}`,
    { user: WRITE_USER, timeoutMs: CONVERT_TIMEOUT_MS }
  );
  if (!res.ok) {
    return {
      error: 'No se pudo convertir el archivo para vista previa',
      detail: (res.stderr || res.stdout || `exit ${res.code}`).slice(0, 500),
    };
  }
  let buf: Buffer;
  try {
    buf = await readFile(hostToContainer(tmpHost));
  } catch (e: any) {
    return {
      error: 'No se pudo leer la vista previa generada',
      detail: String(e?.message || e),
    };
  }
  hostExec(`rm -f -- ${shq(tmpHost)}`, { user: WRITE_USER, timeoutMs: 10_000 }).catch(() => {});
  try {
    await mkdir(PREVIEW_CACHE_DIR, { recursive: true });
    await writeFile(cachePath, buf);
    prunePreviewCache().catch(() => {});
  } catch { /* cache is best-effort */ }
  return { buf };
}

// bytes=start-end | bytes=start- | bytes=-suffix → {start,end} | 'unsatisfiable'
function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'unsatisfiable';
  let start: number, end: number;
  if (m[1] === '') {
    const suffix = parseInt(m[2], 10);
    if (suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(size - 1, parseInt(m[2], 10));
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

export function registerFilesRoutes(app: Hono): void {
  // ---------- List directory ----------
  app.get('/api/files', async (c) => {
    const r = await resolveAllowed(c.req.query('path'));
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);
    const cp = hostToContainer(r.path);

    let dirents;
    try {
      // readdir on a dead mount (FUSE/NFS/smb) can block forever — give up
      // instead of leaving the UI spinning on "Cargando…".
      dirents = await withTimeout(readdir(cp, { withFileTypes: true }), LIST_TIMEOUT_MS, null);
      if (dirents === null) {
        return c.json(
          { ok: false, error: 'El directorio no responde — posible montaje colgado' },
          504
        );
      }
    } catch (e: any) {
      const code = e?.code;
      const msg =
        code === 'ENOENT' ? 'El directorio no existe' :
        code === 'ENOTDIR' ? 'No es un directorio' :
        code === 'EACCES' ? 'Sin permiso para leer el directorio' :
        'No se pudo leer el directorio';
      return c.json({ ok: false, error: msg, detail: String(e?.message || e) },
        code === 'ENOENT' ? 404 : code === 'EACCES' ? 403 : 500);
    }

    const entries: FileEntry[] = await Promise.all(
      dirents.map(async (d) => {
        const cfull = path.join(cp, d.name);
        const ent: FileEntry = { name: d.name, type: 'file', size: 0, mtime: 0, mode: '' };
        const st = await withTimeout(lstat(cfull), STAT_TIMEOUT_MS, null).catch(() => null);
        if (st) {
          ent.size = st.size;
          ent.mtime = st.mtimeMs;
          ent.mode = (st.mode & 0o7777).toString(8);
          if (st.isSymbolicLink()) {
            ent.type = 'link';
            // A symlink to a dir navigates like a dir when the target resolves.
            const t = await withTimeout(stat(cfull), STAT_TIMEOUT_MS, null).catch(() => null);
            if (t) {
              if (t.isDirectory()) ent.type = 'dir';
              ent.size = t.size;
              ent.mtime = t.mtimeMs;
            }
          } else if (st.isDirectory()) {
            ent.type = 'dir';
            ent.size = 0;
          }
        }
        return ent;
      })
    );

    entries.sort(
      (a, b) =>
        (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) ||
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true })
    );
    return c.json({ ok: true, path: r.path, home: await homeDir(), entries });
  });

  // ---------- Read text file (512KB cap) ----------
  app.get('/api/files/read', async (c) => {
    const r = await resolveAllowed(c.req.query('path'));
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);
    const cp = hostToContainer(r.path);
    try {
      const st = await stat(cp);
      if (st.isDirectory()) return c.json({ ok: false, error: 'Es un directorio' }, 400);
      // FIFOs/sockets would block fh.read() forever — only regular files.
      if (!st.isFile()) return c.json({ ok: false, error: 'No es un archivo regular' }, 400);
    } catch (e: any) {
      return c.json({ ok: false, error: 'El archivo no existe', detail: String(e?.message || e) }, 404);
    }

    let fh: Awaited<ReturnType<typeof open>> | null = null;
    try {
      fh = await open(cp, 'r');
      const buf = Buffer.alloc(MAX_READ_BYTES + 1);
      const { bytesRead } = await fh.read(buf, 0, MAX_READ_BYTES + 1, 0);
      const truncated = bytesRead > MAX_READ_BYTES;
      const content = buf.subarray(0, Math.min(bytesRead, MAX_READ_BYTES)).toString('utf-8');
      return c.json({ ok: true, path: r.path, content, truncated });
    } catch (e: any) {
      return c.json(
        { ok: false, error: 'No se pudo leer el archivo', detail: String(e?.message || e) },
        e?.code === 'EACCES' ? 403 : 500
      );
    } finally {
      try { await fh?.close(); } catch { /* ignore */ }
    }
  });

  // ---------- Preview (inline stream + Range + format conversion) ----------
  app.get('/api/files/preview', async (c) => {
    const r = await resolveAllowed(c.req.query('path'));
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);
    const cp = hostToContainer(r.path);
    let st;
    try {
      const s = await withTimeout(stat(cp), LIST_TIMEOUT_MS, null);
      if (!s) return c.json({ ok: false, error: 'El archivo no responde — posible montaje colgado' }, 504);
      if (s.isDirectory()) return c.json({ ok: false, error: 'Es un directorio' }, 400);
      if (!s.isFile()) return c.json({ ok: false, error: 'No es un archivo regular' }, 400);
      st = s;
    } catch (e: any) {
      return c.json({ ok: false, error: 'El archivo no existe', detail: String(e?.message || e) }, 404);
    }

    const name = path.posix.basename(r.path);
    const ext = (name.split('.').pop() || '').toLowerCase();

    // Formats the browser can't render → PNG via ImageMagick on the host.
    if (CONVERT_EXTS.has(ext)) {
      const conv = await convertedPreview(r.path, st);
      if (!conv.buf) return c.json({ ok: false, error: conv.error, detail: conv.detail }, 415);
      const etag = `"cv-${st.size}-${Math.floor(st.mtimeMs)}"`;
      if (c.req.header('if-none-match') === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }
      return new Response(new Uint8Array(conv.buf), {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(conv.buf.length),
          'Content-Disposition': `inline; filename="${encodeURIComponent(name)}.png"`,
          'Cache-Control': 'private, max-age=300',
          ETag: etag,
        },
      });
    }

    if (!INLINE_EXTS.has(ext)) {
      return c.json({ ok: false, error: 'Este tipo de archivo no tiene vista previa' }, 415);
    }

    const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`;
    const baseHeaders: Record<string, string> = {
      'Content-Type': guessMime(name),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Blocks <script> inside svg/xml when the URL is opened as a document
      // (new tab / iframe). Media and pdf viewers are unaffected.
      'Content-Security-Policy': "script-src 'none'",
      ETag: etag,
    };
    if (c.req.header('if-none-match') === etag && !c.req.header('range')) {
      return new Response(null, { status: 304, headers: baseHeaders });
    }

    const range = parseRange(c.req.header('range'), st.size);
    if (range === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${st.size}` },
      });
    }
    if (range) {
      const len = range.end - range.start + 1;
      const stream = Readable.toWeb(
        createReadStream(cp, { start: range.start, end: range.end })
      ) as ReadableStream;
      return new Response(stream, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`,
          'Content-Length': String(len),
        },
      });
    }
    const stream = Readable.toWeb(createReadStream(cp)) as ReadableStream;
    return new Response(stream, {
      headers: { ...baseHeaders, 'Content-Length': String(st.size) },
    });
  });

  // ---------- Download (stream + Content-Disposition) ----------
  app.get('/api/files/download', async (c) => {
    const r = await resolveAllowed(c.req.query('path'));
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);
    const cp = hostToContainer(r.path);
    let st;
    try {
      st = await stat(cp);
      if (st.isDirectory()) return c.json({ ok: false, error: 'Es un directorio' }, 400);
      if (!st.isFile()) return c.json({ ok: false, error: 'No es un archivo regular' }, 400);
    } catch (e: any) {
      return c.json({ ok: false, error: 'El archivo no existe', detail: String(e?.message || e) }, 404);
    }

    const name = path.posix.basename(r.path);
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'archivo';
    const stream = Readable.toWeb(createReadStream(cp)) as ReadableStream;
    return new Response(stream, {
      headers: {
        'Content-Type': guessMime(name),
        'Content-Length': String(st.size),
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  // ---------- Write file ({path, content} or {path, b64}) ----------
  app.post('/api/files/write', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Cuerpo JSON inválido' }, 400);
    }
    const r = await resolveAllowed(body?.path);
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);

    let buf: Buffer;
    if (typeof body?.b64 === 'string') {
      buf = Buffer.from(body.b64, 'base64');
    } else if (typeof body?.content === 'string') {
      buf = Buffer.from(body.content, 'utf-8');
    } else {
      return c.json({ ok: false, error: 'Falta el campo content o b64' }, 400);
    }

    const res = await writeHostFile(r.path, buf);
    if (!res.ok) return c.json({ ok: false, error: res.error, detail: res.detail }, 500);
    return c.json({ ok: true, path: r.path, size: buf.length });
  });

  // ---------- Mkdir ----------
  app.post('/api/files/mkdir', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Cuerpo JSON inválido' }, 400);
    }
    const r = await resolveAllowed(body?.path);
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);

    const res = await hostExec(`mkdir -p -- ${shq(r.path)}`, { user: WRITE_USER, timeoutMs: 15_000 });
    if (!res.ok) {
      return c.json(
        { ok: false, error: 'No se pudo crear la carpeta', detail: res.stderr || res.stdout || `exit ${res.code}` },
        500
      );
    }
    return c.json({ ok: true, path: r.path });
  });

  // ---------- Rename / move ----------
  app.post('/api/files/rename', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Cuerpo JSON inválido' }, 400);
    }
    const rf = await resolveAllowed(body?.from);
    if (!rf.path) return c.json({ ok: false, error: rf.error }, 403);
    const rt = await resolveAllowed(body?.to);
    if (!rt.path) return c.json({ ok: false, error: rt.error }, 403);
    if (rf.path === rt.path) return c.json({ ok: true });
    if (await hostExists(rt.path)) {
      return c.json({ ok: false, error: 'Ya existe un archivo con ese nombre' }, 409);
    }

    const res = await hostExec(`mv -- ${shq(rf.path)} ${shq(rt.path)}`, { user: WRITE_USER, timeoutMs: 30_000 });
    if (!res.ok) {
      return c.json(
        { ok: false, error: 'No se pudo renombrar', detail: res.stderr || res.stdout || `exit ${res.code}` },
        500
      );
    }
    return c.json({ ok: true, from: rf.path, to: rt.path });
  });

  // ---------- Copy (cp -a) ----------
  app.post('/api/files/copy', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Cuerpo JSON inválido' }, 400);
    }
    const rf = await resolveAllowed(body?.from);
    if (!rf.path) return c.json({ ok: false, error: rf.error }, 403);
    const rt = await resolveAllowed(body?.to);
    if (!rt.path) return c.json({ ok: false, error: rt.error }, 403);
    if (rf.path === rt.path || rt.path.startsWith(rf.path + '/')) {
      return c.json({ ok: false, error: 'No se puede copiar un elemento dentro de sí mismo' }, 400);
    }
    if (await hostExists(rt.path)) {
      return c.json({ ok: false, error: 'Ya existe un archivo con ese nombre' }, 409);
    }

    const res = await hostExec(`cp -a -- ${shq(rf.path)} ${shq(rt.path)}`, {
      user: WRITE_USER,
      timeoutMs: 300_000,
    });
    if (!res.ok) {
      return c.json(
        { ok: false, error: 'No se pudo copiar', detail: res.stderr || res.stdout || `exit ${res.code}` },
        500
      );
    }
    return c.json({ ok: true, from: rf.path, to: rt.path });
  });

  // ---------- Delete (rm -rf, guarded) ----------
  app.post('/api/files/delete', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Cuerpo JSON inválido' }, 400);
    }
    if (body?.confirm !== true) {
      return c.json({ ok: false, error: 'Se requiere confirmación (confirm: true)' }, 400);
    }
    const r = await resolveAllowed(body?.path);
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);

    const segments = r.path.split('/').filter(Boolean).length;
    if (r.path === '/' || r.path === '/home' || r.path === '/etc' || segments < 3) {
      return c.json({ ok: false, error: 'Ruta de borrado no permitida' }, 403);
    }

    const res = await hostExec(`rm -rf -- ${shq(r.path)}`, { user: WRITE_USER, timeoutMs: 120_000 });
    if (!res.ok) {
      return c.json(
        { ok: false, error: 'No se pudo eliminar', detail: res.stderr || res.stdout || `exit ${res.code}` },
        500
      );
    }
    return c.json({ ok: true, path: r.path });
  });

  // ---------- Upload (multipart; ?path= is the target dir) ----------
  app.post('/api/files/upload', async (c) => {
    const rd = await resolveAllowed(c.req.query('path'));
    if (!rd.path) return c.json({ ok: false, error: rd.error }, 403);

    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json({ ok: false, error: 'No se pudo procesar el formulario' }, 400);
    }
    const f = body['file'];
    if (!(f instanceof File)) {
      return c.json({ ok: false, error: 'Falta el archivo (campo "file")' }, 400);
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      return c.json({ ok: false, error: `El archivo supera el límite de ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` }, 413);
    }

    // An explicit `name` field overrides the multipart filename — used when the
    // client renamed a conflicting upload ("keep both").
    const reqName = typeof body['name'] === 'string' && body['name'] ? body['name'] : f.name;
    const name = path.posix.basename(reqName || 'archivo').replace(/[^\S ]/g, '');
    if (!name || name === '.' || name === '..') {
      return c.json({ ok: false, error: 'Nombre de archivo inválido' }, 400);
    }
    // Folder uploads carry the file's webkitRelativePath ("subdir/a/b.txt")
    // in a `rel` field — keep the intermediate dirs, sanitizing each segment.
    const rel = typeof body['rel'] === 'string' ? body['rel'] : '';
    const dirParts = rel
      .split('/')
      .slice(0, -1)
      .map((s) => s.replace(/[^\S ]/g, ''))
      .filter((s) => s && s !== '.' && s !== '..' && !s.includes('/') && !s.includes('\\'));
    const targetDir = path.posix.join(rd.path, ...dirParts);
    const rdDir = await resolveAllowed(targetDir);
    if (!rdDir.path) return c.json({ ok: false, error: rdDir.error }, 403);
    // The target dir may not exist yet (first file of a folder upload).
    const mk = await hostExec(`mkdir -p -- ${shq(rdDir.path)}`, { user: WRITE_USER, timeoutMs: 15_000 });
    if (!mk.ok) {
      return c.json({ ok: false, error: 'No se pudo crear la carpeta destino', detail: mk.stderr || `exit ${mk.code}` }, 500);
    }
    const rt = await resolveAllowed(path.posix.join(rdDir.path, name));
    if (!rt.path) return c.json({ ok: false, error: rt.error }, 403);

    const buf = Buffer.from(await f.arrayBuffer());
    const res = await writeHostFile(rt.path, buf);
    if (!res.ok) return c.json({ ok: false, error: res.error, detail: res.detail }, 500);
    return c.json({ ok: true, path: rt.path, size: buf.length });
  });

  // ---------- Trash ----------
  // Trash is a real directory under the host user's home — the file manager
  // browses it like any other folder. A JSON manifest maps each trashed name
  // back to its original location for restore.
  const TRASH_MANIFEST = '.manifest.json';
  const trashDir = async () => `${await homeDir()}/.local/share/axon-trash`;

  interface TrashItem {
    id: string;
    name: string;
    orig: string;
    type: string;
    ts: number;
  }

  async function readTrashManifest(dir: string): Promise<TrashItem[]> {
    const res = await hostExec(`cat ${shq(path.posix.join(dir, TRASH_MANIFEST))} 2>/dev/null || true`, {
      user: WRITE_USER,
      timeoutMs: 10_000,
    });
    try {
      const m = JSON.parse(res.stdout || '[]');
      return Array.isArray(m) ? m : [];
    } catch {
      return [];
    }
  }

  async function writeTrashManifest(dir: string, items: TrashItem[]) {
    await writeHostFile(path.posix.join(dir, TRASH_MANIFEST), Buffer.from(JSON.stringify(items)));
  }

  const randId = () => Math.random().toString(36).slice(2, 8);

  app.get('/api/files/trash/info', async (c) => {
    const dir = await trashDir();
    const items = await readTrashManifest(dir);
    return c.json({ ok: true, dir, count: items.length });
  });

  app.post('/api/files/trash', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Cuerpo JSON inválido' }, 400);
    }
    const paths: string[] = Array.isArray(body?.paths) ? body.paths : [];
    if (!paths.length || paths.length > 500) {
      return c.json({ ok: false, error: 'Lista de rutas inválida' }, 400);
    }
    const dir = await trashDir();
    const mk = await hostExec(`mkdir -p -- ${shq(dir)}`, { user: WRITE_USER, timeoutMs: 15_000 });
    if (!mk.ok) return c.json({ ok: false, error: 'No se pudo crear la papelera', detail: mk.stderr }, 500);

    const manifest = await readTrashManifest(dir);
    const done: { orig: string; trashed: string; name: string }[] = [];
    const failed: { path: string; error: string }[] = [];

    for (const input of paths) {
      const r = await resolveAllowed(input);
      if (!r.path) {
        failed.push({ path: String(input), error: r.error || 'Ruta inválida' });
        continue;
      }
      const segments = r.path.split('/').filter(Boolean).length;
      if (r.path === dir || r.path.startsWith(dir + '/') || segments < 3) {
        failed.push({ path: r.path, error: 'No se puede enviar a la papelera' });
        continue;
      }
      // Type before moving — the manifest needs it for a sane restore.
      let type = 'file';
      try {
        const st = await lstat(hostToContainer(r.path));
        type = st.isDirectory() ? 'dir' : 'file';
      } catch {
        failed.push({ path: r.path, error: 'No existe' });
        continue;
      }
      const id = `${Date.now().toString(36)}${randId()}`;
      const trashed = path.posix.join(dir, id);
      const res = await hostExec(`mv -- ${shq(r.path)} ${shq(trashed)}`, { user: WRITE_USER, timeoutMs: 120_000 });
      if (!res.ok) {
        failed.push({ path: r.path, error: res.stderr || `exit ${res.code}` });
        continue;
      }
      manifest.push({ id, name: path.posix.basename(r.path), orig: r.path, type, ts: Date.now() });
      done.push({ orig: r.path, trashed: id, name: path.posix.basename(r.path) });
    }
    if (done.length) await writeTrashManifest(dir, manifest);
    return c.json({ ok: !failed.length, items: done, failed });
  });

  app.post('/api/files/trash/restore', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Cuerpo JSON inválido' }, 400);
    }
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    if (!ids.length) return c.json({ ok: false, error: 'Sin elementos' }, 400);
    const dir = await trashDir();
    const manifest = await readTrashManifest(dir);
    const keep = new Set(manifest.map((m) => m.id));
    const restored: { from: string; to: string }[] = [];
    const failed: { id: string; error: string }[] = [];
    const remove = new Set<string>();

    for (const id of ids) {
      const entry = manifest.find((m) => m.id === id);
      if (!entry) {
        failed.push({ id, error: 'No está en la papelera' });
        continue;
      }
      const src = path.posix.join(dir, id);
      // Restore to the original path; on collision, append a marker suffix.
      let dest = entry.orig;
      const parent = path.posix.dirname(dest);
      await hostExec(`mkdir -p -- ${shq(parent)}`, { user: WRITE_USER, timeoutMs: 15_000 });
      const base = path.posix.basename(dest);
      const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
      const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
      for (let i = 0; await hostExists(dest) && i < 100; i++) {
        dest = path.posix.join(parent, `${stem} (restaurado${i ? ` ${i + 1}` : ''})${ext}`);
      }
      const res = await hostExec(`mv -- ${shq(src)} ${shq(dest)}`, { user: WRITE_USER, timeoutMs: 120_000 });
      if (!res.ok) {
        failed.push({ id, error: res.stderr || `exit ${res.code}` });
        continue;
      }
      remove.add(id);
      restored.push({ from: src, to: dest });
    }
    if (remove.size) {
      await writeTrashManifest(dir, manifest.filter((m) => !remove.has(m.id)));
    } else if (!keep.size) {
      await writeTrashManifest(dir, manifest);
    }
    return c.json({ ok: !failed.length, restored, failed });
  });

  app.post('/api/files/trash/empty', async (c) => {
    let body: any = {};
    try {
      body = await c.req.json();
    } catch { /* empty body ok if confirm comes via query */ }
    if (body?.confirm !== true) {
      return c.json({ ok: false, error: 'Se requiere confirmación (confirm: true)' }, 400);
    }
    const dir = await trashDir();
    // Only contents — never the trash dir itself. Explicit pattern avoids
    // surprises if $HOME resolution ever misbehaves.
    const res = await hostExec(
      `find ${shq(dir)} -mindepth 1 -maxdepth 1 ! -name ${shq(TRASH_MANIFEST)} -exec rm -rf -- {} + && : > ${shq(path.posix.join(dir, TRASH_MANIFEST))} || true`,
      { user: WRITE_USER, timeoutMs: 120_000 }
    );
    if (!res.ok) {
      return c.json({ ok: false, error: 'No se pudo vaciar la papelera', detail: res.stderr }, 500);
    }
    await writeTrashManifest(dir, []);
    return c.json({ ok: true });
  });

  // ---------- Detailed stat (properties dialog) ----------
  app.get('/api/files/stat', async (c) => {
    const r = await resolveAllowed(c.req.query('path'));
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);
    const res = await hostExec(
      `stat -c '%s|%Y|%X|%Z|%a|%A|%U|%G|%F|%h|%i' -- ${shq(r.path)} && readlink -- ${shq(r.path)} 2>/dev/null || true`,
      { user: WRITE_USER, timeoutMs: 15_000 }
    );
    if (!res.ok) return c.json({ ok: false, error: 'No se pudo leer', detail: res.stderr }, 500);
    const [fields, target] = res.stdout.trim().split('\n');
    const [size, mtime, atime, ctime, mode, modeStr, user, group, ftype, links, inode] = fields.split('|');
    let blocks = 0;
    const du = await hostExec(`du -sb -- ${shq(r.path)} 2>/dev/null | cut -f1`, { user: WRITE_USER, timeoutMs: 60_000 });
    if (du.ok) blocks = parseInt(du.stdout.trim(), 10) || 0;
    return c.json({
      ok: true,
      path: r.path,
      name: path.posix.basename(r.path),
      size: parseInt(size, 10) || 0,
      diskSize: blocks,
      mtime: (parseInt(mtime, 10) || 0) * 1000,
      atime: (parseInt(atime, 10) || 0) * 1000,
      ctime: (parseInt(ctime, 10) || 0) * 1000,
      mode,
      modeStr,
      user,
      group,
      ftype,
      links: parseInt(links, 10) || 0,
      inode,
      symlinkTarget: target || null,
    });
  });

  app.post('/api/files/chmod', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Cuerpo JSON inválido' }, 400);
    }
    const mode = String(body?.mode || '');
    if (!/^[0-7]{3,4}$/.test(mode)) {
      return c.json({ ok: false, error: 'Modo inválido — usá octal (ej: 755)' }, 400);
    }
    const r = await resolveAllowed(body?.path);
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);
    const res = await hostExec(`chmod ${mode} -- ${shq(r.path)}`, { user: WRITE_USER, timeoutMs: 15_000 });
    if (!res.ok) return c.json({ ok: false, error: 'No se pudo cambiar permisos', detail: res.stderr }, 500);
    return c.json({ ok: true });
  });

  // ---------- Directory size (lazy, per-row) ----------
  app.get('/api/files/dirsize', async (c) => {
    const r = await resolveAllowed(c.req.query('path'));
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);
    const res = await hostExec(`du -sb -- ${shq(r.path)} 2>/dev/null | cut -f1`, {
      user: WRITE_USER,
      timeoutMs: 60_000,
    });
    if (!res.ok) return c.json({ ok: false, error: 'No se pudo calcular', detail: res.stderr }, 500);
    return c.json({ ok: true, bytes: parseInt(res.stdout.trim(), 10) || 0 });
  });

  // ---------- Free space for the status bar ----------
  app.get('/api/files/df', async (c) => {
    const r = await resolveAllowed(c.req.query('path'));
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);
    const res = await hostExec(`df -Pk -- ${shq(r.path)} | tail -1`, { user: WRITE_USER, timeoutMs: 10_000 });
    if (!res.ok) return c.json({ ok: false, error: 'No se pudo leer df', detail: res.stderr }, 500);
    const parts = res.stdout.trim().split(/\s+/);
    return c.json({
      ok: true,
      total: (parseInt(parts[1], 10) || 0) * 1024,
      used: (parseInt(parts[2], 10) || 0) * 1024,
      avail: (parseInt(parts[3], 10) || 0) * 1024,
      mount: parts.slice(5).join(' ') || null,
    });
  });

  // ---------- Recursive search (distinct from the in-folder filter) ----------
  app.get('/api/files/search', async (c) => {
    const r = await resolveAllowed(c.req.query('path'));
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);
    const q = (c.req.query('q') || '').trim();
    if (q.length < 2 || q.length > 120) {
      return c.json({ ok: false, error: 'La búsqueda necesita al menos 2 caracteres' }, 400);
    }
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '300', 10) || 300, 10), 1000);
    // User metacharacters are escaped so the query stays literal.
    const esc = q.replace(/[\\*?\[\]]/g, (ch) => '\\' + ch);
    const res = await hostExec(
      `find ${shq(r.path)} -maxdepth 7 -iname ${shq('*' + esc + '*')} -printf '%y\\t%p\\n' 2>/dev/null | head -${limit}`,
      { user: WRITE_USER, timeoutMs: 25_000 }
    );
    if (!res.ok) return c.json({ ok: false, error: 'Búsqueda fallida', detail: res.stderr }, 500);
    const results = res.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [t, p] = line.split('\t');
        return { type: t === 'd' ? 'dir' : 'file', path: p, name: path.posix.basename(p), dir: path.posix.dirname(p) };
      });
    return c.json({ ok: true, results, truncated: results.length >= limit });
  });

  // ---------- Compress / extract ----------
  const ARCHIVE_EXT: Record<string, string> = {
    'tar.gz': 'tar.gz', tgz: 'tgz', 'tar.bz2': 'tar.bz2', tbz2: 'tbz2',
    'tar.xz': 'tar.xz', txz: 'txz', tar: 'tar', zip: 'zip',
  };
  const archiveExtOf = (name: string): string | null => {
    const n = name.toLowerCase();
    for (const e of Object.keys(ARCHIVE_EXT)) if (n.endsWith('.' + e)) return e;
    return null;
  };

  app.post('/api/files/archive', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Cuerpo JSON inválido' }, 400);
    }
    const op = body?.op;
    if (op === 'compress') {
      const rd = await resolveAllowed(body?.dir);
      if (!rd.path) return c.json({ ok: false, error: rd.error }, 403);
      const names: string[] = (Array.isArray(body?.names) ? body.names : [])
        .map((n: unknown) => String(n))
        .filter((n: string) => n && !n.includes('/') && n !== '.' && n !== '..');
      if (!names.length) return c.json({ ok: false, error: 'Sin elementos para comprimir' }, 400);
      const format = ['tar.gz', 'tar', 'zip'].includes(body?.format) ? body.format : 'tar.gz';
      let out = path.posix.basename(String(body?.out || '').trim());
      if (!out) out = `${names[0].replace(/\.[^.]*$/, '') || 'archivo'}.${format}`;
      if (!out.endsWith('.' + format)) out += '.' + format;
      const outPath = path.posix.join(rd.path, out);
      if (await hostExists(outPath)) {
        return c.json({ ok: false, error: 'Ya existe un archivo con ese nombre' }, 409);
      }
      const quoted = names.map(shq).join(' ');
      const cmd =
        format === 'zip'
          // Info-ZIP zip/unzip don't accept '--' (unlike GNU tools).
          ? `zip -rq ${shq(outPath)} -- ${quoted}`
          : `tar -c${format === 'tar.gz' ? 'z' : ''}f ${shq(outPath)} -- ${quoted}`;
      const res = await hostExec(`cd ${shq(rd.path)} && ${cmd}`, { user: WRITE_USER, timeoutMs: 300_000 });
      if (!res.ok) return c.json({ ok: false, error: 'No se pudo comprimir', detail: res.stderr }, 500);
      return c.json({ ok: true, path: outPath });
    }
    if (op === 'extract') {
      const r = await resolveAllowed(body?.path);
      if (!r.path) return c.json({ ok: false, error: r.error }, 403);
      const rd = await resolveAllowed(body?.destDir);
      if (!rd.path) return c.json({ ok: false, error: rd.error }, 403);
      const ext = archiveExtOf(r.path);
      if (!ext) return c.json({ ok: false, error: 'Formato de archivo no soportado' }, 400);
      // Always extract into a fresh folder named after the archive — never
      // sprays files into the cwd and never overwrites anything.
      const stem = path.posix.basename(r.path).slice(0, -ext.length - 1) || 'extraido';
      let outDir = path.posix.join(rd.path, stem);
      for (let i = 1; await hostExists(outDir) && i < 100; i++) {
        outDir = path.posix.join(rd.path, `${stem} (${i + 1})`);
      }
      const cmd = ext === 'zip'
        ? `mkdir -p -- ${shq(outDir)} && unzip -q -- ${shq(r.path)} -d ${shq(outDir)}`
        : `mkdir -p -- ${shq(outDir)} && tar -xf ${shq(r.path)} -C ${shq(outDir)}`;
      const res = await hostExec(cmd, { user: WRITE_USER, timeoutMs: 300_000 });
      if (!res.ok) return c.json({ ok: false, error: 'No se pudo extraer', detail: res.stderr }, 500);
      return c.json({ ok: true, dir: outDir });
    }
    return c.json({ ok: false, error: 'Operación inválida' }, 400);
  });

  // ---------- Copy with progress (rsync-style polling via du) ----------
  // Long copies get a detached cp plus a du-based percentage; the sync
  // /api/files/copy stays for instant small copies.
  interface CopyJob {
    id: string;
    src: string;
    dest: string;
    total: number;
    done: boolean;
    error: string | null;
    started: number;
    proc?: ReturnType<typeof hostSpawn>;
  }
  const copyJobs = new Map<string, CopyJob>();
  const pruneJobs = () => {
    const cut = Date.now() - 10 * 60_000;
    for (const [id, j] of copyJobs) if (j.done && j.started < cut) copyJobs.delete(id);
  };

  app.post('/api/files/copyjob', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Cuerpo JSON inválido' }, 400);
    }
    const rf = await resolveAllowed(body?.from);
    if (!rf.path) return c.json({ ok: false, error: rf.error }, 403);
    const rt = await resolveAllowed(body?.to);
    if (!rt.path) return c.json({ ok: false, error: rt.error }, 403);
    if (rf.path === rt.path || rt.path.startsWith(rf.path + '/')) {
      return c.json({ ok: false, error: 'No se puede copiar un elemento dentro de sí mismo' }, 400);
    }
    if (await hostExists(rt.path)) {
      return c.json({ ok: false, error: 'Ya existe un archivo con ese nombre' }, 409);
    }
    const du = await hostExec(`du -sb -- ${shq(rf.path)} 2>/dev/null | cut -f1`, {
      user: WRITE_USER,
      timeoutMs: 120_000,
    });
    const total = du.ok ? parseInt(du.stdout.trim(), 10) || 0 : 0;
    const proc = hostSpawn(`cp -a -- ${shq(rf.path)} ${shq(rt.path)}`, { user: WRITE_USER });
    const job: CopyJob = {
      id: `${Date.now().toString(36)}${randId()}`,
      src: rf.path,
      dest: rt.path,
      total,
      done: false,
      error: null,
      started: Date.now(),
      proc,
    };
    copyJobs.set(job.id, job);
    proc.exited.then(async (code) => {
      const errTxt = await new Response(proc.stderr).text().catch(() => '');
      job.done = true;
      if (code !== 0) job.error = errTxt.trim() || `exit ${code}`;
      pruneJobs();
    });
    return c.json({ ok: true, jobId: job.id, total });
  });

  app.get('/api/files/copyjob/:id', async (c) => {
    const job = copyJobs.get(c.req.param('id'));
    if (!job) return c.json({ ok: false, error: 'Trabajo no encontrado' }, 404);
    let copied = 0;
    const du = await hostExec(`du -sb -- ${shq(job.dest)} 2>/dev/null | cut -f1 || true`, {
      user: WRITE_USER,
      timeoutMs: 30_000,
    });
    if (du.ok) copied = parseInt(du.stdout.trim(), 10) || 0;
    const pct = job.total > 0 ? Math.min(100, Math.round((copied / job.total) * 100)) : (job.done ? 100 : 0);
    return c.json({ ok: true, pct: job.done && !job.error ? 100 : pct, copied, total: job.total, done: job.done, error: job.error });
  });

  app.delete('/api/files/copyjob/:id', async (c) => {
    const job = copyJobs.get(c.req.param('id'));
    if (!job) return c.json({ ok: false, error: 'Trabajo no encontrado' }, 404);
    try {
      job.proc?.kill('SIGKILL');
    } catch { /* already gone */ }
    job.done = true;
    job.error = 'Cancelado';
    // Partial copy is moved out of the way rather than deleted outright.
    if (await hostExists(job.dest)) {
      await hostExec(`rm -rf -- ${shq(job.dest)}`, { user: WRITE_USER, timeoutMs: 120_000 });
    }
    return c.json({ ok: true });
  });
}
