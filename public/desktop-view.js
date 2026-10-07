import RFB from './vendor/novnc/core/rfb.js';
import KeyTable from './vendor/novnc/core/input/keysym.js';
const status=document.getElementById('desktop-status'),screen=document.getElementById('desktop-screen'),bar=document.getElementById('desktop-bar');
let rfb,attempt=0,timer,closed=false,suspended=false,connectGen=0,mirror=false,bellTimer,live=false;
const MAX_ATTEMPTS=5;
function notify(state){window.parent.postMessage({type:'axon:desktop',state},location.origin);}
function setStatus(text){status.replaceChildren();if(text)status.append(document.createTextNode(text));status.hidden=!text;}
function reconnectButton(){const b=document.createElement('button');b.textContent='Reconectar';b.onclick=()=>{attempt=0;retry();};return b;}
async function fetchStatus(){
  try{const st=await fetch('/api/desktop',{cache:'no-store'}).then(r=>r.ok?r.json():null);return st||null;}
  catch{return null;}
}
async function connect(){
  // Generational guard: disconnect events from a superseded RFB must not
  // schedule retries that kill the live connection, and a slow status fetch
  // must not leave an orphaned second RFB behind.
  clearTimeout(timer);
  const gen=++connectGen;
  try{rfb?.disconnect();}catch{}
  screen.replaceChildren();setStatus('Conectando con el escritorio…');notify('connecting');
  const proto=location.protocol==='https:'?'wss':'ws';
  const st=await fetchStatus();
  if(gen!==connectGen||closed||suspended)return;
  mirror=!!st?.mirror||st?.display===':0';
  const password=st?.vncPassword||null;
  const mine=rfb=new RFB(screen,`${proto}://${location.host}/p/6117/`,password?{credentials:{password}}:undefined);
  mine.scaleViewport=true;mine.background='#181818';
  // Resizing the server's real monitor would disrupt local use; only the
  // dedicated Xvfb session accepts client-driven resolution changes.
  mine.resizeSession=!mirror;
  mine.viewOnly=document.getElementById('dv-viewonly')?.checked||false;
  mine.addEventListener('credentialsrequired',async(e)=>{
    const pw=(await fetchStatus())?.vncPassword||null;
    if(e.target!==rfb)return;
    if(pw)e.target.sendCredentials({password:pw});else e.target.disconnect();
  });
  mine.addEventListener('connect',()=>{if(mine!==rfb)return;live=true;attempt=0;setStatus('');notify('connected');});
  mine.addEventListener('disconnect',()=>{
    if(closed||suspended||mine!==rfb)return;
    live=false;
    if(attempt<MAX_ATTEMPTS){
      setStatus('Escritorio desconectado. Reintentando… ');status.append(reconnectButton());notify('disconnected');
      timer=setTimeout(retry,Math.min(15000,1000*2**attempt++));
    } else {
      setStatus('La conexión se perdió y los reintentos automáticos se agotaron. ');status.append(reconnectButton());notify('gaveup');
    }
  });
  mine.addEventListener('securityfailure',()=>{if(mine!==rfb)return;setStatus('No se pudo autenticar la conexión gráfica.');notify('failed');});
  mine.addEventListener('clipboard',e=>{window.parent.postMessage({type:'axon:desktop-clipboard',text:e.detail.text},location.origin);});
  mine.addEventListener('desktopname',e=>{if(mine!==rfb||!e.detail?.name)return;document.title='Escritorio AXON · '+e.detail.name;});
  mine.addEventListener('bell',()=>{
    if(mine!==rfb||!status.hidden)return;
    setStatus('Alerta sonora del escritorio');clearTimeout(bellTimer);
    bellTimer=setTimeout(()=>{if(rfb&&!status.querySelector('button'))setStatus('');},3000);
  });
}
// Ctrl+Alt+Flecha cambia de escritorio virtual en openbox; se envía la
// combinación completa porque el navegador no la deja pasar cruda.
const arrowCode={Left:'ArrowLeft',Right:'ArrowRight',Up:'ArrowUp',Down:'ArrowDown'};
function sendCtrlAlt(code){
  if(!rfb||!live)return;
  rfb.sendKey(KeyTable.XK_Control_L,'ControlLeft',true);rfb.sendKey(KeyTable.XK_Alt_L,'AltLeft',true);
  rfb.sendKey(KeyTable['XK_'+code],arrowCode[code],true);rfb.sendKey(KeyTable['XK_'+code],arrowCode[code],false);
  rfb.sendKey(KeyTable.XK_Alt_L,'AltLeft',false);rfb.sendKey(KeyTable.XK_Control_L,'ControlLeft',false);
}
bar.querySelector('[data-cad]').onclick=()=>{if(live)rfb?.sendCtrlAltDel();};
bar.querySelectorAll('[data-wm]').forEach(b=>b.onclick=()=>sendCtrlAlt(b.dataset.wm));
document.getElementById('dv-viewonly').addEventListener('change',e=>{if(rfb)rfb.viewOnly=e.target.checked;});
bar.querySelector('[data-fullscreen]').onclick=async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}
};
document.addEventListener('fullscreenchange',()=>{const b=bar.querySelector('[data-fullscreen]');if(b)b.textContent=document.fullscreenElement?'Salir de pantalla completa':'Pantalla completa';});
window.addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==window.parent)return;
  const m=e.data;
  if(m?.type==='axon:desktop-suspend'){suspended=true;clearTimeout(timer);try{rfb?.disconnect();}catch{}return;}
  if(m?.type==='axon:desktop-resume'){if(!suspended)return;suspended=false;attempt=0;retry();return;}
  if(m?.type==='axon:desktop-cad'){if(live)rfb?.sendCtrlAltDel();return;}
  // `live` evita el ruido "Tried changing state of a disconnected RFB object"
  // que noVNC loguea cuando el padre postea con el socket caído.
  if(m?.type!=='axon:desktop-paste'||typeof m.text!=='string'||m.text.length>100000||!rfb||!live)return;
  rfb.clipboardPasteFrom(m.text);
  if(m.paste){
    rfb.sendKey(KeyTable.XK_Control_L,'ControlLeft',true);rfb.sendKey(KeyTable.XK_v,'KeyV',true);
    rfb.sendKey(KeyTable.XK_v,'KeyV',false);rfb.sendKey(KeyTable.XK_Control_L,'ControlLeft',false);
  }
});
window.addEventListener('pagehide',()=>{closed=true;clearTimeout(timer);rfb?.disconnect();});
function retry(){
  if(closed||suspended)return;
  connect().catch(()=>{if(suspended||closed)return;setStatus('Error al conectar con el escritorio. ');status.append(reconnectButton());notify('failed');if(attempt<MAX_ATTEMPTS)timer=setTimeout(retry,Math.min(15000,1000*2**attempt++));});
}
retry();
