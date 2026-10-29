import type { Hono } from 'hono';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { hostExec, HOST_USER, ON_HOST } from './host';
import { hostHome } from './host-storage';
import { boundedCommand } from './storage/host-argv';
import { recordEvent } from './events';
import {
  BROWSER_ROOTS, DEFAULT_NICE_RULES, DOCKER_RULES, GROUPS, appLabel, browserRule, cacheRule, growthBetween,
  isProtected, niceRuleFor, parseDockerDf, q, staticRules, walRule,
  type DirSnap, type NiceRule, type RawProc, type Rule,
} from './health-rules';

// ---------- Estado persistente ----------

interface Receipt { id: string; at: number; kind: 'optimize' | 'clean' | 'auto'; freed: number; items: { id: string; label: string; ok: boolean; freed: number; note?: string }[] }
interface Settings { autoClean: { enabled: boolean; ids: string[] }; autoNice: { enabled: boolean; rules: NiceRule[] } }
interface State { settings: Settings; history: { t: number; used: number; total: number }[]; snaps: { t: number; dirs: DirSnap }[]; receipts: Receipt[]; lastAuto: number }

const AUTO_DEFAULT = ['tmp-user', 'tmp-claude', 'var-tmp', 'journal', 'logs-old', 'crash', 'apt', 'wal'];
const freshState = (): State => ({ settings: { autoClean: { enabled: false, ids: AUTO_DEFAULT }, autoNice: { enabled: true, rules: DEFAULT_NICE_RULES } }, history: [], snaps: [], receipts: [], lastAuto: 0 });

class HealthError extends Error { constructor(message: string, public status = 400) { super(message); } }
const DAY = 86_400_000;

// ---------- Ejecución en el host ----------

const asUser = (r: 'user' | 'root') => (r === 'root' ? 'root' : 'user') as 'root' | 'user';
/** Todo corre con prioridad mínima de CPU y disco: limpiar no debe frenar nada. */
const quiet = (cmd: string) => `ionice -c3 nice -n19 bash -c ${q(cmd)}`;

async function py(req: Record<string, unknown>, timeoutMs = 15_000): Promise<any> {
  const source = await readFile(new URL('./health-host.py', import.meta.url), 'utf8');
  const cmd = ['python3', '-c', source];
  const argv = ON_HOST ? cmd : ['nsenter', '-t', '1', '-m', '-u', '-i', '-n', '-p', '--', ...cmd];
  return JSON.parse(await boundedCommand(argv, JSON.stringify(req), undefined, timeoutMs));
}

async function bytesOf(rule: Rule): Promise<number | null> {
  if (!rule.measure) return null;
  const r = await hostExec(quiet(rule.measure), { user: asUser(rule.as), timeoutMs: 90_000 });
  const n = parseInt(r.stdout.trim().split('\n').pop() || '', 10);
  return Number.isFinite(n) ? n : null;
}
const isBusy = async (rule: Rule) => !!rule.busy && (await hostExec(rule.busy, { user: asUser(rule.as), timeoutMs: 10_000 })).ok;

async function mapPool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function dfRoot() {
  const r = await hostExec(`df -B1 --output=size,used,avail / | tail -1`, { user: 'root', timeoutMs: 10_000 });
  const [total, used, avail] = r.stdout.trim().split(/\s+/).map(Number);
  return { total: total || 0, used: used || 0, avail: avail || 0 };
}

async function dfAll() {
  const r = await hostExec(`df -B1 -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs --output=target,size,used,avail,source | tail -n +2`, { user: 'root', timeoutMs: 10_000 });
  return r.stdout.split('\n').filter(Boolean).map(line => {
    const m = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/.exec(line.trim());
    return m ? { mount: m[1], total: +m[2], used: +m[3], avail: +m[4], device: m[5] } : null;
  }).filter((d): d is NonNullable<typeof d> => !!d && !/^\/(boot|snap|run|sys|proc|dev)/.test(d.mount));
}

// ---------- Reglas descubiertas en tiempo de ejecución ----------

