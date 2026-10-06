async page => {
 if(new URL(page.url()).host!=='127.0.0.1:3459')throw new Error('Use isolated local QA');
 const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const assert=(v,m)=>{if(!v)throw new Error(m);};
 await page.setViewportSize({width:1440,height:960});
 await page.goto('http://127.0.0.1:3459/agentes?id=__chats');
 await page.locator('.ctx-row').first().waitFor({timeout:30000});
 assert(await page.locator('.ctx-row').count()<=40,'List pagination');
 await page.locator('#ctx-agent').selectOption('codex');
 await page.waitForFunction(()=>document.querySelector('#ctx-agent')?.value==='codex'&&document.querySelectorAll('.ctx-row').length>0);
 await page.locator('.ctx-row').first().click();await page.locator('.ctx-message').first().waitFor();
 assert(await page.locator('.ctx-origin code').textContent()!=='','Original path visible');
 const fileLink=new URL(await page.locator('.ctx-origin a').getAttribute('href'),'http://axon.local');const source=await page.locator('.ctx-origin code').textContent();assert(fileLink.searchParams.get('item')===source.split('/').pop()&&fileLink.searchParams.get('path')===source.slice(0,source.lastIndexOf('/')),'File link splits directory and item correctly');
 const detailUrl=page.url();await page.reload();await page.locator('.ctx-message').first().waitFor();assert(page.url().includes('entry='),'Reload retains selected conversation');
 const download=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Descargar chat completo'}).click()]);assert(download[0].suggestedFilename()==='chat-contexto.md','Markdown attachment');
 await page.locator('[data-message-select]').first().check();
 await page.evaluate(()=>{window.__copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__copied=t;}}});});
 await page.getByRole('button',{name:'Copiar selección',exact:true}).click();assert((await page.evaluate(()=>window.__copied)).includes('Proyecto:'),'Selection exports project context');
 await page.goBack();await page.locator('.ctx-row').first().waitFor();
 results.push({check:'Real chat catalog, source filter, detail/reload, selection and full Markdown download',passed:true});
 await page.goto('http://127.0.0.1:3459/agentes?id=__memories');await page.locator('.ctx-row').first().waitFor();
 assert((await page.locator('#ctx-status').textContent()).includes('memorias'),'Real memories');
 await page.locator('#ctx-agent').selectOption('engram');await page.waitForFunction(()=>document.querySelector('#ctx-agent')?.value==='engram'&&document.querySelectorAll('.ctx-row').length>0);
 await page.locator('.ctx-row').first().click();await page.locator('.ctx-memory').waitFor();
 await page.screenshot({path:'/tmp/axon-context-memories-desktop.png'});
 for(const width of [390,320]){
  await page.setViewportSize({width,height:900});await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Memory mobile overflow at '+width);
 }
 await page.locator('.ctx-heading').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/axon-context-memories-mobile.png'});
 results.push({check:'Real Engram memory content and paths, responsive at 1440/390/320px',passed:true});
 // Editing UI is tested against a fixture; no real user memory is changed.
 const fixture={id:'qa-memory',agent:'engram',title:'QA decision',content:'QA original',project:'QA project',source:'/tmp/qa-engram/engram.db',revision:'rev-1',editable:true};
 let memory={...fixture},saveCount=0,conflict=false;
 await page.route('**/api/agent-context/memories/qa-memory',async route=>{
  if(route.request().method()==='POST'){
   if(conflict){await route.fulfill({status:409,json:{ok:false,error:'La memoria cambió. Recargala.'}});return;}
   const body=route.request().postDataJSON();assert(body.revision===memory.revision,'Save uses original revision');memory={...memory,content:body.content,title:body.title,revision:'rev-2'};saveCount++;
  }
  await route.fulfill({json:{ok:true,item:memory,files:[],backup:'/tmp/qa-backup.json'}});
 });
 await page.goto('http://127.0.0.1:3459/agentes?id=__memories&entry=qa-memory');await page.getByRole('button',{name:'Editar memoria'}).click();
 await page.locator('#ctx-content-edit').fill('QA changed');
 await page.evaluate(()=>{void window.AxonNavigation.go('/agentes?id=__chats');});await page.locator('#confirm-modal[open] #confirm-body').waitFor();await page.keyboard.press('Escape');await page.locator('#confirm-body').waitFor({state:'hidden'});
 assert(await page.locator('#ctx-content-edit').inputValue()==='QA changed','Cancel navigation keeps unsaved text');
 await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ctx-memory')?.textContent==='QA changed');assert(saveCount===1,'Exactly one save');
 await page.getByRole('button',{name:'Editar memoria'}).click();await page.locator('#ctx-content-edit').fill('QA stale');conflict=true;
 await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await page.locator('#ctx-save-status').filter({hasText:'La memoria cambió'}).waitFor();assert(await page.locator('#ctx-content-edit').inputValue()==='QA stale','Conflict keeps editable draft');
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.locator('#confirm-modal[open] #confirm-body').waitFor();await page.locator('#confirm-ok').click();
 await page.unroute('**/api/agent-context/memories/qa-memory');
 results.push({check:'Memory editor save, backup feedback, unsaved-navigation cancellation and conflict recovery',passed:true,mockedEditing:true});
 await page.setViewportSize({width:1440,height:960});await page.goto('http://127.0.0.1:3459/agentes?id=__chats');await page.locator('.ctx-row').first().waitFor();
 await page.screenshot({path:'/tmp/axon-context-chats-desktop.png'});
 await page.setViewportSize({width:390,height:900});await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Chat mobile overflow');
 await page.locator('.ctx-heading').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/axon-context-chats-mobile.png'});
 assert(errors.length===0,'Page errors: '+errors.join(', '));return {passed:true,results,pageErrors:errors};
}
