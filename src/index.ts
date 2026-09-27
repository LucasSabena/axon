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
  verifySessionToken,
  setSessionHooks,
} from './auth';
import { loadConfig, saveConfig } from './config';
import { getServerStats, getServerHosts } from './stats';
import { setHostUser, hostExec, hostToContainer, hostSpawnInteractive } from './host';
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
import { notify, setNotifyUrl } from './notify';
import { loadHeartbeats, recordHeartbeat, lastState, allHeartbeats, uptimePct, pruneHeartbeats } from './heartbeats';
import { registerFilesRoutes } from './files';
import { registerEventRoutes, loadEvents, recordEvent } from './events';
import { registerAlertRoutes, startAlertLoop } from './alerts';
import { registerScriptRoutes, startScriptScheduler } from './scripts';
import { parseLogsSrc, startLogsSocket, stopLogsSocket, registerLogsRoutes } from './logs';
import type { LogsWsData } from './logs';
import { registerMetricsRoutes } from './metrics';
import { registerDropRoutes, startDropSweeper } from './drop';
import { registerSessionRoutes, recordSession, sessionIdForToken, isRevoked, touchSession } from './sessions';
import { registerOpsRoutes } from './ops';
import { registerDockerOpsRoutes } from './docker-ops';
import { registerComposeRoutes } from './compose';

const PORT = parseInt(process.env.PORT || '3457', 10);
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'example.com';

let config = await loadConfig();
configurePorts(config.settings);
setHostUser(config.settings.hostUser);
initProjects(config, saveConfig);
await loadHeartbeats();
await loadEvents();
setNotifyUrl(config.settings.notifyUrl);
setSessionHooks({ isRevoked, touch: touchSession });

// ---------- Heartbeat monitor ----------
// Lightweight public probe per domain every 90s; records history and fires a
// webhook when a domain transitions up → down.
const HB_INTERVAL_MS = 90_000;

async function hbProbe(fullDomain: string): Promise<{ s: 'up' | 'warn' | 'down'; ms?: number }> {
  const t0 = performance.now();
  try {
    const res = await fetch(`https://${fullDomain}/`, { signal: AbortSignal.timeout(10_000), redirect: 'manual' });
    res.body?.cancel().catch(() => {});
    const ms = Math.round(performance.now() - t0);
    if (res.status >= 200 && res.status < 400) return { s: 'up', ms };
    if (res.status === 401 || res.status === 403 || res.status === 404) return { s: 'warn', ms };
    return { s: 'down', ms };
  } catch {
    return { s: 'down' };
  }
}

async function heartbeatTick(): Promise<void> {
  const domains = config.domains || [];
  pruneHeartbeats(new Set(domains.map((d) => d.id)));
  await Promise.allSettled(
    domains.map(async (d) => {
      const r = await hbProbe(d.fullDomain);
      const prev = lastState(d.id);
      recordHeartbeat(d.id, r.s, r.ms);
      if (prev === 'up' && r.s === 'down') {
        recordEvent('domain', `Dominio caído — ${d.fullDomain}`);
        notify(`Dominio caído — ${d.fullDomain}`, `Dejó de responder tras ${d.port ? `puerto ${d.port}` : 'su target'}`, 4).catch(() => {});
      }
      if (prev === 'down' && r.s === 'up') recordEvent('domain', `Dominio recuperado — ${d.fullDomain}`);
    })
  );
}

setInterval(() => { heartbeatTick().catch(() => {}); }, HB_INTERVAL_MS).unref();
heartbeatTick().catch(() => {});

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
  recordSession(token, username, c.req.header('user-agent') || '');
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
app.use('/p/*', requireAuth);

// ---------- Device pairing (QR login) ----------
// Short-lived one-time tokens issued by an authed session; scanning the QR
// lands on /pair?t=... which mints a real session and drops the token.
const pairTokens = new Map<string, number>(); // token → expiresAt (ms)
const PAIR_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of pairTokens) if (now > exp) pairTokens.delete(t);
}, 60_000).unref();

