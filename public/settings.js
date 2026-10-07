(() => {
  'use strict';
  const form = document.querySelector('#settings-form');
  const holder = document.querySelector('#settings-modal .modal-content');
  if (!form || !holder) return;
  const sections = [
    ['general', 'Servidor', 'server', 'Servidor y detección', 'Definí qué carpetas explorar y cómo identificar los servicios.'],
    ['appearance', 'Apariencia', 'palette', 'Tu espacio de trabajo', 'Elegí un tema, la densidad y el movimiento. Se guardan en este navegador.'],
    ['connections', 'Conexiones', 'plug', 'Tus cuentas en la nube', 'Conectá tus plataformas para explorar archivos a demanda. En Archivos sólo aparecen las cuentas conectadas que elijas mostrar.'],
    ['notifications', 'Notificaciones', 'bell', 'Avisos y actividad', 'El centro de notificaciones conserva los eventos hasta que los marques como leídos.'],
    ['security', 'Seguridad', 'shield-check', 'Protección y acceso', 'Protegé procesos esenciales y configurá la verificación de tu cuenta.'],
    ['advanced', 'Avanzado', 'sliders-horizontal', 'Herramientas y mantenimiento', 'Preferencias de terminal, datos del navegador y energía del servidor.'],
  ];
  const layout = document.createElement('div'); layout.className = 'settings-layout';
  const tabs = document.createElement('nav'); tabs.className = 'settings-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Configuración');
  const content = document.createElement('div');
  const panes = {};
  for (const [key, name, ic, title, desc] of sections) {
    const button = document.createElement('button'); button.type = 'button'; button.id = `settings-tab-${key}`;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `settings-pane-${key}`);
    button.innerHTML = `${icon(ic)} ${esc(name)}`; button.addEventListener('click', () => select(key)); tabs.append(button);
    const pane = document.createElement('section'); pane.id = `settings-pane-${key}`; pane.className = 'settings-pane';
    pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', button.id);
    pane.innerHTML = `<h4>${title}</h4><p>${desc}</p>`; panes[key] = pane; content.append(pane);
  }
  function move(id, key) { const node = document.querySelector('#' + id); if (node) panes[key].append(node.closest('label') || node); }
  ['settings-scan-interval', 'settings-scan-dirs', 'settings-known-services'].forEach(id => move(id, 'general'));
  panes.general.insertAdjacentHTML('beforeend', '<label>Usuario del host<input type="text" id="settings-host-user" required pattern="[a-z_][a-z0-9_-]*[$]?" autocomplete="off"><small class="settings-help">Los comandos de herramientas y proyectos se ejecutan con este usuario.</small></label>');
  move('settings-notify-url', 'notifications');
  panes.notifications.insertAdjacentHTML('beforeend','<label>Proveedor del webhook<select id="settings-notify-provider"><option value="auto">Detectar por dominio</option><option value="ntfy">ntfy</option><option value="gotify">Gotify</option><option value="discord">Discord</option></select><small class="settings-help">Para Gotify en un dominio propio, elegí Gotify. Usá la URL completa de envío, incluyendo la autenticación que requiere tu servidor.</small></label>');
  ['settings-protected-pids', 'settings-protected-ports'].forEach(id => move(id, 'security'));
  const powers = [...form.querySelectorAll('.settings-power')];
  if (powers[0]) panes.security.append(powers[0]);
  // Injected here (not in index.html) so the powers[] indexes above don't shift.
  panes.security.insertAdjacentHTML('beforeend',
    `<div class="settings-power"><span class="settings-power-label">Contraseña del panel — la cuenta es local, sin recuperación</span><button type="button" id="password-change-btn" class="btn-secondary">${icon('key-round')} Cambiar</button></div>
     <div class="settings-power"><span class="settings-power-label">Primeros pasos — asistente de bienvenida y lista del inicio</span><button type="button" id="onboarding-reset-btn" class="btn-secondary">${icon('list-checks')} Ver de nuevo</button></div>`);
  panes.security.querySelector('#password-change-btn').addEventListener('click', () => {
    $('#password-current').value = '';
    $('#password-new').value = '';
    $('#password-confirm').value = '';
    $('#password-error').textContent = '';
    $('#password-modal').classList.remove('hidden');
    setTimeout(() => $('#password-current').focus(), 50);
  });
  panes.security.querySelector('#onboarding-reset-btn').addEventListener('click', async () => {
    try {
      await api('/api/onboarding/reset', { method: 'POST' });
      toast('Los primeros pasos vuelven a aparecer en Inicio', 'ok');
    } catch (e) {
      errToast(e);
    }
  });
  move('settings-ignored-patterns', 'advanced');
  if (powers[1]) panes.advanced.append(powers[1]);
  panes.appearance.insertAdjacentHTML('beforeend', `<div class="appearance-modes" role="group" aria-label="Modo de color"><button type="button" data-color-mode="light">${icon('sun')} Claro</button><button type="button" data-color-mode="dark">${icon('moon')} Oscuro</button><button type="button" data-color-mode="system">${icon('monitor')} Sistema</button></div><p class="settings-help" id="theme-mode-help"></p><div id="settings-theme-gallery"></div>
    <label style="margin-top:24px">Densidad<select id="settings-density"><option value="theme">La del tema</option><option value="compact">Compacta</option><option value="comfortable">Cómoda</option></select></label>
    <label><input id="settings-motion" type="checkbox"> Reducir animaciones</label>`);
  panes.notifications.insertAdjacentHTML('beforeend', '<div class="settings-power"><span class="settings-power-label" id="settings-notif-state"></span><button type="button" class="btn-secondary" id="settings-notif-permission">Activar avisos del navegador</button></div><button type="button" class="btn-secondary" id="settings-notif-test">Probar webhook guardado</button><p id="settings-notif-result" role="status"></p>');
  panes.advanced.insertAdjacentHTML('afterbegin', '<label>Tamaño de letra de la terminal<select id="settings-terminal-font"><option>12</option><option>14</option><option>16</option><option>18</option><option>20</option></select></label><button type="button" class="btn-secondary" id="settings-clear-recent">Limpiar archivos recientes de este navegador</button>');
  const footer = form.querySelector('.modal-actions'); footer.className = 'settings-savebar';
  window.AxonConnections?.mount(panes.connections);
  footer.insertAdjacentHTML('afterbegin', '<span id="settings-save-state" role="status">Sin cambios pendientes</span>');
  const error = document.querySelector('#settings-error');
  layout.append(tabs, content); form.prepend(layout); form.append(error, footer);
  let saved = '';
  // Visual-only controls (density, motion) persist via localStorage, not the
  // form payload — exclude them or every visit reports fake unsaved changes.
  const snapshot = () => JSON.stringify([...form.querySelectorAll('.settings-pane input:not([data-local]), .settings-pane textarea, .settings-pane select:not([data-local])')].filter(n=>!['settings-motion','settings-density'].includes(n.id)).map(n=>[n.id,n.value]));
  function dirty() { document.querySelector('#settings-save-state').textContent = snapshot() === saved ? 'Sin cambios pendientes' : 'Tenés cambios sin guardar'; }
  let selected='general';
  function select(key) {
    if(!panes[key])key='general';selected=key;
    for (const [id] of sections) {
      panes[id].hidden = id !== key;
      const tab = document.querySelector(`#settings-tab-${id}`); tab.setAttribute('aria-selected', String(id === key)); tab.tabIndex = id === key ? 0 : -1;
    }
    try { sessionStorage.setItem('axon:settings-tab', key); } catch {}
    footer.hidden=key==='connections';
    if(key==='connections')void window.AxonConnections?.refresh();
    if(window.AxonNavigation?.ready&&window.AxonNavigation.current?.section==='settings'&&!window.AxonNavigation.applying)window.AxonNavigation.update('settings',{section:key});
  }
  tabs.addEventListener('keydown', e => {
    if (!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(e.key)) return;
    e.preventDefault();
    const buttons = [...tabs.children], at = buttons.indexOf(document.activeElement);
    const idx = e.key==='Home' ? 0 : e.key==='End' ? buttons.length-1 : (at + (['ArrowLeft','ArrowUp'].includes(e.key) ? -1 : 1) + buttons.length) % buttons.length;
    buttons[idx].click(); buttons[idx].focus();
  });
  form.addEventListener('input', dirty);
  form.addEventListener('change', dirty);
  form.addEventListener('invalid', e => { const pane = e.target.closest('.settings-pane'); if (pane) select(pane.id.replace('settings-pane-','')); }, true);
  function syncThemes() {
    const state = AxonThemes.current();
    document.querySelectorAll('button[data-color-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.colorMode===state.mode)));
    document.querySelector('#theme-current').textContent = AxonThemes.byId.get(state.id).name + ' · 20 temas';
    document.querySelector('#theme-mode-help').textContent = state.mode==='system' ? 'Sigue al sistema. Elegí un tema para cada modo; Axon recuerda ambos.' : `10 temas ${state.mode==='light'?'claros':'oscuros'}. Cada uno cambia fuente, densidad, bordes y sombras.`;
    const modes = state.mode==='system' ? ['light','dark'] : [state.mode];
    document.querySelector('#settings-theme-gallery').innerHTML = modes.map(mode=>`<h5>${mode==='light'?'Temas claros':'Temas oscuros'}</h5><div class="theme-cards">${AxonThemes.presets.filter(t=>t.mode===mode).map(t=>`<button type="button" class="theme-card" data-theme-choice="${t.id}" aria-pressed="${state[mode]===t.id}"><span class="theme-swatch" style="background:${t.tokens['bg-canvas']};border-radius:${t.tokens.radius};box-shadow:${t.tokens['shadow-panel']};font-family:${esc(t.tokens['font-sans'])};color:${t.tokens.text}"><span style="background:${t.tokens['bg-panel']};border-radius:${t.tokens.radius};padding:${t.tokens['row-pad-y']}">Axon <i style="background:${t.tokens.accent}"></i></span><span style="color:${t.tokens['text-dim']}">Aa · ${t.tokens['font-size']}</span></span><b>${esc(t.name)}</b><small>${esc(t.description)}</small></button>`).join('')}</div>`).join('');
    document.querySelector('#settings-density').value=localStorage.getItem('axon:density') || 'theme';
  }
  document.querySelectorAll('button[data-color-mode]').forEach(b=>b.addEventListener('click',()=>AxonThemes.setMode(b.dataset.colorMode)));
  panes.appearance.addEventListener('click',e=>{const b=e.target.closest('[data-theme-choice]');if(b)setTheme(b.dataset.themeChoice);});
  document.querySelector('#theme-current').addEventListener('click',()=>{document.querySelector('#settings-btn').click();select('appearance');});
  document.addEventListener('axon:theme', syncThemes);
  const density = document.querySelector('#settings-density'); density.dataset.local = 'true'; density.value = localStorage.getItem('axon:density') || 'theme';
  const motion = document.querySelector('#settings-motion'); motion.checked = localStorage.getItem('axon:reduce-motion') === 'true';
  function appearance() { document.documentElement.dataset.density = density.value; document.documentElement.dataset.reduceMotion = String(motion.checked); localStorage.setItem('axon:density',density.value); localStorage.setItem('axon:reduce-motion',String(motion.checked)); }
  density.addEventListener('change',appearance); motion.addEventListener('change',appearance); appearance();
  const font = document.querySelector('#settings-terminal-font'); font.dataset.local = 'true'; font.value = localStorage.getItem('axon:terminal-font') || '14';
  font.addEventListener('change',()=>{localStorage.setItem('axon:terminal-font',font.value);document.dispatchEvent(new CustomEvent('axon:terminal-font',{detail:Number(font.value)}));});
  function permissionState() { document.querySelector('#settings-notif-state').textContent = !('Notification' in window) ? 'Avisos no disponibles en este navegador' : Notification.permission==='granted' ? 'Avisos del navegador activados' : Notification.permission==='denied' ? 'Avisos bloqueados. Habilitalos en los permisos del sitio.' : 'Avisos del navegador desactivados'; }
  document.querySelector('#settings-notif-permission').addEventListener('click',async()=>{if('Notification' in window) await Notification.requestPermission();permissionState();});
  document.querySelector('#settings-notif-test').addEventListener('click',async()=>{try{const r=await api('/api/notifications/test',{method:'POST'});document.querySelector('#settings-notif-result').textContent=r.message;}catch(e){errToast(e);}});
  document.querySelector('#settings-clear-recent').addEventListener('click',async()=>{if(await confirmDialog('Limpiar recientes','Se borra la lista de este navegador. Los archivos se conservan.','Limpiar')){localStorage.removeItem('axon:recent-files:v1');window.AxonRecent?.clear?.();toast('Lista de recientes vaciada','ok');}});
  window.AxonSettings = {
    loaded() { saved=snapshot(); dirty(); permissionState(); syncThemes(); },
    dirty:()=>saved && snapshot()!==saved,
    promptPower(word) {
      return new Promise(resolve=>{
        const modal=document.createElement('div'); modal.className='modal';
        modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true');
        modal.innerHTML=`<div class="modal-content"><h3 id="power-prompt-title">${word==='REINICIAR'?'Reiniciar':'Apagar'} el servidor</h3><p>El dashboard y los servicios se van a desconectar. Escribí ${word} para confirmar.</p><input aria-label="Confirmación" autocomplete="off"><div class="modal-actions"><button type="button" class="btn-secondary">Cancelar</button><button type="button" class="btn-danger" disabled>Confirmar</button></div></div>`;
        modal.setAttribute('aria-labelledby','power-prompt-title');
        const input=modal.querySelector('input'), buttons=modal.querySelectorAll('button');
        const done=value=>{modal.remove();document.removeEventListener('keydown',onKey,true);resolve(value);};
        const onKey=e=>{if(e.key==='Escape'){e.stopPropagation();done(null);}};
        input.addEventListener('input',()=>buttons[1].disabled=input.value.trim().toUpperCase()!==word);
        input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!buttons[1].disabled)done(input.value);});
        buttons[0].addEventListener('click',()=>done(null)); buttons[1].addEventListener('click',()=>done(input.value));
        modal.addEventListener('click',e=>{if(e.target===modal)done(null);});
        document.addEventListener('keydown',onKey,true);document.body.append(modal);input.focus();
      });
    },
  };
  // navigation.js ya registra un beforeunload global que consulta
  // AxonPages.<sección>.dirty — exponerlo acá evita un segundo listener.
  window.AxonPages.settings.dirty = () => window.AxonSettings.dirty();
  // Los errores de guardado quedan al final del formulario: llevarlos a vista.
  if(error)new MutationObserver(()=>{ if(error.textContent.trim()) error.scrollIntoView({block:'nearest'}); })
    .observe(error,{childList:true,characterData:true,subtree:true});
  // Busy state del modal 2FA: el submit vive en app.js — acá solo se refleja
  // para bloquear doble click y avisar a lectores de pantalla.
  const totpConfirm=document.querySelector('#totp-confirm'),totpModal=document.querySelector('#totp-modal'),totpError=document.querySelector('#totp-error');
  if(totpConfirm&&totpModal){
    const clearBusy=()=>{totpConfirm.disabled=false;totpConfirm.classList.remove('is-busy');totpConfirm.removeAttribute('aria-busy');};
    totpConfirm.addEventListener('click',()=>{totpConfirm.disabled=true;totpConfirm.classList.add('is-busy');totpConfirm.setAttribute('aria-busy','true');});
    const settle=()=>{if(totpModal.classList.contains('hidden')||totpError?.textContent.trim())clearBusy();};
    new MutationObserver(settle).observe(totpModal,{attributes:true,attributeFilter:['class']});
    if(totpError)new MutationObserver(settle).observe(totpError,{childList:true,characterData:true,subtree:true});
  }
  window.AxonPages.settings.canLeave=async()=>{
    if(!window.AxonSettings.dirty())return true;
    if(!await confirmDialog('Cambios sin guardar','Si salís se pierden los cambios de configuración.','Salir sin guardar'))return false;
    saved=snapshot();dirty();return true;
  };
  const restoreSettings=window.AxonPages.settings.restore;
  window.AxonPages.settings.restore=async(params={})=>{await restoreSettings();select(params.section||sessionStorage.getItem('axon:settings-tab')||'general');if(selected==='connections'&&params.connection)await window.AxonConnections?.refresh(params);};
  window.AxonPages.settings.params=()=>({section:selected});
  select(sections.some(s=>s[0]===sessionStorage.getItem('axon:settings-tab')) ? sessionStorage.getItem('axon:settings-tab') : 'general');
  permissionState(); syncThemes(); refreshIcons();
})();
