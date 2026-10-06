import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Optimizer } from './optimizer';
import { assessContainer, sustainedHigh } from './optimizer-policy';
import { cpuCounters, cpuDelta, dockerMemoryMb, memoryInfo, processStat } from './resource-math';
import type { ContainerInfo } from './optimizer-collector';
import type { AppConfig } from './types';
import audited from './optimizer-audited-databases.json';
import { ActivityGuard, auditedDatabase, networkFingerprint } from './optimizer-activity';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const container = (name = 'homepage', extra: Partial<ContainerInfo> = {}): ContainerInfo => ({ id: 'a'.repeat(64), name, image: `test/${name}:1`, imageId: 'sha256:test', created: '2026-10-01', state: 'running', pid: 100, startedAt: '2026-10-02', project: 'stack', service: name, dependencies: [], ports: [3000], portBindings: [], cpu: 10, memoryMb: 256, ...extra });
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'axon-optimizer-test-')); dirs.push(dir);
  let rows = [container()]; let now = 100_000; let collectionCount = 0;
  const commands: string[] = [];
  const cfg = { domains: [], settings: {}, projects: [] } as unknown as AppConfig;
  let failStop = false; let signal = { sessions: 0, work: 0, fingerprint: 'quiet' }; let probeFails = false;
  const deps = {
    probe: async () => { if (probeFails) throw new Error('Unavailable'); return signal; },
    dir, config: async () => cfg, inventory: async () => structuredClone(rows), now: () => now,
    collect: async () => { collectionCount++; return { at: now, intervalMs: 1000, cpu: { busy: 50, wait: 0, steal: 0, total: 1600, cores: 16, pressure10: 0 }, memory: { totalMb: 1000, usedMb: 500, availableMb: 500, percent: 50, cacheMb: 100, swapUsedMb: 0 }, disk: { totalGb: 100, usedGb: 50, availableGb: 50, percent: 50 }, load: [1, 1, 1], containers: structuredClone(rows), processes: [], errors: [] }; },
    run: async (cmd: string) => {
      commands.push(cmd);
      // Verify recoverable intent reached disk BEFORE issuing a stop.
      const state = JSON.parse(await readFile(path.join(dir, 'optimizer.json'), 'utf8'));
      if (cmd.startsWith('docker stop')) {
        expect(state.receipts.at(-1).items[0].status).toBe('pending');
        rows[0].state = 'exited';
        return { ok: !failStop, stdout: '' };
      }
      if (cmd.startsWith('docker start')) rows[0].state = 'running';
      return { ok: true, stdout: 'Total reclaimed space: 12MB\n' };
    },
  };
  const service = new Optimizer(deps);
  return { service, deps, commands, cfg, rows, signal, probeFails: () => { probeFails = true; }, warm: async () => { for (let i = 0; i < 5; i++) { if(i) now += 30_000; await service.snapshot(); } }, setRows: (r: ContainerInfo[]) => { rows = r; }, advance: (n: number) => { now += n; }, failStop: () => { failStop = true; }, count: () => collectionCount };
}

