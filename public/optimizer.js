/* Salud: measures host usage and preserves applications with detected or unknown activity. */
(() => {
  'use strict';
  let snapshot = null, loading = false, acting = false, timer = null, query = '', sort = 'cpu', showStopped = false, fresh = false;
  const pct = n => n == null ? 'Sin medición' : `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;
  const mb = n => n == null ? 'Sin medición' : n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`;
  const when = t => new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const root = () => $('#optimizer');

  async function init() {
    // The live container mounts public/ directly. Keep its existing Salud view
    // intact until a backend containing these routes has been deployed.
    try { const me = await api('/api/me'); if (!me.authenticated || !me.capabilities?.includes('optimizer-idle-guard')) return; }
    catch { return; }
    const tab = $('#tab-ops');
    if (!tab || root()) return;
    const section = document.createElement('div'); section.id = 'optimizer';
    section.innerHTML = `<p class="opt-intro">Entendé qué está consumiendo recursos y apagá lo que no necesitás ahora.</p>
      <div id="opt-status" class="opt-status" role="status">Midiendo el servidor…</div>
      <div id="opt-summary" class="opt-summary"></div>
      <div class="opt-section-head"><div><h3>Qué podés hacer</h3><p>Las bases locales verificadas pueden apagarse después de 2 minutos sin uso. Si hay actividad o dudas, quedan encendidas.</p></div><button id="opt-plan" class="btn-primary">${icon('sparkles')} Optimizar</button></div>
      <label class="opt-clean"><input type="checkbox" id="opt-clean"> También limpiar caché de compilación vieja <span>Archivos regenerables de Docker, sin uso desde hace 7 días. La próxima compilación puede tardar más.</span></label>
      <p id="opt-op-result" class="opt-result" role="status"></p>
      <div id="opt-receipts"></div>
      <div class="opt-section-head"><div><h3>Aplicaciones del servidor</h3><p>Un contenedor es una aplicación aislada. Acá ves para qué sirve y qué pasa si la apagás.</p></div></div>
      <div class="opt-toolbar"><label><span class="sr-only">Buscar aplicaciones</span><input id="opt-search" type="search" placeholder="Buscar por nombre o función…"></label><label>Ordenar por <select id="opt-sort"><option value="cpu">Uso de CPU</option><option value="memoryMb">Memoria</option><option value="name">Nombre</option></select></label><label><input type="checkbox" id="opt-stopped"> Incluir apagadas</label></div>
      <div class="opt-table-wrap"><table class="opt-table"><caption class="sr-only">Aplicaciones y consumo medido sobre la capacidad total del servidor</caption><thead><tr><th>Aplicación y función</th><th>CPU</th><th>Memoria</th><th>Cuándo la necesitás</th><th>Acción</th></tr></thead><tbody id="opt-apps"></tbody></table></div>
      <details class="opt-host" open><summary>También corre fuera de Docker <span id="opt-process-count"></span></summary><p>Estos programas también consumen recursos. La memoria es aproximada y puede incluir memoria compartida. No se apagan automáticamente.</p><div id="opt-processes"></div></details>
      <div class="opt-section-head"><div><h3>Qué pasó recientemente</h3><p>Muestras cada 30 segundos, incluso con el panel cerrado. Se conservan hasta 24 horas; acá ves las últimas 120 muestras.</p></div><a href="/metricas" class="btn-secondary">Historial de recursos ${icon('arrow-up-right')}</a></div><div id="opt-history"></div>
      <details class="opt-help"><summary>CPU, memoria y disco: qué significa cada uno</summary><p><b>CPU:</b> trabajo que hace el procesador. Un porcentaje alto sostenido puede demorar otras tareas. Todos los consumos de esta vista usan la capacidad total del servidor como referencia.</p><p><b>Memoria:</b> espacio para programas abiertos. Linux usa memoria libre como caché y la recupera cuando hace falta. Vaciar esa caché no soluciona una aplicación que consume CPU.</p><p><b>Disco:</b> espacio para guardar archivos. Limpiar archivos recupera espacio; no implica que baje la CPU. La espera por disco se muestra aparte.</p><p><b>Optimizar:</b> revisa las aplicaciones autorizadas y vuelve a comprobar su uso antes de apagar cada una. Una conexión abierta, actividad reciente o una comprobación incompleta impiden la parada. Las autorizadas están limitadas a sus bases locales verificadas. Las demás necesitan una comprobación de uso confiable; si falta, quedan encendidas. Podés volver a encender lo que se apagó.</p></details>`;
    tab.querySelector('.section-header').after(section);
    const advanced = document.createElement('details'); advanced.className = 'opt-advanced';
    advanced.innerHTML = '<summary>Otros controles del servidor</summary>';
    advanced.append(tab.querySelector('#ops-grid')); tab.append(advanced);
    const original = loaders.ops;
    loaders.ops = () => { load(); original?.(); };
    $('#ops-refresh').addEventListener('click', load);
    section.addEventListener('click', handleClick);
    section.addEventListener('change', handleChange);
    $('#opt-search').addEventListener('input', e => { query = e.target.value; renderApps(); });
    document.addEventListener('axon:section', e => { if (e.detail === 'ops') startPolling(); else stopPolling(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopPolling(); else if (activeTabName === 'ops') { load(); startPolling(); } });
    document.addEventListener('axon:session-expired', stopPolling);
    window.AxonPages ||= {};
    window.AxonPages.ops = { restore: async () => { startPolling(); await load(); }, leave: stopPolling };
    if (activeTabName === 'ops') { startPolling(); load(); }
    refreshIcons();
  }
  function startPolling() { if (!timer) timer = setInterval(() => { if (!document.hidden && activeTabName === 'ops' && !acting && !document.activeElement?.matches('[data-importance]')) load(); }, 15_000); }
  function stopPolling() { clearInterval(timer); timer = null; }
  async function load() {
    if (loading) return;
    loading = true;
    try {
      const data = await api('/api/optimizer', { timeoutMs: 35_000 });
      snapshot = data.snapshot; fresh = true; render();
    } catch (e) {
      fresh = false;
      $('#opt-status').textContent = `No se pudo actualizar el diagnóstico. ${snapshot ? 'Los datos visibles son de ' + when(snapshot.at) + '.' : ''} Usá Actualizar para reintentar.`;
      $('#opt-status').className = 'opt-status opt-warning';
      $('#opt-plan').disabled = true;
    } finally { loading = false; }
  }
  function meter(label, value, detail, description) {
    return `<div class="opt-meter"><span>${label}</span><b>${value == null ? '—' : pct(value)}</b><div class="opt-meter-track"><i class="${value >= 85 ? 'opt-hot' : ''}" style="width:${Math.max(0, Math.min(100, value || 0))}%"></i></div><small>${esc(detail)}</small><p>${esc(description)}</p></div>`;
  }
  function render() {
    const s = snapshot;
    const high = s.cpu.busy >= 85, memoryHigh = s.memory.percent >= 90, waiting = s.cpu.wait >= 15;
    const headline = high ? 'El procesador está muy ocupado' : waiting ? 'El servidor está esperando al disco' : memoryHigh ? 'Queda poca memoria disponible' : s.cpu.busy >= 70 ? 'El procesador está ocupado' : 'El servidor tiene margen en esta medición';
    const top = [...s.apps.filter(a => a.cpu != null).map(a => ({ name: a.name, cpu: a.cpu })), ...s.processes.map(p => ({ name: p.title, cpu: p.cpu }))].sort((a, b) => b.cpu - a.cpu)[0];
    $('#opt-status').className = `opt-status${high || memoryHigh || waiting ? ' opt-warning' : ''}`;
    $('#opt-status').innerHTML = `<div><b>${esc(fresh ? headline : 'No se pudo actualizar el diagnóstico')}</b><p>${!fresh ? 'Los datos visibles son anteriores. Usá Actualizar para reintentar. ' : ''}${top?.cpu >= 1 ? `Mayor consumo observado: ${esc(top.name)}, ${pct(top.cpu)} de la CPU total.` : 'No se observa una aplicación con gran consumo de CPU ahora.'}${s.highForMs >= 60_000 ? ` Uso alto durante al menos ${Math.floor(s.highForMs / 60_000)} min de muestras continuas.` : high ? ' Esperá más muestras para saber si es sostenido.' : ''}</p>${s.errors.length ? `<p class="opt-warning-text">${s.errors.map(esc).join(' ')}</p>` : ''}</div><small>Medido ${when(s.at)} · ${s.cpu.cores} núcleos · ventana de ${(s.intervalMs / 1000).toFixed(1)} s</small>`;
    $('#opt-summary').innerHTML = meter('Procesador · CPU', s.cpu.busy, `Espera por disco ${pct(s.cpu.wait)} · espera del host ${pct(s.cpu.steal)}`, 'Cuánto está trabajando el servidor ahora.') + meter('Memoria · RAM', s.memory.percent, `${mb(s.memory.availableMb)} disponibles de ${mb(s.memory.totalMb)}`, `Caché recuperable: ${mb(s.memory.cacheMb)}. Memoria en disco: ${mb(s.memory.swapUsedMb)}.`) + meter('Almacenamiento · Sistema', s.disk?.percent, s.disk ? `${s.disk.availableGb.toFixed(1)} GB libres de ${s.disk.totalGb.toFixed(1)} GB` : 'No disponible', 'Limpiar archivos libera espacio; no garantiza bajar el uso de CPU.');
    $('#opt-plan').disabled = !fresh || acting || s.busy || s.errors.some(e => e.includes('Docker'));
    renderApps(); renderProcesses(); renderHistory(); renderReceipts(); refreshIcons();
  }
  function renderApps() {
    if (!snapshot) return;
    const opened = new Set(Array.from($('#opt-apps').querySelectorAll('tr[data-id] details[open]')).map(d => d.closest('tr').dataset.id));
    const apps = snapshot.apps.filter(a => (showStopped || a.state !== 'exited' && a.state !== 'created') && `${a.name} ${a.title} ${a.purpose}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : (b[sort] ?? -1) - (a[sort] ?? -1));
    $('#opt-apps').innerHTML = apps.length ? apps.map(a => {
      const running = a.state === 'running';
      return `<tr data-id="${esc(a.id)}"><td><b>${esc(a.title)}</b><span class="opt-app-name">${esc(a.name)} · ${running ? 'Encendida' : a.state === 'exited' || a.state === 'created' ? 'Apagada' : esc(a.state)}</span><p>${esc(a.purpose)}</p><details ${opened.has(a.id) ? 'open' : ''}><summary>Ver conexiones y detalles</summary><small>Imagen: ${esc(a.image)}${a.project ? `<br>Grupo: ${esc(a.project)}` : ''}<br>${a.connections.length ? `Direcciones que pueden dejar de responder: ${a.connections.map(esc).join(', ')}` : 'No hay direcciones asociadas en Axon. Puede tener usuarios o conexiones que Axon no conoce.'}${a.dependents.length ? `<br>La necesitan: ${a.dependents.map(esc).join(', ')}` : ''}</small></details></td><td data-label="CPU">${running ? pct(a.cpu) : '—'}${running && a.cpu != null ? `<div class="opt-meter-track"><i style="width:${Math.min(100, a.cpu)}%"></i></div>` : ''}</td><td data-label="Memoria">${running ? mb(a.memoryMb) : '—'}</td><td data-label="Cuándo la necesitás">${a.critical ? `<span class="opt-protected">${icon('shield-check')} Protegida</span>` : `<select data-importance="${esc(a.id)}" aria-label="Cuándo necesitás ${esc(a.name)}" ${acting || !fresh ? 'disabled' : ''}><option value="unknown" ${a.importance === 'unknown' ? 'selected' : ''}>Por decidir</option><option value="always" ${a.importance === 'always' ? 'selected' : ''}>Siempre encendida</option><option value="sometimes" ${a.importance === 'sometimes' ? 'selected' : ''} ${a.dependents.length ? 'disabled' : ''}>Sólo cuando la uso</option></select>`}<small>${esc(a.blocked || a.activity?.reason || 'Se comprobará su uso antes de permitir apagarla.')}</small></td><td>${a.canStop ? `<button class="btn-secondary" data-stop="${esc(a.id)}" ${acting || !fresh ? 'disabled' : ''}>Apagar…</button>` : '<span class="opt-muted">Sin acción automática</span>'}</td></tr>`;
    }).join('') : `<tr><td colspan="5">${snapshot.errors.some(e => e.includes('Docker')) ? 'No se pudo leer Docker. Reintentá con Actualizar.' : 'No hay aplicaciones que coincidan con el filtro.'}</td></tr>`;
    refreshIcons();
  }
  function renderProcesses() {
    $('#opt-process-count').textContent = `· ${snapshot.processes.length} grupos`;
    $('#opt-processes').innerHTML = snapshot.processes.slice(0, 12).map(p => `<div class="opt-process"><div><b>${esc(p.title)}</b><small>${esc(p.purpose)} · ${p.pids.length} proceso${p.pids.length === 1 ? '' : 's'}${p.cwd ? ' · ' + esc(p.cwd) : ''}</small></div><span>${pct(p.cpu)} CPU</span><span>${mb(p.memoryMb)}</span></div>`).join('') || '<p>Sin procesos medidos fuera de Docker.</p>';
  }
  function renderHistory() {
    const points = snapshot.history;
    if (!points.length) { $('#opt-history').textContent = 'Todavía no hay historial. Las próximas muestras van a aparecer acá.'; return; }
    const peak = points.reduce((a, b) => a.cpu > b.cpu ? a : b);
    const span = Math.max(1, points.at(-1).at - points[0].at);
    const segments = [[]];
    points.forEach((p, i) => { if (i && p.at - points[i - 1].at > 45_000) segments.push([]); segments.at(-1).push(`${(p.at - points[0].at) / span * 700},${100 - Math.min(100, p.cpu)}`); });
    const chart = segments.map(s => s.length === 1 ? `<circle cx="${s[0].split(',')[0]}" cy="${s[0].split(',')[1]}" r="2"/>` : `<polyline points="${s.join(' ')}" fill="none"/>`).join('');
    $('#opt-history').innerHTML = `<div class="opt-history-meta"><span>Pico registrado: <b>${pct(peak.cpu)}</b> a las ${when(peak.at)}</span><span>${points.length} muestras · desde ${when(points[0].at)}</span></div><svg class="opt-chart" viewBox="0 0 700 105" role="img" aria-label="Historial de CPU: pico de ${pct(peak.cpu)}"><line x1="0" y1="15" x2="700" y2="15" class="opt-chart-threshold"/>${chart}</svg><p class="opt-muted">En la muestra del pico coincidieron: ${peak.top.slice(0, 3).map(t => `${esc(t.name)} (${pct(t.cpu)})`).join(', ') || 'sin atribución disponible'}. Las mediciones por aplicación son aproximadas y pueden no sumar el total. Las muestras pueden omitir picos breves.</p>`;
  }
  function renderReceipts() {
    $('#opt-receipts').innerHTML = snapshot.receipts.slice(0, 3).map(r => {
      const recoverable = r.items.filter(i => i.status !== 'skipped');
      const undone = recoverable.length && recoverable.every(i => i.status === 'restored');
      const labels = { pending: 'parada pendiente de verificar', stopped: 'apagada', failed: 'parada no confirmada', restored: 'encendida de nuevo', skipped: 'se mantuvo encendida' };
      return `<div class="opt-receipt"><div><b>${r.complete ? 'Última acción' : 'Acción interrumpida: revisá el estado'} · ${when(r.at)}</b><p>CPU antes ${pct(r.before)}${r.after != null ? ` · después ${pct(r.after)}` : ''}. Es una comparación puntual, no una garantía de mejora.</p>${r.items.map(i => `<p>${esc(i.name)}: ${labels[i.status] || esc(i.status)}${i.error ? ` · ${esc(i.error)}` : ''}</p>`).join('')}${r.cleanup ? `<p>Caché: ${r.cleanup.status === 'ok' ? esc(r.cleanup.detail) : r.cleanup.status === 'pending' ? 'pendiente de verificar' : 'limpieza no confirmada'}. Los archivos de caché se regeneran; no se restauran.</p>` : ''}</div>${recoverable.length ? `<button class="btn-secondary" data-undo="${esc(r.id)}" ${acting || undone ? 'disabled' : ''}>${undone ? 'Restauradas' : 'Volver a encender'}</button>` : ''}</div>`;
    }).join('');
  }
  async function handleChange(e) {
    if (e.target.id === 'opt-sort') { sort = e.target.value; renderApps(); return; }
    if (e.target.id === 'opt-stopped') { showStopped = e.target.checked; renderApps(); return; }
    if (!e.target.dataset.importance) return;
    const id = e.target.dataset.importance, importance = e.target.value;
    const app = snapshot.apps.find(a => a.id === id);
    if (importance === 'sometimes' && !await confirmDialog('Permitir apagar esta aplicación', `${app.name}\n${app.purpose}\n\nAl optimizar sólo podrá apagarse si hay una comprobación de uso confiable y está libre. Si está trabajando, tiene conexiones abiertas o no se puede comprobar, seguirá encendida. Podrás volver a encenderla después.`, 'Permitir apagar')) { renderApps(); return; }
    acting = true; render();
    try { await api(`/api/optimizer/apps/${id}`, { method: 'PUT', body: { importance }, timeoutMs: 35_000 }); await load(); }
    catch (err) { errToast(err); }
    finally { acting = false; render(); }
  }
  async function handleClick(e) {
    const btn = e.target.closest('button');
    if (!btn || acting) return;
    if (btn.dataset.undo) {
      if (!await confirmDialog('Volver a encender', 'Se vuelven a encender únicamente las aplicaciones de esta acción. Las sesiones y tareas interrumpidas pueden requerir que las abras de nuevo.', 'Encender')) return;
      acting = true; render();
      try { await api('/api/optimizer/undo', { method: 'POST', body: { receiptId: btn.dataset.undo }, timeoutMs: 180_000 }); await load(); }
      catch (err) { errToast(err); }
      finally { acting = false; render(); } return;
    }
    if (btn.id !== 'opt-plan' && !btn.dataset.stop) return;
    acting = true; render();
    try {
      const cleanup = !btn.dataset.stop && $('#opt-clean').checked;
      const plan = await api('/api/optimizer/plan', { method: 'POST', body: { cleanup, ...(btn.dataset.stop ? { ids: [btn.dataset.stop] } : {}) }, timeoutMs: 35_000 });
      if (!plan.apps.length && !plan.cleanup) { $('#opt-op-result').textContent = plan.message; return; }
      const message = plan.apps.map(a => `${a.name}: ${a.purpose}${a.connections.length ? '\nDirecciones afectadas: ' + a.connections.join(', ') : ''}`).join('\n\n') + (plan.apps.length ? '\n\nSe comprobó que estaban libres. Se volverá a revisar justo antes de apagar cada una: si aparece uso, seguirá encendida. Podés volver a encender las que se apaguen después.' : '') + (plan.skipped?.length ? '\n\nSe mantienen encendidas:\n' + plan.skipped.map(a => a.name + ': ' + a.reason).join('\n') : '') + (plan.cleanup ? '\n\nSe borra sólo caché de compilación de Docker sin uso desde hace 7 días. No se borran aplicaciones, imágenes ni volúmenes. La caché se regenera y no tiene deshacer.' : '') + '\n\nNo se puede garantizar cuánto bajará la CPU. La propuesta vence en un minuto.';
      if (!await confirmDialog('Revisar optimización', message, 'Aplicar optimización')) return;
      $('#opt-op-result').textContent = 'Aplicando cambios… Esperá el resultado antes de reintentar.';
      const result = await api('/api/optimizer/apply', { method: 'POST', body: { token: plan.token }, timeoutMs: 180_000 });
      const failures = result.receipt.items.some(i => i.status === 'failed') || result.receipt.cleanup?.status === 'failed';
      $('#opt-op-result').textContent = failures ? 'La acción terminó con problemas. Revisá el resultado de cada aplicación abajo.' : result.receipt.items.some(i => i.status === 'skipped') ? 'Se omitieron aplicaciones que ya no estaban libres. Revisá el motivo abajo.' : 'Acción completada. Revisá el consumo nuevo y el resultado abajo.';
      $('#opt-clean').checked = false; await load();
    } catch (err) { $('#opt-op-result').textContent = 'No se pudo confirmar la acción. Actualizá y revisá el registro antes de reintentar.'; errToast(err); await load(); }
    finally { acting = false; if (snapshot) render(); }
  }
  document.addEventListener('axon:authenticated', init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
