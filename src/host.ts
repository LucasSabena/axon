import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import * as path from 'path';

// Filesystem of the host, mounted read-only inside the container at /hostfs.
// When running outside Docker (dev), host paths are accessible directly.
export const HOST_FS = existsSync('/hostfs/etc/hostname') ? '/hostfs' : '';
export const ON_HOST = HOST_FS === '';

export let HOST_USER = process.env.HOST_USER || 'root';

export function setHostUser(user: string) {
  if (user) HOST_USER = user;
}

// Extra PATH entries so user-level tools (pnpm, bun, uv, cargo) resolve even
// though we spawn a non-login shell.
const USER_PATH_EXPORT =
  'export PATH="$HOME/.local/share/pnpm/bin:$HOME/.local/share/pnpm:$HOME/.bun/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"; ' +
  'export PNPM_HOME="$HOME/.local/share/pnpm";';

const NSENTER = ['nsenter', '-t', '1', '-m', '-u', '-i', '-n', '-p', '--'];

export interface HostResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  command: string;
}

// 'user' is a token resolved to HOST_USER (the host's unprivileged account)
type ExecUser = 'root' | 'user' | string;

function buildArgv(command: string, user: ExecUser): string[] {
  const runAs = user === 'user' ? HOST_USER : user;
  if (ON_HOST) {
    const amRoot = process.getuid?.() === 0;
    if (amRoot) {
      return runAs === 'root'
        ? ['bash', '-lc', command]
        : ['runuser', '-u', runAs, '--', 'bash', '-lc', USER_PATH_EXPORT + command];
    }
    // Non-root on host (dev mode): can't escalate, run as ourselves.
    return ['bash', '-c', USER_PATH_EXPORT + command];
  }
  if (runAs === 'root') {
    return [...NSENTER, 'bash', '-lc', command];
  }
  return [...NSENTER, 'runuser', '-u', runAs, '--', 'bash', '-lc', USER_PATH_EXPORT + command];
}

export async function hostExec(
  command: string,
  opts: { user?: ExecUser; timeoutMs?: number } = {}
): Promise<HostResult> {
  const user = opts.user ?? 'root';
  const argv = buildArgv(command, user);
  try {
    const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' });
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { ok: code === 0, code, stdout, stderr, command };
  } catch (err) {
    return { ok: false, code: -1, stdout: '', stderr: String(err), command };
  }
}

// Spawn a long-running / streaming command on the host.
export function hostSpawn(
  command: string,
  opts: { user?: ExecUser } = {}
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(buildArgv(command, opts.user ?? 'root'), {
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

// Spawn an interactive host command with piped stdin — used for the embedded
// terminal (stdin 'pipe' + bidirectional piping over the WebSocket).
export function hostSpawnInteractive(
  command: string,
  opts: { user?: ExecUser } = {}
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(buildArgv(command, opts.user ?? 'user'), {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

// Spawn a detached host process that survives this container restarting.
// Uses a transient user systemd unit: runuser's PAM session dies with the
// command and takes every child cgroup with it (setsid is not enough).
// Returns the host PID (unit MainPID).
export async function hostSpawnDetached(
  command: string,
  cwd: string,
  logFile: string,
  user: ExecUser = 'user'
): Promise<{ ok: boolean; pid?: number; error?: string }> {
  const cmd = USER_PATH_EXPORT + `cd ${shq(cwd)} && ${command} >> ${shq(logFile)} 2>&1`;
  if (user !== 'root') {
    const unit = `pm-detach-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const env = 'export XDG_RUNTIME_DIR=/run/user/$(id -u); export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus; ';
    const spawn = await hostExec(
      `${env}systemd-run --user --collect --quiet --unit=${shq(unit)} -- bash -lc ${shq(cmd)}`,
      { user, timeoutMs: 15_000 }
    );
    if (spawn.ok) {
      for (let i = 0; i < 10; i++) {
        const res = await hostExec(`${env}systemctl --user show -p MainPID --value ${shq(unit)}`, { user, timeoutMs: 10_000 });
        const pid = parseInt(res.stdout.trim(), 10);
        if (pid > 0) return { ok: true, pid };
        await Bun.sleep(200);
      }
    }
    // Fall back to setsid if the user manager is unavailable.
  }
  const inner = `cd ${shq(cwd)} && setsid bash -lc ${shq(cmd)} < /dev/null & echo $!`;
  const res = await hostExec(inner, { user, timeoutMs: 15_000 });
  const pid = parseInt(res.stdout.trim().split('\n').pop() || '', 10);
  if (!res.ok || !pid) {
    return { ok: false, error: res.stderr || res.stdout || `exit ${res.code}` };
  }
  return { ok: true, pid };
}

// --- Path translation between host and container ---

export function hostToContainer(hostPath: string): string {
  if (!hostPath) return hostPath;
  if (ON_HOST) return hostPath;
  return HOST_FS + (hostPath.startsWith('/') ? hostPath : '/' + hostPath);
}

export function containerToHost(containerPath: string, mountRoot = HOST_FS): string {
  if (!containerPath) return containerPath;
  // realpath('/hostfs/') drops its trailing slash. The mount itself is the
  // host's '/', not an application directory called /hostfs.
  if (mountRoot && containerPath === mountRoot) return '/';
  if (mountRoot && containerPath.startsWith(mountRoot + '/')) {
    return containerPath.slice(mountRoot.length);
  }
  return containerPath;
}

export async function readHostFile(hostPath: string): Promise<string> {
  return readFile(hostToContainer(hostPath), 'utf-8');
}

export async function readHostJson<T>(hostPath: string): Promise<T | null> {
  try {
    return JSON.parse(await readHostFile(hostPath)) as T;
  } catch {
    return null;
  }
}

export async function hostDirEntries(hostPath: string): Promise<string[]> {
  try {
    return await readdir(hostToContainer(hostPath));
  } catch {
    return [];
  }
}

export async function hostExists(hostPath: string): Promise<boolean> {
  return existsSync(hostToContainer(hostPath));
}

export function joinHost(...parts: string[]): string {
  return path.join(...parts);
}
