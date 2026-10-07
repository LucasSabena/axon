import { hostSpawn, killHostProc } from './host';
import { notify } from './notify';
import { recordEvent } from './events';
import { readFile, writeFile, mkdir } from 'fs/promises';
import * as path from 'path';
import type { Job, JobStepState, ProgramStep } from './types';

const LOG_CAP = 256 * 1024; // keep last 256KB of output
const jobs = new Map<string, Job>();
const JOB_TTL = 60 * 60 * 1000;

// --- Persistence: finished jobs are written to jobs.json next to config ---
const JOBS_FILE = path.join(
  path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),
  'jobs.json'
);
const PERSIST_MAX_JOBS = 50;
const PERSIST_LOG_CAP = 20_000; // persist only the last 20KB of each job's log

// In-memory copy of the on-disk list; writes are serialized via writeQueue.
const persistedJobs: Job[] = [];
let writeQueue: Promise<void> = Promise.resolve();

async function loadPersistedJobs(): Promise<void> {
  try {
    const raw = await readFile(JOBS_FILE, 'utf-8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    const now = Date.now();
    for (const j of arr) {
      if (j && typeof j.id === 'string' && j.title) {
        // A job persisted as 'running' can no longer be running — the process
        // died with it. Mark it failed so the UI doesn't spin on a zombie.
        if (j.status === 'running') {
          j.status = 'failed';
          j.error = j.error || 'La tarea se interrumpió al reiniciar AXON';
          j.endedAt = j.endedAt || new Date(now).toISOString();
        }
        // Skip records already past TTL so expired jobs don't resurrect.
        if (j.status !== 'running' && now - new Date(j.endedAt || j.startedAt).getTime() > JOB_TTL) continue;
        persistedJobs.push(j as Job);
        if (!jobs.has(j.id)) jobs.set(j.id, j as Job);
      }
    }
  } catch { /* missing or corrupt file — start fresh */ }
}

function queuePersistedWrite(): void {
  writeQueue = writeQueue.then(async () => {
    try {
      await mkdir(path.dirname(JOBS_FILE), { recursive: true });
      await writeFile(JOBS_FILE, JSON.stringify(persistedJobs, null, 2), 'utf-8');
    } catch { /* disk errors are non-fatal */ }
  });
}

function persistJob(job: Job): void {
  try {
    const snapshot: Job = { ...job, log: job.log.slice(-PERSIST_LOG_CAP) };
    // Replace existing entry with same id (shouldn't happen, but be safe).
    const idx = persistedJobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) persistedJobs.splice(idx, 1);
    persistedJobs.push(snapshot);
    while (persistedJobs.length > PERSIST_MAX_JOBS) persistedJobs.shift();
    queuePersistedWrite();
  } catch { /* ignore */ }
}

await loadPersistedJobs();

// Translate common command failures into a human explanation.
export function explainError(stderr: string, code: number): string | undefined {
  const s = stderr.toLowerCase();
  if (/unable to locate package|has no installation candidate|no se ha podido localizar/.test(s))
    return 'El paquete no está disponible: falta el repositorio o el nombre cambió.';
  if (/could not get lock|dpkg.*lock|is another process using it/.test(s))
    return 'Otro proceso está usando apt/dpkg (quizá unattended-upgrades). Reintentá en unos minutos.';
  if (/failed to fetch|temporary failure|could not resolve|connection timed out/.test(s))
    return 'Error de red o el repositorio no responde.';
  if (/command not found|not found$/.test(s))
    return 'El comando no está instalado en el host o no está en el PATH del usuario.';
  if (/permission denied|are you root|operation not permitted/.test(s))
    return 'Permisos insuficientes.';
  if (/err_pnpm_no_pkg|no package.json/.test(s))
    return 'pnpm no encontró package.json en ese directorio.';
  if (/err_pnpm_pm_/.test(s) || /package manager/i.test(s))
    return 'Conflicto de package manager (el proyecto declara otro gestor).';
  if (/exdev|cross-device/.test(s))
    return 'Error de filesystem entre dispositivos (store de pnpm vs bind mount).';
  if (/eacces|eperm/.test(s))
    return 'Error de permisos de archivos.';
  if (/enospc|no space left/.test(s))
    return 'Sin espacio en disco.';
  if (/self[- ]signed|certificate/.test(s))
    return 'Problema de certificado TLS.';
  if (/rate.?limit|429/.test(s))
    return 'Rate limit del servicio remoto.';
  if (code === 124 || /timed? ?out/.test(s))
    return 'El comando tardó demasiado (timeout).';
  return undefined;
}

