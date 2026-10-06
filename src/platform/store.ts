import { Database } from 'bun:sqlite';
import { mkdirSync, chmodSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual, randomBytes, createHash } from 'node:crypto';

export const SCOPES = ['projects:read', 'diagnostics:run', 'logs:read', 'backups:read', 'backups:run', 'audit:read'] as const;
export type Scope = typeof SCOPES[number];
export interface Grant { projectId: string; scopes: Scope[] }
export interface ApiIdentity { id: string; name: string; owner: string; grants: Grant[]; expiresAt: number }
export interface AuditEntry {
  id: string; at: number; actor: string; credentialId?: string; action: string; resource: string;
  projectId?: string; status: 'running' | 'ok' | 'failed' | 'interrupted'; httpStatus?: number;
  durationMs?: number; recovery?: { label: string; url: string }; detail?: string; operationId?:string;
}
export class PlatformError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const text = (input: unknown, max = 200): string => {
  if (typeof input !== 'string' || !input.trim() || input.length > max || /[\u0000-\u001f\u007f]/.test(input)) throw new PlatformError('Texto inválido');
  return input.trim();
};

/** Independent durable store. Tokens are never stored in clear text. Audit is append-only. */
export class PlatformStore {
  readonly db: Database;
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
  }
  createToken(input: { name: unknown; days: unknown; grants: unknown }, owner: string, projects: string[]) {
    const name = text(input.name, 80), days = Number(input.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new PlatformError('La duración debe ser de 1 a 365 días');
    if (!Array.isArray(input.grants) || !input.grants.length || input.grants.length > 100) throw new PlatformError('Seleccioná al menos un proyecto y permiso');
    const seen = new Set<string>();
    const grants: Grant[] = input.grants.map((g: any) => {
      if (!g || Object.keys(g).some(k => !['projectId', 'scopes'].includes(k)) || !projects.includes(g.projectId) || seen.has(g.projectId)) throw new PlatformError('Proyecto inválido o duplicado');
      seen.add(g.projectId);
      if (!Array.isArray(g.scopes) || !g.scopes.length || g.scopes.some((s: any) => !SCOPES.includes(s))) throw new PlatformError('Permiso inválido');
      return { projectId: g.projectId, scopes: [...new Set<Scope>(g.scopes)] };
    });
    const identity: ApiIdentity = { id: crypto.randomUUID(), name, owner, grants, expiresAt: Date.now() + days * 86400000 };
    const token = `axon_${identity.id}_${randomBytes(32).toString('base64url')}`;
    this.db.query('INSERT INTO tokens(id,hash,payload) VALUES(?,?,?)').run(identity.id, digest(token), JSON.stringify(identity));
    this.append({actor: owner,action:'token.create',resource:identity.id,status:'ok',detail:name});
    return { token, identity };
  }
  authenticate(token: string): ApiIdentity | null {
    if (typeof token !== 'string' || token.length > 200 || !/^axon_([a-f0-9-]{36})_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const id = token.slice(5, 41);
    const row = this.db.query('SELECT hash,payload,revoked FROM tokens WHERE id=?').get(id) as {hash:string;payload:string;revoked:number} | null;
    if (!row || row.revoked) return null;
    const a = Buffer.from(digest(token)), b = Buffer.from(row.hash);
    if (a.length !== b.length || !timingSafeEqual(a,b)) return null;
    const identity = JSON.parse(row.payload) as ApiIdentity;
    if (identity.expiresAt <= Date.now()) return null;
    this.db.query('UPDATE tokens SET last_used=? WHERE id=?').run(Date.now(),id);
    return identity;
  }
  permits(identity: ApiIdentity, projectId: string, scope: Scope) { return identity.grants.some(g => g.projectId === projectId && g.scopes.includes(scope)); }
  require(identity: ApiIdentity, projectId: string, scope: Scope) {
    if (!this.permits(identity,projectId,scope)) throw new PlatformError('El token no tiene permiso para este proyecto y acción',403);
  }
  tokens() {
    return (this.db.query('SELECT payload,revoked,last_used FROM tokens ORDER BY rowid DESC').all() as any[]).map(r => ({...JSON.parse(r.payload),revoked:!!r.revoked,lastUsed:r.last_used}));
  }
  revoke(id: string, actor: string) {
    const changed = this.db.query('UPDATE tokens SET revoked=1 WHERE id=? AND revoked=0').run(id);
    if (!changed.changes && !this.db.query('SELECT id FROM tokens WHERE id=?').get(id)) throw new PlatformError('Token no encontrado',404);
    this.append({actor,action:'token.revoke',resource:id,status:'ok'});
  }
  append(entry: Omit<AuditEntry,'id'|'at'>): AuditEntry {
    const value: AuditEntry = { ...entry,id:crypto.randomUUID(),at:Date.now() };
    this.db.query('INSERT INTO audit VALUES(?,?,?,?)').run(value.id,value.at,value.projectId || null,JSON.stringify(value));
    return value;
  }
  audit(projectId?: string, before?: number, limit = 50) {
    const values: (string|number)[] = [], where: string[] = [];
    if (projectId) { where.push('project_id=?'); values.push(projectId); }
    if (before) { where.push('rowid<?'); values.push(before); }
    values.push(Math.min(100,Math.max(1,limit)));
    const rows = this.db.query(`SELECT rowid AS cursor,payload FROM audit ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY rowid DESC LIMIT ?`).all(...values) as {cursor:number;payload:string}[];
    return {entries:rows.map(r => ({...JSON.parse(r.payload),cursor:r.cursor})),next:rows.length ? rows.at(-1)!.cursor : null};
  }
  get<T>(kind: string,id: string): T | undefined { const row = this.db.query('SELECT payload FROM records WHERE kind=? AND id=?').get(kind,id) as {payload:string} | null; return row ? JSON.parse(row.payload) : undefined; }
  put(kind: string,id: string,payload: unknown) { this.db.query('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload').run(kind,id,JSON.stringify(payload)); }
  list<T>(kind: string): T[] { return (this.db.query('SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC').all(kind) as {payload:string}[]).map(r => JSON.parse(r.payload)); }
  close() { this.db.close(); }
}
