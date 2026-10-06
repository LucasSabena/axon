import { SnapshotCache } from './snapshot-cache';
import { readFile, readdir, readlink } from 'fs/promises';
import * as path from 'path';
import {
  HOST_FS,
  hostToContainer,
  hostDirEntries,
  readHostJson,
  hostExec,
} from './host';
import type {
  Identity,
  KillPlan,
  Listener,
  PortProcess,
  KnownService,
} from './types';

// --- Well-known services, keyed by process name (comm) ---
const KNOWN_PROCESSES: Record<string, { name: string; icon: string; protect?: boolean }> = {
  postgres: { name: 'PostgreSQL', icon: 'database', protect: true },
  postmaster: { name: 'PostgreSQL', icon: 'database', protect: true },
  'redis-server': { name: 'Redis', icon: 'database-zap', protect: true },
  mysqld: { name: 'MySQL', icon: 'database', protect: true },
  mariadbd: { name: 'MariaDB', icon: 'database', protect: true },
  mongod: { name: 'MongoDB', icon: 'leaf', protect: true },
  nginx: { name: 'Nginx', icon: 'globe', protect: true },
  apache2: { name: 'Apache', icon: 'feather', protect: true },
  caddy: { name: 'Caddy', icon: 'globe', protect: true },
  traefik: { name: 'Traefik', icon: 'route', protect: true },
  sshd: { name: 'SSH', icon: 'terminal', protect: true },
  systemd: { name: 'systemd', icon: 'settings', protect: true },
  dockerd: { name: 'Docker daemon', icon: 'container', protect: true },
  containerd: { name: 'containerd', icon: 'container', protect: true },
  'docker-proxy': { name: 'Docker proxy', icon: 'container', protect: true },
  cloudflared: { name: 'Cloudflare Tunnel', icon: 'cloud', protect: true },
  'code-server': { name: 'code-server', icon: 'monitor' },
  'cockpit-ws': { name: 'Cockpit', icon: 'monitor' },
  ollama: { name: 'Ollama', icon: 'bot' },
  openchamber: { name: 'OpenChamber', icon: 'brain' },
  'chrome-remote': { name: 'Chrome Remote Desktop', icon: 'monitor-smartphone' },
  grafana: { name: 'Grafana', icon: 'chart-column' },
  prometheus: { name: 'Prometheus', icon: 'chart-line' },
  minio: { name: 'MinIO', icon: 'hard-drive' },
  vaultwarden: { name: 'Vaultwarden', icon: 'lock' },
  authentik: { name: 'Authentik', icon: 'shield' },
  'cupsd': { name: 'CUPS (impresión)', icon: 'printer', protect: true },
  'dnsmasq': { name: 'dnsmasq', icon: 'radar', protect: true },
  'avahi-daemon': { name: 'Avahi (mDNS)', icon: 'radar', protect: true },
};

// Well-known ports fallback when process name doesn't help.
const KNOWN_PORTS: Record<number, { name: string; icon: string }> = {
  22: { name: 'SSH', icon: 'terminal' },
  53: { name: 'DNS', icon: 'radar' },
  80: { name: 'HTTP', icon: 'globe' },
  443: { name: 'HTTPS', icon: 'lock' },
  3000: { name: 'Dev server', icon: 'zap' },
  3306: { name: 'MySQL', icon: 'database' },
  5432: { name: 'PostgreSQL', icon: 'database' },
  6379: { name: 'Redis', icon: 'database-zap' },
  8080: { name: 'HTTP alt', icon: 'globe' },
  9090: { name: 'Cockpit/Prometheus', icon: 'chart-line' },
  27017: { name: 'MongoDB', icon: 'leaf' },
};

const GENERIC_DIRS = new Set(['src', 'app', 'dist', 'build', 'bin', 'lib', 'server', 'client', 'web', 'frontend', 'backend', 'api', 'packages', 'apps', 'public', 'www', 'home', 'root']);

let customServices: Record<string, KnownService> = {};
let protectedPids: number[] = [];
let protectedPorts: number[] = [];
let ignoredPatterns: string[] = [];

export function configurePorts(settings: {
  knownServices?: Record<string, KnownService>;
  protectedPids?: number[];
  protectedPorts?: number[];
  ignoredPatterns?: string[];
}) {
  customServices = settings.knownServices || {};
  protectedPids = settings.protectedPids || [];
  protectedPorts = settings.protectedPorts || [];
  ignoredPatterns = settings.ignoredPatterns || [];
}

