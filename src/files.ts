import { Hono } from 'hono';
import { hostExec, hostSpawnInteractive, hostToContainer, containerToHost, hostExists, HOST_USER } from './host';
import { readdir, stat, lstat, open, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
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
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm',
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip',
  tar: 'application/x-tar', wasm: 'application/wasm', woff: 'font/woff',
  woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
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

export function registerFilesRoutes(app: Hono): void {
  // ---------- List directory ----------
  app.get('/api/files', async (c) => {
    const r = await resolveAllowed(c.req.query('path'));
    if (!r.path) return c.json({ ok: false, error: r.error }, 403);
    const cp = hostToContainer(r.path);

    let dirents;
    try {
      dirents = await readdir(cp, { withFileTypes: true });
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
        try {
          const st = await lstat(cfull);
          ent.size = st.size;
          ent.mtime = st.mtimeMs;
          ent.mode = (st.mode & 0o7777).toString(8);
          if (st.isSymbolicLink()) {
            ent.type = 'link';
            // A symlink to a dir navigates like a dir when the target resolves.
            try {
              const t = await stat(cfull);
              if (t.isDirectory()) ent.type = 'dir';
              ent.size = t.size;
              ent.mtime = t.mtimeMs;
            } catch { /* broken / absolute-outside-mount link stays 'link' */ }
          } else if (st.isDirectory()) {
            ent.type = 'dir';
            ent.size = 0;
          }
        } catch { /* entry vanished mid-listing — keep defaults */ }
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

    const name = path.posix.basename(f.name || 'archivo').replace(/[^\S ]/g, '');
    if (!name || name === '.' || name === '..') {
      return c.json({ ok: false, error: 'Nombre de archivo inválido' }, 400);
    }
    const rt = await resolveAllowed(path.posix.join(rd.path, name));
    if (!rt.path) return c.json({ ok: false, error: rt.error }, 403);

    const buf = Buffer.from(await f.arrayBuffer());
    const res = await writeHostFile(rt.path, buf);
    if (!res.ok) return c.json({ ok: false, error: res.error, detail: res.detail }, 500);
    return c.json({ ok: true, path: rt.path, size: buf.length });
  });
}
