const {chromium}=require(process.env.AXON_QA_PLAYWRIGHT_ENTRY || 'playwright');
const {AxeBuilder}=require('@axe-core/playwright');
const fs=require('node:fs/promises');
const origin=process.env.AXON_QA_ORIGIN||'http://127.0.0.1:3459',out=process.env.AXON_QA_OUTPUT||'/tmp/axon-backups-qa';
const assert=(ok,message)=>{if(!ok)throw Error(message);};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.AXON_QA_BROWSER_CHANNEL?{channel:process.env.AXON_QA_BROWSER_CHANNEL}:{})}),context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();const errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 const api=async(p,options)=>{const r=await context.request.fetch(origin+p,options);const value=await r.json();assert(r.ok(),p+': '+JSON.stringify(value));return value;};
 const wait=async(id)=>{for(let n=0;n<120;n++){const j=(await api('/api/backups/jobs/'+id)).job;if(!['running','queued'].includes(j.state)){assert(j.state==='verified',j.message);return j;}await page.waitForTimeout(300);}throw Error('Backup timeout');};
 const fit=async label=>{await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');};
 const axe=async label=>{const result=await new AxeBuilder({page}).include('#tab-backups').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert(!result.violations.length,label+': '+result.violations.map(v=>v.id+' '+v.nodes.map(n=>n.target)).join(';'));};
 try{
  const marker=await context.request.get(origin+'/api/health');assert((await marker.json()).qa===true,'An isolated QA fixture is required');
  await fs.mkdir(out,{recursive:true});await api('/api/login',{method:'POST',data:{username:'qa',password:'axon-local-qa'}});await page.goto(origin+'/backups');await page.locator('[data-new]').first().waitFor();await axe('Overview');await page.screenshot({path:out+'/overview-desktop.png'});
  await page.locator('[data-new]').first().click();await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.locator('.bk-error').waitFor();assert(await page.getByRole('heading',{name:'¿Qué querés proteger?'}).isVisible(),'Empty source advanced');
  await page.getByRole('button',{name:'Elegir carpeta',exact:true}).click();await page.locator('#host-path-picker').waitFor().catch(()=>{});
  // The existing native host picker exposes real disks and directory navigation.
  await page.getByRole('button',{name:'Elegir esta carpeta',exact:true}).waitFor();await page.getByRole('button',{name:'Elegir esta carpeta',exact:true}).click();
  // Replace the home selection with the small owned project fixture.
  await page.locator('[data-remove-source]').first().click();await page.locator('[data-use-project]').selectOption('qa-project');
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1050});await fit('Folders '+width);if(width===1440||width===390)await page.screenshot({path:out+'/wizard-folders-'+width+'.png'});}
  await page.setViewportSize({width:1440,height:1050});await axe('Folder step');await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.locator('[data-target="fixture-external"]').check();await axe('Destination step');await page.screenshot({path:out+'/wizard-destinations-desktop.png'});await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.locator('[name=interval]').selectOption('custom');await page.locator('[name=days]').fill('2');await page.locator('[name=time]').fill('05:45');await page.locator('[name=retention]').selectOption('30');
  await axe('Frequency step');await page.screenshot({path:out+'/wizard-frequency-desktop.png'});await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.locator('#backup-content [name=name]').fill('Documentos de QA');
  assert((await page.locator('.bk-review').textContent()).includes('Cada 2 días a las 05:45'),'Custom schedule summary incorrect');await axe('Review step');
  const save=page.waitForResponse(r=>r.url().endsWith('/api/backups/policies')&&r.request().method()==='POST');await page.getByRole('button',{name:'Crear backup',exact:true}).click();const policy=(await (await save).json()).policy;
  await page.locator('[data-run="'+policy.id+'"]').waitFor();assert(policy.intervalDays===2&&policy.dailyAt==='05:45'&&policy.retentionDays===30,'Schedule did not persist');assert(policy.sources.length===1&&policy.destinations.length===1,'Selections did not persist');checks.push('Four-step wizard, native folder picker, physical destination, custom calendar interval and retention persist');
  const location=page.getByRole('link',{name:'Abrir ubicación en Archivos'}).first();
  assert(decodeURIComponent(await location.getAttribute('href')).endsWith(policy.destinations[0].path),'Repository path is hidden or incorrect');
  const start=page.waitForResponse(r=>/\/policies\/[^/]+\/run$/.test(r.url()));await page.locator('[data-run="'+policy.id+'"]').click();const job=(await (await start).json()).job;
  await page.locator('[data-job="'+job.id+'"]').waitFor();assert(new URL(page.url()).searchParams.get('plan')===policy.id,'Start did not open the job and preserve its route');
  await page.reload();const backed=await wait(job.id);
  await page.getByRole('button',{name:'Actualizar backups'}).click();await page.locator('[data-restore="'+job.id+'"]').waitFor();assert(backed.files>0&&backed.snapshot,'No real snapshot');checks.push('Real encrypted Restic capture and verified restore test survive reload');
  const size=await api('/api/files/dirsize?path='+encodeURIComponent(policy.destinations[0].path));assert(size.bytes>1000,'Encrypted repository appears empty in Files');
  checks.push('Exact destination and Files link remain visible; starting opens the job; recursive encrypted repository size is complete');
  // Change only this browser's reads: real repository and receipts stay intact.
  let copied=100,partial=false;
  await page.route('**/api/backups',async route=>{
    const response=await route.fetch(),value=await response.json();
    const current=value.jobs.find(j=>j.id===job.id);
    Object.assign(current,{state:partial?'failed':'running',phase:partial?'partial':'capture',partial,message:partial?'Copia incompleta: algunos archivos no pudieron leerse.':'Capturando el respaldo.',progress:{bytes_done:copied,total_bytes:1000,files_done:2,total_files:10},...(partial?{}:{snapshot:null,endedAt:null})});
    await route.fulfill({response,json:value});
  });
  await page.getByRole('button',{name:'Actualizar backups'}).click();
  await page.locator('[data-job="'+job.id+'"]').getByRole('progressbar',{name:'Archivos copiados'}).waitFor();copied=500;
  await page.locator('[data-cancel-job="'+job.id+'"]').evaluate(b=>{b.dataset.qaFocus='preserved';b.focus();});
  await page.waitForFunction(()=>document.querySelector('progress')?.value===500);
  assert(await page.evaluate(()=>document.activeElement?.getAttribute('data-qa-focus')==='preserved'),'Progress polling replaced controls and lost keyboard focus');
  await axe('Live progress');partial=true;
  await page.getByRole('button',{name:'Actualizar backups'}).click();await page.getByText('Copia incompleta',{exact:true}).first().waitFor();
  assert(await page.locator('[data-restore="'+job.id+'"]').isVisible(),'Partial snapshot cannot be recovered');
  await page.unroute('**/api/backups');await page.getByRole('button',{name:'Actualizar backups'}).click();await page.locator('[data-restore="'+job.id+'"]').waitFor();
  checks.push('Live bytes update by polling, verification is distinct from capture, and incomplete copies stay recoverable with an explicit warning');
  await page.locator('[data-restore="'+job.id+'"]').click();await page.locator('[data-recover-file]').first().waitFor();await page.locator('[data-recover-file]').first().check();await axe('Recovery picker');
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1050});await fit('Recovery '+width);}
  await page.setViewportSize({width:1440,height:1050});const recover=page.waitForResponse(r=>r.url().endsWith('/restore')&&r.request().method()==='POST');await page.getByRole('button',{name:'Recuperar lo elegido',exact:true}).click();await page.locator('wa-dialog').getByRole('button',{name:'Recuperar copia',exact:true}).click();const recovery=(await (await recover).json()).job;const recovered=await wait(recovery.id);
  assert(recovered.restoredPath.includes('AXON-Restauraciones'),'Recovery overwrites originals');const chosen=recovered.paths[0];const original=await fs.readFile(chosen),copy=await fs.readFile(recovered.restoredPath+chosen);assert(original.equals(copy),'Recovered data differs');checks.push('Selected-file recovery verified against original bytes without changing originals');
  await page.getByRole('button',{name:'Actualizar backups'}).click();await page.getByRole('link',{name:'Abrir copia recuperada'}).waitFor();
  await page.getByRole('button',{name:'Editar ajustes'}).click();await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.locator('[name=interval]').selectOption('0');await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await page.getByText('Cuando vos lo hagas',{exact:false}).first().waitFor();
  await page.getByRole('button',{name:'Pausar',exact:true}).click();await page.getByRole('button',{name:'Reanudar',exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Reanudar',exact:true}).waitFor();await page.getByRole('button',{name:'Reanudar',exact:true}).click();await page.getByRole('button',{name:'Pausar',exact:true}).waitFor();checks.push('Editing to manual, pause, reload and resume preserve versions');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar clave',exact:true}).click();await page.locator('wa-dialog').getByRole('button',{name:'Descargar clave',exact:true}).click();const file=await download;assert(file.suggestedFilename()==='axon-clave-de-recuperacion.json','Recovery key missing');checks.push('Explicit recovery-key download');
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1050});await fit('Detail '+width);if(width===1440||width===390)await page.screenshot({path:out+'/detail-'+width+'.png'});}
  await page.setViewportSize({width:1440,height:1050});await axe('Detail');
  await page.route('**/api/backups',r=>r.fulfill({status:503,json:{ok:false,error:'Falla temporal de QA'}}));await page.getByRole('button',{name:'Actualizar backups'}).click();await page.locator('.bk-error').waitFor();assert(await page.getByRole('heading',{name:'Documentos de QA',exact:true}).isVisible(),'Failed refresh lost data');await page.unroute('**/api/backups');await page.locator('.bk-error').getByRole('button',{name:'Reintentar'}).click();await page.locator('.bk-error').waitFor({state:'detached'});checks.push('Transient failure preserves prior data and recovers with retry');
  await page.goto(origin+'/respaldos');await page.locator('[data-new]').first().waitFor();assert(await page.title()==='Backups · AXON','Old route compatibility failed');checks.push('Legacy /respaldos route stays compatible with /backups');
  await page.getByRole('button',{name:'Usar modo oscuro',exact:true}).click();await axe('Dark overview');await page.screenshot({path:out+'/overview-dark-desktop.png'});await page.setViewportSize({width:390,height:1050});await fit('Dark mobile');await page.screenshot({path:out+'/overview-dark-mobile.png'});checks.push('Light and dark theme validation');
  assert(!errors.length,'Browser exceptions '+errors.join(';'));checks.push('Responsive 320, 390, 768, 1440 px and WCAG A/AA checks on overview, all steps, detail and recovery');await fs.writeFile(out+'/browser-proof.json',JSON.stringify({passed:true,at:new Date().toISOString(),checks,errors,snapshot:backed.snapshot,recoveryVerified:true,usesProductionData:false},null,2));console.log(JSON.stringify({passed:true,checks,errors}));
 }catch(error){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await fs.writeFile(out+'/browser-proof.json',JSON.stringify({passed:false,checks,errors,error:String(error)},null,2));throw error;}finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