// --- ss parsing ---

interface RawListener extends Listener {
  pid: number;
  procName: string;
}

export async function scanListeners(): Promise<RawListener[]> {
  const res = await hostExec('ss -H -tulnp 2>/dev/null || ss -H -tuln', { user: 'root', timeoutMs: 15_000 });
  if (!res.ok && !res.stdout) {
    throw new Error(`ss falló (exit ${res.code}): ${res.stderr.slice(0, 300)}`);
  }
  const out = res.stdout;
  const listeners: RawListener[] = [];
  const re = /^(tcp|udp)\s+\S+\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+(?:\s+users:\(\("([^"]+)",pid=(\d+),fd=\d+\))?/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    listeners.push({
      proto: m[1] as 'tcp' | 'udp',
      address: m[2],
      port: parseInt(m[3], 10),
      procName: m[4] || '',
      pid: m[5] ? parseInt(m[5], 10) : 0,
    });
  }
  return listeners;
}

// --- /proc helpers (host pid namespace thanks to pid: host) ---

async function readProc(pid: number, file: string): Promise<string> {
  try {
    return await readFile(`/proc/${pid}/${file}`, 'utf-8');
  } catch {
    return '';
  }
}

async function procCmdline(pid: number): Promise<string> {
  try {
    const buf = await readFile(`/proc/${pid}/cmdline`);
    return buf.toString('utf-8').replace(/\0/g, ' ').trim();
  } catch {
    return '';
  }
}

async function procCwd(pid: number): Promise<string> {
  try {
    return await readlink(`/proc/${pid}/cwd`);
  } catch {
    return '';
  }
}

function procUid(status: string): number {
  const m = status.match(/^Uid:\s+(\d+)/m);
  return m ? parseInt(m[1], 10) : -1;
}

function procPpid(stat: string): number {
  // comm may contain spaces/parens; ppid is the field after the last ')'.
  const idx = stat.lastIndexOf(')');
  if (idx < 0) return 0;
  const parts = stat.slice(idx + 1).trim().split(/\s+/);
  return parseInt(parts[1] || '0', 10) || 0;
}

function procStartTime(stat: string): number {
  const idx = stat.lastIndexOf(')');
  if (idx < 0) return 0;
  const parts = stat.slice(idx + 1).trim().split(/\s+/);
  return parseInt(parts[19] || '0', 10) || 0; // starttime in jiffies
}

let cachedBootTime = 0;
let cachedClkTck = 100;

async function bootTime(): Promise<number> {
  if (cachedBootTime) return cachedBootTime;
  try {
    const stat = await readFile('/proc/stat', 'utf-8');
    const m = stat.match(/^btime\s+(\d+)/m);
    cachedBootTime = m ? parseInt(m[1], 10) : 0;
  } catch { /* keep 0 */ }
  try {
    const res = await hostExec('getconf CLK_TCK', { timeoutMs: 5000 });
    const v = parseInt(res.stdout.trim(), 10);
    if (v > 0) cachedClkTck = v;
  } catch { /* default 100 */ }
  return cachedBootTime;
}

function procRssMb(status: string): number {
  const m = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
  return m ? Math.round(parseInt(m[1], 10) / 1024) : 0;
}

const uidNameCache = new Map<number, string>();
async function uidToName(uid: number): Promise<string> {
  if (uidNameCache.has(uid)) return uidNameCache.get(uid)!;
  let name = String(uid);
  try {
    const passwd = await readFile(HOST_FS ? `${HOST_FS}/etc/passwd` : '/etc/passwd', 'utf-8');
    for (const line of passwd.split('\n')) {
      const parts = line.split(':');
      if (parseInt(parts[2], 10) === uid) { name = parts[0]; break; }
    }
  } catch { /* numeric uid */ }
  uidNameCache.set(uid, name);
  return name;
}

async function childPids(pid: number): Promise<number[]> {
  const content = await readProc(pid, 'task/' + pid + '/children');
  return content.split(/\s+/).filter(Boolean).map((v) => parseInt(v, 10));
}

