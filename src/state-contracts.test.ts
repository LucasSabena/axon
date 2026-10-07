import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, readFile, readdir, stat, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { atomicPrivateWrite } from './atomic-file';

const root = path.dirname(new URL(import.meta.url).pathname);
const modulePath = (name: string) => JSON.stringify(path.join(root, name + '.ts'));
// Module globals and boot reads are exercised in fresh processes, never against
// this checkout's real config, credentials, revocations or host services.
async function fixture(source: string, files: Record<string, string> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-state-test-'));
  try {
    for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
    const proc = Bun.spawn(['bun', '--no-env-file', '--eval', source], { env: { ...process.env, SESSION_SECRET: crypto.randomUUID(), CONFIG_PATH: path.join(dir, 'config.json') }, stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => proc.kill('SIGKILL'), 10000);
    let out: string, error: string, code: number;
    try { [out, error, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]); }
    finally { clearTimeout(timer); }
    if (code !== 0) throw new Error(error);
    return JSON.parse(out.trim().split('\n').at(-1)!);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const signFixture = `
async function sign(payload) {
 const body=Buffer.from(JSON.stringify(payload)).toString('base64');
 const sig=new Bun.CryptoHasher('sha256',process.env.SESSION_SECRET).update(Buffer.from(body,'base64')).digest('base64');
 return body+'.'+sig;
}
`;

test('legacy signed sessions have one canonical encoding; alternate encodings cannot evade revocation', async () => {
  const result = await fixture(`
    const auth=await import(${modulePath('auth')}); ${signFixture}
    const token=await sign({username:'admin',exp:Date.now()/1000+3600});
    const [body,sig]=token.split('.');
    const alternate=[token+'.suffix',body+'.'+sig.replace(/=+$/,''),body+'.'+sig+'\\n',body+'\\n.'+sig];
    const before=!!await auth.verifySessionToken(token);
    const accepted=await Promise.all(alternate.map(t=>auth.verifySessionToken(t)));
    auth.setSessionHooks({isRevoked:()=>true});
    console.log(JSON.stringify({before,accepted,after:await auth.verifySessionToken(token)}));
  `);
  expect(result.before).toBe(true); expect(result.accepted).toEqual([null, null, null, null]); expect(result.after).toBeNull();
});

test('session claims reject invalid identities and expired timestamps even with a valid signature', async () => {
  const result = await fixture(`
    const auth=await import(${modulePath('auth')}); ${signFixture}
    const good={username:'admin',exp:Date.now()/1000+3600};
    const bad=[{...good,username:[]},{...good,username:''},{...good,jti:{}},{...good,jti:''},{...good,exp:'999999999999'},{...good,exp:0},null];
    console.log(JSON.stringify(await Promise.all(bad.map(async p=>auth.verifySessionToken(await sign(p))))));
  `);
  expect(result).toEqual(Array(7).fill(null));
});

test('session revocation is durable immediately, survives a new process and cannot be undone by activity', async () => {
  const result = await fixture(`
    const sessions=await import(${modulePath('sessions')});
    const fs=await import('node:fs/promises'),path=await import('node:path');
    await sessions.recordSession('fixture-session-id','admin','fixture');
    await sessions.revokeSession('fixture-session-id');
    await sessions.recordSession('fixture-session-id','admin','fixture');
    const file=path.join(path.dirname(process.env.CONFIG_PATH),'sessions.json');
    const stored=JSON.parse(await fs.readFile(file,'utf8'));
    const child=Bun.spawn(['bun','--no-env-file','--eval',${JSON.stringify(`const s=await import(${modulePath('sessions')}); console.log(JSON.stringify(s.isRevoked('fixture-session-id')));`)}],{stdout:'pipe',stderr:'pipe',env:process.env});
    const reboot=JSON.parse(await new Response(child.stdout).text());if(await child.exited)throw new Error('Reboot failed');
    console.log(JSON.stringify({stored:stored.revoked.some(r=>r.jti==='fixture-session-id'),reboot,revoked:sessions.isRevoked('fixture-session-id'),mode:(await fs.stat(file)).mode&511}));
  `);
  expect(result).toEqual({ stored: true, reboot: true, revoked: true, mode: 0o600 });
});

test('corrupt revocations stop boot rather than resurrecting a revoked administrator session', async () => {
  for (const file of ['{broken', '{"issued":[],"revoked":[{"jti":"protected"}]}']) {
    const result = await fixture(`try{await import(${modulePath('sessions')});console.log('false')}catch{console.log('true')}`, { 'sessions.json': file });
    expect(result).toBe(true);
  }
});

test('a failed revocation write rejects acknowledgement while keeping the in-memory token denied', async () => {
  const result = await fixture(`
    const sessions=await import(${modulePath('sessions')});
    const fs=await import('node:fs/promises'),path=await import('node:path');
    await fs.mkdir(path.join(path.dirname(process.env.CONFIG_PATH),'sessions.json'));
    let failed=false;try{await sessions.revokeSession('fixture-session-id')}catch{failed=true}
    console.log(JSON.stringify({failed,denied:sessions.isRevoked('fixture-session-id')}));
  `);
  expect(result).toEqual({ failed: true, denied: true });
});

test('missing configuration persists exactly one initial password; reboot preserves credentials', async () => {
  const result = await fixture(`
    const {loadConfig}=await import(${modulePath('config')});
    console.log=()=>{};
    const first=await loadConfig(),second=await loadConfig();
    process.stdout.write(JSON.stringify({same:first.auth.passwordHash===second.auth.passwordHash,username:second.auth.username}));
  `);
  expect(result).toEqual({ same: true, username: 'admin' });
});

test('corrupt or malformed configuration is preserved and never replaced with a fresh account', async () => {
  for (const file of ['{broken', '{}', '{"auth":{"username":"admin","passwordHash":null}}', '{"auth":{"username":"admin","passwordHash":"x:x"}}']) {
    const result = await fixture(`
      const {loadConfig}=await import(${modulePath('config')});
      let rejected=false;try{await loadConfig()}catch{rejected=true}
      console.log(JSON.stringify({rejected,text:await Bun.file(process.env.CONFIG_PATH).text()}));
    `, { 'config.json': file });
    expect(result).toEqual({ rejected: true, text: file });
  }
});

test('private atomic writes retain a complete prior file on failure and leave no staging files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-atomic-test-'));
  try {
    const file = path.join(dir, 'config.json');
    await writeFile(file, 'old', { mode: 0o644 });
    await atomicPrivateWrite(file, 'new');
    expect(await readFile(file, 'utf8')).toBe('new'); expect((await stat(file)).mode & 0o777).toBe(0o600);
    const blocked = path.join(dir, 'blocked'); await mkdir(blocked);
    await expect(atomicPrivateWrite(blocked, 'must-not-publish')).rejects.toThrow();
    expect(await readdir(dir)).toEqual(expect.arrayContaining(['config.json', 'blocked']));
    expect((await readdir(dir)).filter(f => f.endsWith('.tmp'))).toEqual([]);
    expect(await readFile(file, 'utf8')).toBe('new');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const onboardingFixture = `
const {Hono}=await import(${JSON.stringify(path.resolve('node_modules/hono/dist/index.js'))});
const ob=await import(${modulePath('onboarding')});
let saved=0,started=0;
const config={auth:{username:'old',passwordHash:'old'},settings:{},domains:[]};
const deps={getConfig:()=>config,saveAuth:async(username,passwordHash,setupTokenHash)=>{saved++;config.auth={username,passwordHash,setupTokenHash}},hashPassword:async(p)=>{await new Promise(r=>setTimeout(r,30));return 'hash-'+p},startSession:async()=>{started++},backupCount:()=>0,probe:async()=>({}),recordEvent:()=>{},lockRemaining:()=>0,noteFail:()=>{}};
const app=new Hono();app.onError(()=>Response.json({ok:false},{status:500}));ob.registerOnboardingPublic(app,deps);ob.registerOnboardingRoutes(app,deps);
const request=(username)=>app.request('http://fixture/api/onboarding/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'single-use-fixture',username,password:'password-fixture'})});
`;
const onboardingState = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), setupToken: 'single-use-fixture' });

