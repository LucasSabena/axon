import { existsSync, readdirSync, readFileSync } from 'fs';
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

function buildArgv(command: string, user: ExecUser, timeoutSec = 0): string[] {
  const runAs = user === 'user' ? HOST_USER : user;
  // `timeout(1)` bounds the REMOTE command, not just our local wrapper:
  // SIGKILL on nsenter/runuser would orphan a still-running host process.
  // Without --foreground the command gets its own process group, so the
  // timeout kill reaches the whole tree.
  const t = (argv: string[]) =>
    timeoutSec > 0 ? ['timeout', '-k', '5s', `${timeoutSec}s`, ...argv] : argv;
  if (ON_HOST) {
    const amRoot = process.getuid?.() === 0;
    if (amRoot) {
      return runAs === 'root'
        ? t(['bash', '-lc', command])
        : ['runuser', '-u', runAs, '--', ...t(['bash', '-lc', USER_PATH_EXPORT + command])];
    }
    // Direct-host development uses the same process-group timeout as Docker.
    // Killing bash alone leaves its children holding stdout and the request open.
    return t(['bash', '-c', USER_PATH_EXPORT + command]);
  }
  if (runAs === 'root') {
    return [...NSENTER, ...t(['bash', '-lc', command])];
  }
  return [...NSENTER, 'runuser', '-u', runAs, '--', ...t(['bash', '-lc', USER_PATH_EXPORT + command])];
}

export async function hostExec(
  command: string,
  opts: { user?: ExecUser; timeoutMs?: number } = {}
): Promise<HostResult> {
  const user = opts.user ?? 'root';
  const timeoutMs = opts.timeoutMs ?? 60_000;
  // The remote `timeout` is the real bound; the local kill is only a backstop
  // (fires after the host-side wrapper should already have reaped the group).
  const argv = buildArgv(command, user, Math.ceil(timeoutMs / 1000));
  try {
    const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' });
    // Remote `timeout -k 5s` force-kills its group at ceil(timeoutMs)+5s; a
    // closer local kill would reap `timeout` itself and orphan a TERM-ignoring
    // remote command unbounded — keep the backstop past the remote deadline.
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs + 10_000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { ok: code === 0, code, stdout, stderr, command };
    } finally { clearTimeout(timer); }
  } catch (err) {
    return { ok: false, code: -1, stdout: '', stderr: String(err), command };
  }
}

// Process starttime (jiffies) from /proc — a pid's identity proof. Pids get
// recycled; (pid, starttime) does not within any window we care about.
export function procStartTime(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    // state ppid pgrp session … starttime is field 22 → index 19 after comm.
    const v = parseInt(fields[19], 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

type HostProc = ReturnType<typeof Bun.spawn> & { _axonStart?: number };

function stampSpawn(proc: HostProc): HostProc {
  const t = procStartTime(proc.pid);
  if (t !== null) proc._axonStart = t;
  return proc;
}

// Spawn a long-running / streaming command on the host.
export function hostSpawn(
  command: string,
  opts: { user?: ExecUser; timeoutSec?: number } = {}
): ReturnType<typeof Bun.spawn> {
  // setsid makes the wrapper a session/group leader so killHostProc reaches
  // the whole remote tree; proc.kill() alone would orphan host children of
  // the killed bash (same rationale as boundedCommand).
  return stampSpawn(Bun.spawn(['setsid', ...buildArgv(command, opts.user ?? 'root', opts.timeoutSec ?? 0)], {
    stdout: 'pipe',
    stderr: 'pipe',
  }));
}

// Spawn an interactive host command with piped stdin — used for the embedded
// terminal (stdin 'pipe' + bidirectional piping over the WebSocket).
export function hostSpawnInteractive(
  command: string,
  opts: { user?: ExecUser } = {}
): ReturnType<typeof Bun.spawn> {
  return stampSpawn(Bun.spawn(['setsid', ...buildArgv(command, opts.user ?? 'user')], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  }));
}

// Pids in the session led by `sid` (setsid makes the spawn its session
// leader). Group signaling can't be used: `timeout(1)` calls setpgid(0,0)
// and drags the remote command OUT of the wrapper's group — the session id
// is the only handle that still covers both.
function sessionPids(sid: number): number[] {
  const out: number[] = [];
  let entries: string[];
  try { entries = readdirSync('/proc'); } catch { return out; }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const stat = readFileSync(`/proc/${e}/stat`, 'utf-8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      // state ppid pgrp session — field 3 after the comm parenthesis.
      if (parseInt(fields[3], 10) === sid) out.push(parseInt(e, 10));
    } catch { /* process gone or unreadable */ }
  }
  return out;
}

