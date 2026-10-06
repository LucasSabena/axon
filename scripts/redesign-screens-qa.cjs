const {chromium}=require(process.env.AXON_QA_PLAYWRIGHT_ENTRY || 'playwright');
const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const out='docs/redesign-implementation-2026-10-05';await fs.mkdir(out+'/screens',{recursive:true});const checks=[];
 try {
  await page.goto('http://127.0.0.1:3459/');await page.locator('#username').waitFor();await page.screenshot({path:out+'/screens/login-light.png'});
  const loginResources=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname));
  if(loginResources.some(p=>/xterm|qrcode|feat-.*\.js|axon-ui\.js/.test(p)))throw Error('Login loaded authenticated or terminal code');
  await page.locator('#password').fill('qa-visible-test');await page.locator('#password-toggle').click();if(await page.locator('#password').getAttribute('type')!=='text')throw Error('Show password');await page.locator('#password-toggle').click();
  await page.locator('#username').fill('qa');await page.locator('#password').fill('axon-local-qa');await page.locator('#login-form button[type=submit]').click();await page.locator('#main-screen:not(.hidden)').waitFor();
  const sections=await page.evaluate(()=>Object.entries(AxonNavigation.sections).map(([id,[url,label]])=>({id,url,label})));
  if(sections.length!==20||await page.locator('.tab-btn').count()!==20)throw Error('Missing route');
  for(const mode of ['dark','light']) {
   await page.evaluate(mode=>AxonThemes.setMode(mode),mode);if(mode==='dark')await page.evaluate(()=>setTheme('axon'));if(mode==='light')await page.evaluate(()=>setTheme('paper'));
   for(const section of sections) {
    await page.evaluate(url=>AxonNavigation.go(url),section.url);await page.locator('#tab-'+section.id+'.active').waitFor();
    await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
    const info=await page.evaluate(id=>{const sec=document.getElementById('tab-'+id);return {controls:sec.querySelectorAll('button,input,select,a').length,active:document.querySelectorAll('.tab-content.active').length,overflow:document.documentElement.scrollWidth>innerWidth,heading:sec.querySelector('h1,h2,h3')?.textContent};},section.id);
    if(info.overflow||info.active!==1)throw Error('Invalid layout '+mode+' '+section.id);
    await page.screenshot({path:out+'/screens/'+section.id+'-'+mode+'.png'});checks.push({...section,mode,...info});
   }
  }
  for(const width of [320,390,768]) {
   await page.setViewportSize({width,height:900});
   for(const section of sections) {
    await page.evaluate(url=>AxonNavigation.go(url),section.url);await page.locator('#tab-'+section.id+'.active').waitFor();
    const good=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);if(!good)throw Error('Mobile overflow '+width+' '+section.id);
    if(width===390)await page.screenshot({path:out+'/screens/'+section.id+'-mobile.png'});
    checks.push({id:section.id,width,overflow:false});
   }
  }
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>AxonNavigation.go('/'));
  await page.locator('#account-menu [slot=trigger]').click();await page.getByRole('menuitem',{name:'Vincular dispositivo',exact:true}).click();await page.locator('#pair-modal:not(.hidden)').waitFor();await page.locator('#pair-close').click();
  // Group preferences remain reversible and the selected route always opens its group.
  await page.locator('.nav-group-toggle').first().click();await page.evaluate(()=>AxonNavigation.go('/archivos'));if(await page.locator('#nav-group-projects').getAttribute('hidden')!==null)throw Error('Active route hidden');
  if(errors.length)throw Error('Browser errors '+errors.join('; '));
  await fs.writeFile(out+'/screen-matrix.json',JSON.stringify({passed:true,checks,errors,loginResources},null,2)+'\n');console.log(JSON.stringify({passed:true,views:40,responsiveChecks:60,errors}));
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
