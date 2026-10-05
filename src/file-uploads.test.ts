import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { registerFilesRoutes } from './files';

let app: Hono;
let dir: string;
const active = new Set<string>();
beforeEach(async () => {
  dir = await mkdtemp(tmpdir() + '/axon-upload-test-');
  app = new Hono();
  registerFilesRoutes(app);
});
afterEach(async () => {
  for (const id of active) await app.request(`/api/files/upload/${id}`, { method: 'DELETE' });
  active.clear();
  await rm(dir, { recursive: true, force: true });
});
async function init(name: string, size: number, target = dir) {
  const r = await app.request('/api/files/upload/init', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: target, name, size }),
  });
  const data = await r.json();
  if (data.id) active.add(data.id);
  return { r, ...data };
}
const chunk = (id: string, offset: number, body: BodyInit) => app.request(`/api/files/upload/${id}?offset=${offset}`, { method: 'PUT', body });
const finish = (id: string) => app.request(`/api/files/upload/${id}/finish`, { method: 'POST' });

test('uploads 72 MiB in bounded requests and preserves every byte', async () => {
  const size = 72 * 1024 * 1024;
  const u = await init('video.mp4', size);
  expect(u.r.status).toBe(200);
  const expected = createHash('sha256');
  for (let off = 0; off < size; off += u.chunkSize) {
    const bytes = Buffer.alloc(u.chunkSize, off / u.chunkSize);
    expected.update(bytes);
    const r = await chunk(u.id, off, bytes);
    expect(r.status).toBe(200);
    expect((await r.json()).received).toBe(off + u.chunkSize);
  }
  expect((await finish(u.id)).status).toBe(200);
  const file = Bun.file(dir + '/video.mp4');
  expect(file.size).toBe(size);
  const actual = createHash('sha256');
  for await (const bytes of file.stream()) actual.update(bytes);
  expect(actual.digest('hex')).toBe(expected.digest('hex'));
  expect(await readdir(dir)).toEqual(['video.mp4']);
});

test('retries a lost acknowledgement without appending the block twice', async () => {
  const u = await init('retry.bin', 6);
  expect((await chunk(u.id, 0, 'abc')).status).toBe(200);
  const retry = await chunk(u.id, 0, 'abc');
  expect(retry.status).toBe(409);
  expect((await retry.json()).received).toBe(3);
  expect((await finish(u.id)).status).toBe(400);
  expect((await chunk(u.id, 3, 'def')).status).toBe(200);
  expect((await finish(u.id)).status).toBe(200);
  expect((await finish(u.id)).status).toBe(200);
  expect(await readFile(dir + '/retry.bin', 'utf8')).toBe('abcdef');
});

test('consumes the retry body before replying through the proxy', async () => {
  const u = await init('retry.bin', 6);
  await chunk(u.id, 0, 'abc');
  let consumed = 0;
  const retry = new ReadableStream({
    pull(c) {
      consumed++;
      if (consumed <= 3) c.enqueue(new Uint8Array([97]));
      else c.close();
    },
  });
  expect((await chunk(u.id, 0, retry)).status).toBe(409);
  expect(consumed).toBe(4);
  expect((await chunk(u.id, 3, 'def')).status).toBe(200);
  expect((await finish(u.id)).status).toBe(200);
  expect(await readFile(dir + '/retry.bin', 'utf8')).toBe('abcdef');
});

test('failed streams roll back to the last acknowledged block', async () => {
  const u = await init('retry.bin', 6);
  await chunk(u.id, 0, 'abc');
  const stream = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('de')); },
    pull(c) { c.error(new Error('connection lost')); },
  });
  const r = await chunk(u.id, 3, stream);
  expect(r.status).toBe(500);
  expect((await r.json()).received).toBe(3);
  expect((await chunk(u.id, 3, 'def')).status).toBe(200);
  expect((await finish(u.id)).status).toBe(200);
  expect(await readFile(dir + '/retry.bin', 'utf8')).toBe('abcdef');
});

test('cancelled overwrite preserves the original and removes temporary files', async () => {
  await writeFile(dir + '/existing.mp4', 'original');
  const u = await init('existing.mp4', 6);
  await chunk(u.id, 0, 'abc');
  expect(await readFile(dir + '/existing.mp4', 'utf8')).toBe('original');
  expect((await app.request(`/api/files/upload/${u.id}`, { method: 'DELETE' })).status).toBe(200);
  expect(await readdir(dir)).toEqual(['existing.mp4']);
  expect(await readFile(dir + '/existing.mp4', 'utf8')).toBe('original');
  expect((await finish(u.id)).status).toBe(404);
});

test('overwrite commits only after all bytes arrive, including empty files and nested folders', async () => {
  await writeFile(dir + '/existing.mp4', 'original');
  const u = await init('existing.mp4', 3);
  await chunk(u.id, 0, 'new');
  expect(await readFile(dir + '/existing.mp4', 'utf8')).toBe('original');
  expect((await finish(u.id)).status).toBe(200);
  expect(await readFile(dir + '/existing.mp4', 'utf8')).toBe('new');
  const empty = await init('empty.txt', 0, dir + '/nested/folder');
  expect((await finish(empty.id)).status).toBe(200);
  expect((await stat(dir + '/nested/folder/empty.txt')).size).toBe(0);
});

test('rejects oversized blocks, extra bytes, unsafe sizes, and invalid paths', async () => {
  const u = await init('blocks.bin', 10 * 1024 * 1024);
  expect((await chunk(u.id, 0, Buffer.alloc(u.chunkSize + 1))).status).toBe(500);
  expect((await chunk(u.id, 0, 'abc')).status).toBe(200);
  const small = await init('small.bin', 1);
  expect((await chunk(small.id, 0, 'ab')).status).toBe(500);
  expect((await chunk(small.id, 0, 'a')).status).toBe(200);
  expect((await finish(small.id)).status).toBe(200);
  expect((await init('../escape', 0)).r.status).toBe(400);
  expect((await init('bad', 1.5)).r.status).toBe(400);
  expect((await init('bad', -1)).r.status).toBe(400);
  expect((await init('bad', Number.MAX_SAFE_INTEGER + 1)).r.status).toBe(400);
  expect((await init('bad', 0, '/bin')).r.status).toBe(403);
});

test('serializes writes and waits for an active block before cancellation', async () => {
  const u = await init('concurrent.bin', 6);
  let controller!: ReadableStreamDefaultController;
  let started!: () => void;
  const ready = new Promise<void>((r) => { started = r; });
  const body = new ReadableStream({ start(c) { controller = c; }, pull() { started(); } });
  const first = chunk(u.id, 0, body);
  await ready;
  expect((await chunk(u.id, 0, 'def')).status).toBe(409);
  expect((await finish(u.id)).status).toBe(409);
  const cancel = app.request(`/api/files/upload/${u.id}`, { method: 'DELETE' });
  controller.enqueue(new TextEncoder().encode('abc'));
  controller.close();
  await first;
  expect((await cancel).status).toBe(200);
  expect(await readdir(dir)).toEqual([]);
});

test('rechecks symlink destinations at completion', async () => {
  const u = await init('video.mp4', 3);
  await chunk(u.id, 0, 'abc');
  await symlink('/etc/hostname', dir + '/video.mp4');
  expect((await finish(u.id)).status).toBe(403);
});
