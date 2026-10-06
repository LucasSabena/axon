import { test, expect } from 'bun:test';
import { ApiLimiter, ApiThrottle, API_LIMITS, apiLane, leasedResponse } from './api-limits';

test('Independent buckets permit bursts, refill continuously and do not charge rejected requests',()=>{
  let now=0;const limiter=new ApiLimiter(API_LIMITS,()=>now);
  for(let n=0;n<API_LIMITS.read.burst;n++)limiter.acquire('one','read')();
  try{limiter.acquire('one','read');throw new Error('Expected rate limit');}catch(e){expect(e).toBeInstanceOf(ApiThrottle);expect((e as ApiThrottle).reason).toBe('rate');expect((e as ApiThrottle).retryAfter).toBe(1);}
  limiter.acquire('one','transfer')();limiter.acquire('one','operation')();limiter.acquire('two','read')();
  now=50;limiter.acquire('one','read')();expect(()=>limiter.acquire('one','read')).toThrow(ApiThrottle);
  now=100;limiter.acquire('one','read')();now=60000;for(let n=0;n<300;n++)limiter.acquire('one','read')();
});

test('Concurrent limits are separate and idempotent release cannot create extra slots',()=>{
  const limiter=new ApiLimiter(),release=Array.from({length:3},()=>limiter.acquire('one','transfer'));
  try{limiter.acquire('one','transfer');throw new Error('Expected concurrency limit');}catch(e){expect((e as ApiThrottle).reason).toBe('concurrency');}
  limiter.acquire('one','read')();release[0]();release[0]();const next=limiter.acquire('one','transfer');expect(()=>limiter.acquire('one','transfer')).toThrow(ApiThrottle);next();release.forEach(fn=>fn());
});

test('REST and MCP use the same categories; binary blocks do not consume the navigation bucket',()=>{
  expect(apiLane('GET','/cloud/dropbox/list')).toBe('read');expect(apiLane('GET','/capabilities')).toBe('read');
  expect(apiLane('GET','/cloud/dropbox/content')).toBe('transfer');expect(apiLane('PUT','/cloud/uploads/id')).toBe('transfer');
  expect(apiLane('POST','/cloud/dropbox/uploads')).toBe('operation');expect(apiLane('POST','/cloud/uploads/id/finish')).toBe('operation');
  expect(apiLane('POST','/mcp',{method:'tools/list'})).toBe('read');expect(apiLane('POST','/mcp',{method:'tools/call',params:{name:'axon_cloud_list'}})).toBe('read');
  expect(apiLane('POST','/mcp',{method:'tools/call',params:{name:'axon_diagnose_project'}})).toBe('operation');expect(apiLane('POST','/mcp',{method:'tools/call',params:{name:'axon_backup_project'}})).toBe('operation');
});

test('A streamed download holds its concurrency slot until completion, cancellation or abort',async()=>{
  for(const mode of ['complete','cancel','abort']){
    let released=0,cancelled=false;const controller=new AbortController();
    const upstream=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.close();},cancel(){cancelled=true;}}));
    const response=leasedResponse(upstream,()=>released++,controller.signal);expect(released).toBe(0);
    if(mode==='complete')expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1,2,3]));
    else if(mode==='cancel')await response.body!.cancel();else{controller.abort();await Promise.resolve();}
    expect(released).toBe(1);if(mode==='cancel')expect(cancelled).toBe(true);
  }
});
