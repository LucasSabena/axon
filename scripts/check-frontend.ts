import { readdir } from 'node:fs/promises';
import path from 'node:path';

// Syntax-check every shipped script, including nested directories and
// .mjs/.cjs files, and report ALL failures instead of exiting on the first.
async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) yield full;
  }
}
const files: string[] = [];
for await (const file of walk('public')) files.push(file);
const failed: string[] = [];
for (const file of files) {
  const p = Bun.spawn(['node', '--check', file], { stdout: 'inherit', stderr: 'inherit' });
  if (await p.exited) failed.push(file);
}
if (failed.length) {
  console.error(`\n${failed.length} of ${files.length} frontend files failed syntax check:`);
  for (const f of failed) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`Frontend syntax checked: ${files.length} files`);
