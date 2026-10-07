import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Own the fixture lifecycle so CI and local runs cannot accidentally reuse a
// live administrator server, or leave the fixture running after a failure.
const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
const port = String(reservation.port); reservation.stop(true);
const origin = 'http://127.0.0.1:' + port;
const output = process.env.AXON_QA_OUTPUT || '/tmp/axon-full-qa';
await mkdir(output, { recursive: true });
const log = await Bun.file(path.join(output, 'server.log')).writer();
const server = Bun.spawn(['bun', '--no-env-file', 'run', 'scripts/qa-server.ts'], { env: { ...process.env, QA_PORT: port }, stdout: 'pipe', stderr: 'pipe' });
const drain = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) log.write(chunk); };
const drains = Promise.all([drain(server.stdout), drain(server.stderr)]);
let testProcess: ReturnType<typeof Bun.spawn> | undefined;
const stop = () => { testProcess?.kill('SIGTERM'); server.kill('SIGTERM'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('QA server failed; see ' + path.join(output, 'server.log'));
    ready = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }).then(async r => r.ok && (await r.json()).qa === true).catch(() => false);
    if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('QA fixture did not start');
  for (const [name, script] of [['stability', 'scripts/stability-browser-qa.ts'], ['screens', 'scripts/audit-browser-qa.ts'], ['agent-states', 'scripts/agent-states-browser-qa.ts'], ['login', 'scripts/login-browser-qa.cjs'], ['auth', 'scripts/auth-state-qa.ts'], ['platform', 'scripts/platform-browser-qa.cjs'], ['backups', 'scripts/backups-browser-qa.cjs'], ['consumption', 'scripts/agent-consumption-browser-qa.cjs']]) {
    testProcess = Bun.spawn(['bun', '--no-env-file', 'run', script], { env: { ...process.env, AXON_QA_ORIGIN: origin, AXON_QA_OUTPUT: path.join(output, name) }, stdout: 'inherit', stderr: 'inherit' });
    const status = await testProcess.exited;
    if (status !== 0) process.exitCode = 1;
  }
} finally {
  stop();
  const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
  try { await server.exited; await drains; await log.end(); }
  finally { clearTimeout(timer); process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
