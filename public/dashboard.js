/* AXON — Home: real recent files, saved locations and agent activity. */
(() => {
  'use strict';
  const sec=document.createElement('section');sec.id='tab-dashboard';sec.className='tab-content dashboard';
  sec.innerHTML=`<header class="home-heading"><div><span class="home-eyebrow">AXON / TU SERVIDOR</span><h1>Inicio</h1><p>Todo a mano. Continuá donde estabas.</p></div><button class="btn-secondary" id="home-refresh">${icon('refresh-cw')} Actualizar</button></header>
    <div class="home-vitals" aria-label="Estado del servidor"><span>CPU <b id="home-cpu">—</b></span><span>Memoria <b id="home-ram">—</b></span><span>Disco sistema <b id="home-disk">—</b></span><a href="/salud">Ver salud ${icon('arrow-up-right')}</a></div>
    <div class="home-section-title"><h2>Continuar trabajando</h2><span>Tu última ubicación en cada sección</span></div><nav class="home-resume" id="home-resume" aria-label="Continuar trabajando"></nav>
    <div class="home-quick" aria-label="Acciones rápidas"><button class="btn-primary" id="home-upload">${icon('upload')} Subir archivos</button><a class="btn-secondary" href="/terminal">${icon('terminal')} Abrir terminal</a><a class="btn-secondary" href="/agentes" data-resume>${icon('bot')} Gestionar agentes</a><button class="btn-secondary" id="home-search">${icon('search')} Buscar en Biblioteca</button><button class="home-command" id="home-command">Buscar una sección <kbd>Ctrl/⌘ K</kbd></button></div>
    <div class="home-columns"><div><section class="home-section"><div class="home-section-title"><h2>Abiertos recientemente</h2><a href="/archivos" data-resume>Archivos ${icon('arrow-right')}</a></div><div id="home-opened" class="home-list"></div></section>
    <section class="home-section"><div class="home-section-title"><h2>Últimas modificaciones</h2><a href="/biblioteca?type=recent">Biblioteca ${icon('arrow-right')}</a></div><div id="home-files" class="home-list" aria-live="polite">Cargando archivos…</div></section>
    <section class="home-section"><div class="home-section-title"><h2>Espacios</h2><span>Enlaces directos a cada sección</span></div><nav id="home-spaces" class="home-spaces" aria-label="Espacios de Axon"></nav></section></div>
    <aside><section class="home-section"><div class="home-section-title"><h2>Cambios de agentes</h2><a href="/agentes">Ver todos ${icon('arrow-right')}</a></div><div id="home-agents" class="home-list" aria-live="polite">Cargando actividad…</div></section>
    <section class="home-section"><div class="home-section-title"><h2>Actividad del servidor</h2></div><div id="home-events" class="home-list" aria-live="polite">Cargando actividad…</div></section><div class="home-key-hint">${icon('keyboard')} Usá el teclado en Archivos y Biblioteca. El botón de atajos muestra las teclas disponibles.</div></aside></div>`;
  document.querySelector('main.content').prepend(sec);
  const settingsSec=document.createElement('section');settingsSec.id='tab-settings';settingsSec.className='tab-content';
  const settings=document.querySelector('#settings-modal');settings.classList.remove('modal');settings.classList.add('settings-page');settingsSec.append(settings);document.querySelector('main.content').append(settingsSec);
  const storageRead=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)) || fallback;}catch{return fallback;}};
  const storedRecent=storageRead('axon:recent-files:v1',[]);
  const recent=Array.isArray(storedRecent)?storedRecent.filter(r=>r && typeof r.url==='string' && r.url.startsWith('/')):[];
  window.AxonRecent={clear(){recent.length=0;localContent();},add(entry){const index=recent.findIndex(r=>r.url===entry.url);if(index>=0)recent.splice(index,1);recent.unshift({...entry,t:Date.now()});recent.splice(20);try{localStorage.setItem('axon:recent-files:v1',JSON.stringify(recent));}catch{}}};
  const sectionIcon={files:'folder-open',library:'images',agents:'bot',ports:'plug',projects:'folder-git-2',docker:'container',domains:'globe',terminal:'terminal',navegador:'globe',programs:'package',store:'store',drop:'upload-cloud',metrics:'chart-line',logs:'scroll-text',ops:'heart-pulse',scripts:'code',compose:'layers',settings:'settings'};
  const safeUrl=(r)=>window.AxonNavigation?.sections[r?.section] ? window.AxonNavigation.url(r.section,r.params) : null;
  const empty=(text)=>`<p class="home-empty">${esc(text)}</p>`;
  const row=(href,title,detail,time,ic='file',thumb='')=>`<a class="home-row" href="${esc(href)}"><span class="home-row-icon">${thumb?`<img src="${esc(thumb)}" alt="" loading="lazy">`:icon(ic)}</span><span class="home-row-main"><b>${esc(title)}</b><small title="${esc(detail)}">${esc(detail)}</small></span>${time?`<time title="${esc(new Date(time).toLocaleString('es-AR'))}">${esc(relTime(time))}</time>`:''}${icon('chevron-right')}</a>`;
  function localContent(){
    const n=window.AxonNavigation;if(!n)return;
    const saved=n.saved();
    document.querySelector('#home-resume').innerHTML=['files','library','agents'].map(s=>{
      const last=saved[s], p=last?new URL(last.url,location.origin).searchParams:null;
      const detail=s==='files'?(p?.get('path') || 'Explorar el servidor'):s==='library'?(p?.get('q') || p?.get('value') || ({all:'Todos los archivos',recent:'Recientes',fav:'Favoritos',shares:'Compartidos'}[p?.get('type')]) || 'Fotos, videos y documentos'):(p?.get('id') || 'Skills, MCPs y configuración');
      return `<a class="home-resume-link" href="${esc(last?.url || n.url(s))}" data-resume>${icon(sectionIcon[s])}<span><b>${esc(n.sections[s][1])}</b><small title="${esc(detail)}">${esc(detail)}</small></span>${icon('arrow-up-right')}</a>`;
    }).join('');
    document.querySelector('#home-opened').innerHTML=recent.length?recent.slice(0,5).map(r=>row(r.url,r.name,r.path,r.t,sectionIcon[r.section])).join(''):empty('Cuando abras un archivo, lo vas a encontrar acá para volver con un clic.');
    document.querySelector('#home-spaces').innerHTML=Object.entries(n.sections).filter(([s])=>s!=='dashboard').map(([s,[href,label]])=>`<a href="${href}" data-resume>${icon(sectionIcon[s] || 'box')}<span>${esc(label)}</span>${icon('arrow-up-right')}</a>`).join('');
    refreshIcons();
  }
  let loading=0;
  async function loadHome(){
    const ticket=++loading;localContent();
    const results=await Promise.allSettled([api('/api/library/recent?limit=6'),api('/api/events?limit=24'),api('/api/agents/activity'),api('/api/stats')]);
    if(ticket!==loading)return;
    const [files,events,agents,stats]=results;
    if(files.status==='fulfilled'){
      document.querySelector('#home-files').innerHTML=files.value.items.length?files.value.items.map(it=>row(window.AxonNavigation.url('library',{type:'all',item:it.id}),it.n,it.p,it.m, it.k==='video'?'film':it.k==='audio'?'music':'file',it.th>=1?`/api/library/thumb/${it.id}?k=${it.tk}`:'')).join(''):empty('Todavía no hay archivos indexados. Agregá carpetas desde Biblioteca.');
    }else document.querySelector('#home-files').innerHTML=empty('No se pudieron cargar los archivos. Podés reintentar con Actualizar.');
    const changes=events.status==='fulfilled'?events.value.events.filter(e=>e.type==='agent'):[];
    document.querySelector('#home-agents').innerHTML=changes.length?changes.slice(0,6).map(e=>row(safeUrl(e.target) || '/agentes',e.title,'Cambio guardado desde Axon',e.t,'bot')).join(''):agents.status==='fulfilled'&&agents.value.backups.length?agents.value.backups.slice(0,5).map(b=>row(window.AxonNavigation.url('agents',{id:b.agentId,tab:'config'}),b.agentName,'Respaldo: '+b.source,b.mtime,'history')).join(''):empty('Los cambios que guardes en agentes van a aparecer acá.');
    const feed=events.status==='fulfilled'?events.value.events.filter(e=>e.type!=='agent').slice(0,6):[];
    document.querySelector('#home-events').innerHTML=feed.length?feed.map(e=>row(safeUrl(e.target) || (e.type==='alert'?'/salud':e.type==='domain'?'/dominios':'/logs'),e.title,e.detail || e.type,e.t,e.type==='alert'?'triangle-alert':'activity')).join(''):empty(events.status==='fulfilled'?'No hay actividad reciente.':'No se pudo cargar la actividad.');
    if(stats.status==='fulfilled'){const s=stats.value.stats;document.querySelector('#home-cpu').textContent=s.cpuPercent+'%';document.querySelector('#home-ram').textContent=s.memoryPercent+'%';document.querySelector('#home-disk').textContent=s.diskPercent+'%';}
    refreshIcons();
  }
  document.querySelector('#home-refresh').addEventListener('click',loadHome);
  document.querySelector('#home-upload').addEventListener('click',async()=>{await window.AxonNavigation.go('/archivos',{remember:true});document.querySelector('#fm-file-input').click();});
  document.querySelector('#home-search').addEventListener('click',async()=>{await window.AxonNavigation.go('/biblioteca',{remember:true});document.querySelector('#lib-q').focus();});
  document.querySelector('#home-command').addEventListener('click',()=>document.querySelector('#cmdk-open').click());
  window.AxonPages ||= {};
  window.AxonPages.dashboard={restore:loadHome};
  document.addEventListener('axon:link-copied',()=>toast('Enlace copiado','ok','',2000));
})();
