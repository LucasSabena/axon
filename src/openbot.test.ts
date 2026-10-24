import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { CODE, EMAIL, parseOverview, parseQr, parseStatus, registerOpenBot, stripAnsi, usageCommand } from './openbot';

test('parseStatus lee sesión abierta y cerrada', () => {
  const on = parseStatus('OpenBot 0.42.0\nAccount: a@b.com\nServer: OpenBot (online)\nMemory: 11596 MiB free of 12288 MiB (ok)\nTurns at the same time: at most 16\n');
  expect(on).toMatchObject({ version: '0.42.0', account: 'a@b.com', signedIn: true, online: true, concurrency: 'at most 16' });
  const off = parseStatus('OpenBot 0.42.0\nAccount: signed out. Sign in with: openbot login\nServer: unconfigured\n');
  expect(off).toMatchObject({ signedIn: false, account: null, online: false });
  expect(parseStatus('')).toMatchObject({ version: null, signedIn: false });
});

test('parseQr interpreta colores ANSI y devuelve la matriz de módulos', () => {
  const E = '\u001b';
  const dark = `${E}[47m${E}[30m`;
  // fila 1: ▄ = abajo oscuro; fila 2: █ = oscuro, ▀ con fg blanco (37) = claro arriba y fondo claro abajo
  const pad = (t: string) => t.padEnd(24, ' ');
  const l1 = `${dark}${pad(' ▄▄▄▄▄▄▄ ▄')}${E}[0m`;
  const l2 = `${dark}${E}[0m${E}[37m▀${dark}${pad('█ ▄▄▄ █ █▄').slice(0, 23)}${E}[0m`;
  const rows = parseQr([l1, l2, 'Scan with the app', ''].join('\n'));
  expect(rows).toHaveLength(4);
  expect(rows.every((r) => r.length === rows[0].length)).toBe(true);
  expect(rows[0]).toBe('0'.repeat(rows[0].length));           // mitad alta de ▄ y espacios: todo claro
  expect(rows[1].slice(1, 8)).toBe('1111111');                // mitad baja de ▄▄▄▄▄▄▄
  expect(rows[2][0]).toBe('0');                               // ▀ con fg blanco: claro
  expect(rows[2][1]).toBe('1');                               // █ oscuro
  expect(parseQr('sin qr aquí\n')).toEqual([]);
  expect(stripAnsi(`${E}[1mhola${E}[0m`)).toBe('hola');
});

test('validadores rechazan metacaracteres de shell', () => {
  for (const ok of ['a@b.com', 'x.y+z@dominio.com.ar']) expect(EMAIL.test(ok)).toBe(true);
  for (const bad of ["a@b.com; rm -rf /", 'a b@c.com', "a'@b.com", 'a@b', '$(x)@b.com', 'a@b.com\nx']) expect(EMAIL.test(bad)).toBe(false);
  for (const ok of ['QRT3-7E46', '123456']) expect(CODE.test(ok)).toBe(true);
  for (const bad of ['', 'ab', 'a b c d', 'x;y;z;w', 'A'.repeat(25)]) expect(CODE.test(bad)).toBe(false);
});

test('usageCommand cita el período y no abre la base real', () => {
  const cmd = usageCommand('7');
  expect(cmd).toContain("'7'");
  expect(cmd).toContain('docker cp openbot:/data/.config/OpenBot/openbot.db');
  expect(cmd).not.toMatch(/sqlite3?\s+\/data|\/var\/lib\/docker/);
});

test('parseOverview une las secciones del host', () => {
  const raw = ['running|healthy|ghcr.io/nightly-labs/openbot:0.42.0|2026-10-16T20:50:00Z|0', '@@STATUS', 'OpenBot 0.42.0', 'Account: a@b.com', 'Server: OpenBot (online)',
    '@@UPDATE', '{"at":"2026-10-16T21:00:00Z","result":"uptodate","detail":"version 0.42.0","running":"0.42.0"}', '@@ALERTS', '{"at":"x","msg":"hola"}', 'basura',
    '@@BACKUP', '/home/binary/openbot-server/backups/20261016T210309Z', 'MANUAL_STOP', '@@TIMER', 'Sat 2026-10-17 05:18:51 -03 11h Fri 2026-10-16 15:35:42 -03 - openbot-update.timer openbot-update.service'].join('\n');
  const o = parseOverview(raw);
  expect(o.container).toMatchObject({ exists: true, state: 'running', health: 'healthy' });
  expect(o.status.signedIn).toBe(true);
  expect(o.update?.result).toBe('uptodate');
  expect(o.alerts).toHaveLength(1);
  expect(o.lastBackup).toBe('20261016T210309Z');
  expect(o.manualStop).toBe(true);
  expect(o.nextUpdate).toBe('2026-10-17 05:18:51');
  expect(parseOverview('missing\n@@STATUS\n').container).toEqual({ exists: false });
});

test('las rutas exigen sesión y origen, y validan sus parámetros', async () => {
  const app = new Hono();
  app.use('*', async (c, next) => { if (c.req.header('cookie')) c.set('user', 'qa'); await next(); });
  registerOpenBot(app);
  const headers = { cookie: 'axon_session=qa', origin: process.env.AXON_PUBLIC_ORIGIN || 'http://localhost', 'Content-Type': 'application/json' };
  const post = (path: string, b: unknown, more = {}) => app.request(path, { method: 'POST', headers: { ...headers, ...more }, body: JSON.stringify(b) });
  expect((await app.request('/api/openbot/status')).status).toBe(401);
  expect((await app.request('/api/openbot/usage?period=999', { headers })).status).toBe(400);
  expect((await app.request('/api/openbot/usage?period=7&path=/etc', { headers })).status).toBe(400);
  expect((await app.request('/api/openbot/logs?source=../../etc/passwd', { headers })).status).toBe(400);
  expect((await post('/api/openbot/action', { action: 'restart' }, { origin: 'https://evil.test' })).status).toBe(403);
  expect((await post('/api/openbot/action', { action: 'rm -rf /' })).status).toBe(400);
  expect((await post('/api/openbot/action', { action: 'stop', extra: 1 })).status).toBe(400);
  expect((await post('/api/openbot/login/start', { email: 'a@b.com; reboot' })).status).toBe(400);
  expect((await post('/api/openbot/login/code', { code: 'x;y' })).status).toBe(400);
  expect((await post('/api/openbot/mobile-connect', { cmd: 'x' })).status).toBe(400);
});
