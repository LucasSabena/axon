import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import {
  requireAuth,
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  getSession,
} from './auth';
import { loadConfig, saveConfig } from './config';
import { getServerStats, getServerHosts } from './stats';
import { setHostUser, hostExec, hostToContainer } from './host';
import {
  configurePorts,
  listPortProcesses,
  killPlan,
  killProcessTree,
  getProcessDetail,
} from './ports';
import { getJob, listJobs, runJob } from './jobs';
import {
  detectPrograms,
  installedPackagesSummary,
  listDesktopApps,
  programById,
  resolveIcon,
  searchAptPackages,
} from './programs';
import {
  initProjects,
  detectProjectsOnDisk,
  refreshRunning,
  getProjects,
  getProjectById,
  saveProjects,
  startProject,
  stopProject,
  installDeps,
  installCommand,
  projectLogs,
} from './projects';
import {
  listContainers,
  containerDetail,
  containerStats,
  containerLogs,
  stopContainer,
} from './docker';
import {
  createDnsRecord,
  deleteDnsRecord,
  syncCloudflaredRoutes,
  listDnsRecords,
  listAllDnsRecords,
  getRemoteTunnelConfig,
} from './cloudflare';
import type { DomainMapping, DomainStatus, Project } from './types';

const PORT = parseInt(process.env.PORT || '3457', 10);
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'example.com';

let config = await loadConfig();
configurePorts(config.settings);
setHostUser(config.settings.hostUser);
initProjects(config, saveConfig);

const app = new Hono();

function fail(c: any, status: number, error: string, extra?: Record<string, unknown>) {
  return c.json({ ok: false, error, ...extra }, status);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- Auth ----------

app.post('/api/login', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>().catch(() => ({ username: '', password: '' }));
  const valid = username === config.auth.username && (await verifyPassword(password, config.auth.passwordHash));
  if (!valid) return fail(c, 401, 'Credenciales inválidas');
  const token = await createSession(username);
  setSessionCookie(c, token);
  return c.json({ ok: true });
});

