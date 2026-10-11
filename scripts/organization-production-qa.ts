/** Production smoke: keeps the existing browser/cache through deployment,
 * reads real file views, and revokes the temporary read-only key afterwards. */
import {chromium} from 'playwright';
import {createSession} from '../src/auth';
import {readFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const origin=process.env.AXON_PRODUCTION_QA_ORIGIN||'https://ports.binaryserver.com.ar',output=process.env.AXON_QA_OUTPUT||'/tmp/axon-organization-production';
await mkdir(output,{recursive:true});
const configPath=process.env.CONFIG_PATH||'data/config.json';
const username=await readFile(configPath,'utf8').then(v=>JSON.parse(v).auth.username).catch((e:any)=>{if(e.code!=='EACCES')throw e;return execFileSync('sudo',['-n','python3','-c','import json,sys; print(json.load(open(sys.argv[1]))["auth"]["username"])',configPath],{encoding:'utf8'}).trim();});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors:string[]=[],checks:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
await context.addCookies([{name:'axon_session',value:await createSession(username),url:origin,httpOnly:true,secure:origin.startsWith('https:'),sameSite:'Lax'}]);
let tokenId:string|undefined;
const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
async function api(path:string,method='GET',body?:unknown){const r=await context.request.fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body?{data:body}:{})});const data=await r.json();assert(r.ok(),path+' failed: '+r.status());return data;}
const request=async(token:string)=>{const r=await context.request.get(origin+'/api/v1/projects',{headers:{Authorization:'Bearer '+token}});return {status:r.status(),body:await r.json()};};
try{
 if(process.env.AXON_PRODUCTION_QA_OLD_IMAGE){const previous=process.env.AXON_PRODUCTION_QA_OLD_IMAGE,old=(file:string)=>execFileSync('docker',['run','--rm','--network','none','--entrypoint','cat',previous,'/app/public/'+file],{encoding:'utf8',maxBuffer:4*1024*1024});await page.route('**/integraciones',route=>route.fulfill({contentType:'text/html',body:old('index.html')}));const platform=old('platform.js');await page.route('**/platform.js?*',route=>route.fulfill({contentType:'application/javascript',body:platform}));}
 await page.goto(origin+'/integraciones');await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);await page.locator('#tab-access.active').waitFor();
 console.log('Authenticated browser loaded the current production shell and cached assets.');
 if(process.env.AXON_PRODUCTION_QA_MARKER||process.env.AXON_PRODUCTION_QA_OLD_IMAGE){if(process.env.AXON_PRODUCTION_QA_MARKER){const deadline=Date.now()+600000;while(!(await Bun.file(process.env.AXON_PRODUCTION_QA_MARKER).exists())){if(Date.now()>deadline)throw new Error('Deployment marker timed out');await new Promise(r=>setTimeout(r,1000));}}await page.unrouteAll();await page.reload();await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);checks.push('Existing browser/cache reload across deployment');}
 await page.locator('[data-new]').waitFor();
 const access=await api('/api/access/tokens');assert(access.defaults&&Array.isArray(access.tokens),'New access contract unavailable');
 if(access.projects.length){
  const created=await api('/api/access/tokens','POST',{name:'Verificación AXON (temporal)',description:'Prueba automática de esta actualización; revocada al finalizar.',days:1,grants:[{projectId:access.projects[0].id,scopes:['projects:read']}],policy:{...access.defaults,dailyRequests:5}});
  tokenId=created.identity.id;let secret=created.token;
  assert((await request(secret)).status===200,'Live key cannot query its permitted resource');
  let report=await api('/api/access/usage?'+new URLSearchParams({token:tokenId!,days:'1'}));assert(report.totals.requests===1&&report.totals.bytesOut>0,'Live consumption missing');
  const paused=await api('/api/access/tokens/'+tokenId,'PATCH',{revision:created.identity.revision,paused:true});assert((await request(secret)).status===401,'Paused live key accepted');
  const resumed=await api('/api/access/tokens/'+tokenId,'PATCH',{revision:paused.identity.revision,paused:false});const rotated=await api('/api/access/tokens/'+tokenId+'/rotate','POST',{revision:resumed.identity.revision});assert((await request(secret)).status===401,'Old live secret accepted after rotation');secret=rotated.token;
  assert((await request(secret)).status===200,'Rotated live key rejected');
  report=await api('/api/access/usage?'+new URLSearchParams({token:tokenId!,days:'1'}));assert(report.totals.requests===2,'Rotation lost consumption history');
  await api('/api/access/tokens/'+tokenId,'DELETE');assert((await request(secret)).status===401,'Revoked live key accepted');secret='';tokenId=undefined;
  checks.push('Live key creation, consumption/bytes, pause, renewal/history and revocation');
 }
 const catalog=await api('/api/file-catalog'),library=await api('/api/library');assert(Array.isArray(catalog.entries)&&library.metadataRevision!==undefined,'Shared catalog/library unavailable');checks.push('Authenticated real catalog and library contract');
 const go=(url:string)=>page.evaluate((url:string)=>(window as any).AxonNavigation.go(url),url);
 await page.locator('[data-refresh]').click();await page.locator('[data-usage] .access-metrics').waitFor();await page.screenshot({path:output+'/api-desktop.png',fullPage:true});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});await go('/integraciones');await page.locator('.access-metrics').waitFor();await page.waitForFunction(()=>document.querySelector('.sidebar')!.getBoundingClientRect().right<=0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'API overflow '+width);await page.screenshot({path:output+'/api-'+width+'.png',fullPage:true});}
 await page.setViewportSize({width:390,height:844});await go('/biblioteca?type=all');await page.locator('#lib-q').waitFor();await page.locator('#lib-q').fill('tipo:carpeta');await page.locator('#lib-catalog-kind').waitFor();await page.screenshot({path:output+'/library-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Library mobile overflow');
 await go('/archivos');await page.locator('#fm-organize-folder').waitFor();await page.locator('#fm-organize-folder').click();await page.locator('.catalog-dialog[open]').waitFor();assert(await page.locator('.catalog-dialog [name=tags]').count()===1,'Production organization editor unavailable');await page.locator('.catalog-dialog [data-close]').first().click();await page.screenshot({path:output+'/files-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Files mobile overflow');checks.push('Real views, folder editor and 1440/390/320 layouts');
 const connections=await api('/api/connections');const provider=connections.providers?.find((p:any)=>p.connected&&p.sources?.length);
 if(provider){const query=new URLSearchParams({location:provider.sources[0].id,path:''}),cloud=await api('/api/files/'+provider.id+'/list?'+query),organization=await api('/api/files/'+provider.id+'/organization?'+query);assert(Array.isArray(organization.entries)&&cloud.entries.every((e:any)=>!e.organization||Array.isArray(e.organization.tags)),'Real cloud annotations contract unavailable');checks.push('Real connected cloud listing with personal organization (read-only)');}
 assert(!errors.length,'Production browser errors: '+errors.join('; '));checks.push('No browser runtime errors');
 const result={ok:true,checks,errors,userFilesChanged:false,cloudFilesChanged:false};await Bun.write(output+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,output},null,2));
}finally{
 if(tokenId)try{await api('/api/access/tokens/'+tokenId,'DELETE');}catch{}
 try{await context.request.post(origin+'/api/logout',{headers:{Origin:origin,'Content-Type':'application/json'},data:{}});}catch{}
 await browser.close();
}
