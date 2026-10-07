import { Database } from 'bun:sqlite';
import { mkdirSync, chmodSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { OperationState } from './types';
import { MaintenanceError, PendingOperationError, type PendingOperation } from './types';
export function incarnation(pid = process.pid): string | null {
  try { const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); return `${readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()}:${pid}:${stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]}`; }
  catch { return null; }
}
/** Independent SQLite connections serialize with BEGIN IMMEDIATE. No expiring lease can authorize effects. */
export class MaintenanceRepository {
  readonly db: Database;
  readonly owner = incarnation();
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (lstatSync(dir).isSymbolicLink()) throw new Error('El ledger requiere un directorio propio, no un enlace simbólico: '+dir);
    if (lstatSync(dir).mode & 0o077) { try { chmodSync(dir, 0o700); } catch {} if (lstatSync(dir).mode & 0o077) throw new Error('El directorio del ledger ('+dir+') es accesible por otros usuarios y no se pudo corregir a modo 700'); }
    const file = path.join(dir, 'maintenance.sqlite');
    try { if (lstatSync(file).isSymbolicLink()) throw new Error('Ledger enlazado no permitido'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    this.db = new Database(file, { create: true, strict: true }); chmodSync(file, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
    this.db.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS locks(resource TEXT PRIMARY KEY,operation TEXT NOT NULL,owner TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS receipts(operation TEXT NOT NULL,step TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(operation,step));
        INSERT OR IGNORE INTO migrations VALUES(1);`);
    }).immediate();
    const versions=this.db.query('SELECT version FROM migrations ORDER BY version').all() as {version:number}[];
    if(versions.length!==1||versions[0].version!==1){this.db.close();throw new Error('Versión de ledger no compatible; mantenimiento bloqueado');}
    // WAL/SHM/journal sidecars inherit the process umask, not the file chmod above.
    for(const sidecar of [file+'-wal',file+'-shm',file+'-journal'])try{chmodSync(sidecar,0o600);}catch(e:any){if(e?.code!=='ENOENT')throw e;}
  }
  put(kind: string, id: string, value: unknown, state: OperationState = 'planned') {
    this.db.query('INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET state=excluded.state,payload=excluded.payload,updated=excluded.updated').run(kind,id,state,JSON.stringify(value),new Date().toISOString());
  }
  get<T>(kind: string,id: string): T | undefined { const row = this.db.query('SELECT payload FROM records WHERE kind=? AND id=?').get(kind,id) as {payload:string} | null; return row ? JSON.parse(row.payload) as T : undefined; }
  list<T>(kind: string, limit=50, offset=0): T[] { return (this.db.query('SELECT payload FROM records WHERE kind=? ORDER BY updated DESC LIMIT ? OFFSET ?').all(kind,limit,offset) as {payload:string}[]).map(r=>JSON.parse(r.payload) as T); }
  lockedOperations(kind:string):string[]{return (this.db.query('SELECT DISTINCT locks.operation FROM locks JOIN records ON records.id=locks.operation WHERE records.kind=?').all(kind) as {operation:string}[]).map(r=>r.operation);}
  private pendingOperation(id:string,actorId?:string):PendingOperation|undefined {
    for(const kind of ['transfer','file-operation','plan','scan'] as const){
      const op=this.get<Record<string,any>>(kind,id);
      if(!op)continue;
      // Scans have no actor field; other kinds only surface to their owner.
      if(kind!=='scan'&&(!actorId||op.actorId!==actorId))continue;
      const status=op.status||op.receipt||{},plan=op.plan||op;
      return {id,kind,state:op.state,action:kind==='scan'?'scan':plan.mode||op.action,from:kind==='scan'?undefined:plan.from||op.path||op.item?.orig,to:plan.to,message:status.message||op.error,logicalBytes:status.logicalBytes||plan.logicalBytes,copiedBytes:status.copiedBytes};
    }
  }
  exclusive<T>(operation: string, resources: string[], start: () => T, actorId?:string): T {
    if (!this.owner) throw new MaintenanceError('No se pudo identificar el proceso');
    return this.db.transaction(() => {
      for (const r of [...new Set(resources)].sort()) {
        const held=this.db.query('SELECT operation FROM locks WHERE resource=?').get(r) as {operation:string}|null;
        if (held) throw new PendingOperationError(this.pendingOperation(held.operation,actorId));
        this.db.query('INSERT INTO locks VALUES(?,?,?)').run(r,operation,this.owner!);
      }
      return start();
    }).immediate();
  }
  exclusiveRecovery<T>(operation:string,resources:string[],start:()=>T):T {
    if(!this.owner)throw new MaintenanceError('No se pudo identificar el proceso');
    return this.db.transaction(()=>{for(const resource of [...new Set(resources)].sort()){
      const held=this.db.query('SELECT operation FROM locks WHERE resource=?').get(resource) as {operation:string}|null;
      if(held&&held.operation!==operation)throw new MaintenanceError('Otra operación conserva el recurso');
      if(held)this.db.query('UPDATE locks SET owner=? WHERE resource=? AND operation=?').run(this.owner!,resource,operation);
      else this.db.query('INSERT INTO locks VALUES(?,?,?)').run(resource,operation,this.owner!);
    }return start();}).immediate();
  }
  releaseReconciled(operation: string) { this.db.query('DELETE FROM locks WHERE operation=?').run(operation); }
  release(operation: string) { this.db.query('DELETE FROM locks WHERE operation=? AND owner=?').run(operation,this.owner!); }
  receipt(operation: string, step: string, receipt: unknown) { this.db.query('INSERT OR REPLACE INTO receipts VALUES(?,?,?)').run(operation,step,JSON.stringify(receipt)); }
  receipts(operation: string): unknown[] { return (this.db.query('SELECT payload FROM receipts WHERE operation=?').all(operation) as {payload:string}[]).map(r=>JSON.parse(r.payload)); }
  reconcile() {
    this.db.transaction(()=>{
    const rows=this.db.query('SELECT DISTINCT operation,owner FROM locks').all() as {operation:string;owner:string}[];
    for (const row of rows) {
      const pid=Number(row.owner.split(':')[1]);
      if (incarnation(pid) === row.owner) continue;
      // A scan has no effects to recover. A dead owner cannot publish its result;
      // leave the interrupted result visible and allow a new read-only analysis.
      const scan=this.get<Record<string,unknown>>('scan',row.operation);
      const resources=this.db.query('SELECT resource FROM locks WHERE operation=?').all(row.operation) as {resource:string}[];
      if(scan&&resources.every(r=>r.resource==='storage:scan')&&!this.get('plan',row.operation)&&!this.get('file-operation',row.operation)){
        this.put('scan',row.operation,{...scan,state:'interrupted',error:'El análisis se interrumpió al finalizar el proceso. No modificó archivos; podés iniciar uno nuevo.'},'interrupted');
        this.db.query('DELETE FROM locks WHERE operation=? AND owner=?').run(row.operation,row.owner);
        continue;
      }
      // Destructive operations retain every lock until effects are reconciled.
      for (const kind of ['plan','scan','file-operation','transfer','compose-release']) {
        const value=this.get<Record<string,unknown>>(kind,row.operation);
        if (value) this.put(kind,row.operation,{...value,state:'interrupted',error:'Proceso interrumpido; efectos sin reconciliar. No se reejecuta automáticamente.'},'interrupted');
      }
    }
    }).immediate();
  }
  retainScans(limit = 50) {
    // Disposable read-only index only. Never erase intent, recovery receipts or scans referenced by plans.
    this.db.query(`DELETE FROM records WHERE kind='scan' AND state NOT IN ('running','cancel-requested')
      AND id NOT IN (SELECT operation FROM locks)
      AND id NOT IN (SELECT id FROM records WHERE kind='scan' ORDER BY updated DESC LIMIT ?)
      AND id NOT IN (SELECT json_extract(payload,'$.inventoryRevision') FROM records WHERE kind='plan')`).run(limit);
  }
  close() { this.db.close(); }
}
