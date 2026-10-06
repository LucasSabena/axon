/* Local token history and current public API price equivalents. */
(() => {
  const names = { all: 'Todos los agentes', codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode / OpenChamber', gemini: 'Gemini CLI', devin: 'Devin' };
  const periods = { today: 'Hoy', '7': 'Últimos 7 días', '15': 'Últimos 15 días', '30': 'Últimos 30 días', all: 'Todo el historial' };
  const fmt = new Intl.NumberFormat('es-AR');
  const money = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const rate = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);
  const date = n => n ? new Date(n * 1000).toLocaleString('es-AR', { hour12: false }) : 'Sin datos';
  const account = id => id === 'unknown' ? 'Cuenta no registrada' : id.startsWith('profile:') ? `Perfil ${id.slice(8)}` : `Cuenta creadora · ${id}`;
  const cached = new Map();
  function amount(s) { return s.pricedRequests ? money(s.usd) : s.requests ? 'Sin precio' : '—'; }
  function options(items, selected, title, label = x => x) {
    return `<option value="">${esc(title)}</option>${items.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(label(v))}</option>`).join('')}`;
  }
  function content(data) {
    const s = data.summary, c = data.coverage;
    const accountName = id => data.accountLabels?.[id] || account(id);
    const stats = [['Tokens registrados', fmt.format(s.total)], ['Equivalente API · USD', amount(s)], ['Input sin caché', fmt.format(s.input)], ['Output incl. razonamiento', fmt.format(s.output)], ['Caché leída', fmt.format(s.cacheRead)], ['Caché escrita', fmt.format(s.cacheWrite)]];
    const days = data.daily, max = Math.max(1, ...days.map(d => d.total));
    const bars = days.map((d, i) => `<rect x="${i * 100 / Math.max(1, days.length)}" y="${100 - d.total / max * 95}" width="${80 / Math.max(1, days.length)}" height="${d.total / max * 95}" rx="0.4"><title>${esc(d.day)}: ${fmt.format(d.total)} tokens · ${amount(d)}</title></rect>`).join('');
    return `<p class="listener-note">Historial registrado en este servidor. El equivalente usa tarifas API estándar actuales; no es una factura ni el precio de tu suscripción. Excluye herramientas, almacenamiento, impuestos y recargos de servicio.</p>
      ${c.indexing ? '<p class="ag-consumption-notice" role="status">Indexando el historial… Los totales son parciales y se actualizarán automáticamente.</p>' : ''}
      ${c.warnings.length ? `<p class="ag-consumption-notice" role="status">${c.warnings.map(esc).join(' ')}</p>` : ''}
      ${data.prices.stale ? '<p class="ag-consumption-notice" role="status">El catálogo no pudo actualizarse o tiene más de 24 horas. Se conserva su última versión disponible.</p>' : ''}
      <dl class="ag-consumption-stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <p class="listener-note">${fmt.format(s.requests)} registros de uso · ${fmt.format(s.sessions)} chats · ${fmt.format(s.reasoning)} tokens de razonamiento incluidos en output. Caché de escritura de 1 hora: ${fmt.format(s.cacheWrite1h)} tokens.</p>
      ${s.unpricedRequests || s.partialRequests ? `<p class="ag-consumption-notice">Estimación parcial: ${fmt.format(s.unpricedRequests)} registros sin precio y ${fmt.format(s.partialRequests)} con categorías sin tarifa. Sus tokens sí están incluidos en el total.</p>` : ''}
      ${!s.requests ? `<div class="ag-consumption-empty"><strong>Sin consumo registrado para estos filtros</strong><p>${c.unsupported.length ? c.unsupported.map(esc).join(' ') : 'Probá otro período o quitá los filtros. La ausencia de registros locales no demuestra que la cuenta no haya consumido tokens.'}</p></div>` : `
      <figure class="ag-consumption-chart"><figcaption>Tokens en días con registros · ${esc(data.timezone)}</figcaption><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Consumo en cada día con registros. El detalle accesible está en la tabla diaria.">${bars}</svg><div><span>${esc(days[0]?.day || '')}</span><span>${esc(days.at(-1)?.day || '')}</span></div></figure>
      <h4>Consumo por modelo y proveedor</h4><div class="ag-consumption-models">${data.groups.map(g => `<article class="ag-consumption-model"><div class="ag-consumption-model-title"><div><strong>${esc(g.model)}</strong><small>${esc(names[g.agent] || g.agent)} · ${esc(g.provider)}</small></div><div><strong>${amount(g)}</strong><small>${g.unpricedRequests || g.partialRequests ? 'Precio incompleto' : 'Equivalente API'}</small></div></div>
      <dl class="ag-consumption-tokens">${[['Input', g.input], ['Output', g.output], ['Caché leída', g.cacheRead], ['Caché escrita', g.cacheWrite], ['Razonamiento¹', g.reasoning], ['Total', g.total]].map(([k, v]) => `<div><dt>${k}</dt><dd>${fmt.format(v)}</dd></div>`).join('')}</dl>
      <small class="listener-note">${esc(accountName(g.account))}${g.accountBasis === 'creator' ? ' · puede haber cambiado durante el chat' : ''} · ${fmt.format(g.requests)} registros</small>
      <details class="ag-consumption-price"><summary>Tarifas y costo por categoría</summary>${g.rates ? `<p class="listener-note">Referencia: ${esc(g.priceModel)} · USD por millón de tokens. ${g.priceBasis === 'api-equivalent' ? 'Comparación con la API pública del modelo.' : 'Tarifa publicada para este proveedor.'} Si hay escritura de 1 hora en Anthropic se aplica 2× input.</p><dl class="ag-consumption-tokens">${[['Input', 'input'], ['Output', 'output'], ['Caché leída', 'cacheRead'], ['Caché escrita', 'cacheWrite']].map(([label, k]) => `<div><dt>${label} · ${g.rates[k] == null ? 'Sin tarifa' : rate(g.rates[k]) + '/M'}</dt><dd>${g.rates[k] == null ? 'Sin estimar' : money(g.components[k] || 0)}</dd></div>`).join('')}</dl>` : '<p class="listener-note">El catálogo no tiene una coincidencia segura para este proveedor y modelo. No se usa el precio de otro modelo.</p>'}</details></article>`).join('')}</div>
      <details class="ag-consumption-daily"><summary>Detalle diario (${days.length} días con registros)</summary><table><caption>Tokens y equivalente API por día</caption><thead><tr><th>Día</th><th>Tokens</th><th>USD estimados</th></tr></thead><tbody>${days.map(d => `<tr><th scope="row">${esc(d.day)}</th><td>${fmt.format(d.total)}</td><td>${amount(d)}${d.unpricedRequests || d.partialRequests ? ' · parcial' : ''}</td></tr>`).join('')}</tbody></table></details>`}
      <p class="listener-note">¹ Razonamiento ya incluido en output; no se suma dos veces. ${esc(c.accountAttribution)}</p>
      <p class="ag-consumption-source">Cobertura: ${date(c.firstAt)} → ${date(c.lastAt)}. <a href="https://models.dev" target="_blank" rel="noopener noreferrer">models.dev</a> · precios consultados ${date(data.prices.fetchedAt)} · actualización automática cada ${data.prices.automaticHours} h. Historial actualizado ${date(data.generatedAt)}.</p>`;
  }
  globalThis.AxonAgentConsumption = {
    content,
    async mount(host, initialAgent) {
      if (!host) return;
      const selected = initialAgent === 'openchamber' ? 'opencode' : initialAgent;
      const state = { agent: selected, period: '7', provider: '', model: '', account: '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
      let generation = 0, data = null, timer;
      const alive = () => host.isConnected;
      host.innerHTML = `<div class="ag-consumption-heading"><h4>Consumo de tokens</h4><div><button class="btn-secondary" data-consumption-refresh>Actualizar consumo</button><button class="btn-secondary" data-consumption-prices>Actualizar precios</button></div></div>
        <div class="ag-consumption-filters"><label>Período<select class="filter-input" data-consumption-filter="period">${Object.entries(periods).map(([k, v]) => `<option value="${k}"${k === '7' ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Agente<select class="filter-input" data-consumption-filter="agent">${Object.entries(names).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Proveedor<select class="filter-input" data-consumption-filter="provider"><option value="">Todos los proveedores</option></select></label>
        <label>Modelo<select class="filter-input" data-consumption-filter="model"><option value="">Todos los modelos</option></select></label>
        <label>Cuenta del historial<select class="filter-input" data-consumption-filter="account"><option value="">Todas / sin identificar</option></select></label></div>
        <p data-consumption-feedback class="listener-note" role="status" aria-live="polite"></p><div data-consumption-results></div>`;
      const results = host.querySelector('[data-consumption-results]'), feedback = host.querySelector('[data-consumption-feedback]');
      function render() {
        results.innerHTML = content(data);
        for (const [k, title] of [['provider', 'Todos los proveedores'], ['model', 'Todos los modelos'], ['account', 'Todas / sin identificar']]) host.querySelector(`[data-consumption-filter="${k}"]`).innerHTML = options(data.facets[k], state[k], title, k === 'account' ? id => data.accountLabels?.[id] || account(id) : x => x);
        refreshIcons();
      }
      async function load(refreshPrices = false) {
        if (!alive()) return;
        clearTimeout(timer); const current = ++generation; const query = new URLSearchParams(Object.entries(state).filter(([, v]) => v)); const key = query.toString();
        const previous = cached.get(key); data = previous || null;
        if (data) render(); else results.innerHTML = '<p class="listener-note" role="status">Leyendo el historial y los precios… La primera lectura puede tardar unos segundos.</p>';
        feedback.textContent = refreshPrices ? 'Consultando el catálogo de precios…' : 'Actualizando consumo…'; host.setAttribute('aria-busy', 'true');
        try {
          const next = await api(`/api/agent-consumption${refreshPrices ? '/prices/refresh' : ''}?${key}`, refreshPrices ? { method: 'POST', body: {}, fresh: true } : { fresh: true });
          if (!alive() || current !== generation) return;
          data = next; cached.set(key, next); render(); feedback.textContent = '';
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
      host.querySelector('[data-consumption-refresh]').onclick = () => void load();
      host.querySelector('[data-consumption-prices]').onclick = () => void load(true);
      await load();
    },
  };
})();
