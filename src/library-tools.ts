import type { Context, Hono } from 'hono';
import { readdir, readFile, writeFile, mkdir, unlink, stat, rename as fsRename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { hostExec, hostSpawn, hostSpawnInteractive, hostSpawnDetached, hostToContainer } from './host';

// ---------------------------------------------------------------------------
// BIBLIOTECA — media tools: optimize / convert photos, videos and audio, and
// transcribe video/audio with an on-demand ASR worker.
//
// * Photos use Squoosh's codec set: MozJPEG (the same WASM build Squoosh
//   ships, run in a Bun worker), libwebp (cwebp), libavif (avifenc),
//   OxiPNG + libimagequant (pngquant), JPEG XL (cjxl). Decoding goes through
//   ImageMagick on the host, so HEIC / RAW / TIFF / PSD inputs all work.
// * Video/audio use ffmpeg on the host with presets or advanced settings.
// * Every result is either a copy next to the original or replaces it — the
//   original then goes to Axon's trash, so a replace is always undoable.
// * Transcription runs in src/transcribe_worker.py: Axon starts it when a
//   job needs it and the worker exits after 10 idle minutes, so the model
//   is never resident when nobody is using it.
// ---------------------------------------------------------------------------

export interface LibItem {
  id: string; p: string; n: string; e: string; k: string; s: number; m: number; tk: string;
  t?: number; w?: number; h?: number; d?: number; c?: string; mx?: 1;
}

export interface LibCtx {
  ready(): Promise<void>;
  item(id: string): LibItem | undefined;
  cacheHost(): string;
  libDir: string;
  addPath(hp: string, carry?: Partial<LibItem>): Promise<LibItem | null>;
  dropPath(hp: string): void;
  repath(from: string, to: string): void;
  publicItem(it: LibItem): unknown;
  freeName(dir: string, name: string): Promise<string>;
  trash(cookie: string, paths: string[]): Promise<string[]>;
  touched(): void;
}

const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
const extOf = (n: string) => {
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(i + 1).toLowerCase() : '';
};
const stem = (n: string) => {
  const e = extOf(n);
  return e ? n.slice(0, -(e.length + 1)) : n;
};
const clamp = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : def;
};
const fmtSize = (b: number) => {
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = b, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
};

function fail(c: Context, status: number, error: string, extra?: Record<string, unknown>) {
  return c.json({ ok: false, error, ...extra }, status as never);
}

// ---------- Capabilities ----------

interface Caps { jxl: boolean; heic: boolean; avif: boolean; webp: boolean; oxipng: boolean; pngquant: boolean; nvenc: boolean; whisper: boolean; uv: boolean; cuda: boolean }
let caps: Caps | null = null;
let capsP: Promise<Caps> | null = null;

function getCaps(): Promise<Caps> {
  if (caps) return Promise.resolve(caps);
  if (capsP) return capsP;
  capsP = (async () => {
    const has = async (bin: string) => (await hostExec(`command -v ${bin}`, { user: 'user', timeoutMs: 8000 })).ok;
    const [jxl, avif, webp, oxipng, pngquant, uv] = await Promise.all(
      ['cjxl', 'avifenc', 'cwebp', 'oxipng', 'pngquant', 'uv'].map(has)
    );
    // heif-enc ships without an HEVC encoder unless libheif-plugin-x265 is in.
    const heic = (await hostExec(`heif-enc --list-encoders 2>/dev/null | sed -n '/^HEIC/,/^[A-Z]/p' | grep -q '^- '`, { user: 'user', timeoutMs: 8000 })).ok;
    const nv = await hostExec('ffmpeg -v error -f lavfi -i color=s=256x256:d=0.2 -c:v h264_nvenc -f null - >/dev/null 2>&1', { user: 'user', timeoutMs: 20_000 });
    const wh = await hostExec(`python3 -c 'import whisper,torch;print(int(torch.cuda.is_available()))'`, { user: 'user', timeoutMs: 60_000 });
    caps = {
      jxl, heic, avif, webp, oxipng, pngquant, uv,
      nvenc: nv.ok,
      whisper: wh.ok,
      cuda: wh.ok && wh.stdout.trim().endsWith('1'),
    };
    return caps;
  })().finally(() => { capsP = null; });
  return capsP;
}

// ---------- Option normalizing ----------

const IMG_OUT = ['jpg', 'webp', 'avif', 'png', 'jxl', 'heic', 'gif', 'tiff', 'bmp'] as const;
type ImgFmt = (typeof IMG_OUT)[number];
const VID_CONT = ['mp4', 'mkv', 'webm', 'mov', 'gif'] as const;
const AUD_OUT = ['mp3', 'm4a', 'opus', 'ogg', 'flac', 'wav'] as const;

interface ImgOpts { format: ImgFmt; quality: number; maxSide: number; keepMeta: boolean; lossless: boolean; colors: number; effort: number }
interface VidOpts {
  container: (typeof VID_CONT)[number]; vcodec: 'h264' | 'h265' | 'av1' | 'vp9' | 'copy'; crf: number; speed: 'fast' | 'medium' | 'slow';
  maxH: number; fps: number; acodec: 'aac' | 'opus' | 'mp3' | 'copy' | 'none'; abr: number; hw: 'auto' | 'cpu' | 'gpu';
  start: number; end: number; gifWidth: number;
}
interface AudOpts { format: (typeof AUD_OUT)[number]; bitrate: number; mono: boolean; normalize: boolean; start: number; end: number }

function imgOpts(o: Record<string, unknown>, srcExt: string): ImgOpts {
  let format = String(o.format || 'webp').toLowerCase().replace('jpeg', 'jpg') as ImgFmt;
  if (format === ('original' as string)) format = (IMG_OUT as readonly string[]).includes(srcExt.replace('jpeg', 'jpg')) ? (srcExt.replace('jpeg', 'jpg') as ImgFmt) : 'jpg';
  if (!(IMG_OUT as readonly string[]).includes(format)) format = 'webp';
  return {
    format,
    quality: clamp(o.quality, 1, 100, format === 'avif' ? 60 : 80),
    maxSide: clamp(o.maxSide, 0, 20000, 0),
    keepMeta: o.keepMeta !== false,
    lossless: o.lossless === true,
    colors: clamp(o.colors, 0, 256, 0),
    effort: clamp(o.effort, 1, 3, 2),
  };
}

