import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('service worker never substitutes an old release shell or script, and only retires AXON caches', async () => {
  const handlers = new Map<string, Function>(), deleted: string[] = [], matches: string[] = [], network: any[] = [];
  let status = 502;
  const caches = {
    keys: async () => ['axon-old', 'other-app'],
    delete: async (key: string) => {deleted.push(key);return true;},
    match: async () => new Response('stale app'),
    open: async (name: string) => ({match: async () => {matches.push(name);return new Response('current vendor');}}),
  };
  runInNewContext(await readFile('public/sw.js','utf8'), {
    URL, Response, location:{origin:'https://axon.test'}, caches, clients:{claim:async()=>{}},
    self:{addEventListener:(event:string,handler:Function)=>handlers.set(event,handler),skipWaiting:async()=>{}},
    fetch:async(req:any,opts:any)=>{network.push({url:req.url,opts});return new Response('network',{status});},
  });
  let task: Promise<Response>;
  const request = (pathname:string,mode='cors') => handlers.get('fetch')!({request:{url:'https://axon.test'+pathname,method:'GET',mode},respondWith:(p:Promise<Response>)=>task=p});
  request('/proyectos','navigate');
  const response = await task!;
  expect(response.status).toBe(503);
  const html = await response.text();
  expect(html).toContain('location.reload()');expect(html).toContain('</script>');expect(html).not.toContain('stale app');
  status=200;request('/app.js?v=123456789abc');
  expect(await (await task!).text()).toBe('network');expect(network.at(-1).opts.cache).toBe('no-store');
  request('/vendor/lib.js');expect(await (await task!).text()).toBe('network');
  request('/vendor/lib.js?v=123456789abc');expect(await (await task!).text()).toBe('current vendor');
  expect(matches).toHaveLength(1);expect(matches[0]).toMatch(/^axon-/);
  let activation:Promise<unknown>;handlers.get('activate')!({waitUntil:(p:Promise<unknown>)=>activation=p});await activation!;
  expect(deleted).toContain('axon-old');expect(deleted).not.toContain('other-app');
});
