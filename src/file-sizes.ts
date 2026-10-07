import { hostExec, type HostResult } from './host';

const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
type Runner = typeof hostExec;

// Reads use the panel's host read access, including its private backup
// repositories. Never follow symlinks or accept du's partial output on error.
export async function fileTreeSize(hostPath: string, allocated = false, run: Runner = hostExec): Promise<number> {
  const result: HostResult = await run(`du ${allocated ? '-s -B1' : '-sb'} -- ${quote(hostPath)}`, { user: 'root', timeoutMs: 60_000 });
  const match = /^(\d+)\t/.exec(result.stdout);
  const bytes = match ? Number(match[1]) : NaN;
  if (!result.ok || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('No se pudo calcular el tamaño completo. Revisá el acceso a la carpeta y volvé a intentar.');
  }
  return bytes;
}
