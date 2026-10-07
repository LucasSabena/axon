(() => {
  'use strict';
  const label={verified:'Verificado',queued:'Preparando',running:'En curso',failed:'Falló',interrupted:'Interrumpido'};
  const date=v=>v?new Date(v).toLocaleString('es-AR'):'Sin registro';
  const badge=v=>`<span class="platform-state" data-state="${esc(v)}">${esc(label[v]||v)}</span>`;
  const error=(node,e,retry)=>{node.querySelector('.platform-error')?.remove();const box=document.createElement('div');box.className='platform-error';box.setAttribute('role','alert');const text=document.createElement('span');text.textContent=e.message;const b=document.createElement('button');b.className='btn-secondary';b.textContent='Reintentar';b.onclick=()=>AxonUI.busy(b,retry);box.append(text,b);node.prepend(box);};
  const desktop=document.getElementById('desktop-content');let connected=false,clipboard='',openedApps=[];
  async function loadDesktop(){
    if(!desktop.children.length)desktop.innerHTML='<p role="status">Consultando escritorio…</p>';
    try{
      const data=await api('/api/desktop');
      if(!data.connected)openedApps.length=0;
      // The iframe survives section switches (suspended, not destroyed); a
      // live viewer only needs a resume nudge instead of a full re-render.
      const liveFrame=desktop.querySelector('iframe');
      if(liveFrame&&data.connected){liveFrame.contentWindow.postMessage({type:'axon:desktop-resume'},location.origin);return;}
      desktop.innerHTML=`<p>Sesión gráfica dedicada del servidor. Sus aplicaciones y perfiles continúan al cerrar esta pestaña.</p>${data.mirror||data.display===':0'?'<p class="platform-warning">Estás viendo la pantalla física del servidor: todo lo que hagas acá se muestra en el monitor conectado y puede interferir con su uso local. El tamaño de pantalla no se puede cambiar en este modo.</p>':''}<div class="platform-toolbar"><span data-state role="status">${data.connected?'Conectando visor…':data.state==='active'?'Iniciando sesión…':'Escritorio detenido'}</span><button class="btn-primary" data-start ${data.missing.length?'disabled':''}>${data.connected?'Reconectar':'Iniciar escritorio'}</button><button class="btn-secondary" data-refresh>Actualizar</button>${data.state==='active'?'<button class="btn-danger" data-stop>Detener escritorio</button>':''}</div>${data.missing.length?`<p class="platform-warning">Faltan herramientas: ${data.missing.map(esc).join(', ')}</p>`:''}<div class="platform-toolbar">${data.applications.map(a=>`<button class="btn-secondary" data-app="${esc(a.id)}" ${data.connected?'':'disabled'}>Abrir ${esc(a.name)}</button>`).join('')}${data.connected?'<button class="btn-secondary" data-paste>Pegar texto</button><button class="btn-secondary" data-copy>Copiar texto recibido</button>':''}</div>${data.connected?`<p data-opened role="status" hidden></p><div class="platform-toolbar">${data.mirror||data.display===':0'?'':'<label class="desktop-field">Tamaño <select data-res aria-label="Resolución de la sesión dedicada"><option>1024x768</option><option>1280x800</option><option selected>1440x900</option><option>1600x900</option><option>1920x1080</option></select></label><button class="btn-secondary" data-resize>Aplicar tamaño</button>'}<button class="btn-secondary" data-tall>Ampliar visor</button><button class="btn-secondary" data-cad>Ctrl+Alt+Supr</button><small>El visor se conecta solo por loopback del servidor, con una contraseña nueva por sesión.</small></div><iframe class="platform-frame" title="Escritorio gráfico del servidor" src="/desktop/view" allow="clipboard-read; clipboard-write; fullscreen"></iframe><section class="platform-panel desktop-send"><h3>Enviar al escritorio</h3><div class="platform-form"><label>Texto al portapapeles remoto<textarea data-send-text rows="3" placeholder="Escribí o pegá acá lo que quieras enviar — el botón lo lleva al portapapeles del escritorio. También podés pegar una imagen copiada para subirla como archivo."></textarea></label></div><div class="platform-toolbar"><button class="btn-secondary" data-send-clipboard>Al portapapeles remoto</button><button class="btn-primary" data-send-paste>Enviar y pegar</button></div><div class="platform-toolbar desktop-send-file"><input type="file" data-send-file aria-label="Archivo a enviar"><select data-send-dir aria-label="Carpeta destino en el servidor"><option value="~/Downloads">~/Downloads</option><option value="~/Desktop">~/Desktop</option><option value="~">Carpeta personal</option></select><button class="btn-secondary" data-send-upload>Subir archivo</button></div><p class="desktop-send-status" data-send-status role="status"></p></section>`:'<section class="platform-panel"><h3>Tu escritorio remoto</h3><p>Iniciá la sesión y abrí una aplicación para trabajar dentro del visor.</p></section>'}`;
      desktop.querySelector('[data-start]').onclick=e=>AxonUI.busy(e.currentTarget,async()=>{try{await api('/api/desktop/start',{method:'POST',body:{}});for(let n=0;n<10;n++){await new Promise(r=>setTimeout(r,500));if((await api('/api/desktop')).connected)break;}desktop.replaceChildren();await loadDesktop();}catch(err){error(desktop,err,loadDesktop);}});
      desktop.querySelector('[data-refresh]').onclick=loadDesktop;
      desktop.querySelector('[data-stop]')?.addEventListener('click',async e=>{if(await confirmDialog('Detener escritorio','Se cierran las aplicaciones de esta sesión dedicada. Guardá primero los cambios.','Detener escritorio'))await AxonUI.busy(e.currentTarget,async()=>{await api('/api/desktop/stop',{method:'POST',body:{}});desktop.replaceChildren();await loadDesktop();});});
      desktop.querySelectorAll('[data-app]').forEach(b=>b.onclick=()=>AxonUI.busy(b,async()=>{try{await api('/api/desktop/launch',{method:'POST',body:{app:b.dataset.app}});toast('Aplicación abierta en el escritorio','ok');const name=b.textContent.replace(/^Abrir /,'');if(!openedApps.includes(name))openedApps.push(name);const el=desktop.querySelector('[data-opened]');if(el){el.textContent='Abiertas en esta visita: '+openedApps.join(', ');el.hidden=false;}}catch(e){error(desktop,e,loadDesktop);}}));
      const openedEl=desktop.querySelector('[data-opened]');
      if(openedEl&&openedApps.length){openedEl.textContent='Abiertas en esta visita: '+openedApps.join(', ');openedEl.hidden=false;}
      desktop.querySelector('[data-resize]')?.addEventListener('click',e=>AxonUI.busy(e.currentTarget,async()=>{try{const resolution=desktop.querySelector('[data-res]').value;await api('/api/desktop/resize',{method:'POST',body:{resolution}});toast('Tamaño de pantalla aplicado','ok');}catch(err){error(desktop,err,loadDesktop);}}));
      desktop.querySelector('[data-tall]')?.addEventListener('click',e=>{const f=desktop.querySelector('iframe');if(!f)return;f.classList.toggle('platform-frame--tall');e.currentTarget.textContent=f.classList.contains('platform-frame--tall')?'Restaurar visor':'Ampliar visor';});
      desktop.querySelector('[data-cad]')?.addEventListener('click',()=>{desktop.querySelector('iframe')?.contentWindow.postMessage({type:'axon:desktop-cad'},location.origin);});
      desktop.querySelector('[data-paste]')?.addEventListener('click',async()=>{try{const text=await navigator.clipboard.readText();desktop.querySelector('iframe').contentWindow.postMessage({type:'axon:desktop-paste',text},location.origin);}catch(e){error(desktop,e,loadDesktop);}});
      desktop.querySelector('[data-copy]')?.addEventListener('click',async()=>{if(!clipboard){toast('Todavía no llegó texto del escritorio','info');return;}try{await navigator.clipboard.writeText(clipboard);toast('Texto recibido copiado','ok');}catch(e){error(desktop,e,loadDesktop);}});
      const fmtBytes=n=>{const u=['B','KB','MB','GB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return(i?n.toFixed(1):n)+' '+u[i];};
      const sendStatus=desktop.querySelector('[data-send-status]');
      const setStatus=t=>{if(sendStatus)sendStatus.textContent=t;};
      const sendToDesktop=(text,paste=false)=>{const f=desktop.querySelector('iframe');if(!f)return false;f.contentWindow.postMessage({type:'axon:desktop-paste',text:text.slice(0,100000),paste},location.origin);return true;};
      let sendFile=null,sendName='';
      const sendBox=desktop.querySelector('[data-send-text]'),fileInput=desktop.querySelector('[data-send-file]');
      desktop.querySelector('[data-send-clipboard]')?.addEventListener('click',()=>{
        const t=sendBox.value;if(!t)return setStatus('Escribí o pegá algo primero.');
        setStatus(sendToDesktop(t)?'Texto enviado al portapapeles remoto — Ctrl+V para insertarlo.':'El escritorio no está conectado.');
      });
      desktop.querySelector('[data-send-paste]')?.addEventListener('click',()=>{
        const t=sendBox.value;if(!t)return setStatus('Escribí o pegá algo primero.');
        setStatus(sendToDesktop(t,true)?'Texto enviado y pegado en la aplicación activa.':'El escritorio no está conectado.');
      });
      sendBox?.addEventListener('paste',e=>{
        const f=e.clipboardData?.files?.[0];if(!f)return;e.preventDefault();
        sendFile=f;sendName=f.name&&!/^image\.png$|^blob$/i.test(f.name)?f.name:`captura-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.${(f.type.split('/')[1]||'png').replace(/[^\w]/g,'').slice(0,8)||'png'}`;
        if(fileInput)fileInput.value='';
        setStatus(`Imagen del portapapeles lista: ${sendName} — elegí la carpeta y Subir archivo.`);
      });
      fileInput?.addEventListener('change',()=>{
        sendFile=fileInput.files[0]||null;sendName=sendFile?.name||'';
        if(sendFile)setStatus(`Listo para subir: ${sendName} (${fmtBytes(sendFile.size)}) — elegí la carpeta y Subir archivo.`);
      });
      const uploadRequest=async(url,options={})=>{
        const res=await fetch(url,{credentials:'same-origin',...options});
        const data=await res.json().catch(()=>({}));
        if(!res.ok||data.ok!==true){const err=new Error(data.error||`HTTP ${res.status}`);err.detail=data.detail;err.status=res.status;throw err;}
        return data;
      };
      desktop.querySelector('[data-send-upload]')?.addEventListener('click',async e=>{
        if(!sendFile)return setStatus('Elegí un archivo o pegá una imagen primero.');
        const dir=desktop.querySelector('[data-send-dir]').value,file=sendFile,name=sendName||file.name;
        await AxonUI.busy(e.currentTarget,async()=>{
          let id,done=false;
          try{
            const init=await uploadRequest('/api/files/upload/init',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:dir,name,size:file.size})});
            id=init.id;
            let offset=0;
            while(offset<file.size){
              const end=Math.min(file.size,offset+init.chunkSize);
              const part=await uploadRequest(`/api/files/upload/${id}?offset=${offset}`,{method:'PUT',body:file.slice(offset,end)});
              if(part.received!==end)throw new Error('El servidor confirmó un bloque incompleto');
              offset=end;setStatus(`Subiendo ${name}… ${Math.round(offset/file.size*100)}%`);
            }
            const out=await uploadRequest(`/api/files/upload/${id}/finish`,{method:'POST'});done=true;
            sendToDesktop(out.path);
            setStatus(`Subido a ${out.path} — la ruta quedó en el portapapeles remoto.`);
            toast('Archivo enviado al escritorio','ok');
          }catch(err){setStatus(err.detail||err.message);}
          finally{if(id&&!done)await uploadRequest(`/api/files/upload/${id}`,{method:'DELETE'}).catch(()=>{});}
        });
        sendFile=null;sendName='';if(fileInput)fileInput.value='';
      });
    }catch(e){error(desktop,e,loadDesktop);}
  }
  window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==desktop.querySelector('iframe')?.contentWindow)return;if(e.data?.type==='axon:desktop'){connected=e.data.state==='connected';const s=desktop.querySelector('[data-state]');if(s)s.textContent={connected:'Escritorio conectado',connecting:'Conectando…',disconnected:'Desconectado · intentando reconectar',gaveup:'Desconectado · reintentos agotados (usá Reconectar en el visor)',failed:'La conexión falló'}[e.data.state]||'Sin conexión';}if(e.data?.type==='axon:desktop-clipboard'&&typeof e.data.text==='string')clipboard=e.data.text.slice(0,100000);});
  // Suspend on leave instead of destroying the iframe: the RFB socket closes
  // but the page (and "Enviar al escritorio" state) survives the switch and a
  // resume message avoids a full noVNC re-handshake on return.
  AxonPages.desktop={restore:loadDesktop,leave:()=>{desktop.querySelector('iframe')?.contentWindow.postMessage({type:'axon:desktop-suspend'},location.origin);connected=false;}};loaders.desktop=loadDesktop;
})();
