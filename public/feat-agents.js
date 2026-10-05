/* AXON — feature: Agents de IA tab
 * Injects #tab-agents + its nav button (Sistema, after Programas).
 * Master-detail: rail of detected agents → per-agent skills / MCPs / plugins
 * with enable/disable, delete and add. Reuses app.js globals:
 * $, $$, api, esc, icon, toast, errToast, confirmDialog, refreshIcons,
 * openJobModal, activeTabName, unloadBrowser.
 */
(() => {
  'use strict';

  let restoringAgent = false;
  let agentsList = [];
  let discoveredList = []; // heuristic candidates not managed yet
  let selectedId = null;
  let selectedDetail = null;
  let loadingDetail = false;
  let agSubTab = 'skill'; // remembered across agents
  let docsCount = null; // rail subtitle for the docs pseudo-agent
  let settingsCache = {}; // agentId → settings payload (per page load)
  let railQuery = ''; // rail search filter (agent names)
  let searchTimer = null; // debounce for the global item search
  let pendingHighlight = null; // {kind,key} — flash item after detail load
  let healthState = {}; // `${agent}:${key}` → 'ok'|'bad'|'loading'
  let provHealth = {}; // `${agent}:${key}` → ProviderCheck result {state,msg,code,ms}

  // Global instruction doc per agent — shown as an editable "Doc" tab.
  const AGENT_DOC = {
    codex: '.codex/AGENTS.md',
    claude: '.claude/CLAUDE.md',
    opencode: '.config/opencode/AGENTS.md',
    gemini: '.gemini/GEMINI.md',
    devin: '.config/devin/AGENTS.md',
    windsurf: '.codeium/windsurf/memories/global_rules.md',
  };

  // ---------- DOM injection ----------

  function activateTab() {
    $$('.tab-btn').forEach((b) => b.classList.remove('active'));
    $$('.tab-content').forEach((t) => t.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="agents"]')?.classList.add('active');
    $('#tab-agents')?.classList.add('active');
    try {
      if (typeof activeTabName !== 'undefined') {
        if (activeTabName === 'navegador' && typeof unloadBrowser === 'function') unloadBrowser();
        activeTabName = 'agents';
      }
    } catch { /* older app.js */ }
    if (!window.AxonNavigation) loadAgents();
  }

  function ensureDom() {
    if ($('#tab-agents')) return;

    const nav = $('.sidebar-nav');
    const anchor = $('#sidebar-settings');
    if (nav && anchor) {
      const btn = document.createElement('button');
      btn.className = 'nav-item tab-btn';
      btn.dataset.tab = 'agents';
      btn.innerHTML = `
        <i data-lucide="bot" class="lucide-icon"></i>
        <span class="nav-label">Agents</span>
        <span class="nav-count nav-alert hidden" id="nav-count-agents"></span>`;
      nav.insertBefore(btn, anchor);
      btn.addEventListener('click', activateTab);
    }

    const main = $('main.content');
    if (!main) return;
    const sec = document.createElement('section');
    sec.id = 'tab-agents';
    sec.className = 'tab-content';
    sec.innerHTML = `
      <div class="section-header">
        <h2>Agents de IA</h2>
        <div class="section-actions">
          <button id="agents-refresh" class="btn-secondary" title="Recargar"><i data-lucide="refresh-cw" class="lucide-icon"></i></button>
          <span class="last-updated" id="agents-updated"></span>
        </div>
      </div>
      <p class="listener-note">Agentes detectados en el host: configuración, integraciones, chats y memorias locales. Las ediciones conservan un respaldo.</p>
      <div class="agents-layout">
        <div class="agents-side">
          <div class="agents-search">
            <i data-lucide="search" class="lucide-icon"></i>
            <input id="agents-q" class="filter-input" placeholder="Buscar agente, skill, MCP…" autocomplete="off">
            <button id="agents-add" class="icon-btn" title="Registrar un agente manualmente">${icon('plus')}</button>
          </div>
          <div id="agents-add-form" class="agd-form hidden">
            <input type="text" id="agf-agent-name" class="filter-input" placeholder="Nombre (ej: Aider)">
            <input type="text" id="agf-agent-dir" class="filter-input" placeholder="Carpeta de config (ej: ~/.aider)">
            <input type="text" id="agf-agent-bin" class="filter-input" placeholder="Binario (opcional)">
            <button class="btn-primary" id="agf-agent-submit">${icon('plus')} Registrar</button>
            <button class="btn-secondary agf-cancel">Cancelar</button>
          </div>
          <div id="agents-matches" class="agents-matches hidden"></div>
          <div class="agents-rail" id="agents-rail"><p class="ops-loading">Detectando agentes…</p></div>
        </div>
        <div class="agents-detail" id="agents-detail">
          <div class="agents-placeholder">${icon('bot')}<p>Elegí un agente, Chats o Memorias para ver su contenido.</p></div>
        </div>
      </div>`;
    main.appendChild(sec);
    sec.querySelector('#agents-refresh').addEventListener('click', async()=>{if(await window.AgentContext.canLeave())await loadAgents();});
    sec.querySelector('#agents-q').addEventListener('input', onSearch);
    sec.querySelector('#agents-add').addEventListener('click', () => {
      $('#agents-add-form').classList.toggle('hidden');
      $('#agf-agent-name')?.focus();
    });
    sec.querySelector('.agf-cancel').addEventListener('click', () => $('#agents-add-form').classList.add('hidden'));
    sec.querySelector('#agf-agent-submit').addEventListener('click', async () => {
      const name = $('#agf-agent-name').value.trim();
      const dir = $('#agf-agent-dir').value.trim();
      const bin = $('#agf-agent-bin').value.trim();
      if (!name) return toast('Falta el nombre', 'error');
      try {
        await api('/api/agents-discovered/add', { method: 'POST', body: { name, dir, bin } });
        toast(`${name} registrado`, 'ok');
        $('#agents-add-form').classList.add('hidden');
        loadAgents();
      } catch (err) { errToast(err); }
    });
    refreshIcons();
  }

  // ---------- data ----------

  async function loadAgents({ refreshDetail = true } = {}) {
    ensureDom();
    try {
      const { agents } = await api('/api/agents');
      agentsList = agents || [];
      // Optional discovery never holds the main rail hostage.
      api('/api/agents-discovered', {cacheMs:60_000}).then(disc=>{
        discoveredList=disc.candidates || []; if(!railQuery) renderRail();
      }).catch(()=>{});
      window.__pmAgents = agentsList; // ⌘K command palette integration
      $('#agents-updated').textContent = `Actualizado ${new Date().toLocaleTimeString()}`;
      renderRail();
      const upd = agentsList.filter((a) => a.latestVersion).length;
      const nc = $('#nav-count-agents');
      if (nc) { nc.textContent = upd || ''; nc.classList.toggle('hidden', !upd); nc.classList.toggle('nav-alert', upd > 0); }
      if (refreshDetail && selectedId && !restoringAgent) loadDetail(selectedId, { silent: true });

    } catch (err) {
      errToast(err);
    }
  }

  async function loadDetail(id, { silent } = {}) {
    loadingDetail = true;
    const routeParams=window.AxonNavigation?.current?.params;
    const stale=()=>selectedId!==id || (window.AxonNavigation?.ready && window.AxonNavigation.current.params!==routeParams);
    if (!silent) {
      $('#agents-detail').innerHTML = `<div class="agents-placeholder">${icon('loader')}<p>Cargando…</p></div>`;
      refreshIcons();
    }
    try {
      if (id === '__chats' || id === '__memories') { await window.AgentContext.render($('#agents-detail'),id === '__chats' ? 'chats' : 'memories',routeParams || {}); if(stale())return; }
      else if (id === '__store') { await renderStore(); if(stale())return; }
      else if (id === '__archives') { await renderArchives(); if(stale())return; }
      else if (id === '__docs') {
        const { docs, missing } = await api('/api/agent-docs');
        if(stale())return;
        docsCount = (docs || []).length;
        renderDocs(docs || [], missing || []);
      } else if (id === '__matrix') {
        const m = await api('/api/agents-matrix');
        if(stale())return;
        renderMatrix(m.agents || [], m.rows || []);
      } else {
        const { agent } = await api(`/api/agents/${id}`);
        if(stale())return;
        selectedDetail = agent;
        renderDetail();
        if(agent?.residual) addArchiveAction(agent);
      }
    } catch (err) {
      errToast(err);
    } finally {
      loadingDetail = false;
    }
  }

  async function renderStore() {
    const id=selectedId, {programs}=await api('/api/programs');if(selectedId!==id)return;
    const list=programs.filter(p=>p.installable && agentsList.some(a=>a.programId===p.id));
    $('#agents-detail').innerHTML=`<div class="agd-head"><div><h3>Instalar agentes</h3><p class="listener-note">Herramientas del registro de Axon. Instalación global con pnpm, progreso y logs en vivo.</p></div></div><div class="view-tools"><input id="agent-store-search" class="filter-input" type="search" aria-label="Buscar en catálogo" placeholder="Buscar herramienta…"></div><div class="programs-grid">${list.map(p=>`<article class="program-card" data-store-name="${esc(p.name.toLowerCase())}"><strong>${esc(p.name)}</strong><p class="program-desc">${esc(p.desc||'')}</p><code>${esc(p.packageName)}</code><div class="program-actions">${p.installed?'<span class="program-ok">Instalado</span>':`<button class="btn-primary" data-store-install="${esc(p.id)}">${icon('download')} Instalar</button>`}</div></article>`).join('')}</div>`;
    $('#agent-store-search').addEventListener('input',e=>{$$('[data-store-name]').forEach(row=>row.hidden=!row.dataset.storeName.includes(e.target.value.trim().toLowerCase()));});
    $$('[data-store-install]').forEach(button=>button.addEventListener('click',async()=>{
      const p=list.find(p=>p.id===button.dataset.storeInstall);
      if(!(await confirmDialog('Instalar agente',`Se ejecuta pnpm add -g ${p.packageName} con el usuario del host.`, 'Instalar')))return;
      try{await AxonUI.busy(button,async()=>{const {job}=await api(`/api/programs/${p.id}/install`,{method:'POST'});openJobModal(job);});}catch(e){errToast(e);}
    }));refreshIcons();
  }
  async function renderArchives() {
    const id=selectedId;
    const [stored,pending]=await Promise.allSettled([api('/api/agent-archives'),api('/api/agent-residuals')]);
    if(selectedId!==id)return;
    const archives=stored.status==='fulfilled'?stored.value.archives:[];
    const residuals=pending.status==='fulfilled'?pending.value.residuals:[];
    const errors=[stored,pending].filter(r=>r.status==='rejected').map(r=>r.reason.message);
    $('#agents-detail').innerHTML=`<h3>Limpiar residuales</h3><p class="listener-note">Seleccioná varias configuraciones de agentes desinstalados y retiralas en un paso. Se conservan en un respaldo recuperable; archivar no libera espacio en disco.</p>${errors.map(error=>`<p role="alert" class="listener-note">${esc(error)}</p>`).join('')}
      <div class="residual-tools"><label><input type="checkbox" id="residual-all" ${residuals.some(r=>r.eligible)?'':'disabled'}> Seleccionar todos los disponibles</label><button class="btn-primary" id="residual-clean" disabled>${icon('archive')} Limpiar seleccionados <span id="residual-count">(0)</span></button></div>
      <div class="residual-list">${residuals.length?residuals.map(r=>`<label class="residual-item"><input type="checkbox" data-residual-id="${esc(r.id)}" ${r.eligible?'':'disabled'}><span><strong>${esc(r.name)}</strong><code>${esc(r.source)}</code><small>${r.eligible?esc(r.size||'Sin estimación'):esc(r.reason||'Esta carpeta no se puede retirar')}</small></span></label>`).join(''):'<p class="empty-state">No hay configuraciones residuales para limpiar.</p>'}</div>
      <p id="residual-result" role="status" aria-live="polite"></p>
      <h4>Respaldos recuperables (${archives.length})</h4><p class="listener-note">Restaurar devuelve la configuración original y nunca reemplaza una carpeta existente.</p>${archives.length?archives.map(a=>`<div class="ag-item"><div class="ag-item-body"><strong>${esc(a.name)}</strong><code class="ag-item-detail">${esc(a.source)}</code><small>${relTime(a.at)}</small></div><button class="btn-secondary" data-archive-restore="${esc(a.id)}">${icon('archive-restore')} Restaurar</button></div>`).join(''):'<p class="empty-state">No hay configuraciones archivadas.</p>'}`;
    const choices=()=>[...document.querySelectorAll('[data-residual-id]:not(:disabled)')];
    const selected=()=>choices().filter(c=>c.checked);
    const sync=()=>{const all=choices(),count=selected().length;$('#residual-count').textContent=`(${count})`;$('#residual-clean').disabled=!count;$('#residual-all').checked=!!all.length&&count===all.length;$('#residual-all').indeterminate=count>0&&count<all.length;};
    $('#residual-all').addEventListener('change',e=>{choices().forEach(c=>c.checked=e.target.checked);sync();});
    choices().forEach(c=>c.addEventListener('change',sync));
    $('#residual-clean').addEventListener('click',async e=>{
      const selectedRows=selected().map(c=>residuals.find(r=>r.id===c.dataset.residualId));
      if(!selectedRows.length)return;
      const detail=selectedRows.map(r=>`${r.name}: ${r.source} (${r.size||'Sin estimación'})`).join('\n');
      if(!(await confirmDialog(`Limpiar ${selectedRows.length} residuales`,`${detail}\n\nSe mueven a respaldos de Axon para poder restaurarlos.`, 'Limpiar seleccionados')))return;
      if(selectedId!==id)return;
      const button=e.currentTarget,controls=[$('#residual-all'),...choices()];controls.forEach(c=>c.disabled=true);
      try{
        const result=await AxonUI.busy(button,()=>api('/api/agent-residuals/archive',{method:'POST',body:{confirm:true,ids:selectedRows.map(r=>r.id)}}));
        await loadAgents({refreshDetail:false});
        if(selectedId===id){await renderArchives();$('#residual-result').textContent=`${result.archives.length} ${result.archives.length===1?'configuración archivada':'configuraciones archivadas'}.${result.failures.length?' '+result.failures.map(f=>`${f.name}: ${f.error}`).join(' · '):''}`;}
        toast(`${result.archives.length} residuales archivados`,result.failures.length?'error':'ok',result.failures.map(f=>`${f.name}: ${f.error}`).join('\n'));
      }catch(err){if(selectedId===id){controls.forEach(c=>c.disabled=false);sync();}errToast(err);}
    });
    $$('[data-archive-restore]').forEach(button=>button.addEventListener('click',async()=>{
      if(!(await confirmDialog('Restaurar configuración','Se devuelve la carpeta a su ubicación original.', 'Restaurar')))return;
      try{await AxonUI.busy(button,()=>api(`/api/agent-archives/${button.dataset.archiveRestore}/restore`,{method:'POST'}));toast('Configuración restaurada','ok');await loadAgents({refreshDetail:false});if(selectedId===id)await renderArchives();}catch(e){errToast(e);}
    }));refreshIcons();
  }
  async function archiveAgent(agent,button){
    try{
      const preview=await AxonUI.busy(button,()=>api(`/api/agents/${agent.id}/archive-preview`));
      if(!(await confirmDialog('Limpiar configuración residual',`${preview.source} (${preview.size}) se mueve a un respaldo de Axon. Podés restaurarla desde Limpiar residuales.`, 'Limpiar')))return;
      await AxonUI.busy(button,()=>api(`/api/agents/${agent.id}/archive`,{method:'POST',body:{confirm:true}}));
      await loadAgents({refreshDetail:false});toast('Configuración archivada','ok');selectAgent('__archives');
    }catch(e){errToast(e);}
  }
  function addArchiveAction(agent){
    const button=document.createElement('button');button.className='btn-secondary';button.innerHTML=`${icon('archive')} Limpiar configuración residual`;
    $('#agents-detail').prepend(button);refreshIcons();button.addEventListener('click',()=>archiveAgent(agent,button));
  }

  // ---------- global search ----------

  function onSearch(e) {
    railQuery = e.target.value.trim().toLowerCase();
    renderRail();
    const box = $('#agents-matches');
    clearTimeout(searchTimer);
    if (railQuery.length < 2) { box.classList.add('hidden'); return; }
    searchTimer = setTimeout(async () => {
      try {
        const query=railQuery;
        const { matches } = await api(`/api/agents-search?q=${encodeURIComponent(query)}`);
        if(query!==railQuery)return;
        if (!matches.length) { box.innerHTML = '<p class="ag-match-empty listener-note">Sin coincidencias</p>'; }
        else {
          box.innerHTML = matches.map((m) => `
            <button class="ag-match" data-agent="${esc(m.agent)}" data-kind="${esc(m.kind)}" data-key="${esc(m.key)}">
              <span class="badge badge-other">${esc(m.agentName)}</span>
              <span class="ag-match-name ${m.enabled ? '' : 'ag-off'}">${esc(m.name)}</span>
              <span class="ag-match-kind">${{ skill: 'skill', mcp: 'mcp', plugin: 'plugin', provider: 'provider' }[m.kind] || m.kind}</span>
            </button>`).join('');
          box.querySelectorAll('.ag-match').forEach((b) => b.addEventListener('click', () => {
            agSubTab = { skill: 'skill', mcp: 'mcp', plugin: 'plugin', provider: 'provider' }[b.dataset.kind] || 'skill';
            pendingHighlight = { kind: b.dataset.kind, key: b.dataset.key };
            box.classList.add('hidden');
            $('#agents-q').value = '';
            railQuery = '';
            renderRail();
            selectAgent(b.dataset.agent);
          }));
        }
        box.classList.remove('hidden');
      } catch { /* search is best-effort */ }
    }, 300);
  }

  function selectAgent(id) {
    if(window.AxonNavigation?.ready && !window.AxonNavigation.applying){
      void window.AxonNavigation.go(window.AxonNavigation.url('agents',{id,tab:agSubTab}),{view:{selectedId:id,agSubTab}});return;
    }
    selectedId = id;
    $('#ag-drawer')?.classList.add('hidden');
    $$('.agent-row').forEach((r) => r.classList.toggle('active', r.dataset.id === id));
    loadDetail(id);
  }

  // ---------- rail ----------

  function agentIcon(a) {
    const fb = icon(typeof lucideName === 'function' ? lucideName(a.icon, 'bot') : a.icon);
    // brandIcon when known; otherwise the resolver (vendored → host icon
    // theme → Simple Icons CDN → initials tile — always returns something)
    const src = a.brandIcon || `/api/brandicon/${encodeURIComponent(a.iconKey || a.id)}`;
    return `<img class="brand-svg" src="${esc(src)}" alt="" onerror="this.nextElementSibling.classList.remove('hidden'); this.remove()"><span class="hidden">${fb}</span>`;
  }

  function renderRail() {
    const rail = $('#agents-rail');
    const q = railQuery;
    const match = (a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q);
    const installed = agentsList.filter((a) => a.installed && !a.residual && match(a));
    const residual = agentsList.filter((a) => a.installed && a.residual && match(a));
    const missing = agentsList.filter((a) => !a.installed && match(a));
    rail.innerHTML = '';
    for (const a of [...installed, ...residual, ...missing]) {
      const el = document.createElement('button');
      el.className = `agent-row ${a.id === selectedId ? 'active' : ''} ${a.installed ? '' : 'agent-off'} ${a.residual ? 'agent-resid' : ''}`;
      el.dataset.id = a.id;
      const c = a.counts || {};
      const sub = !a.installed
        ? 'no detectado'
        : a.residual
          ? 'solo config (desinstalado?)'
          : [c.skills && `${c.skills} skills`, c.mcps && `${c.mcps} mcp`, c.plugins && `${c.plugins} plugins`].filter(Boolean).join(' · ') || 'sin items';
      const upd = a.latestVersion ? `<span class="agent-upd" title="${esc(a.version || '?')} → ${esc(a.latestVersion)}">${icon('arrow-up')}</span>` : '';
      const manual = a.custom ? `<span class="badge badge-node" title="Registrado manualmente">manual</span>` : '';
      const resid = a.residual ? `<span class="badge badge-bun" title="Hay config pero no binario ni .desktop">residual</span>` : '';
      const auth = a.auth ? `<span class="health-dot ${a.auth.loggedIn ? 'health-ok' : 'health-bad'}" title="${a.auth.loggedIn ? esc(a.auth.account || 'Sesión activa') : 'Sin sesión'}"></span>` : '';
      el.innerHTML = `
        <span class="agent-ic">${agentIcon(a)}</span>
        <span class="agent-row-body">
          <span class="agent-name">${esc(a.name)}${upd}${manual}${resid}</span>
          <span class="agent-sub">${esc(sub)}</span>
        </span>
        ${auth}`;
      el.addEventListener('click', () => selectAgent(a.id));
      if(a.residual){
        const wrap=document.createElement('div');wrap.className='agent-row-wrap';
        const quick=document.createElement('button');quick.className='icon-btn residual-quick';quick.dataset.residualQuick=a.id;quick.setAttribute('aria-label',`Limpiar residual de ${a.name}`);quick.title=`Limpiar residual de ${a.name}`;quick.innerHTML=icon('archive');quick.addEventListener('click',()=>archiveAgent(a,quick));wrap.append(el,quick);rail.append(wrap);
      }else rail.appendChild(el);
    }
    if (!installed.length && !residual.length && !missing.length && q) {
      rail.innerHTML = '<p class="agd-empty listener-note">Ningún agente coincide</p>';
    }

    // discovery candidates — dirs that look like agent configs but aren't
    // managed yet. "Registrar" promotes them to a full agent card.
    const cands = discoveredList.filter((c) => !q || c.name.toLowerCase().includes(q));
    if (cands.length) {
      const head = document.createElement('div');
      head.className = 'agents-rail-head';
      head.innerHTML = `${icon('radar')} Detectados en el host <span class="agd-count">${cands.length}</span>`;
      rail.appendChild(head);
      for (const c of cands) {
        const row = document.createElement('div');
        row.className = 'agent-row agent-disc';
        row.innerHTML = `
          <span class="agent-ic"><img class="brand-svg" src="/api/brandicon/${encodeURIComponent(c.name.replace(/^\.+/, '').toLowerCase())}" alt="" onerror="this.nextElementSibling.classList.remove('hidden'); this.remove()"><span class="hidden">${icon('scan-search')}</span></span>
          <span class="agent-row-body">
            <span class="agent-name">${esc(c.name)}${c.hasBin ? '<span class="badge badge-ok" title="Binario en PATH">bin</span>' : ''}</span>
            <span class="agent-sub" title="${esc(c.dir)}">${esc(c.dir.replace(/^\/home\/[^/]+\//, '~/'))} · ${esc(c.markers.join(' '))}</span>
          </span>
          <button class="icon-btn ag-disc-add" title="Registrar como agente">${icon('plus')}</button>
          <button class="icon-btn ag-disc-dismiss" title="Ignorar">${icon('x')}</button>`;
        row.querySelector('.ag-disc-add').addEventListener('click', async (e) => {
          e.stopPropagation();
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            await api('/api/agents-discovered/add', {
              method: 'POST',
              body: { name: c.name, dir: c.dir, bin: c.hasBin ? c.name : '' },
            });
            toast(`${c.name} registrado`, 'ok');
            loadAgents();
          } catch (err) { btn.disabled = false; errToast(err); }
        });
        row.querySelector('.ag-disc-dismiss').addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await api('/api/agents-discovered/dismiss', { method: 'POST', body: { dir: c.dir } });
            discoveredList = discoveredList.filter((x) => x.dir !== c.dir);
            renderRail();
          } catch (err) { errToast(err); }
        });
        rail.appendChild(row);
      }
    }

    const contextNav=document.createElement('div');contextNav.className='ctx-nav';rail.prepend(contextNav);
    for(const [id,name,description,ic] of [['__chats','Chats','Conversaciones por proyecto','messages-square'],['__memories','Memorias','Engram y memorias locales','brain'],['__store','Instalar agentes','Herramientas de IA','package'],['__archives','Limpiar residuales',`${agentsList.filter(a=>a.residual).length} detectados · selección múltiple`,'archive']]){
      const row=document.createElement('button');row.className=`agent-row ${selectedId===id?'active':''}`;row.dataset.id=id;
      row.innerHTML=`<span class="agent-ic">${icon(ic)}</span><span class="agent-row-body"><span class="agent-name">${name}</span><span class="agent-sub">${description}</span></span>`;row.addEventListener('click',()=>selectAgent(id));(id==='__chats'||id==='__memories'||id==='__archives'?contextNav:rail).append(row);
    }
    // pseudo-rows: matriz MCP×agente + documentos de instrucciones
    const matrixRow = document.createElement('button');
    matrixRow.className = `agent-row ${selectedId === '__matrix' ? 'active' : ''}`;
    matrixRow.dataset.id = '__matrix';
    matrixRow.innerHTML = `
      <span class="agent-ic">${icon('layout-grid')}</span>
      <span class="agent-row-body">
        <span class="agent-name">Matriz MCPs</span>
        <span class="agent-sub">qué server va en cada agente</span>
      </span>`;
    matrixRow.addEventListener('click', () => selectAgent('__matrix'));
    rail.appendChild(matrixRow);

    const docsRow = document.createElement('button');
    docsRow.className = `agent-row agent-docs-row ${selectedId === '__docs' ? 'active' : ''}`;
    docsRow.dataset.id = '__docs';
    docsRow.innerHTML = `
      <span class="agent-ic">${icon('file-text')}</span>
      <span class="agent-row-body">
        <span class="agent-name">Documentos</span>
        <span class="agent-sub">${docsCount != null ? `${docsCount} archivos` : 'AGENTS.md · reglas'}</span>
      </span>`;
    docsRow.addEventListener('click', () => selectAgent('__docs'));
    rail.appendChild(docsRow);
    refreshIcons();
  }

  // ---------- docs (AGENTS.md & reglas) ----------

  function renderDocs(docs, missing = []) {
    const box = $('#agents-detail');
    const groups = new Map();
    for (const d of docs) {
      const g = d.scope === 'global' ? 'Globales'
        : d.scope === 'cursor-rules' ? 'Cursor · reglas de usuario'
        : d.project || 'Proyectos';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(d);
    }
    const ordered = [...groups.entries()].sort((a, b) =>
      a[0] === 'Globales' ? -1 : b[0] === 'Globales' ? 1 : a[0].localeCompare(b[0]));
    const fmtSize = (n) => n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
    box.innerHTML = `
      <div class="agd-head">
        <span class="agent-ic agent-ic-lg">${icon('file-text')}</span>
        <div class="agd-title">
          <h3>Documentos de agentes</h3>
          <div class="agd-meta"><span>${docs.length} archivos — AGENTS.md, CLAUDE.md, reglas de Cursor, Copilot…</span></div>
        </div>
      </div>
      ${ordered.map(([g, list]) => `
        <div class="agd-sec">
          <div class="agd-sec-head">${icon('folder')}<h4>${esc(g)}</h4><span class="agd-count">${list.length}</span></div>
          <div class="agd-items">
            ${list.map((d) => `
              <div class="ag-item ag-doc">
                <div class="ag-item-body">
                  <span class="ag-item-name">${esc(d.name)} <span class="badge badge-other">${esc(d.agent)}</span>${fmtSize(d.size) ? `<span class="agd-size">${fmtSize(d.size)}</span>` : ''}</span>
                  <code class="ag-item-detail" title="${esc(d.path)}">${esc(d.path.replace(/^\/home\/[^/]+\//, '~/'))}</code>
                </div>
                <button class="icon-btn ag-doc-view" data-path="${esc(d.path)}" title="Ver">${icon('eye')}</button>
                <button class="icon-btn ag-doc-edit" data-path="${esc(d.path)}" title="Editar">${icon('pencil')}</button>
              </div>`).join('')}
          </div>
        </div>`).join('')}
      ${missing.length ? `
        <div class="agd-sec">
          <details class="ag-collapse">
            <summary>${icon('chevron-right')} Proyectos sin doc de agente <span class="agd-count">${missing.length}</span></summary>
            <p class="listener-note agd-sec-hint">Estos proyectos no tienen AGENTS.md / CLAUDE.md — creá uno para que los agentes entiendan el proyecto.</p>
            <div class="agd-items">
              ${missing.map((m) => `
                <div class="ag-item">
                  <div class="ag-item-body">
                    <span class="ag-item-name">${esc(m.name)}</span>
                    <code class="ag-item-detail" title="${esc(m.dir)}">${esc(m.dir.replace(/^\/home\/[^/]+\//, '~/'))}</code>
                  </div>
                  <button class="btn-action ag-doc-create" data-dir="${esc(m.dir)}">${icon('plus')} Crear AGENTS.md</button>
                </div>`).join('')}
            </div>
          </details>
        </div>` : ''}`;
    box.querySelectorAll('.ag-doc-view').forEach((b) => b.addEventListener('click', () => openMd(b.dataset.path, 'view')));
    box.querySelectorAll('.ag-doc-edit').forEach((b) => b.addEventListener('click', () => openMd(b.dataset.path, 'edit')));
    box.querySelectorAll('.ag-doc-create').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await api('/api/agent-docs/create', { method: 'POST', body: { dir: b.dataset.dir } });
        toast(`Creado ${r.path}`, 'ok');
        loadDetail('__docs', { silent: true });
      } catch (err) { b.disabled = false; errToast(err); }
    }));
    refreshIcons();
  }

  // ---------- MCP × agent matrix ----------

  function renderMatrix(agents, rows) {
    const box = $('#agents-detail');
    box.innerHTML = `
      <div class="agd-head">
        <span class="agent-ic agent-ic-lg">${icon('layout-grid')}</span>
        <div class="agd-title">
          <h3>Matriz de MCP servers</h3>
          <div class="agd-meta"><span>${rows.length} servers × ${agents.length} agentes — tocá una celda para activar/desactivar</span></div>
        </div>
      </div>
      <div class="ag-matrix-wrap">
        <table class="ag-matrix">
          <thead><tr>
            <th class="ag-mx-name">MCP server</th>
            ${agents.map((a) => `<th class="ag-mx-agent" title="${esc(a.name)}"><span class="agent-ic ag-mx-ic">${agentIcon(a)}</span><span>${esc(a.name)}</span></th>`).join('')}
          </tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td class="ag-mx-name"><span>${esc(r.name)}</span>${r.detail ? `<code title="${esc(r.detail)}">${esc(r.detail.slice(0, 42))}</code>` : ''}</td>
                ${agents.map((a) => {
                  const s = r.cells[a.id];
                  return `<td class="ag-mx-cell ${s ? `ag-mx-${s} ag-mx-tog` : 'ag-mx-na'}" ${s ? `data-agent="${a.id}" data-key="${esc(r.name)}" data-enabled="${s === 'on'}"` : ''} title="${s === 'on' ? 'Activo — click para desactivar' : s === 'off' ? 'Inactivo — click para activar' : 'No configurado'}">${s === 'on' ? icon('check') : s === 'off' ? icon('minus') : '·'}</td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    box.querySelectorAll('.ag-mx-tog').forEach((c) => c.addEventListener('click', async () => {
      const agent = c.dataset.agent, key = c.dataset.key, next = c.dataset.enabled !== 'true';
      c.classList.add('ag-mx-busy');
      try {
        await api(`/api/agents/${agent}/toggle`, { method: 'POST', body: { kind: 'mcp', key, enabled: next } });
        c.dataset.enabled = String(next);
        c.className = `ag-mx-cell ag-mx-tog ag-mx-${next ? 'on' : 'off'}`;
        c.innerHTML = next ? icon('check') : icon('minus');
        refreshIcons();
      } catch (err) {
        c.classList.remove('ag-mx-busy');
        errToast(err);
      }
    }));
    refreshIcons();
  }

  // ---------- markdown viewer / editor modal ----------

  let mdPath = null,mdRevision=null;

  function mdInline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function mdRender(src) {
    const out = [];
    let inPre = false;
    let list = [];
    const flush = () => { if (list.length) { out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join('')}</ul>`); list = []; } };
    for (const raw of esc(src).split('\n')) {
      if (/^```/.test(raw)) { flush(); out.push(inPre ? '</code></pre>' : '<pre class="md-pre"><code>'); inPre = !inPre; continue; }
      if (inPre) { out.push(raw + '\n'); continue; }
      const h = raw.match(/^(#{1,6})\s+(.*)/);
      if (h) { flush(); const n = Math.min(h[1].length + 1, 6); out.push(`<h${n}>${mdInline(h[2])}</h${n}>`); continue; }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(raw)) { flush(); out.push('<hr>'); continue; }
      const li = raw.match(/^\s*[-*]\s+(.*)/);
      if (li) { list.push(mdInline(li[1])); continue; }
      flush();
      if (raw.trim()) out.push(`<p>${mdInline(raw)}</p>`);
    }
    flush();
    if (inPre) out.push('</code></pre>');
    return out.join('');
  }

  function ensureMdModal() {
    if ($('#agmd-modal')) return;
    const el = document.createElement('div');
    el.id = 'agmd-modal';
    el.className = 'modal agmd hidden';
    el.innerHTML = `
      <div class="modal-content agmd-content">
        <div class="agmd-head">
          <div class="agmd-title">
            <h3 id="agmd-name"></h3>
            <code id="agmd-path"></code>
          </div>
          <div class="agmd-btns">
            <button class="btn-secondary agmd-mode" data-mode="view">${icon('eye')} Ver</button>
            <button class="btn-secondary agmd-mode" data-mode="edit">${icon('pencil')} Editar</button>
            <button class="icon-btn" id="agmd-close">${icon('x')}</button>
          </div>
        </div>
        <div class="agmd-body">
          <div id="agmd-view" class="agmd-view"></div>
          <textarea id="agmd-editor" class="agmd-editor hidden" spellcheck="false"></textarea>
        </div>
        <div class="modal-actions">
          <span id="agmd-status" class="listener-note"></span>
          <button class="btn-primary" id="agmd-save">${icon('save')} Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) el.classList.add('hidden'); });
    el.querySelector('#agmd-close').addEventListener('click', () => el.classList.add('hidden'));
    el.querySelectorAll('.agmd-mode').forEach((b) => b.addEventListener('click', () => setMdMode(b.dataset.mode)));
    el.querySelector('#agmd-save').addEventListener('click', saveMd);
  }

  function setMdMode(mode) {
    const isMd = /\.(md|mdc)$/i.test(mdPath || '');
    const view = $('#agmd-view'), editor = $('#agmd-editor');
    $('#agmd-modal .modal-actions').classList.toggle('hidden', mode !== 'edit');
    $('#agmd-modal .agmd-mode[data-mode="edit"]').classList.toggle('hidden', mode === 'edit');
    $('#agmd-modal .agmd-mode[data-mode="view"]').classList.toggle('hidden', mode === 'view' || !isMd);
    view.classList.toggle('hidden', mode === 'edit');
    editor.classList.toggle('hidden', mode !== 'edit');
    if (mode === 'edit') editor.focus();
  }

  async function openMd(path, mode = 'view') {
    ensureMdModal();
    mdPath = path;
    $('#agmd-name').textContent = path.split('/').pop();
    $('#agmd-path').textContent = path.replace(/^\/home\/[^/]+\//, '~/');
    $('#agmd-status').textContent = '';
    $('#agmd-modal').classList.remove('hidden');
    $('#agmd-view').innerHTML = '<p class="listener-note">Cargando…</p>';
    try {
      const { content,revision } = await api(`/api/files/read?path=${encodeURIComponent(path)}`);mdRevision=revision;
      $('#agmd-editor').value = content;
      $('#agmd-view').innerHTML = /\.(md|mdc)$/i.test(path) ? mdRender(content) : `<pre class="md-pre"><code>${esc(content)}</code></pre>`;
      setMdMode(mode);
      refreshIcons();
    } catch (err) {
      $('#agmd-view').innerHTML = `<p class="listener-note">No se pudo leer el archivo</p>`;
      errToast(err);
    }
  }

  async function saveMd() {
    const content = $('#agmd-editor').value;
    try {
      const result=await api('/api/files/write', { method: 'POST', body: { path: mdPath, content,revision:mdRevision } });mdRevision=result.revision;
      toast('Archivo guardado', 'ok');
      $('#agmd-status').textContent = 'Guardado';
      if (/\.(md|mdc)$/i.test(mdPath)) $('#agmd-view').innerHTML = mdRender(content);
      else $('#agmd-view').innerHTML = `<pre class="md-pre"><code>${esc(content)}</code></pre>`;
      setMdMode('view');
    } catch (err) { errToast(err); }
  }

  // ---------- detail ----------

  const KIND_META = {
    provider: { title: 'Cuentas, uso & providers', icon: 'key-round', addable: false },
    doc: { title: 'Doc', icon: 'file-text', addable: false },
    config: { title: 'Config', icon: 'settings-2', addable: false },
    skill: { title: 'Skills', icon: 'sparkles', addable: true },
    mcp: { title: 'MCP servers', icon: 'plug-zap', addable: true },
    plugin: { title: 'Plugins', icon: 'blocks', addable: false },
  };

  function renderDetail() {
    const a = selectedDetail;
    const box = $('#agents-detail');
    if (!a) return;
    const auth = a.auth;
    const multiAccount = ['codex', 'claude'].includes(a.id) && a.installed;
    const usagePanel = ['opencode', 'openchamber', 'devin'].includes(a.id) && a.installed;
    const updateBtn = a.latestVersion && a.programId
      ? `<button class="btn-primary agd-update" data-pid="${esc(a.programId)}">${icon('arrow-up-circle')} Actualizar → ${esc(a.latestVersion)}</button>`
      : a.programId ? `<button class="btn-secondary agd-update" data-pid="${esc(a.programId)}" title="Reinstalar / actualizar">${icon('arrow-up-circle')} Update</button>` : '';
    const removeBtn = a.custom
      ? `<button class="btn-secondary agd-remove" title="Quitar de Axon (no borra archivos)">${icon('trash-2')} Quitar</button>` : '';
    const loginBtn = auth?.canLogin && !auth.loggedIn
      ? `<button class="btn-action agd-auth" data-pid="${esc(a.programId)}" data-act="login">${icon('log-in')} Entrar</button>` : '';
    const logoutBtn = auth?.canLogout && auth.loggedIn
      ? `<button class="btn-action agd-auth" data-pid="${esc(a.programId)}" data-act="logout">${icon('log-out')} Salir</button>` : '';
    const hint = auth && !auth.loggedIn && !auth.canLogin && auth.loginHint
      ? `<span class="auth-hint" title="${esc(auth.loginHint)}">${icon('info')} cómo entrar</span>` : '';

    const notes = (a.notes || []).map((n) => `<p class="agd-note">${icon('info')} ${esc(n)}</p>`).join('');

    const groups = { provider: [], doc: [], config: [], skill: [], mcp: [], plugin: [] };
    for (const it of a.items || []) {
      // The account panel owns subscription identity; native config providers
      // remain visible, but must not display another profile as the active one.
      if (multiAccount && it.kind === 'provider' && !it.copyable && ['openai', 'anthropic'].includes(it.key)) continue;
      groups[it.kind]?.push(it);
    }

    // agent's global instruction doc → editable Doc tab
    const home = (a.configRoot || '').split('/').slice(0, 3).join('/');
    const docPath = AGENT_DOC[a.id] ? `${home}/${AGENT_DOC[a.id]}` : null;

    const secMap = {};
    for (const [kind, meta] of Object.entries(KIND_META)) {
      const items = groups[kind] || [];
      if (kind === 'config') {
        secMap[kind] = a.hasConfig
          ? `<div class="agd-sec"><div class="ag-set-list"><p class="agd-empty listener-note">Cargando config…</p></div><div class="ag-bk-list"></div></div>`
          : null;
        continue;
      }
      if (kind === 'doc') {
        if (!docPath) { secMap[kind] = null; continue; }
        secMap[kind] = `
          <div class="agd-sec">
            <div class="ag-item ag-doc">
              <div class="ag-item-body">
                <span class="ag-item-name">${esc(docPath.split('/').pop())} <span class="badge badge-other">${esc(a.name)}</span></span>
                <code class="ag-item-detail" title="${esc(docPath)}">${esc(docPath.replace(/^\/home\/[^/]+\//, '~/'))}</code>
                <span class="listener-note">Instrucciones globales que ${esc(a.name)} lee en cada sesión.</span>
              </div>
              <button class="icon-btn ag-doc-view" data-path="${esc(docPath)}" title="Ver">${icon('eye')}</button>
              <button class="icon-btn ag-doc-edit" data-path="${esc(docPath)}" title="Editar">${icon('pencil')}</button>
              <button class="btn-action ag-doc-new" data-path="${esc(docPath)}" data-agent="${esc(a.name)}" title="Crear si no existe">${icon('plus')} Crear</button>
            </div>
          </div>`;
        continue;
      }
      if (kind === 'provider' && !items.length && !auth && !multiAccount && !usagePanel) { secMap[kind] = null; continue; }
      if (kind === 'plugin' && !items.length) { secMap[kind] = null; continue; }
      // builtin/system skills collapse — they outnumber user skills and are
      // read-only noise (VS Code groups its built-in extensions the same way).
      let rows;
      if (kind === 'skill' && items.length > 6) {
        const sys = items.filter((i) => i.scope === 'sistema');
        const rest = items.filter((i) => i.scope !== 'sistema');
        rows = rest.map((it) => itemRow(it, kind)).join('')
          + (sys.length ? `
            <details class="ag-collapse">
              <summary>${icon('chevron-right')} Skills de sistema <span class="agd-count">${sys.length}</span></summary>
              ${sys.map((it) => itemRow(it, kind)).join('')}
            </details>` : '');
      } else {
        rows = items.map((it) => itemRow(it, kind)).join('');
      }
      const addBtn = meta.addable
        ? `<button class="btn-action agd-add" data-kind="${kind}">${icon('plus')} Agregar</button>` : '';
      const extra = kind === 'provider'
        ? multiAccount ? '<div class="ag-accounts" data-account-panel></div>' : `<div class="agd-authrow">${auth ? `<span class="health-dot ${auth.loggedIn ? 'health-ok' : 'health-bad'}"></span><span class="${auth.loggedIn ? 'auth-account' : 'listener-note'}">${auth.loggedIn ? esc(auth.account || 'Sesión activa') : 'Sin sesión'}</span>${loginBtn}${logoutBtn}${hint}` : ''}</div>${usagePanel ? '<div data-agent-usage-panel></div>' : ''}` : '';
      const addForm = kind === 'skill' ? `
        <div class="agd-form hidden" data-kind="skill">
          <input type="text" id="agf-skill-name" class="filter-input" placeholder="nombre-de-la-skill">
          <input type="text" id="agf-skill-desc" class="filter-input" placeholder="Descripción (cuándo usarla)">
          <button class="btn-primary agf-submit" data-kind="skill">${icon('plus')} Crear skill</button>
          <button class="btn-secondary agf-cancel">Cancelar</button>
        </div>` : kind === 'mcp' ? `
        <div class="agd-form hidden" data-kind="mcp">
          <input type="text" id="agf-mcp-name" class="filter-input" placeholder="nombre">
          <select id="agf-mcp-type" class="filter-input">
            <option value="url">Remoto (URL http)</option>
            <option value="cmd">Local (comando stdio)</option>
          </select>
          <input type="text" id="agf-mcp-url" class="filter-input" placeholder="https://…/mcp">
          <input type="text" id="agf-mcp-cmd" class="filter-input hidden" placeholder="comando (ej: npx)">
          <input type="text" id="agf-mcp-args" class="filter-input hidden" placeholder="args separados por espacio">
          ${(() => {
            const others = agentsList.filter((x) => x.installed && x.id !== a.id && x.id !== 'shared' && (x.counts?.mcps != null || x.hasConfig));
            return others.length ? `
              <div class="agf-props"><span class="listener-note">También en:</span>
                ${others.map((x) => `<label class="agf-prop"><input type="checkbox" value="${esc(x.id)}"> ${esc(x.name)}</label>`).join('')}
              </div>` : '';
          })()}
          <button class="btn-primary agf-submit" data-kind="mcp">${icon('plus')} Agregar MCP</button>
          <button class="btn-secondary agf-cancel">Cancelar</button>
        </div>` : '';
      const pluginHint = kind === 'plugin' && items.length
        ? `<span class="agd-sec-hint listener-note">los nuevos se instalan con el CLI del agente</span>` : '';
      const empty = !items.length && kind !== 'provider'
        ? `<p class="agd-empty listener-note">Nada por acá todavía</p>` : '';
      secMap[kind] = `
        <div class="agd-sec" data-kind="${kind}">
          <div class="agd-sec-head">
            ${icon(meta.icon)}<h4>${meta.title}</h4>
            <span class="agd-count">${items.length || ''}</span>
            ${pluginHint}
            <span class="agd-sec-actions">${addBtn}${kind === 'provider' && items.some((i) => i.copyable) ? `<button class="btn-action agd-check-provs" title="Probar todos los providers">${icon('activity')} Verificar</button>` : ''}</span>
          </div>
          ${extra}
          ${addForm}
          <div class="agd-items">${rows}${empty}</div>
        </div>`;
    }

    // Tab bar: Cuenta | Skills | MCPs | Plugins — keeps the detail short
    // instead of one long scroll. The chosen tab persists across agents.
    const consumptionPanel = ['codex', 'claude', 'opencode', 'openchamber', 'gemini', 'devin'].includes(a.id);
    if (consumptionPanel) secMap.consumption = '<div data-agent-consumption-panel></div>';
    const TAB_ORDER = ['provider', 'consumption', 'doc', 'config', 'skill', 'mcp', 'plugin'];
    const TAB_LABEL = { provider: 'Cuenta y uso', consumption: 'Consumo', doc: 'Doc', config: 'Config', skill: 'Skills', mcp: 'MCPs', plugin: 'Plugins' };
    const visible = TAB_ORDER.filter((k) => secMap[k]);
    const active = visible.includes(agSubTab) ? agSubTab : 'skill';
    const tabsHtml = `
      <div class="agd-tabs">
        ${visible.map((k) => `
          <button class="agd-tab ${k === active ? 'active' : ''}" data-agtab="${k}">
            ${icon(k === 'consumption' ? 'chart-no-axes-combined' : KIND_META[k].icon)} ${TAB_LABEL[k]}
            <span class="agd-tab-count">${groups[k]?.length || ''}</span>
          </button>`).join('')}
      </div>`;
    const panesHtml = visible.map((k) =>
      `<div class="agd-pane ${k === active ? 'active' : ''}" data-agtab="${k}">${secMap[k]}</div>`).join('');

    box.innerHTML = `
      <div class="agd-head">
        <span class="agent-ic agent-ic-lg">${agentIcon(a)}</span>
        <div class="agd-title">
          <h3>${esc(a.name)}</h3>
          <div class="agd-meta">
            ${a.version ? `<span>${esc(a.version)}</span>` : ''}
            <code class="agd-path" title="Carpeta de config">${esc(a.configRoot)}</code>
          </div>
        </div>
        <div class="agd-actions">${updateBtn}${removeBtn}</div>
      </div>
      ${notes}
      ${tabsHtml}
      ${panesHtml}`;
    wireDetail(box);
    if (active === 'consumption') mountConsumption(box);
    if (multiAccount) window.AxonAgentAccounts.mount(box.querySelector('[data-account-panel]'), a.id);
    else if (usagePanel) void window.AxonAgentUsage.mount(box.querySelector('[data-agent-usage-panel]'), a.id);
    refreshIcons();
  }

  function itemRow(it, kind) {
    const toggle = it.toggleable
      ? `<button class="ag-toggle ${it.enabled ? 'on' : ''}" data-key="${esc(it.key)}" data-kind="${kind}" data-enabled="${it.enabled}" title="${it.enabled ? 'Desactivar' : 'Activar'}"><span></span></button>`
      : '<span class="ag-toggle-none"></span>';
    const view = it.file
      ? `<button class="icon-btn ag-view" data-path="${esc(it.file)}" title="Ver / editar archivo">${icon('eye')}</button>` : '';
    const del = it.deletable
      ? `<button class="icon-btn ag-del" data-key="${esc(it.key)}" data-kind="${kind}" title="Borrar">${icon('trash-2')}</button>` : '';
    const linked = it.linked ? `<span class="badge badge-node" title="${esc(it.linked)}">link</span>` : '';
    const scope = it.scope ? `<span class="badge badge-other">${esc(it.scope)}</span>` : '';
    const hId = `${selectedId}:${it.key}`;
    const hClass = healthState[hId] === 'ok' ? 'health-ok' : healthState[hId] === 'bad' ? 'health-bad' : healthState[hId] === 'loading' ? 'health-wait' : 'health-mut';
    const health = it.url
      ? `<button class="icon-btn ag-health" data-key="${esc(it.key)}" title="Chequear ${esc(it.url)}"><span class="health-dot ${hClass}"></span></button>` : '';
    // providers: dot = last health probe, copy = clone config+key to another agent
    const ph = kind === 'provider' ? provHealth[`${selectedId}:${it.key}`] : undefined;
    const phClass = !ph ? 'health-mut' : ph.state === 'ok' ? 'health-ok' : ph.state === 'bad' ? 'health-bad' : 'health-wait';
    const phTitle = ph ? `${ph.msg}${ph.ms ? ` · ${ph.ms}ms` : ''} — click para re-chequear` : 'Probar si el provider responde';
    const provBtns = kind === 'provider' && it.copyable
      ? `<button class="icon-btn ag-prov-health" data-key="${esc(it.key)}" title="${esc(phTitle)}"><span class="health-dot ${phClass}"></span></button>
         <button class="icon-btn ag-prov-copy" data-key="${esc(it.key)}" title="Copiar provider a otro agente">${icon('copy')}</button>` : '';
    return `
      <div class="ag-item ${it.enabled ? '' : 'ag-off'} ag-item-click" data-kind="${kind}" data-key="${esc(it.key)}" title="Click para ver detalle">
        ${toggle}
        <div class="ag-item-body">
          <span class="ag-item-name">${esc(it.name)} ${linked}${scope}</span>
          ${it.desc ? `<span class="ag-item-desc">${esc(it.desc)}</span>` : ''}
          ${it.detail ? `<code class="ag-item-detail" title="${esc(it.detail)}">${esc(it.detail)}</code>` : ''}
        </div>
        ${provBtns}
        ${health}
        ${view}
        ${del}
      </div>`;
  }

  function mountConsumption(box) {
    const host = box.querySelector('[data-agent-consumption-panel]');
    if (host && !host.dataset.mounted) { host.dataset.mounted = 'true'; void window.AxonAgentConsumption.mount(host, selectedId); }
  }

  function wireDetail(box) {
    box.querySelectorAll('.agd-tab').forEach((t) => t.addEventListener('click', () => {
      agSubTab = t.dataset.agtab;
      box.querySelectorAll('.agd-tab').forEach((x) => x.classList.toggle('active', x.dataset.agtab === agSubTab));
      box.querySelectorAll('.agd-pane').forEach((x) => x.classList.toggle('active', x.dataset.agtab === agSubTab));
      if (agSubTab === 'config') { loadSettings(box); loadBackups(box); }
      if (agSubTab === 'consumption') mountConsumption(box);
    }));

    // if the agent opened straight into the config tab (persisted choice)
    if (box.querySelector('.agd-tab.active')?.dataset.agtab === 'config') { loadSettings(box); loadBackups(box); }

    // flash+scroll to the item the global search jumped to
    if (pendingHighlight) {
      const { kind, key } = pendingHighlight;
      pendingHighlight = null;
      const el = box.querySelector(`.ag-item-click[data-kind="${kind}"][data-key="${CSS.escape(key)}"]`);
      if (el) {
        el.closest('details')?.setAttribute('open', '');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('ag-flash');
        setTimeout(() => el.classList.remove('ag-flash'), 1800);
      }
    }

    box.querySelectorAll('.ag-view').forEach((v) =>
      v.addEventListener('click', (e) => { e.stopPropagation(); openMd(v.dataset.path, 'view'); }));
    box.querySelectorAll('.ag-doc-view').forEach((v) =>
      v.addEventListener('click', () => openMd(v.dataset.path, 'view')));
    box.querySelectorAll('.ag-doc-edit').forEach((v) =>
      v.addEventListener('click', () => openMd(v.dataset.path, 'edit')));
    box.querySelectorAll('.ag-doc-new').forEach((v) => v.addEventListener('click', async () => {
      try {
        await api('/api/files/write', { method: 'POST', body: { path: v.dataset.path,revision:'missing', content: `# Reglas globales — ${v.dataset.agent}\n\n## Contexto\n\n## Convenciones\n\n` } });
        toast('Doc creado', 'ok');
        openMd(v.dataset.path, 'edit');
      } catch (err) { errToast(err); }
    }));

    // item drawer — click anywhere on the row that's not a control
    box.querySelectorAll('.ag-item-click').forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const it = (selectedDetail?.items || []).find((x) => x.kind === row.dataset.kind && x.key === row.dataset.key);
      if (it) openDrawer(it, row.dataset.kind);
    }));

    // remote MCP health check
    box.querySelectorAll('.ag-health').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = b.dataset.key, hId = `${selectedId}:${key}`;
      healthState[hId] = 'loading';
      b.querySelector('.health-dot').className = 'health-dot health-wait';
      try {
        const r = await api(`/api/agents/${selectedId}/mcp-health`, { method: 'POST', body: { key } });
        healthState[hId] = r.alive ? 'ok' : 'bad';
        b.querySelector('.health-dot').className = `health-dot ${r.alive ? 'health-ok' : 'health-bad'}`;
        b.title = `HTTP ${r.code} · ${r.ms}ms — ${r.url}`;
        toast(`${key}: HTTP ${r.code} (${r.ms}ms)`, r.alive ? 'ok' : 'error');
      } catch (err) {
        healthState[hId] = 'bad';
        b.querySelector('.health-dot').className = 'health-dot health-bad';
        errToast(err);
      }
    }));

    // provider health probe — pings the provider's /models endpoint
    box.querySelectorAll('.ag-prov-health').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = b.dataset.key, hId = `${selectedId}:${key}`;
      b.querySelector('.health-dot').className = 'health-dot health-wait';
      try {
        const r = await api(`/api/agents/${selectedId}/providers/${encodeURIComponent(key)}/check`, { method: 'POST' });
        provHealth[hId] = r.check;
        b.querySelector('.health-dot').className = `health-dot ${r.check.state === 'ok' ? 'health-ok' : r.check.state === 'bad' ? 'health-bad' : 'health-wait'}`;
        b.title = `${r.check.msg}${r.check.ms ? ` · ${r.check.ms}ms` : ''}`;
        toast(`${key}: ${r.check.msg}`, r.check.state === 'ok' ? 'ok' : 'error');
      } catch (err) { errToast(err); }
    }));

    // copy provider to another agent — inline target picker under the row
    box.querySelectorAll('.ag-prov-copy').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = b.closest('.ag-item');
      row.querySelector('.ag-prov-menu')?.remove();
      const targets = agentsList.filter((x) => x.installed && !x.residual && x.id !== selectedId && x.provWritable && x.id !== 'shared');
      if (!targets.length) { toast('Ningún otro agente instalado soporta providers', 'error'); return; }
      const menu = document.createElement('div');
      menu.className = 'ag-prov-menu';
      menu.innerHTML = `<p class="ag-prov-menu-title listener-note">Copiar "${esc(b.dataset.key)}" a…</p>` +
        targets.map((x) => `<button class="ag-prov-target" data-id="${esc(x.id)}">${esc(x.name)}${x.residual ? ' <span class="badge badge-bun">residual</span>' : ''}</button>`).join('');
      row.appendChild(menu);
      menu.querySelectorAll('.ag-prov-target').forEach((t) => t.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const targetName = t.textContent.trim();
        menu.remove();
        if(!(await confirmDialog('Compartir credencial', `Se copia el provider ${b.dataset.key} a ${targetName}. Si ya existe, se actualiza su configuración y queda un respaldo. La key se transmite entre archivos en el servidor.`, 'Compartir')))return;
        try {
          const r = await api(`/api/agents/${selectedId}/providers/${encodeURIComponent(b.dataset.key)}/copy`, { method: 'POST', body: { target: t.dataset.id } });
          toast(`${b.dataset.key} → ${targetName}${r.note ? ` — ${r.note}` : ''}`, 'ok');
        } catch (err) { errToast(err); }
      }));
      const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
      setTimeout(() => document.addEventListener('click', close), 0);
    }));

    // "Verificar" — probe every copyable provider in this agent at once
    box.querySelector('.agd-check-provs')?.addEventListener('click', async () => {
      const provs = (selectedDetail?.items || []).filter((i) => i.kind === 'provider' && i.copyable);
      await Promise.all(provs.map(async (it) => {
        const dot = box.querySelector(`.ag-prov-health[data-key="${CSS.escape(it.key)}"]`);
        dot?.querySelector('.health-dot')?.classList.replace('health-mut', 'health-wait');
        try {
          const r = await api(`/api/agents/${selectedId}/providers/${encodeURIComponent(it.key)}/check`, { method: 'POST' });
          provHealth[`${selectedId}:${it.key}`] = r.check;
          if (dot) dot.querySelector('.health-dot').className = `health-dot ${r.check.state === 'ok' ? 'health-ok' : r.check.state === 'bad' ? 'health-bad' : 'health-wait'}`;
        } catch { /* per-provider errors land on the dot via state */ }
      }));
      const bad = provs.filter((it) => provHealth[`${selectedId}:${it.key}`]?.state === 'bad').length;
      const okn = provs.filter((it) => provHealth[`${selectedId}:${it.key}`]?.state === 'ok').length;
      toast(`Providers: ${okn} ok${bad ? `, ${bad} con error` : ''}`, bad ? 'error' : 'ok');
    });

    // preload cached health results so dots show the last known state
    if ((selectedDetail?.items || []).some((i) => i.kind === 'provider' && i.copyable)) {
      api(`/api/agents/${selectedId}/providers`).then((r) => {
        for (const p of r.providers || []) {
          if (!p.health) continue;
          provHealth[`${selectedId}:${p.key}`] = p.health;
          const dot = box.querySelector(`.ag-prov-health[data-key="${CSS.escape(p.key)}"] .health-dot`);
          if (dot) dot.className = `health-dot ${p.health.state === 'ok' ? 'health-ok' : p.health.state === 'bad' ? 'health-bad' : 'health-wait'}`;
        }
      }).catch(() => {});
    }

    box.querySelector('.agd-remove')?.addEventListener('click', async () => {
      const ok = await confirmDialog('Quitar agente', `Se quita "${selectedDetail?.name}" del panel. Sus archivos en disco no se tocan.`, 'Quitar');
      if (!ok) return;
      try {
        await api('/api/agents-discovered/remove', { method: 'POST', body: { id: selectedId } });
        toast('Agente quitado', 'ok');
        selectedId = null;
        selectedDetail = null;
        loadAgents();
        $('#agents-detail').innerHTML = `<div class="agents-placeholder">${icon('bot')}<p>Elegí un agente, Chats o Memorias para ver su contenido.</p></div>`;
        refreshIcons();
      } catch (err) { errToast(err); }
    });
    box.querySelector('.agd-update')?.addEventListener('click', async (e) => {
      const pid = e.currentTarget.dataset.pid;
      try {
        const { job } = await api(`/api/programs/${pid}/update`, { method: 'POST' });
        openJobModal(job);
      } catch (err) { errToast(err); }
    });
    box.querySelectorAll('.agd-auth').forEach((b) => b.addEventListener('click', async () => {
      try {
        const { job } = await api(`/api/programs/${b.dataset.pid}/${b.dataset.act}`, { method: 'POST' });
        openJobModal(job);
        if (b.dataset.act === 'login') toast('Seguí el log del job: ahí aparece la URL o código', 'ok');
      } catch (err) { errToast(err); }
    }));

    box.querySelectorAll('.ag-toggle').forEach((t) => t.addEventListener('click', async () => {
      const key = t.dataset.key, kind = t.dataset.kind, next = t.dataset.enabled !== 'true';
      t.classList.toggle('on', next);
      t.closest('.ag-item')?.classList.toggle('ag-off', !next);
      try {
        await api(`/api/agents/${selectedId}/toggle`, { method: 'POST', body: { kind, key, enabled: next } });
        t.dataset.enabled = String(next);
      } catch (err) {
        t.classList.toggle('on', !next);
        t.closest('.ag-item')?.classList.toggle('ag-off', next);
        errToast(err);
      }
    }));

    box.querySelectorAll('.ag-del').forEach((d) => d.addEventListener('click', async () => {
      const key = d.dataset.key, kind = d.dataset.kind;
      const label = { skill: 'skill', mcp: 'MCP', plugin: 'plugin' }[kind] || 'item';
      const warn = kind === 'skill' && selectedId === 'shared'
        ? ' Es una skill compartida: se borra para TODOS los agentes.' : '';
      const okDel = await confirmDialog(`Borrar ${label}`, `Se elimina "${key}" de ${selectedDetail?.name}.${warn}`, 'Borrar');
      if (!okDel) return;
      try {
        await api(`/api/agents/${selectedId}/delete`, { method: 'POST', body: { kind, key } });
        toast(`${label} eliminado`, 'ok');
        loadDetail(selectedId, { silent: true });
        loadAgents();
      } catch (err) { errToast(err); }
    }));

    box.querySelectorAll('.agd-add').forEach((b) => b.addEventListener('click', () => {
      box.querySelectorAll('.agd-form').forEach((f) => f.classList.toggle('hidden', f.dataset.kind !== b.dataset.kind || !f.classList.contains('hidden')));
      box.querySelector('.agd-form:not(.hidden) input')?.focus();
    }));
    box.querySelectorAll('.agf-cancel').forEach((b) => b.addEventListener('click', () => {
      b.closest('.agd-form')?.classList.add('hidden');
    }));
    box.querySelector('#agf-mcp-type')?.addEventListener('change', (e) => {
      const isUrl = e.target.value === 'url';
      box.querySelector('#agf-mcp-url').classList.toggle('hidden', !isUrl);
      box.querySelector('#agf-mcp-cmd').classList.toggle('hidden', isUrl);
      box.querySelector('#agf-mcp-args').classList.toggle('hidden', isUrl);
    });
    box.querySelectorAll('.agf-submit').forEach((b) => b.addEventListener('click', async () => {
      try {
        if (b.dataset.kind === 'skill') {
          const name = box.querySelector('#agf-skill-name').value.trim();
          const desc = box.querySelector('#agf-skill-desc').value.trim();
          if (!name) return toast('Falta el nombre de la skill', 'error');
          await api(`/api/agents/${selectedId}/add-skill`, { method: 'POST', body: { name, desc } });
          toast('Skill creada', 'ok');
        } else {
          const name = box.querySelector('#agf-mcp-name').value.trim();
          const isUrl = box.querySelector('#agf-mcp-type').value === 'url';
          const url = isUrl ? box.querySelector('#agf-mcp-url').value.trim() : '';
          const command = isUrl ? '' : box.querySelector('#agf-mcp-cmd').value.trim();
          const args = isUrl ? '' : box.querySelector('#agf-mcp-args').value.trim();
          if (!name) return toast('Falta el nombre del MCP', 'error');
          await api(`/api/agents/${selectedId}/add-mcp`, { method: 'POST', body: { name, url, command, args } });
          // propagate to the other checked agents — same name+config, their
          // own file format
          const targets = [...box.querySelectorAll('.agf-prop input:checked')].map((i) => i.value);
          let fails = 0;
          for (const t of targets) {
            try { await api(`/api/agents/${t}/add-mcp`, { method: 'POST', body: { name, url, command, args } }); }
            catch { fails++; }
          }
          toast(`MCP agregado${targets.length ? ` en ${selectedDetail?.name} +${targets.length - fails}/${targets.length} agentes` : ''}`, fails ? 'error' : 'ok');
        }
        loadDetail(selectedId, { silent: true });
        loadAgents();
      } catch (err) { errToast(err); }
    }));
  }

  // ---------- item drawer ----------

  function ensureDrawer() {
    if ($('#ag-drawer')) return;
    const d = document.createElement('div');
    d.id = 'ag-drawer';
    d.className = 'modal ag-account-modal hidden';
    document.body.appendChild(d);
    d.addEventListener('click', (e) => { if (e.target.closest('.ag-drawer-close')) d.classList.add('hidden'); });
  }

  function openDrawer(it, kind) {
    ensureDrawer();
    const d = $('#ag-drawer');
    const kindLabel = { skill: 'Skill', mcp: 'MCP server', plugin: 'Plugin', provider: 'Provider' }[kind] || kind;
    const hId = `${selectedId}:${it.key}`;
    const health = it.url
      ? `<button class="btn-secondary agd-health" data-key="${esc(it.key)}">${icon('activity')} Chequear <span class="health-dot ${healthState[hId] === 'ok' ? 'health-ok' : healthState[hId] === 'bad' ? 'health-bad' : 'health-mut'}"></span></button>` : '';
    const rawRows = it.raw
      ? Object.entries(it.raw).map(([k, v]) => `
          <div class="agd-raw-row">
            <span class="agd-raw-key">${esc(k)}</span>
            <code class="agd-raw-val">${esc(Array.isArray(v) ? v.join(', ') || '(vacío)' : typeof v === 'object' ? JSON.stringify(v) : String(v))}</code>
          </div>`).join('')
      : '';
    d.innerHTML = `
      <div class="modal-content ag-account-content"><div class="ag-drawer-head">
        <div class="ag-drawer-title">
          <h3>${esc(it.name)}</h3>
          <div class="ag-drawer-badges">
            <span class="badge badge-other">${kindLabel}</span>
            ${it.scope ? `<span class="badge badge-other">${esc(it.scope)}</span>` : ''}
            ${it.linked ? `<span class="badge badge-node" title="${esc(it.linked)}">link</span>` : ''}
            <span class="badge ${it.enabled ? 'badge-ok' : 'badge-off'}">${it.enabled ? 'activo' : 'inactivo'}</span>
          </div>
        </div>
        <button class="icon-btn ag-drawer-close">${icon('x')}</button>
      </div>
      <div class="ag-drawer-body">
        ${it.desc ? `<p class="ag-item-desc">${esc(it.desc)}</p>` : ''}
        ${it.detail ? `<div class="agd-raw-row"><span class="agd-raw-key">${it.url ? 'url' : 'destino'}</span><code class="agd-raw-val">${esc(it.detail)}</code></div>` : ''}
        ${it.linked ? `<div class="agd-raw-row"><span class="agd-raw-key">link →</span><code class="agd-raw-val">${esc(it.linked)}</code></div>` : ''}
        ${it.file ? `<div class="agd-raw-row"><span class="agd-raw-key">archivo</span><code class="agd-raw-val">${esc(it.file.replace(/^\/home\/[^/]+\//, '~/'))}</code></div>` : ''}
        ${rawRows ? `<div class="agd-raw-title">Config</div>${rawRows}` : ''}
      </div>
      <div class="ag-drawer-actions">
        ${it.toggleable ? `<button class="btn-secondary agd-tog" data-enabled="${it.enabled}">${icon('power')} ${it.enabled ? 'Desactivar' : 'Activar'}</button>` : ''}
        ${health}
        ${it.file ? `<button class="btn-secondary agd-open" data-path="${esc(it.file)}">${icon('file-text')} Abrir archivo</button>` : ''}
        ${it.deletable ? `<button class="btn-secondary agd-del">${icon('trash-2')} Borrar</button>` : ''}
      </div></div>`;
    d.classList.remove('hidden');
    refreshIcons();

    d.querySelector('.agd-tog')?.addEventListener('click', async (b) => {
      const next = b.target.closest('button').dataset.enabled !== 'true';
      try {
        await api(`/api/agents/${selectedId}/toggle`, { method: 'POST', body: { kind, key: it.key, enabled: next } });
        it.enabled = next;
        toast(`${it.name} ${next ? 'activado' : 'desactivado'}`, 'ok');
        loadDetail(selectedId, { silent: true });
        openDrawer(it, kind);
      } catch (err) { errToast(err); }
    });
    d.querySelector('.agd-health')?.addEventListener('click', async (b) => {
      const btn = b.target.closest('button');
      healthState[hId] = 'loading';
      try {
        const r = await api(`/api/agents/${selectedId}/mcp-health`, { method: 'POST', body: { key: it.key } });
        healthState[hId] = r.alive ? 'ok' : 'bad';
        toast(`HTTP ${r.code} · ${r.ms}ms`, r.alive ? 'ok' : 'error');
        openDrawer(it, kind);
        loadDetail(selectedId, { silent: true });
      } catch (err) { healthState[hId] = 'bad'; errToast(err); }
    });
    d.querySelector('.agd-open')?.addEventListener('click', (b) => openMd(b.target.closest('button').dataset.path, 'view'));
    d.querySelector('.agd-del')?.addEventListener('click', async () => {
      const label = { skill: 'skill', mcp: 'MCP', plugin: 'plugin' }[kind] || 'item';
      const warn = kind === 'skill' && selectedId === 'shared' ? ' Es compartida: se borra para TODOS.' : '';
      const okDel = await confirmDialog(`Borrar ${label}`, `Se elimina "${it.key}" de ${selectedDetail?.name}.${warn}`, 'Borrar');
      if (!okDel) return;
      try {
        await api(`/api/agents/${selectedId}/delete`, { method: 'POST', body: { kind, key: it.key } });
        d.classList.add('hidden');
        toast(`${label} eliminado`, 'ok');
        loadDetail(selectedId, { silent: true });
        loadAgents();
      } catch (err) { errToast(err); }
    });
  }

  // ---------- backups (.axonbak) ----------

  async function loadBackups(box) {
    const list = box.querySelector('.agd-pane[data-agtab="config"] .ag-bk-list');
    if (!list) return;
    try {
      const { backups } = await api(`/api/agents/${selectedId}/backups`);
      if (!backups.length) return;
      list.innerHTML = `
        <div class="agd-sec-head">${icon('history')}<h4>Backups</h4><span class="agd-count">${backups.length}</span></div>
        ${backups.map((b) => `
          <div class="ag-set-row">
            <span class="ag-set-key" title="${esc(b.path)}">${esc(b.source.replace(/^\/home\/[^/]+\//, '~/'))}</span>
            <span class="listener-note">${new Date(b.mtime).toLocaleString()} · ${b.size > 1024 ? (b.size / 1024).toFixed(1) + ' KB' : b.size + ' B'}</span>
            <button class="btn-action ag-bk-restore" data-path="${esc(b.path)}">${icon('undo-2')} Restaurar</button>
          </div>`).join('')}`;
      list.querySelectorAll('.ag-bk-restore').forEach((btn) => btn.addEventListener('click', async () => {
        const ok = await confirmDialog('Restaurar backup', `Se sobrescribe el config actual con ${btn.dataset.path.split('/').pop()}`, 'Restaurar');
        if (!ok) return;
        try {
          await api(`/api/agents/${selectedId}/restore-backup`, { method: 'POST', body: { path: btn.dataset.path } });
          toast('Config restaurada', 'ok');
          settingsCache[selectedId] = null;
          loadSettings(box);
          loadBackups(box);
        } catch (err) { errToast(err); }
      }));
      refreshIcons();
    } catch { /* backups are optional */ }
  }

  // ---------- visual settings (Config tab) ----------

  async function loadSettings(box) {
    const id = selectedId;
    const list = box.querySelector('.agd-pane[data-agtab="config"] .ag-set-list');
    if (!list) return;
    if (!settingsCache[id]) {
      try {
        settingsCache[id] = await api(`/api/agents/${id}/settings`);
      } catch (err) {
        list.innerHTML = '<p class="agd-empty listener-note">No se pudo cargar la config</p>';
        return;
      }
    }
    renderSettings(list, settingsCache[id]);
  }

  function renderSettings(list, s) {
    const secrets = s.entries.filter((e) => e.type === 'secret');
    const normals = s.entries.filter((e) => e.type !== 'secret');
    const rowHtml = (e) => {
      const label = e.label || e.key;
      const keySub = e.key !== label || e.key.includes('.')
        ? `<code class="ag-set-sub" title="${esc(e.key)}">${esc(e.key)}${e.key.includes('.') ? ' <span class="badge badge-node">anidado</span>' : ''}</code>` : '';
      const desc = e.desc ? `<span class="ag-set-desc listener-note">${esc(e.desc)}</span>` : '';
      const keyCell = `<span class="ag-set-key">${esc(label)}${keySub}${desc}</span>`;
      if (e.type === 'complex') {
        return `<div class="ag-set-row ag-off">${keyCell}<span class="badge badge-other">objeto</span></div>`;
      }
      if (e.type === 'secret') {
        return `<div class="ag-set-row">${keyCell}
          <span class="ag-set-ctl">
            <input type="password" class="filter-input ag-set-in" data-key="${esc(e.key)}" data-type="string" placeholder="•••••••• — escribí para reemplazar" autocomplete="new-password">
            <button class="icon-btn ag-set-save hidden" data-key="${esc(e.key)}" title="Guardar">${icon('check')}</button>
          </span></div>`;
      }
      // bool with extra union options (e.g. opencode autoupdate: true|false|'notify')
      // → a select is more expressive than a toggle
      const cur = String(e.value ?? '');
      const plainBool = !e.options || e.options.every((o) => o === 'true' || o === 'false');
      if (e.type === 'bool' && plainBool) {
        return `<div class="ag-set-row">${keyCell}
          <button class="ag-toggle ${e.value ? 'on' : ''} ag-set-bool" data-key="${esc(e.key)}" data-val="${e.value}"><span></span></button></div>`;
      }
      if (e.options?.length) {
        const opts = [...new Set([cur, ...e.options])];
        return `<div class="ag-set-row">${keyCell}
          <select class="filter-input ag-set-sel" data-key="${esc(e.key)}" data-type="${e.type}" data-cur="${esc(cur)}">
            ${opts.map((o) => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(o === '' ? '(vacío)' : o)}</option>`).join('')}
          </select></div>`;
      }
      if (e.type === 'bool') {
        return `<div class="ag-set-row">${keyCell}
          <button class="ag-toggle ${e.value ? 'on' : ''} ag-set-bool" data-key="${esc(e.key)}" data-val="${e.value}"><span></span></button></div>`;
      }
      return `<div class="ag-set-row">${keyCell}
        <span class="ag-set-ctl">
          <input type="text" class="filter-input ag-set-in" data-key="${esc(e.key)}" data-type="${e.type}" value="${esc(String(e.value ?? ''))}">
          <button class="icon-btn ag-set-save hidden" data-key="${esc(e.key)}" title="Guardar">${icon('check')}</button>
        </span></div>`;
    };
    list.innerHTML = `
      <div class="ag-set-file">
        <code class="agd-path" title="Archivo de config">${esc(s.file.replace(/^\/home\/[^/]+\//, '~/'))}</code>
        <button class="btn-action ag-set-open">${icon('file-text')} Abrir archivo</button>
      </div>
      ${normals.map(rowHtml).join('')}
      ${secrets.length ? `
        <div class="agd-sec-head ag-cred-head">${icon('key-round')}<h4>Credenciales</h4><span class="agd-count">${secrets.length}</span>
          <span class="listener-note agd-sec-hint">nunca se muestran — escribí para reemplazar</span></div>
        ${secrets.map(rowHtml).join('')}
        <div class="ag-set-row ag-cred-add">
          <input type="text" class="filter-input" id="ag-cred-key" placeholder="key (ej: provider.x.apiKey)">
          <input type="password" class="filter-input" id="ag-cred-val" placeholder="valor" autocomplete="new-password">
          <button class="btn-action" id="ag-cred-save">${icon('plus')} Agregar</button>
        </div>` : ''}`;

    const saveKey = async (key, value) => {
      await api(`/api/agents/${selectedId}/settings`, { method: 'POST', body: { key, value } });
      toast(`${key} actualizado`, 'ok');
    };

    list.querySelector('.ag-set-open')?.addEventListener('click', () => openMd(s.file, 'view'));
    list.querySelector('#ag-cred-save')?.addEventListener('click', async () => {
      const key = list.querySelector('#ag-cred-key').value.trim();
      const value = list.querySelector('#ag-cred-val').value;
      if (!key || !value) return toast('Falta la key o el valor', 'error');
      try {
        await saveKey(key, value);
        settingsCache[selectedId] = await api(`/api/agents/${selectedId}/settings`);
        renderSettings(list, settingsCache[selectedId]);
      } catch (err) { errToast(err); }
    });
    list.querySelectorAll('.ag-set-bool').forEach((t) => t.addEventListener('click', async () => {
      const next = t.dataset.val !== 'true';
      t.classList.toggle('on', next);
      try {
        await saveKey(t.dataset.key, next);
        t.dataset.val = String(next);
      } catch (err) {
        t.classList.toggle('on', !next);
        errToast(err);
      }
    }));
    list.querySelectorAll('.ag-set-sel').forEach((sel) => sel.addEventListener('change', async () => {
      const raw = sel.value;
      // bool unions keep real booleans for true/false, strings for extras
      const value = sel.dataset.type === 'bool'
        ? (raw === 'true' ? true : raw === 'false' ? false : raw)
        : sel.dataset.type === 'number' ? Number(raw) : raw;
      const prev = sel.dataset.cur;
      try {
        await saveKey(sel.dataset.key, value);
        sel.dataset.cur = raw;
      } catch (err) {
        sel.value = prev;
        errToast(err);
      }
    }));
    list.querySelectorAll('.ag-set-in').forEach((inp) => {
      const btn = inp.parentElement.querySelector('.ag-set-save');
      inp.addEventListener('input', () => btn.classList.remove('hidden'));
      const save = async () => {
        const raw = inp.value.trim();
        const value = inp.dataset.type === 'number' ? Number(raw) : raw;
        if (inp.dataset.type === 'number' && Number.isNaN(value)) return toast('Debe ser un número', 'error');
        try {
          await saveKey(inp.dataset.key, value);
          btn.classList.add('hidden');
        } catch (err) { errToast(err); }
      };
      btn.addEventListener('click', save);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    });
    refreshIcons();
  }

  // ---------- boot ----------

  // ⌘K palette hook — jump straight to an agent / docs / matrix
  window.pmGotoAgent = (id) => {
    document.querySelector('.tab-btn[data-tab="agents"]')?.click();
    if (id === '__docs' || id === '__matrix' || id === '__store' || id === '__archives' || id === '__chats' || id === '__memories' || agentsList.some((a) => a.id === id)) {
      selectAgent(id);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureDom);
  } else {
    ensureDom();
  }
  window.AxonPages ||= {};
  window.AxonPages.agents={params:()=>({id:selectedId,tab:agSubTab,...window.AgentContext.params()}),dirty:()=>window.AgentContext.dirty(),canLeave:()=>window.AgentContext.canLeave(),capture:()=>({selectedId,agSubTab,railQuery}),restore:async (params,snap)=>{
    restoringAgent=true;
    try{
      selectedId=params.id || snap?.selectedId || null;
      agSubTab=['skill','mcp','plugin','provider','consumption','config','doc'].includes(params.tab)?params.tab:snap?.agSubTab || 'skill';
      railQuery=snap?.railQuery || '';
      await loadAgents();
      if(window.AxonNavigation.current.section==='agents' && window.AxonNavigation.current.params===params && selectedId)await loadDetail(selectedId);
    }finally{restoringAgent=false;}
  }};
  document.addEventListener('click',e=>{
    if(!e.target.closest('#tab-agents'))return;
    queueMicrotask(()=>{if(window.AxonNavigation?.ready && !window.AxonNavigation.applying && window.AxonNavigation.current.section==='agents')window.AxonNavigation.update('agents',{id:selectedId,tab:agSubTab,...window.AgentContext.params()});});
  });
})();
