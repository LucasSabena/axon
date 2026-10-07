import { resolveHostPath, projectSearchRoots } from './host-storage';
import { Hono } from 'hono';
import { hostExec, hostToContainer, containerToHost, HOST_USER } from './host';
import { runJob, cancelJob } from './jobs';
import { ComposeDrafts, composeSyntax } from './compose-drafts';
import {ComposeReleases} from './compose-releases';
import {MaintenanceError} from './storage/types';
import {actor,textField} from './storage/http';
import { hash } from './storage/policy';
import { protect, body as maintenanceBody, only } from './storage/http';
import { realpath, stat, open, readFile } from 'node:fs/promises';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Compose feature module — Docker Compose visual editor backend.
// Self-contained: index.ts only calls registerComposeRoutes(app).
//
// Reads go through hostToContainer() (the /hostfs read-only mount). Editor saves
// are SQLite drafts; promotion to the host is not enabled. Docker lifecycle
// mutations run as the unprivileged HOST_USER account. `docker` may not exist
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

// Host home is resolved lazily; selected paths share the live disk policy.

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
// .yml/.yaml and pass the same mount-aware policy used by Files and projects.
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
  // Los stacks viven en homes, /opt o discos montados — un *.yml bajo árboles
  // del sistema (/etc/cloud.cfg, /usr/lib/…yaml) no es un compose editable.
  if (/^\/(etc|usr|boot|bin|sbin|lib|lib64|proc|sys|dev|run)(\/|$)/.test(p)) {
    return { error: 'La ruta está bajo un directorio del sistema; Compose solo edita stacks en homes, /opt o discos montados' };
  }

  try {
    const resolved = await resolveHostPath(p);
    // Re-check on the REAL path: a symlinked `x.yaml` may resolve to a file
    // with any extension; reads below hit the resolved target, not `p`.
    if (!/\.ya?ml$/i.test(resolved)) return { error: 'Solo se aceptan archivos .yml / .yaml' };
    if (/^\/(etc|usr|boot|bin|sbin|lib|lib64|proc|sys|dev|run)(\/|$)/.test(resolved)) {
      return { error: 'La ruta real está bajo un directorio del sistema' };
    }
    return { path: resolved };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Ruta inválida' };
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

// Run a docker subcommand: in-container CLI first, host fallback ONLY when the
// in-container CLI is missing (exit 127 / "command not found") — a real exit≠0
// from the daemon or the compose file is a definitive answer, and retrying it
// blindly on the host would just double the failure (and once duplicated a
// wedged-daemon timeout into a second hang).
// `stdin` feeds the in-container spawn directly; on the host path the content
// travels base64-encoded inside the command line (bounded by callers to 256KB).
async function dockerSpawn(
  containerArgv: string[],
  hostCmd: string,
  opts: { stdin?: string; timeoutMs?: number } = {}
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  let timedOut = false;
  const hostFallback = async (stderr: string): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
    const feed = opts.stdin !== undefined ? `printf %s ${shq(Buffer.from(opts.stdin, 'utf8').toString('base64'))} | base64 -d | ` : '';
    const hostRes = await hostExec(`${feed}${hostCmd}`, { user: 'user', timeoutMs: 60_000 });
    if (hostRes.ok) return { ok: true, stdout: hostRes.stdout, stderr: hostRes.stderr };
    return { ok: false, stdout: '', stderr: `${stderr} | host: ${hostRes.stderr || hostRes.stdout || `exit ${hostRes.code}`}` };
  };
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(containerArgv, {
      stdout: 'pipe',
      stderr: 'pipe',
      ...(opts.stdin !== undefined ? { stdin: new Blob([opts.stdin]) } : {}),
    });
  } catch (e) {
    // The docker binary is absent in-container (ENOENT) — host fallback.
    return hostFallback(`spawn: ${e instanceof Error ? e.message : e}`);
  }
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
  }, opts.timeoutMs ?? 15_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
      proc.exited,
    ]);
    if (code === 0) return { ok: true, stdout, stderr };
    const missing = !timedOut && (code === 127 || /command not found|: not found|no such file/i.test(stderr));
    if (!missing) return { ok: false, stdout, stderr };
    return hostFallback(stderr);
  } finally {
    clearTimeout(timer);
  }
}

