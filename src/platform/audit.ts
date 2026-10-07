import type { MiddlewareHandler } from 'hono';
import { PlatformError, type PlatformStore } from './store';
import { MaintenanceError } from '../storage/types';
import path from 'node:path';

/** Metadata only: never capture payloads, query strings, credentials or command output. */
export function auditMutations(store: PlatformStore, projectFor?: (pathname: string, resource: string) => string | undefined): MiddlewareHandler {
  return async (c,next) => {
    if (['GET','HEAD','OPTIONS'].includes(c.req.method)) return next();
    const pathname = c.req.path;
    // Upload chunks and polling do not need one receipt per binary block.
    if (/^\/api\/files\/upload\/[^/]+$/.test(pathname)) return next();
    const actor = c.get('user');
    if (!actor) return next();
    let resource = pathname;
    const size=Number(c.req.header('content-length') || 0);
    if (/^\/api\/files\/(write|create|mkdir|rename|copy|trash|restore)$/.test(pathname) && size>0 && size<=1_000_000 && c.req.header('content-type')?.includes('application/json')) {
      try {
        const input=await c.req.raw.clone().json();
        const value=input.to || input.path || input.from;
        if (typeof value==='string' && path.isAbsolute(value) && value.length<=4096 && !/[\u0000-\u001f]/.test(value)) resource=pathname.endsWith('/create') && typeof input.name==='string' ? path.join(value,input.name) : value;
      } catch { /* Invalid requests retain their endpoint metadata. */ }
    }
    const start = performance.now(), projectId = projectFor?.(pathname,resource);
    const operationId=crypto.randomUUID();
    store.append({actor,action:`${c.req.method} ${pathname}`,resource,projectId,status:'running',operationId});
    try {
      await next();
      store.append({actor,action:`${c.req.method} ${pathname}`,resource,projectId,status:c.res.status < 400 ? 'ok' : 'failed',httpStatus:c.res.status,durationMs:Math.round(performance.now()-start),operationId});
    } catch (e) {
      // The error handlers map typed errors to their own status; mirror that here.
      const httpStatus=(e instanceof PlatformError||e instanceof MaintenanceError)&&Number.isInteger(e.status)?e.status:500;
      store.append({actor,action:`${c.req.method} ${pathname}`,resource,projectId,status:'failed',httpStatus,durationMs:Math.round(performance.now()-start),operationId});
      throw e;
    }
  };
}
