import { resolveHostPath, projectSearchRoots } from './host-storage';
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import * as path from 'path';
import {
  hostDirEntries,
  hostExists,
  hostToContainer,
  readHostJson,
  hostSpawnDetached,
  hostExec,
} from './host';
import { killProcessTree, listPortProcesses, procStartTime } from './ports';
import type { AppConfig, Project } from './types';

// POSIX single-quote escaping: 'foo'bar' -> 'foo'"'"'bar'. JSON.stringify
// would still expand $()/backticks inside a shell double-quoted string.
const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

// HOST-side dir where detached project processes write their logs (the
// redirect runs on the host, so container paths like /app/data don't exist
// there). Read back through the /hostfs mount via hostToContainer().
const HOST_LOG_DIR = process.env.HOST_LOG_DIR || '/tmp/pm-logs';
// Legacy container-side dir (pre-fix logs may still live there).
const LEGACY_LOG_DIR = process.env.LOG_DIR || '/app/data/logs';

let configRef: AppConfig | null = null;
let saveConfigFn: ((c: AppConfig) => Promise<void>) | null = null;
let projects: Project[] = [];

export function initProjects(config: AppConfig, save: (c: AppConfig) => Promise<void>) {
  configRef = config;
  saveConfigFn = save;
  projects = config.projects || [];
}

export function getProjects(): Project[] {
  return projects;
}

export function getProjectById(id: string): Project | undefined {
  return projects.find((p) => p.id === id);
}

export async function saveProjects(list?: Project[]) {
  if (list) projects = list;
  if (configRef && saveConfigFn) {
    configRef.projects = projects;
    await saveConfigFn(configRef);
  }
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.astro', '.venv', 'venv',
  '__pycache__', 'target', 'vendor', '.cache', '.npm', '.pnpm-store', 'coverage',
  '.turbo', '.vercel', '.output', 'out',
]);

interface PackageJsonShape {
  name?: string;
  scripts?: Record<string, string>;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function detectProjectsOnDisk(): Promise<Project[]> {
  const dirs=await projectSearchRoots(getProjectScanDirs());
  const found:Project[]=[];
  const budget={visited:new Set<string>(),entries:0,deadline:Date.now()+20_000};
  for(const dir of dirs)await scanDir(dir,found,0,budget);
  // Self-exclusion: never offer axon itself as a startable project.
  return found.filter((p) => !p.cwd.endsWith('/axon'));
}

export function getProjectScanDirs(){return configRef?.settings.scanDirs||[];}
async function scanDir(dir: string, found: Project[], depth: number,budget:{visited:Set<string>;entries:number;deadline:number}) {
  if(depth>4||budget.entries>=20_000||Date.now()>budget.deadline)return;
  let info;try{info=await lstat(hostToContainer(dir));}catch{return;}
  if(!info.isDirectory()||info.isSymbolicLink())return;
  const key=info.dev+':'+info.ino;if(budget.visited.has(key))return;budget.visited.add(key);
  budget.entries++;
  const entries = await hostDirEntries(dir);
  if (entries.includes('package.json') || entries.includes('pyproject.toml') ||
      entries.includes('requirements.txt') || entries.includes('Cargo.toml') ||
      entries.includes('go.mod')) {
    const project = await projectFromDir(dir);
    if (project) found.push(project);
    // Don't descend into a detected project (sub-packages surface via monorepo tools)
    if (!entries.includes('pnpm-workspace.yaml') && !entries.includes('turbo.json')) return;
  }
  for (const entry of entries) {
    if(++budget.entries>20_000||Date.now()>budget.deadline)return;
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const sub = path.join(dir, entry);
    if (await isHostDir(sub)) {
      await scanDir(sub, found, depth + 1,budget);
    }
  }
}

async function isHostDir(hostPath: string): Promise<boolean> {
  try {
    return (await lstat(hostToContainer(hostPath))).isDirectory();
  } catch {
    return false;
  }
}

async function projectFromDir(cwd: string): Promise<Project | null> {
  const pkg = await readHostJson<PackageJsonShape>(path.join(cwd, 'package.json'));
  const isPy = await hostExists(path.join(cwd, 'pyproject.toml')) || await hostExists(path.join(cwd, 'requirements.txt'));
  const isRust = await hostExists(path.join(cwd, 'Cargo.toml'));
  const isGo = await hostExists(path.join(cwd, 'go.mod'));

  let type: Project['type'] = 'other';
  let framework: string | undefined;
  let pm: Project['packageManager'];

  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['next']) framework = 'Next.js';
    else if (deps['astro']) framework = 'Astro';
    else if (deps['nuxt']) framework = 'Nuxt';
    else if (deps['@sveltejs/kit']) framework = 'SvelteKit';
    else if (deps['vite']) framework = 'Vite';
    else if (deps['react']) framework = 'React';
    else if (deps['expo']) framework = 'Expo';
    else if (deps['hono']) framework = 'Hono';
    else if (deps['express']) framework = 'Express';
    else if (deps['fastify']) framework = 'Fastify';

