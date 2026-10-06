import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { browserWriteGuard, requestOriginAllowed, safePairTarget } from './browser-security';

test('pairing targets remain local without losing proxy paths, query strings and hash',()=>{
  for(const path of ['/','/p/4321/?autoconnect=true&path=p/4321/websockify','/archivos?path=%2Fhome%2Fbinary','/biblioteca#video'])expect(safePairTarget(path)).toBe(path);
  for(const path of ['//evil.example','///evil.example','/\\evil.example','https://evil.example','/\nevil.example','\t//evil.example'])expect(safePairTarget(path)).toBe('/');
  expect(safePairTarget('/%2f%2fevil.example')).toBe('/%2f%2fevil.example');
});
test('browser writes and websocket origins match the public origin including port and TLS proxy',()=>{
  const req=(headers:Record<string,string>)=>new Request('http://127.0.0.1:3457/api/config',{headers});
  expect(requestOriginAllowed(req({origin:'https://axon.example.com',host:'axon.example.com','x-forwarded-proto':'https'}))).toBe(true);
  expect(requestOriginAllowed(req({origin:'http://127.0.0.1:3457'}))).toBe(true);
  for(const origin of ['null','https://evil.example','http://127.0.0.1:3458','http://127.0.0.1:3457/path'])expect(requestOriginAllowed(req({origin}))).toBe(false);
  expect(requestOriginAllowed(req({'sec-fetch-site':'cross-site'}))).toBe(false);
  expect(requestOriginAllowed(req({}))).toBe(true);
});
test('unsafe methods are guarded before handlers, same-origin actions and API clients remain usable',async()=>{
  const app=new Hono();app.use('/api/*',browserWriteGuard);let writes=0;
  app.post('/api/action',c=>{writes++;return c.json({ok:true});});app.get('/api/action',c=>c.json({ok:true}));
  expect((await app.request('http://axon.local/api/action',{method:'POST',headers:{origin:'https://evil.example'}})).status).toBe(403);
  expect(writes).toBe(0);
  for(const headers of [{origin:'http://axon.local'},{}])expect((await app.request('http://axon.local/api/action',{method:'POST',headers})).status).toBe(200);
  expect(writes).toBe(2);
  expect((await app.request('http://axon.local/api/action',{headers:{origin:'https://evil.example'}})).status).toBe(200);
});
