import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

// Host permissions belong to installation data, never to the distributed code.
const auditPath = process.env.OPTIMIZER_AUDIT_PATH || path.join(path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'), 'optimizer-audited-databases.json');
const audited: Array<Pick<ContainerInfo, 'id' | 'created' | 'image' | 'imageId' | 'portBindings'> & { purpose: string }> = (() => {
  try {
    const value = JSON.parse(readFileSync(auditPath, 'utf8'));
    return Array.isArray(value) ? value.filter(a => a && /^[a-f0-9]{64}$/.test(a.id) && typeof a.created === 'string' && typeof a.image === 'string' && typeof a.imageId === 'string' && Array.isArray(a.portBindings) && typeof a.purpose === 'string') : [];
  } catch { return []; }
})();
import { hostExec, hostToContainer } from './host';
import type { ContainerInfo } from './optimizer-collector';

// These exact instances were inspected and authorized by the user. A name,
// image tag or low CPU alone is never evidence that a database is disposable.
export function auditedDatabase(c: ContainerInfo) {
  return audited.find(a => a.id === c.id && a.created === c.created && a.image === c.image && a.imageId === c.imageId &&
    JSON.stringify(a.portBindings) === JSON.stringify(c.portBindings));
}

export type Activity = { state: 'idle' | 'busy' | 'unknown' | 'observing'; reason: string; quietForMs?: number };
export type ActivitySignal = { sessions: number; work: number; fingerprint: string };
export type ActivityProbe = (c: ContainerInfo) => Promise<ActivitySignal>;
export const QUIET_WINDOW_MS = 120_000;
const MAX_SAMPLE_GAP_MS = 45_000;

// One READ ONLY transaction; no credentials or row contents leave PostgreSQL.
// The probe uses a Unix socket, so it doesn't alter network counters. Catalog
// reads/commits in the postgres maintenance DB are excluded from the fingerprint;
// mutations in every database and TCP traffic are included. Catalog reads and
// commits alone are not a client-activity signal: pg_isready and PostgreSQL's
// background housekeeping create them even when no application is connected.
const SQL = `BEGIN READ ONLY;
SET LOCAL statement_timeout = '2500ms';
SELECT json_build_object(
  'canInspect', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
  'inRecovery', pg_is_in_recovery(),
  'sessions', (SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND backend_type = 'client backend'),
  'work', (SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND backend_type NOT IN ('client backend', 'checkpointer', 'background writer', 'walwriter', 'autovacuum launcher', 'logical replication launcher')) + (SELECT count(*) FROM pg_prepared_xacts) + (SELECT count(*) FROM pg_replication_slots),
  'stats', (SELECT json_agg(json_build_array(datid, datname, stats_reset, tup_inserted, tup_updated, tup_deleted) ORDER BY datid) FROM pg_stat_database WHERE datname IS NOT NULL)
); COMMIT;`;

export function networkFingerprint(text: string) {
  const rows = text.split('\n').filter(line => line.startsWith('Tcp:')).map(line => line.trim().split(/\s+/).slice(1));
  if (rows.length !== 2 || rows[0].length !== rows[1].length) throw new Error('Missing TCP counters');
  const fields = ['ActiveOpens', 'PassiveOpens', 'EstabResets', 'InSegs', 'OutSegs', 'RetransSegs'];
  const values = fields.map(field => rows[1][rows[0].indexOf(field)]);
  if (values.some(v => !v || !/^\d+$/.test(v))) throw new Error('Invalid TCP counters');
  return JSON.stringify(values); // preserve 64-bit counters as strings; ignore ARP noise
}

export async function probePostgres(c: ContainerInfo): Promise<ActivitySignal> {
  if (!auditedDatabase(c) || !/^[a-f0-9]{64}$/.test(c.id) || !Number.isSafeInteger(c.pid) || c.pid < 1) throw new Error('Unverified database');
  const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
  // The role stays inside the container; its password is neither read nor logged.
  const command = 'PGAPPNAME=axon_optimizer_probe exec psql -X -qAt -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d postgres -c ' + quote(SQL);
  const result = await hostExec(`docker exec ${c.id} sh -c ${quote(command)}`, { timeoutMs: 6000 });
  if (!result.ok) throw new Error('Activity probe failed');
  const value = JSON.parse(result.stdout.trim());
  if (value.canInspect !== true || value.inRecovery !== false || !Number.isSafeInteger(value.sessions) || value.sessions < 0 || !Number.isSafeInteger(value.work) || value.work < 0 || !Array.isArray(value.stats) || !value.stats.length) throw new Error('Invalid activity response');
  if ((await readFile(hostToContainer(`/proc/${c.pid}/comm`), 'utf8')).trim() !== 'postgres') throw new Error('Unknown signal handling');
  const network = networkFingerprint(await readFile(hostToContainer(`/proc/${c.pid}/net/snmp`), 'utf8'));
  return { sessions: value.sessions, work: value.work, fingerprint: JSON.stringify({ stats: value.stats, network }) };
}

export class ActivityGuard {
  private quiet = new Map<string, { at: number; since: number; fingerprint: string }>();
  private pending = new Map<string, Promise<Activity>>();
  constructor(private probe: ActivityProbe = probePostgres, private now = () => Date.now()) {}
  check(c: ContainerInfo): Promise<Activity> {
    const key = `${c.id}:${c.created}:${c.startedAt}`;
    const active = this.pending.get(key);
    if (active) return active;
    const flight = this.observe(c).finally(() => { this.pending.delete(key); });
    this.pending.set(key, flight);
    return flight;
  }
  private async observe(c: ContainerInfo): Promise<Activity> {
    const key = `${c.id}:${c.created}:${c.startedAt}`;
    // Observe only enrolled databases. Unsupported apps remain on, even if the
    // user classifies them as occasional: low CPU cannot prove no running jobs.
    if (!auditedDatabase(c) && this.probe === probePostgres) return { state: 'unknown', reason: 'Todavía no hay una comprobación de uso confiable para esta aplicación. Se mantiene encendida.' };
    try {
      const signal = await this.probe(c);
      const at = this.now();
      if (signal.sessions || signal.work) {
        this.quiet.delete(key);
        return { state: 'busy', reason: signal.sessions ? `En uso: ${signal.sessions} conexión${signal.sessions === 1 ? '' : 'es'} abierta${signal.sessions === 1 ? '' : 's'}, incluso si está esperando.` : 'Tiene mantenimiento, replicación o trabajo pendiente. Se mantiene encendida.' };
      }
      const old = this.quiet.get(key);
      const uninterrupted = old && at >= old.at && at - old.at <= MAX_SAMPLE_GAP_MS && old.fingerprint === signal.fingerprint;
      const since = uninterrupted ? old.since : at;
      this.quiet.set(key, { at, since, fingerprint: signal.fingerprint });
      for (const [k, value] of this.quiet) if (at - value.at > MAX_SAMPLE_GAP_MS && k !== key) this.quiet.delete(k);
      const quietForMs = at - since;
      if (quietForMs < QUIET_WINDOW_MS) return { state: 'observing', quietForMs, reason: old && old.fingerprint !== signal.fingerprint ? 'Se detectó actividad reciente. Vuelve a contar el período sin uso.' : `Comprobando que esté libre: ${Math.floor(quietForMs / 1000)} de 120 segundos sin conexiones ni actividad detectada.` };
      return { state: 'idle', quietForMs, reason: 'Sin conexiones ni actividad detectada durante al menos 2 minutos. Se volverá a comprobar antes de apagarla.' };
    } catch {
      this.quiet.delete(key);
      return { state: 'unknown', reason: 'No se pudo comprobar si está en uso. Se mantiene encendida.' };
    }
  }
}
