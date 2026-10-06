export type IconProvider='selfhst'|'dashboard'|'simpleicons';
export interface CatalogIcon {id:string;provider:IconProvider;slug:string;name:string;aliases:string[];formats:string[];revision:string;color?:string;sourceUrl:string;license:string;licenseUrl:string}
export const ICON_PROVIDERS={
 selfhst:{repo:'selfhst/icons',branch:'main',index:'index.json',license:'CC BY 4.0',licenseUrl:'https://github.com/selfhst/icons/blob/main/LICENSE'},
 dashboard:{repo:'homarr-labs/dashboard-icons',branch:'main',index:'metadata.json',license:'Apache-2.0',licenseUrl:'https://github.com/homarr-labs/dashboard-icons/blob/main/LICENSE'},
 simpleicons:{repo:'simple-icons/simple-icons',branch:'develop',index:'data/simple-icons.json',license:'CC0-1.0',licenseUrl:'https://github.com/simple-icons/simple-icons/blob/develop/LICENSE'},
} as const;
export const normalizeIconName=(s:string)=>s.toLowerCase().replace(/\+/g,'plus').replace(/#/g,'sharp').replace(/&/g,'and').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
export function parseIconCatalog(provider:IconProvider,revision:string,data:any):CatalogIcon[]{
 if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Invalid catalog revision');
 const cfg=ICON_PROVIDERS[provider],items:CatalogIcon[]=[];
 const add=(slug:string,name:string,aliases:string[],formats:string[],sourceUrl?:string,color?:string,license?:string,licenseUrl?:string)=>{
  if(!/^[a-z0-9][a-z0-9._-]{0,150}$/.test(slug)||slug.includes('..')||typeof name!=='string'||name.length>180)return;
  items.push({id:provider+':'+slug,provider,slug,name,aliases:(Array.isArray(aliases)?aliases:[]).filter(a=>typeof a==='string'&&a.length<180),formats,revision,color,sourceUrl:sourceUrl?.startsWith('https://')?sourceUrl:'https://github.com/'+cfg.repo,license:license||cfg.license,licenseUrl:licenseUrl?.startsWith('https://')?licenseUrl:license&&license!=='custom'?'https://spdx.org/licenses/'+encodeURIComponent(license)+'.html':cfg.licenseUrl});
 };
 if(provider==='selfhst'&&Array.isArray(data))for(const v of data)add(v.Reference,v.Name,[],v.SVG==='Yes'?['svg','png']:['png']);
 else if(provider==='dashboard'&&data&&typeof data==='object'&&!Array.isArray(data))for(const [slug,v] of Object.entries(data) as [string,any][])add(slug,slug.replace(/-/g,' '),v.aliases||[],v.base==='svg'?['svg','png']:['png']);
 else if(provider==='simpleicons'&&Array.isArray(data)){
  const replacements:Record<string,string>={'+':'plus','.':'dot','&':'and','đ':'d','ħ':'h','ı':'i','ĸ':'k','ŀ':'l','ł':'l','ß':'ss','ŧ':'t','ø':'o'};
  for(const v of data){const slug=v.slug||v.title?.toLowerCase().replace(/[+.&đħıĸŀłßŧø]/g,(c:string)=>replacements[c]).normalize('NFD').replace(/[^a-z0-9]/g,'');if(slug)add(slug,v.title,v.aliases?.aka||[],['svg'],v.source,v.hex,v.license?.type,v.license?.url);}
 }else throw Error('Invalid icon catalog format');
 if(items.length<100||items.length>15000)throw Error('Incomplete or oversized icon catalog');return items;
}
export function catalogAssetUrl(icon:CatalogIcon,format:string){
 if(!icon.formats.includes(format)||!['svg','png'].includes(format))throw Error('Invalid icon format');
 return `https://raw.githubusercontent.com/${ICON_PROVIDERS[icon.provider].repo}/${icon.revision}/${icon.provider==='simpleicons'?'icons':format}/${icon.slug}.${format}`;
}