describe('host resource accounting', () => {
  test('separates I/O wait and steal, ignores duplicate guest counters', () => {
    const a = cpuCounters('cpu 0 0 0 0 0 0 0 0 0 0');
    const b = cpuCounters('cpu 20 0 10 30 25 0 0 15 20 0');
    expect(cpuDelta(a, b)).toEqual({ busy: 30, wait: 25, steal: 15, total: 100 });
    expect(() => cpuDelta(b, b)).toThrow();
  });
  test('memory uses available, does not pretend all cache is pressure', () => {
    const m = memoryInfo('MemTotal: 1024000 kB\nMemAvailable: 512000 kB\nCached: 256000 kB\nSReclaimable: 10240 kB\nShmem: 1024 kB\nSwapTotal: 102400 kB\nSwapFree: 51200 kB');
    expect(m.percent).toBe(50); expect(m.cacheMb).toBe(259); expect(m.swapUsedMb).toBe(50);
    expect(() => memoryInfo('')).toThrow();
  });
  test('process names can contain parentheses, PID incarnation is preserved', () => {
    const fields = ['R', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0', '10', '20', '0', '0', '0', '0', '0', '0', '123', '0', '1'];
    expect(processStat(`42 (name (worker)) ${fields.join(' ')}`)).toEqual({ name: 'name (worker)', ticks: 30, start: '123', ppid: 1 });
    expect(dockerMemoryMb('2GiB / 4GiB')).toBe(2048);
    expect(dockerMemoryMb('512MiB / 4GiB')).toBe(512);
    expect(dockerMemoryMb('unknown')).toBeNull();
  });
  test('a gap or low measurement interrupts sustained-high claims', () => {
    expect(sustainedHigh([{ at: 0, cpu: 92 }, { at: 30_000, cpu: 90 }, { at: 60_000, cpu: 90 }])).toBe(60_000);
    expect(sustainedHigh([{ at: 0, cpu: 92 }, { at: 60_000, cpu: 90 }])).toBe(0);
    expect(sustainedHigh([{ at: 0, cpu: 92 }, { at: 30_000, cpu: 20 }, { at: 60_000, cpu: 90 }])).toBe(0);
  });
});

describe('optimizer safety and recovery', () => {
  test('only the exact audited local databases are automatically eligible', () => {
    const c = container(audited[0].name, { ...audited[0] });
    expect(assessContainer(c, [c], {}, []).canStop).toBe(true);
    expect(assessContainer(c, [c], {}, []).auditedLocal).toBe(true);
    expect(auditedDatabase({ ...c, id: 'f'.repeat(64) })).toBeUndefined();
    expect(auditedDatabase({ ...c, imageId: 'sha256:changed' })).toBeUndefined();
    expect(auditedDatabase({ ...c, created: 'replacement' })).toBeUndefined();
    const exposed = { ...c, portBindings: [{ hostIp: '0.0.0.0', hostPort: 5432, containerPort: 5432 }] };
    expect(assessContainer(exposed, [exposed], {}, []).critical).toBe(true);
    const client = container('client', { id: 'b'.repeat(64), dependencies: [c.service] });
    expect(assessContainer(c, [c, client], {}, []).canStop).toBe(false);
    expect(assessContainer(c, [c], { [c.id]: { importance: 'always', created: c.created, image: c.image } }, []).canStop).toBe(false);
  });
  test('unknown, critical, self and dependency providers are protected', () => {
    const c = container();
    expect(assessContainer(c, [c], {}, []).canStop).toBe(false);
    const pref = { [c.id]: { importance: 'sometimes' as const, created: c.created, image: c.image } };
    expect(assessContainer(c, [c], pref, []).canStop).toBe(true);
    expect(assessContainer(c, [c], pref, [], c.id.slice(0, 12)).canStop).toBe(false);
    for (const name of ['axon', 'cloudflared', 'authentik', 'postgres', 'vaultwarden', 'caddy']) {
      expect(assessContainer(container(name), [], pref, []).critical).toBe(true);
    }
    const dependent = container('client', { id: 'b'.repeat(64), dependencies: ['homepage'] });
    expect(assessContainer(c, [c, dependent], pref, []).canStop).toBe(false);
  });
  test('domain impact is shown and approval does not transfer to recreated apps', () => {
    const c = container();
    const pref = { [c.id]: { importance: 'sometimes' as const, created: 'old', image: c.image } };
    const a = assessContainer(c, [c], pref, [{ port: 3000, fullDomain: 'home.test' } as any]);
    expect(a.importance).toBe('unknown'); expect(a.connections).toEqual(['home.test']);
  });
  test('reading diagnosis or preparing a plan never executes changes', async () => {
    const f = await fixture();
    await Promise.all([f.service.snapshot(), f.service.snapshot()]);
    expect(f.count()).toBe(1);
    const plan = await f.service.plan(false);
    expect(plan.apps).toHaveLength(0); expect(f.commands).toHaveLength(0);
    await expect(f.service.plan(false, ['invalid;cmd'])).rejects.toThrow();
  });
  test('approved exact container stops, restart survives service restart, token is one-use', async () => {
    const f = await fixture(); const c = f.rows[0];
    await f.service.preference(c.id, 'sometimes'); await f.warm();
    const plan = await f.service.plan(false);
    const { receipt } = await f.service.apply(plan.token);
    expect(receipt.items[0].status).toBe('stopped'); expect(f.commands).toEqual([`docker stop --time 15 ${c.id}`]);
    await expect(f.service.apply(plan.token)).rejects.toThrow();
    const restored = await new Optimizer(f.deps).undo(receipt.id);
    expect(restored.receipt.items[0].status).toBe('restored');
    expect(f.commands.at(-1)).toBe(`docker start ${c.id}`);
  });
  test('expired plan, changed preference or a new dependency stop all actions', async () => {
    const f = await fixture(); const c = f.rows[0];
    await f.service.preference(c.id, 'sometimes'); await f.warm();
    const plan = await f.service.plan(false); f.advance(60_001);
    await expect(f.service.apply(plan.token)).rejects.toThrow();
    await f.warm(); const p2 = await f.service.plan(false); await f.service.preference(c.id, 'always');
    await expect(f.service.apply(p2.token)).rejects.toThrow();
    await f.service.preference(c.id, 'sometimes'); await f.warm(); const p3 = await f.service.plan(false);
    f.setRows([c, container('client', { id: 'b'.repeat(64), dependencies: ['homepage'] })]);
    await expect(f.service.apply(p3.token)).rejects.toThrow(); expect(f.commands).toHaveLength(0);
  });
  test('a restarted container invalidates a plan, even with the same ID', async () => {
    const f = await fixture(); await f.service.preference(f.rows[0].id, 'sometimes'); await f.warm();
    const p = await f.service.plan(false); f.rows[0].startedAt = 'new';
    await expect(f.service.apply(p.token)).rejects.toThrow(); expect(f.commands).toHaveLength(0);
  });
  test('uncertain stop is recoverable and never reported as stopped', async () => {
    const f = await fixture(); await f.service.preference(f.rows[0].id, 'sometimes'); await f.warm(); f.failStop();
    const p = await f.service.plan(false); const result = await f.service.apply(p.token);
    expect(result.receipt.items[0].status).toBe('failed');
    const restored = await f.service.undo(result.receipt.id);
    expect(restored.receipt.items[0].status).toBe('restored');
  });
  test('undo never starts a replacement, cleanup is narrowly scoped and opt-in', async () => {
    const f = await fixture(); await f.service.preference(f.rows[0].id, 'sometimes'); await f.warm();
    const p = await f.service.plan(true); const result = await f.service.apply(p.token);
    expect(f.commands.at(-1)).toBe('docker builder prune --force --filter until=168h');
    expect(result.receipt.cleanup).toEqual({ status: 'ok', detail: '12MB' });
    f.setRows([container('homepage', { id: 'b'.repeat(64) })]);
    await f.service.undo(result.receipt.id);
    expect(f.commands.some(c => c.startsWith('docker start'))).toBe(false);
  });
  test('corrupt permission store fails closed', async () => {
    const f = await fixture(); await writeFile(path.join(f.deps.dir, 'optimizer.json'), '{broken');
    await expect(f.service.plan(true)).rejects.toThrow('configuración'); expect(f.commands).toHaveLength(0);
  });
  test('concurrent operations cannot stop or change permissions twice', async () => {
    const f = await fixture(); await f.service.preference(f.rows[0].id, 'sometimes'); await f.warm();
    const p = await f.service.plan(false);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const started = new Promise<void>(r => { entered = r; });
    const originalRun = f.deps.run;
    f.deps.run = async cmd => { entered(); await gate; return originalRun(cmd); };
    const action = f.service.apply(p.token); await started;
    await expect(f.service.apply(p.token)).rejects.toThrow('otra acción');
    await expect(f.service.preference(f.rows[0].id, 'always')).rejects.toThrow('otra acción');
    release(); await action; expect(f.commands).toHaveLength(1);
  });
  test('a connection opened after the preview is preserved; undo never starts a skipped app', async () => {
    const f = await fixture(); await f.service.preference(f.rows[0].id, 'sometimes'); await f.warm();
    const plan = await f.service.plan(false); expect(plan.apps).toHaveLength(1);
    f.signal.sessions = 1;
    const { receipt } = await f.service.apply(plan.token);
    expect(receipt.items[0].status).toBe('skipped'); expect(receipt.items[0].error).toContain('conexión');
    expect(f.commands).toHaveLength(0);
    f.rows[0].state = 'exited'; // external change AFTER optimizer skipped it
    await new Optimizer(f.deps).undo(receipt.id);
    expect(f.commands).toHaveLength(0);
  });
  test('recent short queries, an observation gap and probe errors all prevent a stop', async () => {
    for (const mode of ['counters', 'gap', 'error']) {
      const f = await fixture(); await f.service.preference(f.rows[0].id, 'sometimes'); await f.warm();
      const plan = await f.service.plan(false);
      if (mode === 'counters') f.signal.fingerprint = 'recent query';
      if (mode === 'gap') f.advance(45_001);
      if (mode === 'error') f.probeFails();
      const { receipt } = await f.service.apply(plan.token);
      expect(receipt.items[0].status).toBe('skipped'); expect(f.commands).toHaveLength(0);
    }
  });
  test('preview explains busy apps and supports a mix of free and in-use apps', async () => {
    const f = await fixture(); await f.service.preference(f.rows[0].id, 'sometimes'); await f.warm();
    const other = container('other', { id: 'b'.repeat(64) });
    f.setRows([f.rows[0], other]); await f.service.preference(other.id, 'sometimes');
    f.deps.probe = async c => ({ sessions: c.id === other.id ? 1 : 0, work: 0, fingerprint: 'quiet' });
    const service = new Optimizer(f.deps);
    for (let i = 0; i < 5; i++) { if (i) f.advance(30_000); await service.snapshot(); }
    const plan = await service.plan(false);
    expect(plan.apps.map(c => c.name)).toEqual(['homepage']);
    expect(plan.skipped[0].name).toBe('other'); expect(plan.skipped[0].reason).toContain('conexión');
    await service.apply(plan.token);
    expect(f.commands).toEqual([`docker stop --time 15 ${f.rows[0].id}`]);
  });
  test('audited PostgreSQL uses smart shutdown without a forced kill deadline', async () => {
    const f = await fixture(); f.setRows([container(audited[0].name, { ...audited[0] })]);
    await f.warm(); const plan = await f.service.plan(false); await f.service.apply(plan.token);
    expect(f.commands).toEqual([`docker stop --signal SIGTERM --timeout -1 ${audited[0].id}`]);
  });
  test('a smart shutdown still waiting for sessions is never reported as restored', async () => {
    const f = await fixture(); f.setRows([container(audited[0].name, { ...audited[0] })]);
    f.deps.run = async cmd => { f.commands.push(cmd); return { ok: false, stdout: '' }; };
    await f.warm(); const plan = await f.service.plan(false); const { receipt } = await f.service.apply(plan.token);
    f.probeFails(); await f.service.undo(receipt.id);
    expect(receipt.items[0].status).toBe('failed'); expect(receipt.items[0].error).toContain('apagado seguro');
    expect(f.commands).toHaveLength(1);
    f.setRows([container(audited[0].name, { ...audited[0], state: 'exited' })]);
    f.deps.run = async cmd => { f.commands.push(cmd); return { ok: true, stdout: '' }; };
    await f.service.undo(receipt.id);
    expect(receipt.items[0].status).toBe('restored'); expect(f.commands[1]).toBe(`docker start ${audited[0].id}`);
  });
});

describe('activity observation', () => {
  test('parallel readers share one probe instead of detecting each other as clients', async () => {
    let calls = 0; const c = container();
    const guard = new ActivityGuard(async () => { calls++; await Bun.sleep(10); return { sessions: 0, work: 0, fingerprint: 'quiet' }; });
    const results = await Promise.all([guard.check(c), guard.check(c), guard.check(c)]);
    expect(calls).toBe(1); expect(results.every(r => r.state === 'observing')).toBe(true);
    await guard.check(c); expect(calls).toBe(2);
  });
  test('requires two continuous quiet minutes and resets on sessions, work, counters and errors', async () => {
    let now = 0, fail = false; const c = container();
    const signal = { sessions: 0, work: 0, fingerprint: 'initial' };
    const guard = new ActivityGuard(async () => { if (fail) throw new Error(); return signal; }, () => now);
    const warm = async () => { for (let i = 0; i < 5; i++) { if (i) now += 30_000; await guard.check(c); } };
    expect((await guard.check(c)).state).toBe('observing'); await warm();
    expect((await guard.check(c)).state).toBe('idle');
    signal.sessions = 1; expect((await guard.check(c)).state).toBe('busy');
    signal.sessions = 0; expect((await guard.check(c)).state).toBe('observing'); await warm();
    signal.work = 1; expect((await guard.check(c)).state).toBe('busy');
    signal.work = 0; await warm(); signal.fingerprint = 'new query';
    expect((await guard.check(c)).state).toBe('observing'); await warm();
    fail = true; expect((await guard.check(c)).state).toBe('unknown'); fail = false;
    expect((await guard.check(c)).state).toBe('observing'); await warm(); now += 45_001;
    expect((await guard.check(c)).state).toBe('observing'); await warm();
    expect((await guard.check({ ...c, startedAt: 'restarted' })).state).toBe('observing');
  });
  test('unsupported applications are preserved even when their CPU is zero', async () => {
    expect((await new ActivityGuard().check(container('steel-browser', { cpu: 0 }))).state).toBe('unknown');
  });
  test('network counters keep exact precision and missing/corrupt probes fail closed', () => {
    const net = 'Tcp: ActiveOpens PassiveOpens EstabResets InSegs OutSegs RetransSegs\nTcp: 0 0 0 9007199254740993 42 0';
    expect(networkFingerprint(net)).toContain('9007199254740993');
    expect(() => networkFingerprint('')).toThrow();
    expect(() => networkFingerprint(net.replace('42', 'invalid'))).toThrow();
  });
});
