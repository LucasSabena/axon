import type { Database } from 'bun:sqlite';
import { PlatformError } from './store';
import type { ApiLane } from './api-policy';

export interface ApiRequestUsage { tokenId:string; at:number; route:string; lane:ApiLane; status:number; durationMs:number; bytesIn:number; bytesOut:number; failed?:boolean }
/** Only route templates are retained: never query strings, request bodies or credentials. */
export function usageRoute(method:string,path:string,rpc?:any):string {
  if(path==='/mcp')return 'MCP '+(['initialize','ping','tools/list','tools/call'].includes(rpc?.method)?rpc.method:'request')+(rpc?.method==='tools/call'&&['axon_capabilities','axon_list_projects','axon_project_status','axon_diagnose_project','axon_project_logs','axon_project_audit','axon_list_backups','axon_backup_project','axon_cloud_connections','axon_cloud_list','axon_cloud_metadata','axon_cloud_read_text','axon_cloud_upload_status'].includes(rpc.params?.name)?' '+rpc.params.name:'');
  const route=path.replace(/(\/projects\/)[^/]+/,'$1:id').replace(/(\/uploads\/)[^/]+/,'$1:id');
  return method+' '+(/^\/(projects(?:\/:id(?:\/(diagnose|logs|audit|backups))?)?|capabilities|cloud\/(connections|(?:dropbox|gdrive|onedrive)\/(list|metadata|content|uploads)|uploads\/:id(?:\/(finish|cancel))?))$/.test(route)?route:'unknown');
}
export class ApiUsage {
  private pending:ApiRequestUsage[]=[];
  private timer:ReturnType<typeof setInterval>;
  constructor(private db:Database){
    db.exec(`CREATE TABLE IF NOT EXISTS api_usage(token_id TEXT NOT NULL,hour INTEGER NOT NULL,route TEXT NOT NULL,lane TEXT NOT NULL,status INTEGER NOT NULL,requests INTEGER NOT NULL,duration REAL NOT NULL,bytes_in INTEGER NOT NULL,bytes_out INTEGER NOT NULL,failures INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(token_id,hour,route,lane,status));
      CREATE TABLE IF NOT EXISTS api_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,token_id TEXT NOT NULL,at INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS api_requests_token ON api_requests(token_id,id);
      CREATE TABLE IF NOT EXISTS api_daily(token_id TEXT NOT NULL,day INTEGER NOT NULL,requests INTEGER NOT NULL,PRIMARY KEY(token_id,day));
      CREATE TABLE IF NOT EXISTS api_usage_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);`);
    db.query('INSERT OR IGNORE INTO api_usage_meta VALUES(?,?)').run('since',Date.now());
    this.timer=setInterval(()=>this.flush(),1000);this.timer.unref();
  }
  reserve(tokenId:string,quota:number){
    const day=Math.floor(Date.now()/86400000);
    const result=this.db.query('INSERT INTO api_daily VALUES(?,?,1) ON CONFLICT(token_id,day) DO UPDATE SET requests=requests+1 WHERE ?=0 OR requests<?').run(tokenId,day,quota,quota);
    if(!result.changes)throw new PlatformError('Se alcanzó el cupo diario de esta clave. Se renueva a las 00:00 UTC.',429);
  }
  record(v:ApiRequestUsage){this.pending.push(v);if(this.pending.length>=256)this.flush();}
  flush(){
    if(!this.pending.length)return;
    const batch=this.pending;
    this.db.transaction(()=>{
      const rollup=this.db.query('INSERT INTO api_usage VALUES(?,?,?,?,?,1,?,?,?,?) ON CONFLICT(token_id,hour,route,lane,status) DO UPDATE SET requests=requests+1,duration=duration+excluded.duration,bytes_in=bytes_in+excluded.bytes_in,bytes_out=bytes_out+excluded.bytes_out,failures=failures+excluded.failures');
      const recent=this.db.query('INSERT INTO api_requests(token_id,at,payload) VALUES(?,?,?)');
      for(const v of batch){rollup.run(v.tokenId,Math.floor(v.at/3600000)*3600000,v.route,v.lane,v.status,v.durationMs,v.bytesIn,v.bytesOut,v.failed?1:0);recent.run(v.tokenId,v.at,JSON.stringify(v));}
      this.db.query('DELETE FROM api_usage WHERE hour<?').run(Date.now()-90*86400000);
      this.db.query('DELETE FROM api_daily WHERE day<?').run(Math.floor(Date.now()/86400000)-90);
      this.db.exec('DELETE FROM api_requests WHERE id<(SELECT COALESCE(MAX(id),0)-20000 FROM api_requests)');
    })();this.pending=[];
  }
  report(ids:string[],days=7){
    this.flush();
    const since=(this.db.query('SELECT value FROM api_usage_meta WHERE key=?').get('since') as any).value;
    if(!ids.length)return {since,days,totals:{requests:0,errors:0,limited:0,bytesIn:0,bytesOut:0,averageMs:0},series:[],routes:[],lanes:[],recent:[],today:0};
    const placeholders=ids.map(()=>'?').join(','),where=`token_id IN (${placeholders}) AND hour>=?`,values=[...ids,Math.floor((Date.now()-days*86400000)/3600000)*3600000];
    const totals=this.db.query(`SELECT COALESCE(SUM(requests),0) requests,COALESCE(SUM(CASE WHEN status>=400 THEN requests ELSE failures END),0) errors,COALESCE(SUM(CASE WHEN status=429 THEN requests ELSE 0 END),0) limited,COALESCE(SUM(bytes_in),0) bytesIn,COALESCE(SUM(bytes_out),0) bytesOut,COALESCE(SUM(duration)/SUM(requests),0) averageMs FROM api_usage WHERE ${where}`).get(...values);
    const groups=(by:string)=>this.db.query(`SELECT ${by},SUM(requests) requests,SUM(bytes_out) bytesOut,SUM(CASE WHEN status>=400 THEN requests ELSE failures END) errors FROM api_usage WHERE ${where} GROUP BY ${by} ORDER BY requests DESC`).all(...values);
    const recent=this.db.query(`SELECT payload FROM api_requests WHERE token_id IN (${placeholders}) AND at>=? ORDER BY id DESC LIMIT 50`).all(...ids,Date.now()-days*86400000).map((r:any)=>JSON.parse(r.payload));
    const today=(this.db.query(`SELECT COALESCE(SUM(requests),0) total FROM api_usage WHERE token_id IN (${placeholders}) AND hour>=? AND status<>429`).get(...ids,Math.floor(Date.now()/86400000)*86400000) as any).total;
    return {since,days,totals,series:groups('hour').sort((a:any,b:any)=>a.hour-b.hour),routes:groups('route'),lanes:groups('lane'),recent,today};
  }
  daily(tokenId:string){return (this.db.query('SELECT requests FROM api_daily WHERE token_id=? AND day=?').get(tokenId,Math.floor(Date.now()/86400000)) as any)?.requests||0;}
  close(){clearInterval(this.timer);this.flush();}
}
