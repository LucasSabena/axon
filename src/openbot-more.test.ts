import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { SERVICES, buildAccounts, groupKey, parseCookies, registerOpenBotWeb, serviceFor } from './openbot-web';
import { API_KEY, PROVIDER_ID, modelCounts, pickTestModel, registerOpenBotProviders } from './openbot-providers';
import { AGENT_ID, SKILL_TEMPLATE, parseSkillList, registerOpenBotAgents, validateSkill } from './openbot-agents';
import { evaluate, parseSnapshot, registerOpenBotDoctor, type Snapshot } from './openbot-doctor';

const NOW = 1_800_000_000;

test('parseCookies: JSON estilo Cookie-Editor, hostOnly, sesión y vencidas', () => {
  const r = parseCookies(JSON.stringify([
    { name: 'sid', value: 'a1', domain: 'example.com', hostOnly: false, secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: NOW + 1000 },
    { name: 'h', value: 'b', domain: '.app.example.com', hostOnly: true, session: true },
    { name: 'old', value: 'x', domain: 'example.com', expirationDate: NOW - 5 },
    { name: 'bad name', value: 'x', domain: 'example.com' },
    { name: 'nodot', value: 'x', domain: 'localhost' },
  ]), NOW);
  expect(r.cookies).toHaveLength(2);
  expect(r.cookies[0]).toMatchObject({ domain: '.example.com', secure: true, httpOnly: true, sameSite: 0, session: false });
  expect(r.cookies[1]).toMatchObject({ domain: 'app.example.com', session: true });
  expect(r.cookies[1].expires).toBe(NOW + 30 * 86400);
  expect(r.skipped.join('|')).toMatch(/venci/);
  expect(r.skipped).toHaveLength(3);
});

test('parseCookies: storageState de Playwright, SameSite=None sin Secure y tope de 399 días', () => {
  const r = parseCookies(JSON.stringify({ cookies: [{ name: 'a', value: 'v', domain: '.x.com', path: '/p', expires: NOW + 900 * 86400, secure: false, sameSite: 'None' }] }), NOW);
  expect(r.cookies[0]).toMatchObject({ domain: '.x.com', path: '/p', sameSite: -1 });
  expect(r.cookies[0].expires).toBe(NOW + 399 * 86400);
});

test('parseCookies: Netscape con #HttpOnly_ y rechazo de basura', () => {
  const t = `# Netscape HTTP Cookie File\n#HttpOnly_.site.com\tTRUE\t/\tTRUE\t${NOW + 100}\ttok\tz9\nhost.site.com\tFALSE\t/\tFALSE\t${NOW + 100}\tplain\tpp\nlinea rota`;
  const r = parseCookies(t, NOW);
  expect(r.cookies).toHaveLength(2);
  expect(r.cookies[0]).toMatchObject({ name: 'tok', domain: '.site.com', httpOnly: true, secure: true });
  expect(r.cookies[1]).toMatchObject({ name: 'plain', domain: 'host.site.com', httpOnly: false });
  expect(parseCookies('', NOW).cookies).toHaveLength(0);
  expect(parseCookies('{"x":1}', NOW).cookies).toHaveLength(0);
  expect(parseCookies('[{"name":"a","value":"v\\u0000","domain":"x.com"}]', NOW).cookies).toHaveLength(0);
});

