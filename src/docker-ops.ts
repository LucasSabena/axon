import { Hono } from 'hono';
import { hostExec } from './host';
import { runJob } from './jobs';
import { isOwnContainer } from './docker';

// ---------- Docker ops: start / restart / pull+recreate / grouping ----------
// Self-contained feature module — index.ts only calls registerDockerOpsRoutes(app).
// Docker commands run inside the container against the mounted docker.sock
// (same pattern as src/docker.ts); hostExec is the fallback for environments
// where the CLI only exists on the host.

function fail(c: any, status: number, error: string, extra?: Record<string, unknown>) {
  return c.json({ ok: false, error, ...extra }, status);
}

const ID_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
const shq = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Run a docker subcommand: in-container CLI first (hard timeout so a wedged
// daemon can't hang the request), host fallback.
async function dockerCmd(cmd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bash', '-c', `docker ${cmd}`], { stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
  }, 15_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code === 0) return { ok: true, stdout, stderr };
    const hostRes = await hostExec(`docker ${cmd}`, { user: 'user', timeoutMs: 60_000 });
    if (hostRes.ok) return { ok: true, stdout: hostRes.stdout, stderr: hostRes.stderr };
    return { ok: false, stdout, stderr: `${stderr} | host: ${hostRes.stderr || hostRes.stdout || `exit ${hostRes.code}`}` };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectContainer(id: string): Promise<any | null> {
  const res = await dockerCmd(`inspect ${id}`);
  if (!res.ok) return null;
  try { return JSON.parse(res.stdout)?.[0] || null; } catch { return null; }
}

function composeMeta(info: any) {
  const labels = info?.Config?.Labels || {};
  return {
    project: labels['com.docker.compose.project'] || '',
    service: labels['com.docker.compose.service'] || '',
    workingDir: labels['com.docker.compose.project.working_dir'] || '',
    configFiles: labels['com.docker.compose.project.config_files'] || '',
  };
}

