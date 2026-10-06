async page => {
  const origin='http://127.0.0.1:3459',checks=[],errors=[],assert=(v,m)=>{if(!v)throw new Error(m);};
  page.on('pageerror',e=>errors.push(e.message));
  const login=await page.context().request.post(origin+'/api/login',{data:{username:'qa',password:'axon-local-qa'},headers:{Origin:origin}});assert(login.ok(),'QA login failed');
  let configured=false;
  await page.route('**/api/files/dropbox/**',async route=>{
    const p=new URL(route.request().url()).pathname;
    if(p.endsWith('/configure')){configured=true;return route.fulfill({json:{ok:true}});}
    if(p.endsWith('/status'))return route.fulfill({json:{ok:true,configured,serverConfigured:false,connected:false,account:null,sources:[],redirectUri:origin+'/api/files/dropbox/oauth/callback'}});
    return route.fulfill({json:{ok:true,jobs:[]}});
  });
  await page.goto(origin+'/archivos',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.AxonNavigation?.ready);
  await page.locator('[data-source="dropbox"]').click();await page.locator('#cloud-configure').waitFor();
  assert((await page.locator('#cloud-redirect').inputValue())===origin+'/api/files/dropbox/oauth/callback','Wrong redirect URI');
  await page.locator('#cloud-configure input').fill('fixture-browser-key');await page.locator('#cloud-configure button').click();await page.locator('#cloud-connect').waitFor();
  checks.push('Configuration form and exact callback URI');
  let connected=true,fail=false,save=null,jobs=[],copies=0,streams=0;
  const status=()=>({ok:true,configured:true,serverConfigured:false,connected,account:connected?{name:'Cuenta de prueba',email:'qa@example.test'}:null,redirectUri:origin+'/api/files/dropbox/oauth/callback',sources:connected?[{id:'account',name:'Mi Dropbox',type:'account'},{id:'shared-fixture',name:'Entrega del cliente',type:'shared'}]:[]});
  const file=(name,path,type='file',n=50)=>({name,path,type,size:type==='dir'?0:n,modified:null,downloadable:true});
  await page.route('**/api/files/dropbox/**',async route=>{
    const request=route.request(),u=new URL(request.url()),p=u.pathname.slice('/api/files/dropbox'.length);let value;
    if(p==='/status')value=status();
    else if(p==='/list'){
      if(fail)return route.fulfill({status:429,json:{ok:false,error:'Dropbox limitó temporalmente las consultas. Reintentá.'}});
      const path=u.searchParams.get('path');value={ok:true,path,entries:path==='/Fotos'?[file('Nota.txt','/Fotos/Nota.txt')]:u.searchParams.get('cursor')?[file('Otra.txt','/Otra.txt')]:[file('Fotos','/Fotos','dir'),file('Nota.txt','/Nota.txt'),file('Nombre muy largo de archivo que conserva todos los caracteres y no rompe la pantalla.txt','/larga.txt')],cursor:!path&&!u.searchParams.get('cursor')?'fixture-next':null};
    }else if(p==='/stream'){streams++;return route.fulfill({status:206,contentType:'text/plain',body:'Contenido de prueba bajo demanda.\n<script>no se ejecuta</script>'});}
    else if(p==='/downloads'&&request.method()==='POST'){save=request.postDataJSON();copies++;jobs=[{id:'fixture-job',directory:save.directory,names:['Nota.txt'],state:'running',bytes:50,received:25,published:[]}];value={ok:true,id:'fixture-job'};}
    else if(p==='/downloads')value={ok:true,jobs};
    else if(p==='/downloads/fixture-job/cancel'){jobs[0].state='cancelled';jobs[0].error='Copia cancelada.';value={ok:true};}
    else if(p==='/shared')value={ok:true,id:'shared-fixture'};
    else if(p.endsWith('/remove'))value={ok:true};
    else if(p==='/disconnect'){connected=false;value={ok:true};}
    else value={ok:true};
    await route.fulfill({json:value});
  });
  await page.locator('#cloud-refresh').click();await page.locator('.cloud-open').first().waitFor();assert(streams===0,'Browsing fetched content');
  await page.locator('.cloud-open').filter({hasText:'Fotos'}).click();await page.waitForURL('**cloudPath=%2FFotos*');await page.locator('.cloud-open').filter({hasText:'Nota.txt'}).waitFor();
  await page.goBack();await page.locator('.cloud-open').filter({hasText:'Fotos'}).waitFor();
  await page.locator('#cloud-more').click();await page.locator('.cloud-open').filter({hasText:'Otra.txt'}).waitFor();checks.push('Metadata-only browsing, folders, Back and pagination');
  await page.locator('#cloud-filter').fill('Nota');assert(await page.locator('.cloud-row').count()===1,'Filtering failed');await page.locator('.cloud-open').click();await page.locator('.cloud-preview-body pre').waitFor();
  assert((await page.locator('.cloud-preview-body pre').textContent()).includes('<script>'),'Text was not preserved');assert(streams>0,'Preview did not fetch on demand');
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.cloud-preview-body pre').waitFor();checks.push('On-demand text preview, escaped HTML, reload and item deep link');
  await page.locator('[data-select="/Nota.txt"]').check();await page.locator('#cloud-save').click();await page.locator('.cloud-destination[open]').waitFor();await page.locator('#cloud-dest-save:not([disabled])').waitFor();
  await page.locator('#cloud-disk').selectOption('fixture-external');await page.waitForFunction(()=>document.querySelector('#cloud-dest-path').value.endsWith('/external-drive'));
  await page.locator('#cloud-dest-mkdir').click();await page.locator('#cloud-dest-mkdir-form input').fill('Dropbox QA');await page.locator('#cloud-dest-mkdir-form button').click();await page.waitForFunction(()=>document.querySelector('#cloud-dest-path').value.endsWith('/Dropbox QA'));
  await page.locator('#cloud-dest-save').click();await page.locator('[data-cancel="fixture-job"]').waitFor();assert(save.directory.endsWith('/external-drive/Dropbox QA'),'Wrong destination');assert(save.volumeToken==='fixture-external:fixture-external','Wrong disk identity');assert(copies===1,'Duplicate download');
  await page.locator('[data-cancel="fixture-job"]').click();await page.locator('.cloud-jobs').getByText('Cancelada',{exact:true}).waitFor();checks.push('Disk selection, folder creation, background copy request and cancellation');
  await page.locator('#cloud-location').selectOption('shared-fixture');await page.locator('#cloud-remove-link').waitFor();assert(await page.locator('#cloud-location').inputValue()==='shared-fixture','Shared source lost');
  await page.locator('summary').filter({hasText:'Agregar un enlace'}).click();await page.locator('#cloud-shared-form input').fill('https://www.dropbox.com/scl/fo/fixture/id?rlkey=example');await page.locator('#cloud-shared-form button').click();checks.push('Shared-link source navigation');
  fail=true;await page.locator('#cloud-refresh').click();await page.locator('#cloud-message.cloud-error').waitFor();fail=false;await page.locator('#cloud-refresh').click();await page.locator('.cloud-open').first().waitFor();checks.push('Rate-limit error and retry');
  await page.locator('#cloud-location').selectOption('account');await page.locator('#cloud-filter').fill('');await page.locator('.cloud-open').filter({hasText:'Fotos'}).waitFor();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:960});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow '+width);
    await page.screenshot({path:'docs/qa/dropbox-2026-10-06/connected-'+width+'.png',fullPage:true});
    await page.locator('[data-select="/Nota.txt"]').check();await page.locator('#cloud-save').click();await page.locator('#cloud-dest-save:not([disabled])').waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Dialog overflow '+width);await page.locator('.cloud-destination').press('Escape');
    await page.locator('[data-select="/Nota.txt"]').uncheck();
  }
  checks.push('Desktop/tablet/mobile at 1440/768/390/320px and keyboard-dismissable destination dialog');
  await page.locator('[data-source="server"]').click();await page.locator('#fm-location').waitFor({state:'visible'});assert(await page.locator('#cloud-browser').isHidden(),'Cloud view stayed visible');
  await page.goBack();await page.locator('#cloud-browser').waitFor({state:'visible'});checks.push('Local source restored and Back returns to Dropbox');
  assert(!errors.length,'Browser errors: '+errors.join('; '));
  return {ok:true,checks,errors,realAccount:false,dropboxResponses:'mocked',copies,streams};
}
