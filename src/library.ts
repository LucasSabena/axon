import type { Context, Hono, MiddlewareHandler } from 'hono';
import { readdir, stat, readFile, writeFile, mkdir, realpath, rename as fsRename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as zlib from 'node:zlib';
import * as path from 'node:path';
import { hostExec, hostSpawn, hostSpawnInteractive, hostToContainer, containerToHost, HOST_USER } from './host';

// ---------------------------------------------------------------------------
// BIBLIOTECA — media library over host folders + temporary public share links.
//
// * Index: walks the configured host roots (read via /hostfs), classifies
//   files by kind, enriches photos/videos with exiftool (date taken, size,
//   duration, codec). Persisted to data/library/index.json.
// * Heavy work (thumbnails, large previews, H.264 web versions) runs ON THE
//   HOST via nsenter as the host user and writes into ~/.cache/axon-library;
//   the container only reads those files back through /hostfs.
// * Shares: /s/<token> public pages (no cookie) with optional password,
//   expiry, download toggle, view/download counters and streaming ZIP.
// ---------------------------------------------------------------------------

type Kind = 'image' | 'raw' | 'video' | 'audio' | 'pdf' | 'vector' | 'design' | 'doc' | 'other';

interface Item {
  id: string;   // sha1(path)[0:16]
  p: string;    // host path
  n: string;    // basename
  e: string;    // lowercase ext
  k: Kind;
  s: number;    // size
  m: number;    // mtime ms
  tk: string;   // cache key (dev+ino+size+mtime) — survives rename/move
  t?: number;   // taken (exif) ms
  w?: number;
  h?: number;
  d?: number;   // duration s
  c?: string;   // video codec / compressor id
  mx?: 1;       // metadata pass done
}

interface Collection { id: string; name: string; paths: string[]; created: number }

interface Share {
  id: string;
  title: string;
  paths: string[];
  created: number;
  expires: number | null;
  allowDownload: boolean;
  pass?: string;          // Bun.password hash
  views: number;
  downloads: number;
  lastAccess?: number;
}

interface LibState {
  roots: string[];
  uploadRoot: string;
  shareBase: string;      // e.g. https://share.example.com — '' = request origin
  favorites: string[];    // paths
  collections: Collection[];
  shares: Share[];
}

const DATA_DIR = path.dirname(process.env.CONFIG_PATH || '/app/data/config.json');
const LIB_DIR = path.join(DATA_DIR, 'library');
const STATE_FILE = path.join(LIB_DIR, 'state.json');
const INDEX_FILE = path.join(LIB_DIR, 'index.json');
const SECRET = process.env.SESSION_SECRET || 'axon';

const MAX_ITEMS = 250_000;
const THUMB_SIZE = 512;
const VIEW_SIZE = 2048;
const CHUNK_MAX = 64 * 1024 * 1024;
const RESCAN_MS = 20 * 60 * 1000;
const ALLOWED_ROOT_PREFIXES = ['/home', '/mnt', '/media', '/srv', '/data', '/opt', '/tmp'];
const SKIP_DIRS = new Set(['node_modules', '__MACOSX', '$RECYCLE.BIN', 'System Volume Information', 'lost+found', 'venv', '__pycache__']);

// ---------- Kinds ----------

const KIND_BY_EXT: Record<string, Kind> = {};
const addKind = (k: Kind, exts: string) => exts.split(' ').forEach((e) => (KIND_BY_EXT[e] = k));
addKind('image', 'jpg jpeg png gif webp avif bmp ico heic heif tif tiff jxl');
addKind('raw', 'nef nrw dng cr2 cr3 crw arw srf sr2 raf orf rw2 pef srw x3f 3fr erf iiq');
addKind('video', 'mp4 m4v mov webm mkv avi wmv mpg mpeg 3gp ts mts m2ts ogv flv');
addKind('audio', 'mp3 wav flac ogg oga m4a aac opus aiff aif wma');
addKind('pdf', 'pdf');
addKind('vector', 'svg svgz eps ai');
addKind('design', 'psd psb indd idml aep prproj fig sketch xd afdesign afphoto afpub cdr blend');
addKind('doc', 'doc docx xls xlsx ppt pptx odt ods odp rtf txt md csv key pages numbers');

const KIND_FOLDER: Record<Kind, string> = {
  image: 'Imágenes', raw: 'RAW', video: 'Videos', audio: 'Audio', pdf: 'PDF',
  vector: 'Vectores', design: 'Diseño', doc: 'Documentos', other: 'Otros',
};

// Browser-native formats (served as-is); everything else image-like gets a
// converted JPEG "view" rendition.
const NATIVE_IMG = new Set('jpg jpeg png gif webp avif bmp ico svg'.split(' '));
const NEEDS_VIEW = new Set('heic heif tif tiff jxl svgz eps ai psd psb'.split(' '));
const WEB_VIDEO_EXT = new Set('mp4 m4v mov webm ogv'.split(' '));
const HEVC = new Set(['hvc1', 'hev1', 'hevc', 'dvh1', 'dvhe']);

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', heic: 'image/heic',
  heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', ogv: 'video/ogg', wmv: 'video/x-ms-wmv', mpg: 'video/mpeg', mpeg: 'video/mpeg',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/opus',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8', zip: 'application/zip',
};

const extOf = (n: string) => {
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(i + 1).toLowerCase() : '';
};
const idOf = (p: string) => createHash('sha1').update(p).digest('hex').slice(0, 16);
const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
const fmtSize = (b: number) => {
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = b, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
};
const needsWeb = (it: { k: Kind; e: string; c?: string }) =>
  it.k === 'video' && (!WEB_VIDEO_EXT.has(it.e) || (!!it.c && HEVC.has(it.c.toLowerCase())));
const viewKind = (it: { k: Kind; e: string }) => it.k === 'raw' || NEEDS_VIEW.has(it.e);

function fail(c: Context, status: number, error: string, extra?: Record<string, unknown>) {
  return c.json({ ok: false, error, ...extra }, status as never);
}

// ---------- State ----------

let home = HOST_USER === 'root' ? '/root' : `/home/${HOST_USER}`;
let cacheHost = `${home}/.cache/axon-library`;
let state: LibState = { roots: [], uploadRoot: '', shareBase: '', favorites: [], collections: [], shares: [] };
const items = new Map<string, Item>();       // id → item
const byPath = new Map<string, string>();    // path → id
let scannedAt = 0;
let scanning = false;
let metaPending = 0;
let ready: Promise<void> | null = null;

const thumbSet = new Set<string>();
const failSet = new Set<string>();
const viewSet = new Set<string>();
const webSet = new Set<string>();

let stateTimer: ReturnType<typeof setTimeout> | null = null;
let indexTimer: ReturnType<typeof setTimeout> | null = null;

function saveState(): void {
  if (stateTimer) return;
  stateTimer = setTimeout(async () => {
    stateTimer = null;
    try {
      await mkdir(LIB_DIR, { recursive: true });
      await writeFile(STATE_FILE + '.tmp', JSON.stringify(state), 'utf-8');
      await fsRename(STATE_FILE + '.tmp', STATE_FILE);
    } catch (e) { console.error('library state save', e); }
  }, 800);
}

function saveIndex(): void {
  if (indexTimer) return;
  indexTimer = setTimeout(async () => {
    indexTimer = null;
    try {
      await mkdir(LIB_DIR, { recursive: true });
      await writeFile(INDEX_FILE + '.tmp', JSON.stringify({ scannedAt, items: [...items.values()] }), 'utf-8');
      await fsRename(INDEX_FILE + '.tmp', INDEX_FILE);
    } catch (e) { console.error('library index save', e); }
  }, 5000);
}

function putItem(it: Item): void {
  items.set(it.id, it);
  byPath.set(it.p, it.id);
}

function dropItem(id: string): void {
  const it = items.get(id);
  if (!it) return;
  items.delete(id);
  if (byPath.get(it.p) === id) byPath.delete(it.p);
}

async function hostDirExists(p: string): Promise<boolean> {
  const st = await stat(hostToContainer(p)).catch(() => null);
  return !!st?.isDirectory();
}

async function init(): Promise<void> {
  try {
    const r = await hostExec('printf %s "$HOME"', { user: 'user', timeoutMs: 10_000 });
    if (r.ok && r.stdout.trim().startsWith('/')) home = r.stdout.trim();
  } catch { /* keep guess */ }
  cacheHost = `${home}/.cache/axon-library`;

  try {
    const s = JSON.parse(await readFile(STATE_FILE, 'utf-8'));
    state = { ...state, ...s };
  } catch { /* first run */ }
  if (!state.uploadRoot) state.uploadRoot = `${home}/Biblioteca`;
  if (!state.roots.length) {
    const candidates = ['Biblioteca', 'Pictures', 'Imágenes', 'Videos', 'Vídeos', 'Music', 'Música', 'Documents', 'Documentos', 'Downloads', 'Descargas', 'Desktop', 'Escritorio'];
    for (const c of candidates) {
      if (c === 'Biblioteca' || (await hostDirExists(`${home}/${c}`))) state.roots.push(`${home}/${c}`);
    }
    saveState();
  }
  await hostExec(
    `mkdir -p ${shq(state.uploadRoot)} ${shq(cacheHost + '/thumbs')} ${shq(cacheHost + '/views')} ${shq(cacheHost + '/web')}`,
    { user: 'user', timeoutMs: 15_000 }
  );

  try {
    const raw = JSON.parse(await readFile(INDEX_FILE, 'utf-8'));
    scannedAt = raw.scannedAt || 0;
    for (const it of raw.items || []) if (it && it.id && it.p) putItem(it);
  } catch { /* no index yet */ }

  const loadSet = async (dir: string, set: Set<string>, fails?: Set<string>) => {
    try {
      for (const n of await readdir(hostToContainer(`${cacheHost}/${dir}`))) {
        if (n.endsWith('.fail')) fails?.add(n.slice(0, -5));
        else if (!n.includes('.tmp') && !n.includes('.part')) set.add(n.replace(/\.mp4$/, ''));
      }
    } catch { /* empty */ }
  };
  await Promise.all([loadSet('thumbs', thumbSet, failSet), loadSet('views', viewSet), loadSet('web', webSet)]);
}

function ensureReady(): Promise<void> {
  if (!ready) ready = init().catch((e) => console.error('library init', e));
  return ready;
}

