import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileTreeSize } from './file-sizes';
import type { HostResult } from './host';

test('directory totals include nested private data, without following symlinks or executing path text', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'axon-size-'));
  try {
    const dir = path.join(root, "private '\n$(false)");
    await mkdir(dir, { mode: 0o700 });
    await writeFile(path.join(dir, 'data'), Buffer.alloc(2 ** 20), { mode: 0o600 });
    await writeFile(path.join(root, 'outside'), Buffer.alloc(2 ** 20));
    await symlink(path.join(root, 'outside'), path.join(dir, 'link'));
    const total = await fileTreeSize(dir);
    expect(total).toBeGreaterThanOrEqual(2 ** 20);
    expect(total).toBeLessThan((2 ** 20) + 4096); // no data from the linked file
    expect(await fileTreeSize(dir, true)).toBeGreaterThanOrEqual(2 ** 20);
    await expect(fileTreeSize(path.join(root, 'missing'))).rejects.toThrow('tamaño completo');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('partial, missing and invalid du output can never become a successful total', async () => {
  for (const [code, stdout] of [[1, '155\t/private\n'], [124, '155\t/private\n'], [0, ''], [0, 'bad\t/private'], [0, '999999999999999999999\t/private']] as const) {
    const run = async (): Promise<HostResult> => ({ ok: code === 0, code, stdout, stderr: 'denied', command: '' });
    await expect(fileTreeSize('/private', false, run)).rejects.toThrow('tamaño completo');
  }
});
