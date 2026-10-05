import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { registerFilesRoutes } from './files';

let app: Hono;
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(tmpdir() + '/axon-create-test-');
  app = new Hono(); registerFilesRoutes(app);
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const post = (url: string, body: unknown) => app.request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const create = (name: string, folder = dir) => post('/api/files/create', { path: folder, name });

test('creates arbitrary extensions and dotfiles, edits UTF-8 text, and lists them', async () => {
  await mkdir(dir + '/nested');
  for (const name of ['notas.txt', '.env', '.env.local', 'config.json', 'custom.abc', 'Dockerfile', '-archivo', 'ñ.txt']) {
    const response = await create(name, dir + '/nested');
    expect(response.status).toBe(201);
    const file = (await response.json()).path;
    expect((await stat(file)).size).toBe(0);
    expect((await stat(file)).mode & 0o777).toBe(name.startsWith('.env') ? 0o600 : 0o644);
    const content = 'NOMBRE=Producción\nURL=https://ejemplo.test\n';
    const previous=await (await app.request('/api/files/read?path='+encodeURIComponent(file))).json();
    expect((await post('/api/files/write', { path: file, content,revision:previous.revision })).status).toBe(200);
    const read = await (await app.request('/api/files/read?path=' + encodeURIComponent(file))).json();
    expect(read.content).toBe(content); expect(read.binary).toBe(false); expect(read.truncated).toBe(false);
    expect(await readFile(file, 'utf8')).toBe(content);
  }
  const listing = await (await app.request('/api/files?path=' + encodeURIComponent(dir + '/nested'))).json();
  expect(listing.entries).toHaveLength(8);
  expect(listing.entries.some((e: { name: string }) => e.name === '.env')).toBe(true);
  expect((await readdir(dir + '/nested')).some(name => name.startsWith('.axon-new.'))).toBe(false);
});

test('creation never overwrites existing files, directories, or symlinks, including simultaneous requests', async () => {
  await writeFile(dir + '/original.txt', 'keep'); await mkdir(dir + '/folder');
  await symlink('original.txt', dir + '/link'); await symlink('missing', dir + '/broken');
  for (const name of ['original.txt', 'folder', 'link', 'broken']) expect((await create(name)).status).toBe(409);
  expect(await readFile(dir + '/original.txt', 'utf8')).toBe('keep');
  expect(await Bun.file(dir + '/missing').exists()).toBe(false);
  const responses = await Promise.all([create('racing.txt'), create('racing.txt')]);
  expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
  expect((await readdir(dir)).some(name => name.startsWith('.axon-new.'))).toBe(false);
});

test('validates destination and filename without executing shell syntax', async () => {
  for (const name of ['', ' ', '.', '..', '../escape', 'a/b', 'a\\b', 'bad\nname', 'a\0b', 'é'.repeat(128)]) {
    expect((await create(name)).status).toBe(400);
  }
  expect((await create('a', '/bin')).status).toBe(403);
  expect((await create('a', dir + '/missing')).status).toBe(404);
  await writeFile(dir + '/file', 'keep'); expect((await create('a', dir + '/file')).status).toBe(400);
  await symlink('/bin', dir + '/escape'); expect((await create('a', dir + '/escape')).status).toBe(403);
  expect((await post('/api/files/create', { path: [dir], name: 'a' })).status).toBe(400);
  const literal = "a'$(touch injected);.txt";
  expect((await create(literal)).status).toBe(201);
  expect(await readFile(dir + '/' + literal, 'utf8')).toBe('');
  expect(await Bun.file(dir + '/injected').exists()).toBe(false);
});

test('text reads flag binary or invalid UTF-8 and preserve a UTF-8 BOM', async () => {
  for (const bytes of [Buffer.from([65, 0, 66]), Buffer.from([65, 0xff, 66]), Buffer.from([1, 2, 3])]) {
    await writeFile(dir + '/binary.abc', bytes);
    const read = await (await app.request('/api/files/read?path=' + encodeURIComponent(dir + '/binary.abc'))).json();
    expect(read.binary).toBe(true);
  }
  const original = '\uFEFFCLAVE=ejemplo\r\n';
  await writeFile(dir + '/bom.env', original);
  const read = await (await app.request('/api/files/read?path=' + encodeURIComponent(dir + '/bom.env'))).json();
  expect(read.binary).toBe(false); expect(read.content).toBe(original);
  expect((await post('/api/files/write', { path: dir + '/bom.env', content: read.content,revision:read.revision })).status).toBe(200);
  expect(await readFile(dir + '/bom.env', 'utf8')).toBe(original);
});


test('server editing rejects stale content and never overwrites an arriving file',async()=>{
  const file=dir+'/shared.txt';await writeFile(file,'before');const first=await (await app.request('/api/files/read?path='+encodeURIComponent(file))).json();
  await writeFile(file,'changed elsewhere');expect((await post('/api/files/write',{path:file,content:'stale edit',revision:first.revision})).status).toBe(409);expect(await readFile(file,'utf8')).toBe('changed elsewhere');
  const fresh=await (await app.request('/api/files/read?path='+encodeURIComponent(file))).json();const writes=await Promise.all([post('/api/files/write',{path:file,content:'one',revision:fresh.revision}),post('/api/files/write',{path:file,content:'two',revision:fresh.revision})]);expect(writes.map(r=>r.status).sort()).toEqual([200,409]);
  expect((await post('/api/files/write',{path:file,content:'arriving',revision:'missing'})).status).toBe(409);expect(['one','two']).toContain(await readFile(file,'utf8'));
});
