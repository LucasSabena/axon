import {createRequire} from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,realpath,writeFile,readFile} from 'node:fs/promises';
const entry=process.env.AXON_QA_PLAYWRIGHT_ENTRY;if(!entry)throw new Error('Set AXON_QA_PLAYWRIGHT_ENTRY');
const {chromium}=createRequire(await realpath(entry))('playwright');
const output='docs/qa/pending-files-2026-10-05';await mkdir(output,{recursive:true});
const assert=(v:unknown,m:string)=>{if(!v)throw new Error(m);};
const browser=await chromium.launch({channel:'chrome',headless:true});
const results:Record<string,unknown>={},errors:string[]=[];
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',(e:Error)=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3459/archivos');await page.locator('#username').fill('qa');await page.locator('#password').fill('axon-local-qa');await page.locator('#login-form button[type=submit]').click();await page.locator('[data-volume="fixture-external"]').waitFor();
 const home=await page.evaluate(async()=>{const r=await fetch('/api/files/volumes');return (await r.json()).volumes.find((v:any)=>v.id==='fixture-internal').path;});
 const name='pending-'+Date.now(),from=home+'/media/'+name,to=home+'/external-drive/'+name;
 await mkdir(from);await writeFile(from+'/original.txt','Original preservado durante el bloqueo.');
 const pending={id:'qa-pending-ui',kind:'transfer',state:'running',action:'move',from,to,logicalBytes:'100',copiedBytes:'30'};
 let state='running',trashCalls=0,statusCalls=0;
 await page.route('**/api/files/trash',async(route:any)=>{trashCalls++;await route.fulfill({json:{ok:true,items:[],failed:[{path:from,error:'Hay un movimiento pendiente. Revisá su estado antes de continuar.',code:'operation-pending',pending}]}});});
 await page.route('**/api/files/transfers/qa-pending-ui*',async(route:any)=>{statusCalls++;await route.fulfill({json:{ok:true,operation:{...pending,state,copiedBytes:state==='verified'?'100':'30'}}});});
 await page.evaluate((p:string)=>(window as any).AxonNavigation.go('/archivos?'+new URLSearchParams({path:p,view:'list'})),home+'/media');
 await page.locator('.fm-row[data-name="'+name+'"] input[type=checkbox]').check();await page.locator('#fm-sel-del').click();
 const modal=page.locator('.operation-dialog');await modal.waitFor({state:'attached'});await modal.locator('.operation-cancel').waitFor();
 assert((await modal.innerText()).includes('Hay un trabajo pendiente'),'Missing explanatory dialog');
 await page.waitForFunction(()=>document.querySelector('.operation-live-status progress')?.getAttribute('value')==='30');
 for(const width of [1440,390,320]) {
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(200);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Viewport overflow '+width);
  const box=await modal.evaluate((el:any)=>{const r=el.shadowRoot.querySelector('dialog').getBoundingClientRect();return {x:r.x,width:r.width};});assert(box.x>=0&&box.x+box.width<=width,'Dialog outside viewport '+width);
  await page.screenshot({path:`${output}/pending-${width}.png`,fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 const axe=await new AxeBuilder({page}).include('.operation-dialog').withTags(['wcag2a','wcag2aa']).analyze();assert(!axe.violations.length,'Accessibility violations');results.accessibility=axe.violations;
 state='verified';await page.waitForFunction(()=>document.querySelector('.operation-live-status')?.textContent?.includes('Completado'));
 await page.screenshot({path:output+'/completed-1440.png',fullPage:true});
 await modal.locator('.operation-accept').click();await modal.waitFor({state:'detached'});assert(await page.locator('#fm-transfer-history').evaluate((e:any)=>e.open),'History not opened');
 assert(trashCalls===1,'Trash was retried automatically');assert(await readFile(from+'/original.txt','utf8')==='Original preservado durante el bloqueo.','Original changed');
 const stoppedAt=statusCalls;await page.waitForTimeout(3300);assert(statusCalls===stoppedAt,'Status polling continued after dialog close');
 results.pendingDialog={mockedBlockedResponse:true,polledTerminalResult:true,requestsToTrash:trashCalls,pollStopped:true,originalPreserved:true};
 await page.evaluate((from:string)=>{void (window as any).AxonTransfers.showError(Object.assign(new Error('El destino exfat no admite 4 enlaces simbólicos'),{raw:{blockers:Array.from({length:4},(_,i)=>({path:from+'/enlace-'+i,reason:'El destino exfat no admite enlaces simbólicos'}))}}),{mode:'move',from,to:'/mnt/fixture-disk/'+from.split('/').pop()});},from);
 await modal.waitFor({state:'attached'});await modal.locator('.operation-cancel').waitFor();assert(await modal.locator('.operation-impact li').count()===4,'Missing incompatibility paths');
 await page.setViewportSize({width:320,height:1000});await page.waitForTimeout(200);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Blocker dialog overflows');await page.screenshot({path:output+'/incompatible-320.png',fullPage:true});
 await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});results.incompatiblePaths=4;
 assert(!errors.length,'Browser errors: '+errors.join(', '));results.browserErrors=errors;await writeFile(output+'/browser.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
} finally {await browser.close();}
