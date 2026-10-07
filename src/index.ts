import { initHostStorage, resolveHostPath, hostVolumes, availableStorage } from './host-storage';
import packageInfo from '../package.json';
import { $ } from 'bun';
import { Hono } from 'hono';
import { browserWriteGuard, requestOriginAllowed, safePairTarget } from './browser-security';
import { serveStatic, getConnInfo } from 'hono/bun';
import { compress } from 'hono/compress';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import {
  requireAuth,
  verifyPassword,
  hashPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  verifySessionToken,
  setSessionHooks,
} from './auth';
import { loadConfig, saveConfig, updateConfigAuth } from './config';
import { LoginChallenges } from './login-challenges';
import { domainsForPorts, domainsForProject } from './domain-associations';
import { validateSettings, isForbiddenWebhookHost, maskWebhookUrl } from './settings-validation';
import { getServerStats, getServerHosts } from './stats';
import { HOST_USER, setHostUser, hostExec, hostToContainer, hostSpawnInteractive, killHostProc } from './host';
import {
  configurePorts,
  listPortProcesses,
  killPlan,
  killProcessTree,
  getProcessDetail,
  maskCmd,
  maskArgv,
} from './ports';
import { isCriticalUnit } from './systemd-units';
import { getJob, listJobs, runJob, setJobCompletionHook } from './jobs';
import {
  getPrograms,
  invalidateProgramsCache,
  warmProgramsCache,
  programsStatus,
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
  dockerDaemonError,
  isOwnContainer,
} from './docker';
import {
  createDnsRecord,
  deleteDnsRecord,
  syncCloudflaredRoutes,
  listDnsRecords,
  listAllDnsRecords,
  getRemoteTunnelConfig,
  purgeCachePrefixes,
  cloudflareConfigured,
} from './cloudflare';
import type { AppConfig, DomainMapping, DomainStatus, Project } from './types';
import { notify, setNotifyUrl, notifyConfigured } from './notify';
import { generateTotpSecret, verifyTotp, totpUri, generateRecoveryCodes, hashRecoveryCode, consumeRecoveryCode } from './totp';
import { loadHeartbeats, recordHeartbeat, lastState, allHeartbeats, uptimePct, pruneHeartbeats } from './heartbeats';
import { registerFilesRoutes } from './files';
import { registerNavigationRoutes } from './navigation';
import { privateApiResponses } from './response-cache';
import { boundedRequestBody } from './request-body';
import { registerEventRoutes, loadEvents, recordEvent } from './events';
import { registerAlertRoutes, startAlertLoop } from './alerts';
import { registerScriptRoutes, startScriptScheduler } from './scripts';
import { parseLogsSrc, startLogsSocket, stopLogsSocket, registerLogsRoutes } from './logs';
import type { LogsWsData } from './logs';
import { registerMetricsRoutes } from './metrics';
import { registerDropRoutes, startDropSweeper, dropPathReferences } from './drop';
import { registerLibraryRoutes, libraryHostGuard, libraryFileOperation } from './library';
import { registerSessionRoutes, recordSession, sessionIdForToken, sessionIdFromRequest, isRevoked, touchSession, revokeSession, listSessions } from './sessions';
import { registerOnboardingPublic, registerOnboardingRoutes } from './onboarding';
import { registerOpsRoutes } from './ops';
import { registerOptimizerRoutes } from './optimizer';
import { registerDockerOpsRoutes } from './docker-ops';
import {MigrationRetirement} from './migration-retirement';
import {HomepageMigration} from './homepage-migration';
import {ComposeReleases} from './compose-releases';
import { registerComposeRoutes } from './compose';
import { registerStoreRoutes, invalidateStoreCache } from './app-store';
import { software, registerSoftwareRoutes, runSoftwareJob, softwareCommand, softwareConfig, softwareInstallSpec } from './software';
import { registerAgentRoutes, listAgents, invalidateAgentsCache, agentPathReferences } from './agents';
import { registerAgentAccounts } from './agent-accounts';
import { registerAgentUsage } from './agent-usage';
import { registerAgentConsumption } from './agent-consumption';
import { hostTerminalCommand } from './terminal';

import { MaintenanceRepository } from './storage/repository';
import { MaintenanceError } from './storage/types';
import { StorageService } from './storage/service';
import { scanRoot, scanRoots } from './storage/scan';
import { registerStorageRoutes } from './storage/routes';
import {libraryTransferReview} from './library';
import {HostCleaner} from './storage/cleaner';
import {FileTransfers} from './file-transfers';
import {includeConfiguredReferences} from './transfer-references';
import { HomeLinks, registerHomeLinkRoutes, knownHomeLinks } from './home-links';
import { Migrations, registerMigrationRoutes } from './app-migrations';
import { dockerInstallations, physicalInstallations, programInstallation } from './installation-inventory';
import { ComposeDrafts } from './compose-drafts';
import { qaRoot, registerQaBoundary } from './qa-boundary';
import { FileOperations, fileHostHome } from './file-operations';
import { PlatformStore } from './platform/store';
import { ProjectHub, hubContainers, hubTerminals, inside } from './platform/projects';
import { Diagnostics } from './platform/diagnostics';
import { machineApi, registerPlatformRoutes } from './platform/api';
import { auditMutations } from './platform/audit';
import { contextWorker } from './agent-context';
import { consumptionWorker } from './agent-consumption';
import { Backups, registerBackups, hostDataDirectory } from './platform/backups';
import { Desktop, registerDesktop } from './platform/desktop';
import { registerCloudRoutes, createCloudProviders } from './cloud/routes';
import { CloudVault } from './cloud/vault';
import { CloudAgents } from './cloud/agents';
const maintenanceQaRoot = await qaRoot();

const PORT = parseInt(process.env.PORT || '3457', 10);
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'example.com';

let config = await loadConfig();
configurePorts(config.settings);
setHostUser(config.settings.hostUser);
initHostStorage(maintenanceQaRoot||undefined);
initProjects(config, saveConfig);
await loadHeartbeats();
await loadEvents();
{
  // A persisted webhook predating the reserved-host guard would load unchecked;
  // re-validate at boot so SSRF targets can't sneak in via config.json edits.
  const nu = config.settings.notifyUrl;
  if (nu) {
    try {
      const u = new URL(nu);
      if (!['http:', 'https:'].includes(u.protocol) || isForbiddenWebhookHost(u.hostname)) {
        console.warn('[notify] notifyUrl ignorada: apunta a una dirección reservada');
        config.settings.notifyUrl = '';
      }
    } catch {
      console.warn('[notify] notifyUrl ignorada: URL inválida');
      config.settings.notifyUrl = '';
    }
  }
}
setNotifyUrl(config.settings.notifyUrl, config.settings.notifyProvider);
setSessionHooks({ isRevoked, touch: touchSession });

const platformStore = new PlatformStore(path.join(path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),'platform'));
const projectHub = new ProjectHub(platformStore,{
  projects:getProjects, processes:listPortProcesses, containers:maintenanceQaRoot ? async() => [] : hubContainers, domains:() => config.domains,
  home:maintenanceQaRoot ? async() => maintenanceQaRoot : fileHostHome,
  terminals:maintenanceQaRoot ? async() => [] : hubTerminals,
  chats:(home,cwd) => contextWorker(home,{action:'list',kind:'chats',project:cwd}),
  consumption:(home,cwd) => consumptionWorker(home,{agent:'all',period:'7',tz:'America/Argentina/Buenos_Aires',project:cwd}),
});
const projectDiagnostics = new Diagnostics(projectHub);
const platformHome = maintenanceQaRoot ? async() => maintenanceQaRoot : fileHostHome;
const platformBackups = new Backups(platformStore,projectHub,platformHome,() => hostDataDirectory(path.dirname(process.env.CONFIG_PATH || '/app/data/config.json')));
await platformBackups.ensureConfiguration();
const platformDesktop = new Desktop(platformHome,platformStore);
const cloudVaultDir=path.join(path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),'cloud');
const cloudVault=new CloudVault(cloudVaultDir);
const cloudProviders=createCloudProviders(platformStore,cloudVault);
const cloudAgents=new CloudAgents(platformStore,cloudProviders,cloudVault);
const platformDependencies = {cloud:cloudAgents,cloudLocalUrl:'http://127.0.0.1:'+PORT,store:platformStore,hub:projectHub,diagnostics:projectDiagnostics,logs:(id:string) => projectLogs(projectHub.project(id),200),backups:{list:(id:string) => platformBackups.list(id),run:(id:string,actor:string,credentialId?:string) => platformBackups.forProject(id,actor,credentialId)}};

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
app.use('/api/*', privateApiResponses);
registerQaBoundary(app, maintenanceQaRoot);
app.use('*', boundedRequestBody);

// gzip text responses (JS/CSS/HTML/JSON ~500KB → ~150KB). Skips
// already-encoded bodies, downloads, and SSE (excluded by content-type).
app.use(compress());
app.use('/api/*', browserWriteGuard);

// Dedicated share hostname only serves the public /s/* pages.
app.use('*', libraryHostGuard);

function fail(c: any, status: number, error: string, extra?: Record<string, unknown>) {
  return c.json({ ok: false, error, ...extra }, status);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- Auth ----------

// Brute-force guard: per-source failure counters with a lockout, plus a global
// counter so rotating IPs can't bypass it. In-memory is fine — an attacker
// can't force a restart to reset it. Failures feed the event log; lockouts
// push a notification via notify.ts.
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const GLOBAL_MAX_FAILS = 30;
const GLOBAL_LOCKOUT_MS = 10 * 60 * 1000;
const LOGIN_GUARD_MAX_ENTRIES = 2000;

interface LoginGuardState { fails: number[]; lockedUntil: number }
const loginGuard = new Map<string, LoginGuardState>();
const globalLoginFails: number[] = [];
let globalLockUntil = 0;

// Forwarded-IP headers are honored only when the TCP peer is a trusted proxy
// (cloudflared / a reverse proxy on this host, or AXON_TRUSTED_PROXIES). The
// server binds 0.0.0.0 — a direct LAN client could otherwise spoof any IP,
// evading the per-IP lockout or locking the real admin's address out.
const TRUSTED_PROXIES = new Set(
  ['127.0.0.1', '::1', '::ffff:127.0.0.1',
    ...(process.env.AXON_TRUSTED_PROXIES || '').split(',').map((s) => s.trim())].filter(Boolean)
);

function clientIp(c: any): string {
  let peer = '';
  try { peer = getConnInfo(c).remote.address || ''; } catch { /* non-Bun env (tests) */ }
  if (!peer || !TRUSTED_PROXIES.has(peer)) return peer || 'unknown';
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    peer
  );
}

function loginLockRemaining(c: any): number {
  const now = Date.now();
  if (globalLockUntil > now) return globalLockUntil - now;
  const st = loginGuard.get(clientIp(c));
  if (st && st.lockedUntil > now) return st.lockedUntil - now;
  return 0;
}

