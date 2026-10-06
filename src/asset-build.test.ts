import { test, expect } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fingerprintAssets } from '../scripts/fingerprint-assets';

test('asset URLs match final bytes, propagate nested changes and survive repeated builds', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'axon-assets-'));
  const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0,12);
  try {
    await writeFile(path.join(root,'index.html'), '<script src="/loader.js?v=old"></script>');
    await writeFile(path.join(root,'loader.js'), "import './model.js?v=old'; const css='/theme.css?v=old';");
    await writeFile(path.join(root,'model.js'), 'export const value=1;');
    await writeFile(path.join(root,'theme.css'), 'body{color:red}');
    const first = await fingerprintAssets(root);
    const loader = await readFile(path.join(root,'loader.js'),'utf8');
    expect(loader).toContain('./model.js?v='+hash('export const value=1;'));
    expect(loader).toContain('/theme.css?v='+hash('body{color:red}'));
    expect(await readFile(path.join(root,'index.html'),'utf8')).toContain('/loader.js?v='+hash(loader));
    expect(await fingerprintAssets(root)).toBe(first);
    await writeFile(path.join(root,'model.js'), 'export const value=2;');
    expect(await fingerprintAssets(root)).not.toBe(first);
    const changed = await readFile(path.join(root,'loader.js'),'utf8');
    expect(changed).toContain('./model.js?v='+hash('export const value=2;'));
    expect(await readFile(path.join(root,'index.html'),'utf8')).toContain('/loader.js?v='+hash(changed));
    await writeFile(path.join(root,'model.js'), "import './missing.js?v=old';");
    await expect(fingerprintAssets(root)).rejects.toThrow();
  } finally { await rm(root,{recursive:true,force:true}); }
});
