import { chromium } from 'playwright';
import { createSession } from '../src/auth';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const origin = process.env.AXON_PRODUCTION_QA_ORIGIN || 'https://ports.binaryserver.com.ar';
const config = process.env.CONFIG_PATH || 'data/config.json';
const username = await readFile(config, 'utf8').then(text => JSON.parse(text).auth.username).catch(error => {
 if(error.code!=='EACCES')throw error;
 return execFileSync('sudo',['-n','python3','-c','import json,sys; print(json.load(open(sys.argv[1]))["auth"]["username"])',config],{encoding:'utf8'}).trim();
});
const fixture = await mkdtemp(tmpdir() + '/axon-html-production-qa-');
const browser = await chromium.launch({headless:true,channel:'chrome'});
const context = await browser.newContext({viewport:{width:1440,height:1000}});
await context.addCookies([{name:'axon_session',value:await createSession(username),url:origin,httpOnly:true,secure:origin.startsWith('https:'),sameSite:'Lax'}]);
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error(message)};
const checks:string[]=[], errors:string[]=[];
try {
 await writeFile(fixture+'/style.css','body{margin:24px;background:#f4f8ff;font:18px system-ui}h1{color:rgb(12,34,56)}');
 const html='<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="style.css"><h1>Vista HTML de AXON</h1><p>Diseño renderizado en Archivos.</p><script>parent.htmlExecuted=true</script>';
 await writeFile(fixture+'/vista.html',html);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/archivos?'+new URLSearchParams({path:fixture,item:'vista.html',view:'list'}));
 await page.waitForFunction(()=>(window as any).AxonNavigation?.ready&&!(window as any).AxonNavigation.applying);
 const frame=page.frameLocator('#fm-editor-preview iframe');
 await frame.getByRole('heading',{name:'Vista HTML de AXON'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('#fm-editor-preview iframe')?.getAttribute('sandbox')==='allow-same-origin');
 await page.waitForTimeout(500);
 assert(await frame.locator('h1').evaluate(el=>getComputedStyle(el).color)==='rgb(12, 34, 56)','Production relative CSS failed');
 assert(!await page.evaluate(()=>(window as any).htmlExecuted),'Script executed');
 checks.push('Published HTML renders with authenticated local CSS and disabled scripts');
 await page.getByRole('button',{name:'Editor',exact:true}).click();
 const editor=page.locator('#fm-editor-text');await editor.fill(html.replace('Vista HTML de AXON','Borrador HTML'));
 await page.keyboard.press('Control+e');await frame.getByRole('heading',{name:'Borrador HTML'}).waitFor();
 assert(await readFile(fixture+'/vista.html','utf8')===html,'Draft wrote source file');
 await page.getByRole('button',{name:'Editor',exact:true}).click();await editor.fill(html);await page.keyboard.press('Control+e');
 checks.push('Published editor, draft preview and original preservation');
 await mkdir('/tmp/axon-html-production-report',{recursive:true});
 for(const width of [320,390,1440]) {
  await page.setViewportSize({width,height:950});await page.waitForTimeout(300);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Production horizontal overflow');
  await page.screenshot({path:'/tmp/axon-html-production-report/view-'+width+'.png'});
 }
 checks.push('Production browser at 320/390/1440px');assert(!errors.length,errors.join('; '));
 const report={passed:true,checks,errors};await writeFile('/tmp/axon-html-production-report/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {
 await context.request.post(origin+'/api/logout',{headers:{Origin:origin},data:{}}).catch(()=>{});
 await browser.close();await rm(fixture,{recursive:true,force:true});
}