function noteLoginFail(c: any, username: string): void {
  const ip = clientIp(c);
  const now = Date.now();
  const cut = now - LOGIN_WINDOW_MS;

  let st = loginGuard.get(ip);
  if (!st) {
    st = { fails: [], lockedUntil: 0 };
    loginGuard.set(ip, st);
  }
  st.fails = st.fails.filter((t) => t > cut);
  st.fails.push(now);

  for (let i = globalLoginFails.length - 1; i >= 0; i--) {
    if (globalLoginFails[i] <= cut) globalLoginFails.splice(i, 1);
  }
  globalLoginFails.push(now);

  recordEvent('auth', `Login fallido — ${username || 'desconocido'} desde ${ip}`);

  if (st.fails.length >= LOGIN_MAX_FAILS && st.lockedUntil <= now) {
    st.lockedUntil = now + LOGIN_LOCKOUT_MS;
    recordEvent('auth', `Login bloqueado — ${ip} superó ${LOGIN_MAX_FAILS} intentos fallidos`);
    notify(
      'Posible brute force — login bloqueado',
      `${st.fails.length} intentos fallidos desde ${ip}. Bloqueado por ${LOGIN_LOCKOUT_MS / 60000} min.`,
      4
    ).catch(() => {});
  }
  if (globalLoginFails.length >= GLOBAL_MAX_FAILS && globalLockUntil <= now) {
    globalLockUntil = now + GLOBAL_LOCKOUT_MS;
    recordEvent('auth', `Bloqueo global de login — ${globalLoginFails.length} intentos en 10 min (posible rotación de IPs)`);
    notify(
      'Brute force distribuido — logins pausados',
      `${globalLoginFails.length} intentos fallidos en 10 min desde varias IPs. Todos los logins bloqueados por ${GLOBAL_LOCKOUT_MS / 60000} min.`,
      5
    ).catch(() => {});
  }

  // Cap the map so IP rotation can't grow memory unboundedly.
  if (loginGuard.size > LOGIN_GUARD_MAX_ENTRIES) {
    for (const [k, v] of loginGuard) {
      if (v.lockedUntil <= now && (v.fails.length === 0 || v.fails[v.fails.length - 1] <= cut)) loginGuard.delete(k);
    }
    if (loginGuard.size > LOGIN_GUARD_MAX_ENTRIES) {
      loginGuard.delete(loginGuard.keys().next().value as string);
    }
  }
}

// Shared lockout response — login and the credential-management endpoints
// below draw from the same failure counters.
function loginLocked(c: any): Response | null {
  const lockMs = loginLockRemaining(c);
  if (!lockMs) return null;
  const sec = Math.ceil(lockMs / 1000);
  c.header('Retry-After', String(sec));
  return fail(c, 429, `Demasiados intentos fallidos — probá en ${Math.max(1, Math.ceil(sec / 60))} min`);
}

// Credential changes and recovery-code logins share one reauthentication
// boundary, so concurrent requests cannot consume the same code or authenticate
// against a password that another request is currently replacing.
let authRequestQueue: Promise<void> = Promise.resolve();
const serializeAuth = async (_c: any, next: () => Promise<void>) => {
  const previous = authRequestQueue;
  let release: () => void;
  authRequestQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { await next(); } finally { release(); }
};
app.use('/api/login', serializeAuth);
app.use('/api/auth/*', serializeAuth);

const loginChallenges = new LoginChallenges();
app.post('/api/login', async (c) => {
  const locked = loginLocked(c);
  if (locked) return locked;
  // Public route: cap the body before parsing — c.req.json() would buffer
  // the whole payload in memory.
  if (Number(c.req.header('content-length') || 0) > 8192) return fail(c, 413, 'Solicitud demasiado grande');
  const rawBody = await c.req.text();
  if (rawBody.length > 8192) return fail(c, 413, 'Solicitud demasiado grande');
  const parsed = (() => { try { const v = JSON.parse(rawBody); return v && typeof v === 'object' ? v : {}; } catch { return {}; } })() as { username?: unknown; password?: unknown; code?: unknown; challenge?: unknown };
  let username = typeof parsed.username === 'string' ? parsed.username : '';
  const password = typeof parsed.password === 'string' ? parsed.password : '';
  const code = typeof parsed.code === 'string' ? parsed.code : undefined;
  const challenge = typeof parsed.challenge === 'string' ? parsed.challenge : undefined;
  let valid = false;
  if (parsed.challenge !== undefined) {
    const verifiedUser = loginChallenges.get(parsed.challenge, config.auth, clientIp(c));
    if (!verifiedUser) return fail(c, 410, 'La verificación venció. Volvé a ingresar tu usuario y contraseña.');
    username = verifiedUser; valid = true;
  } else {
    // Never disclose 2FA before the password is correct; wrong usernames still
    // run PBKDF2 so the first step preserves its generic failure contract.
    const passOk = await verifyPassword(password, config.auth.passwordHash);
    valid = passOk && username === config.auth.username;
    if (valid && config.auth.totpSecret && !code) {
      return c.json({ ok: true, requiresSecondFactor: true, challenge: loginChallenges.issue(config.auth, clientIp(c)), expiresIn: 300 });
    }
  }
  if (valid && config.auth.totpSecret) {
    valid = verifyTotp(config.auth.totpSecret, code || '');
    const recovery = [...(config.auth.totpRecovery || [])];
    if (!valid && consumeRecoveryCode(recovery, code || '')) {
      await updateConfigAuth(config, auth => { auth.totpRecovery = recovery; });
      valid = true;
      recordEvent('auth', `Login con código de recuperación — quedan ${config.auth.totpRecovery!.length}`);
      notify('Código de recuperación usado', `Quedan ${config.auth.totpRecovery!.length}. Si no fuiste vos, revisá tu 2FA en Configuración.`, 4).catch(() => {});
    }
  }
  if (!valid) {
    noteLoginFail(c, username);
    if (challenge) loginChallenges.fail(challenge);
    // Same message whether the password or the TOTP code was wrong — a
    // distinct "bad code" error would confirm password guesses. The frontend
    // learns totpEnabled from /api/me, not from this error.
    return fail(c, 401, challenge ? 'El código no es válido. Probá otra vez.' : 'Credenciales inválidas');
  }
  if (challenge) loginChallenges.consume(challenge);
  loginGuard.delete(clientIp(c));
  recordEvent('auth', `Login exitoso desde ${clientIp(c)}`);
  const token = await createSession(username);
  await recordSession(token, username, c.req.header('user-agent') || '');
  setSessionCookie(c, token);
  return c.json({ ok: true });
});

