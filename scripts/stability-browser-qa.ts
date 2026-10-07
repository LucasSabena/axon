import { createRequire } from 'node:module';
import { realpath, mkdir } from 'node:fs/promises';
import { SECTIONS } from '../public/navigation-model.js';

const entry = process.env.AXON_QA_PLAYWRIGHT_ENTRY;
if (!entry) throw new Error('Set AXON_QA_PLAYWRIGHT_ENTRY to the installed Playwright entrypoint');
const { chromium } = createRequire(await realpath(entry))('playwright');
const origin = process.env.AXON_QA_ORIGIN || 'http://127.0.0.1:3459';
const output = process.env.AXON_QA_OUTPUT || '/tmp/axon-stability-20261006/local';
await mkdir(output,{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext({viewport:{width:1440,height:960},serviceWorkers:'block'});
const errors: string[] = [], apiErrors: {url:string;status:number}[] = [], checks: string[] = [];
let page;
try {
  if (new URL(origin).hostname === '127.0.0.1') {
    const login = await context.request.post(origin+'/api/login',{data:{username:'qa',password:'axon-local-qa'},headers:{Origin:origin}});
    if (!login.ok()) throw new Error('QA login failed');
  } else {
    // Remote origin: we mint the session cookie locally, which needs the
    // same SESSION_SECRET the target server uses. Without it src/auth
    // throws at import time — say why instead.
    if (!process.env.SESSION_SECRET)
      throw new Error('AXON_QA_ORIGIN is remote: set SESSION_SECRET (the target server\'s secret) so a session cookie can be minted');
    const { createSession } = await import('../src/auth');
    const config = await Bun.file('data/config.json').json();
    await context.addCookies([{name:'axon_session',value:await createSession(config.auth.username),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  }
  page = await context.newPage();
  page.on('pageerror',(e:Error)=>errors.push(e.stack || e.message));
  page.on('response',r=>{if(r.url().startsWith(origin+'/api/') && r.status()>=400)apiErrors.push({url:new URL(r.url()).pathname,status:r.status()});});
  // Keep an image pending after DOMContentLoaded. Before the fix the URL
  // says projects while the visible section stays ports, even after load.
  let release!:()=>void;
  const pending = new Promise<void>(resolve=>release=resolve);
  await page.route('**/stability-slow.png',async route=>{await pending;await route.fulfill({status:204});});
  await page.route(origin+'/proyectos',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace(/<body[^>]*>/,m=>m+'<img src="/stability-slow.png">')});});
  await page.goto(origin+'/proyectos',{waitUntil:'domcontentloaded'});
  await page.locator('#main-screen:not(.hidden)').waitFor();
  await page.waitForFunction(()=>window['AxonNavigation']?.ready);
  const slow = await page.evaluate(()=>({dom:document.readyState,section:document.querySelector('.tab-content.active')?.id}));
  release();
  if(slow.dom!=='interactive'||slow.section!=='tab-projects')throw new Error('Late navigation boot regression: '+JSON.stringify(slow));
  checks.push('Navigation starts during interactive with pending resources');
  await page.unrouteAll({behavior:'wait'});
  let failedDownloads=0;
  await page.route('**/dashboard.js*',async route=>{
    if(failedDownloads++<2)await route.fulfill({status:503,body:'temporarily unavailable'});
    else await route.continue();
  });
  await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window['AxonNavigation']?.ready && window['AxonNavigation'].current?.section==='dashboard',undefined,{timeout:30000});
  await page.waitForFunction(()=>Boolean(window['AxonPages']?.dashboard && window['AxonPages']?.logs && window['AxonPages']?.access));
  checks.push('Failed feature download retries without breaking dependent modules');
  await page.unrouteAll({behavior:'wait'});
  for (const [section,[pathname]] of Object.entries(SECTIONS)) {
    await page.goto(origin+pathname,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(s=>window['AxonNavigation']?.ready && window['AxonNavigation'].current?.section===s,section,{timeout:30000});
    if(await page.locator('.tab-content.active').getAttribute('id')!=='tab-'+section)throw new Error('Wrong section: '+section);
    if(section==='terminal'||section==='logs')await page.locator('.xterm').waitFor();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(s=>window['AxonNavigation']?.ready && window['AxonNavigation'].current?.section===s,section,{timeout:30000});
    if(await page.locator('.tab-content.active').getAttribute('id')!=='tab-'+section)throw new Error('Wrong reload section: '+section);
    if(section==='terminal'||section==='logs')await page.locator('.xterm').waitFor();
    checks.push(section+': deep link and reload');
    console.log('PASS '+section);
  }
  await page.goto(origin+'/proyectos',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window['AxonNavigation']?.ready && !window['AxonNavigation'].applying);
  await page.locator('a[data-tab="docker"]').click();
  await page.waitForURL('**/docker');
  await page.locator('a[data-tab="domains"]').click();
  await page.waitForURL('**/dominios');
  await page.goBack({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window['AxonNavigation'].current.section==='docker' && document.querySelector('.tab-content.active')?.id==='tab-docker');
  await page.goForward({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window['AxonNavigation'].current.section==='domains' && document.querySelector('.tab-content.active')?.id==='tab-domains');
  checks.push('Sidebar + Back + Forward');
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    await page.goto(origin+'/proyectos',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window['AxonNavigation']?.ready);
    await page.waitForFunction(()=>document.querySelector('#projects-updated')?.textContent.includes('Actualizado'));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    if(overflow)throw new Error('Mobile overflow: '+width);
    await page.screenshot({path:output+'/mobile-'+width+'.png'});
    checks.push('Mobile '+width+'px');
  }
  const offlineContext=await browser.newContext({serviceWorkers:'allow'});
  try {
    await offlineContext.addCookies(await context.cookies());
    const offlinePage=await offlineContext.newPage();
    offlinePage.on('pageerror',(e:Error)=>errors.push(e.message));
    await offlinePage.goto(origin+'/proyectos',{waitUntil:'domcontentloaded'});
    await offlinePage.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),undefined,{timeout:30000});
    await offlineContext.setOffline(true);
    await offlinePage.goto(origin+'/proyectos',{waitUntil:'domcontentloaded'});
    if(!await offlinePage.locator('#m').textContent().then(t=>t?.includes('Reintentando automáticamente')))throw new Error('Missing offline recovery screen');
    await offlineContext.setOffline(false);
    await offlinePage.waitForFunction(()=>window['AxonNavigation']?.current?.section==='projects',undefined,{timeout:15000});
    if(new URL(offlinePage.url()).pathname!=='/proyectos')throw new Error('Offline recovery lost URL');
    checks.push('Service worker offline recovery retains the route and returns automatically');
  } finally { await offlineContext.close(); }
  await Bun.write(output+'/report.json',JSON.stringify({origin,checks,errors,apiErrors,slowBoot:slow,operationalActions:0},null,2));
  if(errors.length||apiErrors.length)throw new Error('Browser errors: '+errors.join('; ')+(apiErrors.length?` | API errors: ${apiErrors.map(e=>`${e.status} ${e.url}`).join('; ')}`:''));
  console.log(JSON.stringify({origin,passed:checks.length,browserErrors:errors.length,apiErrors}));
} catch(error) {
  await Bun.write(output+'/failure.json',JSON.stringify({error:String(error),checks,errors,apiErrors,state:await page?.evaluate(()=>({url:location.href,boot:document.querySelector('#boot-message')?.textContent,loginVisible:!document.querySelector('#login-screen')?.classList.contains('hidden'),mainVisible:!document.querySelector('#main-screen')?.classList.contains('hidden')})).catch(()=>null)},null,2));
  await page?.screenshot({path:output+'/failure.png'}).catch(()=>{});
  throw error;
} finally {await context.close();await browser.close();}
