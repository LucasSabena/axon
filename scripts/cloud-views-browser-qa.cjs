async (page) => {
  const assert=(v,m)=>{if(!v)throw new Error(m);},output='docs/qa/cloud-views-2026-10-06';
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:960});
  const provider={id:'dropbox',name:'Dropbox',configured:true,connected:true,visible:true,account:{name:'Cuenta de prueba',email:'qa@example.test'},sources:[{id:'account',name:'Mi Dropbox',type:'account'}]};
  const entry=(name,type,size,modified)=>({name,path:'/'+name,type,size,modified,downloadable:true});
  const entries=['Clientes','Batev','Costos','Documentos','Dormi','Exportaciones','Informes','Manuales'].map(n=>entry(n,'dir',0,null));
  entries.push(entry('Presupuesto 2.pdf','file',8192,'2026-09-10T12:00:00Z'),entry('Presupuesto 12.pdf','file',4096,'2026-10-05T12:00:00Z'),entry('Plano.png','file',256000,'2026-10-06T12:00:00Z'),entry('nota.txt','file',64,'2026-08-12T12:00:00Z'),entry('<img src=x onerror=alert(1)>.txt','file',32,null),entry('Nombre muy largo que debe conservarse al cambiar de vista y al navegar sin romper el ancho de la página.pdf','file',10000,null));
  let streams=0,lists=0;const copies=[];
  await page.route('**/api/connections',r=>r.fulfill({json:{ok:true,providers:[provider]}}));
  await page.route(/\/api\/files\/dropbox\//,async r=>{
    const u=new URL(r.request().url()),action=u.pathname.split('/')[4];
    if(action==='status')return r.fulfill({json:{ok:true,...provider}});
    if(action==='list'){lists++;const path=u.searchParams.get('path')||'';return r.fulfill({json:{ok:true,path,entries:u.searchParams.has('cursor')?[entry('Video.webm','file',2048,null)]:path?[{...entry('nota.txt','file',64,null),path:path+'/nota.txt'}]:entries,cursor:!path&&!u.searchParams.has('cursor')?'next':null}});}
    if(action==='stream'){streams++;return r.fulfill({body:'Texto de prueba',contentType:'text/plain'});}
    if(action==='downloads'){if(r.request().method()==='POST')copies.push(r.request().postDataJSON());return r.fulfill({json:{ok:true,id:'fixture-job',jobs:[]}});}
    return r.fulfill({status:404,json:{ok:false,error:'Unexpected fixture action'}});
  });
  const login=await page.context().request.post('http://127.0.0.1:3459/api/login',{data:{username:'qa',password:'axon-local-qa'},headers:{Origin:'http://127.0.0.1:3459'}});assert(login.ok(),'Fixture login failed');
  await page.goto('http://127.0.0.1:3459/archivos?source=dropbox',{waitUntil:'domcontentloaded'});
  await page.locator('#cloud-list[data-view=details] .cloud-row').first().waitFor();
  assert(await page.locator('.cloud-access').innerText()==='Sólo lectura','Read-only access not clear');
  assert(!await page.locator('.cloud-shared').evaluate(e=>e.open),'Shared-link form expanded on arrival');
  const initialLists=lists;
  await page.locator('[data-select="/nota.txt"]').check();
  for(const view of ['grid','list','details']){
    await page.locator('[data-cloud-view="'+view+'"]').click();
    assert(await page.locator('#cloud-list').getAttribute('data-view')===view,'Wrong view');
    assert(await page.locator('[data-cloud-view="'+view+'"]').getAttribute('aria-pressed')==='true','View state not exposed');
    assert(await page.locator('[data-select="/nota.txt"]').isChecked(),'Selection lost on view switch');
    assert(new URL(page.url()).searchParams.get('view')===view,'View not represented in deep link');
  }
  assert(streams===0&&lists===initialLists,'Switching views downloaded content or refetched metadata');
  const files=()=>page.locator('#cloud-list .cloud-row[data-kind=file] .cloud-open span').allTextContents();
  await page.locator('#cloud-sort').selectOption('size');assert((await files())[0].startsWith('<img'),'Ascending file sizes incorrect');
  await page.locator('#cloud-order').click();assert((await files())[0]==='Plano.png','Descending file sizes incorrect');
  await page.locator('#cloud-sort').selectOption('modified');assert((await files())[0]==='Plano.png','Date sort incorrect');
  await page.locator('#cloud-sort').selectOption('type');assert((await files())[0]==='nota.txt','Type sort incorrect');
  await page.locator('#cloud-sort').selectOption('name');await page.locator('#cloud-order').click();
  const byName=await files();assert(byName.indexOf('Presupuesto 2.pdf')<byName.indexOf('Presupuesto 12.pdf'),'Natural name order incorrect');
  assert(await page.locator('#cloud-list .cloud-row').first().getAttribute('data-kind')==='folder','Folders not kept first');
  await page.locator('#cloud-filter').fill('presupuesto');assert(await page.locator('.cloud-row').count()===2,'Filter failed');assert(await page.locator('#cloud-count').innerText().then(t=>t.includes('2 de 14')),'Filtered count incorrect');
  await page.locator('#cloud-filter').fill('no existe');assert(await page.locator('#cloud-list').innerText()==='No hay coincidencias en esta carpeta.','Empty filter state absent');
  await page.locator('#cloud-filter').fill('');assert(await page.locator('[data-select="/nota.txt"]').isChecked(),'Hidden selection lost');
  await page.locator('#cloud-more').click();await page.waitForFunction(()=>document.querySelectorAll('#cloud-list .cloud-row').length===15);assert(await page.locator('[data-select="/nota.txt"]').isChecked(),'Selection lost on pagination');
  await page.locator('[data-cloud-view=grid]').click();await page.locator('#cloud-save').click();await page.locator('#cloud-dest-save:not([disabled])').waitFor();await page.locator('#cloud-dest-save').click();await page.locator('.cloud-destination').waitFor({state:'detached'});assert(copies.length===1&&copies[0].paths[0]==='/nota.txt'&&copies[0].volumeToken,'Grid copy lost selection/disk identity');
  await page.locator('[data-cloud-view=list]').click();
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#cloud-list[data-view=list] .cloud-row').first().waitFor();assert(new URL(page.url()).searchParams.get('sort')==='name','Sort not restored');
  await page.locator('.cloud-open[data-path="/Clientes"]').click();await page.locator('.cloud-open[data-path="/Clientes/nota.txt"]').waitFor();assert(await page.locator('#cloud-list').getAttribute('data-view')==='list','View lost on folder navigation');
  await page.goBack();await page.locator('.cloud-open[data-path="/Clientes"]').waitFor();
  await page.locator('[data-source=server]').click();await page.locator('#fm-location').waitFor({state:'visible'});await page.locator('[data-source=dropbox]').click();await page.locator('#cloud-list[data-view=list] .cloud-row').first().waitFor();
  await page.locator('.cloud-open[data-path="/nota.txt"]').click();await page.locator('.cloud-preview pre').waitFor();assert(streams===1,'Content not fetched only on open');assert(await page.locator('.cloud-preview pre').textContent()==='Texto de prueba','Preview failed');
  await page.locator('[aria-label="Cerrar vista previa"]').click();await page.locator('#cloud-preview').waitFor({state:'hidden'});
  await page.addScriptTag({path:'/home/user/server-stack/axon/node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/axe.min.js'});
  const widths=[1440,768,390,320];let axeCount=0;
  for(const mode of ['light','dark']){
    await page.evaluate(m=>window.AxonThemes.setMode(m),mode);
    await page.waitForFunction(()=>!document.getAnimations().some(a=>a.constructor.name==='CSSTransition'&&a.playState==='running'));
    for(const width of widths){
      await page.setViewportSize({width,height:960});if(width<=768)await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);
      for(const view of ['list','details','grid']){
        await page.locator('[data-cloud-view="'+view+'"]').click();
        const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth>innerWidth+1,panel:document.querySelector('.cloud-panel').scrollWidth>document.querySelector('.cloud-panel').clientWidth+1}));assert(!overflow.page&&!overflow.panel,'Overflow: '+mode+' '+width+' '+view);
        const axe=await page.evaluate(async()=>await window.axe.run(document.querySelector('.cloud-panel'),{runOnly:['wcag2a','wcag2aa','wcag21aa']}));assert(!axe.violations.length,'A11y '+view+': '+JSON.stringify(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));axeCount++;
        await page.screenshot({path:output+'/'+mode+'-'+width+'-'+view+'.png',fullPage:true});
      }
    }
  }
  assert(!errors.length,'Browser errors: '+errors.join('; '));
  return {ok:true,providerApiMocked:true,realAccountVerified:false,widths,modes:['light','dark'],views:['list','details','grid'],axeChecks:axeCount,streams,copies:copies.length,browserErrors:errors,checks:['metadata-only views','selection preserved','sort name/type/size/date','folder grouping','filters and counts','pagination','safe names','view preferences and deep links','reload/back/source switching','disk destination','preview only on demand','responsive','a11y']};
}
