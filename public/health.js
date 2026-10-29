/* AXON — Salud: resumen, limpieza, espacio, rendimiento y sistema.
 * Se monta dentro de #tab-ops (creado por feat-ops.js) y mueve ahí las tarjetas de
 * sistema y el panel de contenedores. Si falta algo, Salud sigue mostrando lo anterior.
 */
(() => {
  'use strict';
  const GB = 1024 ** 3, MB = 1024 ** 2;
  const fmt = (n) => n == null ? '—' : n >= GB ? `${(n / GB).toFixed(1).replace('.', ',')} GB` : n >= MB ? `${Math.round(n / MB)} MB` : `${Math.round(n / 1024)} KB`;
  const pct = (n) => `${Math.round(n)} %`;
  const RISK = { safe: ['Seguro', 'hl-risk-safe'], regen: ['Se regenera', 'hl-risk-regen'], review: ['Revisar antes', 'hl-risk-review'] };
  const TABS = [['resumen', 'Resumen', 'layout-dashboard'], ['limpieza', 'Limpieza', 'sparkles'], ['espacio', 'Espacio', 'hard-drive'], ['rendimiento', 'Rendimiento', 'gauge'], ['sistema', 'Sistema', 'server']];
  const st = { tab: 'resumen', overview: null, clean: null, sel: new Set(), showEmpty: false, space: null, spacePath: null, perf: null, perfSort: 'cpu', open: new Set(), busy: false, timer: null };
  const root = () => document.getElementById('health');
  const $h = (sel) => root()?.querySelector(sel);

  // ---------- Montaje ----------

  const paint = (id, html) => { const el = $h(id); el.innerHTML = html; if (typeof refreshIcons === 'function') refreshIcons(); };


  function mount() {
    const tab = document.getElementById('tab-ops');
    if (!tab || root() || typeof api !== 'function') return false;
    const header = tab.querySelector('.section-header');
    header?.querySelector('h2') && (header.querySelector('h2').textContent = 'Salud');
    const box = document.createElement('div');
    box.id = 'health';
    box.innerHTML = `
      <nav class="hl-tabs" role="tablist">${TABS.map(([id, label, ic]) => `<button role="tab" data-hl-tab="${id}" aria-selected="${id === st.tab}">${icon(ic)}<span>${label}</span></button>`).join('')}</nav>
      <section class="hl-panel" id="hp-resumen"></section>
      <section class="hl-panel" id="hp-limpieza" hidden></section>
      <section class="hl-panel" id="hp-espacio" hidden><div id="hp-space-body"></div><div id="hp-space-extra"></div></section>
      <section class="hl-panel" id="hp-rendimiento" hidden><div id="hp-perf"></div><div id="hp-containers"></div></section>
      <section class="hl-panel" id="hp-sistema" hidden></section>`;
    header ? header.after(box) : tab.prepend(box);
    const grid = document.getElementById('ops-grid');
    if (grid) $h('#hp-sistema').append(grid);
    tab.querySelector(':scope > .opt-advanced')?.remove();
    const opt = document.getElementById('optimizer');
    if (opt) $h('#hp-containers').append(opt);
    if (typeof refreshIcons === 'function') refreshIcons();
    relocate(tab);
    new MutationObserver(() => relocate(tab)).observe(tab, { childList: true });
    box.addEventListener('click', onClick);
    box.addEventListener('change', onChange);
    box.addEventListener('submit', onSubmit);
    return true;
  }

  // Otras funciones inyectan sus paneles directo en #tab-ops: se acomodan en Espacio.
  function relocate(tab) {
    const slot = $h('#hp-space-extra');
    if (!slot) return;
    for (const n of [...tab.children]) {
      if (n.classList?.contains('host-disks-panel') || (n.tagName === 'P' && n.querySelector('a[href="/almacenamiento"]'))) slot.append(n);
    }
  }

  function setTab(id) {
    st.tab = id;
    for (const b of root().querySelectorAll('[data-hl-tab]')) b.setAttribute('aria-selected', String(b.dataset.hlTab === id));
    for (const [t] of TABS) $h('#hp-' + t).hidden = t !== id;
    refresh();
  }

  function refresh() {
    clearInterval(st.timer);
    const active = document.querySelector('.tab-btn[data-tab="ops"]')?.classList.contains('active');
    if (!active || !root()) return;
    ({ resumen: loadSummary, limpieza: loadClean, espacio: loadSpace, rendimiento: loadPerf, sistema: () => {} })[st.tab]();
    if (st.tab === 'rendimiento' || st.tab === 'resumen') st.timer = setInterval(() => { if (!document.hidden && !st.busy) (st.tab === 'rendimiento' ? loadPerf : loadSummary)(true); }, 6000);
  }

  const failure = (id, err) => { const el = $h(id); if (el && (!el.children.length || el.querySelector('.hl-loading'))) paint(id, `<p class="hl-error">${icon('alert-triangle')} ${esc(err?.message || 'No se pudo cargar')}</p>`); };

  // ---------- Resumen ----------

  function spark(points, key, color) {
    if (points.length < 2) return '';
    const vals = points.map((p) => p[key]);
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1) * 300).toFixed(1)},${(34 - (p[key] - lo) / span * 30).toFixed(1)}`).join('');
    return `<svg viewBox="0 0 300 36" preserveAspectRatio="none" class="hl-spark" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  }

  async function loadSummary(quiet) {
    try {
      const o = await api('/api/health/overview');
      st.overview = o;
      renderSummary(o);
    } catch (e) { if (!quiet) failure('#hp-resumen', e); }
  }

  function renderSummary(o) {
    const d = o.disk, used = d.total ? d.used / d.total * 100 : 0;
    const level = used >= 90 ? 'danger' : used >= 80 ? 'warn' : 'ok';
    const delta = o.growth.diskDelta;
    const grow = delta == null ? 'Todavía no hay suficiente historial para saber cuánto crece.' : delta > 0 ? `Creció ${fmt(delta)} en las últimas 24 h.` : `Liberó ${fmt(-delta)} en las últimas 24 h.`;
    const cpu = o.cpu, mem = o.mem;
    const memUsed = mem ? (1 - mem.available / mem.total) * 100 : null;
    const psiCpu = cpu?.psi?.cpu?.some?.avg60 ?? null, psiMem = cpu?.psi?.memory?.some?.avg60 ?? null;
    const last = o.lastRun;
    paint('#hp-resumen', `
      <div class="hl-hero hl-${level}">
        <div class="hl-hero-main">
          <div class="hl-hero-title"><span>Disco principal</span><b>${fmt(d.avail)} libres</b></div>
          <div class="hl-bar" role="img" aria-label="Disco al ${pct(used)}"><i style="width:${Math.min(100, used).toFixed(1)}%"></i></div>
          <p class="hl-muted">${fmt(d.used)} usados de ${fmt(d.total)} (${pct(used)}). ${grow}</p>
          ${spark(o.history, 'used', 'var(--accent)')}
        </div>
        <div class="hl-hero-action">
          <button class="btn-primary" id="hl-optimize" ${st.busy ? 'disabled' : ''}>${icon('zap')} Optimizar ahora</button>
          <small>Borra temporales, logs viejos y bases ya procesadas, y baja la prioridad de tareas pesadas de fondo. No toca tus archivos.</small>
          <p id="hl-optimize-result" class="hl-result" role="status">${last ? `Última limpieza ${relTime(last.at)}: liberó ${fmt(last.freed)}.` : ''}</p>
        </div>
      </div>
      <div class="hl-tiles">
        ${tile('CPU', cpu ? pct(cpu.pct) : '—', cpu ? `${cpu.ncpu} núcleos · carga ${cpu.load.map((x) => x.toFixed(1)).join(' / ')}` : 'Midiendo…', spark(o.trail, 'cpu', 'var(--accent)'))}
        ${tile('Memoria', memUsed == null ? '—' : pct(memUsed), mem ? `${fmt(mem.available)} disponibles · swap usada ${fmt(mem.swapTotal - mem.swapFree)}` : '', spark(o.trail, 'mem', 'var(--ok)'))}
        ${tile('Presión', psiCpu == null ? '—' : `${psiCpu.toFixed(0)} % / ${psiMem.toFixed(0)} %`, 'CPU / memoria: % del último minuto en que algo tuvo que esperar. Menos de 10 % es sano.', '')}
        ${tile('Temperatura', cpu?.temp == null ? '—' : `${Math.round(cpu.temp)} °C`, cpu?.freqMhz ? `Frecuencia media ${cpu.freqMhz} MHz` : '', '')}
      </div>
      <div class="hl-cols">
        <div class="hl-card"><h3>${icon('lightbulb')} Qué conviene hacer</h3>${o.recommendations.length ? `<ul class="hl-recs">${o.recommendations.map((r) => `<li class="hl-rec hl-${r.level}"><div><b>${esc(r.title)}</b><small>${esc(r.detail)}</small></div><button class="btn-secondary" data-go="${esc(r.go)}">${r.go === 'optimize' ? 'Optimizar' : 'Ver'}</button></li>`).join('')}</ul>` : `<p class="hl-ok">${icon('check-circle-2')} Todo en orden. No hay nada urgente.</p>`}</div>
        <div class="hl-card"><h3>${icon('trending-up')} Lo que más creció</h3>${growthHtml(o.growth, o.lastSnap)}</div>
      </div>
      ${o.disks.length > 1 ? `<div class="hl-card"><h3>${icon('hard-drive')} Otros discos</h3><div class="hl-disks">${o.disks.filter((x) => x.mount !== '/').map((x) => { const p = x.total ? x.used / x.total * 100 : 0; return `<button class="hl-disk" data-space="${esc(x.mount)}"><b>${esc(x.mount)}</b><span class="hl-bar sm"><i style="width:${p.toFixed(0)}%"></i></span><small>${fmt(x.avail)} libres de ${fmt(x.total)}</small></button>`; }).join('')}</div></div>` : ''}`);
  }

  const tile = (label, value, sub, extra) => `<div class="hl-tile"><span>${label}</span><b>${value}</b><small>${esc(sub)}</small>${extra}</div>`;

  function growthHtml(g, snapAt) {
    if (!g.since) return `<p class="hl-muted">Estoy tomando la primera medición de carpetas${snapAt ? '' : ' (tarda unos minutos)'}. Mañana vas a ver acá qué creció.</p>`;
    if (!g.items.length) return `<p class="hl-ok">${icon('check-circle-2')} Ninguna carpeta creció más de 100 MB desde ${relTime(g.since)}.</p>`;
    return `<ul class="hl-grow">${g.items.map((i) => `<li><button data-space="${esc(i.path)}" title="Ver en Espacio"><span class="hl-path">${esc(i.path.replace(/^\/home\/[^/]+/, '~'))}</span><b>+${fmt(i.delta)}</b></button></li>`).join('')}</ul><p class="hl-muted">Desde ${relTime(g.since)}. Tocá una para ver qué hay adentro.</p>`;
  }

  async function optimize() {
    if (st.busy) return;
    st.busy = true;
    const btn = $h('#hl-optimize'); if (btn) { btn.disabled = true; btn.innerHTML = `${icon('loader')} Optimizando…`; }
    try {
      const r = await api('/api/health/optimize', { method: 'POST', body: {} });
      const done = r.receipt.items.filter((i) => i.freed > 0).length;
      toast(`Liberé ${fmt(r.receipt.freed)}${r.reniced ? ` y bajé la prioridad de ${r.reniced} proceso${r.reniced > 1 ? 's' : ''}` : ''}`, 'ok');
      st.clean = null;
      const el = $h('#hl-optimize-result'); if (el) el.textContent = `Listo: ${fmt(r.receipt.freed)} liberados en ${done} lugar${done === 1 ? '' : 'es'}${r.reniced ? `, ${r.reniced} procesos con menos prioridad` : ''}.`;
    } catch (e) { errToast(e); }
    st.busy = false;
    await loadSummary(true);
  }

  // ---------- Limpieza ----------

  async function loadClean(force) {
    const el = $h('#hp-limpieza');
    if (!st.clean) paint('#hp-limpieza', `<p class="hl-loading">${icon('loader')} Analizando qué se puede limpiar…</p>`);
    try {
      const r = await api('/api/health/cleanup' + (force === true ? '?refresh=1' : ''));
      st.clean = r;
      const known = new Set(r.items.map((i) => i.id));
      st.sel = new Set([...st.sel].filter((id) => known.has(id)));
      if (!st.cleanInit) { st.cleanInit = true; for (const i of r.items) if (i.risk === 'safe' && !i.busy && (i.bytes || 0) > 0) st.sel.add(i.id); }
      renderClean();
    } catch (e) { failure('#hp-limpieza', e); }
  }

  const selBytes = () => (st.clean?.items || []).filter((i) => st.sel.has(i.id)).reduce((s, i) => s + (i.bytes || 0), 0);

  function renderClean() {
    const { items, receipts } = st.clean;
    const groups = new Map();
    for (const i of items) { if (!st.showEmpty && i.bytes === 0 && !i.busy) continue; (groups.get(i.groupLabel) || groups.set(i.groupLabel, []).get(i.groupLabel)).push(i); }
    const total = items.reduce((s, i) => s + (i.bytes || 0), 0);
    const auto = st.overview?.settings?.autoClean;
    paint('#hp-limpieza', `
      <div class="hl-toolbar">
        <div><b>${fmt(total)}</b> en total · <b>${fmt(selBytes())}</b> seleccionados</div>
        <div class="hl-actions">
          <label class="hl-check"><input type="checkbox" id="hl-empty" ${st.showEmpty ? 'checked' : ''}> Mostrar vacíos</label>
          <button class="btn-secondary" data-act="select-regen">Seleccionar cachés</button>
          <button class="btn-secondary" data-act="rescan">${icon('refresh-cw')} Analizar de nuevo</button>
          <button class="btn-primary" data-act="run-clean" ${st.sel.size && !st.busy ? '' : 'disabled'}>${icon('trash-2')} Limpiar selección</button>
        </div>
      </div>
      <p class="hl-muted">Marqué lo seguro. <b>Se regenera</b> significa que el programa lo vuelve a descargar o crear cuando lo necesita (puede tardar). <b>Revisar antes</b> borra datos tuyos y pide confirmación.</p>
      ${[...groups].map(([label, rows]) => `<div class="hl-card"><h3>${esc(label)}</h3><ul class="hl-rules">${rows.sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).map((i) => `
        <li class="${i.busy ? 'is-busy' : ''}"><label><input type="checkbox" data-rule="${esc(i.id)}" ${st.sel.has(i.id) ? 'checked' : ''} ${i.busy ? 'disabled' : ''}>
          <span class="hl-rule-text"><b>${esc(i.label)}</b><small>${esc(i.desc)}</small></span>
          <span class="hl-risk ${RISK[i.risk][1]}">${RISK[i.risk][0]}</span>
          <span class="hl-size">${i.busy ? 'En uso' : i.bytes == null ? 'Se ve al limpiar' : fmt(i.bytes)}</span></label></li>`).join('')}</ul></div>`).join('') || `<p class="hl-ok">${icon('check-circle-2')} No hay nada para limpiar.</p>`}
      <div class="hl-card"><h3>${icon('clock')} Limpieza automática</h3>
        <label class="hl-check"><input type="checkbox" id="hl-auto" ${auto?.enabled ? 'checked' : ''}> Cada día, borrar solo temporales, logs viejos, journal, APT y bases ya procesadas (lo marcado como <b>Seguro</b>).</label>
        <p class="hl-muted">Nunca borra cachés, papeleras ni Docker sin que lo pidas vos.</p></div>
      ${receipts.length ? `<div class="hl-card"><h3>${icon('history')} Últimas limpiezas</h3><ul class="hl-history">${receipts.map((r) => `<li><span>${relTime(r.at)} · ${r.kind === 'auto' ? 'automática' : r.kind === 'optimize' ? 'Optimizar' : 'manual'}</span><b>${fmt(r.freed)}</b><small>${esc(r.items.filter((i) => i.freed || !i.ok).slice(0, 4).map((i) => i.label + (i.ok ? '' : ` (${i.note || 'falló'})`)).join(' · '))}</small></li>`).join('')}</ul></div>` : ''}`);
  }

  async function runClean() {
    const items = st.clean.items.filter((i) => st.sel.has(i.id));
    if (!items.length || st.busy) return;
    const review = items.filter((i) => i.risk === 'review');
    const ok = await confirmDialog(review.length ? 'Borrar para siempre' : 'Limpiar selección',
      review.length ? `Vas a eliminar sin posibilidad de recuperarlo: ${review.map((i) => `${i.label} (${fmt(i.bytes)})`).join(', ')}. Más ${items.length - review.length} elemento(s) de limpieza segura.` : `Se van a liberar hasta ${fmt(selBytes())}. Nada de esto toca tus archivos personales.`, 'Limpiar');
    if (!ok) return;
    st.busy = true; renderClean();
    try {
      const r = await api('/api/health/cleanup/run', { method: 'POST', body: { ids: items.map((i) => i.id), confirmed: review.map((i) => i.id) } });
      const bad = r.receipt.items.filter((i) => !i.ok);
      toast(`Liberé ${fmt(r.receipt.freed)}${bad.length ? ` · ${bad.length} no se pudieron limpiar (${bad[0].note})` : ''}`, bad.length ? 'warn' : 'ok');
      st.sel.clear();
    } catch (e) { errToast(e); }
    st.busy = false;
    await loadClean(true);
  }

  // ---------- Espacio ----------

  async function loadSpace(path) {
    if (typeof path === 'string') st.spacePath = path;
    const target = st.spacePath;
    if (!st.space || path) paint('#hp-space-body', `<p class="hl-loading">${icon('loader')} Midiendo… en carpetas grandes puede tardar hasta un minuto.</p>`);
    try {
      const r = await api('/api/health/space' + (target ? `?path=${encodeURIComponent(target)}` : ''));
      st.space = r; st.spacePath = r.path; renderSpace();
    } catch (e) { st.space = null; failure('#hp-space-body', e); }
  }

  function renderSpace() {
    const r = st.space, parts = r.path.split('/').filter(Boolean);
    const crumbs = [['/', '/'], ...parts.map((p, i) => ['/' + parts.slice(0, i + 1).join('/'), p])];
    const max = Math.max(1, ...r.entries.map((e) => e.bytes));
    paint('#hp-space-body', `
      <div class="hl-toolbar"><nav class="hl-crumbs">${crumbs.map(([p, n]) => `<button data-space="${esc(p)}">${esc(n)}</button>`).join('<span>/</span>')}</nav><div><b>${fmt(r.total)}</b> en esta carpeta <button class="btn-secondary" data-space="${esc(r.path)}" data-fresh="1">${icon('refresh-cw')}</button></div></div>
      <ul class="hl-space">${r.entries.map((e) => `<li>
        <button class="hl-space-main" ${e.dir ? `data-space="${esc(e.path)}"` : 'disabled'} title="${esc(e.path)}">${icon(e.dir ? 'folder' : 'file')}<span class="hl-path">${esc(e.name)}</span>
          <span class="hl-bar sm"><i style="width:${(e.bytes / max * 100).toFixed(1)}%"></i></span><b>${fmt(e.bytes)}</b></button>
        <button class="hl-trash" data-trash="${esc(e.path)}" data-size="${e.bytes}" title="Enviar a la papelera">${icon('trash-2')}</button></li>`).join('') || '<li class="hl-muted">Carpeta vacía.</li>'}</ul>
      <p class="hl-muted">“Enviar a la papelera” no borra: mueve el elemento a la papelera del escritorio. El espacio se libera al vaciarla en Limpieza → Papeleras.</p>`);
  }

  async function trashItem(path, size) {
    const name = path.split('/').pop();
    if (!await confirmDialog('Enviar a la papelera', `“${name}” (${fmt(size)}) se mueve a la papelera. Podés recuperarlo hasta que la vacíes.`, 'Enviar')) return;
    try { await api('/api/health/space/trash', { method: 'POST', body: { path } }); toast(`“${name}” está en la papelera`, 'ok'); st.clean = null; await loadSpace(st.spacePath); }
    catch (e) { errToast(e); }
  }

  // ---------- Rendimiento ----------

  async function loadPerf(quiet) {
    try { st.perf = await api('/api/health/processes'); renderPerf(); }
    catch (e) { if (!quiet) failure('#hp-perf', e); }
  }

  const targetsOf = (g) => g.items.map((i) => ({ pid: i.pid, start: i.start }));

  function procRow(g, kind) {
    const prot = g.protectedReason || !g.mine;
    const hot = g.hotMinutes >= 5 ? `<span class="hl-pill hl-warn">≥${g.hotMinutes} min con CPU alta</span>` : '';
    const open = st.open.has(g.label);
    return `<li class="hl-proc ${open ? 'is-open' : ''}">
      <button class="hl-proc-main" data-open="${esc(g.label)}" aria-expanded="${open}"><b>${esc(g.label)}</b>${g.count > 1 ? `<small>×${g.count}</small>` : ''}${hot}
        <span class="hl-num">${kind === 'cpu' ? `${g.cpu.toFixed(1)} %` : fmt(g.rss)}</span><span class="hl-num hl-dim">${kind === 'cpu' ? fmt(g.rss) : `${g.cpu.toFixed(1)} %`}</span></button>
      <div class="hl-proc-actions">${prot ? `<small class="hl-muted" title="${esc(g.protectedReason || 'Pertenece al sistema')}">Protegido</small>` : `<button class="btn-secondary" data-nice="${esc(g.label)}" title="Que ceda CPU y disco a lo demás">Bajar prioridad</button><button class="btn-secondary" data-close="${esc(g.label)}">Cerrar</button>`}</div>
      ${open ? `<ul class="hl-proc-items">${g.items.map((i) => `<li><code>${i.pid}</code><span class="hl-path" title="${esc(i.args)}">${esc(i.args)}</span><small>${i.cpu.toFixed(1)} % · ${fmt(i.rss)} · nice ${i.nice}</small></li>`).join('')}</ul>` : ''}</li>`;
  }

  function renderPerf() {
    const p = st.perf, mem = p.mem, used = mem.total - mem.available, swap = mem.swapTotal - mem.swapFree;
    const rows = p.byCpu.concat(p.byMem);
    const find = (label) => rows.find((g) => g.label === label);
    st.find = find;
    const rules = st.overview?.settings?.autoNice;
    const list = (st.perfSort === 'cpu' ? p.byCpu : p.byMem);
    const el = $h('#hp-perf');
    if (el.contains(document.activeElement) && /INPUT/.test(document.activeElement.tagName) && document.activeElement.type === 'text') return;
    paint('#hp-perf', `
      <div class="hl-tiles">
        ${tile('CPU', pct(p.cpu), `${p.ncpu} núcleos · carga ${p.load.map((x) => x.toFixed(1)).join(' / ')}`, `<div class="hl-cores">${p.cores.map((c) => `<i title="${c} %" style="height:${Math.max(4, c)}%"></i>`).join('')}</div>`)}
        ${tile('Memoria', pct(used / mem.total * 100), `${fmt(mem.available)} disponibles de ${fmt(mem.total)} · ${fmt(mem.cached)} en caché (Linux la libera sola)`, `<div class="hl-bar sm"><i style="width:${(used / mem.total * 100).toFixed(0)}%"></i></div>`)}
        ${tile('Swap', mem.swapTotal ? fmt(swap) : '—', mem.swapTotal ? `de ${fmt(mem.swapTotal)}. Si crece sin parar, falta memoria.` : 'Sin swap', '')}
        ${tile('Presión', `${(p.psi.cpu?.some?.avg60 ?? 0).toFixed(0)} / ${(p.psi.memory?.some?.avg60 ?? 0).toFixed(0)} / ${(p.psi.io?.some?.avg60 ?? 0).toFixed(0)} %`, 'CPU / memoria / disco: tiempo del último minuto que algo esperó. Es la medida real de “está lento”.', '')}
      </div>
      <div class="hl-card"><div class="hl-card-head"><h3>${icon('list')} Qué consume</h3>
        <div class="hl-seg"><button data-sort="cpu" aria-pressed="${st.perfSort === 'cpu'}">CPU</button><button data-sort="mem" aria-pressed="${st.perfSort === 'mem'}">Memoria</button></div></div>
        <ul class="hl-procs">${list.map((g) => procRow(g, st.perfSort)).join('')}</ul></div>
      ${p.stale.length ? `<div class="hl-card"><h3>${icon('archive-x')} Posiblemente olvidados</h3><p class="hl-muted">Servidores de desarrollo abiertos hace más de 6 horas y sin actividad. Revisá antes de cerrarlos.</p><ul class="hl-procs">${p.stale.map((g) => { st.stale = p.stale; return `<li class="hl-proc"><button class="hl-proc-main" disabled><b>${esc(g.label)}</b><small>×${g.count}</small><span class="hl-num">${fmt(g.rss)}</span></button><div class="hl-proc-actions"><button class="btn-secondary" data-close-stale="${esc(g.label)}">Cerrar</button></div></li>`; }).join('')}</ul></div>` : ''}
      <div class="hl-card"><h3>${icon('sliders-horizontal')} Prioridad automática</h3>
        <label class="hl-check"><input type="checkbox" id="hl-nice-on" ${rules?.enabled ? 'checked' : ''}> Que las tareas pesadas de fondo cedan CPU y disco para que AXON y el escritorio sigan fluidos.</label>
        <ul class="hl-nice">${(rules?.rules || []).map((r) => `<li><label class="hl-check"><input type="checkbox" data-nice-rule="${esc(r.id)}" ${r.enabled ? 'checked' : ''}> ${esc(r.label)}</label>${r.custom ? `<button class="hl-x" data-nice-del="${esc(r.id)}" title="Quitar">${icon('x')}</button>` : ''}</li>`).join('')}</ul>
        <form class="hl-add" id="hl-nice-add"><input type="text" name="needle" placeholder="Texto del comando, ej. blender" minlength="3" maxlength="40" required><button class="btn-secondary">Agregar regla</button></form>
        <p class="hl-muted">Se revisa cada 30 segundos. Sólo sube el valor “nice” (menos prioridad); nunca cierra nada.</p></div>`);
  }

  const groupByLabel = (label) => st.find?.(label);

  async function niceGroup(label) {
    const g = groupByLabel(label); if (!g) return;
    try { const r = await api('/api/health/process/renice', { method: 'POST', body: { targets: targetsOf(g), nice: 15 } }); toast(`Bajé la prioridad de ${r.changed} proceso${r.changed === 1 ? '' : 's'}`, 'ok'); loadPerf(true); }
    catch (e) { errToast(e); }
  }

  async function closeGroup(g) {
    if (!g) return;
    if (!await confirmDialog('Cerrar programa', `Se le pide que cierre a ${g.label} (${g.count} proceso${g.count === 1 ? '' : 's'}). Si tiene trabajo sin guardar, se pierde.`, 'Cerrar')) return;
    try { const r = await api('/api/health/process/close', { method: 'POST', body: { targets: targetsOf(g) } }); toast(`Pedí el cierre de ${r.sent} proceso${r.sent === 1 ? '' : 's'}`, 'ok'); setTimeout(() => loadPerf(true), 1500); }
    catch (e) { errToast(e); }
  }

  async function saveSettings(patch) {
    try { const r = await api('/api/health/settings', { method: 'PUT', body: patch }); if (st.overview) st.overview.settings = r.settings; return r.settings; }
    catch (e) { errToast(e); loadPerf(true); }
  }

  // ---------- Eventos ----------

  function goTo(id) { setTab(id === 'optimize' ? 'resumen' : id); if (id === 'optimize') optimize(); }

  async function onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.hlTab) return setTab(t.dataset.hlTab);
    if (t.id === 'hl-optimize') return optimize();
    if (t.dataset.go) return goTo(t.dataset.go);
    if (t.dataset.space) { st.space = t.dataset.fresh ? null : st.space; setTab('espacio'); return loadSpace(t.dataset.space); }
    if (t.dataset.trash) return trashItem(t.dataset.trash, +t.dataset.size);
    if (t.dataset.act === 'rescan') { st.cleanInit = false; st.clean = null; return loadClean(true); }
    if (t.dataset.act === 'run-clean') return runClean();
    if (t.dataset.act === 'select-regen') { for (const i of st.clean.items) if (i.risk !== 'review' && !i.busy && (i.bytes || 0) > 0) st.sel.add(i.id); return renderClean(); }
    if (t.dataset.open) { st.open.has(t.dataset.open) ? st.open.delete(t.dataset.open) : st.open.add(t.dataset.open); return renderPerf(); }
    if (t.dataset.sort) { st.perfSort = t.dataset.sort; return renderPerf(); }
    if (t.dataset.nice) return niceGroup(t.dataset.nice);
    if (t.dataset.close) return closeGroup(groupByLabel(t.dataset.close));
    if (t.dataset.closeStale) return closeGroup(st.stale?.find((g) => g.label === t.dataset.closeStale));
    if (t.dataset.niceDel) { const rules = st.overview.settings.autoNice.rules.filter((r) => r.id !== t.dataset.niceDel); await saveSettings({ autoNice: { rules } }); return loadPerf(true); }
  }

  async function onChange(e) {
    const t = e.target;
    if (t.dataset.rule) { t.checked ? st.sel.add(t.dataset.rule) : st.sel.delete(t.dataset.rule); return renderClean(); }
    if (t.id === 'hl-empty') { st.showEmpty = t.checked; return renderClean(); }
    if (t.id === 'hl-auto') { await saveSettings({ autoClean: { enabled: t.checked } }); toast(t.checked ? 'Limpieza automática activada' : 'Limpieza automática desactivada', 'ok'); return; }
    if (t.id === 'hl-nice-on') { await saveSettings({ autoNice: { enabled: t.checked } }); return; }
    if (t.dataset.niceRule) {
      const rules = st.overview.settings.autoNice.rules.map((r) => r.id === t.dataset.niceRule ? { ...r, enabled: t.checked } : r);
      await saveSettings({ autoNice: { rules } });
    }
  }

  async function onSubmit(e) {
    if (e.target.id !== 'hl-nice-add') return;
    e.preventDefault();
    const needle = new FormData(e.target).get('needle').trim();
    const rules = [...st.overview.settings.autoNice.rules, { id: 'c' + Date.now().toString(36), label: `Comandos con “${needle}”`, needles: [needle], nice: 10, enabled: true, custom: true }];
    if (await saveSettings({ autoNice: { rules } })) { toast('Regla agregada', 'ok'); loadPerf(true); }
  }

  // ---------- Arranque ----------

  function init() {
    let tries = 0;
    const wait = setInterval(() => {
      if (mount()) {
        clearInterval(wait);
        const base = typeof loaders === 'object' ? loaders.ops : null;
        if (typeof loaders === 'object') loaders.ops = () => { base?.(); refresh(); };
        document.addEventListener('axon:section', (ev) => { if (ev.detail === 'ops') refresh(); else clearInterval(st.timer); });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
        api('/api/health/overview').then((o) => { st.overview = o; }).catch(() => {});
        if (document.querySelector('.tab-btn[data-tab="ops"]')?.classList.contains('active')) refresh();
      } else if (++tries > 100) clearInterval(wait);
    }, 100);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
