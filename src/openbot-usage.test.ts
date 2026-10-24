import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { USAGE_PY, consumptionSource, usageCommand } from './openbot-usage';

async function fixture(withPrices = true) {
  const dir = mkdtempSync(join(tmpdir(), 'axon-usage-'));
  const db = join(dir, 'o.db'), py = join(dir, 'u.py'), folder = join(dir, 'cat'); mkdirSync(folder);
  writeFileSync(py, USAGE_PY);
  const now = Date.now() / 1000;
  // Mismo formato que la caché de models.dev que usa la sección Agentes ("proveedor/modelo" → costo).
  if (withPrices) writeFileSync(join(folder, 'prices.json'), JSON.stringify({ fetchedAt: now, checkedAt: now, failed: false, models: {
    'opencode-go/pro-model': { cost: { input: 2, output: 10, cache_read: 0.2 }, canonical: 'lab/pro-model', name: 'Pro' },
    'lab/pro-model': { cost: { input: 4, output: 20, cache_read: 0.4 }, canonical: null, name: 'Pro (lab)' },
    'opencode/x-free': { cost: { input: 0, output: 0 }, canonical: null, name: 'Free' },
    'opencode/haiku': { cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 }, canonical: null, name: 'Haiku' },
  } }));
  const sql = `
create table projection_agents (agent_id text primary key, thread_id text, model text not null, updated_at text, sort_order integer not null, agent_json text not null, last_event_sequence integer not null);
create table agent_usage_records (agent_id text, record_id text, session_id text, turn_id text, provider text, model text, occurred_at text, tokens_json text, estimated_cost_usd real, rate_basis text, recorded_at text);
create table agent_usage_activity (agent_id text, activity_id text, session_id text, turn_id text, provider text, model text, kind text, occurred_at text);
insert into projection_agents values ('a1', null, 'opencode-go/pro-model', null, 0, '{"name":"Uno","title":"t"}', 1), ('a2', null, 'opencode/x-free', null, 1, '{"name":"Dos"}', 1), ('gone', null, 'x', null, 2, '{"name":"Borrado","archived":true}', 1);
insert into agent_usage_records values
 ('a1','r1','s','t1','opencode','opencode-go/pro-model','2026-10-10T10:00:00.000Z','{"uncachedInput":1000000,"cachedInput":1000000,"cacheCreation":null,"output":100000}',null,null,''),
 ('a1','r2','s','t2','opencode','opencode/haiku','2026-10-11T10:00:00.000Z','{"uncachedInput":null,"cachedInput":1000000,"cacheCreation":1000000,"output":1000000}',null,null,''),
 ('a2','r3','s','t3','opencode','opencode/x-free','2026-10-11T11:00:00.000Z','{"uncachedInput":500,"cachedInput":0,"cacheCreation":0,"output":50}',null,null,''),
 ('a2','r4','s','t4','opencode','mystery/unknown','2026-10-11T12:00:00.000Z','{"output":10}',null,null,''),
 ('a2','r5','s','t5','opencode','mystery/billed','2026-10-11T13:00:00.000Z','{"output":10}',0.5,'x','');
insert into agent_usage_activity values ('a1','x1','s','t1','opencode','m','turn','2026-10-10T10:00:00.000Z'), ('a2','x2','s','t3','opencode','m','turn','2026-10-11T11:00:00.000Z');`;
  Bun.spawnSync(['python3', '-c', `import sqlite3,sys;d=sqlite3.connect(sys.argv[1]);d.executescript(sys.argv[2]);d.commit()`, db, sql]);
  return { dir, db, py, folder };
}
async function run(f: Awaited<ReturnType<typeof fixture>>, period: string) {
  const r = Bun.spawnSync(['python3', f.py, f.db, period, f.folder], { stdin: new TextEncoder().encode(await consumptionSource()) });
  return JSON.parse(new TextDecoder().decode(r.stdout));
}

test('el consumo usa el catálogo de models.dev de la sección Agentes (proveedor o equivalente API)', async () => {
  const f = await fixture();
  try {
    const d = await run(f, 'all');
    const a1 = d.agents.find((a: any) => a.id === 'a1'), a2 = d.agents.find((a: any) => a.id === 'a2');
    expect(d.agents.map((a: any) => a.id)).toEqual(['a1', 'a2']);                    // el archivado no aparece
    // Plan fijo (opencode-go): se compara con el modelo original del catálogo (lab/pro-model): 1M×4 + 1M×0.4 + 0.1M×20 = 6.4
    const pro = d.models.find((m: any) => m.model === 'opencode-go/pro-model');
    expect(pro.usd).toBeCloseTo(6.4, 6); expect(pro).toMatchObject({ basis: 'api-equivalent', priceModel: 'lab/pro-model', free: false });
    // haiku (tarifa del proveedor): 1M×0.1 (lectura de caché) + 1M×1.25 (escritura) + 1M×5 = 6.35
    const haiku = d.models.find((m: any) => m.model === 'opencode/haiku');
    expect(haiku.usd).toBeCloseTo(6.35, 6); expect(haiku.basis).toBe('provider');
    expect(a1.usd).toBeCloseTo(12.75, 6); expect(a1.pricedRequests).toBe(2);
    // gratis = 0 y cuenta como con precio; sin tarifa no suma; el costo "nativo" del registro NO se toma como factura
    expect(d.models.find((m: any) => m.model === 'opencode/x-free')).toMatchObject({ free: true, usd: 0, pricedRequests: 1 });
    expect(d.models.find((m: any) => m.model === 'mystery/billed')).toMatchObject({ pricedRequests: 0, rate: null });
    expect(a2.usd).toBe(0); expect(a2.pricedRequests).toBe(1); expect(a2.freeRequests).toBe(1);
    expect(d.totals.unpricedRequests).toBe(2);
    expect(d.totals.usd).toBeCloseTo(12.75, 6);
    expect(d.daily.map((x: any) => x.day)).toEqual(['2026-10-10', '2026-10-11']);
    expect(d.daily[1].models['opencode/haiku']).toBe(3_000_000);                      // desglose por modelo de cada día
    expect(d.daily[1].modelsUsd['opencode/haiku']).toBeCloseTo(6.35, 6);              // costo por modelo y día
    expect(a1.models[0].model).toBe('opencode/haiku');                                // modelos del agente por tokens
    expect(d.prices.source).toBe('models.dev');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('si no hay catálogo de precios no se inventa nada', async () => {
  const f = await fixture(false);
  try {
    // Sin prices.json el Catalog intenta bajarlo; sin red falla y queda vacío: todo "sin tarifa".
    const r = Bun.spawnSync(['python3', f.py, f.db, 'all', f.folder], { stdin: new TextEncoder().encode(await consumptionSource()), env: { ...process.env, https_proxy: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' } });
    const d = JSON.parse(new TextDecoder().decode(r.stdout));
    expect(d.totals.usd).toBe(0); expect(d.totals.pricedRequests).toBe(0); expect(d.totals.unpricedRequests).toBe(5);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
}, 30000);

test('usageCommand copia solo lectura, cita el período y usa la carpeta de precios de AXON', () => {
  const cmd = usageCommand('30');
  expect(cmd).toContain("'30'"); expect(cmd).toContain('.local/share/axon/agent-consumption');
  expect(cmd).not.toMatch(/\/var\/lib\/docker/);
});
