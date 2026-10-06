/* Multi-account controls. Tokens stay on the host; only labels/status reach UI. */
(() => {
  'use strict';
  let generation = 0, timer;
  window.AxonAgentAccounts = {
    async mount(host, agent) {
      clearTimeout(timer);
      const gen = ++generation;
      let data, signature = '', editing = false;
      const alive = () => host.isConnected && gen === generation;
      host.innerHTML = '<p class="listener-note" role="status">Cargando cuentas…</p>';
      async function load(force = false) {
        try {
          const next = await api(`/api/agent-accounts/${agent}`);
          if (!alive()) return;
          data = next;
          const sig = JSON.stringify(data);
          if (!editing && (force || sig !== signature)) { signature = sig; render(); }
        } catch (err) {
          if (!alive()) return;
          if (!data) { host.innerHTML = `<p class="agd-note" role="alert">${esc(err.message)}</p><button class="btn-secondary" data-account-retry>Reintentar</button>`; host.querySelector('button').onclick = () => load(true); }
        }
        clearTimeout(timer);
        if (alive()) timer = setTimeout(() => { if (document.hidden) { loadLater(); return; } void load(); }, 4000);
      }
      function loadLater() { timer = setTimeout(() => void load(), 4000); }
      async function mutate(action, body, button) {
        try {
          if (action === 'enable-server') await api(`/api/agent-accounts/${agent}/install`, { method: 'POST', body: {} });
          const result = await api(`/api/agent-accounts/${agent}${action ? '/' + action : ''}`, { method: 'POST', body, busy: button });
          if (result.job) openJobModal(result.job);
          else if (result.terminalCommand) openTermCmd(result.terminalCommand, { label: result.label });
          else {
            data = result; signature = JSON.stringify(data); editing = false;
            if (alive()) render();
            if (action === 'activate' || action === 'enable-server') { toast(`Cuenta seleccionada${data.scope === 'server' ? ' para el servidor' : ' para la terminal'}: ${data.profiles.find(p => p.active)?.label}`, 'ok'); document.dispatchEvent(new Event('axon:accounts-changed')); }
            if (!action) toast('Cuenta creada. Conectala para poder usarla.', 'ok');
          }
          if (action === 'login') void load(true);
        } catch (err) { errToast(err); }
      }
      function render() {
        const server = agent === 'codex' && data.scope === 'server';
        const desktop = data.desktop?.selectedId === data.active ? data.desktop : null;
        const desktopStatus = desktop?.state === 'ready' && desktop.verified
          ? `App por SSH: ${esc(desktop.email || '')} · Identidad verificada`
          : desktop?.state === 'offline' ? 'App por SSH desconectada. La próxima conexión usará la cuenta seleccionada.'
          : desktop?.state === 'error' ? 'No se pudo verificar el cambio en la app por SSH. La cuenta de la terminal sigue disponible; reintentá aplicar la cuenta al servidor.'
          : `Cambio pendiente en la app por SSH${desktop?.email ? ` · Todavía usa ${esc(desktop.email)}` : ''}. Se renovará la conexión cuando terminen las tareas en curso.`;
        host.innerHTML = `
          <div class="ag-accounts-heading"><strong>Cuentas guardadas</strong><div class="ag-usage-heading"><button class="btn-action" data-usage-refresh>${icon('refresh-cw')} Actualizar cuotas</button><button class="btn-action" data-account-add>${icon('plus')} Agregar cuenta</button></div></div>
          <p class="listener-note">${server ? 'La cuenta seleccionada se usa en el servidor, en la terminal y en la app conectada por SSH. Los pedidos ya enviados conservan su consumo original.' : `La predeterminada se usa al abrir ${agent === 'codex' ? 'Codex' : 'Claude'} en la terminal. Las sesiones abiertas conservan su cuenta.`}</p>
          ${agent === 'codex' ? `<div class="ag-desktop-account" role="status"><p>${server ? desktopStatus : 'Este selector todavía sólo controla la terminal. La app de escritorio por SSH puede seguir usando otra cuenta.'}</p>${!server || desktop?.state === 'error' ? '<button class="btn-secondary" data-account-server>Aplicar cuenta al servidor y app por SSH</button>' : ''}</div>` : ''}
          <div class="ag-account-list">${data.profiles.map(p => `
            <div class="ag-account-row ${p.active ? 'ag-account-active' : ''}" data-account-id="${esc(p.id)}">
              <div class="ag-account-identity"><span class="health-dot ${p.connected ? 'health-ok' : 'health-bad'}"></span><div><strong>${esc(p.label)}</strong>${p.active ? '<span class="badge badge-other">Predeterminada</span>' : ''}<small>${esc(p.email || p.method || (p.loginBusy ? 'Login en curso…' : 'Sin conectar'))}</small></div></div>
              <div class="ag-account-actions"><button class="icon-btn" data-account-rename title="Cambiar nombre" aria-label="Cambiar nombre de ${esc(p.label)}">${icon('pencil')}</button>
                ${p.connected ? `<button class="btn-action" data-account-open>${icon('terminal')} Abrir</button><button class="icon-btn" data-account-login ${p.loginBusy ? 'disabled' : ''} aria-label="Volver a conectar ${esc(p.label)}" title="Volver a conectar">${icon(p.loginBusy ? 'loader' : 'log-in')}</button>` : `<button class="btn-action" data-account-login ${p.loginBusy ? 'disabled' : ''}>${icon(p.loginBusy ? 'loader' : 'log-in')} ${p.loginBusy ? 'Conectando…' : 'Conectar'}</button>`}
                ${!p.active && p.connected ? '<button class="btn-primary" data-account-activate>Usar esta cuenta</button>' : ''}
              </div>
              <div class="ag-account-usage" data-account-usage="${esc(p.id)}"></div>
            </div>`).join('')}</div>
          <form class="ag-account-form hidden"><label for="ag-account-label">Nombre de la cuenta</label><input id="ag-account-label" class="filter-input" name="label" maxlength="48" placeholder="Personal o Empresa" required><div><button class="btn-primary" type="submit">Agregar cuenta</button><button class="btn-secondary" type="button" data-account-cancel>Cancelar</button></div></form>
          ${!data.launcherInstalled ? `<button class="btn-secondary" data-account-install>${icon('terminal')} Habilitar selector en SSH</button>` : `<details class="ag-account-help"><summary>Usar en la terminal SSH</summary><p>En terminales nuevas, ejecutá <code>${agent}</code>. Para habilitarlo en una terminal que ya tenés abierta, ejecutá esta línea una vez:</p><code class="ag-shell-command">. "$HOME/.config/axon/agent-accounts-shell.sh"</code><button class="btn-action" data-account-shell-copy>${icon('copy')} Copiar comando</button><p>Las credenciales y los chats nuevos son independientes. La configuración, instrucciones y skills se comparten con el entorno actual. “Conectada” indica que hay un login guardado; si el servicio lo revoca, deberás volver a conectarla.</p></details>`}`;
        refreshIcons();
        const form = host.querySelector('form');
        host.querySelector('[data-account-add]').onclick = () => { editing = true; form.dataset.id = ''; form.querySelector('input').value = ''; form.querySelector('[type=submit]').textContent = 'Agregar cuenta'; form.classList.remove('hidden'); form.querySelector('input').focus(); };
        host.querySelector('[data-account-cancel]').onclick = () => { editing = false; form.classList.add('hidden'); };
        form.onsubmit = async e => {
          e.preventDefault();
          const label = form.querySelector('input').value.trim();
          await mutate(form.dataset.id ? 'rename' : '', form.dataset.id ? { id: form.dataset.id, label } : { label }, e.submitter);
        };
        host.querySelector('[data-account-install]')?.addEventListener('click', e => mutate('install', {}, e.currentTarget));
        host.querySelector('[data-account-server]')?.addEventListener('click', e => mutate('enable-server', {}, e.currentTarget));
        host.querySelector('[data-account-shell-copy]')?.addEventListener('click', () => AxonTerminalTools.copy('. "$HOME/.config/axon/agent-accounts-shell.sh"'));
        host.querySelectorAll('[data-account-id]').forEach(row => {
          const id = row.dataset.accountId, p = data.profiles.find(p => p.id === id);
          row.querySelector('[data-account-activate]')?.addEventListener('click', e => mutate('activate', { id }, e.currentTarget));
          row.querySelector('[data-account-login]')?.addEventListener('click', e => mutate('login', { id }, e.currentTarget));
          row.querySelector('[data-account-open]')?.addEventListener('click', async e => {
            const server = agent === 'codex' && data.scope === 'server';
            if (server && !p.active) { await mutate('activate', { id }, e.currentTarget); if(data.active !== id)return; }
            const command = `"$HOME/.local/bin/axon-agent" ${server ? 'run codex' : `run-profile ${agent} ${id}`}`;
            if (!data.launcherInstalled) { toast('Habilitá el selector en SSH primero', 'error'); return; }
            openTermCmd(command, { label: `${agent === 'codex' ? 'Codex' : 'Claude'} · ${p.label}` });
          });
          row.querySelector('[data-account-rename]').onclick = () => { editing = true; form.dataset.id = id; form.querySelector('input').value = p.label; form.querySelector('[type=submit]').textContent = 'Guardar nombre'; form.classList.remove('hidden'); form.querySelector('input').focus(); };
        });
        void window.AxonAgentUsage.mount(host, agent);
      }
      await load(true);
    },
  };
})();
