import { availableStorage } from './host-storage';
import type { FileVolume } from './file-volumes';
import { HOST_FS } from './host';

const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

export interface ServerStats {
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  memoryPercent: number;
  diskUsedGb: number;
  diskTotalGb: number;
  diskPercent: number;
  disks?:FileVolume[];
  disksError?:string;
  loadAverage: number[];
  temperatures?: Record<string, number>;
  ip?: string;
  hosts?: ServerHost[];
  // Collectors whose read failed and fell back to 0 — a 0% is "unknown",
  // not "recovered", so alert checks must preserve rather than clear.
  failedCollectors?: string[];
}

export interface ServerHost {
  label: string;
  host: string;
  kind: 'tailscale' | 'lan' | 'route' | 'other';
}

function parseMeminfo(content: string, key: string): number {
  const match = content.match(new RegExp(`${key}:\\s+(\\d+)\\s+kB`));
  return match ? parseInt(match[1], 10) : 0;
}

// Stat collectors must never stall the alert tick or the metrics sampler —
// a hung df/sensors/ip resolves to a fallback instead of blocking forever.
function bounded<T>(promise: Promise<T>, ms: number, fallback: T, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => { try { onTimeout?.(); } catch { /* already gone */ } resolve(fallback); }, ms);
      (timer as { unref?: () => void }).unref?.();
    }),
  ]).finally(() => clearTimeout(timer!));
}

// Shell variant: losing the race also kills the spawned process, so a hung
// `df` on a stale mount doesn't leak one process per tick. Bun.spawn (not the
// $ template) because ShellPromise exposes no kill().
function boundedShell(command: string, ms: number): Promise<string> {
  const proc = Bun.spawn(['sh', '-c', command], { stdout: 'pipe', stderr: 'ignore' });
  return bounded(new Response(proc.stdout).text().catch(() => ''), ms, '', () => {
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
  });
}

// Concurrent callers (alert tick, metrics sampler, HTTP) share one in-flight
// sample so the CPU baseline is only ever mutated by a single reader.
let statsFlight: Promise<ServerStats> | null = null;

export async function getServerStats(): Promise<ServerStats> {
  if (!statsFlight) {
    statsFlight = readServerStats().finally(() => { statsFlight = null; });
  }
  return statsFlight;
}

