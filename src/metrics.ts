import type { FileVolume } from './file-volumes';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Hono } from 'hono';
import { getServerStats } from './stats';
import { hostExec } from './host';

// ---------- Historical metrics sampler ----------
// Same load/record/saveSoon ring-buffer pattern as heartbeats.ts. One sample
// every 60s, kept for 7 days (10080 points) per series, debounced-persisted
// to data/metrics.json next to config.json.

export interface MetricPoint {
  t: number; // epoch ms
  v: number;
}

type SeriesKey = 'cpu' | 'mem' | 'disk' | 'load' | 'netRx' | 'netTx';
const SERIES_KEYS: SeriesKey[] = ['cpu', 'mem', 'disk', 'load', 'netRx', 'netTx'];

const FILE = path.join(
  path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),
  'metrics.json'
);
const INTERVAL_MS = 60_000;
const MAX_SAMPLES = 7 * 24 * 60; // 10080 — 7 días a una muestra por minuto

const series: Record<SeriesKey, MetricPoint[]> = {
  cpu: [],
  mem: [],
  disk: [],
  load: [],
  netRx: [],
  netTx: [],
};

const disks:Record<string,{name:string;path:string;series:MetricPoint[]}>= {};
const diskKey=(v:FileVolume)=>v.uuid||v.device;
let loaded = false;
let started = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
// Absolute /proc/net/dev counters — persisted so the first delta after a
// restart doesn't emit a bogus spike from accumulated bytes.
let lastNet: { rx: number; tx: number; t: number } | null = null;

async function loadMetrics(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const obj = JSON.parse(await readFile(FILE, 'utf-8'));
    for (const k of SERIES_KEYS) {
      const arr = obj?.[k];
      if (Array.isArray(arr)) {
        series[k] = arr
          .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v))
          .slice(-MAX_SAMPLES);
      }
    }
    for(const [key,value] of Object.entries(obj?._disks||{}).slice(0,64)){const v=value as any;if(typeof v.name==='string'&&typeof v.path==='string'&&Array.isArray(v.series))disks[key]={name:v.name,path:v.path,series:v.series.filter((p:any)=>p&&Number.isFinite(p.t)&&Number.isFinite(p.v)&&p.t>Date.now()-7*86400000).slice(-MAX_SAMPLES)};}
    const net = obj?._net;
    if (net && Number.isFinite(net.rx) && Number.isFinite(net.tx) && Date.now() - net.t < 15 * 60_000) {
      lastNet = net;
    }
  } catch { /* missing/corrupt file — start fresh */ }
}

function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeQueue = writeQueue.then(async () => {
      try {
        await mkdir(path.dirname(FILE), { recursive: true });
        await writeFile(FILE, JSON.stringify({ _net: lastNet, _disks:disks, ...series }));
      } catch { /* best-effort */ }
    });
  }, 10_000);
  (saveTimer as { unref?: () => void })?.unref?.();
}

function push(key: SeriesKey, t: number, v: number): void {
  const arr = series[key];
  arr.push({ t, v });
  if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
}

// Container runs network_mode: host → /proc/net/dev already shows the host
// interfaces. Sum rx/tx bytes of every non-lo interface.
function readNetTotals(): { rx: number; tx: number } | null {
  try {
    const dev = readFileSync('/proc/net/dev', 'utf-8');
    let rx = 0;
    let tx = 0;
    for (const line of dev.split('\n')) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const iface = line.slice(0, i).trim();
      if (!iface || iface === 'lo') continue;
      // Skip container plumbing — veth/docker bridges double-count traffic
      // that already flows over the physical interface.
      if (/^(docker|br-|veth|virbr|cni|flannel|kube)/.test(iface)) continue;
      const f = line.slice(i + 1).trim().split(/\s+/).map(Number);
      if (f.length < 16 || f.some((n) => !Number.isFinite(n))) continue;
      rx += f[0];
      tx += f[8];
    }
    return { rx, tx };
  } catch {
    return null;
  }
}

// A stalled stats read must never stack samples up — skip while one runs.
let sampling = false;

async function sample(): Promise<void> {
  if (sampling) return;
  sampling = true;
  try {
    const stats = await getServerStats();
    const t = Date.now();
    push('cpu', t, stats.cpuPercent);
    push('mem', t, stats.memoryPercent);
    push('disk', t, stats.diskPercent);
    for(const v of stats.disks||[])if(v.path&&v.used!=null&&v.size){const key=diskKey(v);if(!disks[key]&&Object.keys(disks).length>=64)continue;const d=disks[key]||={name:v.name,path:v.path,series:[]};d.name=v.name;d.path=v.path;d.series.push({t,v:Math.round(v.used/v.size*100)});d.series=d.series.filter(p=>p.t>t-7*86400000).slice(-MAX_SAMPLES);}
    push('load', t, Math.round((stats.loadAverage?.[0] ?? 0) * 100) / 100);
    const net = readNetTotals();
    if (net && lastNet) {
      const dt = Math.max(1, (t - lastNet.t) / 1000);
      // kB/s per interval
      push('netRx', t, Math.max(0, Math.round(((net.rx - lastNet.rx) / 1024 / dt) * 10) / 10));
      push('netTx', t, Math.max(0, Math.round(((net.tx - lastNet.tx) / 1024 / dt) * 10) / 10));
    } else {
      push('netRx', t, 0);
      push('netTx', t, 0);
    }
    if (net) lastNet = { rx: net.rx, tx: net.tx, t };
    saveSoon();
  } catch { /* sampling is best-effort */ }
  sampling = false;
}

