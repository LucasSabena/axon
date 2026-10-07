/* Local token history and current public API price equivalents. */
(() => {
  const names = { all: 'Todos los agentes', codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode / OpenChamber', gemini: 'Gemini CLI', devin: 'Devin' };
  const periods = { today: 'Hoy', '7': 'Últimos 7 días', '15': 'Últimos 15 días', '30': 'Últimos 30 días', all: 'Todo el historial' };
  const sorts = { total: 'Mayor consumo', usd: 'Mayor costo (USD)', model: 'Nombre A–Z', requests: 'Más registros' };
  const fmt = new Intl.NumberFormat('es-AR');
  const money = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const rate = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);
  const date = n => n ? new Date(n * 1000).toLocaleString('es-AR', { hour12: false }) : 'Sin datos';
  const account = id => id === 'unknown' ? 'Cuenta no registrada' : id.startsWith('profile:') ? `Perfil ${id.slice(8)}` : `Cuenta creadora · ${id}`;
  // {at, data} keyed by filter query — TTL keeps "Actualizar" honest and the
  // LRU cap bounds unbounded growth across filter combinations.
  const cached = new Map();
  const CACHE_TTL = 5 * 60_000, CACHE_MAX = 24;
  const cacheGet = key => {
    const hit = cached.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL) { cached.delete(key); return null; }
    return hit.data;
  };
  const cacheSet = (key, data) => {
    cached.delete(key);
    cached.set(key, { at: Date.now(), data });
    while (cached.size > CACHE_MAX) cached.delete(cached.keys().next().value);
  };
  const providerColors = { openai: '#10a37f', anthropic: '#d97757', google: '#4285f4', 'github-copilot': '#8957e5', deepseek: '#4d6bfe', moonshotai: '#8e6bf1', zai: '#f2994a', xai: '#9aa4b2', 'ollama-cloud': '#f2c94c', 'opencode-go': '#4cb782', minimax: '#e0427f', 'minimax-cn': '#e0427f' };
  function providerColor(p) {
    if (providerColors[p]) return providerColors[p];
    let h = 0; for (const c of String(p || 'unknown')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 62% 58%)`;
  }
  const categories = [['input', 'Input', 'var(--accent)'], ['output', 'Output', 'var(--info)'], ['cacheRead', 'Caché leída', 'var(--ok)'], ['cacheWrite', 'Caché escrita', 'var(--warn)']];
  let tips = [];
  const tipIndex = t => tips.push(t) - 1;
  const pct = (part, total) => (part / Math.max(1, total) * 100).toFixed(1).replace('.', ',') + '%';
  function amount(s) { return s.pricedRequests ? money(s.usd) : s.requests ? 'Sin precio' : '—'; }
  function options(items, selected, title, label = x => x) {
    return `<option value="">${esc(title)}</option>${items.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(label(v))}</option>`).join('')}`;
  }
  function providerParts(data) {
    const by = new Map();
    for (const g of data.groups) {
      const v = by.get(g.provider) || { total: 0, usd: 0, requests: 0, pricedRequests: 0 };
      v.total += g.total; v.usd += g.usd; v.requests += g.requests; v.pricedRequests += g.pricedRequests;
      by.set(g.provider, v);
    }
    return [...by.entries()].sort((a, b) => b[1].total - a[1].total);
  }
  function dayTip(d, metric) {
    const rows = [];
    for (const [p, v] of Object.entries(d.providers || {}).sort((a, b) => b[1].total - a[1].total))
      rows.push({ color: providerColor(p), label: p, value: metric === 'usd' ? (v.pricedRequests ? money(v.usd) : 'Sin precio') : fmt.format(v.total) });
    rows.push({ strong: true, label: 'Total', value: metric === 'usd' ? amount(d) : fmt.format(d.total) });
    return { title: d.day, rows };
  }
  function chartHtml(data, metric, provider) {
    const days = data.daily, N = Math.max(1, days.length);
    const value = (d, v) => metric === 'usd' ? (v || d).usd : (v || d).total;
    const max = Math.max(1, ...days.map(d => value(d)));
    const totals = new Map();
    for (const d of days) for (const [p, v] of Object.entries(d.providers || {})) totals.set(p, (totals.get(p) || 0) + v.total);
    const order = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a));
    const unit = metric === 'usd' ? 'USD estimados' : 'Tokens';
    const bars = days.map((d, i) => {
      let y = 100; const segs = [];
      const provs = d.providers && Object.keys(d.providers).length ? order.filter(p => d.providers[p]) : [null];
      for (const p of provs) {
        const h = Math.max(0, value(d, p && d.providers[p]) / max * 95);
        y -= h;
        if (h > 0) segs.push(`<rect x="${i * 100 / N}" y="${y}" width="${82 / N}" height="${h}" fill="${p ? providerColor(p) : 'var(--accent)'}"/>`);
      }
      return `<g data-tip="${tipIndex(dayTip(d, metric))}">${segs.join('')}</g>`;
    }).join('');
    const parts = providerParts(data);
    // La leyenda es también el control de filtro: si se construye sólo con la
    // data filtrada desaparece el chip activo y no hay forma de quitar el
    // filtro desde acá. Completar con facets.provider (lista completa).
    const partMap = new Map(parts);
    const allProviders = [...new Set([...parts.map(([p]) => p), ...(data.facets?.provider || [])])];
    const legend = allProviders.length > 1 ? `<div class="agc-legend">${allProviders.map((p) => { const v = partMap.get(p); return `<button type="button" class="agc-legend-chip${provider === p ? ' active' : ''}" data-provider="${esc(p)}"><i style="background:${providerColor(p)}"></i>${esc(p)}<b>${v ? pct(v.total, data.summary.total) : '—'}</b></button>`; }).join('')}</div>` : '';
    return `<figure class="ag-consumption-chart"><figcaption><span>${unit} por día · ${esc(data.timezone)}</span><span>Máx. ${metric === 'usd' ? money(max) : fmt.format(max)}</span></figcaption><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${unit} en cada día con registros. El detalle accesible está en la tabla diaria.">${bars}</svg><div class="agc-x"><span>${esc(days[0]?.day || '')}</span><span>${esc(days.at(-1)?.day || '')}</span></div>${legend}</figure>`;
  }
  function distributionHtml(data) {
    const parts = providerParts(data);
    if (parts.length < 2) return '';
    return `<div class="agc-dist"><div class="agc-dist-bar" role="img" aria-label="Distribución del consumo por proveedor">${parts.map(([p, v]) => `<i data-tip="${tipIndex({ title: p, rows: [
      { strong: true, label: 'Tokens', value: fmt.format(v.total) },
      { label: 'Equivalente API', value: v.pricedRequests ? money(v.usd) : 'Sin precio' },
      { label: 'Registros', value: fmt.format(v.requests) },
      { label: 'Del total', value: pct(v.total, data.summary.total) },
    ] })}" style="width:${v.total / Math.max(1, data.summary.total) * 100}%;background:${providerColor(p)}"></i>`).join('')}</div></div>`;
  }
  function groupBar(g) {
    const segs = categories.filter(([k]) => g[k] > 0).map(([k, label, color]) => {
      const t = { title: `${g.model} · ${label}`, rows: [
        { strong: true, label: 'Tokens', value: fmt.format(g[k]) },
        { label: 'Del modelo', value: pct(g[k], g.total) },
      ] };
      if (g.components && g.components[k]) t.rows.push({ label: 'Costo estimado', value: money(g.components[k]) });
      return `<i data-tip="${tipIndex(t)}" style="width:${g[k] / Math.max(1, g.total) * 100}%;background:${color}"></i>`;
    }).join('');
    return `<div class="agc-cat-bar" role="img" aria-label="Composición de tokens de ${esc(g.model)}">${segs}</div>`;
  }
  function filteredGroups(data, view, accountName) {
    const q = view.q.trim().toLowerCase();
    let list = data.groups.filter(g => !q || [g.model, g.provider, names[g.agent] || g.agent, accountName(g.account)].join(' ').toLowerCase().includes(q));
    const cmp = { total: (a, b) => b.total - a.total, usd: (a, b) => b.usd - a.usd, model: (a, b) => a.model.localeCompare(b.model, 'es'), requests: (a, b) => b.requests - a.requests }[view.sort];
    return [...list].sort(cmp || ((a, b) => b.total - a.total));
  }
  function groupsHtml(data, view) {
    const accountName = id => data.accountLabels?.[id] || account(id);
    const list = filteredGroups(data, view, accountName);
    if (!list.length) return '<p class="listener-note">Ningún modelo coincide con la búsqueda o los filtros.</p>';
    return list.map(g => `<article class="ag-consumption-model"><div class="ag-consumption-model-title"><div><strong><i class="agc-prov-dot" style="background:${providerColor(g.provider)}"></i>${esc(g.model)}</strong><small>${esc(names[g.agent] || g.agent)} · ${esc(g.provider)} · ${pct(g.total, data.summary.total)} del período</small></div><div><strong>${amount(g)}</strong><small>${g.unpricedRequests || g.partialRequests ? 'Precio incompleto' : 'Equivalente API'}</small></div></div>
      ${groupBar(g)}
      <dl class="ag-consumption-tokens">${[['Input', g.input], ['Output', g.output], ['Caché leída', g.cacheRead], ['Caché escrita', g.cacheWrite], ['Razonamiento¹', g.reasoning], ['Total', g.total]].map(([k, v]) => `<div><dt>${k}</dt><dd>${fmt.format(v)}</dd></div>`).join('')}</dl>
      <small class="listener-note">${esc(accountName(g.account))}${g.accountBasis === 'creator' ? ' · puede haber cambiado durante el chat' : ''} · ${fmt.format(g.requests)} registros</small>
      <details class="ag-consumption-price"><summary>Tarifas y costo por categoría</summary>${g.rates ? `<p class="listener-note">Referencia: ${esc(g.priceModel)} · USD por millón de tokens. ${g.priceBasis === 'api-equivalent' ? 'Comparación con la API pública del modelo.' : 'Tarifa publicada para este proveedor.'} Si hay escritura de 1 hora en Anthropic se aplica 2× input.</p><dl class="ag-consumption-tokens">${[['Input', 'input'], ['Output', 'output'], ['Caché leída', 'cacheRead'], ['Caché escrita', 'cacheWrite']].map(([label, k]) => `<div><dt>${label} · ${g.rates[k] == null ? 'Sin tarifa' : rate(g.rates[k]) + '/M'}</dt><dd>${g.rates[k] == null ? 'Sin estimar' : money(g.components[k] || 0)}</dd></div>`).join('')}</dl>` : '<p class="listener-note">El catálogo no tiene una coincidencia segura para este proveedor y modelo. No se usa el precio de otro modelo.</p>'}</details></article>`).join('');
  }
  function content(data, view = { sort: 'total', q: '', metric: 'tokens', provider: '' }) {
    tips = [];
    const s = data.summary, c = data.coverage;
    const stats = [['Tokens registrados', fmt.format(s.total)], ['Equivalente API · USD', amount(s)], ['Input sin caché', fmt.format(s.input)], ['Output incl. razonamiento', fmt.format(s.output)], ['Caché leída', fmt.format(s.cacheRead)], ['Caché escrita', fmt.format(s.cacheWrite)]];
    const days = data.daily;
    return `<p class="listener-note">Historial registrado en este servidor. El equivalente usa tarifas API estándar actuales; no es una factura ni el precio de tu suscripción. Excluye herramientas, almacenamiento, impuestos y recargos de servicio.</p>
      ${c.indexing ? '<p class="ag-consumption-notice" role="status">Indexando el historial… Los totales son parciales y se actualizarán automáticamente.</p>' : ''}
      ${c.warnings.length ? `<p class="ag-consumption-notice" role="status">${c.warnings.map(esc).join(' ')}</p>` : ''}
      ${data.prices.stale ? '<p class="ag-consumption-notice" role="status">El catálogo no pudo actualizarse o tiene más de 24 horas. Se conserva su última versión disponible.</p>' : ''}
      <dl class="ag-consumption-stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <p class="listener-note">${fmt.format(s.requests)} registros de uso · ${fmt.format(s.sessions)} chats · ${fmt.format(s.reasoning)} tokens de razonamiento incluidos en output. Caché de escritura de 1 hora: ${fmt.format(s.cacheWrite1h)} tokens.</p>
      ${s.unpricedRequests || s.partialRequests ? `<p class="ag-consumption-notice">Estimación parcial: ${fmt.format(s.unpricedRequests)} registros sin precio y ${fmt.format(s.partialRequests)} con categorías sin tarifa. Sus tokens sí están incluidos en el total.</p>` : ''}
      ${!s.requests ? `<div class="ag-consumption-empty"><strong>Sin consumo registrado para estos filtros</strong><p>${c.unsupported.length ? c.unsupported.map(esc).join(' ') : 'Probá otro período o quitá los filtros. La ausencia de registros locales no demuestra que la cuenta no haya consumido tokens.'}</p></div>` : `
      ${distributionHtml(data)}
      <div class="agc-chart-head"><div class="agc-metric" role="group" aria-label="Métrica del gráfico"><button type="button"${view.metric !== 'usd' ? ' class="active"' : ''} data-metric="tokens">Tokens</button><button type="button"${view.metric === 'usd' ? ' class="active"' : ''} data-metric="usd">USD</button></div></div>
      <div data-consumption-chart>${chartHtml(data, view.metric, view.provider)}</div>
      <div class="agc-groups-toolbar"><h4>Consumo por modelo y proveedor <span class="agc-count" data-groups-count></span></h4><input type="search" class="filter-input" data-groups-q placeholder="Buscar modelo, proveedor…" value="${esc(view.q)}" aria-label="Buscar en los resultados" autocomplete="off"><select class="filter-input" data-groups-sort aria-label="Ordenar resultados">${Object.entries(sorts).map(([k, v]) => `<option value="${k}"${k === view.sort ? ' selected' : ''}>${v}</option>`).join('')}</select><button type="button" class="btn-secondary" data-groups-csv>Exportar CSV</button></div>
      <div data-consumption-groups>${groupsHtml(data, view)}</div>
      <details class="ag-consumption-daily"><summary>Detalle diario (${days.length} días con registros)</summary><table><caption>Tokens y equivalente API por día</caption><thead><tr><th>Día</th><th>Tokens</th><th>USD estimados</th></tr></thead><tbody>${days.map(d => `<tr><th scope="row">${esc(d.day)}</th><td>${fmt.format(d.total)}</td><td>${amount(d)}${d.unpricedRequests || d.partialRequests ? ' · parcial' : ''}</td></tr>`).join('')}</tbody></table></details>`}
      <p class="listener-note">¹ Razonamiento ya incluido en output; no se suma dos veces. ${esc(c.accountAttribution)}</p>
      <p class="ag-consumption-source">Cobertura: ${date(c.firstAt)} → ${date(c.lastAt)}. <a href="https://models.dev" target="_blank" rel="noopener noreferrer">models.dev</a> · precios consultados ${date(data.prices.fetchedAt)} · actualización automática cada ${data.prices.automaticHours} h. Historial actualizado ${date(data.generatedAt)}.</p>`;
  }
  let tooltip, tooltipOwner;
  const hideTooltip = () => { if (tooltip) tooltip.hidden = true; tooltipOwner = null; };
  function sharedTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div'); tooltip.className = 'agc-tip'; tooltip.hidden = true;
    document.body.append(tooltip);
    window.addEventListener('scroll', hideTooltip, true);
    document.addEventListener('axon:route', hideTooltip);
    document.addEventListener('visibilitychange', hideTooltip);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTooltip(); });
    window.addEventListener('blur', hideTooltip);
    window.addEventListener('resize', hideTooltip);
    return tooltip;
  }
  globalThis.AxonAgentConsumption = {
    content,
    async mount(host, initialAgent) {
      if (!host) return;
      host.dataset.panelAgent = initialAgent;
      const selected = initialAgent === 'openchamber' ? 'opencode' : initialAgent;
      const state = { agent: selected, period: '7', provider: '', model: '', account: '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
      const view = { sort: 'total', q: '', metric: 'tokens' };
      let generation = 0, data = null, timer;
      const alive = () => host.isConnected;
      host.innerHTML = `<div class="ag-consumption-heading"><h4>Consumo de tokens</h4><div><button class="btn-secondary" data-consumption-clear>Limpiar filtros</button><button class="btn-secondary" data-consumption-refresh>Actualizar consumo</button><button class="btn-secondary" data-consumption-prices>Actualizar precios</button></div></div>
        <div class="ag-consumption-filters"><label>Período<select class="filter-input" data-consumption-filter="period">${Object.entries(periods).map(([k, v]) => `<option value="${k}"${k === '7' ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Agente<select class="filter-input" data-consumption-filter="agent">${Object.entries(names).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Proveedor<select class="filter-input" data-consumption-filter="provider"><option value="">Todos los proveedores</option></select></label>
        <label>Modelo<select class="filter-input" data-consumption-filter="model"><option value="">Todos los modelos</option></select></label>
        <label>Cuenta del historial<select class="filter-input" data-consumption-filter="account"><option value="">Todas / sin identificar</option></select></label></div>
        <p data-consumption-feedback class="listener-note" role="status" aria-live="polite"></p><div data-consumption-results></div>`;
      const results = host.querySelector('[data-consumption-results]'), feedback = host.querySelector('[data-consumption-feedback]');
      const tip = sharedTooltip(); hideTooltip();
      function moveTip(x, y) {
        tooltipOwner = host;
        tip.hidden = false;
        const r = tip.getBoundingClientRect();
        const gap = 10, edge = 8;
        const width = document.documentElement.clientWidth, height = innerHeight;
        const left = x + gap + r.width <= width - edge ? x + gap : x - r.width - gap;
        const top = y + gap + r.height <= height - edge ? y + gap : y - r.height - gap;
        tip.style.left = Math.max(edge, Math.min(left, width - r.width - edge)) + 'px';
        tip.style.top = Math.max(edge, Math.min(top, height - r.height - edge)) + 'px';
      }
      results.addEventListener('pointerover', e => {
        const el = e.target.closest('[data-tip]'); if (!el) return;
        const t = tips[+el.dataset.tip]; if (!t) return;
        tip.replaceChildren();
        const h = document.createElement('b'); h.textContent = t.title; tip.append(h);
        for (const r of t.rows) {
          const row = document.createElement('div'); row.className = 'agc-tip-row' + (r.strong ? ' strong' : '');
          if (r.color) { const i = document.createElement('i'); i.style.background = r.color; row.append(i); }
          const s = document.createElement('span'); s.textContent = r.label;
          const v = document.createElement('b'); v.textContent = r.value;
          row.append(s, v); tip.append(row);
        }
        moveTip(e.clientX, e.clientY);
      });
      results.addEventListener('pointermove', e => { if (tooltipOwner === host && !tip.hidden) moveTip(e.clientX, e.clientY); });
      results.addEventListener('pointerout', e => {
        if (tooltipOwner === host && e.target.closest('[data-tip]') && e.relatedTarget?.closest('[data-tip]') !== e.target.closest('[data-tip]')) hideTooltip();
      });
      results.addEventListener('pointerdown', hideTooltip);
      function accountName(id) { return data.accountLabels?.[id] || account(id); }
      function updateGroups() {
        const box = results.querySelector('[data-consumption-groups]');
        if (box) box.innerHTML = groupsHtml(data, view);
        const count = results.querySelector('[data-groups-count]');
        if (count) { const n = filteredGroups(data, view, accountName).length; count.textContent = n === data.groups.length ? `(${fmt.format(n)})` : `(${fmt.format(n)} de ${fmt.format(data.groups.length)})`; }
      }
      function updateChart() {
        const box = results.querySelector('[data-consumption-chart]');
        if (box) box.innerHTML = chartHtml(data, view.metric, state.provider);
      }
      function exportCsv() {
        const rows = [['agente', 'proveedor', 'modelo', 'cuenta', 'tokens', 'input', 'output', 'cache_leida', 'cache_escrita', 'razonamiento', 'registros', 'usd_estimado']];
        for (const g of filteredGroups(data, view, accountName)) rows.push([g.agent, g.provider, g.model, accountName(g.account), g.total, g.input, g.output, g.cacheRead, g.cacheWrite, g.reasoning, g.requests, g.pricedRequests ? g.usd.toFixed(4) : '']);
        const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'consumo-agentes.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      function render() {
        if (tooltipOwner === host) hideTooltip();
        const q = host.querySelector('[data-groups-q]'), refocus = q && document.activeElement === q;
        results.innerHTML = content(data, { ...view, provider: state.provider });
        if (refocus) { const el = host.querySelector('[data-groups-q]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
        updateGroups();
        for (const [k, title] of [['provider', 'Todos los proveedores'], ['model', 'Todos los modelos'], ['account', 'Todas / sin identificar']]) host.querySelector(`[data-consumption-filter="${k}"]`).innerHTML = options(data.facets[k], state[k], title, k === 'account' ? id => data.accountLabels?.[id] || account(id) : x => x);
        refreshIcons();
      }
      results.addEventListener('click', e => {
        const metric = e.target.closest('[data-metric]');
        if (metric) { view.metric = metric.dataset.metric; results.querySelectorAll('[data-metric]').forEach(b => b.classList.toggle('active', b === metric)); updateChart(); return; }
        if (e.target.closest('[data-groups-csv]')) { exportCsv(); return; }
        const chip = e.target.closest('[data-provider]');
        if (chip) {
          const sel = host.querySelector('[data-consumption-filter="provider"]');
          sel.value = state.provider === chip.dataset.provider ? '' : chip.dataset.provider;
          sel.dispatchEvent(new Event('change'));
        }
      });
      results.addEventListener('input', e => { if (e.target.matches('[data-groups-q]')) { view.q = e.target.value; updateGroups(); } });
      results.addEventListener('change', e => { if (e.target.matches('[data-groups-sort]')) { view.sort = e.target.value; updateGroups(); } });
      async function load(refreshPrices = false) {
        if (!alive()) return;
        clearTimeout(timer); const current = ++generation; const query = new URLSearchParams(Object.entries(state).filter(([, v]) => v)); const key = query.toString();
        const previous = cacheGet(key); data = previous || null;
        if (data) render(); else results.innerHTML = '<p class="listener-note" role="status">Leyendo el historial y los precios… La primera lectura puede tardar unos segundos.</p>';
        feedback.textContent = refreshPrices ? 'Consultando el catálogo de precios…' : 'Actualizando consumo…'; host.setAttribute('aria-busy', 'true');
        try {
          const next = await api(`/api/agent-consumption${refreshPrices ? '/prices/refresh' : ''}?${key}`, refreshPrices ? { method: 'POST', body: {}, fresh: true } : { fresh: true });
          if (!alive() || current !== generation) return;
          data = next; cacheSet(key, next); render(); feedback.textContent = '';
          if (data.coverage.indexing) timer = setTimeout(() => void load(), 3000);
        } catch (err) {
          if (!alive() || current !== generation) return;
          feedback.textContent = `${err.message}${data ? ' Se muestra la última lectura disponible para estos filtros.' : ' Usá Actualizar consumo para reintentar.'}`;
        } finally { if (alive() && current === generation) host.removeAttribute('aria-busy'); }
      }
      host.querySelectorAll('[data-consumption-filter]').forEach(el => el.onchange = () => {
        const field = el.dataset.consumptionFilter; state[field] = el.value;
        if (field === 'agent' || field === 'period') { for (const k of ['model', 'provider', 'account']) { state[k] = ''; host.querySelector(`[data-consumption-filter="${k}"]`).value = ''; } }
        void load();
      });
      host.querySelector('[data-consumption-clear]').onclick = () => {
        for (const k of ['provider', 'model', 'account']) state[k] = '';
        state.period = '7';
        for (const el of host.querySelectorAll('[data-consumption-filter]')) el.value = el.dataset.consumptionFilter === 'period' ? '7' : (el.dataset.consumptionFilter === 'agent' ? state.agent : '');
        void load();
      };
      host.querySelector('[data-consumption-refresh]').onclick = () => void load();
      host.querySelector('[data-consumption-prices]').onclick = () => void load(true);
      await load();
    },
  };
})();
