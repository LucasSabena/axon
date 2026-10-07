const {chromium}=require(process.env.AXON_QA_PLAYWRIGHT_ENTRY || 'playwright');
const fs=require('node:fs/promises');
const assert=(value,message)=>{if(!value)throw Error(message);};
const origin=process.env.AXON_QA_ORIGIN||'http://127.0.0.1:3459',out=process.env.AXON_QA_OUTPUT||'docs/platform-expansion-2026-10-05';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.AXON_QA_BROWSER_CHANNEL?{channel:process.env.AXON_QA_BROWSER_CHANNEL}:{})});const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 const go=async route=>{await page.evaluate(route=>AxonNavigation.go(route),route);};
 const json=async route=>{const r=await context.request.get(origin+route);assert(r.ok(),'HTTP '+r.status()+' '+route);return r.json();};
 try{
  const marker=await context.request.get(origin+'/api/health');assert((await marker.json()).qa===true,'An isolated QA fixture is required');
  await fs.mkdir(out+'/screens',{recursive:true});await page.goto(origin+'/proyectos?id=qa-project');await page.locator('#username').fill('qa');await page.locator('#password').fill('axon-local-qa');await page.locator('#login-form button[type=submit]').click();await page.locator('#project-hub h2').waitFor();
  assert(await page.locator('#project-hub h2').textContent()==='Proyecto de prueba','Wrong project');assert(await page.locator('#projects-table').isHidden(),'Project list must hide in detail');
  await page.getByRole('button',{name:'Diagnosticar aplicación',exact:true}).click();await page.locator('[data-hub-report] .platform-check').filter({hasText:'Carpeta del proyecto'}).waitFor();
  const diag=await json('/api/project-hub/qa-project/diagnostic');assert(diag.diagnostic.operationalCommandsRun===0,'Diagnosis modified services');await page.reload();await page.locator('[data-hub-report] .platform-check').filter({hasText:'Carpeta del proyecto'}).waitFor();checks.push('Reloadable project context and persistent read-only diagnosis');
  await go('/integraciones');await page.locator('[data-token-new]').click();await page.locator('#access-content form [name=name]').fill('CI de prueba');await page.getByText('Acceso a proyectos (opcional)',{exact:true}).click();await page.locator('#access-content form [name=project]').selectOption('qa-project');
  await page.locator('#access-content form [type=submit]').click();await page.locator('.platform-secret').waitFor();const token=await page.locator('.platform-secret').textContent();assert(token.startsWith('axon_'),'Missing token');await page.locator('#access-content [data-close]').click();
  const machine=await browser.newContext();const headers={authorization:'Bearer '+token};
  assert((await machine.request.get(origin+'/api/v1/projects',{headers})).status()===200,'Token project read failed');assert((await machine.request.get(origin+'/api/v1/projects/other',{headers})).status()===403,'Cross project access');assert((await machine.request.get(origin+'/api/v1/projects/qa-project/logs',{headers})).status()===403,'Scope escalation');assert((await machine.request.get(origin+'/api/config',{headers})).status()===401,'Token accepted by legacy administrator API');
  const metadata=await json('/api/access/tokens');const id=metadata.tokens.find(t=>t.name==='CI de prueba').id;await context.request.delete(origin+'/api/access/tokens/'+id);assert((await machine.request.get(origin+'/api/v1/projects',{headers})).status()===401,'Revocation ineffective');await machine.close();checks.push('Token creation UI, project and action permissions, legacy isolation and immediate revocation');
  // Backup wizard, Restic jobs and recovery are exercised by backups-browser-qa.cjs.
  for(const width of [1440,768,390,320]){
   await page.setViewportSize({width,height:950});
   for(const route of ['/proyectos?id=qa-project','/respaldos?project=qa-project','/historial?project=qa-project','/integraciones']){
    await go(route);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow '+width+' '+route);
    if(width===1440||width===390)await page.screenshot({path:out+'/screens/'+route.split('?')[0].slice(1)+'-'+width+'.png'});
   }
  }
  checks.push('Four feature views at 1440, 768, 390 and 320 px');
  await page.setViewportSize({width:1440,height:1000});await go('/integraciones');await page.route('**/api/access/tokens',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Falla temporal de prueba'})}));await page.locator('[data-token-refresh]').click();await page.locator('#access-content [role=alert]').waitFor();assert(await page.getByRole('heading',{name:'Tokens',exact:true}).isVisible(),'Transient failure erased prior data');await page.unroute('**/api/access/tokens');await page.locator('#access-content [role=alert]').getByRole('button',{name:'Reintentar'}).click();await page.locator('#access-content [role=alert]').waitFor({state:'detached'});checks.push('Transient read error preserves data and retry recovers');
  assert(errors.length===0,'Browser exceptions: '+errors.join('; '));await fs.writeFile(out+'/browser-proof.json',JSON.stringify({passed:true,at:new Date().toISOString(),checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,errors}));
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