    const entries = await hostDirEntries(cwd);
    const pmField = pkg.packageManager || '';
    if (pmField.startsWith('bun') || entries.includes('bun.lock') || entries.includes('bun.lockb')) pm = 'bun';
    else if (pmField.startsWith('pnpm') || entries.includes('pnpm-lock.yaml')) pm = 'pnpm';
    else if (pmField.startsWith('yarn') || entries.includes('yarn.lock')) pm = 'yarn';
    else pm = 'pnpm'; // default per preference; standalone pnpm handles any project
    type = pm === 'bun' ? 'bun' : 'node';
  } else if (isPy) {
    type = 'python';
    framework = 'Python';
  } else if (isRust) {
    type = 'rust';
    framework = 'Rust';
  } else if (isGo) {
    type = 'go';
    framework = 'Go';
  } else {
    return null;
  }

  return {
    id: generateId(),
    name: pkg?.name || path.basename(cwd),
    cwd,
    type,
    framework,
    packageManager: pm,
    autoDetect: true,
    command: inferCommand(cwd, type, pm, pkg),
  };
}

function inferCommand(cwd: string, type: Project['type'], pm: Project['packageManager'], pkg?: PackageJsonShape | null): string | undefined {
  if (type === 'node' || type === 'bun') {
    const runner = pm === 'bun' ? 'bun run' : pm === 'yarn' ? 'yarn' : 'pnpm run';
    const scripts = pkg?.scripts || {};
    for (const s of ['dev', 'start:dev', 'start', 'serve']) {
      if (scripts[s]) return withHost(`${runner} ${s}`, scripts[s]);
    }
    return undefined;
  }
  if (type === 'python') {
    return undefined; // require explicit command; too many conventions
  }
  if (type === 'rust') return 'cargo run';
  if (type === 'go') return 'go run .';
  return undefined;
}

// Ensure dev servers bind 0.0.0.0 so the port is reachable beyond localhost.
function withHost(command: string, script: string): string {
  if (/--host|HOST=|0\.0\.0\.0|--hostname/.test(command) || /--host|HOST=/.test(script)) return command;
  if (/next|nuxt|astro|vite|remix|svelte|expo|serve/.test(script)) return `${command} -- --host 0.0.0.0`;
  return command;
}

function generateId(): string {
  return crypto.randomUUID();
}

// Match process cwd to a project dir — ancestor-aware so monorepo packages match.
function cwdMatches(procCwd: string, projectCwd: string): boolean {
  if (!procCwd || !projectCwd) return false;
  return procCwd === projectCwd || procCwd.startsWith(projectCwd + '/');
}

export async function refreshRunning(): Promise<Project[]> {
  const processes = await listPortProcesses().catch(() => []);
  // The kill -0 probes are independent — run them all at once instead of
  // serially (each hostExec is a ~50ms spawn).
  await Promise.all(projects.map(async (p) => {
    const match = processes.find(
      (proc) => proc.pid > 0 && cwdMatches(proc.cwd, p.cwd)
    );
    if (match) {
      p.running = { pid: match.pid, ports: match.ports, startedAt: match.startedAt };
    } else if (p.running) {
      // Process may exist but no listener yet — check pid alive. kill -0 alone
      // keeps a stale record alive after a host restart recycles the pid, so
      // also require the live process to run inside the project directory.
      const pid = p.running.pid;
      const cwd = pid > 0 ? await readlink(`/proc/${pid}/cwd`).catch(() => '') : '';
      if (!cwdMatches(cwd, p.cwd)) p.running = undefined;
    }
  }));
  return projects;
}

export async function startProject(project: Project): Promise<{ ok: boolean; error?: string; pid?: number; command?: string; needsInstall?: boolean }> {
  try{await resolveHostPath(project.cwd,{directory:true});}catch(e){return {ok:false,error:e instanceof Error?e.message:'Disco no disponible'};}
  const command = project.command;
  if (!command) {
    return { ok: false, error: 'El proyecto no tiene comando de arranque. Editá el proyecto y definilo.' };
  }

  // Deps check for JS projects
  if (project.type === 'node' || project.type === 'bun') {
    const nm = await hostDirEntries(path.join(project.cwd, 'node_modules'));
    if (nm.length === 0) {
      return {
        ok: false,
        needsInstall: true,
        command,
        error: `Faltan dependencias. Ejecutá "Instalar deps" primero (${installCommand(project)}).`,
      };
    }
  }

  await hostExec(`mkdir -p ${shq(HOST_LOG_DIR)} && chmod 700 ${shq(HOST_LOG_DIR)}`, { user: 'user', timeoutMs: 10_000 });
  // Keyed by project id, not name — two projects sharing a name (or one
  // renamed) must never read each other's logs.
  const logFile = path.join(HOST_LOG_DIR, `${String(project.id).replace(/[^\w.-]+/g, '-')}-${Date.now()}.log`);
  const res = await hostSpawnDetached(command, project.cwd, logFile, 'user');
  if (!res.ok) {
    return { ok: false, error: `No se pudo lanzar el proceso en el host: ${res.error}`, command };
  }

  // Give it a moment and check it's alive
  await Bun.sleep(800);
  const alive = (await hostExec(`kill -0 ${res.pid}`, { timeoutMs: 5000 })).ok;
  if (!alive) {
    const tail = await hostExec(`tail -n 30 ${shq(logFile)}`, { timeoutMs: 5000 });
    return {
      ok: false,
      command,
      error: `El proceso arrancó pero terminó de inmediato. Últimas líneas del log:\n${tail.stdout || tail.stderr}`,
    };
  }

  project.running = { pid: res.pid!, ports: [], startedAt: new Date().toISOString() };
  await saveProjects();
  return { ok: true, pid: res.pid, command };
}