async function discoverRules(): Promise<{ rules: Rule[]; dockerBytes: Record<string, number> }> {
  const home = await hostHome();
  const rules = staticRules(home, HOST_USER);
  const [browsers, caches, wals, docker] = await Promise.all([
    hostExec(`for d in ${BROWSER_ROOTS.map(r => q(`${home}/${r}`)).join(' ')}; do [ -d "$d" ] && echo "$d"; done`, { user: 'user', timeoutMs: 10_000 }),
    hostExec(quiet(`du -x -B1 --max-depth=1 ${q(home + '/.cache')} 2>/dev/null | awk '$1>=52428800'`), { user: 'user', timeoutMs: 60_000 }),
    hostExec(quiet(`find ${q(home)} -xdev -maxdepth 7 -type f -name '*-wal' -size +20M -not -path '*/node_modules/*' 2>/dev/null | head -20`), { user: 'user', timeoutMs: 60_000 }),
    hostExec(`command -v docker >/dev/null && docker system df --format '{{.Type}}|{{.Reclaimable}}'`, { user: 'root', timeoutMs: 20_000 }),
  ]);
  for (const abs of browsers.stdout.split('\n').filter(Boolean)) {
    const rel = abs.slice(home.length + 1);
    if (BROWSER_ROOTS.includes(rel)) rules.push(browserRule(home, rel, 0));
  }
  for (const line of caches.stdout.split('\n')) {
    const m = /^(\d+)\s+(.+)$/.exec(line);
    if (!m || m[2] === `${home}/.cache`) continue;
    const rule = m[2].startsWith(home + '/.cache/') ? cacheRule(home, m[2].slice(home.length + 8), +m[1]) : null;
    if (rule) rules.push(rule);
  }
  for (const f of wals.stdout.split('\n').filter(Boolean)) { const rule = walRule(f); if (rule) rules.push(rule); }
  const dockerBytes = docker.ok ? parseDockerDf(docker.stdout) : {};
  for (const d of DOCKER_RULES) if (docker.ok) rules.push(d);
  return { rules, dockerBytes };
}

export interface ScanItem { id: string; group: string; groupLabel: string; label: string; desc: string; risk: string; bytes: number | null; busy: boolean }

// ---------- Servicio ----------

export class HealthService {
  state: State = freshState();
  private loaded?: Promise<void>;
  private scanCache?: { at: number; items: ScanItem[]; rules: Map<string, Rule> };
  private scanning?: Promise<ScanItem[]>;
  private busyLock = false;
  private prev?: { at: number; ticks: Map<string, number>; totals: number[]; cores: number[][] };
  latest?: { at: number; snap: any; cpu: number; cores: number[]; procs: (RawProc & { key: string; cpu: number; age: number })[] };
  private hot = new Map<string, number>();
  private cpuTrail: { t: number; cpu: number; mem: number }[] = [];
  private spaceCache = new Map<string, { at: number; value: any }>();
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(private dir: string) {}

