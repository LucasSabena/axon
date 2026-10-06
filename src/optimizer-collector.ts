import { readdir, readFile, readlink } from 'node:fs/promises';
import { hostToContainer, hostExec } from './host';
import { cpuCounters, cpuDelta, memoryInfo, processStat, dockerMemoryMb } from './resource-math';

export interface ContainerInfo {
  id: string; name: string; image: string; imageId: string; created: string; state: string;
  pid: number; startedAt: string; project: string; service: string; dependencies: string[];
  ports: number[]; portBindings: { hostIp: string; hostPort: number; containerPort: number }[]; cpu: number | null; memoryMb: number | null;
}
export async function dockerRead(command: string, timeoutMs = 15_000) {
  const r = await hostExec(`docker ${command}`, { timeoutMs });
  if (!r.ok) throw new Error('Docker no respondió o faltan permisos para leerlo');
  return r.stdout;
}
export async function inventory(): Promise<ContainerInfo[]> {
  const ids = (await dockerRead('ps -aq --no-trunc')).trim().split(/\s+/).filter(Boolean);
  if (!ids.length) return [];
  if (ids.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error('Inventario de Docker inválido');
  const rows = JSON.parse(await dockerRead(`inspect ${ids.join(' ')}`));
  return rows.map((r: any) => {
    const labels = r.Config?.Labels || {};
    return {
      id: r.Id, name: String(r.Name).replace(/^\//, ''), image: r.Config?.Image || '', imageId: r.Image || '',
      created: r.Created, state: r.State?.Status || 'unknown', pid: r.State?.Pid || 0,
      startedAt: r.State?.StartedAt || '', project: labels['com.docker.compose.project'] || '',
      service: labels['com.docker.compose.service'] || '',
      dependencies: (labels['com.docker.compose.depends_on'] || '').split(',').map((d: string) => d.split(':')[0]).filter(Boolean),
      ports: Object.values(r.NetworkSettings?.Ports || {}).flatMap((ps: any) => (ps || []).map((p: any) => Number(p.HostPort))).filter(Number.isFinite),
      portBindings: Object.entries(r.HostConfig?.PortBindings || {}).flatMap(([port, ps]: [string, any]) => (ps || []).map((p: any) => ({ hostIp: p.HostIp || '', hostPort: Number(p.HostPort), containerPort: Number(port.split('/')[0]) }))),
      cpu: null, memoryMb: null,
    };
  });
}

async function mapLimit<T, R>(items: T[], fn: (item: T) => Promise<R>) {
  const output: R[] = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(24, items.length) }, async () => {
    while (cursor < items.length) { const i = cursor++; output[i] = await fn(items[i]); }
  }));
  return output;
}
async function processSample(details: boolean) {
  const proc = hostToContainer('/proc');
  const ids = (await readdir(proc)).filter(id => /^\d+$/.test(id));
  const rows = await mapLimit(ids, async id => {
    try {
      const stat = processStat(await readFile(`${proc}/${id}/stat`, 'utf8'));
      if (!stat) return null;
      if (!details) return { pid: Number(id), ...stat, cwd: '', cgroup: '', rss: 0 };
      const [status, cgroup, cwd] = await Promise.all([
        readFile(`${proc}/${id}/status`, 'utf8').catch(() => ''),
        readFile(`${proc}/${id}/cgroup`, 'utf8').catch(() => ''),
        readlink(`${proc}/${id}/cwd`).catch(() => ''),
      ]);
      return { pid: Number(id), ...stat, cwd, cgroup, rss: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) / 1024 };
    } catch { return null; } // processes can exit between reads
  });
  return rows.filter((r): r is NonNullable<typeof r> => r !== null);
}

