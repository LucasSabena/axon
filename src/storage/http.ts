import type { Hono, Context } from 'hono';
import { createHash } from 'node:crypto';
import { MaintenanceError, type Actor } from './types';
export function actor(c:Context): Actor {
  const cookie=c.req.header('cookie')?.match(/(?:^|;\s*)axon_session=([^;]+)/)?.[1];
  if(!c.get('user')||!cookie)throw new MaintenanceError('Necesitás una sesión autenticada',401);
  return {actorId:c.get('user'),sessionId:createHash('sha256').update(cookie).digest('hex')};
}
let warnedOrigin=false;
export function requestOrigin(c:Context):string {
  const configured=process.env.AXON_PUBLIC_ORIGIN;
  if(configured){const u=new URL(configured);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new MaintenanceError('Origen público mal configurado',503);return u.origin;}
  // Without AXON_PUBLIC_ORIGIN the Host header is the only origin reference; a
  // reverse proxy that rewrites Host will make every POST fail the Origin check.
  if(!warnedOrigin){warnedOrigin=true;console.warn('[storage] AXON_PUBLIC_ORIGIN no está configurado: Origin se valida contra el encabezado Host de cada solicitud. Detrás de un proxy inverso que reescriba Host, los POST serán rechazados; configurá AXON_PUBLIC_ORIGIN con el origen público exacto.');}
  return new URL(c.req.url).origin;
}
export function protect(app:Hono,prefix:string) {
  app.use(prefix+'/*',async(c,next)=>{
    c.header('Cache-Control','private, no-store');
    try {
      actor(c);
      if(!['GET','HEAD'].includes(c.req.method)) {
        const origin=c.req.header('origin');
        if(!origin||origin!==requestOrigin(c)||c.req.header('sec-fetch-site')==='cross-site')throw new MaintenanceError('Origen de la solicitud no permitido',403);
        if(!c.req.header('content-type')?.startsWith('application/json'))throw new MaintenanceError('Se requiere JSON',415);
        if(Number(c.req.header('content-length')||0)>300000)throw new MaintenanceError('Solicitud demasiado grande',413);
      }
      await next();
    }catch(e){if(e instanceof MaintenanceError)return e.getResponse();return c.json({ok:false,error:'La operación no se pudo completar. No se confirmó ningún resultado.'},503);}
  });
}
export async function body(c:Context): Promise<Record<string,unknown>> {
  const reader=c.req.raw.body?.getReader();if(!reader)throw new MaintenanceError('Falta JSON',400);
  const chunks:Uint8Array[]=[];let size=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>300000){await reader.cancel();throw new MaintenanceError('Solicitud demasiado grande',413);}chunks.push(value);}
    const value:unknown=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Record<string,unknown>;
  } catch(e){if(e instanceof MaintenanceError)throw e;throw new MaintenanceError('JSON inválido',400);}
}
export function only(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).some(k=>!keys.includes(k)))throw new MaintenanceError('Parámetros no permitidos',400);}
export function textField(value:unknown,max=200):string {if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw new MaintenanceError('Campo de texto inválido',400);return value.trim();}