async function processTree(pid: number, depth = 0): Promise<{ pid: number; name: string; cmd: string }[]> {
  if (depth > 6) return [];
  const kids = await childPids(pid);
  const out: { pid: number; name: string; cmd: string }[] = [];
  for (const kid of kids) {
    const [comm, cmd] = await Promise.all([readProc(kid, 'comm'), procCmdline(kid)]);
    out.push({ pid: kid, name: comm.trim() || '?', cmd });
    out.push(...(await processTree(kid, depth + 1)));
  }
  return out;
}

// --- Project / framework identification ---

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

const FRAMEWORKS: { key: string; name: string; icon: string }[] = [
  { key: 'next', name: 'Next.js', icon: 'triangle' },
  { key: 'astro', name: 'Astro', icon: 'rocket' },
  { key: 'nuxt', name: 'Nuxt', icon: 'leaf' },
  { key: '@sveltejs/kit', name: 'SvelteKit', icon: 'flame' },
  { key: '@remix-run/node', name: 'Remix', icon: 'disc' },
  { key: '@remix-run/react', name: 'Remix', icon: 'disc' },
  { key: 'expo', name: 'Expo', icon: 'smartphone' },
  { key: 'electron', name: 'Electron', icon: 'atom' },
  { key: '@nestjs/core', name: 'NestJS', icon: 'cat' },
  { key: 'vite', name: 'Vite', icon: 'zap' },
  { key: 'react', name: 'React', icon: 'atom' },
  { key: 'vue', name: 'Vue', icon: 'leaf' },
  { key: 'svelte', name: 'Svelte', icon: 'flame' },
  { key: 'angular', name: 'Angular', icon: 'angry' },
  { key: '@angular/core', name: 'Angular', icon: 'angry' },
  { key: 'hono', name: 'Hono', icon: 'flame' },
  { key: 'express', name: 'Express', icon: 'train-front' },
  { key: 'fastify', name: 'Fastify', icon: 'zap' },
  { key: 'tailwindcss', name: 'Tailwind', icon: 'palette' },
];

function frameworkFromDeps(deps: Record<string, string>): { name: string; icon: string } | null {
  for (const fw of FRAMEWORKS) {
    if (deps[fw.key]) return { name: fw.name, icon: fw.icon };
  }
  return null;
}

interface ProjectInfo {
  root: string;
  name?: string;
  framework?: string;
  icon?: string;
}

const projectCache = new Map<string, { at: number; info: ProjectInfo | null }>();
const PROJECT_CACHE_TTL = 30_000;

// Walk up from cwd looking for git root / manifests. Reads via /hostfs.
export async function findProjectInfo(cwd: string): Promise<ProjectInfo | null> {
  if (!cwd || cwd === '/' || cwd === '?') return null;
  const cacheKey = cwd;
  const cached = projectCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PROJECT_CACHE_TTL) return cached.info;

  const info = await findProjectInfoUncached(cwd);
  projectCache.set(cacheKey, { at: Date.now(), info });
  return info;
}