app.get('/pair', async (c) => {
  const t = c.req.query('t') || '';
  const exp = pairTokens.get(t);
  const html = (msg: string) =>
    c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#0b0e14;color:#e6e9ef;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${msg}</h2><p style="opacity:.6">Volvé al dashboard y generá uno nuevo.</p></div>`, 410);
  if (!t || !exp || Date.now() > exp) return html('Este link de vinculación venció o no es válido.');
  pairTokens.delete(t);
  const token = await createSession('paired-device');
  setSessionCookie(c, token);
  recordSession(token, 'paired-device', c.req.header('user-agent') || '');
  return c.redirect('/');
});

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
  // Resolve icon availability server-side so the frontend never requests
  // /api/icons/<name> that would 404 (console noise on every render).
  const resolved = await Promise.all(
    desktopApps.map(async (a: { icon?: string | null }) =>
      a.icon && !(await resolveIcon(a.icon)) ? { ...a, icon: null } : a),
  );
  return c.json({ ok: true, desktopApps: resolved, packages });
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

app.post('/api/programs/:id/login', async (c) => {
  const def = programById(c.req.param('id'));
  if (!def?.auth?.login) return fail(c, 400, 'Este programa no tiene login automatizable');
  const job = runJob(`Login ${def.name}`, def.auth.login.map((s) => ({ ...s, group: def.name })));
  return c.json({ ok: true, job });
});

app.post('/api/programs/:id/logout', async (c) => {
  const def = programById(c.req.param('id'));
  if (!def?.auth?.logout) return fail(c, 400, 'Este programa no tiene logout automatizable');
  const job = runJob(`Logout ${def.name}`, def.auth.logout.map((s) => ({ ...s, group: def.name })));
  return c.json({ ok: true, job });
});