// ---------- Path guards ----------

function under(p: string, root: string): boolean {
  return p === root || p.startsWith(root.endsWith('/') ? root : root + '/');
}

// Resolve a host path (deepest existing ancestor through realpath so a
// symlink can't escape) and require it inside one of the library roots.
async function resolveInRoots(input: string): Promise<string | null> {
  if (!input || typeof input !== 'string' || input.includes('\0')) return null;
  let p = input.trim();
  if (p.startsWith('~/')) p = home + p.slice(1);
  p = path.posix.resolve(p);
  const roots = [...state.roots, state.uploadRoot];
  if (!roots.some((r) => under(p, r))) return null;
  let probe = p;
  const tail: string[] = [];
  while (true) {
    try {
      const real = containerToHost(await realpath(hostToContainer(probe)));
      const full = tail.length ? path.posix.join(real, ...tail.reverse()) : real;
      const realRoots = await Promise.all(roots.map(async (r) => {
        try { return containerToHost(await realpath(hostToContainer(r))); } catch { return r; }
      }));
      return realRoots.some((r) => under(full, r)) ? p : null;
    } catch {
      tail.push(path.posix.basename(probe));
      const parent = path.posix.dirname(probe);
      if (parent === probe) return null;
      probe = parent;
    }
  }
}

function sanitizeName(name: string): string {
  return String(name || '')
    .replace(/[/\\\0-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
}

async function existsHost(p: string): Promise<boolean> {
  return !!(await stat(hostToContainer(p)).catch(() => null));
}

async function freeName(dir: string, name: string): Promise<string> {
  const e = extOf(name);
  const base = e ? name.slice(0, -(e.length + 1)) : name;
  let cand = name;
  for (let i = 1; await existsHost(`${dir}/${cand}`); i++) cand = `${base} (${i})${e ? '.' + e : ''}`;
  return cand;
}

// ---------- Scan ----------

async function statItem(hp: string, kindOverride?: Kind): Promise<Item | null> {
  const name = path.posix.basename(hp);
  const e = extOf(name);
  const k = KIND_BY_EXT[e] || kindOverride;
  if (!k) return null;
  const st = await stat(hostToContainer(hp)).catch(() => null);
  if (!st || !st.isFile()) return null;
  const m = Math.floor(st.mtimeMs);
  const tk = createHash('sha1').update(`${st.dev}:${st.ino}:${st.size}:${m}`).digest('hex').slice(0, 20);
  return { id: idOf(hp), p: hp, n: name, e, k, s: st.size, m, tk };
}

async function scan(): Promise<void> {
  await ensureReady();
  if (scanning) return;
  scanning = true;
  const t0 = Date.now();
  try {
    const found = new Map<string, Item>();
    const roots = [...new Set([state.uploadRoot, ...state.roots])];
    for (const root of roots) {
      const anyKind = root === state.uploadRoot;
      const stack = [root.replace(/\/+$/, '')];
      while (stack.length && found.size < MAX_ITEMS) {
        const dir = stack.pop()!;
        let ents;
        try { ents = await readdir(hostToContainer(dir), { withFileTypes: true }); } catch { continue; }
        const files: string[] = [];
        for (const d of ents) {
          if (d.name.startsWith('.')) continue;
          const hp = `${dir}/${d.name}`;
          if (d.isDirectory()) {
            if (!SKIP_DIRS.has(d.name) && hp !== cacheHost) stack.push(hp);
          } else if (d.isFile() && (anyKind || KIND_BY_EXT[extOf(d.name)])) {
            if (!found.has(hp)) files.push(hp);
          }
        }
        for (let i = 0; i < files.length; i += 64) {
          const batch = await Promise.all(files.slice(i, i + 64).map((hp) => statItem(hp, anyKind ? 'other' : undefined)));
          for (const it of batch) {
            if (!it) continue;
            const prevId = byPath.get(it.p);
            const prev = prevId ? items.get(prevId) : undefined;
            if (prev && prev.s === it.s && prev.m === it.m) {
              found.set(it.p, { ...prev, tk: it.tk, k: it.k });
            } else found.set(it.p, it);
          }
        }
      }
    }
    items.clear();
    byPath.clear();
    for (const it of found.values()) putItem(it);
    scannedAt = Date.now();
    saveIndex();
    console.log(`[library] scan: ${items.size} items in ${Date.now() - t0} ms`);
  } finally {
    scanning = false;
  }
  runMetaPass().then(warmThumbs).catch((e) => console.error('library meta', e));
}

// ---------- Metadata (exiftool on the host) ----------

function parseExifDate(s: unknown, offset: unknown, utc: boolean): number | undefined {
  const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(String(s || ''));
  if (!m || m[1] === '0000') return undefined;
  const off = utc ? 'Z' : typeof offset === 'string' && /^[+-]\d\d:\d\d$/.test(offset) ? offset : '-03:00';
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`);
  return Number.isFinite(t) && t > 315532800000 ? t : undefined;
}

async function exifBatch(batch: Item[]): Promise<void> {
  const proc = hostSpawnInteractive(
    'nice -n 10 exiftool -j -n -fast -q -q -charset filename=utf8 -DateTimeOriginal -CreateDate -OffsetTimeOriginal ' +
      '-ImageWidth -ImageHeight -Duration -CompressorID -VideoCodec -Orientation -@ -',
    { user: 'user' }
  );
  const stdin = proc.stdin as { write(d: string): unknown; flush(): unknown; end(): void };
  try {
    stdin.write(batch.map((b) => b.p).filter((p) => !p.includes('\n')).join('\n') + '\n');
    await stdin.flush();
  } catch { /* reported via empty output */ }
  try { stdin.end(); } catch { /* closed */ }
  const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, 120_000);
  const out = await new Response(proc.stdout as ReadableStream).text();
  await proc.exited;
  clearTimeout(timer);
  let rows: Record<string, unknown>[] = [];
  try { rows = JSON.parse(out || '[]'); } catch { /* keep empty */ }
  const meta = new Map(rows.map((r) => [String(r.SourceFile), r]));
  for (const it of batch) {
    const cur = items.get(it.id);
    if (!cur) continue;
    cur.mx = 1;
    const r = meta.get(it.p);
    if (!r) continue;
    const isVid = cur.k === 'video' || cur.k === 'audio';
    const t = parseExifDate(r.DateTimeOriginal, r.OffsetTimeOriginal, false) ?? parseExifDate(r.CreateDate, r.OffsetTimeOriginal, isVid);
    if (t) cur.t = t;
    let w = Number(r.ImageWidth) || 0, h = Number(r.ImageHeight) || 0;
    if ([5, 6, 7, 8].includes(Number(r.Orientation))) [w, h] = [h, w];
    if (w > 0 && h > 0) { cur.w = w; cur.h = h; }
    const d = Number(r.Duration);
    if (Number.isFinite(d) && d > 0) cur.d = Math.round(d * 10) / 10;
    const codec = String(r.CompressorID || r.VideoCodec || '').trim();
    if (codec && cur.k === 'video') cur.c = codec.slice(0, 12);
  }
}

async function runMetaPass(): Promise<void> {
  const todo = [...items.values()].filter((it) => !it.mx && ['image', 'raw', 'video', 'audio'].includes(it.k));
  metaPending = todo.length;
  for (let i = 0; i < todo.length; i += 250) {
    await exifBatch(todo.slice(i, i + 250)).catch(() => {});
    metaPending = Math.max(0, todo.length - i - 250);
    saveIndex();
  }
  // Non-media kinds never get exif — mark them so they don't re-queue.
  for (const it of items.values()) if (!it.mx && !['image', 'raw', 'video', 'audio'].includes(it.k)) it.mx = 1;
  metaPending = 0;
  saveIndex();
}

// ---------- Host job queue (thumbs / views / transcodes) ----------

interface QTask { key: string; run: () => Promise<boolean>; waiters: ((ok: boolean) => void)[] }
const hiQ: QTask[] = [];
const loQ: QTask[] = [];
const inflight = new Map<string, QTask>();
let active = 0;
const MAX_ACTIVE = 4;

function pump(): void {
  while (active < MAX_ACTIVE && (hiQ.length || (loQ.length && active < MAX_ACTIVE - 1))) {
    const t = (hiQ.shift() || loQ.shift())!;
    active++;
    t.run()
      .catch(() => false)
      .then((ok) => {
        active--;
        inflight.delete(t.key);
        t.waiters.forEach((w) => w(ok));
        pump();
      });
  }
}

function enqueue(key: string, run: () => Promise<boolean>, hi: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const ex = inflight.get(key);
    if (ex) {
      ex.waiters.push(resolve);
      if (hi) {
        const i = loQ.indexOf(ex);
        if (i >= 0) { loQ.splice(i, 1); hiQ.push(ex); pump(); }
      }
      return;
    }
    const t: QTask = { key, run, waiters: [resolve] };
    inflight.set(key, t);
    (hi ? hiQ : loQ).push(t);
    pump();
  });
}

// Shell that renders `$S` into a JPEG at `$O` with max side `$Z`. Every tool
// writes to a temp name; the caller mv's it into place atomically.
function renderScript(it: { k: Kind; e: string; d?: number }): string | null {
  const MAGICK = `magick "$S[0]" -auto-orient -thumbnail "\${Z}x\${Z}>" -strip -background '#10151c' -alpha remove -alpha off -quality 82 "jpg:$O"`;
  const MAGICK_JPEG = `magick -define jpeg:size=$((Z*2))x$((Z*2)) "$S[0]" -auto-orient -thumbnail "\${Z}x\${Z}>" -strip -quality 82 "jpg:$O"`;
  const FF = (ss: string) =>
    `ffmpeg -nostdin -v error -y ${ss} -i "$S" -frames:v 1 -vf "scale='min($Z,iw)':'min($Z,ih)':force_original_aspect_ratio=decrease" -q:v 3 -f image2 -c:v mjpeg "$O"`;
  const PDF = `pdftoppm -f 1 -l 1 -singlefile -scale-to $Z -jpeg -jpegopt quality=82 "$S" "$O.pdf" && mv -f "$O.pdf.jpg" "$O"`;
  const { k, e } = it;
  if (k === 'image') {
    if (e === 'heic' || e === 'heif' || e === 'avif') return `${FF('')} || ${MAGICK}`;
    if (e === 'jpg' || e === 'jpeg') return `${MAGICK_JPEG} || ${FF('')}`;
    return `${MAGICK} || ${FF('')}`;
  }
  if (k === 'raw') {
    return `T="$O.raw"; exiftool -b -JpgFromRaw "$S" > "$T" 2>/dev/null; [ -s "$T" ] || exiftool -b -PreviewImage "$S" > "$T" 2>/dev/null; ` +
      `if [ -s "$T" ]; then magick "$T" -auto-orient -thumbnail "\${Z}x\${Z}>" -strip -quality 82 "jpg:$O"; else ${MAGICK}; fi; rc=$?; rm -f "$T"; exit $rc`;
  }
  if (k === 'video') {
    const at = it.d && it.d < 2 ? 0 : 1;
    return `${FF(`-ss ${at}`)} && [ -s "$O" ] || ${FF('')}`;
  }
  if (k === 'audio') return FF('-an');
  if (k === 'pdf') return `${PDF} || ${MAGICK}`;
  if (k === 'vector') {
    if (e === 'svg') return null;
    if (e === 'ai') return `${PDF} || ${MAGICK}`;
    return MAGICK;
  }
  if (k === 'design' && (e === 'psd' || e === 'psb')) return MAGICK;
  return null;
}

async function renderTo(it: Item, dir: 'thumbs' | 'views', size: number): Promise<boolean> {
  const script = renderScript(it);
  if (!script) return false;
  const out = `${cacheHost}/${dir}/${it.tk}`;
  const tmp = `${out}.tmp${randomBytes(3).toString('hex')}`;
  const cmd = `S=${shq(it.p)}; O=${shq(tmp)}; Z=${size}; ( ${script} ) >/dev/null 2>&1 && [ -s "$O" ] && mv -f "$O" ${shq(out)}; rc=$?; rm -f "$O" "$O".*; exit $rc`;
  const res = await hostExec(`nice -n 8 bash -c ${shq(cmd)}`, { user: 'user', timeoutMs: 120_000 });
  return res.ok;
}

function thumbState(it: Item): number {
  if (it.k === 'vector' && it.e === 'svg') return 2;   // use the original
  if (thumbSet.has(it.tk)) return 1;
  if (failSet.has(it.tk) || !renderScript(it)) return -1;
  return 0;
}

function ensureThumb(it: Item, hi: boolean): Promise<boolean> {
  if (thumbSet.has(it.tk)) return Promise.resolve(true);
  if (failSet.has(it.tk) || !renderScript(it)) return Promise.resolve(false);
  return enqueue(`t:${it.tk}`, async () => {
    const ok = await renderTo(it, 'thumbs', THUMB_SIZE);
    if (ok) thumbSet.add(it.tk);
    else {
      failSet.add(it.tk);
      hostExec(`touch ${shq(`${cacheHost}/thumbs/${it.tk}.fail`)}`, { user: 'user', timeoutMs: 5000 }).catch(() => {});
    }
    return ok;
  }, hi);
}

function ensureView(it: Item): Promise<boolean> {
  if (viewSet.has(it.tk)) return Promise.resolve(true);
  return enqueue(`v:${it.tk}`, async () => {
    const ok = await renderTo(it, 'views', VIEW_SIZE);
    if (ok) viewSet.add(it.tk);
    return ok;
  }, true);
}

let warming = false;
async function warmThumbs(): Promise<void> {
  if (warming) return;
  warming = true;
  try {
    const todo = [...items.values()]
      .filter((it) => thumbState(it) === 0)
      .sort((a, b) => (b.t || b.m) - (a.t || a.m));
    for (const it of todo) ensureThumb(it, false);
  } finally {
    warming = false;
  }
}

// ---------- Web (H.264) versions for HEVC / non-web containers ----------

interface Transcode { state: 'queued' | 'running' | 'done' | 'error'; pct: number; error?: string }
const transcodes = new Map<string, Transcode>();
let tcChain: Promise<void> = Promise.resolve();

function ensureWeb(it: Item): Transcode {
  if (webSet.has(it.tk)) return { state: 'done', pct: 100 };
  const cur = transcodes.get(it.tk);
  if (cur && cur.state !== 'error') return cur;
  const tc: Transcode = { state: 'queued', pct: 0 };
  transcodes.set(it.tk, tc);
  tcChain = tcChain.then(() => runTranscode(it, tc)).catch(() => {});
  return tc;
}

async function runTranscode(it: Item, tc: Transcode): Promise<void> {
  tc.state = 'running';
  const out = `${cacheHost}/web/${it.tk}.mp4`;
  const part = `${cacheHost}/web/${it.tk}.part.mp4`;
  const vf = "scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))',format=yuv420p";
  const cmd =
    `nice -n 10 ffmpeg -nostdin -v error -y -i ${shq(it.p)} -map 0:v:0 -map 0:a:0? -c:v libx264 -preset veryfast -crf 23 ` +
    `-profile:v high -vf "${vf}" -c:a aac -b:a 160k -ac 2 -movflags +faststart -threads 8 -progress pipe:1 -nostats ${shq(part)} ` +
    `&& mv -f ${shq(part)} ${shq(out)}`;
  const proc = hostSpawn(cmd, { user: 'user' });
  const dur = it.d || 0;
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && dur) tc.pct = Math.min(99, Math.round((Number(m[1]) / 1e6 / dur) * 100));
      }
    }
  } catch { /* stream closed */ }
  const code = await proc.exited;
  if (code === 0) {
    webSet.add(it.tk);
    tc.state = 'done';
    tc.pct = 100;
  } else {
    tc.state = 'error';
    tc.error = (await new Response(proc.stderr as ReadableStream).text()).trim().slice(-400) || `exit ${code}`;
    hostExec(`rm -f ${shq(part)}`, { user: 'user', timeoutMs: 5000 }).catch(() => {});
  }
}

// ---------- Streaming helpers ----------

function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'bad' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number, end: number;
  if (!m[1]) {
    const suf = parseInt(m[2], 10);
    if (!suf) return 'bad';
    start = Math.max(0, size - suf);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'bad';
  return { start, end };
}

function disposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'archivo';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function sendFile(
  c: Context,
  hostPath: string,
  opts: { name: string; download?: boolean; mime?: string; cache?: string }
): Promise<Response> {
  const cp = hostToContainer(hostPath);
  const st = await stat(cp).catch(() => null);
  if (!st || !st.isFile()) return c.text('No encontrado', 404);
  const e = extOf(opts.name);
  const headers: Record<string, string> = {
    'Content-Type': opts.mime || MIME[e] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': disposition(opts.download ? 'attachment' : 'inline', opts.name),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "script-src 'none'; sandbox",
    'Cache-Control': opts.cache || 'private, max-age=3600',
    ETag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`,
  };
  if (!opts.download && c.req.header('if-none-match') === headers.ETag && !c.req.header('range')) {
    return new Response(null, { status: 304, headers });
  }
  const range = parseRange(c.req.header('range'), st.size);
  if (range === 'bad') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${st.size}` } });
  if (range) {
    const body = Readable.toWeb(createReadStream(cp, { start: range.start, end: range.end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`, 'Content-Length': String(range.end - range.start + 1) },
    });
  }
  const body = Readable.toWeb(createReadStream(cp)) as ReadableStream;
  return new Response(body, { headers: { ...headers, 'Content-Length': String(st.size) } });
}