function appendLog(job: Job, chunk: string) {
  job.log += chunk;
  if (job.log.length > LOG_CAP) {
    job.log = '…(salida truncada)…\n' + job.log.slice(-LOG_CAP / 2);
  }
}

export function runningJobs(): Job[] { return [...jobs.values()].filter(j=>j.status==='running'); }

export function listJobs(): Job[] {
  pruneJobs();
  return Array.from(jobs.values())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 30);
}

let completionHook: (() => void) | null = null;
export function setJobCompletionHook(hook: () => void) { completionHook = hook; }

export function getJob(id: string): Job | undefined {
  pruneJobs();
  return jobs.get(id);
}

export interface JobStep extends ProgramStep {
  group?: string;
  displayCommand?: string;
  // Per-step kill deadline. Steps default to a generous cap so a hung command
  // (e.g. dpkg waiting on a conffile prompt that can never be answered — the
  // spawned process has no stdin) fails instead of locking the job runner
  // forever. Pass timeoutMs to tune, or 0/Infinity to opt out.
  timeoutMs?: number;
  // Alternate command tried only when the primary couldn't even run: exit 127 /
  // "command not found" / permiso denegado (p.ej. docker.sock fuera del grupo).
  // A real non-zero result does NOT trigger it — that would be a blind retry.
  fallback?: { cmd: string; user?: ProgramStep['user']; displayCommand?: string };
}

export const DEFAULT_STEP_TIMEOUT_MS = 30 * 60 * 1000;

export interface RunJobOptions {
  transient?: boolean;
  // Whole-job deadline: past it the job is cancelled (current step killed,
  // pending steps skipped). Per-step timeouts keep applying on top.
  timeoutMs?: number;
}

// jobId → proc of the step currently executing, so a cancel path exists.
const activeProcs = new Map<string, ReturnType<typeof hostSpawn>>();
// jobId → motivo de cancelación pendiente de reflejar en el estado del job.
const cancelReasons = new Map<string, string>();

// Best-effort kill of the currently running step of a job. The job is marked
// failed by the normal exit path in execute() and remaining steps still run.
export function killJob(id: string): boolean {
  const proc = activeProcs.get(id);
  if (!proc) return false;
  try { killHostProc(proc); return true; } catch { return false; }
}

// Cancela el job completo: mata el paso en curso y marca los pendientes como
// 'skipped'. Genérico — cualquier módulo con jobId puede cancelar.
export function cancelJob(id: string, reason = 'Cancelada por el usuario'): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== 'running') return false;
  cancelReasons.set(id, reason);
  const proc = activeProcs.get(id);
  if (proc) {
    try { killHostProc(proc); } catch { /* best-effort */ }
  }
  return true;
}

export function runJob(title: string, steps: JobStep[], options: RunJobOptions = {}): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    title,
    status: 'running',
    steps: steps.map((s) => ({ label: s.label, status: 'pending', group: s.group })),
    log: '',
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  pruneJobs();
  void execute(job, steps, options);
  return job;
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && now - new Date(job.endedAt || job.startedAt).getTime() > JOB_TTL) {
      jobs.delete(id);
    }
  }
  // Reconcile the persisted list so expired jobs don't linger in jobs.json
  // (and don't resurrect on the next restart).
  const before = persistedJobs.length;
  for (let i = persistedJobs.length - 1; i >= 0; i--) {
    const j = persistedJobs[i];
    if (j.status !== 'running' && now - new Date(j.endedAt || j.startedAt).getTime() > JOB_TTL) {
      persistedJobs.splice(i, 1);
    }
  }
  if (persistedJobs.length !== before) queuePersistedWrite();
}

