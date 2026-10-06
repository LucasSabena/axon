async page=>{
 const assert=(v,m)=>{if(!v)throw Error(m);};const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const login=await page.context().request.post('http://127.0.0.1:3459/api/login',{data:{username:'qa',password:'axon-local-qa'},headers:{Origin:'http://127.0.0.1:3459'}});assert(login.ok(),'Isolated login failed');
 await page.goto('http://127.0.0.1:3459/programas?view=installed&q=codex',{waitUntil:'domcontentloaded'});await page.locator('.software-row').first().waitFor({timeout:180000});
 const target=page.locator('[data-detail]').first(),id=await target.getAttribute('data-detail');
 const pick=async()=>{await page.locator('[data-detail="'+id+'"]').click();await page.locator('.software-dialog[open]').getByRole('button',{name:'Elegir icono'}).click();await page.locator('#software-icon-query').waitFor();};
 await pick();await page.locator('#software-icon-query').fill('blender');await page.locator('[data-catalog="selfhst:blender"]').waitFor();
 await page.locator('[data-catalog="selfhst:blender"]').click();await page.locator('.software-dialog').waitFor({state:'detached'});
 const snapshot=await (await page.context().request.get('http://127.0.0.1:3459/api/software')).json();assert(snapshot.installations.find(p=>p.id===id).iconInfo.catalogId==='selfhst:blender','Choice not persisted');
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('.software-row').first().waitFor();await pick();
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:960});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Overflow at '+width);assert(await page.locator('.software-dialog').evaluate(d=>d.getBoundingClientRect().width<=innerWidth),'Picker overflow at '+width);}
 await page.setViewportSize({width:1440,height:960});await page.locator('#software-icon-query').fill('blender');await page.locator('[data-catalog="selfhst:blender"]').waitFor();
 assert(await page.locator('.software-dialog').evaluate(d=>Math.abs(d.getBoundingClientRect().left-(innerWidth-d.getBoundingClientRect().width)/2)<2),'Picker not centered');
 await page.screenshot({path:'docs/qa/software-icons-2026-10-06/picker-1440.png'});
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#247663"/></svg>';
 await page.locator('.software-dialog input[type=file]').setInputFiles({name:'owned-fixture.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});await page.locator('.software-dialog').waitFor({state:'detached'});
 const uploaded=await (await page.context().request.get('http://127.0.0.1:3459/api/software')).json();assert(uploaded.installations.find(p=>p.id===id).iconInfo.label.includes('subido'),'Upload not persisted');
 await pick();await page.locator('.software-dialog').getByRole('button',{name:'Usar detección automática'}).click();await page.locator('.software-dialog').waitFor({state:'detached'});
 const restored=await (await page.context().request.get('http://127.0.0.1:3459/api/software')).json();assert(!restored.installations.find(p=>p.id===id).iconInfo.catalogId,'Reset did not restore automatic logo');
 assert(!errors.length,'Browser errors: '+errors.join('; '));console.log(JSON.stringify({ok:true,choicePersisted:true,upload:true,reset:true,viewports:[1440,390,320],hostPackageMutations:0,isolatedCache:true}));
}
