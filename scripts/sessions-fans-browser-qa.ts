import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin = process.env.AXON_QA_ORIGIN || 'http://127.0.0.1:3459', output = process.env.AXON_QA_OUTPUT || '/tmp/axon-sessions-fans-qa';
await mkdir(output,{recursive:true});
assert.equal((await (await fetch(origin+'/api/health')).json()).qa,true);
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1440,height:960}});
const second = await browser.newContext({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/128.0'});
const checks: string[] = [], errors: string[] = [];
const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
const call = (path: string, body?:unknown) => context.request[body===undefined?'get':'post'](origin+path,body===undefined?{}:{data:body,headers:{Origin:origin}});
try {
  assert.equal((await call('/api/login',{username:'qa',password:'axon-local-qa'})).status(),200);
  await call('/api/sessions/revoke-others', {});
  assert.equal((await second.request.post(origin+'/api/login',{data:{username:'qa',password:'axon-local-qa'}})).status(),200);
  await page.goto(origin+'/configuracion?section=sessions');
  await page.waitForFunction(()=>!!window['AxonNavigation']?.ready);
  await page.locator('.session-row').first().waitFor();
  assert.equal(await page.locator('.session-row').count(),2);
  assert.equal(await page.locator('.settings-savebar').isVisible(),false);
  const other = page.locator('.session-row').filter({hasText:'Firefox · Windows'});
  await other.locator('[data-name]').click();
  await other.locator('input').fill('Laptop de prueba');
  await other.locator('[data-save]').click();
  await page.getByText('Laptop de prueba',{exact:true}).waitFor();
  assert.equal(await page.locator('#settings-save-state').textContent(),'Sin cambios pendientes');
  checks.push('Current device, other browser, persisted device label and independent save flow');
  await page.locator('[data-others]').click();
  await page.locator('#confirm-ok').click();
  await page.waitForFunction(()=>document.querySelectorAll('.session-row').length===1);
  assert.equal((await second.request.get(origin+'/api/sessions')).status(),401);
  assert.equal((await call('/api/sessions')).status(),200);
  checks.push('Close other devices preserves current session and denies their existing cookie');
  await page.locator('[data-history]').check();
  await page.locator('.session-row').filter({hasText:'Cerrada'}).first().waitFor();
  await page.reload(); await page.locator('.session-row').first().waitFor();
  assert(new URL(page.url()).search.includes('sessions'));
  for (const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:960}); await page.waitForTimeout(300);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Session overflow '+width);
    await page.screenshot({path:output+'/sessions-'+width+'.png'});
  }
  checks.push('Session deep link, reload and 1440/768/390/320 px layouts');
  await page.locator('#settings-tab-fans').click();
  await page.locator('[data-controls]:not([hidden])').waitFor();
  assert.equal(await page.locator('.settings-savebar').isVisible(),false);
  await page.locator('[data-cpu]').fill('60');await page.locator('[data-gpu]').fill('70');
  await page.locator('[data-apply]').click();
  await page.getByText('Manual',{exact:true}).waitFor();
  assert.equal((await (await call('/api/fans')).json()).gpu,70);
  checks.push('Independent CPU/GPU control applied with thermal limits and manual duration');
  // Polls must retain the user\'s unapplied slider values.
  await page.locator('[data-cpu]').fill('80');
  await page.locator('#fan-controller [data-refresh]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-cpu]').inputValue(),'80');
  await page.locator('[data-max]').click();
  await page.waitForFunction(()=>document.querySelector('[data-fan-state]')?.textContent.includes('Máximo'));
  await page.locator('[data-auto]').click();
  await page.waitForFunction(()=>document.querySelector('[data-fan-state]')?.textContent.includes('Automático'));
  assert.equal((await (await call('/api/fans')).json()).mode,'auto');
  assert.equal(await page.locator('#settings-save-state').textContent(),'Sin cambios pendientes');
  checks.push('Polling preserves draft sliders; maximum and automatic apply immediately');
  for (const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:960}); await page.waitForTimeout(300);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Fan overflow '+width);
    await page.screenshot({path:output+'/fans-'+width+'.png'});
  }
  await page.reload();await page.locator('[data-controls]:not([hidden])').waitFor();assert(new URL(page.url()).search.includes('fans'));
  checks.push('Fan deep link, reload and 1440/768/390/320 px layouts');
  assert.equal(errors.length,0,errors.join(';'));
  await writeFile(output+'/report.json',JSON.stringify({ok:true,checks,errors,realHardwareWrites:0},null,2));
  console.log(JSON.stringify({ok:true,checks,errors,output}));
} catch(e) { await page.screenshot({path:output+'/failure.png'}); throw e; }
finally { for(const c of [second,context])try{await c.request.post(origin+'/api/logout',{data:{},headers:{Origin:origin}});}catch{} await browser.close(); }