async function sendCached(c: Context, hostPath: string, cache = 'private, max-age=31536000, immutable'): Promise<Response> {
  const f = Bun.file(hostToContainer(hostPath));
  if (!(await f.exists())) return c.text('No encontrado', 404);
  return new Response(f as unknown as BodyInit, {
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(f.size), 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' },
  });
}

// ---------- Streaming ZIP (store, zip64-aware) ----------

interface ZipEntry { name: string; cpath: string; size: number; mtime: number }

function dosTime(ms: number): { time: number; date: number } {
  const d = new Date(ms);
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const U32 = 0xffffffff;

function zipPlan(entries: ZipEntry[]) {
  const enc = new TextEncoder();
  let off = 0;
  const plan = entries.map((e) => {
    const nameB = enc.encode(e.name);
    const z64 = e.size >= U32;
    const localLen = 30 + nameB.length + (z64 ? 20 : 0);
    const ddLen = z64 ? 24 : 16;
    const p = { ...e, nameB, z64, offset: off, localLen, ddLen };
    off += localLen + e.size + ddLen;
    return p;
  });
  const cdStart = off;
  let cdLen = 0;
  for (const p of plan) {
    const needOff = p.offset >= U32;
    const extra = (p.z64 ? 16 : 0) + (needOff ? 8 : 0);
    cdLen += 46 + p.nameB.length + (extra ? 4 + extra : 0);
  }
  const zip64End = cdStart + cdLen >= U32 || plan.length >= 0xffff || plan.some((p) => p.z64 || p.offset >= U32);
  const total = cdStart + cdLen + (zip64End ? 56 + 20 : 0) + 22;
  return { plan, cdStart, cdLen, zip64End, total };
}

function zipStream(entries: ZipEntry[]): { stream: ReadableStream<Uint8Array>; length: number } {
  const { plan, cdStart, cdLen, zip64End, total } = zipPlan(entries);
  const crcs: number[] = [];
  async function* gen(): AsyncGenerator<Uint8Array> {
    for (const p of plan) {
      const { time, date } = dosTime(p.mtime);
      const h = Buffer.alloc(p.localLen);
      h.writeUInt32LE(0x04034b50, 0);
      h.writeUInt16LE(p.z64 ? 45 : 20, 4);
      h.writeUInt16LE(0x0808, 6);            // data descriptor + UTF-8 names
      h.writeUInt16LE(0, 8);                 // store
      h.writeUInt16LE(time, 10);
      h.writeUInt16LE(date, 12);
      h.writeUInt32LE(0, 14);
      h.writeUInt32LE(p.z64 ? U32 : 0, 18);
      h.writeUInt32LE(p.z64 ? U32 : 0, 22);
      h.writeUInt16LE(p.nameB.length, 26);
      h.writeUInt16LE(p.z64 ? 20 : 0, 28);
      Buffer.from(p.nameB).copy(h, 30);
      if (p.z64) {
        const x = 30 + p.nameB.length;
        h.writeUInt16LE(0x0001, x);
        h.writeUInt16LE(16, x + 2);
        h.writeBigUInt64LE(0n, x + 4);
        h.writeBigUInt64LE(0n, x + 12);
      }
      yield h;
      let crc = 0;
      let sent = 0;
      if (p.size > 0) {
        try {
          for await (const chunk of createReadStream(p.cpath, { start: 0, end: p.size - 1, highWaterMark: 1 << 20 })) {
            const b = chunk as Buffer;
            crc = zlib.crc32(b, crc);
            sent += b.length;
            yield b;
          }
        } catch { /* file vanished mid-stream — pad below */ }
      }
      // Keep the precomputed Content-Length honest if the file shrank.
      while (sent < p.size) {
        const pad = Buffer.alloc(Math.min(1 << 20, p.size - sent));
        crc = zlib.crc32(pad, crc);
        sent += pad.length;
        yield pad;
      }
      crcs.push(crc >>> 0);
      const dd = Buffer.alloc(p.ddLen);
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(crc >>> 0, 4);
      if (p.z64) {
        dd.writeBigUInt64LE(BigInt(p.size), 8);
        dd.writeBigUInt64LE(BigInt(p.size), 16);
      } else {
        dd.writeUInt32LE(p.size, 8);
        dd.writeUInt32LE(p.size, 12);
      }
      yield dd;
    }
    // Central directory
    const parts: Buffer[] = [];
    plan.forEach((p, i) => {
      const { time, date } = dosTime(p.mtime);
      const needOff = p.offset >= U32;
      const extraLen = (p.z64 ? 16 : 0) + (needOff ? 8 : 0);
      const b = Buffer.alloc(46 + p.nameB.length + (extraLen ? 4 + extraLen : 0));
      b.writeUInt32LE(0x02014b50, 0);
      b.writeUInt16LE(0x031e, 4);
      b.writeUInt16LE(p.z64 || needOff ? 45 : 20, 6);
      b.writeUInt16LE(0x0808, 8);
      b.writeUInt16LE(0, 10);
      b.writeUInt16LE(time, 12);
      b.writeUInt16LE(date, 14);
      b.writeUInt32LE(crcs[i], 16);
      b.writeUInt32LE(p.z64 ? U32 : p.size, 20);
      b.writeUInt32LE(p.z64 ? U32 : p.size, 24);
      b.writeUInt16LE(p.nameB.length, 28);
      b.writeUInt16LE(extraLen ? 4 + extraLen : 0, 30);
      b.writeUInt16LE(0, 32);
      b.writeUInt16LE(0, 34);
      b.writeUInt16LE(0, 36);
      b.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      b.writeUInt32LE(needOff ? U32 : p.offset, 42);
      Buffer.from(p.nameB).copy(b, 46);
      if (extraLen) {
        let x = 46 + p.nameB.length;
        b.writeUInt16LE(0x0001, x);
        b.writeUInt16LE(extraLen, x + 2);
        x += 4;
        if (p.z64) {
          b.writeBigUInt64LE(BigInt(p.size), x);
          b.writeBigUInt64LE(BigInt(p.size), x + 8);
          x += 16;
        }
        if (needOff) b.writeBigUInt64LE(BigInt(p.offset), x);
      }
      parts.push(b);
    });
    yield Buffer.concat(parts);
    const n = plan.length;
    if (zip64End) {
      const z = Buffer.alloc(56 + 20);
      z.writeUInt32LE(0x06064b50, 0);
      z.writeBigUInt64LE(44n, 4);
      z.writeUInt16LE(45, 12);
      z.writeUInt16LE(45, 14);
      z.writeUInt32LE(0, 16);
      z.writeUInt32LE(0, 20);
      z.writeBigUInt64LE(BigInt(n), 24);
      z.writeBigUInt64LE(BigInt(n), 32);
      z.writeBigUInt64LE(BigInt(cdLen), 40);
      z.writeBigUInt64LE(BigInt(cdStart), 48);
      z.writeUInt32LE(0x07064b50, 56);
      z.writeUInt32LE(0, 60);
      z.writeBigUInt64LE(BigInt(cdStart + cdLen), 64);
      z.writeUInt32LE(1, 72);
      yield z;
    }
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0);
    e.writeUInt16LE(zip64End ? 0xffff : n, 8);
    e.writeUInt16LE(zip64End ? 0xffff : n, 10);
    e.writeUInt32LE(zip64End ? U32 : cdLen, 12);
    e.writeUInt32LE(zip64End ? U32 : cdStart, 16);
    yield e;
  }
  const it = gen();
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const { done, value } = await it.next();
      if (done) ctrl.close();
      else ctrl.enqueue(value);
    },
    async cancel() { await it.return?.(undefined); },
  });
  return { stream, length: total };
}

