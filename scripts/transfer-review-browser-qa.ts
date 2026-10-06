import {createRequire} from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,realpath,writeFile,readFile,lstat} from 'node:fs/promises';
const entry=process.env.AXON_QA_PLAYWRIGHT_ENTRY;if(!entry)throw new Error('Set AXON_QA_PLAYWRIGHT_ENTRY');
const {chromium}=createRequire(await realpath(entry))('playwright');
const origin='http://127.0.0.1:3459', output='docs/qa/transfer-review-2026-10-05';await mkdir(output,{recursive:true});
const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
const browser=await chromium.launch({channel:'chrome',headless:true});const errors:string[]=[];const results:Record<string,unknown>={};
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',(e:Error)=>errors.push(e.message));
 await page.goto(origin+'/archivos');await page.locator('#username').fill('qa');await page.locator('#password').fill('axon-local-qa');await page.locator('#login-form button[type=submit]').click();await page.locator('[data-volume="fixture-external"]').waitFor();
 const call=async(url:string,body?:unknown)=>page.evaluate(async({url,body}:any)=>{const response=await fetch(url,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};},{url,body});
 const inventory=(await call('/api/files/volumes')).data, home=inventory.volumes.find((v:any)=>v.id==='fixture-internal').path;
 const folder='Fotos-'+Date.now();const from=home+'/media/'+folder,to=home+'/external-drive/'+folder;await mkdir(from);await writeFile(from+'/a.txt','archivo A');await writeFile(from+'/b.txt','archivo B');
 await call('/api/library/rescan',{});
 let library=(await call('/api/library')).data;let attempts=0;while(!library.items.some((i:any)=>i.p===from+'/b.txt')&&attempts++<30){await page.waitForTimeout(150);library=(await call('/api/library')).data;}
 const a=library.items.find((i:any)=>i.p===from+'/a.txt'),b=library.items.find((i:any)=>i.p===from+'/b.txt');assert(a&&b,'Missing Library fixtures');
 await call('/api/library/favorite',{ids:[a.id],on:true});assert((await call('/api/library/collections',{name:'Entrega al cliente',ids:[a.id,b.id]})).data.ok,'Collection fixture blocked');
 const share=(await call('/api/library/shares',{ids:[a.id],title:'Entrega privada',allowDownload:false,ttl:86400,cdn:false,notifyActivity:false})).data.share;
 assert(share?.id,'Share fixture missing');
 const prepared=(await call('/api/files/transfers/plans',{mode:'move',from,to})).data.plan;console.log('QA: review prepared');assert(prepared.review.needsConfirmation,'Missing review');
 const forged=await call(`/api/files/transfers/${prepared.id}/execute`,{digest:prepared.digest,reviewDigest:'forged'});assert(forged.status===409,'Forged approval accepted');
 await call('/api/library/favorite',{ids:[b.id],on:true});
 const stale=await call(`/api/files/transfers/${prepared.id}/execute`,{digest:prepared.digest,reviewDigest:prepared.review.revision});assert(stale.status===409&&stale.data.error.includes('cambiaron'),'Stale approval accepted');assert(await readFile(from+'/a.txt','utf8')==='archivo A','Denied review changed original');results.approvalChecks=['unconfirmed rejected','forged rejected','stale rejected'];
 const navigate=async(p:string)=>{await page.evaluate((p:string)=>(window as any).AxonNavigation.go('/archivos?'+new URLSearchParams({path:p,view:'list'})),p);await page.waitForFunction((p:string)=>(document.querySelector('#fm-location') as HTMLInputElement)?.value===p,p);};
 await navigate(home+'/media');await page.locator('.fm-row[data-name="'+folder+'"] input[type=checkbox]').check();await page.locator('#fm-sel-move').click();await navigate(home+'/external-drive');await page.locator('#fm-paste-btn').click();
 const modal=page.locator('.operation-dialog');await modal.waitFor({state:'attached'});await modal.locator('.operation-cancel').waitFor();await modal.locator('.operation-cancel').click();await modal.waitFor({state:'detached'});await page.locator('#fm-paste-btn:not([disabled])').waitFor();assert(await lstat(from).then(()=>true,()=>false),'Cancel moved original');assert(!await lstat(to).then(()=>true,()=>false),'Cancel created destination');assert(await page.locator('#fm-clipboard').isVisible(),'Cancel lost clipboard');results.cancelPreserved=true;console.log('QA: cancelled without effects');
 await page.locator('#fm-paste-btn').click();await modal.waitFor({state:'attached'});await modal.locator('.operation-cancel').waitFor();
 assert(await modal.locator('.operation-impact').count()===4,'Expected favorites, collection, share and indexed files');
 await modal.locator('.operation-impact').first().locator('summary').click();
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(250);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Viewport overflow '+width);
  const box=await modal.evaluate((el:any)=>{const r=el.shadowRoot.querySelector('dialog').getBoundingClientRect();return {x:r.x,width:r.width};});assert(box&&box.x>=0&&box.x+box.width<=width,'Dialog outside viewport '+width);
  await page.screenshot({path:`${output}/review-${width}.png`,fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 const axe=await new AxeBuilder({page}).include('.operation-dialog').withTags(['wcag2a','wcag2aa']).analyze();
 results.dialogAccessibility=axe.violations.map(v=>({id:v.id,impact:v.impact}));assert(!axe.violations.length,'Dialog accessibility violations');
 await page.evaluate(()=>{(window as any).AxonThemes.setMode('dark');});await page.waitForTimeout(250);await page.screenshot({path:output+'/review-dark-1440.png',fullPage:true});
 await page.evaluate(()=>{(window as any).AxonThemes.setMode('light');});
 await modal.locator('.operation-accept').click();await modal.waitFor({state:'detached'});await page.locator('.fm-row[data-name="'+folder+'"]').waitFor();await page.locator('#fm-clipboard.hidden').waitFor({state:'attached'});
 console.log('QA: approved move completed');const persisted=JSON.parse(await readFile(home+'/library/state.json','utf8'));
 assert(persisted.roots.includes(to),'Destination not persisted as Library root');assert(persisted.favorites.filter((p:string)=>p.startsWith(to+'/')).length===2,'Favorites not repathed');assert(persisted.collections.find((c:any)=>c.paths.some((p:string)=>p.startsWith(to+'/'))).paths.every((p:string)=>p.startsWith(to+'/')),'Collection not repathed');assert(persisted.shares.find((s:any)=>s.id===share.id)?.paths[0]===to+'/a.txt'&&!persisted.shares.find((s:any)=>s.id===share.id).allowDownload,'Share changed capability or permissions');
 const publicFile=await page.request.get(origin+`/s/${share.id}/f/0`);assert(publicFile.status()===200&&await publicFile.text()==='archivo A','Existing public link lost file');assert((await page.request.get(origin+`/s/${share.id}/f/0?dl=1`)).status()===403,'Download permission widened');results.referencesPreserved=true;results.publicSharePreserved=true;
 assert(await readFile(to+'/b.txt','utf8')==='archivo B','Move bytes changed');assert(!await lstat(from).then(()=>true,()=>false),'Visible source still present');
 // A real non-overwriting collision: show the new error dialog, preserve both files.
 await writeFile(home+'/external-drive/collision.txt','original');
 await page.evaluate(async({from,to}:any)=>{try{await (window as any).AxonTransfers.run(from,to,'move');}catch(error){void (window as any).AxonTransfers.showError(error,{mode:'move',from,to});}},{from:to+'/a.txt',to:home+'/external-drive/collision.txt'});
 await modal.waitFor({state:'attached'});await modal.locator('.operation-cancel').waitFor();assert((await modal.innerText()).includes('No se pudo mover')&&(await modal.innerText()).includes('El destino existe'),'Missing readable error');await page.waitForTimeout(250);
 for(const width of [1440,320]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(250);await page.screenshot({path:`${output}/error-${width}.png`,fullPage:true});}await modal.locator('.operation-cancel').click();await modal.waitFor({state:'detached'});
 assert(await readFile(to+'/a.txt','utf8')==='archivo A'&&await readFile(home+'/external-drive/collision.txt','utf8')==='original','Collision changed files');results.collisionPreserved=true;
 // Shared rename flow from Library must review a shared item too.
 await page.evaluate(async({from,to}:any)=>{(window as any).__rename=(window as any).AxonTransfers.run(from,to,'move').catch((e:any)=>{(window as any).__renameError=e.message;});},{from:to+'/a.txt',to:to+'/renamed.txt'});await modal.waitFor({state:'attached'});await modal.locator('.operation-cancel').waitFor();await modal.locator('.operation-accept').click();await modal.waitFor({state:'detached'});await page.waitForFunction(()=>!(window as any).__renameError&&!!(window as any).__rename);for(let i=0;i<40&&!await lstat(to+'/renamed.txt').then(()=>true,()=>false);i++)await page.waitForTimeout(150);await page.evaluate(()=>(window as any).__rename);
 const renamed=await page.request.get(origin+`/s/${share.id}/f/0`);assert(renamed.status()===200&&await renamed.text()==='archivo A','Rename broke shared link');results.sharedRenamePreserved=true;
 const projectSource=home+'/scan-fixture/nota.txt',projectDest=home+'/external-drive/project-note.txt';
 const projectPlan=(await call('/api/files/transfers/plans',{mode:'move',from:projectSource,to:projectDest})).data.plan;
 assert(projectPlan.review.impacts.some((i:any)=>i.kind==='configuration'&&i.title.includes('Proyecto')),'Project reference not reviewed');
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate((plan:any)=>{void (window as any).AxonTransfers.review(plan);},projectPlan);await modal.waitFor({state:'attached'});await modal.locator('.operation-cancel').waitFor();
 assert(await modal.locator('.operation-impact-warning[open]').count()>0,'Configuration warning collapsed');
 await page.waitForTimeout(250);await page.screenshot({path:output+'/project-warning-1440.png',fullPage:true});await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});
 assert(await lstat(projectSource).then(()=>true,()=>false),'Escape moved project file');results.projectWarningReviewed=true;
 assert(!errors.length,'Browser errors: '+errors.join(', '));results.browserErrors=errors;await writeFile(output+'/browser.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
