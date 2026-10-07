import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

const references = /((?:\/|\.\/)[A-Za-z0-9_./~%+-]+\.(?:js|css|svg|webmanifest|png|ico|jpe?g|webp|woff2?|ttf))\?v=[A-Za-z0-9._-]+/g;
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex').slice(0, 12);

// Finalize dependencies before their parents. A second build must be identical,
// and a changed lazy-loaded dependency must change the shell's URL too.
export async function fingerprintAssets(root: string): Promise<string> {
  const complete = new Map<string, string>(), visiting = new Set<string>();
  async function visit(filename: string): Promise<string> {
    if (complete.has(filename)) return complete.get(filename)!;
    if (visiting.has(filename)) throw new Error(`Cyclic versioned asset reference: ${filename}`);
    visiting.add(filename);
    const original = await readFile(path.join(root, filename));
    let bytes: string | Buffer = original;
    if (/\.(?:js|css|html|webmanifest)$/.test(filename)) {
      const source = original.toString('utf8');
      let output = source;
      for (const match of source.matchAll(references)) {
        // Normalize both branches first: a `/a/../../x` path escapes the
        // naive `startsWith('../')` guard if only the relative branch is
        // normalized.
        const dependency = path.posix.normalize(
          match[1].startsWith('/') ? match[1].slice(1)
            : path.posix.join(path.posix.dirname(filename), match[1]));
        if (dependency === '..' || dependency.startsWith('../') || path.posix.isAbsolute(dependency))
          throw new Error(`Asset outside public: ${match[1]} in ${filename}`);
        const version = await visit(dependency);
        output = output.split(match[0]).join(`${match[1]}?v=${version}`);
      }
      bytes = output;
      if (output !== source) await writeFile(path.join(root, filename), output);
    }
    const version = hash(bytes);
    complete.set(filename, version);
    visiting.delete(filename);
    return version;
  }
  return visit('index.html');
}