// Kill the whole host-side process tree of a hostSpawn/hostSpawnInteractive
// child — the container shares the host pid namespace, so signals reach the
// remote tree. Falls back to the wrapper pid if the session scan finds none.
//
// Pid-recycle safety: sid membership alone can't be trusted once the leader
// is gone — a recycled pid could lead an innocent session. So: if the
// leader's stat is present but its starttime differs from the one recorded
// at spawn, signal NOTHING; if the stat is absent, no process currently
// holds that sid as leader, so every session member left is necessarily one
// of our orphans; if present and matching, the session is verifiably ours.
export function killHostProc(proc: { pid: number; kill(sig?: number | string): void; _axonStart?: number }, sig: 'SIGTERM' | 'SIGKILL' = 'SIGKILL'): void {
  const leaderStart = proc._axonStart;
  const session = (s: 'SIGTERM' | 'SIGKILL') => {
    if (leaderStart !== undefined) {
      const now = procStartTime(proc.pid);
      if (now !== null && now !== leaderStart) return false; // pid recycled
    }
    let hit = false;
    for (const pid of sessionPids(proc.pid)) {
      try { process.kill(pid, s); hit = true; } catch { /* already gone */ }
    }
    return hit;
  };
  // Bare-pid fallback (unstamped callers, or a stamped leader that vanished
  // without leaving session members). NEVER signal a pid whose recorded
  // starttime no longer matches — that pid belongs to someone else now.
  const fallback = (s: 'SIGTERM' | 'SIGKILL') => {
    if (leaderStart !== undefined && procStartTime(proc.pid) !== leaderStart) return;
    try { proc.kill(s); } catch { /* already gone */ }
  };
  if (sig === 'SIGKILL') {
    // TERM first so `timeout` and shells can run their teardown, then KILL
    // whatever ignored it — all within the same session.
    session('SIGTERM');
    setTimeout(() => {
      if (!session('SIGKILL')) fallback('SIGKILL');
    }, 400).unref?.();
    return;
  }
  if (!session(sig)) fallback(sig);
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
      // The unit was submitted — the command may already be running. A failed
      // or empty MainPID query must NOT fall through to the setsid fallback:
      // that would launch the command a second time.
      for (let i = 0; i < 10; i++) {
        const res = await hostExec(`${env}systemctl --user show -p MainPID,ActiveState --value ${shq(unit)}`, { user, timeoutMs: 10_000 });
        if (!res.ok) {
          return { ok: false, error: 'No se pudo verificar el proceso lanzado; no se reintentó para evitar duplicarlo' };
        }
        const [pidRaw, state] = res.stdout.trim().split('\n');
        const pid = parseInt(pidRaw || '', 10);
        if (pid > 0) return { ok: true, pid };
        // A definitively dead unit means the command failed to start.
        if (state === 'failed' || state === 'inactive' || state === 'dead') break;
        await Bun.sleep(200);
      }
      return { ok: false, error: 'La unidad no reportó un proceso activo; no se relanzó para evitar duplicados' };
    }
    // Fall back to setsid only when systemd-run itself refused to run.
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
