import type { Hono } from 'hono';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { collectResources, inventory, type ContainerInfo } from './optimizer-collector';
import { assessContainer, sustainedHigh, type Preference } from './optimizer-policy';
import { SnapshotCache } from './snapshot-cache';
import { hostExec } from './host';
import { ActivityGuard, auditedDatabase, probePostgres, type ActivityProbe } from './optimizer-activity';
import { recordEvent } from './events';
import type { AppConfig } from './types';

type Resources = Awaited<ReturnType<typeof collectResources>>;
type ReceiptItem = { id: string; name: string; created: string; status: 'pending' | 'stopped' | 'failed' | 'restored' | 'skipped'; smartShutdown?: boolean; error?: string };
type Receipt = { id: string; at: number; before: number; after?: number; items: ReceiptItem[]; cleanup?: { status: 'pending' | 'ok' | 'failed'; detail?: string }; complete: boolean };
type State = { preferences: Record<string, Preference>; receipts: Receipt[] };
type Point = { at: number; cpu: number; memory: number; top: { name: string; cpu: number; kind: string }[] };
type Plan = { token: string; expiresAt: number; before: number; items: ContainerInfo[]; cleanup: boolean };

async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, file);
}
class OperationError extends Error { constructor(message: string, public status = 409) { super(message); } }

// 60 s era corto para leer la propuesta con calma; 3 min sigue obligando a
// re-verificar el estado antes de aplicar.
export const PLAN_TTL_MS = 180_000;