  private file() { return path.join(this.dir, 'health.json'); }
  load() {
    return this.loaded ??= (async () => {
      try {
        const saved = JSON.parse(await readFile(this.file(), 'utf8')) as Partial<State>;
        const base = freshState();
        this.state = { ...base, ...saved, settings: { autoClean: { ...base.settings.autoClean, ...saved.settings?.autoClean }, autoNice: { ...base.settings.autoNice, ...saved.settings?.autoNice } } };
        const known = new Set(this.state.settings.autoNice.rules.map(r => r.id));
        for (const r of DEFAULT_NICE_RULES) if (!known.has(r.id)) this.state.settings.autoNice.rules.push(r);
      } catch { /* primer arranque o archivo ilegible: estado nuevo */ }
    })();
  }
  private saveTimer?: ReturnType<typeof setTimeout>;
  private save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        await mkdir(this.dir, { recursive: true });
        const tmp = `${this.file()}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify(this.state), { mode: 0o600 });
        await rename(tmp, this.file());
      } catch { /* se reintenta en el próximo cambio */ }
    }, 1500);
    (this.saveTimer as { unref?: () => void }).unref?.();
  }

  // --- Limpieza ---

  async scan(force = false): Promise<ScanItem[]> {
    if (!force && this.scanCache && Date.now() - this.scanCache.at < 90_000) return this.scanCache.items;
    return this.scanning ??= (async () => {
      try {
        const { rules, dockerBytes } = await discoverRules();
        const items = await mapPool(rules, 4, async (rule): Promise<ScanItem> => {
          const dockerType = (rule as Rule & { dfType?: string }).dfType;
          let bytes = dockerType ? (dockerBytes[dockerType] ?? 0) : await bytesOf(rule);
          if (bytes !== null && rule.keep) bytes = Math.max(0, bytes - rule.keep);
          return { id: rule.id, group: rule.group, groupLabel: GROUPS[rule.group], label: rule.label, desc: rule.desc, risk: rule.risk, bytes, busy: await isBusy(rule) };
        });
        this.scanCache = { at: Date.now(), items, rules: new Map(rules.map(r => [r.id, r])) };
        return items;
      } finally { this.scanning = undefined; }
    })();
  }

  async clean(ids: string[], confirmed: string[], kind: Receipt['kind']): Promise<Receipt> {
    if (this.busyLock) throw new HealthError('Ya hay una limpieza en curso', 409);
    this.busyLock = true;
    try {
      if (!this.scanCache) await this.scan();
      const rules = this.scanCache!.rules;
      const okToDelete = new Set(confirmed);
      const items: Receipt['items'] = [];
      for (const id of ids) {
        const rule = rules.get(id);
        if (!rule) { items.push({ id, label: id, ok: false, freed: 0, note: 'Ya no existe: actualizá el análisis' }); continue; }
        if (rule.risk === 'review' && !okToDelete.has(id)) { items.push({ id, label: rule.label, ok: false, freed: 0, note: 'Falta confirmar' }); continue; }
        if (await isBusy(rule)) { items.push({ id, label: rule.label, ok: false, freed: 0, note: 'En uso ahora: se omitió' }); continue; }
        const freeBefore = (await dfRoot()).avail;
        const before = (rule as Rule & { dfType?: string }).dfType ? null : await bytesOf(rule);
        const r = await hostExec(quiet(rule.clean), { user: asUser(rule.as), timeoutMs: 300_000 });
        const after = before === null ? null : await bytesOf(rule);
        const dfGain = Math.max(0, (await dfRoot()).avail - freeBefore);
        const freed = before !== null && after !== null ? Math.max(0, before - after) : dfGain;
        items.push({ id, label: rule.label, ok: r.ok, freed, note: r.ok ? undefined : (r.stderr || r.stdout).trim().split('\n').pop()?.slice(0, 160) });
      }
      const receipt: Receipt = { id: Date.now().toString(36), at: Date.now(), kind, freed: items.reduce((s, i) => s + i.freed, 0), items };
      this.state.receipts.unshift(receipt);
      this.state.receipts.length = Math.min(this.state.receipts.length, 40);
      this.scanCache = undefined;
      this.spaceCache.clear();
      this.save();
      recordEvent('system', `Salud liberó ${fmt(receipt.freed)}`, items.filter(i => i.freed).map(i => i.label).join(', ').slice(0, 200) || undefined, { section: 'ops' });
      return receipt;
    } finally { this.busyLock = false; }
  }

  async optimize(): Promise<{ receipt: Receipt; reniced: number }> {
    const items = await this.scan(true);
    const ids = items.filter(i => i.risk === 'safe' && !i.busy && (i.bytes === null || i.bytes > 0)).map(i => i.id);
    const receipt = await this.clean(ids, [], 'optimize');
    return { receipt, reniced: await this.applyNice() };
  }

  // --- Dónde está el espacio ---

  async space(target: string) {
    const hit = this.spaceCache.get(target);
    if (hit && Date.now() - hit.at < 120_000) return hit.value;
    const run = await hostExec(quiet(`du -a -x -B1 --max-depth=1 -- ${q(target)} 2>/dev/null | sort -rn | head -61`), { user: 'root', timeoutMs: 120_000 });
    const rows = run.stdout.split('\n').map(l => /^(\d+)\t(.+)$/.exec(l)).filter(Boolean).map(m => ({ bytes: +m![1], path: m![2] }));
    const total = rows.find(r => r.path === target)?.bytes ?? 0;
    const kids = rows.filter(r => r.path !== target);
    const types = kids.length ? await hostExec(`find ${q(target)} -mindepth 1 -maxdepth 1 -printf '%y\\t%p\\n' 2>/dev/null | head -20000`, { user: 'root', timeoutMs: 20_000 }) : { stdout: '' };
    const kind = new Map(types.stdout.split('\n').map(l => l.split('\t')).filter(a => a.length === 2).map(([k, p]) => [p, k]));
    const value = { path: target, total, entries: kids.map(k => ({ ...k, name: k.path.split('/').pop(), dir: kind.get(k.path) === 'd', link: kind.get(k.path) === 'l' })) };
    this.spaceCache.set(target, { at: Date.now(), value });
    return value;
  }

  async trash(target: string) {
    const home = await hostHome();
    const p = target;
    const rel = p.startsWith(home + '/') ? p.slice(home.length + 1) : null;
    const deep = (n: number) => p.split('/').filter(Boolean).length >= n;
    const allowed = rel !== null || (p.startsWith('/mnt/') && deep(3)) || (p.startsWith('/media/') && deep(4));
    if (!allowed) throw new HealthError('Sólo se pueden enviar a la papelera elementos de tu carpeta personal o de discos montados (lo de /tmp se limpia desde Limpieza)');
    if (rel !== null && /^(\.ssh|\.gnupg|\.local\/share\/keyrings|\.config\/axon|\.local\/share\/Trash)(\/|$)/.test(rel)) throw new HealthError('Esta ruta guarda credenciales o es la propia papelera: no se puede borrar desde acá');
    const r = await hostExec(`command -v gio >/dev/null || { echo 'Falta gio (libglib2.0-bin)' >&2; exit 3; }; gio trash -- ${q(p)}`, { user: 'user', timeoutMs: 120_000 });
    if (!r.ok) throw new HealthError((r.stderr || r.stdout).trim().slice(0, 200) || 'No se pudo enviar a la papelera', 500);
    this.spaceCache.clear();
    return { ok: true };
  }

  // --- Procesos ---

  async sample() {
    const snap = await py({ action: 'snapshot' });
    if (!snap.ok) return;
    const now = snap.now as number;
    const ticks = new Map<string, number>();
    const prev = this.prev;
    const dt = prev ? now - prev.at : 0;
    const procs = (snap.procs as RawProc[]).map(p => {
      const key = `${p.pid}:${p.start}`;
      ticks.set(key, p.ticks);
      const before = prev?.ticks.get(key);
      const cpu = before !== undefined && dt > 0 ? Math.max(0, ((p.ticks - before) / snap.clk) / dt * 100) : 0;
      return { ...p, key, cpu, age: snap.uptime - p.start / snap.clk };
    });
    const pct = (cur: number[], old?: number[]) => (old && cur[1] > old[1] ? (cur[0] - old[0]) / (cur[1] - old[1]) * 100 : 0);
    const cores = prev ? (snap.cpuCores as number[][]).map((c, i) => pct(c, prev.cores[i])) : [];
    const cpu = prev && snap.cpuTotal ? pct(snap.cpuTotal, prev.totals) : 0;
    this.prev = { at: now, ticks, totals: snap.cpuTotal, cores: snap.cpuCores };
    this.latest = { at: Date.now(), snap, cpu, cores, procs };
    const uid = await this.hostUid();
    const seen = new Set<string>();
    for (const p of procs) {
      if (p.cpu >= 50 && p.uid === uid) { seen.add(p.key); if (!this.hot.has(p.key)) this.hot.set(p.key, Date.now()); }
    }
    for (const k of this.hot.keys()) if (!seen.has(k)) this.hot.delete(k);
    this.cpuTrail.push({ t: Date.now(), cpu, mem: snap.mem.total ? (1 - snap.mem.available / snap.mem.total) * 100 : 0 });
    if (this.cpuTrail.length > 120) this.cpuTrail.shift();
  }
  private uidCache?: number;
  private async hostUid() {
    if (this.uidCache !== undefined) return this.uidCache;
    const r = await hostExec(`id -u ${q(HOST_USER)}`, { user: 'root', timeoutMs: 5000 });
    return this.uidCache = parseInt(r.stdout.trim(), 10) || 1000;
  }

  private ancestors(procs: RawProc[]) {
    const byPid = new Map(procs.map(p => [p.pid, p]));
    const set = new Set<number>();
    let pid = process.pid;
    for (let i = 0; i < 12 && pid > 1; i++) { set.add(pid); pid = byPid.get(pid)?.ppid ?? 0; }
    return set;
  }

  async processes() {
    if (!this.latest || Date.now() - this.latest.at > 8_000) {
      if (!this.prev) { await this.sample(); await Bun.sleep(2500); }
      await this.sample();
    }
    const cur = this.latest;
    if (!cur) throw new HealthError('No se pudo leer la lista de procesos', 503);
    const uid = await this.hostUid();
    const anc = this.ancestors(cur.procs);
    const rules = this.state.settings.autoNice.rules;
    const groups = new Map<string, any>();
    for (const p of cur.procs) {
      if (p.kernel) continue;
      const label = appLabel(p.args);
      const g = groups.get(label) ?? { label, count: 0, cpu: 0, rss: 0, protectedReason: null as string | null, mine: false, hotMinutes: 0, items: [] as any[] };
      const reason = isProtected(p, uid, anc);
      g.count++; g.cpu += p.cpu; g.rss += p.rss;
      g.mine ||= p.uid === uid;
      if (reason) g.protectedReason ??= reason;
      const hotSince = this.hot.get(p.key);
      if (hotSince) g.hotMinutes = Math.max(g.hotMinutes, Math.round((Date.now() - hotSince) / 60_000));
      g.items.push({ pid: p.pid, start: p.start, cpu: +p.cpu.toFixed(1), rss: p.rss, nice: p.nice, age: Math.round(p.age), user: p.user, args: p.args.slice(0, 200), rule: niceRuleFor(p.args, rules)?.label ?? null });
      groups.set(label, g);
    }
    const list = [...groups.values()].map(g => ({ ...g, cpu: +g.cpu.toFixed(1), items: g.items.sort((a: any, b: any) => b.cpu - a.cpu || b.rss - a.rss).slice(0, 25) }));
    const STALE = ['opencode serve', 'wrangler', 'workerd', 'vite', 'next dev', 'webpack', 'http.server', 'live-server', 'storybook'];
    const stale = list.filter(g => g.mine && !g.protectedReason && g.cpu < 1 && g.items.every((i: any) => i.age > 6 * 3600) && STALE.some(s => g.items[0].args.toLowerCase().includes(s)));
    const snap = cur.snap;
    return {
      at: cur.at, ncpu: snap.ncpu, cpu: +cur.cpu.toFixed(1), cores: cur.cores.map((c: number) => +c.toFixed(0)), load: snap.load, temp: snap.temp, freqMhz: snap.freqMhz, psi: snap.psi,
      mem: snap.mem, trail: this.cpuTrail,
      byCpu: list.filter(g => g.cpu >= 0.5).sort((a, b) => b.cpu - a.cpu).slice(0, 25),
      byMem: [...list].sort((a, b) => b.rss - a.rss).slice(0, 25),
      stale,
    };
  }

  private async resolve(pid: number, start: number): Promise<RawProc & { key: string }> {
    if (!this.latest) await this.sample();
    const p = this.latest?.procs.find(x => x.pid === pid && x.start === start);
    if (!p) throw new HealthError('El proceso ya no existe. Actualizá la lista.', 409);
    const reason = isProtected(p, await this.hostUid(), this.ancestors(this.latest!.procs));
    if (reason) throw new HealthError(`No se puede tocar: ${reason.toLowerCase()}`, 403);
    return p;
  }

  async signal(targets: { pid: number; start: number }[], force: boolean) {
    let sent = 0;
    for (const t of targets.slice(0, 200)) {
      try { await this.resolve(t.pid, t.start); } catch (e) { if (targets.length === 1) throw e; continue; }
      const r = await py({ action: 'signal', pid: t.pid, start: t.start, force });
      if (r.ok) sent++; else if (targets.length === 1) throw new HealthError(r.error || 'No se pudo cerrar', 409);
    }
    return { ok: true, sent };
  }

  async renice(targets: { pid: number; start: number }[], nice: number) {
    const items: { pid: number; start: number; nice: number; io: boolean }[] = [];
    for (const t of targets.slice(0, 200)) {
      try { await this.resolve(t.pid, t.start); items.push({ ...t, nice, io: true }); } catch (e) { if (targets.length === 1) throw e; }
    }
    const r = items.length ? await py({ action: 'renice', items }) : { ok: true, changed: 0 };
    if (!r.ok) throw new HealthError(r.error || 'No se pudo cambiar la prioridad', 500);
    return { ok: true, changed: r.changed as number };
  }

  /** Baja la prioridad de las tareas de fondo pesadas (ffmpeg, compiladores…) para que el escritorio y AXON sigan fluidos. */
  async applyNice(): Promise<number> {
    const s = this.state.settings.autoNice;
    if (!s.enabled || !this.latest) return 0;
    const uid = await this.hostUid();
    const anc = this.ancestors(this.latest.procs);
    const items: { pid: number; start: number; nice: number; io: boolean }[] = [];
    for (const p of this.latest.procs) {
      const rule = niceRuleFor(p.args, s.rules);
      if (!rule || p.nice >= rule.nice || p.uid !== uid || isProtected(p, uid, anc)) continue;
      items.push({ pid: p.pid, start: p.start, nice: rule.nice, io: true });
    }
    if (!items.length) return 0;
    const r = await py({ action: 'renice', items: items.slice(0, 200) });
    return r.ok ? (r.changed as number) : 0;
  }

  // --- Historial y crecimiento ---

  async recordDisk() {
    const d = await dfRoot();
    if (!d.total) return;
    this.state.history.push({ t: Date.now(), used: d.used, total: d.total });
    const cutoff = Date.now() - 14 * DAY;
    while (this.state.history.length && this.state.history[0].t < cutoff) this.state.history.shift();
    this.save();
  }

  async snapDirs() {
    const home = await hostHome();
    const r = await hostExec(quiet(`du -x -B1 --max-depth=3 ${q(home)} /var /tmp /opt 2>/dev/null | awk '$1>=104857600'`), { user: 'root', timeoutMs: 600_000 });
    const dirs: DirSnap = {};
    for (const line of r.stdout.split('\n')) { const m = /^(\d+)\t(.+)$/.exec(line); if (m) dirs[m[2]] = +m[1]; }
    if (!Object.keys(dirs).length) return;
    this.state.snaps.push({ t: Date.now(), dirs });
    while (this.state.snaps.length > 12) this.state.snaps.shift();
    this.save();
  }

  growth() {
    const snaps = this.state.snaps;
    const last = snaps[snaps.length - 1];
    if (!last) return { since: null, items: [], diskDelta: null };
    const want = last.t - DAY;
    const base = [...snaps].reverse().find(s => s.t <= want + 4 * 3600_000 && s !== last) ?? snaps.find(s => s !== last && last.t - s.t >= 3 * 3600_000);
    const hist = this.state.history;
    const ref = base ? hist.find(h => h.t >= base.t) : undefined;
    const now = hist[hist.length - 1];
    return {
      since: base?.t ?? null,
      items: base ? growthBetween(base.dirs, last.dirs) : [],
      diskDelta: ref && now ? now.used - ref.used : null,
    };
  }

  historySeries() {
    const h = this.state.history;
    const step = Math.max(1, Math.ceil(h.length / 240));
    return h.filter((_, i) => i % step === 0 || i === h.length - 1);
  }

  async recommendations() {
    const out: { level: 'warn' | 'info'; title: string; detail: string; go: string }[] = [];
    const d = await dfRoot();
    const pct = d.total ? d.used / d.total * 100 : 0;
    if (pct >= 85) out.push({ level: 'warn', title: `El disco está al ${pct.toFixed(0)} %`, detail: `Quedan ${fmt(d.avail)} libres.`, go: 'limpieza' });
    const items = this.scanCache?.items ?? [];
    const safe = items.filter(i => i.risk === 'safe' && !i.busy).reduce((s, i) => s + (i.bytes ?? 0), 0);
    if (safe >= 100 * 1024 * 1024) out.push({ level: 'info', title: `${fmt(safe)} se pueden liberar sin riesgo`, detail: 'Temporales, registros y archivos de base de datos ya procesados.', go: 'optimize' });
    for (const i of items.filter(x => x.risk === 'review' && (x.bytes ?? 0) >= 1024 ** 3)) out.push({ level: 'info', title: `${i.label}: ${fmt(i.bytes!)}`, detail: 'Revisá y vaciala si ya no necesitás lo que tiene.', go: 'limpieza' });
    if (this.latest) {
      const mem = this.latest.snap.mem;
      if (mem.total && mem.available / mem.total < 0.1) out.push({ level: 'warn', title: 'Queda muy poca memoria libre', detail: `Disponible: ${fmt(mem.available)}. Cerrá lo que más usa en Rendimiento.`, go: 'rendimiento' });
      const hot = [...this.hot.values()].filter(since => Date.now() - since > 5 * 60_000).length;
      if (hot) out.push({ level: 'warn', title: `${hot} proceso${hot > 1 ? 's' : ''} usando mucha CPU hace más de 5 minutos`, detail: 'Podés bajarles la prioridad o cerrarlos.', go: 'rendimiento' });
    }
    return out;
  }

  async overview() {
    const [disk, disks] = await Promise.all([dfRoot(), dfAll()]);
    const cur = this.latest;
    return {
      disk, disks, growth: this.growth(), history: this.historySeries(),
      cpu: cur ? { pct: +cur.cpu.toFixed(1), ncpu: cur.snap.ncpu, temp: cur.snap.temp, load: cur.snap.load, freqMhz: cur.snap.freqMhz, psi: cur.snap.psi } : null,
      mem: cur?.snap.mem ?? null, trail: this.cpuTrail,
      recommendations: await this.recommendations(), lastRun: this.state.receipts[0] ?? null,
      lastSnap: this.state.snaps[this.state.snaps.length - 1]?.t ?? null, settings: this.state.settings,
    };
  }

  setSettings(body: any) {
    const next = structuredClone(this.state.settings);
    if (body.autoClean) {
      if (typeof body.autoClean.enabled === 'boolean') next.autoClean.enabled = body.autoClean.enabled;
      if (Array.isArray(body.autoClean.ids)) next.autoClean.ids = body.autoClean.ids.filter((x: unknown) => typeof x === 'string' && x.length < 40 && AUTO_DEFAULT.includes(x));
    }
    if (body.autoNice) {
      if (typeof body.autoNice.enabled === 'boolean') next.autoNice.enabled = body.autoNice.enabled;
      if (Array.isArray(body.autoNice.rules)) {
        const known = new Map(DEFAULT_NICE_RULES.map(r => [r.id, r]));
        const rules: NiceRule[] = [];
        for (const r of body.autoNice.rules.slice(0, 24)) {
          if (!r || typeof r.id !== 'string' || !Array.isArray(r.needles)) continue;
          const base = known.get(r.id);
          const needles: string[] = base ? base.needles : r.needles.filter((n: unknown) => typeof n === 'string' && n.trim().length >= 3 && n.length <= 40).map((n: string) => n.trim()).slice(0, 5);
          const nice = Math.min(19, Math.max(1, Math.round(Number(r.nice)) || 10));
          if (!needles.length) continue;
          rules.push({ id: String(r.id).slice(0, 40), label: base ? base.label : String(r.label || needles[0]).slice(0, 60), needles, nice, enabled: r.enabled !== false, custom: !base });
        }
        next.autoNice.rules = rules;
      }
    }
    this.state.settings = next;
    this.save();
    return next;
  }

  start() {
    const every = (ms: number, fn: () => Promise<unknown>) => { const t = setInterval(() => { fn().catch(() => {}); }, ms); (t as { unref?: () => void }).unref?.(); this.timers.push(t); };
    const first = (ms: number, fn: () => Promise<unknown>) => { const t = setTimeout(() => { fn().catch(() => {}); }, ms); (t as { unref?: () => void }).unref?.(); };
    first(5_000, async () => { await this.load(); await this.sample(); await this.recordDisk(); });
    every(30_000, async () => { await this.load(); await this.sample(); await this.applyNice(); });
    every(5 * 60_000, async () => { await this.load(); await this.recordDisk(); });
    every(60 * 60_000, async () => {
      await this.load();
      const last = this.state.snaps[this.state.snaps.length - 1]?.t ?? 0;
      if (Date.now() - last > 6 * 3600_000) await this.snapDirs();
      const auto = this.state.settings.autoClean;
      if (auto.enabled && Date.now() - this.state.lastAuto > DAY) {
        this.state.lastAuto = Date.now();
        const items = await this.scan(true);
        const ids = items.filter(i => i.risk === 'safe' && !i.busy && (auto.ids.includes(i.id) || (i.id.startsWith('wal:') && auto.ids.includes('wal')))).map(i => i.id);
        if (ids.length) await this.clean(ids, [], 'auto');
      }
    });
    first(90_000, async () => { await this.load(); if (!this.state.snaps.length || Date.now() - this.state.snaps[this.state.snaps.length - 1].t > 6 * 3600_000) await this.snapDirs(); });
  }
}

export function fmt(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export function validPath(input: unknown): string {
  if (typeof input !== 'string' || !input.startsWith('/') || input.includes('\0') || input.length > 1024) throw new HealthError('Ruta inválida');
  const clean = path.posix.normalize(input).replace(/\/+$/, '') || '/';
  if (clean !== input.replace(/\/+$/, '') && input !== '/') throw new HealthError('Ruta inválida');
  if (/^\/(proc|sys|dev|run)(\/|$)/.test(clean)) throw new HealthError('Esa ruta no es un disco real');
  return clean;
}

export function registerHealthRoutes(app: Hono, dir: string) {
  const service = new HealthService(dir);
  service.start();
  const route = (fn: (c: any) => Promise<any>) => async (c: any) => {
    c.header('Cache-Control', 'private, no-store');
    const origin = c.req.header('origin');
    if (c.req.method !== 'GET' && origin) {
      let ok = false;
      try { ok = new URL(origin).host === c.req.header('host'); } catch { /* Origin inválido */ }
      if (!ok) return c.json({ ok: false, error: 'Origen de solicitud inválido.' }, 403);
    }
    try { await service.load(); return c.json(await fn(c)); }
    catch (e) {
      if (e instanceof HealthError) return c.json({ ok: false, error: e.message }, e.status);
      return c.json({ ok: false, error: 'No se pudo completar la operación.' }, 500);
    }
  };
  const body = async (c: any) => { try { return await c.req.json(); } catch { throw new HealthError('Cuerpo inválido'); } };
  const targets = (b: any) => {
    if (!Array.isArray(b.targets) || !b.targets.length) throw new HealthError('Sin procesos seleccionados');
    return b.targets.map((t: any) => ({ pid: Number(t.pid), start: Number(t.start) })).filter((t: any) => Number.isInteger(t.pid) && Number.isInteger(t.start));
  };

  app.get('/api/health/overview', route(async () => ({ ok: true, ...(await service.overview()) })));
  app.get('/api/health/cleanup', route(async c => ({ ok: true, items: await service.scan(c.req.query('refresh') === '1'), receipts: service.state.receipts.slice(0, 10) })));
  app.post('/api/health/cleanup/run', route(async c => {
    const b = await body(c);
    if (!Array.isArray(b.ids) || !b.ids.length || b.ids.some((x: unknown) => typeof x !== 'string')) throw new HealthError('Selección inválida');
    const confirmed = Array.isArray(b.confirmed) ? b.confirmed.filter((x: unknown) => typeof x === 'string') : [];
    return { ok: true, receipt: await service.clean(b.ids.slice(0, 80), confirmed, 'clean') };
  }));
  app.post('/api/health/optimize', route(async () => ({ ok: true, ...(await service.optimize()) })));
  app.get('/api/health/space', route(async c => ({ ok: true, ...(await service.space(validPath(c.req.query('path') || await hostHome()))) })));
  app.post('/api/health/space/trash', route(async c => service.trash(validPath((await body(c)).path))));
  app.get('/api/health/processes', route(async () => ({ ok: true, ...(await service.processes()) })));
  app.post('/api/health/process/renice', route(async c => { const b = await body(c); return service.renice(targets(b), Math.min(19, Math.max(1, Math.round(Number(b.nice)) || 10))); }));
  app.post('/api/health/process/close', route(async c => { const b = await body(c); return service.signal(targets(b), b.force === true); }));
  app.put('/api/health/settings', route(async c => ({ ok: true, settings: service.setSettings(await body(c)) })));
  return service;
}