app.post('/api/programs/update-all', async (c) => {
  const programs = await detectPrograms();
  // Only programs with a known pending update — don't reinstall everything.
  const pending = programs.filter((p) => p.installed && (p.latestVersion || p.pendingUpdates));
  const steps = pending.flatMap((p) =>
    (programById(p.id)?.steps || []).map((s) => ({ ...s, label: `${p.name} — ${s.label}`, group: p.name }))
  );
  if (!steps.length) return fail(c, 400, 'Todo está al día — no hay actualizaciones pendientes');
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
    cmd: `cd ${shq(project.cwd)} && ${installCommand(project)}`,
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
  const t0 = performance.now();
  try {
    const res = await fetch(`https://${d.fullDomain}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(7000),
    });
    const ms = Math.round(performance.now() - t0);
    httpStatus = res.status;
    res.body?.cancel().catch(() => {});
    if (res.status < 400) return { state: 'up', httpStatus, ms };
    if (res.status === 401 || res.status === 403) {
      return { state: 'warn', httpStatus, ms, reason: `La app responde pero pide autenticación (HTTP ${res.status})` };
    }
    if (res.status < 500) {
      return { state: 'warn', httpStatus, ms, reason: `La app está viva pero la ruta responde HTTP ${res.status}` };
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
  const blocked: string[] = [];

  for (const entry of remote.config.config.ingress || []) {
    if (!entry.hostname || entry.hostname === `ports.${BASE_DOMAIN}`) continue;
    const subdomain = entry.hostname.replace(new RegExp(`\\.${escapeRegExp(BASE_DOMAIN)}$`), '');
    if (!subdomain || subdomain === entry.hostname) { skipped.push(entry.hostname); continue; }
    const serviceMatch = entry.service.match(/:\/\/localhost:(\d+)/);
    const port = serviceMatch ? parseInt(serviceMatch[1], 10) : 0;
    if (!port || config.domains.some((d) => d.fullDomain === entry.hostname)) {
      skipped.push(entry.hostname);
      continue;
    }
    if ((config.deletedDomains || []).includes(entry.hostname)) {
      blocked.push(entry.hostname);
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
  return c.json({ ok: true, imported, skipped, blocked });
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
  // Manually re-creating a domain lifts the import block
  config.deletedDomains = (config.deletedDomains || []).filter((d) => d !== fullDomain);
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
  config.deletedDomains = [...new Set([...(config.deletedDomains || []), domain.fullDomain])];
  await saveConfig(config);
  const sync = await syncCloudflaredRoutes(config.domains);
  if (!sync.success) return fail(c, 500, 'Dominio borrado pero falló sync del túnel', { detail: sync.error });
  return c.json({ ok: true });
});

// Bulk delete: one tunnel sync for N domains instead of N syncs.
app.post('/api/domains/bulk-delete', async (c) => {
  const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}));
  const ids = new Set(body.ids || []);
  if (!ids.size) return fail(c, 400, 'Sin dominios seleccionados');
  const targets = config.domains.filter((d) => ids.has(d.id));
  if (!targets.length) return fail(c, 404, 'Ningún dominio coincide');

  const results = await Promise.all(
    targets.map(async (d) => {
      if (!d.dnsRecordId) return { id: d.id, ok: true };
      const del = await deleteDnsRecord(d.dnsRecordId);
      return { id: d.id, ok: del.success, error: del.error };
    })
  );
  const failed = results.filter((r) => !r.ok).map((r) => r.id);
  const removed = targets.filter((d) => !failed.includes(d.id));
  config.domains = config.domains.filter((d) => failed.includes(d.id) || !ids.has(d.id));
  config.deletedDomains = [
    ...new Set([...(config.deletedDomains || []), ...removed.map((d) => d.fullDomain)]),
  ];
  await saveConfig(config);
  const sync = await syncCloudflaredRoutes(config.domains);
  return c.json({
    ok: true,
    removed: removed.length,
    failed: failed.length,
    failedIds: failed,
    syncOk: sync.success,
    syncError: sync.error,
  });
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
  setNotifyUrl(config.settings.notifyUrl);
  return c.json({ ok: true, settings: config.settings });
});

app.get('/api/stats', async (c) => {
  const stats = await getServerStats();
  return c.json({ ok: true, stats });
});

// ---------- Port proxy ----------
// /p/:port/... → http://127.0.0.1:port/... — lets remote clients (LAN/Tailscale)
// reach services even when they only bind the host's loopback interface.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate']);

app.all('/p/:port/*', async (c) => {
  const port = parseInt(c.req.param('port'), 10);
  if (!port || port > 65535) return fail(c, 400, 'Puerto inválido');
  const url = new URL(c.req.url);
  const rest = c.req.path.slice(`/p/${port}`.length) || '/';
  const target = `http://127.0.0.1:${port}${rest}${url.search}`;

  const headers = new Headers();
  for (const [k, v] of c.req.raw.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== 'host') headers.set(k, v);
  }
  headers.set('host', `127.0.0.1:${port}`);
  headers.set('x-forwarded-prefix', `/p/${port}`);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: c.req.method,
      headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
      redirect: 'manual',
      // @ts-expect-error bun streaming
      duplex: 'half',
    });
  } catch {
    return c.html(`<body style="background:#0a0a0c;color:#ccc;font-family:monospace;display:grid;place-items:center;height:100vh"><div>Nada responde en el puerto ${port}.<br>El proceso está detenido o el puerto es incorrecto.</div></body>`, 502);
  }

  const resHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    const kl = k.toLowerCase();
    if (HOP_BY_HOP.has(kl) || kl === 'x-frame-options') continue;
    // fetch() already decoded the body — a forwarded content-encoding makes
    // the browser decompress twice, and a stale content-length truncates
    // rewritten HTML. Drop both; the runtime re-computes framing.
    if (kl === 'content-encoding' || kl === 'content-length') continue;
    // keep redirects inside the proxy prefix — root-absolute, absolute
    // loopback URLs, and URLs pointing at the proxied port itself.
    if (kl === 'location') {
      const abs = v.match(/^https?:\/\/(?:0\.0\.0\.0|127\.0\.0\.1|localhost)(?::(\d+))?(\/.*)?$/);
      if (v.startsWith('/') && !v.startsWith('//')) { resHeaders.set(k, `/p/${port}${v}`); continue; }
      if (abs) { resHeaders.set(k, `/p/${abs[1] || port}${abs[2] || '/'}`); continue; }
    }
    if (kl === 'content-security-policy') {
      resHeaders.set(k, v.replace(/frame-ancestors[^;]*(;|$)/g, ''));
      continue;
    }
    if (kl === 'set-cookie') continue; // handled below via getSetCookie()
    resHeaders.set(k, v);
  }
  // Cookies: scope each proxied app's cookies to its own prefix so sessions
  // don't leak into the dashboard API or sibling /p/N/ apps.
  for (const sc of upstream.headers.getSetCookie?.() ?? []) {
    resHeaders.append('set-cookie', sc
      .replace(/;\s*domain=[^;]*/gi, '')
      .replace(/;\s*path=[^;]*/gi, `; Path=/p/${port}`)
      + (/;\s*path=/i.test(sc) ? '' : `; Path=/p/${port}`));
  }
  // Rewritten HTML is request-context-dependent (origin/proxy prefix): never
  // let the browser cache a stale copy with an old (or broken) ws base URL.
  resHeaders.set('cache-control', 'no-store');

  const type = upstream.headers.get('content-type') || '';
  if (type.includes('text/html')) {
    let html = await upstream.text();
    const reqUrl = new URL(c.req.url);
    // Behind the Cloudflare tunnel every request arrives as http:// even
    // though the browser sees https:// — honor X-Forwarded-Proto so rewrites
    // emit wss:// (mixed content would block ws:// on an https page).
    const outerProto = (c.req.header('x-forwarded-proto') || reqUrl.protocol.replace(':', '')).split(',')[0].trim();
    const proto = outerProto === 'https' ? 'wss:' : 'ws:';
    const httpOrigin = `${outerProto}://${reqUrl.host}`;
    // Apps that hardcode their own ws(s)/http origin (e.g. Steel's session
    // viewer emits ws://0.0.0.0:PORT/v1/...) get routed back through the proxy.
    // Single pass so inserted URLs are never re-processed. 0.0.0.0:P inside a
    // proxied page means "the service itself" (its internal listen port may
    // differ from the published one) → same /p/:port. 127.0.0.1/localhost:P
    // points at a *different* service → /p/P.
    html = html.replace(
      /(wss?|https?):\/\/(0\.0\.0\.0|127\.0\.0\.1|localhost):(\d+)/g,
      (m, scheme: string, host: string, p: string) => {
        const target = host === '0.0.0.0' ? String(port) : p;
        return scheme.startsWith('ws') ? `${proto}//${reqUrl.host}/p/${target}` : `${httpOrigin}/p/${target}`;
      }
    );
    // rewrite root-absolute URLs so assets route back through the proxy
    html = html.replace(/((?:href|src|action|poster|formaction)\s*=\s*["'])\/(?!\/|p\/)/g, `$1/p/${port}/`);
    // srcset is a comma-separated candidate list — prefix each entry.
    html = html.replace(/(srcset\s*=\s*["'])([^"']*)/gi,
      (_m, attr: string, val: string) => attr + val.replace(/(^|,)\s*\/(?!\/|p\/)/g, `$1/p/${port}/`));
    // meta refresh redirects ("0;url=/login") — keep inside the prefix.
    html = html.replace(/(content\s*=\s*["'][^"']*url\s*=\s*)\/(?!\/|p\/)/gi, `$1/p/${port}/`);
    return new Response(html, { status: upstream.status, headers: resHeaders });
  }
  // Stylesheets can carry root-absolute url(/fonts/x.woff2) refs — prefix them
  // so proxied apps don't 404 their assets. data:/blob: untouched (no leading /).
  if (type.includes('text/css')) {
    const css = (await upstream.text())
      .replace(/url\(\s*(['"]?)\/(?!\/|p\/|data:|blob:)/g, `url($1/p/${port}/`);
    return new Response(css, { status: upstream.status, headers: resHeaders });
  }
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
});
app.get('/p/:port', (c) => c.redirect(`/p/${c.req.param('port')}/`));

// ---------- Static ----------

// Static assets must not be served stale — index.html/app.js change on every deploy.
app.use('/*', async (c, next) => {
  await next();
  const p = c.req.path;
  if (p === '/' || p.endsWith('.html') || p.endsWith('.js') || p.endsWith('.css')) {
    c.header('Cache-Control', 'no-cache');
  } else if (p.includes('/vendor/')) {
    c.header('Cache-Control', 'public, max-age=86400');
  }
});

// ---------- QR pairing (issue token) ----------

app.post('/api/pair/create', async (c) => {
  const token = crypto.randomUUID();
  pairTokens.set(token, Date.now() + PAIR_TTL_MS);
  const origin = `${c.req.header('x-forwarded-proto') || new URL(c.req.url).protocol.replace(':', '')}://${c.req.header('host')}`;
  return c.json({ ok: true, token, url: `${origin}/pair?t=${token}`, expiresInMs: PAIR_TTL_MS });
});

// ---------- Heartbeat history ----------

app.get('/api/domains/heartbeats', async (c) => {
  const beats = allHeartbeats();
  const uptime: Record<string, number | null> = {};
  for (const id of Object.keys(beats)) uptime[id] = uptimePct(id);
  return c.json({ ok: true, heartbeats: beats, uptime });
});

// ---------- Remote power ----------

app.post('/api/system/power', async (c) => {
  const body = await c.req.json<{ action?: string; confirm?: string }>().catch(() => ({}));
  const action = body.action;
  if (action !== 'reboot' && action !== 'poweroff') return fail(c, 400, 'Acción inválida');
  const want = action === 'reboot' ? 'REINICIAR' : 'APAGAR';
  if (body.confirm !== want) return fail(c, 400, `Escribí ${want} para confirmar`);
  // Schedule a few seconds out so the HTTP response reaches the client.
  const cmd = action === 'reboot' ? 'reboot' : 'poweroff';
  await hostExec(`nohup bash -c 'sleep 3; systemctl ${cmd}' >/dev/null 2>&1 &`, { user: 'root', timeoutMs: 5000 });
  notify('Ports Manager — Servidor', `Se programó ${action === 'reboot' ? 'un reinicio' : 'un apagado'} en 3 segundos`, 5).catch(() => {});
  return c.json({ ok: true });
});

// POSIX single-quote escaping for host-side shells: 'foo'bar' -> 'foo'"'"'bar'
const shq = (s: string) => `'${String(s).replace(/'/g, `'"'"'`)}'`;

// ---------- Convert process to systemd user service ----------

// systemd unit values: quote each argv element so spaces survive, and escape
// % (specifier expansion) in every interpolated field.
function sdQuote(s: string): string {
  // Inside double quotes systemd only treats \ and " specially; % must be %%.
  return `"${s.replace(/%/g, '%%').replace(/([\\"])/g, '\\$1')}"`;
}
function buildUnit(name: string, argv: string[], cwd: string): string {
  return `[Unit]
Description=pm-${name} (creado desde Ports Manager)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${cwd.replace(/%/g, '%%')}
ExecStart=${argv.map(sdQuote).join(' ')}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

app.post('/api/systemd/create-service', async (c) => {
  const body = await c.req.json<{ pid?: number; name?: string }>().catch(() => ({}));
  const pid = Number(body.pid);
  if (!pid || pid <= 1) return fail(c, 400, 'PID inválido');
  const name = String(body.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  if (!name) return fail(c, 400, 'Nombre de servicio inválido');

  // Read the live process: cmdline + cwd (container sees host pids via pid: host).
  const [cmdlineRaw, cwdRes] = await Promise.all([
    readFile(`/proc/${pid}/cmdline`, 'utf-8').catch(() => null),
    hostExec(`readlink /proc/${pid}/cwd`, { user: 'root', timeoutMs: 5000 }),
  ]);
  if (!cmdlineRaw) return fail(c, 404, `No pude leer el proceso ${pid} — ¿siguió corriendo?`);
  const cwd = cwdRes.ok ? cwdRes.stdout.trim() : '';
  const argv = cmdlineRaw.split('\0').filter(Boolean);
  if (!argv.length || !cwd) return fail(c, 500, 'No pude determinar el comando o el directorio del proceso');

  const unit = buildUnit(name, argv, cwd);

  const b64 = Buffer.from(unit, 'utf-8').toString('base64');
  const dir = 'mkdir -p ~/.config/systemd/user';
  const write = `${dir} && echo '${b64}' | base64 -d > ~/.config/systemd/user/pm-${name}.service`;
  const enable = `systemctl --user daemon-reload && systemctl --user enable --now pm-${name}.service`;
  const res = await hostExec(`${write} && ${enable}`, { user: 'user', timeoutMs: 30_000 });
  if (!res.ok) {
    return fail(c, 500, 'Falló crear/habilitar el servicio', { detail: (res.stderr || res.stdout).slice(0, 2000), unit });
  }
  return c.json({ ok: true, service: `pm-${name}.service`, unit, cwd, command: argv.join(' ') });
});

// Preview of the unit that would be generated — no writes.
app.post('/api/systemd/preview-service', async (c) => {
  const body = await c.req.json<{ pid?: number; name?: string }>().catch(() => ({}));
  const pid = Number(body.pid);
  if (!pid || pid <= 1) return fail(c, 400, 'PID inválido');
  const [cmdlineRaw, cwdRes] = await Promise.all([
    readFile(`/proc/${pid}/cmdline`, 'utf-8').catch(() => null),
    hostExec(`readlink /proc/${pid}/cwd`, { user: 'root', timeoutMs: 5000 }),
  ]);
  if (!cmdlineRaw) return fail(c, 404, `Proceso ${pid} no encontrado`);
  const argv = cmdlineRaw.split('\0').filter(Boolean);
  const cwd = cwdRes.ok ? cwdRes.stdout.trim() : '';
  const name = String(body.name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  const unit = buildUnit(name || 'servicio', argv, cwd || '/');
  return c.json({ ok: true, unit, cwd, command: argv.join(' '), suggested: `pm-${name || 'servicio'}.service` });
});

// ---------- Feature modules (self-contained, wired here) ----------
registerFilesRoutes(app);
registerEventRoutes(app);
registerAlertRoutes(app);
registerScriptRoutes(app);
registerLogsRoutes(app);
registerMetricsRoutes(app);
registerDropRoutes(app);
registerSessionRoutes(app);
registerOpsRoutes(app);
registerDockerOpsRoutes(app);
registerComposeRoutes(app);

startAlertLoop();
startScriptScheduler();
startDropSweeper();

app.get('/*', serveStatic({ root: './public' }));

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return fail(c, 500, 'Error interno', { detail: String(err) });
});

// ---------- Embedded terminal ----------
// /ws/term — authenticated WebSocket that bridges to a host tmux session via
// `script` (provides the PTY). The tmux session 'pm-term' persists across
// browser refreshes and reconnects.
interface WsProxyData { kind: 'proxy'; upstream: WebSocket; pendingClient: unknown[]; pendingServer: unknown[]; ws: Bun.ServerWebSocket<WsData> | null }
interface WsTermData { kind: 'term'; proc?: ReturnType<typeof Bun.spawn>; session?: string; exec?: string; cols?: number; rows?: number }
type WsData = WsProxyData | WsTermData | LogsWsData;

function startTermSocket(ws: Bun.ServerWebSocket<WsData>): void {
  const t = ws.data as WsTermData;
  const cols = t.cols || 120;
  const rows = t.rows || 40;
  const session = t.session || 'pm-term';
  // exec mode: `docker exec -it` into a container instead of a tmux session.
  // No persistence — the shell dies with the WS. `script` still provides the
  // local PTY (docker -t allocates the container-side one); COLUMNS/LINES are
  // a best-effort hint for the container's initial winsize.
  const inner = t.exec
    ? `docker exec -it -e COLUMNS=${cols} -e LINES=${rows} ${shq(t.exec)} sh -c 'command -v bash >/dev/null && exec bash -l || exec sh -l'`
    : `tmux new-session -A -s ${session}`;
  const cmd = `export TERM=xterm-256color; script -qfc "stty cols ${cols} rows ${rows}; exec ${inner}" /dev/null`;
  const proc = hostSpawnInteractive(cmd, { user: 'user' });
  t.proc = proc;
  const pump = async (stream: ReadableStream<Uint8Array> | undefined) => {
    if (!stream) return;
    const r = stream.getReader();
    try {
      while (true) {
        const { done, value } = await r.read();
        if (done) break;
        try {
          ws.send(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
        } catch { break; }
      }
    } catch { /* closed */ }
  };
  pump(proc.stdout as ReadableStream<Uint8Array>);
  pump(proc.stderr as ReadableStream<Uint8Array>);
  proc.exited.then(() => { try { ws.close(); } catch { /* closed */ } });
}

export default {
  port: PORT,
  async fetch(req: Request, server: Bun.Server) {
    const url = new URL(req.url);
    const isWs = req.headers.get('upgrade')?.toLowerCase() === 'websocket';
    const wsMatch = url.pathname.match(/^\/p\/(\d+)(\/.*)?$/);
    if (wsMatch && isWs) {
      const token = req.headers.get('cookie')?.match(/(?:^|;\s*)ports_session=([^;]+)/)?.[1];
      if (!token || !(await verifySessionToken(token)) || isRevoked(sessionIdForToken(token))) return new Response('Unauthorized', { status: 401 });
      touchSession(sessionIdForToken(token));
      // Forward the client's subprotocol list (noVNC requires 'binary').
      // Upstream handlers attach NOW — before server.upgrade — so frames
      // that arrive early (RFB greeting, banners) and close/error events
      // can't be lost in the window between connect and websocket.open().
      const protos = (req.headers.get('sec-websocket-protocol') || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      let upstream: WebSocket;
      try {
        upstream = protos.length
          ? new WebSocket(`ws://127.0.0.1:${wsMatch[1]}${wsMatch[2] || '/'}${url.search}`, protos)
          : new WebSocket(`ws://127.0.0.1:${wsMatch[1]}${wsMatch[2] || '/'}${url.search}`);
      } catch {
        return new Response('Upstream inválido', { status: 502 });
      }
      upstream.binaryType = 'arraybuffer';
      const data: WsData = { kind: 'proxy', upstream, pendingClient: [], pendingServer: [], ws: null };
      let resolveOpen: ((ok: boolean) => void) | null = null;
      upstream.onopen = () => {
        for (const m of data.pendingClient.splice(0)) upstream.send(m as never);
        resolveOpen?.(true); resolveOpen = null;
      };
      upstream.onmessage = (e) => {
        if (data.ws) { try { data.ws.send(e.data as string | ArrayBuffer); } catch { /* closed */ } }
        else data.pendingServer.push(e.data);
      };
      upstream.onclose = upstream.onerror = () => {
        resolveOpen?.(false); resolveOpen = null;
        try { data.ws?.close(); } catch { /* closed */ }
      };
      // Wait for the upstream handshake before answering the client so we can
      // echo the subprotocol the upstream ACTUALLY negotiated — and reject
      // with 502 instead of leaving a dead socket hanging forever.
      const opened = await Promise.race([
        new Promise<boolean>((r) => { resolveOpen = r; }),
        new Promise<boolean>((r) => setTimeout(() => { resolveOpen = null; r(false); }, 10_000)),
      ]);
      if (!opened) {
        try { upstream.close(); } catch { /* gone */ }
        return new Response(`Nada responde en el puerto ${wsMatch[1]} (websocket)`, { status: 502 });
      }
      const upgradeHeaders = upstream.protocol ? { 'Sec-WebSocket-Protocol': upstream.protocol } : undefined;
      if (server.upgrade(req, { headers: upgradeHeaders, data })) return;
      upstream.close();
      return new Response('WS upgrade failed', { status: 500 });
    }
    if (isWs && url.pathname === '/ws/term') {
      const token = req.headers.get('cookie')?.match(/(?:^|;\s*)ports_session=([^;]+)/)?.[1];
      if (!token || !(await verifySessionToken(token)) || isRevoked(sessionIdForToken(token))) return new Response('Unauthorized', { status: 401 });
      touchSession(sessionIdForToken(token));
      // ?exec=<container id|name> → interactive docker exec instead of tmux.
      const exec = url.searchParams.get('exec') || '';
      if (exec && !/^[a-zA-Z0-9_.-]{1,128}$/.test(exec)) {
        return new Response('Contenedor inválido', { status: 400 });
      }
      const data: WsData = {
        kind: 'term',
        session: (url.searchParams.get('s') || 'pm-term').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'pm-term',
        exec: exec || undefined,
        cols: parseInt(url.searchParams.get('c') || '120', 10),
        rows: parseInt(url.searchParams.get('r') || '40', 10),
      };
      if (server.upgrade(req, { data })) return;
      return new Response('WS upgrade failed', { status: 500 });
    }
    if (isWs && url.pathname === '/ws/logs') {
      const token = req.headers.get('cookie')?.match(/(?:^|;\s*)ports_session=([^;]+)/)?.[1];
      if (!token || !(await verifySessionToken(token))) return new Response('Unauthorized', { status: 401 });
      if (isRevoked(sessionIdForToken(token))) return new Response('Unauthorized', { status: 401 });
      touchSession(sessionIdForToken(token));
      const src = url.searchParams.get('src') || '';
      const p = parseLogsSrc(src);
      if (!p.ok) return new Response(`src inválido: ${p.error}`, { status: 400 });
      const data: WsData = { kind: 'logs', src };
      if (server.upgrade(req, { data })) return;
      return new Response('WS upgrade failed', { status: 500 });
    }
    return app.fetch(req, server);
  },
  websocket: {
    open(ws: Bun.ServerWebSocket<WsData>) {
      if (ws.data.kind === 'term') { startTermSocket(ws); return; }
      if (ws.data.kind === 'logs') { startLogsSocket(ws); return; }
      // Handlers were attached in fetch() before upgrade — just link the
      // socket and flush any upstream frames buffered in between.
      ws.data.ws = ws;
      for (const m of ws.data.pendingServer.splice(0)) {
        try { ws.send(m as string | ArrayBuffer); } catch { break; }
      }
    },
    message(ws: Bun.ServerWebSocket<WsData>, msg: string | Buffer) {
      if (ws.data.kind === 'logs') return; // read-only stream
      if (ws.data.kind === 'term') {
        const t = ws.data;
        if (typeof msg === 'string' && msg[0] === '{') {
          try {
            const j = JSON.parse(msg);
            if (j.t === 'r' && Number.isFinite(j.c) && Number.isFinite(j.r)) {
              // docker exec sessions can't be resized server-side — initial
              // size only; ignore the message.
              if (t.exec) return;
              const sess = t.session || 'pm-term';
              const c = Math.max(2, Math.min(j.c, 500)), r = Math.max(2, Math.min(j.r, 200));
              hostExec(`tmux resize-window -t ${sess} -x ${c} -y ${r} 2>/dev/null; tmux refresh-client -t ${sess} -C ${c},${r} 2>/dev/null; true`, { user: 'user', timeoutMs: 4000 }).catch(() => {});
              return;
            }
            if (j.t === 'i' && typeof j.d === 'string') {
              const stdin = t.proc?.stdin as { write(d: string): void; flush(): void } | undefined;
              if (stdin) { stdin.write(j.d); stdin.flush(); }
            }
          } catch { /* not json — fall through to raw */ }
          return;
        }
        const stdin = t.proc?.stdin as { write(d: string | Buffer): void; flush(): void } | undefined;
        try { stdin?.write(msg); stdin?.flush(); } catch { /* proc exited */ }
        return;
      }
      const up = ws.data.upstream;
      if (up.readyState === WebSocket.OPEN) up.send(msg as never);
      else ws.data.pendingClient.push(msg);
    },
    close(ws: Bun.ServerWebSocket<WsData>) {
      if (ws.data.kind === 'logs') { stopLogsSocket(ws.data); return; }
      if (ws.data.kind === 'term') {
        // Killing runuser orphans bash→script→tmux-client on the host; detach
        // the tmux client first so the whole chain exits cleanly, then kill.
        // (exec sessions aren't tmux-backed — just kill the process.)
        if (!ws.data.exec) {
          const sess = ws.data.session || 'pm-term';
          hostExec(`tmux detach-client -s ${sess} 2>/dev/null; true`, { user: 'user', timeoutMs: 3000 }).catch(() => {});
        }
        try { (ws.data.proc as { kill(s?: string): void } | undefined)?.kill('SIGKILL'); } catch { /* gone */ }
        return;
      }
      try { ws.data.upstream.close(); } catch { /* already closed */ }
    },
  },
};
