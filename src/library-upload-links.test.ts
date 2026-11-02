import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';

test('upload-only folder links hide the folder, stream resumable files and enforce password, limits and revocation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-upload-links-'));
  const sourceRoot = path.dirname(new URL(import.meta.url).pathname);
  const code = `
    import assert from 'node:assert/strict';
    import {mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises';
    import {Hono} from ${JSON.stringify(path.resolve('node_modules/hono/dist/index.js'))};
    import {initHostStorage} from ${JSON.stringify(path.join(sourceRoot, 'host-storage.ts'))};
    const root=process.env.AXON_QA_ROOT,media=root+'/media',inbox=media+'/entregas';
    await mkdir(inbox,{recursive:true});await mkdir(root+'/library');
    await writeFile(inbox+'/secreto.txt','contenido privado que el visitante no debe ver');
    await writeFile(root+'/library/state.json',JSON.stringify({roots:[media],uploadRoot:media,shareBase:'',favorites:[],collections:[],shares:[],uploadLinks:[]}));
    initHostStorage(root);
    const {registerLibraryRoutes}=await import(${JSON.stringify(path.join(sourceRoot, 'library.ts'))});
    const app=new Hono();registerLibraryRoutes(app);
    const json=async r=>({status:r.status,body:await r.json()});
    const create=body=>app.request('/api/library/upload-links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({folder:inbox,...body})});
    const init=(lid,name,size,cookie='')=>app.request('/u/'+lid+'/up/init',{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({name,size})});
    const put=(lid,uid,offset,body,cookie='')=>app.request('/u/'+lid+'/up/'+uid+'?offset='+offset,{method:'PUT',...(cookie?{headers:{cookie}}:{}),body});
    const finish=(lid,uid,cookie='')=>app.request('/u/'+lid+'/up/'+uid+'/finish',{method:'POST',headers:cookie?{cookie}:{}});

    const made=await json(await create({title:'Entregas del cliente',msg:'Pasame el video original, gracias.'}));
    assert.equal(made.status,200);
    const link=made.body.link;
    assert.ok(link.id && link.url.endsWith('/u/'+link.id));
    assert.equal(link.folderName,'entregas');
    assert.equal(link.filesReceived,0);

    // The public page is an upload area only: no folder listing, no existing
    // file names, no download links.
    const page=await app.request('/u/'+link.id);
    assert.equal(page.status,200);
    const html=await page.text();
    assert.ok(html.includes('Entregas del cliente'));
    assert.ok(html.includes('Arrastrá tus archivos acá'));
    assert.ok(html.includes('solo se pueden subir archivos'));
    assert.ok(!html.includes('secreto.txt'));
    assert.ok(!html.includes('contenido privado'));
    assert.ok(!/\\/f\\/|\\/zip|Descargar/.test(html));

    // Chunked upload with an interrupted block: the server rolls back to the
    // last acknowledged offset and the retry continues from there.
    const six=await json(await init(link.id,'video.mp4',6));
    assert.equal(six.status,200);assert.equal(six.body.chunkSize,16*1024*1024);
    assert.equal((await put(link.id,six.body.id,0,'abc')).status,200);
    const status=await json(await app.request('/u/'+link.id+'/up/'+six.body.id));
    assert.equal(status.body.received,3);
    let sent=false;
    const interrupted=new ReadableStream({pull(c){if(!sent){sent=true;c.enqueue(new TextEncoder().encode('de'))}else return new Promise(resolve=>setTimeout(()=>{c.error(new Error('fixture disconnect'));resolve()},30))}});
    const failed=await put(link.id,six.body.id,3,interrupted);
    assert.equal(failed.status,500);
    assert.equal((await failed.json()).received,3);
    assert.equal((await put(link.id,six.body.id,3,'def')).status,200);
    const saved=await json(await finish(link.id,six.body.id));
    assert.equal(saved.status,200);assert.equal(saved.body.name,'video.mp4');assert.equal(saved.body.size,6);
    assert.equal(await readFile(inbox+'/video.mp4','utf8'),'abcdef');
    // Finishing again is idempotent — a lost response can be retried safely.
    const again=await json(await finish(link.id,six.body.id));
    assert.equal(again.status,200);assert.equal(again.body.name,'video.mp4');

    // Same name never overwrites: the second copy gets a suffix.
    const dup=await json(await init(link.id,'video.mp4',2));
    assert.equal((await put(link.id,dup.body.id,0,'XY')).status,200);
    const dupDone=await json(await finish(link.id,dup.body.id));
    assert.equal(dupDone.body.name,'video (1).mp4');
    assert.equal(await readFile(inbox+'/video (1).mp4','utf8'),'XY');

    // Unsafe names and sizes never reach the filesystem.
    for(const name of ['../evil.txt','carpeta/archivo.txt','.oculto', '']) assert.equal((await init(link.id,name,1)).status,400);
    for(const size of [1.5,-1,Number.MAX_SAFE_INTEGER+1]) assert.equal((await init(link.id,'x.bin',size)).status,400);

    // Summary counts completed files and keeps a bounded recent list.
    const listed=await json(await app.request('/api/library/upload-links'));
    const summary=listed.body.links.find(l=>l.id===link.id);
    assert.equal(summary.filesReceived,2);
    assert.equal(summary.uploadedBytes,8);
    assert.deepEqual(summary.recentUploads.map(u=>u.n),['video (1).mp4','video.mp4']);

    // Password links: page + init stay closed until the cookie is set.
    const locked=await json(await create({title:'Con clave',password:'secreta',ttl:3600}));
    const lockedPage=await app.request('/u/'+locked.body.link.id);
    assert.equal(lockedPage.status,200);assert.ok((await lockedPage.text()).includes('protegida con contraseña'));
    assert.equal((await init(locked.body.link.id,'a.bin',1)).status,401);
    const wrong=await app.request('/u/'+locked.body.link.id+'/unlock',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'password=nope'});
    assert.equal(wrong.status,401);
    const right=await app.request('/u/'+locked.body.link.id+'/unlock',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'password=secreta'});
    assert.equal(right.status,303);
    const cookie=(right.headers.get('set-cookie')||'').split(';')[0];
    assert.ok(cookie.startsWith('axu_'));
    const unlocked=await app.request('/u/'+locked.body.link.id,{headers:{cookie}});
    assert.equal(unlocked.status,200);assert.ok((await unlocked.text()).includes('Arrastrá tus archivos acá'));

    // Total-size limit is enforced before creating a part file.
    const limited=await json(await create({title:'Chico',maxBytes:10}));
    assert.equal((await init(limited.body.link.id,'grande.bin',11)).status,413);

    // Cancelling removes the partial file and invalidates the session.
    const cancel=await json(await init(link.id,'cortado.bin',10));
    assert.equal((await put(link.id,cancel.body.id,0,'12345')).status,200);
    assert.equal((await app.request('/u/'+link.id+'/up/'+cancel.body.id,{method:'DELETE'})).status,200);
    assert.equal((await app.request('/u/'+link.id+'/up/'+cancel.body.id)).status,404);
    assert.ok((await readdir(inbox)).every(n=>!n.startsWith('.axon-upload.')));

    // Pausing stops both visits and uploads without deleting anything.
    const paused=await json(await app.request('/api/library/upload-links/'+link.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({active:false})}));
    assert.equal(paused.status,200);assert.equal(paused.body.link.active,false);
    assert.equal((await app.request('/u/'+link.id)).status,410);
    assert.equal((await init(link.id,'nuevo.bin',1)).status,410);
    await app.request('/api/library/upload-links/'+link.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({active:true})});
    assert.equal((await app.request('/u/'+link.id)).status,200);

    // Revoking makes the token useless; received files stay on disk.
    assert.equal((await app.request('/api/library/upload-links/'+link.id,{method:'DELETE'})).status,200);
    assert.equal((await app.request('/u/'+link.id)).status,404);
    assert.equal(await readFile(inbox+'/video.mp4','utf8'),'abcdef');
    assert.ok((await stat(inbox)).isDirectory());

    // A duplicate-name upload cannot escape through a symlinked part name or
    // the public API: only basenames are ever joined to the fixed folder.
    const inside=await readdir(inbox);
    assert.deepEqual(inside.sort(),['secreto.txt','video (1).mp4','video.mp4']);
    console.log(JSON.stringify({passed:true,files:inside}));
    process.exit(0);
  `;
  try {
    const child = Bun.spawn(['bun', '--no-env-file', '--eval', code], {
      env: {
        ...process.env,
        CONFIG_PATH: path.join(dir, 'config.json'),
        AXON_QA_ROOT: dir,
        HOST_USER: userInfo().username,
        SESSION_SECRET: crypto.randomUUID(),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 25_000);
    let out: string, error: string, status: number;
    try { [out, error, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); }
    finally { clearTimeout(timer); }
    expect(status, error).toBe(0);
    expect(JSON.parse(out.trim().split('\n').at(-1)!)).toEqual({ passed: true, files: ['secreto.txt', 'video (1).mp4', 'video.mp4'] });
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30000);
