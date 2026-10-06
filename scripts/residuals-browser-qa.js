async page => {
 if(new URL(page.url()).host!=='127.0.0.1:3459')throw new Error('Use isolated QA');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const assert=(v,m)=>{if(!v)throw new Error(m);};
 const rows=[{id:'qa-one',name:'Residual One',source:'/tmp/qa-residuals/one',size:'12K',eligible:true},{id:'qa-two',name:'Residual Two',source:'/tmp/qa-residuals/two',size:'8K',eligible:true},{id:'qa-shared',name:'Shared residual',source:'/tmp/qa-residuals/shared',eligible:false,reason:'La carpeta se comparte con otro agente'}];
 let pending=[...rows],archives=[],batches=0,singles=0,restores=0,partial=false;
 const agents=()=>rows.filter(r=>pending.some(p=>p.id===r.id)).map(r=>({id:r.id,name:r.name,icon:'bot',installed:true,residual:true,counts:{skills:0,mcps:0,plugins:0},configRoot:r.source}));
 await page.route('**/api/agents',r=>r.fulfill({json:{ok:true,agents:agents()}}));
 await page.route('**/api/agent-residuals',r=>r.fulfill({json:{ok:true,residuals:pending}}));
 await page.route('**/api/agent-archives',r=>r.fulfill({json:{ok:true,archives}}));
 await page.route('**/api/agent-residuals/archive',async route=>{
  const body=route.request().postDataJSON();assert(body.confirm===true,'Confirmation required');assert(body.ids.length===2,'Selected two eligible residuals only');batches++;
  const done=partial?body.ids.slice(0,1):body.ids;const made=done.map(id=>({id:'backup-'+id,agentId:id,name:rows.find(r=>r.id===id).name,source:rows.find(r=>r.id===id).source,at:Date.now()}));
  pending=pending.filter(r=>!done.includes(r.id));archives.push(...made);
  await route.fulfill({json:{ok:true,archives:made,failures:partial?[{id:body.ids[1],name:'Residual Two',error:'El agente está instalado; se conserva'}]:[]}});
 });
 await page.route('**/api/agent-archives/*/restore',async route=>{
  restores++;const id=new URL(route.request().url()).pathname.split('/').at(-2);const row=archives.find(a=>a.id===id);pending.push(rows.find(r=>r.id===row.agentId));archives=archives.filter(a=>a.id!==id);await route.fulfill({json:{ok:true}});
 });
 await page.route('**/api/agents/*/archive-preview',route=>{const id=new URL(route.request().url()).pathname.split('/').at(-2),r=rows.find(r=>r.id===id);return route.fulfill({json:{ok:true,name:r.name,source:r.source,size:r.size}});});
 await page.route('**/api/agents/*/archive',async route=>{singles++;const id=new URL(route.request().url()).pathname.split('/').at(-2);pending=pending.filter(r=>r.id!==id);const r=rows.find(r=>r.id===id);archives.push({id:'backup-'+id,agentId:id,name:r.name,source:r.source,at:Date.now()});await route.fulfill({json:{ok:true}});});
 await page.setViewportSize({width:1440,height:960});await page.goto('http://127.0.0.1:3459/agentes?id=__archives');await page.locator('#residual-all').waitFor();
 assert(await page.locator('[data-residual-id]').count()===3,'All residuals listed');assert(await page.locator('[data-residual-id="qa-shared"]').isDisabled(),'Shared config blocked');assert(await page.locator('#residual-clean').isDisabled(),'No empty bulk request');
 await page.locator('[data-residual-id="qa-one"]').check();assert(await page.locator('#residual-all').evaluate(e=>e.indeterminate),'Partial selection state');
 await page.locator('#residual-all').check();assert(await page.locator('[data-residual-id]:checked').count()===2,'Select all only chooses eligible configs');
 await page.locator('#residual-clean').click();await page.locator('#confirm-modal[open] #confirm-body').waitFor();assert((await page.locator('#confirm-modal').textContent()).includes('/tmp/qa-residuals/two'),'Confirmation identifies selected paths');await page.keyboard.press('Escape');await page.locator('#confirm-body').waitFor({state:'hidden'});assert(batches===0,'Cancel preserves all folders');
 await page.locator('#residual-clean').click();await page.locator('#confirm-ok').click();await page.waitForFunction(()=>document.querySelectorAll('[data-archive-restore]').length===2);assert(batches===1,'One request for whole batch');assert((await page.locator('#residual-result').textContent()).includes('2 configuraciones archivadas'),'Visible success');
 await page.locator('[data-archive-restore]').first().click();await page.locator('#confirm-ok').click();await page.waitForFunction(()=>document.querySelectorAll('[data-residual-id]').length===2);assert(restores===1,'Restoration available');
 await page.locator('[data-residual-quick="qa-one"]').click();await page.locator('#confirm-modal[open] #confirm-body').waitFor();await page.locator('#confirm-ok').click();await page.waitForFunction(()=>document.querySelectorAll('[data-residual-id]').length===1);assert(singles===1,'Quick rail cleanup without opening detail');
 pending=[...rows];archives=[];partial=true;await page.reload();await page.locator('#residual-all').check();
 await page.screenshot({path:'/tmp/axon-residuals-desktop.png'});
 await page.locator('#residual-clean').click();await page.locator('#confirm-ok').click();await page.locator('#residual-result').filter({hasText:'El agente está instalado'}).waitFor();assert((await page.locator('#residual-result').textContent()).includes('1 configuración archivada'),'Partial completion reported');assert(await page.locator('[data-residual-id="qa-two"]').count()===1,'Failed row remains visible');
 for(const width of [390,320]){await page.setViewportSize({width,height:900});await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No responsive overflow '+width);}
 await page.locator('#residual-all').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/axon-residuals-mobile.png'});
 assert(errors.length===0,'Page errors: '+errors.join('; '));return {passed:true,mockedHostMutations:true,batches,singles,restores,widths:[1440,390,320],pageErrors:errors};
}