export async function stopProject(project: Project): Promise<{ ok: boolean; error?: string }> {
  const processes = await listPortProcesses().catch(() => []);
  const proc = processes.find((p) => p.pid > 0 && cwdMatches(p.cwd, project.cwd));
  let pid = proc?.pid;
  let expectedStart: number | undefined;
  if (!pid && project.running?.pid) {
    // The persisted pid is only a hint: after a restart it may have been
    // recycled by an unrelated (possibly system) process. Never signal a pid
    // whose live cwd is outside the project directory — and pin the process
    // incarnation so a recycle between this check and the kill is refused.
    const candidate = project.running.pid;
    if (candidate > 0) {
      const [cwd, stat] = await Promise.all([
        readlink(`/proc/${candidate}/cwd`).catch(() => ''),
        readFile(`/proc/${candidate}/stat`, 'utf-8').catch(() => ''),
      ]);
      if (cwdMatches(cwd, project.cwd)) {
        pid = candidate;
        expectedStart = procStartTime(stat) || undefined;
      }
    }
  }
  if (!pid) return { ok: false, error: 'El proyecto no está corriendo' };
  const res = await killProcessTree(pid, expectedStart);
  if (!res.ok) return { ok: false, error: res.error || 'No se pudo detener' };
  project.running = undefined;
  await saveProjects();
  return { ok: true };
}

export function installCommand(project: Project): string {
  if (project.type === 'python') {
    return 'uv sync 2>/dev/null || pip install -r requirements.txt';
  }
  const pm = project.packageManager || 'pnpm';
  if (pm === 'bun') return 'bun install';
  if (pm === 'yarn') return 'yarn install';
  return 'pnpm install';
}

export async function installDeps(project: Project): Promise<{ ok: boolean; output?: string; error?: string; command: string }> {
  const command = installCommand(project);
  try{await resolveHostPath(project.cwd,{directory:true,fresh:true});}catch(e){return {ok:false,command,error:e instanceof Error?e.message:'Disco no disponible'};}
  const res = await hostExec(`cd ${shq(project.cwd)} && ${command} 2>&1`, {
    user: 'user',
    timeoutMs: 10 * 60_000,
  });
  return { ok: res.ok, output: res.stdout, error: res.ok ? undefined : res.stderr || `exit ${res.code}`, command };
}

export async function projectLogs(project: Project, tail = 200): Promise<string[]> {
  try {
    const lines = Number.isFinite(tail) ? Math.min(2000, Math.max(1, Math.trunc(tail))) : 200;
    // Primary key is the project id; the name prefix is only a fallback for
    // logs written before the id-keyed naming existed.
    const prefixes = [
      String(project.id).replace(/[^\w.-]+/g, '-'),
      project.name.replace(/[^\w.-]+/g, '-'),
    ];
    const dirs = [hostToContainer(HOST_LOG_DIR), LEGACY_LOG_DIR];
    // Files are '<prefix>-<epoch ms>.log'; requiring the timestamp stops
    // prefixes sharing a leading dash ('web' vs 'web-app') from mixing.
    // byPrefix[0] = id-keyed (authoritative); [1] = legacy name-keyed —
    // used only when the project has no id-keyed log at all, so homonymous
    // projects never read each other's files.
    const byPrefix: { path: string; at: number }[][] = [[], []];
    for (const d of dirs) {
      for (const f of await readdir(d).catch(() => [] as string[])) {
        const i = prefixes.findIndex((p) => f.startsWith(p + '-'));
        const stamp = i >= 0 ? f.slice(prefixes[i].length + 1) : '';
        if (/^\d+\.log$/.test(stamp)) byPrefix[i].push({ path: path.join(d, f), at: parseInt(stamp, 10) });
      }
    }
    const files = byPrefix[0].length ? byPrefix[0] : byPrefix[1];
    files.sort((a, b) => a.at - b.at);
    const latest = files.at(-1)?.path;
    if (!latest) return [];
    // Read through the /hostfs mount directly — the log lives on the host.
    const content = await readFile(latest, 'utf-8');
    return content.split('\n').slice(-lines);
  } catch {
    return [];
  }
}