async function dockerCmd(cmd: string, opts: { stdin?: string; timeoutMs?: number } = {}): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return dockerSpawn(['bash', '-c', `docker ${cmd}`], `docker ${cmd}`, opts);
}

// `docker compose` on a file that exists on the HOST: in-container the same
// file is reachable via the read-only /hostfs mount (fine for read-only
// subcommands like config/ps); the hostExec fallback gets the real path.
// `args` must be literal-safe (no quoting needed) — only call sites below.
async function dockerComposeFile(hostPath: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return dockerSpawn(['docker', 'compose', '-f', hostToContainer(hostPath), ...args], `docker compose -f ${shq(hostPath)} ${args.join(' ')}`, opts);
}

// `docker compose config -q` on arbitrary YAML text piped via stdin. The
// project directory is passed explicitly so env_file/relative paths resolve
// against the real stack dir (via /hostfs in-container).
async function dockerComposeCheck(hostPath: string, content: string, extra: string[] = []): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const dir = path.posix.dirname(hostPath);
  return dockerSpawn(
    ['docker', 'compose', '-f', '-', '--project-directory', hostToContainer(dir), ...extra],
    `docker compose -f - --project-directory ${shq(dir)} ${extra.join(' ')}`,
    { stdin: content, timeoutMs: 45_000 }
  );
}

// Env keys whose rendered values must never leave the process (interpolated
// secrets). Covers `KEY: value` (map form) and `- KEY=value` (list form).
const SENSITIVE_KEY = /(?:^|_)(?:PASSWORD|PASSWD|PASS|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|SECRET_?KEY|CREDENTIALS?|AUTH|SESSION_?KEY|CERT|PWD)(?:_|$)/i;
function maskSecrets(yamlText: string): string {
  return yamlText
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\s*-?\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*[:=]\s*)(.*?)\s*(#.*)?$/);
      if (!m || !SENSITIVE_KEY.test(m[2])) return line;
      const val = (m[4] || '').trim();
      // Already a placeholder (${VAR}) or empty/null — nothing to hide.
      if (!val || val === 'null' || val === '~' || /^\$\{?/.test(val)) return line;
      return `${m[1]}${m[2]}${m[3]}********`;
    })
    .join('\n');
}

// Líneas WARN que docker compose emite por stderr (env vars sin definir, etc).
function dockerWarnings(stderr: string): string[] {
  return stderr
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^WARN\b|level=warn/i.test(s))
    .map((s) => s.replace(/^WARN\[\d+\]\s*/, '').replace(/level=warning msg="/, '').replace(/"$/, ''))
    .slice(0, 20);
}

interface ComposeService {
  name: string;
  container: string;
  containerId?: string;
  status: string;
  statusText?: string;
  // Live memory — absent for stopped/disk services.
  mem?: string;
  memBytes?: number;
}

interface ComposeProject {
  project: string;
  workingDir: string;
  configFile: string;
  services: ComposeService[];
  path: string;
  source: 'containers' | 'disk';
  description?: string; // auto-detected from the compose file
  note?: string;        // user-written (config.composeNotes)
  mem?: string;         // project total, human-readable
  memBytes?: number;
}

function labelVal(labels: string, key: string): string {
  // Labels arrive as a comma-joined `k=v,k=v` string; a value containing a
  // comma cannot survive that format, so the label is skipped rather than
  // returning a truncated (possibly hostile) prefix.
  const m = labels.match(new RegExp(`(?:^|,)${key.replace(/\./g, '\\.')}=([^,]*)`));
  return m?.[1] || '';
}

