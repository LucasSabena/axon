import { realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';

export const insideRoot = (p: string, root: string) => !!root && (p === root || p.startsWith(root.replace(/\/+$/, '') + '/'));
export interface LibraryPathMapper { toContainer(p: string): string; toHost(p: string): string }

// Canonical roots are resolved once per operation, never once per scanned file.
export async function canonicalRoots(roots: string[], mapper: LibraryPathMapper): Promise<string[]> {
  return Promise.all(roots.map(async root => {
    try { return mapper.toHost(await realpath(mapper.toContainer(root))); }
    catch { return path.posix.resolve(root); }
  }));
}

export async function canonicalLibraryFile(input: string, roots: string[], realRoots: string[], mapper: LibraryPathMapper): Promise<string | null> {
  if (!input || input.includes('\0') || !path.posix.isAbsolute(input)) return null;
  const p = path.posix.resolve(input);
  // Inputs may already be in realpath form (share paths under symlinked roots).
  if (!roots.some(root => insideRoot(p, root)) && !realRoots.some(root => insideRoot(p, root))) return null;
  try {
    const resolved = await realpath(mapper.toContainer(p));
    const host = mapper.toHost(resolved);
    if (!realRoots.some(root => insideRoot(host, root))) return null;
    return (await stat(resolved)).isFile() ? host : null;
  } catch { return null; } // Broken, inaccessible and cyclic links are absent.
}
