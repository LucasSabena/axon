async page => {
 if(new URL(page.url()).host!=='127.0.0.1:3459')throw new Error('Use isolated QA');
 const pageErrors=[];const recordPageError=e=>pageErrors.push(e.message);page.on('pageerror',recordPageError);
 await page.reload();await page.locator('#main-screen:not(.hidden)').waitFor();
 const assert=(v,m)=>{if(!v)throw new Error(m);},results=[];
 await page.setViewportSize({width:1440,height:960});
 await page.evaluate(()=>window.AxonNavigation.go('/configuracion'));
 await page.locator('#settings-tab-appearance').click();
 const themes=await page.evaluate(()=>AxonThemes.presets.map(t=>({id:t.id,mode:t.mode})));
 for(const mode of ['dark','light']){
  await page.locator(`#settings-pane-appearance [data-color-mode="${mode}"]`).click();
  assert(await page.locator('[data-theme-choice]').count()===10,'Each mode must show 10 themes');
  for(const theme of themes.filter(t=>t.mode===mode)){
   await page.locator(`[data-theme-choice="${theme.id}"]`).click();
   assert(await page.evaluate(id=>document.documentElement.dataset.theme===id,theme.id),'Selected theme is not applied');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   assert(!overflow,'Theme causes horizontal document overflow: '+theme.id);
  }
 }
 await page.locator('[data-theme-choice="mint"]').click();
 await page.screenshot({path:'/tmp/axon-expanded-light.png'});
 await page.locator('#settings-pane-appearance [data-color-mode="dark"]').click();await page.locator('[data-theme-choice="orchid"]').click();
 await page.locator('#settings-pane-appearance [data-color-mode="system"]').click();
 assert(await page.locator('[data-theme-choice]').count()===20,'System mode needs both theme preferences');
 await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.colorMode==='light');assert(await page.evaluate(()=>document.documentElement.dataset.theme)==='mint','System must keep the selected light theme');
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.colorMode==='dark');assert(await page.evaluate(()=>document.documentElement.dataset.theme)==='orchid','System must keep the selected dark theme');
 await page.reload();await page.locator('#main-screen:not(.hidden)').waitFor();
 assert(await page.evaluate(()=>AxonThemes.current().mode)==='system','Mode must persist across reloads');
 assert(await page.evaluate(()=>AxonThemes.current().dark)==='orchid','Theme must persist across reloads');
 results.push({check:'20 complete themes, light/dark choices, system media updates and reload persistence',passed:true});
 await page.evaluate(()=>window.AxonNavigation.go('/tienda'));
 await page.locator('.store-card').first().waitFor();assert(await page.locator('.store-card').count()>=25,'System app catalog');
 await page.locator('#store-query').fill('godot');assert(await page.locator('.store-card').count()===1,'App search');
 await page.locator('[data-detail="godot"]').click();await page.locator('.modal:not(.hidden) .store-facts').waitFor();await page.keyboard.press('Escape');await page.locator('#confirm-body').waitFor({state:'hidden'});
 let install=false;
 await page.route('**/api/store/godot/install',async route=>{install=true;await new Promise(r=>setTimeout(r,600));await route.fulfill({json:{ok:true,jobId:'qa-store'}});});
 await page.route('**/api/jobs/qa-store',route=>route.fulfill({json:{ok:true,job:{id:'qa-store',title:'QA install',status:'running',steps:[],log:'QA simulated installer',startedAt:new Date().toISOString()}}}));
 await page.locator('[data-store-action="install"]').click();await page.locator('#confirm-modal[open] #confirm-body').waitFor();await page.keyboard.press('Escape');await page.locator('#confirm-body').waitFor({state:'hidden'});assert(!install,'Cancelling must never install');
 await page.locator('[data-store-action="install"]').click();await page.locator('#confirm-ok').click();
 await page.waitForFunction(()=>document.querySelector('[data-store-action="install"]')?.getAttribute('aria-busy')==='true');
 assert(await page.locator('[data-store-action="install"]').getAttribute('aria-busy')==='true','Install action needs busy feedback');
 await page.locator('#job-modal:not(.hidden)').waitFor();assert(install,'Confirmed installer request');
 await page.keyboard.press('Escape');await page.locator('#confirm-body').waitFor({state:'hidden'});await page.unroute('**/api/store/godot/install');await page.unroute('**/api/jobs/qa-store');
 await page.locator('#store-query').fill('davinci');assert(await page.locator('.store-card a').getAttribute('href')==='https://www.blackmagicdesign.com/products/davinciresolve','DaVinci official source');assert(await page.locator('[data-store-action]').count()===0,'Do not promise automated DaVinci installer');
 await page.locator('#store-query').fill('');
 results.push({check:'System store, detail dialog, search, cancel/install feedback and DaVinci source',passed:true,mockedInstallation:true});
 await page.evaluate(()=>window.AxonNavigation.go('/biblioteca?type=shares'));
 await page.locator('#lib-share-manager').waitFor();
 const feed={ok:true,shareBase:'',shares:[{id:'qa-share',title:'Entrega QA',url:'http://127.0.0.1:3459/s/qa-share',created:Date.now(),expires:Date.now()+86400000,alive:true,allowDownload:true,hasPassword:false,cdn:false,views:3,downloads:2,visitors:2,count:1,size:1024,ids:[],missing:0,preparing:0,notifyActivity:true,files:[{name:'video.mp4',path:'/tmp/renders/video.mp4',kind:'video',size:1024}],recentActivity:[{t:Date.now(),kind:'download',visitor:'anon123',client:'Chrome',name:'video.mp4'}]}]};
 await page.route('**/api/library/shares',route=>route.fulfill({json:feed}));
 await page.locator('#lib-share-manager').click();await page.locator('[data-a="activity"]').click();
 await page.locator('.lib-activity-modal').waitFor();assert((await page.locator('.share-files-list').textContent()).includes('/renders/video.mp4'),'Activity shows original shared files');assert((await page.locator('.share-activity-list').textContent()).includes('Descarga iniciada'),'Download timeline');
 await page.evaluate(()=>document.querySelector('.lib-activity-modal').scrollTop=10000);await page.locator('#lib-modal .dialog-close').click();
 await page.unroute('**/api/library/shares');
 results.push({check:'Shared links entry point, canonical file list and activity timeline',passed:true,mocked:true});
 for(const width of [390,768,1440]){
  await page.setViewportSize({width,height:900});
  for(const route of ['/tienda','/configuracion','/biblioteca']){
   await page.evaluate(route=>window.AxonNavigation.go(route),route);if(route==='/configuracion')await page.locator('#settings-tab-appearance').click();await page.waitForTimeout(300);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Responsive overflow '+route+' '+width);
  }
 }
 await page.setViewportSize({width:390,height:900});await page.evaluate(()=>AxonThemes.setMode('light'));await page.evaluate(()=>window.AxonNavigation.go('/tienda'));await page.waitForTimeout(300);await page.screenshot({path:'/tmp/axon-expanded-store-mobile.png'});
 await page.setViewportSize({width:1440,height:960});await page.evaluate(()=>AxonThemes.setMode('dark'));await page.screenshot({path:'/tmp/axon-expanded-store-desktop.png'});
 results.push({check:'Expanded screens responsive at 390 / 768 / 1440 px',passed:true});
 page.off('pageerror',recordPageError);assert(pageErrors.length===0,'Unexpected browser errors: '+pageErrors.join('; '));
 return results;
}
