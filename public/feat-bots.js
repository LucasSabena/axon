/* AXON — feature: Bots (OpenBot)
 * Estado, acceso (login y QR del celular), agentes y consumo, acciones y logs de la
 * instancia de OpenBot que corre en Docker en el servidor.
 * Reusa los globales de app.js: $, $$, api, esc, icon, toast, errToast, confirmDialog, refreshIcons, relTime.
 */
(() => {
  'use strict';

  const fmt = new Intl.NumberFormat('es-AR');
  const usd = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
  const compact = (n) => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' M' : n >= 1e4 ? (n / 1e3).toFixed(0) + ' mil' : fmt.format(n);
  const when = (iso) => iso ? new Date(iso).toLocaleString('es-AR', { hour12: false, dateStyle: 'short', timeStyle: 'short' }) : '—';
  const PERIODS = [['today', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['all', 'Todo']];
  const LOGS = [['openbot', 'OpenBot'], ['update', 'Actualizaciones'], ['backup', 'Backups'], ['watchdog', 'Vigilante']];
  const UPDATE_LABEL = { ok: ['ok', 'Actualizado'], uptodate: ['ok', 'Al día'], pending: ['warn', 'Esperando imagen'], skipped: ['warn', 'Sin chequear'], rejected: ['warn', 'Versión rechazada'], rolledback: ['danger', 'Revertida'], failed: ['danger', 'Falló'], broken: ['danger', 'Roto'] };

  const REG = (window.AxonBots ||= { tabs: [] });
  const TAB_KEY = 'axon:bots-tab';
  let tab = (() => { try { return localStorage.getItem(TAB_KEY) || 'summary'; } catch { return 'summary'; } })();
  let job = null, jobTimer = null, jobDone = null;
  let status = null, usage = null, period = '7', logSource = 'openbot', logText = '', timer = null, ticket = 0;
  let loginStage = 'idle', loginEmail = '', loginMsg = '', qr = null, qrTimer = null, qrLeft = 0, busy = false, active = false;

  const savedEmail = () => { try { return localStorage.getItem('axon:openbot-email') || ''; } catch { return ''; } };
  const saveEmail = (v) => { try { localStorage.setItem('axon:openbot-email', v); } catch { /* sin storage */ } };

  // ---------- DOM ----------
  function ensureDom() {
    if ($('#tab-bots')) return;
    const nav = $('.sidebar-nav'), anchor = $('#sidebar-settings');
    if (nav && anchor) {
      const btn = document.createElement('button');
      btn.className = 'nav-item tab-btn'; btn.dataset.tab = 'bots';
      btn.innerHTML = `${icon('messages-square')}<span class="nav-label">Bots</span><span class="nav-count nav-alert hidden" id="nav-count-bots"></span>`;
      nav.insertBefore(btn, anchor);
      btn.addEventListener('click', () => window.activateAxonSection('bots', false));
    }
    const main = $('main.content'); if (!main) return;
    const sec = document.createElement('section'); sec.id = 'tab-bots'; sec.className = 'tab-content';
    sec.innerHTML = (`
      <div class="section-header">
        <h2>Bots</h2>
        <div class="section-actions"><span class="last-updated" id="bots-updated"></span>
          <button id="bots-refresh" class="btn-secondary" title="Actualizar">${icon('refresh-cw')}</button></div>
      </div>
      <p class="listener-note">OpenBot corre en Docker en este servidor. Desde acá ves su estado, abrís la sesión, conectás el celular, manejás proveedores y cuentas web, y arreglás problemas.</p>
      <div id="bots-job" class="bots-job hidden" role="status" aria-live="polite"></div>
      <div id="bots-tabs" class="bots-tabs" role="tablist" aria-label="Secciones de Bots"></div>
      <div id="bots-body" class="bots-body"></div>`);
    main.append(sec);
    sec.querySelector('#bots-refresh').addEventListener('click', () => refreshAll(true));
    sec.addEventListener('click', onClick);
    sec.addEventListener('submit', onSubmit);
    sec.addEventListener('change', (ev) => { const mod = tab !== 'summary' ? modFor(tab) : null; if (mod?.onChange) mod.onChange(ev); });
  }

  // ---------- datos ----------
  async function loadStatus() {
    try { status = await api('/api/openbot/status'); status.error = null; }
    catch (e) { status = status ? { ...status, error: e.message || 'Sin conexión' } : { ok: false, error: e.message || 'Sin conexión' }; }
    const nav = $('#nav-count-bots');
    if (nav) { const bad = status?.container && (!status.container.exists || status.container.state !== 'running' || (status.status && !status.status.signedIn)); nav.classList.toggle('hidden', !bad); nav.textContent = bad ? '!' : ''; }
  }
  async function loadUsage() {
    try { usage = await api('/api/openbot/usage?period=' + period); }
    catch (e) { usage = { ok: false, error: e.message || 'No se pudo leer el consumo' }; }
  }
  async function loadLogs() {
    try { logText = (await api('/api/openbot/logs?source=' + logSource)).text || ''; }
    catch (e) { logText = 'No se pudo leer el log: ' + (e.message || ''); }
  }
  const modFor = (id) => REG.tabs.find((t) => t.id === id);
  async function refreshAll(force = false) {
    const mine = ++ticket;
    const mod = tab !== 'summary' ? modFor(tab) : null;
    if (force || (!status && !mod)) paintLoading();
    if (mod) { paintTabs(); const b = $('#bots-body'); if (b && (force || !mod.loaded)) b.innerHTML = AxonUI.skeleton('Cargando', 3); await Promise.all([loadStatus(), mod.load(force).catch(() => {})]); mod.loaded = true; }
    else await Promise.all([loadStatus(), loadUsage()]);
    if (mine !== ticket) return;
    paint();
    const stamp = $('#bots-updated'); if (stamp) stamp.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR', { hour12: false });
  }
  function poll() { clearInterval(timer); timer = setInterval(async () => { if (!active || document.hidden || busy) return; await loadStatus(); if (tab === 'summary' && loginStage === 'idle') paintStatusOnly(); }, 15000); }
  async function restore() { active = true; ensureDom(); poll(); await refreshAll(); resumeJob(); }
  function leave() { active = false; clearInterval(timer); stopQr(); }
  Object.assign(REG, { repaint: () => paint(), trackJob, guarded: (fn) => guarded(fn), refreshStatus: loadStatus, esc: (v) => esc(v), when, fmt, compact, usd, isBusy: () => busy });

  // ---------- render ----------
  function paintLoading() { const b = $('#bots-body'); if (b && !status?.ok) b.innerHTML = AxonUI.skeleton('Leyendo OpenBot', 4); }
  function stateView() {
    const c = status?.container, s = status?.status;
    if (!status?.ok) return ['danger', 'Sin datos', status?.error || 'No se pudo leer el estado'];
    if (!c?.exists) return ['danger', 'No existe', 'El contenedor de OpenBot no está creado'];
    if (c.state !== 'running') return [status.manualStop ? 'warn' : 'danger', status.manualStop ? 'Detenido' : 'Caído', status.manualStop ? 'Lo detuviste a mano' : 'El vigilante lo levanta solo en unos minutos'];
    if (c.health && c.health !== 'healthy') return ['warn', 'Arrancando', 'Verificando salud…'];
    if (!s?.signedIn) return ['warn', 'Sin sesión', 'Iniciá sesión para usarlo desde el celular'];
    return ['ok', 'Funcionando', 'Sesión abierta y servidor en línea'];
  }
  function statusCard() {
    const [tone, label, hint] = stateView(), c = status?.container || {}, s = status?.status || {}, u = status?.update;
    const upd = u ? (UPDATE_LABEL[u.result] || ['warn', u.result]) : null;
    const row = (k, v) => `<div class="bots-kv"><dt>${k}</dt><dd>${v}</dd></div>`;
    const alerts = (status?.alerts || []).slice().reverse();
    return `<article class="bots-card bots-status" id="bots-status-card">
      <header><span class="bots-dot is-${tone}"></span><h3>${esc(label)}</h3><small>${esc(hint)}</small></header>
      <dl class="bots-facts">
        ${row('Versión', esc(s.version || '—'))}
        ${row('Cuenta', s.account ? esc(s.account) : '<span class="bots-dim">sin sesión</span>')}
        ${row('Servidor', s.online ? 'En línea' : esc(s.server || '—'))}
        ${row('Memoria', esc((s.memory || '—').replace(/ \(ok\)$/, '')))}
        ${row('Encendido', c.startedAt ? esc(relTime(Date.parse(c.startedAt))) : '—')}
        ${row('Reinicios', c.restarts ? `<span class="bots-warn">${fmt.format(c.restarts)}</span>` : '0')}
        ${row('Último backup', status?.lastBackup ? esc(status.lastBackup.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2}).*/, '$3/$2/$1 $4:$5 UTC')) : '—')}
        ${row('Actualización', upd ? `<span class="badge bots-badge is-${upd[0]}">${esc(upd[1])}</span> <span class="bots-dim">${esc(when(u.at))}</span>` : '—')}
        ${row('Próximo chequeo', status?.nextUpdate ? esc(status.nextUpdate) : '—')}
      </dl>
      ${u && ['rejected', 'rolledback', 'failed', 'broken'].includes(u.result) ? `<p class="bots-note is-warn">${esc(u.detail || '')}</p>` : ''}
      ${alerts.length ? `<details class="bots-alerts"><summary>${icon('triangle-alert')} Alertas del actualizador (${alerts.length})</summary><ul>${alerts.map((a) => `<li><span class="bots-dim">${esc(when(a.at))}</span> ${esc(a.msg)}</li>`).join('')}</ul></details>` : ''}
    </article>`;
  }
  function qrSvg(rows) {
    const M = 4, w = rows[0].length, h = rows.length; let d = '';
    rows.forEach((row, y) => { for (let x = 0; x < w; x++) if (row[x] === '1') d += `M${x + M} ${y + M}h1v1h-1z`; });
    return `<svg class="bots-qr" viewBox="0 0 ${w + 2 * M} ${h + 2 * M}" role="img" aria-label="Código QR para conectar el celular" shape-rendering="crispEdges"><rect width="${w + 2 * M}" height="${h + 2 * M}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  function accessCard() {
    const s = status?.status || {};
    if (loginStage === 'code') return `<article class="bots-card" id="bots-access"><header><h3>Iniciar sesión</h3></header>
      <p class="bots-hint ${/incorrecto|venci|Demasiados/i.test(loginMsg) ? 'bots-warn' : ''}">${esc(loginMsg)}</p>
      <form class="bots-form" data-form="code"><label>Código<input class="filter-input" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="ABCD-1234" required></label>
        <div class="bots-actions"><button class="btn-primary" ${busy ? 'disabled' : ''}>Confirmar</button><button type="button" class="btn-secondary" data-act="login-cancel">Cancelar</button></div></form></article>`;
    if (s.signedIn) return `<article class="bots-card" id="bots-access"><header><h3>Celular</h3></header>
      <p class="bots-hint">Abrí la app de OpenBot en el celular e iniciá sesión con <strong>${esc(s.account)}</strong>. Si no ve el servidor, conectalo con este código.</p>
      ${qr ? `<div class="bots-qrbox">${qrSvg(qr)}<p class="bots-dim">Vence en <strong id="bots-qr-left">${qrLeft}</strong> s. Sirve para una sola conexión.</p></div>` : ''}
      <div class="bots-actions"><button class="btn-primary" data-act="qr" ${busy ? 'disabled' : ''}>${icon('qr-code')} ${qr ? 'Nuevo código' : 'Conectar celular'}</button>${qr ? '<button class="btn-secondary" data-act="qr-hide">Ocultar</button>' : ''}</div>
      ${loginMsg ? `<p class="bots-note">${esc(loginMsg)}</p>` : ''}</article>`;
    return `<article class="bots-card" id="bots-access"><header><h3>Iniciar sesión</h3></header>
      <p class="bots-hint">OpenBot no tiene sesión abierta. Te llega un código por email y lo pegás acá.</p>
      <form class="bots-form" data-form="email"><label>Email de la cuenta<input class="filter-input" type="email" name="email" autocomplete="email" value="${esc(loginEmail || savedEmail())}" required></label>
        <div class="bots-actions"><button class="btn-primary" ${busy ? 'disabled' : ''}>Enviar código</button></div></form>
      ${loginMsg ? `<p class="bots-note is-warn">${esc(loginMsg)}</p>` : ''}</article>`;
  }
  function actionsCard() {
    const running = status?.container?.state === 'running';
    const b = (act, ic, label, cls = 'btn-secondary') => `<button class="${cls}" data-act="${act}" ${busy ? 'disabled' : ''}>${icon(ic)} ${label}</button>`;
    return `<article class="bots-card"><header><h3>Acciones</h3></header><div class="bots-actions wrap">
      ${b('restart', 'rotate-cw', 'Reiniciar')}
      ${running ? b('stop', 'square', 'Detener') : b('start', 'play', 'Iniciar', 'btn-primary')}
      ${b('backup', 'archive', 'Backup ahora')}
      ${b('update', 'download', 'Buscar actualización')}</div>
      <p class="bots-hint">Las actualizaciones corren solas todos los días: hacen backup, prueban la versión nueva en una copia y vuelven atrás si algo falla.</p></article>`;
  }
  // Paleta categórica estable: el color de un modelo depende de su posición en la lista ordenada por nombre.
  const PALETTE = ['#4f8cff', '#f2994a', '#2fb585', '#c25be0', '#e5484d', '#14b8d4', '#d4a017', '#8e8ef0', '#78a05a', '#d9638f'];
  let metric = 'tokens', colorOf = () => '#9aa4b2';
  function buildColors() {
    const names = [...new Set([...(usage?.models || []).map((m) => m.model), ...(usage?.agents || []).flatMap((a) => a.models.map((x) => x.model))])].sort();
    const map = new Map(names.map((n, i) => [n, i < PALETTE.length ? PALETTE[i] : `hsl(${(i * 47) % 360} 55% 55%)`]));
    colorOf = (m) => map.get(m) || '#9aa4b2';
  }
  const shortModel = (m) => String(m || '').replace(/^opencode(-go)?\//, (x, g) => (g ? 'Go · ' : ''));
  const cost = (priced, free, usdValue) => priced ? (usdValue > 0 ? usd(usdValue) : (free ? 'Gratis' : usd(0))) : '<span class="bots-dim">Sin tarifa</span>';
  const rateText = (r, m) => (r ? `entrada ${usd(r.input || 0)} · salida ${usd(r.output || 0)} / 1M${m && m.basis === 'api-equivalent' ? ` · equivale a ${m.priceModel}` : ''}` : 'sin tarifa en models.dev');
  function stackedChart() {
    const days = usage.daily.slice(-30); if (!days.length) return '<p class="bots-dim">Sin actividad en este período.</p>';
    const val = (d) => (metric === 'usd' ? d.usd : d.tokens);
    const max = Math.max(1e-9, ...days.map(val));
    const cols = days.map((d) => {
      const src = metric === 'usd' ? d.modelsUsd : d.models, total = Math.max(1e-9, val(d));
      const segs = Object.entries(src).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([m, v]) => `<i style="height:${(v / total * 100).toFixed(2)}%;background:${colorOf(m)}"></i>`).join('');
      const tip = `${d.day} · ${metric === 'usd' ? usd(d.usd) : fmt.format(d.tokens) + ' tokens'}\n` + Object.entries(src).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${shortModel(m)}: ${metric === 'usd' ? usd(v) : fmt.format(v)}`).join('\n');
      return `<span class="bots-col2" title="${esc(tip)}"><span class="bots-stack" style="height:${Math.max(3, val(d) / max * 100).toFixed(1)}%">${segs || '<i style="height:100%;background:var(--border)"></i>'}</span><small>${esc(d.day.slice(8))}</small></span>`;
    }).join('');
    return `<div class="bots-chart2" role="img" aria-label="${metric === 'usd' ? 'Costo' : 'Tokens'} por día, apilado por modelo">${cols}</div>`;
  }
  function usageCard() {
    const head = `<header><h3>Consumo</h3><div class="bots-seg" role="group" aria-label="Período">${PERIODS.map(([v, l]) => `<button type="button" class="${v === period ? 'is-on' : ''}" data-period="${v}" aria-pressed="${v === period}">${l}</button>`).join('')}</div></header>`;
    if (!usage?.ok) return `<article class="bots-card bots-wide">${head}<p class="bots-note is-warn">${esc(usage?.error || 'Sin datos de consumo')}</p></article>`;
    buildColors();
    const t = usage.totals, maxTok = Math.max(1, ...usage.models.map((m) => m.tokens));
    const tile = (k, v, sub = '') => `<div class="bots-tile"><span>${k}</span><strong>${v}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const sub = [t.freeRequests ? `${fmt.format(t.freeRequests)} gratis` : '', t.unpricedRequests ? `${fmt.format(t.unpricedRequests)} sin tarifa` : ''].filter(Boolean).join(' · ');
    const rows = usage.models.slice(0, 12).map((m) => `<tr><td><span class="bots-sw" style="background:${colorOf(m.model)}"></span>${esc(shortModel(m.model))}<small class="bots-sub">${esc(rateText(m.rate, m))}</small></td>
      <td class="bots-share"><span style="width:${(m.tokens / maxTok * 100).toFixed(1)}%;background:${colorOf(m.model)}"></span></td>
      <td class="num">${compact(m.tokens)}</td><td class="num">${fmt.format(m.requests)}</td><td class="num">${cost(m.pricedRequests, m.free, m.usd)}</td></tr>`).join('');
    return `<article class="bots-card bots-wide">${head}
      <div class="bots-tiles">${tile('Tokens', compact(t.tokens))}${tile('Solicitudes', fmt.format(t.requests))}${tile('Turnos', fmt.format(t.turns))}${tile('Costo equivalente por API', t.pricedRequests ? (t.usd > 0 ? usd(t.usd) : 'Gratis') : '—', sub || 'estimado con tarifa pública')}</div>
      <div class="bots-chart-head"><strong>Por día</strong><div class="bots-seg" role="group" aria-label="Métrica"><button type="button" class="${metric === 'tokens' ? 'is-on' : ''}" data-metric="tokens">Tokens</button><button type="button" class="${metric === 'usd' ? 'is-on' : ''}" data-metric="usd">Costo</button></div></div>
      ${stackedChart()}
      ${rows ? `<div class="bots-tablewrap"><table class="bots-table"><thead><tr><th>Modelo</th><th>Participación</th><th class="num">Tokens</th><th class="num">Solic.</th><th class="num">Costo equiv.</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
      <p class="bots-hint">El costo es una estimación con el mismo catálogo de precios (models.dev) que usa la sección Agentes: tokens × tarifa por millón de tokens. Un plan fijo como OpenCode Go no cobra por uso (se compara con la API del modelo original) y los modelos gratuitos valen 0; sirve para ver cuánto costaría por API directa.</p>
    </article>`;
  }
  function agentsCard() {
    if (!usage?.ok) return '';
    const rows = usage.agents.map((a) => {
      const tot = Math.max(1, a.tokens);
      const bar = a.models.length ? `<span class="bots-mix" title="${esc(a.models.map((x) => `${shortModel(x.model)}: ${fmt.format(x.tokens)}`).join('\n'))}">${a.models.map((x) => `<i style="width:${(x.tokens / tot * 100).toFixed(2)}%;background:${colorOf(x.model)}"></i>`).join('')}</span>` : '';
      return `<tr><td><strong>${esc(a.name)}</strong>${a.title ? `<small class="bots-sub">${esc(a.title)}</small>` : ''}</td>
      <td>${esc(shortModel(a.model))}${a.effort ? ` <span class="badge bots-badge">${esc(a.effort)}</span>` : ''}</td>
      <td class="num">${compact(a.tokens)}${bar}</td><td class="num">${fmt.format(a.turns)}</td>
      <td class="num">${cost(a.pricedRequests, a.freeRequests === a.pricedRequests, a.usd)}</td>
      <td>${a.lastActivity ? esc(when(a.lastActivity)) : '—'}</td></tr>`;
    }).join('');
    return `<article class="bots-card bots-wide"><header><h3>Agentes <small>${usage.agents.length}</small></h3></header>
      ${rows ? `<div class="bots-tablewrap"><table class="bots-table"><thead><tr><th>Agente</th><th>Modelo</th><th class="num">Tokens por modelo</th><th class="num">Turnos</th><th class="num">Costo equiv.</th><th>Última actividad</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="bots-dim">OpenBot no tiene agentes.</p>'}
      <p class="bots-hint">Para ver el detalle de un agente (skills, rutinas, memoria) usá la pestaña <strong>Agentes</strong>.</p></article>`;
  }
  function logsCard() {
    return `<article class="bots-card bots-wide"><header><h3>Registros</h3><div class="bots-seg" role="group" aria-label="Fuente del registro">${LOGS.map(([v, l]) => `<button type="button" class="${v === logSource ? 'is-on' : ''}" data-log="${v}" aria-pressed="${v === logSource}">${l}</button>`).join('')}</div></header>
      ${logText ? `<pre class="bots-log" tabindex="0">${esc(logText)}</pre>` : '<div class="bots-actions"><button class="btn-secondary" data-act="logs">Cargar registro</button></div>'}</article>`;
  }
  function paintTabs() {
    const el = $('#bots-tabs'); if (!el) return;
    const all = [{ id: 'summary', label: 'Resumen', icon: 'layout-dashboard' }, ...REG.tabs];
    if (!all.some((t) => t.id === tab)) tab = 'summary';
    const prev = el.scrollLeft;
    el.innerHTML = all.map((t) => { const n = t.badge?.(); return `<button type="button" role="tab" class="bots-tab ${t.id === tab ? 'is-on' : ''}" data-tab-go="${esc(t.id)}" aria-selected="${t.id === tab}">${icon(t.icon || 'circle')}<span>${esc(t.label)}</span>${n ? `<em class="bots-tab-badge">${esc(String(n))}</em>` : ''}</button>`; }).join('');
    el.scrollLeft = prev; el.querySelector('.is-on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
  function paint() {
    const b = $('#bots-body'); if (!b) return;
    paintTabs();
    const keep = { logs: $('.bots-log')?.scrollTop, y: $('main.content')?.scrollTop };
    const mod = tab !== 'summary' ? modFor(tab) : null;
    if (mod) b.innerHTML = mod.render({ busy });
    else b.innerHTML = (`<div class="bots-grid">${statusCard()}<div class="bots-col">${accessCard()}${actionsCard()}</div>${usageCard()}${agentsCard()}${logsCard()}</div>`);
    refreshIcons();
    const l = $('.bots-log'); if (l) l.scrollTop = keep.logs ?? l.scrollHeight;
  }
  function paintJob() {
    const el = $('#bots-job'); if (!el) return;
    if (!job) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    const run = job.state === 'running';
    el.className = `bots-job is-${run ? 'run' : job.state}`;
    el.innerHTML = `${run ? '<span class="bots-spin" aria-hidden="true"></span>' : icon(job.state === 'done' ? 'circle-check' : 'triangle-alert')}<div><strong>${esc(job.name)}</strong><span>${esc(run ? 'En curso… OpenBot puede reiniciarse; no cierres el panel.' : job.message)}</span></div>${run ? '' : '<button type="button" class="btn-secondary" data-act="job-close">Cerrar</button>'}`;
    refreshIcons();
  }
  /** Sigue una tarea en segundo plano hasta que termina, y recarga lo visible. */
  function trackJob(first) {
    job = first || job; clearInterval(jobTimer); paintJob();
    if (!job || job.state !== 'running') return;
    jobTimer = setInterval(async () => {
      try {
        const r = await api('/api/openbot/job'); job = r.job; paintJob();
        if (job && job.state !== 'running') { clearInterval(jobTimer); toast(job.message, job.state === 'done' ? 'ok' : 'error'); jobDone = job.id; await refreshAll(true); }
      } catch { /* el panel puede estar reiniciándose: se reintenta */ }
    }, 2500);
  }
  async function resumeJob() { try { const r = await api('/api/openbot/job'); if (r.job && (r.job.state === 'running' || r.job.id !== jobDone)) { job = r.job; if (job.state === 'running') trackJob(job); else paintJob(); } } catch { /* sin datos */ } }
  function paintStatusOnly() { const old = $('#bots-status-card'); if (!old) return paint(); const tpl = document.createElement('div'); tpl.innerHTML = statusCard(); old.replaceWith(tpl.firstElementChild); refreshIcons(); }

  // ---------- QR ----------
  function stopQr() { clearInterval(qrTimer); qrTimer = null; }
  function startQr(lines, seconds) {
    stopQr(); qr = lines; qrLeft = seconds;
    qrTimer = setInterval(() => { qrLeft -= 1; const el = $('#bots-qr-left'); if (el) el.textContent = qrLeft; if (qrLeft <= 0) { stopQr(); qr = null; paint(); } }, 1000);
  }

  // ---------- eventos ----------
  async function guarded(fn) { if (busy) return; busy = true; paint(); try { await fn(); } catch (e) { errToast(e); } finally { busy = false; paint(); } }
  async function onSubmit(ev) {
    const form = ev.target.closest('[data-form]'); if (!form) return; ev.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (tab !== 'summary') { const mod = modFor(tab); if (mod?.onSubmit) return mod.onSubmit(form.dataset.form, data, form); }
    if (form.dataset.form === 'email') return guarded(async () => {
      loginEmail = String(data.email || '').trim(); saveEmail(loginEmail); loginMsg = '';
      const r = await api('/api/openbot/login/start', { method: 'POST', body: { email: loginEmail } });
      loginMsg = r.message || ''; loginStage = r.stage === 'code' ? 'code' : 'idle';
      if (r.stage === 'done') { loginMsg = ''; toast('Sesión abierta', 'ok'); await loadStatus(); }
      else if (r.stage === 'error') toast(loginMsg || 'No se pudo enviar el código', 'error');
    });
    if (form.dataset.form === 'code') return guarded(async () => {
      const r = await api('/api/openbot/login/code', { method: 'POST', body: { code: String(data.code || '').trim() } });
      if (r.stage === 'done') { loginStage = 'idle'; loginMsg = ''; toast('Sesión iniciada', 'ok'); await loadStatus(); }
      else { loginMsg = r.message || 'Código incorrecto'; toast(loginMsg, 'error'); loginStage = r.stage === 'code' ? 'code' : 'idle'; }
    });
  }
  async function onClick(ev) {
    const go = ev.target.closest('[data-tab-go]');
    if (go) { tab = go.dataset.tabGo; try { localStorage.setItem(TAB_KEY, tab); } catch { /* sin storage */ } stopQr(); qr = null; return refreshAll(); }
    if (ev.target.closest('[data-act="job-close"]')) { job = null; paintJob(); return; }
    if (tab !== 'summary') { const mod = modFor(tab); if (mod?.onClick && (await mod.onClick(ev))) return; return; }
    const met = ev.target.closest('[data-metric]'); if (met) { metric = met.dataset.metric; return paint(); }
    const per = ev.target.closest('[data-period]'); if (per) { period = per.dataset.period; await loadUsage(); return paint(); }
    const src = ev.target.closest('[data-log]'); if (src) { logSource = src.dataset.log; logText = ''; paint(); await loadLogs(); return paint(); }
    const el = ev.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act;
    if (act === 'logs') { await loadLogs(); return paint(); }
    if (act === 'login-cancel') { try { await api('/api/openbot/login/cancel', { method: 'POST', body: {} }); } catch { /* ya vencido */ } loginStage = 'idle'; loginMsg = ''; return paint(); }
    if (act === 'qr-hide') { stopQr(); qr = null; return paint(); }
    if (act === 'qr') return guarded(async () => { const r = await api('/api/openbot/mobile-connect', { method: 'POST', body: {} }); startQr(r.qr, r.expiresInSeconds || 120); loginMsg = ''; });
    const texts = {
      restart: ['Reiniciar OpenBot', 'Se corta unos segundos lo que esté haciendo. La sesión se conserva.', 'Reiniciar'],
      stop: ['Detener OpenBot', 'Queda detenido hasta que lo inicies de nuevo. Los agentes no responden mientras tanto.', 'Detener'],
      start: null,
      backup: ['Hacer backup', 'OpenBot se detiene aproximadamente un minuto mientras se copia y vuelve solo.', 'Hacer backup'],
      update: ['Buscar actualización', 'Si hay una versión nueva, se prueba en una copia de tus datos y solo se aplica si es segura. Puede tardar varios minutos y reiniciar OpenBot.', 'Buscar'],
    }[act];
    if (texts === undefined) return;
    if (texts && !(await confirmDialog(texts[0], texts[1], texts[2]))) return;
    guarded(async () => {
      const r = await api('/api/openbot/action', { method: 'POST', body: { action: act } });
      if (r.started) { trackJob(r.job); return; }
      toast(r.message || 'Listo', r.ok ? 'ok' : 'error');
      await new Promise((res) => setTimeout(res, 1500));
      await loadStatus();
    });
  }

  document.addEventListener('axon:authenticated', () => { ensureDom(); });
  document.addEventListener('axon:section', (e) => { if (e.detail !== 'bots') leave(); else if (!active) { active = true; poll(); if (!window.AxonNavigation) restore(); } });
  document.addEventListener('axon:session-expired', leave);
  ensureDom();
  window.AxonPages ||= {};
  window.AxonPages.bots = { restore, leave, params: () => ({}) };
})();
