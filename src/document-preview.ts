import { constants } from 'node:fs';
import { open, stat, lstat, mkdir, mkdtemp, readdir, rename, rm, copyFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { hostToContainer } from './host';

export const OFFICE_EXTENSIONS = new Set('doc docx docm dot dotx odt ott rtf ppt pptx pptm pps ppsx pot potx odp otp xls xlsx xlsm xlt xltx ods ots'.split(' '));
const SPREADSHEET_EXTENSIONS = new Set('xls xlsx xlsm xlt xltx ods ots'.split(' '));
const MAX_BYTES = 100 * 1024 * 1024;
const CACHE_BYTES = 512 * 1024 * 1024;
type State = 'none' | 'queued' | 'running' | 'done' | 'error';
type Job = { state: State; key: string; kind?: 'pdf' | 'table'; error?: string; file?: string };
export class DocumentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const signature = (s: Awaited<ReturnType<typeof stat>>) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;

// One cache and bounded queue for both Files and Library. No shell/path input
// enters a command. Cache keys bind renditions to the complete source identity.
export class DocumentPreviews {
  private jobs = new Map<string, Job>();
  private waiting: (() => Promise<void>)[] = [];
  private running = 0;
  private pruning: Promise<void> | undefined;
  constructor(private cache = path.join(path.dirname(process.env.CONFIG_PATH || 'data/config.json'), 'document-previews')) {}

  private async source(hostPath: string) {
    const ext = path.extname(hostPath).slice(1).toLowerCase();
    if (!OFFICE_EXTENSIONS.has(ext)) throw new DocumentError('Este formato no tiene conversión de documentos.', 415);
    const cp = hostToContainer(hostPath);
    const fh = await open(cp, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => { throw new DocumentError('No se pudo leer el documento.', 404); });
    try {
      const st = await fh.stat();
      if (!st.isFile()) throw new DocumentError('No es un archivo regular.');
      if (st.size > MAX_BYTES) throw new DocumentError('El visor admite documentos de hasta 100 MB. Podés descargar el original.', 413);
      if (!st.size) throw new DocumentError('El documento está vacío.', 415);
      const version = signature(st);
      const key = createHash('sha256').update(`office-v2|${hostPath}|${version}`).digest('hex');
      return { fh, cp, ext, version, key, size: st.size };
    } catch (e) { await fh.close(); throw e; }
  }

  async request(hostPath: string, start = false, retry = false): Promise<Job> {
    const source = await this.source(hostPath);
    const { key } = source;
    try {
      const kind = SPREADSHEET_EXTENSIONS.has(source.ext) ? 'table' : 'pdf';
      const suffix = kind === 'table' ? '.json' : '.pdf';
      const file = path.join(this.cache, key + suffix);
      const cached = await stat(file).catch(() => null);
      if (cached?.isFile() && cached.size > 5) return { state: 'done', key, kind, file };
      const current = this.jobs.get(key);
      if (current && !(retry && current.state === 'error') && current.state !== 'done') return { ...current };
      if (!start) return { state: 'none', key };
      if (this.waiting.length >= 16) throw new DocumentError('El visor está ocupado. Reintentá en unos segundos.', 429);
      // Finished states are bounded; queued/running jobs must retain identity.
      for (const [id, job] of this.jobs) {
        if (this.jobs.size < 128) break;
        if (job.state === 'error' || job.state === 'done') this.jobs.delete(id);
      }
      const job: Job = { state: 'queued', key, kind };
      this.jobs.set(key, job);
      this.waiting.push(async () => {
        job.state = 'running';
        let work: string | undefined;
        let input: Awaited<ReturnType<DocumentPreviews['source']>> | undefined;
        try {
          input = await this.source(hostPath);
          if (input.key !== key) throw new DocumentError('El documento cambió. Volvé a abrirlo.', 409);
          await mkdir(this.cache, { recursive: true, mode: 0o700 });
          work = await mkdtemp(path.join(this.cache, '.work-'));
          const staged = await open(path.join(work, 'input.' + input.ext), 'wx', 0o600);
          try {
            const chunk = Buffer.alloc(1024 * 1024);
            let position = 0;
            while (position < input.size) {
              const { bytesRead } = await input.fh.read(chunk, 0, Math.min(chunk.length, input.size - position), position);
              if (!bytesRead) throw new DocumentError('El documento cambió durante la lectura.', 409);
              for (let off = 0; off < bytesRead;) {
                const { bytesWritten } = await staged.write(chunk, off, bytesRead - off);
                if (!bytesWritten) throw new Error('Incomplete staging write');
                off += bytesWritten;
              }
              position += bytesRead;
            }
            if (signature(await input.fh.stat()) !== input.version) throw new DocumentError('El documento cambió durante la lectura.', 409);
          } finally { await staged.close(); }
          const proc = Bun.spawn(['timeout', '-k', '5', '75', 'python3', new URL('./document-convert.py', import.meta.url).pathname, work, input.ext], {
            stdout: 'pipe', stderr: 'ignore', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
          });
          const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
          const result = JSON.parse(out || '{}');
          if (code || !result.ok) throw new DocumentError(result.error || 'No se pudo generar la vista previa.', 415);
          // Atomic replacement of the original must not publish an old rendition.
          if (signature(await stat(input.cp)) !== input.version) throw new DocumentError('El documento cambió. Volvé a abrirlo.', 409);
          await mkdir(this.cache, { recursive: true, mode: 0o700 });
          // Work/cache may live on different volumes: atomic publish in cache.
          const partial = file + '.' + crypto.randomUUID() + '.part';
          try {
            await copyFile(path.join(work, 'input' + suffix), partial, constants.COPYFILE_EXCL);
            await chmod(partial, 0o600);
            await rename(partial, file);
          } finally { await rm(partial, { force: true }); }
          job.state = 'done'; job.file = file;
          this.pruning ||= this.prune().catch(() => {}).finally(() => { this.pruning = undefined; });
        } catch (e) {
          job.state = 'error'; job.error = e instanceof DocumentError ? e.message : 'No se pudo preparar el documento. Podés reintentar o descargar el original.';
        } finally {
          await input?.fh.close().catch(() => {});
          if (work) await rm(work, { recursive: true, force: true }).catch(() => {});
        }
      });
      this.drain();
      return { ...job };
    } finally { await source.fh.close(); }
  }

  private drain() {
    while (this.running < 2 && this.waiting.length) {
      const task = this.waiting.shift()!;
      this.running++;
      void task().finally(() => { this.running--; this.drain(); });
    }
  }

  private async prune() {
    const names = await readdir(this.cache);
    for (const name of names.filter(n => /^\.work-[A-Za-z0-9]+$/.test(n))) {
      const file = path.join(this.cache, name), st = await lstat(file).catch(() => null);
      if (st?.isDirectory() && !st.isSymbolicLink() && Date.now() - st.mtimeMs > 3600000) await rm(file, { recursive: true, force: true });
    }
    for (const name of names.filter(n => /^[a-f0-9]{64}\.[a-f0-9-]+\.part$/.test(n))) {
      const file = path.join(this.cache, name), st = await stat(file).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 3600000) await rm(file, { force: true });
    }
    const entries = await Promise.all(names.filter(n => /^[a-f0-9]{64}\.(?:pdf|json)$/.test(n)).map(async n => {
      const file = path.join(this.cache, n), st = await stat(file).catch(() => null);
      return st ? { file, size: st.size, time: st.mtimeMs } : null;
    }));
    const files = entries.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.time - a.time);
    let bytes = 0;
    for (const [i, entry] of files.entries()) {
      bytes += entry.size;
      if (i >= 100 || bytes > CACHE_BYTES || Date.now() - entry.time > 7 * 86400000) await rm(entry.file, { force: true });
    }
  }
}

