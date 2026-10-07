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
  const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
  const DEFAULT_TIMEOUT_MIN = 30; // espejo de DEFAULT_STEP_TIMEOUT_MS del backend

  let scripts = [];
  let runningMap = {}; // scriptId → jobId
  let refreshTimer = null;
  let signedIn = false;
  let query = '';
  const cardSigs = new Map(); // scriptId → firma de datos para render incremental
  document.addEventListener('axon:authenticated', () => { signedIn = true; });
  document.addEventListener('axon:session-expired', () => { signedIn = false; });

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

  const FIELD_RE = /^(\*|\*\/\d+|\d+)(,(\*|\*\/\d+|\d+))*$/;

  function fieldNumbersOk(field, max) {
    return field.split(',').every((part) => {
      const p = part.trim();
      if (p === '*') return true;
      const m = p.match(/^\*\/(\d+)$/);
      if (m) return parseInt(m[1], 10) >= 1;
      const n = parseInt(p, 10);
      return Number.isInteger(n) && n >= 0 && n <= max;
    });
  }

  // Espejo de validSchedule() del backend — validación temprana en el editor.
  function validSchedule(s) {
    const t = (s || '').trim();
    if (!t) return false;
    if (/^\*\/\d+$/.test(t)) return parseInt(t.slice(2), 10) >= 1;
    const hm = t.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) return parseInt(hm[1], 10) <= 23 && parseInt(hm[2], 10) <= 59;
    const parts = t.split(/\s+/);
    if (parts.length !== 2) return false;
    return (
      FIELD_RE.test(parts[0]) && FIELD_RE.test(parts[1]) &&
      fieldNumbersOk(parts[0], 59) && fieldNumbersOk(parts[1], 23)
    );
  }

  function scheduleMatchesNow(t, d) {
    const m = d.getMinutes();
    const h = d.getHours();
    const parts = t.split(/\s+/);
    // Bare "*/N" only — "*/15 3" is a two-field cron-lite expression and must
    // fall through to fieldMatches (fires only during hour 3, not all day).
    if (parts.length === 1 && t.startsWith('*/')) {
      const n = parseInt(t.slice(2), 10);
      return n >= 1 && (h * 60 + m) % n === 0;
    }
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
    if (t.split(/\s+/).length === 1 && t.startsWith('*/')) return `cada ${t.slice(2)} min`;
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

  function setListError(msg) {
    const box = $('#sc-list-err');
    if (!box) return;
    if (!msg) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const span = box.querySelector('.sc-err-msg');
    if (span) span.textContent = msg;
  }

  async function load(silent) {
    try {
      const data = await api('/api/scripts');
      scripts = data.scripts || [];
      runningMap = {};
      for (const r of data.running || []) runningMap[r.scriptId] = r.jobId;
      render();
      setListError('');
      $('#sc-loading')?.classList.add('hidden');
      const nc = $('#nav-count-scripts');
      if (nc) nc.textContent = scripts.length || '';
    } catch (err) {
      $('#sc-loading')?.classList.add('hidden');
      // El poll es silencioso: solo marca el panel; el botón Recargar avisa.
      setListError('No se pudo cargar la lista de scripts.');
      if (!silent) errToast(err);
    }
  }

  // ---------- Render ----------

  function cardSig(s) {
    return JSON.stringify([
      s.id, s.name, s.cmd, s.description, s.user, s.schedule, s.enabled,
      s.cwd, s.env, s.timeoutMin, s.lastRun, runningMap[s.id] || '',
    ]);
  }

  function matchesQuery(s) {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q) ||
      s.cmd.toLowerCase().includes(q)
    );
  }

  function lastRunHtml(s) {
    return s.lastRun
      ? `${s.lastRun.ok ? '✓' : '✗'} ${relTime(s.lastRun.t)}`
      : '';
  }

  function nextRunHtml(s) {
    const next = s.schedule && s.enabled ? nextRunAt(s.schedule) : null;
    return next ? `${icon('arrow-right')} ${esc(fmtNext(next))}` : '';
  }

  function cardHtml(s) {
    const running = runningMap[s.id];
    const sched = s.schedule
      ? `<span class="sc-chip" title="Programación: ${esc(s.schedule)}">${icon('clock')} ${esc(describeSchedule(s.schedule))}</span>`
      : `<span class="sc-chip sc-chip-manual">${icon('hand')} manual</span>`;
    const next = s.schedule && s.enabled ? nextRunAt(s.schedule) : null;
    const nextChip = next
      ? `<span class="sc-chip sc-chip-next" title="Próxima ejecución estimada">${nextRunHtml(s)}</span>`
      : '';
    const last = s.lastRun
      ? `<button type="button" class="sc-last ${s.lastRun.ok ? 'ok' : 'fail'}" data-job="${esc(s.lastRun.jobId)}" title="Ver log de la última ejecución">${lastRunHtml(s)}</button>`
      : '<span class="sc-last">nunca corrido</span>';
    const userBadge = s.user === 'root'
      ? `<span class="badge badge-bun" title="Corre como root — privilegios totales, sin confirmaciones">${icon('shield-alert')} root</span>`
      : `<span class="badge badge-python" title="Corre como usuario sin privilegios">${icon('user')} user</span>`;
    const envKeys = Object.keys(s.env || {});
    const envChip = envKeys.length
      ? `<span class="sc-chip sc-chip-manual" title="Variables: ${esc(envKeys.join(', '))}">${icon('braces')} env ×${envKeys.length}</span>`
      : '';
    const cwdChip = s.cwd
      ? `<span class="sc-chip sc-chip-manual" title="Directorio de trabajo: ${esc(s.cwd)}">${icon('folder')} ${esc(s.cwd.length > 28 ? '…' + s.cwd.slice(-27) : s.cwd)}</span>`
      : '';
    const toChip = `<span class="sc-chip sc-chip-manual" title="Timeout por ejecución">${icon('timer')} ${s.timeoutMin || DEFAULT_TIMEOUT_MIN}m</span>`;
    const runningBadge = running
      ? `<span class="badge badge-status-running">${icon('loader', 'spin')} corriendo</span>`
      : '';
    const toggleTitle = s.enabled
      ? 'Pausar (detiene la programación y el webhook; Ejecutar sigue disponible)'
      : 'Activar (habilita la programación y el webhook)';
    const toggleLabel = s.enabled ? 'Pausar script' : 'Activar script';
    return `
      <div class="sc-card${s.enabled ? '' : ' sc-off'}" data-id="${esc(s.id)}">
        <div class="sc-head">
          <span class="sc-name">${icon('scroll-text')} ${esc(s.name)}</span>
          ${runningBadge}
        </div>
        ${s.description ? `<p class="sc-desc">${esc(s.description)}</p>` : ''}
        <pre class="sc-cmd" title="${esc(s.cmd)} — click para expandir" role="button" tabindex="0">${esc(s.cmd)}</pre>
        <div class="sc-meta">${sched}${nextChip}${userBadge}${envChip}${cwdChip}${toChip}<span class="sc-last-wrap">última: ${last}</span></div>
        ${s.user === 'root' ? '<p class="sc-root-warn">⚠ Corre como root — el comando tiene privilegios totales del host.</p>' : ''}
        <div class="sc-actions">
          <button class="btn-primary btn-inline sc-run" title="Ejecutar ahora"${running ? ' disabled' : ''}>${icon('play')} Ejecutar</button>
          ${running ? `<button class="btn-danger sc-stop" title="Detener la ejecución en curso" aria-label="Detener la ejecución en curso">${icon('square')}</button>` : ''}
          <button class="btn-secondary sc-hist" title="Historial de ejecuciones" aria-label="Historial de ejecuciones">${icon('history')}</button>
          <button class="btn-secondary sc-hook" title="Copiar URL del webhook" aria-label="Copiar URL del webhook">${icon('link')}</button>
          <button class="btn-secondary sc-rotate" title="Regenerar URL (invalida la anterior)" aria-label="Regenerar URL del webhook">${icon('rotate-ccw')}</button>
          <button class="btn-secondary sc-toggle" title="${toggleTitle}" aria-label="${toggleLabel}">${icon(s.enabled ? 'toggle-right' : 'toggle-left')}</button>
          <button class="btn-secondary sc-edit" title="Editar" aria-label="Editar script">${icon('pencil')}</button>
          <button class="btn-danger sc-del" title="Eliminar" aria-label="Eliminar script">${icon('trash-2')}</button>
        </div>
      </div>`;
  }

  // Actualiza solo lo que envejece con el tiempo (relTime / próxima corrida)
  // sin tocar el resto de la tarjeta.
  function updateDynamic(node, s) {
    const lastBtn = node.querySelector('.sc-last');
    if (lastBtn && s.lastRun) lastBtn.innerHTML = lastRunHtml(s);
    const nextEl = node.querySelector('.sc-chip-next');
    if (nextEl) nextEl.innerHTML = nextRunHtml(s);
  }

  // Render incremental: reconcilia tarjetas por id — solo re-crea las que
  // cambiaron, así el poll de 20s no rompe selección ni foco.
  function render() {
    const list = $('#sc-list');
    if (!list) return;
    const visible = scripts.filter(matchesQuery);
    const seen = new Set();
    for (const s of visible) {
      seen.add(s.id);
      const sig = cardSig(s);
      let node = list.querySelector(`:scope > .sc-card[data-id="${CSS.escape(s.id)}"]`);
      if (node && cardSigs.get(s.id) === sig) {
        updateDynamic(node, s);
      } else {
        const tpl = document.createElement('template');
        tpl.innerHTML = cardHtml(s).trim();
        const fresh = tpl.content.firstChild;
        if (node) node.replaceWith(fresh);
        node = fresh;
      }
      cardSigs.set(s.id, sig);
      list.appendChild(node); // también reordena según `visible`
    }
    for (const node of [...list.children]) {
      if (!seen.has(node.dataset.id)) {
        cardSigs.delete(node.dataset.id);
        node.remove();
      }
    }
    $('#sc-empty').classList.toggle('hidden', scripts.length > 0);
    $('#sc-noresult')?.classList.toggle('hidden', !scripts.length || visible.length > 0);
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
          <label>Descripción (opcional)
            <input type="text" id="sc-f-desc" maxlength="300" placeholder="Qué hace este script">
          </label>
          <label>Comando (corre con bash -lc en el host)
            <textarea id="sc-f-cmd" rows="4" required class="mono" placeholder="apt update && apt upgrade -y"></textarea>
          </label>
          <label>Ejecutar como
            <select id="sc-f-user">
              <option value="user">user (sin privilegios)</option>
              <option value="root">root</option>
            </select>
            <span id="sc-f-rootwarn" class="sc-field-warn hidden">⚠ Corre como root: el comando tiene privilegios totales del host, sin confirmaciones.</span>
          </label>
          <label>Directorio de trabajo (opcional)
            <input type="text" id="sc-f-cwd" class="mono" maxlength="300" placeholder="/home/usuario/proyecto">
          </label>
          <label>Variables de entorno (opcional, una por línea CLAVE=valor; líneas con # se ignoran)
            <textarea id="sc-f-env" rows="2" class="mono" spellcheck="false" placeholder="ENTORNO=produccion"></textarea>
          </label>
          <label>Timeout en minutos (opcional, vacío = ${DEFAULT_TIMEOUT_MIN})
            <input type="number" id="sc-f-timeout" min="1" max="1440" step="1" placeholder="${DEFAULT_TIMEOUT_MIN}">
          </label>
          <label>Programación (opcional)
            <input type="text" id="sc-f-schedule" maxlength="40" placeholder="*/30 · 03:00 · 0 3">
            <span class="listener-note sc-help">${esc(SCHED_HELP)}</span>
            <span id="sc-f-sched-err" class="sc-field-err hidden">Formato inválido — revisá los formatos de arriba.</span>
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
    $('#sc-f-user').addEventListener('change', (e) => {
      $('#sc-f-rootwarn').classList.toggle('hidden', e.target.value !== 'root');
    });
    $('#sc-f-schedule').addEventListener('input', (e) => {
      const bad = e.target.value.trim() && !validSchedule(e.target.value);
      $('#sc-f-sched-err').classList.toggle('hidden', !bad);
      e.target.setAttribute('aria-invalid', bad ? 'true' : 'false');
    });
    refreshIcons();
    return m;
  }

  function envToText(env) {
    return Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
  }

  function openEditor(s) {
    const m = ensureModal();
    $('#sc-modal-title').textContent = s ? 'Editar script' : 'Nuevo script';
    $('#sc-f-id').value = s ? s.id : '';
    $('#sc-f-name').value = s ? s.name : '';
    $('#sc-f-desc').value = s && s.description ? s.description : '';
    $('#sc-f-cmd').value = s ? s.cmd : '';
    $('#sc-f-user').value = s ? s.user : 'user';
    $('#sc-f-rootwarn').classList.toggle('hidden', !s || s.user !== 'root');
    $('#sc-f-cwd').value = s && s.cwd ? s.cwd : '';
    $('#sc-f-env').value = s ? envToText(s.env) : '';
    $('#sc-f-timeout').value = s && s.timeoutMin ? s.timeoutMin : '';
    $('#sc-f-schedule').value = s && s.schedule ? s.schedule : '';
    $('#sc-f-sched-err').classList.add('hidden');
    $('#sc-f-schedule').setAttribute('aria-invalid', 'false');
    $('#sc-f-enabled').checked = s ? !!s.enabled : true;
    $('#sc-f-error').textContent = '';
    m.classList.remove('hidden');
    setTimeout(() => $('#sc-f-name').focus(), 30);
  }

  function parseEnv(text) {
    const env = {};
    const errs = [];
    (text || '').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const eq = t.indexOf('=');
      if (eq < 1) { errs.push(`línea ${i + 1}: falta "CLAVE="`); return; }
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1);
      if (!ENV_KEY_RE.test(k)) { errs.push(`línea ${i + 1}: clave inválida "${k}"`); return; }
      env[k] = v;
    });
    return { env, errs };
  }

  async function saveScript(e) {
    e.preventDefault();
    const id = $('#sc-f-id').value;
    const sched = $('#sc-f-schedule').value.trim();
    if (sched && !validSchedule(sched)) {
      $('#sc-f-error').textContent = 'Programación inválida — revisá los formatos admitidos.';
      return;
    }
    const { env, errs } = parseEnv($('#sc-f-env').value);
    if (errs.length) {
      $('#sc-f-error').textContent = `Variables de entorno: ${errs.join(' · ')}`;
      return;
    }
    const timeoutMin = parseInt($('#sc-f-timeout').value, 10);
    const body = {
      name: $('#sc-f-name').value.trim(),
      description: $('#sc-f-desc').value.trim(),
      cmd: $('#sc-f-cmd').value,
      user: $('#sc-f-user').value,
      schedule: sched,
      cwd: $('#sc-f-cwd').value.trim(),
      env,
      timeoutMin: Number.isInteger(timeoutMin) ? timeoutMin : null,
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
      load(true);
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
          load(true);
        }
      } catch { clearInterval(poll); }
    }, 1000);
  }

  async function openJobById(jobId) {
    try {
      const { job } = await api(`/api/jobs/${jobId}`);
      if (!job) throw new Error('sin job');
      if (typeof openJobModal === 'function') openJobModal(job);
      else fallbackJobModal(job.id, job.title);
    } catch {
      toast('Esa ejecución ya no está disponible (el historial de jobs rota)', 'warn', '', 3500);
    }
  }

  // ---------- History modal ----------

  function ensureHistModal() {
    let m = $('#sc-hist-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'sc-hist-modal';
    m.className = 'modal sc-modal hidden';
    m.innerHTML = `
      <div class="modal-content">
        <h3 id="sc-hist-title">Historial</h3>
        <div id="sc-hist-list" class="sc-hist-list"></div>
        <div class="modal-actions">
          <button type="button" id="sc-hist-close" class="btn-secondary">Cerrar</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    $('#sc-hist-close').addEventListener('click', () => m.classList.add('hidden'));
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    $('#sc-hist-list').addEventListener('click', (e) => {
      const row = e.target.closest('.sc-hist-row');
      if (!row) return;
      openJobById(row.dataset.job);
    });
    return m;
  }

  function openHistory(s) {
    const m = ensureHistModal();
    $('#sc-hist-title').textContent = `Historial — ${s.name}`;
    const rows = (s.history || []).slice().reverse();
    $('#sc-hist-list').innerHTML = rows.length
      ? rows.map((h) => `
        <button type="button" class="sc-hist-row ${h.ok ? 'ok' : 'fail'}" data-job="${esc(h.jobId)}" title="Ver log de la ejecución">
          <span class="sc-hist-mark">${h.ok ? '✓' : '✗'}</span>
          <span class="sc-hist-time">${esc(relTime(h.t))}</span>
          <span class="sc-hist-id">${esc(h.jobId.slice(0, 8))}</span>
        </button>`).join('')
      : '<p class="listener-note">Todavía no hay ejecuciones registradas.</p>';
    m.classList.remove('hidden');
    refreshIcons();
  }

  // ---------- Actions ----------

  async function runNow(s) {
    try {
      const res = await api(`/api/scripts/${s.id}/run`, { method: 'POST', body: { source: 'manual' } });
      toast(
        res.already
          ? `"${s.name}" ya estaba corriendo`
          : `Ejecutando "${s.name}"${res.paused ? ' (pausado — corrida manual)' : ''}`,
        'ok', '', 2500
      );
      let job = res.job;
      if (!job && res.jobId) {
        try { job = (await api(`/api/jobs/${res.jobId}`)).job; } catch { /* fall through */ }
      }
      if (job && typeof openJobModal === 'function') openJobModal(job);
      else if (res.jobId) fallbackJobModal(res.jobId, `Script: ${s.name}`);
      setTimeout(() => load(true), 1500);
    } catch (err) {
      errToast(err);
    }
  }

  async function stopScript(s) {
    const ok = await confirmDialog(
      'Detener script',
      `Se interrumpe la ejecución en curso de "${s.name}" (se mata el proceso y sus hijos).`,
      'Detener'
    );
    if (!ok) return;
    try {
      await api(`/api/scripts/${s.id}/cancel`, { method: 'POST' });
      toast('Señal de detención enviada', 'ok', '', 2500);
      setTimeout(() => load(true), 800);
    } catch (err) {
      errToast(err);
    }
  }

  // El token del webhook no viaja en el listado — se pide on-demand.
  async function copyHook(s) {
    try {
      const { url } = await api(`/api/scripts/${s.id}/hook`);
      const full = `${location.origin}${url}`;
      try {
        await navigator.clipboard.writeText(full);
        toast('URL copiada — un POST la ejecuta', 'ok', full, 4000);
      } catch {
        toast(full, 'ok', 'Un POST a esa URL la ejecuta', 8000);
      }
    } catch (err) {
      errToast(err);
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
      toast('Nueva URL generada', 'ok', res.url ? `Un POST a ${location.origin}${res.url} la ejecuta` : '', 5000);
      load(true);
    } catch (err) {
      errToast(err);
    }
  }

  async function toggleEnabled(s) {
    try {
      await api(`/api/scripts/${s.id}`, { method: 'PUT', body: { enabled: !s.enabled } });
      toast(s.enabled ? `"${s.name}" pausado — Ejecutar sigue disponible` : `"${s.name}" activado`, 'ok', '', 3000);
      load(true);
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
      load(true);
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
          <button id="sc-refresh" class="btn-secondary" title="Recargar" aria-label="Recargar scripts">${icon('refresh-cw')}</button>
        </div>
      </div>
      <p class="listener-note sc-note">Acciones de un toque: ejecutalas desde acá, programalas, o disparalas desde el teléfono con su URL secreta (POST a /x/hook/&lt;token&gt;). "Pausar" solo detiene los disparadores automáticos — Ejecutar siempre funciona.</p>
      <div class="sc-toolbar">
        <input id="sc-search" class="filter-input" type="search" placeholder="Buscar por nombre, descripción o comando…" aria-label="Buscar scripts" autocomplete="off">
      </div>
      <div id="sc-loading" class="listener-note">Cargando…</div>
      <div id="sc-list" class="sc-grid"></div>
      <div id="sc-list-err" class="empty-state hidden"><span class="sc-err-msg"></span> <button id="sc-retry" class="btn-secondary btn-inline">Reintentar</button></div>
      <div id="sc-empty" class="empty-state hidden">No hay scripts — creá el primero con "Nuevo script".</div>
      <div id="sc-noresult" class="empty-state hidden">Ningún script coincide con la búsqueda.</div>`;
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
    $('#sc-refresh').addEventListener('click', () => load());
    $('#sc-retry').addEventListener('click', () => load());
    $('#sc-search').addEventListener('input', (e) => { query = e.target.value.trim(); render(); });
    $('#sc-list').addEventListener('click', (e) => {
      // Click sobre el comando lo expande/colapsa.
      const cmdEl = e.target.closest('.sc-cmd');
      if (cmdEl) { cmdEl.classList.toggle('sc-cmd-open'); return; }
      const btn = e.target.closest('button');
      if (!btn) return;
      const card = btn.closest('.sc-card');
      const s = card && scripts.find((x) => x.id === card.dataset.id);
      if (!s) return;
      if (btn.classList.contains('sc-run')) runNow(s);
      else if (btn.classList.contains('sc-stop')) stopScript(s);
      else if (btn.classList.contains('sc-hist')) openHistory(s);
      else if (btn.classList.contains('sc-hook')) copyHook(s);
      else if (btn.classList.contains('sc-rotate')) rotateHook(s);
      else if (btn.classList.contains('sc-toggle')) toggleEnabled(s);
      else if (btn.classList.contains('sc-edit')) openEditor(s);
      else if (btn.classList.contains('sc-del')) removeScript(s);
      else if (btn.classList.contains('sc-last') && btn.dataset.job) openJobById(btn.dataset.job);
    });
    $('#sc-list').addEventListener('keydown', (e) => {
      const cmdEl = e.target.closest('.sc-cmd');
      if (cmdEl && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        cmdEl.classList.toggle('sc-cmd-open');
      }
    });

    // Light auto-refresh while the tab is visible (last-run times, running badges).
    refreshTimer = setInterval(() => {
      if (signedIn && section.classList.contains('active') && !document.hidden) load(true);
    }, 20000);

    refreshIcons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
