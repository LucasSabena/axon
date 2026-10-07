const {chromium}=require(process.env.AXON_QA_PLAYWRIGHT_ENTRY || 'playwright');const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.AXON_QA_BROWSER_CHANNEL?{channel:process.env.AXON_QA_BROWSER_CHANNEL}:{})});const results=[];
 try{
  for(const base of process.argv.slice(2))for(let run=0;run<5;run++){
   const context=await browser.newContext();const page=await context.newPage();await page.goto(base);await page.locator('#username').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);
   const data=await page.evaluate(()=>{const resources=performance.getEntriesByType('resource');const nav=performance.getEntriesByType('navigation')[0];return {encoded:resources.reduce((n,r)=>n+r.encodedBodySize,0),decoded:resources.reduce((n,r)=>n+r.decodedBodySize,0),requests:resources.length,jsCss:resources.filter(r=>/\.js|\.css/.test(r.name)).length,loaded:resources.map(r=>new URL(r.name).pathname),dcl:nav.domContentLoadedEventEnd,load:nav.loadEventEnd};});results.push({base,run,...data});await context.close();
  }
 }finally{await browser.close();await fs.writeFile(process.env.AXON_QA_OUTPUT||'/tmp/axon-performance.json',JSON.stringify(results,null,2)+'\n');}
 for(const base of process.argv.slice(2)){const r=results.filter(r=>r.base===base);console.log(JSON.stringify({base,runs:r.length,encoded:Math.round(r.reduce((n,r)=>n+r.encoded,0)/r.length),decoded:Math.round(r.reduce((n,r)=>n+r.decoded,0)/r.length),requests:r[0].requests,jsCss:r[0].jsCss}));}
})().catch(e=>{console.error(e);process.exitCode=1;});
