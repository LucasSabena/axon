import { Hono } from 'hono';
import { requestOriginAllowed } from '../browser-security';
import { PlatformError, SCOPES, CLOUD_SCOPES, type PlatformStore, type ApiIdentity, type Scope } from './store';
import type { ProjectHub } from './projects';
import type { Diagnostics } from './diagnostics';
import type { CloudAgents } from '../cloud/agents';
import { registerCloudMachineRoutes, callCloudTool, cloudError } from '../cloud/agent-api';
import { MaintenanceError } from '../storage/types';
import { ApiLimiter, ApiThrottle, apiLane, leasedResponse } from './api-limits';
import { AGENT_INSTRUCTIONS, agentTools, agentCapabilities, permittedProjectTools, permittedCloudTools } from './api-discovery';

export interface PlatformApiDependencies {
  cloud?:CloudAgents;
  cloudLocalUrl?:string;
  store: PlatformStore; hub: ProjectHub; diagnostics: Diagnostics;
  logs: (projectId:string) => Promise<string[]>;
  backups?: { list:(projectId:string) => Promise<any>; run:(projectId:string,actor:string,credentialId?:string) => Promise<any> };
}
type ApiEnv = { Variables: { identity: ApiIdentity; rpcRequest: any } };
async function input(c:any) {
  if (Number(c.req.header('content-length') || 0) > 16384) throw new PlatformError('Solicitud demasiado grande',413);
  const raw = await c.req.text();
  if (raw.length > 16384) throw new PlatformError('Solicitud demasiado grande',413);
  try { const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new PlatformError('JSON inválido'); }
}
export const redactLog = (line:string) => line
  .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi,'$1[oculto]')
  .replace(/((?:["']?)(?:api[_-]?key|token|secret|password|authorization)["']?\s*[=:]\s*["']?)([^\s,;"']+)/gi,'$1[oculto]')
  .replace(/(:\/\/)[^\s/:@]+:[^\s/@]+@/g,'$1[oculto]@');
async function machineResources(hub:ProjectHub,id:string) {
  const resources=await hub.resources(id);
  // Configured launch commands can embed credentials; status grants expose metadata.
  const {command,...project}=resources.project;
  return {...resources,project};
}
/** Identifiable platform/maintenance errors keep their message and status; anything else is a generic 503, not a mislabeled cloud failure. */
const apiError=(e:unknown):PlatformError=>e instanceof PlatformError?e:e instanceof MaintenanceError?new PlatformError(e.message,e.status):new PlatformError('No se pudo completar la operación',503);
/** Shared query-param validation for the audit endpoints (UI + machine API). */
function auditFilters(c:any) {
  const f:Record<string,string>={};
  for (const key of ['status','actor','action','q'] as const) {
    const v=c.req.query(key);
    if (v===undefined) continue;
    if (typeof v!=='string'||v.length>120) throw new PlatformError('Filtro inválido');
    if (v) f[key]=v;
  }
  if (f.status&&!['running','ok','failed','interrupted'].includes(f.status)) throw new PlatformError('Estado de filtro inválido');
  return f;
}
export function machineApi(deps: PlatformApiDependencies) {
  const {store,hub,diagnostics} = deps, app = new Hono<ApiEnv>();
  const limiter = new ApiLimiter();
  app.onError((e,c) => {
    if(e instanceof ApiThrottle){c.header('Retry-After',String(e.retryAfter));c.header('X-Axon-Limit-Lane',e.lane);return c.json({ok:false,error:e.message,code:'axon-api-limit',lane:e.lane,reason:e.reason,retryAfter:e.retryAfter},429);}
    const mapped=apiError(e);return c.json({ok:false,error:mapped.message},mapped.status as any);
  });
  app.use('*',async(c,next) => {
    c.header('Cache-Control','private, no-store');
    if (!requestOriginAllowed(c.req.raw)) throw new PlatformError('Origen no permitido',403);
    const bearer = c.req.header('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    const identity = bearer ? store.authenticate(bearer) : null;
    if (!identity) throw new PlatformError('Token inválido, revocado o vencido',401);
    c.set('identity',identity);
    const route=c.req.path.replace(/^\/api\/v1(?=\/|$)/,'');
    let rpc:any;
    if(c.req.method==='POST'&&route==='/mcp'){
      // Charge the read budget even when the JSON-RPC body cannot be parsed.
      try{rpc=await input(c);}catch(e){limiter.acquire(identity.id,'read')();throw e;}
      c.set('rpcRequest',rpc);
    }
    const lane=apiLane(c.req.method,route,rpc),release=limiter.acquire(identity.id,lane);
    c.header('X-Axon-Limit-Lane',lane);c.header('X-Axon-Limit-Per-Minute',String(limiter.limits[lane].perMinute));
    let leased=false;
    try{await next();c.header('X-Axon-Limit-Lane',lane);c.header('X-Axon-Limit-Per-Minute',String(limiter.limits[lane].perMinute));if(lane==='transfer'&&c.req.method==='GET'&&c.res.ok){c.res=leasedResponse(c.res,release,c.req.raw.signal);leased=true;}}finally{if(!leased)release();}
  });
  const check = (c:any,projectId:string,scope:Scope) => { const identity = c.get('identity') as ApiIdentity;store.require(identity,projectId,scope);hub.project(projectId);return identity; };
  app.get('/projects',c => {
    const identity = c.get('identity');
    return c.json({ok:true,projects:hub.sources.projects().filter(p => store.permits(identity,p.id,'projects:read')).map(({id,name,type,framework}) => ({id,name,type,framework}))});
  });
  app.get('/projects/:id',async c => { check(c,c.req.param('id'),'projects:read');return c.json({ok:true,...await machineResources(hub,c.req.param('id'))}); });
  app.post('/projects/:id/diagnose',async c => {
    const identity = check(c,c.req.param('id'),'diagnostics:run');
    const value = await input(c);if (Object.keys(value).length) throw new PlatformError('El diagnóstico no acepta comandos ni URLs');
    return c.json({ok:true,diagnostic:await diagnostics.run(c.req.param('id'),identity.owner,identity.id)});
  });
  app.get('/projects/:id/logs',async c => {
    const identity = check(c,c.req.param('id'),'logs:read');
    const lines = (await deps.logs(c.req.param('id'))).slice(-200).map(redactLog);
    store.append({actor:identity.owner,credentialId:identity.id,action:'api.logs.read',resource:c.req.param('id'),projectId:c.req.param('id'),status:'ok'});
    return c.json({ok:true,lines});
  });
  app.get('/projects/:id/audit',c => { check(c,c.req.param('id'),'audit:read');return c.json({ok:true,...store.audit(c.req.param('id'),Number(c.req.query('before')) || undefined,50,auditFilters(c))}); });
  app.get('/projects/:id/backups',async c => {
    check(c,c.req.param('id'),'backups:read');if (!deps.backups) throw new PlatformError('Backups no disponibles',503);
    return c.json({ok:true,backups:await deps.backups.list(c.req.param('id'))});
  });
  app.post('/projects/:id/backups',async c => {
    const identity = check(c,c.req.param('id'),'backups:run');
    const value = await input(c);if (Object.keys(value).length) throw new PlatformError('La API sólo ejecuta la política de backup ya configurada');
    if (!deps.backups) throw new PlatformError('Backups no disponibles',503);
    return c.json({ok:true,backup:await deps.backups.run(c.req.param('id'),identity.owner,identity.id)},202);
  });
  if(deps.cloud)registerCloudMachineRoutes(app,deps.cloud,input);
  app.get('/capabilities',c=>c.json({ok:true,...agentCapabilities(c.get('identity'),deps.cloud,!!deps.backups)}));
  app.get('/mcp',c => c.body(null,405,{'Allow':'POST'}));
  app.post('/mcp',async c => {
    const version = c.req.header('mcp-protocol-version');
    if (version && !['2025-03-26','2025-06-18','2025-11-25'].includes(version)) throw new PlatformError('Versión MCP no soportada');
    const accept = c.req.header('accept') || '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) throw new PlatformError('MCP requiere Accept application/json y text/event-stream',406);
    const request = c.get('rpcRequest') || await input(c);
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (request.id !== undefined && typeof request.id !== 'string' && typeof request.id !== 'number')) throw new PlatformError('Solicitud JSON-RPC inválida');
    const identity = c.get('identity'), available = permittedProjectTools(identity,!!deps.backups);
    const availableCloud=permittedCloudTools(identity,deps.cloud);
    const success = (result:any) => c.json({jsonrpc:'2.0',id:request.id,result});
    const rpcError = (code:number,message:string) => c.json({jsonrpc:'2.0',id:request.id ?? null,error:{code,message}});
    if (request.id === undefined) return request.method.startsWith('notifications/') ? c.body(null,202) : rpcError(-32600,'La solicitud necesita id');
    if (request.method === 'initialize') return success({protocolVersion:['2025-03-26','2025-06-18','2025-11-25'].includes(request.params?.protocolVersion) ? request.params.protocolVersion : '2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'axon',version:process.env.AXON_VERSION||'1.2.0'},instructions:AGENT_INSTRUCTIONS});
    if (request.method === 'ping') return success({});
    if (request.method === 'tools/list') return success({tools:agentTools(identity,deps.cloud,!!deps.backups)});
    if (request.method !== 'tools/call') return rpcError(-32601,'Método no soportado');
    if(request.params?.name==='axon_capabilities'){
      const args=request.params?.arguments||{};
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)return rpcError(-32602,'Argumentos inválidos');
      const result=agentCapabilities(identity,deps.cloud,!!deps.backups);return success({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false});
    }
    const cloudTool=availableCloud.find(t=>t.name===request.params?.name);
    if(cloudTool&&deps.cloud){try{const result=await callCloudTool(deps.cloud,identity,cloudTool.name,request.params?.arguments||{});return success({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false});}catch(e){return success({content:[{type:'text',text:cloudError(e).message}],isError:true});}}
    const tool = available.find(t => t.name === request.params?.name);
    if (!tool) return rpcError(-32602,'Herramienta no disponible para este token');
    const args = request.params?.arguments || {};
    if (!args || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).some(k => k !== 'projectId') || (tool.name !== 'axon_list_projects' && typeof args.projectId !== 'string')) return rpcError(-32602,'Argumentos inválidos');
    try {
      let result:any;
      if (tool.name === 'axon_list_projects') result = {projects:hub.sources.projects().filter(p => store.permits(identity,p.id,'projects:read')).map(({id,name}) => ({id,name}))};
      else {
        store.require(identity,args.projectId,tool.scope as Scope);hub.project(args.projectId);
        if (tool.name === 'axon_project_status') result = await machineResources(hub,args.projectId);
        if (tool.name === 'axon_diagnose_project') result = await diagnostics.run(args.projectId,identity.owner,identity.id);
        if (tool.name === 'axon_project_logs') result = {lines:(await deps.logs(args.projectId)).slice(-200).map(redactLog)};
        if (tool.name === 'axon_project_audit') result = store.audit(args.projectId);
        if (tool.name === 'axon_list_backups' || tool.name === 'axon_backup_project') {
          if (!deps.backups) throw new PlatformError('Backups no disponibles',503);
          result = tool.name === 'axon_list_backups' ? await deps.backups.list(args.projectId) : await deps.backups.run(args.projectId,identity.owner,identity.id);
        }
      }
      store.append({actor:identity.owner,credentialId:identity.id,action:'mcp.'+tool.name,resource:args.projectId || 'projects',projectId:args.projectId,status:'ok'});
      return success({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false});
    } catch (e) {
      store.append({actor:identity.owner,credentialId:identity.id,action:'mcp.'+tool.name,resource:args.projectId || 'projects',projectId:args.projectId,status:'failed'});
      return success({content:[{type:'text',text:e instanceof PlatformError ? e.message : 'No se pudo consultar la herramienta'}],isError:true});
    }
  });
  app.all('*',c => c.json({ok:false,error:'Ruta API no disponible'},404));
  return app;
}
export function registerPlatformRoutes(app:Hono,deps:PlatformApiDependencies) {
  const {store,hub,diagnostics} = deps;
  for (const prefix of ['/api/access/*','/api/audit','/api/project-hub/*','/api/project-hub-inventory']) app.use(prefix,async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
  const handle = (fn:(c:any) => Promise<any> | any) => async(c:any) => {
    try { return await fn(c); }
    catch (e) { const mapped=apiError(e);return c.json({ok:false,error:mapped.message},mapped.status); }
  };
  app.get('/api/project-hub-inventory',handle(async c => c.json({ok:true,containers:(await hub.sources.containers()).map(({id,name,state}) => ({id,name,state})),domains:hub.sources.domains().map(({id,fullDomain}) => ({id,fullDomain}))})));
  app.get('/api/project-hub/:id',handle(async c => c.json({ok:true,...await hub.overview(c.req.param('id'))})));
  app.get('/api/project-hub/:id/resources',handle(async c => c.json({ok:true,...await hub.resources(c.req.param('id'))})));
  app.put('/api/project-hub/:id/bindings',handle(async c => c.json({ok:true,bindings:await hub.bind(c.req.param('id'),await input(c),c.get('user'))})));
  app.post('/api/project-hub/:id/diagnose',handle(async c => { const body = await input(c);if (Object.keys(body).length) throw new PlatformError('El diagnóstico no acepta parámetros');return c.json({ok:true,diagnostic:await diagnostics.run(c.req.param('id'),c.get('user'))}); }));
  app.get('/api/project-hub/:id/diagnostic',handle(c => { hub.project(c.req.param('id'));return c.json({ok:true,diagnostic:store.get('diagnostic',c.req.param('id')) || null}); }));
  app.get('/api/audit',handle(c => c.json({ok:true,...store.audit(c.req.query('project'),Number(c.req.query('before')) || undefined,Number(c.req.query('limit'))||50,auditFilters(c))})));
  // Export the filtered history (up to 5.000 rows paged through the cursor).
  // Same filters as /api/audit plus format=json|csv.
  app.get('/api/audit/export',handle(c => {
    const filters=auditFilters(c),project=c.req.query('project'),csv=c.req.query('format')==='csv';
    const entries:any[]=[];let before:number|undefined;
    for (let i=0;i<50;i++) {
      const page=store.audit(project,before,100,filters);
      entries.push(...page.entries);
      if (!page.next||page.entries.length<100) break;
      before=page.next;
    }
    const day=new Date().toISOString().slice(0,10);
    if (csv) {
      // Prefix formula-leading cells: spreadsheet apps would otherwise
      // evaluate =, +, - or @ from action/resource/detail values.
      const cell=(v:unknown)=>{let s=String(v??'');if (/^[=+\-@\t]/.test(s)) s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
      const rows=[['fecha','actor','accion','recurso','proyecto','estado','http','duracion_ms','detalle'].join(',')];
      for (const e of entries) rows.push([new Date(e.at).toISOString(),e.actor,e.action,e.resource,e.projectId||'',e.status,e.httpStatus||'',e.durationMs||'',e.detail||''].map(cell).join(','));
      c.header('Content-Type','text/csv; charset=utf-8');
      c.header('Content-Disposition',`attachment; filename="axon-historial-${day}.csv"`);
      return c.body(rows.join('\n'));
    }
    c.header('Content-Disposition',`attachment; filename="axon-historial-${day}.json"`);
    return c.json({version:1,exportedAt:new Date().toISOString(),entries});
  }));
  app.get('/api/access/tokens',c => c.json({ok:true,tokens:store.tokens().filter(t=>t.owner===c.get('user')),scopes:SCOPES,cloudScopes:CLOUD_SCOPES,cloudConnections:deps.cloud?.available(c.get('user'))||[],cloudLocalUrl:deps.cloudLocalUrl,projects:hub.sources.projects().map(({id,name}) => ({id,name}))}));
  app.post('/api/access/tokens',handle(async c => {
    const value = await input(c);if (Object.keys(value).some(k => !['name','days','grants','cloudGrants'].includes(k))) throw new PlatformError('Campo no permitido');
    const cloudGrants=value.cloudGrants===undefined?[]:await deps.cloud?.grants(c.get('user'),value.cloudGrants);
    if(!cloudGrants)throw new PlatformError('Conexiones no disponibles',503);
    return c.json({ok:true,...store.createToken({...value,grants:value.grants||[],cloudGrants},c.get('user'),hub.sources.projects().map(p => p.id))},201);
  }));
  app.delete('/api/access/tokens/:id',handle(c => { store.revoke(c.req.param('id'),c.get('user'));deps.cloud?.retireCredentials();return c.json({ok:true}); }));
}
