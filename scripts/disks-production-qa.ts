/** Read-only production smoke. Never creates plans or changes visibility.
 * A marker allows keeping an existing browser/cache across the deployment.
 */
import {chromium} from 'playwright';
import {createSession} from '../src/auth';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
const origin=process.env.AXON_PRODUCTION_QA_ORIGIN||'https://ports.binaryserver.com.ar';
const configPath=process.env.CONFIG_PATH||'data/config.json';
const username=await readFile(configPath,'utf8').then(text=>JSON.parse(text).auth.username).catch((e:any)=>{if(e.code!=='EACCES')throw e;return execFileSync('sudo',['-n','python3','-c','import json,sys; print(json.load(open(sys.argv[1]))["auth"]["username"])',configPath],{encoding:'utf8'}).trim();});
const browser=await chromium.launch({headless:true,...(process.env.AXON_QA_BROWSER_CHANNEL?{channel:process.env.AXON_QA_BROWSER_CHANNEL}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const assert=(v:unknown,message:string)=>{if(!v)throw new Error(message);};
const cookie=await createSession(username);
await context.addCookies([{name:'axon_session',value:cookie,url:origin,httpOnly:true,secure:origin.startsWith('https:'),sameSite:'Lax'}]);
try{
 if(process.env.AXON_PRODUCTION_QA_OLD_IMAGE){
  const previous=process.env.AXON_PRODUCTION_QA_OLD_IMAGE;
  const old=(file:string)=>execFileSync('docker',['run','--rm','--network','none','--entrypoint','cat',previous,'/app/public/'+file],{encoding:'utf8',maxBuffer:4*1024*1024});
  await page.route('**/almacenamiento?*',route=>route.fulfill({contentType:'text/html',body:old('index.html')}));
  for(const file of ['storage.js','host-storage.js','feat-files.js']){const bytes=old(file);await page.route('**/'+file+'?*',route=>route.fulfill({contentType:'application/javascript',body:bytes}));}
 }
 await page.goto(origin+'/almacenamiento?view=disks');await page.locator('#app:not(.hidden)').waitFor();await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);
 console.log('Production browser authenticated; current shell and assets loaded.');
 if(process.env.AXON_PRODUCTION_QA_MARKER||process.env.AXON_PRODUCTION_QA_OLD_IMAGE){
  if(process.env.AXON_PRODUCTION_QA_MARKER){
  const deadline=Date.now()+600_000;
  while(!(await Bun.file(process.env.AXON_PRODUCTION_QA_MARKER).exists())){if(Date.now()>deadline)throw new Error('Deployment marker timed out');await new Promise(resolve=>setTimeout(resolve,1000));}
  }
  await page.unrouteAll();await page.reload();await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);await page.evaluate(()=>(window as any).AxonNavigation.go('/almacenamiento?view=disks'));
 }
 console.log('Production route:',page.url());await page.locator('#disk-manager [data-disk-refresh]').waitFor();
 await page.getByText('Discos actualizados.',{exact:true}).waitFor();
 const inventory=await page.evaluate(async()=>await (await fetch('/api/storage/disks')).json());
 assert(inventory.ok&&inventory.privileged,'Production disk service not available');
 assert(inventory.disks.some((d:any)=>!d.partitions.length&&d.canEdit),'New blank disk not configurable');
 assert(inventory.disks.some((d:any)=>d.blockers.length&&!d.canEdit),'System disk is not protected');
 assert(inventory.volumes.volumes.filter((v:any)=>v.technical).every((v:any)=>v.hidden),'Boot/EFI default visibility incorrect');
 const newDisk=inventory.disks.find((d:any)=>!d.partitions.length&&d.canEdit);
 await page.locator('[data-disk="'+newDisk.id+'"][data-disk-operation="layout"]').click();
 await page.locator('[data-add-part]').click();assert(await page.locator('[data-part-row]').count()===2,'Partition editor unavailable');
 await page.locator('[data-part-row="1"] [name=filesystem]').selectOption('exfat');
 assert((await page.locator('[data-part-row="1"] [data-format-description]').textContent())!.includes('Windows'),'Format explanation unavailable');
 const dialogAxe=await new AxeBuilder({page}).include('.disk-dialog').analyze();assert(!dialogAxe.violations.length,'Production dialog accessibility: '+dialogAxe.violations.map(v=>v.id).join(','));
 await page.locator('[data-disk-close]').click();
 const desktopAxe=await new AxeBuilder({page}).include('#disk-manager').analyze();assert(!desktopAxe.violations.length,'Production management accessibility: '+desktopAxe.violations.map(v=>v.id).join(','));
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Production overflow at '+width);
  await page.screenshot({path:'/tmp/axon-disks-production-'+width+'.png',fullPage:true});
 }
 await page.evaluate(()=>(window as any).AxonNavigation.go('/archivos'));await page.locator('#fm-disks-open').click();await page.locator('#fm-volumes-refresh:not([disabled])').click();await page.waitForTimeout(400);
 assert(!(await page.locator('#fm-volumes [data-volume]').evaluateAll(nodes=>nodes.some(n=>/^(boot|efi)$/i.test(n.querySelector('strong')?.textContent||'')))),'Boot/EFI appears in Files');
 assert(!errors.length,'Production runtime errors: '+errors.join('; '));
 console.log(JSON.stringify({ok:true,checks:[...(process.env.AXON_PRODUCTION_QA_MARKER||process.env.AXON_PRODUCTION_QA_OLD_IMAGE?['cached previous browser shell reload']:[]),'physical blank disk configurable','system disk protected','boot/EFI hidden in shared lists','two-partition editor and explained ext4/exFAT options','axe management and dialog','1440/390/320 layouts','Files navigation'],physicalDisksModified:false,plansCreated:false,errors}));
}finally{
 // Revoke this diagnostic session without modifying the user's sessions.
 try{await context.request.post(origin+'/api/logout',{headers:{Origin:origin,'Content-Type':'application/json'},data:{}});}catch{}
 await browser.close();
}
