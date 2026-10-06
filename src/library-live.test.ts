import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { LibraryLiveWatch, libraryFileVersion } from './library-live';

async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check() && Date.now() < deadline) await Bun.sleep(20);
  expect(check()).toBe(true);
}

test('source version detects equal-size in-place writes with restored mtime and atomic replacements', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-library-version-'));
  try {
    const file = path.join(dir, 'video.mp4');
    await writeFile(file, 'old'); const before = await stat(file);
    await Bun.sleep(10); await writeFile(file, 'new'); await utimes(file, before.atime, before.mtime);
    const after = await stat(file);
    expect(after.size).toBe(before.size); expect(after.ino).toBe(before.ino);
    expect(libraryFileVersion(after)).not.toBe(libraryFileVersion(before));
    await writeFile(path.join(dir, 'export.mp4'), 'alt');
    await rename(path.join(dir, 'export.mp4'), file);
    expect(libraryFileVersion(await stat(file))).not.toBe(libraryFileVersion(after));
    expect(libraryFileVersion(after)).toBe(libraryFileVersion(after));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('directory watches observe overwrite, atomic saves, additions and deletions without rescanning', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-library-watch-'));
  const seen: string[] = [];
  const watcher = new LibraryLiveWatch(p => p, async paths => { seen.push(...paths || []); }, 30);
  try {
    const file = path.join(dir, 'same.mp4'); await writeFile(file, 'old');
    await watcher.sync(new Set([dir]));
    await writeFile(file, 'new'); await until(() => seen.includes(file)); seen.length = 0;
    const temp = path.join(dir, '.export'); await writeFile(temp, 'alt'); await rename(temp, file);
    await until(() => seen.includes(file)); seen.length = 0;
    const added = path.join(dir, 'added.wav'); await writeFile(added, 'audio');
    await until(() => seen.includes(added)); seen.length = 0;
    await unlink(file); await until(() => seen.includes(file));
    watcher.close(); seen.length = 0; await writeFile(added, 'again'); await Bun.sleep(100);
    expect(seen).toEqual([]);
  } finally { watcher.close(); await rm(dir, { recursive: true, force: true }); }
});

test('resync follows replaced directories and closes removed roots', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-library-dir-'));
  let seen: string[] = [];
  const watcher = new LibraryLiveWatch(p => p, async paths => { seen.push(...paths || []); }, 30);
  try {
    const sub = path.join(dir, 'renders'); await mkdir(sub); await watcher.sync(new Set([sub]));
    await rename(sub, sub + '-old'); await mkdir(sub); await watcher.sync(new Set([sub]));
    const file = path.join(sub, 'new.mp4'); await writeFile(file, 'new'); await until(() => seen.includes(file));
    await watcher.sync(new Set()); seen = []; await writeFile(file, 'alt'); await Bun.sleep(100);
    expect(seen).toEqual([]);
  } finally { watcher.close(); await rm(dir, { recursive: true, force: true }); }
});

test('an event burst beyond the queue limit requests full reconciliation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-library-overflow-'));
  let reconciled = false;
  const watcher = new LibraryLiveWatch(p => p, async paths => { reconciled ||= paths === null; }, 50, 1);
  try {
    await watcher.sync(new Set([dir]));
    await Promise.all(['a.mp4', 'b.mp4', 'c.mp4'].map(name => writeFile(path.join(dir, name), name)));
    await until(() => reconciled);
  } finally { watcher.close(); await rm(dir, { recursive: true, force: true }); }
});
