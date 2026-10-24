/* AXON — Bots · Cuentas web: sesiones del navegador que usan los agentes de OpenBot (cookies). */
(() => {
  'use strict';
  const REG = (window.AxonBots ||= { tabs: [] });
  const STATE = { active: ['ok', 'Activa'], expiring: ['warn', 'Por vencer'], expired: ['danger', 'Vencida'] };
  let data = null, error = null, backups = [], text = '', preview = null, previewing = false, fileName = '', fileSize = 0;
  const MAX_FILE = 7 * 1024 * 1024;
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const day = (t) => (t ? new Date(t * 1000).toLocaleDateString('es-AR') : '—');

  async function load() {
    try { data = await api('/api/openbot/web/accounts', { timeoutMs: 60000 }); error = null; } catch (e) { data = null; error = e.message || 'No se pudo leer'; }
    try { backups = (await api('/api/openbot/web/backups')).backups || []; } catch { backups = []; }
  }
  function accounts() {
    const rows = data.accounts.map((a) => {
      const st = STATE[a.state] || STATE.active;
      return `<tr><td><strong>${esc(a.name)}</strong>${a.known ? '' : ' <span class="badge bots-badge">otro sitio</span>'}<small class="bots-sub">${esc(a.domains.slice(0, 4).join(', '))}${a.domains.length > 4 ? ` y ${a.domains.length - 4} más` : ''}</small></td>
        <td><span class="badge bots-badge is-${st[0]}">${st[1]}</span></td><td class="num">${esc(String(a.cookies))}</td><td>${esc(day(a.expires))}</td>
        <td class="num"><button class="btn-secondary" data-web-remove="${esc(a.id)}" data-name="${esc(a.name)}">Quitar</button></td></tr>`;
    }).join('');
    return `<article class="bots-card bots-wide"><header><h3>Cuentas guardadas</h3><small>${data.accounts.length} sitios · ${esc(String(data.totalCookies))} cookies</small></header>
      ${rows ? `<div class="bots-tablewrap"><table class="bots-table"><thead><tr><th>Sitio</th><th>Estado</th><th class="num">Cookies</th><th>Vence</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="bots-dim">Todavía no hay sesiones guardadas en el navegador de los agentes.</p>'}
      <p class="bots-hint">Son las sesiones que ya iniciaron los agentes en su navegador integrado. Se guardan en el servidor y sobreviven a reinicios y actualizaciones. Acá no se ven contraseñas ni valores: solo qué sitios hay y cuándo vencen.</p></article>`;
  }
  function services() {
    const chips = data.catalog.map((s) => `<a class="bots-svc ${s.connected ? 'is-on' : ''}" href="${esc(s.login)}" target="_blank" rel="noopener noreferrer" title="${s.connected ? 'Conectado' : 'Sin sesión en el navegador de OpenBot'}">${icon(s.connected ? 'circle-check' : 'circle')}<span>${esc(s.name)}</span></a>`).join('');
    return `<article class="bots-card bots-wide"><header><h3>Servicios típicos</h3></header><div class="bots-svcs">${chips}</div>
      <p class="bots-hint"><strong>Cómo conectar uno:</strong> abrí la app de OpenBot, entrá al agente, abrí su navegador e iniciá sesión en el sitio (queda guardada). O bien importá las cookies desde tu navegador usando el recuadro de abajo. Los enlaces abren el sitio en este navegador, solo como atajo.</p></article>`;
  }
  function importer(busy) {
    const prev = preview ? `<div class="bots-preview"><strong>${esc(String(preview.count))} cookies listas</strong>${preview.domains.length ? `<ul>${preview.domains.slice(0, 8).map((d) => `<li>${esc(d.service || d.domain)} <span class="bots-dim">${esc(d.domain)} · ${esc(String(d.n))}</span></li>`).join('')}${preview.domains.length > 8 ? `<li class="bots-dim">y ${preview.domains.length - 8} dominios más</li>` : ''}</ul>` : ''}
      ${preview.sessionToPersistent ? `<p class="bots-dim">${esc(String(preview.sessionToPersistent))} cookie(s) de sesión se guardan por 30 días.</p>` : ''}
      ${preview.skipped.length ? `<p class="bots-warn">Se omiten ${preview.skipped.length}: ${esc(preview.skipped.slice(0, 3).join(' · '))}</p>` : ''}</div>` : '';
    const source = fileName
      ? `<div class="bots-file"><span>${icon('file-text')}<strong>${esc(fileName)}</strong> <span class="bots-dim">${esc(size(fileSize))}</span></span><button type="button" class="btn-secondary" data-web-clear>Quitar archivo</button></div>`
      : `<div class="bots-actions"><label class="btn-secondary bots-filebtn">${icon('upload')} Elegir archivo<input type="file" data-web-file accept=".json,.txt,.csv,application/json,text/plain" hidden></label><span class="bots-dim">.json o cookies.txt, hasta 7 MB</span></div>
         <label>…o pegá el texto<textarea class="filter-input bots-textarea" name="text" rows="5" maxlength="290000" spellcheck="false" autocomplete="off" placeholder='[{"name":"…","value":"…","domain":".sitio.com", …}]'>${esc(text)}</textarea></label>`;
    return `<article class="bots-card bots-wide"><header><h3>Importar cookies</h3></header>
      <p class="bots-hint">Subí o pegá las cookies exportadas de tu navegador (JSON de Cookie-Editor, <code>cookies.txt</code> de Netscape o <code>storageState</code> de Playwright). Se aplican al navegador de los agentes: es como entrar a esos sitios con tu sesión. <strong>OpenBot se detiene 1–2 minutos</strong> y se hace un respaldo antes. Funciona con archivos grandes (miles de cookies).</p>
      <form class="bots-form" data-form="web-import">${source}
        ${prev}
        <div class="bots-actions"><button type="button" class="btn-secondary" data-web-preview ${busy || previewing ? 'disabled' : ''}>${previewing ? 'Analizando…' : 'Analizar'}</button>
          <button class="btn-primary" ${busy || !preview || !preview.count ? 'disabled' : ''}>Importar</button></div></form></article>
      <article class="bots-card bots-wide"><header><h3>Cómo llevar tu navegador principal</h3></header>
        <ol class="bots-steps">
          <li><strong>Cookies (sesiones):</strong> en tu navegador instalá una extensión que exporte <em>todas</em> las cookies, por ejemplo <strong>Get cookies.txt LOCALLY</strong> (botón “Export All Cookies”) o <strong>Cookie-Editor</strong> (sitio por sitio, formato JSON). Subí el archivo acá arriba.</li>
          <li><strong>Contraseñas:</strong> el navegador de OpenBot no tiene gestor de contraseñas, así que un archivo de contraseñas no se puede cargar ahí. Con las cookies alcanza para entrar sin loguearse. Si querés que los agentes usen contraseñas, la app de OpenBot trae conectores de <strong>Bitwarden</strong> y <strong>1Password</strong>: conectás una bóveda desde la app.</li>
          <li><strong>Con cuidado:</strong> una cookie de sesión equivale a estar logueado. Cargá solo los sitios que querés que usen los agentes; evitá banco y correo principal salvo que lo necesites. Podés quitar cualquier cuenta después desde esta pestaña.</li>
        </ol></article>`;
  }
  function extras() {
    const tabs = data.tabs.length ? `<article class="bots-card"><header><h3>Pestañas abiertas</h3></header><ul class="bots-list">${data.tabs.slice(0, 12).map((t) => `<li>${esc(t.host)}<span class="bots-dim">${esc(t.path)}</span></li>`).join('')}</ul></article>` : '';
    const bk = backups.length ? `<article class="bots-card"><header><h3>Respaldos de cookies</h3></header><ul class="bots-list">${backups.slice(0, 6).map((b) => `<li>${esc(b.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2}).*/, '$3/$2/$1 $4:$5 UTC'))}<button class="btn-secondary" data-web-restore="${esc(b)}">Restaurar</button></li>`).join('')}</ul><p class="bots-hint">Se guarda uno antes de cada importación o borrado.</p></article>` : '';
    return tabs || bk ? `<div class="bots-grid">${tabs}${bk}</div>` : '';
  }
  function render({ busy }) {
    if (!data) return `<article class="bots-card bots-wide"><header><h3>Cuentas web</h3></header><p class="bots-note is-warn">${esc(error || 'Sin datos')}</p><div class="bots-actions"><button class="btn-secondary" data-act="web-reload">Reintentar</button></div></article>`;
    return `<div class="bots-grid">${accounts()}${services()}${importer(busy)}</div>${extras()}`;
  }
  async function onClick(ev) {
    const t = ev.target.closest('button'); if (!t) return false;
    if (t.matches('[data-act="web-reload"]')) { await REG.guarded(load); return true; }
    if (t.matches('[data-web-clear]')) { text = ''; fileName = ''; fileSize = 0; preview = null; REG.repaint(); return true; }
    if (t.matches('[data-web-preview]')) {
      if (!fileName) text = $('#tab-bots textarea[name=text]')?.value || ''; previewing = true; REG.repaint();
      try { preview = await api('/api/openbot/web/preview', { method: 'POST', body: { text } }); } catch (e) { preview = null; errToast(e); }
      previewing = false; REG.repaint(); return true;
    }
    if (t.dataset.webRemove) {
      if (!(await confirmDialog(`Quitar ${t.dataset.name}`, 'Se borran sus cookies del navegador de los agentes: tendrán que volver a iniciar sesión ahí. OpenBot se detiene 1–2 minutos y se hace un respaldo antes.', 'Quitar'))) return true;
      await REG.guarded(async () => { const r = await api('/api/openbot/web/remove', { method: 'POST', body: { account: t.dataset.webRemove, confirm: true } }); REG.trackJob(r.job); });
      return true;
    }
    if (t.dataset.webRestore) {
      if (!(await confirmDialog('Restaurar cookies', 'Se reemplaza la base de cookies por ese respaldo. Lo posterior a esa fecha se pierde. OpenBot se detiene 1–2 minutos.', 'Restaurar'))) return true;
      await REG.guarded(async () => { const r = await api('/api/openbot/web/restore', { method: 'POST', body: { stamp: t.dataset.webRestore, confirm: true } }); REG.trackJob(r.job); });
      return true;
    }
    return false;
  }
  async function runPreview() {
    previewing = true; REG.repaint();
    try { preview = await api('/api/openbot/web/preview', { method: 'POST', body: { text }, timeoutMs: 60000 }); } catch (e) { preview = null; errToast(e); }
    previewing = false; REG.repaint();
  }
  async function onChange(ev) {
    const input = ev.target.closest('[data-web-file]'); const file = input?.files?.[0]; if (!file) return;
    if (file.size > MAX_FILE) { toast(`El archivo pesa ${size(file.size)}; el máximo es 7 MB`, 'error'); input.value = ''; return; }
    try { text = await file.text(); } catch { toast('No se pudo leer el archivo', 'error'); return; }
    fileName = file.name; fileSize = file.size; preview = null; await runPreview();
  }
  async function onSubmit(kind, form, el) {
    if (kind !== 'web-import') return;
    if (!fileName) text = String(form.text || '');
    if (!preview) { toast('Primero tocá Analizar', 'error'); return; }
    if (!(await confirmDialog('Importar cookies', `Se aplican ${preview.count} cookies al navegador de los agentes. OpenBot se detiene 1–2 minutos y se hace un respaldo antes.`, 'Importar'))) return;
    await REG.guarded(async () => {
      const r = await api('/api/openbot/web/import', { method: 'POST', body: { text, confirm: true } });
      text = ''; fileName = ''; fileSize = 0; preview = null; el.reset(); REG.trackJob(r.job);
    });
  }
  REG.tabs.push({ id: 'web', label: 'Cuentas web', icon: 'globe', load, render, onClick, onSubmit, onChange });
})();
