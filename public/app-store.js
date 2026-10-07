/* System application store: all operations use the existing host job UI. */
(() => {
'use strict';
const style=document.createElement('link');style.rel='stylesheet';style.href='/app-store.css';document.head.append(style);
let data=null, flight=null, remoteApps=[], query='', category='Todas', installedOnly=false, signedIn=false, searchSeq=0;
const EXTRAS_LIMIT=48;
// El diálogo genérico de index.html fija variant="danger"; acá se ajusta por
// acción y se restaura, sin tocar el archivo compartido.
async function confirmVariant(title,body,okLabel,variant='brand'){
 const ok=document.querySelector('#confirm-ok'),prev=ok?.getAttribute('variant');
 if(ok)ok.setAttribute('variant',variant);
 try{return await confirmDialog(title,body,okLabel);}
 finally{if(ok){if(prev==null)ok.removeAttribute('variant');else ok.setAttribute('variant',prev);}}
}
document.addEventListener('axon:authenticated',()=>{signedIn=true;});
document.addEventListener('axon:session-expired',()=>{signedIn=false;});
const nav=document.createElement('button');nav.className='nav-item tab-btn';nav.dataset.tab='store';nav.innerHTML=`${icon('store')}<span class="nav-label">Tienda</span>`;
document.querySelector('.sidebar-nav').insertBefore(nav,document.querySelector('#sidebar-settings'));
nav.addEventListener('click',()=>{activateAxonSection('store',false);if(!window.AxonNavigation)load();});
const section=document.createElement('section');section.id='tab-store';section.className='tab-content';section.innerHTML=`<div class="section-header"><h2>Tienda de aplicaciones</h2><button type="button" class="btn-secondary" id="store-refresh">${icon('refresh-cw')} Actualizar</button></div><p class="listener-note">Aplicaciones para el servidor: edición, diseño, juegos, desarrollo y productividad. El inventario incluye instalaciones de sistema y de usuario. Las nuevas instalaciones de esta tienda usan el ámbito de sistema.</p><div class="store-installer"><button type="button" class="store-dropzone" id="store-dropzone">${icon('package-plus')}<span><strong>Instalá un programa desde su instalador</strong><small>Arrastrá el archivo acá o hacé click para elegirlo — .deb, .AppImage, .flatpak, .run, .sh, .rpm, .snap, .zip, .tar.gz…</small></span></button><div class="store-upload hidden" id="store-upload"><div class="store-upload-bar" id="store-upload-bar" role="progressbar" aria-label="Progreso de la subida" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="store-upload-fill"></i></div><span id="store-upload-label"></span><button type="button" class="icon-btn" id="store-upload-cancel" aria-label="Cancelar subida">${icon('x')}</button></div><div class="store-pathrow"><input type="text" id="store-path" placeholder="…o la ruta de un instalador ya en el servidor (ej. ~/Descargas/programa.deb)" aria-label="Ruta del instalador en el servidor"><button type="button" class="btn-secondary" id="store-path-btn">Inspeccionar</button></div></div><input type="file" id="store-file" class="hidden" accept=".deb,.flatpak,.flatpakref,.appimage,.AppImage,.run,.sh,.bin,.rpm,.snap,.zip,.tar,.tgz,.txz,.tbz2,.tar.gz,.tar.xz,.tar.bz2,.tar.zst"><div class="store-toolbar"><label class="store-search">${icon('search')}<input type="search" id="store-query" placeholder="Buscar aplicaciones…" aria-label="Buscar aplicaciones"></label><button type="button" class="btn-secondary" id="store-search-flathub">Buscar en Flathub</button><label><input type="checkbox" id="store-installed"> Sólo instaladas</label><a class="btn-secondary" href="https://flathub.org/en/apps" target="_blank" rel="noopener noreferrer">Explorar Flathub ${icon('external-link')}</a></div><div id="store-categories" class="store-categories" role="group" aria-label="Categorías"></div><div id="store-state" role="status"></div><div id="store-grid" class="store-grid"><p>Cargando aplicaciones…</p></div>`;
document.querySelector('main.content').append(section);
async function load(force=false){if(flight)return flight;flight=(async()=>{try{data=await api('/api/store'+(force?'?refresh=1':''));render();}catch(e){document.querySelector('#store-state').innerHTML='<p>No se pudo cargar la tienda. Tocá Actualizar para reintentar.</p>';errToast(e);}})().finally(()=>flight=null);return flight;}
function render(){
 if(!data)return;
 const canAdmin=data.canAdministerSystem!==false;
 const dropzone=document.querySelector('#store-dropzone');
 dropzone.disabled=!canAdmin;dropzone.classList.toggle('disabled',!canAdmin);
 document.querySelector('#store-path').disabled=document.querySelector('#store-path-btn').disabled=!canAdmin;
 const extrasAll=(data.installedApplications||[]).filter(p=>!data.apps.some(a=>a.installations?.some(i=>i.id===p.id)));
 const extras=extrasAll.slice(0,EXTRAS_LIMIT).map(p=>({id:p.id,name:p.name,description:p.description||p.packageName,category:'Otras instaladas',backend:'inventory',package:p.packageName,installed:true,version:p.version,iconUrl:p.iconUrl,installation:p}));
 // Resultados remotos re-etiquetados con el inventario actual y sin duplicados.
 const remote=remoteApps.filter(a=>!data.apps.some(b=>b.package===a.package)).map(a=>({...a,installed:!!data.installedFlatpak[a.package],version:data.installedFlatpak[a.package]||a.version}));
 const appsAll=[...data.apps,...remote,...extras];
 const categories=['Todas',...new Set(appsAll.map(a=>a.category))];
 document.querySelector('#store-categories').innerHTML=categories.map(c=>{const n=c==='Todas'?appsAll.length:appsAll.filter(a=>a.category===c).length;return `<button type="button" class="chip${category===c?' active':''}" data-category="${esc(c)}" aria-pressed="${category===c}">${esc(c)} <small>${n}</small></button>`;}).join('');
 document.querySelector('#store-state').innerHTML=(!canAdmin?'<p>La instalación de sistema requiere permisos de administración del host. Las instalaciones existentes siguen visibles y el área de instaladores queda deshabilitada.</p>':'')+(data.error?`<p>${esc(data.error)}. Se conserva la última lectura.</p>`:'')+data.jobs.map(j=>`<p>${icon('loader','spin')} ${esc(j.title)} <button type="button" class="btn-secondary" data-job="${esc(j.id)}">Ver progreso</button></p>`).join('')+(data.staging?.count?`<p class="store-staged">${icon('package')} ${data.staging.count} instalador(es) en espera · ${fmtBytes(data.staging.bytes)}. Se limpian solos (área segura: 1 día; subidos: 7 días). <button type="button" class="btn-secondary" id="store-prune"${!canAdmin?' disabled':''}>Limpiar ahora</button></p>`:'')+(!data.flatpak?'<p class="store-setup">Flathub se prepara al instalar tu primera aplicación. <button type="button" class="btn-secondary" id="store-setup">Preparar ahora</button></p>':'');
 const q=query.trim().toLocaleLowerCase('es');
 const apps=appsAll.filter(a=>(category==='Todas'||a.category===category)&&(!installedOnly||a.installed||a.detected)&&(!q||`${a.name} ${a.description} ${a.category}`.toLocaleLowerCase('es').includes(q)));
 const meta=a=>{
  const canUp=a.installations?.some(i=>i.canUpdate)||a.installation?.canUpdate;
  const badge=canUp?'<span class="store-badge">Actualización disponible</span>':'';
  const small=a.installed?'Instalada'+(a.version?' · '+esc(a.version):''):a.detected?'Detectada en el host':a.backend==='external'?'Instalador del fabricante':a.backend==='flatpak'?'Flathub'+(a.flathubVersion?' · '+esc(a.flathubVersion):'')+' · paquete de la comunidad':'Paquete del sistema';
  return `<span>${esc(a.category)}</span><small>${small}</small>${badge}`;
 };
 const actions=a=>{
  if(a.backend==='inventory')return `<a class="btn-secondary" href="/programas?view=installed&q=${encodeURIComponent(a.installation?.packageName||a.package)}">Ver instalación ${icon('package')}</a>`;
  if(a.backend==='external')return `<a class="btn-secondary" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Descarga oficial ${icon('external-link')}</a>`;
  return `<button type="button" class="${a.installed?'btn-secondary':'btn-primary'}" data-store-action="${a.installed?'update':'install'}" data-id="${esc(a.id)}"${data.jobs.length||!a.installed&&!canAdmin?' disabled':''}>${icon(a.installed?'refresh-cw':'download')} ${a.installed?'Revisar actualización':'Instalar'}</button>${a.installed?`<button type="button" class="icon-btn" data-store-action="remove" data-id="${esc(a.id)}" aria-label="Desinstalar ${esc(a.name)}"${data.jobs.length||!canAdmin?' disabled':''}>${icon('trash-2')}</button>`:''}`;
 };
 document.querySelector('#store-grid').innerHTML=(apps.map(a=>`<article class="store-card"><button type="button" class="store-detail" data-detail="${esc(a.id)}"><span class="store-app-icon" aria-hidden="true"><img src="${esc(a.iconUrl||'/api/store/icons/'+encodeURIComponent(a.id))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></span><h3>${esc(a.name)}</h3><p>${esc(a.description)}</p></button><div class="store-card-meta">${meta(a)}</div><div class="store-card-actions">${actions(a)}</div></article>`).join('')||'<div class="store-empty"><p>No hay aplicaciones que coincidan.</p></div>')+(extrasAll.length>EXTRAS_LIMIT?`<div class="store-empty"><p>Se muestran ${EXTRAS_LIMIT} de ${extrasAll.length} aplicaciones “Otras instaladas”. El listado completo está en <a href="/programas?view=installed">Programas</a>.</p></div>`:'');
 refreshIcons();
}
async function openStoreJob(id){const {job}=await api('/api/jobs/'+encodeURIComponent(id));openJobModal(job);}
async function action(id,action,button){
 const app=[...data.apps,...remoteApps].find(a=>a.id===id);if(!app)return;
 if(action==='update'){if(app.installations?.length>1){window.AxonSoftware.chooseInstallation(app.name,app.installations);return;}try{await AxonUI.busy(button,async()=>{const r=await api(`/api/store/${encodeURIComponent(id)}/update`,{method:'POST',body:{review:true}});await window.AxonSoftware.confirmPlan(r.plan);});}catch(e){errToast(e);}return;}
 const descriptions={install:`${app.name} se descargará en el servidor, con sus dependencias.${app.backend==='flatpak'?' Se preparará Flatpak y Flathub si hace falta. Puede ocupar varios GB.':''}`,remove:`Se desinstala ${app.name}. Se conservan sus datos personales.`};
 const run=async()=>{
  if(!await confirmVariant(`${action==='install'?'Instalar':'Desinstalar'} ${app.name}`,descriptions[action],action==='install'?'Instalar':'Desinstalar',action==='install'?'brand':'danger'))return;
  try{await AxonUI.busy(button,async()=>{const r=await api(`/api/store/${encodeURIComponent(id)}/${action}`,{method:'POST'});await openStoreJob(r.jobId);await load(true);});}catch(e){errToast(e);}
 };
 if(action==='remove'){
  try{await AxonUI.busy(button,async()=>{const {preview:p}=await api('/api/store/'+encodeURIComponent(id)+'/removal-preview');const modal=document.createElement('div');modal.className='modal';modal.innerHTML=`<div class="modal-content"><h3>Revisar desinstalación: ${esc(p.name)}</h3><p>${esc(p.backend)} · ${esc(p.scope)} · <code>${esc(p.package)}</code> · ${esc(p.version||'versión no resuelta')}</p><h4>Dependencias según simulación</h4><p>${p.dependencies.complete?'Se retirarían: '+esc(p.dependencies.removed.join(', ')||'ningún paquete'):'Alcance de dependencias no comprobado para este gestor'}</p><h4>Datos conservados</h4><ul>${p.retained.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${p.blockers.length?`<h4>No se puede desinstalar todavía</h4><ul>${p.blockers.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}<p>${p.canExecute?'La operación corre como trabajo con comprobación posterior.':'No se cambió la instalación.'}</p><div class="modal-actions"><button type="button" class="btn-secondary" data-close>Cerrar</button><button type="button" class="btn-danger" data-uninstall${p.canExecute?'':' disabled'}>Desinstalar</button></div></div>`;modal.querySelector('[data-close]').onclick=()=>modal.remove();modal.querySelector('[data-uninstall]').onclick=()=>{modal.remove();run();};document.body.append(modal);refreshIcons();});}catch(e){errToast(e);}return;
 }
 await run();
}
function detail(id){const app=[...data.apps,...remoteApps].find(a=>a.id===id);if(!app){if(id.startsWith('pkg-')){const row=data.installedApplications?.find(p=>p.id===id),url='/programas?view=installed&q='+encodeURIComponent(row?.packageName||'');if(window.AxonNavigation)window.AxonNavigation.go(url);else location.assign(url);}return;}const canUp=app.installations?.some(i=>i.canUpdate)||app.installation?.canUpdate;const modal=document.createElement('div');modal.className='modal';modal.innerHTML=`<div class="modal-content"><h3>${esc(app.name)}</h3><p>${esc(app.description)}</p>${canUp?'<p><span class="store-badge">Actualización disponible</span></p>':''}<dl class="store-facts"><dt>Destino</dt><dd>${app.installations?.length?app.installations.map(p=>esc(p.manager+' · '+(p.scope==='system'?'Sistema':p.user)+' · '+(p.version||'versión no registrada')+(i=>i.canUpdate?' · actualización disponible':'')(p))).join('<br>'):'Servidor · sistema'}</dd><dt>Fuente</dt><dd>${app.backend==='flatpak'?'Flathub · distribución de la comunidad':app.backend==='apt'?'Repositorios del sistema':'Blackmagic Design'}</dd>${app.flathubVersion?`<dt>Versión en Flathub</dt><dd>${esc(app.flathubVersion)}</dd>`:''}${app.package?`<dt>Paquete</dt><dd><code>${esc(app.package)}</code></dd>`:''}${app.version?`<dt>Versión instalada</dt><dd>${esc(app.version)}</dd>`:''}</dl><p class="settings-help">Las aplicaciones gráficas se abren en el escritorio del servidor. DaVinci requiere su instalador oficial y un entorno con GPU compatible.</p><div class="modal-actions"><a class="btn-secondary" href="${esc(app.url)}" target="_blank" rel="noopener noreferrer">Sitio oficial</a><button type="button" class="btn-secondary" data-close>Cerrar</button></div></div>`;modal.querySelector('[data-close]').onclick=()=>modal.remove();document.body.append(modal);refreshIcons();}
section.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.category){category=b.dataset.category;render();sync();}if(b.dataset.detail)detail(b.dataset.detail);if(b.dataset.storeAction)await action(b.dataset.id,b.dataset.storeAction,b);if(b.dataset.job){try{await openStoreJob(b.dataset.job);}catch(err){errToast(err);}}if(b.id==='store-prune'){if(!await confirmVariant('Limpiar instaladores en espera','Se borran los instaladores temporales que quedaron en el área de espera. Los trabajos en curso no se tocan.','Limpiar','warning'))return;try{await AxonUI.busy(b,async()=>{await api('/api/store/installers/prune',{method:'POST'});await load(true);toast('Instaladores limpiados','success');});}catch(err){errToast(err);}}if(b.id==='store-setup'){if(!await confirmVariant('Preparar Flathub','Se instala Flatpak y se agrega Flathub para todos los usuarios del servidor.','Preparar','brand'))return;try{await AxonUI.busy(b,async()=>{const r=await api('/api/store/setup',{method:'POST'});await openStoreJob(r.jobId);await load(true);});}catch(err){errToast(err);}}});
async function searchFlathub(){
 const seq=++searchSeq;
 try{await AxonUI.busy(document.querySelector('#store-search-flathub'),async()=>{
  const r=await api('/api/store/search?q='+encodeURIComponent(query));
  if(seq!==searchSeq)return;
  if(!r.ok)throw new Error(r.error);
  const seen=new Set();remoteApps=(r.apps||[]).filter(a=>a&&a.id&&!seen.has(a.id)&&seen.add(a.id));
  category='Todas';render();sync();
  if(!remoteApps.length)toast('No se encontraron aplicaciones en Flathub','info');
 });}catch(err){errToast(err);}
}
document.querySelector('#store-search-flathub').onclick=()=>searchFlathub();
document.querySelector('#store-query').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchFlathub();}});
document.querySelector('#store-refresh').onclick=e=>AxonUI.busy(e.currentTarget,()=>load(true));
document.querySelector('#store-query').oninput=e=>{query=e.target.value;render();sync();};document.querySelector('#store-installed').onchange=e=>{installedOnly=e.target.checked;render();sync();};
// ---------- Instalar desde archivo (instalador subido o ya en el servidor) ----------
const STAGE_DIR='~/.local/share/axon/instaladores';
const FOREIGN=/\.(exe|msi|msix|appx|dmg|pkg|apk|ipa)$/i;
let upCtl=null,lastInstall=null;
const fmtBytes=n=>{const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return(i?n.toFixed(1):n)+' '+u[i];};
const setUpload=(frac,label)=>{const w=document.querySelector('#store-upload');w.classList.remove('hidden');document.querySelector('#store-upload-fill').style.width=Math.round(frac*100)+'%';document.querySelector('#store-upload-bar').setAttribute('aria-valuenow',String(Math.round(frac*100)));document.querySelector('#store-upload-label').textContent=label;};
const hideUpload=()=>document.querySelector('#store-upload').classList.add('hidden');
async function uploadChunks(file){
 const init=await api('/api/files/upload/init',{method:'POST',body:{path:STAGE_DIR,name:file.name,size:file.size}});
 const id=init.id;let offset=0,donePath=null;upCtl=new AbortController();
 try{
  while(offset<file.size){
   upCtl.signal.throwIfAborted();
   const end=Math.min(file.size,offset+init.chunkSize);let next;
   for(let a=0;;a++){
    try{
     const r=await fetch(`/api/files/upload/${id}?offset=${offset}`,{method:'PUT',body:file.slice(offset,end),credentials:'same-origin',signal:upCtl.signal});
     const d=await r.json().catch(()=>({}));
     if(!r.ok||d.ok!==true){const e=new Error(d.error||`HTTP ${r.status}`);e.status=r.status;e.received=d.received;throw e;}
     next=d.received;break;
    }catch(e){upCtl.signal.throwIfAborted();if(e.status===409&&e.received===end){next=end;break;}if(a>=3||(e.status&&e.status<500&&e.status!==409))throw e;await new Promise(r=>setTimeout(r,500*(a+1)));}
   }
   if(next!==end)throw new Error('El servidor confirmó un tamaño de bloque inválido');
   offset=next;setUpload(offset/file.size,`Subiendo ${file.name} · ${Math.round(offset/file.size*100)}%`);
  }
  upCtl.signal.throwIfAborted();
  donePath=(await api(`/api/files/upload/${id}/finish`,{method:'POST'})).path;
  return donePath;
 }finally{
  if(!donePath)await api(`/api/files/upload/${id}`,{method:'DELETE'}).catch(()=>{});
  upCtl=null;hideUpload();
 }
}
async function inspectAndInstall(hostPath){
 const {plan}=await api('/api/store/installer/inspect',{method:'POST',body:{path:hostPath}});
 const body=`Detectado: ${plan.kindLabel} · ${fmtBytes(plan.size)}\n\nPasos: ${plan.steps.join(' → ')}`+(plan.warning?`\n\n${plan.warning}`:'');
 if(!await confirmVariant(`Instalar ${plan.name}`,body,'Instalar','brand'))return;
 const r=await api('/api/store/installer/install',{method:'POST',body:{path:plan.path}});
 lastInstall={path:plan.path,jobId:r.jobId,kind:r.kind,force:r.force};
 const {job}=await api('/api/jobs/'+encodeURIComponent(r.jobId));openJobModal(job);load(true);
}
function offerForce(){
 const m=document.createElement('div');m.className='modal';
 m.innerHTML=`<div class="modal-content"><h3>El instalador se interrumpió</h3><p>Quizá estaba esperando una confirmación (licencia, opciones, ruta). Revisá el log del trabajo para ver qué pidió.</p><p>Podés reintentar respondiendo <strong>sí</strong> a todas las preguntas automáticamente.</p><div class="modal-actions"><button type="button" class="btn-secondary" data-close>Cerrar</button><button type="button" class="btn-primary" data-force>Reintentar respondiendo sí</button></div></div>`;
 m.querySelector('[data-close]').onclick=()=>m.remove();
 m.querySelector('[data-force]').onclick=async ev=>{try{await AxonUI.busy(ev.currentTarget,async()=>{const r=await api('/api/store/installer/install',{method:'POST',body:{path:lastInstall.path,force:true}});lastInstall={...lastInstall,jobId:r.jobId,force:true};m.remove();const {job}=await api('/api/jobs/'+encodeURIComponent(r.jobId));openJobModal(job);});}catch(e){errToast(e);}};
 document.body.append(m);refreshIcons();
}
document.addEventListener('axon:job-complete',e=>{
 const job=e.detail;
 if(section.classList.contains('active')&&job?.steps?.some(s=>s.group?.startsWith('software:')))load(true);
 if(lastInstall&&job.id===lastInstall.jobId){load(true);if(job.status==='failed'&&lastInstall.kind==='run'&&!lastInstall.force)offerForce();}
});
const dropzone=document.querySelector('#store-dropzone'),fileInput=document.querySelector('#store-file');
dropzone.addEventListener('click',()=>{if(!upCtl)fileInput.click();});
dropzone.addEventListener('dragover',e=>{if(dropzone.disabled)return;e.preventDefault();dropzone.classList.add('drag');});
dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('drag'));
dropzone.addEventListener('drop',e=>{e.preventDefault();dropzone.classList.remove('drag');if(dropzone.disabled)return;const f=e.dataTransfer?.files?.[0];if(f)startInstallerUpload(f);});
fileInput.addEventListener('change',e=>{const f=e.target.files?.[0];e.target.value='';if(f)startInstallerUpload(f);});
async function startInstallerUpload(f){
 if(data?.canAdministerSystem===false)return toast('La instalación requiere permisos de administración del host','info');
 if(upCtl)return toast('Ya hay una subida en curso','warn','',2500);
 if(FOREIGN.test(f.name))return toast('Este instalador es para otro sistema (Windows, macOS o Android)','error');
 try{setUpload(0,'Iniciando subida…');const p=await uploadChunks(f);await inspectAndInstall(p);}
 catch(e){if(e.name!=='AbortError')errToast(e);}
}
document.querySelector('#store-upload-cancel').addEventListener('click',()=>upCtl?.abort());
document.querySelector('#store-path-btn').addEventListener('click',async e=>{const v=document.querySelector('#store-path').value.trim();if(!v)return toast('Indicá la ruta del instalador','warn','',2500);try{await AxonUI.busy(e.currentTarget,()=>inspectAndInstall(v));}catch(err){errToast(err);}});
function params(){return {q:query,category:category==='Todas'?'':category,installed:installedOnly?'1':''};}function sync(){window.AxonNavigation?.update('store',params());}
window.AxonPages ||= {};window.AxonPages.store={restore:async p=>{query=p.q||'';category=p.category||'Todas';installedOnly=p.installed==='1';document.querySelector('#store-query').value=query;document.querySelector('#store-installed').checked=installedOnly;await load();},params,capture:()=>params()};
setInterval(()=>{if(signedIn&&!document.hidden&&section.classList.contains('active')&&(data?.jobs.length||data?.checking))load(false);},5000);
refreshIcons();
})();
