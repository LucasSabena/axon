import { Hono } from 'hono';
import { $ } from 'bun';
import { hostExec, hostSpawnInteractive, hostToContainer, containerToHost, HOST_USER } from './host';
import { runJob } from './jobs';
import { realpath, stat, open } from 'node:fs/promises';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Compose feature module — Docker Compose visual editor backend.
// Self-contained: index.ts only calls registerComposeRoutes(app).
//
// Reads go through hostToContainer() (the /hostfs read-only mount). Writes MUST
// stream through stdin of a host-side `cat > dest` because the mount is RO.
// Mutations run as the unprivileged HOST_USER account. `docker` may not exist
// in-container — dockerCmd() falls back to hostExec like src/docker-ops.ts.
// ---------------------------------------------------------------------------

function fail(c: any, status: number, error: string, extra?: Record<string, unknown>) {
  return c.json({ ok: false, error, ...extra }, status);
}

// POSIX single-quote escaping: 'foo'bar' -> 'foo'"'"'bar'
const shq = (s: string) => `'${String(s).replace(/'/g, `'"'"'`)}'`;

const MAX_READ_BYTES = 512 * 1024; // GET /api/compose/file truncates past this
const MAX_SAVE_BYTES = 256 * 1024; // POST /api/compose/save refuses bigger
const MAX_RENDER_BYTES = 200 * 1024; // preview `config` output cap

// Roots a compose file must live under. $HOME is resolved lazily.
const STATIC_ROOTS = ['/opt', '/srv', '/etc', '/tmp'];

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

