/** Read-only public release QA; only creates and closes its own browser session. */
import {chromium} from 'playwright';
import {createSession} from '../src/auth';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const origin='https://ports.binaryserver.com.ar';
const output=process.env.AXON_QA_OUTPUT||'/tmp/axon-release-production';await mkdir(output,{recursive:true});
const username=execFileSync('sudo',['-n','python3','-c','import json; print(json.load(open("data/config.json"))["auth"]["username"])'],{encoding:'utf8'}).trim();
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'});
await context.addCookies([{name:'axon_session',value:await createSession(username),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
const page=await context.newPage(),errors:string[]=[],checks:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
const assert=(v:unknown,m:string)=>{if(!v)throw Error(m);};
const get=async(path:string)=>{const r=await context.request.get(origin+path);assert(r.ok(),path+' HTTP '+r.status());return r.json();};
const go=async(path:string)=>{await page.evaluate(path=>(window as any).AxonNavigation.go(path),path);};
try{
  await page.goto(origin+'/biblioteca');await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);
  await writeFile(output+'/browser-ready','ready');
  const marker=process.env.AXON_PRODUCTION_QA_MARKER;
  if(marker){
    const deadline=Date.now()+15*60_000;
    while(!await Bun.file(marker).exists()){assert(Date.now()<deadline,'Deployment wait expired');await new Promise(r=>setTimeout(r,500));}
    await page.reload();await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);
    checks.push('Existing authenticated browser and service worker cache reload after deployment');
  }
  const health=await get('/api/health');assert(health.version==='1.4.0','Unexpected production version');
  if(process.env.AXON_EXPECTED_REVISION)assert(health.revision===process.env.AXON_EXPECTED_REVISION,'Unexpected revision');
  for(const path of ['/api/files/volumes','/api/file-catalog','/api/sessions','/api/software','/api/compose'])await get(path);
  checks.push('Public HTTPS and authenticated disks/catalog/sessions/software/compose endpoints');
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});
    for(const [route,tab] of [['/biblioteca','library'],['/agentes','agents'],['/drop','drop'],['/archivos','files']]){
      await go(route);await page.locator('#tab-'+tab+'.active').waitFor();
      assert(await page.locator('#tab-'+tab+'>.host-disks-panel').count()===0,'Redundant disk panel '+route);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow '+route+' '+width);
    }
    await go('/biblioteca');await page.locator('#lib-add-folder').click();await page.locator('#host-path-picker[open]').waitFor();
    await page.locator('#host-path-picker [data-host-volume]').first().waitFor();
    assert(await page.locator('#host-picker-select').isVisible(),'Folder selector unavailable');
    await page.screenshot({path:output+'/folder-picker-'+width+'.png'});await page.keyboard.press('Escape');
  }
  checks.push('Source picker and four production routes at 1440/768/390/320 px');
  const library=await get('/api/library');
  if(library.items.length){
    await go('/biblioteca?type=all&sort=name-asc&item='+encodeURIComponent(library.items[0].id));await page.locator('#lv-next').waitFor();
    if(library.items.length>1&&await page.locator('#lv-next').isEnabled()){
      const before=page.url();await page.locator('#lv-next').click();assert(page.url()!==before,'Library next did not update item');await page.locator('#lv-prev').click();
    }
    await page.screenshot({path:output+'/library-viewer-mobile.png'});await page.locator('#lv-close').click();
    checks.push('Existing indexed file opens and viewer navigation is reachable');
  }
  await page.reload();await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);
  assert(!errors.length,errors.join('; '));
  const report={ok:true,origin,health,checks,errors,libraryItems:library.items.length,dataWrites:0,hardwareActions:0};
  await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){await page.screenshot({path:output+'/failure.png'});throw e;}
finally{try{await context.request.post(origin+'/api/logout',{headers:{Origin:origin},data:{}});}catch{}await browser.close();}