async function findProjectInfoUncached(cwd: string): Promise<ProjectInfo | null> {
  let dir = cwd;
  let root: string | null = null;
  let firstManifestDir: string | null = null;

  for (let i = 0; i < 8 && dir && dir !== '/'; i++) {
    const entries = await hostDirEntries(dir);
    if (entries.length === 0) break; // dir doesn't exist on host view
    if (entries.includes('.git')) { root = dir; break; }
    if (
      !firstManifestDir &&
      (entries.includes('package.json') ||
        entries.includes('pyproject.toml') ||
        entries.includes('Cargo.toml') ||
        entries.includes('go.mod') ||
        entries.includes('requirements.txt') ||
        entries.includes('Gemfile') ||
        entries.includes('composer.json'))
    ) {
      firstManifestDir = dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const base = root || firstManifestDir;
  if (!base) return null;

  const info: ProjectInfo = { root: base };

  const pkg = await readHostJson<PackageJson>(path.join(base, 'package.json'));
  if (pkg) {
    info.name = pkg.name;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const fw = frameworkFromDeps(deps);
    if (fw) { info.framework = fw.name; info.icon = fw.icon; }
    if (!info.framework) info.icon = 'package';
  }

  if (!info.framework) {
    const rawPy = await readFileSafe(path.join(base, 'pyproject.toml'));
    const rawReq = await readFileSafe(path.join(base, 'requirements.txt'));
    const pyText = `${rawPy}\n${rawReq}`;
    if (pyText.trim()) {
      const lower = pyText.toLowerCase();
      if (lower.includes('django')) { info.framework = 'Django'; info.icon = 'guitar'; }
      else if (lower.includes('fastapi')) { info.framework = 'FastAPI'; info.icon = 'zap'; }
      else if (lower.includes('flask')) { info.framework = 'Flask'; info.icon = 'flask-conical'; }
      else { info.framework = 'Python'; info.icon = 'snake'; }
    }
    if (!info.framework && await hostExistsPath(path.join(base, 'Cargo.toml'))) { info.framework = 'Rust'; info.icon = 'cog'; }
    else if (!info.framework && await hostExistsPath(path.join(base, 'go.mod'))) { info.framework = 'Go'; info.icon = 'squirrel'; }
    else if (!info.framework && await hostExistsPath(path.join(base, 'Gemfile'))) { info.framework = 'Ruby'; info.icon = 'gem'; }
    else if (!info.framework && await hostExistsPath(path.join(base, 'composer.json'))) { info.framework = 'PHP'; info.icon = 'file-code'; }
  }

  if (!info.name) info.name = path.basename(base);
  return info;
}

async function readFileSafe(hostPath: string): Promise<string> {
  try {
    return await readFile(hostToContainer(hostPath), 'utf-8');
  } catch {
    return '';
  }
}

async function hostExistsPath(hostPath: string): Promise<boolean> {
  try {
    const { existsSync } = await import('fs');
    return existsSync(hostToContainer(hostPath));
  } catch {
    return false;
  }
}

// --- Identity classification ---

function baseCmd(cmd: string): string {
  const first = (cmd || '').split('\0').join(' ').trim().split(/\s+/)[0] || '';
  return path.basename(first).replace(/\.(exe|sh|py)$/, '');
}

async function classify(pid: number, name: string, cmd: string, cwd: string, uid: number, ports: number[]): Promise<Identity> {
  const lower = cmd.toLowerCase();
  const procKey = name.toLowerCase();

  // Self-protection: never allow killing ourselves or our ancestors.
  if (pid === process.pid || protectedPids.includes(pid)) {
    return { category: 'system', label: name, icon: 'shield', protected: true, protectionReason: 'Proceso protegido (PID)' };
  }
  if (ports.some((p) => protectedPorts.includes(p))) {
    const port = ports.find((p) => protectedPorts.includes(p))!;
    return { category: 'service', label: name, icon: 'lock', protected: true, protectionReason: `Puerto protegido ${port}` };
  }

  // Config-defined known service by port (e.g. OpenChamber = 4095)
  for (const p of ports) {
    const known = customServices[String(p)];
    if (known) {
      return { category: 'service', label: known.name, icon: known.icon, serviceKey: `port:${p}`, protected: false };
    }
  }

  // Known process names
  const knownProc = KNOWN_PROCESSES[procKey] || KNOWN_PROCESSES[baseCmd(cmd)];
  if (knownProc) {
    return {
      category: 'service',
      label: knownProc.name,
      icon: knownProc.icon,
      serviceKey: procKey,
      protected: !!knownProc.protect || uid < 1000,
      protectionReason: knownProc.protect || uid < 1000 ? 'Servicio del sistema' : undefined,
    };
  }

  // Docker proxy / container ports
  if (procKey === 'docker-proxy' || lower.includes('docker-proxy')) {
    return { category: 'docker', label: 'Docker proxy', icon: 'container', protected: true, protectionReason: 'Gestionar desde la pestaña Docker' };
  }

  // code-server: comm is "MainThread" so name-based lookup misses it — match the path instead
  if (lower.includes('code-server')) {
    return { category: 'service', label: 'code-server', icon: 'code', serviceKey: 'code-server', protected: false };
  }

  // IDE / agent helper noise → classify but keep visible under "system-ish"
  if (/(^|\/)(code|cursor|code-server)[\s/]/.test(lower) && !lower.includes('serve-web')) {
    // could still be a real service (code-server serves a port) — keep as service
  }

  // Root-owned daemons we don't recognize
  if (uid >= 0 && uid < 1000) {
    const kp = KNOWN_PORTS[ports[0]];
    return {
      category: 'system',
      label: kp ? kp.name : name,
      icon: kp ? kp.icon : 'settings',
      protected: true,
      protectionReason: 'Proceso del sistema (uid < 1000)',
    };
  }

  // Try project detection
  const project = await findProjectInfo(cwd);
  if (project) {
    return {
      category: 'project',
      label: project.name || path.basename(project.root),
      icon: project.icon || 'folder-git-2',
      framework: project.framework,
      projectRoot: project.root,
      packageName: project.name,
      protected: false,
    };
  }

  // cwd under a home dir → still a user process, probably a script
  if (cwd.startsWith('/home/')) {
    const dirName = path.basename(cwd);
    const isHomeRoot = /^\/home\/[^/]+$/.test(cwd);
    const label = GENERIC_DIRS.has(dirName) || isHomeRoot ? name : dirName;
    const kp = KNOWN_PORTS[ports[0]];
    return {
      category: 'unknown',
      label: label === '.' ? name : label,
      icon: kp?.icon || 'circle-help',
      projectRoot: cwd,
      protected: false,
    };
  }

  const kp = KNOWN_PORTS[ports[0]];
  return {
    category: 'unknown',
    label: kp ? kp.name : name,
    icon: kp?.icon || 'circle-help',
    protected: false,
  };
}

function isIgnored(cmd: string): boolean {
  const lower = cmd.toLowerCase();
  return ignoredPatterns.some((p) => p && lower.includes(p.toLowerCase()));
}

// systemd supervision: last cgroup path component that is a real .service unit.
// e.g. .../user@1000.service/app.slice/zenzsual-producto-demo.service → user unit
function systemdUnit(cgroup: string): { unit: string; scope: 'user' | 'system' } | undefined {
  for (const line of cgroup.split('\n')) {
    const p = line.split(':').pop() || '';
    const last = p.split('/').pop() || '';
    if (last.endsWith('.service') && !last.startsWith('user@') && last !== 'systemd-udevd.service') {
      return { unit: last, scope: /user-\d+\.slice|user@/.test(p) ? 'user' : 'system' };
    }
  }
  return undefined;
}

// --- Port health probing ---

// Any resolved response (even 4xx/5xx/redirect) means something is answering.
// Connection refused / timeout → unhealthy. UDP listeners are never probed.
async function probePortHealth(port: number): Promise<{ ok: boolean; ms?: number }> {
  const t0 = performance.now();
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(400),
      redirect: 'manual',
    });
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch {
    return { ok: false };
  }
}

