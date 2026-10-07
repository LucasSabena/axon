/* The shell uses existing route actors: grouping never replaces a feature's action handlers. */
(() => {
  const nav = document.querySelector('.sidebar-nav');
  const groups = [
    ['Trabajo', ['projects','files','library','agents']],
    ['Servidor', ['docker','ports','compose','domains','storage','backups']],
    ['Salud', ['ops','metrics','logs','audit']],
    ['Herramientas', ['terminal','navegador','desktop','scripts','drop','access']],
    ['Aplicaciones', ['programs','store']],
  ];
  let collapsed = {};
  try { collapsed = JSON.parse(localStorage.getItem('axon:nav-groups:v1') || '{}'); } catch {}
  if (!collapsed || typeof collapsed !== 'object' || Array.isArray(collapsed)) collapsed = {};
  const nodes = new Map([...nav.querySelectorAll('[data-tab]')].map(n=>[n.dataset.tab,n]));
  const settings = document.querySelector('#sidebar-settings');
  nav.querySelectorAll('.nav-section-label').forEach(n=>n.remove());
  if(nodes.get('dashboard')) nav.prepend(nodes.get('dashboard'));
  for (const [label, sections] of groups) {
    const group = document.createElement('div'); group.className='nav-group'; group.dataset.group=label;
    const toggle = document.createElement('button'); toggle.type='button'; toggle.className='nav-group-toggle';
    const content = document.createElement('div'); content.className='nav-group-items'; content.id=`nav-group-${sections[0]}`;
    toggle.innerHTML=`<span>${label}</span>${icon('chevron-down')}`; toggle.setAttribute('aria-controls',content.id);
    const setOpen = open => { content.hidden=!open; toggle.setAttribute('aria-expanded',String(open)); };
    setOpen(!collapsed[label]);
    toggle.addEventListener('click',()=>{const open=content.hidden;setOpen(open);collapsed[label]=!open;try{localStorage.setItem('axon:nav-groups:v1',JSON.stringify(collapsed));}catch{}});
    for (const section of sections) {
      const node = nodes.get(section);
      // A missing nav entry must not abort the rest of the shell wiring.
      if (!node) { console.warn(`Falta la sección ${section} en la navegación`); continue; }
      node.title=node.querySelector('.nav-label')?.textContent.trim() || section;
      content.append(node);
    }
    group.append(toggle,content);nav.append(group);
  }
  // A fixed configuration entry remains discoverable even in a scrolled sidebar.
  settings.querySelector('.nav-label').textContent='Configuración';
  document.querySelector('.sidebar-footer').prepend(settings);
  document.querySelectorAll('.nav-item[data-tab="agents"] .nav-label').forEach(n=>n.textContent='Agentes');
  const theme = document.querySelector('#theme-toggle');
  function syncTheme() {
    const dark = AxonThemes.current().effective==='dark';
    theme.innerHTML=icon(dark?'sun':'moon');
    theme.setAttribute('aria-label', dark?'Usar modo claro':'Usar modo oscuro');
    theme.title=theme.getAttribute('aria-label'); refreshIcons();
  }
  theme.addEventListener('click',()=>AxonThemes.setMode(AxonThemes.current().effective==='dark'?'light':'dark'));
  document.addEventListener('axon:theme',syncTheme);syncTheme();
  const menu = document.querySelector('#account-menu');
  menu.addEventListener('wa-select',e=>{
    const value=e.detail.item.value;
    const target={terminal:'term-btn',pair:'pair-btn',appearance:'theme-current',settings:'settings-btn',logout:'logout-btn'}[value];
    if(target)document.getElementById(target).click();
  });
  for(const button of document.querySelectorAll('button[title]'))if(!button.textContent.trim()&&!button.hasAttribute('aria-label'))button.setAttribute('aria-label',button.title);
  document.addEventListener('axon:route',e=>{
    const active=document.querySelector(`.sidebar-nav [data-tab="${e.detail.section}"]`);
    const group=active?.closest('.nav-group');
    if(group){group.querySelector('.nav-group-items').hidden=false;group.querySelector('.nav-group-toggle').setAttribute('aria-expanded','true');}
  });
  const banner=document.createElement('div');banner.className='connection-banner';banner.hidden=true;banner.setAttribute('role','status');
  document.querySelector('.topbar').after(banner);
  function connectivity(){banner.hidden=navigator.onLine;banner.textContent='Sin conexión. Los datos visibles pueden estar desactualizados; las acciones necesitan conexión con el servidor.';}
  window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity);connectivity();
  // Loading geometry belongs to the target container, never to the whole page.
  const containers=[
    ['/api/ports','#ports-table tbody'],['/api/projects','#projects-table tbody'],['/api/docker','#docker-table tbody'],['/api/domains','#domains-table tbody'],
    ['/api/library/recent','#home-files'],['/api/agents/activity','#home-agents'],['/api/events','#home-events'],
    ['/api/software','#programs-grid'],['/api/jobs','#jobs-history'],['/api/agents','#ag-main'],
    ['/api/scripts','#sc-list'],['/api/compose','#cp-grid'],['/api/store','#store-grid'],
  ];
  const feedbackSections={ '/api/ports':'ports','/api/projects':'projects','/api/docker':'docker','/api/domains':'domains','/api/software':'programs' };
  const feedback=new Map();
  for(const section of Object.values(feedbackSections)) {
    const sec=document.getElementById('tab-'+section);if(!sec)continue;
    const box=document.createElement('div');box.className='view-feedback';box.hidden=true;box.setAttribute('role','alert');
    const message=document.createElement('span'),retry=document.createElement('button');retry.type='button';retry.className='btn-secondary';retry.textContent='Reintentar';
    retry.addEventListener('click',()=>AxonUI.busy(retry,()=>loaders[section]?.()));box.append(message,retry);
    sec.querySelector('.section-header').after(box);feedback.set(section,{box,message});
  }
  document.addEventListener('axon:request-error',e=>{
    const section=feedbackSections[e.detail.path],view=feedback.get(section);if(!view || e.detail.error.status===401)return;
    view.box.hidden=false;view.message.textContent=e.detail.error.message+' · Los datos anteriores se conservan hasta actualizar.';
  });
  const pending=new Map();
  document.addEventListener('axon:request-start',e=>{
    const view=feedback.get(feedbackSections[e.detail.path]);if(view)view.box.hidden=true;
    for(const [prefix,selector] of containers){
      if(!e.detail.path.startsWith(prefix))continue;
      const el=document.querySelector(selector);if(!el || pending.has(el) || el.children.length || (el.textContent.trim()&&!/^Cargando/.test(el.textContent.trim())))continue;
      const initial=el.innerHTML, loading=document.createElement('div');loading.className='loading-shell';loading.setAttribute('role','status');loading.setAttribute('aria-label','Cargando');loading.setAttribute('aria-busy','true');
      loading.innerHTML='<wa-skeleton effect="sheen"></wa-skeleton><wa-skeleton effect="sheen"></wa-skeleton><wa-skeleton effect="sheen"></wa-skeleton>';
      if(el.tagName==='TBODY'){const row=document.createElement('tr');row.dataset.uiSkeleton='';const cell=document.createElement('td');cell.colSpan=el.closest('table').querySelectorAll('thead th').length || 8;cell.append(loading);row.append(cell);el.replaceChildren(row);}else el.replaceChildren(loading);
      pending.set(el,{path:e.detail.path,initial,loading});
    }
  });
  document.addEventListener('axon:request-end',e=>{
    if(feedbackSections[e.detail.path]) document.querySelector('#section-progress')?.classList.add('hidden');
    for(const [el,state] of pending)if(state.path===e.detail.path){if(state.loading.isConnected)el.innerHTML=state.initial;pending.delete(el);}
  });
  // All dynamic feature CSS must precede the shared design system.
  document.head.append(document.querySelector('link[href^="/design-system.css"]'));
  refreshIcons();
})();