app.post('/api/logout', async (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get('/api/me', async (c) => {
  const session = await getSession(c);
  return c.json({ authenticated: !!session, username: session?.username || null });
});

app.use('/api/*', requireAuth);

// ---------- Ports (core) ----------

app.get('/api/ports', async (c) => {
  try {
    const [processes, hosts] = await Promise.all([
      listPortProcesses(),
      getServerHosts().catch(() => []),
    ]);
    for (const p of processes) {
      const domain = config.domains.find(
        (d) => d.processType === 'process' && p.ports.includes(d.port) && d.projectName === p.identity.label
      );
      (p as any).domain = domain;
    }
    // Best host to reach this server: prefer Tailscale, then LAN, then whatever's first.
    const networkHost = (
      hosts.find((h) => h.kind === 'tailscale') ||
      hosts.find((h) => h.kind === 'lan') ||
      hosts[0]
    )?.host || '';
    // First TCP port of the code-server process (if any is listening).
    const codeProc = processes.find(
      (p) => p.cmd.includes('code-server') || p.name.includes('code-server')
    );
    const codeServerPort = codeProc
      ? (codeProc.listeners
          .filter((l) => l.proto === 'tcp')
          .map((l) => l.port)
          .sort((a, b) => a - b)[0] ?? null)
      : null;
    const editorUrl = (config.settings as any).editorUrl || null;
    return c.json({ ok: true, processes, networkHost, codeServerPort, editorUrl });
  } catch (err) {
    return fail(c, 500, 'No se pudo escanear los puertos', { detail: String(err) });
  }
});

app.get('/api/ports/:pid/plan', async (c) => {
  const pid = parseInt(c.req.param('pid'), 10);
  const plan = await killPlan(pid);
  if (!plan) return fail(c, 404, 'El proceso ya no existe');
  return c.json({ ok: true, plan });
});

app.post('/api/ports/:pid/kill', async (c) => {
  const pid = parseInt(c.req.param('pid'), 10);
  const plan = await killPlan(pid);
  if (!plan) return fail(c, 404, 'El proceso ya no existe');
  if (plan.blocked) return fail(c, 403, `No se puede cerrar: ${plan.blocked}`);
  const result = await killProcessTree(pid);
  if (!result.ok) return fail(c, 500, 'No se pudo cerrar el proceso', { detail: result.error });
  return c.json({ ok: true, killed: result.killed });
});

// Stop a systemd unit that supervises a process — the only way to really
// kill a service with Restart=always. Optionally disable it so it doesn't
// come back at next login/boot.
app.post('/api/systemd/stop', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const unit = String(body.unit || '');
  const scope = body.scope === 'system' ? 'system' : 'user';
  const disable = body.disable === true;
  if (!/^[A-Za-z0-9_.@:-]+\.(service|socket|timer|scope)$/.test(unit)) {
    return fail(c, 400, 'Nombre de unidad inválido');
  }
  const action = disable ? 'disable --now' : 'stop';
  const cmd = scope === 'user'
    ? `export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user ${action} ${unit}`
    : `systemctl ${action} ${unit}`;
  const res = await hostExec(cmd, { user: scope === 'user' ? 'user' : 'root', timeoutMs: 25_000 });
  if (!res.ok) {
    return fail(c, 500, `systemctl ${action} ${unit} falló`, {
      detail: res.stderr || res.stdout || `exit ${res.code}`,
    });
  }
  return c.json({ ok: true, unit, action });
});

app.get('/api/ports/:pid/detail', async (c) => {
  const pid = parseInt(c.req.param('pid'), 10);
  const detail = await getProcessDetail(pid);
  if (!detail) return fail(c, 404, 'El proceso ya no existe');
  return c.json({ ok: true, detail });
});

app.get('/api/ports/health', async (c) => {
  const port = parseInt(c.req.query('port') || '', 10);
  if (!port) return fail(c, 400, 'Falta port');
  const proto = [443, 8443, 9443].includes(port) ? 'https' : 'http';
  try {
    const res = await fetch(`${proto}://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(2500),
      redirect: 'manual',
    });
    return c.json({ ok: true, status: res.status, responds: true });
  } catch (err: any) {
    const code = err?.cause?.code || err?.code || '';
    return c.json({ ok: true, responds: false, detail: code || String(err).slice(0, 200) });
  }
});

// ---------- Programs / updater ----------

app.get('/api/programs', async (c) => {
  const programs = await detectPrograms();
  return c.json({ ok: true, programs });
});

app.get('/api/programs/installed', async (c) => {
  const [desktopApps, packages] = await Promise.all([
    listDesktopApps().catch(() => []),
    installedPackagesSummary().catch(() => ({ apt: { total: 0 }, snaps: [], pnpmGlobals: [] })),
  ]);
  return c.json({ ok: true, desktopApps, packages });
});

app.get('/api/programs/packages', async (c) => {
  const q = c.req.query('q') || '';
  const packages = await searchAptPackages(q);
  return c.json({ ok: true, packages });
});

app.post('/api/programs/:id/update', async (c) => {
  const def = programById(c.req.param('id'));
  if (!def) return fail(c, 404, 'Programa desconocido');
  const running = listJobs().find((j) => j.status === 'running' && j.title === def.name);
  if (running) return c.json({ ok: true, job: running, already: true });
  const job = runJob(def.name, def.steps.map((s) => ({ ...s, group: def.name })));
  return c.json({ ok: true, job });
});

app.post('/api/programs/update-all', async (c) => {
  const programs = await detectPrograms();
  const steps = programs.filter((p) => p.installed).flatMap((p) =>
    (programById(p.id)?.steps || []).map((s) => ({ ...s, label: `${p.name} — ${s.label}`, group: p.name }))
  );
  if (!steps.length) return fail(c, 400, 'No hay programas detectados para actualizar');
  const job = runJob('Actualización completa', steps);
  return c.json({ ok: true, job });
});

app.get('/api/jobs', async (c) => c.json({ ok: true, jobs: listJobs() }));

app.get('/api/jobs/:id', async (c) => {
  const job = getJob(c.req.param('id'));
  if (!job) return fail(c, 404, 'Job no encontrado');
  return c.json({ ok: true, job });
});

// Icon resolver for .desktop Icon= values
app.get('/api/icons/:name', async (c) => {
  const name = c.req.param('name');
  const file = await resolveIcon(name);
  if (!file) return fail(c, 404, 'Icono no encontrado');
  try {
    const buf = await readFile(file);
    const ext = file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.xpm') ? 'image/x-xpixmap' : 'image/png';
    return new Response(buf, { headers: { 'Content-Type': ext, 'Cache-Control': 'public, max-age=86400' } });
  } catch {
    return fail(c, 404, 'Icono no encontrado');
  }
});

// ---------- Projects ----------

app.get('/api/projects', async (c) => {
  const projects = await refreshRunning();
  const enriched = projects.map((p) => ({
    ...p,
    installCmd: installCommand(p),
  }));
  return c.json({ ok: true, projects: enriched });
});

app.post('/api/projects/detect', async (c) => {
  const detected = await detectProjectsOnDisk();
  const byCwd = new Map(getProjects().map((p) => [p.cwd, p]));
  for (const p of detected) {
    if (!byCwd.has(p.cwd)) byCwd.set(p.cwd, p);
  }
  const merged = Array.from(byCwd.values()).sort((a, b) => a.name.localeCompare(b.name));
  await saveProjects(merged);
  return c.json({ ok: true, projects: await refreshRunning() });
});

app.post('/api/projects', async (c) => {
  const body = await c.req.json<Partial<Project>>().catch(() => ({}));
  if (!body.name || !body.cwd) {
    return fail(c, 400, 'Faltan campos: name, cwd');
  }
  const existing = body.id ? getProjectById(body.id) : undefined;
  const project: Project = {
    id: existing?.id || body.id || Math.random().toString(36).slice(2, 12),
    name: body.name,
    cwd: body.cwd,
    command: body.command,
    packageManager: body.packageManager,
    type: body.type || 'other',
    framework: body.framework,
    port: body.port,
    autoDetect: existing?.autoDetect ?? false,
  };
  const others = getProjects().filter((p) => p.id !== project.id);
  others.push(project);
  await saveProjects(others);
  return c.json({ ok: true, project });
});

app.delete('/api/projects/:id', async (c) => {
  const id = c.req.param('id');
  const before = getProjects().length;
  await saveProjects(getProjects().filter((p) => p.id !== id));
  if (getProjects().length === before) return fail(c, 404, 'Proyecto no encontrado');
  return c.json({ ok: true });
});

app.post('/api/projects/:id/start', async (c) => {
  const project = getProjectById(c.req.param('id'));
  if (!project) return fail(c, 404, 'Proyecto no encontrado');
  const result = await startProject(project);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error, command: result.command, needsInstall: result.needsInstall }, 409);
  }
  return c.json({ ok: true, pid: result.pid, command: result.command });
});

app.post('/api/projects/:id/install', async (c) => {
  const project = getProjectById(c.req.param('id'));
  if (!project) return fail(c, 404, 'Proyecto no encontrado');
  const job = runJob(`install ${project.name}`, [{
    label: installCommand(project),
    cmd: `cd ${JSON.stringify(project.cwd)} && ${installCommand(project)}`,
    user: 'user',
  }]);
  return c.json({ ok: true, job });
});

app.post('/api/projects/:id/stop', async (c) => {
  const project = getProjectById(c.req.param('id'));
  if (!project) return fail(c, 404, 'Proyecto no encontrado');
  const result = await stopProject(project);
  if (!result.ok) return fail(c, 500, result.error || 'No se pudo detener');
  return c.json({ ok: true });
});

app.get('/api/projects/:id/logs', async (c) => {
  const project = getProjectById(c.req.param('id'));
  if (!project) return fail(c, 404, 'Proyecto no encontrado');
  const tail = parseInt(c.req.query('tail') || '200', 10);
  return c.json({ ok: true, lines: await projectLogs(project, tail) });
});

// ---------- Docker ----------

app.get('/api/docker', async (c) => {
  const containers = await listContainers();
  for (const container of containers) {
    container.domain = config.domains.find(
      (d) => d.processType === 'docker' && d.projectName === container.names.split(',')[0] && container.publicPorts.includes(d.port)
    );
  }
  return c.json({ ok: true, containers });
});

app.post('/api/docker/:id/stop', async (c) => {
  const result = await stopContainer(c.req.param('id'));
  if (!result.ok) return fail(c, 500, 'No se pudo detener el contenedor', { detail: result.error });
  return c.json({ ok: true });
});

app.get('/api/docker/:id/detail', async (c) => {
  const id = c.req.param('id');
  const [containers, detail, stats] = await Promise.all([
    listContainers(),
    containerDetail(id),
    containerStats(id),
  ]);
  const container = containers.find((d) => d.id === id);
  if (!container) return fail(c, 404, 'Contenedor no encontrado');
  return c.json({ ok: true, container, detail, stats });
});

app.get('/api/docker/:id/logs', async (c) => {
  const lines = await containerLogs(c.req.param('id'));
  return c.json({ ok: true, lines });
});

// ---------- Domains (unchanged Cloudflare logic) ----------

app.get('/api/domains', async (c) => c.json({ ok: true, domains: config.domains }));

// Probe every domain publicly and, when it's down, diagnose why: stopped
// process, deleted project, stopped container, or a tunnel routing problem.
app.get('/api/domains/status', async (c) => {
  const portProcs = await listPortProcesses();
  const listening = new Set<number>();
  for (const p of portProcs) for (const l of p.listeners ?? []) listening.add(l.port);
  const containers = await listContainers().catch(() => [] as Awaited<ReturnType<typeof listContainers>>);
  const dockerPorts = new Set(
    containers.filter((ct) => ct.state === 'running').flatMap((ct) => ct.publicPorts)
  );
  const projects = getProjects();

  const statuses = await Promise.all(
    config.domains.map(async (d) => [d.id, await probeDomain(d, listening, dockerPorts, projects)] as const)
  );
  return c.json({ ok: true, statuses: Object.fromEntries(statuses) });
});

async function probeDomain(
  d: DomainMapping,
  listening: Set<number>,
  dockerPorts: Set<number>,
  projects: Project[]
): Promise<DomainStatus> {
  let httpStatus: number | undefined;
  try {
    const res = await fetch(`https://${d.fullDomain}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(7000),
    });
    httpStatus = res.status;
    res.body?.cancel().catch(() => {});
    if (res.status < 400) return { state: 'up', httpStatus };
    if (res.status === 401 || res.status === 403) {
      return { state: 'warn', httpStatus, reason: `La app responde pero pide autenticación (HTTP ${res.status})` };
    }
    if (res.status < 500) {
      return { state: 'warn', httpStatus, reason: `La app está viva pero la ruta responde HTTP ${res.status}` };
    }
  } catch { /* timeout / DNS / TLS → diagnose below */ }

  let reason: string;
  if (d.processType === 'docker') {
    reason = dockerPorts.has(d.port)
      ? 'El contenedor corre y publica el puerto, pero el túnel no lo alcanza (revisar ingress de cloudflared)'
      : 'El contenedor está detenido o ya no publica ese puerto';
  } else if (!listening.has(d.port)) {
    const proj = projects.find((p) => p.name === d.projectName || p.id === d.projectName);
    if (proj?.cwd && !existsSync(hostToContainer(proj.cwd))) {
      reason = 'El proyecto fue borrado del disco';
    } else {
      reason = `El proyecto está detenido — nada escucha en el puerto ${d.port}`;
    }
  } else {
    let localOk = false;
    try {
      const r = await fetch(d.target.startsWith('http') ? d.target : `http://localhost:${d.port}`, {
        redirect: 'manual', signal: AbortSignal.timeout(3000),
      });
      localOk = true;
      r.body?.cancel().catch(() => {});
    } catch { /* port listens but not HTTP */ }
    reason = localOk
      ? 'El proceso responde en local pero el túnel no enruta hasta él (revisar cloudflared)'
      : `Algo escucha en el puerto ${d.port} pero no responde HTTP`;
  }
  return { state: 'down', httpStatus, reason };
}

app.post('/api/domains/import', async (c) => {
  const remote = await getRemoteTunnelConfig();
  if (!remote.success || !remote.config) {
    return fail(c, 500, 'No se pudo obtener la config remota del túnel', { detail: remote.error });
  }
  const dnsRecords = await listAllDnsRecords('CNAME');
  const containers = await listContainers();
  const imported: DomainMapping[] = [];
  const skipped: string[] = [];

  for (const entry of remote.config.config.ingress || []) {
    if (!entry.hostname || entry.hostname === `ports.${BASE_DOMAIN}`) continue;
    const subdomain = entry.hostname.replace(new RegExp(`\\.${escapeRegExp(BASE_DOMAIN)}$`), '');
    const serviceMatch = entry.service.match(/:\/\/localhost:(\d+)/);
    const port = serviceMatch ? parseInt(serviceMatch[1], 10) : 0;
    if (!port || config.domains.some((d) => d.fullDomain === entry.hostname)) {
      skipped.push(entry.hostname);
      continue;
    }
    const target = `${entry.service.startsWith('https://') ? 'https' : 'http'}://localhost:${port}`;
    const matching = containers.find((ct) => ct.publicPorts.includes(port));
    const domain: DomainMapping = {
      id: Math.random().toString(36).slice(2, 12),
      subdomain,
      fullDomain: entry.hostname,
      target,
      port,
      projectName: matching ? matching.names.split(',')[0] : subdomain,
      processType: matching ? 'docker' : 'process',
      createdAt: new Date().toISOString(),
      dnsRecordId: dnsRecords.find((r) => r.name === entry.hostname)?.id,
    };
    config.domains.push(domain);
    imported.push(domain);
  }
  await saveConfig(config);
  return c.json({ ok: true, imported, skipped });
});

app.post('/api/domains', async (c) => {
  const { subdomain, port, processType, projectName } = await c.req.json<{
    subdomain: string; port: number; processType: 'process' | 'docker'; projectName: string;
  }>();
  const clean = (subdomain || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!clean) return fail(c, 400, 'Subdominio inválido');
  const fullDomain = `${clean}.${BASE_DOMAIN}`;
  if (config.domains.some((d) => d.fullDomain === fullDomain)) {
    return fail(c, 409, 'Ese dominio ya está asignado');
  }
  if ((await listDnsRecords(fullDomain)).length > 0) {
    return fail(c, 409, 'El registro DNS ya existe en Cloudflare');
  }
  const isHttps = [443, 8443, 9090, 9443].includes(port);
  const target = `${isHttps ? 'https' : 'http'}://localhost:${port}`;
  const dns = await createDnsRecord(fullDomain);
  if (!dns.success) return fail(c, 500, 'Falló crear el DNS en Cloudflare', { detail: dns.error });

  const domain: DomainMapping = {
    id: Math.random().toString(36).slice(2, 12),
    subdomain: clean,
    fullDomain,
    target,
    port,
    projectName,
    processType,
    createdAt: new Date().toISOString(),
    dnsRecordId: dns.recordId,
  };
  config.domains.push(domain);
  await saveConfig(config);

  const sync = await syncCloudflaredRoutes(config.domains);
  if (!sync.success) {
    if (domain.dnsRecordId) await deleteDnsRecord(domain.dnsRecordId);
    config.domains = config.domains.filter((d) => d.id !== domain.id);
    await saveConfig(config);
    return fail(c, 500, 'Falló sincronizar el túnel', { detail: sync.error });
  }
  return c.json({ ok: true, domain });
});

app.put('/api/domains/:id', async (c) => {
  const domain = config.domains.find((d) => d.id === c.req.param('id'));
  if (!domain) return fail(c, 404, 'Dominio no encontrado');
  const { subdomain } = await c.req.json<{ subdomain: string }>();
  const clean = (subdomain || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!clean) return fail(c, 400, 'Subdominio inválido');
  const newFullDomain = `${clean}.${BASE_DOMAIN}`;
  if (newFullDomain === domain.fullDomain) return c.json({ ok: true, domain });
  if (config.domains.some((d) => d.id !== domain.id && d.fullDomain === newFullDomain)) {
    return fail(c, 409, 'Ese dominio ya está asignado');
  }
  if ((await listDnsRecords(newFullDomain)).length > 0) {
    return fail(c, 409, 'El registro DNS ya existe en Cloudflare');
  }

  const old = { ...domain };
  const created = await createDnsRecord(newFullDomain);
  if (!created.success) return fail(c, 500, 'Falló crear el DNS', { detail: created.error });
  if (old.dnsRecordId) {
    const deleted = await deleteDnsRecord(old.dnsRecordId);
    if (!deleted.success) {
      if (created.recordId) await deleteDnsRecord(created.recordId);
      return fail(c, 500, 'Falló borrar el DNS viejo', { detail: deleted.error });
    }
  }
  domain.subdomain = clean;
  domain.fullDomain = newFullDomain;
  domain.dnsRecordId = created.recordId;
  await saveConfig(config);

  const sync = await syncCloudflaredRoutes(config.domains);
  if (!sync.success) {
    domain.subdomain = old.subdomain;
    domain.fullDomain = old.fullDomain;
    domain.dnsRecordId = old.dnsRecordId;
    await saveConfig(config);
    if (old.dnsRecordId) {
      const recreated = await createDnsRecord(old.fullDomain);
      if (recreated.success && recreated.recordId) {
        domain.dnsRecordId = recreated.recordId;
        await saveConfig(config);
      }
    }
    if (created.recordId) await deleteDnsRecord(created.recordId);
    return fail(c, 500, 'Falló sincronizar el túnel', { detail: sync.error });
  }
  return c.json({ ok: true, domain });
});

app.delete('/api/domains/:id', async (c) => {
  const domain = config.domains.find((d) => d.id === c.req.param('id'));
  if (!domain) return fail(c, 404, 'Dominio no encontrado');
  if (domain.dnsRecordId) {
    const del = await deleteDnsRecord(domain.dnsRecordId);
    if (!del.success) return fail(c, 500, 'Falló borrar el DNS', { detail: del.error });
  }
  config.domains = config.domains.filter((d) => d.id !== domain.id);
  await saveConfig(config);
  const sync = await syncCloudflaredRoutes(config.domains);
  if (!sync.success) return fail(c, 500, 'Dominio borrado pero falló sync del túnel', { detail: sync.error });
  return c.json({ ok: true });
});

// ---------- Config & stats ----------

app.get('/api/config', async (c) => {
  const { auth, ...rest } = config;
  return c.json({ ok: true, config: { ...rest, auth: { username: auth.username } } });
});

app.put('/api/config', async (c) => {
  const body = await c.req.json<Partial<AppConfig['settings']>>().catch(() => ({}));
  config.settings = { ...config.settings, ...body };
  await saveConfig(config);
  configurePorts(config.settings);
  return c.json({ ok: true, settings: config.settings });
});

app.get('/api/stats', async (c) => {
  const stats = await getServerStats();
  return c.json({ ok: true, stats });
});

// ---------- Static ----------

// Static assets must not be served stale — index.html/app.js change on every deploy.
app.use('/*', async (c, next) => {
  await next();
  const p = c.req.path;
  if (p === '/' || p.endsWith('.html') || p.endsWith('/app.js') || p.endsWith('.css')) {
    c.header('Cache-Control', 'no-cache');
  } else if (p.includes('/vendor/')) {
    c.header('Cache-Control', 'public, max-age=86400');
  }
});
app.get('/*', serveStatic({ root: './public' }));

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return fail(c, 500, 'Error interno', { detail: String(err) });
});

export default { port: PORT, fetch: app.fetch };
