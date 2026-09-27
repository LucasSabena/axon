import { Hono } from 'hono';
import { $ } from 'bun';
import { hostExec } from './host';
import { runJob } from './jobs';

// ---------- Docker ops: start / restart / pull+recreate / grouping ----------
// Self-contained feature module — index.ts only calls registerDockerOpsRoutes(app).
// Docker commands run inside the container against the mounted docker.sock
// (same pattern as src/docker.ts); hostExec is the fallback for environments
// where the CLI only exists on the host.

function fail(c: any, status: number, error: string, extra?: Record<string, unknown>) {
  return c.json({ ok: false, error, ...extra }, status);
}

const ID_RE = /^[a-zA-Z0-9_.-]+$/;
const shq = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Run a docker subcommand: in-container CLI first, host fallback.
async function dockerCmd(cmd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const res = await $`bash -c ${'docker ' + cmd}`.quiet().nothrow();
  const stdout = res.stdout.toString();
  const stderr = res.stderr.toString();
  if (res.exitCode === 0) return { ok: true, stdout, stderr };
  const hostRes = await hostExec(`docker ${cmd}`, { user: 'user', timeoutMs: 60_000 });
  if (hostRes.ok) return { ok: true, stdout: hostRes.stdout, stderr: hostRes.stderr };
  return { ok: false, stdout, stderr: `${stderr} | host: ${hostRes.stderr || hostRes.stdout || `exit ${hostRes.code}`}` };
}

async function inspectContainer(id: string): Promise<any | null> {
  const arr = await $`docker inspect ${id}`.json().catch(() => null) as any[] | null;
  if (arr?.[0]) return arr[0];
  const res = await hostExec(`docker inspect ${id}`, { user: 'user', timeoutMs: 15_000 });
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

export function registerDockerOpsRoutes(app: Hono): void {
  app.post('/api/docker/:id/start', async (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return fail(c, 400, 'ID de contenedor inválido');
    const res = await dockerCmd(`start ${id}`);
    if (!res.ok) return fail(c, 500, 'No se pudo iniciar el contenedor', { detail: (res.stderr || res.stdout).slice(0, 2000) });
    return c.json({ ok: true });
  });

  app.post('/api/docker/:id/restart', async (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return fail(c, 400, 'ID de contenedor inválido');
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
    const info = await inspectContainer(id);
    if (!info) return fail(c, 404, 'Contenedor no encontrado');

    const name = String(info.Name || id).replace(/^\//, '');
    const image = info.Config?.Image || info.Image || '';
    const { project, service, workingDir, configFiles } = composeMeta(info);

    if (!project || !service || !workingDir) {
      return fail(c, 400, 'Solo contenedores compose se pueden recrear seguro', {
        detail: 'El contenedor no tiene labels com.docker.compose.* — recrearlo a mano requeriría reconstruir env/volúmenes/puertos.',
      });
    }

    const files = (configFiles || 'compose.yml').split(',').map((f) => f.trim()).filter(Boolean);
    const fArgs = files.map((f) => `-f ${shq(f)}`).join(' ');
    const steps = [
      {
        label: `docker pull ${image}`,
        cmd: `docker pull ${shq(image)}`,
        user: 'root' as const,
        group: name,
      },
      {
        label: `compose up ${service}`,
        cmd: `cd ${shq(workingDir)} && docker compose -p ${shq(project)} ${fArgs} up -d --force-recreate ${shq(service)}`,
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
