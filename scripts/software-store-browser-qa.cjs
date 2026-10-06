async page => {
 const assert=(v,m)=>{if(!v)throw new Error(m);},errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.unroute('**/api/software**');
 const row=(id,scope,canUpdate)=>({id,name:'New application',packageName:'app/org.Test.New/x86_64/stable',applicationId:'org.Test.New',manager:'flatpak',scope,user:scope==='system'?'root':'custom-user',uid:scope==='system'?0:42,root:scope==='system'?'/var/lib/flatpak':'/srv/user/flatpak',version:'1.0',kind:'application',executables:[],canUpdate,updateState:canUpdate?'available':'current',targetCommit:canUpdate?'a'.repeat(64):null,reason:'',iconUrl:'/api/software/icons/'+id});
 const sys=row('pkg-system','system',false),user=row('pkg-user','user',true),extra={...row('pkg-extra','user',false),name:'Uncatalogued app',packageName:'fixture-extra',applicationId:'org.Test.Extra'};
 const snapshot={ok:true,installations:[sys,user,extra],sources:[],checkedAt:Date.now(),canAdministerSystem:true};let reviewed=[];
 await page.route('**/api/software**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.includes('/icons/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'});
  if(u.pathname==='/api/software/plan'){reviewed=route.request().postDataJSON().ids;return route.fulfill({json:{ok:true,plan:{id:'fixture-plan',transactions:[{manager:'flatpak',scope:'user',user:'custom-user',items:[user],effects:'Commit exacto',simulation:{complete:false,changes:[],removals:[]}}]}}});}
  if(u.pathname==='/api/software')return route.fulfill({json:snapshot});
  throw new Error('Unexpected mutation '+u.pathname);
 });
 await page.route('**/api/store**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.includes('/icons/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'});
  if(u.pathname==='/api/store')return route.fulfill({json:{ok:true,canAdministerSystem:true,flatpak:true,apt:false,checkedAt:Date.now(),apps:[{id:'org.Test.New',name:'New application',package:'org.Test.New',description:'Fixture of a new catalog entry',category:'Flathub',backend:'flatpak',installed:true,version:'1.0',url:'https://example.test',installations:[sys,user]}],installedApplications:[sys,user,extra],installedFlatpak:{'org.Test.New':'1.0'},sources:[],jobs:[]}});
  throw new Error('Store bypassed installation review '+u.pathname);
 });
 await page.goto('http://127.0.0.1:3459/tienda',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.AxonNavigation?.ready);await page.locator('.store-card').first().waitFor();
 assert(await page.locator('.store-card').count()===2,'Uncatalogued installation missing or duplicated');
 assert(await page.locator('.store-app-icon img').first().getAttribute('src')==='/api/store/icons/org.Test.New','New catalog entry did not use automatic icon endpoint');
 await page.locator('[data-store-action="update"]').click();await page.locator('.software-dialog[open]').waitFor();
 assert(await page.locator('[data-choice="pkg-system"]').isDisabled(),'Read-only installation was selectable for update');
 await page.locator('[data-choice="pkg-user"]').click();await page.locator('.software-dialog').filter({hasText:'Commit exacto'}).waitFor();assert(reviewed.length===1&&reviewed[0]==='pkg-user','Store updated a different scope or package identity');
 await page.keyboard.press('Escape');await page.locator('.software-dialog').waitFor({state:'detached'});
 await page.locator('[data-detail="pkg-extra"]').click();await page.locator('.software-row').first().waitFor();assert(page.url().includes('/programas?view=installed&q=fixture-extra'),'Uncatalogued store entry did not open shared inventory');
 assert(await page.locator('.software-row').count()===1,'Shared inventory did not filter to the selected installation');assert(!errors.length,'Runtime errors: '+errors.join('; '));
}
