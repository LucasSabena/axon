/** Read-only QA of the Navegador tab against production; only opens its own session. */
import {chromium} from 'playwright';
import {createSession} from '../src/auth';
import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const origin='https://ports.binaryserver.com.ar';
const output=process.env.AXON_QA_OUTPUT||'/tmp/axon-navegador-qa';await mkdir(output,{recursive:true});
const username=execFileSync('sudo',['-n','python3','-c','import json; print(json.load(open("data/config.json"))["auth"]["username"])'],{encoding:'utf8'}).trim();
const browser=await chromium.launch({headless:true,channel:'chrome'});
const assert=(v:unknown,m:string)=>{if(!v)throw Error(m);};
try{
  for(const [name,viewport] of [['desktop',{width:1440,height:950}],['mobile',{width:390,height:844}]] as const){
    const context=await browser.newContext({viewport});
    await context.addCookies([{name:'axon_session',value:await createSession(username),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
    const page=await context.newPage(),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    const info=await (await context.request.get(origin+'/api/browser/info')).json();
    assert(info.ok&&info.browser?.active==='active','browser unit not active: '+JSON.stringify(info).slice(0,300));
    assert(Array.isArray(info.tabs),'no tabs list');
    await page.goto(origin+'/navegador');
    await page.waitForSelector('#browser-bar .browser-chip',{timeout:20000});
    await page.waitForSelector('#browser-tabs',{timeout:10000});
    await page.click('#browser-manage-toggle');
    await page.waitForSelector('#browser-manage h3',{timeout:15000});
    await page.waitForTimeout(6000);
    const chips=await page.$$eval('#browser-bar .browser-chip',els=>els.map(e=>e.textContent?.trim()));
    // El selector de visor tiene que cambiar el título y el iframe.
    assert(await page.isVisible('#browser-follow'),'follow toggle missing');
    // Vista en vivo: captura por HTTP, sin WebSocket.
    await page.click('#browser-live-toggle');
    await page.waitForFunction(()=>{const i=document.querySelector('#browser-live-img') as HTMLImageElement|null;return !!i&&i.naturalWidth>0;},undefined,{timeout:20000});
    const live=await page.$eval('#browser-live-img',(i:HTMLImageElement)=>({w:i.naturalWidth,h:i.naturalHeight}));
    assert(live.w>0&&live.h>0,'live screenshot did not load: '+JSON.stringify(live));
    await page.click('#browser-live-toggle');
    await page.click('.browser-view[data-browser-view="agents"]');
    await page.waitForTimeout(3000);
    const agentTitle=(await page.textContent('#browser-title'))||'';
    assert(/agentes/i.test(agentTitle),'agents view did not switch: '+agentTitle);
    await page.click('.browser-view[data-browser-view="server"]');
    await page.waitForTimeout(3000);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    await page.screenshot({path:`${output}/${name}.png`});
    console.log(name,JSON.stringify(chips),'overflow:',overflow,'errors:',JSON.stringify(errors));
    assert(!overflow,'horizontal overflow on '+name);
    assert(!errors.length,'page errors');
    await context.close();
  }
  console.log('Navegador QA OK');
}finally{await browser.close();}