const VPRESETS: Record<string, Partial<VidOpts> & { label: string }> = {
  web: { label: 'Web (H.264 1080p)', container: 'mp4', vcodec: 'h264', crf: 23, speed: 'medium', maxH: 1080, acodec: 'aac', abr: 128 },
  small: { label: 'Liviano (720p)', container: 'mp4', vcodec: 'h264', crf: 28, speed: 'medium', maxH: 720, fps: 30, acodec: 'aac', abr: 96 },
  hevc: { label: 'H.265 eficiente', container: 'mp4', vcodec: 'h265', crf: 26, speed: 'medium', maxH: 0, acodec: 'aac', abr: 128 },
  av1: { label: 'AV1 máxima compresión', container: 'mp4', vcodec: 'av1', crf: 34, speed: 'medium', maxH: 0, acodec: 'aac', abr: 128 },
  archive: { label: 'Archivo alta calidad', container: 'mkv', vcodec: 'h265', crf: 20, speed: 'slow', maxH: 0, acodec: 'copy', abr: 192 },
  gif: { label: 'GIF animado', container: 'gif', vcodec: 'h264', crf: 23, maxH: 0, fps: 12, acodec: 'none', gifWidth: 480 },
};

function vidOpts(o: Record<string, unknown>): VidOpts & { label: string } {
  const pre = VPRESETS[String(o.preset || '')];
  const m = { ...(pre || {}), ...(pre ? {} : o) } as Record<string, unknown>;
  // Advanced settings may also tweak a preset (trim always applies).
  let container = (VID_CONT as readonly string[]).includes(String(m.container)) ? (m.container as VidOpts['container']) : 'mp4';
  let vcodec = (['h264', 'h265', 'av1', 'vp9', 'copy'].includes(String(m.vcodec)) ? m.vcodec : 'h264') as VidOpts['vcodec'];
  let acodec = (['aac', 'opus', 'mp3', 'copy', 'none'].includes(String(m.acodec)) ? m.acodec : 'aac') as VidOpts['acodec'];
  if (container === 'webm') {
    if (vcodec !== 'av1' && vcodec !== 'vp9') vcodec = 'vp9';
    if (acodec !== 'none') acodec = 'opus';
  }
  if (container === 'mov' && acodec === 'opus') acodec = 'aac';
  const defCrf = { h264: 23, h265: 26, av1: 34, vp9: 33, copy: 0 }[vcodec];
  const speed = (['fast', 'medium', 'slow'].includes(String(m.speed)) ? m.speed : 'medium') as VidOpts['speed'];
  const out: VidOpts & { label: string } = {
    label: pre?.label || 'Personalizado',
    container, vcodec, acodec, speed,
    crf: clamp(m.crf, 0, 63, defCrf),
    maxH: clamp(m.maxH, 0, 4320, 0),
    fps: clamp(m.fps, 0, 240, 0),
    abr: clamp(m.abr, 32, 512, 128),
    hw: (['auto', 'cpu', 'gpu'].includes(String(o.hw)) ? o.hw : 'auto') as VidOpts['hw'],
    start: Math.max(0, Number(o.start) || 0),
    end: Math.max(0, Number(o.end) || 0),
    gifWidth: clamp(m.gifWidth, 64, 1920, 480),
  };
  if (out.vcodec === 'copy' && out.container === 'gif') out.vcodec = 'h264';
  return out;
}

function audOpts(o: Record<string, unknown>): AudOpts {
  const format = ((AUD_OUT as readonly string[]).includes(String(o.format)) ? o.format : 'mp3') as AudOpts['format'];
  return {
    format,
    bitrate: clamp(o.bitrate, 24, 512, format === 'opus' || format === 'ogg' ? 96 : 192),
    mono: o.mono === true,
    normalize: o.normalize === true,
    start: Math.max(0, Number(o.start) || 0),
    end: Math.max(0, Number(o.end) || 0),
  };
}

const IMG_LABEL: Record<ImgFmt, string> = { jpg: 'JPEG (MozJPEG)', webp: 'WebP', avif: 'AVIF', png: 'PNG (OxiPNG)', jxl: 'JPEG XL', heic: 'HEIC', gif: 'GIF', tiff: 'TIFF', bmp: 'BMP' };

function imgLabel(o: ImgOpts): string {
  const bits = [IMG_LABEL[o.format]];
  if (o.lossless || o.format === 'png' && !o.colors) bits.push('sin pérdida');
  else if (o.format === 'png' && o.colors) bits.push(`${o.colors} colores`);
  else if (!['gif', 'tiff', 'bmp'].includes(o.format)) bits.push(`calidad ${o.quality}`);
  if (o.maxSide) bits.push(`máx ${o.maxSide}px`);
  return bits.join(' · ');
}

// ---------- Command builders (run on the host) ----------

// Convert embedded profiles (Display P3 iPhone photos…) to sRGB pixels.
const SRGB_ICC = '/usr/share/color/icc/colord/sRGB.icc';
const SRGB = `$( [ -f ${SRGB_ICC} ] && echo "-profile ${SRGB_ICC}" || echo "-colorspace sRGB" )`;

// Decode anything ImageMagick reads (HEIC, RAW, TIFF, PSD, SVG…) into a
// normalized 8-bit PNG — the common input for every encoder.
function decodeCmd(o: ImgOpts, flatten: boolean): string {
  const resize = o.maxSide ? `-resize "${o.maxSide}x${o.maxSide}>"` : '';
  // Keep the ICC profile so wide-gamut (Display P3) photos keep their colors;
  // EXIF is copied back by exiftool at the end when keepMeta is on.
  const flat = flatten ? `-background white -alpha remove -alpha off` : '';
  // Formats without reliable ICC support get converted to sRGB pixels.
  const color = ['gif', 'bmp'].includes(o.format) ? SRGB : `+profile '!icc,*'`;
  return `magick "$S[0]" -auto-orient ${resize} ${flat} ${color} -depth 8 -define png:compression-level=1 "png:$T/i.png"`;
}

function encodeCmd(o: ImgOpts): string {
  const q = o.quality;
  switch (o.format) {
    case 'webp':
      return o.lossless
        ? `cwebp -quiet -mt -lossless -z ${o.effort * 3} -metadata icc "$T/i.png" -o "$O"`
        : `cwebp -quiet -mt -m ${o.effort === 1 ? 4 : 6} -q ${q} -sharp_yuv -metadata icc "$T/i.png" -o "$O"`;
    case 'avif':
      return `avifenc -q ${o.lossless ? 100 : q} -s ${[8, 6, 4][o.effort - 1]} -j all ${o.lossless ? '-l' : ''} "$T/i.png" "$O" >/dev/null`;
    case 'jxl':
      return `cjxl "$T/i.png" "$O" ${o.lossless ? '-d 0' : `-q ${q}`} -e ${[5, 7, 8][o.effort - 1]} --quiet`;
    case 'heic':
      return `heif-enc ${o.lossless ? '-L' : `-q ${q}`} -o "$O" "$T/i.png" >/dev/null`;
    case 'png': {
      const quant = o.colors
        ? `(pngquant --force --speed ${4 - o.effort} --quality=0-${q} ${o.colors} --output "$T/q.png" "$T/i.png" && mv -f "$T/q.png" "$T/i.png" || true) && `
        : '';
      return `${quant}(oxipng -q -o ${[2, 3, 4][o.effort - 1]} --strip safe --out "$O" "$T/i.png" || cp -f "$T/i.png" "$O")`;
    }
    case 'gif':
      return `magick "$T/i.png" "gif:$O"`;
    case 'tiff':
      return `magick "$T/i.png" -compress zip "tiff:$O"`;
    case 'bmp':
      return `magick "$T/i.png" "bmp:$O"`;
    case 'jpg':
      // Fallback only (huge images) — normal JPEGs go through MozJPEG WASM.
      return `magick "$T/i.png" -quality ${q} -sampling-factor 4:2:0 -interlace JPEG "jpg:$O"`;
  }
}