test('simultaneous initial setup consumes a token once and creates only one administrator session', async () => {
  const result = await fixture(onboardingFixture + `
    const responses=await Promise.all([request('first'),request('second')]);
    console.log(JSON.stringify({statuses:responses.map(r=>r.status),saved,started,username:config.auth.username,state:await ob.loadOnboarding()}));
  `, { 'onboarding.json': onboardingState });
  expect(result.statuses).toEqual([200, 403]); expect(result.saved).toBe(1); expect(result.started).toBe(1); expect(result.username).toBe('first'); expect(result.state.setupToken).toBeUndefined();
});

test('a consumed installer token cannot overwrite credentials after an interrupted wizard write', async () => {
  const result = await fixture(onboardingFixture + `
    config.auth.setupTokenHash=ob.setupTokenHash('single-use-fixture');
    const res=await request('attacker');
    console.log(JSON.stringify({status:res.status,saved,started}));
  `, { 'onboarding.json': onboardingState });
  expect(result).toEqual({ status: 403, saved: 0, started: 0 });
});

test('initial setup write failure releases its transaction so a valid retry can create the account', async () => {
  const result = await fixture(onboardingFixture + `
    const persist=deps.saveAuth;deps.saveAuth=async()=>{throw new Error('fixture disk failure')};
    const first=await request('first');deps.saveAuth=persist;const retry=await request('retry');
    console.log(JSON.stringify({statuses:[first.status,retry.status],saved,started,username:config.auth.username}));
  `, { 'onboarding.json': onboardingState });
  expect(result).toEqual({ statuses: [500, 200], saved: 1, started: 1, username: 'retry' });
});

