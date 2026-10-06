import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import * as path from 'node:path';

// Independent login fixture. Never loads production config or writes host data.
const root = await mkdtemp(path.join(tmpdir(), 'axon-polish-qa-'));
await writeFile(path.join(root, '.axon-qa-owned'), 'isolated-qa-v1', { mode:0o600 });
const port = '3467';
const env = { ...process.env, AXON_QA_ROOT:root, CONFIG_PATH:path.join(root,'config.json'), PORT:port, AXON_BIND_HOST:'127.0.0.1', AXON_PUBLIC_ORIGIN:`http://127.0.0.1:${port}`, HOST_USER:userInfo().username, PROJECT_SCAN_DIRS:root, SESSION_SECRET:crypto.randomUUID() };
for (const key of Object.keys(env)) if (/^(CLOUDFLARE_|CF_)/.test(key)) delete (env as Record<string,string|undefined>)[key];
process.env.SESSION_SECRET = env.SESSION_SECRET;
const { hashPassword } = await import('../src/auth');
await writeFile(env.CONFIG_PATH, JSON.stringify({ auth:{ username:'qa', passwordHash:await hashPassword('axon-local-qa') }, domains:[], projects:[], settings:{ hostUser:env.HOST_USER, scanDirs:[root], scanIntervalMs:5000 } }));
const child = Bun.spawn(['bun','--no-env-file','run','src/index.ts'], { env, stdout:'inherit', stderr:'inherit' });
console.log(`Isolated login QA: http://127.0.0.1:${port}`);
const stop = () => child.kill('SIGTERM');
process.on('SIGINT',stop); process.on('SIGTERM',stop);
try { process.exitCode = await child.exited; }
finally { process.off('SIGINT',stop); process.off('SIGTERM',stop); await rm(root,{ recursive:true,force:true }); }
