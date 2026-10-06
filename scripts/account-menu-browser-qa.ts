import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=createRequire('/home/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('playwright');
const {default:AxeBuilder}=createRequire(import.meta.url)('@axe-core/playwright');
const base=process.env.AXON_MENU_QA_BASE||'http://127.0.0.1:3459';
const production=base.startsWith('https:');
const out='docs/account-menu-fix-2026-10-05';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const findings:any[]=[],errors:string[]=[];
try{
 for(const mode of ['dark','light'])for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<768});
  if(production){const {createSession}=await import('../src/auth');const config=await Bun.file('data/config.json').json();await context.addCookies([{name:'axon_session',value:await createSession(config.auth.username),url:base,httpOnly:true,secure:true,sameSite:'Lax'}]);}
  const page=await context.newPage();page.on('pageerror',(e:Error)=>errors.push(e.message));
  await page.goto(base);
  if(!production){await page.locator('#username').fill('qa');await page.locator('#password').fill('axon-local-qa');await page.locator('#login-form button[type=submit]').click();}
  await page.locator('#main-screen:not(.hidden)').waitFor();await page.waitForFunction('()=>window.AxonNavigation?.ready&&!window.AxonNavigation.applying');
  await page.evaluate(mode=>{(window as any).AxonThemes.setMode(mode);(window as any).setTheme(mode==='dark'?'axon':'paper');},mode);
  const trigger=page.locator('#account-menu [slot=trigger]');
  const open=async()=>{await trigger.click();await page.getByRole('menuitem',{name:'Abrir terminal',exact:true}).waitFor();await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));};
  await open();
  const geometry=await page.evaluate(()=>{
   const menu=document.getElementById('account-menu')!;const panel=menu.shadowRoot!.querySelector('[part=menu]')!;const rect=panel.getBoundingClientRect();
   return {width:rect.width,left:rect.left,right:rect.right,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,items:[...menu.querySelectorAll('wa-dropdown-item')].map(el=>{const s=getComputedStyle(el);return {value:el.getAttribute('value'),paddingTop:parseFloat(s.paddingTop),paddingLeft:parseFloat(s.paddingLeft),height:el.getBoundingClientRect().height,font:s.fontSize,icons:el.querySelectorAll('[slot=icon] svg').length};}),dividerMargin:getComputedStyle(menu.querySelector('wa-divider')!).marginTop};
  });
  if(geometry.items.length!==5||geometry.items.some(i=>i.paddingTop<6||i.paddingLeft<12||i.height<(width<768?42:36)-.5||i.icons!==1)||geometry.left<0||geometry.right>width||geometry.overflow||parseFloat(geometry.dividerMargin)<6)throw Error('Broken menu geometry '+JSON.stringify(geometry));
  const axe=await new AxeBuilder({page}).include('#account-menu').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  if(axe.violations.length)throw Error('Menu accessibility '+JSON.stringify(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)}))));
  await page.screenshot({path:`${out}/${production?'production':'local'}-${mode}-${width}.png`});
  if(width===1440)await page.screenshot({clip:{x:width-330,y:0,width:330,height:320},path:`${out}/${production?'production':'local'}-${mode}-menu.png`});
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');await page.getByRole('menuitem',{name:'Abrir terminal',exact:true}).waitFor({state:'hidden'});
  if(!await trigger.evaluate(el=>el===document.activeElement))throw Error('Menu did not return focus to trigger');
  await open();await page.locator('.home-heading').click({position:{x:2,y:2}});await page.getByRole('menuitem',{name:'Abrir terminal',exact:true}).waitFor({state:'hidden'});
  if(width===1440){
   await open();await page.getByRole('menuitem',{name:'Apariencia',exact:true}).click();await page.locator('#settings-pane-appearance:not([hidden])').waitFor();
   await open();await page.getByRole('menuitem',{name:'Configuración y seguridad',exact:true}).click();await page.locator('#tab-settings.active').waitFor();
   // Verify confirmation still receives its styling and releases focus after the shared reset fix.
   await page.evaluate(()=>{void (window as any).confirmDialog('Confirmación de QA','Esta acción no cambia ningún dato.','Confirmar');});await page.locator('#confirm-body').waitFor();await page.locator('#confirm-cancel').click();await page.locator('#confirm-body').waitFor({state:'hidden'});
   if(!production){
    await open();await page.getByRole('menuitem',{name:'Vincular dispositivo',exact:true}).click();await page.locator('#pair-modal:not(.hidden)').waitFor();await page.waitForFunction('()=>!!document.querySelector("#pair-qr svg")');await page.locator('#pair-close').click();
    await open();await page.getByRole('menuitem',{name:'Abrir terminal',exact:true}).click();await page.locator('#tab-terminal.active').waitFor();
    await open();await page.getByRole('menuitem',{name:'Cerrar sesión',exact:true}).click();await page.locator('#login-screen:not(.hidden)').waitFor();
   }
  }
  findings.push({mode,width,geometry,accessibilityViolations:0,keyboard:true,outsideClick:true,appearanceAndSettings:width===1440,confirmation:width===1440,allActions:!production&&width===1440});await context.close();
 }
 if(errors.length)throw Error(JSON.stringify(errors));
 await writeFile(`${out}/${production?'production':'local'}-checks.json`,JSON.stringify({passed:true,base,findings,errors},null,2)+'\n');console.log(JSON.stringify({passed:true,base,scenarios:findings.length,errors}));
}finally{await browser.close();}
