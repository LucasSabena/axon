async page => {
 const assert=(value,message)=>{if(!value)throw new Error(message);};
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const item=(id,manager,scope,user,extra={})=>({id,manager,scope,user,uid:scope==='system'?0:42,root:scope==='system'?'/':'/srv/custom/global',packageName:'fixture-'+id,name:'Fixture '+id,version:'1.0.0',kind:'tool',executables:[],updateState:'available',targetVersion:'2.0.0',canUpdate:true,reason:'',iconUrl:'/api/software/icons/'+id,...extra});
 const rows=[item('alpha','pnpm','user','custom-user'),item('beta','apt','system','root'),item('manual','manual','user','custom-user',{canUpdate:false,updateState:'unmanaged',targetVersion:null}),item('held','flatpak','user','custom-user',{canUpdate:false,updateState:'held',targetVersion:null}),...Array.from({length:90},(_,i)=>item('extra-'+i,'pnpm','user','custom-user',{canUpdate:false,updateState:'current'}))];
 const snapshot={ok:true,installations:rows,checkedAt:Date.now(),canAdministerSystem:true,sources:[{id:'pnpm',manager:'pnpm',scope:'user',user:'custom-user',root:'/srv/custom/global',available:true,complete:true,updateState:'ok'},{id:'apt',manager:'apt',scope:'system',user:'root',root:'/',available:true,complete:true,updateState:'ok',metadataAt:Date.now()},{id:'cargo',manager:'cargo',scope:'user',user:'custom-user',available:false,complete:false,updateState:'unavailable'}]};
 let fail=false,plans=0,executions=0,requested=[];
 await page.route('**/api/software**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.includes('/icons/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="5" fill="#374151"/></svg>'});
  if(u.pathname==='/api/software')return route.fulfill(fail?{status:503,json:{ok:false,error:'Fixture: gestor no disponible'}}:{json:snapshot});
  if(u.pathname==='/api/software/plan'){
   plans++;requested=route.request().postDataJSON().ids;
   return route.fulfill({json:{ok:true,plan:{ok:true,id:'fixture-approved-plan',createdAt:Date.now(),expiresAt:Date.now()+600000,transactions:requested.map(id=>{const p=rows.find(p=>p.id===id);return {manager:p.manager,scope:p.scope,user:p.user,root:p.root,items:[p],effects:'Cambios de dependencias según el gestor',simulation:{complete:p.manager==='apt',changes:[{packageName:p.packageName,targetVersion:'2.0.0'},{packageName:'fixture-dependency',targetVersion:'3.0.0'}],removals:[]}};})}}});
  }
  if(u.pathname==='/api/software/execute'){executions++;return route.fulfill({status:409,json:{ok:false,error:'Fixture: plan vencido'}});}
  throw new Error('Unexpected software request '+u.pathname);
 });
 const login=await page.context().request.post('http://127.0.0.1:3459/api/login',{data:{username:'qa',password:'axon-local-qa'},headers:{Origin:'http://127.0.0.1:3459'}});assert(login.ok(),'Isolated QA login failed');
 await page.setViewportSize({width:1440,height:960});
 await page.goto('http://127.0.0.1:3459/programas?view=installed&manager=pnpm&q=fixture',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.AxonNavigation?.ready);
 await page.locator('.software-row').first().waitFor();
 assert(await page.locator('#software-manager').inputValue()==='pnpm','Manager filter not restored');
 assert(await page.locator('#tab-programs>.view-tools').count()===0,'Obsolete duplicate toolbar visible');
 assert(await page.locator('.software-row').count()===75,'Inventory pagination absent');
 await page.locator('#software-next').click();assert(await page.locator('.software-row').count()===16,'Second page missing');
 await page.locator('#software-query').fill('alpha');assert(await page.locator('.software-row').count()===1,'Search did not match uncatalogued package');
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.AxonNavigation?.ready);assert(await page.locator('#software-query').inputValue()==='alpha','Search lost on reload');
 await page.locator('[data-detail="alpha"]').click();await page.locator('.software-dialog[open]').waitFor();assert((await page.locator('.software-dialog').innerText()).includes('/srv/custom/global'),'Exact installation location absent');await page.keyboard.press('Escape');await page.locator('.software-dialog').waitFor({state:'detached'});assert(await page.locator('.software-dialog').count()===0,'Escape did not dismiss dialog');
 await page.locator('#software-query').fill('');await page.locator('#software-manager').selectOption('');await page.locator('[data-mode="updates"]').click();
 assert(await page.locator('.software-row').count()===2,'Only manageable candidates should appear in updates');
 await page.locator('#software-select-page').click();await page.locator('#update-all-btn').click();await page.locator('.software-dialog[open]').waitFor();
 assert(requested.length===2,'Selection lost physical installation identities');
 await page.locator('.software-dialog summary').click();assert((await page.locator('.software-dialog').innerText()).includes('fixture-dependency'),'Dependency simulation not reviewable');assert(executions===0,'Planning executed software changes');
 await page.locator('.software-dialog').getByRole('button',{name:'Actualizar',exact:true}).click();assert(executions===1,'Explicit execute click did not use plan endpoint');assert(await page.locator('.software-dialog[open]').count()===1,'Failed execution lost review');await page.keyboard.press('Escape');await page.locator('.software-dialog').waitFor({state:'detached'});
 await page.locator('[data-mode="sources"]').click();assert((await page.locator('#programs-grid').innerText()).includes('No disponible en este host'),'Unavailable managers not explained');
 fail=true;await page.locator('#programs-refresh').click();await page.locator('[data-retry]').waitFor();assert(await page.locator('.software-source').count()===3,'Read failure erased previous inventory');fail=false;await page.locator('[data-retry]').click();
 await page.locator('[data-mode="installed"]').click();
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:960});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow at '+width);
  await page.locator('[data-detail="alpha"]').click();assert(await page.locator('.software-dialog').evaluate(d=>d.getBoundingClientRect().width<=innerWidth),'Dialog overflows at '+width);await page.keyboard.press('Escape');await page.locator('.software-dialog').waitFor({state:'detached'});
  if(width===1440||width===390)await page.screenshot({path:'docs/qa/software-2026-10-06/inventory-'+width+'.png',fullPage:false});
 }
 assert(!errors.length,'Runtime errors: '+errors.join('; '));
 console.log(JSON.stringify({ok:true,plans,executions,viewports:[1440,768,390,320],fixture:true,hostPackageMutations:0}));
}
