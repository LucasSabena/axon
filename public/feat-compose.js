/* AXON — feature: Compose (editor visual de docker-compose)
   Self-contained: injects its own nav item + tab section, reuses app.js
   globals ($ $$ api esc icon toast errToast confirmDialog refreshIcons
   loaders openJobModal unloadBrowser activeTabName). */
(function () {
  'use strict';

  // Self-load the stylesheet in case the host page didn't link it.
  if (!document.querySelector('link[href*="feat-compose.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/feat-compose.css';
    document.head.appendChild(l);
  }

  const S = {
    projects: [],
    editing: null,      // path being edited
    savedValue: '',     // last saved/loaded textarea content (dirty tracking)
    readOnly: false,
  };

  let sec = null;
  const el = (id) => sec && sec.querySelector('#' + id);

  // ---------- Data ----------

  async function load() {
    setState('Cargando…');
    try {
      const data = await api('/api/compose');
      S.projects = data.projects || [];
      render();
      await releaseHistory();
      const nc = $('#nav-count-compose');
      if (nc) nc.textContent = S.projects.length || '';
      if (data.dockerError && !S.projects.length) {
        setState('No se pudo consultar docker — solo se muestran archivos en disco (si los hay)');
      }
    } catch (err) {
      setState('No se pudo cargar la lista de stacks');
      errToast(err);
    }
  }

  // ---------- Render: project cards ----------

  function setState(msg) {
    const st = el('cp-state');
    if (!st) return;
    if (!msg) st.classList.add('hidden');
    else {
      st.textContent = msg;
      st.classList.remove('hidden');
    }
  }

  function chipHtml(s) {
    const running = s.status === 'running';
    const tip = [s.container, s.statusText || s.status].filter(Boolean).join(' · ');
    const mem = s.mem ? `<span class="cp-chip-mem">${esc(s.mem)}</span>` : '';
    return `<span class="cp-chip ${running ? 'cp-on' : 'cp-off'}" title="${esc(tip || s.name)}"><span class="cp-dot"></span>${esc(s.name)}${mem}</span>`;
  }

  function cardHtml(p) {
    const file = p.configFile || p.path || '';
    const running = p.services.filter((s) => s.status === 'running').length;
    const chips = p.services.length
      ? p.services.map(chipHtml).join('')
      : '<span class="cp-chip cp-off"><span class="cp-dot"></span>sin servicios</span>';
    const acts = file
      ? `<button class="btn-primary btn-inline cp-edit" title="Editar el archivo compose">${icon('pencil')} Editar</button>
         <button class="btn-secondary cp-preview" title="Renderizar config + estado">${icon('eye')} Preview</button>
         <button class="btn-secondary cp-pull" title="docker compose pull">${icon('download')} Pull</button>
         <button class="btn-secondary cp-up" title="docker compose up -d">${icon('play')} Up</button>
         <button class="btn-danger cp-down" title="docker compose down">${icon('square')} Down</button>`
      : '<span class="listener-note">Sin archivo de config detectado</span>';
    const badge = running
      ? `<span class="badge badge-status-running">${running} activo${running === 1 ? '' : 's'}</span>`
      : p.source === 'disk'
        ? '<span class="badge badge-other">dormido</span>'
        : '';
    const memBadge = p.mem ? `<span class="badge badge-other" title="RAM total del stack">${icon('cpu')} ${esc(p.mem)}</span>` : '';
    const desc = p.note || p.description || '';
    const descHtml = `<div class="cp-desc ${p.note ? 'cp-desc-note' : ''}" data-key="${esc(file)}" title="Click para editar la nota">${desc ? esc(desc) : '<span class="cp-desc-empty">+ agregar descripción…</span>'}</div>`;
    return `
      <div class="cp-card" data-path="${esc(file)}">
        <div class="cp-head">
          <span class="cp-name">${icon('layers')} ${esc(p.project)}</span>
          ${badge}${memBadge}
        </div>
        <div class="cp-file mono" title="${esc(file)}">${esc(file || '—')}</div>
        ${descHtml}
        <div class="cp-chips">${chips}</div>
        <div class="cp-actions">${acts}</div>
      </div>`;
  }

  function render() {
    const grid = el('cp-grid');
    if (!grid) return;
    grid.innerHTML = S.projects.map(cardHtml).join('');
    setState(S.projects.length ? '' : 'No hay stacks Compose — ni contenedores con labels ni archivos docker-compose.yml en tu home / /opt.');
    refreshIcons();
  }

  // ---------- Views ----------

  function showView(which) {
    el('cp-list').classList.toggle('hidden', which !== 'list');
    el('cp-editor').classList.toggle('hidden', which !== 'editor');
    el('cp-preview').classList.toggle('hidden', which !== 'preview');
    el('cp-top').classList.toggle('hidden', which !== 'list');
  }

  function banner(id, kind, msg) {
    const b = el(id);
    if (!b) return;
    if (!msg) {
      b.classList.add('hidden');
      return;
    }
    b.className = `cp-banner cp-banner-${kind}`;
    b.textContent = msg;
    b.classList.remove('hidden');
  }

  // ---------- Editor ----------

  async function openEditor(p) {
    if (!p) return;
    try {
      const data = await api(`/api/compose/file?path=${encodeURIComponent(p)}`);
      S.editing = data.path;
      S.savedValue = data.content || '';
      S.revision = data.revision;
      S.draft = data.draft;
      el('cp-ed-discard').disabled = !S.draft;
      S.readOnly = Boolean(data.truncated);

      el('cp-ed-path').textContent = data.path;
      const ta = el('cp-ed-text');
      ta.value = S.savedValue;
      ta.readOnly = S.readOnly;
      el('cp-ed-save').disabled = S.readOnly;

      const flag = el('cp-ed-flag');
      if (data.truncated) {
        flag.textContent = 'Truncado (>512KB) — solo lectura';
        flag.classList.remove('hidden');
      } else {
        flag.classList.add('hidden');
      }
      banner('cp-ed-banner', data.draft ? 'warn' : null, data.draft ? 'Estás editando un borrador de Axon. El archivo desplegable del host sigue intacto.' : '');
      showView('editor');
      await releaseHistory();
      ta.focus();
    } catch (err) {
      errToast(err);
    }
  }

  function isDirty() {
    return S.editing && el('cp-ed-text').value !== S.savedValue;
  }

  async function closeEditor() {
    if (isDirty()) {
      const ok = await confirmDialog(
        'Descartar cambios',
        `Hay cambios sin guardar en ${S.editing.split('/').pop()}.`,
        'Descartar'
      );
      if (!ok) return;
    }
    S.editing = null;
    S.readOnly = false;
    showView('list');
    load();
  }

  async function saveEditor() {
    if (!S.editing || S.readOnly) return;
    const btn = el('cp-ed-save');
    btn.disabled = true;
    try {
      const res = await api('/api/compose/save', {
        method: 'POST',
        body: { path: S.editing, content: el('cp-ed-text').value, revision: S.revision },
      });
      S.savedValue = el('cp-ed-text').value;
      S.revision = res.revision; S.draft = !!res.draft;
      await releaseHistory();
      el('cp-ed-discard').disabled = !S.draft;
      if (res.validation && res.validation.ok === false) {
        banner('cp-ed-banner', 'warn', `Borrador guardado; el archivo desplegable sigue intacto. Validación local:\n${res.validation.error || ''}`);
        toast('Borrador guardado; requiere corrección', 'error', res.validation.error, 8000);
      } else {
        banner('cp-ed-banner', 'ok', 'Borrador guardado. YAML válido en la revisión local; falta validar Docker Compose antes de aplicar.');
        toast(`Borrador guardado: ${S.editing.split('/').pop()}`, 'ok', '', 3000);
      }
    } catch (err) {
      banner('cp-ed-banner', 'err', err.message || 'Error al guardar');
      errToast(err);
    } finally {
      btn.disabled = S.readOnly;
    }
  }

  // Validates the file on disk via the save-less preview endpoint.
  async function validateEditor() {
    if (!S.editing) return;
    if (isDirty()) {
      banner('cp-ed-banner', 'warn', 'Hay cambios sin guardar. Guardá el borrador para comparar la versión revisada.');
    }
    const btn = el('cp-ed-validate');
    btn.disabled = true;
    try {
      const res = await api('/api/compose/preview', { method: 'POST', body: { path: S.editing } });
      if (res.draft) {
        banner('cp-ed-banner', 'warn', res.error || 'Borrador guardado. Falta validar Docker Compose antes de aplicar.');
      } else if (res.error) {
        banner('cp-ed-banner', 'err', `"docker compose config" falló:\n${res.error}`);
      } else {
        const n = (res.services || []).length;
        banner('cp-ed-banner', 'ok', `Config válida — ${n} servicio${n === 1 ? '' : 's'} declarado${n === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      banner('cp-ed-banner', 'err', err.message || 'No se pudo validar');
      errToast(err);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Preview view ----------

  async function openPreview(p) {
    if (!p) return;
    el('cp-pv-path').textContent = p;
    el('cp-pv-rendered').textContent = 'Renderizando…';
    el('cp-pv-tbody').innerHTML = '';
    el('cp-pv-comparison').classList.add('hidden');
    el('cp-pv-rendered').classList.remove('hidden');
    banner('cp-pv-banner', null, '');
    showView('preview');
    try {
      const res = await api('/api/compose/preview', { method: 'POST', body: { path: p } });
      el('cp-pv-rendered').textContent =
        (res.rendered || '') + (res.renderedTruncated ? '\n…(salida truncada a 200KB)…\n' : '') || '(vacío)';
      if (res.error) banner('cp-pv-banner', res.draft ? 'warn' : 'err', `${res.draft ? 'Borrador sin aplicar' : 'Docker Compose no validado'}:\n${res.error}`);
      const rows = (res.services || [])
        .map(
          (s) => `<tr>
            <td>${esc(s.name)}</td>
            <td class="mono">${esc(s.image || '—')}</td>
            <td class="mono">${esc(s.ports || '—')}</td>
            <td><span class="cp-chip ${s.status === 'running' ? 'cp-on' : 'cp-off'}"><span class="cp-dot"></span>${esc(s.statusText || s.status || 'sin contenedor')}</span></td>
          </tr>`
        )
        .join('');
      el('cp-pv-tbody').innerHTML = rows || '<tr><td colspan="4" class="listener-note">Sin servicios</td></tr>';
      refreshIcons();
    } catch (err) {
      el('cp-pv-rendered').textContent = '';
      banner('cp-pv-banner', 'err', err.message || 'No se pudo generar el preview');
      errToast(err);
    }
  }

  async function compareDraft() {
    if (!S.editing) return;
    if (isDirty()) {
      banner('cp-ed-banner', 'warn', 'Guardá el borrador antes de comparar. Los cambios del editor todavía no pertenecen a la revisión guardada.');
      return;
    }
    try {
      const res = await api('/api/compose/draft-preview', {method:'POST', body:{path:S.editing}});
      const comparison = res;
      el('cp-pv-path').textContent=S.editing;
      el('cp-pv-tbody').innerHTML='';
      el('cp-pv-rendered').classList.add('hidden');
      el('cp-pv-before').textContent=comparison.before;
      el('cp-pv-after').textContent=comparison.after;
      el('cp-pv-comparison').classList.remove('hidden');
      banner('cp-pv-banner','warn',(comparison.changedOnHost?'El archivo del host cambió desde que creaste el borrador. Revisá el conflicto antes de continuar.\n':'El archivo desplegable sigue intacto.\n')+comparison.blockers.join(' '));
      showView('preview');
      await releaseHistory();
      el('cp-pv-before').focus();
    } catch(err) { banner('cp-ed-banner','err',err.message||'No se pudo comparar el borrador'); }
  }

  async function discardDraft() {
    if(!S.editing||!S.draft)return;
    if(!await confirmDialog('Descartar borrador','Se pierde el borrador y cualquier cambio sin guardar del editor. El archivo del host no se modifica.','Descartar borrador'))return;
    try {
      await api('/api/compose/draft-discard',{method:'POST',body:{path:S.editing,revision:S.revision}});
      await openEditor(S.editing);
      banner('cp-ed-banner','ok','Borrador descartado. Se muestra el archivo actual del host.');
    } catch(err) { banner('cp-ed-banner','err',err.message||'No se pudo descartar'); }
  }

  let releaseTimer;
  async function releaseHistory(){
    clearTimeout(releaseTimer);
    let panel=el('cp-release-history');
    if(!panel){panel=document.createElement('section');panel.id='cp-release-history';panel.className='maint-panel';sec.append(panel);}
    try{
      const result=await api('/api/compose/releases',{fresh:true});
      panel.innerHTML=`<h3>Aplicación y recuperación de Compose</h3><p>Guardá un borrador y prepará una revisión. Se validan Docker, imágenes y contenedores; sólo se reinician los servicios que ya estaban encendidos. No se eliminan huérfanos ni volúmenes. Recuperar configuración no revierte datos o migraciones de la aplicación.</p><button id="cp-release-prepare" class="btn-primary" ${S.editing&&S.draft?'':'disabled'}>Preparar aplicación del borrador</button><div role="status" id="cp-release-status"></div>${result.operations.map(op=>`<article><h4>${op.retire?'Retirada de '+esc(op.retire)+' · ':''}${esc({planned:'Revisión preparada',running:'Aplicando',verified:'Aplicación verificada',interrupted:'Interrumpido: revisar',restored:'Configuración recuperada'}[op.state]||op.state)} · ${esc(op.project)}</h4><p class="maint-path">${esc(op.path)}</p><p>${esc(op.message)}</p><ul>${op.changed.map(s=>`<li>${esc(s.name)}: ${s.fields.map(esc).join(', ')} · imagen ${esc(s.image)}</li>`).join('')}</ul><p>Se reinician: ${op.active.map(esc).join(', ')||'ninguno'}. Permanecen apagados: ${op.inactive.map(esc).join(', ')||'ninguno'}.</p>${op.state==='planned'?`<button class="btn-primary" data-release="${esc(op.id)}" data-digest="${esc(op.digest)}" data-action="apply" data-retire="${esc(op.retire||'')}">${op.retire?'Confirmar esta retirada':'Confirmar esta aplicación'}</button>`:''}${op.canRollback&&op.state!=='running'?`<button class="btn-secondary" data-release="${esc(op.id)}" data-digest="${esc(op.digest)}" data-action="rollback">Recuperar configuración e imágenes anteriores</button>`:''}<button class="btn-secondary" data-release-refresh="${esc(op.id)}">Comprobar estado</button></article>`).join('')}`;
      el('cp-release-prepare').onclick=async()=>{if(isDirty()){el('cp-release-status').textContent='Guardá los cambios antes de preparar la revisión';return;}try{await api('/api/compose/releases',{method:'POST',body:{path:S.editing}});await releaseHistory();}catch(e){el('cp-release-status').textContent=e.message;}};
      panel.querySelectorAll('[data-release]').forEach(b=>b.onclick=async()=>{const rollback=b.dataset.action==='rollback';if(!await confirmDialog(rollback?'Recuperar configuración':b.dataset.retire?'Retirar '+b.dataset.retire:'Aplicar esta selección',rollback?'Se restaura la configuración y las imágenes previas de los servicios indicados. Los datos no se revierten.':b.dataset.retire?'Se retira sólo el servicio y su contenedor. Los datos, volúmenes e imágenes se conservan; el resto del stack no cambia.':'Se publica la configuración revisada y se reinician únicamente los servicios encendidos indicados.','Confirmar'))return;b.disabled=true;try{await api(`/api/compose/releases/${b.dataset.release}/${b.dataset.action}`,{method:'POST',body:{digest:b.dataset.digest}});await releaseHistory();}catch(e){el('cp-release-status').textContent=e.message;}});
      panel.querySelectorAll('[data-release-refresh]').forEach(b=>b.onclick=async()=>{try{await api(`/api/compose/releases/${b.dataset.releaseRefresh}`,{fresh:true});await releaseHistory();}catch(e){el('cp-release-status').textContent=e.message;}});
      if(result.operations.some(op=>op.state==='running'))releaseTimer=setTimeout(()=>{if(activeTabName==='compose')releaseHistory();},1500);
    }catch(e){panel.textContent=e.message;}
  }

  // ---------- Jobs (up / down / pull) ----------

  function showJob(job, fallbackTitle) {
    if (job && typeof openJobModal === 'function') {
      openJobModal(job);
    } else if (job) {
      fallbackJobModal(job.id, job.title || fallbackTitle);
    }
  }

  // Minimal fallback viewer (only if app.js openJobModal is missing).
  function fallbackJobModal(jobId, title) {
    let m = $('#cp-job-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'cp-job-modal';
      m.className = 'modal cp-modal hidden';
      m.innerHTML = `
        <div class="modal-content">
          <h3 id="cp-job-title"></h3>
          <pre id="cp-job-log" class="cp-job-log"></pre>
          <div class="modal-actions">
            <button type="button" id="cp-job-close" class="btn-secondary">Cerrar</button>
          </div>
        </div>`;
      document.body.appendChild(m);
      $('#cp-job-close').addEventListener('click', () => m.classList.add('hidden'));
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    }
    $('#cp-job-title').textContent = title || 'Ejecutando';
    $('#cp-job-log').textContent = 'Iniciando…';
    m.classList.remove('hidden');
    const poll = setInterval(async () => {
      if (m.classList.contains('hidden')) { clearInterval(poll); return; }
      try {
        const { job } = await api(`/api/jobs/${jobId}`);
        const pre = $('#cp-job-log');
        const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
        pre.textContent = job.log || '';
        if (atBottom) pre.scrollTop = pre.scrollHeight;
        if (job.status !== 'running') {
          clearInterval(poll);
          toast(job.status === 'ok' ? `${job.title} completado` : `${job.title} falló`, job.status === 'ok' ? 'ok' : 'error');
          load();
        }
      } catch { clearInterval(poll); }
    }, 1000);
  }

  async function doUp(path) {
    const ok = await confirmDialog(
      'Levantar stack',
      `Corre "docker compose up -d" con ${path.split('/').pop()}.`,
      'Up -d'
    );
    if (!ok) return;
    try {
      const res = await api('/api/compose/up', { method: 'POST', body: { path } });
      showJob(res.job, 'compose up');
      setTimeout(load, 2000);
    } catch (err) {
      errToast(err);
    }
  }

  async function doDown(path, project) {
    const ok1 = await confirmDialog(
      `Bajar ${project || 'stack'}`,
      'Se detienen y eliminan los contenedores y las redes del proyecto (los volúmenes se conservan).',
      'Continuar'
    );
    if (!ok1) return;
    const ok2 = await confirmDialog(
      'Confirmá de nuevo',
      'Esta acción frena todos los servicios del stack. ¿Seguro?',
      'Down'
    );
    if (!ok2) return;
    try {
      const res = await api('/api/compose/down', { method: 'POST', body: { path, confirm: true } });
      showJob(res.job, 'compose down');
      setTimeout(load, 2000);
    } catch (err) {
      errToast(err);
    }
  }

  async function doPull(path) {
    try {
      const res = await api('/api/compose/pull', { method: 'POST', body: { path } });
      showJob(res.job, 'compose pull');
    } catch (err) {
      errToast(err);
    }
  }

  // ---------- Boot: inject nav item + tab section ----------

  function boot() {
    const main = document.querySelector('main.content');
    if (!main || document.getElementById('tab-compose')) return;

    sec = document.createElement('section');
    sec.id = 'tab-compose';
    sec.className = 'tab-content';
    sec.innerHTML = `
      <div class="cp-top" id="cp-top">
        <div class="section-header">
          <h2>Compose</h2>
          <div class="section-actions">
            <button id="cp-refresh" class="btn-secondary" title="Recargar">${icon('refresh-cw')}</button>
          </div>
        </div>
        <p class="listener-note cp-note">Stacks de Docker Compose — los que tienen contenedores y los <code>docker-compose.yml</code>/<code>compose.yml</code> dormidos en tu home y /opt.</p>
      </div>
      <div id="cp-list" class="cp-list">
        <div id="cp-grid" class="cp-grid"></div>
        <div id="cp-state" class="empty-state hidden">Cargando…</div>
      </div>
      <div id="cp-editor" class="cp-editor hidden">
        <div class="cp-editor-bar">
          <span class="mono cp-editor-path" id="cp-ed-path"></span>
          <span class="badge badge-other hidden" id="cp-ed-flag"></span>
          <div class="section-actions">
            <button id="cp-ed-validate" class="btn-secondary" title="docker compose config (sin guardar)">${icon('check-circle-2')} Validar</button>
            <button id="cp-ed-save" class="btn-primary">${icon('save')} Guardar borrador</button>
            <button id="cp-ed-compare" class="btn-secondary">${icon('columns-2')} Comparar borrador</button>
            <button id="cp-ed-discard" class="btn-secondary" disabled>Descartar borrador</button>
            <button id="cp-ed-up" class="btn-secondary" title="docker compose up -d después de guardar">${icon('play')} Up -d</button>
            <button id="cp-ed-back" class="btn-secondary">${icon('arrow-left')} Volver</button>
          </div>
        </div>
        <div id="cp-ed-banner" class="cp-banner hidden"></div>
        <textarea id="cp-ed-text" class="mono" spellcheck="false" wrap="off"></textarea>
        <p class="listener-note">Ctrl/Cmd+S guarda el borrador. Comparar muestra el archivo del host y la revisión guardada. La validación local del borrador no equivale a validar Docker ni aplicar.</p>
      </div>
      <div id="cp-preview" class="cp-preview hidden">
        <div class="cp-editor-bar">
          <span class="mono cp-editor-path" id="cp-pv-path"></span>
          <div class="section-actions">
            <button id="cp-pv-edit" class="btn-secondary">${icon('pencil')} Editar</button>
            <button id="cp-pv-back" class="btn-secondary">${icon('arrow-left')} Volver</button>
          </div>
        </div>
        <div id="cp-pv-banner" class="cp-banner hidden"></div>
        <div class="cp-pv-body">
          <div class="table-wrapper cp-pv-tablewrap">
            <table class="data-table" id="cp-pv-table">
              <thead>
                <tr><th>Servicio</th><th>Imagen</th><th>Puertos</th><th>Estado</th></tr>
              </thead>
              <tbody id="cp-pv-tbody"></tbody>
            </table>
          </div>
          <pre id="cp-pv-rendered" class="cp-rendered mono"></pre>
          <div id="cp-pv-comparison" class="cp-comparison hidden">
            <section><h3>Archivo actual del host</h3><pre id="cp-pv-before" class="cp-rendered mono" tabindex="0" aria-label="Archivo actual del host"></pre></section>
            <section><h3>Borrador guardado</h3><pre id="cp-pv-after" class="cp-rendered mono" tabindex="0" aria-label="Borrador guardado"></pre></section>
          </div>
        </div>
      </div>`;
    main.appendChild(sec);

    // Nav item inside the "Sistema" section, before Config.
    const nav = document.querySelector('.sidebar-nav');
    if (nav) {
      const btn = document.createElement('button');
      btn.className = 'nav-item tab-btn';
      btn.dataset.tab = 'compose';
      btn.innerHTML = `${icon('layers')}<span class="nav-label">Compose</span><span class="nav-count" id="nav-count-compose"></span>`;
      nav.insertBefore(btn, document.getElementById('sidebar-settings'));
      btn.addEventListener('click', () => {
        if (document.querySelector('.tab-btn[data-tab="navegador"]')?.classList.contains('active')) {
          try { unloadBrowser(); } catch { /* not loaded yet */ }
        }
        $$('.tab-btn').forEach((b) => b.classList.remove('active'));
        $$('.tab-content').forEach((t) => t.classList.remove('active'));
        btn.classList.add('active');
        sec.classList.add('active');
        try { activeTabName = 'compose'; } catch { /* const in some scopes */ }
        load();
      });
    }

    if (typeof loaders === 'object' && loaders) loaders.compose = load;

    // ---------- Events ----------
    el('cp-refresh').addEventListener('click', load);

    el('cp-grid').addEventListener('click', (e) => {
      // Click en la descripción → editor inline de la nota del stack.
      const desc = e.target.closest('.cp-desc');
      if (desc && !desc.querySelector('input')) {
        const key = desc.dataset.key;
        const p = S.projects.find((x) => (x.configFile || x.path) === key);
        const cur = p?.note || '';
        const input = document.createElement('input');
        input.className = 'cp-desc-input';
        input.value = cur;
        input.placeholder = 'De qué es este stack… (Enter guarda)';
        input.maxLength = 300;
        desc.replaceChildren(input);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        const commit = async () => {
          const note = input.value.trim();
          try {
            await api('/api/compose/note', { method: 'POST', body: { key, note } });
            if (p) p.note = note || undefined;
          } catch (err) {
            toast(err.message || 'No se pudo guardar la nota', 'error', '', 3000);
          }
          render();
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
          else if (ev.key === 'Escape') render();
        });
        input.addEventListener('blur', commit);
        return;
      }
      const btn = e.target.closest('button');
      if (!btn) return;
      const card = btn.closest('.cp-card');
      const path = card && card.dataset.path;
      if (!path) return;
      const p = S.projects.find((x) => (x.configFile || x.path) === path);
      if (btn.classList.contains('cp-edit')) openEditor(path);
      else if (btn.classList.contains('cp-preview')) openPreview(path);
      else if (btn.classList.contains('cp-pull')) doPull(path);
      else if (btn.classList.contains('cp-up')) doUp(path);
      else if (btn.classList.contains('cp-down')) doDown(path, p && p.project);
    });

    el('cp-ed-save').addEventListener('click', saveEditor);
    el('cp-ed-validate').addEventListener('click', validateEditor);
    el('cp-ed-compare').addEventListener('click', compareDraft);
    el('cp-ed-discard').addEventListener('click', discardDraft);
    el('cp-ed-back').addEventListener('click', closeEditor);
    el('cp-ed-up').addEventListener('click', async () => {
      if (!S.editing) return;
      if (isDirty()) {
        const ok = await confirmDialog(
          'Guardar antes de levantar',
          'Hay cambios sin guardar. ¿Guardar como borrador? Aplicar requiere comparación y validación adicional.',
          'Guardar borrador'
        );
        if (!ok) return;
        await saveEditor();
        if (isDirty() || S.draft) return; // drafts never imply deployment
      }
      doUp(S.editing);
    });

    el('cp-ed-text').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveEditor();
      }
    });

    el('cp-pv-back').addEventListener('click', () => { showView('list'); load(); });
    el('cp-pv-edit').addEventListener('click', () => openEditor(el('cp-pv-path').textContent));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && S.editing && sec.classList.contains('active')) {
        closeEditor();
      }
    });

    refreshIcons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
