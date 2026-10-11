import { chromium } from 'playwright';
import { createSession } from '../src/auth';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const origin='https://ports.binaryserver.com.ar', output='/tmp/axon-sessions-fans-production', marker=process.env.AXON_PRODUCTION_QA_MARKER;
await mkdir(output,{recursive:true});
const username=execFileSync('sudo',['-n','python3','-c','import json; print(json.load(open("data/config.json"))["auth"]["username"])'],{encoding:'utf8'}).trim();
const browser=await chromium.launch({headless:true,channel:'chrome'}), context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'}), second=await browser.newContext({userAgent:'AXON-owned-session-revocation-QA'});
const page=await context.newPage(),errors:string[]=[],checks:any[]=[];
page.on('pageerror',e=>errors.push(e.message));
const token=await createSession(username), otherToken=await createSession(username);
await context.addCookies([{name:'axon_session',value:token,url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
await second.addCookies([{name:'axon_session',value:otherToken,url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
const api=async(path:string,body?:unknown)=>{const r=await context.request[body===undefined?'get':'post'](origin+path,body===undefined?{}:{data:body,headers:{Origin:origin}});assert(r.ok(),path+' HTTP '+r.status());return r.json();};
try {
  await page.goto(origin+'/configuracion?section=security');await page.waitForFunction(()=>window['AxonNavigation']?.ready);
  await writeFile(output+'/browser-ready','ready');console.log('Existing production browser/cache ready.');
  if(marker){const deadline=Date.now()+600000;while(!(await Bun.file(marker).exists())){assert(Date.now()<deadline,'Deployment timed out');await new Promise(r=>setTimeout(r,250));}await page.reload();await page.waitForFunction(()=>window['AxonNavigation']?.ready);checks.push('Authenticated browser and existing cache survive the new release');}
  await page.locator('#settings-tab-sessions').click(); await page.locator('.session-row').first().waitFor();
  const me=(await api('/api/sessions')).sessions.find(s=>s.current); assert(me&&me.ip,'Current production session/IP missing');
  await second.request.get(origin+'/api/sessions');
  const other=(await (await second.request.get(origin+'/api/sessions')).json()).sessions.find(s=>s.current);assert(other,'Owned QA session absent');
  const named=await context.request.patch(origin+'/api/sessions/'+other.jti,{headers:{Origin:origin},data:{name:'Prueba de cierre remoto'}});assert(named.ok());
  // Read-only live stream, never a shell or an unrelated user\'s session.
  await page.evaluate(t=>{
    window['__qaSocket']=new WebSocket('wss://'+location.host+'/ws/logs?src=docker:axon');
    window['__qaClosed']=false;window['__qaSocket'].onclose=e=>{window['__qaClosed']=e.code===4401;};
  },token);
  // Owned other context has its own stream, which must be closed by revocation.
  const otherPage=await second.newPage();await otherPage.goto(origin+'/configuracion?section=sessions');await otherPage.waitForFunction(()=>window['AxonNavigation']?.ready);
  await otherPage.evaluate(()=>{window['__qaSocket']=new WebSocket('wss://'+location.host+'/ws/logs?src=docker:axon');window['__qaClosed']=false;window['__qaSocket'].onclose=e=>{window['__qaClosed']=e.code===4401;};});
  await otherPage.waitForFunction(()=>window['__qaSocket'].readyState===WebSocket.OPEN);
  const start=performance.now();await api('/api/sessions/'+other.jti+'/revoke',{});await otherPage.waitForFunction(()=>window['__qaClosed'],undefined,{timeout:3000});
  assert.equal((await second.request.get(origin+'/api/sessions')).status(),401);assert((await api('/api/sessions')).sessions.some(s=>s.current&&!s.revoked));
  checks.push({remoteRevocation:true,readOnlyWebSocketClosedMs:performance.now()-start,otherUsersRevoked:0});
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(300);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Session overflow '+width);await page.screenshot({path:output+'/sessions-'+width+'.png'});}
  await page.locator('#settings-tab-fans').click();await page.locator('[data-controls]:not([hidden])').waitFor();
  let state=await api('/api/fans');assert(state.available&&!state.fixture&&state.cpuRpm>0&&state.gpuRpm>0,'Real fan telemetry missing');
  await page.locator('[data-cpu]').fill('60');await page.locator('[data-gpu]').fill('70');await page.locator('[data-apply]').click();
  await page.waitForFunction(()=>document.querySelector('[data-fan-state]')?.textContent.includes('Manual'));
  state=await api('/api/fans');assert.equal(state.mode,'manual');assert.equal(state.cpu,60);assert.equal(state.gpu,70);
  await page.waitForTimeout(4000);checks.push({manual:await api('/api/fans')});
  await page.locator('[data-max]').click();await page.waitForFunction(()=>document.querySelector('[data-fan-state]')?.textContent.includes('Máximo'));
  await page.waitForTimeout(4000);checks.push({maximum:await api('/api/fans')});
  await page.locator('[data-auto]').click();await page.waitForFunction(()=>document.querySelector('[data-fan-state]')?.textContent.includes('Automático'));assert.equal((await api('/api/fans')).mode,'auto');
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(300);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Fan overflow '+width);await page.screenshot({path:output+'/fans-'+width+'.png'});}
  await page.reload();await page.locator('[data-controls]:not([hidden])').waitFor();assert(new URL(page.url()).search.includes('fans'));
  assert.equal(errors.length,0,errors.join('; '));checks.push('Public HTTPS real hardware, manual/max/AUTO, deep link, reload and desktop/mobile QA');
  await writeFile(output+'/report.json',JSON.stringify({ok:true,origin,checks,errors,finalMode:'auto'},null,2));console.log(JSON.stringify({ok:true,origin,checks,errors,output}));
}catch(e){await page.screenshot({path:output+'/failure.png'});throw e;}
finally {
  try{const s=await api('/api/fans');if(s.available&&s.mode!=='auto')await api('/api/fans',{mode:'auto',revision:s.revision});}catch{}
  for(const c of [second,context])try{await c.request.post(origin+'/api/logout',{headers:{Origin:origin},data:{}});}catch{}
  await browser.close();
}
