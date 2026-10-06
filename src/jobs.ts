import { hostSpawn } from './host';
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
    for (const j of arr) {
      if (j && typeof j.id === 'string' && j.title) {
        persistedJobs.push(j as Job);
        if (!jobs.has(j.id)) jobs.set(j.id, j as Job);
      }
    }
  } catch { /* missing or corrupt file — start fresh */ }
}

function persistJob(job: Job): void {
  try {
    const snapshot: Job = { ...job, log: job.log.slice(-PERSIST_LOG_CAP) };
    // Replace existing entry with same id (shouldn't happen, but be safe).
    const idx = persistedJobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) persistedJobs.splice(idx, 1);
    persistedJobs.push(snapshot);
    while (persistedJobs.length > PERSIST_MAX_JOBS) persistedJobs.shift();
    writeQueue = writeQueue.then(async () => {
      try {
        await mkdir(path.dirname(JOBS_FILE), { recursive: true });
        await writeFile(JOBS_FILE, JSON.stringify(persistedJobs, null, 2), 'utf-8');
      } catch { /* disk errors are non-fatal */ }
    });
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

export function listJobs(): Job[] {
  return Array.from(jobs.values())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 30);
}

let completionHook: (() => void) | null = null;
export function setJobCompletionHook(hook: () => void) { completionHook = hook; }

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export interface JobStep extends ProgramStep {
  group?: string;
}

export function runJob(title: string, steps: JobStep[], options: { transient?: boolean } = {}): Job {
  const job: Job = {
    id: Math.random().toString(36).slice(2, 10),
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
}

async function execute(job: Job, steps: JobStep[], options: { transient?: boolean } = {}) {
  let failedGroup: string | undefined;
  let anyFailed = false;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const state = job.steps[i];

    // If a program's step failed, skip the rest of THAT program but continue
    // with the next group (so "update all" doesn't abort on one bad app).
    if (step.group && step.group === failedGroup) {
      state.status = 'skipped';
      continue;
    }
    failedGroup = undefined;

    state.status = 'running';
    appendLog(job, `\n$ [${state.label}] (${step.user}) ${step.cmd}\n`);
    try {
      const proc = hostSpawn(step.cmd, { user: step.user });
      const reader = async (stream: ReadableStream<Uint8Array>) => {
        const r = stream.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await r.read();
          if (done) break;
          appendLog(job, decoder.decode(value, { stream: true }));
        }
      };
      const [code] = await Promise.all([proc.exited, reader(proc.stdout as ReadableStream<Uint8Array>), reader(proc.stderr as ReadableStream<Uint8Array>)]);
      state.exitCode = code;
      if (code !== 0) {
        state.status = 'failed';
        anyFailed = true;
        failedGroup = step.group;
        const hint = explainError(job.log.slice(-4000), code);
        state.hint = hint;
        appendLog(job, `\n✗ Paso "${state.label}" falló con código ${code}${hint ? ` — ${hint}` : ''}\n`);
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
  job.status = anyFailed ? 'failed' : 'ok';
  job.endedAt = new Date().toISOString();
  appendLog(job, anyFailed ? '\n— Finalizado con errores —\n' : '\n— Finalizado correctamente —\n');
  if (!options.transient) persistJob(job);
  recordEvent(
    'job',
    job.title,
    anyFailed ? `Fallaron ${job.steps.filter((s) => s.status === 'failed').length} paso(s)` : 'Completado'
  );
  completionHook?.();
  notify(
    `AXON — ${job.title}`,
    anyFailed
      ? `Terminó con ${job.steps.filter((s) => s.status === 'failed').length} paso(s) fallidos`
      : 'Completado correctamente',
    anyFailed ? 4 : 2
  ).catch(() => {});
}
