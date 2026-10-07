import type { HttpFetch } from './http-fetch';
import {Database} from 'bun:sqlite';
import {constants,existsSync,lstatSync,mkdirSync} from 'node:fs';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {hostToContainer} from './host';
import bootstrap from './software-icon-catalog.json';
import seed from './software-icon-seed.json';
import {catalogAssetUrl,ICON_PROVIDERS,normalizeIconName,parseIconCatalog,type CatalogIcon,type IconProvider} from './software-icon-catalog';

export interface IconSubject {id?:string;packageName:string;name:string;manager?:string;kind?:string;applicationId?:string;iconFile?:string;iconName?:string;iconSource?:string;sourceName?:string;homepage?:string;projectName?:string;version?:string|null}
export interface IconInfo {kind:'logo'|'project'|'type';label:string;provider:string;catalogId?:string;sourceUrl?:string;attribution?:string;license?:string;licenseUrl?:string;version:string}
interface Choice {info:IconInfo;catalog?:CatalogIcon;file?:string;hostFile?:boolean;custom?:string;type?:string}
const digest=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
const safeSlug=(s:string)=>/^[a-z0-9][a-z0-9._-]{0,150}$/.test(s)&&!s.includes('..');
const VERSION=digest(JSON.stringify(bootstrap)+':content-mime-v2').slice(0,12);
const VENDORS:Record<string,string>={'@openai/codex':'openai','@anthropic-ai/claude-code':'claudecode','@google/gemini-cli':'googlegemini','@shopify/cli':'shopify','@playwright/cli':'playwright','@playwright/mcp':'playwright','@ai-sdk/anthropic':'anthropic','opencode-ai':'opencode','@opencode/cli':'opencode',nodejs:'nodedotjs','google-chrome-stable':'googlechrome',gh:'github',code:'vscode',mpcli:'mercadopago',uv:'uv',bunx:'bun'};
// Portable package-to-project relationships, independent of the installed list.
const PROJECTS:Record<string,string>={'docker.io':'docker','docker-compose-v2':'docker','code-server':'coder','nginx-light':'nginx','postgresql-client':'postgresql','fd-find':'fd','gpg':'gnuprivacyguard','gnupg':'gnuprivacyguard','cargo':'rust','rustup':'rust','cargo-fmt':'rust','python3':'python','isympy':'sympy','torchrun':'pytorch','torchfrtrace':'pytorch','uvx':'uv','snapd':'snapcraft','gnome-46-2404':'gnome','gtk-common-themes':'gtk','core22':'ubuntu','core24':'ubuntu','core26':'ubuntu','hermes':'hermes-agent','hermes-acp':'hermes-agent','hermes-agent':'hermes-agent','httpx':'httpx','pyppeteer-install':'puppeteer','yt-dlp':'yt-dlp','python3.11':'python','python3.14':'python','pymupdf':'pymupdf',bash:'gnubash',dash:'gnu',grep:'gnu',findutils:'gnu',diffutils:'gnu',gzip:'gnu',wget:'gnu',info:'gnu',glibc:'gnu',sqlite3:'sqlite',xfce4:'xfce',nautilus:'gnome',zenity:'gnome',gcr:'gnome','network-manager':'gnome','nm-connection-editor':'gnome','libwebkit2gtk-4.1-dev':'webkit',whisper:'openai',uvicorn:'fastapi',normalizer:'python'};
const GENERIC_DESKTOP=/^(?:preferences-|system-|application-|applications-|utilities-|folder|network-|audio-|bluetooth|dialog-|package-|text-|gtk-|computer|drive-)/;
const TYPE_PATHS:Record<string,string>={
 dependency:'<path d="m8 14 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V14M16 18v10M24 24l8-4 8 4-8 4-8-4Zm0 0v8l8 4 8-4v-8M32 28v8"/>',
 package:'<path d="m10 15 14-7 14 7-14 7-14-7Zm0 0v18l14 7 14-7V15M24 22v18M17 11l14 7"/>',
 runtime:'<rect x="12" y="12" width="24" height="24" rx="4"/><path d="M18 6v6M30 6v6M18 36v6M30 36v6M6 18h6M6 30h6M36 18h6M36 30h6"/><rect x="19" y="19" width="10" height="10" rx="2"/>',
 script:'<path d="M14 7h14l8 8v26H14V7Zm14 0v10h8M19 23l-3 4 3 4M29 23l3 4-3 4M25 22l-3 10"/>',
 tool:'<rect x="7" y="10" width="34" height="28" rx="4"/><path d="m14 18 6 6-6 6M25 30h9"/>',
 font:'<path d="m10 37 14-27 14 27M16 26h16M8 37h8M32 37h8"/>',
 driver:'<rect x="11" y="10" width="26" height="28" rx="4"/><path d="M17 17h14M17 23h14M17 31h2M27 31h4M7 16h4M7 32h4M37 16h4M37 32h4"/>',
 application:'<rect x="8" y="8" width="13" height="13" rx="3"/><rect x="27" y="8" width="13" height="13" rx="3"/><rect x="8" y="27" width="13" height="13" rx="3"/><rect x="27" y="27" width="13" height="13" rx="3"/>',
};
function iconType(row:IconSubject){if(/^fonts?-/.test(row.packageName))return'font';if(/^(?:linux-|nvidia-|libnvidia)/.test(row.packageName))return'driver';if(/\.(?:sh|py|js)(?:\.|$)|(?:-sync|-bridge|-backup|-restart)/.test(row.packageName))return'script';return TYPE_PATHS[row.kind||'']?row.kind!:(row.manager==='manual'?'tool':'package');}
export function typeIcon(row:IconSubject){const type=iconType(row);return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="9" fill="#eef3f2"/><g fill="none" stroke="#326558" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TYPE_PATHS[type]}</g></svg>`;}
export function validateIcon(bytes:Uint8Array,format:string){
 if(bytes.length>1024*1024||!bytes.length)throw Error('Icon exceeds size limit');
 if(format==='png'){
  const b=Buffer.from(bytes);if(b.length<33||!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||b.toString('ascii',12,16)!=='IHDR'||b.readUInt32BE(16)>4096||b.readUInt32BE(20)>4096||b.readUInt32BE(16)===0||b.readUInt32BE(20)===0)throw Error('Invalid PNG');return;
 }
 if(format!=='svg')throw Error('Unsupported image');
 const svg=Buffer.from(bytes).toString('utf8');
 if(!/<svg\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(svg)||!/<\/svg\s*>/i.test(svg)||/<(?:[\w-]+:)?(?:script|foreignObject|iframe|image|audio|video|animate|set)\b|<!DOCTYPE|<!ENTITY|\bon\w+\s*=|javascript\s*:|@import/i.test(svg))throw Error('Unsafe SVG');
 for(const match of svg.matchAll(/(?:\b(?:href|src)|xlink:href)\s*=\s*["']([^"']*)["']/gi))if(!/^#[a-zA-Z0-9_.:-]+$/.test(match[1]))throw Error('External SVG reference');
 for(const match of svg.matchAll(/url\s*\(\s*["']?([^\s"')]+)["']?\s*\)/gi))if(!/^#[a-zA-Z0-9_.:-]+$/.test(match[1]))throw Error('External SVG style');
}
function nativeMime(bytes:Uint8Array){const b=Buffer.from(bytes);if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'image/png';if(b[0]===255&&b[1]===216&&b[2]===255)return'image/jpeg';if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return'image/webp';if(/<svg\b/i.test(b.toString('utf8')))return'image/svg+xml';return undefined;}
function contrastSvg(bytes:Uint8Array,color?:string){
 let svg=Buffer.from(bytes).toString('utf8').replace(/^\s*<\?xml[^>]*>\s*/,'');
 if(color&&/^[a-f0-9]{6}$/i.test(color))svg=svg.replace(/<svg\b/,'<svg fill="#'+color+'"');
 const fills=[...svg.matchAll(/\bfill=["']#([a-f0-9]{6}|[a-f0-9]{3})["']/gi)].map(m=>m[1]);const primary=color||fills[0]||'000000';
 const hex=primary.length===3?primary.split('').map(c=>c+c).join(''):primary;
 const brightness=/^[a-f0-9]{6}$/i.test(hex)?[0,2,4].reduce((sum,n,i)=>sum+parseInt(hex.slice(n,n+2),16)*[.2126,.7152,.0722][i],0):0;
 const background=brightness>160?'#26333b':'#f7faf9';
 const inset=svg.replace(/<svg\b([^>]*)>/,(_,attrs:string)=>'<svg x="6" y="6" width="36" height="36"'+attrs.replace(/\s(?:width|height|x|y)=["'][^"']*["']/g,'')+'>');
 return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="9" fill="${background}"/>${inset}</svg>`);
}
export class SoftwareIcons {
 private db?:Database;private catalog:CatalogIcon[]=[];private byId=new Map<string,CatalogIcon>();private byName=new Map<string,CatalogIcon[]>();private nativeBrands=new Map<string,IconSubject>();private flights=new Map<string,Promise<{bytes:Uint8Array;mime:string}>>();private refreshFlight?:Promise<void>;private checked=0;private storageError='';private active=0;private waiters:(()=>void)[]=[];
 constructor(private directory=path.join(path.dirname(process.env.CONFIG_PATH||'/app/data/config.json'),'software-icons'),private fetcher:HttpFetch=fetch,private bundled:Record<string,any>=seed.assets){}
 private init(){
  if(this.db)return;
  try{mkdirSync(this.directory,{recursive:true,mode:0o700});if(lstatSync(this.directory).isSymbolicLink()||!lstatSync(this.directory).isDirectory())throw Error('Invalid cache directory');const file=path.join(this.directory,'icons.sqlite');if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('Invalid database path');this.db=new Database(file,{create:true});}
  catch(e:any){this.storageError='No se pudo conservar la base de iconos: '+e.message;this.db=new Database(':memory:');}
  this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS catalog(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assets(key TEXT PRIMARY KEY,bytes BLOB NOT NULL,mime TEXT NOT NULL,hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS choices(installation TEXT PRIMARY KEY,icon TEXT NOT NULL); CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
  if(!(this.db.query('SELECT count(*) AS n FROM catalog').get() as any).n)this.db.transaction(()=>{const insert=this.db!.prepare('INSERT OR REPLACE INTO catalog VALUES (?,?)');for(const icon of bootstrap.icons)insert.run(icon.id,JSON.stringify(icon));})();
  this.reload();this.checked=Number((this.db.query('SELECT value FROM state WHERE key=?').get('checked') as any)?.value)||Date.parse(bootstrap.updatedAt)||0;
 }
 private reload(){this.catalog=(this.db!.query('SELECT json FROM catalog').all() as any[]).map(r=>JSON.parse(r.json));this.byId=new Map(this.catalog.map(i=>[i.id,i]));this.byName.clear();for(const icon of this.catalog){for(const name of new Set([icon.slug,icon.name].map(normalizeIconName))){const list=this.byName.get(name)||[];list.push(icon);this.byName.set(name,list);}}}
 private exact(names:string[]){for(const name of names){const entries=this.byName.get(normalizeIconName(name));if(entries?.length){return [...entries].sort((a,b)=>['selfhst','dashboard','simpleicons'].indexOf(a.provider)-['selfhst','dashboard','simpleicons'].indexOf(b.provider))[0];}}return undefined;}
 learnNative(rows:IconSubject[]){this.nativeBrands.clear();for(const row of rows)if(row.iconFile&&!GENERIC_DESKTOP.test(row.iconName||'')){for(const name of [row.name,row.packageName.replace(/\.desktop$/,''),row.sourceName].filter(Boolean) as string[])this.nativeBrands.set(normalizeIconName(name),row);}}
 choose(row:IconSubject):Choice{
  this.init();
  const selected=row.id?(this.db!.query('SELECT icon FROM choices WHERE installation=?').get(row.id) as any)?.icon:null;
  if(selected){const catalog=this.byId.get(selected);if(catalog)return this.catalogChoice(catalog,'logo','Elegido: '+catalog.name);if(/^custom:[a-f0-9]{64}$/.test(selected)&&(this.db!.query('SELECT key FROM assets WHERE key=?').get(selected)))return{info:{kind:'logo',label:'Icono subido por el administrador',provider:'AXON',version:selected.slice(-12)},custom:selected};}
  const pkg=row.packageName.replace(/:[a-z0-9]+$/,'').replace(/\.desktop$/,'');
  const vendor=VENDORS[pkg]||pkg.toLowerCase();const file=safeSlug(vendor)?path.resolve('public/icons',vendor+'.svg'):undefined;
  if(row.iconFile&&!GENERIC_DESKTOP.test(row.iconName||''))return{info:{kind:'logo',label:'Icono instalado de '+row.name,provider:row.iconSource||'desktop',version:digest(row.iconFile+row.version+VERSION).slice(0,12)},file:row.iconFile,hostFile:true};
  if(file&&existsSync(file))return{info:{kind:'logo',label:'Logo de '+row.name,provider:'AXON',version:digest(vendor+VERSION).slice(0,12)},file};
  const scope=pkg.startsWith('@')?pkg.slice(1).split('/')[0]:'';
  const related=[row.name,pkg,row.sourceName,scope].filter(Boolean).map(n=>this.nativeBrands.get(normalizeIconName(n!))).find(Boolean);
  if(related?.iconFile)return{info:{kind:'project',label:'Icono del proyecto '+related.name,provider:related.iconSource||'desktop',version:digest(related.iconFile+related.version+VERSION).slice(0,12)},file:related.iconFile,hostFile:true};
  if(/^axon(?:-|$)/.test(pkg))return{info:{kind:'project',label:'Icono del proyecto AXON',provider:'AXON',version:VERSION},file:path.resolve('public/marca/Isotipo.svg')};
  const appid=(row.applicationId||'').split('.').slice(-1)[0];
  const identified=row.manager!=='manual'||!!(row.homepage||row.sourceName||row.applicationId||PROJECTS[pkg]);
  const direct=identified?this.exact([PROJECTS[pkg]||pkg,row.name,...(!pkg.startsWith('@')?[appid]:[])]):undefined;
  if(direct){const kind=PROJECTS[pkg]||['dependency','runtime'].includes(row.kind||'')?'project':'logo';return this.catalogChoice(direct,kind,(kind==='logo'?'Logo de ':'Icono del proyecto ')+direct.name);}
  let project=PROJECTS[pkg];
  if(!project&&/^python(?:3)?(?:\.\d+)?(?:-|$)/.test(pkg))project='python';
  if(!project&&/^(?:gnome-|libgnome|gir1.2-gnome)/.test(pkg))project='gnome';
  if(!project&&/^(?:libgtk|gir1.2-gtk|gtk-)/.test(pkg))project='gtk';
  if(!project&&/^(?:nvidia-|libnvidia|linux-modules-nvidia)/.test(pkg))project='nvidia';
  if(!project&&/^(?:llvm|clang|lld)(?:-|\d|$)/.test(pkg))project='llvm';
  if(!project&&/^(?:libssl|openssl)/.test(pkg))project='openssl';
  if(!project&&/^(?:libqt|qt[56]-)/.test(pkg))project='qt';
  if(!project&&/^(?:xfce4-|libxfce)/.test(pkg))project='xfce';
  if(!project&&/^(?:ubuntu-|linux-)/.test(pkg))project=pkg.startsWith('linux-')?'linux':'ubuntu';
  if(!project&&/^(?:opencode-|codex-|claude-)/.test(pkg))project=pkg.split('-')[0]==='codex'?'openai':pkg.split('-')[0]==='claude'?'claudecode':'opencode';
  const parent=this.exact([project||'',row.sourceName||'',row.projectName||'',scope]);
  if(parent)return this.catalogChoice(parent,'project','Icono del proyecto '+parent.name);
  if(project&&safeSlug(project)&&existsSync(path.resolve('public/icons',project+'.svg')))return{info:{kind:'project',label:'Icono del proyecto '+project,provider:'AXON',version:VERSION},file:path.resolve('public/icons',project+'.svg')};
  if(row.iconFile)return{info:{kind:'type',label:'Icono del escritorio',provider:row.iconSource||'desktop',version:digest(row.iconFile+row.version+VERSION).slice(0,12)},file:row.iconFile,hostFile:true};
  const type=iconType(row);return{info:{kind:'type',label:({dependency:'Dependencia',package:'Paquete',runtime:'Runtime',script:'Script local',tool:'Herramienta de terminal',font:'Tipografía',driver:'Controlador',application:'Aplicación'} as any)[type],provider:'AXON',version:VERSION},type};
 }
 private catalogChoice(catalog:CatalogIcon,kind:IconInfo['kind'],label:string):Choice{return{catalog,info:{kind,label,provider:catalog.provider,catalogId:catalog.id,sourceUrl:catalog.sourceUrl,attribution:catalog.provider==='selfhst'?'Icons by selfh.st/icons (CC BY 4.0)':catalog.provider==='dashboard'?'Dashboard Icons by Homarr Labs':'Simple Icons',license:catalog.license,licenseUrl:catalog.licenseUrl,version:digest(catalog.id+catalog.revision).slice(0,12)}};}
 describe(row:IconSubject){return this.choose(row).info;}
 search(query:string){this.init();const q=normalizeIconName(query).slice(0,80);return this.catalog.filter(i=>[i.name,i.slug,...i.aliases].some(n=>normalizeIconName(n).includes(q))).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,48).map(i=>({id:i.id,name:i.name,provider:i.provider,attribution:this.catalogChoice(i,'logo','').info.attribution,license:i.license,sourceUrl:i.sourceUrl,preview:'/api/software/icon-catalog/'+encodeURIComponent(i.id)+'?v='+i.revision.slice(0,12)}));}
 setChoice(row:IconSubject,id:string|null){this.init();if(!row.id)throw Error('Unknown installation');if(id!==null&&!this.byId.has(id))throw Error('Unknown catalog icon');if(id===null)this.db!.query('DELETE FROM choices WHERE installation=?').run(row.id);else this.db!.query('INSERT OR REPLACE INTO choices VALUES (?,?)').run(row.id,id);return this.describe(row);}
 upload(row:IconSubject,bytes:Uint8Array,format:string){this.init();if(!row.id)throw Error('Unknown installation');validateIcon(bytes,format);const key='custom:'+digest(bytes);this.db!.transaction(()=>{this.db!.query("DELETE FROM assets WHERE key LIKE 'custom:%' AND key NOT IN (SELECT icon FROM choices)").run();const total=(this.db!.query("SELECT COALESCE(SUM(length(bytes)),0) AS n FROM assets WHERE key LIKE 'custom:%' AND key!=?").get(key) as any).n;if(total+bytes.length>32*1024*1024)throw Error('El límite de iconos propios es 32 MB');this.store(key,bytes,format==='svg'?'image/svg+xml':'image/png');this.db!.query('INSERT OR REPLACE INTO choices VALUES (?,?)').run(row.id,key);})();return this.describe(row);}
 private async limited<T>(work:()=>Promise<T>){if(this.active>=4)await new Promise<void>(resolve=>this.waiters.push(resolve));else this.active++;try{return await work();}finally{const next=this.waiters.shift();if(next)next();else this.active--;}}
 private async download(url:string,limit:number){return this.limited(async()=>{const u=new URL(url);if(u.protocol!=='https:'||!['raw.githubusercontent.com','api.github.com'].includes(u.hostname)||u.username||u.password)throw Error('Invalid icon source');const response=await this.fetcher(url,{redirect:'error',headers:{'User-Agent':'AXON-software-icons'},signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Icon source HTTP '+response.status);const reader=response.body?.getReader();if(!reader)throw Error('Empty icon');const parts=[];let n=0;for(;;){const part=await reader.read();if(part.done)break;n+=part.value.length;if(n>limit){await reader.cancel();throw Error('Icon source too large');}parts.push(part.value);}return Buffer.concat(parts);});}
 async asset(id:string):Promise<{bytes:Uint8Array;mime:string}>{
  this.init();const icon=this.byId.get(id);if(!icon)throw Error('Unknown catalog icon');
  const key=id+':'+icon.revision;const saved=this.db!.query('SELECT bytes,mime,hash FROM assets WHERE key=?').get(key) as any;
  if(saved&&digest(saved.bytes)===saved.hash)return{bytes:saved.bytes,mime:saved.mime};
  const bundled=this.bundled[key];
  if(bundled){const bytes=Buffer.from(bundled.base64,'base64');if(digest(bytes)===bundled.hash){validateIcon(bytes,bundled.mime==='image/png'?'png':'svg');this.store(key,bytes,bundled.mime);return{bytes,mime:bundled.mime};}}
  if(!this.flights.has(key)){const flight=(async()=>{
   let error:Error|undefined;
   for(const format of icon.formats)try{const bytes=await this.download(catalogAssetUrl(icon,format),1024*1024);validateIcon(bytes,format);const mime=format==='svg'?'image/svg+xml':'image/png';this.store(key,bytes,mime);return{bytes,mime};}catch(e){error=e as Error;}
   throw error||Error('Icon unavailable');
  })().finally(()=>this.flights.delete(key));this.flights.set(key,flight);}
  return this.flights.get(key)!;
 }
 private store(key:string,bytes:Uint8Array,mime:string){this.db!.query('INSERT OR REPLACE INTO assets VALUES (?,?,?,?)').run(key,bytes,mime,digest(bytes));let total=(this.db!.query('SELECT SUM(length(bytes)) AS n FROM assets').get() as any).n;while(total>128*1024*1024){const old=this.db!.query('SELECT key,length(bytes) AS size FROM assets WHERE key NOT LIKE ? ORDER BY rowid LIMIT 1').get('custom:%') as any;if(!old)break;this.db!.query('DELETE FROM assets WHERE key=?').run(old.key);total-=old.size;}}
 async refresh(){
  this.init();if(this.refreshFlight)return this.refreshFlight;
  this.refreshFlight=(async()=>{
   const updated:CatalogIcon[]=[];
   for(const [provider,cfg] of Object.entries(ICON_PROVIDERS)){
    const commit=JSON.parse((await this.download(`https://api.github.com/repos/${cfg.repo}/commits/${cfg.branch}`,1024*1024)).toString());
    if(!/^[a-f0-9]{40}$/.test(commit.sha))throw Error('Invalid catalog revision');
    const data=JSON.parse((await this.download(`https://raw.githubusercontent.com/${cfg.repo}/${commit.sha}/${cfg.index}`,8*1024*1024)).toString());const icons=parseIconCatalog(provider as IconProvider,commit.sha,data);
    updated.push(...icons);
   }
   this.db!.transaction(()=>{this.db!.exec('DELETE FROM catalog');const insert=this.db!.prepare('INSERT INTO catalog VALUES (?,?)');for(const icon of updated)insert.run(icon.id,JSON.stringify(icon));})();
   this.reload();this.checked=Date.now();this.db!.query('INSERT OR REPLACE INTO state VALUES (?,?)').run('checked',String(this.checked));
  })().finally(()=>this.refreshFlight=undefined);return this.refreshFlight;
 }
 autoRefresh(){this.init();if(Date.now()-this.checked>86400000)this.refresh().catch(()=>{this.checked=Date.now();});}
 async warm(rows:IconSubject[]){this.init();this.learnNative(rows);const ids=[...new Set(rows.map(r=>this.choose(r).catalog?.id).filter(Boolean))] as string[];let done=0;const failed:string[]=[];await Promise.all(ids.map(async id=>{try{await this.asset(id);done++;}catch{failed.push(id);}}));return{cached:done,failed};}
 status(rows:IconSubject[]=[]){this.init();const byKind={logo:0,project:0,type:0};for(const row of rows)byKind[this.describe(row).kind]++;return{catalog:this.catalog.length,assets:(this.db!.query('SELECT count(*) AS n FROM assets').get() as any).n,checkedAt:this.checked,refreshing:!!this.refreshFlight,storageError:this.storageError||undefined,byKind};}
 close(){this.db?.close();this.db=undefined;}
 async response(row:IconSubject,nativeFile?:string){
  const choice=this.choose(row);let bytes:Uint8Array|undefined,mime='image/svg+xml';
  if(choice.custom){const asset=this.db!.query('SELECT bytes,mime FROM assets WHERE key=?').get(choice.custom) as any;if(asset){bytes=asset.bytes;mime=asset.mime;}}
  const file=choice.file?(choice.file===row.iconFile&&nativeFile?nativeFile:choice.hostFile?hostToContainer(choice.file):choice.file):undefined;
  if(file)try{const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await handle.stat();if(!info.isFile()||info.size>1024*1024)throw Error('Invalid native icon');bytes=await handle.readFile();const detected=nativeMime(bytes);if(detected)mime=detected;else bytes=undefined;}finally{await handle.close();}}catch{}
  if(!bytes&&choice.catalog)try{({bytes,mime}=await this.asset(choice.catalog.id));}catch{}
  if(bytes&&mime==='image/svg+xml')bytes=contrastSvg(bytes,choice.catalog?.color);
  const actualKind=bytes?choice.info.kind:'type';
  if(!bytes){bytes=Buffer.from(typeIcon(row));mime='image/svg+xml';}
  return new Response(new Uint8Array(bytes),{headers:{'Content-Type':mime,'Cache-Control':actualKind==='type'&&choice.catalog?'private, max-age=60':'private, max-age=3600','ETag':'"'+digest(bytes).slice(0,24)+'"','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox",'X-Content-Type-Options':'nosniff','X-Axon-Icon-Kind':actualKind}});
 }
 async catalogResponse(id:string){this.init();const icon=this.byId.get(id);if(!icon)throw Error('Unknown catalog icon');const value=await this.asset(id);const bytes=value.mime==='image/svg+xml'?contrastSvg(value.bytes,icon.color):value.bytes;return new Response(new Uint8Array(bytes),{headers:{'Content-Type':value.mime,'Cache-Control':'private, max-age=86400','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox",'X-Content-Type-Options':'nosniff'}});}
 exportAssets(){this.init();return Object.fromEntries((this.db!.query('SELECT key,bytes,mime,hash FROM assets').all() as any[]).map(a=>[a.key,{base64:Buffer.from(a.bytes).toString('base64'),mime:a.mime,hash:a.hash}]));}
}
export const softwareIcons=new SoftwareIcons();