// --- Public API ---

const portFlights = new SnapshotCache<PortProcess[]>(0, 1);
export function listPortProcesses(): Promise<PortProcess[]> { return portFlights.get('ports', scanPortProcesses); }
async function scanPortProcesses(): Promise<PortProcess[]> {
  const listeners = await scanListeners();
  const byPid = new Map<number, RawListener[]>();
  const noPid: RawListener[] = [];
  for (const l of listeners) {
    if (!l.pid) { noPid.push(l); continue; }
    const arr = byPid.get(l.pid) || [];
    arr.push(l);
    byPid.set(l.pid, arr);
  }

  const boot = await bootTime();
  const now = Date.now() / 1000;

  const out: PortProcess[] = [];
  await Promise.all(
    Array.from(byPid.entries()).map(async ([pid, ls]) => {
      const [cmdline, cwd, status, stat, comm, cgroup] = await Promise.all([
        procCmdline(pid),
        procCwd(pid),
        readProc(pid, 'status'),
        readProc(pid, 'stat'),
        readProc(pid, 'comm'),
        readProc(pid, 'cgroup'),
      ]);
      if (!cmdline && !comm) return; // process vanished
      const name = (comm || '').trim() || baseCmd(cmdline) || '?';
      const cmd = cmdline || name;
      if (isIgnored(cmd)) return;
      const uid = procUid(status);
      const startJiffies = procStartTime(stat);
      const startedAtSec = boot && startJiffies ? boot + startJiffies / cachedClkTck : 0;
      const ports = Array.from(new Set(ls.map((l) => l.port))).sort((a, b) => a - b);
      const identity = await classify(pid, name, cmd, cwd, uid, ports);
      const unit = systemdUnit(cgroup);
      if (unit) { identity.unit = unit.unit; identity.unitScope = unit.scope; }
      out.push({
        pid,
        ppid: procPpid(stat),
        user: await uidToName(uid),
        uid,
        name,
        cmd,
        cwd,
        listeners: ls.map(({ proto, address, port }) => ({ proto, address, port })),
        ports,
        identity,
        memoryMb: procRssMb(status),
        uptimeSeconds: startedAtSec ? Math.max(0, Math.round(now - startedAtSec)) : 0,
        startedAt: startedAtSec ? new Date(startedAtSec * 1000).toISOString() : '',
      });
    })
  );

  // Kernel/system sockets with no owning pid
  if (noPid.length) {
    const byPort = new Map<number, RawListener[]>();
    for (const l of noPid) {
      const arr = byPort.get(l.port) || [];
      arr.push(l);
      byPort.set(l.port, arr);
    }
    for (const [port, ls] of byPort) {
      const kp = KNOWN_PORTS[port];
      out.push({
        pid: 0,
        ppid: 0,
        user: 'kernel',
        uid: 0,
        name: ls[0].procName || 'kernel',
        cmd: '',
        cwd: '',
        listeners: ls.map(({ proto, address, port: p }) => ({ proto, address, port: p })),
        ports: [port],
        identity: {
          category: 'system',
          label: kp ? kp.name : `socket :${port}`,
          icon: kp?.icon || 'puzzle',
          protected: true,
          protectionReason: 'Socket del kernel (sin PID)',
        },
        memoryMb: 0,
        uptimeSeconds: 0,
        startedAt: '',
      });
    }
  }

  // Probe TCP listeners for HTTP health, all in parallel. UDP → healthy=null.
  // Worst-case added latency is bounded by the 400ms abort timeout.
  const tcpPorts = new Set<number>();
  for (const p of out) {
    for (const l of p.listeners) {
      if (l.proto === 'udp') l.healthy = null;
      else tcpPorts.add(l.port);
    }
  }
  const health = new Map<number, { ok: boolean; ms?: number }>();
  await Promise.all(
    Array.from(tcpPorts).map(async (port) => {
      health.set(port, await probePortHealth(port));
    })
  );
  for (const p of out) {
    for (const l of p.listeners) {
      if (l.proto !== 'udp') {
        const h = health.get(l.port);
        l.healthy = h ? h.ok : null;
        l.latencyMs = h?.ms;
      }
    }
  }

  out.sort((a, b) => (a.ports[0] || 0) - (b.ports[0] || 0));
  return out;
}