async function readServerStats(): Promise<ServerStats> {
  try {
    const [meminfo, stat, df, uptime, sensors] = await Promise.all([
      boundedShell('cat /proc/meminfo', 5000),
      boundedShell('cat /proc/stat', 5000),
      boundedShell(`df -B1 -P -- ${shq(HOST_FS || '/')}`, 5000),
      boundedShell('cat /proc/loadavg', 5000),
      // Single-command only: `sh -c` exec's it, so the timeout kill reaches
      // `sensors` itself — a `|| echo '{}'` compound would orphan a hung one.
      boundedShell(`sensors -j`, 5000),
    ]);

    const memoryTotalKb = parseMeminfo(meminfo, 'MemTotal');
    // A missing MemAvailable is a read failure, not 100% usage.
    const hasMemAvailable = /^MemAvailable:/m.test(meminfo);
    const memoryAvailableKb = parseMeminfo(meminfo, 'MemAvailable');
    const memoryUsedKb = hasMemAvailable ? memoryTotalKb - memoryAvailableKb : 0;
    const memoryTotalMb = Math.round(memoryTotalKb / 1024);
    const memoryUsedMb = Math.round(memoryUsedKb / 1024);
    const memoryPercent = hasMemAvailable && memoryTotalKb ? Math.round((memoryUsedKb / memoryTotalKb) * 100) : 0;

    // First call after boot has no baseline — prime it, wait, and re-sample
    // so the response already carries a real percentage instead of 0.
    let cpuStat = stat;
    if (!lastCpuStats) {
      calculateCpuPercent(stat);
      await new Promise((r) => setTimeout(r, 350));
      cpuStat = (await boundedShell('cat /proc/stat', 5000)) || stat;
    }
    const cpuPercent = calculateCpuPercent(cpuStat);

    const diskLines = df.split('\n').filter(Boolean);
    const diskLine = diskLines[1] || '';
    const diskParts = diskLine.trim().split(/\s+/);
    const diskTotalBytes = parseInt(diskParts[1] || '0', 10);
    const diskUsedBytes = parseInt(diskParts[2] || '0', 10);
    const diskTotalGb = Math.round(diskTotalBytes / (1024 * 1024 * 1024));
    const diskUsedGb = Math.round(diskUsedBytes / (1024 * 1024 * 1024));
    const diskPercent = diskTotalBytes ? Math.round((diskUsedBytes / diskTotalBytes) * 100) : 0;

    const failedCollectors: string[] = [];
    if (!hasMemAvailable) failedCollectors.push('mem');
    if (!diskTotalBytes) failedCollectors.push('disk');
    if (!stat.trim()) failedCollectors.push('cpu');

    const loadAverage = uptime
      .split(/\s+/)
      .slice(0, 3)
      .map((v) => parseFloat(v))
      .filter((v) => !Number.isNaN(v));

    const temperatures = parseSensors(sensors);

    const storage=await bounded(availableStorage().catch(()=>null),15_000,null);
    const hosts = await bounded(getServerHosts(),10_000,[]);
    const serverIp = hosts[0]?.host || '';

    return {
      cpuPercent,
      memoryUsedMb,
      memoryTotalMb,
      memoryPercent,
      diskUsedGb,
      diskTotalGb,
      diskPercent,
      disks:storage?.disks,
      disksError:storage?undefined:'No se pudieron actualizar los discos',
      loadAverage,
      temperatures,
      ip: serverIp,
      hosts,
      failedCollectors,
    };
  } catch (error) {
    console.error('Failed to get server stats:', error);
    return {
      cpuPercent: 0,
      memoryUsedMb: 0,
      memoryTotalMb: 0,
      memoryPercent: 0,
      diskUsedGb: 0,
      diskTotalGb: 0,
      diskPercent: 0,
      loadAverage: [],
      failedCollectors: ['cpu', 'mem', 'disk'],
    };
  }
}

