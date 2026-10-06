import path from 'node:path';
import {hash} from './storage/policy';
import {insideRoot} from './library-paths';

export interface TransferImpact {
  kind: 'favorite'|'collection'|'share'|'root'|'upload'|'index'|'configuration';
  title:string; detail:string; paths:{from:string;to:string}[];
}
export interface TransferReview {
  revision:string; needsConfirmation:boolean; impacts:TransferImpact[]; addRoots:string[]; sourceAliases?:string[];
}
export interface LibraryReferences {
  roots:string[];uploadRoot:string;favorites:string[];
  collections:{id:string;name:string;paths:string[]}[];
  shares:{id:string;title:string;paths:string[];expires:number|null;allowDownload:boolean;pass?:string}[];
}
export const movedPath=(p:string,from:string,to:string)=>insideRoot(p,from)?to+p.slice(from.length):p;

// Review only references belonging to this tree. Visits, scans and unrelated
// favorites must not invalidate an approval; paths and share permissions must.
export function reviewLibraryMove(state:LibraryReferences,from:string,to:string,isDirectory:boolean,indexed:string[],sourceAliases:string[]=[from]):TransferReview {
  const belongs=(p:string)=>sourceAliases.some(alias=>insideRoot(p,alias));
  const repath=(p:string)=>movedReference(p,sourceAliases,to);
  const affected=(paths:string[])=>paths.filter(belongs).sort().map(p=>({from:p,to:repath(p)}));
  const impacts:TransferImpact[]=[];
  const add=(kind:TransferImpact['kind'],title:string,detail:string,paths:string[])=>{
    const selected=affected(paths);if(selected.length)impacts.push({kind,title,detail,paths:selected});
  };
  add('favorite','Favoritos','Se actualizarán a la nueva ubicación.',state.favorites);
  for(const c of state.collections)add('collection',`Colección: ${c.name}`,'Conservará sus archivos en la nueva ubicación.',c.paths);
  for(const s of state.shares)add('share',`Link compartido: ${s.title || 'Sin título'}`,'Conservará su dirección, contraseña, vencimiento y permisos.',s.paths);
  add('root','Carpetas de Biblioteca','La carpeta configurada se actualizará a la nueva ubicación.',state.roots);
  add('upload','Carpeta de subidas','Las próximas subidas usarán la nueva ubicación.',[state.uploadRoot].filter(Boolean));
  add('index','Archivos de Biblioteca','Se volverán a indexar en el destino.',indexed);
  const roots=state.roots.map(repath);
  const upload=repath(state.uploadRoot);
  const covered=[...roots,upload].filter(Boolean).some(root=>insideRoot(to,root));
  const addRoots=impacts.length&&!covered?[isDirectory?to:path.posix.dirname(to)]:[];
  const shares=state.shares.filter(s=>s.paths.some(belongs)).map(s=>({id:s.id,paths:affected(s.paths),expires:s.expires,allowDownload:s.allowDownload,pass:s.pass}));
  const revision=hash({from,to,sourceAliases:[...sourceAliases].sort(),impacts,addRoots,shares});
  return {revision,needsConfirmation:impacts.length>0,impacts,addRoots,sourceAliases};
}

export function movedReference(p:string,sources:string[],to:string):string{
  const source=[...sources].sort((a,b)=>b.length-a.length).find(root=>insideRoot(p,root));
  return source?movedPath(p,source,to):p;
}