test('servicios conocidos, agrupación y estados de cuenta', () => {
  expect(serviceFor('.accounts.google.com')?.id).toBe('google');
  expect(serviceFor('evil-google.com')).toBeNull();
  expect(serviceFor('notgoogle.com')).toBeNull();
  expect(serviceFor('console.neon.tech')?.id).toBe('neon');
  expect(groupKey('.shop.rondita.com.ar')).toBe('rondita.com.ar');
  expect(groupKey('www.algo.io')).toBe('algo.io');
  expect(new Set(SERVICES.map((s) => s.id)).size).toBe(SERVICES.length);
  const acc = buildAccounts([
    { host: '.google.com', count: 17, expires: NOW + 400 * 86400, lastAccess: NOW - 10, persistent: 17, encrypted: 17, secure: 17 },
    { host: 'accounts.google.com', count: 6, expires: NOW + 400 * 86400, lastAccess: NOW - 5, persistent: 6, encrypted: 6, secure: 6 },
    { host: '.rondita.com.ar', count: 2, expires: NOW + 2 * 86400, lastAccess: 0, persistent: 2, encrypted: 2, secure: 2 },
    { host: '.viejo.com', count: 1, expires: NOW - 100, lastAccess: 0, persistent: 1, encrypted: 1, secure: 0 },
  ], NOW);
  expect(acc[0]).toMatchObject({ id: 'google', cookies: 23, known: true, state: 'active' });
  expect(acc.find((a) => a.id === 'rondita.com.ar')?.state).toBe('expiring');
  expect(acc.find((a) => a.id === 'viejo.com')?.state).toBe('expired');
});

test('parseCookies acepta archivos grandes (hasta 5000) y avisa del recorte', () => {
  const many = Array.from({ length: 5200 }, (_, i) => ({ name: 'c' + i, value: 'v', domain: '.big.example', path: '/', expirationDate: NOW + 1000 }));
  const r = parseCookies(JSON.stringify(many), NOW);
  expect(r.cookies).toHaveLength(5000);
  expect(r.skipped.join(' ')).toMatch(/5000/);
});

test('proveedores: validadores y conteo de modelos', () => {
  expect(PROVIDER_ID.test('opencode-go')).toBe(true);
  for (const bad of ['', 'A', '../x', 'a b', 'x;y', '-x']) expect(PROVIDER_ID.test(bad)).toBe(false);
  expect(API_KEY.test('sk-abcdefgh12345678')).toBe(true);
  for (const bad of ['corta', 'con espacio 12345678', 'a\nb12345678', 'ñandú1234567']) expect(API_KEY.test(bad)).toBe(false);
  expect(modelCounts('opencode/a-free\nopencode-go/x\nopencode-go/y\n\u001b[0mruido sin barra\n')).toEqual({ opencode: 1, 'opencode-go': 2 });
  expect(pickTestModel(['p/gran-modelo', 'p/gran-flash', 'p/otro'])).toBe('p/gran-flash');
  expect(pickTestModel(['p/uno', 'p/dos'])).toBe('p/uno');
  expect(pickTestModel(['p/mal;rm -rf'])).toBeNull();
});

const base = (): Snapshot => ({
  container: { exists: true, state: 'running', health: 'healthy', restarts: 0, startedAt: new Date(Date.now() - 3600e3).toISOString(), image: 'x:0.42.0' },
  statusText: 'OpenBot 0.42.0\nAccount: a@b.com\nServer: OpenBot (online)\nMemory: 11000 MiB free of 12288 MiB (ok)\n',
  manualStop: false, composeHasRootMount: false, composeImage: 'x:0.42.0', diskPct: 50, externalMounted: true, lastBackupAgeHours: 3, sessionBackup: null,
  update: { result: 'uptodate' }, timers: { 'openbot-update': 'enabled', 'openbot-backup': 'enabled', 'openbot-watchdog': 'enabled' }, providerErrors: 0, startFailure: null, providerCount: 1,
});