function classifyHost(ip: string): ServerHost['kind'] {
  const parts = ip.split('.').map((part) => parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return 'other';
  const [a, b] = parts;
  if (a === 100 && b >= 64 && b <= 127) return 'tailscale';
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return 'lan';
  return 'other';
}

function labelForHost(ip: string, kind: ServerHost['kind'], iface?: string): string {
  if (kind === 'tailscale') return 'Tailscale';
  if (kind === 'lan') return iface ? `LAN ${iface}` : 'LAN';
  if (kind === 'route') return 'Red';
  return iface ? `Host ${iface}` : 'Host';
}

export async function getServerHosts(): Promise<ServerHost[]> {
  const hosts = new Map<string, ServerHost>();

  const add = (ip: string, kind?: ServerHost['kind'], iface?: string) => {
    if (!ip || ip.startsWith('127.')) return;
    const detectedKind = kind || classifyHost(ip);
    const existing = hosts.get(ip);
    if (!existing) {
      hosts.set(ip, {
        host: ip,
        kind: detectedKind,
        label: labelForHost(ip, detectedKind, iface),
      });
      return;
    }

    const weight: Record<ServerHost['kind'], number> = { tailscale: 0, lan: 1, route: 2, other: 3 };
    if (weight[detectedKind] < weight[existing.kind]) {
      hosts.set(ip, {
        host: ip,
        kind: detectedKind,
        label: labelForHost(ip, detectedKind, iface),
      });
    }
  };

  // boundedShell (not bounded($`…`)) — the $ template exposes no kill(), so a
  // hung `ip` would leak one spawned process per call.
  const routeOutput = await boundedShell('ip route get 1.1.1.1', 5000);
  const routeMatch = routeOutput.match(/src\s+(\d+\.\d+\.\d+\.\d+)/);
  if (routeMatch) add(routeMatch[1], 'route');

  const addrOutput = await boundedShell('ip -4 -o addr show scope global', 5000);
  for (const line of addrOutput.split('\n').filter(Boolean)) {
    const match = line.match(/^\d+:\s+([^:\s]+).*?\sinet\s+(\d+\.\d+\.\d+\.\d+)\/\d+/);
    if (!match) continue;
    if (/^(docker|br-|veth|virbr|podman|cni)/.test(match[1])) continue;
    add(match[2], classifyHost(match[2]), match[1]);
  }

  return Array.from(hosts.values()).sort((a, b) => {
    const weight: Record<ServerHost['kind'], number> = { tailscale: 0, lan: 1, route: 2, other: 3 };
    return weight[a.kind] - weight[b.kind] || a.label.localeCompare(b.label);
  });
}

let lastCpuStats: { user: number; nice: number; system: number; idle: number; iowait: number; irq: number; softirq: number; steal: number; total: number; time: number } | null = null;

function calculateCpuPercent(statContent: string): number {
  const match = statContent.match(/^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
  if (!match) return 0;

  const [user, nice, system, idle, iowait, irq, softirq, steal] = match.slice(1).map((v) => parseInt(v, 10));
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  const now = Date.now();

  if (!lastCpuStats) {
    lastCpuStats = { user, nice, system, idle, iowait, irq, softirq, steal, total, time: now };
    return 0;
  }

  const totalDiff = total - lastCpuStats.total;
  // A wrapped or stalled counter isn't a usable window — keep the previous
  // baseline instead of emitting a bogus 0/100% sample.
  if (totalDiff <= 0) return 0;
  // Time waiting for disk and time stolen by a hypervisor are not CPU work.
  const idleDiff = idle - lastCpuStats.idle + iowait - lastCpuStats.iowait + steal - lastCpuStats.steal;
  const percent = Math.round(((totalDiff - idleDiff) / totalDiff) * 100);

  lastCpuStats = { user, nice, system, idle, iowait, irq, softirq, steal, total, time: now };
  return Math.max(0, Math.min(100, percent));
}

function parseSensors(sensorsJson: string): Record<string, number> | undefined {
  try {
    const data = JSON.parse(sensorsJson);
    const temps: Record<string, number> = {};
    for (const [chip, values] of Object.entries(data)) {
      if (typeof values !== 'object' || values === null) continue;
      for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
        // Only temperature inputs — fan*_input (RPM), in*_input (V),
        // power*_input (W) and curr*_input (A) must not surface as °C.
        if (/^temp\d+_input$/.test(key) && typeof value === 'number') {
          const labelKey = key.replace('input', 'label');
          const label = (values as Record<string, unknown>)[labelKey];
          const name = typeof label === 'string' && label ? `${chip}/${label}` : `${chip}/${key}`;
          temps[name] = Math.round(value * 10) / 10;
        } else if (typeof value === 'object' && value !== null) {
          // `sensors -j` nests feature labels one level deeper:
          // chip → { Adapter, 'Core 0': { temp1_input: 42, ... } }
          const feature = value as Record<string, unknown>;
          for (const [subKey, subValue] of Object.entries(feature)) {
            if (/^temp\d+_input$/.test(subKey) && typeof subValue === 'number') {
              const label = feature[subKey.replace('input', 'label')];
              const name = typeof label === 'string' && label ? `${chip}/${label}` : `${chip}/${key}`;
              temps[name] = Math.round(subValue * 10) / 10;
            }
          }
        }
      }
    }
    return Object.keys(temps).length > 0 ? temps : undefined;
  } catch {
    return undefined;
  }
}
