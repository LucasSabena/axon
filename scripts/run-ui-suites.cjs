const {chromium}=require('/home/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs/promises');const vm=require('node:vm');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});const results=[];
 for(const name of process.argv.slice(2)){
  const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(20000);page.on('dialog',dialog=>dialog.accept());
  try{
   await page.goto('http://127.0.0.1:3459/');await page.locator('#username').fill('qa');await page.locator('#password').fill('axon-local-qa');await page.locator('#login-form button[type=submit]').click();await page.locator('#main-screen:not(.hidden)').waitFor();
   const run=vm.runInThisContext('('+await fs.readFile('scripts/'+name,'utf8')+')');
   const evidence=await run(page);results.push({suite:name,passed:true,evidence});console.log(JSON.stringify(results.at(-1)));
  }catch(error){await page.screenshot({path:'/tmp/axon-failed-'+name+'.png'}).catch(()=>{});results.push({suite:name,passed:false,error:error.stack});console.log(JSON.stringify(results.at(-1)));}
  finally{await context.close();}
 }
 await browser.close();await fs.writeFile('docs/redesign-implementation-2026-10-05/'+(process.env.AXON_BROWSER_REPORT||'browser-suites')+'.json',JSON.stringify(results,null,2)+'\n');if(results.some(r=>!r.passed))process.exitCode=1;
})();
