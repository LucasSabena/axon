const { chromium } = require(process.env.AXON_QA_PLAYWRIGHT_ENTRY || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.AXON_ACCOUNTS_QA_URL || 'http://127.0.0.1:3459';
const fixture = process.env.AXON_ACCOUNTS_QA_HOME;
const companyLabel='Empresa QA '+Date.now();const renamedLabel='Trabajo QA '+Date.now();
const assert = (condition, message) => { if (!condition) throw new Error(message); };
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const errors=[];
  try {
    const context = await browser.newContext({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']});
    const page = await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    page.on('response',async r=>{if(r.url().includes('/api/agent-accounts')&&r.status()>=400)console.error('Account API',r.status(),await r.text());});
    await page.goto(base);
    await page.locator('#username').fill('qa'); await page.locator('#password').fill('axon-local-qa');
    await page.locator('#login-form').evaluate(form=>form.requestSubmit());
    await page.waitForFunction(()=>document.querySelector('#login-screen').classList.contains('hidden'));
    await page.goto(base+'/agentes?id=codex&tab=provider');
    await page.getByRole('button',{name:'Agregar cuenta',exact:true}).first().waitFor({timeout:60000});
    await page.getByRole('button',{name:'Agregar cuenta',exact:true}).first().click();
    await page.locator('#ag-account-label').fill(companyLabel);
    await page.locator('.ag-account-form button[type=submit]').click();
    await page.getByText(companyLabel,{exact:true}).waitFor();
    if (fixture) {
      const response=await context.request.get(base+'/api/agent-accounts/codex');const data=await response.json();
      const p=data.profiles.find(x=>x.label===companyLabel);
      assert(p.home.startsWith(fixture+'/'),'Profile escaped fixture');
      const payload=Buffer.from(JSON.stringify({email:'company@example.test'})).toString('base64url');
      await fs.writeFile(path.join(p.home,'auth.json'),JSON.stringify({tokens:{id_token:'x.'+payload+'.x',refresh_token:'fake-refresh',access_token:'fake-access'}}),{mode:0o600});
      const companyRow=page.locator('.ag-account-row').filter({has:page.getByText(companyLabel,{exact:true})});
      await companyRow.getByRole('button',{name:'Usar esta cuenta',exact:true}).waitFor({timeout:15000});
      await companyRow.getByRole('button',{name:'Usar esta cuenta',exact:true}).click();
      await page.waitForFunction(label=>document.querySelector('.ag-account-active strong')?.textContent===label,companyLabel);
      await page.reload();await page.locator('.ag-account-active').getByText('company@example.test',{exact:true}).waitFor({timeout:60000});
      assert(await page.locator('.ag-account-active strong').textContent()===companyLabel,'Default did not persist');
      await page.getByRole('button',{name:'Cambiar nombre de '+companyLabel}).click();await page.locator('#ag-account-label').fill(renamedLabel);await page.locator('.ag-account-form button[type=submit]').click();
      await page.getByText(renamedLabel,{exact:true}).waitFor();
    }
    await page.screenshot({path:'/tmp/axon-accounts-desktop.png',fullPage:true});
    await page.evaluate(()=>openJobModal({id:'qa-login',title:'Codex · Conectar Empresa',status:'running',steps:[{label:'Iniciar sesión',status:'running'}],startedAt:new Date().toISOString(),log:'\x1b[32mAbrí https://auth.openai.com/codex/device\x1b[0m\nCódigo: TEST-1234\n<img src=x onerror=alert(1)>'}));
    await page.locator('#job-login-links a').waitFor();
    assert(await page.locator('#job-log img').count()===0,'Output executed markup');
    await page.getByRole('button',{name:'Copiar link',exact:true}).click();
    assert(await page.evaluate(()=>navigator.clipboard.readText())==='https://auth.openai.com/codex/device','Link copy mismatch');
    await page.locator('#job-select').click();
    const before=await page.evaluate(()=>getSelection().toString());
    await page.evaluate(()=>renderJob({id:'qa-login',title:'Login',status:'running',steps:[],log:'New output'}));
    assert(await page.evaluate(()=>getSelection().toString())===before,'Polling destroyed selection');
    await page.evaluate(()=>getSelection().removeAllRanges());
    await page.evaluate(()=>renderJob({id:'qa-login',title:'Login',status:'ok',steps:[],log:'New output'}));
    assert(await page.locator('#job-log').textContent()==='New output','Pending output did not update');
    await page.screenshot({path:'/tmp/axon-login-desktop.png'});
    await page.locator('#job-close').click();
    await page.goto(base+'/terminal');await page.locator('.xterm').first().waitFor();
    // QA intentionally blocks the real host WebSocket. Use xterm's rendered
    // buffer and a socket stub to verify clipboard and paste without commands.
    await page.evaluate(()=>{const s=termSessions.get(activeTerm);s.ws?.close();s.term.reset();s.term.write('Login URL: https://auth.openai.com/codex/device\r\nCopy fixture');});
    await page.waitForTimeout(400);
    await page.locator('#term-select').click();
    await page.locator('#term-copy').click();
    assert((await page.evaluate(()=>navigator.clipboard.readText())).includes('https://auth.openai.com/codex/device'),'Terminal copy failed');
    await page.evaluate(()=>{window.__qaInput=[];const s=termSessions.get(activeTerm);s.term.clearSelection();s.ws={readyState:1,send:v=>window.__qaInput.push(JSON.parse(v)),close:()=>{}};return navigator.clipboard.writeText('TEST-1234');});
    await page.locator('#term-paste').click();
    await page.waitForTimeout(500);
    assert(await page.evaluate(()=>window.__qaInput.some(v=>v.t==='i'&&v.d==='TEST-1234')),'Paste did not reach terminal input: '+JSON.stringify(await page.evaluate(()=>({input:window.__qaInput,toasts:document.querySelector('#toast-container').textContent,clipboard:navigator.clipboard.readText()}))));
    await page.evaluate(()=>{const s=termSessions.get(activeTerm);s.term.select(0,0,10);s.term.focus();});
    await page.keyboard.press('Control+c');
    assert(await page.evaluate(()=>!window.__qaInput.some(v=>v.d==='\u0003')),'Copy selection sent Ctrl+C to process');
    await page.screenshot({path:'/tmp/axon-terminal-desktop.png'});
    for(const width of [390,320]){
      await page.setViewportSize({width,height:900});await page.goto(base+'/agentes?id=codex&tab=provider');await page.locator('[data-account-add]').waitFor({timeout:60000});
      await page.waitForTimeout(500);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Account mobile overflow '+width);
      await page.screenshot({path:'/tmp/axon-accounts-mobile-'+width+'.png',fullPage:true});
      await page.evaluate(()=>openJobModal({id:'qa',title:'Codex · Conectar Empresa',status:'ok',steps:[],log:'https://auth.openai.com/codex/device\nCódigo: TEST-1234'}));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Login mobile overflow '+width);
      await page.screenshot({path:'/tmp/axon-login-mobile-'+width+'.png'});await page.locator('#job-close').click();
    }
    assert(!errors.length,JSON.stringify(errors));
    console.log(JSON.stringify({accountCreate:true,activationAndReload:!!fixture,rename:!!fixture,loginLinks:true,copyLink:true,selectionSurvivesPolling:true,terminalCopyPaste:true,copyDoesNotInterruptProcess:true,mobile:[390,320],browserErrors:errors,realLogins:false}));
    await context.close();
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
