import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const origin=process.env.AXON_QA_ORIGIN||'http://127.0.0.1:3459',root=process.env.AXON_QA_FIXTURE_ROOT;
if(!root||!(await readFile(root+'/.axon-qa-owned','utf8')).includes('isolated-qa'))throw Error('Owned QA fixture required');
const output=process.env.AXON_QA_OUTPUT||'/tmp/axon-programs-files-qa';await mkdir(output,{recursive:true});
await mkdir(root+'/media/Carpeta QA',{recursive:true});await writeFile(root+'/media/nota.txt','Fixture que se conserva.');
const browser=await chromium.launch({headless:true,channel:"chrome"}),context=await browser.newContext(),page=await context.newPage(),errors:string[]=[],checks:any[]=[];
await context.addInitScript(()=>{try{localStorage.setItem('fm-drawer','1');}catch{}});
page.on('pageerror',e=>errors.push(e.message));
const assert=(v:unknown,m:string)=>{if(!v)throw Error(m);};
const go=(url:string)=>page.evaluate(url=>(window as any).AxonNavigation.go(url),url);
try{
 await context.request.post(origin+'/api/login',{headers:{Origin:origin},data:{username:'qa',password:'axon-local-qa'}});
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/archivos?'+new URLSearchParams({path:root+'/media',view:'list'}));await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);await page.locator('.fm-row[data-name="Carpeta QA"]').waitFor();
 await page.locator('.fm-row[data-name="Carpeta QA"] [data-act=organize]').click();
 const dialog=page.locator('.catalog-dialog[open]');await dialog.waitFor();
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:844});const box=await dialog.boundingBox();assert(box&&Math.abs(box.x+box.width/2-width/2)<2,'Tag dialog not horizontally centered '+width);assert(box&&Math.abs(box.y+box.height/2-422)<2,'Tag dialog not vertically centered '+width);
 }
 await dialog.locator('[name=color][value=purple]').check();await dialog.locator('[name=tags]').fill('Trabajo, Pendiente');await dialog.locator('[name=favorite]').check();await dialog.locator('[name=pinned]').check();await dialog.locator('[type=submit]').click();await dialog.waitFor({state:'detached'});
 for(const [view,selector] of [['list','.fm-row'],['grid','.fm-card'],['cols','.fm-col-row']]){
  await go('/archivos?'+new URLSearchParams({path:root+'/media',view}));const row=page.locator(selector+'[data-name="Carpeta QA"]');await row.waitFor();assert(await row.getAttribute('data-file-color')==='purple','Missing color '+view);assert((await row.innerText()).includes('trabajo'),'Missing tags '+view);
  const color=await row.locator('svg').first().evaluate(el=>getComputedStyle(el).color);assert(color==='rgb(174, 134, 223)','Unpainted folder '+view+': '+color);
 }
 await page.reload();await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);assert(await page.locator('.fm-col-row[data-name="Carpeta QA"]').getAttribute('data-file-color')==='purple','Organization lost on reload');
 await go('/archivos?'+new URLSearchParams({path:root+'/media',view:'list'}));await page.locator('#fm-mark').selectOption('favorite');await page.locator('.fm-search-hit[data-name="Carpeta QA"][data-file-color=purple]').waitFor();assert(await page.locator('.fm-search-hit .icon-cell svg').count()>0,'Marked search icons not rendered');
 await page.route('**/api/files/transfers',route=>route.fulfill({json:{ok:true,operations:Array.from({length:25},(_,i)=>({id:'fixture-'+i,state:'verified',mode:'copy',from:root+'/media/nota.txt',to:root+'/media/copia-'+i,message:'Verificado'}))}}));
 await page.reload();await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);await page.locator('#fm-transfers-count').filter({hasText:'25'}).waitFor();
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:844});await go('/archivos?'+new URLSearchParams({path:root+'/media',view:'list'}));await page.locator('.fm-row[data-name="Carpeta QA"]').waitFor();
  const metrics=await page.evaluate(()=>{const box=(s:string)=>document.querySelector(s)!.getBoundingClientRect();return{width:innerWidth,top:box('.fm-top').height,main:box('.fm-main').height,footer:box('.fm-footer').height,overflow:document.documentElement.scrollWidth>innerWidth,tool:box('.fm-cmdbar').height,filters:box('#fm-catalog-bar').height};});
  console.log(JSON.stringify(metrics));assert(!metrics.overflow,'Page overflow '+width);assert(metrics.footer<=36,'Tall footer '+width);if(width<=390){assert(metrics.main>844*.50,'File area too small '+width);assert(metrics.tool<=48&&metrics.filters<=50,'Wrapping mobile controls '+width);}
  checks.push(metrics);await page.screenshot({path:output+'/files-'+width+'.png'});
  await page.locator('#fm-transfers-btn').click();await page.locator('.fm-transfer-dialog[open]').waitFor();assert(await page.locator('.fm-transfer-dialog article').count()===25,'History lost');await page.keyboard.press('Escape');await page.locator('.fm-transfer-dialog').waitFor({state:'detached'});assert(await page.locator('#fm-transfers-btn').evaluate(el=>el===document.activeElement),'History focus not restored');
 }
 let revision=1,calls=0;
 const item=(id:string,extra:any={})=>({id,manager:'pnpm',scope:'user',user:'qa',uid:42,root:'/qa/global',sourceId:'pnpm',packageName:'fixture-'+id,name:'Fixture '+id,version:'1.0.0',kind:'tool',executables:[],canUpdate:false,updateState:'unchecked',reason:'',iconUrl:'/api/software/icons/'+id,...extra});
 const rows=Array.from({length:2500},(_,i)=>item('tool-'+i,{updateState:'current'}));
 await page.route('**/api/software**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.includes('/icons/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'});
  assert(path==='/api/software','Unexpected software mutation '+path);calls++;
  return route.fulfill({json:{ok:true,revision,loading:revision===1,checking:revision<3,checkedAt:Date.now(),canAdministerSystem:false,user:'qa',home:root,sources:[{id:'pnpm',manager:'pnpm',scope:'user',user:'qa',available:true,complete:true,updateState:revision===1?'unchecked':'ok'},{id:'slow',manager:'snap',scope:'system',user:'root',available:true,complete:true,updateState:revision<3?'unchecked':'ok'}],installations:[item('wrangler',revision>1?{canUpdate:true,updateState:'available',targetVersion:'2.0.0'}:{}),item('readonly',{manager:'dnf',targetVersion:'2.0.0',updateState:'unsupported'}),...rows]}});
 });
 await page.setViewportSize({width:1440,height:1000});await go('/programas');await page.locator('.software-progress').waitFor();assert((await page.locator('.software-progress').innerText()).includes('Leyendo'),'Initial loading unexplained');
 revision=2;await page.locator('[data-update=wrangler]').waitFor();assert(await page.locator('[data-detail=readonly]').count()===1,'Read-only update hidden');assert(await page.locator('[data-update=wrangler]').isEnabled(),'Slow unrelated source blocks review');
 await page.locator('[data-mode=installed]').click();assert(await page.locator('.software-row').count()===75,'Large inventory not bounded');
 await page.evaluate(()=>{(window as any).__qaIcon=document.querySelector('.sidebar svg');});await page.locator('#software-query').fill('wrangler');assert(await page.locator('.software-row').count()===1,'Global search broken');assert(await page.evaluate(()=>(window as any).__qaIcon===document.querySelector('.sidebar svg')),'Refresh rebuilds unrelated icons');
 revision=3;await page.locator('.software-progress').waitFor({state:'detached'});assert(calls>=3,'Background polling stopped');
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Programs overflow '+width);await page.locator('[data-detail=wrangler]').click();await page.locator('.software-dialog[open]').waitFor();await page.screenshot({path:output+'/programs-'+width+'.png'});await page.keyboard.press('Escape');await page.locator('.software-dialog').waitFor({state:'detached'});}
 assert(!errors.length,'Browser errors '+errors.join('; '));assert(await readFile(root+'/media/nota.txt','utf8')==='Fixture que se conserva.','Fixture contents changed');
 await writeFile(output+'/result.json',JSON.stringify({ok:true,checks,calls,errors,hostPackageMutations:0},null,2));console.log(JSON.stringify({ok:true,checks,calls,errors,output}));
}catch(e){await page.screenshot({path:output+'/failure.png'});throw e;}finally{await browser.close();}
