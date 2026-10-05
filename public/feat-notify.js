/* Notification center: live event counts, explicit read state, resilient refresh. */
(() => {
  'use strict';
  const bell = document.querySelector('#notif-bell'), badge = document.querySelector('#notif-badge');
  if (!bell) return;
  let open = false, signedIn = false, flight = null, stream = null, knownIds = null, events = [], unread = 0;
  let version = 0, pending = false;
  let displayCount = 100;
  const panel = document.createElement('div'); panel.id = 'notif-panel'; panel.className = 'hidden';
  panel.setAttribute('role','region'); panel.setAttribute('aria-label','Notificaciones');
  panel.innerHTML = `<div class="notif-head"><span class="notif-title">Notificaciones</span><div class="notif-head-actions"><button id="notif-read-all" class="notif-btn">Marcar leídas</button><button id="notif-clear" class="notif-btn notif-btn-danger">Limpiar</button><button class="icon-btn" id="notif-close" aria-label="Cerrar notificaciones">${icon('x')}</button></div></div><div id="notif-alerts" class="notif-alerts hidden"><div class="notif-section-title">Alertas activas</div><div id="notif-alerts-list"></div></div><div id="notif-error" class="notif-error hidden" role="status"></div><div id="notif-list" class="notif-list"><div class="notif-empty">Cargando…</div></div><div class="notif-foot"><span id="notif-live">Conectando…</span><button class="notif-btn hidden" id="notif-more">Ver anteriores</button><button class="notif-btn" id="notif-refresh">${icon('refresh-cw')} Actualizar</button></div>`;
  document.body.append(panel);
  bell.setAttribute('aria-controls','notif-panel'); bell.setAttribute('aria-expanded','false'); bell.setAttribute('aria-label','Notificaciones');
  function badgeCount(count) { unread=count;badge.classList.toggle('hidden',!count);badge.textContent=count>99?'99+':String(count||'');bell.setAttribute('aria-label',count?`Notificaciones, ${count} sin leer`:'Notificaciones'); }
  function position() { const r=bell.getBoundingClientRect();panel.style.top=`${r.bottom+8}px`;panel.style.right=`${Math.max(8,innerWidth-r.right)}px`;panel.style.maxHeight=`${Math.max(200,innerHeight-r.bottom-24)}px`; }
  function toggle(value) { open=value;panel.classList.toggle('hidden',!open);bell.setAttribute('aria-expanded',String(open));if(open){position();void refresh();}else bell.focus({preventScroll:true}); }
  function render() {
    document.querySelector('#notif-list').innerHTML=events.length?events.slice(0,displayCount).map(ev=>`<button class="notif-item${ev.read?'':' notif-item-unread'}" data-id="${esc(ev.id)}" aria-pressed="${ev.read?'true':'false'}"><span class="notif-ic">${icon(({alert:'triangle-alert',job:'circle-check',domain:'globe',auth:'shield',file:'file',agent:'bot',system:'cpu'})[ev.type]||'info')}</span><span class="notif-body"><span class="notif-item-title">${esc(ev.title)}</span>${ev.detail?`<span class="notif-detail">${esc(ev.detail)}</span>`:''}<span class="notif-time">${relTime(ev.t)} · ${ev.read?'Leída':'Sin leer'}</span></span></button>`).join(''):'<div class="notif-empty">Sin notificaciones</div>';
    document.querySelector('#notif-more').classList.toggle('hidden',displayCount>=events.length);
    refreshIcons();
  }
  function notifyNew(next) {
    if(knownIds && 'Notification' in window && Notification.permission==='granted' && (document.hidden||!document.hasFocus())) {
      next.filter(ev=>!knownIds.has(ev.id)&&['alert','job','domain','file'].includes(ev.type)).slice(0,3).forEach(ev=>{try{new Notification(ev.title,{body:ev.detail||'',tag:ev.id,icon:'/icons/app.svg'});}catch{}});
    }
    knownIds=new Set(next.map(ev=>ev.id));
  }
  function refresh() {
    if(!signedIn)return Promise.resolve();
    if(flight){pending=true;return flight;}
    const ticket=version;
    flight=(async()=>{
      const [feed,alerts]=await Promise.allSettled([api('/api/events?limit=500'),open?api('/api/alerts'):Promise.resolve(null)]);
      if(ticket!==version)return;
      const error=document.querySelector('#notif-error');
      if(feed.status==='fulfilled') { const next=feed.value.events||[];notifyNew(next);events=next;badgeCount(feed.value.unread||0);if(open)render();error.classList.add('hidden'); }
      else { error.textContent='No se pudo actualizar. Tus notificaciones se conservan.';error.classList.remove('hidden'); }
      if(alerts.status==='fulfilled'&&alerts.value&&open) {
        const list=alerts.value.alerts||[];document.querySelector('#notif-alerts').classList.toggle('hidden',!list.length);
        document.querySelector('#notif-alerts-list').innerHTML=list.map(a=>`<div class="notif-alert"><span class="notif-ic">${icon('triangle-alert')}</span><div class="notif-body"><div class="notif-item-title">${esc(a.title)}</div><div class="notif-detail">${esc(a.detail||'')}</div></div></div>`).join('');refreshIcons();
      }
    })().finally(()=>{flight=null;if(pending){pending=false;void refresh();}});
    return flight;
  }
  async function mutate(path,body,button) {
    await AxonUI.busy(button,async()=>{
      const result=await api(path,{method:'POST',body});version++;badgeCount(result.unread||0);await refresh();
    });
  }
  document.querySelector('#notif-read-all').addEventListener('click',async e=>{try{await mutate('/api/events/read',{ids:events.filter(ev=>!ev.read).map(ev=>ev.id)},e.currentTarget);}catch(e){errToast(e);}});
  document.querySelector('#notif-clear').addEventListener('click',async e=>{const button=e.currentTarget;if(!(await confirmDialog('Vaciar notificaciones','Se elimina el historial de eventos de Axon.','Limpiar')))return;try{await mutate('/api/events/clear',{},button);}catch(e){errToast(e);}});
  document.querySelector('#notif-list').addEventListener('click',async e=>{
    const button=e.target.closest('[data-id]');if(!button)return;const ev=events.find(x=>x.id===button.dataset.id);if(!ev)return;
    try{await mutate('/api/events/read',{ids:[ev.id]},button);if(ev.target&&window.AxonNavigation?.sections[ev.target.section]){toggle(false);await window.AxonNavigation.go(window.AxonNavigation.url(ev.target.section,ev.target.params));}}catch(e){errToast(e);}
  });
  document.querySelector('#notif-refresh').addEventListener('click',e=>AxonUI.busy(e.currentTarget,refresh));
  document.querySelector('#notif-more').addEventListener('click',()=>{displayCount+=100;render();});
  document.querySelector('#notif-close').addEventListener('click',()=>toggle(false));
  bell.addEventListener('click',e=>{e.stopPropagation();toggle(!open);});
  document.addEventListener('click',e=>{if(open&&!panel.contains(e.target)&&!bell.contains(e.target)&&!e.target.closest('.modal'))toggle(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open)toggle(false);});
  addEventListener('resize',()=>{if(open)position();});
  function connect(){
    if(!signedIn||stream)return;
    stream=new EventSource('/api/events/stream');
    stream.onopen=()=>{document.querySelector('#notif-live').textContent='En vivo';};
    stream.addEventListener('change',e=>{try{badgeCount(JSON.parse(e.data).unread);}catch{}void refresh();});
    stream.onerror=()=>{document.querySelector('#notif-live').textContent='Reconectando…';};
  }
  document.addEventListener('axon:authenticated',()=>{signedIn=true;connect();void refresh();});
  document.addEventListener('axon:session-expired',()=>{signedIn=false;version++;knownIds=null;stream?.close();stream=null;if(open)toggle(false);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&signedIn){connect();void refresh();}});
  // Fallback also updates active alerts; it never marks anything read.
  setInterval(()=>{if(signedIn&&!document.hidden)void refresh();},30_000);
})();
