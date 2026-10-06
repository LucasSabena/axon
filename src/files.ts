import { Hono } from 'hono';
import { hostExec, hostSpawnInteractive, hostSpawn, hostToContainer, containerToHost, hostExists, HOST_USER } from './host';
import { readdir, stat, lstat, open, realpath, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import * as path from 'node:path';
import { registerFileUploadRoutes } from './file-uploads';
import { recordEvent } from './events';
import { registerSharedTrashRoutes, type FileOperations } from './file-operations';
import {FileTransfers,publicTransferPlan,legacyTransferProgress} from './file-transfers';
import {actor,body as maintenanceBody,only,protect,requestOrigin} from './storage/http';
import {MaintenanceError} from './storage/types';
import { volumeForPath } from './file-volumes';
import { hostVolumes, initHostStorage, resolveHostPath } from './host-storage';

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

// Roots a normalized path must live under. $HOME is resolved lazily.


let cachedHome: string | null = null;
let fixtureHome:string|undefined;
async function homeDir(): Promise<string> {
  if(fixtureHome)return fixtureHome;
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
  try {return {path:await resolveHostPath(input?.trim()||await homeDir(),{root:true})};}
  catch(e){return {error:e instanceof Error?e.message:'Ruta inválida'};}
}

// POSIX single-quote escaping: 'foo'bar' -> 'foo'"'"'bar'
const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

// Write a buffer to a host path. The host fs is mounted read-only at /hostfs,
// so bytes are streamed through stdin of a host-side `cat > dest` (nsenter).
// Command-line payloads hit the 128KB MAX_ARG_STRLEN limit well under
// upload sizes, so base64 argv chunks are not an option.
async function writeHostFile(hostPath:string,buf:Buffer,revision:string):Promise<{ok:boolean;error?:string;conflict?:boolean;revision?:string}> {
  try{
    const script=await readFile(new URL('./storage/edit-host.py',import.meta.url),'utf8');
    const proc=hostSpawnInteractive(`python3 -c ${shq(script)} ${shq(JSON.stringify({path:hostPath,revision,size:buf.length}))}`,{user:WRITE_USER});
    const input=proc.stdin as {write(d:Uint8Array):number|Promise<number>;flush():number|Promise<number>;end():void};
    const result=new Response(proc.stdout as ReadableStream<Uint8Array>).text(),errors=new Response(proc.stderr as ReadableStream<Uint8Array>).text();
    try{await input.write(buf);await input.flush();}finally{input.end();}
    const [output,,code]=await Promise.all([result,errors,proc.exited]);if(code!==0)throw new Error();return JSON.parse(output);
  }catch{return {ok:false,error:'La edición no se confirmó. Se conservó el original; revisá permisos y compará nuevamente.'};}
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

export function registerFilesRoutes(app: Hono, operations?: FileOperations, transfers?: FileTransfers,qaHome?:string): void {
  fixtureHome=qaHome;
  if(qaHome)initHostStorage(qaHome);
  registerFileUploadRoutes(app, resolveAllowed);
  app.get('/api/files/volumes',async c=>{
    c.header('Cache-Control','private, no-store');
    actor(c);
    return c.json(await hostVolumes.snapshot(true));
  });
  protect(app,'/api/files/volumes');
  app.post('/api/files/volumes/:id/mount',async c=>{
    if(qaHome)throw new MaintenanceError('QA: montaje del host bloqueado',403);
    actor(c);
    if(c.req.header('origin')!==requestOrigin(c))throw new MaintenanceError('Origen no permitido',403);
    only(await maintenanceBody(c),[]);
    return c.json(await hostVolumes.mount(c.req.param('id')));
  });
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
    const volume=volumeForPath((await hostVolumes.snapshot().catch(()=>({volumes:[]}))).volumes,r.path);
    return c.json({ ok: true, path: r.path, home: await homeDir(), entries,
      volume:volume?{id:volume.id,token:volume.id+':'+volume.mountId,path:volume.path,readOnly:volume.readOnly}:null });
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
      const before=await fh.stat({bigint:true});
      const parent=await stat(hostToContainer(path.dirname(r.path)),{bigint:true});
      const buf = Buffer.alloc(MAX_READ_BYTES + 1);
      const { bytesRead } = await fh.read(buf, 0, MAX_READ_BYTES + 1, 0);
      const truncated = bytesRead > MAX_READ_BYTES;
      const bytes = buf.subarray(0, Math.min(bytesRead, MAX_READ_BYTES));
      let content: string;
      let binary = bytes.some(b => b < 32 && ![9, 10, 13].includes(b));
      try {
        // Keep a UTF-8 BOM intact when editing. Invalid encodings must not be
        // silently replaced and saved over the original bytes.
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        binary = true;
        content = bytes.toString('utf-8');
      }
      const after=await fh.stat({bigint:true});if(before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs)return c.json({ok:false,error:'El archivo cambió durante la lectura; volvé a abrirlo'},409);
      const revision=truncated?null:createHash('sha256').update(JSON.stringify({dev:String(after.dev),ino:String(after.ino),size:String(after.size),mtimeNs:String(after.mtimeNs),mode:String(after.mode),parentDev:String(parent.dev),parentIno:String(parent.ino),sha:createHash('sha256').update(bytes).digest('hex')})).digest('hex');
      return c.json({ ok: true, path: r.path, content, truncated, binary,revision });
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
      ) as unknown as ReadableStream;
      return new Response(stream, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`,
          'Content-Length': String(len),
        },
      });
    }
    const stream = Readable.toWeb(createReadStream(cp)) as unknown as ReadableStream;
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
    const stream = Readable.toWeb(createReadStream(cp)) as unknown as ReadableStream;
    return new Response(stream, {
      headers: {
        'Content-Type': guessMime(name),
        'Content-Length': String(st.size),
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  // ---------- Create an empty file, without replacing existing entries ----------
  app.post('/api/files/create', async (c) => {
    const body = await c.req.json().catch(() => null);
    const name = body?.name;
    if (typeof body?.path !== 'string' || !body.path.trim()) {
      return c.json({ ok: false, error: 'Elegí una carpeta destino' }, 400);
    }
    if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' ||
        /[/\\\x00-\x1f\x7f]/.test(name) || Buffer.byteLength(name, 'utf8') > 255) {
      return c.json({ ok: false, error: 'Nombre inválido: usá un nombre sin barras, de hasta 255 bytes' }, 400);
    }
    // Resolve the parent only: following an existing leaf symlink would create
    // a different file instead of reporting the name collision.
    const parent = await resolveAllowed(body.path);
    if (!parent.path) return c.json({ ok: false, error: parent.error }, 403);
    const directory = await stat(hostToContainer(parent.path)).catch(() => null);
    if (!directory) return c.json({ ok: false, error: 'La carpeta destino no existe' }, 404);
    if (!directory.isDirectory()) return c.json({ ok: false, error: 'El destino no es una carpeta' }, 400);
    const dest = path.posix.join(parent.path, name);
    const privateFile = /^\.env(?:\.|$)/i.test(name);
    // A hard link commits the empty file atomically and exclusively. Unlike
    // cat/touch/mv it cannot overwrite a file, directory or broken symlink,
    // even when two requests race. Both names live on the same filesystem.
    const result = await hostExec(
      `cd ${shq(parent.path)} || exit 13; ` +
      `if [ -e ${shq(name)} ] || [ -L ${shq(name)} ]; then exit 17; fi; ` +
      `temp=$(mktemp -- .axon-new.XXXXXXXXXX) || exit 13; ` +
      `trap 'rm -f -- "$temp"' EXIT; ` +
      `chmod ${privateFile ? '600' : '644'} -- "$temp" || exit 13; ` +
      `if ln -T -- "$temp" ${shq(name)}; then exit 0; fi; ` +
      `if [ -e ${shq(name)} ] || [ -L ${shq(name)} ]; then exit 17; fi; exit 13`,
      { user: WRITE_USER, timeoutMs: 10_000 }
    );
    if (!result.ok) return c.json({ ok: false,
      error: result.code === 17 ? 'Ya existe un archivo o carpeta con ese nombre' : 'No se pudo crear el archivo. Revisá los permisos de la carpeta',
    }, result.code === 17 ? 409 : 403);
    recordEvent('file', `Archivo creado: ${name}`, dest,
      { section: 'files', params: { path: parent.path, item: name, edit: '1' } });
    return c.json({ ok: true, path: dest, size: 0 }, 201);
  });

  // ---------- Write file ({path, content} or {path, b64}) ----------
  app.post('/api/files/write', async (c) => {
    if(operations)transferActor(c);
    if(Number(c.req.header('content-length')||0)>2*1024*1024)return c.json({ok:false,error:'La edición supera el límite'},413);
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

    if(buf.length>MAX_READ_BYTES)return c.json({ok:false,error:'La edición supera 512 KiB'},413);
    if(typeof body.revision!=='string'||! /^(?:[a-f0-9]{64}|missing)$/.test(body.revision))return c.json({ok:false,error:'Recargá el archivo para obtener su revisión antes de guardar'},409);
    const res = await writeHostFile(r.path, buf,body.revision);
    if (!res.ok) return c.json({ ok: false, error: res.error }, res.conflict?409:500);
    const name=path.posix.basename(r.path);
    const agentDoc=['AGENTS.MD','CLAUDE.MD','GEMINI.MD','SOUL.MD','INSTRUCTIONS.MD'].includes(name.toUpperCase());
    recordEvent(agentDoc?'agent':'file', `${agentDoc?'Documento de agente editado':'Archivo editado'}: ${name}`, r.path,
      { section: 'files', params: { path: path.posix.dirname(r.path), item: path.posix.basename(r.path), edit: '1' } });
    return c.json({ ok: true, path: r.path, size: buf.length,revision:res.revision });
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

  // Transfers share the durable host worker with Library and maintenance.
  const transferActor=(c:any)=>{const by=actor(c);if(c.req.header('origin')!==requestOrigin(c))throw new MaintenanceError('Origen no permitido',403);return by;};
  const transferPaths=async(input:any)=>{
    const from=await resolveAllowed(input?.from),to=await resolveAllowed(input?.to);
    if(!from.path||!to.path)throw new MaintenanceError(from.error||to.error||'Ruta no permitida',403);
    const sourceMountId=await hostVolumes.validate(from.path,input?.fromVolume);
    const destinationMountId=await hostVolumes.validate(to.path,input?.toVolume);
    return {from:from.path,to:to.path,...(!qaHome?{sourceMountId:sourceMountId||undefined,destinationMountId:destinationMountId||undefined}:{})};
  };
  protect(app,'/api/files/transfers');
  app.post('/api/files/transfers/plans',async c=>{
    if(!transfers)throw new MaintenanceError('Motor de transferencias no disponible',503);
    const by=transferActor(c),input=await maintenanceBody(c);only(input,['mode','from','to','fromVolume','toVolume']);
    if(!['copy','move'].includes(String(input.mode)))throw new MaintenanceError('Modo inválido',400);
    const paths=await transferPaths(input);return c.json({ok:true,plan:publicTransferPlan(await transfers.plan(input.mode as 'copy'|'move',paths.from,paths.to,by,paths))},201);
  });
  app.post('/api/files/transfers/:id/execute',async c=>{
    if(!transfers)throw new MaintenanceError('Motor de transferencias no disponible',503);
    const by=transferActor(c),input=await maintenanceBody(c);only(input,['digest','reviewDigest']);
    return c.json({ok:true,operation:await transfers.execute(c.req.param('id'),String(input.digest),by,typeof input.reviewDigest==='string'?input.reviewDigest:undefined)},202);
  });
  app.post('/api/files/transfers/:id/recover',async c=>{only(await maintenanceBody(c),[]);if(!transfers)throw new MaintenanceError('Motor no disponible',503);return c.json({ok:true,operation:await transfers.recover(c.req.param('id'),actor(c))});});
  app.get('/api/files/transfers',async c=>{if(!transfers)throw new MaintenanceError('Motor no disponible',503);return c.json({ok:true,operations:await transfers.list(actor(c))});});
  app.get('/api/files/transfers/:id',async c=>{if(!transfers)throw new MaintenanceError('Motor no disponible',503);return c.json({ok:true,operation:await transfers.status(c.req.param('id'),actor(c))});});
  for(const [route,mode] of [['rename','move'],['copy','copy']] as const)app.post('/api/files/'+route,async c=>{
    if(!transfers)throw new MaintenanceError('Motor de transferencias no disponible',503);
    const by=transferActor(c),input=await maintenanceBody(c);only(input,['from','to']);const paths=await transferPaths(input);
    if(paths.from===paths.to)return c.json({ok:true,...paths});
    const operation=await transfers.quick(mode,paths.from,paths.to,by);return c.json({ok:true,...paths,operation});
  });

  // Permanent deletion always requires a frozen storage selection and a durable receipt.
  app.post('/api/files/delete',c=>c.json({ok:false,error:'El borrado permanente requiere un plan revisado. Enviá el elemento a papelera y abrí Almacenamiento → Limpieza para analizar y eliminar sólo la selección.'},409));

  // Old tabs must reload into the chunked client. Parsing the old multipart
  // request would put the entire video in memory before we can validate it.
  app.post('/api/files/upload', (c) => c.json({
    ok: false, error: 'Actualizá la página para usar la subida de archivos por partes',
  }, 409));

  const randId = () => crypto.randomUUID();
  // Archivos, Biblioteca y Almacenamiento share the same durable trash service.
  if (operations) registerSharedTrashRoutes(app, operations);

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

  // Compatibility API for the existing progress chips. No in-memory job map.
  app.post('/api/files/copyjob',async c=>{
    if(!transfers)throw new MaintenanceError('Motor no disponible',503);
    const by=transferActor(c),input=await maintenanceBody(c);only(input,['from','to','mode','fromVolume','toVolume']);const paths=await transferPaths(input);
    const mode=input.mode==='move'?'move':'copy';const plan=await transfers.plan(mode,paths.from,paths.to,by,paths);
    await transfers.execute(plan.id,plan.digest,by);return c.json({ok:true,jobId:plan.id,total:plan.logicalBytes},202);
  });
  app.get('/api/files/copyjob/:id',async c=>{
    if(!transfers)throw new MaintenanceError('Motor no disponible',503);
    return c.json(legacyTransferProgress(await transfers.status(c.req.param('id'),actor(c))));
  });
  app.delete('/api/files/copyjob/:id',async c=>{
    if(!transfers)throw new MaintenanceError('Motor no disponible',503);
    return c.json({ok:true,operation:await transfers.cancel(c.req.param('id'),transferActor(c))});
  });
}
