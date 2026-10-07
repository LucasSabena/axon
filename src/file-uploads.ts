import type { Hono } from 'hono';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import { hostExec, hostSpawnInteractive, hostToContainer, killHostProc } from './host';

// The limit is per request, never per file. Memory stays bounded even for
// multi-GB files, and each request fits comfortably through a reverse proxy.
const CHUNK_BYTES = 8 * 1024 * 1024;
const IDLE_MS = 60 * 60 * 1000;
// A single block may be slow, but a dribbling client must not pin the `cat >>`
// writer and the per-upload mutex forever. Generous bound for weak uplinks.
const APPEND_TIMEOUT_MS = 15 * 60 * 1000;
const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
type Resolve = (input: string | undefined | null) => Promise<{ path?: string; error?: string; status?: number }>;
interface Upload {
  dir: string;
  dest: string;
  size: number;
  received: number;
  touched: number;
  cancelled: boolean;
  completed?: boolean;
  operation?: Promise<void>;
}

// A retry still carries its block. Consume that bounded body before answering
// 409: browsers behind a proxy can otherwise stall while sending the body to
// an origin that already returned without reading it.
async function discard(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > CHUNK_BYTES) { await reader.cancel(); break; }
    }
  } catch { /* disconnected retry */ }
  finally { reader.releaseLock(); }
}

// Stream to the host, applying backpressure instead of assembling a Buffer.
export async function appendUploadBlock(part: string, body: ReadableStream<Uint8Array>, max: number, timeoutMs = APPEND_TIMEOUT_MS): Promise<number> {
  const proc = hostSpawnInteractive(`cat >> ${shq(part)}`, { user: 'user' });
  const stdin = proc.stdin as { write(d: Uint8Array): number | Promise<number>; flush(): number | Promise<number>; end(): void };
  const stderr = new Response(proc.stderr as ReadableStream).text();
  const reader = body.getReader();
  let bytes = 0;
  let failure: unknown;
  const timer = setTimeout(() => {
    failure = new Error('El bloque tardó demasiado; la subida quedó interrumpida');
    killHostProc(proc);
    try { void reader.cancel().catch(() => {}); } catch { /* reader already released */ }
  }, timeoutMs);
  try {
    while (true) {
      if (failure) throw failure;
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) throw new Error('El bloque supera el tamaño permitido');
      // FileSink.write may accept only part of the chunk — re-offer the rest
      // so the staged file never silently undercounts.
      for (let off = 0; off < value.byteLength;) {
        const n = Number(await stdin.write(value.subarray(off)));
        if (n <= 0) throw new Error('No se pudo escribir el bloque');
        off += n;
      }
      await stdin.flush();
    }
    if (!bytes) throw new Error('Bloque vacío');
  } catch (err) {
    failure = failure ?? err;
    // Cancellation belongs to the transport; an unresolved cancel promise must
    // not pin the writer or its upload mutex after a rejected block.
    killHostProc(proc);
    void reader.cancel().catch(() => {});
  } finally {
    reader.releaseLock();
    try { stdin.end(); } catch { /* process already closed */ }
  }
  try {
    const [code, detail] = await Promise.all([proc.exited, stderr]);
    if (failure) throw failure;
    if (code !== 0) throw new Error(detail.trim().slice(0, 500) || 'No se pudo escribir el bloque');
    return bytes;
  } finally { clearTimeout(timer); }
}