export async function killPlan(pid: number): Promise<KillPlan | null> {
  const [cmd, cwd, status, stat, comm, cgroup] = await Promise.all([
    procCmdline(pid),
    procCwd(pid),
    readProc(pid, 'status'),
    readProc(pid, 'stat'),
    readProc(pid, 'comm'),
    readProc(pid, 'cgroup'),
  ]);
  if (!cmd && !comm) return null;
  const name = (comm || '').trim() || baseCmd(cmd) || '?';
  const uid = procUid(status);

  const listeners = await scanListeners();
  const ports = listeners.filter((l) => l.pid === pid).map((l) => l.port);
  const identity = await classify(pid, name, cmd || name, cwd, uid, ports);
  const unit = systemdUnit(cgroup);
  if (unit) { identity.unit = unit.unit; identity.unitScope = unit.scope; }
  const tree = await processTree(pid);

  const warnings: string[] = [];
  if (unit) {
    warnings.push(`Supervisado por systemd (${unit.unit}, scope ${unit.scope}): si lo cerrás, se va a reiniciar solo. Usá "Detener servicio" para apagarlo de verdad.`);
  }
  if (tree.length > 0) warnings.push(`Este proceso tiene ${tree.length} proceso(s) hijo que también se cerrarán.`);
  if (ports.length > 1) warnings.push(`Liberará ${ports.length} puertos: ${ports.join(', ')}.`);
  if (uid === 0) warnings.push('El proceso corre como root.');
  if (identity.category === 'project' && identity.projectRoot) {
    warnings.push(`Proyecto: ${identity.projectRoot}`);
  }

  return {
    pid,
    name,
    cmd: cmd || name,
    cwd,
    identity,
    portsFreed: ports,
    tree: [{ pid, name, cmd: cmd || name }, ...tree],
    warnings,
    blocked: identity.protected ? identity.protectionReason || 'Proceso protegido' : undefined,
  };
}

