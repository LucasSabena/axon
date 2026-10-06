/* Native software inventory. Catalog recommendations never define inventory. */
(() => {
'use strict';
let snapshot=null, flight=null, timer=null, mode='updates', query='', manager='', scope='', page=0;
const selected=new Set(), size=75;
const el=id=>document.getElementById(id);
const states={unchecked:'Pendiente',available:'Actualización disponible',current:'Sin actualizaciones detectadas',held:'Retenido',unsupported:'Sólo lectura',unmanaged:'Origen no comprobado',error:'No se pudo comprobar'};
const params=()=>({view:mode==='updates'?'':mode,q:query,manager,scope,page:page?String(page+1):''});
const sync=()=>window.AxonNavigation?.update('programs',params());
const sourceLabel=p=>p.manager+' · '+(p.scope==='system'?'Sistema':p.user);
function selectionLabel(){
 el('update-all-btn').textContent=selected.size?`Revisar ${selected.size} seleccionadas`:'Revisar actualizaciones';
 el('programs-grid').querySelectorAll('[data-select]').forEach(input=>input.checked=selected.has(input.dataset.select));
}
function matching(){
 const q=query.toLocaleLowerCase('es');
 return (snapshot?.installations||[]).filter(p=>(mode!=='updates'||p.canUpdate)&&(!manager||p.manager===manager)&&(!scope||p.scope===scope)&&(!q||[p.name,p.packageName,p.user,p.root,p.description].join(' ').toLocaleLowerCase('es').includes(q))).sort((a,b)=>Number(b.canUpdate)-Number(a.canUpdate)||a.name.localeCompare(b.name,'es'));
}
function render(){
 if(!snapshot)return;
 const pending=snapshot.installations.filter(p=>p.canUpdate), rows=matching(), pages=Math.max(1,Math.ceil(rows.length/size));page=Math.min(page,pages-1);
 const count=el('nav-count-programs');if(count){count.textContent=pending.length||'';count.classList.toggle('nav-alert',pending.length>0);}
 el('programs-updated').textContent=snapshot.checking?'Comprobando fuentes…':'Leído '+new Date(snapshot.checkedAt).toLocaleTimeString();
 el('software-summary').textContent=`${snapshot.installations.length} instalaciones · ${pending.length} actualizaciones · ${snapshot.sources.filter(s=>s.available&&s.manager!=='metadata').length} fuentes detectadas`;
 el('update-all-btn').disabled=!!snapshot.checking||!pending.length;
 el('update-all-btn').textContent=selected.size?`Revisar ${selected.size} seleccionadas`:'Revisar actualizaciones';
 el('software-modes').querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
 el('software-manager').innerHTML='<option value="">Todos los gestores</option>'+[...new Set(snapshot.installations.map(p=>p.manager))].sort().map(m=>`<option value="${esc(m)}"${m===manager?' selected':''}>${esc(m)}</option>`).join('');
 const errors=snapshot.sources.filter(s=>s.error);
 el('software-notice').innerHTML=(snapshot.error?`<p class="software-warning">${esc(snapshot.error)}. Se conserva la última lectura. <button class="btn-secondary" data-retry>Reintentar</button></p>`:'')+(errors.length?`<details class="software-warning"><summary>${errors.length} fuentes necesitan revisión</summary>${errors.map(s=>`<p><strong>${esc(sourceLabel(s))}</strong>: ${esc(s.error)}</p>`).join('')}</details>`:'');
 el('software-toolbar').classList.toggle('hidden',mode==='sources');
 el('programs-grid').className='software-list';
 if(mode==='sources'){
  el('programs-grid').innerHTML=snapshot.sources.filter(s=>s.manager!=='metadata').map(s=>`<article class="software-source"><div><strong>${esc(sourceLabel(s))}</strong><p>${s.available?s.complete?'Inventario leído':'Inventario incompleto':'No disponible en este host'}</p><small>${esc(s.root||'')}</small></div><div><span>${esc(s.available?(s.updateState==='ok'?'Comprobado':states[s.updateState]||'Sólo lectura'):'No instalado')}</span>${s.metadataAt?`<p>Índices: ${esc(new Date(s.metadataAt).toLocaleString())}</p>`:''}${s.note?`<p>${esc(s.note)}</p>`:''}${s.manager==='apt'&&s.available&&snapshot.canAdministerSystem?'<button class="btn-secondary" data-indices>Actualizar índices</button>':''}</div></article>`).join('');
 }else{
  const visible=rows.slice(page*size,(page+1)*size);
  el('programs-grid').innerHTML=visible.length?`<div class="software-columns" aria-hidden="true"><span>Programa / paquete</span><span>Instalación</span><span>Versión</span><span>Estado</span></div>`+visible.map(p=>`<article class="software-row"><div class="software-name"><input type="checkbox" data-select="${esc(p.id)}" aria-label="Seleccionar ${esc(p.name)} · ${esc(sourceLabel(p))}"${selected.has(p.id)?' checked':''}${!p.canUpdate?' disabled':''}><img src="${esc(p.iconUrl)}" alt="" width="32" height="32" loading="lazy"><div><button type="button" class="software-detail" data-detail="${esc(p.id)}">${esc(p.name)}</button><small>${esc(p.packageName)}</small></div></div><span class="software-origin">${esc(sourceLabel(p))}</span><span class="software-version">${esc(p.version||'Versión no registrada')}${p.canUpdate?`<small>→ ${esc(p.targetVersion||p.targetRevision||p.targetCommit?.slice(0,12)||'nuevo commit')}</small>`:''}</span><div class="software-status">${p.canUpdate?`<button type="button" class="btn-secondary" data-update="${esc(p.id)}"${snapshot.checking?' disabled':''}>${icon('arrow-up-circle')} Revisar</button>`:`<span>${esc(states[p.updateState]||'No comprobado')}</span>`}</div></article>`).join(''):`<div class="empty-state">${mode==='updates'?(snapshot.checking?'Buscando actualizaciones…':'No hay actualizaciones gestionadas disponibles. Consultá Instalados y Fuentes para ver la cobertura.'):'No hay instalaciones que coincidan con los filtros.'}</div>`;
 }
 el('software-pagination').classList.toggle('hidden',mode==='sources');
 el('software-page').textContent=`${rows.length} resultados · página ${page+1} de ${pages}`;
 el('software-prev').disabled=page===0;el('software-next').disabled=page>=pages-1;
 el('software-select-page').disabled=!rows.slice(page*size,(page+1)*size).some(p=>p.canUpdate);
 refreshIcons();
}
async function load(fresh=false){
 if(flight)return flight;
 flight=(async()=>{try{
  snapshot=await api('/api/software'+(fresh?'?fresh=1':''));
  for(const id of selected)if(!snapshot.installations.some(p=>p.id===id&&p.canUpdate))selected.delete(id);
  render();clearTimeout(timer);if(snapshot.checking&&!document.hidden&&activeTabName==='programs')timer=setTimeout(()=>load(),4000);
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
 const d=dialog(p.name,`<dl class="software-facts"><dt>Paquete</dt><dd>${esc(p.packageName)}</dd><dt>Gestor</dt><dd>${esc(p.manager)}</dd><dt>Ámbito</dt><dd>${esc(p.scope==='system'?'Sistema':p.user+' (UID '+p.uid+')')}</dd><dt>Ubicación</dt><dd>${esc(p.root)}</dd><dt>Versión registrada</dt><dd>${esc(p.version||'No registrada')}</dd><dt>Estado</dt><dd>${esc(states[p.updateState]||p.updateState)}</dd>${p.origin?`<dt>Origen</dt><dd>${esc(p.origin)}</dd>`:''}${info?`<dt>Icono</dt><dd>${esc(info.label)}${info.attribution?`<small class="settings-help">${esc(info.attribution)} · ${esc(info.license||'')}</small>`:''}</dd>`:p.iconSource?`<dt>Icono</dt><dd>${esc(p.iconSource)}</dd>`:''}</dl>${info?.sourceUrl?`<p><a href="${esc(info.sourceUrl)}" target="_blank" rel="noopener noreferrer">Ver fuente del icono</a>${info.licenseUrl?` · <a href="${esc(info.licenseUrl)}" target="_blank" rel="noopener noreferrer">Licencia</a>`:''}</p>`:''}<p>${esc(p.description||'')}</p><p class="settings-help">${esc(p.reason||'La actualización se revisa con el gestor de esta instalación.')}</p>${p.integrationId?`<p><a href="/agentes?id=${p.integrationId==='claude-code'?'claude':encodeURIComponent(p.integrationId)}">Ver integración y cuentas</a></p>`:''}`);
 const b=document.createElement('button');b.type='button';b.className='btn-secondary';b.textContent='Elegir icono';d.querySelector('.modal-actions').prepend(b);b.onclick=()=>{d.close();iconPicker(p);};
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
 const d=dialog(`Revisar ${count} actualizaciones`,plan.transactions.map(tx=>`<section class="software-plan"><h4>${esc(sourceLabel(tx))}</h4><ul>${tx.items.map(p=>`<li><strong>${esc(p.name)}</strong> · ${esc(p.version||'?')} → ${esc(p.targetVersion||p.targetRevision||p.targetCommit?.slice(0,12)||'nuevo commit')}</li>`).join('')}</ul><p>${esc(tx.effects)}</p>${tx.simulation.complete?`<details><summary>${tx.simulation.changes.length} cambios en paquetes y dependencias</summary><ul>${tx.simulation.changes.map(c=>`<li>${esc(c.packageName)} → ${esc(c.targetVersion||'?')}</li>`).join('')}</ul></details>`:'<p class="settings-help">El gestor puede modificar dependencias. No ofrece una simulación completa en este adaptador.</p>'}</section>`).join('')+'<p class="settings-help">El plan vence en 10 minutos. Antes de ejecutar se vuelve a comprobar la instalación y el candidato. El resultado se verifica en el registro del gestor.</p>');
 const button=document.createElement('button');button.className='btn-primary';button.type='button';button.textContent='Actualizar';d.querySelector('.modal-actions').append(button);
 button.onclick=async()=>{try{await AxonUI.busy(button,async()=>{const {job}=await api('/api/software/execute',{method:'POST',body:{planId:plan.id}});d.close();openJobModal(job);await load(true);});}catch(e){errToast(e);}};
 refreshIcons();
}
function chooseInstallation(name,installations){
 const d=dialog('Elegir instalación de '+name,installations.map(p=>`<p><button type="button" class="btn-secondary" data-choice="${esc(p.id)}"${p.canUpdate===false?' disabled':''}>${esc(sourceLabel(p))} · ${esc(p.version||'Versión no registrada')}${p.canUpdate===false?' · Sin actualización gestionada':''}</button></p>`).join(''));
 d.addEventListener('click',e=>{const b=e.target.closest('[data-choice]');if(b){d.close();review([b.dataset.choice]);}});
}
async function review(ids,button){
 try{await AxonUI.busy(button,async()=>{const {plan}=await api('/api/software/plan',{method:'POST',body:{ids}});await confirmPlan(plan);});}catch(e){errToast(e);}
}
el('software-query').oninput=e=>{query=e.target.value;page=0;render();sync();};
el('software-manager').onchange=e=>{manager=e.target.value;page=0;render();sync();};
el('software-scope').onchange=e=>{scope=e.target.value;page=0;render();sync();};
el('software-modes').onclick=e=>{const b=e.target.closest('[data-mode]');if(b){mode=b.dataset.mode;page=0;render();sync();}};
el('software-prev').onclick=()=>{page--;render();sync();};el('software-next').onclick=()=>{page++;render();sync();};
el('software-select-page').onclick=()=>{const ids=matching().slice(page*size,(page+1)*size).filter(p=>p.canUpdate).map(p=>p.id);const remove=ids.every(id=>selected.has(id));ids.forEach(id=>remove?selected.delete(id):selected.size<200&&selected.add(id));selectionLabel();};
el('programs-grid').onchange=e=>{if(e.target.dataset.select){if(e.target.checked&&selected.size>=200){e.target.checked=false;toast('El plan admite hasta 200 instalaciones','info');return;}e.target.checked?selected.add(e.target.dataset.select):selected.delete(e.target.dataset.select);selectionLabel();}};
el('programs-grid').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.detail)detail(b.dataset.detail);if(b.dataset.update)review([b.dataset.update],b);if(b.hasAttribute('data-indices'))refreshIndices(b);};
el('software-notice').onclick=e=>{if(e.target.closest('[data-retry]'))load(true);};
el('programs-refresh').onclick=e=>AxonUI.busy(e.currentTarget,()=>load(true));
el('update-all-btn').onclick=e=>{const ids=selected.size?[...selected]:snapshot.installations.filter(p=>p.canUpdate).map(p=>p.id);if(ids.length>200){mode='updates';render();toast('Seleccioná hasta 200 instalaciones para revisar el plan','info');return;}review(ids,e.currentTarget);};
async function refreshIndices(button){if(!await confirmDialog('Actualizar índices APT','Se consultan los repositorios del sistema. No se instalan ni actualizan paquetes.','Consultar'))return;try{await AxonUI.busy(button,async()=>{const {job}=await api('/api/software/refresh-indices',{method:'POST'});openJobModal(job);});}catch(e){errToast(e);}}
document.addEventListener('axon:job-complete',()=>{selected.clear();if(activeTabName==='programs')load(true);});
window.AxonPages ||= {};window.AxonPages.programs={params,capture:params,restore:async p=>{mode=['installed','sources'].includes(p.view)?p.view:'updates';query=p.q||'';manager=p.manager||'';scope=['system','user'].includes(p.scope)?p.scope:'';page=Math.max(0,(Number(p.page)||1)-1);el('software-query').value=query;el('software-scope').value=scope;await load();render();}};
window.AxonSoftware={load,review,confirmPlan,chooseInstallation,installed:()=>{mode='installed';page=0;render();sync();},snapshot:()=>snapshot};
})();
