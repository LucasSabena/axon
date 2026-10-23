import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';

// Archivos works with host paths; the library tools work with item ids. /api/library/resolve is the bridge:
// it indexes files under a library folder on demand and reports everything else instead of failing silently.
test('library resolve indexes files under a root on demand and reports outside, missing and repeated paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-library-resolve-'));
  const sourceRoot = path.dirname(new URL(import.meta.url).pathname);
  const code = `
    import assert from 'node:assert/strict';
    import {mkdir,writeFile} from 'node:fs/promises';
    import {Hono} from ${JSON.stringify(path.resolve('node_modules/hono/dist/index.js'))};
    import {initHostStorage} from ${JSON.stringify(path.join(sourceRoot,'host-storage.ts'))};
    const root=process.env.AXON_QA_ROOT,media=root+'/media',outside=root+'/elsewhere';
    await mkdir(media);await mkdir(outside);await mkdir(root+'/library');
    await writeFile(root+'/library/state.json',JSON.stringify({roots:[media],uploadRoot:media+'/subidas',shareBase:'',favorites:[],collections:[],shares:[]}));
    await writeFile(media+'/nota.txt','hola');await writeFile(media+'/dato.xyz','bytes');await writeFile(outside+'/foto.jpg','jpg');await writeFile(outside+'/.env','x');
    initHostStorage(root);
    const {registerLibraryRoutes}=await import(process.env.AXON_LIBRARY_TEST_MODULE||${JSON.stringify(path.join(sourceRoot,'library.ts'))});
    const app=new Hono();registerLibraryRoutes(app);
    const resolve=paths=>app.request('/api/library/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({paths})});
    const first=await (await resolve([media+'/nota.txt',media+'/dato.xyz',outside+'/foto.jpg',media+'/falta.jpg'])).json();
    assert.equal(first.ok,true);
    assert.equal(first.items.find(i=>i.n==='nota.txt').k,'doc');
    assert.equal(first.items.find(i=>i.n==='dato.xyz').k,'other');
    assert.deepEqual(first.items.map(i=>i.n).sort(),['dato.xyz','foto.jpg','nota.txt']);
    assert.deepEqual(first.outside,[]);
    assert.deepEqual(first.missing,[media+'/falta.jpg']);
    const again=await (await resolve([media+'/nota.txt',media+'/nota.txt'])).json();
    assert.equal(again.items.length,1);
    assert.equal(again.items[0].id,first.items.find(i=>i.n==='nota.txt').id);
    const lookup=await (await app.request('/api/library/lookup?p='+encodeURIComponent(media+'/dato.xyz'))).json();
    assert.equal(lookup.item.n,'dato.xyz');
    assert.equal((await resolve([])).status,400);
    assert.equal((await resolve(['../../etc/passwd'])).status,200);
    const escape=await (await resolve(['/proc/self/environ',outside+'/.env'])).json();
    assert.deepEqual(escape.items,[]);assert.equal(escape.outside.length,2);
    console.log(JSON.stringify({passed:true}));
    process.exit(0);
  `;
  try {
    const child = Bun.spawn(['bun', '--no-env-file', '--eval', code], { env: { ...process.env, CONFIG_PATH: path.join(dir, 'config.json'), AXON_QA_ROOT: dir, HOST_USER: userInfo().username, SESSION_SECRET: crypto.randomUUID() }, stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    let out: string, error: string, status: number;
    try { [out, error, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); }
    finally { clearTimeout(timer); }
    expect(status, error).toBe(0);
    expect(JSON.parse(out.trim().split('\n').at(-1)!)).toEqual({ passed: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 20000);
