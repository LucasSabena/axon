const { chromium } = require(process.env.AXON_QA_PLAYWRIGHT_ENTRY || 'playwright');
const { default:AxeBuilder } = require('@axe-core/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const base = process.env.AXON_LOGIN_QA_URL || 'http://127.0.0.1:3467';
  const publicOnly = process.env.AXON_LOGIN_QA_PUBLIC === '1';
  const output = 'docs/login-redesign-2026-10-06';
  await fs.mkdir(output+'/screens',{recursive:true});
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const results = {base,publicOnly,layouts:[],flows:[],pageErrors:[]};
  const context = await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark'});
  const page = await context.newPage();
  page.on('pageerror',error=>results.pageErrors.push(error.message));
  const entrance = async () => {
    await page.goto(base);
    await page.locator('#login-screen:not(.hidden)').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>['.login-story','.login-box'].every(selector=>Number(getComputedStyle(document.querySelector(selector)).opacity)===1));
  };
  try {
    await entrance();
    for (const mode of ['dark','light']) {
      await page.evaluate(mode=>AxonThemes.setMode(mode),mode);
      await page.evaluate(()=>Promise.all(document.querySelector('#login-screen').getAnimations({subtree:true}).filter(animation=>animation.effect.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))));
      for (const width of [1440,960,768,700,390,320]) {
        await page.setViewportSize({width,height:width<701?844:900});
        const layout = await page.evaluate(() => {
          const screen=document.querySelector('#login-screen'),box=document.querySelector('.login-box').getBoundingClientRect();
          return {overflow:screen.scrollWidth>screen.clientWidth,boxInside:box.left>=0&&box.right<=innerWidth,inputs:[...screen.querySelectorAll('input:not(.hidden)')].map(el=>({id:el.id,height:el.getBoundingClientRect().height})),motion:getComputedStyle(document.querySelector('.login-network')).display};
        });
        assert.equal(layout.overflow,false,`${mode}/${width} horizontal overflow`);
        assert.equal(layout.boxInside,true);
        assert.ok(layout.inputs.every(input=>input.height>=44));
        const axe=await new AxeBuilder({page}).include('#login-screen').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
        const violations=axe.violations.map(v=>({id:v.id,help:v.help,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
        results.layouts.push({mode,width,...layout,violations});
        const prefix=publicOnly?'production-':'';
        if ([1440,390,320].includes(width)) await page.screenshot({path:`${output}/screens/${prefix}login-${mode}-${width}.png`});
        assert.equal(violations.length,0,JSON.stringify(violations));
      }
    }
    await page.setViewportSize({width:1440,height:900});
    await page.locator('#login-theme').click();
    assert.equal(await page.evaluate(()=>AxonThemes.current().effective),'dark');
    await page.reload();await page.locator('#username').waitFor();
    assert.equal(await page.evaluate(()=>AxonThemes.current().effective),'dark');
    results.flows.push('theme switch and persistence');
    await page.locator('#login-motion').click();
    assert.equal(await page.locator('#login-motion').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.login-signal path').first().evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    await page.locator('#login-motion').click();
    assert.equal(await page.locator('.login-signal path').first().evaluate(el=>getComputedStyle(el).animationPlayState),'running');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.login-signal path').first().evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await page.locator('#login-motion').isVisible(),false);
    results.flows.push('pause/resume and reduced motion');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('#username').focus();await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'password');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'password-toggle');
    assert.equal(await page.locator('#password-toggle').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#password').getAttribute('type'),'text');
    assert.equal(await page.locator('#password-toggle').getAttribute('aria-pressed'),'true');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#password').getAttribute('type'),'password');
    results.flows.push('keyboard focus and password visibility');
    if (!publicOnly) {
      let calls=0;
      await page.locator('#login-motion').click();
      await page.route('**/api/login',async route=>{
        calls++;await new Promise(resolve=>setTimeout(resolve,700));
        await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({ok:false,error:'Demasiados intentos fallidos — probá en 15 min'})});
      });
      await page.locator('#username').fill('qa');await page.locator('#password').fill('wrong-qa-password');
      await page.locator('#login-submit').click();
      assert.equal(await page.locator('#login-submit').isDisabled(),true);
      assert.equal(await page.locator('#login-form').getAttribute('aria-busy'),'true');
      assert.equal(await page.locator('.login-submit-spinner').evaluate(el=>getComputedStyle(el).animationPlayState),'running');
      await page.evaluate(()=>document.querySelector('#login-form').dispatchEvent(new Event('submit',{cancelable:true})));
      await page.locator('#login-error').filter({hasText:'Demasiados'}).waitFor();
      assert.equal(calls,1);assert.equal(await page.locator('#login-submit').isEnabled(),true);
      const errorScan=await new AxeBuilder({page}).include('#login-screen').analyze();
      assert.equal(errorScan.violations.length,0,JSON.stringify(errorScan.violations));
      results.flows.push('loading, duplicate prevention, rate-limit error and accessible recovery (simulated response)');
      await page.locator('#login-motion').click();
      await page.unroute('**/api/login');
      await page.route('**/api/login',route=>route.abort('failed'));
      await page.locator('#login-submit').click();
      await page.locator('#login-error').filter({hasText:'Sin conexión'}).waitFor();
      assert.equal(await page.locator('#login-submit').isEnabled(),true);
      results.flows.push('connection error recovery (simulated network failure)');
      await page.unroute('**/api/login');
      await page.route('**/api/me',async route=>{
        const response=await route.fetch();const body=await response.json();
        await route.fulfill({response,json:{...body,totpEnabled:true}});
      });
      await entrance();
      assert.equal(await page.locator('#login-code').isVisible(),true);
      assert.equal(await page.locator('#login-code').getAttribute('required'),'');
      await page.locator('#login-code').fill('123');
      assert.equal(await page.locator('#login-code').evaluate(el=>el.checkValidity()),false);
      await page.locator('#login-code').fill('123456');
      assert.equal(await page.locator('#login-code').evaluate(el=>el.checkValidity()),true);
      assert.equal((await new AxeBuilder({page}).include('#login-screen').analyze()).violations.length,0);
      await page.screenshot({path:`${output}/screens/login-2fa.png`});
      results.flows.push('second-factor visibility, helper and six-digit validation (simulated server configuration)');
      await page.unroute('**/api/me');await entrance();
      // A real rejected login exercises the original backend and session contract.
      await page.locator('#username').fill('qa');await page.locator('#password').fill('wrong-qa-password');
      await page.locator('#login-submit').click();
      await page.locator('#login-error').filter({hasText:'Credenciales inválidas'}).waitFor();
      assert.equal(await page.locator('#password').inputValue(),'wrong-qa-password');
      await page.locator('#password').fill('axon-local-qa');await page.locator('#password').press('Enter');
      await page.locator('#main-screen:not(.hidden)').waitFor({timeout:30000});
      assert.equal(await page.locator('#login-screen').isVisible(),false);
      await page.reload();await page.locator('#main-screen:not(.hidden)').waitFor();
      results.flows.push('real invalid credentials, Enter login, session cookie and reload');
      await page.request.post(base+'/api/logout');await entrance();
      results.flows.push('logout returns to new entrance');
    }
    assert.deepEqual(results.pageErrors,[]);
    results.passed=true;
  } finally {
    await fs.writeFile(`${output}/${publicOnly?'production':'local'}-checks.json`,JSON.stringify(results,null,2)+'\n');
    await context.close();await browser.close();
  }
  console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1;});
