import { load, JSON_SCHEMA } from 'js-yaml';
import type { Hono } from 'hono';
import { MaintenanceRepository } from './storage/repository';
import { MaintenanceError } from './storage/types';
import { hash } from './storage/policy';
import { protect, body, only, textField } from './storage/http';
import type { DomainMapping } from './types';
import type { Heartbeat } from './heartbeats';
export interface HomeLink { id:string; name:string; url:string; group:string; favorite:boolean }
export interface LinksState { revision:string; links:HomeLink[] }
export interface KnownHomeLink extends HomeLink {source:'domain';status:'up'|'warn'|'down'|'unknown';observedAt:string|null;serviceType:'process'|'docker'}
/** Reuse observations already collected by Axon. Opening Home never probes a URL. */
export function knownHomeLinks(domains:DomainMapping[],beats:Record<string,Heartbeat[]>,now=Date.now()):KnownHomeLink[]{
  return domains.slice(0,250).flatMap(d=>{
    try {
      if(!d.fullDomain||!/^[a-zA-Z0-9.-]+$/.test(d.fullDomain))return [];
      const link=normalizeLinks([{name:d.fullDomain,url:`https://${d.fullDomain}`,group:d.projectName||'Dominios',favorite:false}])[0];
      const last=beats[d.id]?.at(-1),age=last?now-last.t:Infinity;
      const fresh=Number.isFinite(age)&&age>=0&&age<=180_000&&['up','warn','down'].includes(last?.s||'');
      return [{...link,source:'domain' as const,status:fresh?last.s:'unknown' as const,observedAt:last&&Number.isFinite(last.t)&&Math.abs(last.t)<8.64e15?new Date(last.t).toISOString():null,serviceType:d.processType}];
    } catch { return []; }
  });
}
export function safeLink(input:unknown):string {
  const value=textField(input,2048);
  if(value.startsWith('/')&&!value.startsWith('//')&&!value.includes('\\')){const u=new URL(value,'http://axon.invalid');if(u.origin!=='http://axon.invalid')throw new MaintenanceError('URL interna inválida',400);return u.pathname;}
  let u:URL;try{u=new URL(value);}catch{throw new MaintenanceError('URL inválida',400);}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new MaintenanceError('Usá HTTP(S) sin credenciales en la URL',400);
  // A navigation bookmark never imports tokens from query strings or fragments.
  u.search='';u.hash='';return u.toString();
}
export function normalizeLinks(input:unknown):HomeLink[]{
  if(!Array.isArray(input)||input.length>250)throw new MaintenanceError('Máximo 250 accesos',400);
  const ids=new Set<string>();return input.map((item:unknown)=>{
    if(!item||typeof item!=='object')throw new MaintenanceError('Acceso inválido',400);
    const v=item as Record<string,unknown>;const url=safeLink(v.url), id=hash(url).slice(0,24);
    if(ids.has(id))throw new MaintenanceError('Hay URLs duplicadas',400);ids.add(id);
    return {id,url,name:textField(v.name,100),group:textField(v.group||'Personal',80),favorite:v.favorite===true};
  });
}
export function importHomepage(source:string):{links:HomeLink[];skipped:number;warnings:string[]} {
  if(source.length>250000||/(?:^|\s)[&*][\w-]+/m.test(source))throw new MaintenanceError('Archivo demasiado grande o con referencias YAML no admitidas',400);
  let parsed:unknown;try{parsed=load(source,{schema:JSON_SCHEMA});}catch{throw new MaintenanceError('YAML/JSON inválido',400);}
  if(!Array.isArray(parsed))throw new MaintenanceError('Se espera una lista de grupos de Homepage',400);
  const found:HomeLink[]=[];let skipped=0;
  for(const group of parsed){if(!group||typeof group!=='object'){skipped++;continue;}
    for(const [name,items] of Object.entries(group)){if(!Array.isArray(items)){skipped++;continue;}for(const entry of items){
      if(!entry||typeof entry!=='object'){skipped++;continue;}
      for(const [title,settings] of Object.entries(entry)){
        // Services use a mapping; bookmarks.yaml uses a sequence of mappings.
        // Only these declared leaves are inspected, never arbitrary nested widgets.
        const leaves=Array.isArray(settings)?settings:[settings];
        if(!leaves.length){skipped++;continue;}
        for(const leaf of leaves){
          if(!leaf||typeof leaf!=='object'||Array.isArray(leaf)){skipped++;continue;}
          try { found.push(...normalizeLinks([{name:title,url:(leaf as Record<string,unknown>).href,group:name,favorite:false}])); }
          catch { skipped++; }
        }
      }
    }}
  }
  const unique=[...new Map(found.map(x=>[x.url,x])).values()];
  return {links:normalizeLinks(unique),skipped,warnings:['Sólo nombre, URL y grupo. Se omiten widgets, credenciales, parámetros y fragmentos; revisá los accesos antes de importar.']};
}
export class HomeLinks {
  constructor(readonly repo:MaintenanceRepository){}
  get():LinksState{return this.repo.get<LinksState>('home','links')||{revision:hash([]),links:[]};}
  save(input:unknown,revision:unknown):LinksState{
    return this.repo.db.transaction(()=>{const state=this.get();if(revision!==state.revision)throw new MaintenanceError('Los accesos cambiaron en otra pestaña. Actualizá antes de guardar.');const links=normalizeLinks(input);const next={revision:hash(links),links};this.repo.put('home','links',next);return next;}).immediate();
  }
  importLinks(input:unknown,revision:unknown):LinksState{
    return this.repo.db.transaction(()=>{
      const current=this.get(), incoming=normalizeLinks(input),existing=new Set(current.links.map(l=>l.id));
      // Existing names, favorites, groups and order are deliberate user choices.
      return this.save([...current.links,...incoming.filter(l=>!existing.has(l.id))],revision);
    }).immediate();
  }
}
export function registerHomeLinkRoutes(app:Hono,service:HomeLinks,sources:()=>KnownHomeLink[]=()=>[]){
  protect(app,'/api/home');
  app.get('/api/home/links',c=>c.json({ok:true,...service.get()}));
  app.get('/api/home/sources',c=>c.json({ok:true,links:sources(),coverage:'Estado del dominio en el heartbeat existente. No verifica autenticación ni cada ruta; sin nuevas consultas de red.'}));
  app.post('/api/home/links',async c=>{const b=await body(c);only(b,['links','revision']);return c.json({ok:true,...service.save(b.links,b.revision)});});
  app.post('/api/home/import',async c=>{const b=await body(c);only(b,['links','revision']);return c.json({ok:true,...service.importLinks(b.links,b.revision)});});
  app.post('/api/home/import-preview',async c=>{const b=await body(c);only(b,['source']);const imported=importHomepage(textField(b.source,250000));const current=service.get();return c.json({ok:true,...imported,existing:imported.links.filter(l=>current.links.some(x=>x.id===l.id)).length});});
  app.get('/api/home/export',c=>{c.header('Content-Disposition','attachment; filename="axon-accesos.json"');return c.json({version:1,...service.get()});});
}
