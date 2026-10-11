import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const production = process.env.AXON_USB_QA_PRODUCTION === '1';
const origin = production ? 'https://ports.binaryserver.com.ar' : (process.env.AXON_QA_ORIGIN || 'http://127.0.0.1:3459');
const output = production ? '/tmp/axon-usb-production' : (process.env.AXON_QA_OUTPUT || '/tmp/axon-usb-qa');
await mkdir(output,{recursive:true});
assert.equal((await (await fetch(origin+'/api/health')).json()).qa,production?undefined:true);
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'});
const page=await context.newPage(), errors:string[]=[], checks:any[]=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  if(production){
    const {createSession}=await import('../src/auth');
    const username=execFileSync('sudo',['-n','python3','-c','import json; print(json.load(open("data/config.json"))["auth"]["username"])'],{encoding:'utf8'}).trim();
    await context.addCookies([{name:'axon_session',value:await createSession(username),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  }else assert.equal((await context.request.post(origin+'/api/login',{data:{username:'qa',password:'axon-local-qa'}})).status(),200);
  if(production && process.env.AXON_USB_QA_MARKER){
    await page.goto(origin+'/configuracion?section=security');await page.waitForFunction(()=>window['AxonNavigation']?.ready);
    await writeFile(output+'/browser-ready','ready');
    const deadline=Date.now()+300000;
    while(!await Bun.file(process.env.AXON_USB_QA_MARKER).exists()){
      assert(Date.now()<deadline,'Deployment timed out');await new Promise(r=>setTimeout(r,250));
    }
    await page.reload();checks.push('Existing authenticated browser/cache survives publication');
  }
  await page.goto(origin+'/configuracion?section=usb');
  await page.waitForFunction(()=>window['AxonNavigation']?.ready);
  await page.locator('.usb-port').first().waitFor();
  assert.equal(await page.locator('.settings-savebar').isVisible(),false);
  let snapshot=await (await context.request.get(origin+'/api/usb')).json();
  assert.equal(snapshot.physicalPowerVerified,false);
  assert.equal(snapshot.fixture,production?undefined:true);
  checks.push({externalPorts:snapshot.ports.filter(p=>p.external).map(p=>p.ports),powerCutAvailable:false});
  const protectedPort=page.locator('.usb-port').filter({hasText:production?'DATOS 2':'TOSHIBA'});
  assert.equal(await protectedPort.locator('[data-operation=cycle]').isEnabled(),false);
  assert.equal(await protectedPort.locator('[data-operation=disconnect]').isEnabled(),false);
  const blocked=snapshot.ports.find(p=>p.disks.some(d=>d.mounted));assert(blocked,'Mounted fixture or real disk needed');
  const rejection=await context.request.post(origin+'/api/usb',{headers:{Origin:origin},data:{id:blocked.id,token:blocked.token,operation:'cycle'}});
  assert.equal(rejection.status(),409);
  checks.push('Mounted disk protected in UI and backend; no disk disconnected');
  const empty=snapshot.ports.find(p=>p.external&&p.canDisconnect&&p.devices.length===0&&p.id==='usb3-port4') || (!production?snapshot.ports.find(p=>p.external&&p.canDisconnect&&p.devices.length===0):null);
  assert(empty,'A known empty external port is required');
  const row=page.locator('[data-port="'+empty.id+'"]');
  await row.locator('[data-operation=cycle]').click();
  await page.locator('#confirm-ok').click();
  await page.waitForFunction(()=>document.querySelector('#usb-controller [data-job]')?.textContent.includes('Puerto habilitado'),undefined,{timeout:60000});
  snapshot=await (await context.request.get(origin+'/api/usb')).json();
  assert.equal(snapshot.job.state,'completed');
  assert(snapshot.ports.find(p=>p.id===empty.id).remainingSeconds==null);
  checks.push({logicalReconnect:empty.id,physicalDiskDisconnected:false});
  await page.locator('[data-internal]').check();
  assert((await page.locator('.usb-port').count())>snapshot.ports.filter(p=>p.external).length);
  const camera=page.locator('.usb-port').filter({hasText:production?'HD User Facing':'Cámara integrada'});
  assert.equal(await camera.locator('[data-operation]').count(),0);
  await page.locator('[data-internal]').uncheck();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(250);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow '+width);
    await page.screenshot({path:output+'/usb-'+width+'.png'});
  }
  await page.reload();await page.locator('.usb-port').first().waitFor();assert(new URL(page.url()).search.includes('usb'));
  assert.equal(errors.length,0,errors.join(';'));
  checks.push('Deep link, cached reload, internal protection and 1440/768/390/320 px');
  await writeFile(output+'/report.json',JSON.stringify({ok:true,origin,checks,errors},null,2));
  console.log(JSON.stringify({ok:true,origin,checks,errors,output}));
}catch(e){await page.screenshot({path:output+'/failure.png'});throw e;}
finally {try{await context.request.post(origin+'/api/logout',{headers:{Origin:origin},data:{}});}catch{}await browser.close();}
