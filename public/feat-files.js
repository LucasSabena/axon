/* Ports Manager — File manager tab (self-contained; wired by integrator) */
(() => {
  'use strict';

  if (document.getElementById('tab-files')) return; // already injected

  // ---------- Build the tab section at load ----------
  const sec = document.createElement('section');
  sec.id = 'tab-files';
  sec.className = 'tab-content';
  sec.innerHTML = `
    <div class="fm-top">
      <div class="section-header">
        <h2>Archivos</h2>
        <div class="section-actions">
          <input type="text" id="fm-filter" class="filter-input" placeholder="Filtrar…">
          <button id="fm-upload-btn" class="btn-secondary" title="Subir archivos">${icon('upload')} Subir</button>
          <button id="fm-upload-dir-btn" class="btn-secondary" title="Subir una carpeta completa">${icon('folder-up')} Carpeta</button>
          <button id="fm-mkdir-btn" class="btn-secondary">${icon('folder-plus')} Nueva carpeta</button>
          <button id="fm-refresh-btn" class="btn-secondary" title="Actualizar">${icon('refresh-cw')}</button>
        </div>
      </div>
      <div class="fm-breadcrumb" id="fm-breadcrumb"></div>
      <p class="listener-note fm-note">Archivos del servidor — lectura directa; las escrituras corren como tu usuario del host.</p>
    </div>
    <div class="fm-list" id="fm-list">
      <div class="table-wrapper fm-table-wrap">
        <table class="data-table" id="fm-table">
          <thead>
            <tr>
              <th class="fm-selcell"><input type="checkbox" id="fm-check-all" tabindex="-1" title="Seleccionar todo"></th>
              <th></th>
              <th>Nombre</th>
              <th>Tamaño</th>
              <th>Modificado</th>
              <th>Permisos</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="fm-tbody"></tbody>
        </table>
      </div>
      <div id="fm-state" class="empty-state hidden">Cargando…</div>
    </div>
    <div class="fm-editor hidden" id="fm-editor">
      <div class="fm-editor-bar">
        <span class="mono fm-editor-name" id="fm-editor-name"></span>
        <span class="fm-dirty-dot hidden" id="fm-dirty-dot" title="Cambios sin guardar">●</span>
        <span class="badge badge-other hidden" id="fm-editor-flag"></span>
        <div class="section-actions">
          <button id="fm-save-btn" class="btn-primary">${icon('save')} Guardar</button>
          <button id="fm-back-btn" class="btn-secondary">${icon('arrow-left')} Volver</button>
        </div>
      </div>
      <textarea id="fm-editor-text" class="mono" spellcheck="false" wrap="off"></textarea>
      <p class="listener-note">Ctrl/Cmd+S guarda · Esc vuelve a la lista</p>
    </div>
    <input type="file" id="fm-file-input" class="hidden" multiple>
    <input type="file" id="fm-dir-input" class="hidden" webkitdirectory>
    <div class="fm-selbar hidden" id="fm-selbar">
      <span id="fm-sel-count"></span>
      <button id="fm-sel-all" class="btn-secondary" title="Seleccionar todo">${icon('check-square')} Todos</button>
      <button id="fm-sel-dl" class="btn-secondary">${icon('download')} Descargar</button>
      <button id="fm-sel-del" class="btn-danger">${icon('trash-2')} Eliminar</button>
      <button id="fm-sel-clear" class="btn-secondary" title="Limpiar selección">${icon('x')}</button>
    </div>
    <div class="fm-upload-progress hidden" id="fm-upload-progress">
      <span id="fm-up-label"></span>
      <div class="fm-up-track"><div class="fm-up-bar" id="fm-up-bar"></div></div>
      <button id="fm-up-cancel" class="btn-secondary" title="Cancelar la subida">${icon('x')} Cancelar</button>
    </div>
    <div class="fm-drop-overlay" id="fm-drop-overlay">
      <div class="fm-drop-box">${icon('upload')}<span id="fm-drop-text"></span></div>
    </div>
  `;
  (document.querySelector('main.content') || document.body).appendChild(sec);
  refreshIcons();

  // ---------- State ----------
  const S = {
    cwd: '',
    home: '',
    entries: [],
    filter: '',
    editingPath: null,
    readOnly: false,
    originalContent: '',
    dragDepth: 0,
    sel: new Set(),   // multi-selection (names within cwd)
    anchor: null,     // last-clicked row name — shift+click range base
  };

  const el = (id) => sec.querySelector('#' + id);
  const join = (dir, name) => (dir.endsWith('/') ? dir + name : dir + '/' + name);
  const parentOf = (p) => {
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  };

  // ---------- Formatting ----------
  function fmtSize(n) {
    if (n == null || Number.isNaN(n)) return '—';
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n;
    let i = -1;
    do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
    return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
  }

  function fmtDate(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '—';
    const thisYear = new Date().getFullYear();
    const date = d.toLocaleDateString('es', {
      day: '2-digit',
      month: 'short',
      year: d.getFullYear() === thisYear ? undefined : 'numeric',
    });
    return `${date} ${d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`;
  }

  const CODE_EXT = new Set(
    'js jsx ts tsx mjs cjs json html htm css scss less py sh bash zsh rs go java c h cc cpp hpp rb php lua pl sql yml yaml toml xml vue svelte swift kt kts'.split(' ')
  );
  const TEXT_EXT = new Set(
    'txt md markdown log conf cfg ini env csv tsv properties gitignore editorconfig lock'.split(' ')
  );
  const IMG_EXT = new Set('png jpg jpeg gif svg webp ico bmp avif'.split(' '));
  const ARC_EXT = new Set('zip tar gz tgz bz2 xz 7z rar zst'.split(' '));

  function iconFor(e) {
    if (e.type === 'dir') return 'folder';
    if (e.type === 'link') return 'link';
    const ext = (e.name.split('.').pop() || '').toLowerCase();
    if (CODE_EXT.has(ext)) return 'file-code';
    if (TEXT_EXT.has(ext)) return 'file-text';
    if (IMG_EXT.has(ext)) return 'image';
    if (ARC_EXT.has(ext)) return 'archive';
    return 'file';
  }

  // ---------- Rendering ----------
  function setState(msg) {
    const st = el('fm-state');
    if (!msg) {
      st.classList.add('hidden');
    } else {
      st.textContent = msg;
      st.classList.remove('hidden');
    }
  }

  function showList() {
    el('fm-editor').classList.add('hidden');
    el('fm-list').classList.remove('hidden');
  }

  function renderCrumbs() {
    const parts = S.cwd.split('/').filter(Boolean);
    let html = `<button class="fm-crumb" data-p="${esc(S.home || '/')}">${icon('home')} Inicio</button>`;
    let acc = '';
    for (const seg of parts) {
      acc += '/' + seg;
      html += `<span class="fm-sep">/</span><button class="fm-crumb" data-p="${esc(acc)}">${esc(seg)}</button>`;
    }
    el('fm-breadcrumb').innerHTML = html;
    refreshIcons();
  }

  function rowHtml(e, isUp) {
    const ic = isUp ? icon('arrow-up') : icon(iconFor(e));
    const linkBadge = e.type === 'link' ? ' <span class="badge badge-other">link</span>' : '';
    const acts = isUp
      ? ''
      : `<div class="fm-acts">
          ${e.type !== 'dir' ? `<button class="fm-act" data-act="download" title="Descargar">${icon('download')}</button>` : ''}
          <button class="fm-act" data-act="rename" title="Renombrar">${icon('pencil')}</button>
          <button class="fm-act fm-act-danger" data-act="delete" title="Eliminar">${icon('trash-2')}</button>
        </div>`;
    const selected = !isUp && S.sel.has(e.name);
    return `<tr class="fm-row${isUp ? ' fm-up' : ''}${selected ? ' fm-selected' : ''}" data-name="${esc(e.name)}" data-type="${esc(e.type)}">
      <td class="fm-selcell">${isUp ? '' : `<input type="checkbox" class="fm-check" ${selected ? 'checked' : ''} tabindex="-1">`}</td>
      <td class="icon-cell">${ic}</td>
      <td class="fm-name">${esc(e.name)}${linkBadge}</td>
      <td class="num">${isUp || e.type === 'dir' ? '—' : fmtSize(e.size)}</td>
      <td class="fm-mtime">${isUp ? '' : fmtDate(e.mtime)}</td>
      <td class="mono fm-mode">${esc(e.mode || '')}</td>
      <td class="fm-actcell">${acts}</td>
    </tr>`;
  }

  function renderRows() {
    const q = S.filter.trim().toLowerCase();
    const rows = S.entries.filter((e) => !q || e.name.toLowerCase().includes(q));
    let html = '';
    // ".." stays client-side per spec; hidden when the parent would be "/"
    if (parentOf(S.cwd) !== '/') {
      html += rowHtml({ name: '..', type: 'dir', size: null, mtime: 0, mode: '' }, true);
    }
    html += rows.map((e) => rowHtml(e, false)).join('');
    el('fm-tbody').innerHTML = html;
    setState(rows.length || html ? '' : 'Carpeta vacía');
    refreshIcons();
  }

  // ---------- Navigation ----------
  async function navigate(p) {
    S.sel.clear();
    S.anchor = null;
    showList();
    setState('Cargando…');
    try {
      const q = p ? `?path=${encodeURIComponent(p)}` : '';
      const data = await api(`/api/files${q}`);
      S.cwd = data.path;
      if (!S.home && data.home) S.home = data.home;
      S.entries = data.entries || [];
      renderCrumbs();
      renderRows();
    } catch (err) {
      setState('No se pudo cargar el directorio');
      errToast(err);
    }
  }

  function loadFiles() {
    // Runs every time the tab opens — refresh the current dir, or home first time.
    navigate(S.cwd || undefined);
  }
  loaders.files = loadFiles;

  // ---------- Editor ----------
  async function openEditor(p) {
    try {
      const data = await api(`/api/files/read?path=${encodeURIComponent(p)}`);
      S.editingPath = data.path;
      const binary = String(data.content || '').includes('\u0000');
      S.readOnly = Boolean(data.truncated) || binary;

      el('fm-editor-name').textContent = data.path;
      el('fm-editor-text').value = data.content || '';
      S.originalContent = data.content || '';
      el('fm-editor-text').readOnly = S.readOnly;
      el('fm-save-btn').disabled = S.readOnly;
      updateDirty();

      const flag = el('fm-editor-flag');
      if (data.truncated) {
        flag.textContent = 'Truncado (>512KB) — solo lectura';
        flag.classList.remove('hidden');
      } else if (binary) {
        flag.textContent = 'Binario — solo lectura';
        flag.classList.remove('hidden');
      } else {
        flag.classList.add('hidden');
      }

      el('fm-list').classList.add('hidden');
      el('fm-editor').classList.remove('hidden');
      el('fm-editor-text').focus();
    } catch (err) {
      errToast(err);
    }
  }

  function closeEditor(refresh) {
    S.editingPath = null;
    S.readOnly = false;
    S.originalContent = '';
    updateDirty();
    el('fm-editor').classList.add('hidden');
    el('fm-list').classList.remove('hidden');
    if (refresh) navigate(S.cwd);
  }

  // ---------- Dirty tracking ----------
  const isDirty = () =>
    Boolean(S.editingPath) && !S.readOnly && el('fm-editor-text').value !== S.originalContent;

  function updateDirty() {
    el('fm-dirty-dot').classList.toggle('hidden', !isDirty());
  }

  el('fm-editor-text').addEventListener('input', updateDirty);

  async function confirmCloseEditor() {
    if (isDirty()) {
      const msg = 'Cambios sin guardar — ¿salir?';
      const ok =
        typeof confirmDialog === 'function'
          ? await confirmDialog('Salir del editor', msg, 'Salir')
          : await fmConfirm(msg);
      if (!ok) return;
    }
    closeEditor(true);
  }

  // Small inline confirm used only if app.js's confirmDialog is missing.
  function fmConfirm(message) {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'modal fm-confirm-modal';
      m.innerHTML = `
        <div class="modal-content">
          <h3>Salir del editor</h3>
          <p class="fm-confirm-msg"></p>
          <div class="modal-actions">
            <button class="btn-secondary fm-c-cancel">Cancelar</button>
            <button class="btn-primary fm-c-ok">Salir</button>
          </div>
        </div>`;
      m.querySelector('.fm-confirm-msg').textContent = message;
      const done = (v) => {
        document.removeEventListener('keydown', onKey);
        m.remove();
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') done(false);
      };
      document.addEventListener('keydown', onKey);
      m.querySelector('.fm-c-ok').addEventListener('click', () => done(true));
      m.querySelector('.fm-c-cancel').addEventListener('click', () => done(false));
      m.addEventListener('click', (e) => {
        if (e.target === m) done(false);
      });
      document.body.appendChild(m);
    });
  }

  // ---------- Save (with diff preview) ----------
  async function doSave(content) {
    try {
      await api('/api/files/write', {
        method: 'POST',
        body: { path: S.editingPath, content },
      });
      S.originalContent = content;
      updateDirty();
      toast(`Guardado: ${S.editingPath.split('/').pop()}`, 'ok', '', 3000);
      return true;
    } catch (err) {
      errToast(err);
      return false;
    }
  }

  // Line-level LCS diff: rows of {t:'same'|'del'|'add', s:<line>}.
  // Returns null when the file is too big — use diffFallback instead.
  function diffLines(a, b) {
    const A = a.split('\n');
    const B = b.split('\n');
    const n = A.length;
    const m = B.length;
    if (n + m > 4000) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const rows = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) {
        rows.push({ t: 'same', s: A[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        rows.push({ t: 'del', s: A[i] });
        i++;
      } else {
        rows.push({ t: 'add', s: B[j] });
        j++;
      }
    }
    while (i < n) rows.push({ t: 'del', s: A[i++] });
    while (j < m) rows.push({ t: 'add', s: B[j++] });
    return rows;
  }

  // Cheap fallback for huge files: pairwise line compare (changed lines only).
  function diffFallback(a, b) {
    const A = a.split('\n');
    const B = b.split('\n');
    const rows = [];
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      if (i < A.length && i < B.length && A[i] === B[i]) {
        rows.push({ t: 'same', s: A[i] });
      } else {
        if (i < A.length) rows.push({ t: 'del', s: A[i] });
        if (i < B.length) rows.push({ t: 'add', s: B[i] });
      }
    }
    return rows;
  }

  function diffLineEl(r) {
    const d = document.createElement('div');
    d.className = `fm-diff-line ${r.t}`;
    const sign = r.t === 'add' ? '+' : r.t === 'del' ? '-' : ' ';
    d.textContent = `${sign} ${r.s}`;
    return d;
  }

  function renderDiffRows(container, rows) {
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < rows.length) {
      if (rows[i].t !== 'same') {
        frag.appendChild(diffLineEl(rows[i]));
        i++;
        continue;
      }
      let j = i;
      while (j < rows.length && rows[j].t === 'same') j++;
      const run = rows.slice(i, j);
      if (run.length > 6) {
        const gap = document.createElement('div');
        gap.className = 'fm-diff-gap';
        gap.textContent = `⋯ ${run.length} líneas sin cambios`;
        const box = document.createElement('div');
        box.className = 'fm-diff-gap-lines hidden';
        for (const r of run) box.appendChild(diffLineEl(r));
        gap.addEventListener('click', () => {
          box.classList.remove('hidden');
          gap.classList.add('hidden');
        });
        frag.append(gap, box);
      } else {
        for (const r of run) frag.appendChild(diffLineEl(r));
      }
      i = j;
    }
    container.appendChild(frag);
  }

  function openDiffModal(newVal) {
    const rows = diffLines(S.originalContent, newVal) || diffFallback(S.originalContent, newVal);
    const adds = rows.reduce((k, r) => k + (r.t === 'add' ? 1 : 0), 0);
    const dels = rows.reduce((k, r) => k + (r.t === 'del' ? 1 : 0), 0);
    const modal = document.createElement('div');
    modal.className = 'modal fm-diff-modal';
    modal.innerHTML = `
      <div class="fm-diff-content">
        <div class="fm-diff-header">
          <span class="mono fm-diff-path"></span>
          <span class="fm-diff-stats"></span>
        </div>
        <div class="fm-diff-body mono"></div>
        <div class="modal-actions">
          <button class="btn-secondary fm-diff-cancel">Cancelar</button>
          <button class="btn-primary fm-diff-save">${icon('save')} Guardar</button>
        </div>
      </div>`;
    modal.querySelector('.fm-diff-path').textContent = S.editingPath;
    modal.querySelector('.fm-diff-stats').textContent = `· +${adds} −${dels} líneas`;
    renderDiffRows(modal.querySelector('.fm-diff-body'), rows);
    modal.querySelector('.fm-diff-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('.fm-diff-save').addEventListener('click', async () => {
      if (await doSave(newVal)) modal.remove();
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
    refreshIcons();
  }

  el('fm-save-btn').addEventListener('click', () => {
    if (!S.editingPath || S.readOnly) return;
    const newVal = el('fm-editor-text').value;
    if (newVal === S.originalContent) {
      toast('Sin cambios', 'ok', '', 2500);
      return;
    }
    openDiffModal(newVal);
  });

  el('fm-back-btn').addEventListener('click', () => confirmCloseEditor());

  el('fm-editor-text').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      el('fm-save-btn').click();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Modals handle their own Escape (or block the editor close while open).
    if (document.querySelector('.fm-confirm-modal')) return;
    const cm = document.getElementById('confirm-modal');
    if (cm && !cm.classList.contains('hidden')) return;
    const dm = document.querySelector('.fm-diff-modal');
    if (dm) {
      dm.remove();
      return;
    }
    if (S.editingPath && sec.classList.contains('active')) {
      confirmCloseEditor();
    }
  });

  // ---------- Row actions ----------
  function download(p, name) {
    const a = document.createElement('a');
    a.href = `/api/files/download?path=${encodeURIComponent(p)}`;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function doAction(act, name, type) {
    const p = join(S.cwd, name);
    if (act === 'download') {
      download(p, name);
    } else if (act === 'rename') {
      const nn = await fmPrompt('Renombrar', `Nuevo nombre para «${name}»`, name);
      if (!nn || nn === name) return;
      if (nn.includes('/') || nn === '.' || nn === '..') {
        toast('Nombre inválido — sin "/", "." ni ".."', 'error');
        return;
      }
      try {
        await api('/api/files/rename', { method: 'POST', body: { from: p, to: join(S.cwd, nn) } });
        toast('Renombrado', 'ok', '', 2500);
        navigate(S.cwd);
      } catch (err) {
        errToast(err);
      }
    } else if (act === 'delete') {
      const ok = await confirmDialog(
        `Eliminar ${name}`,
        `Se borra permanentemente ${p}${type === 'dir' ? ' y todo su contenido' : ''}.`
      );
      if (!ok) return;
      try {
        await api('/api/files/delete', { method: 'POST', body: { path: p, confirm: true } });
        toast('Eliminado', 'ok', '', 2500);
        navigate(S.cwd);
      } catch (err) {
        errToast(err);
      }
    }
  }

  // ---------- Multi-selection ----------
  function updateSelbar() {
    const bar = el('fm-selbar');
    const n = S.sel.size;
    bar.classList.toggle('hidden', n === 0);
    el('fm-sel-count').textContent = `${n} seleccionado${n === 1 ? '' : 's'}`;
    const checkAll = el('fm-check-all');
    if (checkAll) {
      const total = S.entries.length;
      checkAll.checked = n > 0 && n === total;
      checkAll.indeterminate = n > 0 && n < total;
    }
  }

  function applySelToDom() {
    el('fm-tbody').querySelectorAll('tr.fm-row').forEach((tr) => {
      const on = S.sel.has(tr.dataset.name);
      tr.classList.toggle('fm-selected', on);
      const cb = tr.querySelector('.fm-check');
      if (cb) cb.checked = on;
    });
    updateSelbar();
  }

  function toggleSel(name, on) {
    if (on === undefined) on = !S.sel.has(name);
    if (on) S.sel.add(name);
    else S.sel.delete(name);
    applySelToDom();
  }

  function clearSel() {
    if (!S.sel.size) return;
    S.sel.clear();
    S.anchor = null;
    applySelToDom();
  }

  // Visible (filtered) row names in display order — for shift-range selects.
  function visibleNames() {
    const q = S.filter.trim().toLowerCase();
    return S.entries.filter((e) => !q || e.name.toLowerCase().includes(q)).map((e) => e.name);
  }

  function rangeSelect(name) {
    const names = visibleNames();
    const a = names.indexOf(S.anchor);
    const b = names.indexOf(name);
    if (a === -1 || b === -1) {
      toggleSel(name, true);
      return;
    }
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) S.sel.add(names[i]);
    applySelToDom();
  }

  el('fm-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr.fm-row');
    const actBtn = e.target.closest('.fm-act');
    if (actBtn && tr) {
      e.stopPropagation();
      doAction(actBtn.dataset.act, tr.dataset.name, tr.dataset.type);
      return;
    }
    const check = e.target.closest('.fm-check');
    if (check && tr) {
      e.stopPropagation();
      S.anchor = tr.dataset.name;
      toggleSel(tr.dataset.name);
      return;
    }
    if (!tr) return;
    const { name, type } = tr.dataset;
    if (name === '..') return navigate(parentOf(S.cwd));
    // Selection modifiers — plain clicks keep their old behavior.
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      S.anchor = name;
      toggleSel(name);
      return;
    }
    if (e.shiftKey && S.sel.size) {
      e.preventDefault();
      rangeSelect(name);
      return;
    }
    if (S.sel.size) clearSel();
    if (type === 'dir') return navigate(join(S.cwd, name));
    openEditor(join(S.cwd, name));
  });

  // Right-click context menu (reuses app.js's showCtxMenu when available)
  el('fm-table').addEventListener('contextmenu', (e) => {
    const tr = e.target.closest('tr.fm-row');
    if (!tr || tr.classList.contains('fm-up')) return;
    if (typeof showCtxMenu !== 'function') return;
    e.preventDefault();
    const { name, type } = tr.dataset;
    const p = join(S.cwd, name);
    const items = [];
    if (type === 'dir' && typeof openTermCmd === 'function') {
      items.push({ icon: 'terminal', label: 'Terminal en esta carpeta', run: () => openTermCmd(`cd '${p.replace(/'/g, `'\\''`)}'`) });
    }
    if (type !== 'dir') {
      items.push(
        { icon: 'pencil', label: 'Editar', run: () => openEditor(p) },
        { icon: 'download', label: 'Descargar', run: () => download(p, name) }
      );
    }
    items.push(
      { icon: 'pencil', label: 'Renombrar', run: () => doAction('rename', name, type) },
      { sep: true },
      { icon: 'trash-2', label: 'Eliminar', danger: true, run: () => doAction('delete', name, type) }
    );
    showCtxMenu(items, e.clientX, e.clientY);
  });

  el('fm-breadcrumb').addEventListener('click', (e) => {
    const b = e.target.closest('.fm-crumb');
    if (b) navigate(b.dataset.p);
  });

  // Header checkbox → select everything visible
  el('fm-check-all').addEventListener('change', (e) => {
    if (e.target.checked) {
      for (const n of visibleNames()) S.sel.add(n);
    } else {
      S.sel.clear();
    }
    S.anchor = null;
    applySelToDom();
  });

  // ---------- Selection bar actions ----------
  el('fm-sel-clear').addEventListener('click', clearSel);
  el('fm-sel-all').addEventListener('click', () => {
    for (const n of visibleNames()) S.sel.add(n);
    applySelToDom();
  });
  el('fm-sel-dl').addEventListener('click', () => {
    let i = 0;
    for (const name of S.sel) {
      const entry = S.entries.find((e) => e.name === name);
      if (!entry || entry.type === 'dir') continue;
      // Stagger so the browser doesn't drop queued downloads.
      const p = join(S.cwd, name);
      setTimeout(() => download(p, name), i++ * 350);
    }
    toast(`Descargando ${i} archivo${i === 1 ? '' : 's'}…`, 'ok', '', 2500);
  });
  el('fm-sel-del').addEventListener('click', async () => {
    const names = [...S.sel];
    if (!names.length) return;
    const preview = names.slice(0, 6).join(', ') + (names.length > 6 ? ` y ${names.length - 6} más` : '');
    const ok = await confirmDialog(
      `Eliminar ${names.length} elemento${names.length === 1 ? '' : 's'}`,
      `Se borran permanentemente: ${preview}`
    );
    if (!ok) return;
    const failed = [];
    for (const name of names) {
      try {
        await api('/api/files/delete', { method: 'POST', body: { path: join(S.cwd, name), confirm: true } });
      } catch (err) {
        failed.push(`${name}: ${err.message}`);
      }
    }
    if (failed.length) toast(`Error al eliminar ${failed.length}`, 'error', failed.join('\n'));
    else toast(`${names.length} eliminado${names.length === 1 ? '' : 's'}`, 'ok', '', 3000);
    navigate(S.cwd);
  });

  // ---------- Marquee (rubber-band) selection ----------
  // Mousedown on empty list space starts a drag-rect; rows it covers get
  // selected. Rows/buttons/links stay clickable — only the gaps trigger it.
  const listEl = el('fm-list');
  let marquee = null; // {x0,y0,div,moved}

  listEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target.closest('tr.fm-row, button, a, input, textarea, select, .fm-crumb')) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const div = document.createElement('div');
    div.className = 'fm-marquee';
    div.style.display = 'none';
    document.body.appendChild(div);
    marquee = { x0: startX, y0: startY, div, moved: false };
    e.preventDefault(); // no text selection while dragging
  });

  document.addEventListener('mousemove', (e) => {
    if (!marquee) return;
    const dx = Math.abs(e.clientX - marquee.x0);
    const dy = Math.abs(e.clientY - marquee.y0);
    if (!marquee.moved && dx < 4 && dy < 4) return; // plain clicks pass through
    if (!marquee.moved) {
      marquee.moved = true;
      marquee.div.style.display = 'block';
      document.body.classList.add('fm-marqueeing');
    }
    const r = {
      left: Math.min(marquee.x0, e.clientX),
      right: Math.max(marquee.x0, e.clientX),
      top: Math.min(marquee.y0, e.clientY),
      bottom: Math.max(marquee.y0, e.clientY),
    };
    Object.assign(marquee.div.style, {
      left: r.left + 'px', top: r.top + 'px',
      width: r.right - r.left + 'px', height: r.bottom - r.top + 'px',
    });
    // Live-select rows whose rect intersects the marquee (additive only —
    // dragging back over a row doesn't deselect, matching file managers).
    el('fm-tbody').querySelectorAll('tr.fm-row:not(.fm-up)').forEach((tr) => {
      const b = tr.getBoundingClientRect();
      const hit = b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
      if (hit) S.sel.add(tr.dataset.name);
      tr.classList.toggle('fm-selected', S.sel.has(tr.dataset.name));
      const cb = tr.querySelector('.fm-check');
      if (cb) cb.checked = S.sel.has(tr.dataset.name);
    });
    updateSelbar();
  });

  document.addEventListener('mouseup', () => {
    if (!marquee) return;
    const moved = marquee.moved;
    marquee.div.remove();
    marquee = null;
    document.body.classList.remove('fm-marqueeing');
    if (!moved) clearSel(); // click on empty space clears the selection
  });

  // Esc clears the selection; Ctrl/Cmd+A selects all (files tab only).
  document.addEventListener('keydown', (e) => {
    if (!sec.classList.contains('active') || S.editingPath) return;
    if (document.querySelector('.modal:not(.hidden)')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'Escape' && S.sel.size) {
      clearSel();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      for (const n of visibleNames()) S.sel.add(n);
      applySelToDom();
    }
  });

  // ---------- Custom prompt modal (mkdir / rename) ----------
  function fmPrompt(title, label, value = '') {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'modal fm-prompt-modal';
      m.innerHTML = `
        <div class="modal-content">
          <h3></h3>
          <label class="fm-prompt-label"><span></span>
            <input type="text" class="fm-prompt-input" maxlength="255" autocomplete="off" spellcheck="false">
          </label>
          <div class="modal-actions">
            <button class="btn-secondary fm-p-cancel">Cancelar</button>
            <button class="btn-primary fm-p-ok">Aceptar</button>
          </div>
        </div>`;
      m.querySelector('h3').textContent = title;
      m.querySelector('.fm-prompt-label span').textContent = label;
      const input = m.querySelector('.fm-prompt-input');
      input.value = value;
      const done = (v) => {
        document.removeEventListener('keydown', onKey, true);
        m.remove();
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); done(null); }
        if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim() || null); }
      };
      document.addEventListener('keydown', onKey, true);
      m.querySelector('.fm-p-ok').addEventListener('click', () => done(input.value.trim() || null));
      m.querySelector('.fm-p-cancel').addEventListener('click', () => done(null));
      m.addEventListener('click', (e) => { if (e.target === m) done(null); });
      document.body.appendChild(m);
      input.focus();
      input.select();
    });
  }

  // ---------- Toolbar ----------
  el('fm-refresh-btn').addEventListener('click', () => navigate(S.cwd || undefined));

  el('fm-filter').addEventListener('input', (e) => {
    S.filter = e.target.value;
    renderRows();
  });

  el('fm-mkdir-btn').addEventListener('click', async () => {
    const name = await fmPrompt('Nueva carpeta', 'Nombre');
    if (!name) return;
    if (name.includes('/') || name === '.' || name === '..') {
      toast('Nombre inválido — sin "/", "." ni ".."', 'error');
      return;
    }
    try {
      await api('/api/files/mkdir', { method: 'POST', body: { path: join(S.cwd, name) } });
      toast('Carpeta creada', 'ok', '', 2500);
      navigate(S.cwd);
    } catch (err) {
      errToast(err);
    }
  });

  el('fm-upload-btn').addEventListener('click', () => el('fm-file-input').click());
  el('fm-upload-dir-btn').addEventListener('click', () => el('fm-dir-input').click());

  // ---------- Upload (shared by file pickers and drag & drop) ----------
  let uploadAbort = null;
  el('fm-up-cancel').addEventListener('click', () => uploadAbort && uploadAbort.abort());

  function setUploadBar(done, total, label) {
    const wrap = el('fm-upload-progress');
    wrap.classList.remove('hidden');
    el('fm-up-label').textContent = label;
    el('fm-up-bar').style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  }

  async function uploadFiles(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    const total = list.length;
    uploadAbort = new AbortController();
    el('fm-up-cancel').disabled = false;
    setUploadBar(0, total, `Subiendo 0/${total}…`);
    const failed = [];
    let okCount = 0;
    for (const f of list) {
      if (uploadAbort.signal.aborted) break;
      // Folder uploads carry webkitRelativePath ("dir/sub/file"); drops of
      // folders carry _relPath stamped by collectDropped(). Plain files: name.
      const rel = (f.webkitRelativePath || f._relPath || f.name || 'archivo').replace(/^\/+/, '');
      try {
        const fd = new FormData();
        fd.append('rel', rel);
        fd.append('file', f, rel.split('/').pop() || 'archivo');
        const res = await fetch(`/api/files/upload?path=${encodeURIComponent(S.cwd)}`, {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
          signal: uploadAbort.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          const err = new Error(data.error || `HTTP ${res.status}`);
          err.detail = data.detail;
          err.status = res.status;
          throw err;
        }
        okCount++;
      } catch (err) {
        if (uploadAbort.signal.aborted) break;
        // Per-file errors (incl. 413 for >64MB) go into one batch toast.
        const why =
          err.status === 413 ? 'El archivo supera el límite de 64 MB' : err.message || 'Error';
        failed.push(`${rel}: ${why}`);
      }
      setUploadBar(okCount + failed.length, total, `Subiendo ${okCount + failed.length}/${total}…`);
    }
    const aborted = uploadAbort.signal.aborted;
    uploadAbort = null;
    el('fm-upload-progress').classList.add('hidden');
    if (aborted) {
      toast(`Subida cancelada — ${okCount} ok, ${total - okCount - failed.length} pendientes`, 'warn', '', 4000);
    } else if (failed.length) {
      toast(`Error al subir ${failed.length} archivo${failed.length === 1 ? '' : 's'}`, 'error', failed.slice(0, 6).join('\n'));
    }
    if (okCount) toast(`${okCount} subido${okCount === 1 ? '' : 's'}`, 'ok', '', 3000);
    navigate(S.cwd);
  }

  el('fm-file-input').addEventListener('change', (e) => {
    // Clone before resetting — FileList is a live view of the input and
    // clearing .value empties it (this was the "upload does nothing" bug).
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    uploadFiles(files);
  });
  el('fm-dir-input').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    uploadFiles(files);
  });

  // Expand dropped folders: Chrome exposes them via webkitGetAsEntry; each
  // nested file gets _relPath stamped ("folder/sub/x.png") for the `rel` field.
  async function collectDropped(dt) {
    const items = Array.from(dt.items || []);
    const out = [];
    const readAll = (reader) =>
      new Promise((res) => {
        const acc = [];
        const step = () =>
          reader.readEntries((batch) => {
            if (!batch.length) return res(acc);
            acc.push(...batch);
            step(); // readEntries returns batches — loop until empty
          });
        step();
      });
    const walk = async (entry, prefix) => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        file._relPath = (prefix + entry.name).replace(/^\/+/, '');
        out.push(file);
      } else if (entry.isDirectory) {
        const subs = await readAll(entry.createReader());
        for (const sub of subs) await walk(sub, prefix + entry.name + '/');
      }
    };
    const pending = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry) pending.push(walk(entry, ''));
      else {
        const f = item.getAsFile && item.getAsFile();
        if (f) out.push(f);
      }
    }
    await Promise.all(pending);
    // Fallback for browsers without the entries API.
    if (!out.length) out.push(...Array.from(dt.files || []));
    return out;
  }

  // ---------- Drag & drop upload ----------
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

  function setDragOver(on) {
    sec.classList.toggle('fm-dragover', on);
    if (on) el('fm-drop-text').textContent = `Soltá para subir a ${S.cwd || '/'}`;
  }

  sec.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    S.dragDepth++;
    setDragOver(true);
  });

  sec.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // required so the drop fires
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  });

  sec.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    S.dragDepth = Math.max(0, S.dragDepth - 1);
    // Hide when the counter bottoms out or the pointer left the section
    // entirely (relatedTarget = element now under the cursor, null if outside).
    if (S.dragDepth === 0 || !sec.contains(e.relatedTarget)) {
      S.dragDepth = 0;
      setDragOver(false);
    }
  });

  sec.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    S.dragDepth = 0;
    setDragOver(false);
    try {
      const files = await collectDropped(e.dataTransfer);
      uploadFiles(files);
    } catch {
      uploadFiles(e.dataTransfer.files);
    }
  });
})();
