import { hostExec, hostSpawnInteractive, killHostProc } from './host';
import { MaintenanceError } from './storage/types';

/* Piezas comunes de los módulos "Bots" (openbot*.ts). Nada acá toca el navegador:
 * todo comando es fijo y toda entrada externa se valida y se cita antes de usarse. */

export const DIR = '~/openbot-server';
export const CONTAINER = /^[a-z0-9][a-z0-9_.-]{0,40}$/.test(process.env.OPENBOT_CONTAINER || '') ? process.env.OPENBOT_CONTAINER! : 'openbot';
export const VOLUME = /^[a-z0-9][a-z0-9_.-]{0,40}$/.test(process.env.OPENBOT_VOLUME || '') ? process.env.OPENBOT_VOLUME! : 'openbot-data';
export const b64 = (s: string) => Buffer.from(s).toString('base64');
export const q = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
export const stripAnsi = (s: string) => s.replace(ANSI, '');
export const clean = (s: string) => stripAnsi(s).replace(/\r/g, '');
export const lastLines = (s: string, n = 3) => clean(s).split('\n').map((l) => l.trim()).filter(Boolean).slice(-n).join(' · ');
export const safeJson = <T>(s: string): T | null => { try { return JSON.parse(s) as T; } catch { return null; } };
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Comando del host como el usuario normal (grupo docker). */
export const sh = (command: string, timeoutMs = 60_000) => hostExec(command, { user: 'user', timeoutMs });
/** Comando del host como root (solo para tocar el volumen de datos con el contenedor detenido). */
export const asRoot = (command: string, timeoutMs = 60_000) => hostExec(command, { user: 'root', timeoutMs });

/** Ruta del binario de OpenCode que OpenBot descargó dentro del contenedor (la versión cambia). */
export const OPENCODE_BIN = 'B=$(echo /data/.config/OpenBot/provider-runtimes/opencode/linux-x64/*/bin/opencode)';
export const BUN_BIN = 'BUN=$(find /data/.config/OpenBot/provider-runtimes/bun -type f -name bun -perm -u+x 2>/dev/null | head -n 1)';

/** Un solo trabajo "pesado" a la vez (parar/editar/arrancar, restaurar, actualizar): evita pisarse. */
let heavy: { name: string; at: number } | null = null;
export async function withHeavy<T>(name: string, maxMs: number, fn: () => Promise<T>): Promise<T> {
  if (heavy && Date.now() - heavy.at < maxMs) throw new MaintenanceError(`Hay otra operación en curso (${heavy.name}). Esperá a que termine.`, 409);
  heavy = { name, at: Date.now() };
  try { return await fn(); } finally { heavy = null; }
}
export const heavyBusy = () => (heavy && Date.now() - heavy.at < 30 * 60_000 ? heavy.name : null);
export function markHeavy(name: string) { heavy = { name, at: Date.now() }; }
export function clearHeavy(name?: string) { if (!name || heavy?.name === name) heavy = null; }

/** Espera a que OpenBot responda `status` (servidor arriba). */
export async function waitReady(seconds = 120): Promise<boolean> {
  for (let t = 0; t < seconds; t += 5) {
    const r = await sh(`docker exec ${CONTAINER} openbot status >/dev/null 2>&1`, 20_000);
    if (r.ok) return true;
    await sleep(5000);
  }
  return false;
}

/** Ejecuta un comando del host con `input` por stdin (así valores sensibles no quedan en la lista de procesos). */
export async function runWithStdin(command: string, input: string, user: 'root' | 'user', timeoutMs = 60_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const child = hostSpawnInteractive(command, { user });
  (child.stdin as Bun.FileSink).write(input); (child.stdin as Bun.FileSink).end();
  const timer = setTimeout(() => killHostProc(child), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text(), child.exited]);
    return { ok: code === 0, stdout, stderr };
  } finally { clearTimeout(timer); }
}

let homeCache: string | undefined;
export async function homeDir(): Promise<string> {
  if (!homeCache) homeCache = (await sh('echo "$HOME"', 10_000)).stdout.trim() || '/home/binary';
  return homeCache;
}

// ---------------------------------------------------------------- trabajos en segundo plano
// Las operaciones largas (parar/editar/arrancar, restaurar…) no pueden vivir dentro de una petición HTTP
// (el servidor corta conexiones inactivas a los 60 s): se lanzan y el panel consulta su avance.
export interface Job { id: string; name: string; state: 'running' | 'done' | 'error'; message: string; startedAt: number; endedAt?: number }
let job: Job | null = null;
export const currentJob = () => job;
export const jobRunning = () => job?.state === 'running';

export function startJob(name: string, fn: () => Promise<{ message: string }>): Job {
  if (job?.state === 'running') throw new MaintenanceError(`Ya hay una tarea en curso (${job.name}). Esperá a que termine.`, 409);
  const mine: Job = { id: Math.random().toString(36).slice(2, 10), name, state: 'running', message: 'En curso…', startedAt: Date.now() };
  job = mine;
  void (async () => {
    try { const r = await fn(); mine.state = 'done'; mine.message = r.message || 'Listo'; }
    catch (e) { mine.state = 'error'; mine.message = e instanceof MaintenanceError ? e.message : 'La tarea falló. Revisá Diagnóstico.'; }
    finally { mine.endedAt = Date.now(); }
  })();
  return mine;
}
