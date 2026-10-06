const {chromium}=require('/home/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {default:AxeBuilder}=require('@axe-core/playwright');const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const findings=[];
 try{
  await page.goto('http://127.0.0.1:3459/');await page.locator('#username').waitFor();
  const scan=async name=>{const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();const issues=result.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))}));findings.push({screen:name,issues});console.log(JSON.stringify({screen:name,issues:issues.map(i=>({id:i.id,nodes:i.nodes.length,impact:i.impact}))}));};
  await scan('login');await page.locator('#username').fill('qa');await page.locator('#password').fill('axon-local-qa');await page.locator('#login-form button[type=submit]').click();await page.locator('#main-screen:not(.hidden)').waitFor();
  const sections=await page.evaluate(()=>Object.entries(AxonNavigation.sections).map(([id,[url]])=>({id,url})));
  for(const mode of ['light','dark']){await page.evaluate(mode=>{AxonThemes.setMode(mode);setTheme(mode==='dark'?'axon':'paper');},mode);for(const section of sections){await page.evaluate(url=>AxonNavigation.go(url),section.url);await page.locator('#tab-'+section.id+'.active').waitFor();await scan(mode+'/'+section.id);}}
  await page.evaluate(()=>{void confirmDialog('Verificar confirmación','Los datos de QA se conservan.','Confirmar');});await page.locator('#confirm-body').waitFor();await scan('confirmation');await page.locator('#confirm-cancel').click();
  if(findings.some(f=>f.issues.length))throw Error('Accessibility violations remain');
 }finally{await fs.writeFile('docs/redesign-implementation-2026-10-05/accessibility.json',JSON.stringify(findings,null,2)+'\n');await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
