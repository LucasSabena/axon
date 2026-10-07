import type { Hono } from 'hono';
import { PlatformStore } from '../platform/store';
import { actor, body, only, protect, requestOrigin, textField } from '../storage/http';
import { MaintenanceError, type Actor } from '../storage/types';
import { Dropbox, cloudPath } from './dropbox';
import { CloudVault } from './vault';
import { CloudDownloads } from './downloads';
import { Drive } from './drive';
import type { CloudProvider } from './provider';
import type { CloudAgents } from './agents';

const INLINE:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',pdf:'application/pdf',mp4:'video/mp4',webm:'video/webm',m4v:'video/mp4',mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',oga:'audio/ogg',wav:'audio/wav',flac:'audio/flac',opus:'audio/ogg'};
export function registerDropboxRoutes(app:Hono,store:PlatformStore,vaultDir:string,provider?:Dropbox) {
  const dropbox=provider||new Dropbox(store,new CloudVault(vaultDir));
  const downloads=new CloudDownloads(store,dropbox);
  registerProviderRoutes(app,store,'dropbox',dropbox,downloads);
  return {dropbox,downloads};
}
const NAMES={dropbox:'Dropbox',gdrive:'Google Drive',onedrive:'OneDrive'};
type ProviderId=keyof typeof NAMES;
function visible(store:PlatformStore,owner:string,id:string){return store.get<{visible:boolean}>('cloud-visibility',id+':'+owner)?.visible!==false;}
export function createCloudProviders(store:PlatformStore,vault:CloudVault):Record<ProviderId,CloudProvider>{return {dropbox:new Dropbox(store,vault),gdrive:new Drive('gdrive',store,vault),onedrive:new Drive('onedrive',store,vault)};}
export function registerCloudRoutes(app:Hono,store:PlatformStore,vaultDir:string,overrides:Partial<Record<ProviderId,CloudProvider>>={},agents?:CloudAgents) {
  const providers={...createCloudProviders(store,new CloudVault(vaultDir)),...overrides};
  for(const [id,provider] of Object.entries(providers))registerProviderRoutes(app,store,id as ProviderId,provider,new CloudDownloads(store,provider,id));
  if(agents)for(const id of Object.keys(providers))app.get('/api/files/'+id+'/uploads',c=>c.json({ok:true,jobs:agents.ownerUploads(actor(c).actorId,id)}));
  protect(app,'/api/connections');
  app.use('/api/connections',async(c,next)=>{c.header('Cache-Control','private, no-store');try{actor(c);await next();}catch(e){if(e instanceof MaintenanceError)return e.getResponse();return c.json({ok:false,error:'No se pudieron consultar las conexiones'},503);}});
  app.get('/api/connections',c=>{const owner=actor(c).actorId;return c.json({ok:true,providers:Object.entries(providers).map(([id,p])=>({id,name:NAMES[id as ProviderId],...p.status(owner),visible:visible(store,owner,id),redirectUri:requestOrigin(c)+'/api/files/'+id+'/oauth/callback'}))});});
  app.post('/api/connections/:id/visibility',async c=>{const id=c.req.param('id');if(!Object.hasOwn(providers,id))throw new MaintenanceError('Plataforma no encontrada',404);const b=await body(c);only(b,['visible']);if(typeof b.visible!=='boolean')throw new MaintenanceError('Visibilidad inválida',400);const owner=actor(c).actorId;store.put('cloud-visibility',id+':'+owner,{visible:b.visible});return c.json({ok:true});});
  return providers;
}
function registerProviderRoutes(app:Hono,store:PlatformStore,id:ProviderId,dropbox:CloudProvider,downloads:CloudDownloads) {
  const PREFIX='/api/files/'+id;
  protect(app,PREFIX);
  app.get(PREFIX+'/status',c=>c.json({ok:true,...dropbox.status(actor(c).actorId),visible:visible(store,actor(c).actorId,id),redirectUri:requestOrigin(c)+PREFIX+'/oauth/callback'}));
  app.post(PREFIX+'/configure',async c=>{const b=await body(c);only(b,id==='dropbox'?['clientId']:['clientId','clientSecret']);if(id==='dropbox')(dropbox as Dropbox).configure(actor(c).actorId,b.clientId);else(dropbox as Drive).configure(actor(c).actorId,b.clientId,b.clientSecret);return c.json({ok:true});});
  app.post(PREFIX+'/connect',async c=>{const b=await body(c);only(b,id==='dropbox'?['upload']:[]);if(b.upload!==undefined&&typeof b.upload!=='boolean')throw new MaintenanceError('Permiso de subida inválido',400);return c.json({ok:true,url:dropbox.authorize(actor(c),requestOrigin(c),b.upload===true)});});
  app.get(PREFIX+'/oauth/callback',async c=>{
    // The session may have expired during the upstream roundtrip — a 401 here
    // would strand the user on a bare error page instead of the login flow.
    let by:Actor;try{by=actor(c);}catch{return c.redirect('/',303);}
    let result='connected',reason='';
    try{await dropbox.callback(by,c.req.query('state'),c.req.query('code'),!!c.req.query('error'));if(c.req.query('error'))result='cancelled';}
    catch(e){result='failed';reason=e instanceof MaintenanceError?({400:'expirada',409:'conflicto',429:'limite',502:'plataforma',503:'plataforma'} as Record<number,string>)[e.status]||'error':'error';}
    return c.redirect('/configuracion?section=connections&provider='+id+'&connection='+result+(reason?'&reason='+reason:''),303);
  });
  app.get(PREFIX+'/health',async c=>{
    const owner=actor(c).actorId;
    if(!dropbox.status(owner).connected)throw new MaintenanceError('La cuenta no está conectada',409);
    try{const info=await dropbox.checkConnection?.(owner);return c.json({ok:true,healthy:true,...(info&&typeof info==='object'?info:{})});}
    catch(e){return c.json({ok:true,healthy:false,error:e instanceof MaintenanceError?e.message:'No se pudo verificar la conexión'});}
  });
  app.post(PREFIX+'/disconnect',async c=>{only(await body(c),[]);const owner=actor(c).actorId;downloads.cancelOwner(owner);const result=await dropbox.disconnect(owner);const notice=result&&typeof result==='object'?result.notice:undefined;return c.json({ok:true,...(notice?{notice}:{})});});
  if(id==='dropbox'){
    app.post(PREFIX+'/shared',async c=>{const b=await body(c);only(b,['url']);return c.json({ok:true,...await (dropbox as Dropbox).addShared(actor(c).actorId,b.url)});});
    app.post(PREFIX+'/shared/:id/remove',async c=>{only(await body(c),[]);(dropbox as Dropbox).removeShared(actor(c).actorId,c.req.param('id'));return c.json({ok:true});});
  }
  app.get(PREFIX+'/list',async c=>{
    const owner=actor(c).actorId,source=c.req.query('location')||'account',p=c.req.query('path')||'';
    const page=await dropbox.list(owner,source,p,c.req.query('cursor'));
    return c.json({ok:true,path:p,...page,...(id!=='dropbox'&&!c.req.query('cursor')?{breadcrumbs:await (dropbox as Drive).breadcrumbs(owner,p)}:{})});
  });
  app.get(PREFIX+'/stream',async c=>{
    const owner=actor(c).actorId,source=c.req.query('location')||'account',p=c.req.query('path')||'';
    const m=await dropbox.metadata(owner,source,p);if(m.type!=='file'||!m.downloadable)throw new MaintenanceError('Este contenido requiere abrirse o exportarse desde su plataforma',409);
    const response=await dropbox.content(owner,source,p,m.revision,c.req.header('range'),c.req.raw.signal);
    const mime=INLINE[m.name.split('.').pop()?.toLowerCase()||''];const attachment=c.req.query('download')==='1'||!mime;
    const headers=new Headers({'Cache-Control':'private, no-store','Content-Type':mime||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer','Accept-Ranges':'bytes','Content-Disposition':`${attachment?'attachment':'inline'}; filename="archivo"; filename*=UTF-8''${encodeURIComponent(m.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`});
    for(const key of ['content-length','content-range']){const v=response.headers.get(key);if(v)headers.set(key,v);}
    return new Response(response.body,{status:response.status,headers});
  });
  app.get(PREFIX+'/downloads',c=>c.json({ok:true,jobs:downloads.list(actor(c).actorId)}));
  app.post(PREFIX+'/downloads',async c=>{
    const b=await body(c);only(b,['location','paths','directory','volumeToken']);
    const id=await downloads.start(actor(c).actorId,textField(b.location,100),b.paths as string[],textField(b.directory,4096),b.volumeToken);return c.json({ok:true,id},202);
  });
  app.post(PREFIX+'/downloads/:id/cancel',async c=>{only(await body(c),[]);downloads.cancel(actor(c).actorId,c.req.param('id'));return c.json({ok:true});});
  app.post(PREFIX+'/downloads/:id/retry',async c=>{only(await body(c),[]);await downloads.retry(actor(c).actorId,c.req.param('id'));return c.json({ok:true});});
}
