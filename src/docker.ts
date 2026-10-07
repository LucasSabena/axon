import { readFile } from 'fs/promises';
import { hostExec } from './host';
import type { DockerContainer } from './types';

interface DockerPsLine {
  ID: string;
  Names: string;
  Image: string;
  Status: string;
  State: string;
  Ports: string;
  Labels?: string;
}

function publicPortsFrom(portsField: string): number[] {
  const ports = new Set<number>();
  for (const part of portsField.split(',')) {
    // Handles single ports `443->443` and ranges `8000-8010->8000-8010`.
    const m = part.match(/(?:[\d.]+|:)?:(\d+)(?:-(\d+))?->/);
    if (m) {
      const lo = parseInt(m[1], 10);
      const hi = m[2] ? Math.min(parseInt(m[2], 10), lo + 512) : lo;
      for (let p = lo; p <= hi && p <= 65535; p++) ports.add(p);
    }
  }
  return Array.from(ports).sort((a, b) => a - b);
}

// Container ids are hex; names match [a-zA-Z0-9][a-zA-Z0-9_.-]+. A leading
// '-' would be parsed as a flag by the docker CLI.
function safeId(id: string): string | null {
  const s = String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  return /^[a-zA-Z0-9]/.test(s) ? s : null;
}

// Run a docker subcommand in-container with a hard timeout — a wedged daemon
// must not hang the request — then fall back to the host CLI (the container
// image may not ship docker at all).
async function dockerRun(args: string, timeoutMs = 15_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bash', '-c', `docker ${args}`], { stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
  }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code === 0) return { ok: true, stdout, stderr };
    const host = await hostExec(`docker ${args}`, { user: 'root', timeoutMs });
    if (host.ok) return { ok: true, stdout: host.stdout, stderr: host.stderr };
    return { ok: false, stdout, stderr: `${stderr} | host: ${host.stderr || host.stdout || `exit ${host.code}`}` };
  } catch (err) {
    return { ok: false, stdout: '', stderr: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// Ids of THIS container (hostname is the short id; cgroup may hold the long
// one). Used to refuse lifecycle ops on Axon itself.
let ownIds: Set<string> | null = null;
async function ownContainerIds(): Promise<Set<string>> {
  if (ownIds) return ownIds;
  const ids = new Set<string>();
  try {
    const h = (await readFile('/etc/hostname', 'utf-8')).trim();
    if (/^[0-9a-f]{12,}$/i.test(h)) ids.add(h);
  } catch { /* not a container */ }
  if (process.env.HOSTNAME && /^[0-9a-f]{12,}$/i.test(process.env.HOSTNAME)) ids.add(process.env.HOSTNAME.trim());
  try {
    const cg = await readFile('/proc/self/cgroup', 'utf-8');
    for (const m of cg.matchAll(/(?:docker|libpod|cri-containerd|crio)[-/]([0-9a-f]{12,64})\.?(?:scope)?/g)) ids.add(m[1]);
  } catch { /* no cgroup hint */ }
  ownIds = ids;
  return ids;
}

export async function isOwnContainer(id: string): Promise<boolean> {
  const res = await dockerRun(`inspect --format '{{.Id}} {{.Name}}' ${id}`, 15_000);
  const parts = res.stdout.trim().split(/\s+/);
  const full = parts[0] || '', name = (parts[1] || '').replace(/^\//, '');
  // Fail closed: if we cannot prove what the container is, refuse the action.
  if (!full) return true;
  // Deployment convention (compose-release worker also hard-blocks 'axon').
  if (name === 'axon') return true;
  const own = await ownContainerIds();
  // An empty id set means cgroup/hostname gave no hint — the name check above
  // is the only signal, and a non-'axon' name that inspects fine is not us.
  for (const o of own) {
    if (o.length >= 12 && full.slice(0, Math.min(o.length, 64)) === o) return true;
  }
  return false;
}

// A wedged/absent daemon must be distinguishable from "zero containers" —
// listContainers can't throw (pollers depend on []), so the last failure is
// surfaced side-channel via dockerDaemonError().
let lastDaemonError: string | null = null;
export function dockerDaemonError(): string | null {
  return lastDaemonError;
}

export async function listContainers(): Promise<DockerContainer[]> {
  // `-a`: stopped containers must be addressable too (detail/restart paths).
  const res = await dockerRun(`ps -a --format '{{json .}}'`);
  const out: DockerContainer[] = [];
  if (!res.ok) {
    lastDaemonError = (res.stderr || 'docker ps falló').trim().slice(0, 300) || 'docker ps falló';
    return out;
  }
  lastDaemonError = null;
  for (const line of res.stdout.split('\n').filter(Boolean)) {
    try {
      const row = JSON.parse(line) as DockerPsLine;
      const composeProject = row.Labels?.match(/com\.docker\.compose\.project=([^,]+)/)?.[1];
      out.push({
        id: row.ID,
        names: row.Names,
        image: row.Image,
        status: row.Status,
        state: row.State,
        ports: row.Ports || '',
        publicPorts: publicPortsFrom(row.Ports || ''),
        projectName: composeProject || row.Names,
        composeProject,
      });
    } catch { /* malformed line */ }
  }
  return out;
}

// Credential-looking values: suspicious key names OR any URI embedding
// user:password (e.g. DATABASE_URL=postgres://u:pw@db). Same rule as
// getProcessDetail in src/ports.ts.
const SECRET_KEY_RE = /(token|secret|key|pass|password|credential|auth|pwd|dsn|url|uri)/i;
const SECRET_VALUE_RE = /^[a-z0-9+\-.]+:\/\/[^/\s]*:[^@\s]+@/i;

export async function containerDetail(id: string) {
  const sid = safeId(id);
  if (!sid) return { env: {}, image: '', createdAt: '', startedAt: '', cmd: '', restartPolicy: '' };
  const res = await dockerRun(`inspect ${sid}`, 15_000);
  let info: any = null;
  try { info = JSON.parse(res.stdout)?.[0] || null; } catch { /* not json */ }
  const env: Record<string, string> = {};
  for (const e of info?.Config?.Env || []) {
    const eq = e.indexOf('=');
    if (eq < 0) continue;
    const k = e.slice(0, eq);
    let v = e.slice(eq + 1);
    if (SECRET_KEY_RE.test(k) || SECRET_VALUE_RE.test(v)) v = '••••••';
    env[k] = v;
  }
  return {
    env,
    image: info?.Config?.Image || '',
    createdAt: info?.Created || '',
    startedAt: info?.State?.StartedAt || '',
    cmd: (info?.Config?.Cmd || []).join(' ') || info?.Path || '',
    restartPolicy: info?.HostConfig?.RestartPolicy?.Name || '',
  };
}

export async function containerStats(id: string) {
  const sid = safeId(id);
  if (!sid) return null;
  const res = await dockerRun(`stats ${sid} --no-stream --format '{{json .}}'`, 15_000);
  try {
    const s = JSON.parse(res.stdout.trim()) as Record<string, string>;
    return {
      cpuPercent: s.CPUPerc,
      memoryUsage: s.MemUsage?.split('/')[0]?.trim(),
      memoryLimit: s.MemUsage?.split('/')[1]?.trim(),
      memoryPercent: s.MemPerc,
      networkIo: s.NetIO,
      blockIo: s.BlockIO,
      pids: s.PIDs,
    };
  } catch {
    return null;
  }
}

export async function containerLogs(id: string, tail = 200): Promise<string[]> {
  const sid = safeId(id);
  if (!sid) return [];
  const n = Math.min(Math.max(1, Math.floor(tail) || 200), 2000);
  const res = await dockerRun(`logs ${sid} --tail ${n} 2>&1`, 15_000);
  return res.stdout.split('\n');
}

export async function stopContainer(id: string): Promise<{ ok: boolean; error?: string }> {
  const sid = safeId(id);
  if (!sid) return { ok: false, error: 'ID de contenedor inválido' };
  // Self-protection: never stop Axon's own container through this endpoint.
  if (await isOwnContainer(sid)) {
    return { ok: false, error: 'Operación rechazada: este contenedor es la propia instancia de Axon' };
  }
  const res = await dockerRun(`stop ${sid}`, 25_000);
  if (!res.ok) return { ok: false, error: (res.stderr || res.stdout || 'docker stop falló').slice(0, 2000) };
  return { ok: true };
}