export const documentPreviews = new DocumentPreviews();

// Routes revalidate their own authorization before calling this, including
// before serving a cached file. A cache hit never bypasses root/disk guards.
export async function documentResponse(hostPath: string, request: Request, baseUrl: string): Promise<Response> {
  const url = new URL(request.url);
  try {
    const job = await documentPreviews.request(hostPath, request.method === 'POST', url.searchParams.get('retry') === '1');
    const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    if (url.searchParams.get('asset') === '1') {
      if (job.state !== 'done' || !job.file) throw new DocumentError('La vista previa todavía no está lista.', 409);
      // The version in the URL prevents a stale viewer from receiving another
      // rendition after an overwrite while it is still rendering.
      if (url.searchParams.get('v') !== job.key) throw new DocumentError('El documento cambió. Volvé a abrirlo.', 409);
      return new Response(Bun.file(job.file), { headers: { ...headers, 'Content-Type': job.kind === 'table' ? 'application/json' : 'application/pdf', 'Content-Disposition': 'inline' } });
    }
    const asset = new URL(baseUrl, url.origin); asset.searchParams.set('asset', '1'); asset.searchParams.set('v', job.key);
    return Response.json({ ok: true, state: job.state, kind: job.kind, error: job.error, version: job.key, ...(job.state === 'done' ? { url: asset.pathname + asset.search } : {}) }, { headers });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof DocumentError ? e.message : 'No se pudo leer el documento.' }, { status: e instanceof DocumentError ? e.status : 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
