/* Quotas are provider observations. Countdown updates never invent a new allowance. */
(() => {
  'use strict';
  const cache = new Map();
  let generation = 0, timer;
  const planNames = { plus: 'Plus', pro: 'Pro', free: 'Free', max: 'Max', team: 'Team', business: 'Business', enterprise: 'Enterprise' };
  const format = n => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n);
  function until(reset, now = Date.now() / 1000) {
    if (!Number.isFinite(reset)) return 'Reinicio no informado';
    if (reset <= now) return 'Reinicio pendiente de confirmar';
    const minutes = Math.ceil((reset - now) / 60), days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
    const left = [days ? `${days} d` : '', hours ? `${hours} h` : '', !days && mins ? `${mins} min` : ''].filter(Boolean).join(' ') || 'menos de 1 min';
    const date = new Date(reset * 1000);
    return `Reinicia en ${left} · ${date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  function freshness(at) {
    if (!at) return 'Sin lectura de cuotas';
    const mins = Math.floor(Math.max(0, Date.now() / 1000 - at) / 60);
    return mins < 1 ? 'Actualizado recién' : `Actualizado hace ${mins} min`;
  }
  function message(account) {
    if (account.id === 'devin-local') return 'El login del CLI no permite leer este panel de cuotas. Conectá una consulta de Devin o revisá Usage & limits en su web.';
    return ({
      reconnect: 'El proveedor rechazó este login. Volvé a conectar esta cuenta en su agente.',
      permission: 'Esta credencial no tiene acceso a la consulta de cuotas. Revisá el plan y los permisos en el proveedor.',
      not_connected: 'Falta un login compatible para consultar las cuotas de esta cuenta.',
      identity_mismatch: 'La respuesta pertenece a otra cuenta. Sus cuotas no se muestran.',
      rate_limited: 'El proveedor pidió esperar. La consulta se reintentará después de su pausa.',
      loading: 'Hay una consulta en curso. Se actualizará al terminar.',
      unavailable: 'No se pudo actualizar. Se conserva la última lectura disponible.',
      unsupported: account.provider === 'opencode'
        ? 'Zen funciona con saldo y límites de gasto. Esta clave de modelos no expone su saldo; consultalo en OpenCode Console.'
        : 'Este proveedor no ofrece una lectura de cuotas con el login disponible en el servidor.',
    })[account.status] || '';
  }
  function contents(account) {
    const windows = account.windows || [];
    const stale = account.stale;
    const notices = message(account);
    const balances = (account.balances || []).map(b => `<span>${esc(b.label)}: <strong>${esc(format(b.remaining))} ${esc(b.unit)}</strong></span>`).join('');
    const plan = account.plan === 'max' && /max_(5|20)x/.test(account.rateLimitTier || '') ? `Max ${account.rateLimitTier.match(/max_(5|20)x/)[1]}×` : planNames[account.plan] || account.plan;
    return `<div class="ag-usage-meta"><span>${plan ? `Plan <strong>${esc(plan)}</strong>` : 'Plan no informado'}${account.authMethod ? ` · Login ${esc(account.authMethod)}` : ''}</span>${stale ? '<span class="ag-usage-stale">Lectura anterior</span>' : ''}</div>
      ${notices ? `<p class="ag-usage-notice" role="status">${esc(notices)}</p>` : ''}
      ${windows.length ? `<div class="ag-usage-windows">${windows.map(w => {
        const percent = Math.max(0, Math.min(100, w.remainingPercent));
        const level = percent <= 10 ? 'low' : percent <= 25 ? 'warn' : 'normal';
        return `<div class="ag-usage-window ${stale ? 'is-stale' : ''}"><div class="ag-usage-window-title"><span>${esc(w.label)}</span><strong>${esc(format(w.remainingPercent))}% <small>restante</small></strong></div><progress class="ag-usage-meter ag-usage-${level}" value="${percent}" max="100" aria-label="${esc(w.label)}: ${esc(format(w.remainingPercent))}% restante${stale ? ', lectura anterior' : ''}"></progress><div class="ag-usage-window-caption"><span>${esc(format(w.usedPercent))}% usado</span><span data-usage-reset="${w.resetsAt ?? ''}" title="${w.resetsAt ? esc(new Date(w.resetsAt * 1000).toISOString()) : ''}">${esc(until(w.resetsAt))}</span></div></div>`;
      }).join('')}</div>` : ''}
      ${balances || account.extraUsageEnabled !== undefined || account.availableResets != null || account.notes?.length ? `<div class="ag-usage-balances">${balances}${account.extraUsageEnabled !== undefined ? `<span>Uso extra ${account.extraUsageEnabled ? 'habilitado' : 'deshabilitado'}</span>` : ''}${account.availableResets != null ? `<span>Reinicios disponibles: <strong>${esc(format(account.availableResets))}</strong></span>` : ''}${(account.notes || []).map(n => `<span>${esc(n)}</span>`).join('')}</div>` : ''}
      <div class="ag-usage-source"><span data-usage-fetched="${account.fetchedAt || ''}">${esc(freshness(account.fetchedAt))}</span><span>${esc(account.source)} · ${esc(account.credentialSource)}</span>${account.dashboardUrl ? `<a href="${esc(account.dashboardUrl)}" target="_blank" rel="noopener noreferrer">Ver en el proveedor ${icon('external-link')}</a>` : ''}</div>`;
  }

  globalThis.AxonAgentUsage = {
    until, contents,
    async mount(host, agent) {
      if (!host) return;
      clearTimeout(timer);
      const gen = ++generation, inline = !!host.querySelector('[data-account-usage]');
      const alive = () => host.isConnected && gen === generation;
      let data = cache.get(agent), loading = false, editing = false;
      const zones = () => inline ? [...host.querySelectorAll('[data-account-usage]')] : [host];
      function render() {
        if (!alive()) return;
        if (inline) {
          for (const zone of zones()) {
            const row = data?.accounts.find(a => a.id === zone.dataset.accountUsage);
            zone.innerHTML = row ? contents(row) : '<p class="listener-note" role="status">Consultando cuotas de esta cuenta…</p>';
          }
        } else {
          host.innerHTML = `<div class="ag-usage-heading"><strong>Uso y límites</strong><div>${agent === 'devin' ? '<button class="btn-secondary" data-usage-connect>Conectar consulta</button>' : ''}<button class="btn-action" data-usage-refresh>${icon('refresh-cw')} Actualizar cuotas</button></div></div>
            <p class="listener-note">${['opencode', 'openchamber'].includes(agent) ? 'Las cuotas pertenecen a cada cuenta y proveedor. Dos agentes pueden consumir el mismo plan; sus cuotas no se suman.' : 'Consultá el uso de cada cuenta sin cambiar la sesión del agente.'} Las fechas se muestran en tu hora local.</p>
            <div data-usage-feedback role="status"></div>
            ${data ? data.accounts.length ? data.accounts.map(a => `<section class="ag-usage-account"><div class="ag-usage-account-heading"><div><strong>${esc(a.label)}</strong>${a.active === true ? '<span class="badge badge-other">Activa en OpenCode</span>' : ''}<small>${esc(a.email || a.accountId || a.credentialSource)}</small></div>${a.id.startsWith('u-') ? `<button class="btn-secondary" data-usage-disconnect="${esc(a.id)}">Desconectar consulta</button>` : ''}</div>${contents(a)}</section>`).join('') : '<p class="agd-empty">No hay cuentas guardadas para consultar. Conectá el agente primero.</p>' : '<p class="listener-note" role="status">Consultando cuentas y cuotas…</p>'}
            ${agent === 'devin' ? `<form class="ag-usage-connect-form hidden"><p class="listener-note">Usá el token de sesión de app.devin.ai y el ID interno de organización del panel Usage & limits. Esta conexión sólo consulta cuotas; no cambia tu login del CLI. El token se guarda en el servidor y no vuelve al navegador.</p><a href="https://github.com/steipete/CodexBar/blob/main/docs/devin.md#manual-auth" target="_blank" rel="noopener noreferrer">Cómo obtener los datos de consulta</a><label>Nombre de la cuenta<input class="filter-input" name="label" maxlength="48" placeholder="Devin · Empresa" required></label><label>ID de organización<input class="filter-input" name="organization" maxlength="120" placeholder="org-…" required></label><label>Token de consulta<input class="filter-input" name="accessToken" type="password" minlength="20" maxlength="16000" autocomplete="off" spellcheck="false" required></label><div><button class="btn-primary" type="submit">Guardar consulta</button><button class="btn-secondary" data-usage-cancel type="button">Cancelar</button></div></form>` : ''}`;
        }
        host.querySelectorAll('[data-usage-refresh]').forEach(b => { b.disabled = loading; b.onclick = () => load(true, b); });
        if (!inline) {
          const form = host.querySelector('form');
          host.querySelector('[data-usage-connect]')?.addEventListener('click', () => { editing = true; form.classList.remove('hidden'); form.elements.label.focus(); });
          host.querySelector('[data-usage-cancel]')?.addEventListener('click', () => { editing = false; form.reset(); form.classList.add('hidden'); });
          if (form) form.onsubmit = async e => {
            e.preventDefault();
            const input = Object.fromEntries(new FormData(form));
            try {
              const result = await api(`/api/agent-usage/devin/connect`, { method: 'POST', body: input, busy: e.submitter });
              form.reset(); editing = false; data = result; cache.set(agent, data); render(); toast('Consulta guardada. Revisá su estado de acceso.', 'ok');
            } catch (err) { errToast(err); }
          };
          host.querySelectorAll('[data-usage-disconnect]').forEach(b => { b.onclick = async () => {
            try { data = await api('/api/agent-usage/devin/disconnect', { method: 'POST', body: { id: b.dataset.usageDisconnect }, busy: b }); cache.set(agent, data); render(); }
            catch (err) { errToast(err); }
          }; });
        }
        refreshIcons();
      }
      async function load(force = false, button) {
        if (loading || !alive()) return;
        loading = true;
        try {
          const next = await api(`/api/agent-usage/${agent}${force ? '/refresh' : ''}`, force ? { method: 'POST', body: {}, busy: button } : {});
          if (!alive()) return;
          data = next; cache.set(agent, data);
          if (!editing) render();
        } catch (err) {
          if (!alive()) return;
          if (data) {
            data = { ...data, accounts: data.accounts.map(a => ({ ...a, status: 'unavailable', stale: !!a.fetchedAt })) };
            if (!editing) render();
          }
          if (inline) for (const zone of zones()) { if (!data) zone.innerHTML = `<p class="ag-usage-notice" role="status">${esc(err.message)} Usá Actualizar cuotas para reintentar.</p>`; }
          else { const feedback = host.querySelector('[data-usage-feedback]'); if (feedback) feedback.textContent = `${err.message}${data ? ' Se conserva la lectura anterior.' : ''}`; }
          if (force) errToast(err);
        } finally { loading = false; if (alive()) host.querySelectorAll('[data-usage-refresh]').forEach(b => b.disabled = false); }
      }
      function tick() {
        if (!alive()) return;
        host.querySelectorAll('[data-usage-reset]').forEach(el => { el.textContent = until(el.dataset.usageReset ? Number(el.dataset.usageReset) : null); });
        host.querySelectorAll('[data-usage-fetched]').forEach(el => { el.textContent = freshness(Number(el.dataset.usageFetched)); });
        if (!document.hidden && !editing) void load();
        timer = setTimeout(tick, 30_000);
      }
      render(); await load();
      if (alive()) timer = setTimeout(tick, 30_000);
    },
  };
})();
