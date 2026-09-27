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
          <button id="fm-upload-btn" class="btn-secondary">${icon('upload')} Subir</button>
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
    return `<tr class="fm-row${isUp ? ' fm-up' : ''}" data-name="${esc(e.name)}" data-type="${esc(e.type)}">
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
      el('fm-editor-text').readOnly = S.readOnly;
      el('fm-save-btn').disabled = S.readOnly;

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
    el('fm-editor').classList.add('hidden');
    el('fm-list').classList.remove('hidden');
    if (refresh) navigate(S.cwd);
  }

  el('fm-save-btn').addEventListener('click', async () => {
    if (!S.editingPath || S.readOnly) return;
    try {
      await api('/api/files/write', {
        method: 'POST',
        body: { path: S.editingPath, content: el('fm-editor-text').value },
      });
      toast(`Guardado: ${S.editingPath.split('/').pop()}`, 'ok', '', 3000);
    } catch (err) {
      errToast(err);
    }
  });

  el('fm-back-btn').addEventListener('click', () => closeEditor(true));

  el('fm-editor-text').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      el('fm-save-btn').click();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.editingPath && sec.classList.contains('active')) {
      closeEditor(true);
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
      const nn = window.prompt(`Renombrar «${name}» a:`, name);
      if (!nn || nn === name) return;
      if (nn.includes('/')) {
        toast('El nombre no puede contener /', 'error');
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

  el('fm-table').addEventListener('click', (e) => {
    const actBtn = e.target.closest('.fm-act');
    const tr = e.target.closest('tr.fm-row');
    if (actBtn && tr) {
      e.stopPropagation();
      doAction(actBtn.dataset.act, tr.dataset.name, tr.dataset.type);
      return;
    }
    if (!tr) return;
    const { name, type } = tr.dataset;
    if (name === '..') return navigate(parentOf(S.cwd));
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

  // ---------- Toolbar ----------
  el('fm-refresh-btn').addEventListener('click', () => navigate(S.cwd || undefined));

  el('fm-filter').addEventListener('input', (e) => {
    S.filter = e.target.value;
    renderRows();
  });

  el('fm-mkdir-btn').addEventListener('click', async () => {
    const name = window.prompt('Nombre de la nueva carpeta:');
    if (!name) return;
    if (name.includes('/')) {
      toast('El nombre no puede contener /', 'error');
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

  el('fm-file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const f of files) {
      try {
        const fd = new FormData();
        fd.append('file', f, f.name);
        const res = await fetch(`/api/files/upload?path=${encodeURIComponent(S.cwd)}`, {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          const err = new Error(data.error || `HTTP ${res.status}`);
          err.detail = data.detail;
          throw err;
        }
        toast(`Subido: ${f.name}`, 'ok', '', 3000);
      } catch (err) {
        errToast(err);
      }
    }
    if (files.length) navigate(S.cwd);
  });
})();
