import { load, JSON_SCHEMA } from 'js-yaml';
import { MaintenanceRepository } from './storage/repository';
import { hash } from './storage/policy';
import { MaintenanceError } from './storage/types';
export interface ComposeDraft {path:string;content:string;revision:string;baseRevision:string;at:string;validation:{ok:boolean;error?:string};services:string[]}
export function composeSyntax(content:string):{ok:boolean;error?:string;services:string[]} {
  try {
    if(content.length>262144||/(?:^|\s)[&*][\w-]+/m.test(content))throw new Error();
    const doc=load(content,{schema:JSON_SCHEMA}) as {services?:unknown};
    if(!doc||typeof doc!=='object'||!doc.services||typeof doc.services!=='object'||Array.isArray(doc.services))throw new Error();
    const services=Object.keys(doc.services);if(!services.length||services.some(s=>! /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(s)))throw new Error();
    return {ok:true,services};
  } catch {return {ok:false,services:[],error:'El YAML no contiene servicios válidos o usa referencias no admitidas por la validación local. No se modificó el archivo desplegable.'};}
}
export class ComposeDrafts {
  constructor(private repo:MaintenanceRepository){}
  get(p:string){return this.repo.get<ComposeDraft>('compose-draft',hash(p));}
  discard(p:string,revision:unknown){
    return this.repo.db.transaction(()=>{
      const draft=this.get(p);
      if(!draft||draft.revision!==revision)throw new MaintenanceError('El borrador cambió. Recargá antes de descartarlo.');
      // Removing a draft has no host effect. No backup containing secrets is made.
      this.repo.db.query('DELETE FROM records WHERE kind=? AND id=?').run('compose-draft',hash(p));
      return {discarded:true,applied:false};
    }).immediate();
  }
  save(p:string,content:string,current:string,expected:unknown){
    return this.repo.db.transaction(()=>{
      const previous=this.get(p);const revision=previous?.revision||hash(current);
      if(expected!==revision)throw new MaintenanceError('El borrador cambió. Recargá antes de guardar.');
      if(previous&&previous.baseRevision!==hash(current))throw new MaintenanceError('El archivo del host cambió desde el borrador. Compará antes de continuar.');
      if(!previous&&this.repo.list('compose-draft',21).length>=20)throw new MaintenanceError('Hay 20 borradores; exportá y revisá los pendientes antes de crear más.');
      const syntax=composeSyntax(content);const draft:ComposeDraft={path:p,content,revision:hash(content),baseRevision:previous?.baseRevision||hash(current),at:new Date().toISOString(),validation:{ok:syntax.ok,error:syntax.error},services:syntax.services};
      this.repo.put('compose-draft',hash(p),draft);return draft;
    }).immediate();
  }
  preview(p:string,current:string){const d=this.get(p);return d?{draft:d,changedOnHost:d.baseRevision!==hash(current),before:current,after:d.content,canApply:false,blockers:['Validación Docker con env files, profiles y overrides, y rollback de imagen/datos pendientes. El borrador no se promueve automáticamente.']}:null;}
}
