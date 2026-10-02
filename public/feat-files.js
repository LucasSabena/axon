/* AXON — File manager tab (self-contained; wired by integrator) */
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
          <button id="fm-search-btn" class="btn-secondary fm-search-btn" title="Búsqueda recursiva en esta carpeta (Ctrl+F)">${icon('search')}</button>
          <div class="fm-view-switch" role="group" aria-label="Vista">
            <button class="fm-vbtn" id="fm-view-list" data-view="list" title="Vista de lista">${icon('list')}</button>
            <button class="fm-vbtn" id="fm-view-grid" data-view="grid" title="Vista de íconos">${icon('layout-grid')}</button>
            <button class="fm-vbtn" id="fm-view-cols" data-view="cols" title="Vista de columnas">${icon('columns')}</button>
          </div>
          <button id="fm-hidden-btn" class="btn-secondary" title="Mostrar/ocultar archivos ocultos (Ctrl+H)">${icon('eye-off')}</button>
          <button id="fm-upload-btn" class="btn-secondary" title="Subir archivos">${icon('upload')} Subir</button>
          <button id="fm-upload-dir-btn" class="btn-secondary" title="Subir una carpeta completa">${icon('folder-up')} Carpeta</button>
          <button id="fm-mkdir-btn" class="btn-secondary">${icon('folder-plus')} Nueva carpeta</button>
          <button id="fm-refresh-btn" class="btn-secondary" title="Actualizar">${icon('refresh-cw')}</button>
        </div>
      </div>
      <div class="fm-breadcrumb" id="fm-breadcrumb"></div>
      <p class="listener-note fm-note">Archivos del servidor — lectura directa; las escrituras corren como tu usuario del host.</p>
    </div>
    <div class="fm-main" id="fm-main">
      <div class="fm-list" id="fm-list">
        <div class="table-wrapper fm-table-wrap" id="fm-table-wrap">
          <table class="data-table" id="fm-table">
            <thead>
              <tr>
                <th class="fm-selcell"><input type="checkbox" id="fm-check-all" tabindex="-1" title="Seleccionar todo"></th>
                <th></th>
                <th class="fm-th-sort" data-sort="name">Nombre <span class="fm-sort-ind"></span></th>
                <th class="fm-th-sort" data-sort="size">Tamaño <span class="fm-sort-ind"></span></th>
                <th class="fm-th-sort" data-sort="mtime">Modificado <span class="fm-sort-ind"></span></th>
                <th>Permisos</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="fm-tbody"></tbody>
          </table>
        </div>
        <div class="fm-grid hidden" id="fm-grid"></div>
        <div class="fm-cols hidden" id="fm-cols"></div>
        <div id="fm-state" class="empty-state hidden">Cargando…</div>
      </div>
      <div class="fm-resize hidden" id="fm-resize" title="Arrastrar para ajustar el ancho"></div>
      <div class="fm-preview hidden" id="fm-preview">
        <div class="fm-prev-bar">
          <span class="fm-prev-ic" id="fm-prev-ic">${icon('file')}</span>
          <span class="mono fm-prev-name" id="fm-prev-name" title=""></span>
          <div class="fm-prev-actions">
            <button id="fm-prev-edit" class="fm-pact hidden" title="Editar">${icon('pencil')}</button>
            <button id="fm-prev-ext" class="fm-pact" title="Abrir en pestaña nueva">${icon('external-link')}</button>
            <button id="fm-prev-full" class="fm-pact" title="Pantalla completa">${icon('maximize')}</button>
            <button id="fm-prev-dl" class="fm-pact" title="Descargar">${icon('download')}</button>
            <button id="fm-prev-close" class="fm-pact" title="Cerrar (Esc)">${icon('x')}</button>
          </div>
        </div>
        <div class="fm-prev-meta" id="fm-prev-meta"></div>
        <div class="fm-prev-body" id="fm-prev-body"></div>
      </div>
    </div>
    <div class="fm-statusbar" id="fm-statusbar"></div>
    <div class="fm-typeahead hidden" id="fm-typeahead"></div>
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
    preview: null,    // {path, name, kind} — open preview pane
    view: localStorage.getItem('fm-view') || 'list', // list | grid | cols
    showHidden: localStorage.getItem('fm-hidden') !== '0',
    sort: (() => {
      try {
        return JSON.parse(localStorage.getItem('fm-sort')) || { key: 'name', dir: 1 };
      } catch {
        return { key: 'name', dir: 1 };
      }
    })(),
    clip: null,       // {mode:'cut'|'copy', dir, names:[...]}
    cursor: null,     // keyboard-focus name — distinct from selection
    cols: [],         // column-view stack [{path, entries, sel, loading, error}]
    kb: '',           // type-ahead buffer
    kbTimer: 0,
    trashDir: null,   // host path of ~/.local/share/axon-trash
    trashNames: {},   // manifest id → { name, orig } for readable trash rows
    undo: [],         // operation journal [{label, undo, redo}]
    redo: [],
    dirSizes: new Map(), // path -> {bytes, ts} — lazy du cache
    df: null,         // {avail,total} free-space for the status bar
    navId: 0,         // bumped on navigate — stale async writes are dropped
    searchMode: false,
    searchQ: '',
    searchResults: null, // [{type,path,name,dir}] while searching
    dragging: null,   // {dir, names:[...]} internal drag payload
    jobs: new Map(),  // jobId -> {label, pct, cancel} copy jobs in flight
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
  const VID_EXT = new Set('mp4 m4v webm mov mkv avi wmv mts m2ts mpg mpeg 3gp 3g2 flv vob'.split(' '));
  const AUD_EXT = new Set('mp3 wav ogg oga flac m4a aac opus weba wma mid midi aif aiff amr'.split(' '));
  // Browser-blind formats the server converts to PNG via ImageMagick.
  const EXOTIC_EXT = new Set('heic heif tiff tif eps ps ai psd xcf raw cr2 cr3 nef arw dng orf rw2 pef sr2 erf mrw kdc x3f'.split(' '));

  const extOf = (name) => (name.split('.').pop() || '').toLowerCase();

  function kindFor(name) {
    const ext = extOf(name);
    if (IMG_EXT.has(ext) || EXOTIC_EXT.has(ext)) return 'image';
    if (VID_EXT.has(ext)) return 'video';
    if (AUD_EXT.has(ext)) return 'audio';
    if (ext === 'pdf') return 'pdf';
    if (CODE_EXT.has(ext) || TEXT_EXT.has(ext) || !name.includes('.')) return 'text';
    return 'other';
  }

  function iconFor(e) {
    if (e.type === 'dir') return 'folder';
    if (e.type === 'link') return 'link';
    const ext = (e.name.split('.').pop() || '').toLowerCase();
    if (VID_EXT.has(ext)) return 'film';
    if (AUD_EXT.has(ext)) return 'music';
    if (CODE_EXT.has(ext)) return 'file-code';
    if (TEXT_EXT.has(ext) || ext === 'pdf') return 'file-text';
    if (IMG_EXT.has(ext) || EXOTIC_EXT.has(ext)) return 'image';
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
    el('fm-main').classList.remove('hidden');
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

  // Entries for the current dir in sort order (dirs first, then sort key).
  function sortedEntries() {
    const es = S.entries.slice();
    const k = S.sort.key;
    const d = S.sort.dir;
    es.sort((a, b) => {
      const df = (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1);
      if (df) return df;
      let r = 0;
      if (k === 'size') r = a.size - b.size;
      else if (k === 'mtime') r = a.mtime - b.mtime;
      else r = a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true });
      return r * d;
    });
    return es;
  }

  // Entries visible right now: honor the dotfile toggle + text filter.
  function visibleEntries() {
    const q = S.filter.trim().toLowerCase();
    return sortedEntries().filter(
      (e) =>
        (S.showHidden || !e.name.startsWith('.')) &&
        (!q || e.name.toLowerCase().includes(q))
    );
  }
  const hiddenCount = () => S.entries.filter((e) => e.name.startsWith('.')).length;
  const isCutName = (name) =>
    S.clip && S.clip.mode === 'cut' && S.clip.dir === S.cwd && S.clip.names.includes(name);

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
    const hidden = !isUp && e.name.startsWith('.');
    const cut = !isUp && isCutName(e.name);
    return `<tr class="fm-row${isUp ? ' fm-up' : ''}${selected ? ' fm-selected' : ''}${hidden ? ' fm-hidden' : ''}${cut ? ' fm-cut' : ''}" data-name="${esc(e.name)}" data-type="${esc(e.type)}"${isUp ? '' : ' draggable="true"'}>
      <td class="fm-selcell">${isUp ? '' : `<input type="checkbox" class="fm-check" ${selected ? 'checked' : ''} tabindex="-1">`}</td>
      <td class="icon-cell">${ic}</td>
      <td class="fm-name">${esc(dispName(e))}${linkBadge}</td>
      <td class="num"${!isUp && e.type === 'dir' ? ` data-dirsize="${esc(join(S.cwd, e.name))}"` : ''}>${isUp ? '—' : e.type === 'dir' ? dirSizeLabel(join(S.cwd, e.name)) : fmtSize(e.size)}</td>
      <td class="fm-mtime">${isUp ? '' : fmtDate(e.mtime)}</td>
      <td class="mono fm-mode">${esc(e.mode || '')}</td>
      <td class="fm-actcell">${acts}</td>
    </tr>`;
  }

  // ---------- Lazy directory sizes ----------
  // du on big trees is slow, so dir sizes resolve asynchronously: the cell
  // renders a marker, a bounded queue fills them in, and results cache 2 min.
  const DIRSIZE_TTL = 120_000;
  let dirSizeRunning = 0;

  function dirSizeLabel(dirPath) {
    const c = S.dirSizes.get(dirPath);
    return c && Date.now() - c.ts < DIRSIZE_TTL ? fmtSize(c.bytes) : '—';
  }

  function fillDirSizes() {
    const nav = S.navId;
    const cells = [...sec.querySelectorAll('[data-dirsize]')];
    if (cells.length > 120) return; // don't du-storm giant folders
    const wanted = cells
      .map((c) => c.dataset.dirsize)
      .filter((p) => {
        const c = S.dirSizes.get(p);
        return !c || Date.now() - c.ts >= DIRSIZE_TTL;
      });
    const queue = [...new Set(wanted)].slice(0, 60);
    const run = async () => {
      while (queue.length && dirSizeRunning < 4) {
        const p = queue.shift();
        dirSizeRunning++;
        api(`/api/files/dirsize?path=${encodeURIComponent(p)}`)
          .then((r) => {
            S.dirSizes.set(p, { bytes: r.bytes, ts: Date.now() });
            if (nav === S.navId) {
              sec.querySelectorAll(`[data-dirsize="${CSS.escape(p)}"]`).forEach((cell) => {
                cell.textContent = fmtSize(r.bytes);
              });
            }
          })
          .catch(() => {})
          .finally(() => { dirSizeRunning--; run(); });
      }
    };
    run();
  }

  // ---------- Free space in the status bar ----------
  async function refreshDf() {
    if (!S.cwd) return;
    const nav = S.navId;
    try {
      const r = await api(`/api/files/df?path=${encodeURIComponent(S.cwd)}`, { signal: AbortSignal.timeout(10_000) });
      if (nav === S.navId) {
        S.df = { avail: r.avail, total: r.total };
        updateStatusbar();
      }
    } catch { /* df is cosmetic */ }
  }

  // ---------- Recursive search ----------
  // The filter input doubles as the search box in search mode — results show
  // as a flat list of hits with their containing path.
  let searchTimer = 0;

  function toggleSearch(on) {
    const next = on !== undefined ? on : !S.searchMode;
    if (next === S.searchMode) return;
    S.searchMode = next;
    el('fm-search-btn').classList.toggle('active', next);
    const inp = el('fm-filter');
    if (next) {
      S.searchQ = '';
      S.searchResults = null;
      inp.value = '';
      inp.placeholder = 'Buscar recursivo — mín. 2 letras';
      inp.focus();
    } else {
      S.searchResults = null;
      // Restore whatever local filter was active before searching — the
      // input would otherwise keep the stale search text while S.filter
      // still holds the old value.
      inp.value = S.filter || '';
      inp.placeholder = 'Filtrar…';
    }
    render();
  }
  const exitSearch = () => toggleSearch(false);

  function scheduleSearch() {
    clearTimeout(searchTimer);
    const q = S.searchQ.trim();
    if (q.length < 2) {
      S.searchResults = null;
      render();
      return;
    }
    searchTimer = setTimeout(runSearch, 350);
  }

  async function runSearch() {
    const q = S.searchQ.trim();
    if (q.length < 2 || !S.searchMode) return;
    const nav = ++S.navId;
    try {
      const data = await api(
        `/api/files/search?path=${encodeURIComponent(S.cwd)}&q=${encodeURIComponent(q)}`,
        { signal: AbortSignal.timeout(30_000) }
      );
      if (!S.searchMode || nav !== S.navId) return;
      S.searchResults = data.results || [];
      render();
      if (data.truncated) toast('Muchos resultados — afiná la búsqueda', 'warn', '', 2500);
    } catch (err) {
      if (S.searchMode) errToast(err);
    }
  }

  function renderSearch() {
    el('fm-table-wrap').classList.remove('hidden');
    el('fm-grid').classList.add('hidden');
    el('fm-cols').classList.add('hidden');
    const res = S.searchResults || [];
    el('fm-tbody').innerHTML = res
      .map((r) => {
        const rel = r.dir === S.cwd ? '.' : r.dir.startsWith(S.cwd + '/') ? r.dir.slice(S.cwd.length + 1) : r.dir;
        return `<tr class="fm-row fm-search-hit" data-dir="${esc(r.dir)}" data-name="${esc(r.name)}" data-type="${esc(r.type)}">
          <td class="fm-selcell"></td>
          <td class="icon-cell">${icon(iconFor(r))}</td>
          <td class="fm-name">${esc(r.name)} <span class="fm-search-dir">${esc(rel)}</span></td>
          <td class="num"></td><td class="fm-mtime"></td><td></td><td></td>
        </tr>`;
      })
      .join('');
    setState(res.length || S.searchQ.trim().length < 2 ? (S.searchQ.trim().length < 2 ? 'Escribí al menos 2 letras' : '') : 'Sin resultados');
    updateStatusbar();
  }

  // ---------- View dispatcher ----------
  function render() {
    if (S.searchMode) {
      renderSearch();
      refreshIcons();
      return;
    }
    const v = S.view;
    el('fm-table-wrap').classList.toggle('hidden', v !== 'list');
    el('fm-grid').classList.toggle('hidden', v !== 'grid');
    el('fm-cols').classList.toggle('hidden', v !== 'cols');
    if (v === 'grid') renderGrid();
    else if (v === 'cols') renderCols();
    else renderList();
    updateStatusbar();
    refreshIcons();
  }

  function setView(v) {
    if (S.view === v) return;
    S.view = v;
    localStorage.setItem('fm-view', v);
    sec.querySelectorAll('.fm-vbtn').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === v)
    );
    if (v === 'cols') {
      S.cols = [];
      render(); // swap visibility first, then drill fills in columns
      drill(S.cwd);
    } else {
      render();
    }
  }

  function renderList() {
    const rows = visibleEntries();
    let html = '';
    // ".." stays client-side per spec; hidden when the parent would be "/"
    if (parentOf(S.cwd) !== '/') {
      html += rowHtml({ name: '..', type: 'dir', size: null, mtime: 0, mode: '' }, true);
    }
    html += rows.map((e) => rowHtml(e, false)).join('');
    el('fm-tbody').innerHTML = html;
    setState(rows.length || html ? '' : 'Carpeta vacía');
    markSortHeader();
    markCursor();
    fillDirSizes();
  }

  function markSortHeader() {
    el('fm-table').querySelectorAll('.fm-th-sort').forEach((th) => {
      const active = th.dataset.sort === S.sort.key;
      th.classList.toggle('fm-sorted', active);
      const ind = th.querySelector('.fm-sort-ind');
      if (ind) ind.textContent = active ? (S.sort.dir === 1 ? '▲' : '▼') : '';
    });
  }

  // ---------- Grid (icon) view ----------
  function gridCard(e, isUp) {
    const sel = !isUp && S.sel.has(e.name);
    const hidden = !isUp && e.name.startsWith('.');
    const cut = !isUp && isCutName(e.name);
    const ext = extOf(e.name);
    let inner;
    if (isUp) inner = icon('arrow-up');
    else if (e.type === 'file' && IMG_EXT.has(ext)) {
      inner = `<img class="fm-thumb" loading="lazy" draggable="false" alt="" src="/api/files/preview?path=${encodeURIComponent(join(S.cwd, e.name))}"><span class="fm-thumb-fb">${icon(iconFor(e))}</span>`;
    } else inner = `<span class="fm-card-ic-big">${icon(iconFor(e))}</span>`;
    const meta = isUp ? '' : e.type === 'dir' ? 'Carpeta' : fmtSize(e.size);
    return `<div class="fm-card${sel ? ' fm-selected' : ''}${hidden ? ' fm-hidden' : ''}${cut ? ' fm-cut' : ''}${isUp ? ' fm-up' : ''}" data-name="${esc(e.name)}" data-type="${esc(e.type)}" title="${esc(e.trashOrig || e.name)}"${isUp ? '' : ' draggable="true"'}>
      <div class="fm-card-ic">${inner}</div>
      <div class="fm-card-name">${esc(dispName(e))}</div>
      <div class="fm-card-meta">${meta}</div>
    </div>`;
  }

  function renderGrid() {
    const rows = visibleEntries();
    let html = '';
    if (parentOf(S.cwd) !== '/') {
      html += gridCard({ name: '..', type: 'dir' }, true);
    }
    html += rows.map((e) => gridCard(e, false)).join('');
    el('fm-grid').innerHTML = html;
    setState(rows.length || html ? '' : 'Carpeta vacía');
    markCursor();
  }

  // ---------- Column (Miller / Finder) view ----------
  function colHtml(col, i) {
    const last = i === S.cols.length - 1;
    if (col.loading) {
      return `<div class="fm-col" data-col="${i}"><div class="fm-col-state">Cargando…</div></div>`;
    }
    if (col.error) {
      return `<div class="fm-col" data-col="${i}"><div class="fm-col-state fm-col-err">${esc(col.error)}</div></div>`;
    }
    const q = S.filter.trim().toLowerCase();
    const rows = col.entries.filter(
      (e) => (S.showHidden || !e.name.startsWith('.')) && (!q || e.name.toLowerCase().includes(q))
    );
    let html = '';
    if (last && parentOf(S.cwd) !== '/') {
      html += `<div class="fm-col-row fm-col-up" data-col="${i}" data-name=".." data-type="dir">${icon('arrow-up')}<span class="fm-col-name">..</span></div>`;
    }
    html += rows
      .map((e) => {
        const sel = col.sel.has(e.name);
        const hidden = e.name.startsWith('.');
        const cut = S.clip && S.clip.mode === 'cut' && S.clip.dir === col.path && S.clip.names.includes(e.name);
        return `<div class="fm-col-row${sel ? ' fm-selected' : ''}${hidden ? ' fm-hidden' : ''}${cut ? ' fm-cut' : ''}" data-col="${i}" data-name="${esc(e.name)}" data-type="${esc(e.type)}" title="${esc(e.trashOrig || e.name)}" draggable="true">
          ${icon(iconFor(e))}<span class="fm-col-name">${esc(dispName(e))}</span>${e.type === 'dir' ? icon('chevron-right', 'fm-col-chev') : ''}
        </div>`;
      })
      .join('');
    return `<div class="fm-col" data-col="${i}">${html || '<div class="fm-col-state">Carpeta vacía</div>'}</div>`;
  }

  function renderCols() {
    setState('');
    const c = el('fm-cols');
    c.innerHTML = S.cols.map((col, i) => colHtml(col, i)).join('');
    // Keep the deepest column in view.
    requestAnimationFrame(() => {
      const last = c.lastElementChild;
      if (last) last.scrollIntoView({ inline: 'end', block: 'nearest' });
      const selRow = c.querySelector('.fm-col:last-child .fm-col-row.fm-selected');
      if (selRow) selRow.scrollIntoView({ block: 'nearest' });
    });
  }

  // Push a directory column onto the stack and fetch its entries.
  async function drill(path) {
    const col = { path, entries: [], sel: new Set(), loading: true, error: null };
    S.cols.push(col);
    renderCols();
    try {
      const data = await api(`/api/files?path=${encodeURIComponent(path)}`, {
        signal: AbortSignal.timeout(25_000),
      });
      if (inTrash(data.path)) await loadTrashNames(data.path);
      col.entries = trashify(data.entries || [], data.path);
      col.loading = false;
      syncColCwd(data.path, data.home);
    } catch (err) {
      col.loading = false;
      col.error = err.message || 'No se pudo cargar';
      col.entries = [];
    }
    renderCols();
    updateStatusbar();
  }

  // cwd/entries/sel always track the deepest column in cols view, so the
  // breadcrumb, status bar, paste target and preview all stay consistent.
  function syncColCwd(resolvedPath, home) {
    const last = S.cols[S.cols.length - 1];
    if (resolvedPath) last.path = resolvedPath;
    if (home && !S.home) S.home = home;
    S.cwd = last.path;
    S.entries = last.entries;
    S.sel = last.sel;
    renderCrumbs();
  }

  function colClick(e) {
    const row = e.target.closest('.fm-col-row');
    if (!row) return;
    const i = parseInt(row.dataset.col, 10);
    const col = S.cols[i];
    if (!col) return;
    const { name, type } = row.dataset;
    // Selecting in a column discards every deeper column (Finder semantics).
    S.cols = S.cols.slice(0, i + 1);
    if (name === '..') {
      // Pop this column: parent column is the new deepest level.
      S.cols.pop();
      const prev = S.cols[S.cols.length - 1];
      if (prev) {
        S.sel = prev.sel;
        S.cwd = prev.path;
        S.entries = prev.entries;
        renderCrumbs();
      }
      renderCols();
      updateStatusbar();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      col.sel.has(name) ? col.sel.delete(name) : col.sel.add(name);
    } else {
      col.sel.clear();
      col.sel.add(name);
    }
    S.sel = col.sel;
    S.cwd = col.path;
    S.entries = col.entries;
    renderCrumbs();
    if (type === 'dir') {
      closePreview();
      drill(join(col.path, name));
    } else {
      renderCols();
      openPreview(name);
    }
    updateStatusbar();
  }

  // ---------- Status bar ----------
  function updateStatusbar() {
    const bar = el('fm-statusbar');
    if (S.searchMode) {
      const n = S.searchResults?.length;
      bar.innerHTML = S.searchResults === null ? 'Buscando…' : `${n} resultado${n === 1 ? '' : 's'} — Enter abre, Esc sale`;
      return;
    }
    const total = S.entries.length;
    const dirs = S.entries.filter((e) => e.type === 'dir').length;
    const hid = hiddenCount();
    let txt = `${total} elemento${total === 1 ? '' : 's'}`;
    if (dirs) txt += ` · ${dirs} carpeta${dirs === 1 ? '' : 's'}`;
    if (hid) txt += ` · ${hid} oculto${hid === 1 ? '' : 's'}${S.showHidden ? '' : ' (Ctrl+H para ver)'}`;
    if (S.sel.size) {
      const bytes = S.entries
        .filter((e) => S.sel.has(e.name) && e.type !== 'dir')
        .reduce((a, e) => a + (e.size || 0), 0);
      txt += ` · <b>${S.sel.size} seleccionado${S.sel.size === 1 ? '' : 's'}</b>`;
      if (bytes) txt += ` (${fmtSize(bytes)})`;
    }
    if (S.clip) {
      txt += ` · ${S.clip.names.length} en portapapeles (${S.clip.mode === 'cut' ? 'cortar' : 'copiar'})`;
    }
    if (S.df) {
      txt += ` · <span class="fm-df">${fmtSize(S.df.avail)} libres</span>`;
    }
    bar.innerHTML = txt;
  }

  // ---------- Navigation ----------
  async function navigate(p) {
    S.navId++;
    if (S.searchMode) toggleSearch(false);
    S.anchor = null;
    S.cursor = null;
    showList();
    if (S.view === 'cols') {
      S.cols = [];
      setState('');
      render(); // syncs container visibility before the first drill lands
      await drill(p ?? S.cwd ?? '');
      return;
    }
    S.sel.clear();
    setState('Cargando…');
    try {
      const q = p ? `?path=${encodeURIComponent(p)}` : '';
      const data = await api(`/api/files${q}`, { signal: AbortSignal.timeout(25_000) });
      S.cwd = data.path;
      if (!S.home && data.home) S.home = data.home;
      if (inTrash(data.path)) await loadTrashNames(data.path);
      S.entries = trashify(data.entries || [], data.path);
      renderCrumbs();
      render();
      refreshDf();
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

  // ---------- Silent auto-refresh ----------
  // Re-fetches the listing while the tab sits open (files arriving via other
  // services/sync used to stay invisible until a manual refresh). Skips
  // re-render when nothing changed and never steals editor focus.
  const entriesSig = (es) =>
    (es || []).map((e) => `${e.name}|${e.type}|${e.size}|${e.mtime}|${e.mode}`).join('\n');

  async function silentRefresh() {
    if (!sec.classList.contains('active') || document.hidden || S.editingPath || !S.cwd) return;
    try {
      const data = await api(`/api/files?path=${encodeURIComponent(S.cwd)}`, {
        signal: AbortSignal.timeout(20_000),
      });
      const list = data.entries || [];
      if (entriesSig(list) === entriesSig(S.entries)) return;
      if (inTrash(S.cwd)) await loadTrashNames(S.cwd);
      const names = new Set(list.map((e) => e.name));
      for (const n of [...S.sel]) if (!names.has(n)) S.sel.delete(n);
      S.entries = trashify(list, S.cwd);
      const col = S.cols.find((c) => c.path === S.cwd);
      if (col) col.entries = S.entries;
      render();
      updateSelbar();
    } catch { /* silent — next tick retries */ }
  }

  setInterval(silentRefresh, 12_000);
  let focusTimer = 0;
  const queueRefresh = () => {
    clearTimeout(focusTimer);
    focusTimer = setTimeout(silentRefresh, 800);
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) queueRefresh();
  });
  window.addEventListener('focus', queueRefresh);

  // ---------- Preview pane ----------
  const previewUrl = (p) => `/api/files/preview?path=${encodeURIComponent(p)}`;

  function renderPrevFallback(msg) {
    const body = el('fm-prev-body');
    body.innerHTML = `
      <div class="fm-pv-fallback">
        ${icon('file')}
        <p class="fm-pv-fb-msg"></p>
        <div class="fm-pv-fb-actions">
          <button class="btn-secondary fm-pv-fb-txt">${icon('file-text')} Abrir como texto</button>
          <button class="btn-secondary fm-pv-fb-dl">${icon('download')} Descargar</button>
        </div>
      </div>`;
    body.querySelector('.fm-pv-fb-msg').textContent = msg;
    body.querySelector('.fm-pv-fb-dl').addEventListener('click', () => {
      if (S.preview) download(S.preview.path, S.preview.name);
    });
    body.querySelector('.fm-pv-fb-txt').addEventListener('click', () => {
      if (S.preview) openEditor(S.preview.path);
    });
    refreshIcons();
  }

  function openPreview(name) {
    const entry = S.entries.find((e) => e.name === name);
    const p = join(S.cwd, name);
    const kind = kindFor(name);
    S.preview = { path: p, name, kind };
    el('fm-preview').classList.remove('hidden');
    el('fm-resize').classList.remove('hidden');
    el('fm-prev-name').textContent = name;
    el('fm-prev-name').title = p;
    el('fm-prev-ic').innerHTML = icon(iconFor({ name, type: 'file' }));
    el('fm-prev-meta').textContent = entry
      ? `${fmtSize(entry.size)} · ${fmtDate(entry.mtime)}${entry.mode ? ' · ' + entry.mode : ''}`
      : '';
    el('fm-prev-edit').classList.toggle('hidden', kind !== 'text');

    const body = el('fm-prev-body');
    body.innerHTML = '<div class="fm-pv-loading">Cargando…</div>';
    const stale = () => S.preview?.path !== p; // user already clicked another file

    if (kind === 'image') {
      const img = new Image();
      img.className = 'fm-pv-media';
      img.alt = name;
      img.draggable = false;
      img.onload = () => {
        if (stale()) return;
        body.innerHTML = '';
        body.appendChild(img);
      };
      img.onerror = () => {
        if (!stale()) renderPrevFallback('No se pudo cargar la imagen');
      };
      img.src = previewUrl(p);
    } else if (kind === 'video') {
      const v = document.createElement('video');
      v.className = 'fm-pv-media';
      v.controls = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = previewUrl(p);
      v.onerror = () => {
        if (!stale()) renderPrevFallback('Este video no se puede reproducir en el navegador');
      };
      body.innerHTML = '';
      body.appendChild(v);
      v.play().catch(() => {}); // autoplay may be blocked — controls stay usable
    } else if (kind === 'audio') {
      body.innerHTML = `
        <div class="fm-pv-audio">
          ${icon('music')}
          <audio controls preload="auto" src="${previewUrl(p)}"></audio>
        </div>`;
      body.querySelector('audio').addEventListener('error', () => {
        if (!stale()) renderPrevFallback('Este audio no se puede reproducir en el navegador');
      });
    } else if (kind === 'pdf') {
      const f = document.createElement('iframe');
      f.className = 'fm-pv-frame';
      f.src = previewUrl(p);
      f.title = name;
      body.innerHTML = '';
      body.appendChild(f);
    } else if (kind === 'text') {
      api(`/api/files/read?path=${encodeURIComponent(p)}`, { signal: AbortSignal.timeout(20_000) })
        .then((data) => {
          if (stale()) return;
          if (String(data.content || '').includes('')) {
            renderPrevFallback('Archivo binario — sin vista de texto');
            return;
          }
          const pre = document.createElement('pre');
          pre.className = 'fm-pv-text mono';
          pre.textContent = data.content || '';
          body.innerHTML = '';
          body.appendChild(pre);
          if (data.truncated) {
            const note = document.createElement('div');
            note.className = 'fm-pv-note';
            note.textContent = 'Truncado (>512KB) — se muestra el inicio del archivo';
            body.appendChild(note);
          }
        })
        .catch((err) => {
          if (!stale()) renderPrevFallback(err.message || 'No se pudo leer el archivo');
        });
    } else {
      renderPrevFallback('Sin vista previa para este tipo de archivo');
    }
    refreshIcons();
  }

  function closePreview() {
    if (!S.preview) return;
    S.preview = null;
    // innerHTML reset also stops any playing audio/video.
    el('fm-prev-body').innerHTML = '';
    el('fm-preview').classList.add('hidden');
    el('fm-resize').classList.add('hidden');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  el('fm-prev-close').addEventListener('click', closePreview);
  el('fm-prev-dl').addEventListener('click', () => {
    if (S.preview) download(S.preview.path, S.preview.name);
  });
  el('fm-prev-ext').addEventListener('click', () => {
    if (S.preview) window.open(previewUrl(S.preview.path), '_blank', 'noopener');
  });
  el('fm-prev-edit').addEventListener('click', () => {
    if (S.preview) openEditor(S.preview.path);
  });
  el('fm-prev-full').addEventListener('click', () => {
    const body = el('fm-prev-body');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else body.requestFullscreen?.().catch(() => {});
  });
  // Double-click on the media area toggles fullscreen too.
  el('fm-prev-body').addEventListener('dblclick', (e) => {
    if (e.target.closest('button, a, input, audio')) return;
    const body = el('fm-prev-body');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else body.requestFullscreen?.().catch(() => {});
  });

  // Drag handle between the list and the pane adjusts the pane width.
  el('fm-resize').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const pane = el('fm-preview');
    const startX = e.clientX;
    const startW = pane.getBoundingClientRect().width;
    const move = (ev) => {
      const w = startW + (startX - ev.clientX);
      pane.style.width = `${Math.min(Math.max(w, 260), window.innerWidth * 0.85)}px`;
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('fm-resizing');
    };
    document.body.classList.add('fm-resizing');
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // Arrow keys walk through previewable files while the pane is open.
  document.addEventListener('keydown', (e) => {
    if (!S.preview || !sec.classList.contains('active') || S.editingPath) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (document.querySelector('.modal:not(.hidden)')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'video', 'audio', 'select', 'iframe'].includes(tag)) return;
    const names = S.entries
      .filter((x) => x.type !== 'dir' && kindFor(x.name) !== 'text')
      .map((x) => x.name);
    const i = names.indexOf(S.preview.name);
    if (i < 0) return;
    const next = e.key === 'ArrowLeft' ? names[i - 1] : names[i + 1];
    if (!next) return;
    e.preventDefault();
    openPreview(next);
  });

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

      el('fm-main').classList.add('hidden');
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
    el('fm-main').classList.remove('hidden');
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
      return;
    }
    // Layered Esc: search → type-ahead → pending clipboard → selection → preview.
    if (S.searchMode && sec.classList.contains('active')) {
      e.stopImmediatePropagation();
      exitSearch();
      return;
    }
    if (S.kb) {
      e.stopImmediatePropagation();
      resetKb();
      return;
    }
    if (S.clip) {
      e.stopImmediatePropagation();
      setClip(null);
      return;
    }
    if (S.sel.size) {
      e.stopImmediatePropagation();
      clearSel();
      return;
    }
    if (S.preview && sec.classList.contains('active')) {
      e.stopImmediatePropagation(); // don't also clear the multi-selection
      closePreview();
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
      const to = join(S.cwd, nn);
      try {
        await apiRename(p, to);
        journaled({
          label: `Renombrar ${name}`,
          undo: async () => { await apiRename(to, p); },
          redo: async () => { await apiRename(p, to); },
        });
        toast('Renombrado — Ctrl+Z deshace', 'ok', '', 2500);
        navigate(S.cwd);
      } catch (err) {
        errToast(err);
      }
    } else if (act === 'delete') {
      await deleteTargets([name]);
    } else if (act === 'restore') {
      await restoreTrashed([name]); // `name` is the manifest id in trash rows
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
      const total = visibleEntries().length;
      checkAll.checked = n > 0 && n === total;
      checkAll.indeterminate = n > 0 && n < total;
    }
  }

  function applySelToDom() {
    // Cut items ghost only inside their source directory.
    const cut = S.clip?.mode === 'cut' ? S.clip : null;
    const isCut = (dir, name) => Boolean(cut && cut.dir === dir && cut.names.includes(name));
    el('fm-tbody').querySelectorAll('tr.fm-row').forEach((tr) => {
      const on = S.sel.has(tr.dataset.name);
      tr.classList.toggle('fm-selected', on);
      tr.classList.toggle('fm-cut', isCut(S.cwd, tr.dataset.name));
      const cb = tr.querySelector('.fm-check');
      if (cb) cb.checked = on;
    });
    el('fm-grid').querySelectorAll('.fm-card').forEach((card) => {
      card.classList.toggle('fm-selected', S.sel.has(card.dataset.name));
      card.classList.toggle('fm-cut', isCut(S.cwd, card.dataset.name));
    });
    el('fm-cols').querySelectorAll('.fm-col-row').forEach((row) => {
      const col = S.cols[parseInt(row.dataset.col, 10)];
      row.classList.toggle('fm-selected', Boolean(col?.sel.has(row.dataset.name)));
      row.classList.toggle('fm-cut', isCut(col?.path, row.dataset.name));
    });
    updateSelbar();
    updateStatusbar();
    markCursor();
  }

  // Keyboard-focus ring — visually distinct from selection (dashed outline).
  function markCursor() {
    sec.querySelectorAll('.fm-focused').forEach((n) => n.classList.remove('fm-focused'));
    if (!S.cursor) return;
    const t = sec.querySelector(`#fm-tbody [data-name="${CSS.escape(S.cursor)}"], #fm-grid [data-name="${CSS.escape(S.cursor)}"]`);
    if (t) t.classList.add('fm-focused');
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
    return visibleEntries().map((e) => e.name);
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
    // Search hits open their containing folder and land on the entry.
    if (tr.classList.contains('fm-search-hit')) {
      const dir = tr.dataset.dir;
      exitSearch();
      navigate(dir).then(() => selectName(name));
      return;
    }
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
    S.cursor = name;
    openEntry(name, type);
  });

  // Shared "activate an entry" logic for the list and grid views.
  function openEntry(name, type) {
    if (type === 'dir') return navigate(join(S.cwd, name));
    // Text/code goes straight to the editor; media and everything else opens
    // the preview pane (unknown types get a fallback card there).
    if (kindFor(name) === 'text') openEditor(join(S.cwd, name));
    else openPreview(name);
  }

  el('fm-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.fm-card');
    if (!card) return;
    const { name, type } = card.dataset;
    if (name === '..') return navigate(parentOf(S.cwd));
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
    S.cursor = name;
    openEntry(name, type);
  });

  el('fm-cols').addEventListener('click', colClick);

  // ---------- Clipboard (Explorer semantics) ----------
  // Ctrl+X marks a "move intent" — items ghost at ~50% until pasted or Esc.
  // Ctrl+C clears any pending cut and copies paths; paste duplicates.
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('axon-fm-clip') : null;

  function setClip(clip) {
    S.clip = clip;
    try {
      if (clip) localStorage.setItem('fm-clip', JSON.stringify(clip));
      else localStorage.removeItem('fm-clip');
    } catch { /* quota */ }
    bc?.postMessage({ type: 'clip', clip });
    applySelToDom();
  }

  if (bc) {
    bc.addEventListener('message', (e) => {
      if (e.data?.type === 'clip') {
        S.clip = e.data.clip;
        applySelToDom();
      }
    });
  }
  // A paste in another tab of this panel shares the in-memory clipboard.
  try {
    const saved = JSON.parse(localStorage.getItem('fm-clip') || 'null');
    if (saved && Array.isArray(saved.names) && saved.dir) S.clip = saved;
  } catch { /* ignore */ }

  // Collision-free "name (copia)", "name (copia 2)"… preserving the extension.
  function freeName(name, taken) {
    if (!taken.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; ; i++) {
      const cand = `${base} (copia${i > 1 ? ' ' + i : ''})${ext}`;
      if (!taken.has(cand)) return cand;
    }
  }

  async function paste(intoDir) {
    if (!S.clip || !S.clip.names.length) return;
    const { mode, dir, names } = S.clip;
    const destDir = intoDir || S.cwd;
    const r = await transferItems(names, dir, destDir, mode);
    journalTransfer(r, mode, dir, destDir);
    if (mode === 'cut' && (r.moved.length || r.skipped)) setClip(null);
    if (r.failed.length) toast(`Error en ${r.failed.length} elemento${r.failed.length === 1 ? '' : 's'}`, 'error', r.failed.slice(0, 5).join('\n'));
    const okN = r.moved.length + r.copied.length;
    if (okN) toast(`${okN} ${mode === 'cut' ? 'movido' : 'copiado'}${okN === 1 ? '' : 's'} — Ctrl+Z deshace`, 'ok', '', 3000);
    if (!okN && r.skipped && !r.failed.length) toast('Nada que mover — origen y destino iguales', 'warn', '', 2500);
    navigate(destDir === S.cwd ? S.cwd : destDir);
  }

  // Record a transfer's inverse: moves undo by renaming back, copies undo by
  // trashing the created files (recoverable from the trash either way).
  function journalTransfer(r, mode, srcDir, destDir) {
    if (r.moved.length) {
      const pairs = r.moved;
      journaled({
        label: `Mover ${pairs.length === 1 ? pairs[0].from.split('/').pop() : pairs.length + ' elementos'}`,
        undo: async () => { for (const p of pairs) await apiRename(p.to, p.from); },
        redo: async () => { for (const p of pairs) await apiRename(p.from, p.to); },
      });
    }
    if (r.copied.length) {
      const dests = r.copied.map((x) => x.to);
      const op = {
        label: `Copiar ${r.copied.length === 1 ? dests[0].split('/').pop() : r.copied.length + ' elementos'}`,
        _ids: [],
        undo: async () => {
          const rr = await apiTrash(dests);
          op._ids = (rr.items || []).map((i) => i.trashed);
        },
        redo: async () => { await apiRestore(op._ids); },
      };
      journaled(op);
    }
  }

  // Clipboard contents for a context/keyboard action: the multi-selection if
  // it contains the target, otherwise just the target row.
  const clipTargets = (name) => (S.sel.has(name) ? [...S.sel] : [name]);

  function copyPath(p) {
    navigator.clipboard?.writeText(p).then(
      () => toast(`Ruta copiada: ${p}`, 'ok', '', 2500),
      () => toast('No se pudo copiar la ruta', 'error')
    );
  }

  // ---------- Trash & undo journal ----------
  // Deletes go to a real trash dir (recoverable). Every mutating op records an
  // inverse closure so Ctrl+Z walks backwards through rename/move/trash/copy.
  const inTrash = (dir) => S.trashDir && (dir === S.trashDir || dir.startsWith(S.trashDir + '/'));

  // Trashed items live under random ids; the manifest maps them back to the
  // original name/location for a readable listing (ops still use the id).
  async function loadTrashNames(dir) {
    S.trashNames = {};
    try {
      const r = await api(`/api/files/read?path=${encodeURIComponent(join(dir, '.manifest.json'))}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const items = JSON.parse(r.content || '[]');
      for (const it of items) S.trashNames[it.id] = it;
    } catch { /* no manifest — rows show raw ids */ }
  }

  const trashify = (entries, dir) => {
    if (!inTrash(dir)) return entries;
    return (entries || [])
      .filter((e) => e.name !== '.manifest.json')
      .map((e) => {
        const meta = S.trashNames[e.name];
        return meta ? { ...e, trashName: meta.name, trashOrig: meta.orig } : e;
      });
  };

  const dispName = (e) => e.trashName || e.name;

  async function apiTrash(paths) {
    const data = await api('/api/files/trash', { method: 'POST', body: { paths } });
    if (data.failed?.length && !data.items?.length) {
      throw Object.assign(new Error(data.failed[0].error || 'No se pudo enviar a la papelera'), { failed: data.failed });
    }
    return data;
  }
  const apiRestore = (ids) => api('/api/files/trash/restore', { method: 'POST', body: { ids } });
  const apiRename = (from, to) => api('/api/files/rename', { method: 'POST', body: { from, to } });
  const apiMkdir = (p) => api('/api/files/mkdir', { method: 'POST', body: { path: p } });
  const apiDeleteHard = (p) => api('/api/files/delete', { method: 'POST', body: { path: p, confirm: true } });

  function journaled(op) {
    S.undo.push(op);
    if (S.undo.length > 50) S.undo.shift();
    S.redo.length = 0; // any new action invalidates the redo stack
  }

  async function doUndo() {
    const op = S.undo.pop();
    if (!op) return toast('Nada para deshacer', 'warn', '', 1800);
    try {
      await op.undo();
      S.redo.push(op);
      toast(`Deshecho: ${op.label}`, 'ok', '', 2200);
    } catch (err) {
      S.undo.push(op); // failed undo stays on the stack
      toast(`No se pudo deshacer: ${op.label}`, 'error', err.message);
    }
    navigate(S.cwd);
  }

  async function doRedo() {
    const op = S.redo.pop();
    if (!op) return toast('Nada para rehacer', 'warn', '', 1800);
    try {
      await op.redo();
      S.undo.push(op);
      toast(`Rehecho: ${op.label}`, 'ok', '', 2200);
    } catch (err) {
      S.redo.push(op);
      toast(`No se pudo rehacer: ${op.label}`, 'error', err.message);
    }
    navigate(S.cwd);
  }

  // Delete = move to trash (reversible). Inside the trash dir, delete is
  // permanent and asks for confirmation.
  async function deleteTargets(names, dir) {
    if (!names.length) return;
    const srcDir = dir || S.cwd;
    const paths = names.map((n) => join(srcDir, n));
    if (inTrash(srcDir)) {
      const preview = names.slice(0, 6).join(', ') + (names.length > 6 ? ` y ${names.length - 6} más` : '');
      const ok = await confirmDialog(
        `Borrado definitivo — ${names.length} elemento${names.length === 1 ? '' : 's'}`,
        `Esto no se puede deshacer: ${preview}`
      );
      if (!ok) return;
      const failed = [];
      for (const p of paths) {
        try { await apiDeleteHard(p); } catch (err) { failed.push(`${p}: ${err.message}`); }
      }
      if (failed.length) toast('Errores al borrar', 'error', failed.join('\n'));
      else toast(`${names.length} borrado${names.length === 1 ? '' : 's'} definitivamente`, 'ok', '', 3000);
      navigate(srcDir === S.cwd ? S.cwd : srcDir);
      return;
    }
    try {
      const r = await apiTrash(paths);
      const items = r.items || [];
      if (items.length) {
        const ids = items.map((i) => i.trashed);
        const origs = items.map((i) => i.orig);
        journaled({
          label: `Papelera: ${items.length === 1 ? items[0].name : items.length + ' elementos'}`,
          undo: async () => { await apiRestore(ids); },
          redo: async () => {
            const rr = await apiTrash(origs);
            ids.length = 0;
            ids.push(...(rr.items || []).map((i) => i.trashed));
          },
        });
      }
      toast(`${items.length} a la papelera — Ctrl+Z para deshacer`, 'ok', '', 3000);
      if (r.failed?.length) toast(`${r.failed.length} no se pudieron mover`, 'error', r.failed.map((f) => f.error).join('\n'));
    } catch (err) {
      errToast(err);
    }
    navigate(srcDir === S.cwd ? S.cwd : srcDir);
  }

  async function restoreTrashed(ids) {
    try {
      const r = await apiRestore(ids);
      const restored = r.restored || [];
      if (restored.length) {
        const dests = restored.map((x) => x.to);
        journaled({
          label: `Restaurar ${restored.length}`,
          undo: async () => { await apiTrash(dests); },
          redo: async () => { await apiRestore(ids); },
        });
      }
      toast(`${restored.length} restaurado${restored.length === 1 ? '' : 's'}`, 'ok', '', 2500);
      if (r.failed?.length) toast(`${r.failed.length} fallaron`, 'error', r.failed.map((f) => f.error).join('\n'));
    } catch (err) {
      errToast(err);
    }
    navigate(S.cwd);
  }

  async function emptyTrash() {
    const ok = await confirmDialog('Vaciar papelera', 'Se borran permanentemente todos los elementos de la papelera.');
    if (!ok) return;
    try {
      await api('/api/files/trash/empty', { method: 'POST', body: { confirm: true } });
      toast('Papelera vaciada', 'ok', '', 2500);
    } catch (err) {
      errToast(err);
    }
    navigate(S.cwd);
  }

  // ---------- Shared move/copy used by paste and drag & drop ----------
  // Returns {moved:[{from,to}], copied:[{from,to}], skipped, failed:[...]} so
  // callers can journal precisely.
  async function transferItems(names, srcDir, destDir, mode) {
    const taken = new Set(await dirNames(destDir));
    const out = { moved: [], copied: [], skipped: 0, failed: [] };
    for (const name of names) {
      const from = join(srcDir, name);
      if (mode === 'cut' && srcDir === destDir) { out.skipped++; continue; }
      const target = freeName(name, taken);
      const to = join(destDir, target);
      try {
        if (mode === 'cut') {
          await apiRename(from, to);
          out.moved.push({ from, to });
        } else {
          await copyWithJobs(from, to, name);
          out.copied.push({ from, to });
        }
        taken.add(target);
      } catch (err) {
        out.failed.push(`${name}: ${err.message}`);
      }
    }
    return out;
  }

  // Name set of a directory — used for collision-free destinations.
  async function dirNames(dir) {
    if (dir === S.cwd) return S.entries.map((e) => e.name);
    try {
      const data = await api(`/api/files?path=${encodeURIComponent(dir)}`, { signal: AbortSignal.timeout(20_000) });
      return (data.entries || []).map((e) => e.name);
    } catch {
      return [];
    }
  }

  // Copy via the job endpoint when it makes sense — small copies still return
  // fast because cp finishes before the first poll.
  async function copyWithJobs(from, to, label) {
    const data = await api('/api/files/copyjob', { method: 'POST', body: { from, to } });
    const jobId = data.jobId;
    if (!jobId) return;
    trackJob(jobId, label);
    // Resolve once the job reports done — trackJob polls in the background and
    // resolves the shared promise kept on the job record.
    const rec = S.jobs.get(jobId);
    await rec.done;
    if (rec.error) throw new Error(rec.error);
  }

  function trackJob(jobId, label) {
    const rec = { label, pct: 0, error: null, done: null, cancel: null };
    rec.done = (async () => {
      for (;;) {
        await new Promise((r) => setTimeout(r, 600));
        const rec2 = S.jobs.get(jobId);
        if (!rec2) return; // cancelled & removed
        try {
          const st = await api(`/api/files/copyjob/${jobId}`);
          rec2.pct = st.pct;
          renderJobs();
          if (st.error) { rec2.error = st.error; S.jobs.delete(jobId); renderJobs(); return; }
          if (st.done) { S.jobs.delete(jobId); renderJobs(); return; }
        } catch (err) {
          rec2.error = err.message;
          S.jobs.delete(jobId);
          renderJobs();
          return;
        }
      }
    })();
    rec.cancel = async () => {
      rec.error = 'Cancelado';
      S.jobs.delete(jobId);
      renderJobs();
      try { await api(`/api/files/copyjob/${jobId}`, { method: 'DELETE' }); } catch { /* gone */ }
    };
    S.jobs.set(jobId, rec);
    renderJobs();
  }

  // Floating job chips (copies in flight) — lives under the status bar.
  function renderJobs() {
    let wrap = document.getElementById('fm-jobs');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'fm-jobs';
      sec.appendChild(wrap);
    }
    if (!S.jobs.size) { wrap.innerHTML = ''; wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = [...S.jobs.entries()].map(([id, j]) => `
      <div class="fm-job" data-job="${esc(id)}">
        <span class="fm-job-label" title="${esc(j.label)}">${esc(j.label)}</span>
        <div class="fm-job-track"><div class="fm-job-bar" style="width:${j.pct}%"></div></div>
        <span class="fm-job-pct">${j.pct}%</span>
        <button class="fm-job-x" title="Cancelar">${icon('x')}</button>
      </div>`).join('');
    wrap.querySelectorAll('.fm-job').forEach((row) => {
      row.querySelector('.fm-job-x').addEventListener('click', () => S.jobs.get(row.dataset.job)?.cancel());
    });
    refreshIcons();
  }

  // ---------- Compress / extract ----------
  async function compressTargets(dir, names) {
    if (!names.length) return;
    const def = names.length === 1 ? names[0].replace(/\.[^.]*$/, '') : 'archivo';
    const name = await fmPrompt('Comprimir', `Nombre del archivo (en ${dir.split('/').pop() || '/'})`, def);
    if (!name) return;
    const format = await fmChoice('Formato', ['tar.gz', 'tar', 'zip'], 'tar.gz');
    if (!format) return;
    try {
      const r = await api('/api/files/archive', {
        method: 'POST',
        body: { op: 'compress', dir, names, out: name, format },
      });
      const op = {
        label: `Comprimir ${names.length}`,
        _ids: [],
        undo: async () => { const rr = await apiTrash([r.path]); op._ids = (rr.items || []).map((i) => i.trashed); },
        redo: async () => { await apiRestore(op._ids); },
      };
      journaled(op);
      toast(`Comprimido: ${r.path.split('/').pop()}`, 'ok', '', 3000);
    } catch (err) {
      errToast(err);
    }
    navigate(dir === S.cwd ? S.cwd : dir);
  }

  async function extractArchive(p, destDir) {
    try {
      const r = await api('/api/files/archive', {
        method: 'POST',
        body: { op: 'extract', path: p, destDir },
      });
      const op = {
        label: `Extraer ${p.split('/').pop()}`,
        _ids: [],
        undo: async () => { const rr = await apiTrash([r.dir]); op._ids = (rr.items || []).map((i) => i.trashed); },
        redo: async () => { await apiRestore(op._ids); },
      };
      journaled(op);
      toast(`Extraído en ${r.dir.split('/').pop()}/`, 'ok', '', 3000);
    } catch (err) {
      errToast(err);
    }
    navigate(S.cwd);
  }

  // Small single-select modal — one row of options, resolves the picked value.
  function fmChoice(title, options, def) {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'modal fm-prompt-modal';
      m.innerHTML = `
        <div class="modal-content">
          <h3></h3>
          <div class="fm-choice-row"></div>
          <div class="modal-actions"><button class="btn-secondary fm-p-cancel">Cancelar</button></div>
        </div>`;
      m.querySelector('h3').textContent = title;
      const row = m.querySelector('.fm-choice-row');
      const done = (v) => { m.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      for (const opt of options) {
        const b = document.createElement('button');
        b.className = 'btn-secondary fm-choice' + (opt === def ? ' fm-choice-def' : '');
        b.textContent = opt;
        b.addEventListener('click', () => done(opt));
        row.appendChild(b);
      }
      m.querySelector('.fm-p-cancel').addEventListener('click', () => done(null));
      m.addEventListener('click', (e) => { if (e.target === m) done(null); });
      document.body.appendChild(m);
      row.querySelector('.fm-choice-def')?.focus();
    });
  }

  // ---------- Properties dialog ----------
  const FILE_TYPE_ES = {
    'regular file': 'Archivo',
    directory: 'Carpeta',
    'symbolic link': 'Enlace simbólico',
    'block special file': 'Dispositivo de bloques',
    'character special file': 'Dispositivo de caracteres',
    socket: 'Socket',
    fifo: 'Pipe (FIFO)',
  };

  async function showProps(p, name, orig) {
    let st;
    try {
      st = await api(`/api/files/stat?path=${encodeURIComponent(p)}`);
    } catch (err) {
      errToast(err);
      return;
    }
    const m = document.createElement('div');
    m.className = 'modal fm-prompt-modal fm-props-modal';
    const ftype = FILE_TYPE_ES[st.ftype] || st.ftype || 'Archivo';
    m.innerHTML = `
      <div class="modal-content">
        <h3></h3>
        <table class="fm-props">
          <tr><td>Nombre</td><td class="mono fp-name"></td></tr>
          <tr><td>Tipo</td><td class="fp-type"></td></tr>
          ${orig ? '<tr><td>Ubicación original</td><td class="mono fp-orig"></td></tr>' : ''}
          ${st.symlinkTarget ? '<tr><td>Destino</td><td class="mono fp-target"></td></tr>' : ''}
          <tr><td>Tamaño</td><td class="fp-size"></td></tr>
          ${st.ftype === 'directory' ? '<tr><td>En disco</td><td class="fm-props-disk">calculando…</td></tr>' : ''}
          <tr><td>Modificado</td><td class="fp-mtime"></td></tr>
          <tr><td>Permisos</td><td class="fm-props-perms"></td></tr>
          <tr><td>Dueño</td><td class="fp-owner"></td></tr>
        </table>
        <div class="modal-actions">
          <button class="btn-secondary fm-p-cancel">Cerrar</button>
          <button class="btn-primary fm-p-chmod">Aplicar permisos</button>
        </div>
      </div>`;
    m.querySelector('h3').textContent = `Propiedades — ${name}`;
    m.querySelector('.fp-name').textContent = name;
    m.querySelector('.fp-type').textContent = ftype;
    if (orig) m.querySelector('.fp-orig').textContent = orig;
    if (st.symlinkTarget) m.querySelector('.fp-target').textContent = st.symlinkTarget;
    m.querySelector('.fp-size').textContent = `${fmtSize(st.size)} (${st.size.toLocaleString('es')} B)`;
    m.querySelector('.fp-mtime').textContent = fmtDate(st.mtime);
    m.querySelector('.fp-owner').textContent = `${st.user}:${st.group}`;
    // chmod input inline in the permisos cell
    const permCell = m.querySelector('.fm-props-perms');
    permCell.innerHTML = `<span class="mono">${esc(st.modeStr)}</span>
      <input type="text" class="fm-chmod-input mono" value="${esc(st.mode)}" maxlength="4" size="4" title="Octal — ej: 755">`;
    const done = () => { m.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
    document.addEventListener('keydown', onKey, true);
    m.querySelector('.fm-p-cancel').addEventListener('click', done);
    m.addEventListener('click', (e) => { if (e.target === m) done(); });
    m.querySelector('.fm-p-chmod').addEventListener('click', async () => {
      const mode = permCell.querySelector('.fm-chmod-input').value.trim();
      try {
        await api('/api/files/chmod', { method: 'POST', body: { path: p, mode } });
        const old = st.mode;
        journaled({
          label: `chmod ${mode} ${name}`,
          undo: async () => { await api('/api/files/chmod', { method: 'POST', body: { path: p, mode: old } }); },
          redo: async () => { await api('/api/files/chmod', { method: 'POST', body: { path: p, mode } }); },
        });
        toast(`Permisos → ${mode}`, 'ok', '', 2200);
        done();
        navigate(S.cwd);
      } catch (err) {
        errToast(err);
      }
    });
    document.body.appendChild(m);
    // Async disk usage — du on big trees takes a while.
    if (st.ftype === 'directory') {
      api(`/api/files/dirsize?path=${encodeURIComponent(p)}`)
        .then((r) => {
          const c = m.querySelector('.fm-props-disk');
          if (c && m.isConnected) c.textContent = `${fmtSize(r.bytes)} (${r.bytes.toLocaleString('es')} B)`;
        })
        .catch(() => {
          const c = m.querySelector('.fm-props-disk');
          if (c && m.isConnected) c.textContent = '—';
        });
    }
  }

  // ---------- Right-click context menus ----------
  const isArchive = (name) =>
    /\.(tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|zip)$/i.test(name);

  el('fm-list').addEventListener('contextmenu', (e) => {
    if (typeof showCtxMenu !== 'function') return;
    const row = e.target.closest('tr.fm-row, .fm-card, .fm-col-row');
    if (!row || row.dataset.name === '..') {
      // Empty space → area menu.
      e.preventDefault();
      const items = [
        { icon: 'folder-plus', label: 'Nueva carpeta', run: () => el('fm-mkdir-btn').click() },
        { icon: 'upload', label: 'Subir archivos', run: () => el('fm-file-input').click() },
      ];
      if (S.clip && !inTrash(S.cwd)) {
        items.push({ icon: 'paste', label: `Pegar (${S.clip.names.length})`, run: () => paste() });
      }
      items.push({ sep: true }, { icon: 'refresh-cw', label: 'Actualizar', run: () => navigate(S.cwd) });
      if (inTrash(S.cwd)) {
        items.push({ icon: 'trash-2', label: 'Vaciar papelera', danger: true, run: emptyTrash });
      } else if (S.trashDir) {
        items.push({ icon: 'trash-2', label: 'Abrir papelera', run: () => navigate(S.trashDir) });
      }
      showCtxMenu(items, e.clientX, e.clientY);
      return;
    }
    e.preventDefault();
    const { name, type } = row.dataset;
    const colI = row.dataset.col !== undefined ? parseInt(row.dataset.col, 10) : null;
    const basePath = colI !== null ? S.cols[colI]?.path || S.cwd : S.cwd;
    const p = join(basePath, name);
    // Right-click selects the row, but never deselects a multi-selection
    // that already contains it.
    if (colI === null && !S.sel.has(name)) {
      S.sel.clear();
      S.sel.add(name);
      S.anchor = name;
      applySelToDom();
    }
    const items = [];
    const trashCtx = inTrash(basePath);
    if (trashCtx) {
      // In the trash the only sensible actions are restore and hard delete.
      const ids = S.sel.has(name) ? [...S.sel] : [name];
      items.push(
        { icon: 'undo-2', label: `Restaurar${ids.length > 1 ? ` (${ids.length})` : ''}`, run: () => restoreTrashed(ids) },
        { icon: 'trash-2', label: 'Borrar definitivamente', danger: true, run: () => deleteTargets(ids, basePath) },
        { sep: true },
        { icon: 'clipboard', label: 'Copiar ruta', run: () => copyPath(p) },
        {
          icon: 'info', label: 'Propiedades',
          run: () => {
            const ent = (colI !== null ? S.cols[colI]?.entries : S.entries)?.find((x) => x.name === name);
            showProps(p, ent?.trashName || name, ent?.trashOrig);
          },
        }
      );
      showCtxMenu(items, e.clientX, e.clientY);
      return;
    }
    if (type === 'dir' && typeof openTermCmd === 'function') {
      items.push({ icon: 'terminal', label: 'Terminal en esta carpeta', run: () => openTermCmd(`cd '${p.replace(/'/g, `'\\''`)}'`) });
    }
    if (type !== 'dir') {
      items.push(
        { icon: 'eye', label: 'Vista previa', run: () => { S.cwd = basePath; if (colI !== null && S.cols[colI]) S.entries = S.cols[colI].entries; openPreview(name); } },
        { icon: 'pencil', label: 'Editar', run: () => openEditor(p) },
        { icon: 'download', label: 'Descargar', run: () => download(p, name) }
      );
      if (isArchive(name)) {
        items.push({ icon: 'package-open', label: 'Extraer aquí', run: () => extractArchive(p, basePath) });
      }
      items.push({ sep: true });
    }
    items.push(
      { icon: 'scissors', label: 'Cortar', run: () => setClip({ mode: 'cut', dir: basePath, names: clipTargets(name) }) },
      { icon: 'copy', label: 'Copiar', run: () => setClip({ mode: 'copy', dir: basePath, names: clipTargets(name) }) }
    );
    if (S.clip) {
      // "Paste here" on a folder drops inside it; on a file, into its dir.
      const pasteDest = type === 'dir' ? p : basePath;
      items.push({
        icon: 'paste',
        label: `Pegar ${type === 'dir' ? 'dentro' : 'aquí'} (${S.clip.names.length})`,
        run: () => paste(pasteDest),
      });
    }
    items.push(
      { icon: 'archive', label: 'Comprimir…', run: () => compressTargets(basePath, clipTargets(name)) },
      { icon: 'clipboard', label: 'Copiar ruta', run: () => copyPath(p) },
      { sep: true },
      { icon: 'pencil', label: 'Renombrar', run: () => { S.cwd = basePath; doAction('rename', name, type); } },
      {
        icon: 'info', label: 'Propiedades',
        run: () => {
          const ent = (colI !== null ? S.cols[colI]?.entries : S.entries)?.find((x) => x.name === name);
          showProps(p, ent?.trashName || name, ent?.trashOrig);
        },
      },
      { icon: 'trash-2', label: 'Eliminar', danger: true, run: () => { S.cwd = basePath; doAction('delete', name, type); } }
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
  el('fm-sel-del').addEventListener('click', () => deleteTargets([...S.sel]));

  // ---------- Marquee (rubber-band) selection ----------
  // Mousedown on empty list space starts a drag-rect; rows it covers get
  // selected. Rows/buttons/links stay clickable — only the gaps trigger it.
  const listEl = el('fm-list');
  let marquee = null; // {x0,y0,div,moved}

  listEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (S.view === 'cols') return; // marquee applies to list + grid only
    if (e.target.closest('tr.fm-row, .fm-card, .fm-col-row, .fm-col, .fm-statusbar, button, a, input, textarea, select, .fm-crumb, .fm-preview')) return;
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
    const itemSel = S.view === 'grid' ? '.fm-card:not(.fm-up)' : 'tr.fm-row:not(.fm-up)';
    el('fm-list').querySelectorAll(itemSel).forEach((tr) => {
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

  // ---------- Keyboard (files tab only) ----------
  // Focus (S.cursor, dashed ring) and selection (S.sel, fill) are separate
  // states like in real file managers: arrows move both, Ctrl+arrows move
  // only focus, Ctrl+Space toggles the focused item, Shift extends ranges.
  function scrollCursorIntoView() {
    if (!S.cursor) return;
    const scope = S.view === 'cols' ? el('fm-cols').lastElementChild : sec;
    scope
      ?.querySelector(`[data-name="${CSS.escape(S.cursor)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  function selectName(name) {
    S.sel.clear();
    S.sel.add(name);
    S.cursor = name;
    S.anchor = name;
    applySelToDom();
    scrollCursorIntoView();
  }

  function moveCursor(delta, { extend = false, focusOnly = false } = {}) {
    const names = visibleNames();
    if (!names.length) return;
    let idx = names.indexOf(S.cursor);
    if (idx === -1) idx = names.indexOf(S.anchor);
    if (idx === -1) idx = delta > 0 ? -1 : names.length;
    const next = names[Math.max(0, Math.min(names.length - 1, idx + delta))];
    if (next === undefined) return;
    S.cursor = next;
    if (focusOnly) {
      applySelToDom();
    } else if (extend) {
      // Shift+arrows extend from the anchored position (the focused item).
      if (S.anchor == null || !names.includes(S.anchor)) {
        S.anchor = names.includes(S.cursor) ? S.cursor : next;
      }
      rangeSelect(next);
    } else {
      S.sel.clear();
      S.sel.add(next);
      S.anchor = next;
      applySelToDom();
    }
    scrollCursorIntoView();
  }

  function jumpEdge(toEnd, extend) {
    const names = visibleNames();
    if (!names.length) return;
    const t = toEnd ? names[names.length - 1] : names[0];
    S.cursor = t;
    if (extend) {
      rangeSelect(t);
    } else {
      S.sel.clear();
      S.sel.add(t);
      S.anchor = t;
      applySelToDom();
    }
    scrollCursorIntoView();
  }

  function gridCols() {
    const g = el('fm-grid');
    const card = g.querySelector('.fm-card');
    if (!card) return 4;
    const w = card.getBoundingClientRect().width + 8;
    return Math.max(1, Math.floor(g.clientWidth / w));
  }

  // Arrow-key model inside Miller columns (Finder semantics).
  function colsKey(k) {
    const last = S.cols[S.cols.length - 1];
    if (!last || last.loading) return;
    const q = S.filter.trim().toLowerCase();
    const rows = last.entries.filter(
      (e) =>
        (S.showHidden || !e.name.startsWith('.')) &&
        (!q || e.name.toLowerCase().includes(q))
    );
    const cur = [...last.sel][0];
    const idx = rows.findIndex((e) => e.name === cur);
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      const ni = k === 'ArrowDown' ? (idx === -1 ? 0 : idx + 1) : (idx === -1 ? 0 : idx - 1);
      if (ni < 0 || ni >= rows.length) return;
      const n = rows[ni].name;
      last.sel.clear();
      last.sel.add(n);
      S.sel = last.sel;
      if (S.preview && rows[ni].type !== 'dir') openPreview(n);
      renderCols();
    } else if (k === 'ArrowRight' || k === 'Enter') {
      const e2 = rows[idx];
      if (!e2) return;
      if (e2.type === 'dir') {
        closePreview();
        drill(join(last.path, e2.name));
      } else if (k === 'Enter') {
        openEntry(e2.name, e2.type);
      } else {
        renderCols();
        openPreview(e2.name);
      }
    } else if (k === 'ArrowLeft' || k === 'Backspace') {
      if (S.cols.length <= 1) return;
      S.cols.pop();
      const prev = S.cols[S.cols.length - 1];
      S.sel = prev.sel;
      S.cwd = prev.path;
      S.entries = prev.entries;
      closePreview();
      renderCrumbs();
      renderCols();
      updateStatusbar();
    }
  }

  // Type-ahead: printable keys jump to the first name starting with the
  // buffer; repeating one letter cycles its matches (Explorer behavior).
  function kbMatches(prefix) {
    const p = prefix.toLowerCase();
    return visibleEntries()
      .filter((e) => e.name.toLowerCase().startsWith(p))
      .map((e) => e.name);
  }
  function showKbChip(ok) {
    const t = el('fm-typeahead');
    t.textContent = S.kb;
    t.classList.remove('hidden');
    t.classList.toggle('fm-kb-miss', ok === false);
  }
  function resetKb() {
    S.kb = '';
    el('fm-typeahead').classList.add('hidden');
  }
  function typeahead(ch) {
    clearTimeout(S.kbTimer);
    const sameCharRun = S.kb && S.kb.split('').every((c) => c === ch);
    if (sameCharRun && kbMatches(ch).length > 1) {
      const m = kbMatches(ch);
      const i = m.indexOf(S.cursor);
      selectName(m[(i + 1) % m.length]);
      showKbChip(true);
    } else {
      S.kb = sameCharRun ? ch : S.kb + ch;
      const m = kbMatches(S.kb);
      if (m.length) {
        selectName(m[0]);
        showKbChip(true);
      } else {
        showKbChip(false);
      }
    }
    S.kbTimer = setTimeout(resetKb, 900);
  }

  document.addEventListener('keydown', (e) => {
    if (!sec.classList.contains('active') || S.editingPath) return;
    if (document.querySelector('.modal:not(.hidden)')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const kl = k.toLowerCase();
    // Enter/Space on a focused button/link should activate it, not our
    // shortcuts — every other key still works while a button holds focus.
    if (!mod && (tag === 'button' || tag === 'a') && (k === 'Enter' || k === ' ')) return;

    if (mod) {
      if (kl === 'a') {
        e.preventDefault();
        for (const n of visibleNames()) S.sel.add(n);
        applySelToDom();
      } else if (kl === 'c' && S.sel.size) {
        e.preventDefault();
        setClip({ mode: 'copy', dir: S.cwd, names: [...S.sel] });
      } else if (kl === 'x' && S.sel.size) {
        e.preventDefault();
        setClip({ mode: 'cut', dir: S.cwd, names: [...S.sel] });
      } else if (kl === 'v') {
        e.preventDefault();
        paste();
      } else if (kl === 'h') {
        e.preventDefault();
        toggleHidden();
      } else if (kl === 'n' && e.shiftKey) {
        e.preventDefault();
        el('fm-mkdir-btn').click();
      } else if (kl === 'f') {
        e.preventDefault();
        toggleSearch(true);
      } else if (kl === 'z') {
        e.preventDefault();
        e.shiftKey ? doRedo() : doUndo();
      } else if (kl === 'y') {
        e.preventDefault();
        doRedo();
      } else if (k.startsWith('Arrow')) {
        e.preventDefault();
        moveCursor(k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1, { focusOnly: true });
      } else if (kl === ' ' || k === ' ') {
        if (S.cursor) {
          e.preventDefault();
          toggleSel(S.cursor);
        }
      }
      return;
    }

    if (e.altKey && k === 'ArrowUp') {
      const par = parentOf(S.cwd);
      if (par !== S.cwd && par !== '/') {
        e.preventDefault();
        navigate(par);
      }
      return;
    }

    if (S.view === 'cols' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(k)) {
      e.preventDefault();
      colsKey(k);
      return;
    }

    switch (k) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const per = S.view === 'grid' ? gridCols() : 1;
        const d = (k === 'ArrowDown' ? 1 : -1) * per;
        if (e.shiftKey) moveCursor(d, { extend: true });
        else moveCursor(d);
        break;
      }
      case 'ArrowRight':
      case 'ArrowLeft': {
        if (S.view !== 'grid') break;
        e.preventDefault();
        const d = k === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey) moveCursor(d, { extend: true });
        else moveCursor(d);
        break;
      }
      case 'Home':
        e.preventDefault();
        jumpEdge(false, e.shiftKey);
        break;
      case 'End':
        e.preventDefault();
        jumpEdge(true, e.shiftKey);
        break;
      case 'PageDown':
        e.preventDefault();
        moveCursor(10, { extend: e.shiftKey });
        break;
      case 'PageUp':
        e.preventDefault();
        moveCursor(-10, { extend: e.shiftKey });
        break;
      case 'Enter': {
        e.preventDefault();
        const name = S.sel.size === 1 ? [...S.sel][0] : S.cursor;
        const ent = name && S.entries.find((x) => x.name === name);
        if (ent) openEntry(name, ent.type);
        break;
      }
      case 'Backspace': {
        const par = parentOf(S.cwd);
        if (par !== S.cwd && par !== '/') {
          e.preventDefault();
          navigate(par);
        }
        break;
      }
      case 'Delete':
        if (S.sel.size) {
          e.preventDefault();
          el('fm-sel-del').click();
        }
        break;
      case 'F2': {
        const name = S.sel.size ? [...S.sel][0] : S.cursor;
        if (name) {
          e.preventDefault();
          const ent = S.entries.find((x) => x.name === name);
          doAction('rename', name, ent?.type || 'file');
        }
        break;
      }
      case ' ': {
        const name = S.sel.size === 1 ? [...S.sel][0] : S.cursor;
        if (name && kindFor(name) !== 'text') {
          e.preventDefault();
          if (S.preview?.name === name) closePreview();
          else openPreview(name);
        }
        break;
      }
      case '/':
        e.preventDefault();
        el('fm-filter').focus();
        break;
      case '?':
        e.preventDefault();
        showHelp();
        break;
      default:
        if (k.length === 1 && !e.altKey) {
          e.preventDefault();
          typeahead(k.toLowerCase());
        }
    }
  });

  // ---------- Shortcut help overlay ('?') ----------
  function showHelp() {
    if (document.querySelector('.fm-help-modal')) return;
    const m = document.createElement('div');
    m.className = 'modal fm-prompt-modal fm-help-modal';
    const rows = [
      ['Flechas', 'Mover cursor / seleccionar'],
      ['Shift + flechas', 'Extender selección'],
      ['Ctrl + flechas · Ctrl+Espacio', 'Mover foco · toggle selección'],
      ['Ctrl+A', 'Seleccionar todo'],
      ['Enter', 'Abrir'],
      ['Backspace · Alt+↑', 'Subir un nivel'],
      ['Ctrl+C / X / V', 'Copiar / cortar / pegar'],
      ['Ctrl+Z · Ctrl+Shift+Z · Ctrl+Y', 'Deshacer · rehacer'],
      ['F2', 'Renombrar'],
      ['Supr', 'A la papelera (dentro de ella: definitivo)'],
      ['Ctrl+H', 'Mostrar/ocultar archivos ocultos'],
      ['Ctrl+F', 'Búsqueda recursiva'],
      ['/', 'Enfocar filtro'],
      ['Espacio', 'Vista previa rápida'],
      ['←/→ con preview', 'Archivo anterior/siguiente'],
      ['?', 'Esta ayuda'],
      ['Esc', 'Cancelar capa actual (búsqueda→clipboard→selección→preview)'],
    ];
    m.innerHTML = `
      <div class="modal-content">
        <h3>Atajos de teclado</h3>
        <table class="fm-help">${rows.map(([k, d]) => `<tr><td class="mono">${k}</td><td>${d}</td></tr>`).join('')}</table>
        <div class="modal-actions"><button class="btn-secondary fm-p-cancel">Cerrar</button></div>
      </div>`;
    const done = () => { m.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === '?') { e.stopImmediatePropagation(); e.preventDefault(); done(); } };
    document.addEventListener('keydown', onKey, true);
    m.querySelector('.fm-p-cancel').addEventListener('click', done);
    m.addEventListener('click', (e) => { if (e.target === m) done(); });
    document.body.appendChild(m);
  }

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
    if (S.searchMode) {
      S.searchQ = e.target.value;
      scheduleSearch();
      return;
    }
    S.filter = e.target.value;
    render();
  });
  el('fm-search-btn').addEventListener('click', () => toggleSearch());

  // ---------- View switcher / hidden files / sortable headers ----------
  function toggleHidden() {
    S.showHidden = !S.showHidden;
    localStorage.setItem('fm-hidden', S.showHidden ? '1' : '0');
    updateHiddenBtn();
    render();
  }

  function updateHiddenBtn() {
    const b = el('fm-hidden-btn');
    b.innerHTML = icon(S.showHidden ? 'eye' : 'eye-off');
    b.classList.toggle('active', !S.showHidden);
    b.title = S.showHidden
      ? 'Ocultar archivos ocultos (Ctrl+H)'
      : 'Mostrar archivos ocultos (Ctrl+H)';
    refreshIcons();
  }

  sec.querySelectorAll('.fm-vbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === S.view);
    b.addEventListener('click', () => setView(b.dataset.view));
  });
  el('fm-hidden-btn').addEventListener('click', toggleHidden);
  updateHiddenBtn();

  el('fm-table').querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('.fm-th-sort');
    if (!th) return;
    const k = th.dataset.sort;
    if (S.sort.key === k) S.sort.dir *= -1;
    else S.sort = { key: k, dir: 1 };
    localStorage.setItem('fm-sort', JSON.stringify(S.sort));
    render();
  });

  // Broken image thumbnails fall back to the file-type icon behind them.
  el('fm-grid').addEventListener(
    'error',
    (e) => {
      if (e.target.tagName === 'IMG') e.target.classList.add('fm-thumb-broken');
    },
    true
  );

  el('fm-mkdir-btn').addEventListener('click', async () => {
    const name = await fmPrompt('Nueva carpeta', 'Nombre');
    if (!name) return;
    if (name.includes('/') || name === '.' || name === '..') {
      toast('Nombre inválido — sin "/", "." ni ".."', 'error');
      return;
    }
    const p = join(S.cwd, name);
    try {
      await apiMkdir(p);
      const op = {
        label: `Nueva carpeta ${name}`,
        _ids: [],
        undo: async () => { const rr = await apiTrash([p]); op._ids = (rr.items || []).map((i) => i.trashed); },
        redo: async () => { await apiRestore(op._ids); },
      };
      journaled(op);
      toast('Carpeta creada — Ctrl+Z deshace', 'ok', '', 2500);
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

  // Per-conflict choice modal — Explorer-style overwrite/rename/skip with an
  // "apply to all" toggle for the rest of the batch.
  function uploadConflictAsk(name, remaining) {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'modal fm-prompt-modal';
      m.innerHTML = `
        <div class="modal-content">
          <h3>«<span class="fp-n"></span>» ya existe</h3>
          <p class="fm-conflict-note">Elegí qué hacer${remaining > 1 ? ` — quedan ${remaining} conflictos` : ''}.</p>
          ${remaining > 1 ? '<label class="fm-conflict-all"><input type="checkbox"> Aplicar a todos los demás</label>' : ''}
          <div class="modal-actions fm-conflict-acts">
            <button class="btn-secondary" data-act="skip">Omitir</button>
            <button class="btn-secondary" data-act="rename">Conservar ambos</button>
            <button class="btn-danger" data-act="overwrite">Sobreescribir</button>
          </div>
        </div>`;
      m.querySelector('.fp-n').textContent = name;
      const all = m.querySelector('.fm-conflict-all input');
      const done = (v) => { m.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done({ action: 'skip', apply: false }); } };
      document.addEventListener('keydown', onKey, true);
      m.querySelectorAll('[data-act]').forEach((b) =>
        b.addEventListener('click', () => done({ action: b.dataset.act, apply: Boolean(all?.checked) }))
      );
      m.addEventListener('click', (e) => { if (e.target === m) done({ action: 'skip', apply: false }); });
      document.body.appendChild(m);
    });
  }

  async function uploadFiles(files, destDir) {
    destDir = destDir || S.cwd;
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    // 1. Plan every file: relative path → target dir + final name.
    const plan = list.map((f) => {
      const rel = (f.webkitRelativePath || f._relPath || f.name || 'archivo').replace(/^\/+/, '');
      const dirPart = rel.split('/').slice(0, -1).join('/');
      return {
        f,
        rel,
        dir: dirPart ? join(destDir, dirPart) : destDir,
        name: rel.split('/').pop() || 'archivo',
        finalName: null,
        skip: false,
        overwritten: false,
      };
    });
    // 2. Existing names per target dir (fetch fresh for non-cwd dirs).
    const dirSet = new Map();
    for (const d of new Set(plan.map((p) => p.dir))) dirSet.set(d, null);
    for (const d of dirSet.keys()) {
      dirSet.set(d, new Set(d === S.cwd ? S.entries.map((e) => e.name) : await dirNames(d)));
    }
    // 3. Resolve conflicts — overwrite / keep-both / skip, optionally batch.
    const conflicts = plan.filter((p) => dirSet.get(p.dir).has(p.name));
    if (conflicts.length) {
      let applyAll = null;
      for (const p of conflicts) {
        let act = applyAll;
        if (!act) {
          const left = conflicts.filter((c) => !c.resolved).length;
          const r = await uploadConflictAsk(p.name, left);
          p.resolved = true;
          act = r?.action || 'skip';
          if (r?.apply) applyAll = act;
        }
        p.resolved = true;
        if (act === 'skip') p.skip = true;
        else if (act === 'rename') p.finalName = freeName(p.name, dirSet.get(p.dir));
        else p.overwritten = true;
        dirSet.get(p.dir).add(p.finalName || p.name);
      }
    }
    for (const p of plan) if (!p.finalName) p.finalName = p.name;
    const todo = plan.filter((p) => !p.skip);

    const total = todo.length;
    if (!total) return toast('Subida omitida — nada que subir', 'warn', '', 2500);
    uploadAbort = new AbortController();
    el('fm-up-cancel').disabled = false;
    setUploadBar(0, total, `Subiendo 0/${total}…`);
    const failed = [];
    const created = [];
    let okCount = 0;
    for (const p of todo) {
      if (uploadAbort.signal.aborted) break;
      try {
        const fd = new FormData();
        fd.append('rel', p.rel);
        fd.append('name', p.finalName);
        fd.append('file', p.f, p.finalName);
        const res = await fetch(`/api/files/upload?path=${encodeURIComponent(p.dir)}`, {
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
        if (!p.overwritten) created.push(join(p.dir, p.finalName));
      } catch (err) {
        if (uploadAbort.signal.aborted) break;
        const why = err.status === 413 ? 'El archivo supera el límite de 64 MB' : err.message || 'Error';
        failed.push(`${p.rel}: ${why}`);
      }
      setUploadBar(okCount + failed.length, total, `Subiendo ${okCount + failed.length}/${total}…`);
    }
    const aborted = uploadAbort.signal.aborted;
    uploadAbort = null;
    el('fm-upload-progress').classList.add('hidden');
    // Journal only files that didn't overwrite anything — a clobbered file
    // can't be brought back.
    if (created.length) {
      const op = {
        label: `Subir ${created.length} archivo${created.length === 1 ? '' : 's'}`,
        _ids: [],
        undo: async () => { const rr = await apiTrash(created); op._ids = (rr.items || []).map((i) => i.trashed); },
        redo: async () => { await apiRestore(op._ids); },
      };
      journaled(op);
    }
    if (aborted) {
      toast(`Subida cancelada — ${okCount} ok, ${total - okCount - failed.length} pendientes`, 'warn', '', 4000);
    } else if (failed.length) {
      toast(`Error al subir ${failed.length} archivo${failed.length === 1 ? '' : 's'}`, 'error', failed.slice(0, 6).join('\n'));
    }
    if (okCount) {
      const ow = todo.filter((p) => p.overwritten).length;
      toast(`${okCount} subido${okCount === 1 ? '' : 's'}${ow ? ` (${ow} sobreescrito${ow === 1 ? '' : 's'} — no deshacible)` : ''}`, 'ok', '', 3500);
    }
    navigate(destDir === S.cwd ? S.cwd : destDir);
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
    // Dropping onto a folder row targets that folder; the overlay falls back
    // to the cwd (dropTargetOf sees no row under an intercepting overlay).
    const dest = dropTargetOf(e) || S.cwd;
    try {
      const files = await collectDropped(e.dataTransfer);
      uploadFiles(files, dest);
    } catch {
      uploadFiles(e.dataTransfer.files, dest);
    }
  });

  // ---------- Internal drag & drop (move/copy between folders) ----------
  // Custom drags carry our marker type only — hasFiles() above keeps the two
  // pipelines cleanly separated (OS drops have 'Files', ours don't).
  let springTimer = 0;
  let springDir = null;

  const clearSpring = () => { springDir = null; clearTimeout(springTimer); };
  const clearDropMarks = () => {
    sec.querySelectorAll('.fm-drop-target').forEach((n) => n.classList.remove('fm-drop-target'));
  };

  // Resolve where a drag/drop lands: folder row, up-row, breadcrumb, column bg.
  function dropTargetOf(e) {
    const row = e.target.closest('tr.fm-row, .fm-card, .fm-col-row');
    if (row && row.dataset.type === 'dir') {
      const colI = row.dataset.col !== undefined ? parseInt(row.dataset.col, 10) : null;
      if (row.dataset.name === '..') {
        return colI !== null ? S.cols[colI - 1]?.path || null : parentOf(S.cwd);
      }
      const base = colI !== null ? S.cols[colI]?.path || S.cwd : S.cwd;
      return join(base, row.dataset.name);
    }
    const crumb = e.target.closest('.fm-crumb');
    if (crumb) return crumb.dataset.p;
    const col = e.target.closest('.fm-col');
    if (col) return S.cols[parseInt(col.dataset.col, 10)]?.path || null;
    return null;
  }

  // Finder-style spring-load: hovering a folder mid-drag opens it after 700ms.
  function scheduleSpring(dir) {
    if (springDir === dir) return;
    clearSpring();
    springDir = dir;
    springTimer = setTimeout(() => {
      springDir = null;
      if (!S.dragging) return;
      navigate(dir);
    }, 700);
  }

  listEl.addEventListener('dragstart', (e) => {
    const row = e.target.closest('tr.fm-row, .fm-card, .fm-col-row');
    if (!row || row.dataset.name === '..') { e.preventDefault(); return; }
    const colI = row.dataset.col !== undefined ? parseInt(row.dataset.col, 10) : null;
    const dir = colI !== null ? S.cols[colI].path : S.cwd;
    const selSet = colI !== null ? S.cols[colI].sel : S.sel;
    // Dragging an unselected item grabs just it; a selected row drags the group.
    if (!selSet.has(row.dataset.name)) {
      selSet.clear();
      selSet.add(row.dataset.name);
      applySelToDom();
    }
    S.dragging = { dir, names: [...selSet] };
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('application/x-axon-fm', '1');
    e.dataTransfer.setData('text/plain', S.dragging.names.join(', '));
  });

  const dndOver = (e) => {
    if (!S.dragging) return;
    let dir = dropTargetOf(e);
    // Same dir or the dragged dir itself are not valid targets.
    if (dir === S.dragging.dir) dir = null;
    if (dir && S.dragging.names.length === 1 && dir === join(S.dragging.dir, S.dragging.names[0])) dir = null;
    if (!dir) {
      clearSpring();
      clearDropMarks();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.ctrlKey || e.altKey ? 'copy' : 'move';
    clearDropMarks();
    e.target
      .closest('tr.fm-row, .fm-card, .fm-col-row, .fm-crumb, .fm-col')
      ?.classList.add('fm-drop-target');
    scheduleSpring(dir);
  };

  const dndDrop = async (e) => {
    if (!S.dragging) return;
    const dir = dropTargetOf(e);
    clearSpring();
    clearDropMarks();
    const drag = S.dragging;
    S.dragging = null;
    if (!dir || dir === drag.dir) return;
    e.preventDefault();
    e.stopPropagation();
    const mode = e.ctrlKey || e.altKey ? 'copy' : 'cut';
    const r = await transferItems(drag.names, drag.dir, dir, mode);
    journalTransfer(r, mode, drag.dir, dir);
    const n = r.moved.length + r.copied.length;
    if (n) toast(`${n} ${mode === 'cut' ? 'movido' : 'copiado'}${n === 1 ? '' : 's'} — Ctrl+Z deshace`, 'ok', '', 3000);
    if (r.failed.length) toast(`${r.failed.length} fallaron`, 'error', r.failed.slice(0, 4).join('\n'));
    if (r.skipped && !n && !r.failed.length) toast('Mismo origen y destino', 'warn', '', 2000);
    // Refresh whichever view holds the destination.
    if (S.view === 'cols') {
      const col = S.cols.find((c) => c.path === dir || c.path === drag.dir);
      if (col) {
        api(`/api/files?path=${encodeURIComponent(col.path)}`)
          .then((d) => { col.entries = d.entries || []; renderCols(); })
          .catch(() => {});
      }
    } else {
      navigate(S.cwd);
    }
  };

  const dndEnd = () => { S.dragging = null; clearSpring(); clearDropMarks(); };

  listEl.addEventListener('dragover', dndOver);
  listEl.addEventListener('drop', dndDrop);
  el('fm-breadcrumb').addEventListener('dragover', dndOver);
  el('fm-breadcrumb').addEventListener('drop', dndDrop);
  document.addEventListener('dragend', dndEnd);
  document.addEventListener('drop', dndEnd); // dropped outside → clear state

  // Trash location — resolved once; needed for in-trash behaviors.
  api('/api/files/trash/info')
    .then((r) => { S.trashDir = r.dir; })
    .catch(() => {});
})();
