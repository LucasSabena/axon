(() => {
  'use strict';
  const visible = node => !!node?.isConnected && node.getClientRects().length > 0;
  const date = n => n ? new Date(n).toLocaleString('es-AR') : 'Sin registro';
  function error(node, e) { const box = node.querySelector('[data-message]'); box.textContent = e.message || 'No se pudo completar la acción.'; box.setAttribute('role', 'alert'); }
  function device(ua) {
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Sistema desconocido';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador desconocido';
    return { label: browser + ' · ' + os, icon: /Android|iPhone|iPad/.test(ua) ? 'smartphone' : 'monitor' };
  }
  function mountSessions(pane) {
    const node = document.createElement('div'); node.id = 'session-manager'; pane.append(node);
    node.innerHTML = '<div class="device-toolbar"><button type="button" class="btn-secondary" data-refresh>Actualizar</button><button type="button" class="btn-danger" data-others disabled>Cerrar las otras sesiones</button><label class="session-history"><input type="checkbox" data-history data-local> Ver cerradas y vencidas</label></div><p data-message role="status">Cargando sesiones…</p><div data-sessions></div><p class="settings-help">Cada inicio de sesión corresponde a un navegador o perfil. La IP muestra desde dónde se conectó; puede cambiar al usar una VPN. Una actividad reciente no confirma que el dispositivo siga conectado. Las sesiones duran 7 días.</p>';
    let data = [], busy = false, ticket = 0, timer, editing = null;
    function render() {
      const history = node.querySelector('[data-history]').checked;
      node.querySelector('[data-others]').disabled = busy || !data.some(s => !s.current && !s.revoked && !s.expired);
      node.querySelector('[data-sessions]').innerHTML = data.filter(s => history || !s.revoked && !s.expired).map(s => {
        const d = device(s.ua), active = !s.revoked && !s.expired;
        return `<article class="session-row" data-session-id="${esc(s.jti)}"><div class="session-symbol">${icon(d.icon)}</div><div class="session-info"><div class="session-heading"><strong>${esc(s.name || d.label)}</strong><span class="session-state">${s.revoked ? 'Cerrada' : s.expired ? 'Vencida' : s.current ? 'Esta sesión' : 'Activa'}</span></div><p>${esc(d.label)} · ${esc(s.username)}<br>IP: <code>${esc(s.ip || 'Sin registro anterior')}</code></p><dl><div><dt>Última actividad</dt><dd>${date(s.lastSeen)}</dd></div><div><dt>Inicio</dt><dd>${date(s.created)}</dd></div><div><dt>Vence</dt><dd>${date(s.expiresAt)}</dd></div></dl><details><summary>Detalles del navegador</summary><p class="session-ua">${esc(s.ua || 'Sin registro')}</p></details><div data-name-editor></div></div><div class="session-actions"><button type="button" class="btn-secondary" data-name${active ? '' : ' disabled'}>Nombrar</button><button type="button" class="btn-danger" data-revoke${active ? '' : ' disabled'}>${s.current ? 'Cerrar esta sesión' : 'Cerrar sesión'}</button></div></article>`;
      }).join('') || '<p class="settings-help">No hay sesiones para mostrar.</p>';
      node.querySelectorAll('[data-session-id]').forEach(row => {
        const s = data.find(s => s.jti === row.dataset.sessionId);
        row.querySelector('[data-revoke]').onclick = async e => {
          if (!await confirmDialog('Cerrar sesión', s.current ? 'Vas a salir de AXON en este navegador.' : `Se cerrará el acceso de ${s.name || device(s.ua).label}, incluyendo sus terminales y conexiones abiertas. Para volver a entrar tendrá que iniciar sesión.`, 'Cerrar sesión')) return;
          busy = true;
          await AxonUI.busy(e.currentTarget, async () => {
            try { await api('/api/sessions/' + encodeURIComponent(s.jti) + '/revoke', { method: 'POST' }); if (s.current) { location.reload(); return; } toast('Sesión cerrada', 'ok'); }
            catch (e) { error(node, e); }
            finally { busy = false; }
          });
          await refresh();
        };
        row.querySelector('[data-name]').onclick = () => {
          if (editing) return editing.querySelector('input').focus();
          const host = row.querySelector('[data-name-editor]'); editing = host;
          host.innerHTML = `<div class="session-name"><label>Nombre del dispositivo<input data-local maxlength="80" aria-label="Nombre del dispositivo" value="${esc(s.name)}" placeholder="Mi computadora"></label><button type="button" class="btn-primary" data-save>Guardar nombre</button><button type="button" class="btn-secondary" data-cancel>Cancelar</button></div>`;
          const close = () => { host.replaceChildren(); editing = null; };
          host.querySelector('[data-cancel]').onclick = close;
          host.querySelector('[data-save]').onclick = e => AxonUI.busy(e.currentTarget, async () => {
            busy = true;
            try { await api('/api/sessions/' + encodeURIComponent(s.jti), { method: 'PATCH', body: { name: host.querySelector('input').value } }); close(); busy = false; await refresh(); }
            catch (e) { error(node, e); } finally { busy = false; }
          });
          host.querySelector('input').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); host.querySelector('[data-save]').click(); } if (e.key === 'Escape') close(); };
          host.querySelector('input').focus();
        };
      }); refreshIcons();
    }
    async function refresh() {
      clearTimeout(timer); if (busy || editing || !visible(node)) return;
      const id = ++ticket; node.setAttribute('aria-busy', 'true');
      try { const r = await api('/api/sessions'); if (id !== ticket || !visible(node)) return; data = r.sessions; render(); const box = node.querySelector('[data-message]'); box.setAttribute('role', 'status'); box.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR'); }
      catch (e) { if (id === ticket) error(node, e); }
      finally { if (id === ticket) { node.removeAttribute('aria-busy'); timer = setTimeout(refresh, 15000); } }
    }
    node.querySelector('[data-refresh]').onclick = refresh;
    node.querySelector('[data-history]').onchange = render;
    node.querySelector('[data-others]').onclick = async e => {
      if (!await confirmDialog('Cerrar las otras sesiones', 'Todos los demás navegadores perderán acceso a AXON. Esta sesión seguirá abierta.', 'Cerrar las otras')) return;
      busy = true;
      await AxonUI.busy(e.currentTarget, async () => {
        try { const r = await api('/api/sessions/revoke-others', { method: 'POST' }); toast(r.revoked + ' sesiones cerradas', 'ok'); }
        catch (e) { error(node, e); } finally { busy = false; }
      }); await refresh();
    };
    document.addEventListener('axon:session-expired', () => { ticket++; clearTimeout(timer); data = []; node.querySelector('[data-sessions]').replaceChildren(); editing = null; });
    return { refresh, dirty: () => !!editing };
  }
  function mountFans(pane) {
    const node = document.createElement('div'); node.id = 'fan-controller'; pane.append(node);
    node.innerHTML = '<div class="device-toolbar"><button type="button" class="btn-secondary" data-refresh>Actualizar</button><button type="button" class="btn-secondary" data-auto disabled>Volver a automático</button><button type="button" class="btn-danger" data-max disabled>Máximo</button></div><p data-message role="status">Consultando ventiladores…</p><div data-fan-state></div><div data-controls hidden><div class="fan-sliders"><label>Ventilador CPU <output data-cpu-output>60%</output><input type="range" min="20" max="100" value="60" step="1" data-cpu data-local aria-label="Potencia del ventilador CPU"></label><label>Ventilador GPU <output data-gpu-output>60%</output><input type="range" min="20" max="100" value="60" step="1" data-gpu data-local aria-label="Potencia del ventilador GPU"></label></div><label>Duración del modo manual<select data-minutes data-local><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option></select></label><button type="button" class="btn-primary" data-apply>Aplicar potencia manual</button><p class="settings-help">Los cambios se aplican con el botón. Al terminar el período manual, vuelve a automático. Si la CPU llega a 85 °C o la GPU a 80 °C, la protección térmica sube los ventiladores al máximo.</p></div>';
    let state, busy = false, pending = false, ticket = 0, timer;
    function render() {
      const enabled = !!state?.available;
      node.querySelectorAll('[data-auto],[data-max],[data-apply]').forEach(b => b.disabled = !enabled || busy);
      node.querySelector('[data-controls]').hidden = !enabled;
      if (!enabled) { node.querySelector('[data-fan-state]').innerHTML = `<p class="settings-help">${esc(state?.error || 'El control de ventiladores todavía no está disponible en este servidor.')}</p>`; return; }
      const modes = { auto: 'Automático · regulado por el BIOS', max: 'Máximo', manual: 'Manual' };
      node.querySelector('[data-fan-state]').innerHTML = `<p class="fan-model"><strong>${esc(state.model)}</strong> · BIOS ${esc(state.bios)}${state.fixture ? ' · Simulación de QA' : ''}</p><p><strong>${modes[state.effectiveMode] || 'Sin confirmar'}</strong>${state.remainingSeconds != null ? ' · ' + Math.ceil(state.remainingSeconds / 60) + ' min restantes' : ''}</p>${state.override ? `<p class="fan-guard" role="status">${esc(state.override)}</p>` : ''}${state.reason ? `<p class="settings-help">${esc(state.reason)}</p>` : ''}<div class="fan-readings"><div><span>CPU</span><strong>${state.cpuRpm == null ? 'Sin lectura' : state.cpuRpm.toLocaleString('es-AR') + ' RPM'}</strong><small>${state.cpuTemp == null ? 'Sin temperatura' : state.cpuTemp + ' °C'}</small></div><div><span>GPU</span><strong>${state.gpuRpm == null ? 'Sin lectura' : state.gpuRpm.toLocaleString('es-AR') + ' RPM'}</strong><small>${state.gpuTemp == null ? 'Sin temperatura' : state.gpuTemp + ' °C'}</small></div></div>`;
      if (!pending && state.mode === 'manual') {
        for (const part of ['cpu','gpu']) { node.querySelector('[data-' + part + ']').value = state[part]; node.querySelector('[data-' + part + '-output]').textContent = state[part] + '%'; }
      }
    }
    async function refresh() {
      clearTimeout(timer); if (busy || !visible(node)) return;
      const id = ++ticket;
      try { const r = await api('/api/fans'); if (id !== ticket || !visible(node)) return; state = r; render(); const box = node.querySelector('[data-message]'); box.setAttribute('role', 'status'); box.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR'); }
      catch (e) { if (id === ticket) { state = null; render(); error(node, e); } }
      finally { if (id === ticket) timer = setTimeout(refresh, 5000); }
    }
    async function apply(button, mode) {
      if (!state?.available || busy) return;
      busy = true; ticket++; clearTimeout(timer);
      const body = { mode, revision: state.revision, ...(mode === 'manual' ? { cpu: Number(node.querySelector('[data-cpu]').value), gpu: Number(node.querySelector('[data-gpu]').value), minutes: Number(node.querySelector('[data-minutes]').value) } : {}) };
      await AxonUI.busy(button, async () => {
        try { state = await api('/api/fans', { method: 'POST', body }); pending = false; render(); node.querySelector('[data-message]').textContent = 'Modo aplicado: ' + (mode === 'manual' ? 'manual' : mode === 'max' ? 'máximo' : 'automático'); }
        catch (e) { error(node, e); }
        finally { busy = false; node.querySelectorAll('[data-auto],[data-max],[data-apply]').forEach(b => b.disabled = !state?.available); timer = setTimeout(refresh, 5000); }
      });
    }
    for (const part of ['cpu','gpu']) node.querySelector('[data-' + part + ']').oninput = e => { pending = true; node.querySelector('[data-' + part + '-output]').textContent = e.target.value + '%'; };
    node.querySelector('[data-minutes]').onchange = () => pending = true;
    node.querySelector('[data-refresh]').onclick = refresh;
    node.querySelector('[data-auto]').onclick = e => apply(e.currentTarget, 'auto');
    node.querySelector('[data-max]').onclick = e => apply(e.currentTarget, 'max');
    node.querySelector('[data-apply]').onclick = e => apply(e.currentTarget, 'manual');
    document.addEventListener('axon:session-expired', () => { ticket++; clearTimeout(timer); state = null; pending = false; render(); });
    return { refresh, dirty: () => pending };
  }
  window.AxonDeviceControls = { mountSessions, mountFans };
})();
