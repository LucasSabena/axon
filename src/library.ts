import { documentResponse } from './document-preview';
import { resolveHostPath, hostVolumes } from './host-storage';
import type {FileTransfers} from './file-transfers';
import {reviewLibraryMove,movedReference,type TransferReview} from './library-transfer-review';
import {actor as maintenanceActor} from './storage/http';
import {MaintenanceError} from './storage/types';
import {volumeForPath,volumeContains} from './file-volumes';
import { getConnInfo } from 'hono/bun';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { appendUploadBlock } from './file-uploads';
import { readdir, stat, readFile, writeFile, mkdir, realpath, rename as fsRename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as zlib from 'node:zlib';
import * as path from 'node:path';
import { hostExec, hostSpawn, hostSpawnInteractive, killHostProc, hostToContainer, containerToHost, HOST_USER } from './host';
import { registerLibraryTools, hasTranscript, transcriptVtt, type LibCtx } from './library-tools';
import { purgeCachePrefixes } from './cloudflare';
import { canonicalRoots, canonicalLibraryFile } from './library-paths';
import { trackShare, type ShareActivity } from './library-activity';
import { recordEvent } from './events';
import { notify } from './notify';
import { playbackEncoding } from './media-playback';
import { LibraryLiveWatch, libraryFileVersion } from './library-live';

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
  tk: string;   // source version (dev+ino+size+mtime+ctime)
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
  msg?: string;           // note shown to the recipient
  notifyActivity?: boolean;
  activity?: ShareActivity[];
  visitors?: string[];
  cdn?: boolean;          // let Cloudflare's edge cache previews/files (default on)
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
const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error('SESSION_SECRET environment variable is required');
}

const MAX_ITEMS = 250_000;
const THUMB_SIZE = 512;
const VIEW_SIZE = 2048;
const CHUNK_MAX = 64 * 1024 * 1024;
const RESCAN_MS = 20 * 60 * 1000;
// Live folder watches already pick up edits; the open-tab poll only forces a
// full walk when the index went stale (used to be ~20 s of near-continuous
// rescanning while the tab stayed open).
const ACTIVE_RESCAN_MS = 5 * 60_000;
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
addKind('doc', 'doc docx xls xlsx ppt pptx odt ods odp rtf txt md csv tsv docm dot dotx ott pptm pps ppsx pot potx otp xlsm xlt xltx ots key pages numbers');

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
// Browser-native but heavy photos also get a 2048px rendition for viewing —
// the original is only fetched to zoom in or download.
const bigImage = (it: { k: Kind; e: string; s: number; w?: number; h?: number }) =>
  it.k === 'image' && !viewKind(it) && it.e !== 'gif' && it.e !== 'svg' &&
  (it.s > 2_500_000 || (it.w || 0) > 2600 || (it.h || 0) > 2600);
const hasView = (it: Item) => viewKind(it) || bigImage(it);
// Videos worth a lighter streaming copy when shared (HEVC, odd containers,
// or simply heavy: > 1080p or > ~12 Mbit/s).
const heavyVideo = (it: Item) =>
  it.k === 'video' && (needsWeb(it) || Math.min(it.w || 0, it.h || 0) > 1080 || (!!it.d && (it.s * 8) / it.d > 12e6));

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
let directories = new Set<string>();
let metaPending = 0;
let ready: Promise<void> | null = null;

const thumbSet = new Set<string>();
const failSet = new Set<string>();
const viewSet = new Set<string>();
const webSet = new Set<string>();
// View/transcode failures don't persist .fail markers — they cool down so a
// broken render can't be requeued on every anonymous share page request.
const viewFails = new Map<string, number>();
const webFails = new Map<string, number>();
const RENDER_RETRY_MS = 10 * 60_000;

let stateWriteQueue = Promise.resolve();
let indexWriteQueue = Promise.resolve();
let scanFlight: Promise<void> | null = null;
const liveWatch = new LibraryLiveWatch(hostToContainer, refreshChangedPaths);
let stateTimer: ReturnType<typeof setTimeout> | null = null;
let indexTimer: ReturnType<typeof setTimeout> | null = null;

function saveState(bumpRev = true): void {
  if (bumpRev) rev++;
  if (stateTimer) return;
  stateTimer = setTimeout(() => {
    stateTimer = null;
    const snapshot=JSON.stringify(state);
    stateWriteQueue=stateWriteQueue.then(async()=>{
      try {
        await mkdir(LIB_DIR, { recursive: true });
        await writeFile(STATE_FILE + '.tmp', snapshot, 'utf-8');
        await fsRename(STATE_FILE + '.tmp', STATE_FILE);
      } catch (e) { console.error('library state save', e); }
    });
  }, 800);
}

function saveIndex(): void {
  if (indexTimer) return;
  indexTimer = setTimeout(() => {
    indexTimer = null;
    const snapshot=JSON.stringify({scannedAt,items:[...items.values()]});
    indexWriteQueue=indexWriteQueue.then(async()=>{
      try {
        await mkdir(LIB_DIR, { recursive: true });
        await writeFile(INDEX_FILE + '.tmp', snapshot, 'utf-8');
        await fsRename(INDEX_FILE + '.tmp', INDEX_FILE);
      } catch (e) { console.error('library index save', e); }
    });
  }, 5000);
}

// Bumped on every change that affects GET /api/library (ETag).
let rev = 1;
const touched = () => { rev++; };

function putItem(it: Item): void {
  rev++;
  items.set(it.id, it);
  byPath.set(it.p, it.id);
}

function dropItem(id: string): void {
  const it = items.get(id);
  if (!it) return;
  rev++;
  items.delete(id);
  if (byPath.get(it.p) === id) byPath.delete(it.p);
}

async function hostDirExists(p: string): Promise<boolean> {
  const st = await stat(hostToContainer(p)).catch(() => null);
  return !!st?.isDirectory();
}