test('corrupt onboarding state reports failure instead of treating setup as an older installation', async () => {
  const result = await fixture(onboardingFixture + `console.log(JSON.stringify({status:(await app.request('http://fixture/api/onboarding/status')).status}));`, { 'onboarding.json': '{broken' });
  expect(result.status).toBe(500);
});


test('failed credential commits leave the active account unchanged and allow a later retry', async () => {
  const result = await fixture(`
    const {updateConfigAuth}=await import(${modulePath('config')});
    const fs=await import('node:fs/promises');
    const config={auth:{username:'admin',passwordHash:'old',totpSecret:'secret',totpRecovery:['one']},settings:{},domains:[]};
    await fs.mkdir(process.env.CONFIG_PATH);
    let failed=false;try{await updateConfigAuth(config,a=>{a.passwordHash='new';delete a.totpSecret;delete a.totpRecovery})}catch{failed=true}
    const before=structuredClone(config.auth);await fs.rmdir(process.env.CONFIG_PATH);
    await updateConfigAuth(config,a=>{a.passwordHash='new';delete a.totpSecret;delete a.totpRecovery});
    const stored=JSON.parse(await fs.readFile(process.env.CONFIG_PATH,'utf8'));
    console.log(JSON.stringify({failed,before,after:config.auth,stored:stored.auth}));
  `);
  expect(result.failed).toBe(true);
  expect(result.before).toEqual({username:'admin',passwordHash:'old',totpSecret:'secret',totpRecovery:['one']});
  expect(result.after).toEqual({username:'admin',passwordHash:'new'});
  expect(result.stored).toEqual(result.after);
});

test('concurrent credential and settings saves cannot restore stale authentication state', async () => {
  const result = await fixture(`
    const {updateConfigAuth,saveConfig}=await import(${modulePath('config')});
    const config={auth:{username:'admin',passwordHash:'old'},settings:{},domains:[]};
    const first=updateConfigAuth(config,async a=>{await Bun.sleep(20);a.passwordHash='new'});
    const settings=saveConfig({...config,settings:{scanIntervalMs:7000}});
    const second=updateConfigAuth(config,a=>{a.totpSecret='secret'});
    await Promise.all([first,settings,second]);
    const stored=JSON.parse(await Bun.file(process.env.CONFIG_PATH).text());
    console.log(JSON.stringify({auth:config.auth,stored:stored.auth,settings:stored.settings}));
  `);
  expect(result.auth).toEqual({username:'admin',passwordHash:'new',totpSecret:'secret'});
  expect(result.stored).toEqual(result.auth);
  expect(result.settings).toEqual({scanIntervalMs:7000});
});
