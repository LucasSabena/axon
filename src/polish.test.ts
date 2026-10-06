import { describe, expect, test, afterAll } from 'bun:test';
import { SnapshotCache } from './snapshot-cache';
import { validateSettings } from './settings-validation';
import { safeArchiveRoot } from './agent-archives';
import { notify, setNotifyUrl } from './notify';
import { detectPrograms } from './programs';
import '../public/request-client.js';

const client = (globalThis as any).AxonRequestClient.create;
const deferred = <T>() => { let resolve!: (v:T)=>void; const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}; };
const json = (data:unknown, status=200) => Response.json(data,{status});

describe('shared request contract', () => {
  test('HTML restart responses produce a useful error, release feedback and can be retried without expiring auth', async () => {
    let calls=0, ended=0, expired=0;
    const transport=client({fetcher:(_p,opts)=>{
      expect(opts.cache).toBe('no-store');
      return Promise.resolve(++calls===1?new Response('<html>Restarting</html>',{status:502}):json({ok:true}));
    },onStart:()=>()=>ended++,onAuth:()=>expired++});
    await expect(transport.request('/api/data')).rejects.toThrow('respuesta incompleta');
    expect(ended).toBe(1);expect(expired).toBe(0);
    expect(await transport.request('/api/data')).toEqual({ok:true});
    expect(ended).toBe(2);
  });
  test('simultaneous reads share a flight and a failed flight can be retried', async () => {
    let calls=0;const pending=deferred<Response>();
    const transport=client({fetcher:()=>{calls++;return calls===1?pending.promise:Promise.resolve(json({value:2}));}});
    const a=transport.request('/api/data'), b=transport.request('/api/data');
    expect(calls).toBe(1);pending.resolve(json({error:'Unavailable'},502));
    const result=await Promise.allSettled([a,b]);expect(result.every(r=>r.status==='rejected')).toBe(true);
    expect(await transport.request('/api/data')).toEqual({value:2});expect(calls).toBe(2);
  });
  test('a successful mutation prevents an older read from refilling the cache', async () => {
    const old=deferred<Response>();let reads=0;
    const transport=client({fetcher:(_p:string,opts:RequestInit)=>opts.method==='POST'?Promise.resolve(json({ok:true})):++reads===1?old.promise:Promise.resolve(json({value:'new'}))});
    const previous=transport.request('/api/data',{cacheMs:1000});
    await transport.request('/api/write',{method:'POST',body:{value:'new'}});
    expect(await transport.request('/api/data',{cacheMs:1000})).toEqual({value:'new'});
    old.resolve(json({value:'old'}));await previous;
    expect(await transport.request('/api/data',{cacheMs:1000})).toEqual({value:'new'});
  });
  test('transient errors retain authentication and only a 401 expires the session', async () => {
    let status=502, expired=0;const transport=client({fetcher:()=>Promise.resolve(json({error:'failure'},status)),onAuth:()=>expired++});
    await expect(transport.request('/api/a')).rejects.toThrow('failure');expect(expired).toBe(0);
    status=401;await expect(transport.request('/api/a')).rejects.toThrow('failure');expect(expired).toBe(1);
  });
  test('busy feedback is released on transport errors', async () => {
    let starts=0, ends=0;
    const transport=client({fetcher:()=>Promise.reject(new Error('offline')),onStart:()=>{starts++;return()=>ends++;}});
    await expect(transport.request('/api/a')).rejects.toThrow('Sin conexión');expect(starts).toBe(1);expect(ends).toBe(1);
  });
  test('each action tracks its wait even when requests share a flight', async () => {
    let starts=0, ends=0, calls=0;const pending=deferred<Response>();
    const transport=client({fetcher:()=>{calls++;return pending.promise;},onStart:()=>{starts++;return()=>ends++;}});
    const a=transport.request('/api/a'),b=transport.request('/api/a');
    expect(calls).toBe(1);expect(starts).toBe(2);expect(ends).toBe(0);
    pending.resolve(json({ok:true}));await Promise.all([a,b]);expect(ends).toBe(2);
  });
});

