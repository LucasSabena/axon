import {hash} from './storage/policy';
import {insideRoot} from './library-paths';
import {movedReference,type TransferReview,type TransferImpact} from './library-transfer-review';
export interface ConfiguredPathReference {title:string;path:string;detail:string;tree?:boolean}
export function includeConfiguredReferences(review:TransferReview,from:string,to:string,references:ConfiguredPathReference[]):TransferReview {
  const aliases=review.sourceAliases||[from], warnings:TransferImpact[]=[],seen=new Set<string>();
  for(const ref of references){
    const relocated=movedReference(ref.path,aliases,to);
    const leavesTree=ref.tree&&aliases.some(alias=>insideRoot(alias,ref.path))&&!insideRoot(to,ref.path);
    if(relocated===ref.path&&!leavesTree)continue;
    const key=ref.title+'\0'+ref.path;if(seen.has(key))continue;seen.add(key);
    warnings.push({kind:'configuration',title:ref.title,detail:ref.detail,paths:[{from:ref.path,to:relocated!==ref.path?relocated:ref.path}]});
  }
  warnings.sort((a,b)=>a.title.localeCompare(b.title)||a.paths[0].from.localeCompare(b.paths[0].from));
  return {...review,impacts:[...warnings,...review.impacts],needsConfirmation:review.needsConfirmation||warnings.length>0,revision:hash({library:review.revision,warnings})};
}