test('diagnóstico: todo bien y cada falla con su reparación', () => {
  expect(evaluate(base()).map((f) => f.id)).toEqual(['all-good']);
  const ids = (m: Partial<Snapshot>) => evaluate({ ...base(), ...m });
  expect(ids({ container: { exists: false } })[0]).toMatchObject({ id: 'no-container', fix: { id: 'recreate' } });
  expect(ids({ container: { exists: true, state: 'exited' }, manualStop: true })[0]).toMatchObject({ id: 'stopped', level: 'warn', fix: { id: 'start' } });
  expect(ids({ container: { exists: true, state: 'exited' } })[0]).toMatchObject({ id: 'stopped', level: 'bad' });
  expect(ids({ startFailure: 'OpenBot database migration to version 38 failed.' })[0]).toMatchObject({ id: 'migration', fix: { id: 'repair-db' } });
  expect(ids({ statusText: 'Account: signed out. Sign in with: openbot login\n', sessionBackup: '20261016T204923Z' })[0]).toMatchObject({ id: 'signed-out', fix: { id: 'restore-session' } });
  expect(ids({ statusText: 'Account: signed out. Sign in\n' })[0].fix).toBeUndefined();
  expect(ids({ composeHasRootMount: true })[0]).toMatchObject({ id: 'root-mount', fix: { id: 'fix-compose' } });
  expect(ids({ providerErrors: 2 }).some((f) => f.fix?.id === 'disable-broken-providers')).toBe(true);
  expect(ids({ lastBackupAgeHours: 80 }).some((f) => f.id === 'old-backup')).toBe(true);
  expect(ids({ lastBackupAgeHours: null }).some((f) => f.id === 'no-backup')).toBe(true);
  expect(ids({ diskPct: 95 })[0]).toMatchObject({ id: 'disk-full', level: 'bad' });
  expect(ids({ timers: { 'openbot-update': 'disabled', 'openbot-backup': 'enabled', 'openbot-watchdog': 'enabled' } }).some((f) => f.fix?.id === 'enable-timers')).toBe(true);
  expect(ids({ update: { result: 'rolledback', detail: 'x' } }).some((f) => f.id === 'update-failed')).toBe(true);
  expect(ids({ providerCount: 0 }).some((f) => f.id === 'no-providers' && f.level === 'info')).toBe(true);
  const sorted = ids({ diskPct: 95, providerErrors: 1 }).map((f) => f.level);
  expect(sorted).toEqual([...sorted].sort((a, b) => ['bad', 'warn', 'info', 'ok'].indexOf(a) - ['bad', 'warn', 'info', 'ok'].indexOf(b)));
});

test('parseSnapshot lee todas las secciones del host', () => {
  const raw = ['running|healthy|2|2026-10-16T21:03:45Z|ghcr.io/nightly-labs/openbot:0.42.0', '@@STATUS', 'OpenBot 0.42.0', 'Account: a@b.com', '@@FLAGS', 'manual', 'rootmount', 'image: ghcr.io/nightly-labs/openbot:0.42.0',
    '@@DISK', '67', 'mounted', '@@BACKUPS', '1000', '8200', '@@UPDATE', '{"result":"ok","detail":"d"}', '@@TIMERS', 'openbot-update enabled', 'openbot-backup disabled', '@@LOGS', '3', '"message":"OpenBot database migration to version 38 failed."', '@@PROVIDERS', '2'].join('\n');
  const s = parseSnapshot(raw);
  expect(s).toMatchObject({ manualStop: true, composeHasRootMount: true, diskPct: 67, externalMounted: true, providerErrors: 3, providerCount: 2, container: { restarts: 2, state: 'running' } });
  expect(s.lastBackupAgeHours).toBeCloseTo(2, 0);
  expect(s.timers).toEqual({ 'openbot-update': 'enabled', 'openbot-backup': 'disabled' });
  expect(s.startFailure).toContain('migration to version 38');
  expect(parseSnapshot('missing\n@@STATUS\n').container.exists).toBe(false);
});

