(() => {
  'use strict';
  const label={verified:'Verificado',queued:'Preparando',running:'En curso',failed:'Falló',interrupted:'Interrumpido'};
  const date=v=>v?new Date(v).toLocaleString('es-AR'):'Sin registro';
  const badge=v=>`<span class="platform-state" data-state="${esc(v)}">${esc(label[v]||v)}</span>`;
  const error=(node,e,retry)=>{node.querySelector('.platform-error')?.remove();const box=document.createElement('div');box.className='platform-error';box.setAttribute('role','alert');const text=document.createElement('span');text.textContent=e.message;const b=document.createElement('button');b.className='btn-secondary';b.textContent='Reintentar';b.onclick=()=>AxonUI.busy(b,retry);box.append(text,b);node.prepend(box);};
  const desktop=document.getElementById('desktop-content');let connected=false,clipboard='';
  async function loadDesktop(){
    if(!desktop.children.length)desktop.innerHTML='<p role="status">Consultando escritorio…</p>';
    try{
      const data=await api('/api/desktop');
      if(desktop.querySelector('iframe')&&data.connected)return;
      desktop.innerHTML=`<p>Sesión gráfica dedicada del servidor. Sus aplicaciones y perfiles continúan al cerrar esta pestaña.</p><div class="platform-toolbar"><span data-state role="status">${data.connected?'Conectando visor…':data.state==='active'?'Iniciando sesión…':'Escritorio detenido'}</span><button class="btn-primary" data-start ${data.missing.length?'disabled':''}>${data.connected?'Reconectar':'Iniciar escritorio'}</button><button class="btn-secondary" data-refresh>Actualizar</button>${data.state==='active'?'<button class="btn-danger" data-stop>Detener escritorio</button>':''}</div>${data.missing.length?`<p class="platform-warning">Faltan herramientas: ${data.missing.map(esc).join(', ')}</p>`:''}<div class="platform-toolbar">${data.applications.map(a=>`<button class="btn-secondary" data-app="${esc(a.id)}" ${data.connected?'':'disabled'}>Abrir ${esc(a.name)}</button>`).join('')}${data.connected?'<button class="btn-secondary" data-paste>Pegar texto</button><button class="btn-secondary" data-copy>Copiar texto recibido</button>':''}</div>${data.connected?'<iframe class="platform-frame" title="Escritorio gráfico del servidor" src="/desktop/view" allow="clipboard-read; clipboard-write"></iframe>':'<section class="platform-panel"><h3>Tu escritorio remoto</h3><p>Iniciá la sesión y abrí una aplicación para trabajar dentro del visor.</p></section>'}`;
      desktop.querySelector('[data-start]').onclick=e=>AxonUI.busy(e.currentTarget,async()=>{try{await api('/api/desktop/start',{method:'POST',body:{}});for(let n=0;n<10;n++){await new Promise(r=>setTimeout(r,500));if((await api('/api/desktop')).connected)break;}desktop.replaceChildren();await loadDesktop();}catch(err){error(desktop,err,loadDesktop);}});
      desktop.querySelector('[data-refresh]').onclick=loadDesktop;
      desktop.querySelector('[data-stop]')?.addEventListener('click',async e=>{if(await confirmDialog('Detener escritorio','Se cierran las aplicaciones de esta sesión dedicada. Guardá primero los cambios.','Detener escritorio'))await AxonUI.busy(e.currentTarget,async()=>{await api('/api/desktop/stop',{method:'POST',body:{}});desktop.replaceChildren();await loadDesktop();});});
      desktop.querySelectorAll('[data-app]').forEach(b=>b.onclick=()=>AxonUI.busy(b,async()=>{try{await api('/api/desktop/launch',{method:'POST',body:{app:b.dataset.app}});toast('Aplicación abierta en el escritorio','ok');}catch(e){error(desktop,e,loadDesktop);}}));
      desktop.querySelector('[data-paste]')?.addEventListener('click',async()=>{try{const text=await navigator.clipboard.readText();desktop.querySelector('iframe').contentWindow.postMessage({type:'axon:desktop-paste',text},location.origin);}catch(e){error(desktop,e,loadDesktop);}});
      desktop.querySelector('[data-copy]')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(clipboard);toast('Texto recibido copiado','ok');}catch(e){error(desktop,e,loadDesktop);}});
    }catch(e){error(desktop,e,loadDesktop);}
  }
  window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==desktop.querySelector('iframe')?.contentWindow)return;if(e.data?.type==='axon:desktop'){connected=e.data.state==='connected';const s=desktop.querySelector('[data-state]');if(s)s.textContent={connected:'Escritorio conectado',connecting:'Conectando…',disconnected:'Desconectado · intentando reconectar',failed:'La conexión falló'}[e.data.state]||'Sin conexión';}if(e.data?.type==='axon:desktop-clipboard'&&typeof e.data.text==='string')clipboard=e.data.text.slice(0,100000);});
  AxonPages.desktop={restore:loadDesktop,leave:()=>{desktop.querySelector('iframe')?.remove();connected=false;}};loaders.desktop=loadDesktop;
})();