export function startMetricsLoop(): void {
  if (started) return;
  started = true;
  loadMetrics()
    .then(() => sample())
    .catch(() => {})
    .finally(() => {
      setInterval(() => { sample().catch(() => {}); }, INTERVAL_MS).unref();
    });
}

// ---------- Top processes (/proc scan — pid: host gives the host table) ----------

interface ProcSnap {
  pid: number;
  name: string;
  rssMB: number;
  jiffies: number;
}

let clkTck = 100;
let clkTckLoaded = false;

async function getClkTck(): Promise<number> {
  if (clkTckLoaded) return clkTck;
  clkTckLoaded = true;
  try {
    const res = await hostExec('getconf CLK_TCK', { timeoutMs: 5000 });
    const v = parseInt(res.stdout.trim(), 10);
    if (v > 0) clkTck = v;
  } catch { /* keep 100 */ }
  return clkTck;
}

async function snapshotProcs(): Promise<ProcSnap[]> {
  const entries = await readdir('/proc').catch(() => [] as string[]);
  const pids = entries.filter((e) => /^\d+$/.test(e)).map((e) => parseInt(e, 10));
  const out: ProcSnap[] = [];
  await Promise.all(
    pids.map(async (pid) => {
      try {
        const [stat, status, comm] = await Promise.all([
          readFile(`/proc/${pid}/stat`, 'utf-8').catch(() => ''),
          readFile(`/proc/${pid}/status`, 'utf-8').catch(() => ''),
          readFile(`/proc/${pid}/comm`, 'utf-8').catch(() => ''),
        ]);
        if (!stat) return;
        const idx = stat.lastIndexOf(')');
        if (idx < 0) return;
        // Fields after 'comm)': state ppid pgrp session tty_nr tpgid flags
        // minflt cminflt majflt cmajflt utime stime ...
        const f = stat.slice(idx + 1).trim().split(/\s+/);
        const flags = parseInt(f[6] || '0', 10) || 0;
        if (flags & 0x200000) return; // PF_KTHREAD — skip kernel threads
        const utime = parseInt(f[11] || '0', 10) || 0;
        const stime = parseInt(f[12] || '0', 10) || 0;
        const name = (comm || stat.slice(stat.indexOf('(') + 1, idx)).trim() || `pid ${pid}`;
        const rssM = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
        out.push({
          pid,
          name,
          rssMB: rssM ? Math.round(parseInt(rssM[1], 10) / 1024) : 0,
          jiffies: utime + stime,
        });
      } catch { /* process vanished mid-scan */ }
    })
  );
  return out;
}

const PROCS_SAMPLE_MS = 200;
// Raw jiffies can exceed 100% on multi-threaded processes; divide by core
// count so the UI shows 0-100% of total capacity.
const CPU_COUNT = Math.max(1, os.cpus().length);

// ---------- Routes ----------

const RANGES: Record<string, number> = {
  '1h': 3_600_000,
  '6h': 21_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
};

export function registerMetricsRoutes(app: Hono): void {
  startMetricsLoop(); // idempotent — routes alone wire the whole feature

  app.get('/api/metrics', async (c) => {
    await loadMetrics();
    const range = c.req.query('range') || '24h';
    const ms = RANGES[range] ?? RANGES['24h'];
    const since = Date.now() - ms;
    const out: Partial<Record<SeriesKey, MetricPoint[]>> = {};
    for (const k of SERIES_KEYS) out[k] = series[k].filter((p) => p.t >= since);
    return c.json({ ok: true, series: out, disks:Object.entries(disks).map(([id,d])=>({id,name:d.name,path:d.path,series:d.series.filter(p=>p.t>=since)})), sampledSec: INTERVAL_MS / 1000 });
  });

  app.get('/api/metrics/procs', async (c) => {
    const n = Math.max(1, Math.min(parseInt(c.req.query('n') || '10', 10) || 10, 50));
    const tck = await getClkTck();
    // Two jiffies reads 200ms apart over the whole table → ranking by live
    // cpu%, not RSS (a cpu-burner with small RSS must not be invisible).
    const first = await snapshotProcs();
    const base = new Map(first.map((p) => [p.pid, p.jiffies]));
    await new Promise((r) => setTimeout(r, PROCS_SAMPLE_MS));
    const second = await snapshotProcs();
    const procs = second
      .map((p) => {
        const dj = Math.max(0, p.jiffies - (base.get(p.pid) ?? p.jiffies));
        const cpu = Math.round(Math.min(100, (dj / tck / (PROCS_SAMPLE_MS / 1000)) * 100 / CPU_COUNT) * 10) / 10;
        return { pid: p.pid, name: p.name, cpu, rssMB: p.rssMB };
      })
      .sort((a, b) => b.cpu - a.cpu || b.rssMB - a.rssMB)
      .slice(0, n);
    return c.json({ ok: true, procs, cpuCount: CPU_COUNT });
  });
}