test('las rutas nuevas exigen sesión/origen y validan entradas', async () => {
  const app = new Hono();
  app.use('*', async (c, next) => { if (c.req.header('cookie')) c.set('user', 'qa'); await next(); });
  registerOpenBotWeb(app); registerOpenBotProviders(app); registerOpenBotDoctor(app);
  const headers = { cookie: 'axon_session=qa', origin: process.env.AXON_PUBLIC_ORIGIN || 'http://localhost', 'Content-Type': 'application/json' };
  const post = (p: string, b: unknown, more = {}) => app.request(p, { method: 'POST', headers: { ...headers, ...more }, body: JSON.stringify(b) });
  for (const p of ['/api/openbot/web/accounts', '/api/openbot/providers', '/api/openbot/doctor']) expect((await app.request(p)).status).toBe(401);
  expect((await post('/api/openbot/web/import', { text: '[]', confirm: true }, { origin: 'https://evil.test' })).status).toBe(403);
  expect((await post('/api/openbot/web/import', { text: '[]', confirm: true })).status).toBe(400);        // sin cookies válidas
  expect((await post('/api/openbot/web/import', { text: '[]' })).status).toBe(400);                       // sin confirmación
  expect((await post('/api/openbot/web/import', { text: '[]', confirm: true, extra: 1 })).status).toBe(400);
  expect((await post('/api/openbot/web/remove', { account: '../x', confirm: true })).status).toBe(400);
  expect((await post('/api/openbot/web/remove', { account: 'google' })).status).toBe(400);
  expect((await post('/api/openbot/web/restore', { stamp: '../../etc', confirm: true })).status).toBe(400);
  expect((await post('/api/openbot/providers/key', { provider: 'x;y', key: 'sk-abcdefgh12345678' })).status).toBe(400);
  expect((await post('/api/openbot/providers/key', { provider: 'openai', key: 'corta' })).status).toBe(400);
  expect((await post('/api/openbot/providers/remove', { provider: 'openai' })).status).toBe(400);
  expect((await post('/api/openbot/providers/test', { provider: '../x' })).status).toBe(400);
  expect((await post('/api/openbot/doctor/fix', { fix: 'rm -rf /', confirm: true })).status).toBe(400);
  expect((await post('/api/openbot/doctor/fix', { fix: 'restart' })).status).toBe(400);
  const prev = await post('/api/openbot/web/preview', { text: '[{"name":"a","value":"b","domain":".google.com"}]' });
  expect(prev.status).toBe(200);
  expect(await prev.json()).toMatchObject({ ok: true, count: 1, domains: [{ domain: '.google.com', service: 'Google' }] });
});

test('agentes: validación de skills (nombre, encabezado y tamaño)', () => {
  expect(validateSkill('informe-diario', SKILL_TEMPLATE('informe-diario'))).toBeNull();
  expect(validateSkill('Mala Skill', SKILL_TEMPLATE('x'))).toMatch(/minúsculas/);
  expect(validateSkill('../etc', 'x')).toMatch(/minúsculas/);
  expect(validateSkill('ok', '')).toMatch(/vacío/);
  expect(validateSkill('ok', '# sin encabezado')).toMatch(/encabezado/);
  expect(validateSkill('ok', '---\nname: otro\ndescription: d\n---\ncuerpo')).toMatch(/exactamente "ok"/);
  expect(validateSkill('ok', '---\nname: ok\ndescription:\n---\ncuerpo')).toMatch(/description/);
  expect(validateSkill('ok', '---\nname: "ok"\ndescription: "Hace algo"\n---\ncuerpo')).toBeNull();
  expect(validateSkill('ok', '---\r\nname: ok\r\ndescription: d\r\n---\r\ncuerpo')).toBeNull();
  expect(validateSkill('ok', '---\nname: ok\ndescription: d\n---\n' + 'x'.repeat(200_001))).toMatch(/grande/);
  expect(AGENT_ID.test('agent-49f5d089-acdd-48ef-bbd2-0f4c99373d04')).toBe(true);
  for (const bad of ['agent-1', '../agent-49f5d089-acdd-48ef-bbd2-0f4c99373d04', 'agent-49f5d089-acdd-48ef-bbd2-0f4c99373d04/../x', '']) expect(AGENT_ID.test(bad)).toBe(false);
});