export class Optimizer {
  private state: State = { preferences: {}, receipts: [] };
  private points: Point[] = [];
  private loaded?: Promise<void>;
  private busy = false;
  private plans = new Map<string, Plan>();
  private cache = new SnapshotCache<Resources>(10_000, 1);
  private lastHistorySave = 0;
  private historySave = Promise.resolve();
  private activity: ActivityGuard;
  constructor(private deps: {
    dir: string;
    config: () => Promise<AppConfig>;
    collect?: typeof collectResources;
    inventory?: typeof inventory;
    run?: (command: string) => Promise<{ ok: boolean; stdout: string }>;
    selfId?: string;
    event?: (title: string) => void;
    now?: () => number;
    probe?: ActivityProbe;
  }) { this.activity = new ActivityGuard(deps.probe, () => this.now()); }
  private now() { return this.deps.now?.() ?? Date.now(); }
  private async load() {
    if (!this.loaded) {
      const attempt = (async () => {
      try {
        const state = JSON.parse(await readFile(path.join(this.deps.dir, 'optimizer.json'), 'utf8'));
        if (!state || !state.preferences || Array.isArray(state.preferences) || !Array.isArray(state.receipts)) throw new Error('Formato inválido');
        this.state = state;
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw new OperationError('No se pudo leer la configuración de optimización. Se bloquearon las acciones.', 503);
      }
      try {
        const points = JSON.parse(await readFile(path.join(this.deps.dir, 'optimizer-history.json'), 'utf8'));
        if (Array.isArray(points)) this.points = points.filter(p => Number.isFinite(p.at) && Number.isFinite(p.cpu) && Array.isArray(p.top)).slice(-2880);
      } catch { /* history is informational; never grants permission to stop */ }
    })();
      this.loaded = attempt;
      // A rejected attempt (corrupt optimizer.json) must not be cached
      // forever — once the file is fixed the next call retries.
      attempt.catch(() => { if (this.loaded === attempt) this.loaded = undefined; });
    }
    return this.loaded;
  }
  private async save() { await atomicJson(path.join(this.deps.dir, 'optimizer.json'), this.state); }
  private async exclusive<T>(fn: () => Promise<T>) {
    if (this.busy) throw new OperationError('Hay otra acción en curso. Esperá a que termine.');
    this.busy = true;
    try { await this.load(); return await fn(); } finally { this.busy = false; }
  }
  private async assessed(rows: ContainerInfo[], checkActivity = true) {
    const cfg = await this.deps.config();
    return Promise.all(rows.map(async c => {
      const app = assessContainer(c, rows, this.state.preferences, cfg.domains, this.deps.selfId);
      const eligible = app.canStop;
      const activity = eligible && checkActivity ? await this.activity.check(c) : null;
      return { ...app, eligible, activity, canStop: eligible && (!checkActivity || activity?.state === 'idle'), blocked: app.blocked || (activity && activity.state !== 'idle' ? activity.reason : null) };
    }));
  }
  private async rows() { return (this.deps.inventory || inventory)(); }
  private async run(command: string) {
    if (this.deps.run) return this.deps.run(command);
    const r = await hostExec(command, { timeoutMs: 60_000 });
    // Raw stderr can contain configuration details. Keep user-facing failures simple.
    return { ok: r.ok, stdout: r.stdout };
  }
  async snapshot() {
    await this.load();
    const raw = await this.cache.get('host', this.deps.collect || collectResources);
    const apps = await this.assessed(raw.containers);
    const cfg = await this.deps.config();
    const processes = raw.processes.map(p => {
      const project = cfg.projects?.filter(pr => p.cwd === pr.cwd || p.cwd.startsWith(pr.cwd + '/')).sort((a, b) => b.cwd.length - a.cwd.length)[0];
      const purpose = project ? `Proyecto ${project.name}` : /ffmpeg|handbrake/i.test(p.name) ? 'Procesamiento de video: exportación, conversión o compresión en curso' : /chrom|firefox/i.test(p.name) ? 'Navegador y pestañas abiertas' : /codex|claude|opencode|gemini/i.test(p.name) ? 'Agente de IA y tareas en ejecución' : /dockerd|containerd/i.test(p.name) ? 'Motor que mantiene los contenedores' : 'Proceso del servidor';
      return { ...p, title: project?.name || p.name, purpose };
    });
    const top = [...apps.filter(a => a.cpu !== null).map(a => ({ name: a.name, cpu: a.cpu!, kind: 'docker' })), ...processes.map(p => ({ name: p.title, cpu: p.cpu, kind: 'host' }))].sort((a, b) => b.cpu - a.cpu).slice(0, 5);
    if (this.points.at(-1)?.at !== raw.at) {
      this.points.push({ at: raw.at, cpu: raw.cpu.busy, memory: raw.memory.percent, top });
      this.points = this.points.filter(p => raw.at - p.at < 24 * 60 * 60_000).slice(-2880);
      if (this.now() - this.lastHistorySave >= 30_000) {
        this.lastHistorySave = this.now();
        const points = [...this.points];
        this.historySave = this.historySave.catch(() => {}).then(() => atomicJson(path.join(this.deps.dir, 'optimizer-history.json'), points));
        this.historySave.catch(() => {});
      }
    }
    const { containers: _containers, processes: _processes, ...resources } = raw;
    return { ...resources, apps, processes, history: this.points.slice(-120), highForMs: sustainedHigh(this.points), receipts: this.state.receipts.slice(-10).reverse(), busy: this.busy };
  }
  async preference(id: string, importance: string) {
    if (!['unknown', 'always', 'sometimes'].includes(importance)) throw new OperationError('Elegí una opción válida.', 400);
    return this.exclusive(async () => {
      const app = (await this.assessed(await this.rows(), false)).find(c => c.id === id);
      if (!app) throw new OperationError('La aplicación cambió o ya no existe. Actualizá la lista.');
      if (importance === 'sometimes' && (app.critical || app.dependents.length)) throw new OperationError(app.blocked || 'Aplicación protegida.');
      const previous = this.state.preferences[id];
      this.state.preferences[id] = { importance: importance as Preference['importance'], created: app.created, image: app.image };
      try { await this.save(); } catch (e) { if (previous) this.state.preferences[id] = previous; else delete this.state.preferences[id]; throw e; }
      this.plans.clear();
      return { ok: true };
    });
  }
  async plan(cleanup: boolean, ids?: string[]) {
    await this.load();
    if (this.busy) throw new OperationError('Hay otra acción en curso.');
    const snapshot = await this.snapshot();
    if (snapshot.errors.some(e => e.includes('Docker'))) throw new OperationError('No se pudo verificar Docker. Reintentá antes de optimizar.', 503);
    const fresh = await this.assessed(await this.rows());
    const eligible = fresh.filter(c => c.eligible);
    if (ids && (ids.length > 50 || ids.some(id => !eligible.some(c => c.id === id)))) throw new OperationError('La selección incluye aplicaciones que no se pueden apagar.');
    const selected = ids ? eligible.filter(c => ids.includes(c.id)) : eligible;
    const items = selected.filter(c => c.canStop);
    const skipped = selected.filter(c => !c.canStop).map(c => ({ id: c.id, name: c.name, reason: c.blocked }));
    const token = crypto.randomUUID();
    const plan: Plan = { token, expiresAt: this.now() + PLAN_TTL_MS, before: snapshot.cpu.busy, items, cleanup };
    for (const [key, p] of this.plans) if (p.expiresAt < this.now()) this.plans.delete(key);
    if (this.plans.size >= 20) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(token, plan);
    return { ok: true, token, expiresAt: plan.expiresAt, apps: items, skipped, cleanup, message: items.length || cleanup ? 'Revisá qué va a cambiar antes de aplicar.' : skipped.length ? 'Se mantienen encendidas: ' + skipped.map(c => `${c.name}: ${c.reason}`).join(' ') : 'No hay aplicaciones autorizadas para apagar. Podés marcar las que usás de vez en cuando.' };
  }
  async apply(token: string) {
    return this.exclusive(async () => {
      const plan = this.plans.get(token);
      this.plans.delete(token);
      if (!plan || plan.expiresAt < this.now()) throw new OperationError('La propuesta venció o ya se usó. Prepará una nueva.');
      const fresh = await this.assessed(await this.rows(), false);
      for (const old of plan.items) {
        const c = fresh.find(c => c.id === old.id);
        if (!c?.canStop || c.created !== old.created || c.image !== old.image || c.imageId !== old.imageId || c.startedAt !== old.startedAt) throw new OperationError('Cambió una aplicación o su protección. Revisá una nueva propuesta.');
      }
      const receipt: Receipt = { id: crypto.randomUUID(), at: this.now(), before: plan.before, items: plan.items.map(c => ({ id: c.id, name: c.name, created: c.created, status: 'pending', smartShutdown: !!auditedDatabase(c) })), complete: false };
      if (plan.cleanup) receipt.cleanup = { status: 'pending' };
      this.state.receipts.push(receipt); this.state.receipts = this.state.receipts.slice(-20);
      // Persist intent BEFORE any side effect: recovery still works after a crash.
      await this.save();
      for (const item of receipt.items) {
        // Recheck immediately before each stop; no broad stop/kill/prune command.
        const old = plan.items.find(c => c.id === item.id)!;
        const live = (await this.assessed(await this.rows(), false)).find(c => c.id === item.id);
        if (!live?.canStop || live.created !== item.created || live.image !== old.image || live.imageId !== old.imageId || live.startedAt !== old.startedAt) { item.status = 'skipped'; item.error = 'Cambió el estado o la protección. Se mantiene encendida.'; }
        else {
          // Never use cached activity to authorize a stop. New connections,
          // counters, observation gaps or probe failures leave the app running.
          const activity = await this.activity.check(live);
          if (activity.state !== 'idle') { item.status = 'skipped'; item.error = activity.reason; }
          else {
            // PostgreSQL SIGTERM is smart shutdown: disallow new connections,
            // let existing sessions finish. Never fall through to SIGKILL, even
            // when work starts in the unavoidable probe-to-signal interval.
            const command = auditedDatabase(live) ? `docker stop --signal SIGTERM --timeout -1 ${item.id}` : `docker stop --time 15 ${item.id}`;
            const result = await this.run(command);
            item.status = result.ok ? 'stopped' : 'failed';
            if (!result.ok) item.error = item.smartShutdown ? 'El apagado seguro no se confirmó. Puede estar esperando conexiones que aparecieron al final; no se fuerza su cierre. Actualizá y reintentá Volver a encender cuando haya terminado.' : 'No se pudo confirmar la parada. Revisá el estado; podés usar Volver a encender.';
          }
        }
        await this.save();
      }
      if (receipt.cleanup) {
        const result = await this.run('docker builder prune --force --filter until=168h');
        receipt.cleanup = { status: result.ok ? 'ok' : 'failed', detail: result.ok ? result.stdout.match(/Total reclaimed space:\s*([^\n]+)/i)?.[1] || 'Limpieza completada; Docker no informó el espacio recuperado.' : 'No se pudo confirmar la limpieza de caché.' };
        await this.save();
      }
      receipt.complete = true;
      this.cache.clear();
      try { receipt.after = (await this.snapshot()).cpu.busy; } catch { /* actions are recorded even if the new measurement fails */ }
      await this.save();
      this.deps.event?.(`Optimización: ${receipt.items.filter(i => i.status === 'stopped').length} aplicaciones apagadas${receipt.cleanup?.status === 'ok' ? ', caché de compilación limpiada' : ''}`);
      return { ok: true, receipt };
    });
  }
  async undo(receiptId: string) {
    return this.exclusive(async () => {
      const receipt = this.state.receipts.find(r => r.id === receiptId);
      if (!receipt) throw new OperationError('No se encontró esa acción.', 404);
      for (const item of receipt.items) {
        if (item.status === 'restored' || item.status === 'skipped') continue;
        const c = (await this.rows()).find(c => c.id === item.id && c.created === item.created);
        if (!c) { item.error = 'El contenedor fue eliminado o reemplazado. No se inicia otro en su lugar.'; continue; }
        if (c.state === 'running') {
          if (item.smartShutdown && (item.status === 'pending' || item.status === 'failed')) {
            try { await (this.deps.probe || probePostgres)(c); }
            catch { item.error = 'La base puede estar terminando su apagado seguro. No se fuerza el cierre ni se informa como restaurada. Reintentá cuando haya terminado.'; await this.save(); continue; }
          }
          item.status = 'restored'; delete item.error;
        }
        else if (c.state === 'exited' || c.state === 'created') {
          const r = await this.run(`docker start ${c.id}`);
          if (r.ok) { item.status = 'restored'; delete item.error; }
          else item.error = 'No se pudo volver a encender. Reintentá.';
        } else item.error = 'La aplicación está cambiando de estado. Reintentá.';
        await this.save();
      }
      this.cache.clear();
      this.deps.event?.('Restauración de aplicaciones desde Salud');
      return { ok: true, receipt };
    });
  }
  // Manual start for an exited/created container. Identity is re-checked so a
  // replaced container can't be started under a stale name.
  async start(id: string) {
    return this.exclusive(async () => {
      const c = (await this.rows()).find(c => c.id === id);
      if (!c) throw new OperationError('La aplicación cambió o ya no existe. Actualizá la lista.', 404);
      if (c.state === 'running') return { ok: true, already: true };
      if (c.state !== 'exited' && c.state !== 'created') throw new OperationError('La aplicación está cambiando de estado. Actualizá y reintentá.');
      const r = await this.run(`docker start ${c.id}`);
      if (!r.ok) throw new OperationError('No se pudo encender. Revisá su estado en Programas.');
      this.cache.clear();
      this.deps.event?.(`Se encendió ${c.name} desde Salud`);
      return { ok: true };
    });
  }
}