async function zipResponse(paths: string[], filename: string): Promise<Response> {
  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  for (const p of paths) {
    const cp = hostToContainer(p);
    const st = await stat(cp).catch(() => null);
    if (!st?.isFile()) continue;
    let name = path.posix.basename(p);
    const e = extOf(name);
    const base = e ? name.slice(0, -(e.length + 1)) : name;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})${e ? '.' + e : ''}`;
    used.add(name.toLowerCase());
    entries.push({ name, cpath: cp, size: st.size, mtime: st.mtimeMs });
  }
  const { stream, length } = zipStream(entries);
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(length),
      'Content-Disposition': disposition('attachment', filename),
      'Cache-Control': 'no-store',
    },
  });
}

// ---------- Shares ----------

function shareAlive(s: Share): boolean {
  return s.expires === null || s.expires > Date.now();
}

function shareBase(c: Context): string {
  if (state.shareBase) return state.shareBase.replace(/\/+$/, '');
  const url = new URL(c.req.url);
  const proto = (c.req.header('x-forwarded-proto') || url.protocol.replace(':', '')).split(',')[0].trim();
  return `${proto}://${c.req.header('host') || url.host}`;
}

const shareUrl = (c: Context, s: Share) => `${shareBase(c)}/s/${s.id}`;

function unlockToken(s: Share): string {
  return createHmac('sha256', SECRET).update(`${s.id}:${s.pass || ''}`).digest('base64url').slice(0, 32);
}

function isUnlocked(c: Context, s: Share): boolean {
  if (!s.pass) return true;
  const m = (c.req.header('cookie') || '').match(new RegExp(`(?:^|;\\s*)axs_${s.id}=([^;]+)`));
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(unlockToken(s));
  return a.length === b.length && timingSafeEqual(a, b);
}

interface ShareFile { i: number; p: string; n: string; e: string; k: Kind; s: number; it?: Item }

async function shareFiles(s: Share): Promise<ShareFile[]> {
  const out: ShareFile[] = [];
  for (let i = 0; i < s.paths.length; i++) {
    const p = s.paths[i];
    const id = byPath.get(p);
    let it = id ? items.get(id) : undefined;
    if (!it) it = (await statItem(p, 'other')) || undefined;
    if (!it) continue;
    out.push({ i, p, n: it.n, e: it.e, k: it.k, s: it.s, it });
  }
  return out;
}

function shareSummary(c: Context, s: Share) {
  const files = s.paths.map((p) => items.get(byPath.get(p) || '')).filter(Boolean) as Item[];
  return {
    id: s.id,
    title: s.title,
    url: shareUrl(c, s),
    created: s.created,
    expires: s.expires,
    alive: shareAlive(s),
    allowDownload: s.allowDownload,
    hasPassword: !!s.pass,
    views: s.views,
    downloads: s.downloads,
    lastAccess: s.lastAccess,
    count: s.paths.length,
    size: files.reduce((a, f) => a + f.s, 0),
    ids: files.map((f) => f.id),
    missing: s.paths.length - files.length,
  };
}

const unlockFails = new Map<string, number[]>();

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

const KIND_LABEL: Record<Kind, string> = {
  image: 'Imagen', raw: 'Foto RAW', video: 'Video', audio: 'Audio', pdf: 'PDF',
  vector: 'Vector', design: 'Diseño', doc: 'Documento', other: 'Archivo',
};

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const PUBLIC_CSS = `
:root{--bg:#070b10;--panel:#0d141d;--el:#131c28;--bd:rgba(120,150,180,.18);--tx:#e6f3fb;--dim:#8ea2b5;--ac:#19dbef;--acx:#032027}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.wrap{max-width:1200px;margin:0 auto;padding:18px 18px 40px}
header.top{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:6px 0 18px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:9px;font-weight:600;letter-spacing:.02em;color:var(--dim);font-size:13px;text-decoration:none}
.brand img{width:22px;height:22px}
.pill{font-size:12px;color:var(--dim);border:1px solid var(--bd);border-radius:99px;padding:4px 10px;background:var(--panel)}
h1{font-size:clamp(20px,3vw,28px);margin:0 0 4px;font-weight:650;word-break:break-word}
.sub{color:var(--dim);font-size:14px;margin:0}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--ac);color:var(--acx);border:0;border-radius:10px;padding:11px 18px;font:inherit;font-weight:650;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn:hover{filter:brightness(1.08)}.btn.ghost{background:var(--el);color:var(--tx);border:1px solid var(--bd)}
.btn svg{width:18px;height:18px}
.head{display:flex;gap:16px;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;margin-bottom:18px}
.stage{background:#000;border:1px solid var(--bd);border-radius:14px;overflow:hidden;display:grid;place-items:center;min-height:200px;max-height:78vh}
.stage img,.stage video{max-width:100%;max-height:78vh;display:block}
.stage video{width:100%;background:#000}.stage iframe{width:100%;height:78vh;border:0;background:#fff}
.stage audio{width:min(560px,92%);margin:20px auto}
.ficon{display:grid;place-items:center;gap:10px;padding:60px 20px;color:var(--dim);text-align:center}
.ficon b{font-size:42px;color:var(--ac);font-weight:700;letter-spacing:.04em}
.note{color:var(--dim);font-size:13px;margin-top:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.tile{position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;background:var(--el);border:1px solid var(--bd);cursor:pointer;display:grid;place-items:center}
.tile img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s}.tile:hover img{transform:scale(1.04)}
.tile .ext{font-weight:700;color:var(--ac);font-size:20px;letter-spacing:.05em}
.tile .cap{position:absolute;inset:auto 0 0 0;padding:20px 9px 7px;background:linear-gradient(transparent,rgba(0,0,0,.75));font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .badge{position:absolute;top:7px;right:7px;background:rgba(0,0,0,.65);border-radius:6px;padding:2px 6px;font-size:11px;font-weight:600}
.lb{position:fixed;inset:0;background:rgba(3,6,9,.96);display:none;flex-direction:column;z-index:10}
.lb.on{display:flex}.lb-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;color:var(--dim);font-size:14px}
.lb-bar .nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--tx)}
.lb-body{flex:1;min-height:0;display:grid;place-items:center;position:relative;padding:0 8px 12px}
.lb-body img,.lb-body video{max-width:100%;max-height:100%;object-fit:contain}
.lb-body video{width:100%;height:100%}.lb-body iframe{width:100%;height:100%;border:0;background:#fff;border-radius:8px}
.nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(20,28,40,.7);border:1px solid var(--bd);color:var(--tx);width:46px;height:46px;border-radius:99px;cursor:pointer;font-size:22px;display:grid;place-items:center}
.nav.prev{left:12px}.nav.next{right:12px}.ib{background:var(--el);border:1px solid var(--bd);color:var(--tx);border-radius:9px;padding:7px 11px;cursor:pointer;font:inherit;font-size:13px;text-decoration:none;display:inline-flex;gap:6px;align-items:center}
.ib svg{width:16px;height:16px}
.center{min-height:80vh;display:grid;place-items:center;text-align:center}
.card{background:var(--panel);border:1px solid var(--bd);border-radius:16px;padding:28px;width:min(400px,100%)}
input[type=password]{width:100%;background:var(--bg);border:1px solid var(--bd);color:var(--tx);border-radius:10px;padding:12px;font:inherit;margin:14px 0}
.err{color:#f87171;font-size:13px}footer{color:var(--dim);font-size:12px;text-align:center;margin-top:28px;opacity:.75}
@media(max-width:600px){.grid{grid-template-columns:repeat(3,1fr);gap:5px}.tile{border-radius:8px}.tile .cap{display:none}.nav{display:none}.head .btn{width:100%;justify-content:center}}
`;