export async function collectResources() {
  const proc = (file: string) => readFile(hostToContainer(`/proc/${file}`), 'utf8');
  const errors: string[] = [];
  const start = Date.now();
  const [firstCpu, first] = await Promise.all([proc('stat'), processSample(false)]);
  // One batch for all containers; never one docker stats process per row.
  const docker = (async () => {
    try {
      const containers = await inventory();
      const stats = await dockerRead("stats --no-stream --format '{{json .}}'", 20_000);
      return { containers, stats };
    } catch { errors.push('No se pudo medir Docker. No se habilitarán acciones sobre aplicaciones.'); return null; }
  })();
  await Bun.sleep(1000);
  const [lastCpu, last, mem, df, load, pressure, containerData] = await Promise.all([
    proc('stat'), processSample(true), proc('meminfo'),
    hostExec('df -B1 --output=size,used,avail,pcent /', { timeoutMs: 8000 }),
    proc('loadavg'), proc('pressure/cpu').catch(() => ''), docker,
  ]);
  const cpu = cpuDelta(cpuCounters(firstCpu), cpuCounters(lastCpu));
  const cores = Math.max(1, lastCpu.match(/^cpu\d+\s/gm)?.length || 1);
  const containers = containerData?.containers || [];
  for (const line of containerData?.stats.split('\n').filter(Boolean) || []) {
    try {
      const s = JSON.parse(line);
      const c = containers.find(c => c.id.startsWith(s.ID || s.Container) || c.name === s.Name);
      if (c && c.state === 'running') {
        const raw = parseFloat(s.CPUPerc);
        c.cpu = Number.isFinite(raw) ? Math.min(100, raw / cores) : null;
        c.memoryMb = dockerMemoryMb(s.MemUsage);
      }
    } catch { errors.push('Una medición de Docker no se pudo interpretar.'); }
  }
  const before = new Map(first.map(p => [p.pid, p]));
  const lastByPid = new Map(last.map(p => [p.pid, p]));
  const roots = new Map(containers.filter(c => c.pid).map(c => [c.pid, c.id]));
  const owner = (p: typeof last[number]) => {
    const id = p.cgroup.match(/(?:docker[-/])([a-f0-9]{64})/)?.[1];
    if (id) return id;
    let current = p; const visited = new Set<number>();
    while (current && !visited.has(current.pid)) {
      if (roots.has(current.pid)) return roots.get(current.pid);
      visited.add(current.pid); current = lastByPid.get(current.ppid)!;
    }
    return null;
  };
  const groups = new Map<string, { name: string; cwd: string; cpu: number; memoryMb: number; pids: number[] }>();
  for (const p of last) {
    if (owner(p)) continue; // containers are already measured above
    const prev = before.get(p.pid);
    const cpuPct = prev?.start === p.start ? Math.max(0, p.ticks - prev.ticks) / cpu.total * 100 : 0;
    if (!p.rss && !cpuPct) continue;
    const key = `${p.name}:${p.cwd}`;
    const g = groups.get(key) || { name: p.name, cwd: p.cwd, cpu: 0, memoryMb: 0, pids: [] };
    g.cpu += cpuPct; g.memoryMb += p.rss; g.pids.push(p.pid); groups.set(key, g);
  }
  const diskFields = df.stdout.trim().split('\n').at(-1)?.trim().split(/\s+/) || [];
  const disk = df.ok && diskFields.length >= 4 && Number(diskFields[0]) > 0 ? { totalGb: Number(diskFields[0]) / 2 ** 30, usedGb: Number(diskFields[1]) / 2 ** 30, availableGb: Number(diskFields[2]) / 2 ** 30, percent: Math.round(Number(diskFields[1]) / Number(diskFields[0]) * 100) } : null;
  if (!disk) errors.push('No se pudo medir el espacio de disco.');
  return {
    at: Date.now(), intervalMs: Date.now() - start, cpu: { ...cpu, cores, pressure10: Number(pressure.match(/some avg10=([\d.]+)/)?.[1] || 0) },
    memory: memoryInfo(mem), disk, load: load.trim().split(/\s+/).slice(0, 3).map(Number),
    containers, processes: [...groups.values()].sort((a, b) => b.cpu - a.cpu || b.memoryMb - a.memoryMb), errors,
  };
}
