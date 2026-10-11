/** Compact headers: real isolated backend, read-only cloud fixture, native overlays. */
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const origin=process.env.AXON_QA_ORIGIN||'http://127.0.0.1:3459';
if(new URL(origin).hostname!=='127.0.0.1')throw new Error('Use an isolated local QA server');
const output=process.env.AXON_QA_OUTPUT||'/tmp/axon-header-qa';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:2280,height:1308}}),page=await context.newPage();
const errors:string[]=[],measurements:any[]=[];
page.on('pageerror',e=>errors.push(e.message));
const assert=(v:unknown,m:string)=>{if(!v)throw new Error(m);};
const provider={id:'dropbox',name:'Dropbox',configured:true,connected:true,visible:true,account:{name:'Cuenta de prueba',email:'qa@example.test'},sources:[{id:'account',name:'Mi Dropbox',type:'account'}]};
await page.route('**/api/connections',r=>r.fulfill({json:{ok:true,providers:[provider]}}));
await page.route(/\/api\/files\/dropbox\//,r=>{
  const action=new URL(r.request().url()).pathname.split('/')[4];
  return r.fulfill({json:action==='status'?{ok:true,...provider}:action==='list'?{ok:true,path:'',entries:[],cursor:null}:{ok:true,jobs:[]}});
});
const go=async(route:string)=>{await page.evaluate(route=>(window as any).AxonNavigation.go(route),route);};
const axe=async(selector:string)=>{
  const result=await new AxeBuilder({page}).include(selector).analyze();
  assert(!result.violations.length,'Accessibility '+selector+': '+result.violations.map(v=>v.id).join(','));
};
try{
  await page.goto(origin+'/archivos');await page.locator('#username').fill('qa');await page.locator('#password').fill('axon-local-qa');await page.locator('#login-form button[type=submit]').click();
  await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);
  await page.locator('#fm-disk-label').getByText('Disco interno',{exact:false}).waitFor();
  const root=await page.locator('#fm-location').inputValue();
  assert((await readFile(root+'/.axon-qa-owned','utf8')).includes('isolated-qa'),'Not an owned fixture');
  await writeFile(root+'/media/nota.txt','Contenido de prueba');
  for(const theme of ['axon','paper'])for(const width of [2280,1440,1024,768,390,320]){
    await page.setViewportSize({width,height:width>1100?1308:844});
    await page.evaluate(theme=>{(window as any).AxonThemes.setMode(theme==='axon'?'dark':'light');(window as any).setTheme(theme);},theme);
    for(const [route,tab,selector] of [['archivos','files','.fm-main'],['biblioteca','library','.lib-layout']]){
      await go('/'+route);await page.locator('#tab-'+tab+'.active '+selector).waitFor();
      await page.waitForTimeout(150);
      const top=await page.locator(selector).evaluate(el=>el.getBoundingClientRect().top);
      measurements.push({theme,width,route,top});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow '+route+' '+width);
      if(width===2280)assert(top<230,'Header too tall '+route+': '+top);
      if(route==='archivos')assert(await page.locator('.fm-main').evaluate(el=>el.getBoundingClientRect().height)>400,'File area collapsed '+width);
      if([2280,390].includes(width))await page.screenshot({path:output+'/'+theme+'-'+route+'-'+width+'.png'});
    }
  }
  await page.setViewportSize({width:1440,height:1000});await go('/archivos');
  await page.locator('#fm-edit-location').click();await page.locator('#fm-location').fill(root+'/media');await page.keyboard.press('Enter');
  await page.locator('.fm-row[data-name="nota.txt"]').waitFor();assert(await page.locator('#fm-breadcrumb').isVisible(),'Breadcrumb did not return');
  await page.keyboard.press('Control+Shift+l');await page.locator('#fm-location').fill('/cancelled');await page.keyboard.press('Escape');
  assert(await page.locator('#fm-location').inputValue()===root+'/media','Cancel changed path');
  await page.locator('#fm-disks-open').click();await page.locator('#fm-disks-dialog[open]').waitFor();await axe('#fm-disks-dialog');
  await page.keyboard.press('Escape');assert(await page.locator('#fm-disks-open').evaluate(el=>el===document.activeElement),'Disk modal lost focus');
  await page.locator('#fm-disks-open').click();await go('/almacenamiento?view=disks');await page.locator('#fm-disks-dialog').waitFor({state:'hidden'});await go('/archivos');
  await page.locator('#fm-disks-open').click();const volume=page.locator('#fm-volumes [data-volume]').first();await volume.click();await page.locator('#fm-disks-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(root=>(document.querySelector('#fm-location') as HTMLInputElement)?.value===root,root);
  await page.locator('#fm-disks-open').click();
  await page.route('**/api/files/volumes',r=>r.fulfill({status:503,json:{ok:false,error:'QA inventory outage'}}));
  await page.locator('#fm-volumes-refresh:not([disabled])').click();await page.locator('#fm-volumes-error:not(.hidden)').waitFor();
  assert(await page.locator('#fm-volumes [data-volume]').count()>0,'Refresh failure erased last inventory');
  await page.keyboard.press('Escape');assert(await page.locator('#fm-disks-open').getAttribute('class')?.then(s=>s?.includes('fm-disks-warning')),'Hidden disk error has no indicator');
  await page.unroute('**/api/files/volumes');await page.locator('#fm-disks-open').click();await page.locator('#fm-volumes-error.hidden').waitFor({state:'attached'});await page.keyboard.press('Escape');
  await page.locator('#fm-create-btn').click();await axe('#fm-create-menu');await page.locator('#fm-new-file-btn').click();await page.locator('#fm-create-name').waitFor();await page.keyboard.press('Escape');
  await page.locator('#fm-create-btn').click();await page.locator('#fm-mkdir-btn').click();await page.locator('.fm-prompt-modal').waitFor();await page.keyboard.press('Escape');
  await page.locator('#fm-create-btn').click();const chooser=page.waitForEvent('filechooser');await page.locator('#fm-upload-dir-btn').click();await chooser;assert(!await page.locator('#fm-create-menu').isVisible(),'Upload menu stayed open');
  await page.locator('[data-source=dropbox]').click();await page.locator('.cloud-panel:not([hidden])').waitFor();assert(await page.locator('.cloud-source-tabs').isVisible(),'Cloud source switcher hidden');
  await page.locator('[data-source=server]').click();await page.locator('#fm-breadcrumb').waitFor();assert(await page.locator('.fm-top .cloud-source-tabs').isVisible(),'Source switcher not restored');
  await go('/biblioteca');assert(await page.locator('#tab-library>.host-disks-panel').count()===0,'Library still has permanent disks');
  await page.locator('[data-host-disks-open]').click();await page.locator('.host-disks-dialog[open]').waitFor();await axe('.host-disks-dialog');
  const selection=await page.locator('#lib-body .sel').count();await page.keyboard.press('Control+a');assert(await page.locator('#lib-body .sel').count()===selection,'Modal shortcut changed library selection');
  await page.keyboard.press('Escape');assert(await page.locator('[data-host-disks-open]').evaluate(el=>el===document.activeElement),'Library modal lost focus');
  await page.locator('[data-host-disks-open]').click();await go('/archivos');await page.locator('.host-disks-dialog').waitFor({state:'hidden'});await go('/biblioteca');
  await page.locator('[data-host-disks-open]').click();await page.locator('.host-disks-dialog [data-host-volume]').first().click();await page.locator('#tab-files.active').waitFor();assert(!await page.locator('.host-disks-dialog').isVisible(),'Library disk dialog stayed open');
  await page.reload();await page.locator('#fm-breadcrumb').waitFor();assert(!await page.locator('#fm-disks-dialog').isVisible(),'Disk dialog opens on reload');
  const inventory=await page.evaluate(async()=>await (await fetch('/api/files/volumes')).json());
  const unmounted={...inventory.volumes[0],id:'qa-unmounted',uuid:'qa-unmounted-uuid',name:'Disco sin montar (QA)',hidden:false,technical:false,device:'/dev/qa-unmounted',diskId:'qa-unmounted',path:null,mountId:null,canMount:true};
  await page.route('**/api/files/volumes',r=>r.fulfill({json:{...inventory,volumes:[...inventory.volumes,unmounted]}}));
  await page.route('**/api/files/volumes/qa-unmounted/mount',r=>r.fulfill({status:503,json:{ok:false,error:'No se pudo montar (QA)'}}));
  await page.locator('#fm-disks-open').click();await page.locator('[data-volume=qa-unmounted]').click();await page.getByText('No se pudo montar (QA)',{exact:true}).waitFor();
  assert(await page.locator('[data-volume=qa-unmounted]').isEnabled(),'Failed mount blocks retry');await page.keyboard.press('Escape');
  await go('/biblioteca');await page.locator('[data-host-disks-open]').click();await page.locator('.host-disks-dialog [data-host-volume=qa-unmounted]').click();await page.locator('.host-disks-dialog').getByText('No se pudo montar (QA)',{exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.unroute('**/api/files/volumes');await page.unroute('**/api/files/volumes/qa-unmounted/mount');await go('/archivos');
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await page.locator('#fm-disks-open').click();await page.locator('#fm-disks-dialog[open]').waitFor();await axe('#fm-disks-dialog');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile disk modal overflow');
    await page.screenshot({path:output+'/files-disks-'+width+'.png'});await page.keyboard.press('Escape');
    await go('/biblioteca');await page.locator('[data-host-disks-open]').click();await page.locator('.host-disks-dialog[open]').waitFor();await axe('.host-disks-dialog');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile library disk modal overflow');
    await page.screenshot({path:output+'/library-disks-'+width+'.png'});await page.keyboard.press('Escape');await go('/archivos');
  }
  assert(!errors.length,'Runtime errors: '+errors.join('; '));
  await writeFile(output+'/report.json',JSON.stringify({ok:true,measurements,errors},null,2));
  console.log(JSON.stringify({ok:true,checks:['12 responsive/theme combinations per page','desktop density','editable address and cancellation','disk navigation and focus return','inventory failure/retry','create and upload entry points','server/cloud switching','library disk modal','reload','overlay accessibility'],measurements,errors}));
}finally{await browser.close();}
