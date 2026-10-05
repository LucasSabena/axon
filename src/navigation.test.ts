import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { SECTIONS, readRoute, routeUrl, readStored } from '../public/navigation-model.js';
import { registerNavigationRoutes } from './navigation';

describe('Axon navigation contract', () => {
  test('every section has a unique reloadable route, including trailing slash', async () => {
    const app=new Hono(); registerNavigationRoutes(app);
    expect(new Set(Object.values(SECTIONS).map(([p])=>p)).size).toBe(Object.keys(SECTIONS).length);
    for(const [section,[p]] of Object.entries(SECTIONS)) {
      for(const suffix of p==='/'?['']:['','/']) {
        const response=await app.request(p+suffix+'?q=video');
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(await response.text()).toContain('navigation.js');
        expect(readRoute(p+suffix)?.section).toBe(section);
      }
    }
  });
  test('missing APIs, assets, proxy and share links remain 404',async()=>{
    const app=new Hono(); registerNavigationRoutes(app);
    for(const p of ['/api/missing','/missing.js','/s/missing','/p/3000','/archivos/missing','/unknown'])expect((await app.request(p)).status).toBe(404);
  });
  test('folder, file, search and collection names round trip without becoming URL syntax',()=>{
    const params={path:'/home/user/Diseño & videos/#1',item:'¿sí o no? + 100%.mp4',q:'a/b&c=#',hidden:'0',empty:null};
    const route=readRoute(routeUrl('files',params));
    expect(route?.section).toBe('files');
    expect(route?.params).toEqual({path:params.path,item:params.item,q:params.q,hidden:'0'});
    expect(readRoute('/biblioteca/?type=col&value=Campa%C3%B1a')?.params.value).toBe('Campaña');
    expect(readRoute('/api/files')).toBeNull();
  });
  test('corrupt or wrong-shaped persisted state does not break navigation',()=>{
    for(const input of ['broken','null','[]','5'])expect(readStored(input)).toEqual({});
    expect(readStored('{"files":{"url":"/archivos"}}')).toEqual({files:{url:'/archivos'}});
  });
});
