import RFB from './vendor/novnc/core/rfb.js';
const status=document.getElementById('desktop-status'),screen=document.getElementById('desktop-screen');
let rfb,attempt=0,timer,closed=false;
function notify(state){window.parent.postMessage({type:'axon:desktop',state},location.origin);}
function connect(){
  clearTimeout(timer);screen.replaceChildren();status.textContent='Conectando con el escritorio…';notify('connecting');
  const proto=location.protocol==='https:'?'wss':'ws';
  rfb=new RFB(screen,`${proto}://${location.host}/p/6117/`);rfb.scaleViewport=true;rfb.resizeSession=false;rfb.background='#181818';
  rfb.addEventListener('connect',()=>{attempt=0;status.textContent='Escritorio conectado · las aplicaciones se ejecutan en el servidor';notify('connected');});
  rfb.addEventListener('disconnect',()=>{
    if(closed)return;status.textContent='Escritorio desconectado. ';notify('disconnected');
    const b=document.createElement('button');b.textContent='Reconectar';b.onclick=()=>{attempt=0;connect();};status.append(b);
    if(attempt<5)timer=setTimeout(connect,Math.min(15000,1000*2**attempt++));
  });
  rfb.addEventListener('securityfailure',()=>{status.textContent='No se pudo autenticar la conexión gráfica.';notify('failed');});
  rfb.addEventListener('clipboard',e=>{window.parent.postMessage({type:'axon:desktop-clipboard',text:e.detail.text},location.origin);});
}
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent)return;if(e.data?.type==='axon:desktop-paste'&&typeof e.data.text==='string'&&e.data.text.length<=100000)rfb?.clipboardPasteFrom(e.data.text);});
window.addEventListener('pagehide',()=>{closed=true;clearTimeout(timer);rfb?.disconnect();});
connect();
