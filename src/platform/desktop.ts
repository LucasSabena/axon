import { readFile } from 'node:fs/promises';
import { hostArgv,boundedCommand } from '../storage/host-argv';
import { PlatformError,type PlatformStore } from './store';
import type { Hono } from 'hono';

let source:Promise<string>|undefined;
export async function desktopWorker(request:Record<string,unknown>) {
  const code=await (source ??= readFile(new URL('./desktop-host.py',import.meta.url),'utf8').catch(e=>{source=undefined;throw e;}));
  const result=JSON.parse(await boundedCommand(hostArgv('python3',['-c',code]),JSON.stringify({...request,workerSource:code}),undefined,30000));
  if(!result.ok)throw new PlatformError(result.error || 'Escritorio no disponible',409);return result;
}
export class Desktop {
  constructor(private home:() => Promise<string>,readonly store:PlatformStore,private run=desktopWorker) {}
  status(){return this.home().then(home=>this.run({action:'status',home}));}
  async action(action:'start'|'stop'|'launch'|'resize',actor:string,app?:string,resolution?:string) {
    const result=await this.run({action,home:await this.home(),app,resolution});
    this.store.append({actor,action:'desktop.'+action,resource:app || resolution || 'desktop',status:'ok'});return result;
  }
}
export function registerDesktop(app:Hono,desktop:Desktop) {
  app.use('/api/desktop*',async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
  const handle=(fn:(c:any)=>Promise<any>)=>async(c:any)=>{try{return c.json(await fn(c));}catch(e){return c.json({ok:false,error:e instanceof PlatformError ? e.message : 'No se pudo consultar el escritorio'},e instanceof PlatformError ? e.status : 503);}};
  app.get('/api/desktop',handle(()=>desktop.status()));
  app.post('/api/desktop/:action',handle(async c=>{
    const action=c.req.param('action');if(!['start','stop','launch','resize'].includes(action))throw new PlatformError('Acción inválida');
    const raw=await c.req.text();if(raw.length>4096)throw new PlatformError('Solicitud excedida');let body:any;try{body=JSON.parse(raw);}catch{throw new PlatformError('JSON inválido');}
    const geom=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{2,3}x[1-9]\d{2,3}$/.test(v);
    if(!body || Object.keys(body).some(k=>k!=='app'&&k!=='resolution'))throw new PlatformError('Parámetros inválidos');
    if(action==='launch'&&(typeof body.app!=='string'||Object.keys(body).length!==1))throw new PlatformError('Parámetros inválidos');
    if(action==='resize'&&!geom(body.resolution))throw new PlatformError('Parámetros inválidos');
    if(action==='stop'&&Object.keys(body).length)throw new PlatformError('Parámetros inválidos');
    if(action==='start'&&(Object.keys(body).length>1||(body.resolution!==undefined&&!geom(body.resolution))||body.app!==undefined))throw new PlatformError('Parámetros inválidos');
    return desktop.action(action as 'start'|'stop'|'launch'|'resize',c.get('user'),body.app,body.resolution);
  }));
  app.get('/desktop/view',c=>{
    c.header('Cache-Control','private, no-store');
    c.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'");
    return c.html('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Escritorio AXON</title><link rel="stylesheet" href="/desktop-view.css"></head><body><div id="desktop-status" role="status">Conectando con el escritorio…</div><div id="desktop-bar" role="toolbar" aria-label="Controles del escritorio"><button type="button" data-cad title="Enviar Ctrl+Alt+Supr a la sesión">Ctrl+Alt+Supr</button><button type="button" data-wm="Left" title="Escritorio virtual anterior (Ctrl+Alt+Izquierda)">Ctrl+Alt+←</button><button type="button" data-wm="Right" title="Escritorio virtual siguiente (Ctrl+Alt+Derecha)">Ctrl+Alt+→</button><button type="button" data-wm="Up" title="Escritorio virtual superior (Ctrl+Alt+Arriba)">Ctrl+Alt+↑</button><button type="button" data-wm="Down" title="Escritorio virtual inferior (Ctrl+Alt+Abajo)">Ctrl+Alt+↓</button><label class="dv-check"><input type="checkbox" id="dv-viewonly"> Solo ver</label><button type="button" data-fullscreen>Pantalla completa</button></div><div id="desktop-screen"></div><script type="module" src="/desktop-view.js"></script></body></html>');
  });
}
