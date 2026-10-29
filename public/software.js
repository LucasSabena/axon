/* Native software inventory. Catalog recommendations never define inventory. */
(() => {
'use strict';
let snapshot=null, flight=null, timer=null, mode='updates', query='', manager='', scope='', state='', kind='', kindDefaulted=false, page=0, signedIn=false;
const selected=new Set(), size=75, planning=new Set();
const hasUpdate=p=>p.canUpdate||p.updateState==='unsupported'&&!!(p.targetVersion||p.targetRevision||p.targetCommit);
// User-facing programs (desktop apps, CLI tools, toolchains) vs OS packages.
const category=p=>!p.risk&&['application','tool','toolchain'].includes(p.kind)?'programs':'system';
const CATEGORY_ORDER={programs:0,system:1};
const CATEGORY_LABEL={programs:'Programas',system:'Sistema operativo'};
const updateLabel=()=>planning.size?'Preparando…':selected.size?`Actualizar ${selected.size} seleccionados`:'Actualizar lo seguro';
// Same order as src/software-guide.ts FOLDERS.
const FOLDERS=['IA y agentes','Internet y comunicación','Oficina','Multimedia','Gráficos y diseño','Desarrollo','Juegos','Educación y ciencia','Utilidades','Sistema y configuración','Herramientas de terminal','Componentes del sistema','Otros'];
const FOLDER_CAP=200;
const RISK={safe:['Seguro','Se puede actualizar sin miedo.'],review:['Conviene revisar','Casi siempre sale bien, pero puede cortar algo un momento (el escritorio, la red o el acceso remoto). Mejor cuando no estés usando eso.'],careful:['Delicado','Piezas centrales. Actualizalas de a una, cuando puedas reiniciar el servidor y tengas tiempo de revisar.']};
const REMOVABLE=['apt','snap','flatpak','pnpm','bun','pipx','uv','cargo'];
const ORIGIN={apt:['Ubuntu (APT)','Paquetes de Ubuntu (APT)','La tienda oficial de Ubuntu. De acá sale el sistema operativo y la mayoría de los programas.'],snap:['Snap','Snap Store','Apps empaquetadas por Canonical, como Firefox. Snap también las actualiza solo.'],flatpak:['Flatpak','Flathub (Flatpak)','Apps de escritorio que corren aisladas del sistema, como Blender o Godot.'],pnpm:['pnpm','Herramientas de Node (pnpm)','Programas de terminal para desarrollo, como Claude Code, Vercel o Supabase.'],bun:['Bun','Herramientas de Bun','Programas de terminal instalados con Bun.'],'node-global':['npm antiguo','Node global (npm)','Herramientas instaladas con npm. AXON sólo las muestra: para actualizarlas conviene reinstalarlas con pnpm.'],pipx:['pipx','Herramientas de Python (pipx)','Programas de terminal escritos en Python.'],uv:['uv','Herramientas de Python (uv)','Programas de terminal escritos en Python, instalados con uv.'],cargo:['cargo','Herramientas de Rust (cargo)','Programas de terminal escritos en Rust.'],rustup:['rustup','Versiones de Rust (rustup)','Las versiones del lenguaje Rust instaladas.'],mise:['mise','Versiones de lenguajes (mise)','Versiones de Node, Python u otros lenguajes que usan tus proyectos.'],brew:['Homebrew','Homebrew','Programas instalados con Homebrew.'],nix:['Nix','Nix','Programas del perfil de Nix.'],dnf:['DNF','Paquetes del sistema (DNF)','La tienda del sistema operativo.'],pacman:['pacman','Paquetes del sistema (pacman)','La tienda del sistema operativo.'],manual:['A mano','Instalados a mano','Programas copiados directo a una carpeta, sin pasar por una tienda. AXON los ve, pero no puede actualizarlos ni desinstalarlos.'],asdf:['asdf','asdf','Versiones de lenguajes gestionadas con asdf.']};
const UPDATABLE=['apt','snap','flatpak','pnpm','bun'];
const originShort=m=>ORIGIN[m]?.[0]||m;
const bytes=n=>{const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}return (i?n.toFixed(n<10?1:0):n)+' '+u[i];};
const safeUpdate=p=>p.canUpdate&&(category(p)==='programs'||!p.risk||p.risk.level==='safe');
let collapsed=new Set(['Componentes del sistema']);
try{const saved=JSON.parse(localStorage.getItem('axon.software.collapsed')||'null');if(Array.isArray(saved))collapsed=new Set(saved);}catch{}
const saveCollapsed=()=>{try{localStorage.setItem('axon.software.collapsed',JSON.stringify([...collapsed]));}catch{}};
let renderedRevision=null;
document.addEventListener('axon:authenticated',()=>{signedIn=true;});
document.addEventListener('axon:session-expired',()=>{signedIn=false;clearTimeout(timer);});
const el=id=>document.getElementById(id);
const states={unchecked:'Pendiente',available:'Actualización disponible',current:'Sin actualizaciones detectadas',held:'Retenido',unsupported:'Sólo lectura',unmanaged:'Origen no comprobado',error:'No se pudo comprobar'};
const params=()=>({view:mode==='updates'?'':mode,q:query,manager,scope,state,kind,page:page?String(page+1):''});
const sync=()=>window.AxonNavigation?.update('programs',params());
const sourceLabel=p=>originShort(p.manager)+' · '+(p.scope==='system'?'Sistema':p.user);
function selectionLabel(){
 el('update-all-btn').textContent=updateLabel();
 el('programs-grid').querySelectorAll('[data-select]').forEach(input=>input.checked=selected.has(input.dataset.select));
 const ids=matching().slice(page*size,(page+1)*size).filter(p=>p.canUpdate).map(p=>p.id);
 el('software-select-page').textContent=ids.length&&ids.every(id=>selected.has(id))?'Deseleccionar página':'Seleccionar página';
}
function matching(){
 const q=query.toLocaleLowerCase('es');
 return (snapshot?.installations||[]).filter(p=>(mode!=='updates'||hasUpdate(p))&&(!kind||category(p)===kind)&&(!manager||p.manager===manager)&&(!scope||p.scope===scope)&&(!state||p.updateState===state)&&(!q||[p.name,p.packageName,p.user,p.root,p.description].join(' ').toLocaleLowerCase('es').includes(q))).sort((a,b)=>CATEGORY_ORDER[category(a)]-CATEGORY_ORDER[category(b)]||(mode==='updates'?Number(b.canUpdate)-Number(a.canUpdate)||0:0)||a.name.localeCompare(b.name,'es'));
}
function statusCell(p){
 return planning.has(p.id)?`<span class="software-state s-pending">${icon('loader','spin')} Preparando…</span>`
  :p.canUpdate?`<button type="button" class="btn-secondary" data-update="${esc(p.id)}"${planning.size?' disabled':''}>${icon('arrow-up-circle')} Actualizar</button>`
  :`<span class="software-state s-${esc(p.updateState)}">${esc(states[p.updateState]||'No comprobado')}</span>`;
}
const canRemove=p=>REMOVABLE.includes(p.manager)&&!['runtime','dependency'].includes(p.kind);
function row(p){
 const remove=mode==='installed'&&canRemove(p)?`<button type="button" class="icon-btn software-remove" data-remove="${esc(p.id)}" aria-label="Desinstalar ${esc(p.name)}" title="Desinstalar">${icon('trash-2')}</button>`:'';
 return `<article class="software-row" role="row"><div class="software-name" role="cell"><input type="checkbox" data-select="${esc(p.id)}" aria-label="Seleccionar ${esc(p.name)} · ${esc(sourceLabel(p))}"${selected.has(p.id)?' checked':''}${!p.canUpdate?' disabled':''}><img src="${esc(p.iconUrl)}" alt="" width="32" height="32" loading="lazy" onerror="this.style.visibility='hidden'"><div><button type="button" class="software-detail" data-detail="${esc(p.id)}">${esc(p.name)}</button><small>${esc(p.packageName)}</small></div></div><span class="software-origin" role="cell">${esc(sourceLabel(p))}</span><span class="software-version" role="cell">${esc(p.version||'Versión no registrada')}${hasUpdate(p)?`<small>→ ${esc(p.targetVersion||p.targetRevision||p.targetCommit?.slice(0,12)||'nuevo commit')}</small>`:''}</span><div class="software-status" role="cell">${statusCell(p)}${remove}${p.reason?`<small class="software-reason" title="${esc(p.reason)}">${esc(p.reason)}</small>`:''}</div></article>`;
}
const COLUMNS=`<div class="software-columns" role="row" aria-hidden="true"><span role="columnheader">Programa / paquete</span><span role="columnheader">Origen</span><span role="columnheader">Versión</span><span role="columnheader">Estado</span></div>`;
function emptyText(){
 return snapshot.loading?'Leyendo instalaciones… Los resultados aparecen a medida que se detectan.':mode==='updates'?(snapshot.checking?'Buscando actualizaciones… Podés abrir Instalados mientras termina.':'Todo está al día. No hay actualizaciones disponibles.'):'No hay instalaciones que coincidan con los filtros.';
}
// Installed: automatic folders from the desktop categories (backend `folder`).
function renderFolders(rows){
 const groups=new Map();for(const p of rows){const f=FOLDERS.includes(p.folder)?p.folder:'Otros';if(!groups.has(f))groups.set(f,[]);groups.get(f).push(p);}
 const open=f=>!!query||!collapsed.has(f);
 return [...groups].sort((a,b)=>FOLDERS.indexOf(a[0])-FOLDERS.indexOf(b[0])).map(([folder,items])=>{
  const expanded=open(folder),shown=expanded?items.slice(0,FOLDER_CAP):[];
  return `<div class="software-folder" role="row"><button type="button" role="cell" data-folder="${esc(folder)}" aria-expanded="${expanded}">${icon(expanded?'folder-open':'folder')} <span>${esc(folder)}</span><small>${items.length}</small>${icon(expanded?'chevron-up':'chevron-down')}</button></div>`
   +shown.map(row).join('')+(expanded&&items.length>FOLDER_CAP?`<p class="software-more">Se muestran ${FOLDER_CAP} de ${items.length}. Usá la búsqueda para encontrar el resto.</p>`:'');
 }).join('');
}
// Updates: programs first, then system pieces grouped by what they are and
// how risky the update is (backend `risk`).
function renderUpdates(rows){
 const programs=rows.filter(p=>category(p)==='programs'),system=rows.filter(p=>category(p)==='system');
 let html='';
 if(programs.length)html+=`<section class="software-section"><header><h3>Programas</h3><p>Apps y herramientas que usás. Actualizarlas es seguro; si alguna está abierta puede pedir reiniciarla.</p></header><div class="software-list" role="table">${COLUMNS}${programs.map(row).join('')}</div></section>`;
 const groups=new Map();
 for(const p of system){const r=p.risk||{level:'safe',group:'other:'+p.manager,title:'Componentes del sistema',detail:'Piezas internas del sistema.'};if(!groups.has(r.group))groups.set(r.group,{risk:r,items:[]});groups.get(r.group).items.push(p);}
 for(const level of ['safe','review','careful']){
  const cards=[...groups.values()].filter(g=>g.risk.level===level).sort((a,b)=>b.items.length-a.items.length||a.risk.title.localeCompare(b.risk.title,'es'));
  if(!cards.length)continue;
  html+=`<section class="software-section"><header><h3><span class="software-risk-badge r-${level}">${RISK[level][0]}</span> Sistema</h3><p>${RISK[level][1]}</p></header><div class="software-risk-grid">${cards.map(g=>{
   const ids=g.items.filter(p=>p.canUpdate).map(p=>p.id),busy=g.items.some(p=>planning.has(p.id));
   return `<article class="software-risk r-${level}"><strong>${esc(g.risk.title)}</strong><p>${esc(g.risk.detail)}</p><details><summary>${g.items.length===1?'1 paquete':g.items.length+' paquetes'}</summary><ul>${g.items.map(p=>`<li><code>${esc(p.packageName)}</code> ${esc(p.version||'')} → ${esc(p.targetVersion||p.targetRevision||p.targetCommit?.slice(0,12)||'?')}${p.canUpdate?'':` · <span class="software-state s-${esc(p.updateState)}">${esc(p.reason||states[p.updateState]||'')}</span>`}</li>`).join('')}</ul></details><div class="software-risk-actions">${busy?`<span class="software-state s-pending">${icon('loader','spin')} Preparando…</span>`:ids.length?`<button type="button" class="btn-secondary" data-group-update="${esc(ids.join(','))}"${planning.size?' disabled':''}>${icon('arrow-up-circle')} Actualizar${ids.length>1?' ('+ids.length+')':''}</button>`:''}</div></article>`;
  }).join('')}</div></section>`;
 }
 return html;
}
const SOURCE_STATE={ok:'Comprobado',unsupported:'Sólo lectura',error:'Con problemas',unchecked:'Pendiente'};
function renderSources(){
 const count=s=>snapshot.installations.filter(p=>p.sourceId===s.id).length;
 const all=snapshot.sources.filter(s=>s.manager!=='metadata'),present=all.filter(s=>s.available&&(count(s)||s.error)),absent=[...new Set(all.filter(s=>!present.includes(s)).map(s=>s.manager))].filter(m=>!present.some(s=>s.manager===m));
 return `<div class="software-sources-intro"><p><strong>¿Qué son los orígenes?</strong> Son las distintas "tiendas" o herramientas que instalaron programas en este servidor. No tenés que hacer nada acá: sirve para saber de dónde salió cada programa y si AXON puede actualizarlo y desinstalarlo.</p></div>`
  +present.map(s=>{const [,title,about]=ORIGIN[s.manager]||[s.manager,s.manager,''],n=count(s);
   const can=UPDATABLE.includes(s.manager)?'AXON puede actualizarlos'+(REMOVABLE.includes(s.manager)?' y desinstalarlos':''):REMOVABLE.includes(s.manager)?'AXON puede desinstalarlos, pero no actualizarlos':'AXON sólo los muestra';
   return `<article class="software-source"><div><strong>${esc(title)}</strong><p>${esc(about)}</p><small>${s.scope==='system'?'Para todo el sistema':'Del usuario '+esc(s.user)}${s.root?' · '+esc(s.root):''}</small></div><div><span class="software-state s-${s.error?'error':s.updateState==='ok'?'current':'unsupported'}">${n===1?'1 instalado':n+' instalados'} · ${esc(s.error?'Con problemas':SOURCE_STATE[s.updateState]||'Leído')}</span><p>${esc(can)}.</p>${s.error?`<p class="software-state s-error">${esc(s.error)}</p>`:''}${s.metadataAt?`<p>Lista de versiones consultada: ${esc(new Date(s.metadataAt).toLocaleString())}</p>`:''}${s.manager==='apt'&&snapshot.canAdministerSystem?'<button class="btn-secondary" data-indices title="Pregunta a los servidores de Ubuntu si hay versiones nuevas. No instala nada.">Buscar versiones nuevas de Ubuntu</button>':''}</div></article>`;}).join('')
  +(absent.length?`<p class="software-more">Sin nada instalado en este servidor: ${absent.map(m=>esc(originShort(m))).join(', ')}.</p>`:'');
}
function render(){
 if(!snapshot)return;
 const pending=snapshot.installations.filter(hasUpdate), manageable=pending.filter(safeUpdate), rows=matching();
 const count=el('nav-count-programs');if(count){count.textContent=pending.length||'';count.classList.toggle('nav-alert',pending.length>0);}
 el('programs-updated').textContent=snapshot.loading?'Leyendo programas instalados…':snapshot.checking?'Comprobando actualizaciones…':snapshot.checkedAt?'Comprobado '+new Date(snapshot.checkedAt).toLocaleTimeString():'Inventario sin completar';
 el('programs-grid').setAttribute('aria-busy',String(!!snapshot.loading));
 const programs=snapshot.installations.filter(p=>category(p)==='programs').length;
 el('software-summary').textContent=`${programs} programas · ${snapshot.installations.length-programs} componentes del sistema · ${pending.length} actualizaciones disponibles`;
 el('update-all-btn').disabled=planning.size>0||!(selected.size||manageable.length);
 el('update-all-btn').title=selected.size?'':'Actualiza los programas y las piezas de sistema marcadas como seguras. Las delicadas se actualizan aparte.';
 el('software-modes').querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
 el('software-manager').innerHTML='<option value="">Todos los orígenes</option>'+[...new Set(snapshot.installations.map(p=>p.manager))].sort().map(m=>`<option value="${esc(m)}"${m===manager?' selected':''}>${esc(originShort(m))}</option>`).join('');
 const errors=snapshot.sources.filter(s=>s.error);
 const complete=snapshot.sources.filter(s=>s.available&&s.manager!=='metadata'&&s.updateState!=='unchecked').length;
 const detected=snapshot.sources.filter(s=>s.available&&s.manager!=='metadata').length;
 el('software-notice').innerHTML=(planning.size?`<p class="software-progress" role="status">${icon('loader','spin')} Preparando el plan de actualización de ${planning.size===1?'un programa':planning.size+' programas'}… Esto vuelve a comprobar el gestor y puede tardar.</p>`:'')+(snapshot.checking?`<p class="software-progress" role="status">${icon('loader','spin')} ${snapshot.loading?'Leyendo instalaciones. Los programas aparecen a medida que se detectan.':`Comprobando orígenes (${complete}/${detected}). Las actualizaciones aparecen a medida que se encuentran.`}</p>`:'')+(snapshot.error?`<p class="software-warning">${esc(snapshot.error)}. Se conserva la última lectura. <button class="btn-secondary" data-retry>Reintentar</button></p>`:'')+(errors.length&&mode!=='sources'?`<details class="software-warning"><summary>${errors.length===1?'Un origen tiene problemas':errors.length+' orígenes tienen problemas'}</summary>${errors.map(s=>`<p><strong>${esc(sourceLabel(s))}</strong>: ${esc(s.error)}</p>`).join('')}</details>`:'');
 el('software-toolbar').classList.toggle('hidden',mode==='sources');
 el('software-pagination').classList.add('hidden');
 const grid=el('programs-grid');grid.removeAttribute('role');
 if(mode==='sources'){grid.className='software-list';grid.innerHTML=renderSources();}
 else if(!rows.length){grid.className='software-list';grid.innerHTML=`<div class="empty-state">${emptyText()}</div>`;}
 else if(mode==='updates'){grid.className='software-updates';grid.innerHTML=renderUpdates(rows);}
 else{grid.className='software-list';grid.setAttribute('role','table');grid.innerHTML=COLUMNS+renderFolders(rows);}
 selectionLabel();
 refreshIcons(el('tab-programs'));
}
async function load(fresh=false){
 if(flight)return flight;
 if(!snapshot){el('programs-updated').textContent='Leyendo programas…';el('programs-grid').innerHTML='<div class="empty-state" role="status">Leyendo programas instalados…</div>';el('programs-grid').setAttribute('aria-busy','true');}
 flight=(async()=>{try{
  const next=await api('/api/software'+(fresh?'?fresh=1':''));
  signedIn=true;const changed=!snapshot||next.revision===undefined||next.revision!==renderedRevision||next.checking!==snapshot.checking||next.loading!==snapshot.loading;
  snapshot=next;
  for(const id of selected)if(!snapshot.installations.some(p=>p.id===id&&p.canUpdate))selected.delete(id);
  if(changed){render();renderedRevision=snapshot.revision;}clearTimeout(timer);if(snapshot.checking&&!document.hidden&&activeTabName==='programs'&&signedIn)timer=setTimeout(()=>load(),1000);
  return snapshot;
 }catch(e){el('software-notice').innerHTML='<p class="software-warning">No se pudo leer el inventario. <button class="btn-secondary" data-retry>Reintentar</button></p>';errToast(e);return snapshot;}})().finally(()=>flight=null);
 return flight;
}
function dialog(title,html){
 const previous=document.activeElement, d=document.createElement('dialog');d.className='software-dialog';
 d.innerHTML=`<div class="software-dialog-body"><h3>${esc(title)}</h3>${html}<div class="modal-actions"><button type="button" class="btn-secondary" data-close>Cerrar</button></div></div>`;
 d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>{d.remove();previous?.focus();});document.body.append(d);d.showModal();return d;
}
function detail(id){
 const p=snapshot?.installations.find(p=>p.id===id);if(!p)return;
 const info=p.iconInfo;
 const d=dialog(p.name,`<dl class="software-facts"><dt>Paquete</dt><dd>${esc(p.packageName)}</dd><dt>Gestor</dt><dd>${esc(p.manager)}</dd><dt>Ámbito</dt><dd>${esc(p.scope==='system'?'Sistema':p.user+' (UID '+p.uid+')')}</dd><dt>Ubicación</dt><dd>${esc(p.root)}</dd><dt>Versión registrada</dt><dd>${esc(p.version||'No registrada')}</dd>${p.canUpdate?`<dt>Actualización</dt><dd>${esc(p.targetVersion||p.targetRevision||p.targetCommit?.slice(0,12)||'nuevo commit')}</dd>`:''}<dt>Estado</dt><dd><span class="software-state s-${esc(p.updateState)}">${esc(states[p.updateState]||p.updateState)}</span></dd>${p.origin?`<dt>Origen</dt><dd>${esc(p.origin)}</dd>`:''}${p.homepage?`<dt>Sitio</dt><dd><a href="${esc(p.homepage)}" target="_blank" rel="noopener noreferrer">${esc(p.homepage)}</a></dd>`:''}${p.executables?.length?`<dt>Ejecutables</dt><dd>${p.executables.map(x=>`<code>${esc(x)}</code>`).join(' ')}</dd>`:''}${info?`<dt>Icono</dt><dd>${esc(info.label)}${info.attribution?`<small class="settings-help">${esc(info.attribution)} · ${esc(info.license||'')}</small>`:''}</dd>`:p.iconSource?`<dt>Icono</dt><dd>${esc(p.iconSource)}</dd>`:''}</dl>${info?.sourceUrl?`<p><a href="${esc(info.sourceUrl)}" target="_blank" rel="noopener noreferrer">Ver fuente del icono</a>${info.licenseUrl?` · <a href="${esc(info.licenseUrl)}" target="_blank" rel="noopener noreferrer">Licencia</a>`:''}</p>`:''}<p>${esc(p.description||'')}</p><p class="settings-help">${esc(p.reason||'La actualización se revisa con el gestor de esta instalación.')}</p>${p.integrationId?`<p><a href="/agentes?id=${p.integrationId==='claude-code'?'claude':encodeURIComponent(p.integrationId)}">Ver integración y cuentas</a></p>`:''}`);
 if(canRemove(p)){const rm=document.createElement('button');rm.type='button';rm.className='btn-danger';rm.textContent='Desinstalar';d.querySelector('.modal-actions').prepend(rm);rm.onclick=()=>{d.close();uninstall(p.id);};}
 const b=document.createElement('button');b.type='button';b.className='btn-secondary';b.textContent='Elegir icono';d.querySelector('.modal-actions').prepend(b);b.onclick=()=>{d.close();iconPicker(p);};
 const ig=document.createElement('button');ig.type='button';ig.className='btn-secondary';ig.textContent=p.ignored?'Dejar de ignorar':'Ignorar actualizaciones';ig.title=p.ignored?'Vuelve a comprobar esta instalación en los planes':'No se ofrece en actualizaciones; queda retenida en la configuración de AXON';
 d.querySelector('.modal-actions').prepend(ig);
 ig.onclick=async()=>{try{await AxonUI.busy(ig,async()=>{await api('/api/software/'+encodeURIComponent(p.id)+'/ignore',{method:'PUT',body:{ignored:!p.ignored}});d.close();await load(true);toast(p.ignored===undefined||!p.ignored?'Actualizaciones ignoradas':'Se vuelve a comprobar esta instalación','success');});}catch(e){errToast(e);}};
}
function iconPicker(p){
 const d=dialog('Icono de '+p.name,`<p class="settings-help">Buscá el programa o su proyecto. La selección se conserva en este servidor.</p><label for="software-icon-query">Buscar en el catálogo</label><input class="software-icon-query" id="software-icon-query" type="search" autocomplete="off"><div class="software-icon-results" aria-live="polite">Cargando catálogo…</div>`);
 const input=d.querySelector('input'),results=d.querySelector('.software-icon-results');let request=0,delay;
 const search=async()=>{const current=++request;results.textContent='Buscando iconos…';try{const data=await api('/api/software/icon-catalog?q='+encodeURIComponent(input.value));if(!d.isConnected||current!==request)return;results.innerHTML=data.icons.length?data.icons.map(i=>`<button type="button" class="software-icon-option" data-catalog="${esc(i.id)}"><img src="${esc(i.preview)}" alt="" width="40" height="40" loading="lazy"><strong>${esc(i.name)}</strong><small>${esc(i.attribution)} · ${esc(i.license)}</small></button>`).join(''):'<p>No hay coincidencias. Probá el nombre del proyecto.</p>';}catch(e){if(current===request)results.textContent='No se pudo leer el catálogo. Volvé a buscar para reintentar.';}};
 input.oninput=()=>{clearTimeout(delay);delay=setTimeout(search,250);};input.value=p.name.replace(/\s+CLI$/i,'');
 const save=async(id,b)=>{try{await AxonUI.busy(b,async()=>{const data=await api('/api/software/icons/'+encodeURIComponent(p.id),{method:'PUT',body:{catalogId:id}});p.iconInfo=data.iconInfo;p.iconUrl=data.iconUrl;d.close();render();toast('Icono guardado','success');});}catch(e){errToast(e);}};
 results.onclick=e=>{const b=e.target.closest('[data-catalog]');if(b)save(b.dataset.catalog,b);};
 const reset=document.createElement('button');reset.type='button';reset.className='btn-secondary';reset.textContent='Usar detección automática';reset.onclick=()=>save(null,reset);d.querySelector('.modal-actions').prepend(reset);
 const upload=document.createElement('button');upload.type='button';upload.className='btn-secondary';upload.textContent='Subir SVG o PNG';const file=document.createElement('input');file.type='file';file.accept='.svg,.png';file.hidden=true;upload.onclick=()=>file.click();d.querySelector('.modal-actions').prepend(upload);d.append(file);
 file.onchange=async()=>{const image=file.files[0];if(!image)return;if(image.size>1024*1024){toast('El icono debe pesar menos de 1 MB','info');return;}try{await AxonUI.busy(upload,async()=>{const bytes=new Uint8Array(await image.arrayBuffer());let binary='';bytes.forEach(b=>binary+=String.fromCharCode(b));const data=await api('/api/software/icons/'+encodeURIComponent(p.id)+'/upload',{method:'POST',body:{format:image.name.toLowerCase().endsWith('.svg')?'svg':'png',base64:btoa(binary)}});p.iconInfo=data.iconInfo;p.iconUrl=data.iconUrl;d.close();render();toast('Icono guardado','success');});}catch(e){errToast(e);}};
 d.addEventListener('close',()=>{clearTimeout(delay);request++;});search();input.focus();
}
async function confirmPlan(plan){
 const count=plan.transactions.reduce((n,tx)=>n+tx.items.length,0);
 const d=dialog(`Actualizar ${count===1?'1 programa':count+' programas'}`,plan.transactions.map(tx=>`<section class="software-plan"><h4>${esc(sourceLabel(tx))}</h4>${tx.argv?.length?`<p class="software-cmd"><code>${esc(tx.argv.join(' '))}</code></p>`:''}<ul>${tx.items.map(p=>`<li><strong>${esc(p.name)}</strong> · ${esc(p.version||'?')} → ${esc(p.targetVersion||p.targetRevision||p.targetCommit?.slice(0,12)||'nuevo commit')}</li>`).join('')}</ul><p>${esc(tx.effects)}</p>${tx.simulation.complete?`<details><summary>${tx.simulation.changes.length} cambios en paquetes y dependencias</summary><ul>${tx.simulation.changes.map(c=>`<li>${esc(c.packageName)} → ${esc(c.targetVersion||'?')}</li>`).join('')}</ul></details>`:'<p class="settings-help">El gestor puede modificar dependencias. No ofrece una simulación completa en este adaptador.</p>'}</section>`).join('')+'<p class="settings-help">El plan vence en 10 minutos. Antes de ejecutar se vuelve a comprobar la instalación y el candidato. El resultado se verifica en el registro del gestor.'+(count>3?' La ejecución puede tardar varios minutos; el progreso queda en el trabajo registrado y podés seguir usando AXON.':'')+'</p>');
 const button=document.createElement('button');button.className='btn-primary';button.type='button';button.textContent='Actualizar';d.querySelector('.modal-actions').append(button);
 button.onclick=async()=>{try{await AxonUI.busy(button,async()=>{button.textContent='Iniciando…';const {job}=await api('/api/software/execute',{method:'POST',body:{planId:plan.id}});d.close();openJobModal(job);toast('Actualización iniciada','ok');await load(true);});}catch(e){button.textContent='Actualizar';errToast(e);if(/en curso/i.test(e?.message||''))try{const {jobs}=await api('/api/jobs');const running=(jobs||[]).find(j=>j.status==='running'&&j.steps?.some(s=>s.group?.startsWith('software:')));if(running){d.close();openJobModal(running);}}catch{}}};
 refreshIcons();
}
// Uninstall: the host previews package, orphaned dependencies and leftover
// folders; the user picks which leftovers go to the Trash before confirming.
async function uninstall(id,button){
 try{await AxonUI.busy(button,async()=>{const {preview}=await api('/api/software/'+encodeURIComponent(id)+'/removal-preview',{method:'POST'});removalDialog(preview);});}catch(e){errToast(e);}
}
function removalDialog(v){
 const home=snapshot?.home||'',short=path=>home&&path.startsWith(home+'/')?'~'+path.slice(home.length):path;
 const extra=v.removes.filter(name=>name!==v.packageName&&name.split(':')[0]!==v.packageName.split(':')[0]);
 const leftovers=v.leftovers.length?`<ul class="software-leftovers">${v.leftovers.map((f,i)=>`<li><label><input type="checkbox" data-leftover="${i}"${f.selected?' checked':''}${v.canExecute?'':' disabled'}> <code>${esc(short(f.path))}</code> <span>${esc(f.label)} · ${f.partial?'más de ':''}${bytes(f.size)}</span>${f.note?`<small>${esc(f.note)}</small>`:''}</label></li>`).join('')}</ul><p class="settings-help">Las carpetas marcadas van a la Papelera (Archivos → Papelera), así que se pueden recuperar si te arrepentís.</p>`:'<p class="settings-help">No se encontraron restos en tu carpeta personal.</p>';
 const d=dialog('Desinstalar '+v.name,(v.blockers.length?`<div class="software-warning"><strong>No se puede desinstalar desde AXON</strong><ul>${v.blockers.map(b=>`<li>${esc(b)}</li>`).join('')}</ul></div>`:'')
  +`<h4>Qué se quita</h4><p><strong>${esc(v.name)}</strong> <code>${esc(v.packageName)}</code> · ${esc(originShort(v.manager))}${v.version?' · '+esc(v.version):''}</p>`
  +(extra.length?`<details><summary>Además ${extra.length===1?'1 dependencia que ya nadie usa':extra.length+' dependencias que ya nadie usa'}</summary><ul>${extra.map(n=>`<li><code>${esc(n)}</code></li>`).join('')}</ul></details>`:'')
  +v.notes.map(n=>`<p class="settings-help">${esc(n)}</p>`).join('')
  +`<h4>Restos que deja</h4>${leftovers}`
  +(v.commands.length?`<details><summary>Comandos que se van a ejecutar</summary>${v.commands.map(c=>`<p class="software-cmd"><code>${esc(c.join(' '))}</code></p>`).join('')}</details>`:''));
 if(!v.canExecute)return;
 const button=document.createElement('button');button.type='button';button.className='btn-danger';button.textContent='Desinstalar';d.querySelector('.modal-actions').append(button);
 button.onclick=async()=>{const chosen=[...d.querySelectorAll('[data-leftover]:checked')].map(x=>v.leftovers[Number(x.dataset.leftover)].path);try{await AxonUI.busy(button,async()=>{const {job}=await api('/api/software/remove',{method:'POST',body:{reviewId:v.reviewId,leftovers:chosen}});d.close();openJobModal(job);toast('Desinstalación iniciada','ok');await load(true);});}catch(e){errToast(e);}};
}
function chooseInstallation(name,installations){
 const d=dialog('Elegir instalación de '+name,installations.map(p=>`<p><button type="button" class="btn-secondary" data-choice="${esc(p.id)}"${p.canUpdate===false?' disabled':''}>${esc(sourceLabel(p))} · ${esc(p.version||'Versión no registrada')}${p.canUpdate===false?' · Sin actualización gestionada':''}</button></p>`).join(''));
 d.addEventListener('click',e=>{const b=e.target.closest('[data-choice]');if(b){d.close();review([b.dataset.choice]);}});
}
// `planning` survives render(): the grid re-renders while the inventory polls,
// so the busy state must live in data, not on the clicked button element.
async function review(ids,button){
 const pending=[...new Set(ids)].filter(id=>!planning.has(id));
 if(!pending.length)return;
 pending.forEach(id=>planning.add(id));
 if(snapshot)render();
 try{await AxonUI.busy(button,async()=>{const {plan}=await api('/api/software/plan',{method:'POST',body:{ids:pending}});await confirmPlan(plan);});}
 catch(e){errToast(e);if(/comprobar|cambi/i.test(e?.message||''))load(true);}
 finally{pending.forEach(id=>planning.delete(id));if(snapshot)render();}
}
el('software-query').oninput=e=>{query=e.target.value;page=0;render();sync();};
el('software-manager').onchange=e=>{manager=e.target.value;page=0;render();sync();};
el('software-scope').onchange=e=>{scope=e.target.value;page=0;render();sync();};
// Filtro por estado: el select se agrega desde acá para no depender del markup.
const stateSelect=document.createElement('select');stateSelect.id='software-state';stateSelect.setAttribute('aria-label','Filtrar por estado');
stateSelect.innerHTML='<option value="">Todos los estados</option>'+Object.entries(states).map(([v,l])=>`<option value="${esc(v)}"${v===state?' selected':''}>${esc(l)}</option>`).join('');
el('software-toolbar').append(stateSelect);
stateSelect.onchange=e=>{state=e.target.value;page=0;render();sync();};
el('software-kind').onchange=e=>{kind=e.target.value;kindDefaulted=true;kindAuto=false;page=0;render();sync();};
// "Sólo programas" is Instalados' automatic default; Actualizaciones drops it
// again so the system risk cards stay visible.
let kindAuto=false;
el('software-modes').onclick=e=>{const b=e.target.closest('[data-mode]');if(b){mode=b.dataset.mode;if(mode==='installed'&&!kind&&!kindDefaulted){kind='programs';kindDefaulted=true;kindAuto=true;el('software-kind').value=kind;}if(mode==='updates'&&kindAuto){kind='';kindDefaulted=false;kindAuto=false;el('software-kind').value='';}page=0;render();sync();}};
el('software-prev').onclick=()=>{page--;render();sync();};el('software-next').onclick=()=>{page++;render();sync();};
el('software-select-page').onclick=()=>{const ids=matching().slice(page*size,(page+1)*size).filter(p=>p.canUpdate).map(p=>p.id);const remove=ids.every(id=>selected.has(id));ids.forEach(id=>remove?selected.delete(id):selected.size<200&&selected.add(id));selectionLabel();};
el('programs-grid').onchange=e=>{if(e.target.dataset.select){if(e.target.checked&&selected.size>=200){e.target.checked=false;toast('El plan admite hasta 200 instalaciones','info');return;}e.target.checked?selected.add(e.target.dataset.select):selected.delete(e.target.dataset.select);selectionLabel();}};
el('programs-grid').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.detail)detail(b.dataset.detail);if(b.dataset.update)review([b.dataset.update],b);if(b.dataset.groupUpdate)review(b.dataset.groupUpdate.split(','),b);if(b.dataset.remove)uninstall(b.dataset.remove,b);if(b.dataset.folder){const f=b.dataset.folder;collapsed.has(f)?collapsed.delete(f):collapsed.add(f);saveCollapsed();render();}if(b.hasAttribute('data-indices'))refreshIndices(b);};
el('software-notice').onclick=e=>{if(e.target.closest('[data-retry]'))load(true);};
el('programs-refresh').onclick=e=>AxonUI.busy(e.currentTarget,()=>load(true));
el('update-all-btn').onclick=e=>{const ids=selected.size?[...selected]:snapshot.installations.filter(safeUpdate).map(p=>p.id);if(ids.length>200){mode='updates';render();toast('Seleccioná hasta 200 instalaciones por plan','info');return;}review(ids,e.currentTarget);};
// El diálogo genérico de index.html fija variant="danger"; acá se ajusta por
// acción y se restaura, sin tocar el archivo compartido.
async function confirmVariant(title,body,okLabel,variant='brand'){
 const ok=document.querySelector('#confirm-ok'),prev=ok?.getAttribute('variant');
 if(ok)ok.setAttribute('variant',variant);
 try{return await confirmDialog(title,body,okLabel);}
 finally{if(ok){if(prev==null)ok.removeAttribute('variant');else ok.setAttribute('variant',prev);}}
}
async function refreshIndices(button){if(!await confirmVariant('Actualizar índices APT','Se consultan los repositorios del sistema. No se instalan ni actualizan paquetes.','Consultar','brand'))return;try{await AxonUI.busy(button,async()=>{const {job}=await api('/api/software/refresh-indices',{method:'POST'});openJobModal(job);});}catch(e){errToast(e);}}
// Reload re-validates the selection against canUpdate, so only ids the job
// actually touched drop out. Sólo los jobs de software recargan: un backup o
// una transferencia ya no pisan la selección en curso.
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&activeTabName==='programs'&&signedIn)load();});
document.addEventListener('axon:tab',e=>{if(e.detail!=='programs')clearTimeout(timer);});
document.addEventListener('axon:job-complete',e=>{const job=e.detail;if(activeTabName==='programs'&&job?.steps?.some(s=>s.group?.startsWith('software:')))load(true);});
window.AxonPages ||= {};window.AxonPages.programs={params,capture:params,restore:async p=>{mode=['installed','sources'].includes(p.view)?p.view:'updates';query=p.q||'';manager=p.manager||'';scope=['system','user'].includes(p.scope)?p.scope:'';state=states[p.state]?p.state:'';kind=['programs','system'].includes(p.kind)?p.kind:'';kindDefaulted=!!p.kind;page=Math.max(0,(Number(p.page)||1)-1);el('software-query').value=query;el('software-scope').value=scope;el('software-kind').value=kind;stateSelect.value=state;await load();render();}};
window.AxonSoftware={load,review,uninstall,confirmPlan,chooseInstallation,installed:()=>{mode='installed';if(!kind&&!kindDefaulted){kind='programs';kindDefaulted=true;kindAuto=true;el('software-kind').value=kind;}page=0;render();sync();},snapshot:()=>snapshot};
})();