app.post('/api/logout', async (c) => {
  // Revoke server-side too — the cookie is stateless, so clearing it alone
  // leaves the signed token valid for the rest of its TTL.
  const token = c.req.header('cookie')?.match(/(?:^|;\s*)axon_session=([^;]+)/)?.[1];
  if (token) await revokeSession(token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get('/api/me', async (c) => {
  const session = await getSession(c);
  // totpEnabled is auth state — leaking it pre-auth tells an attacker
  // whether the account has a second factor before guessing anything.
  if (!session) return c.json({ authenticated: false, username: null });
  // A revoked token must report as logged out, not half-authenticated.
  const token = c.req.header('cookie')?.match(/(?:^|;\s*)axon_session=([^;]+)/)?.[1];
  if (token && isRevoked(sessionIdForToken(token))) {
    return c.json({ authenticated: false, username: null });
  }
  return c.json({ authenticated: true, username: session.username, totpEnabled: !!config.auth.totpSecret, scanIntervalMs: config.settings.scanIntervalMs, capabilities: ['optimizer', 'optimizer-idle-guard'] });
});

// ---------- First-run onboarding ----------
// What the panel already detected about the host — surfaced during setup so
// the user's first impression is their real environment, not a blank state.
async function onboardingProbe() {
  const [dockerVersion, containers, diskProjects, storage, stats] = await Promise.all([
    $`docker version --format '{{.Server.Version}}'`.text().catch(() => ''),
    maintenanceQaRoot ? Promise.resolve([]) : listContainers().catch(() => []),
    detectProjectsOnDisk().catch(() => []),
    availableStorage().catch(() => null),
    getServerStats().catch(() => null),
  ]);
  return {
    docker: {
      available: !!dockerVersion.trim() || (containers?.length ?? 0) > 0,
      version: dockerVersion.trim() || null,
      running: containers?.length ?? 0,
    },
    projects: {
      count: diskProjects.length,
      sample: diskProjects.slice(0, 5).map((p) => ({ name: p.name, type: p.type })),
    },
    disks: (storage?.disks || []).slice(0, 6).map((d) => ({ name: d.name, path: d.path, available: d.available })),
    memoryTotalMb: stats?.memoryTotalMb ?? null,
    hostUser: config.settings.hostUser,
  };
}

const onboardingDeps = {
  getConfig: () => config,
  saveAuth: async (username: string, passwordHash: string, consumedTokenHash: string) => {
    await updateConfigAuth(config, auth => {
      auth.username = username; auth.passwordHash = passwordHash; auth.setupTokenHash = consumedTokenHash;
    });
  },
  hashPassword,
  startSession: async (c: any, username: string) => {
    const token = await createSession(username);
    await recordSession(token, username, c.req.header('user-agent') || '');
    setSessionCookie(c, token);
  },
  backupCount: () => platformBackups.policies().length,
  probe: onboardingProbe,
  recordEvent,
  lockRemaining: loginLockRemaining,
  noteFail: noteLoginFail,
};
// Public part (status + one-time-token setup) must precede requireAuth.
registerOnboardingPublic(app, onboardingDeps);

app.use('/api/*', async (c,next)=>{if(/^\/api\/(storage|maintenance|home|compose|files\/trash)(?:\/|$)/.test(c.req.path))c.header('Cache-Control','private, no-store');await next();});
// Machine tokens are accepted only by the versioned API, before cookie auth.
// Its terminal wildcard prevents any request from falling through to legacy routes.
app.route('/api/v1',machineApi(platformDependencies));
app.get('/api/health', c => {
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, version: process.env.AXON_VERSION || packageInfo.version, revision: process.env.AXON_REVISION || 'development', ...(maintenanceQaRoot ? {qa:true} : {}) });
});
app.use('/api/*', requireAuth);
app.use('/api/*',async(c,next)=>{
  if(!['GET','HEAD'].includes(c.req.method)&&/^\/api\/(files|library|projects|compose|drop|agents)(?:\/|$)/.test(c.req.path))await hostVolumes.snapshot(true);
  await next();
});
app.use('/api/*',auditMutations(platformStore,(pathname,resource) => {
  const id = pathname.match(/^\/api\/(?:projects|project-hub)\/([^/]+)/)?.[1];
  return id && getProjects().some(p => p.id === id) ? id : getProjects().filter(p=>inside(resource,p.cwd)).sort((a,b)=>b.cwd.length-a.cwd.length)[0]?.id;
}));
registerPlatformRoutes(app,platformDependencies);
registerBackups(app,platformBackups);
app.use('/desktop/*',requireAuth);
registerDesktop(app,platformDesktop);
app.use('/p/*', requireAuth);

// ---------- TOTP (2FA) management — authed ----------
// Enrollment: setup issues a pending secret held in memory (10 min, keyed by
// the logged-in user); it only becomes config.auth.totpSecret once the user
// confirms with a valid code — can't lock yourself out with a bad scan.
const totpPending = new Map<string, { secret: string; exp: number }>();
const TOTP_PENDING_TTL_MS = 10 * 60 * 1000;

// These endpoints share the login guard: a stolen session must not be able
// to grind 6-digit codes or enroll an attacker authenticator.
app.post('/api/auth/totp/setup', (c) => {
  const locked = loginLocked(c);
  if (locked) return locked;
  const user = String(c.get('user') || 'user');
  const secret = generateTotpSecret();
  totpPending.set(user, { secret, exp: Date.now() + TOTP_PENDING_TTL_MS });
  return c.json({ ok: true, secret, uri: totpUri(secret, user) });
});

// Re-auth gate for enrolling/removing 2FA — a session cookie alone is not
// enough to change the second factor. Accepts the current password, or a
// code from the existing secret when rotating devices.
async function totpReauth(body: { code?: string; password?: string }): Promise<boolean> {
  return (
    (await verifyPassword(String(body.password || ''), config.auth.passwordHash)) ||
    (config.auth.totpSecret ? verifyTotp(config.auth.totpSecret, String(body.code || '')) : false)
  );
}

app.post('/api/auth/totp/enable', async (c) => {
  const locked = loginLocked(c);
  if (locked) return locked;
  const user = String(c.get('user') || 'user');
  const body = await c.req.json<{ code?: string; password?: string }>().catch(() => ({} as { code?: string; password?: string }));
  if (!(await totpReauth(body))) {
    noteLoginFail(c, user);
    return fail(c, 401, 'Reautenticación requerida — ingresá tu contraseña actual');
  }
  const pending = totpPending.get(user);
  if (!pending || pending.exp < Date.now()) {
    totpPending.delete(user);
    return fail(c, 400, 'El setup venció — generá un QR nuevo');
  }
  if (!verifyTotp(pending.secret, String(body.code || ''))) {
    noteLoginFail(c, user);
    return fail(c, 401, 'Código inválido');
  }
  const recovery = generateRecoveryCodes();
  await updateConfigAuth(config, auth => { auth.totpSecret = pending.secret; auth.totpRecovery = recovery.map(hashRecoveryCode); });
  totpPending.delete(user);
  recordEvent('auth', '2FA activado');
  notify('2FA activado', 'Los próximos logins van a pedir el código del autenticador.', 3).catch(() => {});
  return c.json({ ok: true, recovery });
});

// Password change — there is no recovery flow, so the current password is
// always required and every other session is revoked on success (a stolen
// cookie can't outlive the rotation). CLI fallback: `axon reset-password`.
app.post('/api/auth/password', async (c) => {
  const locked = loginLocked(c);
  if (locked) return locked;
  const body = await c.req.json<{ current?: string; password?: string }>().catch(() => ({} as { current?: string; password?: string }));
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8 || password.length > 200) {
    return fail(c, 400, 'La contraseña nueva necesita al menos 8 caracteres.');
  }
  if (!(await verifyPassword(String(body.current || ''), config.auth.passwordHash))) {
    noteLoginFail(c, String(c.get('user') || 'user'));
    recordEvent('auth', 'Cambio de contraseña rechazado — la actual no coincide');
    return fail(c, 401, 'La contraseña actual no es correcta.');
  }
  if (body.current === password) return fail(c, 400, 'La contraseña nueva es igual a la actual.');
  const passwordHash = await hashPassword(password);
  await updateConfigAuth(config, auth => { auth.passwordHash = passwordHash; });
  const sid = sessionIdFromRequest(c);
  for (const s of listSessions().issued) if (s.jti !== sid) await revokeSession(s.jti);
  recordEvent('auth', `Contraseña actualizada por ${c.get('user')}`);
  notify('Contraseña actualizada', 'Las demás sesiones y dispositivos quedaron cerradas.', 3).catch(() => {});
  return c.json({ ok: true });
});

app.post('/api/auth/totp/disable', async (c) => {
  const locked = loginLocked(c);
  if (locked) return locked;
  const user = String(c.get('user') || 'user');
  const body = await c.req.json<{ code?: string; password?: string }>().catch(() => ({} as { code?: string; password?: string }));
  if (!config.auth.totpSecret) return fail(c, 400, '2FA no está activado');
  if (!(await totpReauth(body))) {
    noteLoginFail(c, user);
    return fail(c, 401, 'Código o contraseña inválidos');
  }
  await updateConfigAuth(config, auth => { delete auth.totpSecret; delete auth.totpRecovery; });
  recordEvent('auth', `2FA desactivado por ${user}`);
  notify('2FA desactivado', 'El login vuelve a pedir solo usuario y contraseña.', 4).catch(() => {});
  return c.json({ ok: true });
});

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
  // A top-level GET must never mint a session — an authed attacker could
  // otherwise force-login a victim's browser with a bare <img>/link. The
  // session is created by the explicit same-origin POST below. The token is
  // consumed there, not here, so loading this page doesn't burn it.
  // `next` lands verbatim in page JS (it only ever feeds safePairTarget).
  const payload = JSON.stringify({ t, next: c.req.query('next') || '/' }).replace(/</g, '\\u003c');
  c.header('X-Frame-Options', 'DENY');
  return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#0b0e14;color:#e6e9ef;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>Vincular este dispositivo</h2><p style="opacity:.6">Se va a iniciar sesión en AXON desde este navegador.</p><button id="go" style="font:inherit;padding:.7rem 1.6rem;border-radius:10px;border:0;background:#3b82f6;color:#fff;cursor:pointer">Vincular</button><p id="err" style="color:#f87171"></p></div><script>var P=${payload},b=document.getElementById('go'),e=document.getElementById('err');b.onclick=async function(){b.disabled=true;try{var r=await fetch('/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(P)}),j=await r.json();if(j.ok){location.href=j.next||'/';return;}e.textContent=j.error||'No se pudo vincular';}catch(x){e.textContent='Sin conexión';}b.disabled=false};</script>`);
});

app.post('/pair', async (c) => {
  // Same-origin only — a cross-site form/fetch must not mint a session into
  // the victim's browser (forced-login CSRF works over POST too).
  if (!requestOriginAllowed(c.req.raw)) return fail(c, 403, 'El origen de esta acción no está permitido.');
  const body = await c.req.json<{ t?: string; next?: string }>().catch(() => ({} as { t?: string; next?: string }));
  const t = String(body.t || '');
  const exp = pairTokens.get(t);
  if (!t || !exp || Date.now() > exp) return fail(c, 410, 'Este link de vinculación venció o no es válido.');
  pairTokens.delete(t);
  const token = await createSession('paired-device');
  await recordSession(token, 'paired-device', c.req.header('user-agent') || '');
  setSessionCookie(c, token);
  // Optional in-app target after pairing (e.g. /p/4321/ for the embedded
  // browser) — same-origin paths only, never an open redirect.
  return c.json({ ok: true, next: safePairTarget(String(body.next || '/')) });
});

// ---------- Ports (core) ----------

app.get('/api/ports', async (c) => {
  try {
    const [processes, hosts] = await Promise.all([
      listPortProcesses(),
      getServerHosts().catch(() => []),
    ]);
    for (const p of processes) {
      p.domains = domainsForPorts(config.domains, p.ports, 'process');
      p.domain = p.domains[0];
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
  const plan = await killPlan(pid, config.domains);
  if (!plan) return fail(c, 404, 'El proceso ya no existe');
  return c.json({ ok: true, plan });
});

app.post('/api/ports/:pid/kill', async (c) => {
  const pid = parseInt(c.req.param('pid'), 10);
  const plan = await killPlan(pid, config.domains);
  if (!plan) return fail(c, 404, 'El proceso ya no existe');
  if (plan.blocked) return fail(c, 403, `No se puede cerrar: ${plan.blocked}`);
  const result = await killProcessTree(pid);
  if (!result.ok) return fail(c, 500, 'No se pudo cerrar el proceso', { detail: result.error });
  return c.json({ ok: true, killed: result.killed, skipped: result.skipped });
});

// Stop a systemd unit that supervises a process — the only way to really
// kill a service with Restart=always. Optionally disable it so it doesn't
// come back at next login/boot.
app.post('/api/systemd/stop', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const unit = String(body.unit || '');
  const scope = body.scope === 'system' ? 'system' : 'user';
  const disable = body.disable === true;
  // First char must be alphanumeric — a leading '-' reaches systemctl as a
  // getopt flag, not a unit name.
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@:-]*\.(service|socket|timer|scope)$/.test(unit)) {
    return fail(c, 400, 'Nombre de unidad inválido');
  }
  // Stopping container/network/ssh infrastructure takes down the host, every
  // container (Axon included) and/or the only way back in — refuse here.
  if (isCriticalUnit(unit)) {
    return fail(c, 403, 'Esa unidad es crítica para el sistema; no se puede detener desde Axon');
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

// ---------- Programs / updater ----------

app.get('/api/programs', async (c) => {
  const programs = await getPrograms(c.req.query('fresh') === '1');
  return c.json({ ok: true, programs, ...programsStatus() });
});

app.post('/api/programs/:id/install', async c => {
  try {
  const def = programById(c.req.param('id'));
  if (!def?.npmPkg || def.channel !== 'pnpm' || def.id === 'opencode' || !/^[@a-zA-Z0-9._/-]+$/.test(def.npmPkg)) return fail(c, 400, 'Este programa no tiene instalación gestionada');
  const active = listJobs().find(j => j.status === 'running' && (j.title === def.name || j.title === `Instalar ${def.name}`));
  if (active) return c.json({ ok: true, job: active });
  invalidateProgramsCache(); invalidateAgentsCache();
  const spec = await softwareInstallSpec(def.npmPkg);
  const cfg=await softwareConfig();const cmd=await softwareCommand({action:'install-global',user:HOST_USER,settings:cfg.contexts?.[HOST_USER]||{},spec});
  const job = runSoftwareJob(`Instalar ${def.name}`, [{ label: `Instalar y verificar ${def.npmPkg}`, cmd,displayCommand:'pnpm add -g '+spec,user:'root',group:'software:pnpm'}]);
  return c.json({ ok: true, job });
  }catch(e){return fail(c,409,(e as Error).message);}
});

app.get('/api/programs/installed', async c => c.json(await software.get()));

app.get('/api/programs/packages', async (c) => {
  const q = c.req.query('q') || '';
  const packages = await searchAptPackages(q);
  return c.json({ ok: true, packages });
});

app.post('/api/programs/:id/update', async c => {
  try {
    const body=await c.req.json().catch(()=>({}));if(body.review!==true)return fail(c,409,'Recargá AXON y revisá el plan desde Programas antes de actualizar');
    const snapshot=await software.settled(), id=c.req.param('id');
    const matches=snapshot.installations.filter(p=>p.id===id || p.integrationId===id);
    if(matches.length!==1)return fail(c,409,'Elegí la instalación y su gestor desde Programas');
    return c.json({ok:true,plan:await software.plan([matches[0].id])});
  }catch(e){return fail(c,409,(e as Error).message);}
});

app.post('/api/programs/:id/login', async (c) => {
  if (['codex', 'claude-code'].includes(c.req.param('id'))) return fail(c, 409, 'Elegí la cuenta en Agents → Cuenta → Conectar');
  const def = programById(c.req.param('id'));
  if (!def?.auth?.login) return fail(c, 400, 'Este programa no tiene login automatizable');
  const job = runJob(`Login ${def.name}`, def.auth.login.map((s) => ({ ...s, group: def.name })));
  return c.json({ ok: true, job });
});

app.post('/api/programs/:id/logout', async (c) => {
  if (['codex', 'claude-code'].includes(c.req.param('id'))) return fail(c, 409, 'Las cuentas se administran desde Agents → Cuenta');
  const def = programById(c.req.param('id'));
  if (!def?.auth?.logout) return fail(c, 400, 'Este programa no tiene logout automatizable');
  const job = runJob(`Logout ${def.name}`, def.auth.logout.map((s) => ({ ...s, group: def.name })));
  return c.json({ ok: true, job });
});

app.post('/api/programs/update-all', c => fail(c,409,'Recargá AXON y revisá las instalaciones seleccionadas desde Programas'));

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
  if (file) try {
    const buf = await readFile(file);
    const ext = file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.xpm') ? 'image/x-xpixmap' : 'image/png';
    return new Response(buf, { headers: { 'Content-Type': ext, 'Cache-Control': 'public, max-age=86400' } });
  } catch { /* The native icon may disappear between discovery and reading. */ }
  // Desktop icons are optional host resources. Use the same portable brand /
  // initials chain as discovered agents when an icon is absent or removed.
  // Filesystem paths and traversal inputs must never become brand lookups.
  if (/^[a-z0-9][a-z0-9._-]{0,150}$/i.test(name) && !name.includes('..'))
    return c.redirect('/api/brandicon/' + encodeURIComponent(name));
  return fail(c, 404, 'Icono no encontrado');
});

