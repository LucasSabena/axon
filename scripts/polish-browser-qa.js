async page => {
  if(new URL(page.url()).host!=='127.0.0.1:3459')throw new Error('Run against the isolated QA server on port 3459');
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  const outcomes=[];const pageErrors=[];const recordPageError=e=>pageErrors.push(e.message);page.on('pageerror',recordPageError);
  await page.setViewportSize({width:1280,height:800});
  await page.route('**/feat-notify.js*',async route=>{await new Promise(r=>setTimeout(r,700));await route.continue();});
  await page.goto('http://127.0.0.1:3459/');
  await page.waitForFunction(()=>!document.querySelector('#login-screen').classList.contains('hidden')||!document.querySelector('#main-screen').classList.contains('hidden'));
  if(await page.locator('#username').isVisible()){
    await page.locator('#username').fill('qa');await page.locator('#password').fill('axon-local-qa');await page.locator('#login-form button[type=submit]').click();
  }
  await page.evaluate(()=>localStorage.removeItem('pm.termSessions'));
  await page.locator('#main-screen:not(.hidden)').waitFor();
  await page.unroute('**/feat-notify.js*');
  await page.waitForFunction(()=>document.querySelector('#notif-live')?.textContent==='En vivo');
  outcomes.push({check:'Late feature scripts receive authenticated initialization',passed:true});
  await page.waitForTimeout(700);
  const paths=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname));
  assert(!paths.includes('/api/programs')&&!paths.includes('/api/programs/installed')&&!paths.includes('/api/ports'),'Dashboard eager loads unrelated sections');
  outcomes.push({check:'Dashboard only loads its own resources',passed:true});

  await page.evaluate(()=>window.AxonNavigation.go('/configuracion'));
  await page.locator('#settings-tab-general').click();
  await page.locator('#settings-scan-interval').fill('7000');
  await page.locator('a[data-tab="ports"]').click();
  await page.locator('#confirm-modal[open] #confirm-body').waitFor();
  await page.keyboard.press('Escape');await page.locator('#confirm-body').waitFor({state:'hidden'});
  assert(new URL(page.url()).pathname==='/configuracion','Escape must cancel navigation with unsaved settings');
  await page.locator('#settings-scan-interval').fill('5000');
  await page.locator('#settings-tab-general').focus();await page.keyboard.press('ArrowRight');
  assert(await page.locator('#settings-tab-appearance').getAttribute('aria-selected')==='true','Settings keyboard tabs');
  await page.locator('#settings-pane-appearance [data-color-mode="dark"]').click();
  await page.locator('[data-theme-choice="linear"]').click();
  assert(await page.evaluate(()=>document.documentElement.dataset.theme)==='linear','Theme selection');
  await page.locator('[data-theme-choice="axon"]').click();
  outcomes.push({check:'Settings dirty guard, keyboard tabs and themes',passed:true});

  await page.evaluate(()=>window.AxonNavigation.go('/puertos'));
  await page.route('**/api/ports',async route=>{await new Promise(r=>setTimeout(r,600));await route.fulfill({json:{ok:true,processes:[],networkHost:''}});});
  await page.locator('#ports-refresh').click();
  assert(await page.locator('#ports-refresh').getAttribute('aria-busy')==='true','Refresh needs immediate busy feedback');
  assert(await page.locator('#ports-refresh').isDisabled(),'Pending refresh allows duplicate actions');
  await page.waitForTimeout(900);assert(!await page.locator('#ports-refresh').isDisabled(),'Refresh remains disabled');
  await page.unroute('**/api/ports');outcomes.push({check:'Refresh animation, duplicate protection and recovery',passed:true});

  const count=await page.evaluate(async()=> (await api('/api/events')).unread);
  await page.locator('#notif-bell').click();await page.waitForTimeout(250);
  assert(await page.evaluate(async()=> (await api('/api/events')).unread)===count,'Opening notifications marked events read');
  await page.route('**/api/events/read',route=>route.fulfill({status:503,json:{ok:false,error:'QA failure'}}));
  await page.locator('#notif-read-all').click();await page.waitForTimeout(150);
  assert(await page.evaluate(async()=> (await api('/api/events')).unread)===count,'Failed read mutated notification state');
  await page.unroute('**/api/events/read');await page.locator('#notif-close').click();
  outcomes.push({check:'Notification read state survives opening and failed writes',passed:true});

  await page.evaluate(()=>{
    const m=document.createElement('div');m.id='qa-long-modal';m.className='modal';m.innerHTML='<div class="modal-content"><h3>QA modal</h3><input aria-label="QA field"><div style="height:1800px">Contenido extenso</div><div class="modal-actions"><button type="button">Cancelar</button></div></div>';m.querySelector('button').onclick=()=>m.remove();document.body.append(m);
  });
  await page.locator('#qa-long-modal .dialog-close').waitFor();
  await page.evaluate(()=>document.querySelector('#qa-long-modal .modal-content').scrollTop=1700);
  const box=await page.locator('#qa-long-modal .dialog-close').boundingBox();assert(box&&box.y>=0&&box.y<800,'Close control scrolled out of modal');
  await page.locator('#qa-long-modal .dialog-close').click();assert(!await page.locator('#qa-long-modal').count(),'Modal close did not settle');
  outcomes.push({check:'Long modal has a visible working close control',passed:true});

  const agents=[{id:'qa-source',name:'QA Source',installed:true,provWritable:true,configRoot:'/tmp/qa-source',counts:{skills:0,mcps:0,plugins:0}}, {id:'qa-target',name:'QA Target',installed:true,provWritable:true,configRoot:'/tmp/qa-target',counts:{skills:0,mcps:0,plugins:0}}];
  await page.route('**/api/agents',route=>route.fulfill({json:{ok:true,agents}}));
  await page.route('**/api/agents-discovered',route=>route.fulfill({json:{ok:true,candidates:[]}}));
  await page.route('**/api/agents/qa-source',route=>route.fulfill({json:{ok:true,agent:{...agents[0],items:[{kind:'provider',key:'qa-provider',name:'QA Provider',enabled:true,toggleable:false,deletable:false,copyable:true,detail:'Key guardada',raw:{baseUrl:'https://provider.example',apiKey:'••••••••'}}],notes:[]}}}));
  await page.route('**/api/agents/qa-source/providers',route=>route.fulfill({json:{ok:true,providers:[]}}));
  let copied=false;
  await page.route('**/api/agents/qa-source/providers/qa-provider/copy',async route=>{copied=route.request().postDataJSON().target==='qa-target';await route.fulfill({json:{ok:true}});});
  await page.evaluate(()=>AxonUI.invalidate());
  await page.evaluate(()=>window.AxonNavigation.go('/agentes?id=qa-source&tab=provider'));
  await page.locator('.ag-item[data-key="qa-provider"]').click();
  await page.locator('#ag-drawer:not(.hidden)').waitFor();
  assert(await page.locator('#ag-drawer').getAttribute('role')==='dialog','Account details are not accessible dialogs');
  await page.keyboard.press('Escape');await page.locator('#confirm-body').waitFor({state:'hidden'});
  await page.locator('.ag-prov-copy').click();await page.locator('.ag-prov-target[data-id="qa-target"]').click();
  await page.locator('#confirm-modal[open] #confirm-body').waitFor();await page.locator('#confirm-ok').click();await page.waitForTimeout(200);assert(copied,'Provider sharing did not use selected compatible agent');
  outcomes.push({check:'Account modal and credential sharing',passed:true,mocked:true});
  await page.unroute('**/api/agents');await page.unroute('**/api/agents-discovered');await page.unroute('**/api/agents/qa-source');await page.unroute('**/api/agents/qa-source/providers');await page.unroute('**/api/agents/qa-source/providers/qa-provider/copy');
  await page.evaluate(()=>AxonUI.invalidate());

  await page.evaluate(()=>{
    window.qaSockets=0;
    window.WebSocket=class {
      constructor(){window.qaSockets++;this.readyState=0;setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.();this.onmessage?.({data:'QA terminal\r\n'});},0);}
      send(){}
      close(){this.readyState=3;this.onclose?.();}
    };
  });
  await page.evaluate(()=>window.AxonNavigation.go('/terminal'));
  await page.waitForTimeout(300);assert((await page.locator('#term-connection').innerText()).includes('Conectada'),'Terminal status');
  await page.locator('#term-reconnect').click();await page.waitForTimeout(100);assert(await page.evaluate(()=>window.qaSockets)===1,'Reconnect duplicates an open socket');
  await page.locator('#term-new-tab').click();await page.waitForTimeout(100);assert(await page.evaluate(()=>window.qaSockets)===2,'New terminal tab');
  await page.locator('.term-tab-x').last().click();assert(await page.locator('.term-tab').count()===1,'Keyboard accessible close');
  outcomes.push({check:'Terminal session status and socket deduplication',passed:true,mocked:true});

  await page.route('**/api/browser/status',route=>route.fulfill({json:{ok:true,available:false}}));
  await page.evaluate(()=>window.AxonNavigation.go('/navegador'));await page.waitForTimeout(150);
  assert(await page.locator('#browser-state').getAttribute('data-state')==='error','Browser failure feedback');
  await page.unroute('**/api/browser/status');outcomes.push({check:'Browser unavailable state',passed:true,mocked:true});

  for(const size of [{width:390,height:844},{width:768,height:1024},{width:1440,height:900}]){
    await page.setViewportSize(size);
    await page.waitForTimeout(300);
    for(const url of ['/configuracion','/biblioteca','/archivos','/agentes','/programas','/docker']){
      await page.evaluate(url=>window.AxonNavigation.go(url),url);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Horizontal overflow at ${size.width} ${url}`);
    }
  }
  outcomes.push({check:'390, 768, 1440 px responsive layout',passed:true});
  await page.evaluate(()=>window.AxonNavigation.go('/configuracion'));await page.locator('#settings-tab-appearance').click();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
  assert(await page.evaluate(()=>document.querySelector('.sidebar').inert&&document.querySelector('.sidebar').getBoundingClientRect().right<=0),'Closed mobile sidebar covers content or accepts keyboard focus');
  await page.locator('#mobile-menu-btn').click();assert(await page.locator('#mobile-menu-btn').getAttribute('aria-expanded')==='true','Mobile navigation did not open');
  await page.keyboard.press('Escape');await page.locator('#confirm-body').waitFor({state:'hidden'});await page.waitForTimeout(300);
  assert(await page.locator('#mobile-menu-btn').getAttribute('aria-expanded')==='false','Mobile navigation did not close');
  await page.screenshot({path:'/tmp/axon-polish-mobile.png'});
  await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(300);await page.screenshot({path:'/tmp/axon-polish-desktop.png'});
  page.off('pageerror',recordPageError);assert(pageErrors.length===0,'Unexpected browser errors: '+pageErrors.join('; '));
  return outcomes;
}
