/* AXON — Bots · Proveedores: claves API del OpenCode que corre dentro de OpenBot. */
(() => {
  'use strict';
  const REG = (window.AxonBots ||= { tabs: [] });
  const QUICK = [['opencode-go', 'OpenCode Go'], ['openrouter', 'OpenRouter'], ['anthropic', 'Anthropic'], ['openai', 'OpenAI (API)'], ['google', 'Google'], ['deepseek', 'DeepSeek'], ['minimax-coding-plan', 'MiniMax'], ['ollama-cloud', 'Ollama Cloud'], ['groq', 'Groq']];
  const TYPE = { api: 'Clave API', oauth: 'Inicio de sesión', wellknown: 'Automático' };
  let data = null, error = null, dirty = false, picked = '', tests = {};

  async function load() {
    try { data = await api('/api/openbot/providers'); error = null; } catch (e) { data = null; error = e.message || 'No se pudo leer'; }
  }
  function render({ busy }) {
    if (!data) return `<article class="bots-card bots-wide"><header><h3>Proveedores</h3></header><p class="bots-note is-warn">${esc(error || 'Sin datos')}</p><div class="bots-actions"><button class="btn-secondary" data-act="prov-reload">Reintentar</button></div></article>`;
    const have = new Set(data.providers.map((p) => p.id));
    const paid = data.totalModels - data.freeModels;
    const rows = data.providers.map((p) => {
      const t = tests[p.id];
      const res = t ? (t.loading ? '<span class="bots-dim">Probando…</span>' : t.works ? `<span class="bots-ok">Responde (${(t.ms / 1000).toFixed(1)} s)</span> <span class="bots-dim">${esc(t.model)}</span>` : `<span class="bots-warn">No respondió</span> <span class="bots-dim">${esc(t.error || t.detail || '')}</span>`) : '';
      return `<tr><td><strong>${esc(p.name)}</strong><small class="bots-sub">${esc(p.id)}</small></td><td>${esc(TYPE[p.type] || p.type)}</td><td class="num">${esc(String(p.models))}</td><td>${res}</td>
        <td class="num"><button class="btn-secondary" data-prov-test="${esc(p.id)}" ${busy ? 'disabled' : ''}>Probar</button> <button class="btn-secondary" data-prov-remove="${esc(p.id)}" data-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>Quitar</button></td></tr>`;
    }).join('');
    const quick = QUICK.filter(([id]) => data.addable.some((a) => a.id === id) && !have.has(id)).map(([id, name]) => `<button type="button" class="bots-chip ${picked === id ? 'is-on' : ''}" data-prov-pick="${id}">${esc(name)}</button>`).join('');
    const pickedName = (data.addable.find((a) => a.id === picked) || {}).name || '';
    return `<div class="bots-grid">
      <article class="bots-card bots-wide"><header><h3>Conectados</h3><small>${esc(String(data.totalModels))} modelos disponibles · ${esc(String(data.freeModels))} gratuitos${paid > 0 ? ` · ${esc(String(paid))} con tus proveedores` : ''}</small></header>
        ${rows ? `<div class="bots-tablewrap"><table class="bots-table"><thead><tr><th>Proveedor</th><th>Acceso</th><th class="num">Modelos</th><th>Prueba</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="bots-dim">Todavía no conectaste ningún proveedor: solo están los modelos gratuitos de OpenCode.</p>'}
        ${dirty ? `<p class="bots-note is-warn">Hay cambios sin aplicar: OpenBot necesita reiniciarse para que la app vea los modelos nuevos.</p><div class="bots-actions"><button class="btn-primary" data-prov-apply ${busy ? 'disabled' : ''}>${icon('rotate-cw')} Reiniciar OpenBot ahora</button></div>` : ''}
      </article>
      <article class="bots-card"><header><h3>Agregar clave API</h3></header>
        <p class="bots-hint">Elegí el proveedor y pegá tu clave. Se guarda dentro de OpenBot y no se vuelve a mostrar. Para <strong>OpenCode Go</strong> usá la clave de opencode.ai/auth.</p>
        ${quick ? `<div class="bots-chips">${quick}</div>` : ''}
        <form class="bots-form" data-form="prov-key" autocomplete="off">
          <label>Proveedor<input class="filter-input" name="provider" list="bots-prov-list" value="${esc(pickedName)}" placeholder="Buscá por nombre…" required></label>
          <datalist id="bots-prov-list">${data.addable.map((a) => `<option value="${esc(a.name)}"></option>`).join('')}</datalist>
          <label>Clave API<input class="filter-input" type="password" name="key" autocomplete="new-password" spellcheck="false" placeholder="sk-…" required></label>
          <div class="bots-actions"><button class="btn-primary" ${busy ? 'disabled' : ''}>Guardar clave</button></div></form>
      </article>
      <article class="bots-card"><header><h3>Qué se puede conectar</h3></header>
        <p class="bots-hint">Acá se conectan proveedores con <strong>clave API</strong>. El inicio de sesión por navegador (OAuth), por ejemplo ChatGPT o Copilot, no se maneja desde el panel.</p>
        <p class="bots-hint">Cada agente elige su modelo en la app de OpenBot; los modelos de estos proveedores aparecen ahí después de reiniciar OpenBot.</p></article>
    </div>`;
  }
  async function onClick(ev) {
    const t = ev.target.closest('button'); if (!t) return false;
    if (t.matches('[data-act="prov-reload"]')) { await REG.guarded(load); return true; }
    if (t.dataset.provPick) { picked = t.dataset.provPick; REG.repaint(); $('#tab-bots input[name=key]')?.focus(); return true; }
    if (t.matches('[data-prov-apply]')) {
      if (!(await confirmDialog('Reiniciar OpenBot', 'Se corta unos segundos lo que esté haciendo. La sesión se conserva.', 'Reiniciar'))) return true;
      const r = await api('/api/openbot/action', { method: 'POST', body: { action: 'restart' } }); dirty = false; REG.trackJob(r.job); return true;
    }
    if (t.dataset.provTest) {
      const id = t.dataset.provTest; tests[id] = { loading: true }; REG.repaint();
      try { const r = await api('/api/openbot/providers/test', { method: 'POST', body: { provider: id }, timeoutMs: 120000 }); tests[id] = r; }
      catch (e) { tests[id] = { works: false, error: e.message }; }
      REG.repaint(); return true;
    }
    if (t.dataset.provRemove) {
      if (!(await confirmDialog(`Quitar ${t.dataset.name}`, 'Se borra la credencial dentro de OpenBot. Los agentes que usen sus modelos dejarán de funcionar hasta que elijas otro.', 'Quitar'))) return true;
      await REG.guarded(async () => { const r = await api('/api/openbot/providers/remove', { method: 'POST', body: { provider: t.dataset.provRemove, confirm: true } }); toast(r.message, 'ok'); dirty = true; await load(); });
      return true;
    }
    return false;
  }
  async function onSubmit(kind, form, el) {
    if (kind !== 'prov-key') return;
    const typed = String(form.provider || '').trim().toLowerCase();
    const hit = data.addable.find((a) => a.name.toLowerCase() === typed || a.id === typed);
    if (!hit) { toast('Elegí un proveedor de la lista', 'error'); return; }
    await REG.guarded(async () => {
      const r = await api('/api/openbot/providers/key', { method: 'POST', body: { provider: hit.id, key: String(form.key || '').trim() } });
      el.reset(); picked = ''; dirty = true; toast(r.message, 'ok'); await load();
    });
  }
  REG.tabs.push({ id: 'providers', label: 'Proveedores', icon: 'plug', load, render, onClick, onSubmit, badge: () => (dirty ? '!' : '') });
})();
