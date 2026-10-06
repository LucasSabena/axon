/* Provider adapters are remote sources; host navigation remains independent. */
(() => {
  'use strict';
  const sec=document.getElementById('tab-files');
  if(!sec || window.AxonDropbox)return;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size=n=>{if(n<1024)return n+' B';let i=-1;do{n/=1024;i++;}while(n>=1024&&i<3);return n.toFixed(n>=10?0:1)+' '+['KB','MB','GB','TB'][i];};
  let base='/api/files/dropbox';
  const names={dropbox:'Dropbox',gdrive:'Google Drive',onedrive:'OneDrive'};
  const name=()=>names[S.provider];
  const tabs=document.createElement('nav');tabs.className='cloud-source-tabs';tabs.setAttribute('aria-label','Ubicación de archivos');
  tabs.innerHTML=`<button type="button" class="btn-secondary" data-source="server" aria-pressed="true">${icon('hard-drive')} Servidor</button><button type="button" class="btn-secondary" data-connections aria-pressed="false">${icon('plug')} Conexiones</button>`;
  sec.prepend(tabs);
  const panel=document.createElement('div');panel.className='cloud-panel';panel.hidden=true;
  panel.innerHTML=`<div class="section-header cloud-header"><div><div class="cloud-title"><h2>Dropbox</h2><span class="cloud-access" title="Podés abrir y copiar archivos. Subir, editar y borrar en la nube no está habilitado.">${icon('lock-keyhole')} Sólo lectura</span></div><p class="listener-note">Abrí archivos a demanda o guardá una copia en tu disco.</p></div><button type="button" id="cloud-refresh" class="btn-secondary" aria-label="Actualizar Dropbox">${icon('refresh-cw')}<span>Actualizar</span></button></div>
    <p id="cloud-message" class="cloud-message" role="status" aria-live="polite"></p>
    <div id="cloud-connection"></div>
    <div id="cloud-browser" hidden>
      <nav id="cloud-breadcrumb" class="fm-breadcrumb" aria-label="Carpeta de Dropbox"></nav><button type="button" id="cloud-copy-path" class="btn-secondary">Copiar ruta para agentes</button>
      <div class="cloud-toolbar"><label>Ubicación<select id="cloud-location" aria-label="Ubicación de Dropbox"></select></label><label class="cloud-filter">Filtrar esta carpeta<input id="cloud-filter" type="search" placeholder="Nombre de archivo…"></label><div class="cloud-sort-controls"><label>Ordenar por<select id="cloud-sort"><option value="name">Nombre</option><option value="type">Tipo</option><option value="size">Tamaño</option><option value="modified">Modificado</option></select></label><button type="button" id="cloud-order" class="btn-secondary" aria-label="Orden descendente" title="Cambiar orden">${icon('arrow-up')}</button></div><div class="cloud-view-switch" role="group" aria-label="Vista de archivos">${[['list','list','Lista'],['details','table-2','Detalles'],['grid','layout-grid','Cuadrícula']].map(([view,glyph,label])=>`<button type="button" data-cloud-view="${view}" aria-label="Vista de ${label.toLowerCase()}" title="${label}" aria-pressed="false">${icon(glyph)}<span>${label}</span></button>`).join('')}</div><button type="button" id="cloud-remove-link" class="btn-secondary" hidden>Quitar enlace</button></div>
      <details class="cloud-shared"><summary>Agregar un enlace compartido</summary><form id="cloud-shared-form"><label>Enlace de Dropbox<input type="url" name="url" required placeholder="https://www.dropbox.com/…" maxlength="4096"></label><button type="submit" class="btn-secondary">${icon('link')} Agregar</button></form><p class="listener-note">El contenido sigue en Dropbox. Se respetan los permisos del enlace.</p></details>
      <div class="cloud-actions"><label><input id="cloud-select-all" type="checkbox"> Seleccionar visibles</label><span id="cloud-count"></span><button type="button" id="cloud-save" class="btn-primary" disabled>${icon('download')} Guardar en un disco</button></div>
      <div id="cloud-list" class="cloud-list" aria-busy="false"></div><button type="button" id="cloud-more" class="btn-secondary" hidden>Cargar más</button>
      <div id="cloud-preview" class="cloud-preview" hidden></div>
    </div>
    <div id="cloud-jobs" class="cloud-jobs" role="region" aria-label="Copias desde Dropbox"></div>`;
  tabs.after(panel);refreshIcons();
  const el=id=>panel.querySelector('#'+id);
  let preferences={};try{preferences=JSON.parse(localStorage.getItem('axon:cloud-view:v1'))||{};}catch{}
  const views=['list','details','grid'],sorts=['name','type','size','modified'];
  const S={provider:'dropbox',providers:[],sourcesNav:0,crumbs:null,status:null,location:'account',path:'',entries:[],cursor:null,filter:'',view:views.includes(preferences?.view)?preferences.view:'details',sort:sorts.includes(preferences?.sort)?preferences.sort:'name',order:preferences?.order==='desc'?'desc':'asc',sel:new Set(),item:null,nav:0,poll:0,jobs:[],uploads:[],busy:false,local:null};
  async function request(url,body){
    const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json().catch(()=>({error:'No se pudo leer la respuesta'}));if(!r.ok || d.ok===false)throw new Error(d.error||'No se pudo completar la acción');return d;
  }
  const message=(text,error=false)=>{el('cloud-message').textContent=text;el('cloud-message').classList.toggle('cloud-error',error);el('cloud-message').setAttribute('role',error?'alert':'status');};
  function params(){return {source:S.provider,location:S.location,cloudPath:S.path,q:S.filter||null,item:S.item||null,view:S.view,sort:S.sort,order:S.order};}
  function saveView(){try{localStorage.setItem('axon:cloud-view:v1',JSON.stringify({view:S.view,sort:S.sort,order:S.order}));}catch{}window.AxonNavigation.update('files',params());}
  function go(p={}){return window.AxonNavigation.go(window.AxonNavigation.url('files',{...params(),...p}));}
  function query(p,extra={}){return new URLSearchParams({location:S.location,path:p,...extra});}
  function hide(){S.nav++;panel.hidden=true;sec.classList.remove('fm-cloud-mode');clearTimeout(S.poll);closePreview();void refreshSources();tabs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.source==='server')));}
  function closePreview(){const box=el('cloud-preview');box.querySelectorAll('video,audio').forEach(m=>{m.pause();m.removeAttribute('src');m.load();});box.replaceChildren();box.hidden=true;}
  function renderSources(){
    tabs.innerHTML=`<button type="button" class="btn-secondary" data-source="server" aria-pressed="${panel.hidden}">${icon('hard-drive')} Servidor</button>`+S.providers.filter(p=>p.connected&&p.visible).map(p=>`<button type="button" class="btn-secondary" data-source="${p.id}" aria-pressed="${!panel.hidden&&S.provider===p.id}">${window.AxonConnections.logo(p.id)} ${esc(p.name)}</button>`).join('')+`<button type="button" class="btn-secondary cloud-manage" data-connections>${icon('plug')} Conexiones</button>`;refreshIcons();
  }
  async function refreshSources(){const nav=++S.sourcesNav;try{const d=await request('/api/connections');if(nav!==S.sourcesNav)return;S.providers=d.providers;renderSources();}catch{ /* Existing navigation remains usable during an outage. */ }}
  document.addEventListener('axon:connections',e=>{S.sourcesNav++;S.providers=e.detail;renderSources();});
  function renderConnection(){
    const d=S.status,box=el('cloud-connection'),available=d.connected&&d.visible!==false;
    el('cloud-browser').hidden=!available;
    el('cloud-jobs').hidden=!d.connected;
    panel.querySelector('h2').innerHTML=available?window.AxonConnections.logo(S.provider)+' '+esc(name()):'Conexión no disponible';
    el('cloud-refresh').setAttribute('aria-label','Actualizar '+name());
    el('cloud-location').setAttribute('aria-label','Ubicación de '+name());
    el('cloud-breadcrumb').setAttribute('aria-label','Carpeta de '+name());
    el('cloud-jobs').setAttribute('aria-label','Transferencias de '+name());
    const access=panel.querySelector('.cloud-access');access.innerHTML=icon('lock-keyhole')+(d.uploadGranted?' Subidas para agentes':' Sólo lectura');access.title=d.uploadGranted?'Los agentes con un token autorizado pueden subir archivos.':'Podés abrir y copiar archivos. Habilitá las subidas desde Conexiones.';
    if(available){box.innerHTML=`<div class="cloud-account"><span>${icon('circle-check')} <strong>${esc(d.account.name)}</strong> <span class="listener-note">${esc(d.account.email)}</span></span><button type="button" class="btn-secondary" data-manage aria-label="Gestionar conexión" title="Gestionar conexión">${icon('settings-2')}<span>Gestionar conexión</span></button></div>${d.appFolder?'<p class="listener-note">Esta aplicación sólo puede acceder a su propia carpeta de Dropbox. Para ver toda tu cuenta, configurá una aplicación Full Dropbox desde Conexiones.</p>':''}`;
      el('cloud-location').innerHTML=d.sources.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}${s.type==='shared'?' · enlace compartido':''}</option>`).join('');el('cloud-location').value=S.location;el('cloud-remove-link').hidden=S.provider!=='dropbox'||S.location==='account';
    }else box.innerHTML=`<div class="cloud-empty"><p>${d.connected?'Esta cuenta está oculta en Archivos. Podés volver a mostrarla desde Configuración.':'Conectá tu cuenta desde Configuración para acceder a sus archivos.'}</p><button type="button" class="btn-primary" data-manage>Abrir Conexiones</button></div>`;
    box.querySelector('[data-manage]').onclick=()=>void window.AxonNavigation.go('/configuracion?section=connections');
    el('cloud-browser').querySelector('.cloud-shared').hidden=S.provider!=='dropbox';refreshIcons();
  }
  async function action(button,fn){button.disabled=true;try{await fn();}catch(e){message(e.message,true);}finally{if(button.isConnected)button.disabled=false;if(button.id==='cloud-save')updateSelection();}}
  const fileType=e=>e.type==='dir'?'Carpeta':!e.downloadable?'Documento en la nube':e.name.includes('.')?e.name.split('.').pop().toUpperCase():'Archivo';
  function fileIcon(e){if(e.type==='dir')return 'folder';const ext=e.name.split('.').pop().toLowerCase();if(['png','jpg','jpeg','gif','webp','avif','bmp','svg'].includes(ext))return 'image';if(['mp4','m4v','webm','mov'].includes(ext))return 'film';if(['mp3','m4a','ogg','wav','flac','opus'].includes(ext))return 'music';if(['zip','rar','7z','tar','gz'].includes(ext))return 'archive';return 'file-text';}
  function modified(value){const date=value?new Date(value):null;return date&&Number.isFinite(date.getTime())?date.toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'}):'—';}
  function visible(){return S.entries.filter(e=>e.name.toLocaleLowerCase().includes(S.filter.toLocaleLowerCase())).sort((a,b)=>{
    const dirs=(a.type==='dir'?0:1)-(b.type==='dir'?0:1);if(dirs)return dirs;
    let comparison=0;
    if(S.sort==='size')comparison=a.size-b.size;
    else if(S.sort==='modified'){const ta=Date.parse(a.modified)||0,tb=Date.parse(b.modified)||0;comparison=ta-tb;}
    else comparison=(S.sort==='type'?fileType(a):a.name).localeCompare(S.sort==='type'?fileType(b):b.name,'es',{numeric:true,sensitivity:'base'});
    return (S.order==='desc'?-1:1)*(comparison||a.name.localeCompare(b.name,'es',{numeric:true,sensitivity:'base'}));
  });}
  function updateSelection(){
    const entries=visible().filter(e=>e.downloadable),checked=entries.filter(e=>S.sel.has(e.path)).length;
    el('cloud-select-all').checked=!!entries.length&&checked===entries.length;el('cloud-select-all').indeterminate=checked>0&&checked<entries.length;
    const count=visible().length;el('cloud-count').textContent=(S.sel.size?S.sel.size+' seleccionado'+(S.sel.size===1?'':'s')+' · ':'')+(S.filter?count+' de '+S.entries.length:S.entries.length)+' elemento'+(S.entries.length===1?'':'s')+(S.cursor?' · hay más por cargar':'');
    el('cloud-save').disabled=!S.sel.size||S.busy||S.jobs.some(j=>['planning','running'].includes(j.state));
  }
  function renderList(){
    const list=el('cloud-list'),entries=visible();
    list.dataset.view=S.view;el('cloud-sort').value=S.sort;
    panel.querySelectorAll('[data-cloud-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cloudView===S.view)));
    const descending=S.order==='desc';el('cloud-order').innerHTML=icon(descending?'arrow-down':'arrow-up');el('cloud-order').setAttribute('aria-label',descending?'Cambiar a orden ascendente':'Cambiar a orden descendente');el('cloud-order').title=descending?'Descendente · cambiar a ascendente':'Ascendente · cambiar a descendente';
    const headings=S.view==='details'&&entries.length?'<div class="cloud-list-head" aria-hidden="true"><span></span><span>Nombre</span><span>Tipo</span><span>Tamaño</span><span>Modificado</span></div>':'';
    list.innerHTML=entries.length?headings+entries.map(e=>`<div class="cloud-row${S.sel.has(e.path)?' is-selected':''}" data-kind="${e.type==='dir'?'folder':'file'}"><label class="cloud-check"><input type="checkbox" data-select="${esc(e.path)}" aria-label="Seleccionar ${esc(e.name)}" ${S.sel.has(e.path)?'checked':''} ${!e.downloadable?'disabled':''}></label><button type="button" class="cloud-open" data-path="${esc(e.path)}" title="${esc(e.name)}">${icon(fileIcon(e))}<span>${esc(e.name)}</span></button><span class="cloud-row-type" data-label="Tipo">${esc(fileType(e))}</span><span class="cloud-row-meta" data-label="Tamaño">${e.type==='dir'?'—':e.downloadable?size(e.size):'En la nube'}</span><span class="cloud-row-date" data-label="Modificado">${esc(modified(e.modified))}</span></div>`).join(''):`<div class="empty-state">${S.filter?'No hay coincidencias en esta carpeta.':'Esta carpeta está vacía.'}</div>`;
    list.querySelectorAll('[data-select]').forEach(input=>input.onchange=()=>{if(input.checked)S.sel.add(input.dataset.select);else S.sel.delete(input.dataset.select);input.closest('.cloud-row').classList.toggle('is-selected',input.checked);updateSelection();});
    list.querySelectorAll('[data-path]').forEach(btn=>btn.onclick=()=>{const e=S.entries.find(e=>e.path===btn.dataset.path);void go(e.type==='dir'?{cloudPath:e.path,item:null,q:null}:{item:e.path});});
    el('cloud-more').hidden=!S.cursor;updateSelection();refreshIcons();
  }
  function breadcrumbs(){
    const pieces=S.path.split('/').filter(Boolean);let p='';const links=[{name:S.status.sources.find(s=>s.id===S.location)?.name||name(),path:''}];
    if(S.crumbs)links.push(...S.crumbs);else for(const part of pieces){p+='/'+part;links.push({name:part,path:p});}
    el('cloud-breadcrumb').innerHTML=links.map((l,i)=>`${i?'<span aria-hidden="true">/</span>':''}<button type="button" class="btn-secondary" data-path="${esc(l.path)}"${i===links.length-1?' aria-current="page"':''}>${esc(l.name)}</button>`).join('');
    el('cloud-breadcrumb').querySelectorAll('button').forEach(b=>b.onclick=()=>void go({cloudPath:b.dataset.path,item:null,q:null}));
  }
  async function preview(e){
    closePreview();if(!e)return;const box=el('cloud-preview'),ext=e.name.split('.').pop().toLowerCase(),url=base+'/stream?'+query(e.path),nav=S.nav;box.hidden=false;
    box.innerHTML=`<div class="cloud-preview-head"><h3>${esc(e.name)}</h3><a class="btn-secondary" href="${esc(url+'&download=1')}">${icon('download')} Descargar a mi computadora</a><button type="button" class="icon-btn" aria-label="Cerrar vista previa">${icon('x')}</button></div><div class="cloud-preview-body"></div><p class="listener-note">La vista previa trae contenido desde ${esc(name())}. Guardar en un disco crea una copia en el servidor.</p>`;
    box.querySelector('button').onclick=()=>void go({item:null});const body=box.querySelector('.cloud-preview-body');refreshIcons();
    if(!e.downloadable){body.textContent='Este documento se abre o exporta desde '+name()+'.';const link=box.querySelector('a');if(e.webUrl&&new URL(e.webUrl).origin==='https://drive.google.com'){link.href=e.webUrl;link.textContent='Abrir en Google Drive';link.target='_blank';link.rel='noopener noreferrer';}else link.remove();return;}
    if(['png','jpg','jpeg','gif','webp','avif','bmp'].includes(ext)){const img=document.createElement('img');img.alt=e.name;img.src=url;img.onerror=()=>message('No se pudo cargar la imagen. Reintentá la vista previa.',true);body.append(img);}
    else if(['mp4','m4v','webm','mp3','m4a','ogg','oga','wav','flac','opus'].includes(ext)){const media=document.createElement(['mp4','m4v','webm'].includes(ext)?'video':'audio');media.controls=true;media.preload='metadata';media.src=url;media.onerror=()=>message('No se pudo reproducir este formato. Podés guardar una copia.',true);body.append(media);}
    else if(ext==='pdf'){const frame=document.createElement('iframe');frame.title='Vista previa de '+e.name;frame.src=url;body.append(frame);}
    else if(['txt','md','csv','json','log','js','ts','py','yml','yaml','ini','conf','css','html','xml','env'].includes(ext)||!e.name.includes('.')){
      body.textContent='Cargando vista previa…';try{const r=e.size?await fetch(url,{headers:{Range:'bytes=0-524287'}}):null;if(r&&!r.ok)throw new Error('No se pudo cargar la vista previa');const text=r?await r.text():'(Archivo vacío)';if(nav!==S.nav)return;const pre=document.createElement('pre');pre.textContent=text+(e.size>524288?'\n\nVista parcial. Guardá una copia para abrir el archivo completo.':'');body.replaceChildren(pre);}catch(err){if(nav===S.nav){body.textContent=err.message;message(err.message,true);}}
    }else body.textContent='Este formato no tiene vista previa en el navegador. Podés guardar una copia para abrirlo con una aplicación.';
  }
  async function restore(p,snapshot){
    const nav=++S.nav;S.provider=Object.hasOwn(names,p.source)?p.source:'dropbox';base='/api/files/'+S.provider;S.crumbs=null;S.jobs=[];S.uploads=[];el('cloud-jobs').replaceChildren();clearTimeout(S.poll);closePreview();S.local ||= window.AxonFilesLocal.params();sec.classList.add('fm-cloud-mode');panel.hidden=false;
    tabs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.source===S.provider)));
    S.location=p.location||'account';S.path=p.cloudPath||'';S.filter=p.q||'';S.item=p.item||null;S.view=views.includes(p.view)?p.view:S.view;S.sort=sorts.includes(p.sort)?p.sort:S.sort;S.order=['asc','desc'].includes(p.order)?p.order:S.order;S.sel=new Set();S.entries=[];S.cursor=null;S.busy=true;el('cloud-browser').hidden=true;el('cloud-filter').value=S.filter;message('Consultando '+name()+'…');panel.querySelector('h2').textContent=name();await refreshSources();
    try{
      const d=await request(base+'/status');if(nav!==S.nav)return;S.status=d;
      if(d.connected&&!d.sources.some(s=>s.id===S.location)){S.location='account';S.path='';S.item=null;}
      renderConnection();
      if(d.connected&&d.visible!==false){el('cloud-list').textContent='Cargando carpeta…';el('cloud-list').setAttribute('aria-busy','true');const page=await request(base+'/list?'+query(S.path));if(nav!==S.nav)return;if(S.provider==='dropbox'){const status=await request(base+'/status');if(nav!==S.nav)return;S.status=status;renderConnection();}S.entries=page.entries;S.cursor=page.cursor;S.crumbs=page.breadcrumbs||null;S.sel=new Set((snapshot?.sel||[]).filter(path=>S.entries.some(e=>e.path===path)));breadcrumbs();S.busy=false;renderList();await preview(S.entries.find(e=>e.path===S.item||e.name===S.item));}
      if(nav!==S.nav)return;
      message(p.connection==='failed'?'No se pudo conectar la cuenta. Revisá la configuración y volvé a intentar.':p.connection==='cancelled'?'Conexión cancelada.':'',p.connection==='failed');
      window.AxonNavigation.update('files',params());if(d.connected)await pollJobs();if(snapshot?.top)panel.scrollTop=snapshot.top;
    }catch(e){if(nav===S.nav){message(e.message,true);el('cloud-list').textContent='No se pudo cargar la carpeta. Usá Actualizar para reintentar.';}}
    finally{if(nav===S.nav){S.busy=false;el('cloud-list').setAttribute('aria-busy','false');updateSelection();}}
  }
  function renderJobs(){
    const labels={planning:'Revisando selección',running:'Copiando',complete:'Copia completa',failed:'Copia fallida',cancelled:'Cancelada',interrupted:'Interrumpida'};
    el('cloud-jobs').innerHTML=S.jobs.length?'<h3>Copias al servidor</h3>'+S.jobs.slice(0,8).map(j=>`<article><div class="cloud-job-head"><strong>${esc(labels[j.state])}</strong><span>${size(j.received)} / ${size(j.bytes)}</span></div><p class="cloud-job-dest">${esc(j.directory)}${j.names.length?' · '+esc(j.names.join(', ')):''}</p>${j.state==='running'?`<progress value="${j.received}" max="${Math.max(1,j.bytes)}" aria-label="Progreso de copia"></progress>`:''}${j.error?`<p class="cloud-error">${esc(j.error)}</p>`:''}${j.published.length?`<p class="listener-note">Guardado: ${esc(j.published.join(', '))}</p>`:''}${['planning','running'].includes(j.state)?`<button type="button" class="btn-secondary" data-cancel="${esc(j.id)}">Cancelar copia</button>`:j.state==='complete'?`<button type="button" class="btn-secondary" data-folder="${esc(j.directory)}">Abrir carpeta del servidor</button>`:''}</article>`).join(''):'';
    if(S.uploads.length)el('cloud-jobs').insertAdjacentHTML('beforeend','<h3>Subidas de agentes</h3>'+S.uploads.slice(0,8).map(u=>`<article><div class="cloud-job-head"><strong>${esc({starting:'Preparando',running:'Subiendo',committing:'Publicando',complete:'Guardado en '+name(),failed:'Falló',cancelled:'Cancelada',uncertain:'Revisar publicación'}[u.state]||u.state)}</strong><span>${size(u.received)} / ${size(u.size)}</span></div><p class="cloud-job-dest">${esc(u.agent)} · ${esc(u.path)}</p>${u.state==='running'?`<progress value="${u.received}" max="${Math.max(1,u.size)}" aria-label="Progreso de subida"></progress>`:''}${u.error?`<p class="cloud-error">${esc(u.error)}</p>`:''}${u.state==='complete'?`<button type="button" class="btn-secondary" data-upload-path="${esc(u.path)}">Ver archivo en ${esc(name())}</button>`:''}</article>`).join(''));
    el('cloud-jobs').querySelectorAll('[data-upload-path]').forEach(b=>b.onclick=()=>void go({cloudPath:b.dataset.uploadPath.slice(0,b.dataset.uploadPath.lastIndexOf('/')),location:'account',item:b.dataset.uploadPath}));
    el('cloud-jobs').querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>action(b,async()=>{await request(base+'/downloads/'+b.dataset.cancel+'/cancel',{});await pollJobs();}));
    el('cloud-jobs').querySelectorAll('[data-folder]').forEach(b=>b.onclick=()=>void window.AxonNavigation.go(window.AxonNavigation.url('files',{path:b.dataset.folder})));
  }
  async function pollJobs(){
    clearTimeout(S.poll);const nav=S.nav;try{const [data,uploads]=await Promise.all([request(base+'/downloads'),S.status?.uploadSupported?request(base+'/uploads'):Promise.resolve({jobs:[]})]);if(nav!==S.nav)return;S.jobs=data.jobs;S.uploads=uploads.jobs;renderJobs();updateSelection();}catch(e){if(nav!==S.nav)return;message('No se pudo actualizar el estado de las copias. '+e.message,true);}
    if(!panel.hidden)S.poll=setTimeout(()=>void pollJobs(),(S.jobs.some(j=>['planning','running'].includes(j.state))||S.uploads.some(j=>['starting','running','committing'].includes(j.state)))?1500:10000);
  }
  async function chooseDestination(){
    const dialog=document.createElement('dialog');dialog.className='cloud-destination';dialog.setAttribute('aria-label','Elegir destino en el servidor');
    dialog.innerHTML=`<form method="dialog"><div class="cloud-preview-head"><h3>Guardar en el servidor</h3><button type="submit" class="icon-btn" aria-label="Cerrar">${icon('x')}</button></div></form><p>Se copiará lo seleccionado. Los archivos existentes se conservan.</p><label>Disco<select id="cloud-disk"></select></label><form id="cloud-dest-path-form"><label>Carpeta de destino<input id="cloud-dest-path" spellcheck="false" autocomplete="off"></label><button type="submit" class="btn-secondary">Ir</button></form><div class="cloud-dest-controls"><button type="button" id="cloud-dest-parent" class="btn-secondary">${icon('arrow-up')} Subir</button><button type="button" id="cloud-dest-mkdir" class="btn-secondary">Nueva carpeta</button></div><div id="cloud-dest-list" class="cloud-dest-list"></div><form id="cloud-dest-mkdir-form" hidden><label>Nombre de carpeta<input name="name" required maxlength="255"></label><button type="submit" class="btn-secondary">Crear</button></form><p id="cloud-dest-error" role="alert" class="cloud-error"></p><div class="modal-actions"><button type="button" id="cloud-dest-save" class="btn-primary" disabled>Guardar acá</button></div>`;
    document.body.append(dialog);refreshIcons();const q=id=>dialog.querySelector('#'+id);let current=null,nav=0,volumes=[];const previous=document.activeElement;
    return new Promise(resolve=>{
      dialog.addEventListener('close',()=>{dialog.remove();previous?.focus();resolve(null);},{once:true});dialog.showModal();
      async function browse(p){
        const id=++nav;q('cloud-dest-save').disabled=true;q('cloud-dest-error').textContent='';q('cloud-dest-list').textContent='Consultando carpeta…';current=null;
        try{const d=await request('/api/files?path='+encodeURIComponent(p));if(id!==nav||!dialog.open)return;current=d;q('cloud-dest-path').value=d.path;q('cloud-disk').value=d.volume?.id||'';
          q('cloud-dest-list').innerHTML=d.entries.filter(e=>e.type==='dir').map(e=>`<button type="button" class="cloud-folder" data-name="${esc(e.name)}">${icon('folder')} ${esc(e.name)}</button>`).join('')||'<p class="listener-note">No hay subcarpetas.</p>';
          q('cloud-dest-list').querySelectorAll('button').forEach(b=>b.onclick=()=>void browse(d.path.replace(/\/$/,'')+'/'+b.dataset.name));q('cloud-dest-save').disabled=!d.volume||d.volume.readOnly;refreshIcons();
        }catch(e){q('cloud-dest-list').textContent='';q('cloud-dest-error').textContent=e.message;}
      }
      q('cloud-disk').onchange=()=>{const v=volumes.find(v=>v.id===q('cloud-disk').value);if(v?.path)void browse(v.path);};
      q('cloud-dest-path-form').onsubmit=e=>{e.preventDefault();void browse(q('cloud-dest-path').value);};
      q('cloud-dest-parent').onclick=()=>{if(current)void browse(current.path.slice(0,current.path.lastIndexOf('/'))||'/');};
      q('cloud-dest-mkdir').onclick=()=>{q('cloud-dest-mkdir-form').hidden=!q('cloud-dest-mkdir-form').hidden;q('cloud-dest-mkdir-form').elements.name.focus();};
      q('cloud-dest-mkdir-form').onsubmit=async e=>{e.preventDefault();if(!current)return;const name=new FormData(e.currentTarget).get('name');if(!name||/[/\\\x00-\x1f]/.test(name)||['.','..'].includes(name)){q('cloud-dest-error').textContent='Nombre de carpeta inválido';return;}const p=current.path.replace(/\/$/,'')+'/'+name;try{await request('/api/files/mkdir',{path:p});q('cloud-dest-mkdir-form').hidden=true;await browse(p);}catch(err){q('cloud-dest-error').textContent=err.message;}};
      q('cloud-dest-save').onclick=()=>{if(!current?.volume||current.volume.readOnly)return;const result={directory:current.path,volumeToken:current.volume.token};resolve(result);dialog.close();};
      void (async()=>{try{const d=await request('/api/files/volumes');volumes=d.volumes.filter(v=>v.path&&v.readable);q('cloud-disk').innerHTML='<option value="">Elegí un disco</option>'+volumes.map(v=>`<option value="${esc(v.id)}">${esc(v.name)} · ${esc(v.path)}${v.available!=null?' · '+size(v.available)+' libres':''}${v.readOnly?' · sólo lectura':''}</option>`).join('');await browse(window.AxonFilesLocal.location());}catch(e){q('cloud-dest-error').textContent=e.message;}})();
    });
  }
  tabs.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-connections')){void window.AxonNavigation.go('/configuracion?section=connections');return;}if(b.dataset.source==='server')void window.AxonNavigation.go(window.AxonNavigation.url('files',S.local||{path:window.AxonFilesLocal.location()}));else if(Object.hasOwn(names,b.dataset.source)){if(!sec.classList.contains('fm-cloud-mode'))S.local=window.AxonFilesLocal.params();void go({source:b.dataset.source,location:'account',cloudPath:'',item:null,q:null});}});
  el('cloud-refresh').onclick=()=>void restore(params());
  el('cloud-location').onchange=()=>void go({location:el('cloud-location').value,cloudPath:'',item:null,q:null});
  el('cloud-filter').oninput=()=>{S.filter=el('cloud-filter').value;renderList();window.AxonNavigation.update('files',params());};
  panel.querySelectorAll('[data-cloud-view]').forEach(b=>b.onclick=()=>{S.view=b.dataset.cloudView;renderList();saveView();});
  el('cloud-sort').onchange=()=>{S.sort=el('cloud-sort').value;renderList();saveView();};
  el('cloud-order').onclick=()=>{S.order=S.order==='asc'?'desc':'asc';renderList();saveView();};
  el('cloud-select-all').onchange=()=>{for(const e of visible())if(e.downloadable){if(el('cloud-select-all').checked)S.sel.add(e.path);else S.sel.delete(e.path);}renderList();};
  el('cloud-more').onclick=e=>action(e.currentTarget,async()=>{const nav=S.nav,page=await request(base+'/list?'+query(S.path,{cursor:S.cursor}));if(nav!==S.nav)return;const paths=new Set(S.entries.map(e=>e.path));S.entries.push(...page.entries.filter(e=>!paths.has(e.path)));S.cursor=page.cursor;renderList();});
  el('cloud-shared-form').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;action(form.querySelector('button'),async()=>{const d=await request(base+'/shared',{url:new FormData(form).get('url')});form.reset();await go({location:d.id,cloudPath:'',q:null,item:null});});};
  el('cloud-remove-link').onclick=e=>action(e.currentTarget,async()=>{if(!await confirmDialog('Quitar enlace','Se quita este acceso de AXON. El contenido de Dropbox se conserva.','Quitar'))return;await request(base+'/shared/'+S.location+'/remove',{});await go({location:'account',cloudPath:'',item:null,q:null});});
  el('cloud-copy-path').onclick=e=>action(e.currentTarget,async()=>{await navigator.clipboard.writeText(S.path);message('Ruta copiada: '+(S.path||'raíz de la ubicación (ruta vacía)'));});
  el('cloud-save').onclick=e=>action(e.currentTarget,async()=>{const paths=[...S.sel],location=S.location,endpoint=base,dest=await chooseDestination();if(!dest)return;await request(endpoint+'/downloads',{location,paths,...dest});message('Copia iniciada. Continúa aunque cierres la pestaña.');S.sel.clear();renderList();await pollJobs();});
  const localLeave=window.AxonPages.files.leave;window.AxonPages.files.leave=()=>{localLeave();closePreview();clearTimeout(S.poll);};
  window.AxonCloud=window.AxonDropbox={params,restore,hide,refreshSources,capture:()=>({sel:[...S.sel],top:panel.scrollTop})};
})();