// ---------- Brand icon resolver ----------
// Generic logo lookup so arbitrary installed tools get an icon without us
// vendoring one per product. Order per candidate slug:
//   1. public/icons/<slug>.svg (vendored, always wins)
//   2. data/icons/<slug>.svg (previously fetched from the CDN)
//   3. host icon theme via resolveIcon() (.desktop Icon= names, e.g.
//      'com.visualstudio.code' → VS Code's pixmap)
//   4. cdn.simpleicons.org/<slug> → cached into data/icons/ for offline use
//   5. generated initials tile (never 404 — cards always render something)

const ICON_CACHE_DIR = path.join(
  path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),
  'icons'
);

// key → extra slugs to try first (name differs from the brand slug)
const BRAND_ALIASES: Record<string, string[]> = {
  'ai.opencode.desktop': ['opencode'],
  'devin-desktop': ['devin'],
  'claude-code': ['claudecode', 'claude'],
  'claude-desktop': ['claude'],
  codex: ['openai'],
  gemini: ['googlegemini'],
  copilot: ['githubcopilot'],
  vscode: ['com.visualstudio.code', 'code'],
  zed: ['zedindustries'],
  kimi: ['kimi'],
  'kimi-code': ['kimi'],
  node: ['nodedotjs'],
};

// Slugs where cdn.simpleicons.org resolves to a *different* brand's logo
// (fashion house Hermès, AMP the web framework, π …) — skip the CDN for these.
const WRONG_SLUGS = new Set([
  'hermes', 'amp', 'pi', 'factory', 'slate', 'grok', 'goose', 'aider',
  'commandcode', 'openclaude', 'openclaw', 'continue', 'zed',
]);

const brandIconNegCache = new Map<string, number>(); // slug → last 404 ts

const iconMime = (f: string) =>
  f.endsWith('.svg') ? 'image/svg+xml'
    : f.endsWith('.xpm') ? 'image/x-xpixmap'
    : f.endsWith('.webp') ? 'image/webp'
    : f.endsWith('.ico') ? 'image/x-icon'
    : /\.jpe?g$/.test(f) ? 'image/jpeg'
    : 'image/png';

app.get('/api/brandicon/:key', async (c) => {
  const key = c.req.param('key').replace(/^custom-/, '').toLowerCase();
  const slugs = [...(BRAND_ALIASES[key] ?? []), key];
  for (const raw of slugs) {
    const slug = raw.toLowerCase().replace(/[^a-z0-9.-]/g, '');
    if (!slug || slug.includes('..')) continue;
    // 1. vendored asset — redirect so it flows through the static handler
    if (existsSync(`public/icons/${slug}.svg`)) return c.redirect(`/icons/${slug}.svg`);
    // 2. CDN cache
    const cached = path.join(ICON_CACHE_DIR, `${slug}.svg`);
    try {
      if (existsSync(cached)) {
        return new Response(await readFile(cached), {
          headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
        });
      }
    } catch { /* fall through */ }
    // 3. host icon theme / .desktop icon name
    const host = await resolveIcon(slug);
    if (host) {
      try {
        return new Response(await readFile(host), {
          headers: { 'Content-Type': iconMime(host), 'Cache-Control': 'public, max-age=86400' },
        });
      } catch { /* fall through */ }
    }
    // 4. Simple Icons CDN (negative-cached for a day, skipped for wrong brands)
    if (!WRONG_SLUGS.has(slug) && (brandIconNegCache.get(slug) ?? 0) < Date.now() - 86_400_000) {
      try {
        const r = await fetch(`https://cdn.simpleicons.org/${slug}`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const svg = await r.text();
          if (svg.trimStart().startsWith('<svg')) {
            await mkdir(ICON_CACHE_DIR, { recursive: true });
            await writeFile(cached, svg, 'utf-8');
            return new Response(svg, {
              headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
            });
          }
        }
        if (r.status === 404) brandIconNegCache.set(slug, Date.now());
      } catch { /* offline — fall through to initials */ }
    }
  }

  // 5. initials tile — deterministic hue from the key, so it never 404s
  const words = key.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const initials = (words.map((w) => w[0]).slice(0, 2).join('') || '?').toUpperCase();
  const hue = [...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="hsl(${hue},45%,22%)"/>` +
    `<text x="32" y="42" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" ` +
    `font-size="26" font-weight="600" fill="hsl(${hue},80%,80%)">${initials}</text></svg>`;
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
  });
});

// ---------- Projects ----------