// busyGuard reports a running compose release: mutating containers while a
// checkpoint/apply is in flight interleaves with its `docker compose` calls.
export function registerDockerOpsRoutes(app: Hono, busyGuard?: () => Promise<string | null> | string | null): void {
  const busy = async (c: Parameters<typeof fail>[0]) => {
    const msg = await busyGuard?.();
    return msg ? fail(c, 409, msg) : null;
  };

  app.post('/api/docker/:id/start', async (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return fail(c, 400, 'ID de contenedor inválido');
    const held = await busy(c);
    if (held) return held;
    if (await isOwnContainer(id)) return fail(c, 403, 'Operación rechazada: este contenedor es la propia instancia de Axon');
    const res = await dockerCmd(`start ${id}`);
    if (!res.ok) return fail(c, 500, 'No se pudo iniciar el contenedor', { detail: (res.stderr || res.stdout).slice(0, 2000) });
    return c.json({ ok: true });
  });

  app.post('/api/docker/:id/restart', async (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return fail(c, 400, 'ID de contenedor inválido');
    const held = await busy(c);
    if (held) return held;
    if (await isOwnContainer(id)) return fail(c, 403, 'Operación rechazada: este contenedor es la propia instancia de Axon');
    const res = await dockerCmd(`restart ${id}`);
    if (!res.ok) return fail(c, 500, 'No se pudo reiniciar el contenedor', { detail: (res.stderr || res.stdout).slice(0, 2000) });
    return c.json({ ok: true });
  });

  // Pull + recreate — ONLY for compose-managed containers. Raw `docker run`
  // recreation would need full env/volume/port reconstruction; compose labels
  // tell us exactly how to rebuild safely.
  app.post('/api/docker/:id/update', async (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return fail(c, 400, 'ID de contenedor inválido');
    const held = await busy(c);
    if (held) return held;
    const info = await inspectContainer(id);
    if (!info) return fail(c, 404, 'Contenedor no encontrado');
    if (await isOwnContainer(id)) return fail(c, 403, 'Operación rechazada: este contenedor es la propia instancia de Axon');

    const name = String(info.Name || id).replace(/^\//, '');
    const image = info.Config?.Image || info.Image || '';
    const { project, service, workingDir, configFiles } = composeMeta(info);

    if (!project || !service || !workingDir) {
      return fail(c, 400, 'Solo contenedores compose se pueden recrear seguro', {
        detail: 'El contenedor no tiene labels com.docker.compose.* — recrearlo a mano requeriría reconstruir env/volúmenes/puertos.',
      });
    }

    // Label values are attacker-controllable (`docker run --label`). Quoting
    // alone is not enough: a value like `--remove-orphans` still reaches the
    // docker arg parser. Reject anything that isn't a plain identifier/path,
    // and pass `--` before the positional service name.
    const LABEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
    if (!LABEL_RE.test(project) || !LABEL_RE.test(service)) {
      return fail(c, 400, 'Labels compose inválidas', { detail: 'project/service contienen caracteres no permitidos.' });
    }
    if (!/^\.{0,2}\/|^\//.test(workingDir) || workingDir.includes('\0') || workingDir.split('/').includes('..')) {
      return fail(c, 400, 'working_dir inválido');
    }
    if (!image || !/^[a-zA-Z0-9][a-zA-Z0-9.:/@_-]*$/.test(image)) {
      return fail(c, 400, 'Imagen inválida');
    }

    const rawFiles = (configFiles || 'compose.yml').split(',').map((f) => f.trim()).filter(Boolean);
    // A `-f` value that looks like a flag could still confuse the parser, and a
    // forged label must not point compose at an arbitrary non-yaml host file.
    // Each file must resolve inside the compose working dir: an absolute path
    // elsewhere on the host (e.g. /etc/x.yml) is rejected as surely forged.
    const wdNorm = workingDir.endsWith('/') ? workingDir.slice(0, -1) : workingDir;
    const files = rawFiles.filter((f) => {
      if (!/^[^\s-]/.test(f) || /[\0-\x1f]/.test(f) || !/\.(ya?ml)$/i.test(f) || f.split('/').includes('..')) return false;
      // An absolute -f path is only acceptable under an absolute workingDir —
      // with a relative workingDir it escapes containment entirely.
      if (f.startsWith('/') && (!workingDir.startsWith('/') || !f.startsWith(`${wdNorm}/`))) return false;
      return true;
    });
    if (files.length !== rawFiles.length) return fail(c, 400, 'config_files inválido');
    const fArgs = files.map((f) => `-f ${shq(f)}`).join(' ');
    const steps = [
      {
        label: `docker pull ${image}`,
        cmd: `docker pull -- ${shq(image)}`,
        user: 'root' as const,
        group: name,
      },
      {
        label: `compose up ${service}`,
        cmd: `cd -- ${shq(workingDir)} && docker compose -p ${shq(project)} ${fArgs} up -d --force-recreate -- ${shq(service)}`,
        user: 'root' as const,
        group: name,
      },
    ];
    const job = runJob(`Actualizar ${name}`, steps);
    return c.json({ ok: true, job, image, project, service });
  });

  app.get('/api/docker/:id/inspect', async (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return fail(c, 400, 'ID de contenedor inválido');
    const info = await inspectContainer(id);
    if (!info) return fail(c, 404, 'Contenedor no encontrado');
    const { project, service } = composeMeta(info);
    return c.json({
      ok: true,
      inspect: {
        id: info.Id || id,
        name: String(info.Name || '').replace(/^\//, ''),
        image: info.Config?.Image || info.Image || '',
        restartCount: info.RestartCount ?? 0,
        startedAt: info.State?.StartedAt || '',
        state: info.State?.Status || '',
        exitCode: info.State?.ExitCode,
        composeProject: project || null,
        composeService: service || null,
      },
    });
  });

  // All containers (running + stopped) grouped by compose project.
  app.get('/api/docker/groups', async (c) => {
    const res = await dockerCmd(`ps -a --format '{{json .}}'`);
    if (!res.ok) return fail(c, 500, 'No se pudo listar contenedores', { detail: res.stderr.slice(0, 2000) });
    const groups = new Map<string, { project: string; containers: { id: string; name: string; status: string; image: string }[] }>();
    const standalone: { id: string; name: string; status: string; image: string }[] = [];
    for (const line of res.stdout.split('\n').filter(Boolean)) {
      try {
        const row = JSON.parse(line) as { ID: string; Names: string; Image: string; Status: string; State: string; Labels?: string };
        const project = row.Labels?.match(/com\.docker\.compose\.project=([^,]+)/)?.[1] || '';
        const item = { id: row.ID, name: row.Names, status: row.Status, image: row.Image };
        if (project) {
          const g = groups.get(project) || { project, containers: [] };
          g.containers.push(item);
          groups.set(project, g);
        } else {
          standalone.push(item);
        }
      } catch { /* malformed line */ }
    }
    return c.json({
      ok: true,
      groups: Array.from(groups.values()).sort((a, b) => a.project.localeCompare(b.project)),
      standalone,
    });
  });
}