const DL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

function pageShell(title: string, body: string, head = ''): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#070b10"><title>${esc(title)}</title>
<link rel="icon" type="image/svg+xml" href="/marca/favicon.svg">${head}<style>${PUBLIC_CSS}</style></head><body>${body}</body></html>`;
}

function messagePage(c: Context, status: number, title: string, msg: string): Response {
  return c.html(pageShell(title, `<div class="center"><div><h1>${esc(title)}</h1><p class="sub">${esc(msg)}</p></div></div>`), status as never);
}

function passwordPage(c: Context, s: Share, error = ''): Response {
  return c.html(pageShell('Contenido protegido', `<div class="center"><form class="card" method="post" action="/s/${s.id}/unlock">
<h1 style="font-size:20px">🔒 ${esc(s.title)}</h1><p class="sub">Este contenido está protegido con contraseña.</p>
<input type="password" name="password" placeholder="Contraseña" autofocus autocomplete="current-password" required>
${error ? `<p class="err">${esc(error)}</p>` : ''}<button class="btn" style="width:100%;justify-content:center">Ver contenido</button></form></div>`), error ? 401 : 200);
}

function fileDesc(f: ShareFile): string {
  const it = f.it;
  const parts = [KIND_LABEL[f.k], fmtSize(f.s)];
  if (it?.d) parts.push(`${Math.floor(it.d / 60)}:${String(Math.round(it.d % 60)).padStart(2, '0')}`);
  if (it?.w && it?.h) parts.push(`${it.w}×${it.h}`);
  return parts.join(' · ');
}

function sharePage(c: Context, s: Share, files: ShareFile[]): Response {
  const base = `/s/${s.id}`;
  const abs = shareUrl(c, s);
  const data = files.map((f) => ({
    i: f.i,
    n: f.n,
    e: f.e,
    k: f.k,
    s: f.s,
    sz: fmtSize(f.s),
    desc: fileDesc(f),
    th: f.it ? thumbState(f.it) !== -1 : false,
    v: f.it ? viewKind(f.it) : false,
    w: f.it ? webSet.has(f.it.tk) : false,
    nw: f.it ? needsWeb(f.it) : false,
  }));
  const total = files.reduce((a, f) => a + f.s, 0);
  const expTxt = s.expires ? `Disponible hasta el ${fmtDate(s.expires)}` : 'Link sin vencimiento';
  const summary = files.length === 1 ? fileDesc(files[0]) : `${files.length} archivos · ${fmtSize(total)}`;
  const first = data[0];
  const og = !s.pass && first?.th
    ? `<meta property="og:image" content="${esc(`${abs}/t/${first.i}`)}"><meta name="twitter:card" content="summary_large_image">`
    : '';
  const head = `<meta property="og:title" content="${esc(s.title)}"><meta property="og:description" content="${esc(summary + ' · ' + expTxt)}">
<meta property="og:type" content="website"><meta property="og:url" content="${esc(abs)}">${og}`;

  const dlAll = s.allowDownload
    ? files.length > 1
      ? `<a class="btn" href="${base}/zip">${DL_SVG} Descargar todo (${fmtSize(total)})</a>`
      : files.length ? `<a class="btn" href="${base}/f/${files[0].i}?dl=1">${DL_SVG} Descargar (${fmtSize(files[0].s)})</a>` : ''
    : '';
  const single = files.length === 1;
  const body = `<div class="wrap">
