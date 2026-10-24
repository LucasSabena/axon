import { readFile } from 'node:fs/promises';
import { CONTAINER, q, runWithStdin } from './openbot-shared';

/* Consumo de los agentes de OpenBot. Se lee de una COPIA de la base (nunca de la real).
 * Los costos usan EXACTAMENTE el mismo catálogo y las mismas reglas que la sección Agentes de AXON
 * (scripts/agent-consumption.py → clase Catalog, precios de models.dev con caché diaria): tarifa del proveedor
 * cuando existe, o "equivalente por API" del modelo original para planes fijos como OpenCode Go.
 * Es una estimación de lo que costaría por API directa, no lo que se cobra. */

export const USAGE_PY = String.raw`
import json, os, sqlite3, sys, datetime, types
from pathlib import Path
path, period, folder = sys.argv[1], sys.argv[2], sys.argv[3]
# stdin = código de scripts/agent-consumption.py; se carga como módulo (no ejecuta su main)
mod = types.ModuleType('axon_consumption'); exec(compile(sys.stdin.read(), 'agent-consumption.py', 'exec'), mod.__dict__)
try: catalog = mod.Catalog(Path(folder)).load()
except Exception: catalog = None
now = datetime.datetime.now(datetime.timezone.utc)
cut = None
if period == 'today': cut = now.replace(hour=0, minute=0, second=0, microsecond=0)
elif period in ('7', '30'): cut = now - datetime.timedelta(days=int(period))
cutIso = cut.strftime('%Y-%m-%dT%H:%M:%S') if cut else ''
def tok(t):
    try: j = json.loads(t)
    except Exception: j = {}
    g = lambda k: int(j.get(k) or 0) if not isinstance(j.get(k), bool) else 0
    return dict(input=g('uncachedInput'), cacheRead=g('cachedInput'), cacheWrite=g('cacheCreation'), output=g('output'), reasoning=0, cacheWrite1h=0)
def price(model_id, tk):
    prov, _, name = (model_id or '').partition('/')
    if catalog is None or not name: return dict(status='missing')
    try: return catalog.price(dict(tk, provider=prov, model=name))
    except Exception: return dict(status='missing')
db = sqlite3.connect(path); db.row_factory = sqlite3.Row
agents = {}
for r in db.execute('select agent_id, model, agent_json, updated_at from projection_agents order by sort_order'):
    try: j = json.loads(r['agent_json'])
    except Exception: j = {}
    if j.get('archived') or j.get('deletedAt'): continue
    agents[r['agent_id']] = dict(id=r['agent_id'], name=j.get('name') or r['agent_id'], title=j.get('title') or '', model=j.get('model') or r['model'],
        provider=j.get('provider'), effort=j.get('reasoningEffort'), updatedAt=j.get('updatedAt') or r['updated_at'],
        tokens=0, usd=0.0, pricedRequests=0, freeRequests=0, requests=0, turns=0, lastActivity=None, models={})
daily, bymodel = {}, {}
for r in db.execute('select agent_id, provider, model, occurred_at, tokens_json from agent_usage_records where occurred_at >= ?', (cutIso,)):
    tk = tok(r['tokens_json']); t = sum(tk.values()); p = price(r['model'], tk)
    priced = p.get('status') in ('priced', 'partial'); c = p['usd'] if priced else None
    rates = p.get('rates') or {}
    free = priced and not (rates.get('input') or 0) and not (rates.get('output') or 0)
    a = agents.get(r['agent_id'])
    if a is not None:
        a['tokens'] += t; a['requests'] += 1; a['models'][r['model']] = a['models'].get(r['model'], 0) + t
        if priced: a['usd'] += c; a['pricedRequests'] += 1
        if free: a['freeRequests'] += 1
    day = r['occurred_at'][:10]
    d = daily.setdefault(day, dict(day=day, tokens=0, usd=0.0, requests=0, models={}, modelsUsd={}))
    d['tokens'] += t; d['requests'] += 1; d['usd'] += c or 0; d['models'][r['model']] = d['models'].get(r['model'], 0) + t; d['modelsUsd'][r['model']] = d['modelsUsd'].get(r['model'], 0) + (c or 0)
    m = bymodel.setdefault(r['model'], dict(model=r['model'], provider=(r['model'] or '').split('/')[0], tokens=0, usd=0.0, requests=0, pricedRequests=0, freeRequests=0,
        rate=dict(input=rates.get('input'), output=rates.get('output'), cache_read=rates.get('cacheRead'), cache_write=rates.get('cacheWrite')) if priced else None,
        free=bool(free), priceModel=p.get('model'), basis=p.get('basis'), partial=p.get('status') == 'partial'))
    m['tokens'] += t; m['requests'] += 1
    if priced: m['usd'] += c; m['pricedRequests'] += 1
    if free: m['freeRequests'] += 1
for r in db.execute("select agent_id, count(*) n from agent_usage_activity where kind='turn' and occurred_at >= ? group by agent_id", (cutIso,)):
    if r['agent_id'] in agents: agents[r['agent_id']]['turns'] = r['n']
for r in db.execute('select agent_id, max(occurred_at) last from agent_usage_activity group by agent_id'):
    if r['agent_id'] in agents: agents[r['agent_id']]['lastActivity'] = r['last']
ag = list(agents.values())
for a in ag: a['models'] = [dict(model=k, tokens=v) for k, v in sorted(a['models'].items(), key=lambda kv: -kv[1])]
mods = sorted(bymodel.values(), key=lambda m: -m['tokens'])
tot = dict(tokens=sum(m['tokens'] for m in mods), usd=sum(m['usd'] for m in mods), requests=sum(m['requests'] for m in mods), pricedRequests=sum(m['pricedRequests'] for m in mods),
           freeRequests=sum(m['freeRequests'] for m in mods), turns=sum(a['turns'] for a in ag))
tot['unpricedRequests'] = tot['requests'] - tot['pricedRequests']
print(json.dumps(dict(ok=True, period=period, agents=ag, totals=tot, daily=sorted(daily.values(), key=lambda d: d['day']), models=mods,
    prices=(catalog.meta if catalog else None))))
`;
const USAGE_B64 = Buffer.from(USAGE_PY).toString('base64');