// Cheap YAML skim: service names = keys one indent level below a top-level
// `services:`. Only used to decorate dormant stacks; preview/validation use
// `docker compose`. Indent width is not fixed (2 vs 4 spaces) and keys may
// be quoted.
function parseServiceNames(yaml: string): string[] {
  const names: string[] = [];
  let inServices = false;
  let svcIndent = -1;
  for (const line of yaml.split('\n')) {
    if (/^services\s*:\s*(#.*)?$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^\S/.test(line) && line.trim()) break; // next top-level key
    // Any `key:` at the first indent under `services:` is a service name —
    // inline values (`web: {}`) and quoted keys count too.
    const m = line.match(/^(\s+)(?:["']([A-Za-z0-9_.-]+)["']|([A-Za-z0-9_.-]+))\s*:\s*(?:\S.*)?$/);
    if (!m) continue;
    const indent = m[1].replace(/\t/g, '  ').length;
    if (svcIndent < 0) svcIndent = indent;
    if (indent === svcIndent) names.push(m[2] || m[3]);
  }
  return names;
}

// Skim a human description out of a compose file: a top-level
// `x-description:`/`description:` key, else the leading `#` comment block.
function parseDescription(yaml: string): string {
  for (const line of yaml.split('\n')) {
    const m = line.match(/^x?-?description:\s*["']?(.+?)["']?\s*$/i);
    if (m && !/^\s/.test(line)) return m[1].trim().slice(0, 200);
    if (line.trim() && !line.startsWith('#') && !/^x?-?description/i.test(line)) {
      if (!/^(version|name|services|x-|description)/i.test(line)) break;
    }
  }
  const comments: string[] = [];
  for (const line of yaml.split('\n')) {
    if (line.startsWith('#')) {
      const t = line.replace(/^#+\s?/, '').trim();
      if (t) comments.push(t);
    } else if (line.trim()) break;
    if (comments.join(' ').length > 200) break;
  }
  return comments.join(' ').slice(0, 200);
}

const MEM_UNITS: Record<string, number> = { B: 1, KiB: 1 << 10, MiB: 1 << 20, GiB: 1 << 30, TiB: 1 << 40, kB: 1000, MB: 1e6, GB: 1e9 };

// `docker stats` MemUsage looks like "45.2MiB / 3.79GiB" — take the left side.
function parseMemUsage(usage: string): { text: string; bytes: number } | null {
  const m = usage.match(/^([\d.]+)\s*([A-Za-z]+)/);
  if (!m) return null;
  const mult = MEM_UNITS[m[2]] ?? 1;
  return { text: `${m[1]} ${m[2]}`, bytes: Math.round(parseFloat(m[1]) * mult) };
}

// `docker stats --no-stream` blocks ~2s on the daemon. The panel only needs
// memory, which lives in the cgroup filesystem — reading it directly is ~ms.
// Returns container-id → bytes (cgroup v2 systemd scopes + v1 fallback).
async function containerMemById(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const res = await hostExec(
    'for f in /sys/fs/cgroup/system.slice/docker-*.scope/memory.current /sys/fs/cgroup/memory/docker/*/memory.usage_in_bytes; do ' +
    '[ -f "$f" ] || continue; echo "$(basename "${f%/*}") $(cat "$f")"; done',
    { user: 'root', timeoutMs: 10_000 }
  );
  for (const line of res.stdout.split('\n')) {
    const [dir, bytesRaw] = line.trim().split(/\s+/);
    const id = (dir || '').replace(/^docker-/, '').replace(/\.scope$/, '');
    const bytes = parseInt(bytesRaw || '', 10);
    if (/^[0-9a-f]{12,64}$/i.test(id) && Number.isFinite(bytes)) map.set(id, bytes);
  }
  return map;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GiB`;
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MiB`;
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(1)} KiB`;
  return `${bytes} B`;
}

interface ComposeDeps {
  drafts?: ComposeDrafts;
  releases?: ComposeReleases;
  getNotes?: () => Record<string, string> | undefined;
  setNote?: (key: string, note: string) => Promise<void> | void;
  // Reports a running/interrupted compose release — lifecycle ops must not
  // interleave with a worker's `docker compose` calls.
  busyGuard?: () => Promise<string | null> | string | null;
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

export function registerComposeRoutes(app: Hono, deps: ComposeDeps = {}): void {
  protect(app, "/api/compose");
  app.get('/api/compose/releases',async c=>c.json({ok:true,operations:await deps.releases?.list(actor(c))||[]}));
  app.post('/api/compose/releases',async c=>{const b=await maintenanceBody(c);only(b,['path']);const r=await resolveComposePath(textField(b.path,4096));if(!r.path)return fail(c,403,r.error!);if(!deps.releases)return fail(c,503,'Aplicación no disponible en este contexto');return c.json({ok:true,operation:await deps.releases.prepare(r.path,actor(c))},201);});
  app.get('/api/compose/releases/:id',async c=>{if(!deps.releases)return fail(c,503,'Motor no disponible');return c.json({ok:true,operation:await deps.releases.status(c.req.param('id'),actor(c))});});
  app.post('/api/compose/releases/:id/:action',async c=>{const b=await maintenanceBody(c);only(b,['digest']);const action=c.req.param('action');if(!['apply','rollback'].includes(action))return fail(c,400,'Acción desconocida');if(!deps.releases)return fail(c,503,'Motor no disponible');return c.json({ok:true,operation:await deps.releases.execute(c.req.param('id'),textField(b.digest),actor(c),action==='rollback')},202);});
  // ---------- List projects: containers' compose labels + dormant files ----------
  app.get('/api/compose', async (c) => {
    const projects = new Map<string, ComposeProject>();
    const knownFiles = new Set<string>();
    let dockerError: string | undefined;
    const notes = deps.getNotes?.() || {};

    // The three data sources are independent — run them in parallel.
    // `docker stats` was the slowest by far (~2s on the daemon); cgroup reads
    // replace it with a fallback below if the layout isn't recognized.
    const [ps, findRes, memById] = await Promise.all([
      dockerCmd(`ps -a --format '{{json .}}'`),
      // head -41 (uno más que el cap) para detectar e informar el truncado.
      projectSearchRoots([await homeDir(),'/opt']).then((roots) =>
        hostExec(
          `find ${roots.map(shq).join(' ')||'/nonexistent'} -maxdepth 4 \\( -name node_modules -o -name .git \\) -prune -o -type f \\( -name 'docker-compose.y*ml' -o -name 'compose.y*ml' \\) -print 2>/dev/null | head -41`,
          { user: 'user', timeoutMs: 15_000 }
        )
      ),
      containerMemById(),
    ]);

    // 1) Running/stopped containers grouped by com.docker.compose.project.
    if (!ps.ok) {
      dockerError = (ps.stderr || ps.stdout || 'docker no disponible').slice(0, 1000);
    } else {
      for (const line of ps.stdout.split('\n').filter(Boolean)) {
        try {
          const row = JSON.parse(line) as { ID?: string; Names?: string; State?: string; Status?: string; Labels?: string };
          const labels = row.Labels || '';
          const project = labelVal(labels, 'com.docker.compose.project');
          if (!project) continue;
          const service = labelVal(labels, 'com.docker.compose.service');
          const workingDir = labelVal(labels, 'com.docker.compose.project.working_dir');
          const configRaw = labelVal(labels, 'com.docker.compose.project.config_files');
          // config_files is a comma-separated list of yml paths — take the
          // first. Never split on ':' — it corrupts paths containing one.
          const configFile = configRaw.split(',').map((f) => f.trim()).filter(Boolean)[0] || '';

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
            containerId: row.ID || '',
            status: row.State || '',
            statusText: row.Status || '',
          });
          projects.set(project, g);
        } catch { /* malformed line */ }
      }
    }

    // 2) Dormant stacks: compose files on disk with no containers. Searched
    // under $HOME and /opt (find -maxdepth 4, node_modules/.git pruned),
    // capped at 40 hits.
    const foundLines = findRes.ok ? findRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
    const filesTruncated = foundLines.length > 40;
    const found = foundLines.slice(0, 40);

    // Resolve + realpath every candidate in parallel (was sequential per file:
    // ~2 syscalls × 40 files added noticeable latency to the panel load).
    const candidates = (
      await Promise.all(
        found.map(async (f) => {
          try {
            // Must still pass the same allowlist the editor enforces.
            const r = await resolveComposePath(f);
            if (!r.path) return null;
            return { real: await resolveReal(r.path) };
          } catch {
            return null;
          }
        })
      )
    ).filter((x): x is { real: string } => !!x);

    // Real paths of container-derived projects, resolved once in parallel.
    const projectReals = new Set(
      await Promise.all(
        [...projects.values()].map((p) => (p.configFile ? resolveReal(p.configFile) : Promise.resolve('')))
      )
    );

    const accepted: string[] = [];
    for (const c of candidates) {
      if (knownFiles.has(c.real) || projectReals.has(c.real)) continue;
      knownFiles.add(c.real);
      accepted.push(c.real);
    }

    await Promise.all(
      accepted.map(async (real) => {
        try {
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
            description: parseDescription(head) || undefined,
          });
        } catch { /* unreadable / vanished file — skip */ }
      })
    );

    // 3) Decorate: live memory per container + file-derived descriptions.
    // cgroup gives full ids; `docker ps` shows the 12-char prefix — match by
    // prefix. Fall back to `docker stats` when the cgroup layout is unknown.
    let memByName = new Map<string, { text: string; bytes: number }>();
    if (memById.size) {
      for (const p of projects.values()) {
        for (const s of p.services) {
          if (!s.containerId) continue;
          const bytes = memById.get(s.containerId)
            ?? [...memById.entries()].find(([id]) => id.startsWith(s.containerId!))?.[1];
          if (bytes !== undefined) memByName.set(s.container, { text: fmtBytes(bytes), bytes });
        }
      }
    }
    if (!memByName.size) {
      const stats = await dockerCmd(`stats --no-stream --format '{{json .}}'`);
      if (stats.ok) {
        for (const line of stats.stdout.split('\n').filter(Boolean)) {
          try {
            const row = JSON.parse(line) as { Name?: string; MemUsage?: string };
            const mem = row.MemUsage ? parseMemUsage(row.MemUsage) : null;
            if (row.Name && mem) memByName.set(row.Name, mem);
          } catch { /* malformed line */ }
        }
      }
    }
    await Promise.all(
      [...projects.values()].map(async (p) => {
        let total = 0;
        for (const s of p.services) {
          const mem = s.container ? memByName.get(s.container) : null;
          if (mem) { s.mem = mem.text; s.memBytes = mem.bytes; total += mem.bytes; }
        }
        if (total > 0) { p.memBytes = total; p.mem = fmtBytes(total); }
        if (!p.description && p.configFile) {
          // configFile comes from a container label — forged values could point
          // at any host file whose head would leak via this API. Only read it
          // when it passes the same mount-aware policy as editor paths.
          const vr = await resolveComposePath(p.configFile).catch(() => ({ path: undefined }));
          if (vr.path) {
            const head = await readHead(vr.path, 32 * 1024);
            const d = parseDescription(head);
            if (d) p.description = d;
          }
        }
        const key = p.configFile || p.path;
        if (key && notes[key]) p.note = notes[key];
      })
    );

    const list = Array.from(projects.values()).sort((a, b) => {
      const ra = a.services.some((s) => s.status === 'running') ? 0 : 1;
      const rb = b.services.some((s) => s.status === 'running') ? 0 : 1;
      return ra - rb || a.project.localeCompare(b.project);
    });
    return c.json({ ok: true, projects: list, dockerError, filesTruncated });
  });

  // ---------- User note per stack ({key: compose file path, note}) ----------
  app.post('/api/compose/note', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'Cuerpo JSON inválido');
    }
    const key = String(body?.key || '').trim();
    const note = String(body?.note ?? '').slice(0, 500);
    if (!key) return fail(c, 400, 'Falta el campo key');
    if (!deps.setNote) return fail(c, 501, 'Notas no disponibles');
    await deps.setNote(key, note);
    return c.json({ ok: true });
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
      const draft = deps.drafts?.get(r.path);
      return c.json({ ok: true, path: r.path, content: draft?.content ?? content, revision: draft?.revision ?? hash(content), draft: !!draft, deployedContent: content, truncated });
    } catch (e: any) {
      return fail(c, e?.code === 'EACCES' ? 403 : 500, 'No se pudo leer el archivo', { detail: String(e?.message || e) });
    } finally {
      try { await fh?.close(); } catch { /* ignore */ }
    }
  });

  // ---------- Save a private draft; never replace the deployable file ----------
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

    if (!deps.drafts) return fail(c, 503, 'El ledger de borradores no está disponible');
    const original = await readHead(r.path, MAX_READ_BYTES + 1);
    if (Buffer.byteLength(original) > MAX_READ_BYTES) return fail(c, 413, 'Archivo original demasiado grande');
    const draft = deps.drafts.save(r.path, body.content, original, body.revision);
    return c.json({ ok: true, saved: true, draft: true, applied: false, path: r.path, revision: draft.revision, validation: draft.validation, message: 'Borrador guardado en Axon. El archivo del host sigue intacto. La validación local no equivale a validar Docker Compose.' });
  });

  app.post('/api/compose/draft-preview', async (c) => {
    const body = await c.req.json().catch(() => null);
    const r = await resolveComposePath(body?.path);
    if (!r.path) return fail(c, 403, r.error!);
    const preview = deps.drafts?.preview(r.path, await readHead(r.path, MAX_READ_BYTES));
    if (!preview) return fail(c, 404, 'No hay borrador para comparar');
    return c.json({ ok: true, ...preview });
  });

  app.post('/api/compose/draft-discard', async (c) => {
    const body = await maintenanceBody(c);only(body,['path','revision']);
    if(typeof body?.path!=='string'||!path.isAbsolute(body.path)||body.path.length>4096)return fail(c,400,'Ruta de borrador inválida');
    if(!deps.drafts)return fail(c,503,'El ledger de borradores no está disponible');
    return c.json({ok:true,...deps.drafts.discard(body.path,body.revision)});
  });

  // ---------- Docker-validate a draft / arbitrary content via stdin ----------
  app.post('/api/compose/validate', async (c) => {
    const body = await c.req.json().catch(() => null);
    const r = await resolveComposePath(body?.path);
    if (!r.path) return fail(c, 403, r.error!);
    // Prioridad: contenido enviado (editor sin guardar) > borrador > disco.
    let content: string;
    let source: 'editor' | 'borrador' | 'disco';
    if (typeof body?.content === 'string') {
      if (Buffer.byteLength(body.content, 'utf8') > MAX_SAVE_BYTES) {
        return fail(c, 413, `El contenido supera el límite de ${MAX_SAVE_BYTES / 1024} KB`);
      }
      content = body.content;
      source = 'editor';
    } else {
      const draft = deps.drafts?.get(r.path);
      if (draft) {
        content = draft.content;
        source = 'borrador';
      } else {
        content = await readHead(r.path, MAX_READ_BYTES + 1);
        source = 'disco';
        if (Buffer.byteLength(content, 'utf8') > MAX_READ_BYTES) return fail(c, 413, 'El archivo es demasiado grande');
        if (!content.trim()) return fail(c, 404, 'El archivo está vacío o no se pudo leer');
      }
    }
    const local = composeSyntax(content);
    if (!local.ok) return c.json({ ok: true, valid: false, source, error: local.error, warnings: [], services: [] });
    const res = await dockerComposeCheck(r.path, content, ['config', '-q']);
    const warnings = dockerWarnings(res.stderr);
    return c.json({
      ok: true,
      valid: res.ok,
      source,
      error: res.ok ? undefined : (res.stderr || res.stdout || 'docker compose config falló').trim().slice(0, 4000),
      warnings,
      services: local.services,
    });
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

    const draft = deps.drafts?.preview(r.path, await readHead(r.path, MAX_READ_BYTES));
    if (draft) {
      // El borrador no existe en el host: se valida/renderiza vía stdin.
      // `--no-interpolate` evita expandir secrets del entorno; maskSecrets
      // cubre los valores hardcodeados.
      const [check, render] = await Promise.all([
        dockerComposeCheck(r.path, draft.after, ['config', '-q']),
        dockerComposeCheck(r.path, draft.after, ['config', '--no-interpolate']),
      ]);
      const renderedRaw = render.ok ? render.stdout : '';
      return c.json({
        ok: true,
        path: r.path,
        draft: true,
        rendered: render.ok ? maskSecrets(renderedRaw.slice(0, MAX_RENDER_BYTES)) : draft.after,
        renderedTruncated: render.ok && render.stdout.length > MAX_RENDER_BYTES,
        dockerValidated: check.ok,
        services: draft.draft.services.map(name => ({name, status: 'borrador', image: '', ports: '', container: ''})),
        warnings: dockerWarnings(check.stderr),
        error: (check.ok ? '' : (check.stderr || 'docker compose config falló').trim().slice(0, 4000) + '\n')
          + 'Borrador de Axon, todavía sin aplicar. ' + draft.blockers.join(' '),
        before: draft.before,
        changedOnHost: draft.changedOnHost,
      });
    }

    // `config -q` valida interpolando (detecta env faltantes) sin volcarlas;
    // `--no-interpolate` produce la salida visible sin expandir secrets.
    const [cfg, check, psRes] = await Promise.all([
      dockerComposeFile(r.path, ['config', '--no-interpolate'], { timeoutMs: 45_000 }),
      dockerComposeFile(r.path, ['config', '-q'], { timeoutMs: 45_000 }),
      dockerComposeFile(r.path, ['ps', '--format', 'json'], { timeoutMs: 30_000 }),
    ]);
    const renderedRaw = cfg.stdout.slice(0, MAX_RENDER_BYTES);
    const rendered = maskSecrets(renderedRaw);
    const renderedTruncated = cfg.stdout.length > MAX_RENDER_BYTES;
    const warnings = dockerWarnings(check.stderr);

    // Service status rows — `ps --format json` emits a JSON array on newer
    // compose and one JSON object per line on older versions.
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

    // Declared services so dormant stacks still show a table. Parsed from the
    // RAW render (before masking — masked values could break YAML); if that
    // fails, fall back to `config --services`.
    let declared: string[] = cfg.ok ? composeSyntax(renderedRaw).services : [];
    if (!declared.length && cfg.ok) {
      const svcRes = await dockerComposeFile(r.path, ['config', '--services']);
      if (svcRes.ok) {
        for (const n of svcRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) declared.push(n);
      }
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
      warnings,
      error: check.ok ? undefined : (check.stderr || check.stdout || 'docker compose config falló').trim().slice(0, 4000),
    });
  });

  // ---------- Job-runnable lifecycle ops ----------

  // Per-path mutex: concurrent up/down/pull on the same compose file can
  // interleave docker operations. The Job object is mutated in place by the
  // runner, so `status` here reflects live state.
  const lifecycleLocks = new Map<string, ReturnType<typeof runJob>>();
  // Jobs emitidos por este módulo — la cancelación solo puede tocar estos.
  const composeJobIds = new Set<string>();

  function pruneLifecycle() {
    if (lifecycleLocks.size > 200 || composeJobIds.size > 200) {
      for (const [k, j] of lifecycleLocks) {
        if (j.status !== 'running') { lifecycleLocks.delete(k); composeJobIds.delete(j.id); }
      }
    }
  }

  // Exclusión mutua en la otra dirección: un apply/rollback de release no
  // puede arrancar mientras un lifecycle job corre sobre el mismo archivo.
  deps.releases?.onBeforeExecute(async (id) => {
    const rec = deps.releases?.peek(id);
    const p = rec?.status?.path;
    const running = p ? lifecycleLocks.get(p) : undefined;
    if (running && running.status === 'running') {
      throw new MaintenanceError(`Hay una operación compose en curso (${running.title}); esperá a que termine`, 409);
    }
  });

  // Cancelar un job emitido por Compose (up/down/pull/service).
  app.post('/api/compose/job/:id/cancel', (c) => {
    const id = c.req.param('id');
    if (!composeJobIds.has(id)) return fail(c, 404, 'Job de Compose no encontrado');
    if (!cancelJob(id)) return fail(c, 409, 'El job ya no está en ejecución');
    return c.json({ ok: true });
  });

  // Returns an error string if this file is Axon's own deployment stack.
  async function selfStackBlock(hostPath: string): Promise<string | null> {
    // Self-stack guard: `down`/`up`/`pull` on Axon's own deployment compose
    // would kill or recreate this very process. The file must be readable to
    // verify it doesn't declare the axon service. The deployment manifest is
    // generated as JSON (valid YAML), so check both the YAML service listing
    // and the JSON/container_name spellings.
    try {
      const yaml = await readFile(hostToContainer(hostPath), 'utf8');
      if (parseServiceNames(yaml).includes('axon')
        || /container_name["']?\s*:\s*["']?axon(?=["'\s}]|$)/m.test(yaml)
        || /"services"\s*:\s*\{\s*"axon"\s*:/.test(yaml)) {
        return 'Operación rechazada: este stack gestiona la propia instancia de Axon';
      }
      return null;
    } catch {
      return 'No se pudo leer el archivo compose para verificarlo';
    }
  }

  function startComposeJob(rPath: string, label: string, args: string, timeoutMs: number) {
    const dirName = path.posix.basename(path.posix.dirname(rPath)) || rPath;
    const cmd = `docker compose -f ${shq(rPath)} ${args}`;
    const job = runJob(`compose ${label}: ${dirName}`, [
      {
        label: `docker compose ${label}`,
        cmd,
        user: 'user',
        timeoutMs,
        // El usuario del host puede no tener docker en PATH ni pertenecer al
        // grupo docker — root en el host es el equivalente del fallback
        // hostExec que usan las lecturas.
        fallback: { cmd, user: 'root' },
      },
    ]);
    lifecycleLocks.set(rPath, job);
    composeJobIds.add(job.id);
    pruneLifecycle();
    return job;
  }

  async function composeJob(
    c: any,
    verb: 'up' | 'down' | 'pull',
    args: string,
    timeoutMs: number
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

    const selfBlock = await selfStackBlock(r.path);
    if (selfBlock) return fail(c, 403, selfBlock);

    if (verb === 'up' && deps.drafts?.get(r.path)) return fail(c, 409, 'Hay un borrador sin aplicar. Compará y resolvé sus precondiciones antes de iniciar el stack.');
    if (verb === 'up') {
      const validation = await dockerComposeFile(r.path, ['config', '-q']);
      if (!validation.ok) return fail(c, 409, 'La configuración actual no pasó la validación de Docker Compose', { detail: (validation.stderr || '').slice(0, 2000) });
    }
    const releaseHold = await deps.busyGuard?.();
    if (releaseHold) return fail(c, 409, releaseHold);
    const active = lifecycleLocks.get(r.path);
    if (active && active.status === 'running') {
      return fail(c, 409, 'Ya hay una operación Compose en curso para esta ruta');
    }
    return c.json({ ok: true, job: startComposeJob(r.path, verb, args, timeoutMs) });
  }

  app.post('/api/compose/up', (c) => composeJob(c, 'up', 'up -d', 30 * 60_000));
  app.post('/api/compose/down', (c) => composeJob(c, 'down', 'down', 10 * 60_000));
  app.post('/api/compose/pull', (c) => composeJob(c, 'pull', 'pull', 45 * 60_000));

  // ---------- Per-service actions (start / stop / restart) ----------
  app.post('/api/compose/service', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'Cuerpo JSON inválido');
    }
    const action = String(body?.action || '');
    if (!['start', 'stop', 'restart'].includes(action)) return fail(c, 400, 'Acción desconocida');
    const service = String(body?.service || '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(service)) return fail(c, 400, 'Servicio inválido');
    const r = await resolveComposePath(body?.path);
    if (!r.path) return fail(c, 403, r.error!);

    // En el stack propio cualquier mutación por servicio puede tumbar el panel
    // (container_name puede llamarse axon bajo otro nombre de servicio).
    const selfBlock = await selfStackBlock(r.path);
    if (selfBlock) return fail(c, 403, selfBlock);

    const releaseHold = await deps.busyGuard?.();
    if (releaseHold) return fail(c, 409, releaseHold);
    const active = lifecycleLocks.get(r.path);
    if (active && active.status === 'running') {
      return fail(c, 409, 'Ya hay una operación Compose en curso para esta ruta');
    }
    const job = startComposeJob(r.path, `${action} ${service}`, `${action} ${shq(service)}`, 10 * 60_000);
    return c.json({ ok: true, job });
  });
}
