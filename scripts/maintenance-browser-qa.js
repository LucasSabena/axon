async page => {
  if(new URL(page.url()).host!=='127.0.0.1:3459')throw new Error('Use isolated QA server');
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  const errors=[];const capture=e=>errors.push(e.message);page.on('pageerror',capture);const checks=[];
  await page.goto('http://127.0.0.1:3459/almacenamiento');
  if(await page.getByRole('button',{name:'Ingresar',exact:true}).isVisible()){
    await page.getByRole('textbox',{name:'Usuario',exact:true}).fill('qa');await page.getByRole('textbox',{name:'Contraseña',exact:true}).fill('axon-local-qa');await page.getByRole('button',{name:'Ingresar',exact:true}).click();
  }
  await page.evaluate(async()=>{const old=await fetch('/api/home/links').then(r=>r.json());await fetch('/api/home/links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({links:[],revision:old.revision})});});
  await page.locator('#tab-storage.active').waitFor();
  await page.getByRole('button',{name:'Analizar',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#storage-status')?.textContent.startsWith('Finalizado'));
  assert(await page.locator('#storage-content [data-candidate]').count()===2,'Fixture scan has two entries');
  const scanUrl=page.url();await page.locator('[data-candidate]').first().check();
  await page.getByRole('button',{name:'Ver cambios',exact:true}).click();await page.locator('#storage-execute').waitFor();
  assert(!await page.locator('#storage-execute').isDisabled(),'Confined fixture cleaner must be available');
  assert((await page.locator('#storage-plan').innerText()).includes('permanentemente'),'Irreversible scope must be visible');checks.push('Scan → selección → plan durable con alcance irreversible visible');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#storage-status')?.textContent.startsWith('Finalizado'));
  assert(page.url()===scanUrl,'Reload preserves scan URL');assert(await page.locator('[data-candidate]:checked').count()===0,'No approval or selection leaks across reload');checks.push('Recarga conserva el análisis sin trasladar aprobación');
  await page.locator('[data-view="history"]').click();await page.locator('#storage-content').getByText('Historial durable').waitFor();assert((await page.locator('#storage-content').innerText()).includes('Plan preparado'),'Plan appears in history');
  await page.goBack();await page.locator('#storage-root').waitFor();await page.goForward();await page.locator('#storage-content').getByText('Historial durable').waitFor();checks.push('Historial y Atrás/Adelante');
  await page.goto('http://127.0.0.1:3459/');await page.locator('#home-links-panel').waitFor();
  await page.getByText('Agregar o editar un acceso',{exact:true}).click();
  const form=page.locator('#home-links-form');await form.locator('[name=name]').fill('Servicio QA');await form.locator('[name=url]').fill('https://qa.example.test/');await form.locator('[name=group]').fill('Pruebas');await form.getByRole('button',{name:'Guardar acceso'}).click();await page.locator('.maint-link-row').filter({hasText:'Servicio QA'}).waitFor();
  await page.locator('.maint-link-row').filter({hasText:'Servicio QA'}).locator('[data-action=favorite]').click();
  await page.waitForFunction(()=>document.querySelector('#home-links-list')?.textContent.includes('★ Servicio QA'));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#home-links-list')?.textContent.includes('★ Servicio QA'));checks.push('Acceso y favorito persistidos tras recarga');
  await page.getByText('Importar accesos de Homepage',{exact:true}).click();
  await page.locator('#home-links-source').fill('- Grupo QA:\n  - Importado:\n      href: https://import.example.test/?token=fixture-secret\n      widget:\n        password: fixture-password\n');
  await page.locator('#home-links-preview').click();await page.locator('#home-links-import').waitFor();const preview=await page.locator('#home-links-preview-content').innerText();assert(!preview.includes('fixture-secret')&&!preview.includes('fixture-password'),'Secrets cannot reach import preview');assert(await page.locator('#home-links-source').inputValue()==='','Clear raw import source');await page.locator('#home-links-import').click();await page.locator('.maint-link-row').filter({hasText:'Importado'}).waitFor();checks.push('Importación revisada y saneada de Homepage');
  await page.locator('#home-links-source').fill('- Marcadores:\n  - Nombre importado:\n    - href: https://qa.example.test/\n  - Marcador QA:\n    - href: https://bookmark.example.test/\n');
  await page.locator('#home-links-preview').click();await page.locator('#home-links-import').waitFor();await page.locator('#home-links-import').click();
  await page.locator('.maint-link-row').filter({hasText:'Marcador QA'}).waitFor();
  assert((await page.locator('#home-links-list').innerText()).includes('★ Servicio QA'),'Import keeps existing favorite/name');
  assert(!(await page.locator('#home-links-list').innerText()).includes('Nombre importado'),'Duplicate does not replace a customized access');
  checks.push('bookmarks.yaml importado sin pisar nombres, favoritos ni orden existentes');
  await page.getByText('Agregar desde Dominios y servicios',{exact:true}).click();
  assert((await page.locator('#home-sources-list').innerText()).includes('No hay dominios configurados'),'QA has no real domains or extra probes');
  checks.push('Integración de accesos con dominios sin disparar nuevas consultas');
  const security=await page.evaluate(async()=>{
    const r=await fetch('/api/docker/fixture/restart',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const old=await fetch('/api/home/links').then(r=>r.json());
    const a=await fetch('/api/home/links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({links:[...old.links,{name:'Otro',url:'https://other.example.test',group:'Pruebas'}],revision:old.revision})});
    const stale=await fetch('/api/home/links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({links:[],revision:old.revision})});return {blocked:r.status,write:a.status,stale:stale.status};
  });assert(security.blocked===403&&security.write===200&&security.stale===409,'Server QA boundary and concurrent edits');checks.push('Backend QA bloquea restart; edición concurrente responde 409');
  await page.goto('http://127.0.0.1:3459/programas');await page.locator('[data-compare=homepage]').waitFor({state:'attached'});await page.locator('#migration-apps details').first().locator('summary').click();await page.locator('[data-compare=homepage]').click();await page.waitForFunction(()=>document.querySelector('#migration-status').textContent.includes('Comparación guardada'));
  await page.locator('#migration-apps details').first().locator('summary').click();assert((await page.locator('#migration-apps').innerText()).includes('con brechas pendientes'),'Migration must preserve gaps');checks.push('Comparación persistida de instalación fixture sin declarar retirada');
  await page.goto(scanUrl);await page.locator('#tab-storage.active').waitFor();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow at '+width);checks.push('Almacenamiento sin overflow a '+width+' px');}
  await page.setViewportSize({width:800,height:700});await page.evaluate(()=>document.documentElement.style.zoom='2');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% zoom overflows');await page.evaluate(()=>document.documentElement.style.zoom='');checks.push('Zoom 200% sin overflow');
  await page.setViewportSize({width:1440,height:1000});await page.locator('#storage-filter').focus();await page.keyboard.type('cache');await page.waitForTimeout(650);assert((await page.locator('#storage-content').innerText()).includes('cache-demo.bin'),'Filter applies');await page.reload();await page.waitForFunction(()=>document.querySelector('#storage-filter')?.value==='cache');checks.push('Filtro persistido en URL y recarga');
  await page.goto('http://127.0.0.1:3459/almacenamiento?view=cleanup');await page.locator('#storage-migrate-review').waitFor();
  const legacyChoices=page.locator('[data-trash-migrate]');
  if(await legacyChoices.count()){
    assert(await legacyChoices.count()===2,'QA starts with two legacy items');await legacyChoices.first().check();
    await page.locator('#storage-migrate-review').click();await page.locator('#storage-migrate-execute').waitFor();
    assert((await page.locator('#storage-plan').innerText()).includes('No libera espacio'),'Migration does not claim disk recovery');
    await page.locator('#storage-migrate-execute').click();await page.waitForFunction(()=>document.querySelector('#storage-status')?.textContent.includes('Origen y fecha conservados'));
    assert(await page.locator('[data-trash-migrate]').count()===1,'Unselected legacy item remains');
    await page.reload();await page.locator('#storage-migrate-review').waitFor();assert(await page.locator('[data-trash-migrate]').count()===1,'Migration persists across reload');
    await page.locator('[data-trash-restore^="xdg:"]').click();await page.locator('#confirm-ok').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-trash-restore^="xdg:"]').length===0);
    checks.push('Backend fixture: migración legacy seleccionada, recarga y restauración XDG sin mover el no seleccionado');
  } else throw new Error('Restart QA server to restore the owned legacy fixtures');
  await page.goto(scanUrl);
  const prior=page.url();await page.route('**/api/storage/overview',route=>route.abort());await page.reload();await page.waitForFunction(()=>document.querySelector('#storage-status')?.textContent.includes('Sin conexión'));await page.unroute('**/api/storage/overview');await page.goto(prior);checks.push('Error de red visible y reintento recuperable');
  const composePath='/tmp/qa-compose-fixture/compose.yml',before='services:\n  fixture:\n    image: example:old\n',after='services:\n  fixture:\n    image: example:new\n';
  let draftDiscarded=false;
  const mockCompose=async route=>{
    const u=new URL(route.request().url());let data;
    if(u.pathname==='/api/compose')data={ok:true,projects:[{project:'Fixture QA',path:composePath,configFile:composePath,services:[],source:'disk'}]};
    else if(u.pathname==='/api/compose/releases')data={ok:true,operations:[]};
    else if(u.pathname==='/api/compose/file')data={ok:true,path:composePath,content:draftDiscarded?before:after,revision:'fixture',draft:!draftDiscarded};
    else if(u.pathname==='/api/compose/draft-discard'){draftDiscarded=true;data={ok:true,discarded:true,applied:false};}
    else if(u.pathname==='/api/compose/draft-preview')data={ok:true,draft:{},before,after,changedOnHost:false,canApply:false,blockers:['Fixture: aplicar y rollback pendientes.']};
    else if(u.pathname==='/api/compose/preview')data={ok:true,draft:true,error:'Borrador: validación local solamente.',services:[]};
    else throw new Error('Unexpected Compose UI request: '+u.pathname);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  };
  await page.route('**/api/compose**',mockCompose);await page.goto('http://127.0.0.1:3459/compose');await page.locator('.cp-edit').click();
  await page.locator('#cp-ed-validate').click();await page.waitForFunction(()=>document.querySelector('#cp-ed-banner').textContent.includes('validación local solamente'));
  assert(!(await page.locator('#cp-ed-banner').getAttribute('class')).includes('cp-banner-ok'),'Draft local validation must not turn green as Docker validation');
  await page.locator('#cp-ed-compare').click();await page.locator('#cp-pv-comparison').waitFor({state:'visible'});
  assert(await page.locator('#cp-pv-before').textContent()===before,'Comparison shows original');assert(await page.locator('#cp-pv-after').textContent()===after,'Comparison shows draft');
  await page.setViewportSize({width:320,height:844});await page.waitForTimeout(200);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Compose comparison overflows mobile');
  await page.locator('#cp-pv-edit').click();await page.locator('#cp-ed-discard').click();await page.locator('#confirm-ok').click();
  await page.waitForFunction(()=>document.querySelector('#cp-ed-banner').textContent.includes('Borrador descartado'));
  assert(await page.locator('#cp-ed-text').inputValue()===before,'Discard restores the view of the original');
  assert(await page.locator('#cp-ed-discard').isDisabled(),'No duplicate discard without a draft');
  checks.push('Compose UI con HTTP fixture: comparación host/borrador, descarte, validación honesta y móvil; backend probado por separado');
  await page.unroute('**/api/compose**',mockCompose);await page.setViewportSize({width:1440,height:1000});await page.goto(prior);
  assert(!errors.length,'Browser errors: '+errors.join('; '));page.off('pageerror',capture);
  await page.evaluate(report=>{window.__maintenanceQaReport=report;},{at:new Date().toISOString(),checks,errors,fixtureOnly:true,hostMutations:0});
}
