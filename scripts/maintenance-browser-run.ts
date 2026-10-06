import {createRequire} from 'node:module';
import {realpath,writeFile} from 'node:fs/promises';
const entry=process.env.AXON_QA_PLAYWRIGHT_ENTRY;if(!entry)throw new Error('AXON_QA_PLAYWRIGHT_ENTRY required');
const {chromium}=createRequire(await realpath(entry))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();await page.goto('http://127.0.0.1:3459/');
 const fn=(0,eval)('('+await Bun.file('scripts/maintenance-browser-qa.js').text()+')');await fn(page);
 const report=await page.evaluate(()=>(window as any).__maintenanceQaReport);await writeFile('docs/qa/maintenance-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 await page.screenshot({path:'docs/qa/maintenance-desktop.png'});await page.setViewportSize({width:390,height:900});await page.screenshot({path:'docs/qa/maintenance-mobile.png'});
 // Real fixture cleaner, then reload history to reconcile durable worker.
 await page.goto('http://127.0.0.1:3459/almacenamiento');await page.locator('#storage-content [data-candidate]').first().waitFor();await page.locator('[data-candidate]').first().check();await page.locator('#storage-review').click();await page.locator('#storage-execute').click();await page.locator('#confirm-ok').click();await page.waitForURL('**view=history**');await page.reload();await page.waitForFunction(()=>document.querySelector('#storage-content')?.textContent.includes('Selección eliminada y ausencia verificada'));
 const removed=await page.evaluate(async()=>{const history=await fetch('/api/storage/history').then(r=>r.json());return history.plans.find(p=>p.state==='verified');});if(!removed)throw new Error('Cleanup not verified after reload');
 // Selected fixture contents only, no other paths are writable through the QA boundary.
 const api=await page.evaluate(async()=>{const r=await fetch('/api/files/transfers/plans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'move',from:'/etc/hosts',to:'/tmp/axon-not-owned'})});return r.status;});if(api!==403)throw new Error('Fixture confinement missing');
 // Real browser upload/editor and authenticated fixture API for share/reference behavior.
 const home=await page.evaluate(async()=>{const r=await fetch('/api/files').then(r=>r.json());return r.path;});
 const media=home+'/media',source=media+'/browser-upload.txt',moved=media+'/browser-moved.txt';
 await page.goto('http://127.0.0.1:3459/archivos?path='+encodeURIComponent(media));await page.locator('#tab-files.active').waitFor();
 await page.locator('#fm-file-input').setInputFiles({name:'browser-upload.txt',mimeType:'text/plain',buffer:Buffer.from('Fixture subida desde navegador')});await page.locator('.fm-row[data-name="browser-upload.txt"]').waitFor();
 await page.goto('http://127.0.0.1:3459/archivos?'+new URLSearchParams({path:media,item:'browser-upload.txt',edit:'1'}));await page.locator('#fm-editor:not(.hidden)').waitFor();await page.locator('#fm-editor-text').fill('Fixture editada');await page.locator('#fm-save-btn').click();await page.locator('.fm-diff-save').click();await page.waitForFunction(()=>document.querySelector('#fm-dirty-dot')?.classList.contains('hidden'));
 const operations=await page.evaluate(async({source,moved})=>{
  const request=async(url,body)=>{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const b=await r.json();if(!r.ok)throw new Error(url+' '+r.status+' '+b.error);return b;};
  await request('/api/library/rescan',{});let library=await fetch('/api/library').then(r=>r.json());let item=library.items.find(i=>i.path===source||i.p===source);if(!item)throw new Error('Uploaded item not indexed');
  await request('/api/library/favorite',{ids:[item.id],on:true});const shared=await request('/api/library/shares',{ids:[item.id],title:'Fixture QA',cdn:false,notifyActivity:false});
  const plan=await request('/api/files/transfers/plans',{mode:'move',from:source,to:moved});await request('/api/files/transfers/'+plan.plan.id+'/execute',{digest:plan.plan.digest});
  return {id:plan.plan.id,shareId:shared.share.id};
 },{source,moved});
 await page.goto('http://127.0.0.1:3459/archivos?path='+encodeURIComponent(media));await page.reload();await page.locator('#fm-transfer-history').waitFor();
 await page.waitForFunction(()=>document.querySelector('#fm-transfer-history')?.textContent.includes('verified'));
 const result=await page.evaluate(async({source,moved,shareId,id})=>{
  const library=await fetch('/api/library').then(r=>r.json()),item=library.items.find(i=>i.path===moved||i.p===moved);if(!item||!library.favorites.includes(item.id))throw new Error('Move did not preserve favorite reference');
  const download=await fetch('/s/'+shareId+'/f/0');if(!download.ok||await download.text()!=='Fixture editada')throw new Error('Share did not follow moved file');
  const trash=await fetch('/api/files/trash',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({paths:[moved]})}).then(r=>r.json());if(!trash.ok)throw new Error('Trash failed');
  const items=await fetch('/api/storage/trash').then(r=>r.json()),entry=items.items.find(i=>i.orig===moved);if(!entry)throw new Error('Shared XDG item missing');const restore=await fetch('/api/storage/trash/restore',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:entry.id})});if(!restore.ok)throw new Error('Restore failed');
  const original=await fetch('/api/files/download?path='+encodeURIComponent(moved));if(!original.ok||await original.text()!=='Fixture editada')throw new Error('Restored download differs');return true;
 },{source,moved,shareId:operations.shareId,id:operations.id});
 if(!result)throw new Error('Fixture file flow incomplete');
 report.checks.push('Navegador: subir y editar un archivo real de fixture','Transferencia durable después de recargar, favorito y share siguen al archivo movido','Papelera XDG, restauración y descarga conservan el contenido');
 report.checks.push('Limpieza real de fixture seleccionada, progreso, recibo medido y recarga del historial','QA rechaza transferencias fuera de su fixture');await writeFile('docs/qa/maintenance-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({extraChecks:report.checks.slice(-2)}));await context.close();
}finally{await browser.close();}