function metaCmd(o: ImgOpts): string {
  if (!o.keepMeta || ['bmp', 'gif'].includes(o.format)) return 'true';
  return `exiftool -q -q -m -overwrite_original -TagsFromFile "$S" -all:all -Orientation= -ThumbnailImage= -PreviewImage= -JpgFromRaw= "$O" >/dev/null 2>&1 || true`;
}

function vidEncoderArgs(o: VidOpts, gpu: boolean): string {
  const sp = o.speed;
  switch (o.vcodec) {
    case 'copy': return '-c:v copy';
    case 'h264':
      return gpu
        ? `-c:v h264_nvenc -preset ${sp === 'fast' ? 'p3' : sp === 'slow' ? 'p7' : 'p5'} -rc vbr -cq ${o.crf} -b:v 0 -pix_fmt yuv420p -profile:v high`
        : `-c:v libx264 -preset ${sp === 'fast' ? 'veryfast' : sp === 'slow' ? 'slow' : 'medium'} -crf ${o.crf} -pix_fmt yuv420p -profile:v high`;
    case 'h265':
      return gpu
        ? `-c:v hevc_nvenc -preset ${sp === 'fast' ? 'p3' : sp === 'slow' ? 'p7' : 'p5'} -rc vbr -cq ${o.crf} -b:v 0 -pix_fmt yuv420p -tag:v hvc1`
        : `-c:v libx265 -preset ${sp === 'fast' ? 'veryfast' : sp === 'slow' ? 'slow' : 'medium'} -crf ${o.crf} -pix_fmt yuv420p -tag:v hvc1 -x265-params log-level=error`;
    case 'av1':
      return `-c:v libsvtav1 -preset ${sp === 'fast' ? 10 : sp === 'slow' ? 5 : 8} -crf ${o.crf} -pix_fmt yuv420p`;
    case 'vp9':
      return `-c:v libvpx-vp9 -crf ${o.crf} -b:v 0 -row-mt 1 -deadline good -cpu-used ${sp === 'fast' ? 4 : sp === 'slow' ? 1 : 2}`;
  }
}

