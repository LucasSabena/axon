/* AXON — feature: Biblioteca
 * Media library over host folders: browse by type / date / folder / collection,
 * viewer, organize (favorites, collections, move, rename, trash), chunked
 * uploads, temporary public share links (/s/<token>), optimize / convert
 * photos-videos-audio (Squoosh codecs + ffmpeg) and on-demand transcription.
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
    directories: [],
    home: '',
    uploadRoot: '',
    shareBase: '',
    scannedAt: 0,
    view: (()=>{try{return JSON.parse(localStorage.getItem('lib-view')) || {type:'all'};}catch{return {type:'all'};}})(),
    q: '',
    sort: localStorage.getItem('lib-sort') || 'date-desc',
    group: localStorage.getItem('lib-group') || 'month',
    size: Number(localStorage.getItem('lib-size') || 170),
    layout: localStorage.getItem('lib-layout') || 'grid',
    sel: new Set(),
    cursor: null,
    selMode: false,
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
  const mediaUrl = (it, kind = 'file') => `/api/library/${kind}/${it.id}?k=${encodeURIComponent(it.tk)}`;
  const thumbUrl = (it) => mediaUrl(it, 'thumb');
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
    if (window.AxonNavigation) return;
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
        <div class="page-history"><button class="icon-btn" data-axon-back title="Atrás" aria-label="Atrás">${icon('arrow-left')}</button><button class="icon-btn" data-axon-forward title="Adelante" aria-label="Adelante">${icon('arrow-right')}</button><button class="icon-btn" id="lib-keys" title="Atajos de teclado" aria-label="Atajos de teclado">${icon('keyboard')}</button></div>
        <button class="icon-btn lib-side-toggle" id="lib-side-toggle" title="Secciones">${icon('panel-left')}</button>
        <div class="lib-title"><h2 id="lib-h">Biblioteca</h2><span class="lib-sub" id="lib-sub"></span></div>
        <div class="lib-search">${icon('search')}<input id="lib-q" placeholder="Buscar… ej: tipo:video >100mb vacaciones" autocomplete="off"><kbd>/</kbd></div>
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
          <button class="icon-btn lib-selmode" id="lib-selmode" title="Seleccionar">${icon('check-square')}</button>
          <button class="btn-secondary" id="lib-share-manager" title="Links compartidos y actividad">${icon('link')}<span>Links</span></button>
          <button class="btn-primary" id="lib-upload">${icon('upload')}<span>Subir</span></button>
          <button class="icon-btn" id="lib-refresh" title="Volver a escanear">${icon('refresh-cw')}</button>
          <button class="icon-btn" id="lib-settings" title="Carpetas y ajustes">${icon('settings-2')}</button>
        </div>
      </div>
      <div class="lib-layout">
        <aside class="lib-side" id="lib-side"></aside>
        <div class="lib-main" id="lib-main">
          <div class="lib-crumbs" id="lib-crumbs"></div>
          <div class="lib-body" id="lib-body">${AxonUI.skeleton('Cargando biblioteca',6)}</div>
        </div>
      </div>
      <div class="lib-bulk hidden" id="lib-bulk"></div>
      <div class="lib-dock"><div class="lib-uploads lib-jobs hidden" id="lib-jobs"></div><div class="lib-uploads hidden" id="lib-uploads"></div></div>
      <div class="lib-drop hidden" id="lib-drop"><div>${icon('upload-cloud')}<p>Soltá para subir</p><span id="lib-drop-dest"></span></div></div>
      <input type="file" id="lib-file" multiple hidden>
      <input type="file" id="lib-file-dir" webkitdirectory hidden>
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
    $('#lib-upload').addEventListener('click', (e) => {
      if (typeof showCtxMenu !== 'function') return $('#lib-file').click();
      const r = e.currentTarget.getBoundingClientRect();
      showCtxMenu([
        { icon: 'upload', label: 'Subir archivos', run: () => $('#lib-file').click() },
        { icon: 'folder-up', label: 'Subir carpeta', run: () => $('#lib-file-dir').click() },
      ], r.left, r.bottom + 4);
    });
    $('#lib-file').addEventListener('change', (e) => { startUploads([...e.target.files].map((f) => ({ f }))); e.target.value = ''; });
    $('#lib-file-dir').addEventListener('change', (e) => { startUploads([...e.target.files].map((f) => ({ f, rel: f.webkitRelativePath || f.name }))); e.target.value = ''; });
    $('#lib-refresh').addEventListener('click', rescan);
    $('#lib-selmode').addEventListener('click', () => {
      L.selMode = !L.selMode;
      if (!L.selMode) L.sel.clear();
      syncSelClasses();
    });
    setupLongPress(sec);
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
    sec.addEventListener('drop', async (e) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      dragDepth = 0;
      $('#lib-drop').classList.add('hidden');
      // Traverse dropped folders so the whole tree uploads with its structure.
      let files = [];
      const items = e.dataTransfer.items;
      if (items?.length && items[0].webkitGetAsEntry) {
        const entries = [...items].map((it) => it.webkitGetAsEntry()).filter(Boolean);
        for (const ent of entries) files.push(...await collectEntry(ent));
      }
      if (!files.length) files = [...(e.dataTransfer.files || [])].map((f) => ({ f }));
      startUploads(files);
    });

    $('#lib-share-manager').addEventListener('click',()=>setView({type:'shares'}));
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

  let loadFlight = null;
  function load() {
    if (!loadFlight) loadFlight = fetchLibrary().finally(() => { loadFlight = null; });
    return loadFlight;
  }
  async function fetchLibrary() {
    try {
      const d = await api('/api/library');
      // Read the current item AFTER the request: the user may have stepped meanwhile.
      const viewerId = !$('#lib-viewer')?.classList.contains('hidden') ? vItemId : null;
      const viewerVersion = viewerId ? vItemVersion : null;
      L.loaded = true;
      L.items = d.items;
      L.byId = new Map(d.items.map((it) => [it.id, it]));
      L.favs = new Set(d.favorites);
      L.cols = d.collections;
      L.roots = d.roots;
      L.directories = d.directories || [];
      L.home = d.home;
      L.uploadRoot = d.uploadRoot;
      L.shareBase = d.shareBase;
      L.scannedAt = d.scannedAt;
      L.revision = d.revision;
      L.sharesCount = d.shares;
      for (const id of [...L.sel]) if (!L.byId.has(id)) L.sel.delete(id);
      const nc = $('#nav-count-library');
      if (nc) nc.textContent = d.items.length ? d.items.length.toLocaleString('es-AR') : '';
      const first = !L.rendered;
      L.rendered = true;
      render({ keep: !first });
      if (viewerId) {
        const i = L.list.findIndex((x) => x.id === viewerId);
        if (i >= 0) {
          vIdx = i;
          if (viewerVersion !== L.list[i].tk) {
            const media = $('#lv-stage audio, #lv-stage video');
            showItem(media ? { time: media.currentTime, paused: media.paused } : null);
          }
          else { viewerBar(); syncViewerNavigation(); }
        }
        else { closeViewer(false); window.AxonNavigation?.update('library', libraryParams()); }
      }
      statusLine(d);
      pollStatus();
    } catch (err) {
      errToast(err);
      if (!L.loaded) $('#lib-body').innerHTML = `<div class="lib-empty">${icon('alert-triangle')} No se pudo cargar la biblioteca. Usá Actualizar para reintentar.</div>`;
      refreshIcons();
    }
  }

  let pollTimer = null;
  function pollStatus(delay = 2000) {
    clearTimeout(pollTimer);
    if (!tabActive() || document.hidden) return;
    pollTimer = setTimeout(async () => {
      try {
        const status = await api('/api/library/status?live=1' + (vItemId ? `&item=${encodeURIComponent(vItemId)}` : ''));
        statusLine(status);
        if (status.revision !== L.revision) await load();
        pollStatus(2000);
      } catch (e) { if (e.status !== 401) pollStatus(15_000); }
    }, delay);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && tabActive()) { pollStatus(0); pollJobs(0); } else clearTimeout(pollTimer); });
  document.addEventListener('axon:section', e => { if(e.detail === 'library' && L.loaded) { pollStatus(0); pollJobs(0); } else clearTimeout(pollTimer); });

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
    if (window.AxonNavigation?.ready && !window.AxonNavigation.applying) {
      const params = { ...libraryParams(), type: v.type, value: v.value || null, item: null };
      const snapshot = libraryLocations[`${v.type}:${v.value || ''}:${L.q}`];
      void window.AxonNavigation.go(window.AxonNavigation.url('library', params), { view: snapshot });
      return;
    }
    L.view = v;
    localStorage.setItem('lib-view', JSON.stringify(v));
    L.sel.clear();
    L.selMode = false;
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
      const isOp = (t) => /^(tipo:|ext:)/.test(t) || /^[<>]\d/.test(t);
      const words = terms.filter((t) => !isOp(t));
      const kindAlias = { imagen: 'image', imagenes: 'image', foto: 'image', fotos: 'image', video: 'video', videos: 'video', audio: 'audio', vector: 'vector', vectores: 'vector', 'diseño': 'design', diseno: 'design', documento: 'doc', documentos: 'doc', texto: 'doc', otro: 'other', otros: 'other' };
      const kinds = new Set(), exts = new Set();
      let minSize = -1, maxSize = -1;
      for (const t of terms.filter(isOp)) {
        if (t.startsWith('tipo:')) { const k = KIND[t.slice(5)] ? t.slice(5) : kindAlias[t.slice(5)]; if (k) kinds.add(k); }
        else if (t.startsWith('ext:')) exts.add(t.slice(4).replace(/^\./, ''));
        else {
          const m = /^([<>])(\d+(?:[.,]\d+)?)(b|kb|mb|gb|tb)?$/.exec(t);
          if (m) { const v = Number(m[2].replace(',', '.')) * ({ b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 }[m[3] || 'mb']); if (m[1] === '>') minSize = v; else maxSize = v; }
        }
      }
      list = list.filter((it) => {
        if (kinds.size && !kinds.has(it.k)) return false;
        if (exts.size && !exts.has(it.e)) return false;
        if (minSize >= 0 && it.s <= minSize) return false;
        if (maxSize >= 0 && it.s >= maxSize) return false;
        if (!words.length) return true;
        const hay = `${it.p} ${KIND_ONE[it.k]} ${it.e}`.toLowerCase();
        return words.every((t) => hay.includes(t));
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
    for(const p of L.directories){if(!p.startsWith(dir+'/'))continue;const name=p.slice(dir.length+1).split('/')[0];if(name&&!map.has(name))map.set(name,{name,path:dir+'/'+name,count:0,size:0,cover:null});}
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

  // keep: re-render after a data refresh without losing the scroll position
  // (and the already-rendered pages) of the current view.
  function render(opts = {}) {
    if (!$('#tab-library')) return;
    renderSide();
    if (L.view.type === 'shares') return renderShares();
    if (L.view.type === 'dupes') return renderDupes();
    renderCrumbs();
    const main = $('#lib-main');
    const keepShown = opts.keep ? L.shown : 0;
    const keepTop = opts.keep ? main?.scrollTop || 0 : 0;
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
            <span class="lib-folder-cover">${f.cover ? `<img loading="lazy" src="${thumbUrl(f.cover)}" alt="" data-k="${f.cover.k}" data-e="${esc(f.cover.e)}">` : icon('folder')}</span>
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
    while (L.shown < Math.min(keepShown, L.list.length)) renderMore();
    if (keepTop && main) main.scrollTop = keepTop;
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
      : `<img loading="lazy" decoding="async" src="${thumbUrl(it)}" alt="" data-k="${it.k}" data-e="${esc(it.e)}">`;
    const badge = it.k === 'video'
      ? `<span class="lib-badge">${icon('play')}${fmtDur(it.d)}</span>`
      : it.k !== 'image' ? `<span class="lib-badge">${esc(it.e.toUpperCase())}</span>` : '';
    return `<div class="lib-tile${sel ? ' sel' : ''}" data-i="${i}" data-id="${it.id}" title="${esc(it.n)}">
      ${media}${badge}
      <button class="lib-check" data-act="sel" aria-label="Seleccionar ${esc(it.n)}">${icon('check')}</button>
      <button class="lib-fav${fav ? ' on' : ''}" data-act="fav" aria-label="Marcar favorito ${esc(it.n)}">${icon('star')}</button>
      <span class="lib-cap">${esc(it.n)}</span>
    </div>`;
  }

  function rowHtml(it, i) {
    const sel = L.sel.has(it.id);
    const media = it.th === -1 ? `<span class="lib-ext k-${it.k}">${icon(KIND[it.k]?.ic || 'file')}</span>` : `<img loading="lazy" src="${thumbUrl(it)}" alt="" data-k="${it.k}" data-e="${esc(it.e)}">`;
    return `<div class="lib-row${sel ? ' sel' : ''}" data-i="${i}" data-id="${it.id}">
      <span class="lib-row-th"><button class="lib-check" data-act="sel" aria-label="Seleccionar ${esc(it.n)}">${icon('check')}</button>${media}</span>
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

  // Broken thumbnails fall back to the kind badge. Delegated on capture —
  // 'error' doesn't bubble, and an inline onerror handler would let an
  // esc()'d &#39; decode back to a quote inside the attribute (XSS vector).
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.k) return;
    const span = document.createElement('span');
    span.className = `lib-ext k-${img.dataset.k}`;
    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', KIND[img.dataset.k]?.ic || 'file');
    ic.className = 'lucide-icon';
    const b = document.createElement('b');
    b.textContent = (img.dataset.e || '?').toUpperCase();
    span.append(ic, b);
    img.replaceWith(span);
    refreshIcons();
  }, true);

  // Delegated tile interactions.
  document.addEventListener('click', (e) => {
    const tile = e.target.closest('#tab-library .lib-tile, #tab-library .lib-row');
    if (!tile) return;
    const i = Number(tile.dataset.i);
    const it = L.list[i];
    if (!it) return;
    if (lpFired) { lpFired = false; return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fav') { e.stopPropagation(); return toggleFav([it.id], !L.favs.has(it.id)); }
    if (act === 'sel' || e.ctrlKey || e.metaKey || L.selMode || (L.sel.size && !e.shiftKey)) return toggleSel(i, e.shiftKey);
    if (e.shiftKey) return toggleSel(i, true);
    openViewer(i);
  });

  // Touch: long-press selects (and enters selection mode) instead of the
  // context menu; a tap then toggles more items.
  let lpFired = false;
  let lastTouch = 0;
  function setupLongPress(root) {
    let t = null, sx = 0, sy = 0;
    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      lastTouch = Date.now();
      const tile = e.target.closest('.lib-tile, .lib-row');
      if (!tile || !root.querySelector('#lib-body').contains(tile)) return;
      sx = e.clientX; sy = e.clientY; lpFired = false;
      clearTimeout(t);
      t = setTimeout(() => {
        lpFired = true;
        const i = Number(tile.dataset.i);
        const it = L.list[i];
        if (!it) return;
        L.selMode = true;
        if (!L.sel.has(it.id)) toggleSel(i, false);
        else syncSelClasses();
        navigator.vibrate?.(12);
      }, 430);
    });
    const cancel = () => clearTimeout(t);
    root.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
    root.addEventListener('pointerup', cancel);
    root.addEventListener('pointercancel', cancel);
    root.addEventListener('scroll', cancel, true);
  }

  function itemMenu(it, ids, i) {
    const list = ids.map((id) => L.byId.get(id)).filter(Boolean);
    const nTool = list.filter(canTool).length;
    const nTr = list.filter(canTranscribe).length;
    return [
      ...(i != null ? [{ icon: 'eye', label: 'Ver', run: () => openViewer(i) }] : []),
      { icon: 'share-2', label: ids.length > 1 ? `Compartir ${ids.length} archivos` : 'Compartir link', run: () => openShareModal(ids) },
      { icon: 'link-2', label: 'Agregar a un link existente…', run: () => addToShare(ids) },
      { icon: 'download', label: 'Descargar', run: () => downloadIds(ids) },
      ...(nTool ? [{ icon: 'wand-2', label: nTool > 1 ? `Optimizar / convertir ${nTool}…` : 'Optimizar / convertir…', run: () => openTools(ids) }] : []),
      ...(nTr ? [{ icon: 'captions', label: nTr > 1 ? `Transcribir ${nTr}…` : 'Transcribir…', run: () => openTranscribe(ids) }] : []),
      { icon: 'star', label: L.favs.has(it.id) ? 'Quitar de favoritos' : 'Favorito', run: () => toggleFav(ids, !L.favs.has(it.id)) },
      { icon: 'folder-plus', label: 'Agregar a colección…', run: () => addToCollection(ids) },
      { icon: 'folder-input', label: 'Mover a…', run: () => openMove(ids) },
      ...(ids.length === 1 ? [{ icon: 'pencil', label: 'Renombrar', run: () => renameItem(it) }] : []),
      { icon: 'folder-open', label: 'Ir a la carpeta', run: () => { closeViewer(); setView({ type: 'folder', value: dirOf(it.p) }); } },
      { icon: 'trash-2', label: 'Eliminar', danger: true, run: () => trashIds(ids) },
    ];
  }

  document.addEventListener('contextmenu', (e) => {
    const tile = e.target.closest('#tab-library .lib-tile, #tab-library .lib-row');
    if (!tile || typeof showCtxMenu !== 'function') return;
    e.preventDefault();
    if (Date.now() - lastTouch < 1200) return; // long-press = select on touch
    const it = L.list[Number(tile.dataset.i)];
    if (!it) return;
    const ids = L.sel.has(it.id) ? [...L.sel] : [it.id];
    showCtxMenu(itemMenu(it, ids, Number(tile.dataset.i)), e.clientX, e.clientY);
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
    $('#lib-selmode')?.classList.toggle('on', L.selMode || L.sel.size > 0);
    updateBulk();
  }

  function updateBulk() {
    const bar = $('#lib-bulk');
    if (!bar) return;
    const on = L.sel.size > 0 || L.selMode;
    $('#lib-body')?.classList.toggle('selecting', on);
    $('#tab-library')?.classList.toggle('lib-selecting', on);
    if (!on || L.view.type === 'shares' || L.view.type === 'dupes') { bar.classList.add('hidden'); return; }
    const ids = [...L.sel];
    const list = ids.map((id) => L.byId.get(id)).filter(Boolean);
    const size = list.reduce((a, it) => a + it.s, 0);
    const inCol = L.view.type === 'col';
    const nTool = list.filter(canTool).length;
    const nTr = list.filter(canTranscribe).length;
    const dis = ids.length ? '' : ' disabled';
    bar.innerHTML = `
      <span class="lib-bulk-n">${ids.length ? `<b>${ids.length}</b> · ${fmtSize(size)}` : 'Tocá archivos para elegir'}</span>
      <button class="btn-primary" data-b="share"${dis}>${icon('share-2')}<span>Compartir</span></button>
      <button class="btn-secondary" data-b="dl"${dis}>${icon('download')}<span>Descargar</span></button>
      ${nTool ? `<button class="btn-secondary" data-b="tools">${icon('wand-2')}<span>Optimizar</span></button>` : ''}
      ${nTr ? `<button class="btn-secondary lib-bw" data-b="tr">${icon('captions')}<span>Transcribir</span></button>` : ''}
      <button class="btn-secondary lib-bw" data-b="fav"${dis}>${icon('star')}<span>Favorito</span></button>
      <button class="btn-secondary lib-bw" data-b="col"${dis}>${icon('folder-plus')}<span>Colección</span></button>
      ${inCol ? `<button class="btn-secondary lib-bw" data-b="uncol"${dis}>${icon('folder-minus')}<span>Quitar</span></button>` : ''}
      <button class="btn-secondary lib-bw" data-b="move"${dis}>${icon('folder-input')}<span>Mover</span></button>
      <button class="btn-danger lib-bw" data-b="trash"${dis}>${icon('trash-2')}</button>
      <button class="btn-secondary lib-bw" data-b="all" title="Seleccionar todo">${icon('check-check')}</button>
      <button class="btn-secondary lib-bm" data-b="more" title="Más">${icon('more-horizontal')}</button>
      <button class="icon-btn" data-b="clear" title="Cancelar (Esc)">${icon('x')}</button>`;
    bar.classList.remove('hidden');
    const clear = () => { L.sel.clear(); L.selMode = false; syncSelClasses(); };
    bar.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', (e) => {
      const a = b.dataset.b;
      if (a === 'share') openShareModal(ids);
      if (a === 'dl') downloadIds(ids);
      if (a === 'tools') openTools(ids);
      if (a === 'tr') openTranscribe(ids);
      if (a === 'fav') toggleFav(ids, !ids.every((id) => L.favs.has(id)));
      if (a === 'col') addToCollection(ids);
      if (a === 'uncol') removeFromCollection(ids);
      if (a === 'move') openMove(ids);
      if (a === 'trash') trashIds(ids);
      if (a === 'all') { L.list.forEach((it) => L.sel.add(it.id)); syncSelClasses(); }
      if (a === 'clear') clear();
      if (a === 'more') {
        const r = e.currentTarget.getBoundingClientRect();
        showCtxMenu?.([
          ...(nTr ? [{ icon: 'captions', label: 'Transcribir…', run: () => openTranscribe(ids) }] : []),
          { icon: 'link-2', label: 'Agregar a un link existente…', run: () => addToShare(ids) },
          { icon: 'star', label: 'Favorito', run: () => toggleFav(ids, !ids.every((id) => L.favs.has(id))) },
          { icon: 'folder-plus', label: 'Agregar a colección…', run: () => addToCollection(ids) },
          ...(inCol ? [{ icon: 'folder-minus', label: 'Quitar de la colección', run: () => removeFromCollection(ids) }] : []),
          { icon: 'folder-input', label: 'Mover a…', run: () => openMove(ids) },
          { icon: 'check-check', label: 'Seleccionar todo', run: () => { L.list.forEach((it) => L.sel.add(it.id)); syncSelClasses(); } },
          { icon: 'trash-2', label: 'Eliminar', danger: true, run: () => trashIds(ids) },
        ].filter((x) => ids.length || x.icon === 'check-check'), r.left, r.top - 8);
      }
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
        ${item('dupes', undefined, 'copy', 'Duplicados')}
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
      if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') return toast('Usá un nombre sin barras, punto ni doble punto', 'error');
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
    try { await api('/api/library/favorite', { method: 'POST', body: { ids, on } }); } catch (err) { ids.forEach((id) => (on ? L.favs.delete(id) : L.favs.add(id))); errToast(err); }
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
      if(name.includes('/')||name==='.'||name==='..')throw new Error('Usá un nombre sin barras, punto ni doble punto.');
      await window.AxonTransfers.run(it.p,dirOf(it.p)+'/'+name,'move');
      toast('Renombrado', 'ok', '', 2000);
      closeViewer();
      load();
    } catch (err) { errToast(err); }
  }

  function allFolders() {
    const set = new Set([L.uploadRoot, ...L.roots, ...L.directories].filter(Boolean));
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
        const target=dest(), selected=ids.map(id=>L.byId.get(id)).filter(Boolean);
        await api('/api/files/mkdir',{method:'POST',body:{path:target}});
        const listing=await api('/api/files?path='+encodeURIComponent(target));
        const taken=new Set(listing.entries.map(e=>e.name));
        closeModal();
        // Sequential transfers report into a dock row: N/M + per-file % + ETA,
        // and each in-flight move is cancellable through the transfer API.
        ensureUpPanel().classList.remove('hidden');
        const row = document.createElement('div');
        row.className = 'lib-up lib-mv';
        row.innerHTML = `<span class="lib-up-n">Moviendo a ${esc(prettyPath(target))}</span><span class="lib-up-s"></span><button class="icon-btn lib-up-cancel" title="Cancelar movimiento">${icon('x')}</button><div class="lib-up-bar"><i></i></div>`;
        $('#lib-up-list').prepend(row); refreshIcons();
        const bar = row.querySelector('i'), stEl = row.querySelector('.lib-up-s');
        let cancel = false, currentOp = null;
        row.querySelector('.lib-up-cancel').addEventListener('click', async () => {
          cancel = true;
          if (currentOp?.id) await api(`/api/files/copyjob/${currentOp.id}`, { method: 'DELETE' }).catch(() => {});
        });
        let moved = 0;
        for (const [idx, it] of selected.entries()) {
          if (cancel) break;
          if (dirOf(it.p) === target) { moved++; continue; }
          let name = it.n, n = 1;
          const dot = it.n.lastIndexOf('.'), stem = dot > 0 ? it.n.slice(0, dot) : it.n, ext = dot > 0 ? it.n.slice(dot) : '';
          while (taken.has(name)) name = `${stem} (copia${n++ === 1 ? '' : ' ' + (n - 1)})${ext}`;
          stEl.textContent = `${idx + 1}/${selected.length} · ${it.n}`;
          try {
            await window.AxonTransfers.run(it.p, target + '/' + name, 'move', {
              onProgress: (op, info) => {
                currentOp = op;
                const pct = (idx + (info?.pct ?? 0) / 100) / selected.length * 100;
                bar.style.width = Math.min(100, pct).toFixed(1) + '%';
                if (info?.pct != null) stEl.textContent = `${idx + 1}/${selected.length} · ${it.n} · ${info.pct}%${info.eta ? ` · quedan ~${info.eta}` : ''}`;
              },
            });
          } catch (err) {
            if (cancel || err.cancelled) break;
            throw err;
          }
          taken.add(name); moved++;
        }
        bar.style.width = '100%';
        row.querySelector('.lib-up-cancel')?.remove();
        stEl.textContent = cancel ? `Cancelado · ${moved} movidos` : `✓ ${moved} movidos`;
        row.classList.add(cancel ? 'err' : 'done');
        toast(cancel ? `Movimiento cancelado — ${moved} archivos llegaron al destino` : `${moved} archivo${moved === 1 ? '' : 's'} movido${moved === 1 ? '' : 's'}`, cancel ? 'warn' : 'ok', '', 4000);
        L.sel.clear();
        closeViewer();
        load();
      } catch (err) {
        const button=$('#lib-mv-ok');if(button)button.disabled=false;
        L.sel.clear();load();
        if(!err.cancelled)await window.AxonTransfers.showError(err,{mode:'move'});
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
  let vItemId = null;
  let vItemVersion = null;
  let mediaGeneration = 0;
  let documentViewer = null;
  let vInfo = localStorage.getItem('lib-vinfo') !== '0';
  let vPanel = 'info';
  let tcPoll = null;
  let vZoom = null;
  const viewerMobile=matchMedia('(max-width:768px)');
  viewerMobile.addEventListener('change',()=>{if(viewerMobile.matches&&vPanel==='info'){vInfo=false;$('#lv-info')?.classList.add('hidden');if(!$('#lib-viewer')?.classList.contains('hidden'))viewerBar();}});

  function openViewer(i, fromRoute = false) {
    if (!fromRoute && !$('#lib-viewer')?.classList.contains('hidden') && !window.AxonNavigation?.applying) {
      if (vItemId === L.list[i]?.id) return;
      vIdx = i; L.cursor = L.list[i]?.id;
      showItem();
      window.AxonNavigation?.update('library', libraryParams());
      return;
    }
    if (!fromRoute && window.AxonNavigation?.ready && !window.AxonNavigation.applying) {
      L.cursor = L.list[i]?.id;
      void window.AxonNavigation.go(window.AxonNavigation.url('library', { ...libraryParams(), item: L.cursor }), { view: captureLibrary(), transient: true });
      return;
    }
    stopViewerMedia();
    vIdx = i;
    if (L.list[i]?.k === 'audio' && vPanel === 'info') vInfo = false;
    if(matchMedia('(max-width:768px)').matches && vPanel==='info')vInfo=false;
    const v = $('#lib-viewer');
    v.classList.remove('hidden');
    v.setAttribute('role','dialog');v.setAttribute('aria-modal','true');v.setAttribute('aria-label','Vista previa de archivo');
    document.body.classList.add('lib-noscroll');
    v.innerHTML = `
      <div class="lv-bar" id="lv-bar"></div>
      <div class="lv-main">
        <div class="lv-stage" id="lv-stage"></div>
        <button class="lv-nav prev" id="lv-prev">${icon('chevron-left')}</button>
        <button class="lv-nav next" id="lv-next">${icon('chevron-right')}</button>
        <aside class="lv-info${vInfo || vPanel === 'tr' ? '' : ' hidden'}" id="lv-info"></aside>
      </div>`;
    if (vPanel === 'tr') vInfo = true;
    $('#lv-prev').addEventListener('click', () => step(-1));
    $('#lv-next').addEventListener('click', () => step(1));
    let sx = null, sy = null;
    const st = $('#lv-stage');
    st.addEventListener('touchstart', (e) => {
      if (e.target.closest('audio,video,button,input') || v.classList.contains('lv-compact') || e.touches.length !== 1 || vZoom?.zoomed()) { sx = null; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    st.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
      else if (dy > 110 && Math.abs(dy) > Math.abs(dx)) closeViewer();
      sx = null;
    });
    showItem();
    $('#lv-close')?.focus({preventScroll:true});
  }

  function viewerQueue() {
    return L.list[vIdx]?.k === 'audio' ? L.list.filter(it => it.k === 'audio') : L.list;
  }

  function syncViewerNavigation() {
    const queue = viewerQueue(), pos = queue.findIndex(it => it.id === vItemId);
    const audio = L.list[vIdx]?.k === 'audio';
    $('#lv-prev').disabled = queue.length < 2 || (audio && pos <= 0);
    $('#lv-next').disabled = queue.length < 2 || (audio && pos >= queue.length - 1);
    $('#lv-prev').setAttribute('aria-label', audio ? 'Audio anterior' : 'Archivo anterior');
    $('#lv-next').setAttribute('aria-label', audio ? 'Audio siguiente' : 'Archivo siguiente');
  }

  function step(d) {
    const queue = viewerQueue(), pos = queue.findIndex(it => it.id === vItemId);
    if (pos < 0 || !queue.length) return;
    let next = pos + d;
    if (L.list[vIdx]?.k === 'audio') {
      if (next < 0 || next >= queue.length) return;
    } else next = (next + queue.length) % queue.length;
    vIdx = L.list.findIndex(it => it.id === queue[next].id);
    L.cursor = L.list[vIdx].id;
    showItem();
    window.AxonNavigation?.update('library', libraryParams());
  }

  function stopViewerMedia() {
    mediaGeneration++;
    documentViewer?.destroy(); documentViewer = null;
    clearTimeout(tcPoll);
    $('#lib-viewer')?.querySelectorAll('audio,video').forEach(media => {
      media.pause();
      media.removeAttribute('src');
      media.load();
    });
  }

  function closeViewer(back = true) {
    if (back && window.AxonNavigation?.ready && !window.AxonNavigation.applying) {
      window.AxonNavigation.close({ ...libraryParams(), item: null }); return;
    }
    const v = $('#lib-viewer');
    if (!v || v.classList.contains('hidden')) return;
    stopViewerMedia();
    vItemId = null;
    vItemVersion = null;
    v.classList.add('hidden');
    v.innerHTML = '';
    vZoom = null;
    document.body.classList.remove('lib-noscroll');
    clearTimeout(tcPoll);
  }

  function viewerBar() {
    const it = L.list[vIdx];
    if (!it) return;
    const tool = canTool(it);
    const tr = canTranscribe(it);
    $('#lv-bar').innerHTML = `
      <button class="lv-btn" id="lv-close" title="Cerrar (Esc)">${icon('x')}</button>
      <div class="lv-title"><b>${esc(it.n)}</b><small>${viewerQueue().findIndex(x => x.id === it.id) + 1} / ${viewerQueue().length} · ${fmtSize(it.s)}</small></div>
      <div class="lv-actions">
        <button class="lv-btn${L.favs.has(it.id) ? ' on' : ''} lv-hide-sm" id="lv-fav" title="Favorito (F)">${icon('star')}</button>
        ${tool ? `<button class="lv-btn" id="lv-tools" title="Optimizar / convertir (O)">${icon('wand-2')}<span>Optimizar</span></button>` : ''}
        ${tr ? `<button class="lv-btn${vInfo && vPanel === 'tr' ? ' on-ac' : ''}" id="lv-tr" title="Transcripción (T)">${icon('captions')}<span>${it.tr ? 'Transcripción' : 'Transcribir'}</span></button>` : ''}
        <button class="lv-btn lv-primary" id="lv-share" title="Compartir link (S)">${icon('share-2')}<span>Compartir</span></button>
        <a class="lv-btn lv-hide-sm" href="/api/library/file/${it.id}?dl=1" title="Descargar (D)">${icon('download')}</a>
        <button class="lv-btn" id="lv-more" title="Más">${icon('more-vertical')}</button>
        <button class="lv-btn lv-hide-sm${vInfo && vPanel === 'info' ? ' on-ac' : ''}" id="lv-info-t" title="Información (I)">${icon('info')}</button>
      </div>`;
    $('#lv-close').addEventListener('click', () => closeViewer());
    $('#lv-fav').addEventListener('click', () => toggleFav([it.id], !L.favs.has(it.id)));
    $('#lv-share').addEventListener('click', () => openShareModal([it.id]));
    $('#lv-tools')?.addEventListener('click', () => openTools([it.id]));
    $('#lv-tr')?.addEventListener('click', () => (it.tr || J.list.some((j) => j.type === 'transcribe' && j.itemId === it.id && ['queued', 'running'].includes(j.state)) ? togglePanel('tr') : openTranscribe([it.id])));
    $('#lv-info-t').addEventListener('click', () => togglePanel('info'));
    $('#lv-more').addEventListener('click', (e) => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      showCtxMenu?.([
        { icon: 'info', label: 'Información', run: () => togglePanel('info') },
        { icon: 'star', label: L.favs.has(it.id) ? 'Quitar de favoritos' : 'Favorito', run: () => toggleFav([it.id], !L.favs.has(it.id)) },
        { icon: 'download', label: 'Descargar original', run: () => { location.href = `/api/library/file/${it.id}?dl=1`; } },
        { icon: 'external-link', label: 'Abrir original en otra pestaña', run: () => window.open(mediaUrl(it), '_blank') },
        ...itemMenu(it, [it.id]).filter((x) => !['share-2', 'download', 'star'].includes(x.icon)),
      ], r.right - 240, r.bottom + 4);
    });
    refreshIcons();
  }

  function togglePanel(which) {
    if (vInfo && vPanel === which) vInfo = false;
    else { vInfo = true; vPanel = which; }
    localStorage.setItem('lib-vinfo', vInfo ? '1' : '0');
    $('#lv-info')?.classList.toggle('hidden', !vInfo);
    const it = L.list[vIdx];
    if (it) { renderInfo(it); viewerBar(); }
  }

  function mediaHtml(it) {
    const f = mediaUrl(it);
    if (it.k === 'video') {
      const src = it.wv ? mediaUrl(it, 'web') : f;
      const track = it.tr ? `<track kind="subtitles" label="Transcripción" src="/api/library/transcript/${it.id}/export?fmt=vtt&v=${Date.now()}">` : '';
      return `<video controls autoplay playsinline preload="metadata" ${it.th >= 1 ? `poster="${thumbUrl(it)}"` : ''} src="${src}">${track}</video>`;
    }
    if (it.k === 'image' || it.k === 'raw' || it.k === 'vector' || (it.k === 'design' && it.vw)) {
      const light = it.vw || it.bv;
      const src = light ? mediaUrl(it, 'view') : f;
      return `<div class="lv-img-wrap" id="lv-zoom">${light && it.th >= 1 ? `<img class="lv-ph" src="${thumbUrl(it)}" alt="">` : ''}<img class="lv-img" src="${src}" alt="" draggable="false" onload="this.previousElementSibling?.classList?.contains('lv-ph')&&this.previousElementSibling.remove()"></div>`;
    }
    if (it.k === 'audio') return `<div class="lv-audio"><audio controls autoplay preload="metadata" aria-label="${esc(it.n)}" src="${f}"></audio><small class="lv-audio-status" role="status"></small></div>`;
    if (window.AxonDocumentViewer?.supports(it.n)) return '<div class="lv-document"></div>';
    if (['txt', 'md'].includes(it.e)) return `<iframe class="lv-frame" src="${f}"></iframe>`;
    return `<div class="lv-file">${icon(KIND[it.k]?.ic || 'file')}<b>${esc(it.e.toUpperCase())}</b><span>${esc(it.n)}</span><span>Este tipo de archivo no tiene vista previa</span>
      <a class="btn-primary" href="${f}&dl=1">${icon('download')} Descargar</a></div>`;
  }

  // Wheel / pinch / double-tap zoom. Past 1.3× the light 2048px view is
  // swapped for the original so details stay sharp.
  function zoomer(wrap, it) {
    const img = wrap.querySelector('.lv-img');
    let s = 1, x = 0, y = 0, pinch = null, pan = null, lastTap = 0, full = !it.bv;
    const pts = {};
    const apply = () => {
      img.style.transform = `translate(${x}px,${y}px) scale(${s})`;
      wrap.classList.toggle('zoomed', s > 1);
    };
    const zoomAt = (ns, cx, cy) => {
      const r = wrap.getBoundingClientRect();
      cx -= r.left; cy -= r.top;
      ns = Math.max(1, Math.min(10, ns));
      x = cx - (cx - x) * (ns / s); y = cy - (cy - y) * (ns / s); s = ns;
      if (s === 1) { x = 0; y = 0; }
      apply();
      if (s > 1.3 && !full) {
        full = true;
        const o = new Image();
        o.onload = () => { if (img.isConnected) img.src = o.src; };
        o.src = mediaUrl(it);
      }
    };
    img.style.transformOrigin = '0 0';
    wrap.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
    wrap.addEventListener('dblclick', (e) => zoomAt(s > 1 ? 1 : 2.5, e.clientX, e.clientY));
    wrap.addEventListener('pointerdown', (e) => {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      const k = Object.keys(pts);
      if (k.length === 2) { const [a, b] = k.map((i) => pts[i]); pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s }; pan = null; return; }
      if (s > 1) { pan = { x: e.clientX - x, y: e.clientY - y }; wrap.setPointerCapture(e.pointerId); }
      if (e.pointerType === 'touch') {
        const now = Date.now();
        if (now - lastTap < 280) { zoomAt(s > 1 ? 1 : 2.5, e.clientX, e.clientY); lastTap = 0; } else lastTap = now;
      }
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      const k = Object.keys(pts);
      if (pinch && k.length === 2) { const [a, b] = k.map((i) => pts[i]); zoomAt(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2); }
      else if (pan) { x = e.clientX - pan.x; y = e.clientY - pan.y; apply(); }
    });
    const up = (e) => { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) pinch = null; if (!Object.keys(pts).length) pan = null; };
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', up);
    return { zoomed: () => s > 1, reset: () => zoomAt(1, 0, 0) };
  }

  function showItem(playback = null) {
    const it = L.list[vIdx];
    if (!it) return closeViewer();
    window.AxonRecent?.add({section:'library',name:it.n,path:it.p,url:window.AxonNavigation.url('library',{...libraryParams(),item:it.id})});
    stopViewerMedia();
    vItemId = it.id;
    vItemVersion = it.tk;
    const generation = mediaGeneration;
    const viewer = $('#lib-viewer'), compact = it.k === 'audio';
    viewer.classList.toggle('lv-compact', compact);
    viewer.setAttribute('role', compact ? 'region' : 'dialog');
    viewer.setAttribute('aria-label', compact ? 'Reproductor de audio' : 'Vista previa de archivo');
    if (compact) viewer.removeAttribute('aria-modal'); else viewer.setAttribute('aria-modal', 'true');
    document.body.classList.toggle('lib-noscroll', !compact);
    viewerBar();
    syncViewerNavigation();
    const st = $('#lv-stage');
    st.innerHTML = mediaHtml(it);
    if (window.AxonDocumentViewer?.supports(it.n)) {
      documentViewer = window.AxonDocumentViewer.mount(st.querySelector('.lv-document'), {
        name: it.n, sourceUrl: mediaUrl(it), documentUrl: '/api/library/document/' + encodeURIComponent(it.id),
        downloadUrl: '/api/library/file/' + encodeURIComponent(it.id) + '?dl=1',
      });
    }
    if (playback) {
      const media = st.querySelector('audio,video');
      if (media) {
        media.autoplay = !playback.paused;
        if (playback.paused) media.pause();
        media.addEventListener('loadedmetadata', () => {
          if (generation !== mediaGeneration) return;
          if (Number.isFinite(media.duration)) media.currentTime = Math.min(playback.time || 0, Math.max(0, media.duration - 0.05));
          if (!playback.paused) media.play().catch(() => {});
        }, { once: true });
      }
    }
    vZoom = $('#lv-zoom') ? zoomer($('#lv-zoom'), it) : null;
    if (compact) {
      const audio = st.querySelector('audio');
      audio.addEventListener('ended', () => { if (generation === mediaGeneration) step(1); });
      audio.addEventListener('error', () => {
        if (generation === mediaGeneration) st.querySelector('.lv-audio-status').textContent = 'No se pudo reproducir este audio. Podés descargar el original desde la barra.';
      });
    }
    if (it.k === 'video') {
      const note = document.createElement('div');
      note.className = 'lv-note hidden';
      note.setAttribute('role', 'status');
      st.appendChild(note);
      const video = st.querySelector('video');
      video.addEventListener('error', () => {
        if (generation !== mediaGeneration || !video.isConnected) return;
        if (!it.wv && [3, 4].includes(video.error?.code)) makeWeb(it, note, video, generation);
        else {
          note.classList.remove('hidden');
          note.textContent = 'No se pudo cargar el video. Revisá la conexión o descargá el original desde la barra.';
        }
      });
    }
    // Warm up the neighbours (light views for photos) for snappy navigation.
    for (const d of [1, -1]) {
      const n = L.list[(vIdx + d + L.list.length) % L.list.length];
      if (!n || n.th === -1) continue;
      new Image().src = thumbUrl(n);
      if (n.k === 'image' && (n.vw || n.bv)) new Image().src = `/api/library/view/${n.id}?k=${n.tk}`;
    }
    if (vPanel === 'tr' && !canTranscribe(it)) vPanel = 'info';
    renderInfo(it);
    refreshIcons();
  }

  async function makeWeb(it, note, video, generation) {
    if (note.dataset.preparing) return;
    note.dataset.preparing = '1';
    note.classList.remove('hidden');
    note.textContent = 'Preparando reproducción compatible…';
    const active = () => generation === mediaGeneration && video.isConnected && vItemId === it.id;
    const failed = (message) => {
      if (!active()) return;
      note.textContent = message + ' ';
      const retry = document.createElement('button');
      retry.className = 'btn-primary'; retry.textContent = 'Reintentar';
      retry.addEventListener('click', () => { delete note.dataset.preparing; makeWeb(it, note, video, generation); });
      note.appendChild(retry);
    };
    try {
      await api(`/api/library/web/${it.id}`, { method: 'POST' });
      if (!active()) return;
      const tick = async () => {
        if (!active()) return;
        let status;
        try { status = await api(`/api/library/web/${it.id}/status`); }
        catch { failed('Se interrumpió la preparación.'); return; }
        if (!active()) return;
        if (status.state === 'done') {
          it.wv = 1;
          const time = video.currentTime || 0;
          video.addEventListener('loadedmetadata', () => { video.currentTime = time; video.play().catch(() => {}); }, { once: true });
          video.src = mediaUrl(it, 'web');
          video.load();
          note.classList.add('hidden');
          return;
        }
        if (status.state === 'error' || status.state === 'none') {
          failed('No se pudo preparar la reproducción compatible.');
          return;
        }
        note.textContent = `Preparando reproducción compatible… ${status.state === 'queued' ? 'en cola' : (status.pct || 0) + '%'}`;
        tcPoll = setTimeout(tick, 1500);
      };
      void tick();
    } catch { failed('No se pudo iniciar la reproducción compatible.'); }
  }

  function renderInfo(it) {
    const el = $('#lv-info');
    if (!el) return;
    const tabs = canTranscribe(it)
      ? `<div class="lv-tabs"><button data-p="info" class="${vPanel === 'info' ? 'on' : ''}">${icon('info')} Info</button><button data-p="tr" class="${vPanel === 'tr' ? 'on' : ''}">${icon('captions')} Transcripción${it.tr ? '' : ''}</button><button class="lv-tabs-x" data-p="x" title="Cerrar panel">${icon('x')}</button></div>`
      : `<div class="lv-tabs"><button class="on" data-p="info">${icon('info')} Info</button><button class="lv-tabs-x" data-p="x" title="Cerrar panel">${icon('x')}</button></div>`;
    if (vPanel === 'tr' && canTranscribe(it)) {
      el.innerHTML = `${tabs}<div class="lv-tr" id="lv-tr-box"></div>`;
      bindTabs(el, it);
      renderTranscript(it, $('#lv-tr-box'));
      return;
    }
    const cols = L.cols.filter((c) => c.ids.includes(it.id));
    const rows = [
      ['Tipo', `${KIND_ONE[it.k]} · ${it.e.toUpperCase()}`],
      ['Tamaño', fmtSize(it.s)],
      it.w ? ['Dimensiones', `${it.w} × ${it.h}${it.w * it.h > 1e6 ? ` (${((it.w * it.h) / 1e6).toFixed(1)} MP)` : ''}`] : null,
      it.d ? ['Duración', fmtDur(it.d)] : null,
      it.d && it.k === 'video' ? ['Bitrate', `${((it.s * 8) / it.d / 1e6).toFixed(1)} Mbit/s`] : null,
      it.c ? ['Códec', it.c] : null,
      it.t ? ['Tomada', fmtDateTime(it.t)] : null,
      ['Modificado', fmtDateTime(it.m)],
    ].filter(Boolean);
    el.innerHTML = `${tabs}
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <h4>Ubicación</h4>
      <button class="lv-path" id="lv-goto" title="Ir a la carpeta">${icon('folder-open')} <span>${esc(prettyPath(dirOf(it.p)))}</span></button>
      ${cols.length ? `<h4>Colecciones</h4><div class="lv-tags">${cols.map((c) => `<span>${esc(c.name)}</span>`).join('')}</div>` : ''}
      ${canTool(it) ? `<button class="btn-secondary lv-share-big" id="lv-tools2">${icon('wand-2')} Optimizar o convertir</button>` : ''}
      <button class="btn-primary lv-share-big" id="lv-share2">${icon('link')} Crear link para compartir</button>`;
    bindTabs(el, it);
    $('#lv-goto').addEventListener('click', () => { closeViewer(); setView({ type: 'folder', value: dirOf(it.p) }); });
    $('#lv-share2').addEventListener('click', () => openShareModal([it.id]));
    $('#lv-tools2')?.addEventListener('click', () => openTools([it.id]));
    refreshIcons();
  }

  function bindTabs(el, it) {
    el.querySelectorAll('.lv-tabs button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.p === 'x') return togglePanel(vPanel);
      vPanel = b.dataset.p;
      renderInfo(it);
      viewerBar();
    }));
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
      if(e.key==='Tab' && !$('#lib-viewer').classList.contains('lv-compact')){
        const nodes=[...$('#lib-viewer').querySelectorAll('button,a[href],input,select,textarea,video,audio,iframe,[tabindex]')].filter(n=>n.offsetParent!==null&&!n.disabled&&n.tabIndex>=0);
        const i=nodes.indexOf(document.activeElement);
        if(nodes.length&&(i<0 || (e.shiftKey?i===0:i===nodes.length-1))){e.preventDefault();nodes[e.shiftKey?nodes.length-1:0].focus();}return;
      }
      if (inField) return;
      if (e.key !== 'Escape' && e.target.closest('.axon-doc')) return;
      if (e.key !== 'Escape' && (e.target.closest('audio,video') || ($('#lib-viewer').classList.contains('lv-compact') && !e.target.closest('#lib-viewer')))) {
        if ($('#lib-viewer').classList.contains('lv-compact') && !e.target.closest('#lib-viewer')) libraryKeyboard(e);
        return;
      }
      const it = L.list[vIdx];
      if (!it) return;
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'f' || e.key === 'F') toggleFav([it.id], !L.favs.has(it.id));
      else if (e.key === 's' || e.key === 'S') openShareModal([it.id]);
      else if (e.key === 'i' || e.key === 'I') togglePanel('info');
      else if ((e.key === 'o' || e.key === 'O') && canTool(it)) openTools([it.id]);
      else if ((e.key === 't' || e.key === 'T') && canTranscribe(it)) (it.tr ? togglePanel('tr') : openTranscribe([it.id]));
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
    if (libraryKeyboard(e)) return;
    if (e.key === '/') { e.preventDefault(); $('#lib-q').focus(); }
    else if (e.key === 'Escape' && (L.sel.size || L.selMode)) { L.sel.clear(); L.selMode = false; syncSelClasses(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'a' && L.view.type !== 'shares' && L.view.type !== 'dupes') {
      e.preventDefault();
      L.list.forEach((it) => L.sel.add(it.id));
      syncSelClasses();
    } else if (e.key === 'Delete' && L.sel.size) trashIds([...L.sel]);
  }

  // ---------- Modals ----------

  let promptResolve = null;
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
    const resolve = promptResolve; promptResolve = null; resolve?.('');
    $('#lib-modal').classList.add('hidden');
    $('#lib-modal-c').innerHTML = '';
  }

  function promptModal(title, value = '', placeholder = '') {
    return new Promise((resolve) => {
      openModal(`<h3>${esc(title)}</h3><input type="text" id="lib-prompt" class="filter-input lib-wide" value="${esc(value)}" placeholder="${esc(placeholder)}">
        <div class="modal-actions"><button class="btn-secondary" data-close>Cancelar</button><button class="btn-primary" id="lib-prompt-ok">Aceptar</button></div>`);
      const inp = $('#lib-prompt');
      promptResolve = resolve;
      const done = (v) => { promptResolve = null; closeModal(); resolve(v); };
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

  function sharePreview(list) {
    const size = list.reduce((a, it) => a + it.s, 0);
    return `<div class="lib-share-prev">${list.slice(0, 6).map((it) => (it.th === -1 ? `<span class="lib-ext k-${it.k}"><b>${esc(it.e.toUpperCase())}</b></span>` : `<img src="${thumbUrl(it)}" alt="" data-k="${it.k}" data-e="${esc(it.e)}">`)).join('')}${list.length > 6 ? `<span class="lib-more">+${list.length - 6}</span>` : ''}<small>${list.length} · ${fmtSize(size)}</small></div>`;
  }

  function openShareModal(ids, title) {
    ids = ids.filter((id) => L.byId.has(id));
    if (!ids.length) return toast('Nada para compartir', 'error');
    const list = ids.map((id) => L.byId.get(id));
    const defTitle = title || (list.length === 1 ? list[0].n : `${list.length} archivos`);
    const heavy = list.filter((it) => it.k === 'video' && (it.nw && !it.wv || Math.min(it.w || 0, it.h || 0) > 1080 || (it.d && (it.s * 8) / it.d > 12e6))).length;
    const bigPhotos = list.filter((it) => it.bv || it.vw).length;
    let ttl = Number(localStorage.getItem('lib-ttl') || 7 * 86400);
    openModal(`
      <h3>${icon('share-2')} Compartir ${list.length === 1 ? 'archivo' : `${list.length} archivos`}</h3>
      ${sharePreview(list)}
      <label>Título que verá quien abra el link<input type="text" id="lsh-title" value="${esc(defTitle)}"></label>
      <label>Mensaje <small class="lt-hint">(opcional, aparece arriba de los archivos)</small><textarea id="lsh-msg" rows="2" placeholder="Ej: ¡Hola! Acá están las fotos del evento."></textarea></label>
      <div class="lib-field-l">Disponible por</div>
      <div class="lib-pills" id="lsh-ttl">${TTLS.map((t) => `<button class="chip${t.s === ttl ? ' active' : ''}" data-s="${t.s}">${t.label}</button>`).join('')}</div>
      <label class="lib-toggle"><input type="checkbox" id="lsh-dl" checked><span>Permitir descargar <small>(si lo apagás, solo pueden ver online)</small></span></label>
      <label class="lib-toggle"><input type="checkbox" id="lsh-pw-on"><span>Proteger con contraseña</span></label>
      <input type="text" id="lsh-pw" class="filter-input lib-wide hidden" placeholder="Contraseña" autocomplete="off">
      <label class="lib-toggle"><input type="checkbox" id="lsh-notify" checked><span>Notificar visitas, reproducciones y descargas</span></label>
      <label class="lib-toggle" id="lsh-cdn-w"><input type="checkbox" id="lsh-cdn"${localStorage.getItem('lib-cdn') === '0' ? '' : ' checked'}><span>Acelerar con la CDN de Cloudflare <small>(más rápido, pero Cloudflare puede conservar copias temporales en sus nodos fuera del servidor)</small></span></label>
      ${heavy || bigPhotos ? `<p class="lib-muted">${icon('zap')} Para que cargue rápido: ${[bigPhotos ? `${bigPhotos} foto${bigPhotos > 1 ? 's' : ''} se ${bigPhotos > 1 ? 'muestran' : 'muestra'} en una versión liviana (el original se baja al descargar o hacer zoom)` : '', heavy ? `${heavy} video${heavy > 1 ? 's' : ''} pesado${heavy > 1 ? 's' : ''} o HEVC se ${heavy > 1 ? 'preparan' : 'prepara'} en una versión para streaming` : ''].filter(Boolean).join(' · ')}.</p>` : ''}
      <div class="modal-actions"><button class="btn-secondary" data-close>Cancelar</button><button class="btn-primary" id="lsh-ok">${icon('link')} Crear link</button></div>`, 'lib-share-modal');
    $$('#lsh-ttl .chip').forEach((b) => b.addEventListener('click', () => {
      ttl = Number(b.dataset.s);
      $$('#lsh-ttl .chip').forEach((x) => x.classList.toggle('active', x === b));
    }));
    $('#lsh-pw-on').addEventListener('change', (e) => {
      $('#lsh-pw').classList.toggle('hidden', !e.target.checked);
      $('#lsh-cdn-w').classList.toggle('hidden', e.target.checked);
      if (e.target.checked) $('#lsh-pw').focus();
    });
    $('#lsh-ok').addEventListener('click', async () => {
      const pw = $('#lsh-pw-on').checked ? $('#lsh-pw').value : '';
      if ($('#lsh-pw-on').checked && !pw) return $('#lsh-pw').focus();
      $('#lsh-ok').disabled = true;
      localStorage.setItem('lib-ttl', String(ttl));
      localStorage.setItem('lib-cdn', $('#lsh-cdn').checked ? '1' : '0');
      try {
        const r = await api('/api/library/shares', {
          method: 'POST',
          body: { ids, title: $('#lsh-title').value, msg: $('#lsh-msg').value, ttl, allowDownload: $('#lsh-dl').checked, password: pw, cdn: $('#lsh-cdn').checked, notifyActivity: $('#lsh-notify').checked },
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

  function shareTargets(s) {
    const text = `${s.title} — ${s.url}`;
    return [
      { ic: 'message-circle', l: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(text)}` },
      { ic: 'send', l: 'Telegram', href: `https://t.me/share/url?url=${encodeURIComponent(s.url)}&text=${encodeURIComponent(s.title)}` },
      { ic: 'mail', l: 'Mail', href: `mailto:?subject=${encodeURIComponent(s.title)}&body=${encodeURIComponent(`${s.msg ? s.msg + '\n\n' : ''}${s.url}`)}` },
    ];
  }

  function shareResult(s, pw) {
    openModal(`
      <h3>${icon('check-circle-2')} Link listo</h3>
      <div class="lib-link-box"><input type="text" readonly value="${esc(s.url)}" id="lsr-url"><button class="btn-primary" id="lsr-copy">${icon('copy')} Copiar</button></div>
      <div class="lib-share-done">
        <div class="lib-qr">${qrSvg(s.url)}</div>
        <div class="lib-share-facts">
          <p>${icon('clock')} ${esc(expiresIn(s.expires))}${s.expires ? ` · hasta ${esc(fmtDateTime(s.expires))}` : ''}</p>
          <p>${icon(s.allowDownload ? 'download' : 'eye')} ${s.allowDownload ? 'Pueden ver y descargar' : 'Solo pueden ver'}</p>
          ${pw ? `<p>${icon('lock')} Con contraseña — mandala por separado</p>` : ''}
          ${s.cdn ? `<p>${icon('zap')} Acelerado por la CDN de Cloudflare</p>` : ''}
          ${s.preparing ? `<p>${icon('loader', 'spin')} Preparando ${s.preparing} video${s.preparing > 1 ? 's' : ''} para streaming</p>` : ''}
          <div class="lib-share-btns">
            ${navigator.share ? `<button class="btn-primary" id="lsr-native">${icon('share')} Compartir…</button>` : ''}
            ${shareTargets(s).map((t) => `<a class="btn-secondary" href="${esc(t.href)}" target="_blank" rel="noopener noreferrer">${icon(t.ic)} ${t.l}</a>`).join('')}
            <a class="btn-secondary" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${icon('external-link')} Abrir</a>
          </div>
        </div>
      </div>
      <div class="modal-actions"><button class="btn-secondary" id="lsr-all">${icon('link')} Ver todos los links</button><button class="btn-primary" data-close>Listo</button></div>`);
    $('#lsr-url').addEventListener('focus', (e) => e.target.select());
    $('#lsr-copy').addEventListener('click', () => copyText(s.url));
    $('#lsr-native')?.addEventListener('click', () => navigator.share({ title: s.title, text: s.msg || s.title, url: s.url }).catch(() => {}));
    $('#lsr-all').addEventListener('click', () => { closeModal(); closeViewer(); setView({ type: 'shares' }); });
    copyText(s.url);
  }

  async function addToShare(ids) {
    let d;
    try { d = await api('/api/library/shares'); } catch (err) { return errToast(err); }
    const alive = d.shares.filter((s) => s.alive);
    if (!alive.length) return openShareModal(ids);
    openModal(`<h3>${icon('link-2')} Agregar ${ids.length} archivo${ids.length > 1 ? 's' : ''} a un link</h3>
      <p class="lib-muted">Quien ya tenga el link va a ver los archivos nuevos al recargar.</p>
      <div class="lib-picks">${alive.map((s) => `<button class="lib-pick" data-sid="${s.id}">${icon('link')} ${esc(s.title)} <em>${s.count} · ${esc(expiresIn(s.expires))}</em></button>`).join('')}</div>
      <div class="modal-actions"><button class="btn-secondary" data-close>Cancelar</button><button class="btn-secondary" id="lats-new">${icon('plus')} Link nuevo</button></div>`);
    $('#lats-new').addEventListener('click', () => openShareModal(ids));
    $$('#lib-modal .lib-pick').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await api(`/api/library/shares/${b.dataset.sid}`, { method: 'PATCH', body: { add: ids } });
        closeModal();
        toast(`Agregado a "${r.share.title}"`, 'ok', '', 2500);
        copyText(r.share.url);
      } catch (err) { errToast(err); }
    }));
  }

  function editShare(s, after) {
    const files = s.ids.map((id) => L.byId.get(id)).filter(Boolean);
    const remove = new Set();
    openModal(`
      <h3>${icon('pencil')} Editar link</h3>
      <label>Título<input type="text" id="les-title" value="${esc(s.title)}"></label>
      <label>Mensaje<textarea id="les-msg" rows="2">${esc(s.msg || '')}</textarea></label>
      <div class="lib-field-l">Vencimiento <small class="lt-hint">· ${esc(expiresIn(s.expires))}</small></div>
      <div class="lib-pills" id="les-ttl"><button class="chip active" data-s="-1">Sin cambios</button>${TTLS.map((t) => `<button class="chip" data-s="${t.s}">${t.s ? `${t.label} desde hoy` : t.label}</button>`).join('')}</div>
      <label class="lib-toggle"><input type="checkbox" id="les-notify"${s.notifyActivity !== false ? ' checked' : ''}><span>Notificar actividad de este link</span></label>
      <label class="lib-toggle"><input type="checkbox" id="les-dl"${s.allowDownload ? ' checked' : ''}><span>Permitir descargar</span></label>
      <label class="lib-toggle"><input type="checkbox" id="les-cdn"${s.cdn || s.hasPassword ? ' checked' : ''}${s.hasPassword ? ' disabled' : ''}><span>Acelerar con la CDN de Cloudflare${s.hasPassword ? ' <small>(no aplica con contraseña)</small>' : ''}</span></label>
      <label class="lib-toggle"><input type="checkbox" id="les-pw-on"${s.hasPassword ? ' checked' : ''}><span>Contraseña${s.hasPassword ? ' <small>(dejá el campo vacío para mantener la actual)</small>' : ''}</span></label>
      <input type="text" id="les-pw" class="filter-input lib-wide${s.hasPassword ? '' : ' hidden'}" placeholder="${s.hasPassword ? 'Nueva contraseña' : 'Contraseña'}" autocomplete="off">
      <div class="lib-field-l">Archivos <small class="lt-hint">· tocá para quitar</small></div>
      <div class="les-files">${files.map((it) => `<button class="les-f" data-id="${it.id}" title="${esc(it.n)}">${it.th === -1 ? `<span class="lib-ext k-${it.k}"><b>${esc(it.e.toUpperCase())}</b></span>` : `<img src="${thumbUrl(it)}" alt="" data-k="${it.k}" data-e="${esc(it.e)}">`}<i>${icon('x')}</i></button>`).join('')}</div>
      <div class="modal-actions"><button class="btn-secondary" data-close>Cancelar</button><button class="btn-primary" id="les-ok">${icon('save')} Guardar</button></div>`);
    let ttl = -1;
    $$('#les-ttl .chip').forEach((b) => b.addEventListener('click', () => { ttl = Number(b.dataset.s); $$('#les-ttl .chip').forEach((x) => x.classList.toggle('active', x === b)); }));
    $('#les-pw-on').addEventListener('change', (e) => $('#les-pw').classList.toggle('hidden', !e.target.checked));
    $$('#lib-modal .les-f').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.id;
      if (remove.has(id)) remove.delete(id); else remove.add(id);
      b.classList.toggle('off', remove.has(id));
    }));
    $('#les-ok').addEventListener('click', async () => {
      const body = { title: $('#les-title').value, msg: $('#les-msg').value, allowDownload: $('#les-dl').checked, notifyActivity: $('#les-notify').checked };
      if (!s.hasPassword) body.cdn = $('#les-cdn').checked;
      if (ttl >= 0) body.ttl = ttl || null;
      if (!$('#les-pw-on').checked && s.hasPassword) body.password = null;
      else if ($('#les-pw-on').checked && $('#les-pw').value) body.password = $('#les-pw').value;
      else if ($('#les-pw-on').checked && !s.hasPassword) return $('#les-pw').focus();
      if (remove.size) body.remove = [...remove];
      try {
        const result=await api(`/api/library/shares/${s.id}`, { method: 'PATCH', body });if(result.warning)toast(result.warning,'error','',12000);
        closeModal();
        toast('Link actualizado', 'ok', '', 2000);
        after?.();
      } catch (err) { errToast(err); }
    });
  }

  function showShareActivity(s) {
    const actions={view:'Visita',play:'Reproducción iniciada',download:'Descarga iniciada',zip:'ZIP iniciado'};
    openModal(`<h3>${icon('activity')} ${esc(s.title)}</h3><p class="lib-muted">${s.views} visitas · ${s.downloads} descargas iniciadas · ${s.visitors || 0} visitantes anónimos${s.visitorsCapped?'+':''}. Un inicio de descarga no confirma que haya terminado.</p>
      <label class="lib-toggle"><input type="checkbox" id="share-activity-notify"${s.notifyActivity!==false?' checked':''}><span>Recibir notificaciones de este link</span></label>
      <h4>Archivos compartidos</h4><ul class="share-files-list">${(s.files||[]).map(f=>`<li><b>${esc(f.name)}</b><small>${esc(prettyPath(f.path))} · ${fmtSize(f.size)}</small></li>`).join('')}</ul>
      <h4>Últimos 100 eventos</h4><p class="lib-muted">Los visitantes se identifican con un código anónimo. No identifica a una persona ni guarda su IP.</p><div class="share-activity-list">${(s.recentActivity||[]).map(ev=>`<div><b>${esc(actions[ev.kind]||ev.kind)}</b><span>${esc(ev.name||ev.client)}</span><small>${esc(fmtDateTime(ev.t))} · ${esc(ev.client)} · ${esc(ev.visitor)}</small></div>`).join('')||'<p>Todavía no hay actividad.</p>'}</div><div class="modal-actions"><button class="btn-secondary" data-close>Cerrar</button></div>`, 'lib-activity-modal');
    $('#share-activity-notify').addEventListener('change',async e=>{try{await api(`/api/library/shares/${s.id}`,{method:'PATCH',body:{notifyActivity:e.target.checked}});s.notifyActivity=e.target.checked;}catch(err){e.target.checked=!e.target.checked;errToast(err);}});
  }

  async function renderShares() {
    $('#lib-crumbs').innerHTML = `<span class="lib-crumb-title">Links compartidos</span><span class="lib-crumb-sp"></span>
      <button class="lib-crumb-act" id="lib-sh-clean">${icon('trash')} Borrar vencidos</button><span class="lib-status" id="lib-status"></span>`;
    $('#lib-sh-clean').addEventListener('click', async () => {
      if(!await confirmDialog('Borrar links vencidos','Se borra su historial de actividad. Los archivos se conservan.','Borrar vencidos'))return;
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
        <div class="lib-share-th n${thumbs.length}">${thumbs.map((it) => (it.th === -1 ? `<span class="lib-ext k-${it.k}"><b>${esc(it.e.toUpperCase())}</b></span>` : `<img loading="lazy" src="${thumbUrl(it)}" alt="" data-k="${it.k}" data-e="${esc(it.e)}">`)).join('') || icon('file')}</div>
        <div class="lib-share-main">
          <b>${esc(s.title)}</b>
          <small>${s.count} archivo${s.count === 1 ? '' : 's'} · ${fmtSize(s.size)}${s.missing ? ` · ${s.missing} ya no existen` : ''}${s.lastAccess ? ` · último acceso ${esc(fmtDateTime(s.lastAccess))}` : ''}</small>
          <div class="lib-share-meta">
            <span class="${s.alive ? 'ok' : 'bad'}">${icon('clock')} ${esc(expiresIn(s.expires))}</span>
            <span title="Visitantes anónimos aproximados">${icon('users')} ${s.visitors || 0}${s.visitorsCapped ? '+' : ''}</span><span title="Visitas">${icon('eye')} ${s.views}</span><span title="Descargas iniciadas; no confirma la transferencia completa">${icon('download')} ${s.downloads}</span>
            ${s.hasPassword ? `<span title="Con contraseña">${icon('lock')}</span>` : ''}${s.allowDownload ? '' : `<span>${icon('eye-off')} solo ver</span>`}
            ${s.cdn ? `<span title="Acelerado por la CDN de Cloudflare">${icon('zap')} CDN</span>` : ''}
            ${s.preparing ? `<span>${icon('loader', 'spin')} preparando ${s.preparing} video${s.preparing > 1 ? 's' : ''}</span>` : ''}
          </div>
          <small class="lib-share-url">${esc(s.url)}</small>
        </div>
        <div class="lib-share-acts">
          <button class="btn-secondary" data-a="copy" title="Copiar link">${icon('copy')}</button>
          <button class="btn-secondary" data-a="qr" title="QR y compartir">${icon('qr-code')}</button>
          <a class="btn-secondary" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="Abrir">${icon('external-link')}</a>
          <button class="btn-secondary" data-a="activity" title="Ver archivos y actividad">${icon('chart-no-axes-combined')}</button>
          <button class="btn-secondary" data-a="edit" title="Editar">${icon('pencil')}</button>
          <button class="btn-secondary" data-a="ext" title="Extender 7 días">${icon('calendar-plus')}</button>
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
          if (a === 'qr') return shareResult(s, '');
          if (a === 'activity') return showShareActivity(s);
          if (a === 'edit') return editShare(s, renderShares);
          if (a === 'ext') await api(`/api/library/shares/${s.id}`, { method: 'PATCH', body: { extend: 7 * 86400 } });
          if (a === 'del') {
            if (!(await confirmDialog('Eliminar link', `"${s.title}" deja de estar disponible en Axon. Los archivos se conservan.${s.cdn?' También se invalidan sus copias de CDN.':''}`))) return;
            const result=await api(`/api/library/shares/${s.id}`, { method: 'DELETE' });if(result.warning)toast(result.warning,'error','',12000);
          }
          renderShares();
          renderSide();
        } catch (err) { errToast(err); }
      }));
    });
    if (d.shares.some((s) => s.preparing)) setTimeout(() => { if (L.view.type === 'shares' && tabActive()) renderShares(); }, 8000);
    refreshIcons();
  }

  // ---------- Duplicates ----------

  let dupesGen = 0;
  async function renderDupes() {
    $('#lib-crumbs').innerHTML = `<span class="lib-crumb-title">Duplicados</span><span class="lib-crumb-sp"></span>
      <button class="lib-crumb-act" id="lib-dupes-re">${icon('refresh-cw')} Volver a buscar</button><span class="lib-status" id="lib-status"></span>`;
    $('#lib-dupes-re').addEventListener('click', () => renderDupes());
    updateBulk();
    const body = $('#lib-body');
    body.className = 'lib-body';
    body.innerHTML = `<div class="lib-empty">${icon('loader', 'spin')}<p>Buscando duplicados — se agrupa por tamaño y se compara el contenido…</p></div>`;
    refreshIcons();
    const gen = ++dupesGen;
    let d;
    try { d = await api('/api/library/duplicates'); }
    catch (err) {
      if (gen !== dupesGen) return;
      body.innerHTML = `<div class="lib-empty">${icon('alert-triangle')}<p>No se pudo buscar duplicados: ${esc(err.message)}</p></div>`;
      refreshIcons();
      return;
    }
    if (gen !== dupesGen || L.view.type !== 'dupes') return;
    const groups = d.groups || [];
    const dupCount = groups.reduce((a, g) => a + g.items.length - 1, 0);
    const reclaim = groups.reduce((a, g) => a + g.size * (g.items.length - 1), 0);
    $('#lib-sub').textContent = groups.length ? `${groups.length} grupos · ${dupCount} repetidos · ${fmtSize(reclaim)} recuperables` : 'Sin duplicados';
    if (!groups.length) {
      body.innerHTML = `<div class="lib-empty">${icon('check-check')}<p>No se encontraron duplicados.<br>Solo se consideran archivos con el mismo tamaño.</p></div>`;
      refreshIcons();
      return;
    }
    body.innerHTML = `
      <p class="lib-muted">${icon('info')} El más reciente de cada grupo queda desmarcado — revisá antes de eliminar. Van a la papelera de Axon y se pueden restaurar.${d.partial ? ` Análisis parcial: faltan ${d.remaining} grupos por comparar; usá "Volver a buscar" para continuar.` : ''}</p>
      <div class="lib-dupes">${groups.map((g) => `
        <section class="lib-dupe">
          <header><b>${g.items.length} copias · ${fmtSize(g.size)} c/u</b><span>recuperables ${fmtSize(g.size * (g.items.length - 1))}${g.exact ? '' : ' · contenido muestreado (archivos grandes)'}</span></header>
          <div class="lib-dupe-items">${g.items.map((it, ii) => `
            <label class="lib-dupe-item" data-id="${it.id}">
              <span class="lib-dupe-th">${it.th === -1 ? `<span class="lib-ext k-${it.k}"><b>${esc(it.e.toUpperCase())}</b></span>` : `<img loading="lazy" src="${thumbUrl(it)}" alt="" data-k="${it.k}" data-e="${esc(it.e)}">`}</span>
              <span class="lib-dupe-m"><b>${esc(it.n)}</b><small>${esc(prettyPath(dirOf(it.p)))}</small><small>${fmtDateTime(when(it))}${ii === 0 ? ' · más reciente' : ''}</small></span>
              <button class="icon-btn lib-dupe-open" data-p="${esc(dirOf(it.p))}" title="Abrir carpeta">${icon('folder-open')}</button>
              <input type="checkbox"${ii === 0 ? '' : ' checked'} aria-label="Enviar a papelera ${esc(it.n)}">
            </label>`).join('')}</div>
          <button class="btn-danger lib-dupe-del">${icon('trash-2')} Enviar marcados a papelera</button>
        </section>`).join('')}</div>`;
    body.querySelectorAll('.lib-dupe-open').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setView({ type: 'folder', value: b.dataset.p }); }));
    body.querySelectorAll('.lib-dupe-del').forEach((b) => b.addEventListener('click', async () => {
      const box = b.closest('.lib-dupe');
      const rows = [...box.querySelectorAll('.lib-dupe-item')];
      const ids = rows.filter((r) => r.querySelector('input[type=checkbox]').checked).map((r) => r.dataset.id);
      if (!ids.length) return toast('Marcá los repetidos a eliminar', 'error');
      if (ids.length === rows.length && !(await confirmDialog('Eliminar todas las copias', 'Marcaste TODAS las copias del grupo — no queda ninguna en la biblioteca.', 'Eliminar todas'))) return;
      await trashIds(ids);
    }));
    refreshIcons();
  }

  // ---------- Upload (chunked) ----------

  const upQ = [];
  let upActive = 0;

  function uploadDest() {
    return L.view.type === 'folder' ? L.view.value : '';
  }

  // Whole dropped folders keep their structure via webkitGetAsEntry.
  async function collectEntry(ent, prefix = '') {
    if (ent.isFile) {
      const f = await new Promise((res, rej) => ent.file(res, rej));
      return [{ f, rel: prefix + f.name }];
    }
    if (!ent.isDirectory) return [];
    const rd = ent.createReader(), out = [];
    for (;;) {
      const batch = await new Promise((res, rej) => rd.readEntries(res, rej));
      if (!batch.length) break;
      for (const sub of batch) out.push(...await collectEntry(sub, `${prefix}${ent.name}/`));
    }
    return out;
  }

  function ensureUpPanel() {
    const panel = $('#lib-uploads');
    if (!panel.querySelector('.lib-up-h')) {
      panel.innerHTML = `<div class="lib-up-h"><b>Subidas</b><button class="icon-btn" id="lib-up-x" title="Ocultar">${icon('x')}</button></div><div class="lib-up-list" id="lib-up-list"></div>`;
      $('#lib-up-x').addEventListener('click', () => { panel.classList.add('hidden'); panel.innerHTML = ''; });
    }
    return panel;
  }

  function startUploads(files) {
    if (!files.length) return;
    const dir = uploadDest();
    const panel = ensureUpPanel();
    panel.classList.remove('hidden');
    for (const { f, rel } of files) {
      const row = document.createElement('div');
      row.className = 'lib-up';
      row.innerHTML = `<span class="lib-up-n">${esc(rel || f.name)}</span><span class="lib-up-s">${fmtSize(f.size)}</span><button class="icon-btn lib-up-cancel" title="Cancelar subida">${icon('x')}</button><div class="lib-up-bar"><i></i></div>`;
      $('#lib-up-list').prepend(row);
      const job = { f, rel: rel || f.name, dir, row, uid: null, ctrl: null, cancelled: false };
      row.querySelector('.lib-up-cancel').addEventListener('click', () => cancelUpload(job));
      upQ.push(job);
    }
    refreshIcons();
    pumpUploads();
  }

  function cancelUpload(job) {
    job.cancelled = true;
    const i = upQ.indexOf(job);
    if (i >= 0) upQ.splice(i, 1);
    job.ctrl?.abort();
    if (job.uid) api(`/api/library/upload/${job.uid}`, { method: 'DELETE' }).catch(() => {});
    const s = job.row.querySelector('.lib-up-s');
    if (s) s.textContent = 'Cancelada';
    job.row.classList.add('err');
    job.row.querySelector('.lib-up-cancel')?.remove();
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

  async function uploadOne(job) {
    const { f, dir, row } = job;
    const bar = row.querySelector('i');
    const setSt = (txt, cls) => { const s = row.querySelector('.lib-up-s'); if (s) s.textContent = txt; if (cls) row.classList.add(cls); };
    try {
      job.ctrl = new AbortController();
      const init = await api('/api/library/upload/init', { method: 'POST', body: { name: f.name, size: f.size, dir: dir || undefined, rel: job.rel } });
      job.uid = init.id;
      const cs = init.chunkSize;
      let off = 0;
      const t0 = Date.now();
      while (off < f.size) {
        if (job.cancelled) return;
        const blob = f.slice(off, Math.min(f.size, off + cs));
        let tries = 0;
        while (true) {
          const res = await fetch(`/api/library/upload/${init.id}?offset=${off}`, { method: 'PUT', body: blob, credentials: 'same-origin', signal: job.ctrl.signal });
          const j = await res.json().catch(() => ({}));
          if (res.ok && j.ok) { off = j.received; break; }
          if (res.status === 409 && j.received != null) { off = j.received; break; }
          if (job.cancelled) return;
          if (++tries >= 4) throw new Error(j.error || `HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, 1000 * tries));
        }
        const pct = f.size ? off / f.size : 1;
        bar.style.width = (pct * 100).toFixed(1) + '%';
        const rate = off / Math.max(1, (Date.now() - t0) / 1000);
        const left = rate > 0 ? Math.round((f.size - off) / rate) : 0;
        setSt(`${Math.round(pct * 100)}% · ${fmtSize(rate)}/s${off < f.size ? ` · quedan ~${left < 60 ? `${Math.max(1, left)}s` : `${Math.ceil(left / 60)}min`}` : ''}`);
      }
      if (job.cancelled) return;
      const done = await api(`/api/library/upload/${init.id}/finish`, { method: 'POST' });
      bar.style.width = '100%';
      row.querySelector('.lib-up-cancel')?.remove();
      setSt(`✓ ${prettyPath(dirOf(done.path))}`, 'done');
    } catch (err) {
      if (job.cancelled || err.name === 'AbortError') return;
      row.querySelector('.lib-up-cancel')?.remove();
      setSt(`Error: ${err.message || err}`, 'err');
      // Retry just re-queues the file — a fresh init resumes from scratch.
      const rb = document.createElement('button');
      rb.className = 'btn-secondary lib-up-retry';
      rb.textContent = 'Reintentar';
      rb.addEventListener('click', () => {
        rb.remove(); job.cancelled = false; job.uid = null; job.ctrl = null;
        row.classList.remove('err');
        const s = row.querySelector('.lib-up-s'); if (s) s.textContent = fmtSize(f.size);
        upQ.push(job); pumpUploads();
      });
      row.querySelector('.lib-up-s')?.insertAdjacentElement('afterend', rb);
    }
  }

  // ---------- Tools: optimize / convert (Squoosh codecs + ffmpeg) ----------

  const IMG_FMTS = [
    { v: 'webp', l: 'WebP', q: 80, lossless: true },
    { v: 'avif', l: 'AVIF', q: 60, lossless: true },
    { v: 'jpg', l: 'JPEG · MozJPEG', q: 82 },
    { v: 'png', l: 'PNG · OxiPNG' },
    { v: 'jxl', l: 'JPEG XL', q: 80, lossless: true, cap: 'jxl' },
    { v: 'heic', l: 'HEIC', q: 60, lossless: true, cap: 'heic' },
    { v: 'gif', l: 'GIF' },
    { v: 'tiff', l: 'TIFF' },
    { v: 'bmp', l: 'BMP' },
    { v: 'original', l: 'Mismo formato', q: 80 },
  ];
  const PHOTO_PRESETS = [
    { k: 'web', l: 'Web equilibrado', d: 'WebP · calidad 80 · máx 2560 px', o: { format: 'webp', quality: 80, maxSide: 2560, lossless: false, colors: 0 } },
    { k: 'max', l: 'Máxima compresión', d: 'AVIF · calidad 55 · máx 2560 px', o: { format: 'avif', quality: 55, maxSide: 2560, lossless: false, colors: 0 } },
    { k: 'jpg', l: 'JPEG compatible', d: 'MozJPEG · calidad 82 · tamaño original', o: { format: 'jpg', quality: 82, maxSide: 0, lossless: false, colors: 0 } },
    { k: 'same', l: 'Mismo formato', d: 'Recomprime sin cambiar el tipo de archivo', o: { format: 'original', quality: 80, maxSide: 0, lossless: false, colors: 0 } },
    { k: 'lossless', l: 'Sin pérdida', d: 'PNG optimizado (OxiPNG)', o: { format: 'png', quality: 90, maxSide: 0, lossless: true, colors: 0 } },
  ];
  const VIDEO_PRESETS = [
    { k: 'web', l: 'Web / compartir', d: 'H.264 · 1080p · se reproduce en cualquier lado' },
    { k: 'small', l: 'Liviano', d: 'H.264 · 720p · ideal WhatsApp o mail' },
    { k: 'hevc', l: 'H.265 eficiente', d: '≈ mitad de peso · misma resolución' },
    { k: 'av1', l: 'AV1 máxima compresión', d: 'El más chico · tarda más en codificar' },
    { k: 'archive', l: 'Archivo alta calidad', d: 'H.265 casi sin pérdida · MKV' },
    { k: 'gif', l: 'GIF animado', d: '480 px · 12 fps · sin audio' },
  ];
  const AUDIO_FMTS = [
    { v: 'mp3', l: 'MP3', br: 192 }, { v: 'm4a', l: 'M4A · AAC', br: 160 }, { v: 'opus', l: 'Opus', br: 96 },
    { v: 'ogg', l: 'OGG · Opus', br: 96 }, { v: 'flac', l: 'FLAC (sin pérdida)' }, { v: 'wav', l: 'WAV' },
  ];
  const LANGS = [['', 'Detectar automáticamente'], ['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués'], ['fr', 'Francés'], ['it', 'Italiano'], ['de', 'Alemán'], ['ca', 'Catalán'], ['nl', 'Neerlandés'], ['pl', 'Polaco'], ['ru', 'Ruso'], ['uk', 'Ucraniano'], ['ja', 'Japonés'], ['zh', 'Chino'], ['ko', 'Coreano'], ['ar', 'Árabe']];
  const IMG_KINDS = ['image', 'raw', 'vector', 'design'];
  const toolKind = (it) => (IMG_KINDS.includes(it.k) && (it.th !== -1 || it.k !== 'design') ? 'image' : it.k === 'video' ? 'video' : it.k === 'audio' ? 'audio' : '');
  const canTool = (it) => !!toolKind(it);
  const canTranscribe = (it) => it.k === 'video' || it.k === 'audio';
  const secs = (v) => {
    const s = String(v || '').trim();
    if (!s) return 0;
    if (s.includes(':')) return s.split(':').reduce((a, x) => a * 60 + Number(x || 0), 0);
    return Number(s.replace(',', '.')) || 0;
  };

  let capsCache = null;
  async function getCaps(force) {
    if (capsCache && !force) return capsCache;
    capsCache = await api('/api/library/tools/caps').catch(() => ({ caps: {}, asr: {} }));
    return capsCache;
  }

  async function openTools(ids, tab) {
    const list = ids.map((id) => L.byId.get(id)).filter(Boolean);
    const groups = { image: list.filter((it) => toolKind(it) === 'image'), video: list.filter((it) => it.k === 'video'), audio: list.filter((it) => it.k === 'audio' || it.k === 'video') };
    const tabs = [
      groups.image.length && { k: 'image', l: 'Fotos', n: groups.image.length, ic: 'image' },
      groups.video.length && { k: 'video', l: 'Video', n: groups.video.length, ic: 'film' },
      groups.audio.length && { k: 'audio', l: groups.video.length && !list.some((it) => it.k === 'audio') ? 'Extraer audio' : 'Audio', n: groups.audio.length, ic: 'music' },
    ].filter(Boolean);
    if (!tabs.length) return toast('Estos archivos no se pueden optimizar ni convertir', 'error');
    const caps = (await getCaps()).caps || {};
    let cur = tabs.find((t) => t.k === tab)?.k || tabs[0].k;
    const st = {
      mode: localStorage.getItem('lt-mode') || 'copy',
      smaller: true,
      img: { preset: 'web', ...PHOTO_PRESETS[0].o, keepMeta: true, effort: 2 },
      vid: { preset: 'web', adv: false, container: 'mp4', vcodec: 'h264', crf: 23, speed: 'medium', maxH: 1080, fps: 0, acodec: 'aac', abr: 128, hw: 'auto', start: '', end: '' },
      aud: { format: 'mp3', bitrate: 192, mono: false, normalize: false, start: '', end: '' },
    };
    try { Object.assign(st.img, JSON.parse(localStorage.getItem('lt-img') || '{}')); } catch { /* defaults */ }
    try { Object.assign(st.vid, JSON.parse(localStorage.getItem('lt-vid') || '{}'), { start: '', end: '' }); } catch { /* defaults */ }
    try { Object.assign(st.aud, JSON.parse(localStorage.getItem('lt-aud') || '{}'), { start: '', end: '' }); } catch { /* defaults */ }

    openModal(`
      <h3>${icon('wand-2')} Optimizar y convertir</h3>
      ${tabs.length > 1 ? `<div class="lt-tabs">${tabs.map((t) => `<button data-t="${t.k}">${icon(t.ic)} ${t.l} <em>${t.n}</em></button>`).join('')}</div>` : ''}
      <div id="lt-body"></div>
      <div class="lt-dest">
        <div class="lt-seg" id="lt-mode">
          <button data-m="copy">${icon('copy-plus')}<span><b>Guardar como copia</b><small>El original queda intacto</small></span></button>
          <button data-m="replace">${icon('replace')}<span><b>Reemplazar original</b><small>El original va a la papelera</small></span></button>
        </div>
        <label class="lib-toggle" id="lt-smaller-w"><input type="checkbox" id="lt-smaller" checked><span>Descartar el resultado si no queda más liviano <small>(solo cuando no cambia el formato)</small></span></label>
      </div>
      <div class="modal-actions"><button class="btn-secondary" data-close>Cancelar</button><button class="btn-primary" id="lt-go"></button></div>`, 'lib-tools-modal');

    const body = $('#lt-body');
    const syncMode = () => {
      $$('#lt-mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === st.mode));
    };
    $$('#lt-mode button').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.m; localStorage.setItem('lt-mode', st.mode); syncMode(); }));
    $('#lt-smaller').addEventListener('change', (e) => { st.smaller = e.target.checked; });
    syncMode();

    const goLabel = () => {
      const n = groups[cur].length;
      const what = cur === 'image' ? (n === 1 ? 'foto' : 'fotos') : cur === 'video' ? (n === 1 ? 'video' : 'videos') : (n === 1 ? 'archivo' : 'archivos');
      $('#lt-go').innerHTML = `${icon('wand-2')} Procesar ${n} ${what}`;
      refreshIcons();
    };

    const drawTab = () => {
      $$('.lt-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === cur));
      if (cur === 'image') drawImage(); else if (cur === 'video') drawVideo(); else drawAudio();
      goLabel();
      refreshIcons();
    };
    $$('.lt-tabs button').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.t; drawTab(); }));

    // ---- Photos ----
    let cmpSeq = 0;
    function drawImage() {
      const one = groups.image.length === 1 ? groups.image[0] : null;
      const o = st.img;
      const fmt = IMG_FMTS.find((f) => f.v === o.format) || IMG_FMTS[0];
      const effFmt = o.format === 'original' ? (one ? one.e.replace('jpeg', 'jpg') : '') : o.format;
      const hasQ = !!fmt.q && !(o.lossless && fmt.lossless) || (effFmt === 'png' && o.colors);
      body.innerHTML = `
        ${one ? `<div class="lt-cmp" id="lt-cmp">
          <div class="lt-cmp-in" id="lt-cmp-in">
            <img class="lt-a" src="${mediaUrl(one, one.vw ? 'view' : 'file')}" alt="" draggable="false">
            <img class="lt-b" id="lt-b" alt="" draggable="false">
          </div>
          <div class="lt-cmp-line" id="lt-line"><span>${icon('chevrons-left-right')}</span></div>
          <span class="lt-cmp-lbl l">Original · ${fmtSize(one.s)}</span>
          <span class="lt-cmp-lbl r" id="lt-res">…</span>
          <span class="lt-cmp-hint">Arrastrá para comparar · rueda / pellizco para zoom</span>
        </div>` : `<div class="lt-many">${groups.image.slice(0, 8).map((it) => `<img src="${thumbUrl(it)}" alt="">`).join('')}${groups.image.length > 8 ? `<span>+${groups.image.length - 8}</span>` : ''}<small>${fmtSize(groups.image.reduce((a, it) => a + it.s, 0))}</small></div>`}
        <div class="lt-presets">${PHOTO_PRESETS.map((p) => `<button class="lt-preset${o.preset === p.k ? ' on' : ''}" data-p="${p.k}"><b>${p.l}</b><small>${p.d}</small></button>`).join('')}</div>
        <div class="lt-grid">
          <label>Formato de salida<select id="lt-fmt">${IMG_FMTS.map((f) => `<option value="${f.v}"${f.v === o.format ? ' selected' : ''}${f.cap && !caps[f.cap] ? ' disabled' : ''}>${f.l}${f.cap && !caps[f.cap] ? ' (no instalado)' : ''}</option>`).join('')}</select></label>
          <label>Tamaño máximo<select id="lt-max">${[[0, 'Original'], [3840, '3840 px (4K)'], [2560, '2560 px'], [2048, '2048 px'], [1920, '1920 px'], [1280, '1280 px'], [1080, '1080 px'], [800, '800 px'], [512, '512 px']].map(([v, l]) => `<option value="${v}"${v === o.maxSide ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="${hasQ ? '' : 'hidden'}"><span>Calidad <b id="lt-qv">${o.quality}</b></span><input type="range" id="lt-q" min="1" max="100" value="${o.quality}"></label>
          <label>Esfuerzo<select id="lt-eff"><option value="1"${o.effort === 1 ? ' selected' : ''}>Rápido</option><option value="2"${o.effort === 2 ? ' selected' : ''}>Normal</option><option value="3"${o.effort === 3 ? ' selected' : ''}>Máximo</option></select></label>
        </div>
        <div class="lt-checks">
          ${fmt.lossless ? `<label class="lib-toggle"><input type="checkbox" id="lt-lossless"${o.lossless ? ' checked' : ''}><span>Sin pérdida</span></label>` : ''}
          ${effFmt === 'png' || o.format === 'png' ? `<label class="lib-toggle"><input type="checkbox" id="lt-pal"${o.colors ? ' checked' : ''}><span>Reducir paleta (pngquant, hasta 256 colores)</span></label>` : ''}
          <label class="lib-toggle"><input type="checkbox" id="lt-meta"${o.keepMeta ? ' checked' : ''}><span>Mantener metadatos (fecha, cámara, GPS)</span></label>
        </div>`;
      const set = (patch, preset = 'custom') => {
        Object.assign(o, patch, { preset });
        localStorage.setItem('lt-img', JSON.stringify(o));
        drawImage();
        refreshIcons();
      };
      body.querySelectorAll('.lt-preset').forEach((b) => b.addEventListener('click', () => set({ ...PHOTO_PRESETS.find((p) => p.k === b.dataset.p).o }, b.dataset.p)));
      $('#lt-fmt').addEventListener('change', (e) => {
        const f = IMG_FMTS.find((x) => x.v === e.target.value);
        set({ format: f.v, quality: f.q || o.quality, lossless: false, colors: 0 });
      });
      $('#lt-max').addEventListener('change', (e) => set({ maxSide: Number(e.target.value) }, o.preset === 'custom' ? 'custom' : 'custom'));
      $('#lt-eff').addEventListener('change', (e) => set({ effort: Number(e.target.value) }, o.preset));
      $('#lt-q').addEventListener('input', (e) => { $('#lt-qv').textContent = e.target.value; });
      $('#lt-q').addEventListener('change', (e) => set({ quality: Number(e.target.value) }));
      $('#lt-lossless')?.addEventListener('change', (e) => set({ lossless: e.target.checked }));
      $('#lt-pal')?.addEventListener('change', (e) => set({ colors: e.target.checked ? 256 : 0, quality: e.target.checked ? 85 : o.quality }));
      $('#lt-meta').addEventListener('change', (e) => { o.keepMeta = e.target.checked; localStorage.setItem('lt-img', JSON.stringify(o)); });
      if (one) {
        compareWidget();
        runPreview(one);
      }
    }

    function compareWidget() {
      const box = $('#lt-cmp'), inner = $('#lt-cmp-in'), line = $('#lt-line'), b = $('#lt-b');
      let pos = 50, z = 1, x = 0, y = 0, drag = null, pan = null;
      const pts = {};
      let pinch = null;
      const apply = () => {
        b.style.clipPath = `inset(0 0 0 ${pos}%)`;
        line.style.left = pos + '%';
        inner.style.transform = `translate(${x}px,${y}px) scale(${z})`;
      };
      const zoomAt = (nz, cx, cy) => {
        const r = box.getBoundingClientRect();
        cx -= r.left; cy -= r.top;
        nz = Math.max(1, Math.min(10, nz));
        x = cx - (cx - x) * (nz / z); y = cy - (cy - y) * (nz / z); z = nz;
        if (z === 1) { x = 0; y = 0; }
        apply();
      };
      box.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
      box.addEventListener('dblclick', (e) => zoomAt(z > 1 ? 1 : 3, e.clientX, e.clientY));
      box.addEventListener('pointerdown', (e) => {
        box.setPointerCapture(e.pointerId);
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        const k = Object.keys(pts);
        if (k.length === 2) { const [a, c] = k.map((i) => pts[i]); pinch = { d: Math.hypot(a.x - c.x, a.y - c.y), z }; drag = null; pan = null; return; }
        const r = box.getBoundingClientRect();
        const lx = r.left + (pos / 100) * r.width;
        if (z > 1 && Math.abs(e.clientX - lx) > 24) pan = { x: e.clientX - x, y: e.clientY - y };
        else drag = true;
        if (drag) { pos = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)); apply(); }
      });
      box.addEventListener('pointermove', (e) => {
        if (!pts[e.pointerId]) return;
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        const k = Object.keys(pts);
        if (pinch && k.length === 2) { const [a, c] = k.map((i) => pts[i]); zoomAt(pinch.z * Math.hypot(a.x - c.x, a.y - c.y) / pinch.d, (a.x + c.x) / 2, (a.y + c.y) / 2); return; }
        if (drag) { const r = box.getBoundingClientRect(); pos = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)); apply(); }
        else if (pan) { x = e.clientX - pan.x; y = e.clientY - pan.y; apply(); }
      });
      const up = (e) => { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) pinch = null; if (!Object.keys(pts).length) { drag = null; pan = null; } };
      box.addEventListener('pointerup', up);
      box.addEventListener('pointercancel', up);
      apply();
    }

    const runPreview = debounce(async (one) => {
      const seq = ++cmpSeq;
      const res = $('#lt-res');
      const b = $('#lt-b');
      if (!res) return;
      res.innerHTML = `${icon('loader', 'spin')} Comprimiendo…`;
      $('#lt-cmp')?.classList.add('busy');
      refreshIcons();
      try {
        const r = await api('/api/library/tools/preview', { method: 'POST', body: { id: one.id, opts: st.img } });
        if (seq !== cmpSeq || !$('#lt-b')) return;
        const pct = Math.round((1 - r.size / r.before) * 100);
        await new Promise((ok) => { b.onload = ok; b.onerror = ok; b.src = r.url; });
        if (seq !== cmpSeq) return;
        const shown = b.naturalWidth > 0;
        res.innerHTML = `${esc(r.label)} · <b>${fmtSize(r.size)}</b> <em class="${pct >= 0 ? 'ok' : 'bad'}">${pct >= 0 ? '−' : '+'}${Math.abs(pct)}%</em>${shown ? '' : ' · tu navegador no muestra este formato'}`;
      } catch (err) {
        if (seq === cmpSeq) res.textContent = err.detail || err.message || 'No se pudo previsualizar';
      } finally {
        if (seq === cmpSeq) $('#lt-cmp')?.classList.remove('busy');
      }
    }, 450);

    // ---- Video ----
    function drawVideo() {
      const o = st.vid;
      const one = groups.video.length === 1 ? groups.video[0] : null;
      const sel = (id, opts, val) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(val) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
      body.innerHTML = `
        ${one ? `<p class="lt-info">${icon('film')} ${esc(one.n)} · ${fmtSize(one.s)}${one.d ? ' · ' + fmtDur(one.d) : ''}${one.w ? ` · ${one.w}×${one.h}` : ''}${one.c ? ' · ' + esc(one.c.toUpperCase()) : ''}</p>` : `<p class="lt-info">${icon('film')} ${groups.video.length} videos · ${fmtSize(groups.video.reduce((a, it) => a + it.s, 0))}</p>`}
        <div class="lt-presets">${VIDEO_PRESETS.map((p) => `<button class="lt-preset${!o.adv && o.preset === p.k ? ' on' : ''}" data-p="${p.k}"><b>${p.l}</b><small>${p.d}</small></button>`).join('')}
          <button class="lt-preset${o.adv ? ' on' : ''}" data-p="adv"><b>${icon('sliders-horizontal')} Avanzado</b><small>Códec, calidad, resolución, audio…</small></button></div>
        <div class="lt-grid${o.adv ? '' : ' hidden'}" id="lt-adv">
          <label>Contenedor${sel('lv-cont', [['mp4', 'MP4'], ['mkv', 'MKV'], ['webm', 'WebM'], ['mov', 'MOV'], ['gif', 'GIF animado']], o.container)}</label>
          <label>Códec de video${sel('lv-vc', [['h264', 'H.264 (compatible)'], ['h265', 'H.265 / HEVC'], ['av1', 'AV1'], ['vp9', 'VP9'], ['copy', 'Copiar sin recodificar']], o.vcodec)}</label>
          <label><span>Calidad (CRF) <b id="lv-crfv">${o.crf}</b></span><input type="range" id="lv-crf" min="14" max="50" value="${o.crf}"><small class="lt-hint">Menor = más calidad y más peso</small></label>
          <label>Velocidad${sel('lv-sp', [['fast', 'Rápida'], ['medium', 'Normal'], ['slow', 'Lenta (más chico)']], o.speed)}</label>
          <label>Resolución máxima${sel('lv-h', [[0, 'Original'], [2160, '4K (2160p)'], [1440, '1440p'], [1080, '1080p'], [720, '720p'], [480, '480p'], [360, '360p']], o.maxH)}</label>
          <label>FPS máximo${sel('lv-fps', [[0, 'Original'], [60, '60'], [30, '30'], [24, '24'], [15, '15']], o.fps)}</label>
          <label>Audio${sel('lv-ac', [['aac', 'AAC'], ['opus', 'Opus'], ['mp3', 'MP3'], ['copy', 'Copiar original'], ['none', 'Sin audio']], o.acodec)}</label>
          <label>Bitrate de audio${sel('lv-abr', [[64, '64 kbps'], [96, '96 kbps'], [128, '128 kbps'], [160, '160 kbps'], [192, '192 kbps'], [256, '256 kbps'], [320, '320 kbps']], o.abr)}</label>
          <label>Aceleración${sel('lv-hw', [['auto', caps.nvenc ? 'Auto (GPU NVENC)' : 'Auto (CPU)'], ['cpu', 'CPU (mejor compresión)'], ['gpu', caps.nvenc ? 'GPU NVENC' : 'GPU (no disponible)']], o.hw)}</label>
        </div>
        <div class="lt-trim">
          <label>Recortar desde<input type="text" id="lv-ss" value="${esc(o.start)}" placeholder="0:00" inputmode="decimal"></label>
          <label>hasta<input type="text" id="lv-to" value="${esc(o.end)}" placeholder="${one?.d ? fmtDur(one.d) : 'final'}" inputmode="decimal"></label>
          ${one && $('#lv-stage video') ? `<button class="btn-secondary" id="lv-now" title="Usar la posición actual del video">${icon('timer')} Posición actual</button>` : ''}
        </div>`;
      const save = () => localStorage.setItem('lt-vid', JSON.stringify({ ...o, start: '', end: '' }));
      body.querySelectorAll('.lt-preset').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.p === 'adv') o.adv = true;
        else { o.adv = false; o.preset = b.dataset.p; }
        save();
        drawVideo();
        refreshIcons();
      }));
      const bind = (id, key, num) => $(id)?.addEventListener('change', (e) => { o[key] = num ? Number(e.target.value) : e.target.value; save(); });
      bind('#lv-cont', 'container'); bind('#lv-vc', 'vcodec'); bind('#lv-sp', 'speed'); bind('#lv-h', 'maxH', 1); bind('#lv-fps', 'fps', 1);
      bind('#lv-ac', 'acodec'); bind('#lv-abr', 'abr', 1); bind('#lv-hw', 'hw');
      $('#lv-crf').addEventListener('input', (e) => { $('#lv-crfv').textContent = e.target.value; o.crf = Number(e.target.value); save(); });
      $('#lv-ss').addEventListener('input', (e) => { o.start = e.target.value; });
      $('#lv-to').addEventListener('input', (e) => { o.end = e.target.value; });
      $('#lv-now')?.addEventListener('click', () => {
        const v = $('#lv-stage video');
        const t = fmtDur(v.currentTime) || '0:00';
        if (!o.start) { o.start = t; $('#lv-ss').value = t; } else { o.end = t; $('#lv-to').value = t; }
      });
    }

    // ---- Audio ----
    function drawAudio() {
      const o = st.aud;
      const f = AUDIO_FMTS.find((x) => x.v === o.format) || AUDIO_FMTS[0];
      body.innerHTML = `
        <p class="lt-info">${icon('music')} ${groups.audio.length === 1 ? esc(groups.audio[0].n) : `${groups.audio.length} archivos`}${groups.audio.some((it) => it.k === 'video') ? ' · se extrae solo la pista de audio' : ''}</p>
        <div class="lt-presets">
          <button class="lt-preset" data-a="voice"><b>Voz / podcast</b><small>Opus 48 kbps mono · normalizado</small></button>
          <button class="lt-preset" data-a="music"><b>Música</b><small>AAC 192 kbps</small></button>
          <button class="lt-preset" data-a="mp3"><b>MP3 compatible</b><small>192 kbps</small></button>
          <button class="lt-preset" data-a="flac"><b>Sin pérdida</b><small>FLAC</small></button>
        </div>
        <div class="lt-grid">
          <label>Formato<select id="la-fmt">${AUDIO_FMTS.map((x) => `<option value="${x.v}"${x.v === o.format ? ' selected' : ''}>${x.l}</option>`).join('')}</select></label>
          <label class="${f.br ? '' : 'hidden'}">Bitrate<select id="la-br">${[32, 48, 64, 96, 128, 160, 192, 256, 320].map((v) => `<option value="${v}"${v === o.bitrate ? ' selected' : ''}>${v} kbps</option>`).join('')}</select></label>
        </div>
        <div class="lt-checks">
          <label class="lib-toggle"><input type="checkbox" id="la-mono"${o.mono ? ' checked' : ''}><span>Mono</span></label>
          <label class="lib-toggle"><input type="checkbox" id="la-norm"${o.normalize ? ' checked' : ''}><span>Normalizar volumen (−16 LUFS)</span></label>
        </div>
        <div class="lt-trim">
          <label>Recortar desde<input type="text" id="la-ss" value="${esc(o.start)}" placeholder="0:00"></label>
          <label>hasta<input type="text" id="la-to" value="${esc(o.end)}" placeholder="final"></label>
        </div>`;
      const save = () => localStorage.setItem('lt-aud', JSON.stringify({ ...o, start: '', end: '' }));
      const presets = { voice: { format: 'opus', bitrate: 48, mono: true, normalize: true }, music: { format: 'm4a', bitrate: 192, mono: false, normalize: false }, mp3: { format: 'mp3', bitrate: 192, mono: false, normalize: false }, flac: { format: 'flac', mono: false, normalize: false } };
      body.querySelectorAll('.lt-preset').forEach((b) => b.addEventListener('click', () => { Object.assign(o, presets[b.dataset.a]); save(); drawAudio(); refreshIcons(); }));
      $('#la-fmt').addEventListener('change', (e) => { o.format = e.target.value; o.bitrate = AUDIO_FMTS.find((x) => x.v === o.format).br || o.bitrate; save(); drawAudio(); refreshIcons(); });
      $('#la-br').addEventListener('change', (e) => { o.bitrate = Number(e.target.value); save(); });
      $('#la-mono').addEventListener('change', (e) => { o.mono = e.target.checked; save(); });
      $('#la-norm').addEventListener('change', (e) => { o.normalize = e.target.checked; save(); });
      $('#la-ss').addEventListener('input', (e) => { o.start = e.target.value; });
      $('#la-to').addEventListener('input', (e) => { o.end = e.target.value; });
    }

    $('#lt-go').addEventListener('click', async () => {
      const ids2 = groups[cur].map((it) => it.id);
      let opts;
      if (cur === 'image') {
        const { preset, ...rest } = st.img;
        opts = rest;
      } else if (cur === 'video') {
        const o = st.vid;
        opts = o.adv
          ? { container: o.container, vcodec: o.vcodec, crf: o.crf, speed: o.speed, maxH: o.maxH, fps: o.fps, acodec: o.acodec, abr: o.abr }
          : { preset: o.preset };
        Object.assign(opts, { hw: o.hw, start: secs(o.start), end: secs(o.end) });
      } else {
        const o = st.aud;
        opts = { format: o.format, bitrate: o.bitrate, mono: o.mono, normalize: o.normalize, start: secs(o.start), end: secs(o.end) };
      }
      if (st.mode === 'replace' && !(await confirmDialog('Reemplazar originales', `${ids2.length === 1 ? 'El original va' : `Los ${ids2.length} originales van`} a la papelera de Axon y en su lugar queda la versión nueva. Se puede restaurar desde Archivos → Papelera.`, 'Reemplazar'))) return;
      $('#lt-go').disabled = true;
      try {
        const r = await api('/api/library/tools/run', { method: 'POST', body: { ids: ids2, op: cur, opts, mode: st.mode, onlySmaller: st.smaller } });
        closeModal();
        toast(`${r.jobs.length} ${r.jobs.length === 1 ? 'trabajo' : 'trabajos'} en cola${r.skipped?.length ? ` · ${r.skipped.length} omitidos` : ''}`, 'ok', '', 2500);
        showJobs(true);
      } catch (err) {
        $('#lt-go').disabled = false;
        errToast(err);
      }
    });
    drawTab();
  }

  // ---------- Jobs panel ----------

  const J = { list: [], timer: null, seen: new Map(), open: false, reloadT: null, wasActive: false, fails: 0 };
  const JOB_IC = { image: 'image', video: 'film', audio: 'music', transcribe: 'captions' };
  const STAGE = { starting: 'iniciando el motor…', loading: 'cargando modelo…', downloading: 'descargando modelo (una sola vez)…', audio: 'leyendo audio…', transcribing: 'transcribiendo', encoding: 'procesando', 'encoding-gpu': 'procesando (GPU)', replacing: 'reemplazando…', queued: 'en cola' };

  function showJobs(force) {
    if (force) J.open = true;
    pollJobs(0);
  }

  function pollJobs(delay = 1500) {
    clearTimeout(J.timer);
    if (!tabActive() || document.hidden) return;
    J.timer = setTimeout(async () => {
      let d;
      try { d = await api('/api/library/tools/jobs'); J.fails = 0; } catch (e) { if (e.status !== 401) pollJobs(Math.min(60_000, 15_000 * ++J.fails)); return; }
      J.list = d.jobs;
      let changed = false;
      for (const j of d.jobs) {
        const prev = J.seen.get(j.id);
        if (prev && prev !== j.state && ['done', 'skipped'].includes(j.state)) changed = true;
        if (prev && prev !== j.state && j.state === 'done' && j.type === 'transcribe') onTranscribed(j);
        J.seen.set(j.id, j.state);
      }
      // Only re-open when work starts again — "Ocultar" must stick while a
      // job keeps running.
      if (d.active && !J.wasActive) J.open = true;
      J.wasActive = !!d.active;
      renderJobs();
      if (changed) {
        clearTimeout(J.reloadT);
        J.reloadT = setTimeout(() => load(), 400);
      }
      if (d.active) pollJobs();
    }, delay);
  }

  function renderJobs() {
    const el = $('#lib-jobs');
    if (!el) return;
    const active = J.list.filter((j) => j.state === 'queued' || j.state === 'running').length;
    const nav = $('#nav-count-library');
    if (!J.open || !J.list.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `<div class="lib-up-h"><b>${active ? `Procesando · ${active}` : 'Trabajos terminados'}</b>
      <span class="lib-jobs-acts">${J.list.some((j) => !['queued', 'running'].includes(j.state)) ? `<button class="icon-btn" id="lj-clear" title="Limpiar terminados">${icon('list-x')}</button>` : ''}<button class="icon-btn" id="lj-x" title="Ocultar">${icon('x')}</button></span></div>
      <div class="lib-up-list">${J.list.map((j) => {
        const pct = j.state === 'done' ? 100 : j.pct || 0;
        let sub = '';
        if (j.state === 'running') sub = `${STAGE[j.stage] || 'procesando'}${j.pct ? ` · ${j.pct}%` : ''}`;
        else if (j.state === 'queued') sub = 'en cola';
        else if (j.state === 'done' && j.type !== 'transcribe') sub = `${fmtSize(j.before)} → <b>${fmtSize(j.after || 0)}</b> <em class="${j.after <= j.before ? 'ok' : 'bad'}">${j.after <= j.before ? '−' : '+'}${Math.abs(Math.round((1 - (j.after || 0) / j.before) * 100))}%</em>${j.mode === 'replace' ? ' · reemplazado' : ''}`;
        else if (j.state === 'done') sub = esc(j.note || 'Listo');
        else if (j.state === 'skipped') sub = esc(j.note || 'Omitido');
        else if (j.state === 'cancelled') sub = 'Cancelado';
        else if (j.state === 'error') sub = `<span class="bad">${esc(j.error || 'Error')}</span>`;
        const act = ['queued', 'running'].includes(j.state)
          ? `<button class="icon-btn" data-cancel="${j.id}" title="Cancelar">${icon('square')}</button>`
          : j.state === 'done' && j.outId ? `<button class="icon-btn" data-open="${j.outId}" data-tr="${j.type === 'transcribe' ? 1 : ''}" title="Ver">${icon(j.type === 'transcribe' ? 'captions' : 'eye')}</button>` : '';
        return `<div class="lj lj-${j.state}"><span class="lj-ic">${icon(JOB_IC[j.type] || 'wand-2')}</span>
          <div class="lj-m"><b title="${esc(j.name)}">${esc(j.name)}</b><small class="lj-l">${esc(j.label)}</small><small>${sub}</small>
          ${['queued', 'running'].includes(j.state) ? `<div class="lib-up-bar"><i style="width:${pct}%"></i></div>` : ''}</div>${act}</div>`;
      }).join('')}</div>`;
    $('#lj-x').addEventListener('click', () => { J.open = false; el.classList.add('hidden'); });
    $('#lj-clear')?.addEventListener('click', async () => { await api('/api/library/tools/jobs/clear', { method: 'POST' }).catch(errToast); pollJobs(0); });
    el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => { await api(`/api/library/tools/jobs/${b.dataset.cancel}`, { method: 'DELETE' }).catch(errToast); pollJobs(200); }));
    el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openById(b.dataset.open, !!b.dataset.tr)));
    if (nav && active) nav.dataset.busy = '1'; else if (nav) delete nav.dataset.busy;
    refreshIcons();
  }

  async function openById(id, transcript) {
    if (!L.byId.has(id)) await load();
    const it = L.byId.get(id);
    if (!it) return toast('El archivo ya no está en la biblioteca', 'error');
    let i = L.list.findIndex((x) => x.id === id);
    if (i < 0) {
      setView({ type: 'folder', value: dirOf(it.p) });
      i = L.list.findIndex((x) => x.id === id);
    }
    if (i < 0) return;
    if (transcript) vPanel = 'tr';
    openViewer(i);
  }

  function onTranscribed(j) {
    const it = L.byId.get(j.outId);
    if (it) it.tr = 1;
    const cur = L.list[vIdx];
    if (cur && cur.id === j.outId && !$('#lib-viewer').classList.contains('hidden')) {
      cur.tr = 1;
      vPanel = 'tr';
      viewerBar(); renderInfo(cur);
    }
    toast(`Transcripción lista: ${j.name}`, 'ok', '', 3000);
  }

  // ---------- Transcription ----------

  async function openTranscribe(ids) {
    const list = ids.map((id) => L.byId.get(id)).filter((it) => it && canTranscribe(it));
    if (!list.length) return toast('Elegí videos o audios para transcribir', 'error');
    const caps = await getCaps(true);
    const asr = caps.asr || {};
    let engine = localStorage.getItem('tr-engine') || 'whisper';
    if (engine === 'whisper' && caps.caps && caps.caps.whisper === false) engine = 'parakeet';
    const had = list.filter((it) => it.tr).length;
    const status = (e) => {
      const h = asr[e];
      if (!h) return '<em>apagado · se carga al usarlo</em>';
      const mins = Math.max(1, Math.round((h.idleLeft || 0) / 60));
      return `<em class="ok">${h.busy ? 'trabajando' : h.loaded ? `en memoria · se libera en ${mins} min` : 'iniciado'}${h.device ? ` · ${h.device === 'cuda' ? 'GPU' : 'CPU'}` : ''}</em>`;
    };
    openModal(`
      <h3>${icon('captions')} Transcribir ${list.length === 1 ? esc(list[0].n) : `${list.length} archivos`}</h3>
      <div class="lt-engines">
        <button class="lt-engine" data-e="whisper"${caps.caps?.whisper === false ? ' disabled' : ''}><b>Whisper</b><small>Más preciso · 99 idiomas · traduce · ${caps.caps?.cuda ? 'GPU' : 'CPU'}</small>${status('whisper')}</button>
        <button class="lt-engine" data-e="parakeet"><b>Parakeet v3 · NVIDIA</b><small>Muy rápido en CPU · 25 idiomas europeos</small>${status('parakeet')}</button>
      </div>
      <div class="lt-grid">
        <label id="tr-model-w">Modelo<select id="tr-model">
          <option value="turbo">turbo · rápido y preciso (recomendado)</option>
          <option value="large-v3">large-v3 · máxima precisión</option>
          <option value="medium">medium</option>
          <option value="small">small · el más rápido</option></select></label>
        <label>Idioma<select id="tr-lang">${LANGS.map(([v, l]) => `<option value="${v}"${v === (localStorage.getItem('tr-lang') ?? 'es') ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label id="tr-task-w">Tarea<select id="tr-task"><option value="transcribe">Transcribir en el idioma original</option><option value="translate">Traducir al inglés</option></select></label>
      </div>
      <label id="tr-prompt-w">Palabras clave <small class="lt-hint">(opcional: nombres, marcas, jerga — mejora la precisión)</small><input type="text" id="tr-prompt" placeholder="Ej: Axon, Demo, ablandador"></label>
      <p class="lib-muted">${icon('memory-stick')} El modelo se carga solo para esto y se descarga de la memoria a los ${Math.round((asr.idle || 600) / 60)} minutos sin uso.</p>
      ${had ? `<p class="lib-muted">${icon('alert-triangle')} ${had === 1 && list.length === 1 ? 'Ya tiene' : `${had} ya tienen`} transcripción — se va a reemplazar.</p>` : ''}
      <div class="modal-actions">${asr.whisper || asr.parakeet ? `<button class="btn-secondary" id="tr-free" title="Cerrar los motores cargados y liberar memoria">${icon('power')} Liberar memoria</button><span class="lt-sp"></span>` : ''}<button class="btn-secondary" data-close>Cancelar</button><button class="btn-primary" id="tr-go">${icon('captions')} Transcribir</button></div>`, 'lib-tr-modal');
    const sync = () => {
      $$('.lt-engine').forEach((b) => b.classList.toggle('on', b.dataset.e === engine));
      $('#tr-model-w').classList.toggle('hidden', engine !== 'whisper');
      $('#tr-task-w').classList.toggle('hidden', engine !== 'whisper');
      $('#tr-prompt-w').classList.toggle('hidden', engine !== 'whisper');
    };
    $('#tr-model').value = localStorage.getItem('tr-model') || 'turbo';
    $$('.lt-engine').forEach((b) => b.addEventListener('click', () => { engine = b.dataset.e; sync(); }));
    sync();
    $('#tr-free')?.addEventListener('click', async () => {
      await Promise.all(['whisper', 'parakeet'].map((e) => api(`/api/library/asr/${e}/stop`, { method: 'POST' }).catch(() => {})));
      toast('Memoria liberada', 'ok', '', 2000);
      closeModal();
    });
    $('#tr-go').addEventListener('click', async () => {
      localStorage.setItem('tr-engine', engine);
      localStorage.setItem('tr-model', $('#tr-model').value);
      localStorage.setItem('tr-lang', $('#tr-lang').value);
      $('#tr-go').disabled = true;
      try {
        await api('/api/library/tools/run', {
          method: 'POST',
          body: { ids: list.map((it) => it.id), op: 'transcribe', opts: { engine, model: $('#tr-model').value, language: $('#tr-lang').value, task: $('#tr-task').value, prompt: $('#tr-prompt').value } },
        });
        closeModal();
        showJobs(true);
        if (list.length === 1 && L.list[vIdx]?.id === list[0].id) { vPanel = 'tr'; renderInfo(list[0]); }
      } catch (err) {
        $('#tr-go').disabled = false;
        errToast(err);
      }
    });
  }

  const trCache = new Map();
  async function renderTranscript(it, el) {
    const job = J.list.find((j) => j.type === 'transcribe' && j.itemId === it.id && ['queued', 'running'].includes(j.state));
    if (!it.tr) {
      el.innerHTML = job
        ? `<div class="lv-tr-empty">${icon('loader', 'spin')}<p>${esc(STAGE[job.stage] || 'Transcribiendo')}${job.pct ? ` · ${job.pct}%` : ''}</p><div class="lib-up-bar"><i style="width:${job.pct || 0}%"></i></div></div>`
        : `<div class="lv-tr-empty">${icon('captions')}<p>Todavía no tiene transcripción.</p><button class="btn-primary" id="lv-tr-go">${icon('captions')} Transcribir</button></div>`;
      $('#lv-tr-go')?.addEventListener('click', () => openTranscribe([it.id]));
      if (job) setTimeout(() => { if (L.list[vIdx]?.id === it.id && vPanel === 'tr') renderTranscript(L.byId.get(it.id) || it, el); }, 1500);
      refreshIcons();
      return;
    }
    let t = trCache.get(it.tk);
    if (!t) {
      el.innerHTML = `<div class="lv-tr-empty">${icon('loader', 'spin')}</div>`;
      refreshIcons();
      try { t = (await api(`/api/library/transcript/${it.id}`)).transcript; } catch (err) { el.innerHTML = `<div class="lv-tr-empty">${esc(err.message)}</div>`; return; }
      trCache.set(it.tk, t);
    }
    if (L.list[vIdx]?.id !== it.id) return;
    const mmss = (x) => fmtDur(x) || '0:00';
    let editing = false;
    const draw = (q = '') => {
      const ql = q.toLowerCase();
      el.innerHTML = `
        <div class="lv-tr-tools">
          <div class="lv-tr-q">${icon('search')}<input id="lv-tr-q" placeholder="Buscar en la transcripción" value="${esc(q)}"></div>
          <button class="lv-btn" id="lv-tr-edit" title="Editar texto">${icon(editing ? 'check' : 'pencil')}</button>
          <button class="lv-btn" id="lv-tr-more" title="Descargar / guardar">${icon('download')}</button>
        </div>
        <small class="lv-tr-meta">${esc(t.engine === 'parakeet' ? 'Parakeet v3' : `Whisper ${t.model || ''}`)}${t.language ? ' · ' + esc(t.language) : ''} · ${t.segments.length} segmentos${t.edited ? ' · editada' : ''}</small>
        <div class="lv-tr-list${editing ? ' editing' : ''}" id="lv-tr-list">${t.segments.map((s, i) => (!ql || s.text.toLowerCase().includes(ql)) ? `<div class="lv-seg" data-i="${i}" data-s="${s.start}"><time>${mmss(s.start)}</time><p${editing ? ' contenteditable="plaintext-only"' : ''}>${esc(s.text)}</p></div>` : '').join('') || '<p class="lib-muted">Sin coincidencias</p>'}</div>`;
      $('#lv-tr-q').addEventListener('input', debounce((e) => { draw(e.target.value); $('#lv-tr-q').focus(); const v = $('#lv-tr-q'); v.setSelectionRange(v.value.length, v.value.length); }, 200));
      $('#lv-tr-list').addEventListener('click', (e) => {
        if (editing) return;
        const seg = e.target.closest('.lv-seg');
        const media = $('#lv-stage video, #lv-stage audio');
        if (seg && media) { media.currentTime = Number(seg.dataset.s) + 0.01; media.play?.().catch(() => {}); }
      });
      $('#lv-tr-edit').addEventListener('click', async () => {
        if (editing) {
          el.querySelectorAll('.lv-seg').forEach((row) => { t.segments[Number(row.dataset.i)].text = row.querySelector('p').textContent.trim(); });
          try {
            await api(`/api/library/transcript/${it.id}`, { method: 'PUT', body: { segments: t.segments } });
            t.edited = Date.now();
            toast('Transcripción guardada', 'ok', '', 2000);
          } catch (err) { errToast(err); }
        }
        editing = !editing;
        draw(q);
      });
      $('#lv-tr-more').addEventListener('click', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const ex = (fmt) => () => { location.href = `/api/library/transcript/${it.id}/export?fmt=${fmt}&dl=1`; };
        showCtxMenu?.([
          { icon: 'file-text', label: 'Descargar TXT', run: ex('txt') },
          { icon: 'subtitles', label: 'Descargar SRT (subtítulos)', run: ex('srt') },
          { icon: 'subtitles', label: 'Descargar VTT (web)', run: ex('vtt') },
          { icon: 'file-type', label: 'Descargar Markdown', run: ex('md') },
          { icon: 'braces', label: 'Descargar JSON', run: ex('json') },
          { icon: 'copy', label: 'Copiar texto', run: async () => { const r2 = await fetch(`/api/library/transcript/${it.id}/export?fmt=txt`); const txt = await r2.text(); try { await navigator.clipboard.writeText(txt); toast('Texto copiado', 'ok', '', 2000); } catch { errToast(new Error('No se pudo copiar')); } } },
          { icon: 'save', label: 'Guardar .srt y .txt junto al archivo', run: async () => {
            try {
              const r2 = await api(`/api/library/transcript/${it.id}/save`, { method: 'POST', body: { formats: ['srt', 'txt'] } });
              toast(`Guardado: ${r2.saved.map(baseOf).join(', ')}`, 'ok', '', 3500);
              load();
            } catch (err) { errToast(err); }
          } },
          { icon: 'captions', label: 'Volver a transcribir…', run: () => openTranscribe([it.id]) },
          { icon: 'trash-2', label: 'Eliminar transcripción', danger: true, run: async () => {
            if (!(await confirmDialog('Eliminar transcripción', 'Se borra la transcripción guardada. El archivo no se toca.'))) return;
            await api(`/api/library/transcript/${it.id}`, { method: 'DELETE' }).catch(errToast);
            trCache.delete(it.tk);
            it.tr = 0;
            showItem(true);
          } },
        ], r.right - 250, r.bottom + 4);
      });
      refreshIcons();
    };
    draw();
    // Follow playback.
    const media = $('#lv-stage video, #lv-stage audio');
    if (media && !media.dataset.trHook) {
      media.dataset.trHook = '1';
      let last = -1;
      media.addEventListener('timeupdate', () => {
        if (editing || vPanel !== 'tr') return;
        const tt = media.currentTime;
        const i = t.segments.findIndex((s) => tt >= s.start && tt < s.end + 0.25);
        if (i === last) return;
        last = i;
        el.querySelectorAll('.lv-seg.on').forEach((x) => x.classList.remove('on'));
        const row = el.querySelector(`.lv-seg[data-i="${i}"]`);
        if (row) { row.classList.add('on'); row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      });
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

  const libraryLocations = (()=>{try{const d=JSON.parse(localStorage.getItem('axon:library-locations:v1') || '{}');return d && typeof d==='object' && !Array.isArray(d)?d:{};}catch{return {};}})();
  function libraryParams() {
    return { type:L.view.type, value:L.view.value || null, q:L.q || null, view:L.layout, sort:L.sort, group:L.group,
      item:!$('#lib-viewer')?.classList.contains('hidden') ? vItemId : null };
  }
  function captureLibrary() {
    const snap={cursor:L.cursor,sel:[...L.sel].slice(0,500),scroll:$('#lib-main')?.scrollTop || 0,shown:L.shown,focus:Boolean(document.activeElement?.closest('.lib-tile,.lib-row'))};
    libraryLocations[`${L.view.type}:${L.view.value || ''}:${L.q}`]=snap;
    const keys=Object.keys(libraryLocations);while(keys.length>40)delete libraryLocations[keys.shift()];
    try{localStorage.setItem('axon:library-locations:v1',JSON.stringify(libraryLocations));}catch{}
    return snap;
  }
  async function restoreLibrary(params,snap) {
    ensureDom();
    closeViewer(false);
    L.view={type:['all','recent','fav','kind','col','folder','shares','dupes'].includes(params.type)?params.type:'all',value:params.value || ''};
    L.q=params.q || '';
    if(['grid','list'].includes(params.view))L.layout=params.view;
    if(['date-desc','date-asc','name-asc','name-desc','size-desc','size-asc','kind'].includes(params.sort))L.sort=params.sort;
    if(['month','day','year','folder','kind','none'].includes(params.group))L.group=params.group;
    $('#lib-q').value=L.q;$('#lib-sort').value=L.sort;$('#lib-group').value=L.group;
    if(!L.loaded)await load();else render();
    if(window.AxonNavigation.current.section!=='library' || window.AxonNavigation.current.params!==params)return;
    snap ||= libraryLocations[`${L.view.type}:${L.view.value || ''}:${L.q}`];
    L.sel=new Set((snap?.sel || []).filter(id=>L.byId.has(id)));
    L.cursor=L.byId.has(snap?.cursor) ? snap.cursor : null;
    const focusIndex=L.list.findIndex(it=>it.id===L.cursor);
    const needed=Math.max(snap?.shown || PAGE,focusIndex+1);
    while(L.shown<Math.min(needed,L.list.length) && $('#lib-groups'))renderMore();
    syncSelClasses();markLibraryCursor();
    $('#lib-main').scrollTop=snap?.scroll || 0;
    if(snap?.focus && L.cursor)$('#lib-body').querySelector(`[data-id="${CSS.escape(L.cursor)}"]`)?.focus({preventScroll:true});
    if(params.item){
      let i=L.list.findIndex(it=>it.id===params.item);
      if(i<0 && L.byId.has(params.item)){L.view={type:'all'};L.q='';$('#lib-q').value='';render();i=L.list.findIndex(it=>it.id===params.item);}
      if(i>=0){L.cursor=params.item;openViewer(i,true);}
      else toast('Este archivo ya no está en la biblioteca','warn','',3500);
    }
    if(params.action==='upload')$('#lib-file').click();
    window.AxonNavigation.controls();
  }
  function markLibraryCursor() {
    const rows=[...($('#lib-body')?.querySelectorAll('.lib-tile,.lib-row') || [])];
    const cursor=rows.some(r=>r.dataset.id===L.cursor)?L.cursor:rows[0]?.dataset.id;
    rows.forEach(row=>{
      row.tabIndex=row.dataset.id===cursor?0:-1;
      row.classList.toggle('lib-focused',row.dataset.id===L.cursor);
      row.setAttribute('role','group');row.setAttribute('aria-label',L.list.find(it=>it.id===row.dataset.id)?.n || 'Archivo');
      row.querySelector('[data-act=sel]')?.setAttribute('aria-pressed',String(L.sel.has(row.dataset.id)));
      row.querySelector('[data-act=fav]')?.setAttribute('aria-pressed',String(L.favs.has(row.dataset.id)));
    });
    $('#lib-groups')?.setAttribute('role','group');$('#lib-groups')?.setAttribute('aria-label','Archivos de la biblioteca');

  }
  let libraryType='',libraryTypeTimer;
  function libraryKeyboard(e) {
    if(L.view.type==='shares'||L.view.type==='dupes'||!L.list.length)return false;
    if((e.target.tagName==='BUTTON'||e.target.tagName==='A')&&['Enter',' '].includes(e.key))return false;
    let index=L.list.findIndex(it=>it.id===L.cursor);
    let next=index;
    const tile=$('#lib-body .lib-tile');
    const columns=L.layout==='list'?1:Math.max(1,Math.round((tile?.parentElement.clientWidth || 1)/Math.max(1,(tile?.getBoundingClientRect().width || 1)+8)));
    if(e.key==='ArrowDown')next=index<0?0:index+columns;
    else if(e.key==='ArrowUp')next=index<0?0:index-columns;
    else if(e.key==='ArrowRight')next=index<0?0:index+1;
    else if(e.key==='ArrowLeft')next=index<0?0:index-1;
    else if(e.key==='Home')next=0;
    else if(e.key==='End')next=L.list.length-1;
    else if(e.key==='Enter'){e.preventDefault();if(index>=0)openViewer(index);return true;}
    else if(e.key===' '){e.preventDefault();if(index>=0){L.sel.has(L.cursor)?L.sel.delete(L.cursor):L.sel.add(L.cursor);syncSelClasses();markLibraryCursor();}return true;}
    else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.length===1 && /[\p{L}\p{N}]/u.test(e.key)) {
      libraryType+=e.key.toLocaleLowerCase('es');clearTimeout(libraryTypeTimer);libraryTypeTimer=setTimeout(()=>libraryType='',800);
      next=L.list.findIndex(it=>it.n.toLocaleLowerCase('es').startsWith(libraryType));if(next<0)return false;
    }else return false;
    e.preventDefault();next=Math.max(0,Math.min(next,L.list.length-1));
    L.cursor=L.list[next].id;
    if(e.shiftKey){const a=L.lastIdx>=0?L.lastIdx:Math.max(0,index);for(let i=Math.min(a,next);i<=Math.max(a,next);i++)L.sel.add(L.list[i].id);}
    else if(!e.ctrlKey&&!e.metaKey){L.sel=new Set([L.cursor]);L.lastIdx=next;}
    while(L.shown<=next && L.shown<L.list.length)renderMore();
    syncSelClasses();markLibraryCursor();
    const row=$('#lib-body').querySelector(`[data-id="${CSS.escape(L.cursor)}"]`);row?.focus({preventScroll:true});row?.scrollIntoView({block:'nearest'});
    window.AxonNavigation?.checkpoint();return true;
  }
  window.AxonPages ||= {};
  window.AxonPages.library={capture:captureLibrary,params:libraryParams,restore:restoreLibrary,leave:()=>closeViewer(false)};
  function wireLibraryNavigation(){
    const sec=$('#tab-library');if(!sec)return;
    sec.addEventListener('click',e=>{const row=e.target.closest('.lib-tile,.lib-row');if(row)L.cursor=row.dataset.id;});
    const save=()=>queueMicrotask(()=>{if(tabActive() && window.AxonNavigation?.ready&&!window.AxonNavigation.applying){markLibraryCursor();window.AxonNavigation.update('library',libraryParams());}});
    sec.addEventListener('focusin',e=>{const row=e.target.closest('.lib-tile,.lib-row');if(row){L.cursor=row.dataset.id;markLibraryCursor();save();}});
    ['click','keyup','change'].forEach(t=>sec.addEventListener(t,save));
    $('#lib-q').addEventListener('input',()=>setTimeout(save,180));
    $('#lib-main').addEventListener('scroll',save,{passive:true});
    $('#lib-keys').addEventListener('click',()=>openModal('<h3>Teclado en Biblioteca</h3><dl class="shortcut-list"><dt>Flechas · Inicio · Fin</dt><dd>Mover el foco entre archivos</dd><dt>Enter</dt><dd>Abrir el archivo enfocado</dd><dt>Espacio</dt><dd>Seleccionar o deseleccionar</dd><dt>Shift + flechas</dt><dd>Extender selección</dd><dt>Ctrl/⌘ + flechas</dt><dd>Mover foco sin cambiar selección</dd><dt>/ · escribir un nombre</dt><dd>Buscar o saltar a un archivo</dd><dt>Filtros en la búsqueda</dt><dd>tipo:video · ext:jpg · &gt;100mb · &lt;5mb (combinables con texto)</dd><dt>Esc · ← · → en el visor</dt><dd>Volver o cambiar de archivo</dd></dl><button class="btn-secondary" data-close>Cerrar</button>'));
    markLibraryCursor();
  }
  const previousRender=render;render=function(...args){
    previousRender(...args);markLibraryCursor();
    if (vItemId && !$('#lib-viewer')?.classList.contains('hidden')) {
      const index=L.list.findIndex(it=>it.id===vItemId);
      if(index>=0){vIdx=index;viewerBar();syncViewerNavigation();}
      else closeViewer(false);
    }
  };
  // ---------- Boot ----------

  function boot() {
    ensureDom();
    wireLibraryNavigation();
    document.addEventListener('axon:authenticated', () => {
      api('/api/library/status').then(s => {
        const nc = $('#nav-count-library'); if(nc && s.count) nc.textContent = s.count.toLocaleString('es-AR');
      }).catch(() => {});
      pollJobs(1500);
    }, { once: true });
  }

  window.pmLibrary = { open: () => window.AxonNavigation?.ready ? window.AxonNavigation.go("/biblioteca", {remember:true}) : activateTab(), share: openShareModal, tools: openTools, transcribe: openTranscribe };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
