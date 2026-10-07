/* Account configuration is centralized here; remote bytes load only on demand. */
(() => {
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>{if(!Number.isFinite(n))return '';if(n<1024)return n+' B';let i=-1;do{n/=1024;i++;}while(n>=1024&&i<3);return n.toFixed(n>=10?0:1)+' '+['KB','MB','GB','TB'][i];};
  const ids=['dropbox','gdrive','onedrive'];
  const logo=id=>ids.includes(id)?`<img class="cloud-brand" src="/cloud-logos/${id}.${id==='gdrive'?'png':'svg'}" alt="" width="24" height="24">`:'';
  const guides={
    dropbox:{url:'https://www.dropbox.com/developers/apps',label:'Consola de Dropbox',steps:'Configuración inicial, una sola vez: 1. Creá una aplicación con Scoped access → Full Dropbox y dejala en Development. 2. En Permissions habilitá account_info.read, files.metadata.read, files.content.read y sharing.read; en Settings → OAuth 2 agregá la dirección de retorno de abajo. 3. Copiá la App key, guardala acá y elegí Conectar Dropbox. Para tu cuenta personal no necesitás Request production status: omití ese formulario, la revisión y los datos de publicación.',idLabel:'App key',secret:false},
    gdrive:{url:'https://console.cloud.google.com/apis/credentials',label:'Google Cloud',steps:'Habilitá Google Drive API y creá un cliente OAuth de tipo Aplicación web. Agregá la dirección de retorno de abajo en las URI de redirección autorizadas. Configurá la pantalla de consentimiento y, si está en modo prueba, agregá tu cuenta como usuario de prueba.',idLabel:'Client ID',secret:true},
    onedrive:{url:'https://entra.microsoft.com/',label:'Microsoft Entra',steps:'Registrá una aplicación para cuentas organizativas y personales. En Autenticación agregá una plataforma Web con la dirección de retorno de abajo. Creá un secreto de cliente y copiá su valor. Se solicitan los permisos delegados Files.Read, User.Read y offline_access.',idLabel:'Application (client) ID',secret:true},
  };
  const reasons={expirada:'La autorización expiró. Volvé a conectar.',conflicto:'La conexión cambió o fue cancelada. Volvé a intentar.',limite:'La plataforma limitó los intentos. Esperá un momento y reintentá.',plataforma:'La plataforma no respondió. Revisá su estado y reintentá.'};
  let pane=null,providers=[],serial=0;
  // Shared transport adds cache:'no-store', JSON-error normalization and the
  // 401 → axon:session-expired dispatch that raw fetch misses.
  const request=(url,body)=>window.AxonUI.request(url,body===undefined?{}:{method:'POST',body});
  function announce(text,error=false){if(!pane)return;const box=pane.querySelector('#connections-message');box.textContent=text;box.classList.toggle('cloud-error',error);box.setAttribute('role',error?'alert':'status');}
  async function act(button,fn){button.disabled=true;try{await fn();}catch(e){announce(e.message,true);}finally{if(button.isConnected)button.disabled=false;}}
  function publish(){document.dispatchEvent(new CustomEvent('axon:connections',{detail:providers}));}
  // Re-renders must not collapse open setup panels nor wipe half-typed forms.
  function snapshot(){
    const s={open:new Set(),fields:{}};
    pane.querySelectorAll('.connection-row').forEach(row=>{const id=row.dataset.provider;
      if(row.querySelector('.connection-setup')?.open)s.open.add(id);
      s.fields[id]={clientId:row.querySelector('[data-client-id]')?.value||'',secret:row.querySelector('[data-client-secret]')?.value||''};
    });
    return s;
  }
  function restore(s){
    pane.querySelectorAll('.connection-row').forEach(row=>{const id=row.dataset.provider,f=s.fields[id];
      if(s.open.has(id)){const d=row.querySelector('.connection-setup');if(d)d.open=true;}
      const ci=row.querySelector('[data-client-id]');if(ci&&f?.clientId)ci.value=f.clientId;
      const cs=row.querySelector('[data-client-secret]');if(cs&&f?.secret)cs.value=f.secret;
    });
  }
  async function checkHealth(row,p){
    const box=row.querySelector('[data-health]');if(!box)return;
    try{
      const d=await request('/api/files/'+p.id+'/health');if(!row.isConnected)return;
      if(d.healthy===false){box.textContent='La cuenta no responde: '+(d.error||'verificación fallida')+'. Desconectá y volvé a conectar.';box.classList.add('cloud-error');}
      else box.textContent=d.total?'Conexión verificada · '+fmt(d.used)+' de '+fmt(d.total)+' en uso.':'Conexión verificada.';
    }catch(e){if(row.isConnected){box.textContent='No se pudo verificar la conexión: '+e.message;box.classList.add('cloud-error');}}
  }
  function render(){
    if(!pane)return;
    const snap=snapshot();
    pane.querySelector('#connections-list').innerHTML=providers.map(p=>{const g=guides[p.id];return `<article class="connection-row" data-provider="${p.id}"><div class="connection-heading">${logo(p.id)}<div><h5>${esc(p.name)}</h5><p>${p.connected?esc(p.account.name)+(p.account.email?' · '+esc(p.account.email):''):'Sin conectar'}</p></div><span class="connection-state">${p.connected?(p.visible?'Visible en Archivos':'Oculta en Archivos'):p.configured?'Lista para conectar':'Sin configurar'}</span></div>${p.connected?`<p class="settings-help" data-health>Verificando conexión…</p>`:''}${p.connected&&p.uploadSupported?`<p class="settings-help">${p.uploadGranted?'Lectura y subida habilitadas. Los agentes necesitan además un token de AXON con permiso de subida.':'Acceso de lectura. Para subir desde agentes, habilitá files.content.write en Permissions de tu aplicación de Dropbox, guardá con Submit y elegí Habilitar subidas.'}</p>`:''}${p.appFolder?'<p class="settings-help">Acceso limitado a la carpeta de la aplicación. Para ver toda la cuenta, creá una aplicación Full Dropbox, desconectá esta cuenta y conectá la nueva aplicación.</p>':''}<div class="connection-actions">${p.connected?`<label class="connection-visible"><input type="checkbox" data-local data-visible ${p.visible?'checked':''}> Mostrar en Archivos</label><button type="button" class="btn-secondary" data-browse>Abrir archivos</button>${p.uploadSupported&&!p.uploadGranted?'<button type="button" class="btn-secondary" data-enable-upload>Habilitar subidas</button>':''}<a class="btn-secondary" href="/integraciones">Acceso para agentes</a><button type="button" class="btn-secondary" data-disconnect>Desconectar</button>`:`${p.configured?`<button type="button" class="btn-primary" data-connect>Conectar ${esc(p.name)}</button>`:''}`}</div>${!p.connected&&!p.serverConfigured?`<details class="connection-setup"><summary>${p.configured?'Configuración avanzada':'Configuración inicial · una sola vez'}</summary><p>${g.steps}</p><a href="${g.url}" target="_blank" rel="noopener noreferrer">Abrir ${g.label}</a><label>Dirección de retorno<input data-local readonly value="${esc(p.redirectUri)}" aria-label="Dirección de retorno de ${esc(p.name)}"><button type="button" class="btn-secondary" data-copy>Copiar dirección</button></label><label>${g.idLabel}<input data-local data-client-id autocomplete="off" maxlength="200" placeholder="${p.configured?'Guardada '+(p.clientId||''):'ID de la aplicación'}"></label>${g.secret?`<label>Secreto de cliente<input data-local data-client-secret type="password" autocomplete="new-password" maxlength="2000" placeholder="${p.configured?'Guardado · dejá vacío para conservarlo':'Valor del secreto'}"></label>`:''}<button type="button" class="btn-secondary" data-configure>Guardar conexión</button><small class="settings-help">La contraseña de tu cuenta se ingresa en ${esc(p.name)}. AXON pide acceso de lectura y guarda las credenciales cifradas.</small></details>`:''}</article>`;}).join('');
    restore(snap);
    for(const row of pane.querySelectorAll('[data-provider]')){
      const id=row.dataset.provider,p=providers.find(p=>p.id===id),base='/api/files/'+id;
      row.querySelector('[data-visible]')?.addEventListener('change',e=>{const input=e.currentTarget;void act(input,async()=>{try{await request('/api/connections/'+id+'/visibility',{visible:input.checked});await refresh();announce('Preferencia guardada.');}catch(err){input.checked=p.visible;throw err;}});});
      row.querySelector('[data-browse]')?.addEventListener('click',()=>act(row.querySelector('[data-browse]'),async()=>{if(!p.visible){await request('/api/connections/'+id+'/visibility',{visible:true});await refresh();}await window.AxonNavigation.go('/archivos?source='+id);}));
      row.querySelector('[data-disconnect]')?.addEventListener('click',e=>act(e.currentTarget,async()=>{if(!await confirmDialog('Desconectar '+p.name,'Se cancela la conexión y sus copias en curso. Las copias guardadas en tus discos se conservan.','Desconectar'))return;const d=await request(base+'/disconnect',{});await refresh();announce(d.notice||'Cuenta desconectada.');}));
      row.querySelector('[data-enable-upload]')?.addEventListener('click',e=>act(e.currentTarget,async()=>{const d=await request(base+'/connect',{upload:true}),u=new URL(d.url);if(u.origin!=='https://www.dropbox.com')throw new Error('Dirección de autorización inválida');location.assign(u.href);}));
      row.querySelector('[data-connect]')?.addEventListener('click',e=>act(e.currentTarget,async()=>{const d=await request(base+'/connect',{}),u=new URL(d.url),expected={dropbox:'https://www.dropbox.com',gdrive:'https://accounts.google.com',onedrive:'https://login.microsoftonline.com'}[id];if(u.origin!==expected)throw new Error('Dirección de autorización inválida');location.assign(u.href);}));
      row.querySelector('[data-configure]')?.addEventListener('click',e=>act(e.currentTarget,async()=>{const clientId=row.querySelector('[data-client-id]').value.trim(),clientSecret=row.querySelector('[data-client-secret]')?.value;if(!clientId)throw new Error('Completá el ID de la aplicación.');await request(base+'/configure',{clientId,...(id==='dropbox'?{}:{clientSecret:clientSecret||''})});if(row.querySelector('[data-client-secret]'))row.querySelector('[data-client-secret]').value='';await refresh();announce('Configuración guardada. Ya podés conectar tu cuenta.');}));
      row.querySelector('[data-copy]')?.addEventListener('click',e=>act(e.currentTarget,async()=>{await navigator.clipboard.writeText(p.redirectUri);announce('Dirección copiada.');}));
      row.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('input:not([readonly]):not([type=checkbox])')){e.preventDefault();row.querySelector('[data-configure]')?.click();}});
      if(p.connected)void checkHealth(row,p);
    }
  }
  async function refresh(params={}){const nav=++serial;try{const d=await request('/api/connections');if(nav!==serial)return;providers=d.providers;render();publish();if(params.connection)announce(params.connection==='connected'?'Cuenta conectada.':params.connection==='cancelled'?'Conexión cancelada.':(reasons[params.reason]||'No se pudo conectar. Revisá la configuración y reintentá.'),params.connection==='failed');}catch(e){if(nav===serial)announce(e.message,true);}}
  window.AxonConnections={logo,refresh,get providers(){return providers;},mount(node){pane=node;pane.insertAdjacentHTML('beforeend','<p id="connections-message" role="status" aria-live="polite"></p><div id="connections-list">Consultando conexiones…</div><button type="button" class="btn-secondary" id="connections-refresh">Actualizar conexiones</button>');pane.querySelector('#connections-refresh').onclick=()=>void refresh();}};
})();