function vidCmd(src: string, out: string, o: VidOpts, gpu: boolean): string {
  const trimIn = o.start ? `-ss ${o.start}` : '';
  const trimOut = o.end && o.end > o.start ? `-t ${(o.end - o.start).toFixed(3)}` : '';
  const base = `nice -n 10 ffmpeg -nostdin -v error -y ${trimIn} -i ${shq(src)} ${trimOut}`;
  if (o.container === 'gif') {
    const fps = o.fps || 12;
    const vf = `fps=${fps},scale='min(${o.gifWidth},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    return `${base} -an -vf ${shq(vf)} -loop 0 -progress pipe:1 -nostats -f gif ${shq(out)}`;
  }
  const filters: string[] = [];
  if (o.vcodec !== 'copy' && o.maxH) {
    filters.push(`scale='if(gte(iw,ih),-2,min(${o.maxH},iw))':'if(gte(iw,ih),min(${o.maxH},ih),-2)'`);
  }
  const vf = filters.length ? `-vf ${shq(filters.join(','))}` : '';
  const fps = o.vcodec !== 'copy' && o.fps ? `-fpsmax ${o.fps}` : '';
  const aud = o.acodec === 'none' ? '-an'
    : o.acodec === 'copy' ? '-c:a copy'
    : o.acodec === 'opus' ? `-c:a libopus -b:a ${o.abr}k`
    : o.acodec === 'mp3' ? `-c:a libmp3lame -b:a ${o.abr}k`
    : `-c:a aac -b:a ${o.abr}k`;
  const mov = o.container === 'mp4' || o.container === 'mov' ? '-movflags +faststart+use_metadata_tags' : '';
  const fmt = { mp4: 'mp4', mov: 'mov', mkv: 'matroska', webm: 'webm' }[o.container];
  return `${base} -map 0:v:0 -map 0:a:0? -map_metadata 0 ${vidEncoderArgs(o, gpu)} ${vf} ${fps} ${aud} ${mov} -progress pipe:1 -nostats -f ${fmt} ${shq(out)}`;
}

function audCmd(src: string, out: string, o: AudOpts): string {
  const trimIn = o.start ? `-ss ${o.start}` : '';
  const trimOut = o.end && o.end > o.start ? `-t ${(o.end - o.start).toFixed(3)}` : '';
  const af = o.normalize ? `-af loudnorm=I=-16:TP=-1.5:LRA=11` : '';
  const ch = o.mono ? '-ac 1' : '';
  const enc = {
    mp3: [`-c:a libmp3lame -b:a ${o.bitrate}k`, 'mp3'],
    m4a: [`-c:a aac -b:a ${o.bitrate}k -movflags +faststart`, 'ipod'],
    opus: [`-c:a libopus -b:a ${o.bitrate}k`, 'opus'],
    ogg: [`-c:a libopus -b:a ${o.bitrate}k`, 'ogg'],
    flac: ['-c:a flac -compression_level 8', 'flac'],
    wav: ['-c:a pcm_s16le', 'wav'],
  }[o.format];
  return `nice -n 10 ffmpeg -nostdin -v error -y ${trimIn} -i ${shq(src)} ${trimOut} -vn -map 0:a:0 -map_metadata 0 ${af} ${ch} ${enc[0]} -progress pipe:1 -nostats -f ${enc[1]} ${shq(out)}`;
}

// ---------- MozJPEG worker ----------

let mozWorker: Worker | null = null;
const mozWait = new Map<string, (r: { ok: boolean; out?: Uint8Array; error?: string }) => void>();

function mozjpeg(data: Uint8Array, width: number, height: number, quality: number): Promise<Uint8Array> {
  if (!mozWorker) {
    mozWorker = new Worker(new URL('./mozjpeg-worker.ts', import.meta.url).href);
    mozWorker.onmessage = (e: MessageEvent) => {
      const w = mozWait.get(e.data.id);
      mozWait.delete(e.data.id);
      w?.(e.data);
    };
    mozWorker.onerror = (e) => {
      for (const w of mozWait.values()) w({ ok: false, error: String((e as ErrorEvent).message || 'worker error') });
      mozWait.clear();
      mozWorker?.terminate();
      mozWorker = null;
    };
  }
  const id = randomBytes(6).toString('hex');
  return new Promise((resolve, reject) => {
    mozWait.set(id, (r) => (r.ok && r.out ? resolve(r.out) : reject(new Error(r.error || 'MozJPEG falló'))));
    mozWorker!.postMessage({ id, data, width, height, quality }, [data.buffer] as unknown as Transferable[]);
  });
}

// Parse a binary PAM (P7) stream from `magick … pam:-`.
function parsePam(buf: Uint8Array): { width: number; height: number; depth: number; data: Uint8Array } | null {
  const head = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 512)));
  const end = head.indexOf('ENDHDR\n');
  if (!head.startsWith('P7') || end < 0) return null;
  const get = (k: string) => Number(new RegExp(`${k} (\\d+)`).exec(head)?.[1] || 0);
  const width = get('WIDTH'), height = get('HEIGHT'), depth = get('DEPTH');
  const off = end + 7;
  if (!width || !height || depth !== 4 || buf.length < off + width * height * 4) return null;
  return { width, height, depth, data: buf.subarray(off, off + width * height * 4) };
}

async function writeHost(hp: string, data: Uint8Array): Promise<boolean> {
  const proc = hostSpawnInteractive(`cat > ${shq(hp)}`, { user: 'user' });
  const stdin = proc.stdin as { write(d: Uint8Array): unknown; flush(): unknown; end(): void };
  try {
    for (let i = 0; i < data.length; i += 1 << 20) {
      await stdin.write(data.subarray(i, i + (1 << 20)));
      await stdin.flush();
    }
  } catch { /* reported by exit code */ }
  try { stdin.end(); } catch { /* closed */ }
  return (await proc.exited) === 0;
}

// ---------- Jobs ----------

type JobType = 'image' | 'video' | 'audio' | 'transcribe';
type JobState = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'skipped';

interface Job {
  id: string;
  type: JobType;
  itemId: string;
  src: string;
  name: string;
  label: string;
  mode: 'copy' | 'replace';
  onlySmaller: boolean;
  opts: Record<string, unknown>;
  state: JobState;
  stage?: string;
  pct: number;
  error?: string;
  note?: string;
  before: number;
  after?: number;
  out?: unknown;
  outId?: string;
  created: number;
  started?: number;
  finished?: number;
  cookie: string;
  cancel?: () => void;
  cancelled?: boolean;
}

const jobs = new Map<string, Job>();
const LIMITS: Record<JobType, number> = { image: 3, video: 1, audio: 2, transcribe: 1 };
const running: Record<JobType, number> = { image: 0, video: 0, audio: 0, transcribe: 0 };

function publicJob(j: Job) {
  const { cookie, cancel, opts, ...rest } = j;
  void cookie; void cancel;
  return { ...rest, engine: j.type === 'transcribe' ? opts.engine : undefined };
}

function pruneJobs(): void {
  const done = [...jobs.values()].filter((j) => j.finished).sort((a, b) => b.finished! - a.finished!);
  for (const j of done.slice(80)) jobs.delete(j.id);
}

let toolsCtx: LibCtx;

function pumpJobs(): void {
  for (const j of [...jobs.values()].sort((a, b) => a.created - b.created)) {
    if (j.state !== 'queued' || running[j.type] >= LIMITS[j.type]) continue;
    running[j.type]++;
    j.state = 'running';
    j.started = Date.now();
    runJob(j)
      .catch((e) => {
        if (j.state === 'running') {
          j.state = j.cancelled ? 'cancelled' : 'error';
          j.error = j.cancelled ? undefined : String((e as Error)?.message || e).slice(-600);
        }
      })
      .finally(() => {
        running[j.type]--;
        j.finished = Date.now();
        j.cancel = undefined;
        pruneJobs();
        pumpJobs();
      });
  }
}

async function runJob(j: Job): Promise<void> {
  const ctx = toolsCtx;
  const it = ctx.item(j.itemId);
  if (!it || it.p !== j.src) throw new Error('El archivo ya no está en la biblioteca');
  if (j.type === 'transcribe') return runTranscribe(j, it);
  const dir = path.posix.dirname(it.p);
  const tag = randomBytes(4).toString('hex');
  const ext = j.type === 'image' ? (j.opts.format as string) : j.type === 'video' ? (j.opts.container as string) : (j.opts.format as string);
  const outExt = ext === 'jpg' && extOf(it.n) === 'jpeg' ? 'jpeg' : ext === 'tiff' && extOf(it.n) === 'tif' ? 'tif' : ext;
  const tmp = `${dir}/.${stem(it.n)}.axon-${tag}.${outExt}`;
  const pidf = `${ctx.cacheHost()}/run/${tag}.pid`;
  j.cancel = () => {
    j.cancelled = true;
    hostExec(`[ -s ${shq(pidf)} ] && kill -TERM -- -$(cat ${shq(pidf)}) 2>/dev/null; rm -f ${shq(tmp)}`, { user: 'user', timeoutMs: 5000 }).catch(() => {});
  };
  try {
    if (j.type === 'image') await runImage(j, it, tmp, pidf);
    else await runFfmpeg(j, it, tmp, pidf);
    if (j.cancelled) throw new Error('cancelado');
    const st = await stat(hostToContainer(tmp)).catch(() => null);
    if (!st?.size) throw new Error('El resultado quedó vacío');
    j.after = st.size;
    if (j.onlySmaller && st.size >= it.s && outExt === extOf(it.n)) {
      await hostExec(`rm -f ${shq(tmp)}`, { user: 'user', timeoutMs: 5000 });
      j.state = 'skipped';
      j.note = `No se achicó (${fmtSize(st.size)} ≥ ${fmtSize(it.s)}) — se dejó el original`;
      return;
    }
    // Keep the original's date so the library timeline doesn't reorder.
    await hostExec(`touch -r ${shq(it.p)} ${shq(tmp)}`, { user: 'user', timeoutMs: 5000 });
    const carry: Partial<LibItem> = { t: it.t };
    let finalPath: string;
    if (j.mode === 'replace') {
      j.stage = 'replacing';
      const trashed = await ctx.trash(j.cookie, [it.p]);
      if (!trashed.includes(it.p)) throw new Error('No se pudo mover el original a la papelera — el resultado no se aplicó');
      const name = await ctx.freeName(dir, `${stem(it.n)}.${outExt}`);
      finalPath = `${dir}/${name}`;
      const r = await hostExec(`mv -n -- ${shq(tmp)} ${shq(finalPath)}`, { user: 'user', timeoutMs: 60_000 });
      if (!r.ok) throw new Error(`No se pudo ubicar el resultado: ${r.stderr}`);
      ctx.dropPath(it.p);
      ctx.repath(it.p, finalPath);
    } else {
      const want = outExt === extOf(it.n) ? `${stem(it.n)} (optimizado).${outExt}` : `${stem(it.n)}.${outExt}`;
      const name = await ctx.freeName(dir, want);
      finalPath = `${dir}/${name}`;
      const r = await hostExec(`mv -n -- ${shq(tmp)} ${shq(finalPath)}`, { user: 'user', timeoutMs: 60_000 });
      if (!r.ok) throw new Error(`No se pudo guardar la copia: ${r.stderr}`);
    }
    const ni = await ctx.addPath(finalPath, carry);
    if (ni) {
      j.outId = ni.id;
      j.out = ctx.publicItem(ni);
    }
    ctx.touched();
    j.state = 'done';
    j.pct = 100;
  } finally {
    hostExec(`rm -f ${shq(pidf)} ${shq(tmp)}`, { user: 'user', timeoutMs: 5000 }).catch(() => {});
  }
}

async function runImage(j: Job, it: LibItem, out: string, pidf: string): Promise<void> {
  const o = j.opts as unknown as ImgOpts;
  await encodeImage(it, o, out, pidf, j);
}

// Shared by jobs and the live preview.
async function encodeImage(it: LibItem, o: ImgOpts, out: string, pidf: string, j?: Job): Promise<void> {
  const flatten = o.format === 'jpg' || o.format === 'bmp';
  j && (j.stage = 'encoding', j.pct = 10);
  const pre = `S=${shq(it.p)}; O=${shq(out)}; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; echo $$ > ${shq(pidf)};`;
  if (o.format === 'jpg' && (it.w || 0) * (it.h || 0) < 80e6) {
    // Pixels out of ImageMagick as PAM → MozJPEG (WASM) → back to the host.
    const resize = o.maxSide ? `-resize "${o.maxSide}x${o.maxSide}>"` : '';
    const dec = `S=${shq(it.p)}; echo $$ > ${shq(pidf)}; exec magick "$S[0]" -auto-orient ${resize} ${SRGB} -background white -alpha remove -alpha on -type TrueColorAlpha -depth 8 pam:-`;
    const proc = hostSpawn(`nice -n 8 setsid -w bash -c ${shq(dec)}`, { user: 'user' });
    const [buf, code, err] = await Promise.all([
      new Response(proc.stdout as ReadableStream).arrayBuffer(),
      proc.exited,
      new Response(proc.stderr as ReadableStream).text(),
    ]);
    if (code !== 0) throw new Error(`No se pudo leer la imagen: ${err.trim().slice(-300) || `exit ${code}`}`);
    const pam = parsePam(new Uint8Array(buf));
    if (!pam) throw new Error('Decodificación inesperada (PAM)');
    j && (j.pct = 45);
    const jpg = await mozjpeg(pam.data.slice(), pam.width, pam.height, o.quality);
    if (j?.cancelled) throw new Error('cancelado');
    if (!(await writeHost(out, jpg))) throw new Error('No se pudo escribir el resultado');
    j && (j.pct = 90);
    // Copy EXIF (pixels were already converted to sRGB, so no ICC needed).
    const meta = o.keepMeta
      ? `exiftool -q -q -m -overwrite_original -TagsFromFile ${shq(it.p)} -all:all -Orientation= -ThumbnailImage= -PreviewImage= -JpgFromRaw= -ICC_Profile= ${shq(out)} >/dev/null 2>&1 || true`
      : 'true';
    await hostExec(meta, { user: 'user', timeoutMs: 60_000 });
    return;
  }
  const script = `${pre} ${decodeCmd(o, flatten)} && ${encodeCmd(o)} && [ -s "$O" ] && ${metaCmd(o)}`;
  const r = await hostExec(`nice -n 8 setsid -w bash -c ${shq(script)}`, { user: 'user', timeoutMs: 15 * 60_000 });
  if (!r.ok) throw new Error(r.stderr.trim().split('\n').slice(-3).join(' ').slice(-400) || `exit ${r.code}`);
}

async function probeDuration(p: string): Promise<number> {
  const r = await hostExec(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${shq(p)}`, { user: 'user', timeoutMs: 30_000 });
  return Number(r.stdout.trim()) || 0;
}

