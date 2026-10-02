/* AXON — feature: Scripts (library + scheduler + inbound webhooks)
   Self-contained: injects its own nav item + tab section, reuses app.js
   globals ($ $$ api esc icon toast errToast confirmDialog refreshIcons
   relTime loaders openJobModal). */
(function () {
  'use strict';

  // Self-load the stylesheet in case the host page didn't link it.
  if (!document.querySelector('link[href*="feat-scripts.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/feat-scripts.css';
    document.head.appendChild(l);
  }

  const SCHED_HELP =
    'Formatos: */N (cada N minutos), HH:MM (diario a esa hora), "M H" (cron: minuto hora — soporta *, */N y listas como 3,15). Vacío = solo manual.';

  let scripts = [];
  let runningMap = {}; // scriptId → jobId
  let refreshTimer = null;

  // ---------- Schedule helpers (mirror of the backend parser) ----------

  function fieldMatches(field, value) {
    return field.split(',').some((raw) => {
      const p = raw.trim();
      if (p === '*') return true;
      const step = p.match(/^\*\/(\d+)$/);
      if (step) {
        const n = parseInt(step[1], 10);
        return n >= 1 && value % n === 0;
      }
      return parseInt(p, 10) === value;
    });
  }

  function scheduleMatchesNow(t, d) {
    const m = d.getMinutes();
    const h = d.getHours();
    if (t.startsWith('*/')) {
      const n = parseInt(t.slice(2), 10);
      return n >= 1 && (h * 60 + m) % n === 0;
    }
    const parts = t.split(/\s+/);
    if (parts.length === 1 && parts[0].includes(':')) {
      const [hh, mm] = parts[0].split(':').map(Number);
      return h === hh && m === mm;
    }
    if (parts.length === 2) {
      return fieldMatches(parts[0], m) && fieldMatches(parts[1], h);
    }
    return false;
  }

  // Next fire time — scans ahead minute by minute (max 48h).
  function nextRunAt(schedule) {
    const t = (schedule || '').trim();
    if (!t) return null;
    const base = new Date();
    base.setSeconds(0, 0);
    for (let i = 1; i <= 2880; i++) {
      const d = new Date(base.getTime() + i * 60000);
      if (scheduleMatchesNow(t, d)) return d;
    }
    return null;
  }

  function describeSchedule(schedule) {
    const t = (schedule || '').trim();
    if (t.startsWith('*/')) return `cada ${t.slice(2)} min`;
    if (/^\d{1,2}:\d{2}$/.test(t)) return `diario ${t}`;
    if (t) return `cron "${t}"`;
    return 'manual';
  }

  function fmtNext(d) {
    if (!d) return '';
    const diffMin = Math.round((d.getTime() - Date.now()) / 60000);
    if (diffMin < 60) return `en ${diffMin}m`;
    const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86400000);
    if (d.toDateString() === today.toDateString()) return `hoy ${hm}`;
    if (d.toDateString() === tomorrow.toDateString()) return `mañana ${hm}`;
    return `${d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${hm}`;
  }

  // ---------- Data ----------

  async function load() {
    try {
      const data = await api('/api/scripts');
      scripts = data.scripts || [];
      runningMap = {};
      for (const r of data.running || []) runningMap[r.scriptId] = r.jobId;
      render();
      const nc = $('#nav-count-scripts');
      if (nc) nc.textContent = scripts.length || '';
    } catch (err) {
      errToast(err);
    }
  }

  // ---------- Render ----------

  function cardHtml(s) {
    const running = runningMap[s.id];
    const sched = s.schedule
      ? `<span class="sc-chip" title="Programación: ${esc(s.schedule)}">${icon('clock')} ${esc(describeSchedule(s.schedule))}</span>`
      : `<span class="sc-chip sc-chip-manual">${icon('hand')} manual</span>`;
    const next = s.schedule && s.enabled ? nextRunAt(s.schedule) : null;
    const nextChip = next
      ? `<span class="sc-chip sc-chip-next" title="Próxima ejecución estimada">${icon('arrow-right')} ${esc(fmtNext(next))}</span>`
      : '';
    const last = s.lastRun
      ? `<span class="sc-last ${s.lastRun.ok ? 'ok' : 'fail'}" title="Job ${esc(s.lastRun.jobId)}">${s.lastRun.ok ? '✓' : '✗'} ${relTime(s.lastRun.t)}</span>`
      : '<span class="sc-last">nunca corrido</span>';
    const userBadge = `<span class="badge ${s.user === 'root' ? 'badge-bun' : 'badge-python'}" title="Corre como ${esc(s.user)}">${icon('user')} ${esc(s.user)}</span>`;
    const runningBadge = running
      ? `<span class="badge badge-status-running">${icon('loader', 'spin')} corriendo</span>`
      : '';
    const toggleIcon = s.enabled ? 'toggle-right' : 'toggle-left';
    const toggleTitle = s.enabled ? 'Pausar (desactiva la programación y el webhook)' : 'Activar';
    return `
      <div class="sc-card${s.enabled ? '' : ' sc-off'}" data-id="${esc(s.id)}">
        <div class="sc-head">
          <span class="sc-name">${icon('scroll-text')} ${esc(s.name)}</span>
          ${runningBadge}
        </div>
        <pre class="sc-cmd" title="${esc(s.cmd)}">${esc(s.cmd)}</pre>
        <div class="sc-meta">${sched}${nextChip}${userBadge}<span class="sc-last-wrap">última: ${last}</span></div>
        <div class="sc-actions">
          <button class="btn-primary btn-inline sc-run" title="Ejecutar ahora"${running ? ' disabled' : ''}>${icon('play')} Ejecutar</button>
          <button class="btn-secondary sc-hook" title="Copiar URL del webhook">${icon('link')}</button>
          <button class="btn-secondary sc-rotate" title="Regenerar URL (invalida la anterior)">${icon('rotate-ccw')}</button>
          <button class="btn-secondary sc-toggle" title="${toggleTitle}">${icon(toggleIcon)}</button>
          <button class="btn-secondary sc-edit" title="Editar">${icon('pencil')}</button>
          <button class="btn-danger sc-del" title="Eliminar">${icon('trash-2')}</button>
        </div>
      </div>`;
  }

  function render() {
    const list = $('#sc-list');
    if (!list) return;
    list.innerHTML = scripts.map(cardHtml).join('');
    $('#sc-empty').classList.toggle('hidden', scripts.length > 0);
    refreshIcons();
  }

  // ---------- Editor modal ----------

  function ensureModal() {
    let m = $('#sc-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'sc-modal';
    m.className = 'modal sc-modal hidden';
    m.innerHTML = `
      <div class="modal-content">
        <h3 id="sc-modal-title">Nuevo script</h3>
        <form id="sc-form">
          <label>Nombre
            <input type="text" id="sc-f-name" required maxlength="80" placeholder="Backup config">
          </label>
          <label>Comando (corre con bash -lc en el host)
            <textarea id="sc-f-cmd" rows="4" required class="mono" placeholder="apt update && apt upgrade -y"></textarea>
          </label>
          <label>Ejecutar como
            <select id="sc-f-user">
              <option value="user">user (sin privilegios)</option>
              <option value="root">root</option>
            </select>
          </label>
          <label>Programación (opcional)
            <input type="text" id="sc-f-schedule" placeholder="*/30 · 03:00 · 0 3">
            <span class="listener-note sc-help">${esc(SCHED_HELP)}</span>
          </label>
          <label class="sc-check"><input type="checkbox" id="sc-f-enabled" checked> Activo (programación y webhook habilitados)</label>
          <div id="sc-f-error" class="error"></div>
          <input type="hidden" id="sc-f-id">
          <div class="modal-actions">
            <button type="button" id="sc-f-cancel" class="btn-secondary">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(m);
    $('#sc-f-cancel').addEventListener('click', () => m.classList.add('hidden'));
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    $('#sc-form').addEventListener('submit', saveScript);
    refreshIcons();
    return m;
  }

  function openEditor(s) {
    const m = ensureModal();
    $('#sc-modal-title').textContent = s ? 'Editar script' : 'Nuevo script';
    $('#sc-f-id').value = s ? s.id : '';
    $('#sc-f-name').value = s ? s.name : '';
    $('#sc-f-cmd').value = s ? s.cmd : '';
    $('#sc-f-user').value = s ? s.user : 'user';
    $('#sc-f-schedule').value = s && s.schedule ? s.schedule : '';
    $('#sc-f-enabled').checked = s ? !!s.enabled : true;
    $('#sc-f-error').textContent = '';
    m.classList.remove('hidden');
    setTimeout(() => $('#sc-f-name').focus(), 30);
  }

  async function saveScript(e) {
    e.preventDefault();
    const id = $('#sc-f-id').value;
    const body = {
      name: $('#sc-f-name').value.trim(),
      cmd: $('#sc-f-cmd').value,
      user: $('#sc-f-user').value,
      schedule: $('#sc-f-schedule').value.trim(),
      enabled: $('#sc-f-enabled').checked,
    };
    try {
      if (id) {
        await api(`/api/scripts/${id}`, { method: 'PUT', body });
        toast('Script actualizado', 'ok', '', 2500);
      } else {
        await api('/api/scripts', { method: 'POST', body });
        toast('Script creado', 'ok', '', 2500);
      }
      $('#sc-modal').classList.add('hidden');
      load();
    } catch (err) {
      $('#sc-f-error').textContent = err.message || 'Error al guardar';
    }
  }

  // ---------- Fallback job viewer (only if app.js openJobModal is missing) ----------

  function fallbackJobModal(jobId, title) {
    let m = $('#sc-job-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'sc-job-modal';
      m.className = 'modal sc-modal hidden';
      m.innerHTML = `
        <div class="modal-content">
          <h3 id="sc-job-title"></h3>
          <pre id="sc-job-log" class="sc-job-log"></pre>
          <div class="modal-actions">
            <button type="button" id="sc-job-close" class="btn-secondary">Cerrar</button>
          </div>
        </div>`;
      document.body.appendChild(m);
      $('#sc-job-close').addEventListener('click', () => m.classList.add('hidden'));
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    }
    $('#sc-job-title').textContent = title || 'Ejecutando';
    $('#sc-job-log').textContent = 'Iniciando…';
    m.classList.remove('hidden');
    const poll = setInterval(async () => {
      if (m.classList.contains('hidden')) { clearInterval(poll); return; }
      try {
        const { job } = await api(`/api/jobs/${jobId}`);
        const pre = $('#sc-job-log');
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

  // ---------- Actions ----------

  async function runNow(s) {
    try {
      const res = await api(`/api/scripts/${s.id}/run`, { method: 'POST', body: { source: 'manual' } });
      toast(res.already ? `"${s.name}" ya estaba corriendo` : `Ejecutando "${s.name}"`, 'ok', '', 2500);
      let job = res.job;
      if (!job && res.jobId) {
        try { job = (await api(`/api/jobs/${res.jobId}`)).job; } catch { /* fall through */ }
      }
      if (job && typeof openJobModal === 'function') openJobModal(job);
      else if (res.jobId) fallbackJobModal(res.jobId, `Script: ${s.name}`);
      setTimeout(load, 1500);
    } catch (err) {
      errToast(err);
    }
  }

  async function copyHook(s) {
    const url = `${location.origin}/x/hook/${s.hookToken}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('URL copiada — POST o GET la ejecuta', 'ok', url, 4000);
    } catch {
      toast(url, 'ok', 'POST o GET la ejecuta', 8000);
    }
  }

  async function rotateHook(s) {
    const ok = await confirmDialog(
      'Regenerar URL del webhook',
      'La URL anterior deja de funcionar — actualizá donde la uses (ntfy, marcadores, atajos).',
      'Regenerar'
    );
    if (!ok) return;
    try {
      const res = await api(`/api/scripts/${s.id}/hook/rotate`, { method: 'POST' });
      toast('Nueva URL generada', 'ok', '', 2500);
      if (res.script) s.hookToken = res.script.hookToken;
      load();
    } catch (err) {
      errToast(err);
    }
  }

  async function toggleEnabled(s) {
    try {
      await api(`/api/scripts/${s.id}`, { method: 'PUT', body: { enabled: !s.enabled } });
      load();
    } catch (err) {
      errToast(err);
    }
  }

  async function removeScript(s) {
    const ok = await confirmDialog(
      'Eliminar script',
      `Se elimina "${s.name}" y su URL de webhook deja de funcionar.`
    );
    if (!ok) return;
    try {
      await api(`/api/scripts/${s.id}`, { method: 'DELETE' });
      toast('Script eliminado', 'ok', '', 2500);
      load();
    } catch (err) {
      errToast(err);
    }
  }

  // ---------- Boot: inject nav item + tab section ----------

  function boot() {
    const main = document.querySelector('main.content');
    if (!main || document.getElementById('tab-scripts')) return;

    const section = document.createElement('section');
    section.id = 'tab-scripts';
    section.className = 'tab-content';
    section.innerHTML = `
      <div class="section-header">
        <h2>Scripts</h2>
        <div class="section-actions">
          <button id="sc-new" class="btn-primary btn-inline">${icon('plus')} Nuevo script</button>
          <button id="sc-refresh" class="btn-secondary" title="Recargar">${icon('refresh-cw')}</button>
        </div>
      </div>
      <p class="listener-note sc-note">Acciones de un toque: ejecutalas desde acá, programalas, o disparalas desde el teléfono con su URL secreta (POST o GET a /x/hook/&lt;token&gt;).</p>
      <div id="sc-list" class="sc-grid"></div>
      <div id="sc-empty" class="empty-state hidden">No hay scripts — creá el primero con "Nuevo script".</div>`;
    main.appendChild(section);

    // Nav item inside the "Sistema" section, before Config.
    const nav = document.querySelector('.sidebar-nav');
    if (nav) {
      const btn = document.createElement('button');
      btn.className = 'nav-item tab-btn';
      btn.dataset.tab = 'scripts';
      btn.innerHTML = `${icon('scroll-text')}<span class="nav-label">Scripts</span><span class="nav-count" id="nav-count-scripts"></span>`;
      nav.insertBefore(btn, document.getElementById('sidebar-settings'));
      btn.addEventListener('click', () => {
        if (document.querySelector('.tab-btn[data-tab="navegador"]')?.classList.contains('active')) {
          try { unloadBrowser(); } catch { /* not loaded yet */ }
        }
        $$('.tab-btn').forEach((b) => b.classList.remove('active'));
        $$('.tab-content').forEach((t) => t.classList.remove('active'));
        btn.classList.add('active');
        section.classList.add('active');
        try { activeTabName = 'scripts'; } catch { /* const in some scopes */ }
        load();
      });
    }

    if (typeof loaders === 'object' && loaders) loaders.scripts = load;

    // Section events
    $('#sc-new').addEventListener('click', () => openEditor(null));
    $('#sc-refresh').addEventListener('click', load);
    $('#sc-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const card = btn.closest('.sc-card');
      const s = card && scripts.find((x) => x.id === card.dataset.id);
      if (!s) return;
      if (btn.classList.contains('sc-run')) runNow(s);
      else if (btn.classList.contains('sc-hook')) copyHook(s);
      else if (btn.classList.contains('sc-rotate')) rotateHook(s);
      else if (btn.classList.contains('sc-toggle')) toggleEnabled(s);
      else if (btn.classList.contains('sc-edit')) openEditor(s);
      else if (btn.classList.contains('sc-del')) removeScript(s);
    });

    // Light auto-refresh while the tab is visible (last-run times, running badges).
    refreshTimer = setInterval(() => {
      if (section.classList.contains('active') && !document.hidden) load();
    }, 20000);

    refreshIcons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