describe('server snapshots', () => {
  test('the first programs snapshot uses installation probes without waiting for CLI metadata', async () => {
    const commands:string[]=[];
    const views=await detectPrograms(false,false,async command=>{commands.push(command);return {ok:command==='command -v codex',code:0,stdout:'',stderr:'',command};});
    const codex=views.find(p=>p.id==='codex')!;
    expect(codex.installed).toBe(true);expect(codex.metadataPending).toBe(true);expect(codex.version).toBeUndefined();
    expect(views.find(p=>p.id==='claude-code')?.metadataPending).toBe(false);
    expect(commands.some(c=>c.includes('--version')||c.includes('pnpm view')||c.includes('snap list'))).toBe(false);
  });
  test('deduplicates reads, expires data and isolates invalidated flights', async () => {
    let time=0;const cache=new SnapshotCache<string>(100,4,()=>time), old=deferred<string>();let calls=0;
    const read=()=>{calls++;return old.promise;};const first=cache.get('agent',read), same=cache.get('agent',read);
    await Promise.resolve();expect(calls).toBe(1);cache.clear();expect(await cache.get('agent',async()=>'new')).toBe('new');
    old.resolve('old');expect(await first).toBe('old');expect(await same).toBe('old');
    expect(await cache.get('agent',async()=>'wrong')).toBe('new');time=101;expect(await cache.get('agent',async()=>'fresh')).toBe('fresh');
  });
});

describe('settings and residual safety', () => {
  test('rejects invalid intervals, ports, paths, users and protocols', () => {
    for(const input of [{scanIntervalMs:0},{scanIntervalMs:100000},{protectedPorts:[-1,70000]},{scanDirs:['relative']},{hostUser:'x;rm'},{notifyUrl:'javascript:alert(1)'},{knownServices:{'99999':{name:'x'}}},{arbitrary:true}]) expect(()=>validateSettings(input)).toThrow();
    expect(validateSettings({scanIntervalMs:5000,hostUser:'binary',protectedPorts:[22,3457],scanDirs:['/tmp/qa'],notifyUrl:''})).toMatchObject({scanIntervalMs:5000});
  });
  test('never archives a home, shared configuration root or traversal path', () => {
    for(const root of ['/home/test','/home/test/.agents','/home/test/.config','/home/test/.local/share','/home/test/../else','/etc','/home/test/.local/share/axon/agent-archives']) expect(safeArchiveRoot(root,'/home/test')).toBe(false);
    expect(safeArchiveRoot('/home/test/.config/residual','/home/test')).toBe(true);
  });
});

describe('webhook delivery', () => {
  const requests: {headers:Headers;body:string}[]=[];
  let status=200;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){requests.push({headers:req.headers,body:await req.text()});return new Response('ok',{status});}});
  afterAll(()=>{setNotifyUrl('');server.stop(true);});
  test('sends UTF-8 titles safely and a plain ntfy message', async () => {
    setNotifyUrl(`http://127.0.0.1:${server.port}/topic`);
    await notify('Axon — actualización ✅','Prueba de notificación',3,true);
    expect(requests.at(-1)?.body).toBe('Prueba de notificación');
    expect(requests.at(-1)?.headers.get('Title')).toBe(`=?UTF-8?B?${Buffer.from('Axon — actualización ✅').toString('base64')}?=`);
  });
  test('reports delivery failures when testing, and keeps background delivery best-effort', async () => {
    status=503;await expect(notify('Title','body',3,true)).rejects.toThrow('HTTP 503');await notify('Title','body');
  });
  test('explicit providers work on custom domains and use their own payload', async () => {
    status=200;setNotifyUrl(`http://127.0.0.1:${server.port}/message?token=fixture`,'gotify');
    await notify('Título','Mensaje',4,true);
    expect(JSON.parse(requests.at(-1)!.body)).toEqual({title:'Título',message:'Mensaje',priority:4});
    setNotifyUrl(`http://127.0.0.1:${server.port}/fixture`,'discord');await notify('Título','Mensaje',3,true);
    expect(JSON.parse(requests.at(-1)!.body)).toEqual({content:'**Título**\nMensaje'});
  });
});