test('agentes: lista de skills con marca de OpenBot y descripciones con barras', () => {
  const out = 'openbot-data|1|1|1|3700|1760000000|Keep data | shared\nmi-skill|0|1|0|120|1760000100|Hace algo\nmala/ruta|0|1|1|1|1|x\n';
  const list = parseSkillList(out);
  expect(list.map((s) => s.slug)).toEqual(['mi-skill', 'openbot-data']);        // propias primero, administradas al final
  expect(list[1]).toMatchObject({ managed: true, inAgents: true, inClaude: true, description: 'Keep data | shared' });
  expect(list[0]).toMatchObject({ managed: false, inAgents: true, inClaude: false, size: 120 });
});

test('agentes: las rutas validan id, nombre y confirmación', async () => {
  const app = new Hono();
  app.use('*', async (c, next) => { if (c.req.header('cookie')) c.set('user', 'qa'); await next(); });
  registerOpenBotAgents(app);
  const headers = { cookie: 'axon_session=qa', origin: process.env.AXON_PUBLIC_ORIGIN || 'http://localhost', 'Content-Type': 'application/json' };
  const post = (p: string, b: unknown, more = {}) => app.request(p, { method: 'POST', headers: { ...headers, ...more }, body: JSON.stringify(b) });
  const AG = 'agent-49f5d089-acdd-48ef-bbd2-0f4c99373d04';
  expect((await app.request('/api/openbot/agents')).status).toBe(401);
  expect((await app.request('/api/openbot/agents/detail?id=../x', { headers })).status).toBe(400);
  expect((await app.request(`/api/openbot/agents/skill?id=${AG}&slug=../../etc/passwd`, { headers })).status).toBe(400);
  expect((await post('/api/openbot/agents/skill', { id: 'nope', slug: 'a', content: 'x' })).status).toBe(400);
  expect((await post('/api/openbot/agents/skill', { id: AG, slug: 'a', content: '# sin encabezado' })).status).toBe(400);
  expect((await post('/api/openbot/agents/skill', { id: AG, slug: 'a', content: SKILL_TEMPLATE('a'), extra: 1 })).status).toBe(400);
  expect((await post('/api/openbot/agents/skill', { id: AG, slug: 'a', content: SKILL_TEMPLATE('a') }, { origin: 'https://evil.test' })).status).toBe(403);
  expect((await post('/api/openbot/agents/skill/delete', { id: AG, slug: 'a' })).status).toBe(400);
  expect((await post('/api/openbot/agents/skill/delete', { id: AG, slug: '../x', confirm: true })).status).toBe(400);
});

test('un archivo grande de cookies (≈2 MB) pasa por la ruta de análisis', async () => {
  const app = new Hono();
  app.use('*', async (c, next) => { if (c.req.header('cookie')) c.set('user', 'qa'); await next(); });
  registerOpenBotWeb(app);
  const headers = { cookie: 'axon_session=qa', origin: process.env.AXON_PUBLIC_ORIGIN || 'http://localhost', 'Content-Type': 'application/json' };
  const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
  const text = JSON.stringify(Array.from({ length: 4000 }, (_, i) => ({ name: 'c' + i, value: 'v'.repeat(300), domain: '.site' + (i % 50) + '.example', path: '/', expirationDate: exp })));
  expect(text.length).toBeGreaterThan(1_500_000);
  const r = await app.request('/api/openbot/web/preview', { method: 'POST', headers, body: JSON.stringify({ text }) });
  expect(r.status).toBe(200);
  const j: any = await r.json();
  expect(j.count).toBe(4000); expect(j.domains.length).toBe(50);
  const huge = await app.request('/api/openbot/web/preview', { method: 'POST', headers, body: JSON.stringify({ text: 'x'.repeat(9_000_000) }) });
  expect(huge.status).toBe(413);
});
