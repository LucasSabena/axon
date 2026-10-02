/* AXON — feature: Biblioteca
 * Media library over host folders: browse by type / date / folder / collection,
 * viewer, organize (favorites, collections, move, rename, trash), chunked
 * uploads, and temporary public share links (/s/<token>).
 * Reuses app.js globals: $, $$, api, esc, icon, toast, errToast, confirmDialog,
 * refreshIcons, activeTabName, unloadBrowser.
 */
(() => {
  'use strict';

  const KINDS = [
    { k: 'image', label: 'Imágenes', ic: 'image' },
    { k: 'video', label: 'Videos', ic: 'film' },
    { k: 'raw', label: 'Fotos RAW', ic: 'aperture' },
    { k: 'vector', label: 'Vectores / SVG', ic: 'pen-tool' },
    { k: 'pdf', label: 'PDF', ic: 'file-text' },
    { k: 'design', label: 'Diseño (PSD…)', ic: 'layers' },
    { k: 'audio', label: 'Audio', ic: 'music' },
    { k: 'doc', label: 'Documentos', ic: 'file-type' },
    { k: 'other', label: 'Otros', ic: 'file' },
  ];
  const KIND = Object.fromEntries(KINDS.map((x) => [x.k, x]));
  const KIND_ONE = { image: 'Imagen', raw: 'Foto RAW', video: 'Video', audio: 'Audio', pdf: 'PDF', vector: 'Vector', design: 'Diseño', doc: 'Documento', other: 'Archivo' };
  const TTLS = [
    { s: 3600, label: '1 hora' },
    { s: 86400, label: '1 día' },
    { s: 7 * 86400, label: '7 días' },
    { s: 30 * 86400, label: '30 días' },
    { s: 0, label: 'Sin vencimiento' },
  ];
  const PAGE = 240;

  const L = {
    loaded: false,
    items: [],
    byId: new Map(),
    favs: new Set(),
    cols: [],
    roots: [],
    home: '',
    uploadRoot: '',
    shareBase: '',
    scannedAt: 0,
    view: JSON.parse(localStorage.getItem('lib-view') || '{"type":"all"}'),
    q: '',
    sort: localStorage.getItem('lib-sort') || 'date-desc',
    group: localStorage.getItem('lib-group') || 'month',
    size: Number(localStorage.getItem('lib-size') || 170),
    layout: localStorage.getItem('lib-layout') || 'grid',
    sel: new Set(),
    lastIdx: -1,
    list: [],
    shown: 0,
    sharesCount: 0,
  };

  const fmtSize = (b) => {
    if (b == null) return '';
    if (b < 1024) return `${b} B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let v = b, i = -1;
    do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
  };
  const fmtDur = (d) => {
    if (!d) return '';
    d = Math.round(d);
    const h = Math.floor(d / 3600), m = Math.floor((d % 3600) / 60), s = d % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
  };
  const when = (it) => it.t || it.m;
  const fmtDate = (ms, opts) => new Date(ms).toLocaleDateString('es-AR', opts || { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDateTime = (ms) => new Date(ms).toLocaleString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));
  const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const prettyPath = (p) => (L.home && p.startsWith(L.home) ? '~' + p.slice(L.home.length) : p);
  const thumbUrl = (it) => (it.th === 2 ? `/api/library/thumb/${it.id}` : `/api/library/thumb/${it.id}?k=${it.tk}`);
  const rootOf = (p) => [L.uploadRoot, ...L.roots].filter(Boolean).sort((a, b) => b.length - a.length).find((r) => p === r || p.startsWith(r + '/'));
  const expiresIn = (ms) => {
    if (!ms) return 'Sin vencimiento';
    const d = ms - Date.now();
    if (d <= 0) return 'Vencido';
    const h = d / 36e5;
    if (h < 1) return `Vence en ${Math.max(1, Math.round(d / 6e4))} min`;
    if (h < 48) return `Vence en ${Math.round(h)} h`;
    return `Vence en ${Math.round(h / 24)} días`;
  };

  function qrSvg(text) {
    try {
      if (typeof qrcode === 'function') {
        const q = qrcode(0, 'M');
        q.addData(text);
        q.make();
        return q.createSvgTag(4, 8);
      }
    } catch { /* no qr */ }
    return '';
  }

  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Link copiado', 'ok', '', 2500);
  }

  // ---------- DOM ----------

  function activateTab() {
    $$('.tab-btn').forEach((b) => b.classList.remove('active'));
    $$('.tab-content').forEach((t) => t.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="library"]')?.classList.add('active');
    $('#tab-library')?.classList.add('active');
    try {
      if (typeof activeTabName !== 'undefined') {
        if (activeTabName === 'navegador' && typeof unloadBrowser === 'function') unloadBrowser();
        activeTabName = 'library';
      }
    } catch { /* older app.js */ }
    document.body.classList.remove('sidebar-open');
    if (!L.loaded) load();
    else render();
  }

  function ensureDom() {
    if ($('#tab-library')) return;
    const nav = $('.sidebar-nav');
    const anchor = document.querySelector('.tab-btn[data-tab="terminal"]');
    if (nav) {
      const btn = document.createElement('button');
      btn.className = 'nav-item tab-btn';
      btn.dataset.tab = 'library';
      btn.innerHTML = `${icon('images')}<span class="nav-label">Biblioteca</span><span class="nav-count" id="nav-count-library"></span>`;
      if (anchor) nav.insertBefore(btn, anchor);
      else nav.appendChild(btn);
      btn.addEventListener('click', activateTab);
    }
    const main = $('main.content');
    if (!main) return;
    const sec = document.createElement('section');
    sec.id = 'tab-library';
    sec.className = 'tab-content';
    sec.innerHTML = `
      <div class="lib-top">
        <button class="icon-btn lib-side-toggle" id="lib-side-toggle" title="Secciones">${icon('panel-left')}</button>
        <div class="lib-title"><h2 id="lib-h">Biblioteca</h2><span class="lib-sub" id="lib-sub"></span></div>
        <div class="lib-search">${icon('search')}<input id="lib-q" placeholder="Buscar por nombre, carpeta, tipo…" autocomplete="off"><kbd>/</kbd></div>
        <div class="lib-tools">
          <select id="lib-sort" class="lib-select" title="Ordenar">
            <option value="date-desc">Más recientes</option>
            <option value="date-asc">Más antiguos</option>
            <option value="name-asc">Nombre A→Z</option>
            <option value="name-desc">Nombre Z→A</option>
            <option value="size-desc">Más pesados</option>
            <option value="size-asc">Más livianos</option>
            <option value="kind">Tipo</option>
          </select>
          <select id="lib-group" class="lib-select" title="Agrupar">
            <option value="month">Por mes</option>
            <option value="day">Por día</option>
            <option value="year">Por año</option>
            <option value="folder">Por carpeta</option>
            <option value="kind">Por tipo</option>
            <option value="none">Sin agrupar</option>
          </select>
          <input type="range" id="lib-size" min="96" max="320" step="8" title="Tamaño de miniaturas">
          <div class="lib-seg">
            <button data-layout="grid" title="Cuadrícula">${icon('layout-grid')}</button>
            <button data-layout="list" title="Lista">${icon('list')}</button>
          </div>
          <button class="btn-primary" id="lib-upload">${icon('upload')}<span>Subir</span></button>
          <button class="icon-btn" id="lib-refresh" title="Volver a escanear">${icon('refresh-cw')}</button>
          <button class="icon-btn" id="lib-settings" title="Carpetas y ajustes">${icon('settings-2')}</button>
        </div>
      </div>
      <div class="lib-layout">
        <aside class="lib-side" id="lib-side"></aside>
        <div class="lib-main" id="lib-main">
          <div class="lib-crumbs" id="lib-crumbs"></div>
          <div class="lib-body" id="lib-body"><div class="lib-empty">${icon('loader')} Cargando biblioteca…</div></div>
        </div>
      </div>
      <div class="lib-bulk hidden" id="lib-bulk"></div>
      <div class="lib-uploads hidden" id="lib-uploads"></div>
      <div class="lib-drop hidden" id="lib-drop"><div>${icon('upload-cloud')}<p>Soltá para subir</p><span id="lib-drop-dest"></span></div></div>
      <input type="file" id="lib-file" multiple hidden>
      <div class="lib-viewer hidden" id="lib-viewer"></div>
      <div class="modal hidden" id="lib-modal"><div class="modal-content lib-modal-content" id="lib-modal-c"></div></div>`;
    main.appendChild(sec);

    $('#lib-q').addEventListener('input', debounce((e) => { L.q = e.target.value.trim(); render(); }, 160));
    $('#lib-sort').value = L.sort;
    $('#lib-group').value = L.group;
    $('#lib-size').value = L.size;
    $('#lib-sort').addEventListener('change', (e) => { L.sort = e.target.value; localStorage.setItem('lib-sort', L.sort); render(); });
    $('#lib-group').addEventListener('change', (e) => { L.group = e.target.value; localStorage.setItem('lib-group', L.group); render(); });
    $('#lib-size').addEventListener('input', (e) => {
      L.size = Number(e.target.value);
      localStorage.setItem('lib-size', L.size);
      $('#lib-body').style.setProperty('--tile', L.size + 'px');
    });
    sec.querySelectorAll('.lib-seg button').forEach((b) => b.addEventListener('click', () => {
      L.layout = b.dataset.layout;
      localStorage.setItem('lib-layout', L.layout);
      render();
    }));
    $('#lib-upload').addEventListener('click', () => $('#lib-file').click());
    $('#lib-file').addEventListener('change', (e) => { startUploads([...e.target.files]); e.target.value = ''; });
    $('#lib-refresh').addEventListener('click', rescan);
    $('#lib-settings').addEventListener('click', openSettings);
    $('#lib-side-toggle').addEventListener('click', () => sec.classList.toggle('side-open'));
    $('#lib-modal').addEventListener('mousedown', (e) => { if (e.target.id === 'lib-modal') closeModal(); });

    // Drag & drop upload anywhere on the tab.
    let dragDepth = 0;
    sec.addEventListener('dragenter', (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault();
      dragDepth++;
      $('#lib-drop-dest').textContent = `Destino: ${prettyPath(uploadDest() || L.uploadRoot + '/<tipo>')}`;
      $('#lib-drop').classList.remove('hidden');
    });
    sec.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
    sec.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#lib-drop').classList.add('hidden'); } });
    sec.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      dragDepth = 0;
      $('#lib-drop').classList.add('hidden');
      startUploads([...e.dataTransfer.files]);
    });

    document.addEventListener('keydown', onKey);
    refreshIcons();
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function tabActive() {
    return $('#tab-library')?.classList.contains('active');
  }

  // ---------- Data ----------

  async function load() {
    try {
      const d = await api('/api/library');
      L.loaded = true;
      L.items = d.items;
      L.byId = new Map(d.items.map((it) => [it.id, it]));
      L.favs = new Set(d.favorites);
      L.cols = d.collections;
      L.roots = d.roots;
      L.home = d.home;
      L.uploadRoot = d.uploadRoot;
      L.shareBase = d.shareBase;
      L.scannedAt = d.scannedAt;
      L.sharesCount = d.shares;
      for (const id of [...L.sel]) if (!L.byId.has(id)) L.sel.delete(id);
      const nc = $('#nav-count-library');
      if (nc) nc.textContent = d.items.length ? d.items.length.toLocaleString('es-AR') : '';
      render();
      statusLine(d);
      if (d.scanning || d.metaPending || d.thumbsPending) pollStatus();
    } catch (err) {
      errToast(err);
      $('#lib-body').innerHTML = `<div class="lib-empty">${icon('alert-triangle')} No se pudo cargar la biblioteca</div>`;
      refreshIcons();
    }
  }

  let pollTimer = null;
  function pollStatus() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        const s = await api('/api/library/status');
        statusLine(s);
        if (s.scannedAt !== L.scannedAt && !s.scanning) return load();
        if (s.scanning || s.metaPending || s.thumbsPending) pollStatus();
        else if (tabActive()) load();
      } catch { /* transient */ }
    }, 4000);
  }

  function statusLine(s) {
    const bits = [];
    if (s.scanning) bits.push('escaneando carpetas…');
    if (s.metaPending) bits.push(`leyendo metadatos (${s.metaPending})`);
    if (s.thumbsPending) bits.push(`generando miniaturas (${s.thumbsPending})`);
    const el = $('#lib-status');
    if (el) el.innerHTML = bits.length ? `${icon('loader', 'spin')} ${esc(bits.join(' · '))}` : '';
    refreshIcons();
  }

  async function rescan() {
    toast('Escaneando carpetas…', 'ok', '', 2500);
    try {
      await api('/api/library/rescan?wait=1', { method: 'POST' });
      await load();
    } catch (err) { errToast(err); }
  }

  // ---------- Filtering / grouping ----------

  function setView(v) {
    L.view = v;
    localStorage.setItem('lib-view', JSON.stringify(v));
    L.sel.clear();
    $('#tab-library')?.classList.remove('side-open');
    $('#lib-main')?.scrollTo?.(0, 0);
    render();
  }

  function baseList() {
    const v = L.view;
    let list = L.items;
    if (v.type === 'fav') list = list.filter((it) => L.favs.has(it.id));
    else if (v.type === 'recent') {
      const cut = Date.now() - 30 * 86400e3;
      list = list.filter((it) => it.m >= cut);
    } else if (v.type === 'kind') list = list.filter((it) => it.k === v.value);
    else if (v.type === 'col') {
      const col = L.cols.find((c) => c.id === v.value);
      const ids = new Set(col ? col.ids : []);
      list = list.filter((it) => ids.has(it.id));
    } else if (v.type === 'folder') {
      list = L.q ? list.filter((it) => it.p.startsWith(v.value + '/')) : list.filter((it) => dirOf(it.p) === v.value);
    }
    if (L.q) {
      const terms = L.q.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((it) => {
        const hay = `${it.p} ${KIND_ONE[it.k]} ${it.e}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    return list;
  }

  function sortList(list) {
    const s = L.sort;
    const cmpName = (a, b) => a.n.localeCompare(b.n, 'es', { numeric: true, sensitivity: 'base' });
    const arr = list.slice();
    if (s === 'date-desc') arr.sort((a, b) => when(b) - when(a));
    else if (s === 'date-asc') arr.sort((a, b) => when(a) - when(b));
    else if (s === 'name-asc') arr.sort(cmpName);
    else if (s === 'name-desc') arr.sort((a, b) => cmpName(b, a));
    else if (s === 'size-desc') arr.sort((a, b) => b.s - a.s);
    else if (s === 'size-asc') arr.sort((a, b) => a.s - b.s);
    else if (s === 'kind') arr.sort((a, b) => a.k.localeCompare(b.k) || when(b) - when(a));
    return arr;
  }

  function groupKey(it) {
    const g = L.group;
    if (g === 'none') return ['', ''];
    if (g === 'kind') return [it.k, KIND[it.k]?.label || it.k];
    if (g === 'folder') { const d = dirOf(it.p); return [d, prettyPath(d)]; }
    const d = new Date(when(it));
    if (g === 'year') return [String(d.getFullYear()), String(d.getFullYear())];
    if (g === 'day') return [d.toDateString(), d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })];
    const label = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    return [`${d.getFullYear()}-${d.getMonth()}`, label.charAt(0).toUpperCase() + label.slice(1)];
  }

  // Subfolders of a folder view, with counts and a cover image.
  function subfolders(dir) {
    const map = new Map();
    for (const it of L.items) {
      if (!it.p.startsWith(dir + '/')) continue;
      const rest = it.p.slice(dir.length + 1);
      const slash = rest.indexOf('/');
      if (slash < 0) continue;
      const name = rest.slice(0, slash);
      let f = map.get(name);
      if (!f) map.set(name, (f = { name, path: `${dir}/${name}`, count: 0, size: 0, cover: null }));
      f.count++;
      f.size += it.s;
      if (it.th >= 1 && (!f.cover || when(it) > when(f.cover))) f.cover = it;
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  }

  // ---------- Render ----------

  function render() {
    if (!$('#tab-library')) return;
    renderSide();
    if (L.view.type === 'shares') return renderShares();
    renderCrumbs();
    L.list = sortList(baseList());
    L.shown = 0;
    const body = $('#lib-body');
    body.style.setProperty('--tile', L.size + 'px');
    body.className = `lib-body layout-${L.layout}`;
    $$('#tab-library .lib-seg button').forEach((b) => b.classList.toggle('active', b.dataset.layout === L.layout));
    $('#lib-size').style.display = L.layout === 'grid' ? '' : 'none';
    let html = '';
    if (L.view.type === 'folder' && !L.q) {
      const subs = subfolders(L.view.value);
      if (subs.length) {
        html += `<div class="lib-folders">${subs.map((f) => `
          <button class="lib-folder" data-path="${esc(f.path)}">
            <span class="lib-folder-cover">${f.cover ? `<img loading="lazy" src="${thumbUrl(f.cover)}" alt="">` : icon('folder')}</span>
            <span class="lib-folder-meta"><b>${esc(f.name)}</b><small>${f.count.toLocaleString('es-AR')} archivos · ${fmtSize(f.size)}</small></span>
          </button>`).join('')}</div>`;
      }
    }
    const total = L.list.reduce((a, it) => a + it.s, 0);
    $('#lib-sub').textContent = `${L.list.length.toLocaleString('es-AR')} archivos · ${fmtSize(total)}`;
    if (!L.list.length) {
      html += `<div class="lib-empty">${icon(L.q ? 'search-x' : 'image-off')}<p>${L.q ? 'Nada coincide con la búsqueda' : emptyMsg()}</p></div>`;
      body.innerHTML = html;
      body.querySelectorAll('.lib-folder').forEach((b) => b.addEventListener('click', () => setView({ type: 'folder', value: b.dataset.path })));
      updateBulk();
      refreshIcons();
      return;
    }
    if (L.layout === 'list') {
      html += `<div class="lib-list-head"><span></span><span>Nombre</span><span>Tipo</span><span>Tamaño</span><span>Fecha</span><span>Carpeta</span></div>`;
    }
    html += '<div class="lib-groups" id="lib-groups"></div><div class="lib-sentinel" id="lib-sentinel"></div>';
    body.innerHTML = html;
    body.querySelectorAll('.lib-folder').forEach((b) => b.addEventListener('click', () => setView({ type: 'folder', value: b.dataset.path })));
    renderMore();
    setupSentinel();
    updateBulk();
  }

  function emptyMsg() {
    const v = L.view;
    if (v.type === 'fav') return 'Todavía no marcaste favoritos — tocá la ⭐ en cualquier archivo';
    if (v.type === 'col') return 'Esta colección está vacía. Seleccioná archivos y usá "Agregar a colección"';
    if (v.type === 'folder') return 'Esta carpeta no tiene archivos multimedia';
    if (v.type === 'recent') return 'No hay archivos de los últimos 30 días';
    return 'No hay archivos. Subí algunos o agregá carpetas en ajustes ⚙';
  }

  let lastGroupKey = null;
  function renderMore() {
    const wrap = $('#lib-groups');
    if (!wrap) return;
    if (L.shown === 0) lastGroupKey = null;
    const end = Math.min(L.list.length, L.shown + PAGE);
    let grid = wrap.lastElementChild?.querySelector('.lib-grid');
    const frag = document.createDocumentFragment();
    for (let i = L.shown; i < end; i++) {
      const it = L.list[i];
      const [gk, gl] = groupKey(it);
      if (gk !== lastGroupKey || !grid) {
        lastGroupKey = gk;
        const g = document.createElement('div');
        g.className = 'lib-group';
        g.innerHTML = gl ? `<div class="lib-group-h"><span>${esc(gl)}</span><button class="lib-group-sel" data-gk="${esc(gk)}" title="Seleccionar grupo">${icon('check-square')}</button></div><div class="lib-grid"></div>` : '<div class="lib-grid"></div>';
        frag.appendChild(g);
        wrap.appendChild(frag);
        grid = g.querySelector('.lib-grid');
        g.querySelector('.lib-group-sel')?.addEventListener('click', () => selectGroup(gk));
      }
      grid.insertAdjacentHTML('beforeend', L.layout === 'list' ? rowHtml(it, i) : tileHtml(it, i));
    }
    L.shown = end;
    refreshIcons();
  }

  function tileHtml(it, i) {
    const sel = L.sel.has(it.id);
    const fav = L.favs.has(it.id);
    const media = it.th === -1
      ? `<span class="lib-ext k-${it.k}">${icon(KIND[it.k]?.ic || 'file')}<b>${esc(it.e.toUpperCase() || '?')}</b></span>`
      : `<img loading="lazy" decoding="async" src="${thumbUrl(it)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'lib-ext k-${it.k}',innerHTML:'<b>${esc(it.e.toUpperCase())}</b>'}))">`;
    const badge = it.k === 'video'
      ? `<span class="lib-badge">${icon('play')}${fmtDur(it.d)}</span>`
      : it.k !== 'image' ? `<span class="lib-badge">${esc(it.e.toUpperCase())}</span>` : '';
    return `<div class="lib-tile${sel ? ' sel' : ''}" data-i="${i}" data-id="${it.id}" title="${esc(it.n)}">
      ${media}${badge}
      <button class="lib-check" data-act="sel" aria-label="Seleccionar">${icon('check')}</button>
      <button class="lib-fav${fav ? ' on' : ''}" data-act="fav" aria-label="Favorito">${icon('star')}</button>
      <span class="lib-cap">${esc(it.n)}</span>
    </div>`;
  }

  function rowHtml(it, i) {
    const sel = L.sel.has(it.id);
    const media = it.th === -1 ? `<span class="lib-ext k-${it.k}">${icon(KIND[it.k]?.ic || 'file')}</span>` : `<img loading="lazy" src="${thumbUrl(it)}" alt="">`;
    return `<div class="lib-row${sel ? ' sel' : ''}" data-i="${i}" data-id="${it.id}">
      <span class="lib-row-th"><button class="lib-check" data-act="sel">${icon('check')}</button>${media}</span>
      <span class="lib-row-n">${L.favs.has(it.id) ? `<span class="lib-star">${icon('star')}</span>` : ''}${esc(it.n)}</span>
      <span>${esc(KIND_ONE[it.k])}${it.d ? ' · ' + fmtDur(it.d) : ''}</span>
      <span>${fmtSize(it.s)}</span>
      <span>${fmtDate(when(it))}</span>
      <span class="lib-row-dir" title="${esc(dirOf(it.p))}">${esc(prettyPath(dirOf(it.p)))}</span>
    </div>`;
  }

  let observer = null;
  function setupSentinel() {
    observer?.disconnect();
    const s = $('#lib-sentinel');
    if (!s) return;
    observer = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting) && L.shown < L.list.length) renderMore();
    }, { rootMargin: '1200px' });
    observer.observe(s);
  }

  // Delegated tile interactions.
  document.addEventListener('click', (e) => {
    const tile = e.target.closest('#tab-library .lib-tile, #tab-library .lib-row');
    if (!tile) return;
    const i = Number(tile.dataset.i);
    const it = L.list[i];
    if (!it) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fav') { e.stopPropagation(); return toggleFav([it.id], !L.favs.has(it.id)); }
    if (act === 'sel' || e.ctrlKey || e.metaKey || (L.sel.size && !e.shiftKey)) return toggleSel(i, e.shiftKey);
    if (e.shiftKey) return toggleSel(i, true);
    openViewer(i);
  });

  document.addEventListener('contextmenu', (e) => {
    const tile = e.target.closest('#tab-library .lib-tile, #tab-library .lib-row');
    if (!tile || typeof showCtxMenu !== 'function') return;
    e.preventDefault();
    const it = L.list[Number(tile.dataset.i)];
    if (!it) return;
    const ids = L.sel.has(it.id) ? [...L.sel] : [it.id];
    showCtxMenu([
      { icon: 'eye', label: 'Ver', run: () => openViewer(Number(tile.dataset.i)) },
      { icon: 'share-2', label: ids.length > 1 ? `Compartir ${ids.length} archivos` : 'Compartir link', run: () => openShareModal(ids) },
      { icon: 'download', label: 'Descargar', run: () => downloadIds(ids) },
      { icon: 'star', label: L.favs.has(it.id) ? 'Quitar de favoritos' : 'Favorito', run: () => toggleFav(ids, !L.favs.has(it.id)) },
      { icon: 'folder-plus', label: 'Agregar a colección…', run: () => addToCollection(ids) },
      { icon: 'folder-input', label: 'Mover a…', run: () => openMove(ids) },
      ...(ids.length === 1 ? [{ icon: 'pencil', label: 'Renombrar', run: () => renameItem(it) }] : []),
      { icon: 'folder-open', label: 'Ir a la carpeta', run: () => setView({ type: 'folder', value: dirOf(it.p) }) },
      { icon: 'trash-2', label: 'Eliminar', danger: true, run: () => trashIds(ids) },
    ], e.clientX, e.clientY);
  });

  function toggleSel(i, range) {
    const it = L.list[i];
    if (range && L.lastIdx >= 0) {
      const [a, b] = [Math.min(L.lastIdx, i), Math.max(L.lastIdx, i)];
      for (let j = a; j <= b; j++) L.sel.add(L.list[j].id);
    } else if (L.sel.has(it.id)) L.sel.delete(it.id);
    else L.sel.add(it.id);
    L.lastIdx = i;
    syncSelClasses();
  }

  function selectGroup(gk) {
    const ids = L.list.filter((it) => groupKey(it)[0] === gk).map((it) => it.id);
    const all = ids.every((id) => L.sel.has(id));
    ids.forEach((id) => (all ? L.sel.delete(id) : L.sel.add(id)));
    syncSelClasses();
  }

  function syncSelClasses() {
    $$('#lib-body .lib-tile, #lib-body .lib-row').forEach((el) => el.classList.toggle('sel', L.sel.has(el.dataset.id)));
    updateBulk();
  }

  function updateBulk() {
    const bar = $('#lib-bulk');
    if (!bar) return;
    $('#lib-body')?.classList.toggle('selecting', L.sel.size > 0);
    if (!L.sel.size || L.view.type === 'shares') { bar.classList.add('hidden'); return; }
    const ids = [...L.sel];
    const size = ids.reduce((a, id) => a + (L.byId.get(id)?.s || 0), 0);
    const inCol = L.view.type === 'col';
    bar.innerHTML = `
      <span class="lib-bulk-n"><b>${ids.length}</b> seleccionados · ${fmtSize(size)}</span>
      <button class="btn-primary" data-b="share">${icon('share-2')}<span>Compartir</span></button>
      <button class="btn-secondary" data-b="dl">${icon('download')}<span>Descargar</span></button>
      <button class="btn-secondary" data-b="fav">${icon('star')}<span>Favorito</span></button>
      <button class="btn-secondary" data-b="col">${icon('folder-plus')}<span>Colección</span></button>
      ${inCol ? `<button class="btn-secondary" data-b="uncol">${icon('folder-minus')}<span>Quitar</span></button>` : ''}
      <button class="btn-secondary" data-b="move">${icon('folder-input')}<span>Mover</span></button>
      <button class="btn-danger" data-b="trash">${icon('trash-2')}</button>
      <button class="btn-secondary" data-b="all" title="Seleccionar todo">${icon('check-check')}</button>
      <button class="icon-btn" data-b="clear" title="Cancelar (Esc)">${icon('x')}</button>`;
    bar.classList.remove('hidden');
    bar.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.b;
      if (a === 'share') openShareModal(ids);
      if (a === 'dl') downloadIds(ids);
      if (a === 'fav') toggleFav(ids, !ids.every((id) => L.favs.has(id)));
      if (a === 'col') addToCollection(ids);
      if (a === 'uncol') removeFromCollection(ids);
      if (a === 'move') openMove(ids);
      if (a === 'trash') trashIds(ids);
      if (a === 'all') { L.list.forEach((it) => L.sel.add(it.id)); syncSelClasses(); }
      if (a === 'clear') { L.sel.clear(); syncSelClasses(); }
    }));
    refreshIcons();
  }

  function renderSide() {
    const side = $('#lib-side');
    if (!side) return;
    const v = L.view;
    const counts = {};
    for (const it of L.items) counts[it.k] = (counts[it.k] || 0) + 1;
    const recentCut = Date.now() - 30 * 86400e3;
    const nRecent = L.items.filter((it) => it.m >= recentCut).length;
    const act = (type, value) => (v.type === type && (value === undefined || v.value === value) ? ' active' : '');
    const item = (type, value, ic, label, n) =>
      `<button class="lib-nav${act(type, value)}" data-type="${type}" data-value="${esc(value ?? '')}">${icon(ic)}<span>${esc(label)}</span>${n != null ? `<em>${Number(n).toLocaleString('es-AR')}</em>` : ''}</button>`;
    const rootCounts = new Map();
    for (const it of L.items) {
      const r = rootOf(it.p);
      if (r) rootCounts.set(r, (rootCounts.get(r) || 0) + 1);
    }
    const roots = [...new Set([L.uploadRoot, ...L.roots])].filter(Boolean);
    side.innerHTML = `
      <div class="lib-side-sec">
        ${item('all', undefined, 'library', 'Todo', L.items.length)}
        ${item('recent', undefined, 'clock', 'Recientes', nRecent)}
        ${item('fav', undefined, 'star', 'Favoritos', L.favs.size)}
        ${item('shares', undefined, 'link', 'Links compartidos', L.sharesCount)}
      </div>
      <div class="lib-side-sec"><div class="lib-side-h">Tipos</div>
        ${KINDS.filter((k) => counts[k.k]).map((k) => item('kind', k.k, k.ic, k.label, counts[k.k])).join('')}
      </div>
      <div class="lib-side-sec"><div class="lib-side-h">Colecciones <button class="lib-side-add" id="lib-col-new" title="Nueva colección">${icon('plus')}</button></div>
        ${L.cols.length ? L.cols.map((c) => `<div class="lib-nav-wrap">${item('col', c.id, 'album', c.name, c.ids.length)}<button class="lib-nav-more" data-col="${c.id}" title="Opciones">${icon('more-horizontal')}</button></div>`).join('') : '<p class="lib-side-empty">Agrupá archivos de distintas carpetas sin moverlos</p>'}
      </div>
      <div class="lib-side-sec"><div class="lib-side-h">Carpetas</div>
        ${roots.map((r) => item('folder', r, r === L.uploadRoot ? 'inbox' : 'hard-drive', baseOf(r) + (r === L.uploadRoot ? ' (subidas)' : ''), rootCounts.get(r) || 0)).join('')}
      </div>`;
    side.querySelectorAll('.lib-nav').forEach((b) => b.addEventListener('click', () => {
      const type = b.dataset.type;
      setView(type === 'all' || type === 'recent' || type === 'fav' || type === 'shares' ? { type } : { type, value: b.dataset.value });
    }));
    $('#lib-col-new')?.addEventListener('click', async () => {
      const name = await promptModal('Nueva colección', '', 'Ej: Portfolio, Cliente X, Viaje…');
      if (!name) return;
      try { await api('/api/library/collections', { method: 'POST', body: { name } }); await load(); } catch (err) { errToast(err); }
    });
    side.querySelectorAll('.lib-nav-more').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const col = L.cols.find((c) => c.id === b.dataset.col);
      const r = b.getBoundingClientRect();
      showCtxMenu?.([
        { icon: 'share-2', label: 'Compartir colección', run: () => openShareModal(col.ids, col.name) },
        { icon: 'download', label: 'Descargar (ZIP)', run: () => downloadIds(col.ids, col.name) },
        { icon: 'pencil', label: 'Renombrar', run: async () => {
          const name = await promptModal('Renombrar colección', col.name);
          if (name) { await api(`/api/library/collections/${col.id}`, { method: 'PATCH', body: { name } }).catch(errToast); load(); }
        } },
        { icon: 'trash-2', label: 'Eliminar colección', danger: true, run: async () => {
          if (!(await confirmDialog('Eliminar colección', `Se elimina "${col.name}". Los archivos no se tocan.`))) return;
          await api(`/api/library/collections/${col.id}`, { method: 'DELETE' }).catch(errToast);
          if (L.view.type === 'col' && L.view.value === col.id) L.view = { type: 'all' };
          load();
        } },
      ], r.left, r.bottom);
    }));
    refreshIcons();
  }

  function renderCrumbs() {
    const el = $('#lib-crumbs');
    const v = L.view;
    let h = '';
    if (v.type === 'folder') {
      const root = rootOf(v.value) || v.value;
      const parts = v.value.slice(root.length).split('/').filter(Boolean);
      let acc = root;
      h = `<button class="lib-crumb" data-path="${esc(root)}">${icon('hard-drive')} ${esc(baseOf(root))}</button>`;
      for (const p of parts) {
        acc += '/' + p;
        h += `<span class="lib-crumb-sep">/</span><button class="lib-crumb" data-path="${esc(acc)}">${esc(p)}</button>`;
      }
      h += `<span class="lib-crumb-sp"></span><button class="lib-crumb-act" id="lib-mkdir">${icon('folder-plus')} Nueva carpeta</button>`;
    } else {
      const titles = { all: 'Todo', recent: 'Recientes · últimos 30 días', fav: 'Favoritos' };
      const t = v.type === 'kind' ? KIND[v.value]?.label : v.type === 'col' ? `Colección · ${L.cols.find((c) => c.id === v.value)?.name || ''}` : titles[v.type];
      h = `<span class="lib-crumb-title">${esc(t || '')}</span>`;
      if (v.type === 'col') {
        const col = L.cols.find((c) => c.id === v.value);
        if (col?.ids.length) h += `<span class="lib-crumb-sp"></span><button class="lib-crumb-act" id="lib-col-share">${icon('share-2')} Compartir colección</button>`;
      }
    }
    h += `<span class="lib-status" id="lib-status"></span>`;
    el.innerHTML = h;
    el.querySelectorAll('.lib-crumb').forEach((b) => b.addEventListener('click', () => setView({ type: 'folder', value: b.dataset.path })));
    $('#lib-mkdir')?.addEventListener('click', async () => {
      const name = await promptModal('Nueva carpeta', '', 'Nombre de la carpeta');
      if (!name) return;
      try {
        const r = await api('/api/library/mkdir', { method: 'POST', body: { dir: `${v.value}/${name}` } });
        toast('Carpeta creada — subí archivos o mové algunos ahí', 'ok', '', 3000);
        setView({ type: 'folder', value: r.dir });
      } catch (err) { errToast(err); }
    });
    $('#lib-col-share')?.addEventListener('click', () => {
      const col = L.cols.find((c) => c.id === v.value);
      openShareModal(col.ids, col.name);
    });
    refreshIcons();
  }

  // ---------- Actions ----------

  async function toggleFav(ids, on) {
    ids.forEach((id) => (on ? L.favs.add(id) : L.favs.delete(id)));
    try { await api('/api/library/favorite', { method: 'POST', body: { ids, on } }); } catch (err) { errToast(err); }
    $$('#lib-body .lib-tile').forEach((el) => el.querySelector('.lib-fav')?.classList.toggle('on', L.favs.has(el.dataset.id)));
    renderSide();
    if (L.view.type === 'fav') render();
    if ($('#lib-viewer') && !$('#lib-viewer').classList.contains('hidden')) viewerBar();
  }

  async function downloadIds(ids, name) {
    if (ids.length === 1) {
      location.href = `/api/library/file/${ids[0]}?dl=1`;
      return;
    }
    try {
      const r = await api('/api/library/zip', { method: 'POST', body: { ids, name: name || `biblioteca-${ids.length}-archivos` } });
      location.href = r.url;
    } catch (err) { errToast(err); }
  }

  async function addToCollection(ids) {
    const opts = L.cols.map((c) => `<button class="lib-pick" data-id="${c.id}">${icon('album')} ${esc(c.name)} <em>${c.ids.length}</em></button>`).join('');
    openModal(`<h3>Agregar ${ids.length} archivo${ids.length > 1 ? 's' : ''} a una colección</h3>
      <div class="lib-picks">${opts || '<p class="lib-muted">No hay colecciones todavía.</p>'}</div>
      <label>Nueva colección<input type="text" id="lib-newcol" placeholder="Nombre"></label>
      <div class="modal-actions"><button class="btn-secondary" data-close>Cancelar</button><button class="btn-primary" id="lib-newcol-ok">${icon('plus')} Crear y agregar</button></div>`);
    $$('#lib-modal .lib-pick').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/library/collections/${b.dataset.id}`, { method: 'PATCH', body: { add: ids } });
        closeModal();
        toast('Agregado a la colección', 'ok', '', 2500);
        load();
      } catch (err) { errToast(err); }
    }));
    $('#lib-newcol-ok').addEventListener('click', async () => {
      const name = $('#lib-newcol').value.trim();
      if (!name) return $('#lib-newcol').focus();
      try {
        await api('/api/library/collections', { method: 'POST', body: { name, ids } });
        closeModal();
        toast(`Colección "${name}" creada`, 'ok', '', 2500);
        load();
      } catch (err) { errToast(err); }
    });
  }

  async function removeFromCollection(ids) {
    try {
      await api(`/api/library/collections/${L.view.value}`, { method: 'PATCH', body: { remove: ids } });
      L.sel.clear();
      load();
    } catch (err) { errToast(err); }
  }

  async function renameItem(it) {
    const name = await promptModal('Renombrar', it.n);
    if (!name || name === it.n) return;
    try {
      await api('/api/library/rename', { method: 'POST', body: { id: it.id, name } });
      toast('Renombrado', 'ok', '', 2000);
      closeViewer();
      load();
    } catch (err) { errToast(err); }
  }

  function allFolders() {
    const set = new Set([L.uploadRoot, ...L.roots].filter(Boolean));
    for (const it of L.items) {
      let d = dirOf(it.p);
      const r = rootOf(it.p);
      while (d && r && d.length >= r.length && !set.has(d)) { set.add(d); d = dirOf(d); }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }

  function openMove(ids) {
    const folders = allFolders();
    openModal(`<h3>Mover ${ids.length} archivo${ids.length > 1 ? 's' : ''}</h3>
      <input type="text" id="lib-mv-q" class="filter-input lib-wide" placeholder="Buscar carpeta…" autocomplete="off">
      <div class="lib-picks lib-folder-picks" id="lib-mv-list"></div>
      <label>Dentro de la carpeta elegida, crear subcarpeta (opcional)<input type="text" id="lib-mv-new" placeholder="Ej: Seleccionadas"></label>
      <p class="lib-muted" id="lib-mv-dest">Elegí una carpeta</p>
      <div class="modal-actions"><button class="btn-secondary" data-close>Cancelar</button><button class="btn-primary" id="lib-mv-ok" disabled>${icon('folder-input')} Mover</button></div>`);
    let chosen = L.view.type === 'folder' ? L.view.value : '';
    const draw = () => {
      const q = $('#lib-mv-q').value.toLowerCase();
      $('#lib-mv-list').innerHTML = folders.filter((f) => !q || f.toLowerCase().includes(q)).slice(0, 300)
        .map((f) => `<button class="lib-pick${f === chosen ? ' on' : ''}" data-f="${esc(f)}">${icon('folder')} ${esc(prettyPath(f))}</button>`).join('');
      $$('#lib-mv-list .lib-pick').forEach((b) => b.addEventListener('click', () => { chosen = b.dataset.f; draw(); upd(); }));
      refreshIcons();
    };
    const dest = () => (chosen ? chosen + ($('#lib-mv-new').value.trim() ? '/' + $('#lib-mv-new').value.trim().replace(/\//g, '-') : '') : '');
    const upd = () => {
      $('#lib-mv-dest').textContent = chosen ? `Destino: ${prettyPath(dest())}` : 'Elegí una carpeta';
      $('#lib-mv-ok').disabled = !chosen;
    };
    $('#lib-mv-q').addEventListener('input', draw);
    $('#lib-mv-new').addEventListener('input', upd);
    draw(); upd();
    $('#lib-mv-ok').addEventListener('click', async () => {
      $('#lib-mv-ok').disabled = true;
      try {
        const r = await api('/api/library/move', { method: 'POST', body: { ids, dir: dest() } });
        closeModal();
        toast(`${r.moved.length} archivo${r.moved.length === 1 ? '' : 's'} movido${r.moved.length === 1 ? '' : 's'}`, 'ok', '', 2500);
        L.sel.clear();
        closeViewer();
        load();
      } catch (err) {
        $('#lib-mv-ok').disabled = false;
        errToast(err);
      }
    });
  }

  async function trashIds(ids) {
    const n = ids.length;
    const one = n === 1 ? L.byId.get(ids[0])?.n : '';
    if (!(await confirmDialog('Enviar a la papelera', n === 1 ? `"${one}" va a la papelera de Axon (se puede restaurar desde Archivos).` : `${n} archivos van a la papelera de Axon (se pueden restaurar desde Archivos).`, 'Eliminar'))) return;
    try {
      const r = await api('/api/library/trash', { method: 'POST', body: { ids } });
      toast(`${r.removed} enviado${r.removed === 1 ? '' : 's'} a la papelera`, 'ok', '', 2500);
    } catch (err) { errToast(err); }
    L.sel.clear();
    closeViewer();
    load();
  }

  // ---------- Viewer ----------

  let vIdx = -1;
  let vInfo = localStorage.getItem('lib-vinfo') !== '0';
  let tcPoll = null;

  function openViewer(i) {
    vIdx = i;
    const v = $('#lib-viewer');
    v.classList.remove('hidden');
    document.body.classList.add('lib-noscroll');
    v.innerHTML = `
      <div class="lv-bar" id="lv-bar"></div>
      <div class="lv-main">
        <div class="lv-stage" id="lv-stage"></div>
        <button class="lv-nav prev" id="lv-prev">${icon('chevron-left')}</button>
        <button class="lv-nav next" id="lv-next">${icon('chevron-right')}</button>
        <aside class="lv-info${vInfo ? '' : ' hidden'}" id="lv-info"></aside>
      </div>`;
    $('#lv-prev').addEventListener('click', () => step(-1));
    $('#lv-next').addEventListener('click', () => step(1));
    let sx = null, sy = null;
    const st = $('#lv-stage');
    st.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    st.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
      else if (dy > 110 && Math.abs(dy) > Math.abs(dx)) closeViewer();
      sx = null;
    });
    showItem();
  }

  function step(d) {
    if (!L.list.length) return;
    vIdx = (vIdx + d + L.list.length) % L.list.length;
    showItem();
  }

  function closeViewer() {
    const v = $('#lib-viewer');
    if (!v || v.classList.contains('hidden')) return;
    v.classList.add('hidden');
    v.innerHTML = '';
    document.body.classList.remove('lib-noscroll');
    clearTimeout(tcPoll);
  }

  function viewerBar() {
    const it = L.list[vIdx];
    if (!it) return;
    $('#lv-bar').innerHTML = `
      <button class="lv-btn" id="lv-close" title="Cerrar (Esc)">${icon('x')}</button>
      <div class="lv-title"><b>${esc(it.n)}</b><small>${vIdx + 1} / ${L.list.length} · ${fmtSize(it.s)}</small></div>
      <div class="lv-actions">
        <button class="lv-btn${L.favs.has(it.id) ? ' on' : ''}" id="lv-fav" title="Favorito (F)">${icon('star')}</button>
        <button class="lv-btn lv-primary" id="lv-share" title="Compartir link (S)">${icon('share-2')}<span>Compartir</span></button>
        <a class="lv-btn" href="/api/library/file/${it.id}?dl=1" title="Descargar (D)">${icon('download')}</a>
        <a class="lv-btn lv-hide-sm" href="/api/library/file/${it.id}" target="_blank" title="Abrir original">${icon('external-link')}</a>
        <button class="lv-btn" id="lv-more" title="Más">${icon('more-vertical')}</button>
        <button class="lv-btn lv-hide-sm${vInfo ? ' on' : ''}" id="lv-info-t" title="Información (I)">${icon('info')}</button>
      </div>`;
    $('#lv-close').addEventListener('click', closeViewer);
    $('#lv-fav').addEventListener('click', () => toggleFav([it.id], !L.favs.has(it.id)));
    $('#lv-share').addEventListener('click', () => openShareModal([it.id]));
    $('#lv-info-t').addEventListener('click', toggleInfo);
    $('#lv-more').addEventListener('click', (e) => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      showCtxMenu?.([
        { icon: 'info', label: 'Información', run: toggleInfo },
        { icon: 'pencil', label: 'Renombrar', run: () => renameItem(it) },
        { icon: 'folder-input', label: 'Mover a…', run: () => openMove([it.id]) },
        { icon: 'folder-plus', label: 'Agregar a colección…', run: () => addToCollection([it.id]) },
        { icon: 'folder-open', label: 'Ir a la carpeta', run: () => { closeViewer(); setView({ type: 'folder', value: dirOf(it.p) }); } },
        { icon: 'trash-2', label: 'Eliminar', danger: true, run: () => trashIds([it.id]) },
      ], r.right - 200, r.bottom + 4);
    });
    refreshIcons();
  }

  function toggleInfo() {
    vInfo = !vInfo;
    localStorage.setItem('lib-vinfo', vInfo ? '1' : '0');
    $('#lv-info')?.classList.toggle('hidden', !vInfo);
    $('#lv-info-t')?.classList.toggle('on', vInfo);
  }

  function mediaHtml(it) {
    const f = `/api/library/file/${it.id}`;
    if (it.k === 'video') {
      const src = it.wv ? `/api/library/web/${it.id}` : f;
      return `<video controls autoplay playsinline preload="metadata" ${it.th >= 1 ? `poster="${thumbUrl(it)}"` : ''} src="${src}"></video>`;
    }
    if (it.k === 'image' || it.k === 'raw' || it.k === 'vector' || (it.k === 'design' && it.vw)) {
      const src = it.vw ? `/api/library/view/${it.id}` : f;
      return `<div class="lv-img-wrap">${it.vw && it.th >= 1 ? `<img class="lv-ph" src="${thumbUrl(it)}" alt="">` : ''}<img class="lv-img" src="${src}" alt="" onload="this.previousElementSibling?.classList?.contains('lv-ph')&&this.previousElementSibling.remove()"></div>`;
    }
    if (it.k === 'audio') return `<div class="lv-audio">${it.th >= 1 ? `<img src="${thumbUrl(it)}" alt="">` : icon('music')}<b>${esc(it.n)}</b><audio controls autoplay src="${f}"></audio></div>`;
    if (it.k === 'pdf' || ['txt', 'md', 'csv'].includes(it.e)) return `<iframe class="lv-frame" src="${f}"></iframe>`;
    return `<div class="lv-file">${icon(KIND[it.k]?.ic || 'file')}<b>${esc(it.e.toUpperCase())}</b><span>${esc(it.n)}</span><span>Este tipo de archivo no tiene vista previa</span>
      <a class="btn-primary" href="${f}?dl=1">${icon('download')} Descargar</a></div>`;
  }

  function showItem() {
    const it = L.list[vIdx];
    if (!it) return closeViewer();
    clearTimeout(tcPoll);
    viewerBar();
    const st = $('#lv-stage');
    st.innerHTML = mediaHtml(it);
    if (it.k === 'video') {
      const note = document.createElement('div');
      note.className = 'lv-note hidden';
      st.appendChild(note);
      const v = st.querySelector('video');
      const offerWeb = (msg) => {
        note.classList.remove('hidden');
        note.innerHTML = `${icon('alert-triangle')} <span>${esc(msg)}</span> <button class="btn-primary" id="lv-mkweb">${icon('wand-2')} Crear versión compatible</button>`;
        $('#lv-mkweb').addEventListener('click', () => makeWeb(it, note));
        refreshIcons();
      };
      v.addEventListener('error', () => offerWeb('Este navegador no puede reproducir el formato original.'));
      if (it.nw && !it.wv) offerWeb(`Video ${it.c ? it.c.toUpperCase() : esc(it.e.toUpperCase())}: puede no reproducirse en todos los navegadores.`);
    }
    // Preload neighbours' thumbs for snappy navigation.
    for (const d of [1, -1]) {
      const n = L.list[(vIdx + d + L.list.length) % L.list.length];
      if (n && n.th >= 0 && n.th !== -1) new Image().src = thumbUrl(n);
    }
    renderInfo(it);
    refreshIcons();
  }

  async function makeWeb(it, note) {
    try {
      await api(`/api/library/web/${it.id}`, { method: 'POST' });
      const tick = async () => {
        const s = await api(`/api/library/web/${it.id}/status`).catch(() => null);
        if (!s) return;
        if (s.state === 'done') {
          it.wv = 1;
          if (L.list[vIdx]?.id === it.id) showItem();
          toast('Versión web lista', 'ok', '', 2500);
          return;
        }
        if (s.state === 'error') {
          note.innerHTML = `${icon('x-circle')} No se pudo convertir: ${esc(s.error || '')}`;
          refreshIcons();
          return;
        }
        note.innerHTML = `${icon('loader', 'spin')} Convirtiendo a MP4 H.264… ${s.state === 'queued' ? 'en cola' : (s.pct || 0) + '%'}`;
        refreshIcons();
        tcPoll = setTimeout(tick, 1500);
      };
      tick();
    } catch (err) { errToast(err); }
  }

  function renderInfo(it) {
    const el = $('#lv-info');
    if (!el) return;
    const cols = L.cols.filter((c) => c.ids.includes(it.id));
    const rows = [
      ['Tipo', `${KIND_ONE[it.k]} · ${it.e.toUpperCase()}`],
      ['Tamaño', fmtSize(it.s)],
      it.w ? ['Dimensiones', `${it.w} × ${it.h}${it.w * it.h > 1e6 ? ` (${((it.w * it.h) / 1e6).toFixed(1)} MP)` : ''}`] : null,
      it.d ? ['Duración', fmtDur(it.d)] : null,
      it.c ? ['Códec', it.c] : null,
      it.t ? ['Tomada', fmtDateTime(it.t)] : null,
      ['Modificado', fmtDateTime(it.m)],
    ].filter(Boolean);
    el.innerHTML = `
      <h4>Información</h4>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <h4>Ubicación</h4>
      <button class="lv-path" id="lv-goto" title="Ir a la carpeta">${icon('folder-open')} <span>${esc(prettyPath(dirOf(it.p)))}</span></button>
      ${cols.length ? `<h4>Colecciones</h4><div class="lv-tags">${cols.map((c) => `<span>${esc(c.name)}</span>`).join('')}</div>` : ''}
      <button class="btn-primary lv-share-big" id="lv-share2">${icon('link')} Crear link para compartir</button>`;
    $('#lv-goto').addEventListener('click', () => { closeViewer(); setView({ type: 'folder', value: dirOf(it.p) }); });
    $('#lv-share2').addEventListener('click', () => openShareModal([it.id]));
  }

  function onKey(e) {
    if (!tabActive()) return;
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    const modalOpen = !$('#lib-modal').classList.contains('hidden');
    if (modalOpen) {
      if (e.key === 'Escape') closeModal();
      return;
    }
    const viewer = !$('#lib-viewer').classList.contains('hidden');
    if (viewer) {
      if (inField) return;
      const it = L.list[vIdx];
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'f' || e.key === 'F') toggleFav([it.id], !L.favs.has(it.id));
      else if (e.key === 's' || e.key === 'S') openShareModal([it.id]);
      else if (e.key === 'i' || e.key === 'I') toggleInfo();
      else if (e.key === 'd' || e.key === 'D') location.href = `/api/library/file/${it.id}?dl=1`;
      else if (e.key === 'Delete') trashIds([it.id]);
      else return;
      e.preventDefault();
      return;
    }
    if (inField) {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    if (e.key === '/') { e.preventDefault(); $('#lib-q').focus(); }
    else if (e.key === 'Escape' && L.sel.size) { L.sel.clear(); syncSelClasses(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'a' && L.view.type !== 'shares') {
      e.preventDefault();
      L.list.forEach((it) => L.sel.add(it.id));
      syncSelClasses();
    } else if (e.key === 'Delete' && L.sel.size) trashIds([...L.sel]);
  }

  // ---------- Modals ----------

  function openModal(html, cls = '') {
    const c = $('#lib-modal-c');
    c.className = `modal-content lib-modal-content ${cls}`;
    c.innerHTML = html;
    $('#lib-modal').classList.remove('hidden');
    c.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
    refreshIcons();
    setTimeout(() => c.querySelector('input[type=text]:not([readonly])')?.focus(), 30);
  }

  function closeModal() {
    $('#lib-modal').classList.add('hidden');
    $('#lib-modal-c').innerHTML = '';
  }

  function promptModal(title, value = '', placeholder = '') {
    return new Promise((resolve) => {
      openModal(`<h3>${esc(title)}</h3><input type="text" id="lib-prompt" class="filter-input lib-wide" value="${esc(value)}" placeholder="${esc(placeholder)}">
        <div class="modal-actions"><button class="btn-secondary" data-close>Cancelar</button><button class="btn-primary" id="lib-prompt-ok">Aceptar</button></div>`);
      const inp = $('#lib-prompt');
      const done = (v) => { closeModal(); resolve(v); };
      $('#lib-prompt-ok').addEventListener('click', () => done(inp.value.trim()));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value.trim()); });
      $$('#lib-modal [data-close]').forEach((b) => b.addEventListener('click', () => resolve('')));
      setTimeout(() => {
        inp.focus();
        const dot = value.lastIndexOf('.');
        inp.setSelectionRange(0, dot > 0 ? dot : value.length);
      }, 40);
    });
  }

  // ---------- Share ----------

  function openShareModal(ids, title) {
    ids = ids.filter((id) => L.byId.has(id));
    if (!ids.length) return toast('Nada para compartir', 'error');
    const list = ids.map((id) => L.byId.get(id));
    const size = list.reduce((a, it) => a + it.s, 0);
    const defTitle = title || (list.length === 1 ? list[0].n : `${list.length} archivos`);
    const hevc = list.filter((it) => it.nw && !it.wv).length;
    let ttl = Number(localStorage.getItem('lib-ttl') || 7 * 86400);
    openModal(`
      <h3>${icon('share-2')} Compartir ${list.length === 1 ? 'archivo' : `${list.length} archivos`}</h3>
      <div class="lib-share-prev">${list.slice(0, 6).map((it) => (it.th === -1 ? `<span class="lib-ext k-${it.k}"><b>${esc(it.e.toUpperCase())}</b></span>` : `<img src="${thumbUrl(it)}" alt="">`)).join('')}${list.length > 6 ? `<span class="lib-more">+${list.length - 6}</span>` : ''}<small>${fmtSize(size)}</small></div>
      <label>Título que verá quien abra el link<input type="text" id="lsh-title" value="${esc(defTitle)}"></label>
      <div class="lib-field-l">Disponible por</div>
      <div class="lib-pills" id="lsh-ttl">${TTLS.map((t) => `<button class="chip${t.s === ttl ? ' active' : ''}" data-s="${t.s}">${t.label}</button>`).join('')}</div>
      <label class="lib-toggle"><input type="checkbox" id="lsh-dl" checked><span>Permitir descargar <small>(si lo apagás, solo pueden ver online)</small></span></label>
      <label class="lib-toggle"><input type="checkbox" id="lsh-pw-on"><span>Proteger con contraseña</span></label>
      <input type="text" id="lsh-pw" class="filter-input lib-wide hidden" placeholder="Contraseña" autocomplete="off">
      ${hevc ? `<p class="lib-muted">${icon('wand-2')} ${hevc} video${hevc > 1 ? 's' : ''} HEVC se van a convertir automáticamente a un formato que se reproduce en cualquier navegador.</p>` : ''}
      <div class="modal-actions"><button class="btn-secondary" data-close>Cancelar</button><button class="btn-primary" id="lsh-ok">${icon('link')} Crear link</button></div>`, 'lib-share-modal');
    $$('#lsh-ttl .chip').forEach((b) => b.addEventListener('click', () => {
      ttl = Number(b.dataset.s);
      $$('#lsh-ttl .chip').forEach((x) => x.classList.toggle('active', x === b));
    }));
    $('#lsh-pw-on').addEventListener('change', (e) => {
      $('#lsh-pw').classList.toggle('hidden', !e.target.checked);
      if (e.target.checked) $('#lsh-pw').focus();
    });
    $('#lsh-ok').addEventListener('click', async () => {
      const pw = $('#lsh-pw-on').checked ? $('#lsh-pw').value : '';
      if ($('#lsh-pw-on').checked && !pw) return $('#lsh-pw').focus();
      $('#lsh-ok').disabled = true;
      localStorage.setItem('lib-ttl', String(ttl));
      try {
        const r = await api('/api/library/shares', {
          method: 'POST',
          body: { ids, title: $('#lsh-title').value, ttl, allowDownload: $('#lsh-dl').checked, password: pw },
        });
        L.sharesCount++;
        renderSide();
        shareResult(r.share, pw);
      } catch (err) {
        $('#lsh-ok').disabled = false;
        errToast(err);
      }
    });
  }

  function shareResult(s, pw) {
    const wa = `https://wa.me/?text=${encodeURIComponent(`${s.title} — ${s.url}`)}`;
    openModal(`
      <h3>${icon('check-circle-2')} Link listo</h3>
      <div class="lib-link-box"><input type="text" readonly value="${esc(s.url)}" id="lsr-url"><button class="btn-primary" id="lsr-copy">${icon('copy')} Copiar</button></div>
      <div class="lib-share-done">
        <div class="lib-qr">${qrSvg(s.url)}</div>
        <div class="lib-share-facts">
          <p>${icon('clock')} ${esc(expiresIn(s.expires))}${s.expires ? ` · hasta ${esc(fmtDateTime(s.expires))}` : ''}</p>
          <p>${icon(s.allowDownload ? 'download' : 'eye')} ${s.allowDownload ? 'Pueden ver y descargar' : 'Solo pueden ver'}</p>
          ${pw ? `<p>${icon('lock')} Con contraseña — mandala por separado</p>` : ''}
          <div class="lib-share-btns">
            <a class="btn-secondary" href="${esc(s.url)}" target="_blank">${icon('external-link')} Abrir</a>
            <a class="btn-secondary" href="${esc(wa)}" target="_blank">${icon('message-circle')} WhatsApp</a>
            ${navigator.share ? `<button class="btn-secondary" id="lsr-native">${icon('share')} Más…</button>` : ''}
          </div>
        </div>
      </div>
      <div class="modal-actions"><button class="btn-secondary" id="lsr-all">${icon('link')} Ver todos los links</button><button class="btn-primary" data-close>Listo</button></div>`);
    $('#lsr-url').addEventListener('focus', (e) => e.target.select());
    $('#lsr-copy').addEventListener('click', () => copyText(s.url));
    $('#lsr-native')?.addEventListener('click', () => navigator.share({ title: s.title, url: s.url }).catch(() => {}));
    $('#lsr-all').addEventListener('click', () => { closeModal(); closeViewer(); setView({ type: 'shares' }); });
    copyText(s.url);
  }

  async function renderShares() {
    $('#lib-crumbs').innerHTML = `<span class="lib-crumb-title">Links compartidos</span><span class="lib-crumb-sp"></span>
      <button class="lib-crumb-act" id="lib-sh-clean">${icon('trash')} Borrar vencidos</button><span class="lib-status" id="lib-status"></span>`;
    $('#lib-sh-clean').addEventListener('click', async () => {
      const r = await api('/api/library/shares/cleanup', { method: 'POST' }).catch(errToast);
      if (r) toast(`${r.removed} links vencidos eliminados`, 'ok', '', 2500);
      renderShares();
    });
    updateBulk();
    const body = $('#lib-body');
    body.className = 'lib-body';
    let d;
    try { d = await api('/api/library/shares'); } catch (err) { return errToast(err); }
    L.sharesCount = d.shares.filter((s) => s.alive).length;
    $('#lib-sub').textContent = `${L.sharesCount} activos · ${d.shares.length} en total`;
    if (!d.shares.length) {
      body.innerHTML = `<div class="lib-empty">${icon('link')}<p>Todavía no compartiste nada.<br>Abrí un archivo o seleccioná varios y tocá <b>Compartir</b>.</p></div>`;
      refreshIcons();
      return;
    }
    body.innerHTML = `<div class="lib-shares">${d.shares.map((s) => {
      const thumbs = s.ids.slice(0, 4).map((id) => L.byId.get(id)).filter(Boolean);
      return `<div class="lib-share${s.alive ? '' : ' dead'}" data-sid="${s.id}">
        <div class="lib-share-th n${thumbs.length}">${thumbs.map((it) => (it.th === -1 ? `<span class="lib-ext k-${it.k}"><b>${esc(it.e.toUpperCase())}</b></span>` : `<img loading="lazy" src="${thumbUrl(it)}" alt="">`)).join('') || icon('file')}</div>
        <div class="lib-share-main">
          <b>${esc(s.title)}</b>
          <small>${s.count} archivo${s.count === 1 ? '' : 's'} · ${fmtSize(s.size)}${s.missing ? ` · ${s.missing} ya no existen` : ''}</small>
          <div class="lib-share-meta">
            <span class="${s.alive ? 'ok' : 'bad'}">${icon('clock')} ${esc(expiresIn(s.expires))}</span>
            <span>${icon('eye')} ${s.views}</span><span>${icon('download')} ${s.downloads}</span>
            ${s.hasPassword ? `<span>${icon('lock')}</span>` : ''}${s.allowDownload ? '' : `<span>${icon('eye-off')} solo ver</span>`}
          </div>
          <small class="lib-share-url">${esc(s.url)}</small>
        </div>
        <div class="lib-share-acts">
          <button class="btn-secondary" data-a="copy" title="Copiar link">${icon('copy')}</button>
          <button class="btn-secondary" data-a="qr" title="QR">${icon('qr-code')}</button>
          <a class="btn-secondary" href="${esc(s.url)}" target="_blank" title="Abrir">${icon('external-link')}</a>
          <button class="btn-secondary" data-a="ext" title="Extender 7 días">${icon('calendar-plus')}</button>
          <button class="btn-secondary" data-a="dl" title="${s.allowDownload ? 'Deshabilitar descarga' : 'Permitir descarga'}">${icon(s.allowDownload ? 'download' : 'eye')}</button>
          <button class="btn-danger" data-a="del" title="Eliminar link">${icon('trash-2')}</button>
        </div>
      </div>`;
    }).join('')}</div>`;
    body.querySelectorAll('.lib-share').forEach((row) => {
      const s = d.shares.find((x) => x.id === row.dataset.sid);
      row.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.a;
        try {
          if (a === 'copy') return copyText(s.url);
          if (a === 'qr') {
            return openModal(`<h3>${esc(s.title)}</h3><div class="lib-qr big">${qrSvg(s.url)}</div><p class="lib-muted lib-center">${esc(s.url)}</p><div class="modal-actions"><button class="btn-primary" data-close>Cerrar</button></div>`);
          }
          if (a === 'ext') await api(`/api/library/shares/${s.id}`, { method: 'PATCH', body: { extend: 7 * 86400 } });
          if (a === 'dl') await api(`/api/library/shares/${s.id}`, { method: 'PATCH', body: { allowDownload: !s.allowDownload } });
          if (a === 'del') {
            if (!(await confirmDialog('Eliminar link', `"${s.title}" deja de funcionar inmediatamente. Los archivos no se tocan.`))) return;
            await api(`/api/library/shares/${s.id}`, { method: 'DELETE' });
          }
          renderShares();
          renderSide();
        } catch (err) { errToast(err); }
      }));
    });
    refreshIcons();
  }

  // ---------- Upload (chunked) ----------

  const upQ = [];
  let upActive = 0;

  function uploadDest() {
    return L.view.type === 'folder' ? L.view.value : '';
  }

  function startUploads(files) {
    if (!files.length) return;
    const dir = uploadDest();
    const panel = $('#lib-uploads');
    panel.classList.remove('hidden');
    if (!panel.querySelector('.lib-up-h')) {
      panel.innerHTML = `<div class="lib-up-h"><b>Subidas</b><button class="icon-btn" id="lib-up-x" title="Ocultar">${icon('x')}</button></div><div class="lib-up-list" id="lib-up-list"></div>`;
      $('#lib-up-x').addEventListener('click', () => { panel.classList.add('hidden'); panel.innerHTML = ''; });
    }
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'lib-up';
      row.innerHTML = `<span class="lib-up-n">${esc(f.name)}</span><span class="lib-up-s">${fmtSize(f.size)}</span><div class="lib-up-bar"><i></i></div>`;
      $('#lib-up-list').prepend(row);
      upQ.push({ f, dir, row });
    }
    refreshIcons();
    pumpUploads();
  }

  function pumpUploads() {
    while (upActive < 2 && upQ.length) {
      const job = upQ.shift();
      upActive++;
      uploadOne(job).finally(() => {
        upActive--;
        pumpUploads();
        if (!upActive && !upQ.length) load();
      });
    }
  }

  async function uploadOne({ f, dir, row }) {
    const bar = row.querySelector('i');
    const setSt = (txt, cls) => { row.querySelector('.lib-up-s').textContent = txt; if (cls) row.classList.add(cls); };
    try {
      const init = await api('/api/library/upload/init', { method: 'POST', body: { name: f.name, size: f.size, dir: dir || undefined } });
      const cs = init.chunkSize;
      let off = 0;
      const t0 = Date.now();
      while (off < f.size) {
        const blob = f.slice(off, Math.min(f.size, off + cs));
        let tries = 0;
        while (true) {
          const res = await fetch(`/api/library/upload/${init.id}?offset=${off}`, { method: 'PUT', body: blob, credentials: 'same-origin' });
          const j = await res.json().catch(() => ({}));
          if (res.ok && j.ok) { off = j.received; break; }
          if (res.status === 409 && j.received != null) { off = j.received; break; }
          if (++tries >= 4) throw new Error(j.error || `HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, 1000 * tries));
        }
        const pct = f.size ? off / f.size : 1;
        bar.style.width = (pct * 100).toFixed(1) + '%';
        const rate = off / Math.max(1, (Date.now() - t0) / 1000);
        setSt(`${Math.round(pct * 100)}% · ${fmtSize(rate)}/s`);
      }
      const done = await api(`/api/library/upload/${init.id}/finish`, { method: 'POST' });
      bar.style.width = '100%';
      setSt(`✓ ${prettyPath(dirOf(done.path))}`, 'done');
    } catch (err) {
      setSt(`Error: ${err.message || err}`, 'err');
    }
  }

  // ---------- Settings ----------

  function openSettings() {
    openModal(`
      <h3>${icon('settings-2')} Biblioteca — carpetas y ajustes</h3>
      <label>Carpetas que se indexan (una por línea)
        <textarea id="lst-roots" rows="7" spellcheck="false">${esc(L.roots.map(prettyPath).join('\n'))}</textarea></label>
      <p class="lib-muted">Se recorren completas (se ignoran carpetas ocultas y node_modules). Los archivos no se copian: la biblioteca muestra lo que ya está en el servidor.</p>
      <label>Carpeta de subidas (se ordenan solas en subcarpetas por tipo)
        <input type="text" id="lst-up" value="${esc(prettyPath(L.uploadRoot))}"></label>
      <label>URL pública para los links compartidos
        <input type="text" id="lst-base" value="${esc(L.shareBase)}" placeholder="${esc(location.origin)}"></label>
      <p class="lib-muted">Si apunta a un subdominio propio, ese dominio solo muestra los links compartidos — nunca el panel.</p>
      <div class="modal-actions"><button class="btn-secondary" data-close>Cancelar</button><button class="btn-primary" id="lst-ok">${icon('save')} Guardar y escanear</button></div>`);
    $('#lst-ok').addEventListener('click', async () => {
      const unHome = (p) => (p.startsWith('~/') || p === '~' ? L.home + p.slice(1) : p);
      try {
        await api('/api/library/settings', {
          method: 'PUT',
          body: {
            roots: $('#lst-roots').value.split('\n').map((s) => unHome(s.trim())).filter(Boolean),
            uploadRoot: unHome($('#lst-up').value.trim()),
            shareBase: $('#lst-base').value.trim(),
          },
        });
        closeModal();
        toast('Guardado — escaneando…', 'ok', '', 2500);
        setTimeout(load, 1500);
      } catch (err) { errToast(err); }
    });
  }

  // ---------- Boot ----------

  function boot() {
    ensureDom();
    // Light background refresh of the nav count.
    api('/api/library/status').then((s) => {
      const nc = $('#nav-count-library');
      if (nc && s.count) nc.textContent = s.count.toLocaleString('es-AR');
    }).catch(() => {});
  }

  window.pmLibrary = { open: activateTab, share: openShareModal };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
