import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendUploadBlock } from './file-uploads';
import { expect, test } from 'bun:test';
import { hostExec, ON_HOST } from './host';

test('the same host timeout applies in unprivileged development and privileged deployments', async () => {
  if (!ON_HOST) return;
  const result = await hostExec("sleep 2; printf 'late-success'", { user: 'user', timeoutMs: 100 });
  expect(result.ok).toBe(false);
  expect(result.code).toBe(124);
  expect(result.stdout).not.toContain('late-success');
}, 5000);


test('upload rejection releases its writer even when transport cancellation never settles', async () => {
  if (!ON_HOST) return;
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-writer-test-'));
  try {
    const body = new ReadableStream<Uint8Array>({start(c) {c.enqueue(new Uint8Array([1,2]));},cancel() {return new Promise<void>(() => {});}});
    await expect(appendUploadBlock(path.join(dir, 'part'), body, 1, 200)).rejects.toThrow('tamaño permitido');
  } finally { await rm(dir, {recursive:true,force:true}); }
}, 3000);

test('a stalled upload reader times out and releases the writer', async () => {
  if (!ON_HOST) return;
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-writer-test-'));
  try {
    const body = new ReadableStream<Uint8Array>({pull() {return new Promise<void>(() => {});}});
    await expect(appendUploadBlock(path.join(dir, 'part'), body, 1, 100)).rejects.toThrow('tardó demasiado');
  } finally { await rm(dir, {recursive:true,force:true}); }
}, 3000);