async function runFfmpeg(j: Job, it: LibItem, out: string, pidf: string): Promise<void> {
  let dur = it.d || (await probeDuration(it.p));
  const o = j.opts as Record<string, number>;
  if (o.end && o.end > (o.start || 0)) dur = o.end - (o.start || 0);
  else if (o.start) dur = Math.max(1, dur - o.start);
  let gpu = false;
  if (j.type === 'video') {
    const vo = j.opts as unknown as VidOpts;
    const c = await getCaps();
    gpu = vo.hw !== 'cpu' && c.nvenc && (vo.vcodec === 'h264' || vo.vcodec === 'h265');
  }
  const attempt = async (useGpu: boolean) => {
    const cmd = j.type === 'video' ? vidCmd(it.p, out, j.opts as unknown as VidOpts, useGpu) : audCmd(it.p, out, j.opts as unknown as AudOpts);
    j.stage = useGpu ? 'encoding-gpu' : 'encoding';
    const proc = hostSpawn(`setsid -w bash -c ${shq(`echo $$ > ${shq(pidf)}; exec ${cmd}`)}`, { user: 'user' });
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
          if (m && dur) j.pct = Math.min(99, Math.max(1, Math.round((Number(m[1]) / 1e6 / dur) * 100)));
        }
      }
    } catch { /* closed */ }
    const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr as ReadableStream).text()]);
    return { code, err: err.trim() };
  };
  let r = await attempt(gpu);
  if (r.code !== 0 && gpu && !j.cancelled) r = await attempt(false);
  if (j.cancelled) throw new Error('cancelado');
  if (r.code !== 0) throw new Error(r.err.split('\n').slice(-3).join(' ').slice(-400) || `ffmpeg salió con ${r.code}`);
}

// ---------- Transcription (on-demand worker) ----------

const ASR_IDLE = Number(process.env.ASR_IDLE_SECONDS || 600);
const ENGINES = {
  whisper: { port: 47961, label: 'Whisper', models: ['turbo', 'large-v3', 'medium', 'small', 'base'] },
  parakeet: { port: 47962, label: 'Parakeet v3', models: ['nemo-parakeet-tdt-0.6b-v3'] },
} as const;
type Engine = keyof typeof ENGINES;
const starting = new Map<Engine, Promise<void>>();

async function asrHealth(engine: Engine): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${ENGINES[engine].port}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

let workerWritten = false;
async function ensureWorkerFile(ctx: LibCtx): Promise<string> {
  const dest = `${ctx.cacheHost()}/bin/transcribe_worker.py`;
  if (workerWritten) return dest;
  const src = await readFile(new URL('./transcribe_worker.py', import.meta.url), 'utf-8');
  await hostExec(`mkdir -p ${shq(path.posix.dirname(dest))}`, { user: 'user', timeoutMs: 10_000 });
  if (!(await writeHost(dest, new TextEncoder().encode(src)))) throw new Error('No se pudo instalar el worker de transcripción');
  workerWritten = true;
  return dest;
}

