import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = new URL('.', import.meta.url).pathname;
async function fixture(code: string) {
  const dir = await mkdtemp(path.join(tmpdir(),'axon-session-test-'));
  try {
    const p = Bun.spawn(['bun','--no-env-file','--eval',`const {Hono}=await import('hono'); const s=await import(${JSON.stringify(root+'sessions.ts')}); const a=await import(${JSON.stringify(root+'auth.ts')}); ${code}`], {cwd:path.dirname(root),env:{...process.env,CONFIG_PATH:path.join(dir,'config.json'),SESSION_SECRET:crypto.randomUUID()},stdout:'pipe',stderr:'pipe'});
    const [out,err,exit] = await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
    if(exit)throw Error(err); return JSON.parse(out);
  } finally { await rm(dir,{recursive:true,force:true}); }
}
test('device revocation is durable, closes subscribers immediately and preserves current session', async () => {
  const r = await fixture(`
    a.setSessionHooks({isRevoked:s.isRevoked,touch:(id,c,p)=>s.touchSession(id,{username:p.username,expiresAt:p.exp*1000,ua:c.req.header('user-agent')||'',ip:'192.0.2.1'})});
    const one=await a.createSession('admin'),two=await a.createSession('admin');
    await s.recordSession(one,'admin','Chrome','192.0.2.1'); await s.recordSession(two,'admin','Firefox','192.0.2.2');
    const app=new Hono();app.use('/api/*',a.requireAuth);s.registerSessionRoutes(app);
    const call=(p,method='GET',body)=>app.request(p,{method,headers:{cookie:'axon_session='+one,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const list=await (await call('/api/sessions')).json();const target=list.sessions.find(x=>!x.current);
    let notified='';s.onSessionRevoked(id=>notified=id);
    const named=await call('/api/sessions/'+target.jti,'PATCH',{name:'Mi laptop'});
    const closed=await call('/api/sessions/'+target.jti+'/revoke','POST');
    const denied=await app.request('/api/sessions',{headers:{cookie:'axon_session='+two}});
    const fs=await import('node:fs/promises');const stored=JSON.parse(await fs.readFile(process.env.CONFIG_PATH.replace('config.json','sessions.json'),'utf8'));
    console.log(JSON.stringify({fullId:target.jti.length,current:list.sessions.some(x=>x.current),named:named.status,closed:closed.status,denied:denied.status,notified:notified===target.jti,durable:stored.revoked.some(x=>x.jti===target.jti),name:stored.issued.find(x=>x.jti===target.jti).name,survived:!!await a.verifySessionToken(one)}));
  `);
  expect(r).toEqual({fullId:36,current:true,named:200,closed:200,denied:401,notified:true,durable:true,name:'Mi laptop',survived:true});
});
test('verified legacy sessions enter the registry and revoke-others denies every other active token', async () => {
  const r = await fixture(`
    a.setSessionHooks({isRevoked:s.isRevoked,touch:(id,c,p)=>s.touchSession(id,{username:p.username,expiresAt:p.exp*1000,ua:'legacy',ip:'192.0.2.1'})});
    const first=await a.createSession('admin');
    const data=new TextEncoder().encode(JSON.stringify({username:'admin',exp:Date.now()/1000+3600}));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(process.env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const sig=await crypto.subtle.sign('HMAC',key,data);const legacy=btoa(String.fromCharCode(...data))+'.'+btoa(String.fromCharCode(...new Uint8Array(sig)));
    const app=new Hono();app.use('/api/*',a.requireAuth);s.registerSessionRoutes(app);
    const list=await (await app.request('/api/sessions',{headers:{cookie:'axon_session='+legacy}})).json();
    await s.recordSession(first,'admin','other');
    const closed=await (await app.request('/api/sessions/revoke-others',{method:'POST',headers:{cookie:'axon_session='+legacy}})).json();
    console.log(JSON.stringify({legacy:list.sessions.some(x=>x.current&&x.jti.startsWith('tok-')),closed:closed.revoked,otherDenied:!await a.verifySessionToken(first),legacySurvives:!!await a.verifySessionToken(legacy)}));
  `);
  expect(r).toEqual({legacy:true,closed:1,otherDenied:true,legacySurvives:true});
});