// Normalize + validate a client-supplied compose file path. Must end in
// .yml/.yaml and resolve under [home, /opt, /srv, /etc, /tmp] — the deepest
// existing ancestor is realpath'd and re-checked so a symlink under an allowed
// root can't escape the allowlist (same approach as src/files.ts).
async function resolveComposePath(input: string | undefined | null): Promise<{ path?: string; error?: string }> {
  const home = await homeDir();
  let raw = (input ?? '').trim();
  if (!raw) return { error: 'Falta la ruta del archivo' };
  if (raw === '~') raw = home;
  else if (raw.startsWith('~/')) raw = home + raw.slice(1);

  let p: string;
  try {
    p = path.posix.resolve(raw);
  } catch {
    return { error: 'Ruta inválida' };
  }
  if (!/\.ya?ml$/i.test(p)) return { error: 'Solo se aceptan archivos .yml / .yaml' };

  const roots = [home, ...STATIC_ROOTS];
  const inside = (q: string) => roots.some((r) => q === r || q.startsWith(r.endsWith('/') ? r : r + '/'));
  if (!inside(p)) return { error: 'Ruta fuera de los directorios permitidos' };
  // Symlink escape guard.
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

// Resolve the real location of a host path (for dedup); falls back to the input.
async function resolveReal(p: string): Promise<string> {
  try {
    return containerToHost(await realpath(hostToContainer(p)));
  } catch {
    return p;
  }
}

// Write text to a host path. The host fs is mounted read-only at /hostfs, so
// bytes are streamed through stdin of a host-side `cat > dest` (nsenter).
async function writeHostFile(
  hostPath: string,
  buf: Buffer
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  try {
    const proc = hostSpawnInteractive(`cat > ${shq(hostPath)}`, { user: 'user' });
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

// Run a docker subcommand: in-container CLI first, host fallback.
// (Copy of the helper in src/docker-ops.ts.)
async function dockerCmd(cmd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const res = await $`bash -c ${'docker ' + cmd}`.quiet().nothrow();
  const stdout = res.stdout.toString();
  const stderr = res.stderr.toString();
  if (res.exitCode === 0) return { ok: true, stdout, stderr };
  const hostRes = await hostExec(`docker ${cmd}`, { user: 'user', timeoutMs: 60_000 });
  if (hostRes.ok) return { ok: true, stdout: hostRes.stdout, stderr: hostRes.stderr };
  return { ok: false, stdout, stderr: `${stderr} | host: ${hostRes.stderr || hostRes.stdout || `exit ${hostRes.code}`}` };
}

interface ComposeService {
  name: string;
  container: string;
  status: string;
  statusText?: string;
}

interface ComposeProject {
  project: string;
  workingDir: string;
  configFile: string;
  services: ComposeService[];
  path: string;
  source: 'containers' | 'disk';
}

function labelVal(labels: string, key: string): string {
  // Labels arrive as a comma-joined `k=v,k=v` string; values stop at the next
  // comma (config_files is itself comma-separated, so this yields the first).
  return labels.match(new RegExp(`${key.replace(/\./g, '\\.')}=([^,]+)`))?.[1] || '';
}

// Cheap YAML skim: service names = 2-space keys under a top-level `services:`.
// Only used to decorate dormant stacks; preview/validation use `docker compose`.
function parseServiceNames(yaml: string): string[] {
  const names: string[] = [];
  let inServices = false;
  for (const line of yaml.split('\n')) {
    if (/^services:\s*(#.*)?$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^\S/.test(line) && line.trim()) break; // next top-level key
    const m = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*(#.*)?$/);
    if (m) names.push(m[1]);
  }
  return names;
}

async function readHead(hostPath: string, maxBytes: number): Promise<string> {
  const cp = hostToContainer(hostPath);
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(cp, 'r');
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString('utf-8');
  } catch {
    return '';
  } finally {
    try { await fh?.close(); } catch { /* ignore */ }
  }
}

export function registerComposeRoutes(app: Hono): void {
  // ---------- List projects: containers' compose labels + dormant files ----------
  app.get('/api/compose', async (c) => {
    const projects = new Map<string, ComposeProject>();
    const knownFiles = new Set<string>();
    let dockerError: string | undefined;

    // 1) Running/stopped containers grouped by com.docker.compose.project.
    const ps = await dockerCmd(`ps -a --format '{{json .}}'`);
    if (!ps.ok) {
      dockerError = (ps.stderr || ps.stdout || 'docker no disponible').slice(0, 1000);
    } else {
      for (const line of ps.stdout.split('\n').filter(Boolean)) {
        try {
          const row = JSON.parse(line) as { Names?: string; State?: string; Status?: string; Labels?: string };
          const labels = row.Labels || '';
          const project = labelVal(labels, 'com.docker.compose.project');
          if (!project) continue;
          const service = labelVal(labels, 'com.docker.compose.service');
          const workingDir = labelVal(labels, 'com.docker.compose.project.working_dir');
          const configRaw = labelVal(labels, 'com.docker.compose.project.config_files');
          // config_files is a list of yml paths (comma- or colon-separated) — take first.
          const configFile = configRaw.split(/[,:]/).map((f) => f.trim()).filter(Boolean)[0] || '';

          const g = projects.get(project) || {
            project,
            workingDir: '',
            configFile: '',
            services: [],
            path: '',
            source: 'containers' as const,
          };
          if (!g.workingDir && workingDir) g.workingDir = workingDir;
          if (!g.configFile && configFile) g.configFile = configFile;
          g.path = g.configFile || g.workingDir;
          g.services.push({
            name: service || row.Names || '',
            container: row.Names || '',
            status: row.State || '',
            statusText: row.Status || '',
          });
          projects.set(project, g);
        } catch { /* malformed line */ }
      }
    }

    // 2) Dormant stacks: compose files on disk with no containers. Searched one
    // level deep under $HOME and /opt (find -maxdepth 3), capped at 40 hits.
    const home = await homeDir();
    const findRes = await hostExec(
      `find ${shq(home)} /opt -maxdepth 3 -type f \\( -name 'docker-compose.y*ml' -o -name 'compose.y*ml' \\) 2>/dev/null | head -40`,
      { user: 'user', timeoutMs: 15_000 }
    );
    const found = findRes.ok ? findRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 40) : [];

    for (const f of found) {
      try {
        // Must still pass the same allowlist the editor enforces.
        const r = await resolveComposePath(f);
        if (!r.path) continue;
        const real = await resolveReal(r.path);
        if (knownFiles.has(real)) continue;
        // Skip files that already belong to a container-derived project.
        let dup = false;
        for (const p of projects.values()) {
          if (p.configFile && (await resolveReal(p.configFile)) === real) { dup = true; break; }
        }
        if (dup) continue;
        knownFiles.add(real);

        const workingDir = path.posix.dirname(real);
        const head = await readHead(real, 64 * 1024);
        const services = parseServiceNames(head).map((name) => ({
          name,
          container: '',
          status: 'stopped',
        }));
        projects.set(`disk:${real}`, {
          project: path.posix.basename(workingDir),
          workingDir,
          configFile: real,
          services,
          path: real,
          source: 'disk',
        });
      } catch { /* unreadable / vanished file — skip */ }
    }

    const list = Array.from(projects.values()).sort((a, b) => {
      const ra = a.services.some((s) => s.status === 'running') ? 0 : 1;
      const rb = b.services.some((s) => s.status === 'running') ? 0 : 1;
      return ra - rb || a.project.localeCompare(b.project);
    });
    return c.json({ ok: true, projects: list, dockerError });
  });

  // ---------- Read file ----------
  app.get('/api/compose/file', async (c) => {
    const r = await resolveComposePath(c.req.query('path'));
    if (!r.path) return fail(c, 403, r.error!);
    const cp = hostToContainer(r.path);
    try {
      const st = await stat(cp);
      if (st.isDirectory()) return fail(c, 400, 'Es un directorio');
      if (!st.isFile()) return fail(c, 400, 'No es un archivo regular');
    } catch (e: any) {
      return fail(c, 404, 'El archivo no existe', { detail: String(e?.message || e) });
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
      return fail(c, e?.code === 'EACCES' ? 403 : 500, 'No se pudo leer el archivo', { detail: String(e?.message || e) });
    } finally {
      try { await fh?.close(); } catch { /* ignore */ }
    }
  });

  // ---------- Save (backup → stdin cat → `compose config -q` validation) ----------
  app.post('/api/compose/save', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'Cuerpo JSON inválido');
    }
    const r = await resolveComposePath(body?.path);
    if (!r.path) return fail(c, 403, r.error!);
    if (typeof body?.content !== 'string') return fail(c, 400, 'Falta el campo content');
    const buf = Buffer.from(body.content, 'utf-8');
    if (buf.length > MAX_SAVE_BYTES) {
      return fail(c, 413, `El archivo supera el límite de ${MAX_SAVE_BYTES / 1024} KB`);
    }

    // Timestamped backup alongside the file; a missing original (new file)
    // just means there's nothing to back up — non-fatal either way.
    const backup = `${r.path}.bak-${Math.floor(Date.now() / 1000)}`;
    const cpRes = await hostExec(`cp -- ${shq(r.path)} ${shq(backup)}`, { user: 'user', timeoutMs: 15_000 });
    const backupPath = cpRes.ok ? backup : null;

    const wr = await writeHostFile(r.path, buf);
    if (!wr.ok) return fail(c, 500, wr.error!, { detail: wr.detail, backup: backupPath });

    // Syntax/merge validation. A failure is a warning, not a rollback — the
    // user may be mid-edit and still wants the file on disk.
    const vres = await dockerCmd(`compose -f ${shq(r.path)} config -q`);
    const validation = vres.ok
      ? { ok: true }
      : { ok: false, error: (vres.stderr || vres.stdout || 'validación falló').trim().slice(0, 4000) };

    return c.json({ ok: true, saved: true, path: r.path, backup: backupPath, validation });
  });

  // ---------- Preview: rendered config + service status ----------
  app.post('/api/compose/preview', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'Cuerpo JSON inválido');
    }
    const r = await resolveComposePath(body?.path);
    if (!r.path) return fail(c, 403, r.error!);

    const cfg = await dockerCmd(`compose -f ${shq(r.path)} config`);
    const rendered = cfg.stdout.slice(0, MAX_RENDER_BYTES);
    const renderedTruncated = cfg.stdout.length > MAX_RENDER_BYTES;

    // Service status rows — `ps --format json` emits a JSON array on newer
    // compose and one JSON object per line on older versions.
    const psRes = await dockerCmd(`compose -f ${shq(r.path)} ps --format json`);
    const byService = new Map<string, any>();
    if (psRes.ok && psRes.stdout.trim()) {
      const raw = psRes.stdout.trim();
      let rows: any[] = [];
      try {
        const parsed = JSON.parse(raw);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        for (const line of raw.split('\n').filter(Boolean)) {
          try { rows.push(JSON.parse(line)); } catch { /* non-JSON line */ }
        }
      }
      for (const row of rows) {
        const svc = String(row?.Service || row?.Name || '');
        if (!svc) continue;
        const ports = Array.isArray(row?.Publishers)
          ? row.Publishers.map((p: any) => `${p?.URL ? p.URL + ':' : ''}${p?.PublishedPort ?? ''}->${p?.TargetPort ?? ''}/${p?.Protocol || 'tcp'}`).join(', ')
          : String(row?.Ports || '');
        byService.set(svc, {
          name: svc,
          container: String(row?.Name || ''),
          image: String(row?.Image || ''),
          ports,
          status: String(row?.State || ''),
          statusText: String(row?.Status || ''),
        });
      }
    }

    // Declared services so dormant stacks still show a table.
    const declared: string[] = [];
    const svcRes = cfg.ok ? await dockerCmd(`compose -f ${shq(r.path)} config --services`) : { ok: false, stdout: '' };
    if (svcRes.ok) {
      for (const n of svcRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) declared.push(n);
    }
    const services = declared.length
      ? declared.map((name) => byService.get(name) || { name, container: '', image: '', ports: '', status: '', statusText: '' })
      : Array.from(byService.values());

    return c.json({
      ok: true,
      path: r.path,
      rendered,
      renderedTruncated,
      services,
      error: cfg.ok ? undefined : (cfg.stderr || cfg.stdout || 'docker compose config falló').trim().slice(0, 4000),
    });
  });

  // ---------- Job-runnable lifecycle ops ----------
  async function composeJob(
    c: any,
    verb: 'up' | 'down' | 'pull',
    args: string
  ) {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'Cuerpo JSON inválido');
    }
    if (verb === 'down' && body?.confirm !== true) {
      return fail(c, 400, 'Se requiere confirmación (confirm: true)');
    }
    const r = await resolveComposePath(body?.path);
    if (!r.path) return fail(c, 403, r.error!);

    const dirName = path.posix.basename(path.posix.dirname(r.path)) || r.path;
    const job = runJob(`compose ${verb}: ${dirName}`, [
      {
        label: `docker compose ${verb}`,
        cmd: `docker compose -f ${shq(r.path)} ${args}`,
        user: 'user',
      },
    ]);
    return c.json({ ok: true, job });
  }

  app.post('/api/compose/up', (c) => composeJob(c, 'up', 'up -d --remove-orphans'));
  app.post('/api/compose/down', (c) => composeJob(c, 'down', 'down'));
  app.post('/api/compose/pull', (c) => composeJob(c, 'pull', 'pull'));
}