async function ensureAsr(engine: Engine, j?: Job): Promise<void> {
  if (await asrHealth(engine)) return;
  const pending = starting.get(engine);
  if (pending) return pending;
  const p = (async () => {
    const ctx = toolsCtx;
    const worker = await ensureWorkerFile(ctx);
    const c = await getCaps();
    const port = ENGINES[engine].port;
    const args = `--engine ${engine} --port ${port} --idle ${ASR_IDLE} --models ${shq(ctx.cacheHost() + '/models')}`;
    let cmd: string;
    if (engine === 'whisper') {
      if (!c.whisper) throw new Error('openai-whisper no está instalado en el servidor (pip install openai-whisper)');
      cmd = `exec python3 ${shq(worker)} ${args}`;
    } else {
      if (!c.uv) throw new Error('Parakeet necesita uv instalado en el servidor');
      cmd = `exec uv run -q --with 'onnx-asr[cpu,hub]' python ${shq(worker)} ${args}`;
    }
    const log = `${ctx.cacheHost()}/asr-${engine}.log`;
    const sp = await hostSpawnDetached(cmd, ctx.cacheHost(), log, 'user');
    if (!sp.ok) throw new Error(`No se pudo iniciar ${ENGINES[engine].label}: ${sp.error}`);
    // First Parakeet start installs onnx-asr with uv — can take a while.
    const until = Date.now() + 8 * 60_000;
    while (Date.now() < until) {
      if (j?.cancelled) throw new Error('cancelado');
      await Bun.sleep(700);
      if (await asrHealth(engine)) return;
      const alive = await hostExec(`kill -0 ${sp.pid}`, { user: 'user', timeoutMs: 5000 });
      if (!alive.ok && !(await asrHealth(engine))) {
        const tail = await hostExec(`tail -n 6 ${shq(log)}`, { user: 'user', timeoutMs: 5000 });
        throw new Error(`${ENGINES[engine].label} no arrancó: ${tail.stdout.trim().slice(-400)}`);
      }
    }
    throw new Error(`${ENGINES[engine].label} tardó demasiado en arrancar`);
  })().finally(() => starting.delete(engine));
  starting.set(engine, p);
  return p;
}

interface Segment { start: number; end: number; text: string }
interface Transcript {
  name: string; engine: string; model: string; device?: string; language?: string | null;
  created: number; duration?: number; elapsed?: number; edited?: number; segments: Segment[];
}

const trDir = () => path.join(toolsCtx.libDir, 'transcripts');
const trFile = (tk: string) => path.join(trDir(), `${tk}.json`);
const trSet = new Set<string>();

export async function loadTranscriptIndex(libDir: string): Promise<void> {
  try {
    for (const n of await readdir(path.join(libDir, 'transcripts'))) if (n.endsWith('.json')) trSet.add(n.slice(0, -5));
  } catch { /* none yet */ }
}
export const hasTranscript = (tk: string) => trSet.has(tk);

async function readTranscript(tk: string): Promise<Transcript | null> {
  try { return JSON.parse(await readFile(trFile(tk), 'utf-8')); } catch { return null; }
}

async function saveTranscript(tk: string, t: Transcript): Promise<void> {
  await mkdir(trDir(), { recursive: true });
  await writeFile(trFile(tk) + '.tmp', JSON.stringify(t), 'utf-8');
  await fsRename(trFile(tk) + '.tmp', trFile(tk));
  trSet.add(tk);
}

async function runTranscribe(j: Job, it: LibItem): Promise<void> {
  const engine = (j.opts.engine === 'parakeet' ? 'parakeet' : 'whisper') as Engine;
  j.stage = 'starting';
  j.pct = 0;
  await ensureAsr(engine, j);
  const base = `http://127.0.0.1:${ENGINES[engine].port}`;
  const opts = { model: j.opts.model, language: j.opts.language || null, task: j.opts.task, prompt: j.opts.prompt };
  const r = await fetch(`${base}/jobs`, { method: 'POST', body: JSON.stringify({ path: it.p, opts }), signal: AbortSignal.timeout(10_000) });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
  if (!d.ok || !d.id) throw new Error(d.error || 'El motor rechazó el trabajo');
  const wid = d.id;
  j.cancel = () => {
    j.cancelled = true;
    fetch(`${base}/jobs/${wid}`, { method: 'DELETE', signal: AbortSignal.timeout(3000) }).catch(() => {});
  };
  let misses = 0;
  while (true) {
    await Bun.sleep(1200);
    let s: Record<string, unknown> | null = null;
    try {
      const res = await fetch(`${base}/jobs/${wid}`, { signal: AbortSignal.timeout(5000) });
      s = (await res.json()) as Record<string, unknown>;
    } catch { /* worker busy or gone */ }
    if (!s || s.ok === false) {
      if (++misses > 8) throw new Error('El motor de transcripción se cerró inesperadamente');
      continue;
    }
    misses = 0;
    j.stage = String(s.stage || s.state);
    j.pct = Number(s.pct) || 0;
    if (s.state === 'cancelled') throw new Error('cancelado');
    if (s.state === 'error') throw new Error(String(s.error || 'falló la transcripción'));
    if (s.state === 'done') {
      const res = s.result as Record<string, unknown>;
      const segs = (res.segments as Segment[]) || [];
      await saveTranscript(it.tk, {
        name: it.n,
        engine,
        model: String(res.model || ''),
        device: String(res.device || ''),
        language: (res.language as string) || (j.opts.language as string) || null,
        created: Date.now(),
        duration: Number(res.duration) || it.d,
        elapsed: Number(res.elapsed) || undefined,
        segments: segs,
      });
      j.note = segs.length ? `${segs.length} segmentos · ${res.device === 'cuda' ? 'GPU' : 'CPU'} · ${Math.round(Number(res.elapsed) || 0)} s` : 'No se detectó voz';
      j.outId = it.id;
      j.state = 'done';
      j.pct = 100;
      toolsCtx.touched();
      return;
    }
  }
}

// ---------- Transcript formats ----------

function ts(sec: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
}