app.get('/api/projects', async (c) => {
  const projects = await refreshRunning();
  const enriched = projects.map((p) => ({
    ...p,
    installCmd: installCommand(p),
    domains: domainsForProject(config.domains, p),
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

const PROJECT_TYPES = new Set(['node', 'bun', 'python', 'rust', 'go', 'static', 'other']);
const PROJECT_PMS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

app.post('/api/projects', async (c) => {
  const body = await c.req.json<Partial<Project>>().catch(() => ({} as Partial<Project>));
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 128) {
    return fail(c, 400, 'Nombre de proyecto inválido');
  }
  if (typeof body.cwd !== 'string' || !body.cwd) {
    return fail(c, 400, 'Falta la carpeta del proyecto (cwd)');
  }
  if (body.command !== undefined && (typeof body.command !== 'string' || body.command.length > 2000)) {
    return fail(c, 400, 'Comando inválido');
  }
  if (body.port !== undefined && (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535)) {
    return fail(c, 400, 'Puerto inválido (1-65535)');
  }
  if (body.type !== undefined && !PROJECT_TYPES.has(body.type)) {
    return fail(c, 400, 'Tipo de proyecto inválido');
  }
  if (body.packageManager !== undefined && !PROJECT_PMS.has(body.packageManager)) {
    return fail(c, 400, 'Gestor de paquetes inválido');
  }
  if (body.framework !== undefined && (typeof body.framework !== 'string' || body.framework.length > 64)) {
    return fail(c, 400, 'Framework inválido');
  }
  try {
    body.cwd = await resolveHostPath(body.cwd, { directory: true });
  } catch (e) {
    if (e instanceof MaintenanceError) return e.getResponse();
    return fail(c, 400, 'No se pudo validar la carpeta del proyecto');
  }
  const existing = body.id ? getProjectById(body.id) : undefined;
  // Exempt ids that already exist: a legacy/manual id (hand-edited config or
  // pre-validation API) must stay editable — the XSS vector is closed at
  // render, and a *new* non-conforming id is still rejected.
  if (body.id !== undefined && !existing && (typeof body.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(body.id))) {
    return fail(c, 400, 'ID de proyecto inválido');
  }
  // Editing without a field must PRESERVE it — the UI posts the form as-is,
  // so absent keys would otherwise wipe detected type/framework/pm.
  const project: Project = {
    id: existing?.id || body.id || crypto.randomUUID(),
    name: body.name.trim(),
    cwd: body.cwd,
    command: body.command ?? existing?.command,
    packageManager: body.packageManager ?? existing?.packageManager,
    type: body.type ?? existing?.type ?? 'other',
    framework: body.framework ?? existing?.framework,
    port: body.port ?? existing?.port,
    autoDetect: existing?.autoDetect ?? false,
    running: existing?.running,
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
  try {
    await resolveHostPath(project.cwd, { directory: true });
  } catch (e) {
    if (e instanceof MaintenanceError) return e.getResponse();
    return fail(c, 400, 'No se pudo validar la carpeta del proyecto');
  }
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
  // daemonError distinguishes "daemon caído" de "sin contenedores" —
  // listContainers returns [] in both cases otherwise.
  return c.json({ ok: true, containers, daemonError: dockerDaemonError() });
});

app.post('/api/docker/:id/stop', async (c) => {
  const held = await composeOpsGuard();
  if (held) return fail(c, 409, held);
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
  const lines = await containerLogs(c.req.param('id'), parseInt(c.req.query('tail') || '200', 10));
  return c.json({ ok: true, lines });
});

// ---------- Domains (unchanged Cloudflare logic) ----------

// Strict DNS label: lowercase alnum + interior hyphens, ≤63 chars. Never
// silently "clean" user input — reject it so typos surface as errors.
const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
function parseSubdomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return SUBDOMAIN_RE.test(s) ? s : null;
}
function parseDomainPort(raw: unknown): number | null {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}
// `scheme` lets the caller state the protocol explicitly; without it we keep
// the historical port heuristic (443/8443/9090/9443 → https).
function domainTargetFor(port: number, scheme?: unknown): string {
  const proto = scheme === 'http' || scheme === 'https' ? scheme
    : [443, 8443, 9090, 9443].includes(port) ? 'https' : 'http';
  return `${proto}://localhost:${port}`;
}

app.get('/api/domains', async (c) => c.json({ ok: true, domains: config.domains }));

// Probe every domain publicly and, when it's down, diagnose why: stopped
// process, deleted project, stopped container, or a tunnel routing problem.
// Each probe is a public HTTPS fetch (up to 7s), so results are cached
// briefly — a stale hit returns instantly and recomputes in the background.
let domainStatusCache: { at: number; statuses: Record<string, DomainStatus> } | null = null;
let domainStatusInflight: Promise<Record<string, DomainStatus>> | null = null;
const DOMAIN_STATUS_TTL_MS = 30_000;
const DOMAIN_STATUS_STALE_MS = 5 * 60_000;

async function computeDomainStatuses(): Promise<Record<string, DomainStatus>> {
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
  return Object.fromEntries(statuses);
}

function refreshDomainStatuses(): Promise<Record<string, DomainStatus>> {
  if (!domainStatusInflight) {
    domainStatusInflight = computeDomainStatuses()
      .then((statuses) => {
        domainStatusCache = { at: Date.now(), statuses };
        return statuses;
      })
      .finally(() => {
        domainStatusInflight = null;
      });
  }
  return domainStatusInflight;
}

app.get('/api/domains/status', async (c) => {
  const fresh = c.req.query('fresh') === '1';
  if (!fresh && domainStatusCache) {
    const age = Date.now() - domainStatusCache.at;
    if (age < DOMAIN_STATUS_TTL_MS) return c.json({ ok: true, statuses: domainStatusCache.statuses });
    if (age < DOMAIN_STATUS_STALE_MS) {
      refreshDomainStatuses().catch(() => {});
      return c.json({ ok: true, statuses: domainStatusCache.statuses });
    }
  }
  const statuses = await refreshDomainStatuses();
  return c.json({ ok: true, statuses });
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
      const url = d.target.startsWith('http') ? d.target : `http://localhost:${d.port}`;
      // Local HTTPS services almost always run self-signed certs — without
      // tolerating them the probe reports "no responde HTTP" for a service
      // that is perfectly alive.
      const r = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(3000),
        ...(url.startsWith('https:') ? { tls: { rejectUnauthorized: false } } : {}),
      } as RequestInit);
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
  if (!cloudflareConfigured()) {
    return fail(c, 503, 'Cloudflare no está configurado — faltan credenciales o ids de zona/túnel');
  }
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
      id: crypto.randomUUID(),
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
  domainStatusCache = null;
  return c.json({ ok: true, imported, skipped, blocked });
});

app.post('/api/domains', async (c) => {
  if (!cloudflareConfigured()) {
    return fail(c, 503, 'Cloudflare no está configurado — faltan credenciales o ids de zona/túnel');
  }
  const body = await c.req.json<{
    subdomain?: string; port?: number; processType?: 'process' | 'docker'; projectName?: string; scheme?: string;
  }>().catch(() => ({}) as { subdomain?: string; port?: number; processType?: 'process' | 'docker'; projectName?: string; scheme?: string });
  const clean = parseSubdomain(body.subdomain);
  if (!clean) {
    return fail(c, 400, 'Subdominio inválido — solo letras minúsculas, números y guiones interiores (máx. 63 caracteres)');
  }
  const port = parseDomainPort(body.port);
  if (!port) return fail(c, 400, 'Puerto inválido (entero entre 1 y 65535)');
  if (body.processType !== 'process' && body.processType !== 'docker') {
    return fail(c, 400, 'processType inválido ("process" o "docker")');
  }
  if (body.projectName !== undefined && (typeof body.projectName !== 'string' || body.projectName.length > 128)) {
    return fail(c, 400, 'projectName inválido');
  }
  if (body.scheme !== undefined && body.scheme !== 'http' && body.scheme !== 'https') {
    return fail(c, 400, 'scheme inválido ("http" o "https")');
  }
  const fullDomain = `${clean}.${BASE_DOMAIN}`;
  if (config.domains.some((d) => d.fullDomain === fullDomain)) {
    return fail(c, 409, 'Ese dominio ya está asignado');
  }
  if ((await listDnsRecords(fullDomain)).length > 0) {
    return fail(c, 409, 'El registro DNS ya existe en Cloudflare');
  }
  const target = domainTargetFor(port, body.scheme);
  const dns = await createDnsRecord(fullDomain);
  if (!dns.success) return fail(c, 500, 'Falló crear el DNS en Cloudflare', { detail: dns.error });

  const domain: DomainMapping = {
    id: crypto.randomUUID(),
    subdomain: clean,
    fullDomain,
    target,
    port,
    projectName: body.projectName || '',
    processType: body.processType,
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
  domainStatusCache = null;
  return c.json({ ok: true, domain });
});

app.put('/api/domains/:id', async (c) => {
  const domain = config.domains.find((d) => d.id === c.req.param('id'));
  if (!domain) return fail(c, 404, 'Dominio no encontrado');
  const body = await c.req.json<{
    subdomain?: string; port?: number; processType?: 'process' | 'docker'; projectName?: string; scheme?: string;
  }>().catch(() => ({}) as { subdomain?: string; port?: number; processType?: 'process' | 'docker'; projectName?: string; scheme?: string });
  if (body.subdomain !== undefined && parseSubdomain(body.subdomain) === null) {
    return fail(c, 400, 'Subdominio inválido — solo letras minúsculas, números y guiones interiores (máx. 63 caracteres)');
  }
  const clean = body.subdomain !== undefined ? parseSubdomain(body.subdomain)! : domain.subdomain;
  const parsedPort = body.port !== undefined ? parseDomainPort(body.port) : undefined;
  if (body.port !== undefined && parsedPort === undefined) {
    return fail(c, 400, 'Puerto inválido (entero entre 1 y 65535)');
  }
  if (body.processType !== undefined && body.processType !== 'process' && body.processType !== 'docker') {
    return fail(c, 400, 'processType inválido ("process" o "docker")');
  }
  if (body.projectName !== undefined && (typeof body.projectName !== 'string' || body.projectName.length > 128)) {
    return fail(c, 400, 'projectName inválido');
  }
  if (body.scheme !== undefined && body.scheme !== 'http' && body.scheme !== 'https') {
    return fail(c, 400, 'scheme inválido ("http" o "https")');
  }
  const newFullDomain = `${clean}.${BASE_DOMAIN}`;
  if (config.domains.some((d) => d.id !== domain.id && d.fullDomain === newFullDomain)) {
    return fail(c, 409, 'Ese dominio ya está asignado');
  }
  // Any target-affecting field must rebuild the ingress URL — port alone,
  // or an explicit scheme override.
  const targetChanges = body.port !== undefined || body.scheme !== undefined;
  const nextTarget = targetChanges ? domainTargetFor(parsedPort ?? domain.port, body.scheme) : domain.target;
  const domainChanges = newFullDomain !== domain.fullDomain;
  const metaChanges =
    (body.processType !== undefined && body.processType !== domain.processType) ||
    (body.projectName !== undefined && body.projectName !== domain.projectName) ||
    (targetChanges && nextTarget !== domain.target);
  if (!domainChanges && !metaChanges) return c.json({ ok: true, domain });
  // projectName/processType only affect Axon-side association — the tunnel
  // ingress cares about hostname + target. Skip the sync (and its rollback
  // machinery) when nothing Cloudflare-facing moved.
  const needsSync = domainChanges || nextTarget !== domain.target;
  if (needsSync && !cloudflareConfigured()) {
    return fail(c, 503, 'Cloudflare no está configurado — faltan credenciales o ids de zona/túnel');
  }

  const old = { ...domain };
  let created: { success: boolean; recordId?: string; error?: string } = { success: true };
  if (domainChanges) {
    if ((await listDnsRecords(newFullDomain)).length > 0) {
      return fail(c, 409, 'El registro DNS ya existe en Cloudflare');
    }
    created = await createDnsRecord(newFullDomain);
    if (!created.success) return fail(c, 500, 'Falló crear el DNS', { detail: created.error });
    if (old.dnsRecordId) {
      const deleted = await deleteDnsRecord(old.dnsRecordId);
      if (!deleted.success) {
        if (created.recordId) await deleteDnsRecord(created.recordId);
        return fail(c, 500, 'Falló borrar el DNS viejo', { detail: deleted.error });
      }
    }
  }
  domain.subdomain = clean;
  domain.fullDomain = newFullDomain;
  if (domainChanges) domain.dnsRecordId = created.recordId;
  if (parsedPort !== undefined) domain.port = parsedPort;
  if (body.processType !== undefined) domain.processType = body.processType;
  if (body.projectName !== undefined) domain.projectName = body.projectName;
  if (targetChanges) domain.target = nextTarget;
  await saveConfig(config);
  if (!needsSync) {
    domainStatusCache = null;
    return c.json({ ok: true, domain });
  }

  const sync = await syncCloudflaredRoutes(config.domains);
  if (!sync.success) {
    domain.subdomain = old.subdomain;
    domain.fullDomain = old.fullDomain;
    domain.dnsRecordId = old.dnsRecordId;
    domain.port = old.port;
    domain.processType = old.processType;
    domain.projectName = old.projectName;
    domain.target = old.target;
    await saveConfig(config);
    if (domainChanges && old.dnsRecordId) {
      const recreated = await createDnsRecord(old.fullDomain);
      if (recreated.success && recreated.recordId) {
        domain.dnsRecordId = recreated.recordId;
        await saveConfig(config);
      }
    }
    if (created.recordId) await deleteDnsRecord(created.recordId);
    return fail(c, 500, 'Falló sincronizar el túnel', { detail: sync.error });
  }
  domainStatusCache = null;
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
  domainStatusCache = null;
  return c.json({ ok: true });
});

// Bulk delete: one tunnel sync for N domains instead of N syncs.
app.post('/api/domains/bulk-delete', async (c) => {
  const body = await c.req.json<{ ids?: string[] }>().catch(() => ({} as { ids?: string[] }));
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
  domainStatusCache = null;
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
  // El webhook embebe tokens de Discord/Gotify — al cliente llega enmascarado;
  // para reescribirlo hay que mandar la URL completa nueva.
  const settings = { ...rest.settings, notifyUrl: maskWebhookUrl(rest.settings?.notifyUrl || '') };
  return c.json({ ok: true, config: { ...rest, settings, auth: { username: auth.username, totpEnabled: !!auth.totpSecret } } });
});

let settingsWrite: Promise<unknown> = Promise.resolve();
app.put('/api/config', async (c) => {
  let body: Partial<AppConfig['settings']>;
  try { body = validateSettings(await c.req.json(), config.settings); } catch (e) { return fail(c, 400, (e as Error).message); }
  const operation = settingsWrite.catch(() => {}).then(async () => {
    const settings = { ...config.settings, ...body };
    await saveConfig({ ...config, settings });
    config.settings = settings;
    configurePorts(settings);
    setHostUser(settings.hostUser);
    software.invalidate(); invalidateStoreCache();
    invalidateProgramsCache(); invalidateAgentsCache();
    setNotifyUrl(settings.notifyUrl, settings.notifyProvider);
    return { ...settings, notifyUrl: maskWebhookUrl(settings.notifyUrl || '') };
  });
  settingsWrite = operation;
  return c.json({ ok: true, settings: await operation });
});

app.post('/api/notifications/test', async c => {
  if (!notifyConfigured()) return fail(c, 400, 'Guardá un webhook antes de probarlo');
  try { await notify('Axon — prueba de notificaciones', 'El webhook está funcionando.', 3, true); }
  catch (e) { return fail(c, 502, (e as Error).message); }
  return c.json({ ok: true, message: 'El destino aceptó la notificación de prueba.' });
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
    const kl = k.toLowerCase();
    if (HOP_BY_HOP.has(kl) || kl === 'host' || kl === 'authorization' || kl === 'cookie') continue;
    headers.set(k, v);
  }
  // Rebuild Cookie without axon_session — the 7-day admin token must never
  // reach an arbitrary loopback service. The app's own cookies (scoped to
  // Path=/p/N on the way out) still pass through.
  const cookie = (c.req.header('cookie') || '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !/^axon_session\s*=/.test(p))
    .join('; ');
  if (cookie) headers.set('cookie', cookie);
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
  // don't leak into the dashboard API or sibling /p/N/ apps. A forged
  // `axon_session` cookie would sort ahead of the real one on its prefix —
  // drop it (self-DoS otherwise).
  for (const sc of upstream.headers.getSetCookie?.() ?? []) {
    if (/^axon_session\s*=/i.test(sc)) continue;
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

// Static assets must not be served stale — index.html/app.js change on every
// deploy. Explicit per-route Cache-Control wins; these defaults only cover
// the statics that set none (brand assets, fonts, manifest).
app.use('/*', async (c, next) => {
  await next();
  if (c.res.headers.has('Cache-Control')) return;
  const p = c.req.path;
  if (p === '/' || p.endsWith('.html')) {
    c.header('Cache-Control', 'private, no-store');
  } else if (p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.webmanifest')) {
    c.header('Cache-Control', 'no-store');
  } else if (p.startsWith('/icons/') || p.startsWith('/marca/') || p.startsWith('/fonts/') || p.includes('/vendor/')) {
    c.header('Cache-Control', 'public, max-age=86400');
  }
  if (p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.webmanifest')) {
    c.header('CDN-Cache-Control', 'no-store');
    c.header('Cloudflare-CDN-Cache-Control', 'no-store');
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
  // The store keeps ~1440 ticks (~36h) per domain; the UI only ever renders
  // the last 48. Ship a window, not the whole history, per poll.
  const max = Math.min(1440, Math.max(1, parseInt(c.req.query('ticks') || '288', 10) || 288));
  const beats = allHeartbeats();
  const heartbeats: Record<string, typeof beats[string]> = {};
  const uptime: Record<string, number | null> = {};
  for (const [id, arr] of Object.entries(beats)) {
    heartbeats[id] = arr.slice(-max);
    uptime[id] = uptimePct(id);
  }
  return c.json({ ok: true, heartbeats, uptime });
});

// ---------- Remote power ----------

app.post('/api/system/power', async (c) => {
  const body = await c.req.json<{ action?: string; confirm?: string }>().catch(() => ({} as { action?: string; confirm?: string }));
  const action = body.action;
  if (action !== 'reboot' && action !== 'poweroff') return fail(c, 400, 'Acción inválida');
  const want = action === 'reboot' ? 'REINICIAR' : 'APAGAR';
  if (body.confirm !== want) return fail(c, 400, `Escribí ${want} para confirmar`);
  // Schedule a few seconds out so the HTTP response reaches the client.
  const cmd = action === 'reboot' ? 'reboot' : 'poweroff';
  await hostExec(`nohup bash -c 'sleep 3; systemctl ${cmd}' >/dev/null 2>&1 &`, { user: 'root', timeoutMs: 5000 });
  notify('AXON — Servidor', `Se programó ${action === 'reboot' ? 'un reinicio' : 'un apagado'} en 3 segundos`, 5).catch(() => {});
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
Description=axon-${name} (creado desde AXON)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${sdQuote(cwd)}
ExecStart=${argv.map(sdQuote).join(' ')}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

app.post('/api/systemd/create-service', async (c) => {
  const body = await c.req.json<{ pid?: number; name?: string }>().catch(() => ({} as { pid?: number; name?: string }));
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
  // A newline in argv/cwd would inject extra unit directives past ExecStart.
  if (argv.some((a) => /[\r\n]/.test(a)) || /[\r\n]/.test(cwd)) {
    return fail(c, 400, 'El comando del proceso contiene caracteres que no pueden ir en una unidad systemd');
  }

  const unit = buildUnit(name, argv, cwd);
  // The written unit needs the real argv; the API echo masks credentials the
  // same way `command` does — mask the elements BEFORE quoting, or the
  // sdQuote quotes hide every '-' flag from the masker.
  const shownUnit = unit.replace(/^ExecStart=.*$/m, () => `ExecStart=${maskArgv(argv).map(sdQuote).join(' ')}`);

  const b64 = Buffer.from(unit, 'utf-8').toString('base64');
  const dir = 'mkdir -p ~/.config/systemd/user';
  const write = `${dir} && echo '${b64}' | base64 -d > ~/.config/systemd/user/pm-${name}.service`;
  const enable = `systemctl --user daemon-reload && systemctl --user enable --now pm-${name}.service`;
  const res = await hostExec(`${write} && ${enable}`, { user: 'user', timeoutMs: 30_000 });
  if (!res.ok) {
    return fail(c, 500, 'Falló crear/habilitar el servicio', { detail: (res.stderr || res.stdout).slice(0, 2000), unit: shownUnit });
  }
  return c.json({ ok: true, service: `pm-${name}.service`, unit: shownUnit, cwd, command: maskCmd(argv.join(' ')) });
});

// Preview of the unit that would be generated — no writes.
app.post('/api/systemd/preview-service', async (c) => {
  const body = await c.req.json<{ pid?: number; name?: string }>().catch(() => ({} as { pid?: number; name?: string }));
  const pid = Number(body.pid);
  if (!pid || pid <= 1) return fail(c, 400, 'PID inválido');
  const [cmdlineRaw, cwdRes] = await Promise.all([
    readFile(`/proc/${pid}/cmdline`, 'utf-8').catch(() => null),
    hostExec(`readlink /proc/${pid}/cwd`, { user: 'root', timeoutMs: 5000 }),
  ]);
  if (!cmdlineRaw) return fail(c, 404, `Proceso ${pid} no encontrado`);
  const argv = cmdlineRaw.split('\0').filter(Boolean);
  const cwd = cwdRes.ok ? cwdRes.stdout.trim() : '';
  if (argv.some((a) => /[\r\n]/.test(a)) || /[\r\n]/.test(cwd)) {
    return fail(c, 400, 'El comando del proceso contiene caracteres que no pueden ir en una unidad systemd');
  }
  const name = String(body.name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  const unit = buildUnit(name || 'servicio', argv, cwd || '/')
    .replace(/^ExecStart=.*$/m, () => `ExecStart=${maskArgv(argv).map(sdQuote).join(' ')}`);
  return c.json({ ok: true, unit, cwd, command: maskCmd(argv.join(' ')), suggested: `pm-${name || 'servicio'}.service` });
});

// ---------- Feature modules (self-contained, wired here) ----------
const maintenanceRepo = new MaintenanceRepository(path.join(path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'), 'maintenance'));
const fileOperations = new FileOperations(maintenanceRepo, maintenanceQaRoot ? async()=>maintenanceQaRoot : fileHostHome);
if(!maintenanceQaRoot)fileOperations.onVolumes(async()=> (await hostVolumes.snapshot()).volumes.filter(v=>v.path&&v.readable).map(v=>({path:v.path!,mountId:v.mountId})));
fileOperations.onChanged(async(action,from,to)=>{
  if(action==='purge'){recordEvent('file','Borrado definitivo verificado','Elemento retirado de la papelera; irreversible');return;}
  await libraryFileOperation(action,from,to);recordEvent('file',action==='send'?'Elemento enviado a papelera':'Elemento restaurado','Operación verificada; no implica espacio liberado');});
const fileTransfers=new FileTransfers(maintenanceRepo,maintenanceQaRoot?async()=>maintenanceQaRoot:fileHostHome);
fileTransfers.onValidate(async(mode,from,to)=>{
  if(maintenanceQaRoot&&(![from,to].every(p=>p.startsWith(maintenanceQaRoot+'/'))))throw new MaintenanceError('QA: transferencia fuera de la fixture',403);
  // Transfers never touch trash zones: trashed items leave via Restaurar and
  // are removed via Borrar definitivamente — both keep metadata and receipts
  // consistent. Moving in/out by transfer would orphan .trashinfo entries.
  const dirs=(await fileOperations.list()).dirs||[];
  const inZone=(p:string)=>dirs.some(d=>{const base=d.endsWith('/files')?path.posix.dirname(d):d;return p===base||p.startsWith(base+'/');});
  if(inZone(from)||inZone(to))throw new MaintenanceError('Los elementos de papelera se gestionan con Restaurar o Borrar definitivamente; no entran ni salen por transferencias.');
});
fileTransfers.onReview(async(mode,from,to)=>{
  const review=await libraryTransferReview(mode,from,to);if(!review)return;
  const references=[
    ...getProjects().map(p=>({title:`Proyecto: ${p.name}`,path:p.cwd,tree:true,detail:'El proyecto seguirá configurado con la ruta de origen. Moverlo puede impedir iniciarlo o abrir su terminal; actualizá su carpeta en Proyectos después del movimiento.'})),
    ...config.settings.scanDirs.map(p=>({title:'Búsqueda de proyectos',path:p,detail:'La búsqueda automática seguirá usando el origen. Actualizá esta carpeta en Configuración después del movimiento.'})),
    ...Object.keys(config.composeNotes||{}).map(p=>({title:'Compose con notas guardadas',path:p,detail:'Las notas guardadas seguirán asociadas al archivo de origen. Los servicios que usan rutas de este Compose pueden necesitar ajustes.'})),
    ...agentPathReferences(),...dropPathReferences(),
    ...platformBackups.policies().flatMap(p=>[...platformBackups.sources(p).map(source=>({title:`Backup: ${p.name} · origen`,path:source,tree:true,detail:'El backup seguirá buscando la carpeta configurada. Actualizá su origen después del movimiento.'})),...platformBackups.targets(p).filter(t=>t.path).map(t=>({title:`Backup: ${p.name} · ${t.label}`,path:t.path,tree:true,detail:'Este destino contiene copias de seguridad. Conservar su ubicación permite recuperar las versiones anteriores.'}))])
  ];
  return includeConfiguredReferences(review,from,to,references);
});
fileOperations.onBeforeWrite(()=>fileTransfers.reconcilePending());
setInterval(()=>{void fileTransfers.reconcilePending().catch(()=>{});},5000).unref();
fileTransfers.onChanged(async(mode,from,to,review)=>{await libraryFileOperation(mode,from,to,review);recordEvent('file',mode==='move'?'Movimiento verificado':'Copia verificada','Operación durable; no implica ahorro de disco');});
registerFilesRoutes(app, fileOperations,fileTransfers,maintenanceQaRoot||undefined);
registerCloudRoutes(app, platformStore, cloudVaultDir, cloudProviders, cloudAgents);
registerEventRoutes(app);
registerAlertRoutes(app);
registerScriptRoutes(app);
registerLogsRoutes(app);
registerMetricsRoutes(app);
registerDropRoutes(app);
registerLibraryRoutes(app,fileTransfers);
registerSessionRoutes(app);
registerOnboardingRoutes(app, onboardingDeps);
registerOpsRoutes(app);
registerOptimizerRoutes(app, async () => config, () => composeOpsGuard());
// Locks are retained by design for interrupted releases pending reconcile —
// mutating mid-release could invalidate a pending rollback — so the block
// still applies, but the message must reflect the actual state. A 'running'
// record older than any plausible apply means the worker died and nobody
// polled /api/compose/releases to settle it — reconcile now instead of
// blocking docker ops forever on a dead record.
const composeOpsGuard = async (): Promise<string | null> => {
  const ops = maintenanceRepo.lockedOperations('compose-release');
  for (const id of ops) {
    const rec = maintenanceRepo.get<{ state?: string; runningAt?: number; actorId?: string; sessionId?: string }>('compose-release', id);
    if (!rec || (rec.state !== 'running' && rec.state !== 'planned')) continue;
    if (!maintenanceQaRoot && rec.state === 'running' && (!rec.runningAt || Date.now() - rec.runningAt > 10 * 60_000) && rec.actorId) {
      await composeReleases.status(id, { actorId: rec.actorId, sessionId: rec.sessionId || '' }).catch(() => null);
      const after = maintenanceRepo.get<{ state?: string }>('compose-release', id);
      if (!after || (after.state !== 'running' && after.state !== 'planned')) continue;
    }
    return 'Hay una actualización de compose en curso; esperá a que termine';
  }
  return ops.length
    ? 'Hay una actualización de compose interrumpida — reconciliá o revertí desde la sección Compose antes de operar'
    : null;
};
registerDockerOpsRoutes(app, composeOpsGuard);
registerAgentRoutes(app);
registerAgentAccounts(app, maintenanceQaRoot ? async () => maintenanceQaRoot : fileHostHome, () => { invalidateProgramsCache(); invalidateAgentsCache(); });
registerAgentUsage(app, maintenanceQaRoot ? async () => maintenanceQaRoot : fileHostHome);
registerAgentConsumption(app, maintenanceQaRoot ? async () => maintenanceQaRoot : fileHostHome);
registerSoftwareRoutes(app);
registerStoreRoutes(app);
const hostCleaner = maintenanceQaRoot?new HostCleaner(async()=>maintenanceQaRoot,async()=>({complete:true,references:[],tools:[],unknownProcesses:0,examined:0,elapsedMs:0}),undefined,maintenanceQaRoot):new HostCleaner(fileHostHome);
const storageService = new StorageService(maintenanceRepo, () => maintenanceQaRoot ? Promise.resolve([{id:'qa-cache',path:path.join(maintenanceQaRoot,'scan-fixture'),title:'Caché de prueba aislada',adapterId:'packages'}]) : scanRoots(config.projects), scanRoot,undefined,hostCleaner);
fileOperations.useCleaner(hostCleaner);
registerStorageRoutes(app, storageService, fileOperations);
registerHomeLinkRoutes(app, new HomeLinks(maintenanceRepo), () => knownHomeLinks(config.domains,allHeartbeats()));
const installations = maintenanceQaRoot ? async () => ['homepage','filebrowser','portainer'].map(name => ({id:'qa-'+name,name,backend:'docker',scope:'fixture',version:'fixture',executablePath:null,coverage:'Fixture de QA; no es una instalación real',references:[],container:{id:'qa-'+name,project:'qa-isolated',service:name,state:'fixture',mounts:[{source:maintenanceQaRoot,destination:'/data',type:'bind'}],configFiles:[],image:name+':fixture'},blockers:['Fixture: ninguna retirada autorizada']})) : async () => [...await physicalInstallations(await getPrograms()), ...await dockerInstallations()];
const composeDrafts=new ComposeDrafts(maintenanceRepo),composeReleases=new ComposeReleases(maintenanceRepo,composeDrafts,fileHostHome);
const migrationService=new Migrations(maintenanceRepo,installations);
registerMigrationRoutes(app,migrationService,installations,maintenanceQaRoot?undefined:new HomepageMigration(migrationService,new HomeLinks(maintenanceRepo)),maintenanceQaRoot?undefined:new MigrationRetirement(migrationService,composeDrafts,composeReleases));
registerComposeRoutes(app, {
  drafts: composeDrafts,
  releases: maintenanceQaRoot?undefined:composeReleases,
  busyGuard: composeOpsGuard,
  getNotes: () => config.composeNotes,
  setNote: async (key, note) => {
    config.composeNotes = { ...(config.composeNotes || {}), [key]: note };
    if (!note) delete config.composeNotes[key];
    await saveConfig(config);
  },
});

// Open a URL inside the embedded server-side Chromium via its CDP endpoint.
// The jlesage image publishes remote debugging on 127.0.0.1:9222 when
// CHROMIUM_REMOTE_DEBUGGING=1 — this only opens tabs in the running session.
app.get('/api/browser/status', async c => {
  if (maintenanceQaRoot) return c.json({ok:true,available:false,fixture:true});
  const response = await fetch('http://127.0.0.1:5800/', {signal:AbortSignal.timeout(4000)}).catch(() => null);
  await response?.body?.cancel().catch(() => {});
  return c.json({ok:true, available:!!response?.ok});
});
app.post('/api/browser/open', async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => ({} as { url?: string }));
  const raw = (body.url || '').trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return fail(c, 400, 'URL inválida');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return fail(c, 400, 'Solo se pueden abrir URLs http/https');
  }
  // The embedded Chromium shares the host network (network_mode: host), so
  // localhost URLs resolve to the server's own services directly.
  const res = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(u.toString())}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res || !res.ok) {
    return fail(c, 502, 'El navegador del servidor no responde', {
      detail: res ? `CDP ${res.status}` : 'sin conexión a 127.0.0.1:9222',
    });
  }
  // json/new opens the target in the background — activate it so the VNC
  // display switches to the new tab, otherwise it looks like nothing happened.
  const target = (await res.json().catch(() => ({}))) as { id?: string };
  if (target.id) {
    await fetch(`http://127.0.0.1:9222/json/activate/${target.id}`, {
      method: 'PUT',
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
  return c.json({ ok: true });
});

startAlertLoop();
startScriptScheduler();
startDropSweeper();
if (!maintenanceQaRoot) platformBackups.scheduler();

// Warm the expensive caches in the background so the first Programs/Agents
// page load doesn't pay the full host-scan cost.
setJobCompletionHook(() => { software.invalidate(); invalidateStoreCache(); invalidateProgramsCache(); invalidateAgentsCache(); warmProgramsCache(); });
warmProgramsCache();
listAgents().catch(() => {});

// A fresh deploy replaces this process — drop the edge-cached copies of the
// panel's assets so Cloudflare can't serve the previous build to reloads
// that land mid-restart. Non-fatal: the app works without CF credentials.
{
  try {
    const origin = process.env.AXON_PUBLIC_ORIGIN;
    if (origin) {
      const host = new URL(origin).host;
      purgeCachePrefixes([`${host}/`]).then((r) => { if (!r.success) console.warn('Cloudflare cache purge:', r.error); }).catch(() => {});
    }
  } catch { /* malformed origin — purge is best-effort */ }
}

registerNavigationRoutes(app);
app.get('/*', serveStatic({ root: './public' }));

app.onError((err, c) => {
  if (err instanceof MaintenanceError) return err.getResponse();
  if (/^\/api\/(storage|maintenance|home|compose|files\/trash)(?:\/|$)/.test(c.req.path)) {
    c.header('Cache-Control', 'private, no-store');
    return c.json({ok:false,error:'La operación no se pudo completar. Revisá el historial antes de reintentar.'},503);
  }
  console.error('Unhandled error:', err);
  // No detail to the client — String(err) can carry internal paths or
  // command output, and pre-auth routes hit this handler too.
  return fail(c, 500, 'Error interno');
});

// ---------- Embedded terminal ----------
// /ws/term — authenticated WebSocket that bridges to a host tmux session via
// `script` (provides the PTY). The tmux session 'axon-term' persists across
// browser refreshes and reconnects.

// Cerrar una pestaña mata su sesión tmux — sin esto quedan axon-term-*
// huérfanas acumulándose. Solo nombres con el prefijo propio: no tocar
// sesiones tmux ajenas al panel.
app.delete('/api/term/:name', async (c) => {
  const name = (c.req.param('name') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  if (!name || !name.startsWith('axon-term')) return fail(c, 400, 'Sesión inválida');
  const res = await hostExec(`tmux kill-session -t ${shq(name)}`, { user: 'user', timeoutMs: 8000 });
  if (!res.ok) {
    if (/can't find session|no server running/i.test(res.stderr || '')) return c.json({ ok: true });
    return fail(c, 500, 'No se pudo cerrar la sesión de terminal');
  }
  recordEvent('system', `Terminal ${name} cerrada`);
  return c.json({ ok: true });
});
interface WsProxyData { kind: 'proxy'; upstream: WebSocket; pendingClient: unknown[]; pendingServer: unknown[]; ws: Bun.ServerWebSocket<WsData> | null }
interface WsTermData { kind: 'term'; proc?: ReturnType<typeof Bun.spawn>; session?: string; exec?: string; cols?: number; rows?: number; marker?: string }
type WsData = WsProxyData | WsTermData | LogsWsData;

// Auth state for upgraded sockets — the token is verified at upgrade time,
// but a revoked/expired session must not keep a live terminal/log stream.
// A periodic re-check closes the socket within ~30s of revocation, and each
// inbound frame re-checks the cheap denylist synchronously.
interface WsCred { token: string; sid: string | null; timer?: ReturnType<typeof setInterval> }
const wsCredentials = new WeakMap<WsData, WsCred>();
const WS_REVALIDATE_MS = 30_000;

function armWsRevalidation(ws: Bun.ServerWebSocket<WsData>): void {
  const cred = wsCredentials.get(ws.data);
  if (!cred) return;
  cred.timer = setInterval(async () => {
    try {
      const dead = (cred.sid ? isRevoked(cred.sid) : false) || !(await verifySessionToken(cred.token));
      if (dead) {
        try { ws.close(4401, 'Sesión expirada o revocada'); } catch { /* closed */ }
      }
    } catch { /* transient verify failure — keep the socket */ }
  }, WS_REVALIDATE_MS);
  cred.timer.unref?.();
}

function wsStillAuthed(data: WsData): boolean {
  const cred = wsCredentials.get(data);
  return !cred || !cred.sid || !isRevoked(cred.sid);
}

function startTermSocket(ws: Bun.ServerWebSocket<WsData>): void {
  const t = ws.data as WsTermData;
  const cols = t.cols || 120;
  const rows = t.rows || 40;
  const session = t.session || 'axon-term';
  // exec mode: `docker exec -it` into a container instead of a tmux session.
  // No persistence — the shell dies with the WS. `script` still provides the
  // local PTY (docker -t allocates the container-side one); COLUMNS/LINES are
  // a best-effort hint for the container's initial winsize.
  const cmd = hostTerminalCommand({ session, cols, rows, exec: t.exec });
  // exec sessions get a unique env marker so close() can sweep the orphaned
  // host-side chain (bash → script → docker exec) by /proc/*/environ — the
  // same targeted trick as PMLOG in logs.ts.
  const marker = t.exec ? `AXONTERM=${crypto.randomUUID()}` : '';
  t.marker = marker || undefined;
  const proc = hostSpawnInteractive(marker ? `export ${marker}; ${cmd}` : cmd, { user: 'user' });
  t.proc = proc;
  const pump = async (stream: ReadableStream<Uint8Array> | undefined) => {
    if (!stream) return;
    const r = stream.getReader();
    let dropWarned = false;
    try {
      while (true) {
        const { done, value } = await r.read();
        if (done) break;
        if (ws.readyState !== WebSocket.OPEN) break;
        try {
          // send() returns 0 under backpressure and -1 on a dead socket —
          // ignoring it corrupts the xterm stream (partial frames). Drop the
          // chunk and flag the gap once, so the PTY keeps draining.
          const sent = ws.send(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
          if (sent < 0) break;
          if (sent === 0 && !dropWarned) {
            dropWarned = true;
            try { ws.send('\r\n\x1b[33m[axon] Conexión lenta: se descartó parte de la salida.\x1b[0m\r\n'); } catch { /* best-effort */ }
          }
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
  hostname: process.env.AXON_BIND_HOST || '0.0.0.0',
  idleTimeout: 60,
  async fetch(req: Request, server: Bun.Server<WsData>) {
    const url = new URL(req.url);
    const isWs = req.headers.get('upgrade')?.toLowerCase() === 'websocket';
    if (isWs && !requestOriginAllowed(req)) return new Response('Origen WebSocket no permitido', {status:403});
    if (maintenanceQaRoot && isWs) return new Response('QA: WebSocket operativo bloqueado', {status:403});
    const wsMatch = url.pathname.match(/^\/p\/(\d+)(\/.*)?$/);
    if (wsMatch && isWs) {
      const token = req.headers.get('cookie')?.match(/(?:^|;\s*)axon_session=([^;]+)/)?.[1];
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
      wsCredentials.set(data, { token, sid: sessionIdForToken(token) });
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
      const token = req.headers.get('cookie')?.match(/(?:^|;\s*)axon_session=([^;]+)/)?.[1];
      if (!token || !(await verifySessionToken(token)) || isRevoked(sessionIdForToken(token))) return new Response('Unauthorized', { status: 401 });
      touchSession(sessionIdForToken(token));
      // ?exec=<container id|name> → interactive docker exec instead of tmux.
      const exec = url.searchParams.get('exec') || '';
      if (exec && !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(exec)) {
        return new Response('Contenedor inválido', { status: 400 });
      }
      // Same rule as the lifecycle endpoints: no shell inside Axon itself.
      if (exec && await isOwnContainer(exec)) {
        return new Response('Contenedor protegido', { status: 403 });
      }
      const data: WsData = {
        kind: 'term',
        session: (url.searchParams.get('s') || 'axon-term').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'axon-term',
        exec: exec || undefined,
        cols: parseInt(url.searchParams.get('c') || '120', 10),
        rows: parseInt(url.searchParams.get('r') || '40', 10),
      };
      wsCredentials.set(data, { token, sid: sessionIdForToken(token) });
      // A root shell inside an arbitrary container is a high-impact action —
      // leave it in the event feed.
      if (exec) recordEvent('system', `Terminal docker exec → ${exec}`);
      if (server.upgrade(req, { data })) return;
      return new Response('WS upgrade failed', { status: 500 });
    }
    if (isWs && url.pathname === '/ws/logs') {
      const token = req.headers.get('cookie')?.match(/(?:^|;\s*)axon_session=([^;]+)/)?.[1];
      if (!token || !(await verifySessionToken(token))) return new Response('Unauthorized', { status: 401 });
      if (isRevoked(sessionIdForToken(token))) return new Response('Unauthorized', { status: 401 });
      touchSession(sessionIdForToken(token));
      const src = url.searchParams.get('src') || '';
      const p = parseLogsSrc(src);
      if (!p.ok) return new Response(`src inválido: ${p.error}`, { status: 400 });
      const data: WsData = { kind: 'logs', src };
      wsCredentials.set(data, { token, sid: sessionIdForToken(token) });
      if (server.upgrade(req, { data })) return;
      return new Response('WS upgrade failed', { status: 500 });
    }
    return app.fetch(req, server);
  },
  websocket: {
    open(ws: Bun.ServerWebSocket<WsData>) {
      armWsRevalidation(ws);
      if (ws.data.kind === 'term') { startTermSocket(ws); return; }
      if (ws.data.kind === 'logs') { startLogsSocket(ws as Bun.ServerWebSocket<LogsWsData>); return; }
      // Handlers were attached in fetch() before upgrade — just link the
      // socket and flush any upstream frames buffered in between.
      ws.data.ws = ws;
      for (const m of ws.data.pendingServer.splice(0)) {
        try { ws.send(m as string | ArrayBuffer); } catch { break; }
      }
    },
    message(ws: Bun.ServerWebSocket<WsData>, msg: string | Buffer) {
      if (ws.data.kind === 'logs') return; // read-only stream
      // Revocation lands between periodic re-checks — an interactive stream
      // must die the moment the session is denied, not 30s later.
      if (!wsStillAuthed(ws.data)) {
        try { ws.close(4401, 'Sesión revocada'); } catch { /* closed */ }
        return;
      }
      if (ws.data.kind === 'term') {
        const t = ws.data;
        if (typeof msg === 'string' && msg[0] === '{') {
          try {
            const j = JSON.parse(msg);
            if (j.t === 'r' && Number.isFinite(j.c) && Number.isFinite(j.r)) {
              // docker exec sessions can't be resized server-side — initial
              // size only; ignore the message.
              if (t.exec) return;
              const sess = t.session || 'axon-term';
              const c = Math.max(2, Math.min(j.c, 500)), r = Math.max(2, Math.min(j.r, 200));
              hostExec(`tmux resize-window -t ${sess} -x ${c} -y ${r} 2>/dev/null; tmux refresh-client -t ${sess} -C ${c},${r} 2>/dev/null; true`, { user: 'user', timeoutMs: 4000 }).catch(() => {});
              return;
            }
            if (j.t === 'i' && typeof j.d === 'string') {
              const stdin = t.proc?.stdin as { write(d: string): void; flush(): void } | undefined;
              if (stdin) { stdin.write(j.d); stdin.flush(); }
              return;
            }
          } catch { /* not json — fall through to raw */ }
        }
        const stdin = t.proc?.stdin as { write(d: string | Buffer): void; flush(): void } | undefined;
        try { stdin?.write(msg); stdin?.flush(); } catch { /* proc exited */ }
        return;
      }
      const up = ws.data.upstream;
      if (up.readyState === WebSocket.OPEN) up.send(msg as never);
      else try { ws.close(1011); } catch { /* closed — don't buffer against a dead upstream */ }
    },
    close(ws: Bun.ServerWebSocket<WsData>) {
      const cred = wsCredentials.get(ws.data);
      if (cred?.timer) clearInterval(cred.timer);
      if (ws.data.kind === 'logs') { stopLogsSocket(ws.data); return; }
      if (ws.data.kind === 'term') {
        // Killing runuser orphans bash→script→tmux-client on the host; detach
        // the tmux client first so the whole chain exits cleanly, then kill.
        // The kill MUST wait for the detach to land — firing both at once
        // races and can kill runuser before the detach reaches the host.
        const killProc = () => {
          const proc = (ws.data as WsTermData).proc;
          if (proc) killHostProc(proc);
        };
        if (!ws.data.exec) {
          const sess = ws.data.session || 'axon-term';
          hostExec(`tmux detach-client -s ${sess} 2>/dev/null; true`, { user: 'user', timeoutMs: 3000 })
            .catch(() => {})
            .finally(killProc);
          return;
        }
        if (ws.data.marker) {
          // exec sessions aren't tmux-backed — the orphaned host chain is
          // bash→script→docker exec. Kill every host process still carrying
          // this session's env marker; the literal is built inside the
          // sweep's own shell so it can never match itself.
          const uuid = ws.data.marker.slice(ws.data.marker.indexOf('=') + 1);
          hostExec(
            `M="AXONTERM="; M="\${M}${uuid}"; ` +
            `pkill -9 -f "$M" 2>/dev/null; ` +
            `for d in /proc/[0-9]*/environ; do ` +
            `  if tr '\\0' '\\n' < "$d" 2>/dev/null | grep -qxF "$M"; then ` +
            `    kill -9 "$(basename "$(dirname "$d")")" 2>/dev/null; ` +
            `  fi; ` +
            `done; true`,
            { timeoutMs: 10_000 }
          ).catch(() => {});
        }
        killProc();
        return;
      }
      try { ws.data.upstream.close(); } catch { /* already closed */ }
    },
  },
};