export async function killProcessTree(pid: number): Promise<{ ok: boolean; killed: number[]; error?: string }> {
  if (pid <= 1) return { ok: false, killed: [], error: 'PID inválido' };
  if (pid === process.pid || protectedPids.includes(pid)) {
    return { ok: false, killed: [], error: 'Proceso protegido' };
  }
  const listeners = await scanListeners();
  const ports = listeners.filter((l) => l.pid === pid).map((l) => l.port);
  const port = ports.find((p) => protectedPorts.includes(p));
  if (port !== undefined) {
    return { ok: false, killed: [], error: `Puerto protegido ${port}` };
  }

  const tree = await processTree(pid);
  const targets = [pid, ...tree.map((t) => t.pid)];

  const sendSignal = async (signal: 'TERM' | 'KILL') => {
    // Signal on the host via nsenter so signal delivery is in host context.
    const pids = targets.join(' ');
    await hostExec(`kill -${signal} ${pids} 2>/dev/null; true`, { user: 'root', timeoutMs: 10_000 });
  };

  await sendSignal('TERM');
  const deadline = Date.now() + 3000;
  let alive = targets.length;
  while (Date.now() < deadline) {
    alive = 0;
    for (const t of targets) {
      if (await procAlive(t)) alive++;
    }
    if (alive === 0) break;
    await Bun.sleep(250);
  }
  if (alive > 0) {
    await sendSignal('KILL');
    await Bun.sleep(300);
  }

  const killed: number[] = [];
  for (const t of targets) {
    if (!(await procAlive(t))) killed.push(t);
  }
  return { ok: killed.includes(pid), killed };
}

async function procAlive(pid: number): Promise<boolean> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf-8');
    const idx = stat.lastIndexOf(')');
    const state = stat.slice(idx + 1).trim().split(/\s+/)[0];
    return state !== 'Z' && state !== 'X';
  } catch {
    return false;
  }
}

export async function getProcessDetail(pid: number) {
  const [cmd, cwd, status, stat, comm] = await Promise.all([
    procCmdline(pid),
    procCwd(pid),
    readProc(pid, 'status'),
    readProc(pid, 'stat'),
    readProc(pid, 'comm'),
  ]);
  if (!cmd && !comm) return null;

  let env: Record<string, string> = {};
  try {
    const raw = await readFile(`/proc/${pid}/environ`);
    for (const entry of raw.toString('utf-8').split('\0')) {
      if (!entry) continue;
      const eq = entry.indexOf('=');
      if (eq < 0) continue;
      const key = entry.slice(0, eq);
      let value = entry.slice(eq + 1);
      // Mask anything whose name or value smells like a credential —
      // DATABASE_URL=postgres://u:secret@… has a clean key name but leaks.
      if (/(token|secret|key|pass|password|credential|auth)/i.test(key)
        || /^[a-z0-9+\-.]+:\/\/[^/\s]*:[^@\s]+@/i.test(value)) value = '••••••';
      env[key] = value;
    }
  } catch { /* no perms */ }

  const uid = procUid(status);
  const listeners = await scanListeners();
  const ports = listeners.filter((l) => l.pid === pid).map((l) => l.port);
  const name = (comm || '').trim() || baseCmd(cmd) || '?';
  const identity = await classify(pid, name, cmd || name, cwd, uid, ports);

  const boot = await bootTime();
  const startJiffies = procStartTime(stat);
  const startedAtSec = boot && startJiffies ? boot + startJiffies / cachedClkTck : 0;
  const threads = parseInt(status.match(/^Threads:\s+(\d+)/m)?.[1] || '0', 10);

  return {
    pid,
    ppid: procPpid(stat),
    name,
    cmd: cmd || name,
    cwd,
    user: await uidToName(uid),
    ports,
    identity,
    env,
    stats: {
      cpuPercent: 0,
      memoryMb: procRssMb(status),
      uptimeSeconds: startedAtSec ? Math.max(0, Math.round(Date.now() / 1000 - startedAtSec)) : 0,
      threads,
    },
    startedAt: startedAtSec ? new Date(startedAtSec * 1000).toISOString() : '',
  };
}
