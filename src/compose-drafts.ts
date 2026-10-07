import { load } from 'js-yaml';
import { MaintenanceRepository } from './storage/repository';
import { hash } from './storage/policy';
import { MaintenanceError } from './storage/types';
export interface ComposeDraft {path:string;content:string;revision:string;baseRevision:string;at:string;validation:{ok:boolean;error?:string};services:string[]}
export function composeSyntax(content:string):{ok:boolean;error?:string;services:string[]} {
  try {
    if(content.length>262144)throw new Error('El archivo supera el máximo de 256 KB');
    // Schema por defecto de js-yaml: soporta anchors, aliases y merge keys
    // (`<<`), todos válidos en docker-compose. La validación fina (env files,
    // profiles, tipos de campos) la hace `docker compose config` server-side.
    const doc=load(content) as {services?:unknown};
    if(!doc||typeof doc!=='object'||Array.isArray(doc)||!doc.services||typeof doc.services!=='object'||Array.isArray(doc.services))throw new Error('El documento no declara una sección "services" como mapa');
    const services=Object.keys(doc.services);if(!services.length)throw new Error('La sección "services" está vacía');
    const bad=services.filter(s=>!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(s));if(bad.length)throw new Error(`Nombres de servicio inválidos: ${bad.join(', ')}`);
    return {ok:true,services};
  } catch(e){return {ok:false,services:[],error:`YAML inválido: ${e instanceof Error?e.message.split('\n')[0]:'error de sintaxis'}. No se modificó el archivo desplegable.`};}
}
export class ComposeDrafts {
  constructor(private repo:MaintenanceRepository){}
  get(p:string){return this.repo.get<ComposeDraft>('compose-draft',hash(p));}
  discard(p:string,revision:unknown){
    return this.repo.db.transaction(()=>{
      const draft=this.get(p);
      if(!draft||draft.revision!==revision)throw new MaintenanceError('El borrador cambió desde que lo cargaste. Recargá antes de descartarlo.');
      // Removing a draft has no host effect. No backup containing secrets is made.
      this.repo.db.query('DELETE FROM records WHERE kind=? AND id=?').run('compose-draft',hash(p));
      return {discarded:true,applied:false};
    }).immediate();
  }
  save(p:string,content:string,current:string,expected:unknown){
    return this.repo.db.transaction(()=>{
      const previous=this.get(p);const revision=previous?.revision||hash(current);
      if(expected!==revision)throw new MaintenanceError('La revisión que editás quedó vieja: el borrador cambió desde que lo cargaste. Recargá antes de guardar.');
      if(previous&&previous.baseRevision!==hash(current))throw new MaintenanceError('El archivo del host cambió desde el borrador. Compará antes de continuar.');
      if(!previous&&this.repo.list('compose-draft',21).length>=20)throw new MaintenanceError('Hay 20 borradores; exportá y revisá los pendientes antes de crear más.');
      const syntax=composeSyntax(content);const draft:ComposeDraft={path:p,content,revision:hash(content),baseRevision:previous?.baseRevision||hash(current),at:new Date().toISOString(),validation:{ok:syntax.ok,error:syntax.error},services:syntax.services};
      this.repo.put('compose-draft',hash(p),draft);return draft;
    }).immediate();
  }
  preview(p:string,current:string){const d=this.get(p);return d?{draft:d,changedOnHost:d.baseRevision!==hash(current),before:current,after:d.content,canApply:false,blockers:['Validación Docker con env files, profiles y overrides, y rollback de imagen/datos pendientes. El borrador no se promueve automáticamente.']}:null;}
}
