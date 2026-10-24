/* AXON — Bots · Agentes: detalle completo de cada agente de OpenBot y edición de sus skills. */
(() => {
  'use strict';
  const REG = (window.AxonBots ||= { tabs: [] });
  const SUBS = [['resumen', 'Resumen'], ['skills', 'Skills'], ['rutinas', 'Rutinas'], ['memoria', 'Memoria']];
  const MAX_FILE = 200_000;
  let list = null, error = null, selected = null, detail = null, sub = 'resumen', skill = null, memQuery = '', loading = false;
  const day = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { hour12: false, dateStyle: 'short', timeStyle: 'short' }) : '—');
  const kb = (n) => (n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
  const SKILL_TEMPLATE = (slug) => `---\nname: ${slug}\ndescription: Explicá en una frase cuándo debe usar esta skill el agente.\n---\n\n# ${slug}\n\nEscribí acá las instrucciones paso a paso.\n`;
  const textarea = () => $('#tab-bots textarea[name=skill]');
  /** Antes de repintar, rescata lo que se está escribiendo para no perderlo. */
  function sync() { const t = textarea(); if (t && skill && !skill.managed) skill.content = t.value; }
  const dirty = () => { sync(); return !!skill && !skill.managed && skill.content !== skill.original; };

  async function load() {
    try { list = (await api('/api/openbot/agents', { timeoutMs: 60000 })).agents; error = null; } catch (e) { list = null; error = e.message || 'No se pudo leer'; return; }
    if (!selected || !list.some((a) => a.id === selected)) selected = list[0]?.id || null;
    await loadDetail();
  }
  async function loadDetail() {
    detail = null; skill = null; if (!selected) return;
    try { detail = await api('/api/openbot/agents/detail?id=' + encodeURIComponent(selected), { timeoutMs: 60000 }); } catch (e) { error = e.message; }
  }
  const humanSchedule = (s) => {
    if (!s) return 'Sin horario';
    if (s.kind === 'daily') return `Todos los días a las ${s.time}`;
    if (s.kind === 'weekly') return `Cada semana (${(s.days || []).join(', ')}) a las ${s.time || ''}`;
    if (s.kind === 'interval') return `Cada ${s.every || s.minutes || '?'} ${s.unit || 'min'}`;
    return JSON.stringify(s);
  };
  const RUN = { succeeded: ['ok', 'Exitosa'], failed: ['danger', 'Falló'], running: ['warn', 'En curso'], queued: ['warn', 'En cola'], skipped: ['warn', 'Omitida'], cancelled: ['warn', 'Cancelada'] };

  function rail() {
    return `<nav class="bots-rail" aria-label="Agentes">${list.map((a) => `<button type="button" class="bots-rail-item ${a.id === selected ? 'is-on' : ''}" data-ag-pick="${esc(a.id)}">
      <strong>${esc(a.name)}</strong><span>${esc(a.model || '')}</span><small>${esc(String(a.skillCount ?? 0))} skills · ${esc(String(a.activeRoutines))} rutinas · ${esc(String(a.memoryCount))} recuerdos</small></button>`).join('') || '<p class="bots-dim">OpenBot no tiene agentes.</p>'}</nav>`;
  }
  const readonlyNote = '<p class="bots-hint bots-lock">' + '' + 'Esto se edita en la app de OpenBot: lo guarda en un registro protegido y modificarlo desde afuera podría dejarlo inconsistente. Acá lo ves completo.</p>';
  function summary(a) {
    const row = (k, v) => `<div class="bots-kv"><dt>${k}</dt><dd>${v}</dd></div>`;
    return `<article class="bots-card"><header><h3>${esc(a.name)}</h3><small>${esc(a.model || '')}${a.effort ? ' · razonamiento ' + esc(a.effort) : ''}</small></header>
      <dl class="bots-facts">${row('Proveedor', esc(a.provider || '—'))}${row('Acceso', esc(typeof a.access === 'object' && a.access ? JSON.stringify(a.access) : String(a.access ?? '—')))}${row('Uso del equipo', esc(typeof a.computerUse === 'object' && a.computerUse ? JSON.stringify(a.computerUse) : String(a.computerUse ?? '—')))}
        ${row('Notificaciones', a.notifications ? 'Sí' : 'No')}${row('Carpeta de trabajo', `<code>${esc(a.workspacePath || '—')}</code>`)}${row('Actualizado', esc(day(a.updatedAt)))}</dl></article>
      <article class="bots-card"><header><h3>Instrucciones</h3></header>
        ${a.title ? `<p class="bots-pre"><strong>Rol:</strong> ${esc(a.title)}</p>` : ''}${a.description ? `<p class="bots-pre"><strong>Descripción:</strong> ${esc(a.description)}</p>` : ''}${!a.title && !a.description ? '<p class="bots-dim">Sin instrucciones.</p>' : ''}
        ${readonlyNote}</article>`;
  }
  function skills(a, busy) {
    if (skill) {
      const ro = skill.managed;
      const others = list.filter((x) => x.id !== selected);
      return `<article class="bots-card bots-wide"><header><h3>${skill.isNew ? 'Nueva skill' : esc(skill.slug)}</h3>${ro ? '<span class="badge bots-badge">Administrada por OpenBot · solo lectura</span>' : ''}</header>
        ${skill.isNew ? `<label class="bots-label">Nombre (minúsculas, números y guiones)<input class="filter-input" name="slug" value="${esc(skill.slug)}" placeholder="informe-diario" maxlength="64" autocomplete="off" spellcheck="false"></label>` : ''}
        <textarea class="filter-input bots-editor" name="skill" rows="22" spellcheck="false" ${ro ? 'readonly' : ''} maxlength="${MAX_FILE}">${esc(skill.content)}</textarea>
        <p class="bots-hint">Empieza con un encabezado <code>---</code> que lleve <code>name</code> (igual al nombre) y <code>description</code> (cuándo usarla). Se guarda en las dos carpetas que lee el agente.</p>
        ${!ro && others.length ? `<details class="bots-copy"><summary>Copiar también a otros agentes</summary>${others.map((o) => `<label class="bots-check"><input type="checkbox" name="copy" value="${esc(o.id)}"> ${esc(o.name)}</label>`).join('')}</details>` : ''}
        <div class="bots-actions wrap">${ro ? '' : `<button class="btn-primary" data-ag-save ${busy ? 'disabled' : ''}>${icon('save')} Guardar</button>`}
          ${!ro && !skill.isNew ? `<button class="btn-secondary" data-ag-del ${busy ? 'disabled' : ''}>Borrar</button>` : ''}
          <button class="btn-secondary" data-ag-close>${ro ? 'Cerrar' : 'Cancelar'}</button></div></article>`;
    }
    const rows = detail.skills.map((s) => `<tr><td><strong>${esc(s.slug)}</strong><small class="bots-sub">${esc(s.description || 'Sin descripción')}</small></td>
      <td>${s.managed ? '<span class="badge bots-badge">OpenBot</span>' : '<span class="badge bots-badge is-ok">Propia</span>'}</td><td class="num">${esc(kb(s.size))}</td><td>${s.updated ? esc(day(new Date(s.updated * 1000).toISOString())) : '—'}</td>
      <td class="num"><button class="btn-secondary" data-ag-open="${esc(s.slug)}">${s.managed ? 'Ver' : 'Editar'}</button></td></tr>`).join('');
    return `<article class="bots-card bots-wide"><header><h3>Skills <small>${detail.skills.length}</small></h3>
        <div class="bots-actions"><button class="btn-primary" data-ag-new>${icon('plus')} Nueva</button>
        <label class="btn-secondary bots-filebtn">${icon('upload')} Subir SKILL.md<input type="file" data-ag-file accept=".md,text/markdown,text/plain" hidden></label></div></header>
      ${rows ? `<div class="bots-tablewrap"><table class="bots-table"><thead><tr><th>Skill</th><th>Origen</th><th class="num">Tamaño</th><th>Modificada</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="bots-dim">Este agente no tiene skills.</p>'}
      <p class="bots-hint">Las skills le enseñan al agente procedimientos reutilizables. Las propias se pueden crear, editar, borrar y copiar a otros agentes; las de OpenBot son solo de lectura.</p></article>`;
  }
  function routines(a) {
    const rs = a.routines || [];
    const cards = rs.map((r) => `<article class="bots-card bots-wide"><header><h3>${esc(r.name)}</h3><span class="badge bots-badge ${r.active ? 'is-ok' : ''}">${r.active ? 'Activa' : 'Pausada'}</span></header>
      <dl class="bots-facts">${[['Horario', esc(humanSchedule(r.schedule))], ['Zona horaria', esc(r.timezone)], ['Próxima ejecución', esc(day(r.nextRunAt))], ['Si se alcanza el límite', r.limitPolicy === 'wait' ? 'Espera' : 'Omite'], ['Si se perdió una ejecución', r.missedPolicy === 'skip' ? 'La omite' : 'Corre una vez']].map(([k, v]) => `<div class="bots-kv"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <p class="bots-pre"><strong>Instrucción:</strong> ${esc(r.instruction)}</p>
      ${r.runs.length ? `<details><summary>Últimas ejecuciones (${r.runs.length})</summary><ul class="bots-list">${r.runs.map((x) => { const st = RUN[x.status] || ['warn', x.status]; return `<li><span><span class="badge bots-badge is-${st[0]}">${esc(st[1])}</span> ${esc(day(x.scheduledFor || x.createdAt))}</span>${x.error ? `<span class="bots-warn">${esc(x.error)}</span>` : ''}</li>`; }).join('')}</ul></details>` : '<p class="bots-dim">Todavía no se ejecutó.</p>'}</article>`).join('');
    return `${cards || '<article class="bots-card bots-wide"><p class="bots-dim">Este agente no tiene rutinas.</p></article>'}<article class="bots-card bots-wide">${readonlyNote}</article>`;
  }
  function memory(a) {
    const q = memQuery.trim().toLowerCase();
    const ms = (a.memories || []).filter((m) => !q || m.text.toLowerCase().includes(q));
    return `<article class="bots-card bots-wide"><header><h3>Memoria <small>${(a.memories || []).length}</small></h3>
        <input class="filter-input bots-search" data-ag-memq value="${esc(memQuery)}" placeholder="Buscar en la memoria…" aria-label="Buscar en la memoria"></header>
      ${ms.length ? `<ul class="bots-mem">${ms.map((m) => `<li><p class="bots-pre">${esc(m.text)}</p><span class="bots-dim">${m.origin === 'manual' ? 'Manual' : 'Automática'} · ${m.inclusion === 'essential' ? 'Siempre presente' : 'Se busca cuando hace falta'} · ${esc(day(m.createdAt))}</span></li>`).join('')}</ul>` : '<p class="bots-dim">No hay recuerdos que coincidan.</p>'}
      ${readonlyNote}</article>`;
  }
  function render({ busy }) {
    if (!list) return `<article class="bots-card bots-wide"><header><h3>Agentes</h3></header><p class="bots-note is-warn">${esc(error || 'Sin datos')}</p><div class="bots-actions"><button class="btn-secondary" data-act="ag-reload">Reintentar</button></div></article>`;
    sync();
    const a = detail?.agent;
    const subs = `<div class="bots-subtabs" role="tablist">${SUBS.map(([id, label]) => `<button type="button" role="tab" class="${id === sub ? 'is-on' : ''}" data-ag-sub="${id}" aria-selected="${id === sub}">${label}${id === 'skills' && detail ? ` <em>${detail.skills.length}</em>` : ''}${id === 'rutinas' && a ? ` <em>${a.routineCount}</em>` : ''}${id === 'memoria' && a ? ` <em>${a.memoryCount}</em>` : ''}</button>`).join('')}</div>`;
    const body = !a ? `<article class="bots-card bots-wide"><p class="bots-note is-warn">${esc(error || 'Elegí un agente')}</p></article>` : sub === 'skills' ? skills(a, busy) : sub === 'rutinas' ? routines(a) : sub === 'memoria' ? memory(a) : summary(a);
    return `<div class="bots-agents">${rail()}<div class="bots-agent-main">${subs}<div class="bots-grid">${body}</div></div></div>`;
  }
  async function leaveGuard() { return !dirty() || confirmDialog('Hay cambios sin guardar', 'Si salís, se pierde lo que escribiste en la skill.', 'Descartar'); }
  async function openSkill(slug) {
    const r = await api(`/api/openbot/agents/skill?id=${encodeURIComponent(selected)}&slug=${encodeURIComponent(slug)}`);
    skill = { slug, content: r.content, original: r.content, managed: r.managed, isNew: false };
  }
  async function saveSkill(copyTo) {
    const slug = skill.isNew ? String($('#tab-bots input[name=slug]')?.value || '').trim() : skill.slug;
    sync(); const content = skill.content;
    const r = await api('/api/openbot/agents/skill', { method: 'POST', body: { id: selected, slug, content, ...(copyTo.length ? { copyTo } : {}), confirm: true } });
    toast(r.message, 'ok'); skill = null; await loadDetail(); await api('/api/openbot/agents').then((x) => { list = x.agents; }).catch(() => {});
  }
  async function onClick(ev) {
    const t = ev.target.closest('button'); if (!t) return false;
    if (t.matches('[data-act="ag-reload"]')) { await REG.guarded(load); return true; }
    if (t.dataset.agPick) { if (!(await leaveGuard())) return true; selected = t.dataset.agPick; sub = 'resumen'; REG.repaint(); loading = true; await loadDetail(); loading = false; REG.repaint(); return true; }
    if (t.dataset.agSub) { if (!(await leaveGuard())) return true; skill = null; sub = t.dataset.agSub; REG.repaint(); return true; }
    if (t.matches('[data-ag-new]')) { skill = { slug: '', content: SKILL_TEMPLATE('nueva-skill'), original: SKILL_TEMPLATE('nueva-skill'), managed: false, isNew: true }; REG.repaint(); return true; }
    if (t.dataset.agOpen) { await REG.guarded(async () => { await openSkill(t.dataset.agOpen); }); return true; }
    if (t.matches('[data-ag-close]')) { if (!(await leaveGuard())) return true; skill = null; REG.repaint(); return true; }
    if (t.matches('[data-ag-save]')) {
      const copyTo = [...document.querySelectorAll('#tab-bots input[name=copy]:checked')].map((i) => i.value);
      if (copyTo.length && !(await confirmDialog('Copiar skill', `Se guarda también en ${copyTo.length} agente(s) más; si ya tienen una skill con ese nombre, se reemplaza.`, 'Guardar'))) return true;
      await REG.guarded(() => saveSkill(copyTo)); return true;
    }
    if (t.matches('[data-ag-del]')) {
      if (!(await confirmDialog(`Borrar ${skill.slug}`, 'Se borra la skill de este agente (solo de este). No se puede deshacer.', 'Borrar'))) return true;
      await REG.guarded(async () => { const r = await api('/api/openbot/agents/skill/delete', { method: 'POST', body: { id: selected, slug: skill.slug, confirm: true } }); toast(r.message, 'ok'); skill = null; await loadDetail(); });
      return true;
    }
    return false;
  }
  async function onChange(ev) {
    const input = ev.target.closest('[data-ag-file]'); const file = input?.files?.[0]; if (!file) return;
    input.value = '';
    if (file.size > MAX_FILE) { toast('El archivo supera los 200 KB', 'error'); return; }
    let content = ''; try { content = await file.text(); } catch { toast('No se pudo leer el archivo', 'error'); return; }
    const m = content.match(/^---\r?\n[\s\S]*?\bname:\s*["']?([a-z0-9][a-z0-9-]{0,63})["']?\s*$/m);
    const slug = m ? m[1] : file.name.replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
    skill = { slug, content, original: '', managed: false, isNew: true }; REG.repaint();
  }
  document.addEventListener('input', (ev) => { const q = ev.target.closest?.('[data-ag-memq]'); if (!q) return; memQuery = q.value; const pos = q.selectionStart; REG.repaint(); const n = $('#tab-bots [data-ag-memq]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
  REG.tabs.push({ id: 'agents', label: 'Agentes', icon: 'bot', load, render, onClick, onChange, badge: () => '' });
})();
