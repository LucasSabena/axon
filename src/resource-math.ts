// /proc/stat counts guest time inside user/nice already. Waiting for I/O
// and hypervisor steal are reported separately from work done by this CPU.
export function cpuCounters(text: string) {
  const values = text.match(/^cpu\s+(.+)$/m)?.[1].trim().split(/\s+/).slice(0, 8).map(Number);
  if (!values || values.length !== 8 || values.some(v => !Number.isFinite(v))) throw new Error('No se pudo leer la CPU del host');
  return { total: values.reduce((a, b) => a + b, 0), idle: values[3], wait: values[4], steal: values[7] };
}

export function cpuDelta(a: ReturnType<typeof cpuCounters>, b: ReturnType<typeof cpuCounters>) {
  const total = b.total - a.total;
  if (total <= 0) throw new Error('La muestra de CPU no tiene un intervalo válido');
  const pct = (n: number) => Math.round(Math.max(0, Math.min(100, n / total * 100)) * 10) / 10;
  return { busy: pct(total - (b.idle - a.idle) - (b.wait - a.wait) - (b.steal - a.steal)), wait: pct(b.wait - a.wait), steal: pct(b.steal - a.steal), total };
}

export function memoryInfo(text: string) {
  const kb = (key: string) => Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] || 0);
  const totalMb = kb('MemTotal') / 1024;
  if (!totalMb || !/^MemAvailable:/m.test(text)) throw new Error('No se pudo leer la memoria disponible del host');
  const availableMb = kb('MemAvailable') / 1024;
  return { totalMb, availableMb, usedMb: totalMb - availableMb, percent: Math.round((totalMb - availableMb) / totalMb * 100), cacheMb: Math.max(0, kb('Cached') + kb('SReclaimable') - kb('Shmem')) / 1024, swapUsedMb: (kb('SwapTotal') - kb('SwapFree')) / 1024 };
}

export function processStat(text: string) {
  const end = text.lastIndexOf(')');
  if (end < 0) return null;
  const fields = text.slice(end + 2).trim().split(/\s+/);
  if (fields.length < 22) return null;
  return { name: text.slice(text.indexOf('(') + 1, end), ticks: Number(fields[11]) + Number(fields[12]), start: fields[19], ppid: Number(fields[1]) };
}

export function dockerMemoryMb(text: string): number | null {
  const m = text.match(/^\s*([\d.]+)\s*(B|kB|KiB|MB|MiB|GB|GiB|TB|TiB)\b/i);
  if (!m) return null;
  const scale = { b: 1 / 1048576, kb: 1000 / 1048576, kib: 1 / 1024, mb: 1000000 / 1048576, mib: 1, gb: 1000000000 / 1048576, gib: 1024, tb: 1e12 / 1048576, tib: 1048576 };
  return Number(m[1]) * scale[m[2].toLowerCase()];
}
