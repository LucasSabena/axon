/* AXON — Explorer shell for Archivos.
 * Owns what sits around the folder view: the navigation pane (quick access, library, tags, disks tree,
 * cloud, system), the embedded Biblioteca gallery, pane resize/collapse and the mobile drawer.
 * The folder view itself stays in feat-files.js; library tools stay in feat-library.js (window.AxonLibrary).
 */
(() => {
  'use strict';
  const sec = document.getElementById('tab-files');
  const nav = sec?.querySelector('#fm-nav');
  const FL = window.AxonFilesLocal;
  if (!sec || !nav || !FL || window.AxonExplorer) return;

  // ---------- Preferences ----------
  const PREFS_KEY = 'axon:fm-nav:v2';
  const read = () => { try { const v = JSON.parse(localStorage.getItem(PREFS_KEY)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  const prefs = read();
  prefs.sections = prefs.sections && typeof prefs.sections === 'object' ? prefs.sections : {};
  const save = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, expanded: [...expanded].slice(-200) })); } catch { /* private mode */ } };
  const expanded = new Set(Array.isArray(prefs.expanded) ? prefs.expanded : ['lib:roots']);
  const mobile = matchMedia('(max-width: 768px)');
  const sectionOpen = (id, fallback = true) => (id in prefs.sections ? prefs.sections[id] : fallback);

  const join = (dir, name) => (dir.endsWith('/') ? dir + name : dir + '/' + name);
  const baseName = (p) => p.replace(/\/+$/, '').split('/').pop() || '/';
  const url = (section, params) => window.AxonNavigation?.url(section, params) || '#';
  const count = (n) => Number(n).toLocaleString('es-AR');

  // ---------- Layout: width, collapse, drawer ----------
  const MIN_W = 200, MAX_W = 440, DEFAULT_W = 260;
  let width = Math.min(MAX_W, Math.max(MIN_W, Number(prefs.width) || DEFAULT_W));
  const grip = sec.querySelector('#fm-grip');
  const setWidth = (w, persist = true) => {
    width = Math.min(MAX_W, Math.max(MIN_W, Math.round(w)));
    sec.style.setProperty('--fm-nav-w', width + 'px');
    grip?.setAttribute('aria-valuenow', String(width));
    if (persist) { prefs.width = width; save(); }
  };
  setWidth(width, false);
  grip?.setAttribute('aria-valuemin', String(MIN_W));
  grip?.setAttribute('aria-valuemax', String(MAX_W));

  let backdrop = null;
  function navShown() { return mobile.matches ? sec.classList.contains('fm-nav-open') : !sec.classList.contains('fm-nav-hidden'); }
  function setNav(open, { persist = true, focus = false } = {}) {
    if (mobile.matches) {
      sec.classList.toggle('fm-nav-open', open);
      nav.inert = !open;
    } else {
      sec.classList.toggle('fm-nav-hidden', !open);
      nav.inert = !open;
      if (persist) { prefs.hidden = !open; save(); }
    }
    document.querySelectorAll('.fm-nav-toggle').forEach((b) => b.setAttribute('aria-expanded', String(open)));
    if (backdrop) backdrop.hidden = !(mobile.matches && open);
    if (open && focus) (nav.querySelector('[tabindex="0"]') || nav.querySelector('[data-nav-key]'))?.focus();
  }
  function toggleNav() { setNav(!navShown(), { focus: !navShown() }); }
  mobile.addEventListener('change', () => { sec.classList.remove('fm-nav-open'); setNav(mobile.matches ? false : !prefs.hidden, { persist: false }); });
  document.addEventListener('click', (e) => { if (e.target.closest('.fm-nav-toggle')) toggleNav(); });

  backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'fm-nav-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-label', 'Cerrar el panel de navegación');
  backdrop.addEventListener('click', () => setNav(false));
  sec.append(backdrop);

  if (grip) {
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('is-dragging');
      document.body.classList.add('fm-resizing');
      const left = nav.getBoundingClientRect().left;
      const move = (ev) => setWidth(ev.clientX - left, false);
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        grip.classList.remove('is-dragging');
        document.body.classList.remove('fm-resizing');
        setWidth(width);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', () => setWidth(DEFAULT_W));
    grip.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 48 : 16;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(width - step); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + step); }
      else if (e.key === 'Home') { e.preventDefault(); setWidth(MIN_W); }
      else if (e.key === 'End') { e.preventDefault(); setWidth(MAX_W); }
    });
  }

  // ---------- Embedded gallery (Biblioteca) ----------
  // Biblioteca no longer owns a tab: its gallery, viewer, share/optimize/transcribe dialogs and job dock
  // live inside Archivos. Moving the nodes keeps every id and listener the library code relies on.
  function embedGallery() {
    const gallery = document.getElementById('tab-library');
    if (!gallery || gallery.dataset.embedded) return;
    gallery.dataset.embedded = '1';
    gallery.classList.remove('tab-content', 'active');
    gallery.classList.add('fm-gallery');
    sec.append(gallery);
    // Shared overlays must stay visible whichever view is showing.
    for (const sel of ['#lib-viewer', '#lib-modal', '.lib-dock', '#lib-file', '#lib-file-dir']) {
      const node = gallery.querySelector(sel);
      if (node) sec.append(node);
    }
    // Tipo / color / etiqueta live behind a "Filtros" button, like the folder view's drawer.
    const bar = gallery.querySelector('#lib-catalog-bar');
    const tools = gallery.querySelector('.lib-tools');
    if (bar && tools && !tools.querySelector('#lib-filters-btn')) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'lib-filters-btn'; btn.className = 'btn-secondary lib-filters-btn';
      btn.setAttribute('aria-controls', 'lib-catalog-bar');
      btn.innerHTML = `${icon('sliders-horizontal')}<span>Filtros</span>`;
      const set = (open) => { bar.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.classList.toggle('active', open); };
      set(Boolean(prefs.galleryFilters));
      btn.addEventListener('click', () => { set(bar.hidden); prefs.galleryFilters = !bar.hidden; save(); });
      tools.prepend(btn);
      // A filter in effect must stay visible.
      const sync = () => {
        const active = ['#lib-catalog-kind', '#lib-catalog-color', '#lib-catalog-tag'].some((id) => gallery.querySelector(id)?.value);
        btn.dataset.filters = active ? '•' : '';
        if (active && bar.hidden) set(true);
      };
      document.addEventListener('axon:library', sync);
      bar.addEventListener('change', sync);
    }
    const top = gallery.querySelector('.lib-top');
    if (top && !top.querySelector('.fm-nav-toggle')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-btn fm-nav-toggle';
      btn.title = 'Panel de navegación (Ctrl+B)';
      btn.setAttribute('aria-label', 'Mostrar u ocultar el panel de navegación');
      btn.setAttribute('aria-controls', 'fm-nav');
      btn.innerHTML = icon('panel-left');
      top.prepend(btn);
      refreshIcons(top);
    }
  }

  let mode = 'files';
  function setMode(next) {
    mode = next;
    sec.classList.toggle('fm-mode-gallery', next === 'library');
    document.getElementById('tab-library')?.classList.toggle('active', next === 'library');
    if (next === 'library') window.AxonLibrary?.ensureLoaded?.().catch(() => {});
    scheduleRender();
  }
  document.addEventListener('axon:section', (e) => { if (e.detail === 'library' || e.detail === 'files') setMode(e.detail === 'library' ? 'library' : 'files'); });

  // ---------- Folder tree ----------
  const TTL = 30_000;
  const dirs = new Map(); // path → { items: [{name, path}], ts, loading, error, total }
  const HOME_STD = [
    ['Escritorio', 'Desktop', 'monitor'], ['Descargas', 'Downloads', 'download'], ['Documentos', 'Documents', 'file-text'],
    ['Imágenes', 'Pictures', 'image'], ['Música', 'Music', 'music'], ['Vídeos', 'Videos', 'film'], ['Proyectos', 'Projects', 'folder-git-2'],
  ];
  const MAX_CHILDREN = 400;

  async function loadDirs(path, { force = false } = {}) {
    const known = dirs.get(path);
    if (known && !force && (known.loading || Date.now() - known.ts < TTL)) return known.promise || known;
    const entry = known || { items: [], ts: 0 };
    entry.loading = true;
    entry.error = '';
    dirs.set(path, entry);
    entry.promise = (async () => {
      try {
        const data = await api(`/api/files?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(20_000) });
        const all = (data.entries || []).filter((e) => e.type === 'dir');
        const sorted = all.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }));
        const signature = sorted.map((e) => e.name).join('\n');
        const changed = signature !== entry.signature;
        entry.signature = signature;
        entry.total = sorted.length;
        entry.items = sorted.slice(0, MAX_CHILDREN).map((e) => ({ name: e.name, path: join(data.path || path, e.name) }));
        entry.real = data.path || path;
        entry.ts = Date.now();
        if (changed) scheduleRender();
      } catch (err) {
        entry.error = err?.message || 'No se pudo leer la carpeta';
        entry.ts = Date.now() - TTL + 5000; // retry soon, not on every render
        scheduleRender();
      } finally {
        entry.loading = false;
        delete entry.promise;
      }
      return entry;
    })();
    scheduleRender();
    return entry.promise;
  }

  const nodeKey = (root, path) => `${root}|${path}`;
  // The folder view learns the home path and the disks on its first listing; the gallery can open first.
  let fallbackHome = '';
  const homePath = () => FL.home || fallbackHome;
  const volumesList = () => (FL.volumes?.length ? FL.volumes : window.AxonStorage?.snapshot?.volumes || []);
  const uniqueVolumes = () => (window.AxonStorage?.uniqueVolumes(volumesList()) || volumesList()).filter((v) => v.path || v.canMount);

  function rootsList() {
    const roots = [];
    if (homePath()) roots.push({ key: 'home', path: homePath(), label: 'Inicio', icon: 'home' });
    for (const v of uniqueVolumes()) roots.push({ key: 'v:' + v.id, path: v.path || '', label: v.name, icon: v.external ? 'usb' : 'hard-drive', volume: v });
    return roots;
  }
  // The root a path belongs to: Inicio for anything under it, otherwise the deepest volume.
  function rootFor(path) {
    if (!path) return null;
    const home = homePath();
    if (home && (path === home || path.startsWith(home + '/'))) return 'home';
    const best = uniqueVolumes().filter((v) => v.path && (v.path === '/' || path === v.path || path.startsWith(v.path + '/'))).sort((a, b) => b.path.length - a.path.length)[0];
    return best ? 'v:' + best.id : null;
  }

  // ---------- Current location ----------
  function where() {
    const cur = window.AxonNavigation?.current;
    const p = cur?.params || {};
    if (cur?.section === 'library') return { mode: 'library', type: p.type || 'all', value: p.value || '' };
    if (cur?.section === 'files' && p.pc === '1') return { mode: 'pc' };
    if (cur?.section === 'files' && ['dropbox', 'gdrive', 'onedrive'].includes(p.source)) return { mode: 'cloud', source: p.source };
    return { mode: 'files', path: FL.cwd || '', mark: p.mark || '', color: p.color || '', tag: p.tag || '' };
  }

  // Open every ancestor of the current folder in its tree and bring the node into view.
  let revealToken = 0;
  async function reveal() {
    const here = where();
    if (here.mode !== 'files' || !here.path || here.mark || here.color || here.tag) { scheduleRender(); return; }
    const token = ++revealToken;
    const root = rootFor(here.path);
    const rootInfo = rootsList().find((r) => r.key === root);
    if (!rootInfo?.path) { scheduleRender(); return; }
    const rel = here.path.slice(rootInfo.path === '/' ? 1 : rootInfo.path.length).split('/').filter(Boolean);
    let acc = rootInfo.path;
    expanded.add(nodeKey(root, acc));
    let entry = await loadDirs(acc);
    for (const seg of rel) {
      if (token !== revealToken) return;
      // A folder created after the cached listing is missing from it: re-read once before giving up.
      if (!entry?.items?.some((c) => c.name === seg)) entry = await loadDirs(acc, { force: true });
      acc = join(acc, seg);
      if (acc !== here.path) {
        expanded.add(nodeKey(root, acc));
        entry = await loadDirs(acc);
      }
    }
    if (token !== revealToken) return;
    // The current folder shows its own children too, so deeper navigation feels continuous.
    save();
    render();
    nav.querySelector('.fm-nav-i.is-current')?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Data for the library / tags sections ----------
  const LIB_KINDS = [
    ['image', 'Imágenes', 'image'], ['video', 'Videos', 'film'], ['audio', 'Audio', 'music'], ['pdf', 'PDF', 'file-text'],
    ['doc', 'Documentos', 'file-type'], ['raw', 'Fotos RAW', 'aperture'], ['vector', 'Vectores / SVG', 'pen-tool'], ['design', 'Diseño', 'layers'], ['other', 'Otros', 'file'],
  ];
  const COLOR_CSS = { red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e', blue: '#3b82f6', purple: '#a855f7', pink: '#ec4899', gray: '#8b93a5' };

  function catalogStats() {
    const rows = (window.AxonFileCatalog?.entries() || []).filter((r) => r.available);
    const marks = {}, colors = {}, tags = {};
    let organized = 0;
    for (const r of rows) {
      const m = r.metadata;
      let any = false;
      for (const k of Object.keys(window.AxonFileCatalog.marks)) if (m[k]) { marks[k] = (marks[k] || 0) + 1; any = true; }
      if (m.color) { colors[m.color] = (colors[m.color] || 0) + 1; any = true; }
      for (const t of m.tags) { tags[t] = (tags[t] || 0) + 1; any = true; }
      if (any) organized++;
    }
    return { marks, colors, tags, organized, pinned: rows.filter((r) => r.metadata.pinned) };
  }

  // ---------- Rendering ----------
  let renderQueued = false;
  let dragActive = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; if (dragActive) { scheduleRender(); return; } render(); });
  }
  document.addEventListener('dragstart', () => { dragActive = true; }, true);
  document.addEventListener('dragend', () => { dragActive = false; }, true);
  document.addEventListener('drop', () => { dragActive = false; }, true);

  const item = ({ key, href, icon: ic, label, count: n, current, soft = false, vars = '', level = 0, tree, open, title, drop, extra = '', attrs = '', badge = '', sub = '', loading = false, parent = '' }) => {
    const aria = tree ? ` aria-expanded="${open ? 'true' : 'false'}"` : '';
    const chev = tree ? `<span class="fm-nav-chev${open ? ' is-open' : ''}" data-toggle="${esc(key)}" aria-hidden="true">${loading ? icon('loader', 'spin') : icon('chevron-right')}</span>` : '<span class="fm-nav-chev fm-nav-chev-none" aria-hidden="true"></span>';
    const anchor = `<a class="fm-nav-i${current ? ' is-current' : ''}${soft ? ' is-here' : ''}" role="treeitem" href="${esc(href || '#')}" data-nav-key="${esc(key)}"${parent ? ` data-parent="${esc(parent)}"` : ''}${drop ? ` data-drop-path="${esc(drop)}"` : ''}${aria}${current ? ' aria-current="page"' : ''} aria-level="${level + 1}" tabindex="-1" style="--lvl:${level};${vars}"${title ? ` title="${esc(title)}"` : ''}${attrs}>${chev}<span class="fm-nav-ic">${icon(ic)}</span><span class="fm-nav-lb">${esc(label)}${badge}${sub}</span>${n != null && n !== '' ? `<em class="fm-nav-ct">${esc(typeof n === 'number' ? count(n) : n)}</em>` : ''}</a>`;
    // Action buttons sit beside the link: interactive content must not nest inside an anchor.
    return extra ? `<div class="fm-nav-wrap">${anchor}${extra}</div>` : anchor;
  };
  const section = (id, label, body, { actions = '', fallbackOpen = true } = {}) => {
    const open = sectionOpen(id, fallbackOpen);
    // Each list is its own tree: headers and action buttons stay outside, as plain controls.
    return `<section class="fm-nav-sec" data-sec="${id}"><div class="fm-nav-h-row"><button type="button" class="fm-nav-h" data-nav-key="sec:${id}" aria-expanded="${open}" aria-controls="fm-nav-list-${id}" tabindex="-1"><span class="fm-nav-chev${open ? ' is-open' : ''}" aria-hidden="true">${icon('chevron-right')}</span><span>${esc(label)}</span></button>${actions}</div><div class="fm-nav-list" id="fm-nav-list-${id}" role="tree" aria-label="${esc(label)}"${open ? '' : ' hidden'}>${body}</div></section>`;
  };

  function treeRows(root, path, level, here, parentKey) {
    const key = nodeKey(root, path);
    const entry = dirs.get(path);
    if (!entry || !expanded.has(key)) return '';
    const rows = [];
    for (const child of entry.items) {
      if (!FL.showHidden && child.name.startsWith('.')) continue;
      const ck = nodeKey(root, child.path);
      const open = expanded.has(ck);
      const kids = dirs.get(child.path);
      // Unknown leaf-ness: show the chevron until a listing proves the folder has no subfolders.
      const isTree = !kids || kids.loading || kids.items.length > 0 || Boolean(kids.error);
      rows.push(item({
        key: ck, href: url('files', { path: child.path }), icon: open ? 'folder-open' : 'folder', label: child.name, level, tree: isTree, open, loading: Boolean(kids?.loading) && open,
        current: here.mode === 'files' && !here.mark && !here.color && !here.tag && here.path === child.path && rootFor(here.path) === root,
        drop: child.path, parent: parentKey, attrs: ` data-path="${esc(child.path)}" data-root="${esc(root)}"${catalogColorAttr(child.path)}`,
      }));
      if (open) rows.push(treeRows(root, child.path, level + 1, here, ck));
    }
    if (entry.total > entry.items.length) rows.push(`<div class="fm-nav-note" style="--lvl:${level}">y ${count(entry.total - entry.items.length)} más…</div>`);
    if (entry.error) rows.push(`<div class="fm-nav-note is-error" style="--lvl:${level}">${esc(entry.error)}</div>`);
    return rows.join('');
  }
  const catalogColorAttr = (p) => { const c = window.AxonFileCatalog?.get(p).color; return c ? ` data-file-color="${esc(c)}"` : ''; };

  function quickAccess(here) {
    const rows = [];
    const home = homePath();
    const seen = new Set();
    const add = (path, label, ic, extra = {}) => {
      if (!path || seen.has(path)) return;
      seen.add(path);
      rows.push(item({
        key: 'q:' + path, href: url('files', { path }), icon: ic, label: label || baseName(path), title: path, drop: path,
        soft: here.mode === 'files' && !here.mark && !here.color && !here.tag && here.path === path, attrs: ` data-path="${esc(path)}" data-quick="1"${extra.pinned ? ' data-pinned="1"' : ''}${catalogColorAttr(path)}`,
      }));
    };
    if (home) add(home, 'Inicio', 'home');
    const homeEntry = home ? dirs.get(home) : null;
    for (const [es, en, ic] of HOME_STD) {
      const hit = homeEntry?.items.find((c) => c.name === es || c.name === en);
      if (hit) add(hit.path, hit.name, ic);
    }
    const stats = catalogStats();
    for (const r of stats.pinned.slice(0, 14)) {
      if (r.kind === 'dir') add(r.path, baseName(r.path), 'pin', { pinned: true });
      else {
        const dir = r.path.slice(0, r.path.lastIndexOf('/')) || '/';
        const href = url('files', { path: dir, item: baseName(r.path) });
        rows.push(item({ key: 'qf:' + r.path, href, icon: 'file', label: baseName(r.path), title: r.path, attrs: ` data-path="${esc(r.path)}" data-quick="1" data-pinned="1" data-file="1"` }));
      }
    }
    return section('quick', 'Acceso rápido', rows.join(''));
  }

  function librarySection(here) {
    const L = window.AxonLibrary;
    if (!L) return '';
    const sum = L.summary();
    const cur = (type, value = '') => here.mode === 'library' && here.type === type && (here.value || '') === value;
    const li = (type, label, ic, n, value = '', level = 0, extra = {}) => item({
      key: `lib:${type}:${value}`, href: url('library', value ? { type, value } : { type }), icon: ic, label, count: sum.loaded ? n : null, current: cur(type, value), level, ...extra,
    });
    const kindsOpen = expanded.has('lib:kinds'), colsOpen = expanded.has('lib:cols'), rootsOpen = expanded.has('lib:roots');
    const rootRows = sum.roots.map((r) => li('folder', baseName(r.path) + (r.upload ? ' (subidas)' : ''), r.upload ? 'inbox' : 'hard-drive', r.count, r.path, 1, { parent: 'lib:roots', title: r.path, drop: r.path, attrs: ` data-path="${esc(r.path)}"` }));
    const kindRows = LIB_KINDS.filter(([k]) => sum.kinds[k]).map(([k, label, ic]) => li('kind', label, ic, sum.kinds[k], k, 1, { parent: 'lib:kinds' }));
    const colRows = sum.collections.map((c) => li('col', c.name, 'album', c.count, c.id, 1, { parent: 'lib:cols', attrs: ` data-collection="${esc(c.id)}"`, extra: `<button type="button" class="fm-nav-more" data-collection-menu="${esc(c.id)}" tabindex="-1" aria-label="Opciones de ${esc(c.name)}">${icon('more-horizontal')}</button>` }));
    const body = [
      li('all', 'Todo', 'library', sum.total),
      li('recent', 'Recientes', 'clock', sum.recent),
      li('fav', 'Favoritos', 'star', sum.favs),
      item({ key: 'lib:kinds', href: url('library', { type: 'all' }), icon: 'layout-grid', label: 'Por tipo', tree: true, open: kindsOpen, attrs: ' data-toggle-only="1"' }),
      kindsOpen ? (kindRows.join('') || '<div class="fm-nav-note" style="--lvl:1">Todavía no hay archivos indexados</div>') : '',
      li('tr', 'Transcripciones', 'captions', sum.transcripts),
      li('shares', 'Links compartidos', 'link', sum.shares),
      item({ key: 'lib:cols', href: url('library', { type: 'all' }), icon: 'album', label: 'Colecciones', count: sum.loaded ? sum.collections.length : null, tree: true, open: colsOpen, attrs: ' data-toggle-only="1"' }),
      colsOpen ? (colRows.join('') || '<div class="fm-nav-note" style="--lvl:1">Agrupá archivos de distintas carpetas sin moverlos</div>') : '',
      li('dupes', 'Duplicados', 'copy', null),
      item({ key: 'lib:roots', href: url('library', { type: 'all' }), icon: 'folders', label: 'Carpetas', count: sum.roots.length || null, tree: true, open: rootsOpen, attrs: ' data-toggle-only="1"' }),
      rootsOpen ? (rootRows.join('') || '<div class="fm-nav-note" style="--lvl:1">Agregá carpetas con el engranaje</div>') : '',
    ].join('');
    const actions = `<button type="button" class="fm-nav-add" data-lib-manage tabindex="-1" title="Carpetas de la biblioteca y ajustes" aria-label="Carpetas de la biblioteca y ajustes">${icon('settings-2')}</button>`;
    return section('library', 'Biblioteca', body, { actions });
  }

  function tagsSection(here) {
    const C = window.AxonFileCatalog;
    if (!C) return '';
    const st = catalogStats();
    const on = (mark, color = '', tag = '') => here.mode === 'files' && here.mark === mark && here.color === color && here.tag === tag;
    const rows = [
      item({ key: 'cat:*', href: url('files', { mark: '*' }), icon: 'tags', label: 'Todo lo organizado', count: st.organized, current: on('*') }),
      ...Object.entries(C.marks).filter(([k]) => k !== 'pinned').map(([k, [ic, label]]) => item({ key: 'cat:m:' + k, href: url('files', { mark: k }), icon: ic, label, count: st.marks[k] || 0, current: on(k) })),
    ];
    const colors = Object.entries(C.colors).filter(([c]) => st.colors[c] || on('*', c)).map(([c, label]) => item({ key: 'cat:c:' + c, href: url('files', { mark: '*', color: c }), icon: 'circle', label, count: st.colors[c] || 0, current: on('*', c), vars: `--dot:${COLOR_CSS[c] || 'currentColor'}` }).replace('class="fm-nav-i', 'class="fm-nav-i fm-nav-color'));
    const tagList = Object.entries(st.tags).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')).slice(0, 40);
    const tagRows = tagList.map(([t, n]) => item({ key: 'cat:t:' + t, href: url('files', { mark: '*', tag: t }), icon: 'tag', label: t, count: n, current: on('*', '', t) }));
    return section('tags', 'Etiquetas', rows.join('') + (colors.length ? `<div class="fm-nav-sub">Colores</div>${colors.join('')}` : '') + (tagRows.length ? `<div class="fm-nav-sub">Etiquetas</div>${tagRows.join('')}` : '<div class="fm-nav-note">Creá etiquetas y colores desde «Organizar»</div>'), { fallbackOpen: false });
  }

  function volumeItem(v, root, here) {
    const usedPct = v.size && v.available != null ? Math.max(0, Math.min(100, Math.round((1 - v.available / v.size) * 100))) : null;
    const state = !v.path ? 'Sin montar' : v.readOnly ? 'Sólo lectura' : !v.readable ? 'Sin permiso' : v.available != null ? `${FL.fmtSize(v.available)} libres` : '';
    const bar = usedPct != null ? `<span class="fm-vol"><span class="fm-vol-bar${usedPct >= 90 ? ' is-full' : ''}"><i style="width:${usedPct}%"></i></span><small>${esc(state)}</small></span>` : (state ? `<span class="fm-vol"><small>${esc(state)}</small></span>` : '');
    const key = nodeKey(root.key, root.path || v.id);
    const open = Boolean(root.path) && expanded.has(key);
    const kids = root.path ? dirs.get(root.path) : null;
    const isTree = Boolean(root.path) && (!kids || kids.loading || kids.items.length > 0 || Boolean(kids.error));
    const head = item({
      key: root.path ? key : 'vol:' + v.id, href: root.path ? url('files', { path: root.path }) : '#', icon: root.icon, label: root.label, tree: isTree, open, loading: Boolean(kids?.loading) && open,
      current: here.mode === 'files' && !here.mark && !here.color && !here.tag && here.path === root.path && rootFor(here.path) === root.key, drop: root.path || '', title: v.path || v.device, sub: bar,
      attrs: ` data-root="${esc(root.key)}" data-path="${esc(root.path)}" data-nav-volume="${esc(v.id)}"${root.path ? '' : ' data-unmounted="1"'}`,
    });
    return head + (open ? treeRows(root.key, root.path, 1, here, key) : '');
  }

  function pcSection(here) {
    const rows = [item({ key: 'pc:overview', href: url('files', { pc: '1' }), icon: 'monitor', label: 'Resumen del equipo', current: here.mode === 'pc' })];
    for (const root of rootsList()) {
      if (root.key === 'home') {
        const key = nodeKey('home', root.path), open = expanded.has(key), kids = dirs.get(root.path);
        rows.push(item({
          key, href: url('files', { path: root.path }), icon: 'home', label: 'Inicio', tree: !kids || kids.loading || kids.items.length > 0, open, loading: Boolean(kids?.loading) && open, title: root.path, drop: root.path,
          current: here.mode === 'files' && !here.mark && !here.color && !here.tag && here.path === root.path && rootFor(here.path) === 'home', attrs: ` data-root="home" data-path="${esc(root.path)}"`,
        }));
        if (open) rows.push(treeRows('home', root.path, 1, here, key));
      } else rows.push(volumeItem(root.volume, root, here));
    }
    if (!rows.length) rows.push('<div class="fm-nav-note">Buscando discos…</div>');
    const actions = `<button type="button" class="fm-nav-add" data-disks-refresh tabindex="-1" title="Actualizar discos" aria-label="Actualizar discos">${icon('refresh-cw')}</button>`;
    return section('pc', 'Este equipo', rows.join(''), { actions });
  }

  let cloud = { providers: [], active: '' };
  function cloudSection(here) {
    const rows = cloud.providers.map((p) => item({
      key: 'cloud:' + p.id, href: url('files', { source: p.id, location: 'account', cloudPath: '' }), icon: 'cloud', label: p.name, current: here.mode === 'cloud' && here.source === p.id,
      attrs: ` data-nav-provider="${esc(p.id)}"`,
    }).replace('<span class="fm-nav-ic"><i data-lucide="cloud" class="lucide-icon"></i></span>', `<span class="fm-nav-ic">${window.AxonConnections?.logo?.(p.id) || icon('cloud')}</span>`));
    rows.push(item({ key: 'cloud:manage', href: '/configuracion?section=connections', icon: 'plug', label: cloud.providers.length ? 'Administrar conexiones' : 'Conectar una nube…' }));
    return section('cloud', 'Nube', rows.join(''), { fallbackOpen: true });
  }

  function systemSection() {
    const L = window.AxonLibrary;
    return section('system', 'Sistema', [
      item({ key: 'sys:trash', href: '#', icon: 'trash-2', label: 'Papelera', attrs: ' data-action="trash"' }),
      item({ key: 'sys:transfers', href: '#', icon: 'arrow-left-right', label: 'Transferencias', attrs: ' data-action="transfers"' }),
      item({ key: 'sys:disks', href: '/almacenamiento?view=disks', icon: 'hard-drive-download', label: 'Almacenamiento y discos' }),
      L ? item({ key: 'sys:folders', href: '#', icon: 'folder-plus', label: 'Agregar carpeta a la biblioteca', attrs: ' data-action="lib-add"' }) : '',
    ].join(''), { fallbackOpen: true });
  }

  function render() {
    const focusKey = document.activeElement?.closest?.('[data-nav-key]')?.dataset.navKey;
    const hadFocus = nav.contains(document.activeElement);
    const scroll = nav.scrollTop;
    const here = where();
    nav.innerHTML = [quickAccess(here), pcSection(here), librarySection(here), tagsSection(here), cloudSection(here), systemSection()].join('');
    refreshIcons(nav);
    nav.scrollTop = scroll;
    if (pcActive) renderPc();
    // Roving tabindex: exactly one stop in the pane.
    const all = [...nav.querySelectorAll('[data-nav-key]')];
    const target = (focusKey && all.find((n) => n.dataset.navKey === focusKey)) || nav.querySelector('.is-current') || all[0];
    if (target) target.tabIndex = 0;
    if (hadFocus) target?.focus({ preventScroll: true });
  }

  // ---------- Interaction ----------
  function toggleNode(key, force) {
    const open = force ?? !expanded.has(key);
    if (open) expanded.add(key); else expanded.delete(key);
    save();
    const path = nav.querySelector(`[data-nav-key="${CSS.escape(key)}"]`)?.dataset.path;
    if (open && path) void loadDirs(path);
    render();
  }

  nav.addEventListener('click', (e) => {
    const chev = e.target.closest('[data-toggle]');
    if (chev) { e.preventDefault(); e.stopPropagation(); toggleNode(chev.dataset.toggle); return; }
    const head = e.target.closest('.fm-nav-h');
    if (head) {
      const id = head.dataset.navKey.slice(4);
      prefs.sections[id] = head.getAttribute('aria-expanded') !== 'true';
      save(); render();
      nav.querySelector(`[data-nav-key="${CSS.escape(head.dataset.navKey)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('[data-lib-manage]')) { window.AxonLibrary?.settings(); return; }
    if (e.target.closest('[data-disks-refresh]')) { void FL.refreshVolumes(); return; }
    const more = e.target.closest('[data-collection-menu]');
    if (more) { e.preventDefault(); e.stopPropagation(); const r = more.getBoundingClientRect(); window.AxonLibrary.collectionMenu(more.dataset.collectionMenu, r.left, r.bottom); return; }
    const link = e.target.closest('.fm-nav-i');
    if (!link) return;
    if (link.dataset.toggleOnly) { e.preventDefault(); e.stopImmediatePropagation(); toggleNode(link.dataset.navKey); return; }
    const action = link.dataset.action;
    if (action) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (action === 'trash') FL.openTrash();
      else if (action === 'transfers') FL.showTransfers();
      else if (action === 'lib-add') window.AxonLibrary?.addFolder();
      if (mobile.matches) setNav(false);
      return;
    }
    if (link.dataset.unmounted) { e.preventDefault(); e.stopImmediatePropagation(); void mountVolume(link.dataset.navVolume); return; }
    // Everything else is a real link handled by AxonNavigation; a folder click also opens its branch.
    if (link.getAttribute('aria-expanded') === 'false' && link.dataset.path && !e.ctrlKey && !e.metaKey && !e.shiftKey) toggleNode(link.dataset.navKey, true);
    if (mobile.matches && !e.ctrlKey && !e.metaKey && !e.shiftKey) setNav(false);
  });

  nav.addEventListener('dblclick', (e) => {
    const link = e.target.closest('.fm-nav-i[aria-expanded]');
    if (link && !link.dataset.toggleOnly && !e.target.closest('[data-toggle]')) toggleNode(link.dataset.navKey);
  });

  async function mountVolume(id) {
    try {
      const r = await api(`/api/files/volumes/${encodeURIComponent(id)}/mount`, { method: 'POST', body: {} });
      await FL.refreshVolumes();
      if (r.path) FL.navigate(r.path);
    } catch (err) { errToast(err); }
  }

  // Keyboard model of a tree (WAI-ARIA): arrows move, left/right collapse/expand, Enter opens.
  nav.addEventListener('keydown', (e) => {
    const cur = e.target.closest?.('[data-nav-key]');
    if (!cur || e.ctrlKey || e.metaKey || e.altKey) return;
    const all = [...nav.querySelectorAll('[data-nav-key]')].filter((n) => !n.closest('[hidden]'));
    const i = all.indexOf(cur);
    const focus = (n) => { if (!n) return; e.preventDefault(); all.forEach((x) => { x.tabIndex = -1; }); n.tabIndex = 0; n.focus(); n.scrollIntoView({ block: 'nearest' }); };
    const isHead = cur.classList.contains('fm-nav-h');
    const expandable = cur.hasAttribute('aria-expanded');
    const open = cur.getAttribute('aria-expanded') === 'true';
    switch (e.key) {
      case 'ArrowDown': focus(all[i + 1]); break;
      case 'ArrowUp': focus(all[i - 1]); break;
      case 'Home': focus(all[0]); break;
      case 'End': focus(all.at(-1)); break;
      case 'ArrowRight':
        if (!expandable) break;
        e.preventDefault();
        if (!open) isHead ? cur.click() : toggleNode(cur.dataset.navKey, true);
        else focus(all[i + 1]);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (expandable && open) { isHead ? cur.click() : toggleNode(cur.dataset.navKey, false); }
        else if (cur.dataset.parent) focus(all.find((n) => n.dataset.navKey === cur.dataset.parent));
        break;
      case ' ': if (isHead || cur.dataset.action) { e.preventDefault(); cur.click(); } else if (cur.matches('a')) { e.preventDefault(); cur.click(); } break;
      case 'Escape': {
        e.preventDefault();
        (sec.querySelector('#fm-list [tabindex="0"]') || sec.querySelector('#fm-list'))?.focus?.();
        break;
      }
      default:
        if (e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key) && !e.shiftKey) {
          typed += e.key.toLocaleLowerCase('es'); clearTimeout(typedTimer); typedTimer = setTimeout(() => { typed = ''; }, 700);
          const labels = all.map((n) => n.textContent.trim().toLocaleLowerCase('es'));
          const start = typed.length === 1 ? i + 1 : Math.max(0, i);
          const hit = [...labels.keys()].map((n) => (n + start) % labels.length).find((n) => labels[n].startsWith(typed));
          if (hit !== undefined) focus(all[hit]);
        }
    }
  });
  let typed = '', typedTimer = 0;
  nav.addEventListener('focusin', (e) => {
    const n = e.target.closest?.('[data-nav-key]');
    if (!n) return;
    nav.querySelectorAll('[tabindex="0"]').forEach((x) => { if (x !== n) x.tabIndex = -1; });
    n.tabIndex = 0;
  });

  // ---------- Menus on nodes ----------
  nav.addEventListener('contextmenu', (e) => {
    const link = e.target.closest('.fm-nav-i, .fm-nav-h');
    e.preventDefault();
    if (!link) return;
    const x = e.clientX, y = e.clientY;
    if (link.classList.contains('fm-nav-h')) {
      const isOpen = link.getAttribute('aria-expanded') === 'true';
      const id = link.dataset.navKey.slice(4);
      showCtxMenu([
        { icon: isOpen ? 'chevrons-up' : 'chevrons-down', label: isOpen ? 'Contraer' : 'Expandir', run: () => link.click() },
        ...(id === 'library' ? [{ icon: 'settings-2', label: 'Carpetas de la biblioteca…', run: () => window.AxonLibrary?.settings() }, { icon: 'folder-plus', label: 'Agregar carpeta…', run: () => window.AxonLibrary?.addFolder() }] : []),
        ...(id === 'pc' ? [{ icon: 'refresh-cw', label: 'Actualizar discos', run: () => FL.refreshVolumes() }] : []),
        { sep: true },
        { icon: 'panel-left-close', label: 'Ocultar el panel', kbd: 'Ctrl+B', run: () => setNav(false) },
      ], x, y);
      return;
    }
    const path = link.dataset.path;
    if (link.dataset.collection) return window.AxonLibrary.collectionMenu(link.dataset.collection, x, y);
    if (link.dataset.navProvider) {
      return showCtxMenu([
        { icon: 'external-link', label: 'Abrir', run: () => link.click() },
        { icon: 'settings-2', label: 'Administrar conexión', run: () => window.AxonNavigation.go('/configuracion?section=connections') },
      ], x, y);
    }
    if (link.dataset.navVolume) {
      const v = volumesList().find((vol) => vol.id === link.dataset.navVolume);
      const items = [];
      if (path) items.push(...FL.folderMenu(path, { tree: true }));
      else if (v?.canMount) items.push({ icon: 'plug', label: 'Montar', run: () => mountVolume(v.id) });
      items.push({ sep: true }, { icon: 'refresh-cw', label: 'Actualizar discos', run: () => FL.refreshVolumes() }, { icon: 'hard-drive-download', label: 'Administrar discos', run: () => window.AxonNavigation.go('/almacenamiento?view=disks') });
      return showCtxMenu(items, x, y);
    }
    if (path && !link.dataset.file) {
      const items = FL.folderMenu(path, { tree: true });
      if (link.dataset.quick) {
        const pinned = link.dataset.pinned === '1';
        items.push({ sep: true }, pinned
          ? { icon: 'pin-off', label: 'Quitar de acceso rápido', run: () => window.AxonFileCatalog.patch([path], { pinned: false }).catch(errToast) }
          : { icon: 'pin', label: 'Fijar en acceso rápido', run: () => window.AxonFileCatalog.patch([path], { pinned: true }).catch(errToast) });
      } else if (!link.dataset.root || link.dataset.root) {
        items.push({ sep: true }, { icon: 'pin', label: 'Fijar en acceso rápido', run: () => window.AxonFileCatalog.patch([path], { pinned: true }).catch(errToast) });
      }
      items.push({ icon: 'external-link', label: 'Abrir en una pestaña nueva', run: () => window.open(link.href, '_blank', 'noopener') });
      return showCtxMenu(items, x, y);
    }
    if (link.dataset.file) {
      return showCtxMenu([
        { icon: 'external-link', label: 'Abrir', run: () => link.click() },
        { icon: 'pin-off', label: 'Quitar de acceso rápido', run: () => window.AxonFileCatalog.patch([path], { pinned: false }).catch(errToast) },
        { icon: 'clipboard', label: 'Copiar ruta', run: () => navigator.clipboard.writeText(path) },
      ], x, y);
    }
    const key = link.dataset.navKey || '';
    const items = [{ icon: 'external-link', label: 'Abrir', run: () => link.click() }];
    if (key === 'lib:cols') items.push({ icon: 'plus', label: 'Nueva colección…', run: () => window.AxonLibrary.newCollection() });
    if (key.startsWith('lib:')) items.push({ icon: 'settings-2', label: 'Carpetas de la biblioteca…', run: () => window.AxonLibrary.settings() });
    if (key.startsWith('sys:trash')) items.splice(0, 1, { icon: 'trash', label: 'Abrir papelera', run: () => FL.openTrash() });
    showCtxMenu(items, x, y);
  });

  // The open drawer sits on top of everything: it takes Escape before the folder view's layered Escape does.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobile.matches && sec.classList.contains('fm-nav-open') && !AxonMenu.open && !document.querySelector('dialog[open], .modal:not(.hidden)')) { e.preventDefault(); e.stopImmediatePropagation(); setNav(false); }
  }, true);

  // Shortcuts that must work in the gallery too (the folder view's own handler stands down there).
  document.addEventListener('keydown', (e) => {
    if (mode !== 'library' || !sec.classList.contains('active') || document.querySelector('dialog[open], .modal:not(.hidden)') || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key.toLowerCase() === 'b') { e.preventDefault(); toggleNav(); }
  });


  // ---------- "Este equipo": overview of folders and drives (Windows-style landing) ----------
  const pcEl = document.createElement('div');
  pcEl.className = 'fm-pc';
  pcEl.id = 'fm-pc';
  pcEl.hidden = true;
  sec.append(pcEl);
  let pcActive = false;

  function pcCards() {
    const home = homePath();
    const entry = home ? dirs.get(home) : null;
    const folders = HOME_STD.map(([es, en, ic]) => ({ ic, hit: entry?.items.find((c) => c.name === es || c.name === en) })).filter((x) => x.hit);
    const others = (entry?.items || []).filter((c) => !c.name.startsWith('.') && !folders.some((f) => f.hit === c)).slice(0, 12).map((hit) => ({ ic: 'folder', hit }));
    const folderCard = ({ ic, hit }) => `<a class="fm-pc-card" href="${esc(url('files', { path: hit.path }))}" data-drop-path="${esc(hit.path)}"${catalogColorAttr(hit.path)}><span class="fm-pc-ic">${icon(ic)}</span><span class="fm-pc-name">${esc(hit.name)}</span></a>`;
    const drives = uniqueVolumes().map((v) => {
      const used = v.size && v.available != null ? Math.round((1 - v.available / v.size) * 100) : null;
      const detail = !v.path ? 'Sin montar' : v.readOnly ? 'Sólo lectura' : !v.readable ? 'Sin permiso' : v.size && v.available != null ? `${FL.fmtSize(v.available)} disponibles de ${FL.fmtSize(v.size)}` : '';
      const attrs = v.path ? `href="${esc(url('files', { path: v.path }))}" data-drop-path="${esc(v.path)}"` : `href="#" data-pc-mount="${esc(v.id)}"`;
      return `<a class="fm-pc-drive" ${attrs} title="${esc(v.path || v.device || '')}"><span class="fm-pc-ic">${icon(v.external ? 'usb' : 'hard-drive')}</span><span class="fm-pc-info"><b>${esc(v.name)}</b>${used != null ? `<span class="fm-vol-bar fm-pc-bar${used >= 90 ? ' is-full' : ''}"><i style="width:${used}%"></i></span>` : ''}<small>${esc(detail)}${!v.path && v.canMount ? ' · Montar' : ''}</small></span></a>`;
    });
    const L = window.AxonLibrary?.summary();
    const lib = L?.loaded ? LIB_KINDS.filter(([k]) => L.kinds[k]).slice(0, 6).map(([k, label, ic]) => `<a class="fm-pc-card fm-pc-lib" href="${esc(url('library', { type: 'kind', value: k }))}"><span class="fm-pc-ic">${icon(ic)}</span><span class="fm-pc-name">${esc(label)}</span><em>${count(L.kinds[k])}</em></a>`) : [];
    const clouds = cloud.providers.map((p) => `<a class="fm-pc-card" href="${esc(url('files', { source: p.id, location: 'account' }))}"><span class="fm-pc-ic">${window.AxonConnections?.logo?.(p.id) || icon('cloud')}</span><span class="fm-pc-name">${esc(p.name)}</span></a>`);
    return `
      <header class="fm-pc-head"><button type="button" class="icon-btn fm-nav-toggle" aria-label="Mostrar u ocultar el panel de navegación" aria-controls="fm-nav">${icon('panel-left')}</button><div class="page-history"><button class="icon-btn" data-axon-back title="Atrás" aria-label="Atrás">${icon('arrow-left')}</button><button class="icon-btn" data-axon-forward title="Adelante" aria-label="Adelante">${icon('arrow-right')}</button></div><h2>Este equipo</h2></header>
      <div class="fm-pc-body">
        <section aria-labelledby="pc-folders"><h3 id="pc-folders">Carpetas <span>${count(folders.length + others.length)}</span></h3><div class="fm-pc-grid">${[...folders, ...others].map(folderCard).join('') || '<p class="fm-nav-note">Cargando carpetas…</p>'}</div></section>
        <section aria-labelledby="pc-drives"><h3 id="pc-drives">Dispositivos y unidades <span>${drives.length}</span></h3><div class="fm-pc-drives">${drives.join('') || '<p class="fm-nav-note">Buscando discos…</p>'}</div></section>
        ${lib.length ? `<section aria-labelledby="pc-lib"><h3 id="pc-lib">Biblioteca <span>${count(L.total)}</span></h3><div class="fm-pc-grid">${lib.join('')}</div></section>` : ''}
        ${clouds.length ? `<section aria-labelledby="pc-cloud"><h3 id="pc-cloud">Nube</h3><div class="fm-pc-grid">${clouds.join('')}</div></section>` : ''}
      </div>`;
  }
  function renderPc() {
    if (!pcActive) return;
    pcEl.innerHTML = pcCards();
    refreshIcons(pcEl);
    window.AxonNavigation?.controls();
  }
  async function showPc() {
    pcActive = true;
    sec.classList.add('fm-mode-pc');
    pcEl.hidden = false;
    renderPc();
    await Promise.allSettled([FL.refreshVolumes(), homePath() ? loadDirs(homePath()) : Promise.resolve()]);
    renderPc();
    scheduleRender();
  }
  function hidePc() {
    if (!pcActive) return;
    pcActive = false;
    sec.classList.remove('fm-mode-pc');
    pcEl.hidden = true;
    scheduleRender();
  }
  pcEl.addEventListener('click', (e) => {
    const mount = e.target.closest('[data-pc-mount]');
    if (mount) { e.preventDefault(); e.stopImmediatePropagation(); void mountVolume(mount.dataset.pcMount); }
  });

  // ---------- Refresh triggers ----------
  window.addEventListener('axon:files-location', () => { void reveal(); });
  window.addEventListener('axon:files-changed', (e) => { const d = e.detail?.dir; if (d) void loadDirs(d, { force: true }); });
  // Links in the pane are handled by AxonNavigation (capture phase), so closing the mobile drawer follows the route.
  document.addEventListener('axon:route', () => { if (mobile.matches) setNav(false); scheduleRender(); void reveal(); });
  document.addEventListener('axon:catalog', scheduleRender);
  document.addEventListener('axon:library', scheduleRender);
  window.addEventListener('axon:disks', () => scheduleRender());
  document.addEventListener('axon:cloud-sources', (e) => { cloud = e.detail; scheduleRender(); });
  const volumeTimer = setInterval(() => { if (sec.classList.contains('active')) scheduleRender(); }, 20_000);
  void volumeTimer;

  // Counts and collections in the pane follow uploads, optimizations and shares made elsewhere.
  setInterval(() => {
    if (!sec.classList.contains('active') || document.hidden || mode === 'library') return; // the gallery polls on its own
    window.AxonLibrary?.refreshIfChanged().catch(() => {});
  }, 45_000);

  // Folders created, renamed or deleted from the folder view: refresh the branch that holds them.
  setInterval(() => {
    if (!sec.classList.contains('active') || document.hidden || mode !== 'files') return;
    const here = FL.cwd;
    if (!here) return;
    const parent = here.slice(0, here.lastIndexOf('/')) || '/';
    for (const p of [here, parent]) if (dirs.has(p) && expanded.size) void loadDirs(p, { force: Date.now() - dirs.get(p).ts > TTL });
  }, 15_000);

  // ---------- Boot ----------
  function boot() {
    embedGallery();
    cloud = window.AxonCloud ? { providers: window.AxonCloud.providers(), active: window.AxonCloud.active() } : cloud;
    setNav(mobile.matches ? false : !prefs.hidden, { persist: false });
    setMode(window.AxonNavigation?.current?.section === 'library' ? 'library' : 'files');
    render();
    // Library counts and collections load quietly once the page is idle.
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 1200)))(() => { window.AxonLibrary?.ensureLoaded?.().catch(() => {}); });
  }
  async function bootstrapPaths() {
    try {
      if (!homePath()) { const d = await api('/api/files'); fallbackHome = d.home || ''; }
      if (homePath()) { expanded.add(nodeKey('home', homePath())); void loadDirs(homePath()); }
      if (!volumesList().length) await FL.refreshVolumes();
    } catch { /* offline or signed out: the pane renders what it has */ }
    scheduleRender();
    void reveal();
  }
  // Wait for sign-in: boot runs while the login screen may still be showing.
  if (document.querySelector('#main-screen:not(.hidden)')) void bootstrapPaths();
  else document.addEventListener('axon:authenticated', () => void bootstrapPaths(), { once: true });
  window.addEventListener('axon:files-location', () => { if (!fallbackHome && !FL.home) void bootstrapPaths(); }, { once: true });

  window.AxonExplorer = { toggleNav, setNav, refresh: scheduleRender, reveal, showPc, hidePc, get pcActive() { return pcActive; }, get mode() { return mode; } };
  boot();
})();