let catalogSource: Promise<string> | undefined;
/** Código de la sección Agentes, de donde se toma el catálogo de precios (se cachea; si falla la lectura, se reintenta). */
export function consumptionSource(): Promise<string> {
  if (!catalogSource) catalogSource = readFile(new URL('../scripts/agent-consumption.py', import.meta.url), 'utf8').catch((e) => { catalogSource = undefined; throw e; });
  return catalogSource;
}

export const CATALOG_FOLDER = '$HOME/.local/share/axon/agent-consumption';

export function usageCommand(period: string, folder = CATALOG_FOLDER) {
  return [
    'T=$(mktemp -d) || exit 1; trap \'rm -rf "$T"\' EXIT',
    `docker cp ${CONTAINER}:/data/.config/OpenBot/openbot.db "$T/openbot.db" >/dev/null 2>&1 || { echo '{"ok":false,"error":"No se pudo leer la base de OpenBot"}'; exit 0; }`,
    `docker cp ${CONTAINER}:/data/.config/OpenBot/openbot.db-wal "$T/openbot.db-wal" >/dev/null 2>&1 || true`,
    `mkdir -p "${folder}" && echo ${USAGE_B64} | base64 -d > "$T/u.py" && python3 "$T/u.py" "$T/openbot.db" ${q(period)} "${folder}"`,
  ].join('; ');
}

export async function readUsage(period: string) {
  const r = await runWithStdin(usageCommand(period), await consumptionSource(), 'user', 60_000);
  try { return JSON.parse(r.stdout.trim().split('\n').pop() || ''); } catch { return null; }
}