export function registerFileUploadRoutes(app: Hono, resolve: Resolve): void {
  const uploads = new Map<string, Upload>();
  const remove = async (id: string, u: Upload) => {
    u.cancelled = true;
    await u.operation;
    const r = await hostExec(`rm -rf -- ${shq(u.dir)}`, { user: 'user', timeoutMs: 15_000 });
    if (r.ok) uploads.delete(id);
    return r;
  };
  const sweeper = setInterval(() => {
    for (const [id, u] of uploads) {
      // `touched` is stamped when a block starts and again when it settles, so
      // an operation still running past IDLE_MS is a stuck upload: reap it too
      // instead of letting a dribbling chunk keep the staging dir immortal.
      if (Date.now() - u.touched > IDLE_MS) void remove(id, u);
    }
  }, 60_000);
  sweeper.unref();

  app.post('/api/files/upload/init', async (c) => {
    const b = await c.req.json<{ path: string; name: string; size: number }>().catch(() => null);
    if (!b || !Number.isSafeInteger(b.size) || b.size < 0) return c.json({ ok: false, error: 'Tamaño inválido' }, 400);
    if (typeof b.name !== 'string' || !b.name || b.name === '.' || b.name === '..' || /[/\\\x00-\x1f\x7f]/.test(b.name) ||
        Buffer.byteLength(b.name, 'utf8') > 255) {
      return c.json({ ok: false, error: 'Nombre de archivo inválido' }, 400);
    }
    if (typeof b.path !== 'string') return c.json({ ok: false, error: 'Ruta inválida' }, 400);
    const rd = await resolve(b.path);
    if (!rd.path) return c.json({ ok: false, error: rd.error }, (rd.status ?? 403) as 403);
    const mk = await hostExec(`mkdir -p -- ${shq(rd.path)}`, { user: 'user', timeoutMs: 15_000 });
    if (!mk.ok) return c.json({ ok: false, error: 'No se pudo crear la carpeta destino', detail: mk.stderr }, 500);
    const dest = await resolve(path.posix.join(rd.path, b.name));
    if (!dest.path) return c.json({ ok: false, error: dest.error }, (dest.status ?? 403) as 403);
    // Stage on the destination filesystem so final rename is atomic, including
    // overwrite. An interrupted upload never truncates the original file.
    const parent = path.posix.dirname(dest.path);
    const df = await hostExec(`df -B1 --output=avail -- ${shq(parent)}`, { user: 'user', timeoutMs: 10_000 });
    const available = Number(df.stdout.trim().split('\n').pop());
    if (df.ok && Number.isFinite(available) && b.size > available) return c.json({ ok: false, error: 'No hay espacio suficiente en el disco' }, 507);
    const temp = await hostExec(`mktemp -d -- ${shq(parent + '/.axon-upload.XXXXXXXXXX')}`, { user: 'user', timeoutMs: 10_000 });
    if (!temp.ok) return c.json({ ok: false, error: 'No se pudo iniciar la subida', detail: temp.stderr }, 500);
    const dir = temp.stdout.trim();
    const id = crypto.randomUUID();
    uploads.set(id, { dir, dest: dest.path, size: b.size, received: 0, touched: Date.now(), cancelled: false });
    return c.json({ ok: true, id, chunkSize: CHUNK_BYTES });
  });

  app.put('/api/files/upload/:id', async (c) => {
    const id = c.req.param('id');
    const u = uploads.get(id);
    // Every early return drains the bounded body first (same rationale as the
    // 409s above): a proxy stalls if we answer while the client still sends.
    if (!u || u.cancelled) {
      await discard(c.req.raw.body);
      return c.json({ ok: false, error: 'Subida no encontrada o cancelada' }, 404);
    }
    if (u.completed) {
      await discard(c.req.raw.body);
      return c.json({ ok: false, error: 'Subida completa', received: u.received }, 409);
    }
    if (u.operation) {
      await discard(c.req.raw.body);
      return c.json({ ok: false, error: 'Hay un bloque en curso' }, 409);
    }
    const offset = Number(c.req.query('offset'));
    if (!Number.isSafeInteger(offset) || offset < 0) {
      await discard(c.req.raw.body);
      return c.json({ ok: false, error: 'Offset inválido' }, 400);
    }
    if (offset !== u.received) {
      await discard(c.req.raw.body);
      return c.json({ ok: false, error: 'Offset desactualizado', received: u.received }, 409);
    }
    const body = c.req.raw.body;
    if (!body) return c.json({ ok: false, error: 'Bloque vacío o subida completa' }, 400);
    if (u.received === u.size) {
      await discard(body);
      return c.json({ ok: false, error: 'Bloque vacío o subida completa' }, 400);
    }
    const part = u.dir + '/data';
    let unlock!: () => void;
    u.operation = new Promise<void>((r) => { unlock = r; });
    u.touched = Date.now();
    try {
      const bytes = await appendUploadBlock(part, body, Math.min(CHUNK_BYTES, u.size - u.received));
      u.received += bytes;
      return c.json({ ok: true, received: u.received });
    } catch (err) {
      // Roll back even a partially written request; retry starts at the last
      // acknowledged offset, never in the middle of a failed block.
      const r = await hostExec(`truncate -s ${u.received} -- ${shq(part)}`, { user: 'user', timeoutMs: 10_000 });
      if (!r.ok) u.cancelled = true;
      return c.json({ ok: false, error: 'No se pudo subir el bloque', detail: String(err), received: u.received }, 500);
    } finally {
      u.touched = Date.now();
      u.operation = undefined;
      unlock();
    }
  });

  app.post('/api/files/upload/:id/finish', async (c) => {
    const id = c.req.param('id');
    const u = uploads.get(id);
    if (!u || u.cancelled) return c.json({ ok: false, error: 'Subida no encontrada o cancelada' }, 404);
    if (u.operation) return c.json({ ok: false, error: 'Subida en curso' }, 409);
    if (u.completed) return c.json({ ok: true, path: u.dest, size: u.size });
    if (u.received !== u.size) return c.json({ ok: false, error: 'Subida incompleta', received: u.received }, 400);
    let unlock!: () => void;
    u.operation = new Promise<void>((r) => { unlock = r; });
    try {
      // Recheck the allowlist in case a parent symlink changed during upload.
      const dest = await resolve(u.dest);
      if (dest.path !== u.dest) return c.json({ ok: false, error: dest.error || 'La ruta destino cambió' }, (dest.status ?? 403) as 403);
      const part = u.dir + '/data';
      if (!u.size) {
        const r = await hostExec(`: > ${shq(part)}`, { user: 'user', timeoutMs: 10_000 });
        if (!r.ok) return c.json({ ok: false, error: 'No se pudo crear el archivo vacío' }, 500);
      }
      const s = await stat(hostToContainer(part)).catch(() => null);
      if (s?.size !== u.size) return c.json({ ok: false, error: 'El tamaño recibido no coincide' }, 400);
      const r = await hostExec(`mv -fT -- ${shq(part)} ${shq(u.dest)}`, { user: 'user', timeoutMs: 30_000 });
      if (!r.ok) return c.json({ ok: false, error: 'No se pudo guardar el archivo', detail: r.stderr }, 500);
      u.completed = true;
      u.touched = Date.now();
      await hostExec(`rmdir -- ${shq(u.dir)}`, { user: 'user', timeoutMs: 10_000 });
      return c.json({ ok: true, path: u.dest, size: u.size });
    } finally {
      u.operation = undefined;
      unlock();
    }
  });

  app.delete('/api/files/upload/:id', async (c) => {
    const id = c.req.param('id');
    const u = uploads.get(id);
    if (u) {
      const r = await remove(id, u);
      if (!r.ok) return c.json({ ok: false, error: 'No se pudo limpiar la subida', detail: r.stderr }, 500);
    }
    return c.json({ ok: true });
  });
}
