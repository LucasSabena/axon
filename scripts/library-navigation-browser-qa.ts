/** Source selection and preview navigation against an owned, isolated backend. */
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const origin=process.env.AXON_QA_ORIGIN||'http://127.0.0.1:3459';
if(new URL(origin).hostname!=='127.0.0.1')throw new Error('Isolated QA only');
const output=process.env.AXON_QA_OUTPUT||'/tmp/axon-library-navigation-qa';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
const go=async(url:string)=>{await page.evaluate(url=>(window as any).AxonNavigation.go(url),url);};
const request=async(url:string,body?:unknown)=>page.evaluate(async({url,body})=>{
  const r=await fetch(url,body?{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
  return {status:r.status,data:await r.json()};
},{url,body});
try{
  await page.goto(origin+'/archivos');await page.locator('#username').fill('qa');await page.locator('#password').fill('axon-local-qa');await page.locator('#login-form button[type=submit]').click();
  await page.waitForFunction(()=>(window as any).AxonNavigation?.ready);
  await page.locator('#fm-location').waitFor({state:'attached'});
  await page.waitForFunction(()=>(document.querySelector('#fm-location') as HTMLInputElement)?.value.startsWith('/tmp/axon-polish-qa-'));
  const root=await page.locator('#fm-location').inputValue();
  assert((await readFile(root+'/.axon-qa-owned','utf8')).includes('isolated-qa'),'Fixture ownership');
  const folder=root+'/external-drive/photos';await mkdir(folder,{recursive:true});
  for(const [name,color] of [['a.svg','red'],['b.svg','blue'],['c.svg','green']])await writeFile(folder+'/'+name,`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/></svg>`);
  await go('/biblioteca');await page.locator('#tab-library .fm-nav-toggle').click();await page.locator('.fm-nav-i[data-action="lib-add"]').waitFor();
  await page.locator('.fm-nav-i[data-action="lib-add"]').click();await page.locator('#host-path-picker[open]').waitFor();
  await page.locator('#host-picker-path').fill(folder);await page.locator('#host-picker-location button[type=submit]').click();
  await page.waitForFunction(folder=>(document.querySelector('#host-picker-path') as HTMLInputElement).value===folder&&!document.querySelector('#host-picker-select')?.hasAttribute('disabled'),folder);
  await page.locator('#host-picker-select').click();
  for(let i=0;i<40&&!((await request('/api/library')).data.roots||[]).includes(folder);i++)await page.waitForTimeout(250);
  await page.evaluate(async()=>{await fetch('/api/library/rescan?wait=1',{method:'POST'});});
  const library=(await request('/api/library')).data;
  assert(library.roots.includes(root+'/media')&&library.roots.includes(folder),'Add discarded existing roots');
  assert(library.items.filter((it:any)=>it.p.startsWith(folder+'/')).length===3,'External folder not indexed');
  await request('/api/library/settings',{addRoot:folder});
  assert((await request('/api/library')).data.roots.filter((p:string)=>p===folder).length===1,'Duplicate source');
  const invalid=await request('/api/library/settings',{addRoot:folder+'/missing'});
  assert(invalid.status>=400,'Missing source accepted');
  assert((await request('/api/library')).data.roots.includes(folder),'Rejected source changed roots');
  await page.reload();await page.locator('#lib-body [data-id]').first().waitFor();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:900});
    await go('/biblioteca?type=folder&value='+encodeURIComponent(folder)+'&sort=name-asc');
    await page.locator('#lib-body [data-id]').first().click();await page.locator('#lv-next').waitFor();
    const before=await page.locator('#lv-stage').innerHTML();
    await page.locator('#lv-next').click();assert(await page.locator('#lv-stage').innerHTML()!==before,'Library next did not change file');
    await page.locator('#lv-prev').click();assert(await page.locator('#lv-stage').innerHTML()===before,'Library previous did not return');
    await page.locator('#lv-close').click();
    if(width<=768){
      await page.locator('#tab-library .fm-nav-toggle').click();assert(await page.locator('#tab-library .fm-nav-toggle').getAttribute('aria-expanded')==='true','Section toggle state');
      await page.locator('#fm-nav [data-nav-key="lib:all:"]').click();assert(await page.locator('#tab-library .fm-nav-toggle').getAttribute('aria-expanded')==='false','Sections did not close');
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Library overflow '+width);
    await go('/archivos?path='+encodeURIComponent(folder)+'&item=a.svg&sort=name&order=asc');
    await page.locator('#fm-prev-name').getByText('a.svg',{exact:true}).waitFor();
    assert(await page.locator('#fm-prev-previous').isDisabled(),'Previous enabled on first file');
    await page.locator('#fm-prev-next').click();await page.locator('#fm-prev-name').getByText('b.svg',{exact:true}).waitFor();
    await page.keyboard.press('ArrowRight');await page.locator('#fm-prev-name').getByText('c.svg',{exact:true}).waitFor();
    assert(await page.locator('#fm-prev-next').isDisabled(),'Next enabled on last file');
    await page.locator('#fm-prev-previous').click();await page.locator('#fm-prev-name').getByText('b.svg',{exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Files overflow '+width);
    await go('/archivos?path='+encodeURIComponent(folder)+'&item=c.svg&sort=name&order=desc');
    await page.locator('#fm-prev-name').getByText('c.svg',{exact:true}).waitFor();
    await page.locator('#fm-prev-next').click();await page.locator('#fm-prev-name').getByText('b.svg',{exact:true}).waitFor();
    await page.locator('#fm-filter').fill('b.svg');
    await page.waitForFunction(()=>document.querySelector('#fm-prev-next')?.hasAttribute('disabled')&&document.querySelector('#fm-prev-previous')?.hasAttribute('disabled'));
    if(width===390)await page.screenshot({path:output+'/mobile.png'});
  }
  for(const route of ['/agentes','/biblioteca']){await go(route);assert(await page.locator('#tab-agents>.host-disks-panel,#tab-library>.host-disks-panel').count()===0,'Redundant disk panel');}
  assert(!errors.length,errors.join('; '));const report={ok:true,widths:[1440,768,390,320],checks:['external folder picker and indexing','preserve existing sources','deduplicate sources','invalid source rejection','visible viewer arrows','keyboard navigation','queue boundaries and active filters','descending sort','mobile sections dismissal','no horizontal overflow','no redundant disk panels'],errors};await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
