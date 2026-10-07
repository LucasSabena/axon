import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { totpCode } from '../src/totp';
const origin = process.env.AXON_QA_ORIGIN || 'http://127.0.0.1:3459';
assert.equal(new URL(origin).hostname, '127.0.0.1');
const output = process.env.AXON_QA_OUTPUT || '/tmp/axon-auth-state-qa';
const call = (url: string, body?: unknown, cookie?: string) => fetch(origin + url, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Origin: origin, ...(body === undefined ? {} : {'Content-Type':'application/json'}), ...(cookie ? {Cookie:cookie} : {}) },
  ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(10000)
});
assert.equal((await (await call('/api/health')).json()).qa, true, 'An isolated QA fixture is required');
const login = async (password: string) => {
  const response = await call('/api/login', {username:'qa',password});
  assert.equal(response.status, 200, 'Fixture login failed');
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie); return cookie;
};
const first = await login('axon-local-qa'), second = await login('axon-local-qa');
const candidate = 'isolated-' + crypto.randomUUID();
let rotated = false, secondFactor = false, active = first;
try {
  const responses = await Promise.all([candidate, 'other-' + crypto.randomUUID()].map(password => call('/api/auth/password', {current:'axon-local-qa',password}, first)));
  rotated = responses[0].status === 200;
  assert.deepEqual(responses.map(r=>r.status).sort(), [200,401], 'Concurrent rotations must reauthenticate after the preceding commit');
  assert.ok(rotated, 'The first queued rotation should succeed');
  assert.equal((await (await call('/api/me', undefined, second)).json()).authenticated, false, 'Other sessions must be revoked immediately');
  assert.equal((await (await call('/api/me', undefined, first)).json()).authenticated, true, 'The current session should remain valid');
  await login(candidate);
  const restore = await call('/api/auth/password', {current:candidate,password:'axon-local-qa'}, first);
  assert.equal(restore.status,200); rotated=false;
  active = await login('axon-local-qa');
  const setup = await call('/api/auth/totp/setup', {}, active);
  assert.equal(setup.status,200); const secret = (await setup.json()).secret;
  const enabled = await call('/api/auth/totp/enable',{password:'axon-local-qa',code:totpCode(secret)},active);
  assert.equal(enabled.status,200); secondFactor=true;
  const recovery = (await enabled.json()).recovery[0];
  const withoutCode = await call('/api/login',{username:'qa',password:'axon-local-qa'});
  assert.equal(withoutCode.status,200);
  assert.equal(withoutCode.headers.get('set-cookie'),null,'Password proof must not create an administrator session');
  const pending = await withoutCode.json();
  assert.equal(pending.requiresSecondFactor,true); assert.ok(pending.challenge);
  assert.equal((await (await call('/api/me')).json()).authenticated,false);
  const wrongPassword = await call('/api/login',{username:'qa',password:'wrong-fixture-password'});
  assert.equal(wrongPassword.status,401);
  assert.equal((await wrongPassword.json()).requiresSecondFactor,undefined,'Wrong credentials must not disclose 2FA');
  const badCode = await call('/api/login',{challenge:pending.challenge,code:'invalid'});
  assert.equal(badCode.status,401);
  const factorLogin = await call('/api/login',{challenge:pending.challenge,code:totpCode(secret)});
  assert.equal(factorLogin.status,200); assert.ok(factorLogin.headers.get('set-cookie'));
  assert.equal((await call('/api/login',{challenge:pending.challenge,code:totpCode(secret)})).status,410);
  const proofs = await Promise.all([0,1].map(async()=>{
    const response=await call('/api/login',{username:'qa',password:'axon-local-qa'});
    assert.equal(response.status,200);return (await response.json()).challenge;
  }));
  const recovered = await Promise.all(proofs.map(challenge=>call('/api/login',{challenge,code:recovery})));
  assert.deepEqual(recovered.map(r=>r.status).sort(),[200,401],'A recovery code can authenticate only once');
  const disabled = await call('/api/auth/totp/disable',{password:'axon-local-qa'},active);
  assert.equal(disabled.status,200); secondFactor=false;
  await login('axon-local-qa');
  await mkdir(output,{recursive:true});
  const checks = ['Concurrent password rotations reauthenticate against the committed credentials', 'Other sessions are immediately denied', 'Current session survives its own rotation', 'New password authenticates and the fixture account can be restored', 'Real TOTP enrollment requires a valid authenticator code', 'Password proof reveals 2FA only after correct credentials and creates no administrator session', 'Wrong credentials do not reveal 2FA', 'Wrong code can be retried and a completed challenge cannot be replayed', 'Simultaneous recovery-code logins consume the code exactly once', 'Disabling 2FA persists and password-only login works again'];
  await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,usesProductionData:false},null,2));
  console.log(JSON.stringify({passed:true,checks}));
} finally {
  if(secondFactor) await call('/api/auth/totp/disable',{password:'axon-local-qa'},active).catch(()=>{});
  if(rotated) await call('/api/auth/password',{current:candidate,password:'axon-local-qa'},first).catch(()=>{});
}
