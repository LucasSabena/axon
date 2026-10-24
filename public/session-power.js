(() => {
  'use strict';
  const visible = node => !!node?.isConnected && node.getClientRects().length > 0;
  const DAY_NAMES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const MODE_LABELS = { performance: 'Rendimiento', balanced: 'Equilibrado', quiet: 'Silencioso', auto: 'Horarios' };
  function error(node, e) { const box = node.querySelector('[data-message]'); box.textContent = e.message || 'No se pudo completar la acción.'; box.setAttribute('role', 'alert'); }
  function mountPower(pane) {
    const node = document.createElement('div'); node.id = 'power-controller'; pane.append(node);
    node.innerHTML = `<div class="device-toolbar"><button type="button" class="btn-secondary" data-refresh>Actualizar</button><button type="button" class="btn-secondary" data-mode="performance" disabled>Rendimiento</button><button type="button" class="btn-secondary" data-mode="balanced" disabled>Equilibrado</button><button type="button" class="btn-secondary" data-mode="quiet" disabled>Silencioso</button><button type="button" class="btn-secondary" data-mode="auto" disabled>Horarios</button></div><p data-message role="status">Consultando energía…</p><div data-power-state></div><div data-schedule hidden><h5>Horarios del modo automático</h5><div data-schedule-list></div><div class="power-schedule-form" data-form><label>Desde<input type="time" data-start value="23:00" data-local></label><label>Hasta<input type="time" data-end value="08:00" data-local></label><label>Modo<select data-smode data-local><option value="quiet">Silencioso</option><option value="balanced">Equilibrado</option><option value="performance">Rendimiento</option></select></label><div class="power-days" role="group" aria-label="Días">${DAY_NAMES.map((d, i) => `<label><input type="checkbox" data-day="${i}" checked data-local> ${d}</label>`).join('')}</div><button type="button" class="btn-primary" data-add>Agregar horario</button></div><p class="settings-help">En modo Horarios el servidor aplica el modo del primer tramo que coincida; fuera de los tramos queda en Equilibrado. Los tramos pueden cruzar la medianoche.</p></div>`;
    let state, busy = false, pending = false, ticket = 0, timer;
    function readings() {
      const k = state.knobs || {};
      const watts = k.raplPl1Watts != null ? `${k.raplPl1Watts} / ${k.raplPl2Watts} W` : 'Sin control';
      const turbo = k.turbo == null ? 'Sin lectura' : k.turbo ? 'Activo' : 'Desactivado';
      const sources = { manual: 'elegido a mano', horario: 'por horario', predeterminado: 'predeterminado' };
      const next = state.nextChange ? `<p class="settings-help">Próximo cambio: ${esc(state.nextChange.modeName)} en ${state.nextChange.inMinutes >= 120 ? Math.round(state.nextChange.inMinutes / 60) + ' h' : state.nextChange.inMinutes + ' min'}.</p>` : '';
      return `<p class="fan-model"><strong>${esc(state.model || 'Este servidor')}</strong>${state.fixture ? ' · Simulación de QA' : ''}</p><p><strong>${esc(state.modeName || 'Sin confirmar')}</strong> · ${sources[state.source] || ''}${state.mode === 'auto' ? ' · modo Horarios' : ''}</p>${next}<div class="fan-readings power-readings"><div><span>Turbo Boost</span><strong>${turbo}</strong><small>${k.maxPerfPct == null ? '' : 'Frecuencia máx. ' + k.maxPerfPct + '%'}</small></div><div><span>Perfil de energía</span><strong>${esc(k.profile || k.epp || 'Sin lectura')}</strong><small>${esc(k.epp && k.profile ? k.epp : '')}</small></div><div><span>Límite de potencia CPU</span><strong>${watts}</strong><small>sostenido / pico</small></div><div><span>GPU</span><strong>${esc(k.gpuPowerState || 'D0')}${k.gpuClock ? ' · limitada' : ''}</strong><small>${k.gpuError ? esc(k.gpuError) : k.quietFans ? 'ventiladores bajos' : ''}</small></div></div>${state.mode === 'auto' && !state.schedule.length ? '<p class="settings-help">Sin horarios cargados: siempre Equilibrado. Agregá un tramo abajo.</p>' : ''}`;
    }
    function scheduleList() {
      node.querySelector('[data-schedule-list]').innerHTML = (state.schedule || []).map((e, i) => `<div class="power-schedule-row"><span><strong>${esc(e.start)} – ${esc(e.end)}</strong> · ${MODE_LABELS[e.mode] || esc(e.mode)} · ${e.days.length === 7 ? 'todos los días' : e.days.map(d => DAY_NAMES[d]).join(' ')}</span><button type="button" class="btn-danger" data-del="${i}">Quitar</button></div>`).join('') || '<p class="settings-help">Todavía no hay tramos.</p>';
      node.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (busy || !state?.available) return;
        const schedule = state.schedule.filter((_, i) => i !== Number(b.dataset.del));
        await post({ schedule });
      });
    }
    function render() {
      const enabled = !!state?.available;
      node.querySelectorAll('[data-mode]').forEach(b => { b.disabled = !enabled || busy; b.setAttribute('aria-pressed', String(enabled && state.mode === b.dataset.mode)); });
      node.querySelector('[data-schedule]').hidden = !enabled || state.mode !== 'auto';
      if (!enabled) { node.querySelector('[data-power-state]').innerHTML = `<p class="settings-help">${esc(state?.error || 'El control de energía todavía no está disponible en este servidor.')}</p>`; return; }
      node.querySelector('[data-power-state]').innerHTML = readings();
      if (state.mode === 'auto') scheduleList();
    }
    async function refresh() {
      clearTimeout(timer); if (busy || !visible(node)) return;
      const id = ++ticket;
      try { const r = await api('/api/power'); if (id !== ticket || !visible(node)) return; state = r; if (!pending) render(); const box = node.querySelector('[data-message]'); box.setAttribute('role', 'status'); box.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR'); }
      catch (e) { if (id === ticket) { state = null; render(); error(node, e); } }
      finally { if (id === ticket) timer = setTimeout(refresh, 5000); }
    }
    async function post(body) {
      if (!state?.available || busy) return;
      busy = true; ticket++; clearTimeout(timer);
      try { state = await api('/api/power', { method: 'POST', body: { ...body, revision: state.revision } }); pending = false; render(); node.querySelector('[data-message]').textContent = 'Cambio aplicado.'; }
      catch (e) { error(node, e); }
      finally { busy = false; node.querySelectorAll('[data-mode]').forEach(b => b.disabled = !state?.available); timer = setTimeout(refresh, 5000); }
    }
    node.querySelectorAll('[data-mode]').forEach(b => b.onclick = async e => {
      const mode = e.currentTarget.dataset.mode;
      if (state?.mode === mode || !await confirmDialog('Cambiar modo de energía', mode === 'quiet' ? 'Baja el rendimiento, limita el consumo y reduce los ventiladores hasta que cambies de modo.' : mode === 'auto' ? 'El servidor seguirá los horarios cargados.' : 'Vuelve a la potencia completa del hardware.', 'Aplicar')) return;
      await post({ mode });
    });
    node.querySelector('[data-refresh]').onclick = refresh;
    node.querySelector('[data-add]').onclick = async () => {
      if (!state?.available || busy) return;
      const start = node.querySelector('[data-start]').value, end = node.querySelector('[data-end]').value, mode = node.querySelector('[data-smode]').value;
      const days = [...node.querySelectorAll('[data-day]:checked')].map(d => Number(d.dataset.day));
      if (!start || !end || start === end || !days.length) { error(node, new Error('Completá desde, hasta y al menos un día.')); return; }
      await post({ schedule: [...(state.schedule || []), { start, end, mode, days }] });
    };
    node.querySelector('[data-form]').addEventListener('input', () => pending = true);
    document.addEventListener('axon:session-expired', () => { ticket++; clearTimeout(timer); state = null; pending = false; render(); });
    return { refresh, dirty: () => pending };
  }
  window.AxonPower = { mount: mountPower };
})();
