import { $ } from 'bun';
import type { DockerContainer } from './types';

interface DockerPsLine {
  ID: string;
  Names: string;
  Image: string;
  Status: string;
  State: string;
  Ports: string;
  Labels?: string;
}

function publicPortsFrom(portsField: string): number[] {
  const ports = new Set<number>();
  for (const part of portsField.split(',')) {
    const m = part.match(/(?:[\d.]+|:)?:(\d+)->/);
    if (m) ports.add(parseInt(m[1], 10));
  }
  return Array.from(ports).sort((a, b) => a - b);
}

export async function listContainers(): Promise<DockerContainer[]> {
  const res = await $`docker ps --format '{{json .}}'`.text().catch(() => '');
  const out: DockerContainer[] = [];
  for (const line of res.split('\n').filter(Boolean)) {
    try {
      const row = JSON.parse(line) as DockerPsLine;
      const composeProject = row.Labels?.match(/com\.docker\.compose\.project=([^,]+)/)?.[1];
      out.push({
        id: row.ID,
        names: row.Names,
        image: row.Image,
        status: row.Status,
        state: row.State,
        ports: row.Ports || '',
        publicPorts: publicPortsFrom(row.Ports || ''),
        projectName: composeProject || row.Names,
        composeProject,
      });
    } catch { /* malformed line */ }
  }
  return out;
}

export async function containerDetail(id: string) {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const inspect = await $`docker inspect ${safeId}`.json().catch(() => null) as any[] | null;
  const info = inspect?.[0];
  const env: Record<string, string> = {};
  for (const e of info?.Config?.Env || []) {
    const eq = e.indexOf('=');
    if (eq < 0) continue;
    const k = e.slice(0, eq);
    let v = e.slice(eq + 1);
    if (/(token|secret|key|pass|password|credential)/i.test(k)) v = '••••••';
    env[k] = v;
  }
  return {
    env,
    image: info?.Config?.Image || '',
    createdAt: info?.Created || '',
    startedAt: info?.State?.StartedAt || '',
    cmd: (info?.Config?.Cmd || []).join(' ') || info?.Path || '',
    restartPolicy: info?.HostConfig?.RestartPolicy?.Name || '',
  };
}

export async function containerStats(id: string) {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const res = await $`docker stats ${safeId} --no-stream --format '{{json .}}'`.text().catch(() => '');
  try {
    const s = JSON.parse(res.trim()) as Record<string, string>;
    return {
      cpuPercent: s.CPUPerc,
      memoryUsage: s.MemUsage?.split('/')[0]?.trim(),
      memoryLimit: s.MemUsage?.split('/')[1]?.trim(),
      memoryPercent: s.MemPerc,
      networkIo: s.NetIO,
      blockIo: s.BlockIO,
      pids: s.PIDs,
    };
  } catch {
    return null;
  }
}

export async function containerLogs(id: string, tail = 200): Promise<string[]> {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const res = await $`docker logs ${safeId} --tail ${tail} 2>&1`.text().catch(() => '');
  return res.split('\n');
}

export async function stopContainer(id: string): Promise<{ ok: boolean; error?: string }> {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  try {
    await $`docker stop ${safeId}`.text();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