<header class="top"><span class="brand"><img src="/marca/favicon.svg" alt="">Compartido con Axon</span><span class="pill" id="exp">${esc(expTxt)}</span></header>
<div class="head"><div><h1>${esc(s.title)}</h1><p class="sub">${esc(summary)}</p></div>${dlAll}</div>
${files.length === 0 ? '<p class="sub">Los archivos de este link ya no están disponibles.</p>' : single ? '<div class="stage" id="single"></div><p class="note" id="snote"></p>' : '<div class="grid" id="grid"></div>'}
<footer>${esc(expTxt)}${s.allowDownload ? '' : ' · Solo visualización'}</footer></div>
<div class="lb" id="lb"><div class="lb-bar"><span class="nm" id="lbn"></span><span id="lbc"></span><span id="lbd"></span><button class="ib" id="lbx">✕</button></div>
<div class="lb-body" id="lbb"></div><button class="nav prev" id="lbp">‹</button><button class="nav next" id="lbnx">›</button></div>
<script>
(function(){
var B=${JSON.stringify(base)},F=${JSON.stringify(data).replace(/</g, '\\u003c')},DL=${s.allowDownload ? 1 : 0},EXP=${s.expires || 0};
var DLI=${JSON.stringify(DL_SVG)};
function h(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function src(f){return B+'/f/'+f.i}
function media(f,big){
  var k=f.k;
  if((k==='image'||k==='raw'||k==='vector'||(k==='design'&&f.v))){var u=f.v?B+'/v/'+f.i:src(f);return '<img src="'+u+'" alt="'+h(f.n)+'">'}
  if(k==='video'){var u=f.w?B+'/w/'+f.i:src(f);return '<video controls playsinline autoplay preload="metadata" '+(f.th?'poster="'+B+'/t/'+f.i+'" ':'')+(DL?'':'controlslist="nodownload" ')+'src="'+u+'" data-nw="'+(f.nw&&!f.w?1:0)+'"></video>'}
  if(k==='audio')return (f.th?'<img src="'+B+'/t/'+f.i+'" style="max-height:50vh">':'')+'<audio controls autoplay src="'+src(f)+'"></audio>';
  if(k==='pdf'||f.e==='txt'||f.e==='md'||f.e==='csv')return '<iframe src="'+src(f)+'"></iframe>';
  return '<div class="ficon"><b>'+h((f.e||'file').toUpperCase())+'</b><span>'+h(f.n)+'</span><span>'+h(f.desc)+'</span>'+(DL?'<a class="btn" href="'+src(f)+'?dl=1">'+DLI+' Descargar</a>':'')+'</div>';
}
function hookVideo(root,noteEl){
  var v=root.querySelector('video');if(!v)return;
  v.addEventListener('error',function(){var m='Tu navegador no puede reproducir este formato.'+(DL?' Descargalo para verlo.':'');if(noteEl)noteEl.textContent=m;else alert(m)});
  if(v.dataset.nw==='1'&&noteEl)noteEl.textContent='Si el video no se reproduce, se está preparando una versión compatible — recargá en unos minutos.';
}
if(EXP){var el=document.getElementById('exp');var d=EXP-Date.now();if(d>0){var hrs=d/36e5;el.textContent=hrs<1?'Vence en '+Math.max(1,Math.round(d/6e4))+' min':hrs<48?'Vence en '+Math.round(hrs)+' h':'Vence en '+Math.round(hrs/24)+' días';el.title=${JSON.stringify(expTxt)}}}
var single=document.getElementById('single');
if(single){single.innerHTML=media(F[0],1);hookVideo(single,document.getElementById('snote'));if(F[0].k==='pdf'){document.getElementById('snote').innerHTML='¿No se ve? <a href="'+src(F[0])+'" target="_blank">Abrir el PDF</a>'}return}
var g=document.getElementById('grid');if(!g)return;
g.innerHTML=F.map(function(f,ix){
  var dur='';
  return '<div class="tile" data-ix="'+ix+'">'+(f.th?'<img loading="lazy" src="'+(f.k==='vector'&&f.e==='svg'?src(f):B+'/t/'+f.i)+'" alt="">':'<span class="ext">'+h((f.e||'?').toUpperCase())+'</span>')+(f.k==='video'?'<span class="badge">▶</span>':'')+'<span class="cap">'+h(f.n)+'</span></div>'
}).join('');
var lb=document.getElementById('lb'),lbb=document.getElementById('lbb'),cur=0;
function show(ix){cur=(ix+F.length)%F.length;var f=F[cur];lbb.innerHTML=media(f,1);hookVideo(lbb,null);
  document.getElementById('lbn').textContent=f.n;document.getElementById('lbc').textContent=(cur+1)+' / '+F.length+' · '+f.sz;
  document.getElementById('lbd').innerHTML=DL?'<a class="ib" href="'+src(f)+'?dl=1">'+DLI+' Descargar</a>':'';
  lb.classList.add('on');document.body.style.overflow='hidden'}
function close(){lb.classList.remove('on');lbb.innerHTML='';document.body.style.overflow=''}
g.addEventListener('click',function(e){var t=e.target.closest('.tile');if(t)show(+t.dataset.ix)});
document.getElementById('lbx').onclick=close;document.getElementById('lbp').onclick=function(){show(cur-1)};document.getElementById('lbnx').onclick=function(){show(cur+1)};
document.addEventListener('keydown',function(e){if(!lb.classList.contains('on'))return;if(e.key==='Escape')close();if(e.key==='ArrowLeft')show(cur-1);if(e.key==='ArrowRight')show(cur+1)});
var sx=null;lbb.addEventListener('touchstart',function(e){sx=e.touches[0].clientX},{passive:true});
lbb.addEventListener('touchend',function(e){if(sx===null)return;var dx=e.changedTouches[0].clientX-sx;if(Math.abs(dx)>60)show(cur+(dx<0?1:-1));sx=null});
})();
</script>`;
  return c.html(pageShell(s.title, body, head), 200, { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
}

// ---------- Host guard for the dedicated share hostname ----------
// When shareBase points at its own hostname, that hostname only serves the
// public /s/* pages — the admin panel is not reachable through it.

export const libraryHostGuard: MiddlewareHandler = async (c, next) => {
  if (!state.shareBase) return next();
  let shareHost = '';
  try { shareHost = new URL(state.shareBase).host.toLowerCase(); } catch { return next(); }
  const host = (c.req.header('x-forwarded-host') || c.req.header('host') || '').toLowerCase();
  if (!shareHost || host !== shareHost) return next();
  const p = c.req.path;
  if (p.startsWith('/s/') || p === '/marca/favicon.svg' || p === '/robots.txt') {
    if (p === '/robots.txt') return c.text('User-agent: *\nDisallow: /\n');
    return next();
  }
  return messagePage(c, 404, 'Link no encontrado', 'Pedile a quien te lo compartió que te pase el link completo.');
};

// ---------- Uploads (chunked, appended on the host) ----------

interface Upload { id: string; dir: string; name: string; part: string; size: number; received: number; t: number }
const uploads = new Map<string, Upload>();

async function appendToHost(part: string, body: ReadableStream<Uint8Array> | null): Promise<{ ok: boolean; n: number; error?: string }> {
  if (!body) return { ok: false, n: 0, error: 'Cuerpo vacío' };
  const proc = hostSpawnInteractive(`cat >> ${shq(part)}`, { user: 'user' });
  const stdin = proc.stdin as { write(d: Uint8Array): number | Promise<number>; flush(): void | Promise<void>; end(): void };
  let n = 0;
  try {
    const r = body.getReader();
    while (true) {
      const { done, value } = await r.read();
      if (done) break;
      n += value.length;
      if (n > CHUNK_MAX) throw new Error('Chunk demasiado grande');
      await stdin.write(value);
      await stdin.flush();
    }
  } catch (e) {
    try { stdin.end(); } catch { /* closed */ }
    await proc.exited;
    return { ok: false, n, error: String((e as Error)?.message || e) };
  }
  try { stdin.end(); } catch { /* closed */ }
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr as ReadableStream).text()]);
  return code === 0 ? { ok: true, n } : { ok: false, n, error: err.trim() || `exit ${code}` };
}

async function addPathToIndex(hp: string): Promise<Item | null> {
  const inUpload = under(hp, state.uploadRoot);
  const it = await statItem(hp, inUpload ? 'other' : undefined);
  if (!it) return null;
  putItem(it);
  saveIndex();
  if (['image', 'raw', 'video', 'audio'].includes(it.k)) exifBatch([it]).then(() => saveIndex()).catch(() => {});
  else it.mx = 1;
  ensureThumb(it, true);
  return it;
}

// Rewrite references (favorites / collections / shares) after a move.
function repath(from: string, to: string): void {
  const swap = (arr: string[]) => arr.map((p) => (p === from ? to : p));
  state.favorites = swap(state.favorites);
  for (const col of state.collections) col.paths = swap(col.paths);
  for (const s of state.shares) s.paths = swap(s.paths);
  saveState();
}

function publicItem(it: Item) {
  return {
    id: it.id, p: it.p, n: it.n, e: it.e, k: it.k, s: it.s, m: it.m, tk: it.tk,
    t: it.t, w: it.w, h: it.h, d: it.d, c: it.c,
    th: thumbState(it), wv: webSet.has(it.tk) ? 1 : 0, nw: needsWeb(it) ? 1 : 0, vw: viewKind(it) ? 1 : 0,
  };
}

const zipTokens = new Map<string, { paths: string[]; name: string; exp: number }>();

// ---------- Routes ----------
// Register AFTER app.use('/api/*', requireAuth): /api/library/* inherits
// cookie auth; /s/* is intentionally public (the token is the capability).

export function registerLibraryRoutes(app: Hono): void {
  ensureReady().then(() => {
    if (!items.size || Date.now() - scannedAt > RESCAN_MS) scan().catch(() => {});
    else runMetaPass().then(warmThumbs).catch(() => {});
  });
  setInterval(() => { scan().catch(() => {}); }, RESCAN_MS).unref();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of zipTokens) if (v.exp < now) zipTokens.delete(k);
    for (const [k, u] of uploads) {
      if (now - u.t > 24 * 3600_000) {
        uploads.delete(k);
        hostExec(`rm -f ${shq(u.part)}`, { user: 'user', timeoutMs: 5000 }).catch(() => {});
      }
    }
  }, 10 * 60_000).unref();

  // ---- Index ----
  app.get('/api/library', async (c) => {
    await ensureReady();
    const favs = new Set(state.favorites);
    const list = [...items.values()];
    return c.json({
      ok: true,
      home,
      roots: state.roots,
      uploadRoot: state.uploadRoot,
      shareBase: state.shareBase,
      scannedAt,
      scanning,
      metaPending,
      thumbsPending: hiQ.length + loQ.length + active,
      items: list.map(publicItem),
      favorites: list.filter((it) => favs.has(it.p)).map((it) => it.id),
      collections: state.collections.map((col) => ({
        id: col.id, name: col.name, created: col.created,
        ids: col.paths.map((p) => byPath.get(p)).filter(Boolean),
      })),
      shares: state.shares.filter(shareAlive).length,
    });
  });

  app.get('/api/library/status', async (c) => {
    await ensureReady();
    return c.json({ ok: true, scanning, scannedAt, metaPending, thumbsPending: hiQ.length + loQ.length + active, count: items.size });
  });

  app.post('/api/library/rescan', async (c) => {
    await ensureReady();
    const wait = c.req.query('wait') === '1';
    const p = scan();
    if (wait) await p;
    return c.json({ ok: true, count: items.size, scanning });
  });

  app.put('/api/library/settings', async (c) => {
    await ensureReady();
    const body = await c.req.json<{ roots?: string[]; uploadRoot?: string; shareBase?: string }>().catch(() => ({} as never));
    if (Array.isArray(body.roots)) {
      const clean: string[] = [];
      for (const r of body.roots) {
        let p = String(r || '').trim();
        if (!p) continue;
        if (p.startsWith('~/')) p = home + p.slice(1);
        p = path.posix.resolve(p);
        if (!ALLOWED_ROOT_PREFIXES.some((a) => under(p, a)) || p === '/home') return fail(c, 400, `Carpeta no permitida: ${p}`);
        if (!(await hostDirExists(p))) return fail(c, 400, `No existe la carpeta: ${p}`);
        if (!clean.includes(p)) clean.push(p);
      }
      state.roots = clean;
    }
    if (typeof body.uploadRoot === 'string' && body.uploadRoot.trim()) {
      let p = body.uploadRoot.trim();
      if (p.startsWith('~/')) p = home + p.slice(1);
      p = path.posix.resolve(p);
      if (!ALLOWED_ROOT_PREFIXES.some((a) => under(p, a)) || p === '/home') return fail(c, 400, 'Carpeta de subidas no permitida');
      const mk = await hostExec(`mkdir -p ${shq(p)}`, { user: 'user', timeoutMs: 10_000 });
      if (!mk.ok) return fail(c, 400, 'No se pudo crear la carpeta de subidas', { detail: mk.stderr });
      state.uploadRoot = p;
    }
    if (typeof body.shareBase === 'string') {
      const sb = body.shareBase.trim().replace(/\/+$/, '');
      if (sb && !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(sb)) return fail(c, 400, 'URL base inválida (ej: https://share.midominio.com)');
      state.shareBase = sb;
    }
    saveState();
    scan().catch(() => {});
    return c.json({ ok: true, roots: state.roots, uploadRoot: state.uploadRoot, shareBase: state.shareBase });
  });

  // ---- Media ----
  const itemOr404 = (c: Context) => items.get(c.req.param('id') || '');

  app.get('/api/library/thumb/:id', async (c) => {
    const it = itemOr404(c);
    if (!it) return c.text('No encontrado', 404);
    if (it.k === 'vector' && it.e === 'svg') return sendFile(c, it.p, { name: it.n });
    const ok = await Promise.race([ensureThumb(it, true), Bun.sleep(45_000).then(() => false)]);
    if (!ok) return c.text('Sin miniatura', 404);
    return sendCached(c, `${cacheHost}/thumbs/${it.tk}`);
  });

  app.get('/api/library/view/:id', async (c) => {
    const it = itemOr404(c);
    if (!it) return c.text('No encontrado', 404);
    if (!viewKind(it)) return sendFile(c, it.p, { name: it.n });
    const ok = await ensureView(it);
    if (!ok) return c.text('No se pudo generar la vista', 415);
    return sendCached(c, `${cacheHost}/views/${it.tk}`);
  });

  app.get('/api/library/file/:id', async (c) => {
    const it = itemOr404(c);
    if (!it) return c.text('No encontrado', 404);
    return sendFile(c, it.p, { name: it.n, download: c.req.query('dl') === '1' });
  });

  app.get('/api/library/web/:id', async (c) => {
    const it = itemOr404(c);
    if (!it || !webSet.has(it.tk)) return c.text('No encontrado', 404);
    return sendFile(c, `${cacheHost}/web/${it.tk}.mp4`, { name: it.n.replace(/\.[^.]+$/, '') + '.mp4', mime: 'video/mp4' });
  });

  app.post('/api/library/web/:id', async (c) => {
    const it = itemOr404(c);
    if (!it || it.k !== 'video') return fail(c, 404, 'Video no encontrado');
    return c.json({ ok: true, ...ensureWeb(it) });
  });

  app.get('/api/library/web/:id/status', async (c) => {
    const it = itemOr404(c);
    if (!it) return fail(c, 404, 'No encontrado');
    if (webSet.has(it.tk)) return c.json({ ok: true, state: 'done', pct: 100 });
    const tc = transcodes.get(it.tk);
    return c.json({ ok: true, ...(tc || { state: 'none', pct: 0 }) });
  });

  // ---- Organize ----
  app.post('/api/library/favorite', async (c) => {
    const { ids, on } = await c.req.json<{ ids: string[]; on: boolean }>().catch(() => ({ ids: [], on: true }));
    const paths = (ids || []).map((id) => items.get(id)?.p).filter(Boolean) as string[];
    const set = new Set(state.favorites);
    for (const p of paths) on ? set.add(p) : set.delete(p);
    state.favorites = [...set];
    saveState();
    return c.json({ ok: true });
  });

  app.post('/api/library/collections', async (c) => {
    const { name, ids } = await c.req.json<{ name: string; ids?: string[] }>().catch(() => ({ name: '' }));
    const clean = String(name || '').trim().slice(0, 80);
    if (!clean) return fail(c, 400, 'Poné un nombre');
    const col: Collection = {
      id: randomBytes(6).toString('base64url'),
      name: clean,
      created: Date.now(),
      paths: (ids || []).map((id) => items.get(id)?.p).filter(Boolean) as string[],
    };
    state.collections.push(col);
    saveState();
    return c.json({ ok: true, id: col.id });
  });

  app.patch('/api/library/collections/:cid', async (c) => {
    const col = state.collections.find((x) => x.id === c.req.param('cid'));
    if (!col) return fail(c, 404, 'Colección no encontrada');
    const b = await c.req.json<{ name?: string; add?: string[]; remove?: string[] }>().catch(() => ({} as never));
    if (b.name && String(b.name).trim()) col.name = String(b.name).trim().slice(0, 80);
    const toPaths = (ids?: string[]) => (ids || []).map((id) => items.get(id)?.p).filter(Boolean) as string[];
    if (b.add) for (const p of toPaths(b.add)) if (!col.paths.includes(p)) col.paths.push(p);
    if (b.remove) {
      const rm = new Set(toPaths(b.remove));
      col.paths = col.paths.filter((p) => !rm.has(p));
    }
    saveState();
    return c.json({ ok: true });
  });

  app.delete('/api/library/collections/:cid', (c) => {
    state.collections = state.collections.filter((x) => x.id !== c.req.param('cid'));
    saveState();
    return c.json({ ok: true });
  });

  app.post('/api/library/rename', async (c) => {
    const { id, name } = await c.req.json<{ id: string; name: string }>().catch(() => ({ id: '', name: '' }));
    const it = items.get(id);
    if (!it) return fail(c, 404, 'Archivo no encontrado');
    const clean = sanitizeName(name);
    if (!clean) return fail(c, 400, 'Nombre inválido');
    const dir = path.posix.dirname(it.p);
    const dest = `${dir}/${clean}`;
    if (dest === it.p) return c.json({ ok: true, item: publicItem(it) });
    if (!(await resolveInRoots(dest))) return fail(c, 403, 'Destino fuera de la biblioteca');
    if (await existsHost(dest)) return fail(c, 409, 'Ya existe un archivo con ese nombre');
    const r = await hostExec(`mv -n -- ${shq(it.p)} ${shq(dest)}`, { user: 'user', timeoutMs: 30_000 });
    if (!r.ok) return fail(c, 500, 'No se pudo renombrar', { detail: r.stderr });
    dropItem(it.id);
    repath(it.p, dest);
    const ni = await addPathToIndex(dest);
    if (ni) Object.assign(ni, { t: it.t, w: it.w, h: it.h, d: it.d, c: it.c, mx: it.mx });
    return c.json({ ok: true, item: ni ? publicItem(ni) : null });
  });

  app.post('/api/library/move', async (c) => {
    const { ids, dir } = await c.req.json<{ ids: string[]; dir: string }>().catch(() => ({ ids: [], dir: '' }));
    const target = await resolveInRoots(String(dir || ''));
    if (!target) return fail(c, 403, 'La carpeta destino tiene que estar dentro de la biblioteca');
    const mk = await hostExec(`mkdir -p -- ${shq(target)}`, { user: 'user', timeoutMs: 15_000 });
    if (!mk.ok) return fail(c, 500, 'No se pudo crear la carpeta', { detail: mk.stderr });
    const moved: unknown[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of ids || []) {
      const it = items.get(id);
      if (!it) { failed.push({ id, error: 'No encontrado' }); continue; }
      if (path.posix.dirname(it.p) === target) continue;
      const name = await freeName(target, it.n);
      const dest = `${target}/${name}`;
      const r = await hostExec(`mv -n -- ${shq(it.p)} ${shq(dest)}`, { user: 'user', timeoutMs: 600_000 });
      if (!r.ok) { failed.push({ id, error: r.stderr || `exit ${r.code}` }); continue; }
      dropItem(it.id);
      repath(it.p, dest);
      const ni = await addPathToIndex(dest);
      if (ni) {
        Object.assign(ni, { t: it.t, w: it.w, h: it.h, d: it.d, c: it.c, mx: it.mx });
        moved.push(publicItem(ni));
      }
    }
    saveIndex();
    return c.json({ ok: !failed.length, moved, failed });
  });

  // Delete = move to Axon's trash (restorable from Archivos → Papelera).
  app.post('/api/library/trash', async (c) => {
    const { ids } = await c.req.json<{ ids: string[] }>().catch(() => ({ ids: [] }));
    const list = (ids || []).map((id) => items.get(id)).filter(Boolean) as Item[];
    if (!list.length) return fail(c, 400, 'Nada para eliminar');
    const res = await app.request('/api/files/trash', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: c.req.header('cookie') || '' },
      body: JSON.stringify({ paths: list.map((it) => it.p) }),
    });
    const data = (await res.json().catch(() => ({}))) as { items?: { orig: string }[]; failed?: unknown[]; error?: string };
    const done = new Set((data.items || []).map((x) => x.orig));
    for (const it of list) if (done.has(it.p)) dropItem(it.id);
    state.favorites = state.favorites.filter((p) => !done.has(p));
    for (const col of state.collections) col.paths = col.paths.filter((p) => !done.has(p));
    saveState();
    saveIndex();
    return c.json({ ok: !data.failed?.length, removed: done.size, failed: data.failed || [], error: data.error });
  });

  app.post('/api/library/mkdir', async (c) => {
    const { dir } = await c.req.json<{ dir: string }>().catch(() => ({ dir: '' }));
    const target = await resolveInRoots(String(dir || ''));
    if (!target) return fail(c, 403, 'La carpeta tiene que estar dentro de la biblioteca');
    const r = await hostExec(`mkdir -p -- ${shq(target)}`, { user: 'user', timeoutMs: 15_000 });
    return r.ok ? c.json({ ok: true, dir: target }) : fail(c, 500, 'No se pudo crear', { detail: r.stderr });
  });

  // ---- Upload ----
  app.post('/api/library/upload/init', async (c) => {
    await ensureReady();
    const b = await c.req.json<{ name: string; size: number; dir?: string; rel?: string }>().catch(() => ({} as never));
    const name = sanitizeName(b.name);
    const size = Number(b.size);
    if (!name) return fail(c, 400, 'Nombre inválido');
    if (!Number.isFinite(size) || size < 0) return fail(c, 400, 'Tamaño inválido');
    const kind = KIND_BY_EXT[extOf(name)] || 'other';
    let dir = b.dir ? await resolveInRoots(b.dir) : `${state.uploadRoot}/${KIND_FOLDER[kind]}`;
    if (!dir) return fail(c, 403, 'Carpeta destino fuera de la biblioteca');
    const relDirs = String(b.rel || '').split('/').slice(0, -1).map(sanitizeName).filter((s) => s && s !== '..');
    if (relDirs.length) dir = `${dir}/${relDirs.join('/')}`;
    const mk = await hostExec(`mkdir -p -- ${shq(dir)}`, { user: 'user', timeoutMs: 15_000 });
    if (!mk.ok) return fail(c, 500, 'No se pudo crear la carpeta destino', { detail: mk.stderr });
    const df = await hostExec(`df -B1 --output=avail ${shq(dir)} | tail -1`, { user: 'user', timeoutMs: 10_000 });
    const avail = parseInt(df.stdout.trim(), 10);
    if (avail && size > avail - 512 * 1024 * 1024) return fail(c, 507, `No hay espacio suficiente (libre: ${fmtSize(avail)})`);
    const id = randomBytes(9).toString('base64url');
    const part = `${dir}/.${name}.${id}.axonpart`;
    const t = await hostExec(`: > ${shq(part)}`, { user: 'user', timeoutMs: 10_000 });
    if (!t.ok) return fail(c, 500, 'No se pudo iniciar la subida', { detail: t.stderr });
    uploads.set(id, { id, dir, name, part, size, received: 0, t: Date.now() });
    return c.json({ ok: true, id, chunkSize: 32 * 1024 * 1024, dir });
  });

  app.put('/api/library/upload/:uid', async (c) => {
    const u = uploads.get(c.req.param('uid'));
    if (!u) return fail(c, 404, 'Subida no encontrada (¿expiró?)');
    const offset = Number(c.req.query('offset') || 0);
    const st = await stat(hostToContainer(u.part)).catch(() => null);
    const have = st?.size ?? -1;
    if (have < 0) return fail(c, 410, 'El archivo parcial desapareció');
    if (offset !== have) return c.json({ ok: false, error: 'offset', received: have }, 409);
    const r = await appendToHost(u.part, c.req.raw.body);
    const after = (await stat(hostToContainer(u.part)).catch(() => null))?.size ?? have;
    u.received = after;
    u.t = Date.now();
    if (!r.ok) return fail(c, 500, 'Falló la escritura del bloque', { detail: r.error, received: after });
    if (after > u.size) return fail(c, 400, 'Se recibieron más bytes de los declarados');
    return c.json({ ok: true, received: after });
  });

  app.post('/api/library/upload/:uid/finish', async (c) => {
    const u = uploads.get(c.req.param('uid'));
    if (!u) return fail(c, 404, 'Subida no encontrada');
    const st = await stat(hostToContainer(u.part)).catch(() => null);
    if (!st || st.size !== u.size) return fail(c, 400, `Subida incompleta (${st?.size ?? 0} de ${u.size} bytes)`);
    const name = await freeName(u.dir, u.name);
    const dest = `${u.dir}/${name}`;
    const r = await hostExec(`mv -n -- ${shq(u.part)} ${shq(dest)}`, { user: 'user', timeoutMs: 30_000 });
    if (!r.ok) return fail(c, 500, 'No se pudo completar la subida', { detail: r.stderr });
    uploads.delete(u.id);
    const it = await addPathToIndex(dest);
    return c.json({ ok: true, item: it ? publicItem(it) : null, path: dest });
  });

  app.delete('/api/library/upload/:uid', async (c) => {
    const u = uploads.get(c.req.param('uid'));
    if (u) {
      uploads.delete(u.id);
      await hostExec(`rm -f -- ${shq(u.part)}`, { user: 'user', timeoutMs: 10_000 });
    }
    return c.json({ ok: true });
  });

  // ---- ZIP (authed) ----
  app.post('/api/library/zip', async (c) => {
    const { ids, name } = await c.req.json<{ ids: string[]; name?: string }>().catch(() => ({ ids: [] }));
    const paths = (ids || []).map((id) => items.get(id)?.p).filter(Boolean) as string[];
    if (!paths.length) return fail(c, 400, 'Nada para descargar');
    const tok = randomBytes(12).toString('base64url');
    zipTokens.set(tok, { paths, name: sanitizeName(name || 'biblioteca') + '.zip', exp: Date.now() + 10 * 60_000 });
    return c.json({ ok: true, url: `/api/library/zip/${tok}` });
  });

  app.get('/api/library/zip/:tok', async (c) => {
    const z = zipTokens.get(c.req.param('tok'));
    if (!z || z.exp < Date.now()) return c.text('Link de descarga vencido', 410);
    return zipResponse(z.paths, z.name);
  });

  // ---- Shares (authed management) ----
  app.get('/api/library/shares', async (c) => {
    await ensureReady();
    return c.json({ ok: true, shareBase: state.shareBase, shares: state.shares.slice().sort((a, b) => b.created - a.created).map((s) => shareSummary(c, s)) });
  });

  app.post('/api/library/shares', async (c) => {
    await ensureReady();
    const b = await c.req.json<{ ids: string[]; title?: string; ttl?: number; allowDownload?: boolean; password?: string }>().catch(() => ({ ids: [] } as never));
    const list = (b.ids || []).map((id) => items.get(id)).filter(Boolean) as Item[];
    if (!list.length) return fail(c, 400, 'Elegí al menos un archivo');
    if (list.length > 2000) return fail(c, 400, 'Demasiados archivos para un solo link');
    const ttl = Number(b.ttl);
    const s: Share = {
      id: randomBytes(12).toString('base64url'),
      title: String(b.title || '').trim().slice(0, 120) || (list.length === 1 ? list[0].n : `${list.length} archivos`),
      paths: list.map((it) => it.p),
      created: Date.now(),
      expires: ttl > 0 ? Date.now() + Math.min(ttl, 366 * 86400) * 1000 : null,
      allowDownload: b.allowDownload !== false,
      views: 0,
      downloads: 0,
    };
    if (b.password && String(b.password).length) s.pass = await Bun.password.hash(String(b.password));
    state.shares.push(s);
    saveState();
    // Prepare what the visitor will need: thumbnails + H.264 versions.
    for (const it of list) {
      ensureThumb(it, true);
      if (needsWeb(it)) ensureWeb(it);
    }
    return c.json({ ok: true, share: shareSummary(c, s) });
  });

  app.patch('/api/library/shares/:sid', async (c) => {
    const s = state.shares.find((x) => x.id === c.req.param('sid'));
    if (!s) return fail(c, 404, 'Link no encontrado');
    const b = await c.req.json<{ title?: string; ttl?: number | null; extend?: number; allowDownload?: boolean; password?: string | null }>().catch(() => ({} as never));
    if (typeof b.title === 'string' && b.title.trim()) s.title = b.title.trim().slice(0, 120);
    if (b.ttl === null || b.ttl === 0) s.expires = null;
    else if (typeof b.ttl === 'number' && b.ttl > 0) s.expires = Date.now() + Math.min(b.ttl, 366 * 86400) * 1000;
    if (typeof b.extend === 'number' && b.extend > 0) s.expires = Math.max(Date.now(), s.expires ?? Date.now()) + b.extend * 1000;
    if (typeof b.allowDownload === 'boolean') s.allowDownload = b.allowDownload;
    if (b.password === null || b.password === '') delete s.pass;
    else if (typeof b.password === 'string') s.pass = await Bun.password.hash(b.password);
    saveState();
    return c.json({ ok: true, share: shareSummary(c, s) });
  });

  app.delete('/api/library/shares/:sid', (c) => {
    const before = state.shares.length;
    state.shares = state.shares.filter((x) => x.id !== c.req.param('sid'));
    saveState();
    return c.json({ ok: before !== state.shares.length });
  });

  app.post('/api/library/shares/cleanup', (c) => {
    const before = state.shares.length;
    state.shares = state.shares.filter(shareAlive);
    saveState();
    return c.json({ ok: true, removed: before - state.shares.length });
  });

  // ---- Public share pages (no cookie) ----
  const getShare = async (c: Context): Promise<Share | Response> => {
    await ensureReady();
    const sid = c.req.param('sid') || '';
    const s = /^[A-Za-z0-9_-]{8,40}$/.test(sid) ? state.shares.find((x) => x.id === sid) : undefined;
    if (!s) return messagePage(c, 404, 'Link no encontrado', 'Este link no existe o fue eliminado.');
    if (!shareAlive(s)) return messagePage(c, 410, 'Este link venció', 'Pedile a quien te lo compartió que genere uno nuevo.');
    return s;
  };

  const fileOf = async (c: Context, s: Share): Promise<ShareFile | null> => {
    const i = Number(c.req.param('i'));
    if (!Number.isInteger(i) || i < 0 || i >= s.paths.length) return null;
    const p = s.paths[i];
    const id = byPath.get(p);
    const it = (id ? items.get(id) : undefined) || (await statItem(p, 'other')) || undefined;
    return it ? { i, p, n: it.n, e: it.e, k: it.k, s: it.s, it } : null;
  };

  app.get('/s/:sid', async (c) => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!isUnlocked(c, s)) return passwordPage(c, s);
    s.views++;
    s.lastAccess = Date.now();
    saveState();
    return sharePage(c, s, await shareFiles(s));
  });

  app.post('/s/:sid/unlock', async (c) => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!s.pass) return c.redirect(`/s/${s.id}`);
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'x';
    const key = `${ip}:${s.id}`;
    const now = Date.now();
    const fails = (unlockFails.get(key) || []).filter((t) => t > now - 10 * 60_000);
    if (fails.length >= 8) return passwordPage(c, s, 'Demasiados intentos. Esperá unos minutos.');
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const ok = await Bun.password.verify(String(form.password || ''), s.pass).catch(() => false);
    if (!ok) {
      fails.push(now);
      unlockFails.set(key, fails);
      if (unlockFails.size > 5000) unlockFails.clear();
      return passwordPage(c, s, 'Contraseña incorrecta');
    }
    unlockFails.delete(key);
    const secure = (c.req.header('x-forwarded-proto') || '').includes('https') || (c.req.header('cf-visitor') || '').includes('https') ? '; Secure' : '';
    c.header('set-cookie', `axs_${s.id}=${unlockToken(s)}; Path=/s/${s.id}; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}${secure}`);
    return c.redirect(`/s/${s.id}`, 303);
  });

  app.get('/s/:sid/f/:i', async (c) => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!isUnlocked(c, s)) return c.text('Protegido', 401);
    const f = await fileOf(c, s);
    if (!f) return c.text('No encontrado', 404);
    const dl = c.req.query('dl') === '1';
    if (dl && !s.allowDownload) return c.text('La descarga está deshabilitada para este link', 403);
    if (dl && !/^bytes=[1-9]/.test(c.req.header('range') || '')) {
      s.downloads++;
      s.lastAccess = Date.now();
      saveState();
    }
    return sendFile(c, f.p, { name: f.n, download: dl, cache: 'private, no-store' });
  });

  app.get('/s/:sid/t/:i', async (c) => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!isUnlocked(c, s)) return c.text('Protegido', 401);
    const f = await fileOf(c, s);
    if (!f?.it) return c.text('No encontrado', 404);
    if (f.it.k === 'vector' && f.it.e === 'svg') return sendFile(c, f.p, { name: f.n });
    const ok = await Promise.race([ensureThumb(f.it, true), Bun.sleep(45_000).then(() => false)]);
    if (!ok) return c.text('Sin miniatura', 404);
    return sendCached(c, `${cacheHost}/thumbs/${f.it.tk}`, 'public, max-age=3600');
  });

  app.get('/s/:sid/v/:i', async (c) => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!isUnlocked(c, s)) return c.text('Protegido', 401);
    const f = await fileOf(c, s);
    if (!f?.it) return c.text('No encontrado', 404);
    if (!viewKind(f.it)) return sendFile(c, f.p, { name: f.n });
    if (!(await ensureView(f.it))) return c.text('No se pudo generar la vista', 415);
    return sendCached(c, `${cacheHost}/views/${f.it.tk}`, 'private, max-age=3600');
  });

  app.get('/s/:sid/w/:i', async (c) => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!isUnlocked(c, s)) return c.text('Protegido', 401);
    const f = await fileOf(c, s);
    if (!f?.it || !webSet.has(f.it.tk)) return c.text('No encontrado', 404);
    return sendFile(c, `${cacheHost}/web/${f.it.tk}.mp4`, { name: f.n.replace(/\.[^.]+$/, '') + '.mp4', mime: 'video/mp4', cache: 'private, no-store' });
  });

  app.get('/s/:sid/zip', async (c) => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!isUnlocked(c, s)) return c.text('Protegido', 401);
    if (!s.allowDownload) return c.text('La descarga está deshabilitada para este link', 403);
    s.downloads++;
    s.lastAccess = Date.now();
    saveState();
    return zipResponse(s.paths, `${sanitizeName(s.title) || 'compartido'}.zip`);
  });
}
