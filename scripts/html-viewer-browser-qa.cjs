const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const origin = process.env.AXON_QA_ORIGIN || 'http://127.0.0.1:3459';
const assert = (ok, message) => { if (!ok) throw Error(message); };
(async () => {
 const browser = await chromium.launch({headless:true,channel:'chrome'}); let fixture;
 try {
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  assert((await (await context.request.get(origin+'/api/health')).json()).qa, 'QA server required');
  await context.request.post(origin+'/api/login',{data:{username:'qa',password:'axon-local-qa'}});
  const home=(await (await context.request.get(origin+'/api/files')).json()).home;
  assert(await fs.readFile(home+'/.axon-qa-owned','utf8')==='isolated-qa-v1','Owned fixture required');
  fixture=await fs.mkdtemp(path.join(home,'media','html-qa-'));
  await fs.mkdir(fixture+'/assets');
  await fs.writeFile(fixture+'/assets/style.css','@import "nested.css"; h1 {color:rgb(12, 34, 56)} body{background:#fff;margin:20px}');
  await fs.writeFile(fixture+'/assets/nested.css','h1{border:3px solid rgb(70,80,90)}');
  await fs.writeFile(fixture+'/assets/pic.svg','<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>');
  const sample='<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="assets/style.css"></head><body><h1>Diseño HTML</h1><img src="assets/pic.svg"><script>parent.htmlExecuted=true;fetch("/api/config")</script><img src="missing" onerror="parent.htmlExecuted=true"><form action="/api/logout" method="post"><button>Enviar</button></form></body></html>';
  for(const name of ['pagina.html','alias.HTM']) await fs.writeFile(fixture+'/'+name,sample);
  await fs.writeFile(fixture+'/vacio.html',''); await fs.writeFile(fixture+'/grande.html',sample+'x'.repeat(530000));
  await fs.writeFile(fixture+'/binario.html',Buffer.from([0,1,255]));
  const page=await context.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const url=name=>origin+'/archivos?'+new URLSearchParams({path:fixture,item:name,view:'list'});
  async function open(name) {await page.goto(url(name));await page.waitForFunction(()=>window.AxonNavigation?.ready&&!window.AxonNavigation.applying);}
  await open('pagina.html');
  const frame=page.frameLocator('#fm-editor-preview iframe');
  await frame.locator('h1').waitFor();
  await page.waitForTimeout(300);
  assert(await frame.locator('h1').evaluate(el=>getComputedStyle(el).color)==='rgb(12, 34, 56)','Relative CSS failed');
  assert(await frame.locator('h1').evaluate(el=>getComputedStyle(el).borderTopWidth)==='3px','Nested CSS import failed');
  assert(await frame.locator('img').first().evaluate(el=>el.complete&&el.naturalWidth===80),'Relative image failed');
  assert(await page.locator('#fm-editor-preview iframe').getAttribute('sandbox')==='allow-same-origin','Sandbox missing');
  assert(!await page.evaluate(()=>window.htmlExecuted),'Script escaped preview');
  await page.getByRole('button',{name:'Editor',exact:true}).click();
  const textarea=page.locator('#fm-editor-text'); const original=await textarea.inputValue();
  await textarea.fill(original.replace('Diseño HTML','Borrador sin guardar'));
  await page.keyboard.press('Control+e');await frame.getByRole('heading',{name:'Borrador sin guardar'}).waitFor();
  assert((await(await context.request.get(origin+'/api/files/read?path='+encodeURIComponent(fixture+'/pagina.html'))).json()).content===sample,'Preview wrote file');
  await page.getByRole('button',{name:'Editor',exact:true}).click(); await textarea.fill(original);await page.keyboard.press('Control+e');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await page.waitForTimeout(200);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Viewport overflow '+width);}
  await fs.mkdir('/tmp/axon-html-qa',{recursive:true});await page.screenshot({path:'/tmp/axon-html-qa/desktop.png'});
  for(const name of ['alias.HTM','vacio.html','grande.html']){await open(name);await page.locator('#fm-editor-preview iframe').waitFor();}
  assert((await page.locator('.fm-html-view').textContent()).includes('truncado'),'Truncation not shown');
  await open('binario.html');assert(await textarea.isVisible(),'Binary should open editor');assert(await textarea.getAttribute('readonly')!==null,'Binary editor is writable');
  await page.goto(origin+'/archivos?'+new URLSearchParams({path:fixture,view:'list'}));await page.waitForFunction(()=>window.AxonNavigation?.ready&&!window.AxonNavigation.applying);
  await page.locator('.fm-row[data-name="pagina.html"]').dblclick();await frame.getByRole('heading',{name:'Diseño HTML'}).waitFor();
  for(const ext of ['pagina.html','x.js','secret.txt'])assert((await context.request.get(origin+'/api/files/html-assets'+fixture+'/'+ext)).status()===415,'Executable/nonasset resource allowed');
  const anon=await browser.newContext();assert((await anon.request.get(origin+'/api/files/html-assets'+fixture+'/assets/style.css')).status()===401,'Unauthenticated asset allowed');await anon.close();
  assert(!errors.length,errors.join('; '));
  console.log(JSON.stringify({passed:true,checks:['default HTML view and file activation','HTML/HTM aliases','relative CSS, nested imports and SVG','sandbox and blocked scripts','draft preview without writing','editor toggle and keyboard','320/390/768/1440 layouts','empty, truncated and binary files','resource allowlist and authentication'],errors}));
 }finally{await browser.close();if(fixture)await fs.rm(fixture,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