async function execute(job: Job, steps: JobStep[], options: RunJobOptions = {}) {
  let failedGroup: string | undefined;
  let anyFailed = false;

  // Job-level deadline: cancels like a user cancel — kills the current step
  // and skips the pending ones.
  const jobTimer =
    options.timeoutMs && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? setTimeout(
          () => cancelJob(job.id, `La tarea superó el límite total de ${Math.round(options.timeoutMs! / 60000)} min`),
          options.timeoutMs
        )
      : null;

  const reader = async (stream: ReadableStream<Uint8Array>) => {
    const r = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await r.read();
      if (done) break;
      appendLog(job, decoder.decode(value, { stream: true }));
    }
  };

  // Spawn one command and wait for it; returns the exit code plus whether the
  // step-level timeout killed it.
  const runOnce = async (
    cmd: string,
    user: ProgramStep['user'],
    timeoutMs: number
  ): Promise<{ code: number; timedOut: boolean }> => {
    const proc = hostSpawn(cmd, { user });
    activeProcs.set(job.id, proc);
    let timedOut = false;
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killHostProc(proc);
          }, timeoutMs)
        : null;
    try {
      const [code] = await Promise.all([proc.exited, reader(proc.stdout as ReadableStream<Uint8Array>), reader(proc.stderr as ReadableStream<Uint8Array>)]);
      return { code, timedOut };
    } finally {
      if (timer) clearTimeout(timer);
      if (activeProcs.get(job.id) === proc) activeProcs.delete(job.id);
    }
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const state = job.steps[i];

    // Job cancelled while a previous step ran: remaining steps never start.
    if (cancelReasons.has(job.id)) {
      state.status = 'skipped';
      continue;
    }
    // If a program's step failed, skip the rest of THAT program but continue
    // with the next group (so "update all" doesn't abort on one bad app).
    if (step.group && step.group === failedGroup) {
      state.status = 'skipped';
      continue;
    }
    failedGroup = undefined;

    state.status = 'running';
    appendLog(job, `\n$ [${state.label}] (${step.user}) ${step.displayCommand || step.cmd}\n`);
    try {
      const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
      let res = await runOnce(step.cmd, step.user, timeoutMs);
      const cancelReason = cancelReasons.get(job.id);
      // Fallback only when the primary never really ran (missing binary or
      // permission on the socket/tool) — never a blind retry of real failures.
      if (
        res.code !== 0 &&
        !res.timedOut &&
        !cancelReason &&
        step.fallback &&
        (res.code === 127 || /command not found|not installed|permission denied|operation not permitted|docker\.sock/i.test(job.log.slice(-3000)))
      ) {
        appendLog(job, `\n↪ No se pudo ejecutar como '${step.user}'; reintentando como '${step.fallback.user || step.user}' (${step.fallback.displayCommand || step.fallback.cmd})\n`);
        res = await runOnce(step.fallback.cmd, step.fallback.user || step.user, timeoutMs);
      }
      state.exitCode = res.code;
      const cancel = cancelReasons.get(job.id);
      if (cancel) {
        state.status = 'failed';
        anyFailed = true;
        failedGroup = step.group;
        state.hint = cancel;
        appendLog(job, `\n✗ Paso "${state.label}" — ${cancel}\n`);
        continue;
      }
      if (res.timedOut) {
        state.status = 'failed';
        anyFailed = true;
        failedGroup = step.group;
        state.hint = 'El comando tardó demasiado (timeout).';
        appendLog(job, `\n✗ Paso "${state.label}" superó el límite de ${Math.round(timeoutMs / 60000)} min y se interrumpió\n`);
        continue;
      }
      if (res.code !== 0) {
        state.status = 'failed';
        anyFailed = true;
        failedGroup = step.group;
        const hint = explainError(job.log.slice(-4000), res.code);
        state.hint = hint;
        appendLog(job, `\n✗ Paso "${state.label}" falló con código ${res.code}${hint ? ` — ${hint}` : ''}\n`);
        continue;
      }
      state.status = 'ok';
      appendLog(job, `\n✓ ${state.label}\n`);
    } catch (err) {
      state.status = 'failed';
      anyFailed = true;
      failedGroup = step.group;
      appendLog(job, `\n✗ Error ejecutando paso: ${String(err)}\n`);
    }
  }
  const cancelled = cancelReasons.get(job.id);
  cancelReasons.delete(job.id);
  if (jobTimer) clearTimeout(jobTimer);
  job.status = anyFailed || cancelled ? 'failed' : 'ok';
  if (cancelled) {
    job.error = cancelled;
    (job as Job & { cancelled?: boolean }).cancelled = true;
  }
  job.endedAt = new Date().toISOString();
  appendLog(
    job,
    cancelled ? `\n— ${cancelled} —\n` : anyFailed ? '\n— Finalizado con errores —\n' : '\n— Finalizado correctamente —\n'
  );
  activeProcs.delete(job.id);
  // Epilogue: each side effect is independent — a failure here must never
  // reject execute() (it is fired via `void`) nor skip the notification.
  try { if (!options.transient) persistJob(job); } catch { /* ignore */ }
  try {
    recordEvent(
      'job',
      job.title,
      anyFailed ? `Fallaron ${job.steps.filter((s) => s.status === 'failed').length} paso(s)` : 'Completado'
    );
  } catch { /* ignore */ }
  try { completionHook?.(); } catch { /* ignore */ }
  notify(
    `AXON — ${job.title}`,
    anyFailed
      ? `Terminó con ${job.steps.filter((s) => s.status === 'failed').length} paso(s) fallidos`
      : 'Completado correctamente',
    anyFailed ? 4 : 2
  ).catch(() => {});
}