export function transcriptAs(t: Transcript, fmt: string): { body: string; mime: string; ext: string } {
  const segs = t.segments || [];
  if (fmt === 'srt') {
    return { ext: 'srt', mime: 'application/x-subrip; charset=utf-8', body: segs.map((s, i) => `${i + 1}\n${ts(s.start, ',')} --> ${ts(s.end, ',')}\n${s.text}\n`).join('\n') };
  }
  if (fmt === 'vtt') {
    return { ext: 'vtt', mime: 'text/vtt; charset=utf-8', body: 'WEBVTT\n\n' + segs.map((s) => `${ts(s.start, '.')} --> ${ts(s.end, '.')}\n${s.text}\n`).join('\n') };
  }
  if (fmt === 'json') return { ext: 'json', mime: 'application/json; charset=utf-8', body: JSON.stringify(t, null, 2) };
  if (fmt === 'tsv') return { ext: 'tsv', mime: 'text/tab-separated-values; charset=utf-8', body: 'start\tend\ttext\n' + segs.map((s) => `${Math.round(s.start * 1000)}\t${Math.round(s.end * 1000)}\t${s.text.replace(/\t/g, ' ')}`).join('\n') };
  if (fmt === 'md') {
    const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
    return { ext: 'md', mime: 'text/markdown; charset=utf-8', body: `# ${t.name}\n\n` + segs.map((s) => `**[${mmss(s.start)}]** ${s.text}`).join('\n\n') + '\n' };
  }
  // Plain text: paragraphs at long pauses.
  let out = '';
  segs.forEach((s, i) => {
    const gap = i ? s.start - segs[i - 1].end : 0;
    out += (i ? (gap > 1.6 ? '\n\n' : ' ') : '') + s.text;
  });
  return { ext: 'txt', mime: 'text/plain; charset=utf-8', body: out + '\n' };
}

export async function transcriptVtt(tk: string): Promise<string | null> {
  if (!trSet.has(tk)) return null;
  const t = await readTranscript(tk);
  return t ? transcriptAs(t, 'vtt').body : null;
}

