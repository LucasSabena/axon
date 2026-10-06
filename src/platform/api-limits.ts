import { PlatformError } from './store';

export type ApiLane = 'read'|'transfer'|'operation';
export interface ApiLimit { perMinute:number; burst:number; concurrent:number }
export const API_LIMITS:Record<ApiLane,ApiLimit> = {
  read:{perMinute:1200,burst:300,concurrent:8},
  transfer:{perMinute:2400,burst:120,concurrent:3},
  operation:{perMinute:120,burst:30,concurrent:2},
};
export class ApiThrottle extends PlatformError {
  constructor(readonly lane:ApiLane,readonly reason:'rate'|'concurrency',readonly retryAfter:number){super(reason==='rate'?'AXON recibió demasiadas solicitudes seguidas; reintentá tras la pausa indicada':'Hay demasiadas operaciones simultáneas; esperá a que termine alguna',429);}
}
/** Independent token buckets allow bursts and refill continuously, rather than pausing a full minute. */
export class ApiLimiter {
  private buckets=new Map<string,{credit:number;at:number;active:number}>();
  private calls=0;
  constructor(readonly limits=API_LIMITS,private now:()=>number=()=>performance.now()){}
  acquire(tokenId:string,lane:ApiLane){
    const now=this.now(),limit=this.limits[lane],key=tokenId+':'+lane;
    let bucket=this.buckets.get(key);
    if(!bucket){bucket={credit:limit.burst,at:now,active:0};this.buckets.set(key,bucket);}
    bucket.credit=Math.min(limit.burst,bucket.credit+Math.max(0,now-bucket.at)*limit.perMinute/60000);bucket.at=now;
    if(bucket.active>=limit.concurrent)throw new ApiThrottle(lane,'concurrency',1);
    if(bucket.credit<1)throw new ApiThrottle(lane,'rate',Math.max(1,Math.ceil((1-bucket.credit)*60/limit.perMinute)));
    bucket.credit--;bucket.active++;
    if(++this.calls%1024===0)for(const [id,b] of this.buckets)if(!b.active&&now-b.at>300000)this.buckets.delete(id);
    let released=false;return ()=>{if(!released){released=true;bucket!.active--;}};
  }
}
export function apiLane(method:string,path:string,rpc?:any):ApiLane {
  if(method==='POST'&&path==='/mcp')return rpc?.method==='tools/call'&&['axon_diagnose_project','axon_backup_project'].includes(rpc.params?.name)?'operation':'read';
  if((method==='PUT'&&/^\/cloud\/uploads\/[^/]+$/.test(path))||(method==='GET'&&/^\/cloud\/[^/]+\/content$/.test(path)))return 'transfer';
  return ['GET','HEAD','OPTIONS'].includes(method)?'read':'operation';
}
/** Keep download slots until the stream ends/cancels, not only until response headers arrive. */
export function leasedResponse(response:Response,release:()=>void,signal:AbortSignal):Response {
  if(!response.body){release();return response;}
  const reader=response.body.getReader();
  const done=()=>{signal.removeEventListener('abort',abort);release();};
  const abort=()=>{done();void reader.cancel().catch(()=>{});};
  const stream=new ReadableStream<Uint8Array>({
    async pull(controller){try{const v=await reader.read();if(v.done){done();controller.close();}else controller.enqueue(v.value);}catch(e){done();controller.error(e);}},
    async cancel(reason){done();await reader.cancel(reason).catch(()=>{});},
  },{highWaterMark:0});
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
}
