import { Database } from 'bun:sqlite';
import { mkdirSync, chmodSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { apiPolicy, type ApiPolicy } from './api-policy';
import { ApiUsage } from './api-usage';
import { timingSafeEqual, randomBytes, createHash } from 'node:crypto';

export const SCOPES = ['projects:read', 'diagnostics:run', 'logs:read', 'backups:read', 'backups:run', 'audit:read'] as const;
export type Scope = typeof SCOPES[number];
export interface Grant { projectId: string; scopes: Scope[] }
export const CLOUD_SCOPES = ['cloud:read','cloud:upload'] as const;
export type CloudScope = typeof CLOUD_SCOPES[number];
export interface CloudGrant { provider:string; source:string; root:string; scopes:CloudScope[]; connectionId:string }
export interface ApiIdentity { id: string; name: string; owner: string; grants: Grant[]; cloudGrants?:CloudGrant[]; expiresAt: number; createdAt?:number; description?:string; paused?:boolean; revision?:number; policy?:ApiPolicy }
export interface AuditEntry {
  id: string; at: number; actor: string; credentialId?: string; action: string; resource: string;
  projectId?: string; status: 'running' | 'ok' | 'failed' | 'interrupted'; httpStatus?: number;
  durationMs?: number; recovery?: { label: string; url: string }; detail?: string; operationId?:string;
}
export interface AuditFilters { status?: string; actor?: string; action?: string; q?: string }
export class PlatformError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const text = (input: unknown, max = 200): string => {
  if (typeof input !== 'string' || !input.trim() || input.length > max || /[\u0000-\u001f\u007f]/.test(input)) throw new PlatformError('Texto inválido');
  return input.trim();
};

/** Independent durable store. Tokens are never stored in clear text. Audit is append-only. */
export class PlatformStore {
  readonly db: Database;
  readonly usage:ApiUsage;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('El estado operativo necesita un directorio privado');
    const file = path.join(dir, 'platform.sqlite');
    try { if (lstatSync(file).isSymbolicLink()) throw new Error('Estado operativo enlazado no permitido'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    this.db = new Database(file, { create: true, strict: true }); chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS platform_version(version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO platform_version VALUES(1);
      CREATE TABLE IF NOT EXISTS tokens(id TEXT PRIMARY KEY, hash TEXT NOT NULL, payload TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, last_used INTEGER);
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, at INTEGER NOT NULL, project_id TEXT, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS audit_project ON audit(project_id,at);
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id));`);
    const versions = this.db.query('SELECT version FROM platform_version').all() as {version:number}[];
    if (versions.length !== 1 || versions[0].version !== 1) { this.db.close(); throw new Error('Versión operativa no compatible'); }
    this.usage=new ApiUsage(this.db);
  }
  private validateToken(input: { name: unknown; days: unknown; grants: unknown; cloudGrants?:unknown; description?:unknown; policy?:unknown }, owner: string, projects: string[]) {
    const name = text(input.name, 80), days = Number(input.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new PlatformError('La duración debe ser de 1 a 365 días');
    if (!Array.isArray(input.grants) || input.grants.length > 100) throw new PlatformError('Permisos de proyecto inválidos');
    const cloudGrants:CloudGrant[]=[];
    if(input.cloudGrants!==undefined){
      if(!Array.isArray(input.cloudGrants)||input.cloudGrants.length>100)throw new PlatformError('Permisos de conexión inválidos');
      for(const g of input.cloudGrants){
        if(!g||Object.keys(g).some(k=>!['provider','source','root','scopes','connectionId'].includes(k))||!['dropbox','gdrive','onedrive'].includes(g.provider)||typeof g.source!=='string'||!g.source||g.source.length>100||typeof g.root!=='string'||g.root.length>4096||/[\x00-\x1f\x7f\\]/.test(g.root)||(g.root&&(!g.root.startsWith('/')||g.root.endsWith('/')||g.root.includes('//')))||g.root.split('/').some((p:string)=>p==='.'||p==='..')||typeof g.connectionId!=='string'||!g.connectionId||g.connectionId.length>200||!Array.isArray(g.scopes)||!g.scopes.length||g.scopes.some((s:any)=>!CLOUD_SCOPES.includes(s)))throw new PlatformError('Permiso de conexión inválido');
        if(cloudGrants.some(v=>v.provider===g.provider&&v.source===g.source&&v.root===g.root))throw new PlatformError('Carpeta de conexión duplicada');
        cloudGrants.push({provider:g.provider,source:g.source,root:g.root,connectionId:g.connectionId,scopes:[...new Set<CloudScope>(g.scopes)]});
      }
    }
    if(!input.grants.length&&!cloudGrants.length)throw new PlatformError('Seleccioná al menos un proyecto o conexión y permiso');
    const seen = new Set<string>();
    const grants: Grant[] = input.grants.map((g: any) => {
      if (!g || Object.keys(g).some(k => !['projectId', 'scopes'].includes(k)) || !projects.includes(g.projectId) || seen.has(g.projectId)) throw new PlatformError('Proyecto inválido o duplicado');
      seen.add(g.projectId);
      if (!Array.isArray(g.scopes) || !g.scopes.length || g.scopes.some((s: any) => !SCOPES.includes(s))) throw new PlatformError('Permiso inválido');
      return { projectId: g.projectId, scopes: [...new Set<Scope>(g.scopes)] };
    });
    const description=this.description(input.description),policy=apiPolicy(input.policy);
    return {name,days,grants,cloudGrants,description,policy};
  }
  createToken(input:{name:unknown;days:unknown;grants:unknown;cloudGrants?:unknown;description?:unknown;policy?:unknown},owner:string,projects:string[]){
    const {name,days,grants,cloudGrants,description,policy}=this.validateToken(input,owner,projects);
    const identity:ApiIdentity={createdAt:Date.now(),revision:1,description,policy,id:crypto.randomUUID(),name,owner,grants,...(cloudGrants.length?{cloudGrants}:{}),expiresAt:Date.now()+days*86400000};
    const token = `axon_${identity.id}_${randomBytes(32).toString('base64url')}`;
    this.db.query('INSERT INTO tokens(id,hash,payload) VALUES(?,?,?)').run(identity.id, digest(token), JSON.stringify(identity));
    this.append({actor: owner,action:'token.create',resource:identity.id,status:'ok',detail:name});
    return { token, identity };
  }
  authenticate(token: string): ApiIdentity | null {
    if (typeof token !== 'string' || token.length > 200 || !/^axon_([a-f0-9-]{36})_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const id = token.slice(5, 41);
    const row = this.db.query('SELECT hash,payload,revoked,last_used FROM tokens WHERE id=?').get(id) as {hash:string;payload:string;revoked:number;last_used:number|null} | null;
    if (!row || row.revoked) return null;
    const a = Buffer.from(digest(token)), b = Buffer.from(row.hash);
    if (a.length !== b.length || !timingSafeEqual(a,b)) return null;
    const identity = JSON.parse(row.payload) as ApiIdentity;
    const now = Date.now();
    if (identity.expiresAt <= now || identity.paused) return null;
    // A WAL write with synchronous=FULL fsyncs; coalesce last_used to one
    // write per minute instead of one per authenticated request.
    if (!row.last_used || now - row.last_used > 60000) this.db.query('UPDATE tokens SET last_used=? WHERE id=?').run(now,id);
    return identity;
  }
  permits(identity: ApiIdentity, projectId: string, scope: Scope) { return identity.grants.some(g => g.projectId === projectId && g.scopes.includes(scope)); }
  require(identity: ApiIdentity, projectId: string, scope: Scope) {
    if (!this.permits(identity,projectId,scope)) throw new PlatformError('El token no tiene permiso para este proyecto y acción',403);
  }
  assertActive(identity:ApiIdentity){const row=this.db.query('SELECT revoked,payload FROM tokens WHERE id=?').get(identity.id) as {revoked:number;payload:string}|null;if(!row||row.revoked||JSON.parse(row.payload).expiresAt<=Date.now()||JSON.parse(row.payload).paused||JSON.parse(row.payload).revision!==(identity.revision))throw new PlatformError('Token revocado o vencido',401);}
  tokens() {
    return (this.db.query('SELECT payload,revoked,last_used FROM tokens ORDER BY rowid DESC').all() as any[]).map(r => ({...JSON.parse(r.payload),revoked:!!r.revoked,lastUsed:r.last_used}));
  }
  private description(value:unknown){if(value===undefined)return '';if(typeof value!=='string'||value.length>300||/[\u0000-\u001f\u007f]/.test(value))throw new PlatformError('La descripción admite hasta 300 caracteres');return value.trim();}
  ownedToken(id:string,owner:string){const row=this.db.query('SELECT payload,revoked FROM tokens WHERE id=?').get(id) as any;if(!row||JSON.parse(row.payload).owner!==owner)throw new PlatformError('Clave no encontrada',404);return {...JSON.parse(row.payload),revoked:!!row.revoked} as ApiIdentity&{revoked:boolean};}
  updateToken(id:string,input:any,owner:string,projects:string[]){
    const current=this.ownedToken(id,owner);
    if(current.revoked)throw new PlatformError('Una clave revocada no se puede modificar',409);
    if(input.revision!==(current.revision||0))throw new PlatformError('La clave cambió. Actualizá antes de guardar.',409);
    const name=input.name===undefined?current.name:text(input.name,80);
    const description=input.description===undefined?current.description:this.description(input.description);
    if(input.paused!==undefined&&typeof input.paused!=='boolean')throw new PlatformError('Estado de clave inválido');
    const expiresAt=input.expiresAt===undefined?current.expiresAt:input.expiresAt;
    if(!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+365*86400000)throw new PlatformError('Elegí un vencimiento futuro de hasta 365 días');
    const validated=this.validateToken({name,days:1,grants:input.grants??current.grants,cloudGrants:input.cloudGrants??current.cloudGrants??[],description,policy:input.policy??current.policy},owner,projects);
    const next:ApiIdentity={id:current.id,owner,name:validated.name,description:validated.description,policy:validated.policy,grants:validated.grants,cloudGrants:validated.cloudGrants,createdAt:current.createdAt,expiresAt,paused:input.paused??current.paused??false,revision:(current.revision||0)+1};
    this.db.query('UPDATE tokens SET payload=? WHERE id=?').run(JSON.stringify(next),id);
    this.append({actor:owner,action:'token.update',resource:id,status:'ok',detail:name});return next;
  }
  rotateToken(id:string,revision:unknown,owner:string){
    const current=this.ownedToken(id,owner);if(current.revoked||current.expiresAt<=Date.now())throw new PlatformError('Sólo se renuevan claves vigentes',409);
    if(revision!==(current.revision||0))throw new PlatformError('La clave cambió. Actualizá antes de renovarla.',409);
    const {revoked,...identity}=current;identity.revision=(current.revision||0)+1;
    const token=`axon_${id}_${randomBytes(32).toString('base64url')}`;
    this.db.query('UPDATE tokens SET hash=?,payload=? WHERE id=?').run(digest(token),JSON.stringify(identity),id);
    this.append({actor:owner,action:'token.rotate',resource:id,status:'ok'});return {token,identity};
  }
  revoke(id: string, actor: string) {
    // Only the owner may revoke; other people's tokens answer like missing ones.
    const changed = this.db.query("UPDATE tokens SET revoked=1 WHERE id=? AND revoked=0 AND json_extract(payload,'$.owner')=?").run(id,actor);
    if (!changed.changes && !this.db.query("SELECT id FROM tokens WHERE id=? AND json_extract(payload,'$.owner')=?").get(id,actor)) throw new PlatformError('Token no encontrado',404);
    this.append({actor,action:'token.revoke',resource:id,status:'ok'});
  }
  private appended = 0;
  append(entry: Omit<AuditEntry,'id'|'at'>): AuditEntry {
    const value: AuditEntry = { ...entry,id:crypto.randomUUID(),at:Date.now() };
    this.db.query('INSERT INTO audit VALUES(?,?,?,?)').run(value.id,value.at,value.projectId || null,JSON.stringify(value));
    // The table used to grow without bound — prune periodically (amortized,
    // not every append, because each prune is a WAL write with FULL sync).
    if (++this.appended % 64 === 0) this.pruneAudit();
    return value;
  }
  // Retention: 90 days or 20.000 entries, whichever ends first. The newest
  // rows always survive — pruning never removes evidence of recent activity.
  private pruneAudit() {
    try {
      const keep = (this.db.query('SELECT rowid FROM audit ORDER BY rowid DESC LIMIT 1 OFFSET 19999').get() as {rowid:number}|null)?.rowid || 0;
      this.db.query('DELETE FROM audit WHERE at<? OR rowid<?').run(Date.now()-90*86_400_000,keep);
    } catch { /* pruning must never break the append path */ }
  }
  audit(projectId?: string, before?: number, limit = 50, filters?: AuditFilters) {
    const values: (string|number)[] = [], where: string[] = [];
    const like = (v: string) => `%${v.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    if (projectId) { where.push('project_id=?'); values.push(projectId); }
    if (before) { where.push('rowid<?'); values.push(before); }
    if (filters?.status) { where.push(`json_extract(payload,'$.status')=?`); values.push(filters.status); }
    if (filters?.actor) { where.push(`json_extract(payload,'$.actor') LIKE ? ESCAPE '\\'`); values.push(like(filters.actor)); }
    if (filters?.action) { where.push(`json_extract(payload,'$.action') LIKE ? ESCAPE '\\'`); values.push(like(filters.action)); }
    if (filters?.q) {
      where.push(`(json_extract(payload,'$.action') LIKE ? ESCAPE '\\' OR json_extract(payload,'$.resource') LIKE ? ESCAPE '\\' OR json_extract(payload,'$.actor') LIKE ? ESCAPE '\\' OR json_extract(payload,'$.detail') LIKE ? ESCAPE '\\')`);
      values.push(like(filters.q),like(filters.q),like(filters.q),like(filters.q));
    }
    values.push(Math.min(100,Math.max(1,limit)));
    const rows = this.db.query(`SELECT rowid AS cursor,payload FROM audit ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY rowid DESC LIMIT ?`).all(...values) as {cursor:number;payload:string}[];
    return {entries:this.groupEntries(rows.map(r => ({...JSON.parse(r.payload),cursor:r.cursor}))),next:rows.length ? rows.at(-1)!.cursor : null};
  }
  // auditMutations appends one 'running' row and one result row per request
  // sharing an operationId — the history shows a single row per operation.
  private groupEntries(entries: (AuditEntry & {cursor:number})[]) {
    const terminal = new Set(entries.filter(e => e.operationId && e.status !== 'running').map(e => e.operationId!));
    const staleRunning = Date.now() - 2 * 3600_000;
    return entries.filter(e => !(e.operationId && e.status === 'running' && terminal.has(e.operationId)))
      .map(e => e.status === 'running' && e.at < staleRunning
        // An orphaned 'En curso' (its result was never recorded, e.g. a
        // restart mid-request) reads as interrupted instead of stuck forever.
        ? {...e, status: 'interrupted' as const}
        : e);
  }
  remove(kind: string,id: string) { this.db.query('DELETE FROM records WHERE kind=? AND id=?').run(kind,id); }
  get<T>(kind: string,id: string): T | undefined { const row = this.db.query('SELECT payload FROM records WHERE kind=? AND id=?').get(kind,id) as {payload:string} | null; return row ? JSON.parse(row.payload) : undefined; }
  put(kind: string,id: string,payload: unknown) { this.db.query('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload').run(kind,id,JSON.stringify(payload)); }
  list<T>(kind: string): T[] { return (this.db.query('SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC').all(kind) as {payload:string}[]).map(r => JSON.parse(r.payload)); }
  close() { this.usage.close();this.db.close(); }
}
