/* AXON — Bots · Diagnóstico: revisa OpenBot y ofrece reparaciones de una lista cerrada. */
(() => {
  'use strict';
  const REG = (window.AxonBots ||= { tabs: [] });
  const ICON = { ok: 'circle-check', info: 'info', warn: 'triangle-alert', bad: 'circle-x' };
  let data = null, error = null;
  async function load() {
    try { data = await api('/api/openbot/doctor', { timeoutMs: 100000 }); error = null; } catch (e) { data = null; error = e.message || 'No se pudo hacer el diagnóstico'; }
  }
  const problems = () => (data?.findings || []).filter((f) => f.level === 'bad' || f.level === 'warn').length;
  function render({ busy }) {
    if (!data) return `<article class="bots-card bots-wide"><header><h3>Diagnóstico</h3></header><p class="bots-note is-warn">${esc(error || 'Sin datos')}</p><div class="bots-actions"><button class="btn-secondary" data-act="doc-reload">Reintentar</button></div></article>`;
    const list = data.findings.map((f) => `<li class="bots-find is-${f.level}"><span class="bots-find-ic">${icon(ICON[f.level] || 'info')}</span>
      <div><strong>${esc(f.title)}</strong><p>${esc(f.detail)}</p></div>
      ${f.fix ? `<button class="${f.level === 'bad' ? 'btn-primary' : 'btn-secondary'}" data-fix="${esc(f.fix.id)}" data-confirm="${esc(f.fix.confirm)}" data-label="${esc(f.fix.label)}" ${busy ? 'disabled' : ''}>${esc(f.fix.label)}</button>` : ''}</li>`).join('');
    return `<article class="bots-card bots-wide"><header><h3>Diagnóstico</h3><small>Revisado ${esc(REG.when(data.checkedAt))}</small>
        <div class="bots-seg"><button type="button" data-act="doc-reload">${icon('refresh-cw')} Volver a revisar</button></div></header>
      <ul class="bots-finds">${list}</ul>
      <p class="bots-hint">Las reparaciones guardan una copia antes de tocar nada y siempre vuelven a levantar OpenBot. Si una falla, queda el detalle en la barra de tareas y en Registros.</p></article>`;
  }
  async function onClick(ev) {
    const t = ev.target.closest('button'); if (!t) return false;
    if (t.matches('[data-act="doc-reload"]')) { await REG.guarded(load); return true; }
    if (t.dataset.fix) {
      if (!(await confirmDialog(t.dataset.label, t.dataset.confirm, t.dataset.label))) return true;
      await REG.guarded(async () => { const r = await api('/api/openbot/doctor/fix', { method: 'POST', body: { fix: t.dataset.fix, confirm: true } }); REG.trackJob(r.job); });
      return true;
    }
    return false;
  }
  REG.tabs.push({ id: 'doctor', label: 'Diagnóstico', icon: 'stethoscope', load, render, onClick, badge: problems });
})();
