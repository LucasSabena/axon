import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';

test('library uploads roll failed blocks back, retry once, reject unsafe sizes and preserve completed content', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-library-upload-'));
  const sourceRoot = path.dirname(new URL(import.meta.url).pathname);
  const code = `
    import assert from 'node:assert/strict';
    import {mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises';
    import {Hono} from ${JSON.stringify(path.resolve('node_modules/hono/dist/index.js'))};
    import {initHostStorage} from ${JSON.stringify(path.join(sourceRoot,'host-storage.ts'))};
    const root=process.env.AXON_QA_ROOT,media=root+'/media';
    await mkdir(media);await mkdir(root+'/library');
    await writeFile(root+'/library/state.json',JSON.stringify({roots:[media],uploadRoot:media,shareBase:'',favorites:[],collections:[],shares:[]}));
    initHostStorage(root);
    const {registerLibraryRoutes}=await import(process.env.AXON_LIBRARY_TEST_MODULE||${JSON.stringify(path.join(sourceRoot,'library.ts'))});
    const app=new Hono();registerLibraryRoutes(app);
    const init=(name,size)=>app.request('/api/library/upload/init',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,size,dir:media})});
    const put=(id,offset,body)=>app.request('/api/library/upload/'+id+'?offset='+offset,{method:'PUT',body});
    const finish=id=>app.request('/api/library/upload/'+id+'/finish',{method:'POST'});
    const u=await (await init('retry.bin',6)).json();assert.ok(u.id);
    assert.equal((await put(u.id,0,'abc')).status,200);
    let sent=false;
    const interrupted=new ReadableStream({pull(c){if(!sent){sent=true;c.enqueue(new TextEncoder().encode('de'))}else return new Promise(resolve=>setTimeout(()=>{c.error(new Error('fixture disconnect'));resolve()},30))}});
    const failed=await put(u.id,3,interrupted);assert.equal(failed.status,500);assert.equal((await failed.json()).received,3);
    assert.equal((await put(u.id,3,'def')).status,200);
    const saved=await finish(u.id);assert.equal(saved.status,200);const savedBody=await saved.json();assert.equal(await readFile(savedBody.path,'utf8'),'abcdef');
    const small=await (await init('small.bin',1)).json();assert.equal((await put(small.id,0,'ab')).status,500);
    assert.equal((await put(small.id,0,'a')).status,200);assert.equal((await finish(small.id)).status,200);
    const empty=await (await init('empty.bin',0)).json();assert.equal((await finish(empty.id)).status,200);
    assert.ok((await readdir(media)).every(f=>!f.endsWith('.axonpart')));
    for(const size of [1.5,-1,Number.MAX_SAFE_INTEGER+1])assert.equal((await init('invalid.bin',size)).status,400);
    assert.equal((await init('é'.repeat(128)+'.bin',0)).status,400);
    assert.ok((await stat(root+'/.cache/axon-library')).isDirectory());
    console.log(JSON.stringify({passed:true,retryContent:'abcdef',fixtureCache:true}));
    process.exit(0);
  `;
  try {
    const child = Bun.spawn(['bun','--no-env-file','--eval',code],{env:{...process.env,CONFIG_PATH:path.join(dir,'config.json'),AXON_QA_ROOT:dir,HOST_USER:userInfo().username,SESSION_SECRET:crypto.randomUUID()},stdout:'pipe',stderr:'pipe'});
    const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
    let out:string,error:string,status:number;
    try{[out,error,status]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);}
    finally{clearTimeout(timer);}
    expect(status,error).toBe(0);
    expect(JSON.parse(out.trim().split('\n').at(-1)!)).toEqual({passed:true,retryContent:'abcdef',fixtureCache:true});
  } finally {await rm(dir,{recursive:true,force:true});}
},20000);