export function registerOptimizerRoutes(app: Hono, config: () => Promise<AppConfig>, busyGuard?: () => Promise<string | null>) {
  const service = new Optimizer({
    dir: path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'), config,
    selfId: process.env.HOSTNAME || '',
    event: title => recordEvent('system', title, undefined, { section: 'ops' }),
  });
  const json = async (c: any) => {
    try { return await c.req.json(); }
    catch { throw new OperationError('Cuerpo de la solicitud inválido.', 400); }
  };
  const route = (fn: (c: any) => Promise<any>) => async (c: any) => {
    c.header('Cache-Control', 'private, no-store');
    const origin = c.req.header('origin');
    if (c.req.method !== 'GET' && origin) {
      let validOrigin = false;
      try { validOrigin = new URL(origin).host === c.req.header('host'); } catch { /* invalid Origin */ }
      if (!validOrigin) return c.json({ ok: false, error: 'Origen de solicitud inválido.' }, 403);
    }
    try { return c.json(await fn(c)); } catch (e) { return c.json({ ok: false, error: e instanceof OperationError ? e.message : 'No se pudo completar la operación. No se aplicarán nuevas acciones hasta poder verificar el servidor.' }, e instanceof OperationError ? e.status : 503); }
  };
  app.get('/api/optimizer', route(async () => ({ ok: true, snapshot: await service.snapshot() })));
  app.put('/api/optimizer/apps/:id', route(async c => service.preference(c.req.param('id'), (await json(c)).importance)));
  app.post('/api/optimizer/plan', route(async c => {
    const body = await json(c);
    if (body.ids !== undefined && (!Array.isArray(body.ids) || body.ids.some((v: unknown) => typeof v !== 'string'))) throw new OperationError('Selección inválida.', 400);
    return service.plan(body.cleanup === true, body.ids);
  }));
  // docker stop/start must not race an in-flight compose apply/recovery —
  // same guard the docker/compose mutation routes use.
  const dockerGuard = async () => {
    const msg = await busyGuard?.();
    if (msg) throw new OperationError(msg, 409);
  };
  app.post('/api/optimizer/apply', route(async c => { await dockerGuard(); return service.apply((await json(c)).token); }));
  app.post('/api/optimizer/undo', route(async c => { await dockerGuard(); return service.undo((await json(c)).receiptId); }));
  app.post('/api/optimizer/apps/:id/start', route(async c => { await dockerGuard(); return service.start(c.req.param('id')); }));
  // Attribute spikes even while the UI is closed. Never run automatic actions.
  const timer = setInterval(() => service.snapshot().catch(() => {}), 30_000);
  timer.unref();
  return service;
}