async function init(): Promise<void> {
  if (process.env.AXON_QA_ROOT) home = process.env.AXON_QA_ROOT;
  else try {
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
  if (!root) return false;
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
  try{await hostVolumes.roots(p);}catch{return null;}
  const realRoots = await Promise.all(roots.map(async (r) => {
    try { return containerToHost(await realpath(hostToContainer(r))); } catch { return r; }
  }));
  // Shares keep paths under symlinked roots in their resolved spelling.
  if (!roots.some((r) => under(p, r)) && !realRoots.some((r) => under(p, r))) return null;
  let probe = p;
  const tail: string[] = [];
  while (true) {
    try {
      const real = containerToHost(await realpath(hostToContainer(probe)));
      const full = tail.length ? path.posix.join(real, ...tail.reverse()) : real;
      try{await hostVolumes.roots(full);}catch{return null;}
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
  const tk = libraryFileVersion(st);
  return { id: idOf(hp), p: hp, n: name, e, k, s: st.size, m, tk };
}

async function scan(): Promise<void> {
  await ensureReady();
  if (!scanFlight) scanFlight=scanOnce().finally(()=>{scanFlight=null;});
  return scanFlight;
}
async function scanOnce(): Promise<void> {
  scanning = true;
  const t0 = Date.now();
  try {
    const found = new Map<string, Item>();
    const foundDirs = new Set<string>();
    const staleParts: string[] = [];
    const roots = [...new Set([state.uploadRoot, ...state.roots])];
    const mapper = { toContainer: hostToContainer, toHost: containerToHost };
    const realRoots = await canonicalRoots(roots, mapper);
    const visited=new Set<string>();
    for (const root of roots) {
      try{await hostVolumes.roots(root);}catch{for(const it of items.values())if(under(it.p,root))found.set(it.p,it);continue;}
      const anyKind = root === state.uploadRoot;
      const stack = [root.replace(/\/+$/, '')];
      while (stack.length && found.size < MAX_ITEMS) {
        const dir = stack.pop()!;
        let ents;
        try{await hostVolumes.roots(dir);const ds=await stat(hostToContainer(dir));const key=ds.dev+':'+ds.ino;if(visited.has(key))continue;visited.add(key);}catch{continue;}
        try { ents = await readdir(hostToContainer(dir), { withFileTypes: true }); } catch { continue; }
        foundDirs.add(dir);
        const files: string[] = [];
        const links: string[] = [];
        for (const d of ents) {
          if (d.name.startsWith('.')) {
            if (d.name.endsWith('.axonpart')) staleParts.push(`${dir}/${d.name}`);
            continue;
          }
          const hp = `${dir}/${d.name}`;
          if (d.isDirectory()) {
            if (!SKIP_DIRS.has(d.name) && hp !== cacheHost) stack.push(hp);
          } else if (d.isSymbolicLink() && KIND_BY_EXT[extOf(d.name)]) {
            links.push(hp);
          } else if (d.isFile() && (anyKind || KIND_BY_EXT[extOf(d.name)])) {
            if (!found.has(hp)) files.push(hp);
          }
        }
        for (let i = 0; i < links.length; i += 64) {
          const accepted = await Promise.all(links.slice(i, i + 64).map(async hp =>
            await canonicalLibraryFile(hp, roots, realRoots, mapper) ? hp : null));
          files.push(...accepted.filter((p): p is string => !!p && !found.has(p)));
        }
        for (let i = 0; i < files.length; i += 64) {
          const batch = await Promise.all(files.slice(i, i + 64).map((hp) => statItem(hp, anyKind ? 'other' : undefined)));
          for (const it of batch) {
            if (!it) continue;
            const prevId = byPath.get(it.p);
            const prev = prevId ? items.get(prevId) : undefined;
            if (prev && prev.tk === it.tk && prev.s === it.s && prev.m === it.m) {
              found.set(it.p, { ...prev, tk: it.tk, k: it.k });
            } else found.set(it.p, it);
          }
        }
      }
    }
    // Part files whose upload never finished and whose tracker was lost on a
    // restart get swept once they're a day old.
    const tracked = new Set([...uploads.values()].map((u) => u.part));
    for (const hp of staleParts) {
      if (tracked.has(hp)) continue;
      const st = await stat(hostToContainer(hp)).catch(() => null);
      if (st?.isFile() && st.mtimeMs < Date.now() - 24 * 3600_000)
        hostExec(`rm -f -- ${shq(hp)}`, { user: 'user', timeoutMs: 5000 }).catch(() => {});
    }
    const changed = foundDirs.size !== directories.size || [...foundDirs].some(p => !directories.has(p)) || found.size !== items.size || [...found.values()].some(it => {
      const previous = items.get(it.id);
      return !previous || previous.tk !== it.tk || previous.k !== it.k || previous.m !== it.m || previous.s !== it.s;
    });
    directories = foundDirs;
    if (changed) {
      items.clear(); byPath.clear();
      for (const it of found.values()) putItem(it);
      rev++;
    }
    scannedAt = Date.now();
    await liveWatch.sync(directories);
    saveIndex();
    console.log(`[library] scan: ${items.size} items in ${Date.now() - t0} ms`);
  } finally {
    scanning = false;
  }
  runMetaPass().catch((e) => console.error('library meta', e));
}

// Revalidate individual resources on access, even before a watch/poll fires.
// Resolve links again so a changed link cannot escape the configured roots.
async function freshItem(id: string): Promise<Item | undefined> {
  await ensureReady();
  const previous = items.get(id);
  if (!previous) return undefined;
  try{await hostVolumes.roots(previous.p);}catch{return undefined;}
  const roots = [...state.roots, state.uploadRoot];
  const mapper = { toContainer: hostToContainer, toHost: containerToHost };
  const realRoots = await canonicalRoots(roots, mapper);
  const allowed = await canonicalLibraryFile(previous.p, roots, realRoots, mapper);
  const current = allowed ? await statItem(previous.p, under(previous.p, state.uploadRoot) ? 'other' : undefined) : null;
  // An overlapping scan may already have replaced the indexed entry.
  if (items.get(id) !== previous) return items.get(id);
  if (!current) { dropItem(id); saveIndex(); return undefined; }
  if (current.tk === previous.tk) return previous;
  putItem(current); saveIndex();
  if (['image', 'raw', 'video', 'audio'].includes(current.k)) {
    exifBatch([current]).then(() => { touched(); saveIndex(); }).catch(() => {});
  } else current.mx = 1;
  return current;
}

async function refreshChangedPaths(paths: string[] | null): Promise<void> {
  // Don't let a scan snapshot overwrite an update detected during its walk.
  if (scanFlight) await scanFlight;
  if (!paths) { await scan(); return; }
  let reconcile = false;
  for (const p of paths) {
    if (directories.has(p)) { reconcile = true; continue; }
    if (path.posix.basename(p).startsWith('.')) continue;
    const id = byPath.get(p);
    if (id) { await freshItem(id); continue; }
    const st = await stat(hostToContainer(p)).catch(() => null);
    if (st?.isDirectory()) { reconcile = true; continue; }
    if (!st?.isFile() || !(KIND_BY_EXT[extOf(p)] || under(p, state.uploadRoot))) continue;
    if (await resolveInRoots(p)) await addPathToIndex(p);
  }
  if (reconcile) await scan();
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
  const timer = setTimeout(() => killHostProc(proc), 120_000);
  let out = '';
  try {
    out = await new Response(proc.stdout as ReadableStream).text();
    await proc.exited;
  } catch {
    killHostProc(proc);
    try { await proc.exited; } catch { /* gone */ }
  } finally {
    clearTimeout(timer);
  }
  let rows: Record<string, unknown>[] = [];
  try { rows = JSON.parse(out || '[]'); } catch { /* keep empty */ }
  const meta = new Map(rows.map((r) => [String(r.SourceFile), r]));
  for (const it of batch) {
    const cur = items.get(it.id);
    if (!cur || cur.tk !== it.tk) continue;
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

let metaFlight: Promise<void> | null = null;
let metaAgain = false;
function runMetaPass(): Promise<void> {
  metaAgain = true;
  if (!metaFlight) {
    metaFlight = (async () => {
      do { metaAgain = false; await runMetaOnce(); } while (metaAgain);
    })().finally(() => { metaFlight = null; });
  }
  return metaFlight;
}

async function runMetaOnce(): Promise<void> {
  const groups = new Map<string,Item[]>();
  for(const it of items.values()){const group=groups.get(it.tk)||[];group.push(it);groups.set(it.tk,group);}
  const metadata = (it:Item) => ({mx:it.mx,t:it.t,w:it.w,h:it.h,d:it.d,c:it.c});
  const todo: Item[] = [];
  for(const group of groups.values()){
    const ready=group.find(it=>it.mx);
    if(ready)for(const it of group)Object.assign(it,metadata(ready));
    else if(['image','raw','video','audio'].includes(group[0].k))todo.push(group[0]);
  }
  metaPending = todo.length;
  for (let i = 0; i < todo.length; i += 250) {
    const batch=todo.slice(i,i+250).filter(it => items.get(it.id)?.tk === it.tk && !items.get(it.id)?.mx);
    if (batch.length) await exifBatch(batch).catch(() => {});
    for(const it of batch)for(const sibling of groups.get(it.tk)||[])if(items.get(sibling.id)?.tk===it.tk)Object.assign(items.get(sibling.id)!,metadata(it));
    metaPending = Math.max(0, todo.length - i - 250);
    if (batch.length) touched();
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
    rev++;
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
  if (Date.now() - (viewFails.get(it.tk) || 0) < RENDER_RETRY_MS) return Promise.resolve(false);
  return enqueue(`v:${it.tk}`, async () => {
    const ok = await renderTo(it, 'views', VIEW_SIZE);
    if (ok) { viewSet.add(it.tk); viewFails.delete(it.tk); }
    else viewFails.set(it.tk, Date.now());
    return ok;
  }, true);
}

// ---------- Web (H.264) versions for HEVC / non-web containers ----------

interface Transcode { state: 'queued' | 'running' | 'done' | 'error'; pct: number; error?: string }
const transcodes = new Map<string, Transcode>();
let tcChain: Promise<void> = Promise.resolve();

function ensureWeb(it: Item): Transcode {
  if (webSet.has(it.tk)) return { state: 'done', pct: 100 };
  const cur = transcodes.get(it.tk);
  if (cur && cur.state !== 'error') return cur;
  // A failed transcode cools down before retrying so share pages don't requeue
  // the same ffmpeg crash on every request.
  if (Date.now() - (webFails.get(it.tk) || 0) < RENDER_RETRY_MS)
    return cur || { state: 'error', pct: 0, error: 'No se pudo preparar el video' };
  const tc: Transcode = { state: 'queued', pct: 0 };
  transcodes.set(it.tk, tc);
  tcChain = tcChain.then(() => runTranscode(it, tc)).catch(() => { tc.state = 'error'; tc.error = 'No se pudo preparar el video'; webFails.set(it.tk, Date.now()); });
  return tc;
}

async function runTranscode(it: Item, tc: Transcode): Promise<void> {
  tc.state = 'running';
  const out = `${cacheHost}/web/${it.tk}.mp4`;
  const part = `${cacheHost}/web/${it.tk}.part.mp4`;
  const probe = await hostExec(`ffprobe -v error -show_entries stream=codec_type,codec_name,pix_fmt -of json ${shq(it.p)}`, { user: 'user', timeoutMs: 15_000 });
  const encoding = playbackEncoding(probe.stdout, needsWeb(it) || !heavyVideo(it));
  const cmd =
    `nice -n 10 ffmpeg -nostdin -v error -y -i ${shq(it.p)} -map 0:v:0 -map 0:a:0? ${encoding.video} ${encoding.audio} ` +
    `-movflags +faststart -threads 8 -progress pipe:1 -nostats ${shq(part)} ` +
    `&& mv -f ${shq(part)} ${shq(out)}`;
  // Remote `timeout` bounds the whole ffmpeg tree; the local watchdog only
  // backstops the wrapper (a wedged ffmpeg must not serialize tcChain forever).
  const proc = hostSpawn(cmd, { user: 'user', timeoutSec: 3600 });
  const watchdog = setTimeout(() => killHostProc(proc), 3_660_000);
  // Attach the catch now: a dead stderr stream on the success path must not
  // surface as an unhandled rejection.
  const stderr = new Response(proc.stderr as ReadableStream).text().catch(() => '');
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
  clearTimeout(watchdog);
  if (code === 0) {
    rev++;
    webSet.add(it.tk);
    webFails.delete(it.tk);
    tc.state = 'done';
    tc.pct = 100;
  } else {
    tc.state = 'error';
    webFails.set(it.tk, Date.now());
    tc.error = (await stderr).trim().slice(-400) || `exit ${code}`;
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
  opts: { name: string; download?: boolean; mime?: string; cache?: string; version?: string }
): Promise<Response> {
  const cp = hostToContainer(hostPath);
  const st = await stat(cp).catch(() => null);
  if (!st || !st.isFile()) return c.text('No encontrado', 404);
  const e = extOf(opts.name);
  const version = libraryFileVersion(st);
  const headers: Record<string, string> = {
    'Content-Type': opts.mime || MIME[e] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': disposition(opts.download ? 'attachment' : 'inline', opts.name),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "script-src 'none'; sandbox",
    'Cache-Control': opts.download ? 'private, no-store' : opts.cache ||
      (opts.version === version ? 'private, max-age=31536000, immutable' : 'private, no-cache'),
    ETag: `"${version}"`,
  };
  if (!opts.download && c.req.header('if-none-match') === headers.ETag && !c.req.header('range')) {
    return new Response(null, { status: 304, headers });
  }
  const range = parseRange(c.req.header('range'), st.size);
  if (range === 'bad') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${st.size}` } });
  // Bun.file bodies go out with sendfile(2) and a real Content-Length, so
  // browsers show progress / time left and resume with Range requests
  // (a ReadableStream body would be sent chunked, without a length).
  const file = Bun.file(cp);
  if (range) {
    return new Response(file.slice(range.start, range.end + 1) as unknown as BodyInit, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`, 'Content-Length': String(range.end - range.start + 1) },
    });
  }
  return new Response(file as unknown as BodyInit, { headers: { ...headers, 'Content-Length': String(st.size) } });
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
    if (!(await resolveInRoots(p))) continue;
    if (!it) it = (await statItem(p, 'other')) || undefined;
    if (!it) continue;
    out.push({ i, p, n: it.n, e: it.e, k: it.k, s: it.s, it });
  }
  return out;
}

async function canonicalSharePaths(paths: string[]): Promise<string[]> {
  const roots = [...state.roots, state.uploadRoot];
  const mapper = { toContainer: hostToContainer, toHost: containerToHost };
  const realRoots = await canonicalRoots(roots, mapper);
  const resolved = await Promise.all(paths.map(p => canonicalLibraryFile(p, roots, realRoots, mapper)));
  if (resolved.some(p => !p)) throw new Error('Uno de los archivos ya no existe o está fuera de la Biblioteca');
  return [...new Set(resolved as string[])];
}

async function shareSummary(c: Context, s: Share) {
  const files = (await shareFiles(s)).map(f => f.it!).filter(Boolean);
  const preparing = files.filter((it) => {
    const tc = transcodes.get(it.tk);
    return tc && (tc.state === 'queued' || tc.state === 'running');
  }).length;
  return {
    id: s.id,
    title: s.title,
    url: shareUrl(c, s),
    created: s.created,
    expires: s.expires,
    alive: shareAlive(s),
    allowDownload: s.allowDownload,
    hasPassword: !!s.pass,
    msg: s.msg || '',
    cdn: s.cdn !== false && !s.pass,
    views: s.views,
    downloads: s.downloads,
    lastAccess: s.lastAccess,
    notifyActivity: s.notifyActivity !== false,
    visitors: s.visitors?.length || 0,
    visitorsCapped: (s.visitors?.length || 0) >= 2000,
    recentActivity: (s.activity || []).slice(-100).reverse(),
    files: files.map(it => ({name:it.n, path:it.p, kind:it.k, size:it.s})),
    count: s.paths.length,
    size: files.reduce((a, f) => a + f.s, 0),
    ids: files.map((f) => f.id),
    missing: s.paths.length - files.length,
    preparing,
  };
}

// Prepare what a visitor needs: thumbnails, light views and streaming copies.
function prepareShare(list: Item[]): void {
  for (const it of list) {
    ensureThumb(it, true);
    if (heavyVideo(it)) ensureWeb(it);
    else if (bigImage(it) || viewKind(it)) ensureView(it).catch(() => {});
  }
}

// Edge caching (Cloudflare) for public links: previews and files are cached
// at the edge only while the link is alive, never for password links.
function edgeCache(s: Share, browserMax: number): string {
  if (s.pass || s.cdn === false) return `private, max-age=${Math.min(browserMax, 3600)}`;
  const left = s.expires ? Math.floor((s.expires - Date.now()) / 1000) : 7 * 86400;
  const edge = Math.max(0, Math.min(7 * 86400, left));
  return edge > 120 ? `public, max-age=${Math.min(browserMax, edge)}, s-maxage=${edge}` : 'private, max-age=60';
}

async function purgeShare(c: Context, s: Share, hadEdgeCopies?: boolean): Promise<{success:boolean;error?:string}> {
  // Skip only when the share could never have had public edge copies —
  // evaluated by callers on the PREVIOUS state (turning CDN off must purge).
  if (!(hadEdgeCopies ?? !(s.cdn === false && !s.pass))) return { success: true };
  const host = shareBase(c).replace(/^https?:\/\//, '');
  const r = await purgeCachePrefixes([`${host}/s/${s.id}/`]).catch((e) => ({ success: false, error: String(e) }));
  if (!r.success) console.warn('[library] purge', s.id, r.error);
  return r;
}

// Forwarded headers are only trustworthy when the immediate peer is the
// loopback reverse proxy — direct clients can spoof them freely.
function loopbackPeer(c: Context): boolean {
  try {
    const a = getConnInfo(c).remote.address;
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  } catch { return false; }
}

function requestIp(c: Context): string {
  const fwd = loopbackPeer(c)
    ? c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    : undefined;
  if (fwd) return fwd;
  try { return getConnInfo(c).remote.address || 'local'; } catch { return 'local'; }
}

function shareActivity(c: Context, s: Share, kind: ShareActivity['kind'], name?: string) {
  const ip = requestIp(c);
  const agent = c.req.header('user-agent') || '';
  const visitor = createHmac('sha256', SECRET).update(s.id + ':' + ip + ':' + agent).digest('hex').slice(0, 12);
  const client = /Firefox/i.test(agent) ? 'Firefox' : /Edg/i.test(agent) ? 'Edge' : /Chrome/i.test(agent) ? 'Chrome' : /Safari/i.test(agent) ? 'Safari' : 'Otro cliente';
  if (!trackShare(s, { t:Date.now(), kind, visitor, client, ...(name ? {name} : {}) })) return;
  // Share counters don't feed the admin index ETag — don't bump rev per view.
  saveState(false);
  if (s.notifyActivity === false) return;
  const action = {view:'Visita',play:'Reproducción iniciada',download:'Descarga iniciada',zip:'Descarga ZIP iniciada'}[kind];
  const title = action + ': ' + s.title;
  recordEvent('file',title,name || client,{section:'library',params:{type:'shares'}});
  void notify(title,name || client);
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
:root{--bg:#070b10;--panel:#0d141d;--el:#131c28;--el2:#1a2533;--bd:rgba(120,150,180,.18);--tx:#e6f3fb;--dim:#8ea2b5;--ac:#19dbef;--acx:#032027;--ok:#4ade80}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
a{color:inherit}button{font:inherit;color:inherit}
.wrap{max-width:1280px;margin:0 auto;padding:16px 18px 110px}.wrap.has-video{padding-bottom:24px}
header.top{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:4px 0 16px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:9px;font-weight:600;letter-spacing:.02em;color:var(--dim);font-size:13px;text-decoration:none}
.brand img{width:22px;height:22px}
.pill{font-size:12px;color:var(--dim);border:1px solid var(--bd);border-radius:99px;padding:4px 10px;background:var(--panel)}
h1{font-size:clamp(21px,3vw,30px);margin:0 0 4px;font-weight:680;word-break:break-word;letter-spacing:-.01em}
.sub{color:var(--dim);font-size:14px;margin:0}
.msg{margin:12px 0 0;padding:12px 14px;border-left:3px solid var(--ac);background:var(--panel);border-radius:0 10px 10px 0;white-space:pre-wrap;font-size:14px;max-width:760px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--ac);color:var(--acx);border:0;border-radius:11px;padding:11px 18px;font-weight:650;text-decoration:none;cursor:pointer;white-space:nowrap;min-height:44px}
.btn:hover{filter:brightness(1.08)}.btn.ghost{background:var(--el);color:var(--tx);border:1px solid var(--bd)}
.btn svg,.ib svg{width:18px;height:18px;flex-shrink:0}
.head{display:flex;gap:16px;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;margin-bottom:16px}
.acts{display:flex;gap:8px;flex-wrap:wrap}
.bar{display:flex;align-items:center;gap:8px;margin:0 0 12px;color:var(--dim);font-size:13px;flex-wrap:wrap}
.bar .sp{flex:1}
.seg{display:inline-flex;border:1px solid var(--bd);border-radius:9px;overflow:hidden}
.seg button{background:var(--el);border:0;padding:7px 10px;cursor:pointer;color:var(--dim);display:grid;place-items:center}
.seg button.on{background:var(--el2);color:var(--tx)}
.seg svg{width:16px;height:16px}
.ib{background:var(--el);border:1px solid var(--bd);border-radius:9px;padding:7px 11px;cursor:pointer;font-size:13px;text-decoration:none;display:inline-flex;gap:6px;align-items:center;min-height:36px;white-space:nowrap}
.ib:hover{background:var(--el2)}
.stage{background:#000;border:1px solid var(--bd);border-radius:16px;overflow:hidden;display:grid;place-items:center;min-height:220px;max-height:78vh;position:relative}
.stage img,.stage video{max-width:100%;max-height:78vh;display:block}
.stage video{width:100%;background:#000;object-fit:contain}.stage.is-video{min-height:0;max-height:none;margin:0 auto}.stage.is-video video{width:100%;height:100%;max-height:100%;object-fit:contain}.stage iframe{width:100%;height:78vh;border:0;background:#fff}
.stage audio{width:min(560px,92%);margin:20px auto}
.stage .zoomable{cursor:zoom-in}
.ficon{display:grid;place-items:center;gap:10px;padding:60px 20px;color:var(--dim);text-align:center}
.ficon b{font-size:42px;color:var(--ac);font-weight:700;letter-spacing:.04em}
.note{color:var(--dim);font-size:13px;margin-top:10px;min-height:1em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.tile{position:relative;border-radius:13px;overflow:hidden;background:var(--el);border:1px solid var(--bd);cursor:pointer;display:flex;flex-direction:column;user-select:none;-webkit-user-select:none}
.tile .th{aspect-ratio:1;display:grid;place-items:center;overflow:hidden;background:var(--panel)}
.tile img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s;background:var(--el)}
@media(hover:hover){.tile:hover img{transform:scale(1.04)}}
.tile .ext{font-weight:700;color:var(--ac);font-size:20px;letter-spacing:.05em}
.tile .cap{padding:7px 9px 8px;font-size:12.5px;line-height:1.3;display:flex;flex-direction:column;min-width:0}
.tile .cap b{font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .cap small{color:var(--dim);font-size:11.5px}
.tile .badge{position:absolute;top:8px;left:8px;background:rgba(0,0,0,.66);color:#fff;border-radius:6px;padding:2px 7px;font-size:11px;font-weight:650;display:flex;gap:4px;align-items:center}
.tile .ck{position:absolute;top:8px;right:8px;width:26px;height:26px;border-radius:99px;background:rgba(0,0,0,.45);box-shadow:inset 0 0 0 2px rgba(255,255,255,.9);display:none;place-items:center;color:var(--acx)}
.tile .ck svg{width:15px;height:15px;opacity:0}
.selecting .tile .ck{display:grid}
.tile.sel{outline:3px solid var(--ac);outline-offset:-3px}.tile.sel .ck{background:var(--ac);box-shadow:none}.tile.sel .ck svg{opacity:1}
.list{display:flex;flex-direction:column;gap:6px}
.row{display:flex;align-items:center;gap:12px;padding:8px;border-radius:12px;background:var(--el);border:1px solid var(--bd);cursor:pointer}
.row .rt{width:52px;height:52px;border-radius:9px;overflow:hidden;flex-shrink:0;display:grid;place-items:center;background:var(--panel);color:var(--ac);font-weight:700;font-size:12px}
.row .rt img{width:100%;height:100%;object-fit:cover}
.row .rm{flex:1;min-width:0}.row .rm b{display:block;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row .rm small{color:var(--dim);font-size:12px}
.row.sel{outline:2px solid var(--ac);outline-offset:-2px}
.selbar{position:fixed;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translate(-50%,140%);transition:transform .2s;z-index:5;display:flex;gap:8px;align-items:center;background:var(--el2);border:1px solid var(--bd);border-radius:16px;padding:8px 8px 8px 16px;box-shadow:0 14px 40px rgba(0,0,0,.5);max-width:calc(100% - 20px)}
.selbar.on{transform:translate(-50%,0)}.selbar span{font-size:14px;white-space:nowrap}
.lb{position:fixed;inset:0;background:#030609;display:none;flex-direction:column;z-index:10}
.lb.on{display:flex;height:100dvh}.lb-bar{flex-shrink:0;display:flex;align-items:center;gap:8px;padding:10px 12px;padding-top:max(10px,env(safe-area-inset-top));color:var(--dim);font-size:14px}
.lb-bar .nm{flex:1;min-width:0;display:flex;flex-direction:column}.lb-bar .nm b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--tx);font-weight:600}.lb-bar .nm small{font-size:12px}
.lb-body{flex:1 1 0;min-height:0;min-width:0;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;padding:16px}
.lb-body>img,.lb-body .zw img{max-width:100%;max-height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none}
.zw{width:100%;display:grid;place-items:center;transform-origin:0 0;will-change:transform}.lb-body .zw{height:100%;touch-action:none}
.lb-body .ph{position:absolute;inset:0;margin:auto;filter:blur(10px);opacity:.55}
.lb-body video{max-width:100%;max-height:100%;object-fit:contain;display:block;flex-shrink:1}.lb-body iframe{width:100%;height:100%;border:0;background:#fff}
.lb-body audio{width:min(560px,92%)}
.stage.is-audio{min-height:0;background:var(--panel);padding:12px}
.lb.is-audio.on{inset:auto 12px max(12px,env(safe-area-inset-bottom));height:auto;max-height:35vh;border:1px solid var(--bd);border-radius:12px;background:var(--panel)}
.lb.is-audio .lb-body{padding:8px 64px 14px}.lb.is-audio audio{width:100%;height:40px}
.lb.is-audio .nav{display:grid;top:auto;bottom:14px;transform:none;width:36px;height:36px}.nav:disabled{opacity:.35;cursor:default}
.playback-note{position:absolute;bottom:12px;left:12px;right:12px;padding:8px;background:var(--panel);border-radius:8px;text-align:center}.playback-note:empty{display:none}

.nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(20,28,40,.72);border:1px solid var(--bd);width:48px;height:48px;border-radius:99px;cursor:pointer;font-size:24px;display:grid;place-items:center;z-index:2}
.nav.prev{left:12px}.nav.next{right:12px}
.spin{width:28px;height:28px;border:3px solid rgba(255,255,255,.15);border-top-color:var(--ac);border-radius:50%;animation:sp 1s linear infinite;position:absolute}
@keyframes sp{to{transform:rotate(360deg)}}
.center{min-height:80vh;display:grid;place-items:center;text-align:center;padding:20px}
.card{background:var(--panel);border:1px solid var(--bd);border-radius:18px;padding:28px;width:min(400px,100%)}
input[type=password]{width:100%;background:var(--bg);border:1px solid var(--bd);color:var(--tx);border-radius:10px;padding:13px;font:inherit;margin:14px 0;font-size:16px}
.err{color:#f87171;font-size:13px}footer{color:var(--dim);font-size:12px;text-align:center;margin-top:28px;opacity:.75}
.hide{display:none!important}
@media(max-width:640px){
 .wrap{padding:12px 10px 110px}.grid{grid-template-columns:repeat(3,1fr);gap:4px}.tile{border-radius:8px;border:0}.tile .cap{display:none}
 .tile .badge{top:5px;left:5px;font-size:10px;padding:1px 5px}.tile .ck{top:5px;right:5px;width:24px;height:24px}
 .nav{display:none}.head .acts{width:100%}.head .acts .btn{flex:1}.lb-bar .ib span{display:none}
 .stage{border-radius:12px;max-height:70vh}.stage img{max-height:70vh}.stage.is-video{max-height:none}.lb-body{padding:8px}
}
`;

const SVG = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const DL_SVG = SVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>');
const ICONS = {
  dl: DL_SVG,
  check: SVG('<polyline points="20 6 9 17 4 12"/>'),
  grid: SVG('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'),
  list: SVG('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
  sel: SVG('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  x: SVG('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  play: SVG('<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>'),
  save: SVG('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>'),
  zoom: SVG('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>'),
};

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
${error ? `<p class="err">${esc(error)}</p>` : ''}<button class="btn" style="width:100%">Ver contenido</button></form></div>`), error ? 401 : 200);
}

function fileDesc(f: ShareFile): string {
  const it = f.it;
  const parts = [KIND_LABEL[f.k], fmtSize(f.s)];
  if (it?.d) parts.push(`${Math.floor(it.d / 60)}:${String(Math.round(it.d % 60)).padStart(2, '0')}`);
  if (it?.w && it?.h) parts.push(`${it.w}×${it.h}`);
  return parts.join(' · ');
}

// Name segment for file URLs — gives the CDN an extension to key caching on
// and download managers a sensible filename.
const urlName = (n: string) => encodeURIComponent(n.replace(/[/\\?#%]/g, '_'));

function sharePage(c: Context, s: Share, files: ShareFile[]): Response {
  const base = `/s/${s.id}`;
  const abs = shareUrl(c, s);
  const data = files.map((f) => {
    const it = f.it;
    const dur = it?.d ? `${Math.floor(it.d / 60)}:${String(Math.round(it.d % 60)).padStart(2, '0')}` : '';
    return {
      i: f.i,
      n: f.n,
      u: urlName(f.n),
      e: f.e,
      k: f.k,
      s: f.s,
      sz: fmtSize(f.s),
      desc: fileDesc(f),
      dur,
      width:it?.w || 0, height:it?.h || 0,
      v: it?.tk || '',
      th: it ? thumbState(it) !== -1 : false,
      vw: it ? hasView(it) : false,
      w: it ? webSet.has(it.tk) : false,
      nw: it ? needsWeb(it) && !webSet.has(it.tk) : false,
      tr: it ? hasTranscript(it.tk) : false,
    };
  });
  const total = files.reduce((a, f) => a + f.s, 0);
  const expTxt = s.expires ? `Disponible hasta el ${fmtDate(s.expires)}` : 'Link sin vencimiento';
  const summary = files.length === 1 ? fileDesc(files[0]) : `${files.length} archivos · ${fmtSize(total)}`;
  const first = data.find((d) => d.th);
  const og = !s.pass && first
    ? `<meta property="og:image" content="${esc(`${abs}/t/${first.i}.jpg?v=${first.v}`)}"><meta name="twitter:card" content="summary_large_image">`
    : '';
  const head = `<meta property="og:title" content="${esc(s.title)}"><meta property="og:description" content="${esc(summary + ' · ' + expTxt)}">
<meta property="og:type" content="website"><meta property="og:url" content="${esc(abs)}">${og}`;
  const single = files.length === 1;
  const dlAll = s.allowDownload && files.length
    ? single
      ? `<a class="btn" href="${base}/f/${files[0].i}/${urlName(files[0].n)}?dl=1">${DL_SVG} Descargar · ${fmtSize(files[0].s)}</a>`
      : `<a class="btn" href="${base}/zip">${DL_SVG} Descargar todo · ${fmtSize(total)}</a>`
    : '';
  const saveBtn = single && s.allowDownload && ['image', 'video'].includes(files[0].k) && files[0].s < 250e6
    ? `<button class="btn ghost hide" id="save1">${ICONS.save} Guardar en el teléfono</button>` : '';
  const multiBar = !single && files.length
    ? `<div class="bar"><span>${files.length} archivos</span><span class="sp"></span>
${s.allowDownload ? `<button class="ib" id="selt">${ICONS.sel}<span>Seleccionar</span></button>` : ''}
<div class="seg"><button id="vg" title="Cuadrícula">${ICONS.grid}</button><button id="vl" title="Lista">${ICONS.list}</button></div></div>` : '';
  const body = `<div class="wrap">
<header class="top"><span class="brand"><img src="/marca/favicon.svg" alt="">Compartido con Axon</span><span class="pill" id="exp">${esc(expTxt)}</span></header>
<div class="head"><div><h1>${esc(s.title)}</h1><p class="sub">${esc(summary)}</p>${s.msg ? `<p class="msg">${esc(s.msg)}</p>` : ''}</div><div class="acts">${saveBtn}${dlAll}</div></div>
${multiBar}
${files.length === 0 ? '<p class="sub">Los archivos de este link ya no están disponibles.</p>' : single ? '<div class="stage" id="single"></div><p class="note" id="snote"></p>' : '<div id="items"></div>'}
<footer>${esc(expTxt)}${s.allowDownload ? '' : ' · Solo visualización'}</footer></div>
<div class="selbar" id="selbar"><span id="seln"></span><button class="ib" id="selall">Todo</button><a class="btn" id="seldl" href="${base}/zip">${DL_SVG} Descargar</a><button class="ib" id="selx" title="Cancelar">${ICONS.x}</button></div>
<div class="lb" id="lb"><div class="lb-bar"><div class="nm"><b id="lbn"></b><small id="lbc"></small></div><span id="lbd"></span><button class="ib" id="lbx" title="Cerrar">${ICONS.x}</button></div>
<div class="lb-body" id="lbb"></div><button class="nav prev" id="lbp">‹</button><button class="nav next" id="lbnx">›</button></div>
<script>
(function(){
var B=${JSON.stringify(base)},F=${JSON.stringify(data).replace(/</g, '\\u003c')},DL=${s.allowDownload ? 1 : 0},EXP=${s.expires || 0};
var IC=${JSON.stringify(ICONS).replace(/</g, '\\u003c')};
function $(id){return document.getElementById(id)}
function h(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function fmt(b){if(b<1024)return b+' B';var u=['KB','MB','GB','TB'],v=b,i=-1;do{v/=1024;i++}while(v>=1024&&i<3);return (v<10?v.toFixed(1):Math.round(v))+' '+u[i]}
function orig(f){return B+'/f/'+f.i+'/'+f.u}
function thumb(f){return f.k==='vector'&&f.e==='svg'?orig(f):B+'/t/'+f.i+'.jpg?v='+f.v}
function view(f){return f.vw?B+'/v/'+f.i+'.jpg?v='+f.v:orig(f)}
function isImg(f){return f.k==='image'||f.k==='raw'||f.k==='vector'||(f.k==='design'&&f.vw)}
function media(f){
  var k=f.k;
  if(isImg(f))return '<div class="zw"><img class="main" src="'+view(f)+'" alt="'+h(f.n)+'" draggable="false"></div>';
  if(k==='video'){var u=f.w?B+'/w/'+f.i+'.mp4?v='+f.v:orig(f);return '<video controls playsinline autoplay preload="metadata" crossorigin="anonymous" '+(f.th?'poster="'+thumb(f)+'" ':'')+(DL?'':'controlslist="nodownload" ')+'src="'+u+'">'+(f.tr?'<track kind="subtitles" label="Subtítulos" src="'+B+'/c/'+f.i+'.vtt?v='+f.v+'" default>':'')+'</video>'}
  if(k==='audio')return '<audio controls autoplay preload="metadata" aria-label="'+h(f.n)+'" src="'+orig(f)+'"></audio>';
  if(k==='pdf'||f.e==='txt'||f.e==='md'||f.e==='csv')return '<iframe src="'+orig(f)+'"></iframe>';
  return '<div class="ficon"><b>'+h((f.e||'file').toUpperCase())+'</b><span>'+h(f.n)+'</span><span>'+h(f.desc)+'</span>'+(DL?'<a class="btn" href="'+orig(f)+'?dl=1">'+IC.dl+' Descargar</a>':'')+'</div>';
}
function fitVideo(root,f){
  var v=root.querySelector('video');if(!v)return;
  if(root._axonVideo===v&&root._axonVideoFit){root._axonVideoFit();return;}
  var inline=root.id==='single';if(inline){root.classList.add('is-video');root.parentElement.classList.add('has-video');}
  function fit(){
    if(!inline&&!root.closest('.lb.on'))return;
    var viewport=window.visualViewport?window.visualViewport.height:window.innerHeight;
    var ratio=v.videoWidth&&v.videoHeight?v.videoWidth/v.videoHeight:(f.width&&f.height?f.width/f.height:16/9);
    var maxW,maxH;
    if(inline){var wrap=root.parentElement,style=getComputedStyle(wrap);maxW=wrap.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);maxH=Math.max(120,Math.min(680,viewport-root.getBoundingClientRect().top-128));}
    else{var style=getComputedStyle(root);maxW=root.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);maxH=root.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);}
    if(maxW<=0||maxH<=0)return;
    var w=Math.min(maxW,maxH*ratio),h=w/ratio;
    v.style.width=w+'px';v.style.height=h+'px';
    if(inline){root.style.width=(w+2)+'px';root.style.height=(h+2)+'px';}
  }
  root._axonVideo=v;root._axonVideoFit=fit;
  v.addEventListener('loadedmetadata',fit);requestAnimationFrame(fit);
}
window.addEventListener('resize',function(){var v=$('single');if(v)fitVideo(v,F[0]);if($('lb').classList.contains('on'))fitVideo($('lbb'),F[cur]);});
if(window.visualViewport)window.visualViewport.addEventListener('resize',function(){window.dispatchEvent(new Event('resize'))});
function stopMedia(root){[].forEach.call(root.querySelectorAll('audio,video'),function(v){v.pause();v.removeAttribute('src');v.load()})}
function hookVideo(root,noteEl,f){
  var audio=root.querySelector('audio');
  if(audio){if(root.id==='single')root.classList.add('is-audio');audio.addEventListener('ended',function(){if(audio.isConnected&&root.id!=='single')stepAudio(1)});return;}
  fitVideo(root,f);
  var v=root.querySelector('video');if(!v)return;
  function active(){return v.isConnected&&root.querySelector('video')===v}
  var preparing=false;
  function note(msg){if(!active())return;var el=noteEl;if(!el){el=root.querySelector('.playback-note');if(!el){el=document.createElement('p');el.className='note playback-note';el.setAttribute('role','status');root.appendChild(el)}}el.textContent=msg;}
  function prepare(){
    if(preparing||!active())return;preparing=true;note('Preparando reproducción compatible…');
    fetch(B+'/prepare/'+f.i,{method:'POST'}).then(function(r){if(!r.ok)throw Error();return r.json()}).then(function(){if(active())waitWeb(f,function(){return active()},function(){f.w=true;f.nw=false;var t=v.currentTime||0;v.addEventListener('loadedmetadata',function(){v.currentTime=t;v.play().catch(function(){})},{once:true});v.src=B+'/w/'+f.i+'.mp4?v='+f.v;v.load();note('')},note)}).catch(function(){note('No se pudo preparar este video. Recargá para reintentar.');});
  }
  v.addEventListener('play',function(){fetch(B+'/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({i:f.i}),keepalive:true}).catch(function(){})},{once:true});
  v.addEventListener('error',function(){if(!active())return;if(!f.w&&v.error&&(v.error.code===3||v.error.code===4))prepare();else note('No se pudo reproducir el video.'+(DL?' Podés descargar el original.':''));});
}
function waitWeb(f,active,cb,note){if(!active())return;setTimeout(function(){if(!active())return;fetch(B+'/st',{cache:'no-store'}).then(function(r){if(!r.ok)throw Error();return r.json()}).then(function(d){if(!active())return;var x=d.files&&d.files[f.i];if(x&&x.w)cb();else if(!x||x.state==='error'||x.state==='none')note('No se pudo preparar este video. Recargá para reintentar.');else {note('Preparando reproducción compatible… '+(x.state==='queued'?'en cola':(x.pct||0)+'%'));waitWeb(f,active,cb,note)}}).catch(function(){note('Se interrumpió la preparación. Recargá para reintentar.')})},1500)}
// Pinch / double-tap / wheel zoom; zooming in swaps the light view for the original.
function zoomer(wrap,f,inline){
  var img=wrap.querySelector('img'),s=1,x=0,y=0,pts={},pinch=null,pan=null,lastTap=0,full=false;
  if(inline)wrap.style.touchAction='pan-y';
  function apply(){wrap.style.transform='translate('+x+'px,'+y+'px) scale('+s+')';wrap.parentNode.style.cursor=s>1?'grab':'';if(inline)wrap.style.touchAction=s>1?'none':'pan-y'}
  function setZoom(ns,cx,cy){var r=wrap.parentNode.getBoundingClientRect();cx-=r.left;cy-=r.top;ns=Math.max(1,Math.min(8,ns));x=cx-(cx-x)*(ns/s);y=cy-(cy-y)*(ns/s);s=ns;if(s===1){x=0;y=0}apply();if(s>1.3&&f.vw&&!full){full=true;var o=new Image();o.onload=function(){img.src=o.src};o.src=orig(f)}}
  wrap.parentNode.addEventListener('wheel',function(e){if(inline&&s===1&&!e.ctrlKey)return;e.preventDefault();setZoom(s*(e.deltaY<0?1.2:1/1.2),e.clientX,e.clientY)},{passive:false});
  wrap.addEventListener('dblclick',function(e){setZoom(s>1?1:2.5,e.clientX,e.clientY)});
  wrap.addEventListener('pointerdown',function(e){pts[e.pointerId]={x:e.clientX,y:e.clientY};var k=Object.keys(pts);if(k.length===2){var a=pts[k[0]],b=pts[k[1]];pinch={d:Math.hypot(a.x-b.x,a.y-b.y),s:s}}else if(s>1){pan={x:e.clientX-x,y:e.clientY-y}}
    var now=Date.now();if(e.pointerType==='touch'&&k.length===1){if(now-lastTap<300){setZoom(s>1?1:2.5,e.clientX,e.clientY);lastTap=0}else lastTap=now}});
  wrap.addEventListener('pointermove',function(e){if(!pts[e.pointerId])return;pts[e.pointerId]={x:e.clientX,y:e.clientY};var k=Object.keys(pts);
    if(pinch&&k.length===2){var a=pts[k[0]],b=pts[k[1]];setZoom(pinch.s*Math.hypot(a.x-b.x,a.y-b.y)/pinch.d,(a.x+b.x)/2,(a.y+b.y)/2)}
    else if(pan){x=e.clientX-pan.x;y=e.clientY-pan.y;apply()}});
  function up(e){delete pts[e.pointerId];if(Object.keys(pts).length<2)pinch=null;if(!Object.keys(pts).length)pan=null}
  wrap.addEventListener('pointerup',up);wrap.addEventListener('pointercancel',up);
  return {zoomed:function(){return s>1}};
}
if(EXP){var el=$('exp'),d=EXP-Date.now();if(d>0){var hrs=d/36e5;el.textContent=hrs<1?'Vence en '+Math.max(1,Math.round(d/6e4))+' min':hrs<48?'Vence en '+Math.round(hrs)+' h':'Vence en '+Math.round(hrs/24)+' días';el.title=${JSON.stringify(expTxt)}}}
// Save to the phone's gallery through the share sheet (iOS / Android).
function saveFile(f,btn){var t=btn.innerHTML;btn.textContent='Preparando…';fetch(orig(f)).then(function(r){return r.blob()}).then(function(b){var file=new File([b],f.n,{type:b.type});return navigator.share({files:[file]})}).catch(function(){}).then(function(){btn.innerHTML=t})}
function canSave(f){try{return DL&&navigator.canShare&&/Mobi|Android|iPhone|iPad/.test(navigator.userAgent)&&navigator.canShare({files:[new File([''],f.n,{type:f.k==='video'?'video/mp4':'image/jpeg'})]})&&f.s<250e6}catch(e){return false}}
var single=$('single');
if(single){var f0=F[0];single.innerHTML=media(f0);var zw=single.querySelector('.zw');if(zw)zoomer(zw,f0,true);
  hookVideo(single,$('snote'),f0);if(f0.k==='pdf')$('snote').innerHTML='¿No se ve? <a href="'+orig(f0)+'" target="_blank" rel="noopener noreferrer">Abrir el PDF</a>';
  if(f0.vw&&isImg(f0))$('snote').textContent='Doble toque (o Ctrl + rueda) para hacer zoom en la resolución original.';
  var sb=$('save1');if(sb&&canSave(f0)){sb.classList.remove('hide');sb.onclick=function(){saveFile(f0,sb)}}
  return}
var box=$('items');if(!box)return;
var layout='grid';try{layout=localStorage.getItem('axs-layout')||(F.filter(function(f){return f.th}).length<F.length/2?'list':'grid')}catch(e){}
var sel={},selecting=false;
function selSize(){var n=0,b=0;for(var k in sel){n++;b+=F[k].s}return [n,b]}
function syncSel(){var r=selSize();$('selbar').classList.toggle('on',selecting);$('seln').textContent=r[0]?r[0]+' · '+fmt(r[1]):'Tocá para elegir';
  $('seldl').style.opacity=r[0]?1:.5;var ix=Object.keys(sel).map(function(k){return F[k].i});
  $('seldl').href=r[0]===1?orig(F[Object.keys(sel)[0]])+'?dl=1':B+'/zip?i='+ix.join(',');
  box.classList.toggle('selecting',selecting);[].forEach.call(box.querySelectorAll('[data-ix]'),function(t){t.classList.toggle('sel',!!sel[t.dataset.ix])})}
function draw(){
  if(layout==='list'){box.className='list';box.innerHTML=F.map(function(f,ix){return '<div class="row" data-ix="'+ix+'"><span class="rt">'+(f.th?'<img loading="lazy" src="'+thumb(f)+'" alt="">':h((f.e||'?').toUpperCase()))+'</span><span class="rm"><b>'+h(f.n)+'</b><small>'+h(f.desc)+'</small></span>'+(DL?'<a class="ib" href="'+orig(f)+'?dl=1" data-dl="1" title="Descargar">'+IC.dl+'</a>':'')+'</div>'}).join('')}
  else{box.className='grid';box.innerHTML=F.map(function(f,ix){return '<div class="tile" data-ix="'+ix+'"><div class="th">'+(f.th?'<img loading="'+(ix<12?'eager':'lazy')+'" decoding="async" src="'+thumb(f)+'" alt="">':'<span class="ext">'+h((f.e||'?').toUpperCase())+'</span>')+'</div>'+(f.k==='video'?'<span class="badge">'+IC.play+(f.dur||'')+'</span>':'')+'<span class="ck">'+IC.check+'</span><span class="cap"><b>'+h(f.n)+'</b><small>'+h(f.sz)+'</small></span></div>'}).join('')}
  if($('vg')){$('vg').classList.toggle('on',layout==='grid');$('vl').classList.toggle('on',layout==='list')}
  syncSel();
}
draw();
if($('vg')){$('vg').onclick=function(){layout='grid';try{localStorage.setItem('axs-layout',layout)}catch(e){}draw()};$('vl').onclick=function(){layout='list';try{localStorage.setItem('axs-layout',layout)}catch(e){}draw()}}
if($('selt'))$('selt').onclick=function(){selecting=!selecting;if(!selecting)sel={};syncSel()};
$('selx').onclick=function(){selecting=false;sel={};syncSel()};
$('selall').onclick=function(){var all=Object.keys(sel).length===F.length;sel={};if(!all)F.forEach(function(f,ix){sel[ix]=1});syncSel()};
$('seldl').addEventListener('click',function(e){if(!Object.keys(sel).length)e.preventDefault()});
// Long-press starts selecting (mobile).
var lpT=null,lpFired=false;
box.addEventListener('pointerdown',function(e){var t=e.target.closest('[data-ix]');if(!t||!DL)return;lpFired=false;lpT=setTimeout(function(){lpFired=true;selecting=true;sel[t.dataset.ix]=1;syncSel();if(navigator.vibrate)navigator.vibrate(15)},480)});
['pointerup','pointercancel','pointerleave','scroll'].forEach(function(ev){box.addEventListener(ev,function(){clearTimeout(lpT)},{passive:true})});
box.addEventListener('contextmenu',function(e){if(e.target.closest('[data-ix]')&&DL)e.preventDefault()});
box.addEventListener('click',function(e){if(e.target.closest('[data-dl]'))return;var t=e.target.closest('[data-ix]');if(!t)return;if(lpFired){lpFired=false;return}
  var ix=t.dataset.ix;if(selecting){if(sel[ix])delete sel[ix];else sel[ix]=1;syncSel();return}show(+ix)});
var lb=$('lb'),lbb=$('lbb'),cur=0,zm=null;
function preload(ix){var f=F[(ix+F.length)%F.length];if(f&&isImg(f)){var i=new Image();i.src=view(f)}}
function stepAudio(d){var q=F.map(function(f,i){return f.k==='audio'?i:-1}).filter(function(i){return i>=0}),p=q.indexOf(cur)+d;if(p>=0&&p<q.length)show(q[p])}
function step(d){if(F[cur].k==='audio')stepAudio(d);else show(cur+d)}
function show(ix){stopMedia(lbb);cur=(ix+F.length)%F.length;var f=F[cur];
  lb.classList.toggle('is-audio',f.k==='audio');
  var q=F.map(function(f,i){return f.k==='audio'?i:-1}).filter(function(i){return i>=0}),p=q.indexOf(cur);
  $('lbp').disabled=f.k==='audio'&&p===0;$('lbnx').disabled=f.k==='audio'&&p===q.length-1;
  $('lbp').setAttribute('aria-label','Anterior');$('lbnx').setAttribute('aria-label','Siguiente');

  lbb.innerHTML=(isImg(f)&&f.th?'<img class="ph" src="'+thumb(f)+'" alt="">':'')+(isImg(f)?'<span class="spin"></span>':'')+media(f);zm=null;
  var main=lbb.querySelector('img.main');if(main){var done=function(){var p=lbb.querySelector('.ph'),sp=lbb.querySelector('.spin');if(p)p.remove();if(sp)sp.remove()};if(main.complete)done();else{main.onload=done;main.onerror=done}zm=zoomer(lbb.querySelector('.zw'),f)}
  hookVideo(lbb,null,f);
  $('lbn').textContent=f.n;$('lbc').textContent=(cur+1)+' / '+F.length+' · '+f.desc;
  var acts='';if(f.vw&&isImg(f))acts+='<a class="ib" href="'+orig(f)+'" target="_blank" rel="noopener noreferrer" title="Original">'+IC.zoom+'<span>Original</span></a> ';
  if(DL){if(canSave(f))acts+='<button class="ib" id="lbs">'+IC.save+'<span>Guardar</span></button> ';acts+='<a class="ib" href="'+orig(f)+'?dl=1">'+IC.dl+'<span>Descargar</span></a>'}
  $('lbd').innerHTML=acts;var sb=$('lbs');if(sb)sb.onclick=function(){saveFile(f,sb)};
  lb.classList.add('on');document.body.style.overflow=f.k==='audio'?'':'hidden';preload(cur+1);preload(cur-1);
  if(history.state!=='lb')history.pushState('lb','')}
function close(back){stopMedia(lbb);lb.classList.remove('on');lbb.innerHTML='';document.body.style.overflow='';if(back!==false&&history.state==='lb')history.back()}
window.addEventListener('popstate',function(){if(lb.classList.contains('on'))close(false)});
$('lbx').onclick=function(){close()};$('lbp').onclick=function(){step(-1)};$('lbnx').onclick=function(){step(1)};
document.addEventListener('keydown',function(e){if(!lb.classList.contains('on'))return;if(e.key==='Escape')close();if(e.target.closest('audio,video,input,textarea'))return;if(e.key==='ArrowLeft'){e.preventDefault();step(-1)}if(e.key==='ArrowRight'){e.preventDefault();step(1)}});
var sx=null,sy=null;lbb.addEventListener('touchstart',function(e){if(e.target.closest('audio,video,button,input')||lb.classList.contains('is-audio')||e.touches.length!==1||(zm&&zm.zoomed())){sx=null;return}sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true});
lbb.addEventListener('touchend',function(e){if(sx===null)return;var dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy))show(cur+(dx<0?1:-1));else if(dy>120&&Math.abs(dy)>Math.abs(dx))close();sx=null});
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
  // Compare against the connection's Host; X-Forwarded-Host counts only when
  // the peer is the loopback proxy — a client-supplied one must not dodge the
  // restriction (or trigger it) on the wrong hostname.
  const host = (c.req.header('host') || '').split(',')[0].trim().toLowerCase();
  const forwarded = loopbackPeer(c) ? (c.req.header('x-forwarded-host') || '').split(',')[0].trim().toLowerCase() : '';
  if (!shareHost || (host !== shareHost && forwarded !== shareHost)) return next();
  const p = c.req.path;
  if (p.startsWith('/s/') || p === '/marca/favicon.svg' || p === '/robots.txt') {
    if (p === '/robots.txt') return c.text('User-agent: *\nDisallow: /\n');
    return next();
  }
  return messagePage(c, 404, 'Link no encontrado', 'Pedile a quien te lo compartió que te pase el link completo.');
};

// ---------- Uploads (chunked, appended on the host) ----------

interface Upload { id: string; dir: string; name: string; part: string; size: number; received: number; t: number; cancelled?: boolean }
const uploads = new Map<string, Upload>();
// Per-upload promise chain: two concurrent chunks must not both pass the
// offset check and interleave appends into a corrupt part file.
const uploadLocks = new Map<string, Promise<void>>();

// A malformed AXON_PUBLIC_ORIGIN must surface as a structured error, not a
// bare TypeError from `new URL()` deep inside a route handler.
function publicOrigin(): string {
  try {
    return new URL(process.env.AXON_PUBLIC_ORIGIN || 'http://localhost').origin;
  } catch {
    throw new Error('AXON_PUBLIC_ORIGIN inválido — debe ser una URL absoluta (p. ej. https://axon.example.com)');
  }
}

async function addPathToIndex(hp: string, carry?: Partial<Item>): Promise<Item | null> {
  const inUpload = under(hp, state.uploadRoot);
  const it = await statItem(hp, inUpload ? 'other' : undefined);
  if (!it) return null;
  if (carry?.t) it.t = carry.t;
  putItem(it);
  saveIndex();
  if (['image', 'raw', 'video', 'audio'].includes(it.k)) exifBatch([it]).then(() => saveIndex()).catch(() => {});
  else it.mx = 1;
  return it;
}

// Rewrite references (favorites / collections / shares) after a move.
function repath(from: string, to: string, aliases:string[]=[from]): void {
  const swap = (arr: string[]) => arr.map(p=>movedReference(p,aliases,to));
  state.favorites = swap(state.favorites);
  for (const col of state.collections) col.paths = swap(col.paths);
  for (const s of state.shares) s.paths = swap(s.paths);
  saveState();
}

// Trash keeps favorites/collections/share paths at the original location. A restore
// reindexes that location; originals in trash must never become public shares.
export async function libraryFileOperation(action: 'send'|'restore'|'copy'|'move', from: string, to: string, review?:TransferReview): Promise<void> {
  await ensureReady();
  if(action==='move'){
    // Persist the approved visibility change together with all repathed references.
    const aliases=review?.sourceAliases||[from];
    state.roots=[...new Set([...state.roots.map(p=>movedReference(p,aliases,to)),...(review?.addRoots||[])])];
    state.uploadRoot=movedReference(state.uploadRoot,aliases,to);
    repath(from,to,aliases);
    await flushTransferState();
  }
  if (action === 'send'||action==='move') {
    for (const it of [...items.values()]) if ((review?.sourceAliases||[from]).some(root=>it.p===root||it.p.startsWith(root+'/'))) dropItem(it.id);
    saveIndex();
  }
  if(action!=='send'){
    const allowed = [...state.roots, state.uploadRoot].filter(Boolean).some(root => to === root || to.startsWith(root + '/'));
    if (allowed) { const st = await stat(hostToContainer(to)); if (st.isDirectory()) await scan(); else await addPathToIndex(to); }
  }
}

async function flushTransferState():Promise<void>{
  if(stateTimer){clearTimeout(stateTimer);stateTimer=null;}
  const snapshot=JSON.stringify(state);
  const write=stateWriteQueue.then(async()=>{
    await mkdir(LIB_DIR,{recursive:true});
    await writeFile(STATE_FILE+'.tmp',snapshot,'utf-8');
    await fsRename(STATE_FILE+'.tmp',STATE_FILE);
  });
  stateWriteQueue=write.catch(()=>{});
  await write;
}

export async function libraryTransferReview(mode:'copy'|'move',from:string,to:string):Promise<TransferReview|undefined>{
  if(mode!=='move')return;
  await ensureReady();
  const source=await stat(hostToContainer(from)).catch((e)=>{
    const code=(e as NodeJS.ErrnoException)?.code;
    throw new MaintenanceError(code==='ENOENT'||code==='ENOTDIR'?'El origen ya no existe':'No se puede acceder al origen',code==='ENOENT'||code==='ENOTDIR'?404:403);
  });
  const aliases=[from];
  // A configured root may itself be a symlink; older shares keep the resolved
  // spelling, so the resolved source is also an alias worth rewriting.
  const real=await realpath(hostToContainer(from)).then(containerToHost).catch(()=>null);
  if(real&&real!==from)aliases.push(real);
  const inventory=await hostVolumes.snapshot();
  const current=volumeForPath(inventory.volumes,from);
  if(current?.path){
    const relative=path.posix.relative(current.path,from);
    for(const volume of inventory.volumes){
      if(!volume.path||volume.path===current.path||volume.majorMinor!==current.majorMinor)continue;
      const candidate=path.posix.join(volume.path,relative);
      if(!volumeContains(candidate,volume.path))continue;
      const entry=await stat(hostToContainer(candidate)).catch(()=>null);
      // The identity check also excludes bind mounts of a different subtree.
      if(entry&&entry.dev===source.dev&&entry.ino===source.ino)aliases.push(candidate);
    }
  }
  return reviewLibraryMove(state,from,to,source.isDirectory(),[...items.values()].map(it=>it.p),aliases);
}

// Library moves apply their own reference rewrites (repath/reindex), so the
// plan→execute review round-trip happens inline: the freshly computed review
// revision acts as the confirmation digest, and execute() still re-checks it.
async function transferMove(transfers: FileTransfers, from: string, to: string, c: Context): Promise<void> {
  const actor = maintenanceActor(c);
  const plan = await transfers.plan('move', from, to, actor);
  let status = await transfers.execute(plan.id, plan.digest, actor, plan.review?.revision);
  const until = Date.now() + 25_000;
  while (['planned', 'running'].includes(status.state) && Date.now() < until) {
    await Bun.sleep(100);
    status = await transfers.status(plan.id, actor);
  }
  if (status.state !== 'verified') throw new MaintenanceError(`La operación ${status.id} sigue pendiente. Abrí el historial de transferencias.`, 409);
}

function publicItem(it: Item) {
  return {
    id: it.id, p: it.p, n: it.n, e: it.e, k: it.k, s: it.s, m: it.m, tk: it.tk,
    t: it.t, w: it.w, h: it.h, d: it.d, c: it.c,
    th: thumbState(it), wv: webSet.has(it.tk) ? 1 : 0, nw: needsWeb(it) ? 1 : 0, vw: viewKind(it) ? 1 : 0,
    bv: bigImage(it) ? 1 : 0, tr: hasTranscript(it.tk) ? 1 : 0,
  };
}

const zipTokens = new Map<string, { paths: string[]; name: string; exp: number }>();

// ---------- Duplicates ----------
// Candidates are grouped by size first; matching sizes get fingerprinted.
// Files up to 3 spans get a full sha1; bigger ones a head+middle+tail sample
// (exact=false) so a whole-library pass stays bounded. Results are cached per
// index revision — hashing hundreds of GB on every request is not an option.
interface DupeGroup { fp: string; size: number; exact: boolean; items: Item[] }
const DUPE_SPAN = 8 * 1024 * 1024;
const DUPE_BUDGET_MS = 30_000;
let dupesCache: { rev: number; at: number; partial: boolean; remaining: number; groups: DupeGroup[] } | null = null;
let dupesFlight: Promise<void> | null = null;

function hashRanges(cp: string, ranges: [number, number][]): Promise<string | null> {
  return new Promise((resolve) => {
    const h = createHash('sha1');
    let i = 0;
    const next = () => {
      if (i >= ranges.length) return resolve(h.digest('hex'));
      const [start, end] = ranges[i++];
      const s = createReadStream(cp, { start, end });
      s.on('data', (d) => h.update(d));
      s.once('end', next);
      s.once('error', () => { s.destroy(); resolve(null); });
    };
    next();
  });
}

async function dupeFingerprint(it: Item): Promise<{ fp: string; exact: boolean } | null> {
  const cp = hostToContainer(it.p);
  const st = await stat(cp).catch(() => null);
  if (!st?.isFile() || st.size !== it.s) return null;
  if (it.s <= DUPE_SPAN * 3) {
    const fp = await hashRanges(cp, [[0, it.s - 1]]);
    return fp ? { fp, exact: true } : null;
  }
  const mid = Math.floor(it.s / 2 - DUPE_SPAN / 2);
  const fp = await hashRanges(cp, [[0, DUPE_SPAN - 1], [mid, mid + DUPE_SPAN - 1], [it.s - DUPE_SPAN, it.s - 1]]);
  return fp ? { fp, exact: false } : null;
}

async function computeDuplicates(): Promise<void> {
  const bySize = new Map<number, Item[]>();
  for (const it of items.values()) {
    if (it.s <= 0) continue;
    const g = bySize.get(it.s);
    if (g) g.push(it); else bySize.set(it.s, [it]);
  }
  const sizeGroups = [...bySize.values()].filter((g) => g.length > 1)
    .sort((a, b) => b[0].s * (b.length - 1) - a[0].s * (a.length - 1));
  const deadline = Date.now() + DUPE_BUDGET_MS;
  const byFp = new Map<string, DupeGroup>();
  let done = 0;
  const worker = async () => {
    while (done < sizeGroups.length && Date.now() < deadline) {
      const grp = sizeGroups[done++];
      const hashed = await Promise.all(grp.map(dupeFingerprint));
      for (let i = 0; i < grp.length; i++) {
        const h = hashed[i];
        if (!h) continue;
        const key = `${grp[i].s}:${h.fp}`;
        const g = byFp.get(key);
        if (g) { g.items.push(grp[i]); g.exact = g.exact && h.exact; }
        else byFp.set(key, { fp: key, size: grp[i].s, exact: h.exact, items: [grp[i]] });
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const groups = [...byFp.values()].filter((g) => g.items.length > 1)
    .map((g) => ({ ...g, items: g.items.sort((a, b) => b.m - a.m) }))
    .sort((a, b) => b.size * (b.items.length - 1) - a.size * (a.items.length - 1));
  dupesCache = { rev, at: Date.now(), partial: done < sizeGroups.length, remaining: Math.max(0, sizeGroups.length - done), groups };
}

async function duplicates(): Promise<NonNullable<typeof dupesCache>> {
  const stale = !dupesCache || dupesCache.rev !== rev || Date.now() - dupesCache.at > (dupesCache.partial ? 60_000 : 10 * 60_000);
  if (stale) {
    if (!dupesFlight) dupesFlight = computeDuplicates().finally(() => { dupesFlight = null; });
    await dupesFlight;
  }
  return dupesCache!;
}

// ---------- Routes ----------
// Register AFTER app.use('/api/*', requireAuth): /api/library/* inherits
// cookie auth; /s/* is intentionally public (the token is the capability).

export function registerLibraryRoutes(app: Hono,transfers?:FileTransfers): void {
  ensureReady().then(() => {
    scan().catch(() => {});
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

  const ctx: LibCtx = {
    ready: ensureReady,
    item: (id) => items.get(id),
    cacheHost: () => cacheHost,
    libDir: LIB_DIR,
    addPath: (hp, carry) => addPathToIndex(hp, carry as Partial<Item>),
    dropPath: (hp) => { const id = byPath.get(hp); if (id) dropItem(id); saveIndex(); },
    repath,
    publicItem: (it) => publicItem(it as Item),
    freeName,
    trash: async (cookie, paths) => {
      // The internal request must carry the advertised origin as its URL base:
      // browserWriteGuard compares Origin against the request URL while the
      // trash route compares it against AXON_PUBLIC_ORIGIN — only an absolute
      // URL on that origin satisfies both.
      const base = publicOrigin();
      const res = await app.request(`${base}/api/files/trash`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        body: JSON.stringify({ paths }),
      });
      const data = (await res.json().catch(() => ({}))) as { items?: { orig: string }[] };
      return (data.items || []).map((x) => x.orig);
    },
    touched,
  };
  registerLibraryTools(app, ctx);

  // ---- Index ----
  // The full index is a few MB for a big library — clients revalidate with
  // If-None-Match and get a 304 unless something actually changed.
  app.get('/api/library', async (c) => {
    await ensureReady();
    const etag = `W/"lib-${rev}"`;
    if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, no-cache' } });
    c.header('ETag', etag);
    c.header('Cache-Control', 'private, no-cache');
    const favs = new Set(state.favorites);
    const list = [...items.values()];
    return c.json({
      ok: true,
      home,
      roots: state.roots,
      directories: [...directories],
      uploadRoot: state.uploadRoot,
      shareBase: state.shareBase,
      scannedAt,
      revision: rev,
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

  app.get('/api/library/recent', async (c) => {
    await ensureReady();
    const limit = Math.max(1, Math.min(24, Number(c.req.query('limit')) || 8));
    const list = [...items.values()].sort((a, b) => b.m - a.m).slice(0, limit);
    return c.json({ ok: true, items: list.map(publicItem), count: items.size, scannedAt });
  });

  app.get('/api/library/duplicates', async (c) => {
    await ensureReady();
    const r = await duplicates();
    return c.json({
      ok: true, partial: r.partial, remaining: r.remaining, at: r.at,
      groups: r.groups.map((g) => ({
        hash: g.fp, size: g.size, exact: g.exact,
        items: g.items.filter((it) => items.get(it.id) === it).map(publicItem),
      })),
    });
  });

  app.get('/api/library/status', async (c) => {
    await ensureReady();
    const currentId = c.req.query('item');
    if (currentId) await freshItem(currentId);
    if (c.req.query('live') === '1' && Date.now() - scannedAt > ACTIVE_RESCAN_MS && !scanning) scan().catch(() => {});
    c.header('Cache-Control', 'private, no-store');
    return c.json({ ok: true, revision: rev, scanning, scannedAt, metaPending, thumbsPending: hiQ.length + loQ.length + active, count: items.size });
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
    const next={...state};
    if(Array.isArray(body.roots)){
      const clean:string[]=[];
      for(const r of body.roots){if(!String(r||'').trim())continue;const p=await resolveHostPath(String(r),{directory:true});if(p==='/home')return fail(c,400,'Elegí una carpeta dentro de /home');if(!clean.includes(p))clean.push(p);}
      next.roots=clean;
    }
    if(typeof body.uploadRoot==='string'&&body.uploadRoot.trim()){
      const p=await resolveHostPath(body.uploadRoot);if(p==='/home')return fail(c,400,'Elegí una carpeta de subidas');
      next.uploadRoot=p;
    }
    if(typeof body.shareBase==='string'){
      const sb=body.shareBase.trim().replace(/\/+$/,'');if(sb&&!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(sb))return fail(c,400,'URL base inválida');next.shareBase=sb;
    }
    if(next.uploadRoot!==state.uploadRoot){const mk=await hostExec(`mkdir -p -- ${shq(next.uploadRoot)}`,{user:'user',timeoutMs:10_000});if(!mk.ok)return fail(c,400,'No se pudo crear la carpeta de subidas');}
    state=next;
    saveState();
    scan().catch(() => {});
    return c.json({ ok: true, roots: state.roots, uploadRoot: state.uploadRoot, shareBase: state.shareBase });
  });

  // ---- Media ----
  const itemOr404 = (c: Context) => freshItem(c.req.param('id') || '');
  const previewCache = (c: Context, it: Item) => c.req.query('k') === it.tk
    ? 'private, max-age=31536000, immutable' : 'private, no-cache';

  app.on(['GET', 'POST'], '/api/library/document/:id', async c => {
    const it = await itemOr404(c);
    if (!it) return fail(c, 404, 'Documento no encontrado');
    return documentResponse(it.p, c.req.raw, '/api/library/document/' + encodeURIComponent(it.id));
  });

  app.get('/api/library/thumb/:id', async (c) => {
    const it = await itemOr404(c);
    if (!it) return c.text('No encontrado', 404);
    if (it.k === 'vector' && it.e === 'svg') return sendFile(c, it.p, { name: it.n, version: c.req.query('k') });
    const ok = await Promise.race([ensureThumb(it, true), Bun.sleep(45_000).then(() => false)]);
    if (!ok) return c.text('Sin miniatura', 404);
    return sendCached(c, `${cacheHost}/thumbs/${it.tk}`, previewCache(c, it));
  });

  app.get('/api/library/view/:id', async (c) => {
    const it = await itemOr404(c);
    if (!it) return c.text('No encontrado', 404);
    if (!hasView(it)) return sendFile(c, it.p, { name: it.n, version: c.req.query('k') });
    const ok = await ensureView(it);
    if (!ok) return c.text('No se pudo generar la vista', 415);
    return sendCached(c, `${cacheHost}/views/${it.tk}`, previewCache(c, it));
  });

  app.get('/api/library/file/:id', async (c) => {
    const it = await itemOr404(c);
    if (!it) return c.text('No encontrado', 404);
    return sendFile(c, it.p, { name: it.n, download: c.req.query('dl') === '1', version: c.req.query('k') });
  });

  app.get('/api/library/web/:id', async (c) => {
    const it = await itemOr404(c);
    if (!it || !webSet.has(it.tk)) return c.text('No encontrado', 404);
    return sendFile(c, `${cacheHost}/web/${it.tk}.mp4`, { name: it.n.replace(/\.[^.]+$/, '') + '.mp4', mime: 'video/mp4', cache: previewCache(c, it) });
  });

  app.post('/api/library/web/:id', async (c) => {
    const it = await itemOr404(c);
    if (!it || it.k !== 'video') return fail(c, 404, 'Video no encontrado');
    return c.json({ ok: true, ...ensureWeb(it) });
  });

  app.get('/api/library/web/:id/status', async (c) => {
    const it = await itemOr404(c);
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
    const { name, ids } = await c.req.json<{ name: string; ids?: string[] }>().catch(() => ({ name: '', ids: undefined as string[] | undefined, desc: undefined as string | undefined, body: undefined as string | undefined, url: undefined as string | undefined, command: undefined as string | undefined, args: undefined as string | undefined }));
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
    if(!transfers)return fail(c,503,'Motor de transferencias no disponible');
    await transferMove(transfers,it.p,dest,c);
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
      if(!transfers){failed.push({id,error:'Motor de transferencias no disponible'});break;}
      try{await transferMove(transfers,it.p,dest,c);}catch{failed.push({id,error:'Operación pendiente o no completada. Consultá el historial de transferencias.'});break;}
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
    const { ids } = await c.req.json<{ ids: string[] }>().catch(() => ({ ids: [] as string[], name: undefined as string | undefined }));
    const list = (ids || []).map((id) => items.get(id)).filter(Boolean) as Item[];
    if (!list.length) return fail(c, 400, 'Nada para eliminar');
    const base = publicOrigin();
    const res = await app.request(`${base}/api/files/trash`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: c.req.header('cookie') || '', origin: base },
      body: JSON.stringify({ paths: list.map((it) => it.p) }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; items?: { orig: string }[]; failed?: unknown[]; error?: string };
    if (!res.ok || data.ok === false) {
      return fail(c, res.ok ? 502 : res.status, data.error || 'No se pudo enviar a la papelera');
    }
    const done = new Set((data.items || []).map((x) => x.orig));
    for (const it of list) if (done.has(it.p)) dropItem(it.id);
    // Favorites/collections/shares keep pointing at the original location —
    // trash is restorable, and a restore reindexes that path.
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
    if (!name || Buffer.byteLength(name, 'utf8') > 255) return fail(c, 400, 'Nombre inválido');
    if (!Number.isSafeInteger(size) || size < 0) return fail(c, 400, 'Tamaño inválido');
    const kind = KIND_BY_EXT[extOf(name)] || 'other';
    let dir = await resolveInRoots(b.dir || `${state.uploadRoot}/${KIND_FOLDER[kind]}`);
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
    const prev = uploadLocks.get(u.id);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    uploadLocks.set(u.id, gate);
    // Gates never reject today, but swallow a predecessor rejection anyway so
    // a future change cannot orphan this gate's release path.
    await prev?.catch(() => {});
    try {
      if (u.cancelled || uploads.get(u.id) !== u) return fail(c, 410, 'La subida se interrumpió');
      await hostVolumes.roots(u.dir);
      const offset = Number(c.req.query('offset') || 0);
      const st = await stat(hostToContainer(u.part)).catch(() => null);
      const have = st?.size ?? -1;
      if (have < 0) return fail(c, 410, 'El archivo parcial desapareció');
      if (have !== u.received) return fail(c, 409, 'El archivo parcial cambió; reiniciá la subida');
      if (offset !== have) return c.json({ ok: false, error: 'offset', received: have }, 409);
      try {
        if (!c.req.raw.body) return fail(c, 400, 'Bloque vacío');
        const bytes = await appendUploadBlock(u.part, c.req.raw.body, Math.min(CHUNK_MAX, u.size - have));
        u.received = have + bytes;
        return c.json({ ok: true, received: u.received });
      } catch {
        // Failed blocks were never acknowledged. Restore the previous offset
        // so retry sends that block once, including interrupted/oversized bodies.
        const rollback = await hostExec(`truncate -s ${have} -- ${shq(u.part)}`, { user: 'user', timeoutMs: 10_000 });
        if (!rollback.ok) u.cancelled = true;
        return fail(c, 500, 'Falló la escritura del bloque', { received: have });
      }
    } finally {
      u.t = Date.now();
      release();
      if (uploadLocks.get(u.id) === gate) uploadLocks.delete(u.id);
    }
  });

  // finish/delete take the same per-uid gate as chunk PUTs — a `mv` or `rm`
  // racing an in-flight append would move bytes mid-write.
  const withUploadLock = async (uid: string, fn: () => Promise<Response>): Promise<Response> => {
    const prev = uploadLocks.get(uid);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    uploadLocks.set(uid, gate);
    await prev?.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (uploadLocks.get(uid) === gate) uploadLocks.delete(uid);
    }
  };

  app.post('/api/library/upload/:uid/finish', async (c) => {
    const u = uploads.get(c.req.param('uid'));
    if (!u) return fail(c, 404, 'Subida no encontrada');
    return withUploadLock(u.id, async () => {
      if (u.cancelled || uploads.get(u.id) !== u) return fail(c, 410, 'La subida se interrumpió');
      await hostVolumes.roots(u.dir);
      const st = await stat(hostToContainer(u.part)).catch(() => null);
      if (!st || st.size !== u.size) return fail(c, 400, `Subida incompleta (${st?.size ?? 0} de ${u.size} bytes)`);
      const name = await freeName(u.dir, u.name);
      const dest = `${u.dir}/${name}`;
      // mv -n exits 0 even when it skips an existing destination — verify the
      // part file actually went away so a silent no-op can't pass for success.
      const r = await hostExec(`mv -nT -- ${shq(u.part)} ${shq(dest)}; [ ! -e ${shq(u.part)} ]`, { user: 'user', timeoutMs: 30_000 });
      if (!r.ok) return fail(c, 409, 'No se pudo completar la subida (¿el destino ya existía?)', { detail: r.stderr });
      uploads.delete(u.id);
      const it = await addPathToIndex(dest);
      return c.json({ ok: true, item: it ? publicItem(it) : null, path: dest });
    });
  });

  app.delete('/api/library/upload/:uid', async (c) => {
    const u = uploads.get(c.req.param('uid'));
    if (u) {
      await withUploadLock(u.id, async () => {
        await hostVolumes.roots(u.dir);
        uploads.delete(u.id);
        await hostExec(`rm -f -- ${shq(u.part)}`, { user: 'user', timeoutMs: 10_000 });
        return c.json({ ok: true });
      });
    }
    return c.json({ ok: true });
  });

  // ---- ZIP (authed) ----
  app.post('/api/library/zip', async (c) => {
    const { ids, name } = await c.req.json<{ ids: string[]; name?: string }>().catch(() => ({ ids: [] as string[], name: undefined as string | undefined }));
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
    return c.json({ ok: true, shareBase: state.shareBase, shares: await Promise.all(state.shares.slice().sort((a, b) => b.created - a.created).map((s) => shareSummary(c, s))) });
  });

  app.post('/api/library/shares', async (c) => {
    await ensureReady();
    const b = await c.req.json<{ ids: string[]; title?: string; ttl?: number; allowDownload?: boolean; password?: string; msg?: string; cdn?: boolean; notifyActivity?: boolean }>().catch(() => ({ ids: [] } as never));
    const list = (b.ids || []).map((id) => items.get(id)).filter(Boolean) as Item[];
    if (!list.length) return fail(c, 400, 'Elegí al menos un archivo');
    if (list.length > 2000) return fail(c, 400, 'Demasiados archivos para un solo link');
    let sharePaths: string[];
    try { sharePaths = await canonicalSharePaths(list.map(it => it.p)); } catch (e) { return fail(c, 400, (e as Error).message); }
    const ttl = Number(b.ttl);
    const s: Share = {
      id: randomBytes(12).toString('base64url'),
      title: String(b.title || '').trim().slice(0, 120) || (list.length === 1 ? list[0].n : `${list.length} archivos`),
      paths: sharePaths,
      created: Date.now(),
      expires: ttl > 0 ? Date.now() + Math.min(ttl, 366 * 86400) * 1000 : null,
      allowDownload: b.allowDownload !== false,
      views: 0,
      downloads: 0,
      cdn: b.cdn !== false,
      notifyActivity: b.notifyActivity !== false,
    };
    const msg = String(b.msg || '').trim().slice(0, 1000);
    if (msg) s.msg = msg;
    if (b.password && String(b.password).length) s.pass = await Bun.password.hash(String(b.password));
    state.shares.push(s);
    saveState();
    prepareShare(list);
    return c.json({ ok: true, share: await shareSummary(c, s) });
  });

  app.patch('/api/library/shares/:sid', async (c) => {
    const current = state.shares.find((x) => x.id === c.req.param('sid'));
    if (!current) return fail(c, 404, 'Link no encontrado');
    const s: Share = { ...current, paths: [...current.paths] };
    const hadEdgeCopies = current.cdn !== false && !current.pass;
    const b = await c.req.json<{
      title?: string; ttl?: number | null; extend?: number; allowDownload?: boolean; password?: string | null;
      msg?: string; cdn?: boolean; notifyActivity?: boolean; add?: string[]; remove?: string[]; order?: string[];
    }>().catch(() => ({} as never));
    // Anything that changes who may see what invalidates the edge copies.
    let purge = false;
    if(typeof b.notifyActivity === 'boolean')s.notifyActivity=b.notifyActivity;
    if (typeof b.title === 'string' && b.title.trim()) s.title = b.title.trim().slice(0, 120);
    if (typeof b.msg === 'string') { const m = b.msg.trim().slice(0, 1000); if (m) s.msg = m; else delete s.msg; }
    if (b.ttl === null || b.ttl === 0) s.expires = null;
    else if (typeof b.ttl === 'number' && b.ttl > 0) s.expires = Date.now() + Math.min(b.ttl, 366 * 86400) * 1000;
    if (typeof b.extend === 'number' && b.extend > 0) s.expires = Math.max(Date.now(), s.expires ?? Date.now()) + b.extend * 1000;
    if (typeof b.allowDownload === 'boolean' && b.allowDownload !== s.allowDownload) { s.allowDownload = b.allowDownload; purge = true; }
    if (typeof b.cdn === 'boolean' && b.cdn !== (s.cdn !== false)) { s.cdn = b.cdn; purge = true; }
    if (b.password === null || b.password === '') { if (s.pass) purge = true; delete s.pass; }
    else if (typeof b.password === 'string') { s.pass = await Bun.password.hash(b.password); purge = true; }
    const toPaths = async (ids?: string[]) => canonicalSharePaths((ids || []).map(id => items.get(id)?.p).filter(Boolean) as string[]);
    let addedPaths: string[], removedPaths: string[];
    try {
      // Existing paths whose target vanished (renamed/deleted on disk, root
      // removed) must not wedge every later PATCH — drop them instead of
      // failing. They no longer resolve, so they serve nothing anyway.
      const existing = await Promise.all(s.paths.map(async (p) => {
        try { return (await canonicalSharePaths([p]))[0]; } catch { return null; }
      }));
      s.paths = existing.filter((p): p is string => !!p);
      addedPaths = await toPaths(b.add); removedPaths = await toPaths(b.remove);
    } catch (e) { return fail(c, 400, (e as Error).message); }
    if (b.remove?.length) {
      // Removing shifts file indexes, so cached /f/<i> URLs must go.
      const rm = new Set(removedPaths);
      s.paths = s.paths.filter((p) => !rm.has(p));
      purge = true;
    }
    if (b.add?.length) {
      const added = addedPaths.filter((p) => !s.paths.includes(p));
      s.paths.push(...added);
      prepareShare(added.map((p) => items.get(byPath.get(p) || '')).filter(Boolean) as Item[]);
    }
    if (!s.paths.length) return fail(c, 400, 'El link tiene que tener al menos un archivo');
    if (s.paths.length > 2000) return fail(c, 400, 'Demasiados archivos para un solo link');
    if (b.order?.length) {
      let ordered: string[];
      try { ordered = await toPaths(b.order); } catch (e) { return fail(c, 400, (e as Error).message); }
      s.paths = [...ordered.filter(p => s.paths.includes(p)), ...s.paths.filter(p => !ordered.includes(p))];
      purge = true;
    }
    if (JSON.stringify(s.paths) !== JSON.stringify(current.paths)) purge = true;
    Object.assign(current, s);
    if (!s.pass) delete current.pass;
    if (!s.msg) delete current.msg;
    saveState();
    const edge = purge ? await purgeShare(c, s, hadEdgeCopies) : {success:true};
    return c.json({ ok: true, share: await shareSummary(c, s), ...(!edge.success ? {warning:'El cambio ya se aplicó en Axon, pero no se pudo invalidar la CDN. Algunas copias previas pueden seguir disponibles hasta vencer.'} : {}) });
  });

  app.delete('/api/library/shares/:sid', async (c) => {
    const s = state.shares.find((x) => x.id === c.req.param('sid'));
    if (!s) return c.json({ ok: false });
    state.shares = state.shares.filter((x) => x !== s);
    saveState();
    const edge=await purgeShare(c,s);
    return c.json({ ok: true, ...(!edge.success ? {warning:'Revocado en Axon. No se pudo invalidar la CDN; algunas copias previas pueden seguir disponibles hasta vencer.'} : {}) });
  });

  app.post('/api/library/shares/cleanup', (c) => {
    const dead = state.shares.filter((s) => !shareAlive(s));
    state.shares = state.shares.filter(shareAlive);
    saveState();
    for (const s of dead) purgeShare(c, s);
    return c.json({ ok: true, removed: dead.length });
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

  // "3", "3.jpg" → 3
  const idxOf = (c: Context) => {
    const m = /^(\d+)(?:\.[a-z0-9]+)?$/i.exec(c.req.param('i') || '');
    return m ? Number(m[1]) : -1;
  };

  const fileOf = async (c: Context, s: Share): Promise<ShareFile | null> => {
    const i = idxOf(c);
    if (!Number.isInteger(i) || i < 0 || i >= s.paths.length) return null;
    const p = s.paths[i];
    if (!(await resolveInRoots(p))) return null;
    const id = byPath.get(p);
    const it = (id ? items.get(id) : undefined) || (await statItem(p, 'other')) || undefined;
    return it ? { i, p, n: it.n, e: it.e, k: it.k, s: it.s, it } : null;
  };

  // Common guard for every public asset route.
  const shareAsset = async (c: Context): Promise<{ s: Share; f: ShareFile } | Response> => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!isUnlocked(c, s)) return c.text('Protegido', 401);
    const f = await fileOf(c, s);
    if (!f) return c.text('No encontrado', 404);
    return { s, f };
  };

  app.get('/s/:sid', async (c) => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!isUnlocked(c, s)) return passwordPage(c, s);
    shareActivity(c,s,'view');
    return sharePage(c, s, await shareFiles(s));
  });

  app.post('/s/:sid/unlock', async (c) => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!s.pass) return c.redirect(`/s/${s.id}`);
    const ip = requestIp(c);
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
    const secure = ((loopbackPeer(c) && ((c.req.header('x-forwarded-proto') || '').includes('https') || (c.req.header('cf-visitor') || '').includes('https'))) || new URL(c.req.url).protocol === 'https:') ? '; Secure' : '';
    c.header('set-cookie', `axs_${s.id}=${unlockToken(s)}; Path=/s/${s.id}; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}${secure}`);
    return c.redirect(`/s/${s.id}`, 303);
  });

  app.post('/s/:sid/activity', async c => {
    const s = await getShare(c); if(s instanceof Response)return s;
    if(!isUnlocked(c,s))return c.json({ok:false},401);
    const b = await c.req.json<{i?:number}>().catch(()=>({} as {i?:number}));
    if(!Number.isInteger(b.i) || b.i!<0 || b.i!>=s.paths.length)return c.json({ok:false},400);
    shareActivity(c,s,'play',path.posix.basename(s.paths[b.i!]));
    return c.json({ok:true},200,{'Cache-Control':'no-store'});
  });

  // Live state for the page (streaming copies finishing while it's open).
  app.get('/s/:sid/st', async (c) => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!isUnlocked(c, s)) return c.json({ ok: false }, 401);
    const files: Record<number, { w: boolean; pct: number; state: string }> = {};
    s.paths.forEach((p, i) => {
      const it = items.get(byPath.get(p) || '');
      if (it?.k === 'video') files[i] = { w: webSet.has(it.tk), pct: transcodes.get(it.tk)?.pct || 0, state: webSet.has(it.tk) ? 'done' : transcodes.get(it.tk)?.state || 'none' };
    });
    return c.json({ ok: true, files }, 200, { 'Cache-Control': 'no-store' });
  });

  const original = async (c: Context) => {
    const r = await shareAsset(c);
    if (r instanceof Response) return r;
    const { s, f } = r;
    const dl = c.req.query('dl') === '1';
    if (dl && !s.allowDownload) return c.text('La descarga está deshabilitada para este link', 403);
    if (dl && !/^bytes=[1-9]/.test(c.req.header('range') || '')) {
      shareActivity(c,s,'download',f.n);
    }
    return sendFile(c, f.p, { name: f.n, download: dl, cache: dl ? 'private, no-store' : edgeCache(s, 3600) });
  };
  app.get('/s/:sid/f/:i', original);
  app.get('/s/:sid/f/:i/:name', original);

  app.get('/s/:sid/t/:i', async (c) => {
    const r = await shareAsset(c);
    if (r instanceof Response) return r;
    const { s, f } = r;
    if (!f.it) return c.text('No encontrado', 404);
    if (f.it.k === 'vector' && f.it.e === 'svg') return sendFile(c, f.p, { name: f.n, cache: edgeCache(s, 86400) });
    const ok = await Promise.race([ensureThumb(f.it, true), Bun.sleep(45_000).then(() => false)]);
    if (!ok) return c.text('Sin miniatura', 404);
    return sendCached(c, `${cacheHost}/thumbs/${f.it.tk}`, edgeCache(s, 7 * 86400));
  });

  app.get('/s/:sid/v/:i', async (c) => {
    const r = await shareAsset(c);
    if (r instanceof Response) return r;
    const { s, f } = r;
    if (!f.it) return c.text('No encontrado', 404);
    if (!hasView(f.it)) return sendFile(c, f.p, { name: f.n, cache: edgeCache(s, 86400) });
    if (!(await ensureView(f.it))) return sendFile(c, f.p, { name: f.n, cache: edgeCache(s, 3600) });
    return sendCached(c, `${cacheHost}/views/${f.it.tk}`, edgeCache(s, 7 * 86400));
  });

  app.get('/s/:sid/w/:i', async (c) => {
    const r = await shareAsset(c);
    if (r instanceof Response) return r;
    const { s, f } = r;
    if (!f.it || !webSet.has(f.it.tk)) return c.text('No encontrado', 404);
    return sendFile(c, `${cacheHost}/web/${f.it.tk}.mp4`, { name: f.n.replace(/\.[^.]+$/, '') + '.mp4', mime: 'video/mp4', cache: edgeCache(s, 86400) });
  });

  // Visitors can request playback only for an accessible video in this share.
  // The existing queue deduplicates by the original's rendition key.
  app.post('/s/:sid/prepare/:i', async (c) => {
    const r = await shareAsset(c);
    if (r instanceof Response) return r;
    if (!r.f.it || r.f.it.k !== 'video') return c.json({ ok: false }, 404);
    return c.json({ ok: true, ...ensureWeb(r.f.it) }, 200, { 'Cache-Control': 'no-store' });
  });

  // Subtitles from the transcript (if one was made).
  app.get('/s/:sid/c/:i', async (c) => {
    const r = await shareAsset(c);
    if (r instanceof Response) return r;
    const vtt = r.f.it ? await transcriptVtt(r.f.it.tk) : null;
    if (!vtt) return c.text('Sin subtítulos', 404);
    return c.body(vtt, 200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': edgeCache(r.s, 3600) });
  });

  // ZIP of everything, or of a subset: /zip?i=0,3,7
  app.get('/s/:sid/zip', async (c) => {
    const s = await getShare(c);
    if (s instanceof Response) return s;
    if (!isUnlocked(c, s)) return c.text('Protegido', 401);
    if (!s.allowDownload) return c.text('La descarga está deshabilitada para este link', 403);
    let paths = s.paths;
    const pick = String(c.req.query('i') || '');
    if (pick) {
      const want = new Set(pick.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < s.paths.length));
      paths = s.paths.filter((_, i) => want.has(i));
      if (!paths.length) return c.text('Nada seleccionado', 400);
    }
    try { paths = await canonicalSharePaths(paths); } catch { return c.text('Uno de los archivos ya no está disponible',404); }
    shareActivity(c,s,'zip',`${paths.length} archivos`);
    const name = sanitizeName(s.title) || 'compartido';
    return zipResponse(paths, `${name}${pick ? ` (${paths.length})` : ''}.zip`);
  });
}
