import {chromium} from 'playwright';
import {createSession} from '../src/auth';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const origin=process.env.AXON_PRODUCTION_QA_ORIGIN||'https://ports.binaryserver.com.ar',output=process.env.AXON_QA_OUTPUT||'/tmp/axon-programs-files-production';
await mkdir(output,{recursive:true});
const configPath=process.env.CONFIG_PATH||'data/config.json';
const username=await readFile(configPath,'utf8').then(v=>JSON.parse(v).auth.username).catch((e:any)=>{if(e.code!=='EACCES')throw e;return execFileSync('sudo',['-n','python3','-c','import json,sys; print(json.load(open(sys.argv[1]))["auth"]["username"])',configPath],{encoding:'utf8'}).trim();});
const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors:string[]=[],checks:any[]=[];
page.on('pageerror',e=>errors.push(e.message));
await context.addCookies([{name:'axon_session',value:await createSession(username),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
const assert=(v:unknown,m:string)=>{if(!v)throw Error(m);};
const api=async(path:string)=>{const started=performance.now(),r=await context.request.get(origin+path,{timeout:120000});assert(r.ok(),'Failed '+path+': '+r.status());return{body:await r.json(),milliseconds:performance.now()-started};};
const go=(url:string)=>page.evaluate(url=>(window as any).AxonNavigation.go(url),url);
try{
 await page.goto(origin+'/archivos');await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);await page.locator('#fm-organize-folder').waitFor();await page.screenshot({path:output+'/before-mobile.png'});
 await writeFile(output+'/browser-ready','ready');console.log('Existing production browser/cache ready.');
 const marker=process.env.AXON_PRODUCTION_QA_MARKER;
 if(marker){const deadline=Date.now()+600000;while(!(await Bun.file(marker).exists())){if(Date.now()>deadline)throw Error('Deployment wait expired');await new Promise(r=>setTimeout(r,500));}await page.reload();await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);checks.push('Existing browser/cache reload after deployment');}
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:844});await go('/archivos');await page.locator('.fm-footer').waitFor();
  const metrics=await page.evaluate(()=>{const b=(s:string)=>document.querySelector(s)!.getBoundingClientRect();return{width:innerWidth,top:b('.fm-top').height,main:b('.fm-main').height,footer:b('.fm-footer').height,overflow:document.documentElement.scrollWidth>innerWidth};});assert(!metrics.overflow,'Files overflow '+width);assert(metrics.footer<=36,'Footer expanded '+width);if(width<=768)assert(metrics.main>844*.5,'Insufficient file area '+width);checks.push(metrics);
  await page.locator('#fm-organize-folder').click();const box=await page.locator('.catalog-dialog[open]').boundingBox();assert(box&&Math.abs(box.x+box.width/2-width/2)<2&&Math.abs(box.y+box.height/2-422)<2,'Tag dialog not centered '+width);await page.screenshot({path:output+'/tags-'+width+'.png'});await page.keyboard.press('Escape');await page.locator('.catalog-dialog').waitFor({state:'detached'});
  await page.locator('#fm-transfers-btn').click();await page.locator('.fm-transfer-dialog[open]').waitFor();await page.screenshot({path:output+'/transfers-'+width+'.png'});await page.keyboard.press('Escape');await page.locator('.fm-transfer-dialog').waitFor({state:'detached'});
  await page.screenshot({path:output+'/files-'+width+'.png'});
 }
 const catalog=(await api('/api/file-catalog')).body;
 const colored=catalog.entries.find((r:any)=>r.available&&r.kind==='dir'&&r.metadata.color);
 if(colored){const slash=colored.path.lastIndexOf('/'),parent=colored.path.slice(0,slash)||'/',name=colored.path.slice(slash+1);for(const [view,selector] of [['list','.fm-row'],['grid','.fm-card'],['cols','.fm-col-row']]){await go('/archivos?'+new URLSearchParams({path:parent,view}));const row=page.locator(selector+'[data-name='+JSON.stringify(name)+']');await row.waitFor();assert(await row.getAttribute('data-file-color')===colored.metadata.color,'Live folder lost color '+view);}checks.push('Existing live folder retains color in all views');}
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>{(window as any).__qaTasks=[];new PerformanceObserver(list=>{(window as any).__qaTasks.push(...list.getEntries().map(e=>e.duration));}).observe({entryTypes:['longtask']});});
 const started=performance.now();await go('/programas?view=installed');await page.locator('.software-row').first().waitFor({timeout:15000});const firstRowsMs=performance.now()-started;
 const first=await api('/api/software');assert(first.milliseconds<2500,'Software API blocked on host discovery');
 let current=first.body;const samples=[{milliseconds:first.milliseconds,count:current.installations.length,checking:current.checking}];const deadline=Date.now()+120000;
 while(current.checking){if(Date.now()>deadline)throw Error('Update check did not complete');await new Promise(r=>setTimeout(r,1000));const value=await api('/api/software');current=value.body;samples.push({milliseconds:value.milliseconds,count:current.installations.length,checking:current.checking});}
 assert(current.installations.length>1000,'Host inventory incomplete');assert(!current.error,'Inventory failed');assert(current.sources.every((s:any)=>!s.available||!s.error),'A live source failed');
 const globals=current.installations.filter((p:any)=>['pnpm','bun'].includes(p.manager)&&p.canUpdate);assert(globals.length>0,'Global updates missing');
 const wrangler=current.installations.find((p:any)=>p.packageName==='wrangler');assert(wrangler&&wrangler.reason.includes('Acceso roto'),'Dangling Wrangler access hidden');
 await page.locator('#software-query').fill('wrangler');await page.locator('[data-detail='+JSON.stringify(wrangler.id)+']').waitFor();await page.locator('[data-detail='+JSON.stringify(wrangler.id)+']').click();await page.locator('.software-dialog[open]').waitFor();assert((await page.locator('.software-dialog').innerText()).includes('Acceso roto'),'Wrangler diagnosis missing from UI');await page.screenshot({path:output+'/wrangler.png'});await page.keyboard.press('Escape');await page.locator('.software-dialog').waitFor({state:'detached'});
 const tasks=await page.evaluate(()=>(window as any).__qaTasks);await page.locator('#software-query').fill('wrangler');await page.reload();await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);assert(await page.locator('#software-query').inputValue()==='wrangler','Search lost on immediate reload');checks.push('Search survives immediate reload');await page.locator('#software-query').fill('');await page.locator('[data-mode=updates]').click();await page.locator('[data-update]').first().waitFor();await page.screenshot({path:output+'/updates.png'});
 assert(!tasks.some((n:number)=>n>800),'Programs froze browser');checks.push({firstRowsMs,apiSamples:samples,count:current.installations.length,updates:globals.map((p:any)=>({package:p.packageName,version:p.version,target:p.targetVersion})),longTasks:tasks,wrangler:'dangling executable visible'});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Programs overflow '+width);await page.screenshot({path:output+'/programs-'+width+'.png'});}
 assert(!errors.length,'Browser errors: '+errors.join('; '));await writeFile(output+'/result.json',JSON.stringify({ok:true,origin,checks,errors,hostPackageMutations:0},null,2));console.log(JSON.stringify({ok:true,origin,checks,errors,output}));
}catch(e){await page.screenshot({path:output+'/failure.png'});throw e;}finally{try{await context.request.post(origin+'/api/logout',{headers:{Origin:origin},data:{}});}catch{}await browser.close();}
