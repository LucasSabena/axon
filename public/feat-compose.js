/* Ports Manager — feature: Compose (editor visual de docker-compose)
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
    return `<span class="cp-chip ${running ? 'cp-on' : 'cp-off'}" title="${esc(tip || s.name)}"><span class="cp-dot"></span>${esc(s.name)}</span>`;
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
         <button class="btn-secondary cp-up" title="docker compose up -d --remove-orphans">${icon('play')} Up</button>
         <button class="btn-danger cp-down" title="docker compose down">${icon('square')} Down</button>`
      : '<span class="listener-note">Sin archivo de config detectado</span>';
    const badge = running
      ? `<span class="badge badge-status-running">${running} activo${running === 1 ? '' : 's'}</span>`
      : p.source === 'disk'
        ? '<span class="badge badge-other">dormido</span>'
        : '';
    return `
      <div class="cp-card" data-path="${esc(file)}">
        <div class="cp-head">
          <span class="cp-name">${icon('layers')} ${esc(p.project)}</span>
          ${badge}
        </div>
        <div class="cp-file mono" title="${esc(file)}">${esc(file || '—')}</div>
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
      banner('cp-ed-banner', null, '');
      showView('editor');
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
        body: { path: S.editing, content: el('cp-ed-text').value },
      });
      S.savedValue = el('cp-ed-text').value;
      if (res.validation && res.validation.ok === false) {
        banner('cp-ed-banner', 'warn', `Guardado, pero "docker compose config" falló:\n${res.validation.error || ''}`);
        toast('Guardado con errores de validación', 'error', res.validation.error, 8000);
      } else {
        banner('cp-ed-banner', 'ok', 'Guardado — "docker compose config" valida OK.');
        toast(`Guardado: ${S.editing.split('/').pop()}`, 'ok', '', 3000);
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
      banner('cp-ed-banner', 'warn', 'Ojo: hay cambios sin guardar — la validación corre sobre el archivo en disco.');
    }
    const btn = el('cp-ed-validate');
    btn.disabled = true;
    try {
      const res = await api('/api/compose/preview', { method: 'POST', body: { path: S.editing } });
      if (res.error) {
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
    banner('cp-pv-banner', null, '');
    showView('preview');
    try {
      const res = await api('/api/compose/preview', { method: 'POST', body: { path: p } });
      el('cp-pv-rendered').textContent =
        (res.rendered || '') + (res.renderedTruncated ? '\n…(salida truncada a 200KB)…\n' : '') || '(vacío)';
      if (res.error) banner('cp-pv-banner', 'err', `"docker compose config" falló:\n${res.error}`);
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
      `Corre "docker compose up -d --remove-orphans" con ${path.split('/').pop()}.`,
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
            <button id="cp-ed-save" class="btn-primary">${icon('save')} Guardar</button>
            <button id="cp-ed-up" class="btn-secondary" title="docker compose up -d después de guardar">${icon('play')} Up -d</button>
            <button id="cp-ed-back" class="btn-secondary">${icon('arrow-left')} Volver</button>
          </div>
        </div>
        <div id="cp-ed-banner" class="cp-banner hidden"></div>
        <textarea id="cp-ed-text" class="mono" spellcheck="false" wrap="off"></textarea>
        <p class="listener-note">Ctrl/Cmd+S guarda · "Validar" corre <code>docker compose config</code> sobre el archivo en disco (los cambios sin guardar no se evalúan).</p>
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
    el('cp-ed-back').addEventListener('click', closeEditor);
    el('cp-ed-up').addEventListener('click', async () => {
      if (!S.editing) return;
      if (isDirty()) {
        const ok = await confirmDialog(
          'Guardar antes de levantar',
          'Hay cambios sin guardar. ¿Guardar y correr "up -d"?',
          'Guardar y Up'
        );
        if (!ok) return;
        await saveEditor();
        if (isDirty()) return; // save failed
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