function dispo(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'transcripcion';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// ---------- Preview cache (Squoosh-style live compare) ----------

const previews = new Map<string, { hp: string; mime: string; t: number }>();
const PREVIEW_MIME: Record<string, string> = { jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', png: 'image/png', jxl: 'image/jxl', heic: 'image/heic', gif: 'image/gif', tiff: 'image/tiff', bmp: 'image/bmp' };

function sweepPreviews(): void {
  const cut = Date.now() - 20 * 60_000;
  for (const [k, v] of previews) {
    if (v.t < cut) {
      previews.delete(k);
      hostExec(`rm -f ${shq(v.hp)}`, { user: 'user', timeoutMs: 5000 }).catch(() => {});
    }
  }
}

// ---------- Routes ----------

const OPS: Record<JobType, string[]> = {
  image: ['image', 'raw', 'vector', 'design'],
  video: ['video'],
  audio: ['audio', 'video'],
  transcribe: ['audio', 'video'],
};

export function registerLibraryTools(app: Hono, ctx: LibCtx): void {
  toolsCtx = ctx;
  loadTranscriptIndex(ctx.libDir).catch(() => {});
  ctx.ready().then(() => hostExec(`mkdir -p ${shq(ctx.cacheHost() + '/run')} ${shq(ctx.cacheHost() + '/previews')} ${shq(ctx.cacheHost() + '/models')}`, { user: 'user', timeoutMs: 10_000 })).catch(() => {});
  setInterval(sweepPreviews, 5 * 60_000).unref();

  app.get('/api/library/tools/caps', async (c) => {
    await ctx.ready();
    const k = await getCaps();
    const [wh, pk] = await Promise.all([asrHealth('whisper'), asrHealth('parakeet')]);
    return c.json({
      ok: true, caps: k,
      presets: Object.fromEntries(Object.entries(VPRESETS).map(([key, v]) => [key, v.label])),
      asr: { idle: ASR_IDLE, whisper: wh, parakeet: pk, models: { whisper: ENGINES.whisper.models, parakeet: ENGINES.parakeet.models } },
    });
  });

  app.post('/api/library/tools/run', async (c) => {
    await ctx.ready();
    const b = await c.req.json<{ ids: string[]; op: JobType; opts?: Record<string, unknown>; mode?: string; onlySmaller?: boolean }>().catch(() => ({} as never));
    const op = b.op;
    if (!OPS[op]) return fail(c, 400, 'Operación inválida');
    const ids = Array.isArray(b.ids) ? b.ids.slice(0, 500) : [];
    const list = ids.map((id) => ctx.item(id)).filter(Boolean) as LibItem[];
    if (!list.length) return fail(c, 400, 'Nada para procesar');
    const k = await getCaps();
    const created: unknown[] = [];
    const skipped: string[] = [];
    for (const it of list) {
      if (!OPS[op].includes(it.k)) { skipped.push(it.n); continue; }
      let opts: Record<string, unknown>;
      let label: string;
      if (op === 'image') {
        const o = imgOpts(b.opts || {}, it.e);
        if (o.format === 'jxl' && !k.jxl) return fail(c, 400, 'JPEG XL no está disponible (instalá libjxl-tools)');
        if (o.format === 'heic' && !k.heic) return fail(c, 400, 'HEIC no está disponible (instalá libheif-examples y libheif-plugin-x265)');
        opts = o as unknown as Record<string, unknown>;
        label = imgLabel(o);
      } else if (op === 'video') {
        const o = vidOpts(b.opts || {});
        opts = o as unknown as Record<string, unknown>;
        label = o.label === 'Personalizado'
          ? [o.container.toUpperCase(), o.container === 'gif' ? `${o.gifWidth}px` : o.vcodec.toUpperCase(), o.vcodec !== 'copy' && o.container !== 'gif' ? `CRF ${o.crf}` : '', o.maxH ? `${o.maxH}p` : ''].filter(Boolean).join(' · ')
          : o.label;
      } else if (op === 'audio') {
        const o = audOpts(b.opts || {});
        opts = o as unknown as Record<string, unknown>;
        label = `${o.format.toUpperCase()}${['flac', 'wav'].includes(o.format) ? '' : ` · ${o.bitrate} kbps`}${o.mono ? ' · mono' : ''}${o.normalize ? ' · normalizado' : ''}`;
      } else {
        const engine = b.opts?.engine === 'parakeet' ? 'parakeet' : 'whisper';
        const models = ENGINES[engine].models as readonly string[];
        const model = models.includes(String(b.opts?.model)) ? String(b.opts?.model) : models[0];
        const lang = /^[a-z]{2,3}$/.test(String(b.opts?.language || '')) ? String(b.opts?.language) : '';
        opts = { engine, model, language: lang, task: b.opts?.task === 'translate' ? 'translate' : 'transcribe', prompt: String(b.opts?.prompt || '').slice(0, 600) };
        label = `${ENGINES[engine].label}${engine === 'whisper' ? ` ${model}` : ''}${lang ? ` · ${lang}` : ''}${opts.task === 'translate' ? ' · traducir a inglés' : ''}`;
      }
      const j: Job = {
        id: randomBytes(6).toString('base64url'),
        type: op, itemId: it.id, src: it.p, name: it.n, label,
        mode: op !== 'transcribe' && b.mode === 'replace' ? 'replace' : 'copy',
        onlySmaller: b.onlySmaller !== false && op !== 'transcribe',
        opts, state: 'queued', pct: 0, before: it.s, created: Date.now(),
        cookie: c.req.header('cookie') || '',
      };
      jobs.set(j.id, j);
      created.push(publicJob(j));
    }
    pumpJobs();
    if (!created.length) return fail(c, 400, 'Ningún archivo seleccionado admite esta operación');
    return c.json({ ok: true, jobs: created, skipped });
  });

  app.get('/api/library/tools/jobs', (c) => {
    const list = [...jobs.values()].sort((a, b) => b.created - a.created).map(publicJob);
    return c.json({ ok: true, jobs: list, active: list.filter((j) => j.state === 'queued' || j.state === 'running').length });
  });

  app.delete('/api/library/tools/jobs/:jid', (c) => {
    const j = jobs.get(c.req.param('jid'));
    if (!j) return fail(c, 404, 'Trabajo no encontrado');
    if (j.state === 'queued') { j.state = 'cancelled'; j.finished = Date.now(); }
    else if (j.state === 'running') j.cancel?.();
    else jobs.delete(j.id);
    return c.json({ ok: true });
  });

  app.post('/api/library/tools/jobs/clear', (c) => {
    for (const j of [...jobs.values()]) if (j.finished) jobs.delete(j.id);
    return c.json({ ok: true });
  });

  // Squoosh-style live preview: encode once into the cache, return size.
  app.post('/api/library/tools/preview', async (c) => {
    await ctx.ready();
    const b = await c.req.json<{ id: string; opts?: Record<string, unknown> }>().catch(() => ({} as never));
    const it = ctx.item(String(b.id || ''));
    if (!it || !OPS.image.includes(it.k)) return fail(c, 404, 'Imagen no encontrada');
    const o = imgOpts(b.opts || {}, it.e);
    const k = await getCaps();
    if ((o.format === 'jxl' && !k.jxl) || (o.format === 'heic' && !k.heic)) return fail(c, 400, 'Formato no disponible en el servidor');
    const key = randomBytes(8).toString('hex');
    const hp = `${ctx.cacheHost()}/previews/${key}.${o.format}`;
    const t0 = Date.now();
    try {
      await encodeImage(it, o, hp, `${ctx.cacheHost()}/run/${key}.pid`);
    } catch (e) {
      return fail(c, 500, 'No se pudo generar la vista previa', { detail: String((e as Error).message || e) });
    }
    const st = await stat(hostToContainer(hp)).catch(() => null);
    if (!st) return fail(c, 500, 'La vista previa quedó vacía');
    previews.set(key, { hp, mime: PREVIEW_MIME[o.format] || 'application/octet-stream', t: Date.now() });
    return c.json({ ok: true, url: `/api/library/tools/preview/${key}`, size: st.size, before: it.s, ms: Date.now() - t0, format: o.format, label: imgLabel(o) });
  });

  app.get('/api/library/tools/preview/:key', (c) => {
    const p = previews.get(c.req.param('key'));
    if (!p) return c.text('Vencida', 404);
    const f = Bun.file(hostToContainer(p.hp));
    return new Response(f as unknown as BodyInit, { headers: { 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=1200' } });
  });

  // ---- Transcripts ----
  app.get('/api/library/transcript/:id', async (c) => {
    const it = ctx.item(c.req.param('id'));
    if (!it) return fail(c, 404, 'Archivo no encontrado');
    const t = trSet.has(it.tk) ? await readTranscript(it.tk) : null;
    if (!t) return fail(c, 404, 'Sin transcripción');
    return c.json({ ok: true, transcript: t });
  });

  app.get('/api/library/transcript/:id/export', async (c) => {
    const it = ctx.item(c.req.param('id'));
    const t = it && trSet.has(it.tk) ? await readTranscript(it.tk) : null;
    if (!it || !t) return c.text('Sin transcripción', 404);
    const out = transcriptAs(t, c.req.query('fmt') || 'txt');
    const headers: Record<string, string> = { 'Content-Type': out.mime, 'Cache-Control': 'no-store' };
    if (c.req.query('dl') === '1') headers['Content-Disposition'] = dispo(`${stem(it.n)}.${out.ext}`);
    return new Response(out.body, { headers });
  });

  app.put('/api/library/transcript/:id', async (c) => {
    const it = ctx.item(c.req.param('id'));
    const t = it && trSet.has(it.tk) ? await readTranscript(it.tk) : null;
    if (!it || !t) return fail(c, 404, 'Sin transcripción');
    const b = await c.req.json<{ segments?: Segment[] }>().catch(() => ({} as never));
    if (!Array.isArray(b.segments)) return fail(c, 400, 'Segmentos inválidos');
    t.segments = b.segments
      .filter((s) => s && Number.isFinite(Number(s.start)) && Number.isFinite(Number(s.end)))
      .slice(0, 50_000)
      .map((s) => ({ start: Number(s.start), end: Number(s.end), text: String(s.text || '').slice(0, 4000) }))
      .filter((s) => s.text.trim());
    t.edited = Date.now();
    await saveTranscript(it.tk, t);
    return c.json({ ok: true });
  });

  app.delete('/api/library/transcript/:id', async (c) => {
    const it = ctx.item(c.req.param('id'));
    if (!it) return fail(c, 404, 'Archivo no encontrado');
    await unlink(trFile(it.tk)).catch(() => {});
    trSet.delete(it.tk);
    ctx.touched();
    return c.json({ ok: true });
  });

  // Write .srt / .txt / .vtt next to the media file (same base name, so
  // players pick the subtitles up automatically).
  app.post('/api/library/transcript/:id/save', async (c) => {
    const it = ctx.item(c.req.param('id'));
    const t = it && trSet.has(it.tk) ? await readTranscript(it.tk) : null;
    if (!it || !t) return fail(c, 404, 'Sin transcripción');
    const b = await c.req.json<{ formats?: string[]; overwrite?: boolean }>().catch(() => ({} as never));
    const fmts = (b.formats || ['srt']).filter((f) => ['srt', 'vtt', 'txt', 'md', 'json'].includes(f));
    if (!fmts.length) return fail(c, 400, 'Elegí al menos un formato');
    const dir = path.posix.dirname(it.p);
    const saved: string[] = [];
    for (const f of fmts) {
      const out = transcriptAs(t, f);
      const want = `${stem(it.n)}.${out.ext}`;
      const name = b.overwrite ? want : await ctx.freeName(dir, want);
      const dest = `${dir}/${name}`;
      if (!(await writeHost(dest, new TextEncoder().encode(out.body)))) return fail(c, 500, `No se pudo guardar ${name}`);
      saved.push(dest);
      await ctx.addPath(dest);
    }
    ctx.touched();
    return c.json({ ok: true, saved });
  });

  app.post('/api/library/asr/:engine/stop', async (c) => {
    const engine = c.req.param('engine') as Engine;
    if (!ENGINES[engine]) return fail(c, 404, 'Motor desconocido');
    await fetch(`http://127.0.0.1:${ENGINES[engine].port}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(3000) }).catch(() => {});
    return c.json({ ok: true });
  });
}
