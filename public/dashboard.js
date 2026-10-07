/* AXON — Home: real recent files, saved locations and agent activity. */
(() => {
  'use strict';
  const main=document.querySelector('main.content');
  const sec=document.createElement('section');sec.id='tab-dashboard';sec.className='tab-content dashboard';
  sec.innerHTML=`<header class="home-heading"><div><span class="home-eyebrow">AXON / TU SERVIDOR</span><h1>Inicio</h1><p>Todo a mano. Continuá donde estabas.</p></div><button class="btn-secondary" id="home-refresh">${icon('refresh-cw')} Actualizar</button></header>
    <div class="home-vitals" role="group" aria-label="Estado del servidor"><span>CPU <b id="home-cpu">—</b></span><span>Memoria <b id="home-ram">—</b></span><span>Disco sistema <b id="home-disk">—</b></span><span>Carga <b id="home-load">—</b></span><span>Temp <b id="home-temp">—</b></span><span>IP <b id="home-ip">—</b></span><span id="home-disks-wrap" hidden>Otros discos <b id="home-disks">—</b></span><span id="home-vitals-status" role="status" style="color:var(--warn)" hidden></span><a href="/salud">Ver salud ${icon('arrow-up-right')}</a></div>
    <div class="home-section-title"><h2>Continuar trabajando</h2><span>Tu última ubicación en cada sección</span></div><nav class="home-resume" id="home-resume" aria-label="Continuar trabajando"></nav>
    <div class="home-quick" role="group" aria-label="Acciones rápidas"><button class="btn-primary" id="home-upload">${icon('upload')} Subir archivos</button><a class="btn-secondary" href="/terminal">${icon('terminal')} Abrir terminal</a><a class="btn-secondary" href="/agentes" data-resume>${icon('bot')} Gestionar agentes</a><button class="btn-secondary" id="home-search">${icon('search')} Buscar en Biblioteca</button><button class="home-command" id="home-command">Buscar una sección <kbd>Ctrl/⌘ K</kbd></button></div>
    <div class="home-columns"><div><section class="home-section"><div class="home-section-title"><h2>Abiertos recientemente</h2><a href="/archivos" data-resume>Archivos ${icon('arrow-right')}</a></div><div id="home-opened" class="home-list"></div></section>
    <section class="home-section"><div class="home-section-title"><h2>Últimas modificaciones</h2><a href="/biblioteca?type=recent">Biblioteca ${icon('arrow-right')}</a></div><div id="home-files" class="home-list" aria-live="polite">Cargando archivos…</div></section>
    <section class="home-section"><div class="home-section-title"><h2>Espacios</h2><span>Enlaces directos a cada sección</span></div><nav id="home-spaces" class="home-spaces" aria-label="Espacios de Axon"></nav></section></div>
    <aside><section class="home-section"><div class="home-section-title"><h2>Cambios de agentes</h2><a href="/agentes">Ver todos ${icon('arrow-right')}</a></div><div id="home-agents" class="home-list" aria-live="polite">Cargando actividad…</div></section>
    <section class="home-section"><div class="home-section-title"><h2>Actividad del servidor</h2></div><div id="home-events" class="home-list" aria-live="polite">Cargando actividad…</div></section><div class="home-key-hint">${icon('keyboard')} Usá el teclado en Archivos y Biblioteca. El botón de atajos muestra las teclas disponibles.</div></aside></div>`;
  if(main)main.prepend(sec);
  const settingsSec=document.createElement('section');settingsSec.id='tab-settings';settingsSec.className='tab-content';
  const settings=document.querySelector('#settings-modal');
  if(settings&&main){settings.classList.remove('modal');settings.classList.add('settings-page');settingsSec.append(settings);main.append(settingsSec);}
  const storageRead=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)) || fallback;}catch{return fallback;}};
  const storedRecent=storageRead('axon:recent-files:v1',[]);
  const recent=Array.isArray(storedRecent)?storedRecent.filter(r=>r && typeof r.url==='string' && /^\/(?!\/)/.test(r.url)):[];
  window.AxonRecent={clear(){recent.length=0;localContent();},add(entry){const index=recent.findIndex(r=>r.url===entry.url);if(index>=0)recent.splice(index,1);recent.unshift({...entry,t:Date.now()});recent.splice(20);try{localStorage.setItem('axon:recent-files:v1',JSON.stringify(recent));}catch{}}};
  const sectionIcon={files:'folder-open',library:'images',agents:'bot',ports:'plug',projects:'folder-git-2',docker:'container',domains:'globe',terminal:'terminal',navegador:'globe',programs:'package',store:'store',drop:'upload-cloud',metrics:'chart-line',logs:'scroll-text',ops:'heart-pulse',scripts:'code',compose:'layers',settings:'settings',storage:'hard-drive',backups:'archive',audit:'history',access:'key-round',desktop:'monitor'};
  const eventIcon={alert:'triangle-alert',domain:'globe',file:'file',job:'list-checks',auth:'key-round',system:'server',info:'info',agent:'bot'};
  const navUrl=(s,p)=>window.AxonNavigation?.url?.(s,p)||'#';
  const safeUrl=(r)=>window.AxonNavigation?.sections?.[r?.section] ? navUrl(r.section,r.params) : null;
  const empty=(text)=>`<p class="home-empty">${esc(text)}</p>`;
  const row=(href,title,detail,time,ic='file',thumb='')=>`<a class="home-row" href="${esc(href)}"><span class="home-row-icon">${thumb?`<img src="${esc(thumb)}" alt="" loading="lazy">`:icon(ic)}</span><span class="home-row-main"><b>${esc(title)}</b><small title="${esc(detail)}">${esc(detail)}</small></span>${time?`<time title="${esc(new Date(time).toLocaleString('es-AR'))}">${esc(relTime(time))}</time>`:''}${icon('chevron-right')}</a>`;
  function localContent(){
    const n=window.AxonNavigation;if(!n)return;
    const saved=n.saved();
    const pinned=['files','library','agents'];
    const extra=Object.keys(saved).filter(s=>s!=='dashboard'&&!pinned.includes(s)&&n.sections[s]).sort((a,b)=>(saved[b]?.t||0)-(saved[a]?.t||0));
    const resumeList=[...new Set([...pinned,...extra])].filter(s=>n.sections[s]).slice(0,3+Math.min(3,extra.length));
    sec.querySelector('#home-resume').innerHTML=resumeList.map(s=>{
      const last=saved[s], p=last?new URL(last.url,location.origin).searchParams:null;
      const detail=s==='files'?(p?.get('path') || 'Explorar el servidor'):s==='library'?(p?.get('q') || p?.get('value') || ({all:'Todos los archivos',recent:'Recientes',fav:'Favoritos',shares:'Compartidos'}[p?.get('type')]) || 'Fotos, videos y documentos'):s==='agents'?(p?.get('id') || 'Skills, MCPs y configuración'):([...(p?.values()||[])][0] || 'Tu última ubicación');
      return `<a class="home-resume-link" href="${esc(last?.url || n.url(s))}" data-resume>${icon(sectionIcon[s] || 'box')}<span><b>${esc(n.sections[s][1])}</b><small title="${esc(detail)}">${esc(detail)}</small></span>${icon('arrow-up-right')}</a>`;
    }).join('');
    sec.querySelector('#home-opened').innerHTML=recent.length?recent.slice(0,5).map(r=>row(r.url,r.name,r.path,r.t,sectionIcon[r.section])).join(''):empty('Cuando abras un archivo, lo vas a encontrar acá para volver con un clic.');
    sec.querySelector('#home-spaces').innerHTML=Object.entries(n.sections).filter(([s])=>s!=='dashboard').map(([s,[href,label]])=>`<a href="${href}" data-resume>${icon(sectionIcon[s] || 'box')}<span>${esc(label)}</span>${icon('arrow-up-right')}</a>`).join('');
    refreshIcons();
  }
  const vitalsStatus=sec.querySelector('#home-vitals-status');
  function vitalsError(){if(vitalsStatus){vitalsStatus.hidden=false;vitalsStatus.textContent='Sin datos del servidor';}}
  function updateVitals(s){
    if(!s||typeof s!=='object'){vitalsError();return;}
    if(vitalsStatus)vitalsStatus.hidden=true;
    const pct=v=>Number.isFinite(v)?`${v}%`:'—';
    const temps=Object.values(s.temperatures||{}).filter(Number.isFinite);
    const extras=(Array.isArray(s.disks)?s.disks:[]).filter(d=>d&&Number.isFinite(d.used)&&d.size>0&&d.path&&d.path!=='/');
    const set=(id,v)=>{const el=sec.querySelector('#'+id);if(el)el.textContent=v;};
    set('home-cpu',pct(s.cpuPercent));set('home-ram',pct(s.memoryPercent));set('home-disk',pct(s.diskPercent));
    set('home-load',(Array.isArray(s.loadAverage)?s.loadAverage:[]).filter(Number.isFinite).map(v=>v.toFixed(2)).join(' ')||'—');
    set('home-temp',temps.length?`${Math.round(Math.max(...temps))}°C`:'—');
    set('home-ip',s.ip||'—');
    const wrap=sec.querySelector('#home-disks-wrap');
    if(wrap)wrap.hidden=!extras.length;
    if(extras.length)set('home-disks',`${extras.length} · máx ${Math.max(...extras.map(d=>Math.round(d.used/d.size*100)))}%`);
  }
  // El poll de 5s del header ya pide /api/stats (caché de 1s): al terminar su
  // request reutilizamos el resultado cacheado para refrescar los vitals.
  document.addEventListener('axon:request-end',e=>{
    if(e.detail?.path!=='/api/stats'||!sec.classList.contains('active'))return;
    api('/api/stats').then(r=>updateVitals(r?.stats)).catch(vitalsError);
  });
  function renderFeed(list){
    const changes=list.filter(e=>e.type==='agent');
    if(changes.length)sec.querySelector('#home-agents').innerHTML=changes.slice(0,6).map(e=>row(safeUrl(e.target) || '/agentes',e.title,'Cambio guardado desde Axon',e.t,'bot')).join('');
    const feed=list.filter(e=>e.type!=='agent').slice(0,6);
    sec.querySelector('#home-events').innerHTML=feed.length?feed.map(e=>row(safeUrl(e.target) || (e.type==='alert'?'/salud':e.type==='domain'?'/dominios':'/logs'),e.title,e.detail || e.type,e.t,eventIcon[e.type]||'activity')).join(''):empty('No hay actividad reciente.');
    refreshIcons();
  }
  // "Actividad del servidor" se actualiza en vivo vía SSE; se abre al entrar a
  // la sección y se cierra al salir (leave).
  let eventStream=null;
  function watchEvents(){
    if(eventStream||typeof EventSource==='undefined')return;
    eventStream=new EventSource('/api/events/stream');
    eventStream.addEventListener('change',async()=>{
      if(!sec.classList.contains('active'))return;
      try{const d=await api('/api/events?limit=24');if(Array.isArray(d?.events))renderFeed(d.events);}catch{/* el feed es best-effort */}
    });
  }
  let loading=0;
  async function loadHome(){
    const ticket=++loading;localContent();
    const results=await Promise.allSettled([api('/api/library/recent?limit=6'),api('/api/events?limit=24'),api('/api/agents/activity'),api('/api/stats')]);
    if(ticket!==loading)return;
    const [files,events,agents,stats]=results;
    const items=files.status==='fulfilled'&&Array.isArray(files.value?.items)?files.value.items:null;
    sec.querySelector('#home-files').innerHTML=items===null?empty('No se pudieron cargar los archivos. Podés reintentar con Actualizar.'):items.length?items.map(it=>row(navUrl('library',{type:'all',item:it.id}),it.n,it.p,it.m, it.k==='video'?'film':it.k==='audio'?'music':'file',it.th>=1?`/api/library/thumb/${encodeURIComponent(it.id)}?k=${encodeURIComponent(it.tk)}`:'')).join(''):empty('Todavía no hay archivos indexados. Agregá carpetas desde Biblioteca.');
    const list=events.status==='fulfilled'&&Array.isArray(events.value?.events)?events.value.events:null;
    if(list)renderFeed(list);else sec.querySelector('#home-events').innerHTML=empty('No se pudo cargar la actividad.');
    if(!list||!list.some(e=>e.type==='agent')){
      const backups=agents.status==='fulfilled'&&Array.isArray(agents.value?.backups)?agents.value.backups:[];
      sec.querySelector('#home-agents').innerHTML=backups.length?backups.slice(0,5).map(b=>row(navUrl('agents',{id:b.agentId,tab:'config'}),b.agentName,'Respaldo: '+b.source,b.mtime,'history')).join(''):empty('Los cambios que guardes en agentes van a aparecer acá.');
    }
    if(stats.status==='fulfilled')updateVitals(stats.value?.stats);else vitalsError();
    refreshIcons();
  }
  sec.querySelector('#home-refresh').addEventListener('click',loadHome);
  const goSection=async url=>{try{return await window.AxonNavigation?.go?.(url,{remember:true})===true;}catch{return false;}};
  sec.querySelector('#home-upload').addEventListener('click',async()=>{if(!await goSection('/archivos'))return;document.querySelector('#fm-file-input')?.click();});
  sec.querySelector('#home-search').addEventListener('click',async()=>{if(!await goSection('/biblioteca'))return;document.querySelector('#lib-q')?.focus();});
  sec.querySelector('#home-command').addEventListener('click',()=>document.querySelector('#cmdk-open')?.click());
  window.AxonPages ||= {};
  window.AxonPages.dashboard={restore(){watchEvents();return loadHome();},leave(){eventStream?.close();eventStream=null;}};
  document.addEventListener('axon:link-copied',()=>toast('Enlace copiado','ok','',2000));
})();
