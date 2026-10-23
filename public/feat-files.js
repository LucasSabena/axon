/* AXON — File manager tab (self-contained; wired by integrator) */
(() => {
  'use strict';

  if (document.getElementById('tab-files')) return; // already injected

  // ---------- Build the tab section at load ----------
  const sec = document.createElement('section');
  sec.id = 'tab-files';
  sec.className = 'tab-content';
  sec.innerHTML = `
    <aside class="fm-nav" id="fm-nav" aria-label="Navegación de archivos"></aside>
    <div class="fm-grip" id="fm-grip" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Ancho del panel de navegación" title="Arrastrá para ajustar el panel"></div>
    <div class="fm-pane" id="fm-pane">
    <div class="fm-top">
      <div class="fm-navrow">
        <button type="button" class="icon-btn fm-nav-toggle" id="fm-nav-toggle" title="Panel de navegación (Ctrl+B)" aria-label="Mostrar u ocultar el panel de navegación" aria-controls="fm-nav" aria-expanded="true">${icon('panel-left')}</button>
        <div class="page-history">
          <button class="icon-btn" data-axon-back title="Atrás (Alt+←)" aria-label="Atrás">${icon('arrow-left')}</button>
          <button class="icon-btn" data-axon-forward title="Adelante (Alt+→)" aria-label="Adelante">${icon('arrow-right')}</button>
          <button class="icon-btn" id="fm-parent" title="Carpeta superior (Alt+↑)" aria-label="Carpeta superior">${icon('arrow-up')}</button>
          <button class="icon-btn" id="fm-refresh-btn" title="Actualizar (F5)" aria-label="Actualizar">${icon('refresh-cw')}</button>
        </div>
        <div class="fm-address"><nav class="fm-breadcrumb" id="fm-breadcrumb" aria-label="Carpeta actual"></nav><form id="fm-location-form"><input id="fm-location" aria-label="Carpeta actual" placeholder="Ir a una carpeta…" autocomplete="off" spellcheck="false"></form></div>
        <button class="icon-btn" id="fm-edit-location" title="Escribir una ruta (Ctrl+L)" aria-label="Escribir una ruta">${icon('pencil')}</button>
        <div class="fm-searchbox">
          ${icon('search')}
          <input type="text" id="fm-filter" placeholder="Buscar o filtrar…" aria-label="Buscar archivos y carpetas" autocomplete="off" spellcheck="false">
          <button type="button" id="fm-search-btn" class="fm-scope" aria-pressed="false" title="Buscar también dentro de las subcarpetas (Ctrl+F)">${icon('folders')}<span>Subcarpetas</span></button>
        </div>
      </div>
      <div class="fm-cmdbar" role="toolbar" aria-label="Acciones de la carpeta">
        <button id="fm-create-btn" class="fm-cmd fm-cmd-primary" popovertarget="fm-create-menu" aria-haspopup="menu">${icon('plus')}<span>Nuevo</span>${icon('chevron-down')}</button>
        <button id="fm-upload-btn" class="fm-cmd" title="Subir archivos (Ctrl+U)">${icon('upload')}<span>Subir</span></button>
        <span class="fm-cmd-sep" aria-hidden="true"></span>
        <button id="fm-sort-btn" class="fm-cmd" aria-haspopup="menu" title="Ordenar">${icon('arrow-up-down')}<span id="fm-sort-label">Nombre</span>${icon('chevron-down')}</button>
        <button id="fm-view-btn" class="fm-cmd" aria-haspopup="menu" title="Tamaño de íconos, densidad y elementos visibles">${icon('layout-template')}<span>Vista</span>${icon('chevron-down')}</button>
        <div class="fm-view-switch" role="group" aria-label="Vista">
          <button class="fm-vbtn" id="fm-view-list" data-view="list" title="Lista (Ctrl+Shift+1)" aria-label="Vista de lista">${icon('list')}</button>
          <button class="fm-vbtn" id="fm-view-grid" data-view="grid" title="Íconos (Ctrl+Shift+2)" aria-label="Vista de íconos">${icon('layout-grid')}</button>
          <button class="fm-vbtn" id="fm-view-cols" data-view="cols" title="Columnas (Ctrl+Shift+3)" aria-label="Vista de columnas">${icon('columns')}</button>
        </div>
        <button id="fm-hidden-btn" class="fm-cmd fm-cmd-icon" title="Mostrar/ocultar archivos ocultos (Ctrl+H)" aria-label="Archivos ocultos">${icon('eye-off')}</button>
        <span class="fm-cmd-spacer"></span>
        <span class="fm-filter-summary hidden" id="fm-filter-summary" role="status"></span>
        <button id="fm-more-btn" class="fm-cmd" aria-expanded="false" aria-controls="fm-drawer" title="Filtros, etiquetas y herramientas">${icon('sliders-horizontal')}<span>Filtros y más</span>${icon('chevron-down')}</button>
      </div>
      <div class="fm-drawer" id="fm-drawer" hidden>
        <div class="fm-filter-row"><div class="catalog-bar" id="fm-catalog-bar" aria-label="Organización y filtros">
          <label>Ver<select id="fm-mark"><option value="">Esta carpeta</option><option value="*">Todo lo organizado</option>${Object.entries(AxonFileCatalog.marks).map(([k,[,label]])=>`<option value="${k}">${label}</option>`).join('')}</select></label>
          <label>Tipo<select id="fm-kind"><option value="">Todo</option><option value="dir">Carpetas</option><option value="file">Archivos</option></select></label>
          <label>Color<select id="fm-color"><option value="">Todos</option>${Object.entries(AxonFileCatalog.colors).map(([c,label])=>`<option value="${c}">${label}</option>`).join('')}</select></label>
          <label>Etiqueta<select id="fm-tag"><option value="">Todas</option></select></label>
          <button id="fm-organize-folder" class="btn-secondary">${icon('tags')}Organizar carpeta</button>
          <button id="fm-clear-filters" class="btn-secondary hidden">${icon('x')}Quitar filtros</button>
        </div></div>
        <div class="fm-tools-row">
          <button type="button" id="fm-disks-open" class="btn-secondary" aria-haspopup="dialog" aria-controls="fm-disks-dialog">${icon('hard-drive')}<span id="fm-disk-label">Discos</span>${icon('chevron-down')}</button>
          <button type="button" id="fm-trash" class="btn-secondary" title="Papelera del disco actual">${icon('trash-2')}<span>Papelera</span></button>
          <button class="btn-secondary" data-axon-copy title="Copiar el enlace de esta carpeta">${icon('link')}<span>Copiar enlace</span></button>
          <button class="btn-secondary" id="fm-keys" title="Atajos de teclado (?)">${icon('keyboard')}<span>Atajos</span></button>
          <div class="catalog-quick" id="fm-quick"></div>
        </div>
      </div>
      <div id="fm-clipboard" class="fm-clipboard hidden" aria-live="polite">
        <span id="fm-clipboard-label"></span>
        <button id="fm-paste-btn" class="btn-primary">${icon('clipboard-paste')} Pegar acá</button>
        <button id="fm-clipboard-clear" class="icon-btn" aria-label="Vaciar portapapeles">${icon('x')}</button>
      </div>
    </div>
    <div id="fm-create-menu" class="fm-create-menu" popover aria-label="Crear o subir">
      <button id="fm-mkdir-btn" class="btn-secondary">${icon('folder-plus')} Nueva carpeta</button>
      <button id="fm-new-file-btn" class="btn-secondary" title="Crear un archivo (Ctrl+Alt+N)">${icon('file-plus')} Nuevo archivo</button>
      <button id="fm-upload-dir-btn" class="btn-secondary" title="Subir una carpeta completa">${icon('folder-up')} Subir carpeta</button>
    </div>
    <dialog id="fm-disks-dialog" class="fm-disks-dialog" aria-labelledby="fm-disks-title">
      <div class="fm-disks-heading"><h2 id="fm-disks-title">Discos del servidor</h2><button type="button" id="fm-disks-close" class="icon-btn" aria-label="Cerrar discos">${icon('x')}</button></div>
      <p class="listener-note">Elegí un disco para explorar sus archivos. Acá podés consultar el espacio disponible.</p>
      <div id="fm-volumes" class="fm-volume-list"><span class="listener-note">Buscando discos…</span></div>
      <p id="fm-volumes-error" class="listener-note hidden" role="status"></p>
      <div class="fm-disks-actions"><a class="btn-secondary" href="/almacenamiento?view=disks">Administrar discos</a><button id="fm-volumes-refresh" class="btn-secondary">${icon('refresh-cw')} Actualizar discos</button></div>
      <p class="listener-note">Los archivos se leen directamente del servidor. Los cambios se realizan con los permisos de tu usuario.</p>
    </dialog>
    <div class="fm-main" id="fm-main">
      <div class="fm-list" id="fm-list">
        <div class="table-wrapper fm-table-wrap" id="fm-table-wrap">
          <table class="data-table" id="fm-table">
            <thead>
              <tr>
                <th class="fm-selcell"><input type="checkbox" id="fm-check-all" tabindex="-1" title="Seleccionar todo" aria-label="Seleccionar todo"></th>
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
            <button id="fm-prev-share" class="fm-pact hidden" title="Compartir link" aria-label="Compartir link">${icon('share-2')}</button>
            <button id="fm-prev-tools" class="fm-pact hidden" title="Optimizar o convertir" aria-label="Optimizar o convertir">${icon('wand-2')}</button>
            <button id="fm-prev-viewer" class="fm-pact hidden" title="Abrir en el visor de la biblioteca" aria-label="Abrir en el visor">${icon('scan-eye')}</button>
            <button id="fm-prev-ext" class="fm-pact" title="Abrir en pestaña nueva">${icon('external-link')}</button>
            <button id="fm-prev-full" class="fm-pact" title="Pantalla completa">${icon('maximize')}</button>
            <button id="fm-prev-dl" class="fm-pact" title="Descargar">${icon('download')}</button>
            <button id="fm-prev-close" class="fm-pact" title="Cerrar (Esc)">${icon('x')}</button>
          </div>
        </div>
        <div class="fm-prev-navigation" aria-label="Navegar archivos">
          <button type="button" class="fm-pact" id="fm-prev-previous" aria-label="Archivo anterior">${icon('chevron-left')}</button>
          <span id="fm-prev-position" role="status"></span>
          <button type="button" class="fm-pact" id="fm-prev-next" aria-label="Archivo siguiente">${icon('chevron-right')}</button>
        </div>
        <div class="fm-prev-meta" id="fm-prev-meta"></div>
        <div class="fm-prev-body" id="fm-prev-body"></div>
      </div>
    </div>
    <div class="fm-footer">
      <div class="fm-statusbar" id="fm-statusbar"></div>
      <button type="button" id="fm-transfers-btn" class="fm-transfers-btn" title="Historial de transferencias" aria-label="Ver historial de transferencias">${icon('arrow-left-right')}<span class="fm-transfers-label">Transferencias</span><span id="fm-transfers-count">0</span></button>
    </div>
    <div class="fm-typeahead hidden" id="fm-typeahead"></div>
    <div class="fm-editor hidden" id="fm-editor">
      <div class="fm-editor-bar">
        <span class="mono fm-editor-name" id="fm-editor-name"></span>
        <span class="fm-dirty-dot hidden" id="fm-dirty-dot" title="Cambios sin guardar">●</span>
        <span class="badge badge-other hidden" id="fm-editor-flag"></span>
        <div class="section-actions">
          <div id="fm-document-modes" class="fm-view-switch hidden" role="group" aria-label="Modo del documento">
            <button type="button" id="fm-document-read" class="fm-vbtn" aria-pressed="false">${icon('book-open')} Visualizador</button>
            <button type="button" id="fm-document-edit" class="fm-vbtn" aria-pressed="true">${icon('pencil')} Editor</button>
          </div>
          <button id="fm-save-btn" class="btn-primary">${icon('save')} Guardar</button>
          <button id="fm-back-btn" class="btn-secondary">${icon('arrow-left')} Volver</button>
        </div>
      </div>
      <textarea id="fm-editor-text" class="mono" aria-label="Contenido del archivo" spellcheck="false" wrap="off"></textarea>
      <div id="fm-editor-preview" class="fm-editor-preview hidden"></div>
      <p class="listener-note" id="fm-editor-help">Ctrl/Cmd+S guarda · Tab indenta (Shift+Tab quita) · Esc vuelve a la lista</p>
    </div>
    <input type="file" id="fm-file-input" class="hidden" multiple>
    <input type="file" id="fm-dir-input" class="hidden" webkitdirectory>
    <div class="fm-selbar hidden" id="fm-selbar" role="toolbar" aria-label="Acciones de la selección">
      <span class="fm-sel-info"><b id="fm-sel-count"></b><small id="fm-sel-size"></small></span>
      <button id="fm-sel-share" class="btn-primary" title="Crear un link para compartir (los archivos seleccionados)">${icon('share-2')}<span>Compartir</span></button>
      <button id="fm-sel-dl" class="btn-secondary" title="Descargar">${icon('download')}<span>Descargar</span></button>
      <button id="fm-sel-copy" class="btn-secondary" title="Copiar (Ctrl+C)">${icon('copy')}<span>Copiar</span></button>
      <button id="fm-sel-move" class="btn-secondary" title="Cortar para mover (Ctrl+X)">${icon('scissors')}<span>Cortar</span></button>
      <button id="fm-sel-organize" class="btn-secondary" title="Colores, etiquetas y marcas">${icon('tags')}<span>Organizar</span></button>
      <button id="fm-sel-more" class="btn-secondary" aria-haspopup="menu" aria-label="Más acciones" title="Más acciones">${icon('more-horizontal')}</button>
      <button id="fm-sel-del" class="btn-danger" aria-label="Eliminar">${icon('trash-2')}<span>Eliminar</span></button>
      <span class="fm-sel-sep" aria-hidden="true"></span>
      <button id="fm-sel-all" class="btn-secondary fm-sel-icon" title="Seleccionar todo (Ctrl+A)" aria-label="Seleccionar todo">${icon('check-check')}</button>
      <button id="fm-sel-clear" class="btn-secondary fm-sel-icon" title="Limpiar selección (Esc)" aria-label="Limpiar selección">${icon('x')}</button>
    </div>
    <div class="fm-upload-progress hidden" id="fm-upload-progress">
      <span id="fm-up-label"></span>
      <div class="fm-up-track"><div class="fm-up-bar" id="fm-up-bar"></div></div>
      <button id="fm-up-cancel" class="btn-secondary" title="Cancelar la subida">${icon('x')} Cancelar</button>
    </div>
    <div class="fm-drop-overlay" id="fm-drop-overlay">
      <div class="fm-drop-box">${icon('upload')}<span id="fm-drop-text"></span></div>
    </div>
    </div>
  `;
  (document.querySelector('main.content') || document.body).appendChild(sec);
  refreshIcons();

  // ---------- State ----------
  const RENDER_PAGE = 500; // first paint budget; a 10k dir never writes 10k rows
  const S = {
    cwd: '',
    home: '',
    entries: [],
    volumes: [],
    devices: [],
    volume: null,
    volumesBusy: false,
    transferBusy: false,
    filter: '',
    editingPath: null,
    readOnly: false,
    originalContent: '',
    lineEnding: '\n',
    dragDepth: 0,
    sel: new Set(),   // multi-selection (names within cwd)
    anchor: null,     // last-clicked row name — shift+click range base
    preview: null,    // {path, name, kind} — open preview pane
    view: localStorage.getItem('fm-view') || 'list', // list | grid | cols
    tile: localStorage.getItem('fm-tile') || 'medium',      // grid icon size: small | medium | large | xl
    density: localStorage.getItem('fm-density') || 'normal', // list rows: compact | normal | comfortable
    checks: localStorage.getItem('fm-checks') !== '0',      // selection checkboxes column
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
    catalogMark:'',catalogColor:'',catalogTag:'',catalogKind:'',
    searchMode: false,
    searchQ: '',
    searchResults: null, // [{type,path,name,dir}] while searching
    dragging: null,   // {dir, names:[...]} internal drag payload
    jobs: new Map(),  // jobId -> {label, pct, cancel} copy jobs in flight
    renderLimit: RENDER_PAGE, // rows currently painted — grows via "Mostrar más"
  };

  const el = (id) => sec.querySelector('#' + id);
  // Cloud sources and the Biblioteca gallery replace the folder view; shortcuts and polling stand down meanwhile.
  const dormant = () => sec.classList.contains('fm-cloud-mode') || sec.classList.contains('fm-mode-gallery') || sec.classList.contains('fm-mode-pc');
  const join = (dir, name) => (dir.endsWith('/') ? dir + name : dir + '/' + name);
  const parentOf = (p) => {
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  };

  function syncCatalogControls(){
    el('fm-mark').value=S.catalogMark;
    el('fm-kind').value=S.catalogKind;el('fm-color').value=S.catalogColor;
    el('fm-tag').innerHTML='<option value="">Todas</option>'+AxonFileCatalog.tags().map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');el('fm-tag').value=S.catalogTag;
    const pins=AxonFileCatalog.entries().filter(r=>r.available&&r.metadata.pinned).slice(0,12);
    syncCommandBar();
    el('fm-quick').innerHTML=pins.length?'<span>Acceso rápido</span>'+pins.map(r=>`<a href="/archivos?${new URLSearchParams(r.kind==='dir'?{path:r.path}:{path:parentOf(r.path),item:r.path.split('/').pop()})}"${AxonFileCatalog.attr(r.path)}>${icon(r.kind==='dir'?'folder':'file')} ${esc(r.path.split('/').pop())}</a>`).join(''):'';
    refreshIcons();
  }
  el('fm-mark').onchange=e=>{toggleSearch(false);S.catalogMark=e.target.value;S.sel.clear();syncCatalogControls();render();updateSelbar();window.AxonNavigation?.update('files',fileParams());};
  for(const [id,key] of [['fm-kind','catalogKind'],['fm-color','catalogColor'],['fm-tag','catalogTag']])el(id).onchange=e=>{S[key]=e.target.value;syncCommandBar();render();window.AxonNavigation?.update('files',fileParams());};
  el('fm-organize-folder').onclick=()=>AxonFileCatalog.edit([S.cwd]);
  document.addEventListener('axon:catalog',()=>{syncCatalogControls();if(!S.editingPath)render();});
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
    if (window.AxonDocumentViewer?.supports(name)) return 'document';
    if (CODE_EXT.has(ext) || TEXT_EXT.has(ext) || !name.includes('.') || /^\.env(?:\.|$)/i.test(name)) return 'text';
    return 'other';
  }

  function iconFor(e) {
    if (e.type === 'dir') return 'folder';
    if (e.type === 'link') return 'link';
    const ext = (e.name.split('.').pop() || '').toLowerCase();
    if (VID_EXT.has(ext)) return 'film';
    if (AUD_EXT.has(ext)) return 'music';
    if (CODE_EXT.has(ext)) return 'file-code';
    if (['csv', 'tsv', 'xls', 'xlsx', 'xlsm', 'ods'].includes(ext)) return 'table-2';
    if (['ppt', 'pptx', 'pps', 'ppsx', 'odp'].includes(ext)) return 'presentation';
    if (TEXT_EXT.has(ext) || window.AxonDocumentViewer?.supports(e.name)) return 'file-text';
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
      if (msg === 'Cargando…') st.innerHTML = AxonUI.skeleton('Cargando archivos',5); else st.textContent = msg;
      st.classList.remove('hidden');
    }
  }

  function showList() {
    el('fm-editor').classList.add('hidden');
    el('fm-main').classList.remove('hidden');
  }

  function renderCrumbs() {
    el('fm-location').value = S.cwd;
    const parts = S.cwd.split('/').filter(Boolean);
    let html = `${window.AxonExplorer ? `<button class="fm-crumb fm-crumb-pc" data-pc="1" title="Este equipo" aria-label="Este equipo">${icon('monitor')}</button><span class="fm-sep">/</span>` : ''}<button class="fm-crumb" data-p="${esc(S.home || '/')}">${icon('home')} Inicio</button>`;
    let acc = '';
    for (const seg of parts) {
      acc += '/' + seg;
      html += `<span class="fm-sep">/</span><button class="fm-crumb" data-p="${esc(acc)}">${esc(seg)}</button>`;
    }
    el('fm-breadcrumb').innerHTML = html;
    el('fm-breadcrumb').lastElementChild?.setAttribute('aria-current', 'location');
    el('fm-breadcrumb').scrollLeft=el('fm-breadcrumb').scrollWidth;
    refreshIcons();
    renderVolumes();
    renderClipboard();
    applyReadOnly();
    window.dispatchEvent(new CustomEvent('axon:files-location', { detail: { path: S.cwd } }));
  }

  // Read-only volumes gray out every create/upload entry point (paste is
  // handled in renderClipboard; drag & drop and transfers check on their own).
  function applyReadOnly() {
    const ro = Boolean(volumeAt(S.cwd)?.readOnly);
    for (const id of ['fm-upload-btn', 'fm-upload-dir-btn', 'fm-new-file-btn', 'fm-mkdir-btn']) {
      const b = el(id);
      if (b.dataset.ot === undefined) b.dataset.ot = b.title || '';
      b.disabled = ro;
      b.title = ro ? 'Solo lectura — este volumen no admite cambios' : b.dataset.ot;
    }
  }

  function volumeAt(p) {
    return S.volumes.filter(v => v.path && (v.path==='/' || p===v.path || p.startsWith(v.path+'/')))
      .sort((a,b)=>b.path.length-a.path.length)[0];
  }
  function volumeToken(p) {
    const v=volumeAt(p);return v ? v.id+':'+v.mountId : undefined;
  }
  function renderVolumes() {
    const current=volumeAt(S.cwd);
    el('fm-disk-label').textContent=current?.name || 'Discos';
    el('fm-disks-open').title=current ? `${current.name} · ${fmtSize(current.available)} libres · Ver discos` : 'Ver discos del servidor';
    const mounted = (window.AxonStorage?.uniqueVolumes(S.volumes)||S.volumes).map(v=>{
      const selected=current?.id===v.id;
      const state=!v.path?'Sin montar':v.readOnly?'Sólo lectura':!v.readable?'Sin permiso':v.available===null?'Montado':`${fmtSize(v.available)} libres`;
      const blocked=(v.path && !v.readable) || (!v.path && !v.canMount);
      return `<button type="button" class="fm-volume${selected?' active':''}" data-volume="${esc(v.id)}" ${blocked?'disabled':''} aria-pressed="${selected}" title="${esc(v.path || v.device)}">
        ${icon(v.external?'usb':'hard-drive')}<span><strong>${esc(v.name)}</strong><small>${v.size?fmtSize(v.size)+' · ':''}${esc(state)}${!v.path&&v.canMount?' · Montar':''}</small></span>
      </button>`;
    });
    for(const d of S.devices)if(!d.hidden&&!S.volumes.some(v=>v.diskId===d.id))mounted.push(`<span class="fm-volume">${icon(d.external?'usb':'hard-drive')}<span><strong>${esc(d.name)}</strong><small>${fmtSize(d.size)} · Sin volumen navegable</small></span></span>`);
    el('fm-volumes').innerHTML=mounted.join('') || '<span class="listener-note">No hay volúmenes disponibles. Revisá la conexión de los discos.</span>';
    refreshIcons();
  }
  async function refreshVolumes() {
    if(S.volumesBusy)return;
    S.volumesBusy=true;el('fm-volumes-refresh').disabled=true;
    try {
      const data=await api('/api/files/volumes',{fresh:true,signal:AbortSignal.timeout(35_000)});
      const previous=volumeAt(S.cwd);S.volumes=data.volumes || [];S.devices=data.devices || [];
      el('fm-volumes-error').classList.add('hidden');
      el('fm-disks-open').classList.remove('fm-disks-warning');
      if(previous?.path && previous.path!=='/' && !S.volumes.some(v=>v.id===previous.id && v.mountId===previous.mountId)){
        S.entries=[];S.sel.clear();render();
        setState('El disco fue desconectado o cambió su montaje. Elegí un disco disponible.');
      }
      renderVolumes();renderClipboard();applyReadOnly();
    } catch(err) {
      el('fm-volumes-error').textContent='No se pudieron actualizar los discos. La lista puede estar desactualizada. Usá Actualizar discos para reintentar.';
      el('fm-volumes-error').classList.remove('hidden');
      el('fm-disks-open').classList.add('fm-disks-warning');
      el('fm-disks-open').title='No se pudieron actualizar los discos. Abrí Discos para reintentar.';
    } finally {S.volumesBusy=false;el('fm-volumes-refresh').disabled=false;}
  }
  el('fm-volumes-refresh').addEventListener('click',refreshVolumes);
  const disksDialog=el('fm-disks-dialog');
  el('fm-disks-open').addEventListener('click',()=>{disksDialog.showModal();void refreshVolumes();});
  el('fm-disks-close').addEventListener('click',()=>disksDialog.close());
  disksDialog.querySelector('a').addEventListener('click',()=>disksDialog.close());
  window.addEventListener('axon:disk-visibility',refreshVolumes);
  el('fm-trash').addEventListener('click',()=>{
    const disk=volumeAt(S.cwd), local=(S.trashDirs||[]).find(p=>disk?.path&&disk.path!=='/'&&p.startsWith(disk.path+'/'));
    navigate(local||S.trashDir||'~/.local/share/Trash/files');
  });
  el('fm-volumes').addEventListener('click',async e=>{
    const button=e.target.closest('[data-volume]');if(!button)return;
    const v=S.volumes.find(v=>v.id===button.dataset.volume);if(!v)return;
    if(v.path){disksDialog.close();navigate(v.path);return;}
    button.disabled=true;button.setAttribute('aria-busy','true');
    try {
      const result=await api(`/api/files/volumes/${encodeURIComponent(v.id)}/mount`,{method:'POST',body:{}});
      await refreshVolumes();if(result.path){disksDialog.close();navigate(result.path);}
    } catch(err){el('fm-volumes-error').textContent=err.message;el('fm-volumes-error').classList.remove('hidden');button.disabled=false;button.removeAttribute('aria-busy');}
  });
  function renderClipboard() {
    const clip=S.clip;
    el('fm-clipboard').classList.toggle('hidden',!clip?.names?.length);
    if(!clip?.names?.length)return;
    el('fm-clipboard-label').textContent=`${clip.mode==='cut'?'Mover':'Copiar'} ${clip.names.length===1?clip.names[0]:clip.names.length+' elementos'} · Elegí la carpeta de destino y pegá`;
    el('fm-paste-btn').disabled=S.transferBusy || !S.cwd || Boolean(volumeAt(S.cwd)?.readOnly);
    el('fm-paste-btn').setAttribute('aria-busy',String(S.transferBusy));
  }
  el('fm-sel-copy').addEventListener('click',()=>setClip({mode:'copy',dir:S.cwd,names:[...S.sel]}));
  el('fm-sel-move').addEventListener('click',()=>setClip({mode:'cut',dir:S.cwd,names:[...S.sel]}));
  el('fm-paste-btn').addEventListener('click',()=>paste().catch(errToast));
  el('fm-clipboard-clear').addEventListener('click',()=>setClip(null));

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
        AxonFileCatalog.matches(join(S.cwd,e.name),{query:q,color:S.catalogColor,tag:S.catalogTag,kind:S.catalogKind},e.type==='dir'?'dir':'file')
    );
  }
  const hiddenCount = () => S.entries.filter((e) => e.name.startsWith('.')).length;
  const isCutName = (name) =>
    S.clip && S.clip.mode === 'cut' && S.clip.dir === S.cwd && S.clip.names.includes(name);


  // Indexed media already has a cached thumbnail in the library; reuse it instead of a generic icon.
  const libThumb = (path) => {
    const it = window.AxonLibrary?.peek(path);
    return it && it.k !== 'audio' && it.th !== -1 ? `/api/library/thumb/${encodeURIComponent(it.id)}?k=${encodeURIComponent(it.tk)}` : '';
  };

  function rowHtml(e, isUp) {
    let ic = isUp ? icon('arrow-up') : icon(iconFor(e));
    if (!isUp && e.type === 'file') {
      const thumb = libThumb(join(S.cwd, e.name));
      if (thumb) ic = `<span class="fm-row-ic">${ic}</span><img class="fm-row-thumb" loading="lazy" decoding="async" draggable="false" alt="" src="${thumb}">`;
    }
    const linkBadge = e.type === 'link' ? ' <span class="badge badge-other">link</span>' : '';
    // Trash rows get restore/permanent-delete only — renaming a trashed entry
    // would desync it from its .trashinfo manifest, and structural rows
    // (files/, info/, ids sin metadatos) get no row actions at all.
    let acts = '';
    if (!isUp) {
      if (inTrash(S.cwd)) {
        if (S.trashNames[e.name]?.id) {
          acts = `<div class="fm-acts">
            <button class="fm-act" data-act="restore" title="Restaurar a su ubicación original">${icon('undo-2')}</button>
            <button class="fm-act fm-act-danger" data-act="delete" title="Borrar definitivamente">${icon('trash-2')}</button>
          </div>`;
        }
      } else {
        acts = `<div class="fm-acts">
          ${e.type !== 'dir' && window.AxonLibrary ? `<button class="fm-act" data-act="share" aria-label="Compartir ${esc(e.name)}" title="Compartir link">${icon('share-2')}</button>` : ''}
          <button class="fm-act" data-act="organize" aria-label="Organizar ${esc(e.name)}" title="Colores, etiquetas y marcas">${icon('tags')}</button>
          ${e.type !== 'dir' ? `<button class="fm-act" data-act="download" aria-label="Descargar ${esc(e.name)}" title="Descargar">${icon('download')}</button>` : `<button class="fm-act" data-act="zipdl" aria-label="Descargar ${esc(e.name)} como zip" title="Descargar como .zip">${icon('archive')}</button>`}
          <button class="fm-act" data-act="more" aria-haspopup="menu" aria-label="Más acciones para ${esc(e.name)}" title="Más acciones">${icon('more-horizontal')}</button>
        </div>`;
      }
    }
    const selected = !isUp && S.sel.has(e.name);
    const hidden = !isUp && e.name.startsWith('.');
    const cut = !isUp && isCutName(e.name);
    return `<tr class="fm-row${isUp ? ' fm-up' : ''}${selected ? ' fm-selected' : ''}${hidden ? ' fm-hidden' : ''}${cut ? ' fm-cut' : ''}" data-name="${esc(e.name)}" data-type="${esc(e.type)}"${isUp?'':AxonFileCatalog.attr(join(S.cwd,e.name))}${isUp ? '' : ' draggable="true"'}>
      <td class="fm-selcell">${isUp ? '' : `<input type="checkbox" class="fm-check" aria-label="Seleccionar ${esc(e.name)}" ${selected ? 'checked' : ''} tabindex="-1">`}</td>
      <td class="icon-cell">${ic}</td>
      <td class="fm-name"${e.trashOrig ? ` title="${esc(`Ubicación original: ${e.trashOrig}${S.trashNames[e.name]?.ts ? ` · Eliminado: ${fmtDate(Date.parse(S.trashNames[e.name].ts))}` : ''}`)}"` : ''}>${esc(dispName(e))}${linkBadge}${isUp?'':AxonFileCatalog.badges(join(S.cwd,e.name))}</td>
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
    // Prune the du cache — it grows unboundedly while browsing otherwise.
    if (S.dirSizes.size > 600) {
      const now = Date.now();
      for (const [k, v] of S.dirSizes) if (now - v.ts > DIRSIZE_TTL) S.dirSizes.delete(k);
      if (S.dirSizes.size > 600) {
        for (const k of [...S.dirSizes.keys()].slice(0, S.dirSizes.size - 400)) S.dirSizes.delete(k);
      }
    }
    const cells = [...sec.querySelectorAll('[data-dirsize]')];
    if (cells.length > 120) {
      // No du-storm on giant folders — explain the '—' instead of hiding it.
      for (const c of cells) c.title = 'Tamaño no calculado: esta carpeta tiene demasiadas subcarpetas';
      return;
    }
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
          .catch((error) => {
            if (nav === S.navId) sec.querySelectorAll(`[data-dirsize="${CSS.escape(p)}"]`).forEach((cell) => {
              cell.textContent = 'Sin calcular';
              cell.title = error.message || 'No se pudo leer el contenido completo de esta carpeta';
            });
          })
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
  let searchTimer = 0, searchGeneration=0, searchController;

  function toggleSearch(on) {
    if(on!==false)S.catalogMark='';
    const next = on !== undefined ? on : !S.searchMode;
    if (next === S.searchMode) return;
    S.searchMode = next;
    el('fm-search-btn').classList.toggle('active', next);
    el('fm-search-btn').setAttribute('aria-pressed', String(next));
    const inp = el('fm-filter');
    if (next) {
      S.searchQ = '';
      S.searchResults = null;
      inp.value = '';
      inp.placeholder = 'Buscar en subcarpetas — mín. 2 letras';
      inp.focus();
    } else {
      S.searchResults = null;
      // Restore whatever local filter was active before searching — the
      // input would otherwise keep the stale search text while S.filter
      // still holds the old value.
      inp.value = S.filter || '';
      inp.placeholder = 'Buscar o filtrar…';
    }
    render();
  }
  const exitSearch = () => toggleSearch(false);

  function scheduleSearch() {
    clearTimeout(searchTimer);searchGeneration++;searchController?.abort();
    const q = S.searchQ.trim();
    if (q.length < 2) {
      S.searchResults = null;
      render();
      return;
    }
    S.searchPending=true;S.searchResults=null;render();
    searchTimer = setTimeout(runSearch, 350);
  }

  async function runSearch() {
    const q = S.searchQ.trim();
    if (q.length < 2 || !S.searchMode) return;
    const nav=S.navId,generation=searchGeneration;searchController?.abort();searchController=new AbortController();
    try {
      const data = await api(
        `/api/files/search?path=${encodeURIComponent(S.cwd)}&q=${encodeURIComponent(q)}`,
        { signal: AbortSignal.any([searchController.signal,AbortSignal.timeout(30_000)]) }
      );
      if (!S.searchMode || nav !== S.navId || generation!==searchGeneration || q!==S.searchQ.trim()) return;
      const annotated=AxonFileCatalog.entries().filter(r=>r.available&&(r.path===S.cwd||r.path.startsWith(S.cwd+'/'))&&AxonFileCatalog.matches(r.path,{query:q},r.kind)).map(r=>({path:r.path,type:r.kind,name:r.path.split('/').pop(),dir:parentOf(r.path)}));
      S.searchResults = [...new Map([...(data.results||[]),...annotated].map(r=>[r.path,r])).values()].sort((a,b)=>(a.type==='dir'?0:1)-(b.type==='dir'?0:1)||a.name.localeCompare(b.name,'es'));
      S.searchPending=false;
      render();
      if (data.truncated) toast('Muchos resultados — afiná la búsqueda', 'warn', '', 2500);
    } catch (err) {
      if (S.searchMode&&generation===searchGeneration&&nav===S.navId&&!searchController.signal.aborted){S.searchPending=false;render();setState('No se pudo buscar. Volvé a escribir para reintentar.');errToast(err);}
    }
  }

  function renderSearch() {
    el('fm-table-wrap').classList.remove('hidden');
    el('fm-grid').classList.add('hidden');
    el('fm-cols').classList.add('hidden');
    const res = (S.searchResults || []).filter(r=>(S.showHidden||!r.path.slice(S.cwd.length).split('/').some(n=>n.startsWith('.')))&&AxonFileCatalog.matches(r.path,{color:S.catalogColor,tag:S.catalogTag,kind:S.catalogKind},r.type));
    el('fm-tbody').innerHTML = res
      .map((r) => {
        const rel = r.dir === S.cwd ? '.' : r.dir.startsWith(S.cwd + '/') ? r.dir.slice(S.cwd.length + 1) : r.dir;
        return `<tr class="fm-row fm-search-hit" data-dir="${esc(r.dir)}" data-name="${esc(r.name)}" data-type="${esc(r.type)}"${AxonFileCatalog.attr(r.path)}>
          <td class="fm-selcell"></td>
          <td class="icon-cell">${icon(iconFor(r))}</td>
          <td class="fm-name">${esc(r.name)}${AxonFileCatalog.badges(r.path)} <span class="fm-search-dir">${esc(rel)}</span></td>
          <td class="num"></td><td class="fm-mtime"></td><td></td>
          <td class="fm-actcell"><div class="fm-acts">
            ${r.type !== 'dir' ? `<button class="fm-act" data-act="download" aria-label="Descargar ${esc(r.name)}" title="Descargar">${icon('download')}</button>` : ''}
            <button class="fm-act" data-act="goto" aria-label="Ir a la carpeta de ${esc(r.name)}" title="Ir a la carpeta">${icon('folder-open')}</button>
            <button class="fm-act" data-act="more" aria-haspopup="menu" aria-label="Más acciones para ${esc(r.name)}" title="Más acciones">${icon('more-horizontal')}</button>
          </div></td>
        </tr>`;
      })
      .join('');
    setState(res.length?'':S.catalogMark?'Todavía no hay elementos con este filtro. Usá Organizar en un archivo o carpeta para marcarlos.':S.searchQ.trim().length<2?'Escribí al menos 2 letras':S.searchPending?'Buscando…':'Sin resultados');
    updateStatusbar();
  }

  // ---------- View dispatcher ----------
  function render() {
    if (S.preview) syncPreviewNavigation();
    if(S.catalogMark){
      const everything = S.catalogMark === '*';
      const organized = (m) => m.color || m.tags.length || Object.keys(AxonFileCatalog.marks).some((k) => m[k]);
      S.searchResults=AxonFileCatalog.entries().filter(r=>r.available&&(!everything||organized(r.metadata))&&AxonFileCatalog.matches(r.path,{mark:everything?'':S.catalogMark,query:S.filter},r.kind)).map(r=>({path:r.path,type:r.kind,name:r.path.split('/').pop(),dir:parentOf(r.path)}));
      renderSearch();refreshIcons(sec);return;
    }
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
    sec.querySelectorAll('.fm-vbtn[data-view]').forEach((b) =>
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

  // Huge folders paint in pages — innerHTML of 10k rows froze the tab.
  const moreHtml = (hidden) =>
    `<tr class="fm-more"><td colspan="7"><button type="button" class="btn-secondary fm-more-btn">Mostrar ${Math.min(RENDER_PAGE, hidden)} más — quedan ${hidden}</button></td></tr>`;
  const moreCard = (hidden) =>
    `<div class="fm-card fm-more"><button type="button" class="btn-secondary fm-more-btn">Mostrar ${Math.min(RENDER_PAGE, hidden)} más — quedan ${hidden}</button></div>`;

  function renderList() {
    const rows = visibleEntries();
    let html = '';
    // ".." stays client-side per spec; hidden when the parent would be "/"
    if (parentOf(S.cwd) !== '/') {
      html += rowHtml({ name: '..', type: 'dir', size: null, mtime: 0, mode: '' }, true);
    }
    html += rows.slice(0, S.renderLimit).map((e) => rowHtml(e, false)).join('');
    if (rows.length > S.renderLimit) html += moreHtml(rows.length - S.renderLimit);
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
    else if (e.type === 'file' && (IMG_EXT.has(ext) || EXOTIC_EXT.has(ext))) {
      // ?w=160 — the server returns a magick thumbnail instead of the
      // original file; grid cells are 56px so the full image was pure waste.
      inner = `<img class="fm-thumb" loading="lazy" draggable="false" alt="" src="/api/files/preview?path=${encodeURIComponent(join(S.cwd, e.name))}&w=${S.tile === 'large' || S.tile === 'xl' ? 360 : 160}"><span class="fm-thumb-fb">${icon(iconFor(e))}</span>`;
    } else if (e.type === 'file' && libThumb(join(S.cwd, e.name))) {
      inner = `<img class="fm-thumb" loading="lazy" draggable="false" alt="" src="${libThumb(join(S.cwd, e.name))}"><span class="fm-thumb-fb">${icon(iconFor(e))}</span>`;
    } else inner = `<span class="fm-card-ic-big">${icon(iconFor(e))}</span>`;
    const meta = isUp ? '' : e.type === 'dir' ? 'Carpeta' : fmtSize(e.size);
    return `<div class="fm-card${sel ? ' fm-selected' : ''}${hidden ? ' fm-hidden' : ''}${cut ? ' fm-cut' : ''}${isUp ? ' fm-up' : ''}" data-name="${esc(e.name)}" data-type="${esc(e.type)}" title="${esc(e.trashOrig || e.name)}"${isUp?'':AxonFileCatalog.attr(join(S.cwd,e.name))}${isUp ? '' : ' draggable="true"'}>
      <div class="fm-card-ic">${inner}</div>
      <div class="fm-card-name">${esc(dispName(e))}${isUp?'':AxonFileCatalog.badges(join(S.cwd,e.name))}</div>
      <div class="fm-card-meta">${meta}</div>
    </div>`;
  }

  function renderGrid() {
    const rows = visibleEntries();
    let html = '';
    if (parentOf(S.cwd) !== '/') {
      html += gridCard({ name: '..', type: 'dir' }, true);
    }
    html += rows.slice(0, S.renderLimit).map((e) => gridCard(e, false)).join('');
    if (rows.length > S.renderLimit) html += moreCard(rows.length - S.renderLimit);
    el('fm-grid').innerHTML = html;
    setState(rows.length || html ? '' : 'Carpeta vacía');
    markCursor();
  }

  // ---------- Column (Miller / Finder) view ----------
  function colHtml(col, i) {
    if (col.loading) {
      return `<div class="fm-col" data-col="${i}"><div class="fm-col-state">Cargando…</div></div>`;
    }
    if (col.error) {
      return `<div class="fm-col" data-col="${i}"><div class="fm-col-state fm-col-err">${esc(col.error)}</div></div>`;
    }
    const q = S.filter.trim().toLowerCase();
    const rows = col.entries.filter(
      (e) => (S.showHidden || !e.name.startsWith('.')) && AxonFileCatalog.matches(join(col.path,e.name),{query:q,color:S.catalogColor,tag:S.catalogTag,kind:S.catalogKind},e.type==='dir'?'dir':'file')
    );
    let html = '';
    html += rows
      .map((e) => {
        const sel = col.sel.has(e.name);
        const hidden = e.name.startsWith('.');
        const cut = S.clip && S.clip.mode === 'cut' && S.clip.dir === col.path && S.clip.names.includes(e.name);
        return `<div class="fm-col-row${sel ? ' fm-selected' : ''}${hidden ? ' fm-hidden' : ''}${cut ? ' fm-cut' : ''}" data-col="${i}" data-name="${esc(e.name)}" data-type="${esc(e.type)}"${AxonFileCatalog.attr(join(col.path,e.name))} title="${esc(e.trashOrig || e.name)}" draggable="true">
          ${icon(iconFor(e))}<span class="fm-col-name">${esc(dispName(e))}${AxonFileCatalog.badges(join(col.path,e.name))}</span>${e.type === 'dir' ? icon('chevron-right', 'fm-col-chev') : ''}
        </div>`;
      })
      .join('');
    return `<div class="fm-col${i === S.cols.length - 1 ? ' fm-col-last' : ''}" data-col="${i}">${html || '<div class="fm-col-state">Carpeta vacía</div>'}</div>`;
  }

  const lastCol = () => { const all = el('fm-cols').querySelectorAll('.fm-col'); return all[all.length - 1] || null; };

  function renderCols() {
    setState('');
    const c = el('fm-cols');
    c.innerHTML = S.cols.map((col, i) => colHtml(col, i)).join('') + '<div class="fm-col-fill" aria-hidden="true"><span>Elegí una carpeta o un archivo</span></div>';
    refreshIcons(c);
    // Keep the deepest column in view.
    requestAnimationFrame(() => {
      if(window.AxonNavigation?.applying)return;
      const last = lastCol();
      if (last) last.scrollIntoView({ inline: 'end', block: 'nearest' });
      const selRow = c.querySelector('.fm-col.fm-col-last .fm-col-row.fm-selected');
      if (selRow) selRow.scrollIntoView({ block: 'nearest' });
    });
  }

  // Push a directory column onto the stack and fetch its entries.
  async function drill(path, fromRoute = false) {
    await AxonFileCatalog.load().catch(()=>toast('No se pudo cargar la organización. Usá Actualizar para reintentar.','warn'));syncCatalogControls();
    if (window.AxonNavigation?.ready && !window.AxonNavigation.applying && !fromRoute) {
      const snapshot = captureFiles();
      snapshot.cols = [...snapshot.cols, { path, sel: [], top: 0 }];
      snapshot.scroll['fm-cols'][0]=Number.MAX_SAFE_INTEGER;
      return window.AxonNavigation.go(window.AxonNavigation.url('files', { ...fileParams(), path, item: null, edit: null }), { view: snapshot });
    }
    const col = { path, entries: [], sel: new Set(), loading: true, error: null };
    S.cols.push(col);
    renderCols();
    try {
      const data = await api(`/api/files?path=${encodeURIComponent(path)}`, {
        signal: AbortSignal.timeout(25_000),
      });
      if(!S.cols.includes(col))return;
      S.volume=data.volume;
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
      if(window.AxonNavigation?.ready && !window.AxonNavigation.applying){const snap=captureFiles();snap.cols=snap.cols.slice(0,i);const target=snap.cols.at(-1)?.path || parentOf(col.path);void window.AxonNavigation.go(window.AxonNavigation.url('files',{...fileParams(),path:target,item:null,edit:null}),{view:snap});return;}
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
    if (S.searchMode||S.catalogMark) {
      const n = S.searchResults?.length;
      bar.innerHTML = S.searchResults === null ? 'Buscando…' : `${n} resultado${n === 1 ? '' : 's'} — Enter abre, Esc sale`;
      return;
    }
    const total = S.entries.length;
    const dirs = S.entries.filter((e) => e.type === 'dir').length;
    const hid = hiddenCount();
    let txt = `${total} elemento${total === 1 ? '' : 's'}`;
    if (dirs) txt += ` · ${dirs} carpeta${dirs === 1 ? '' : 's'}`;
    if (dirs > 120) txt += ' · tamaños de carpetas sin calcular (demasiadas subcarpetas)';
    if (total > S.renderLimit) txt += ` · mostrando ${S.renderLimit}`;
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
    bar.innerHTML = `<span class="fm-status-text">${txt}</span>${S.df?`<span class="fm-df">${fmtSize(S.df.avail)} libres</span>`:''}`;
  }

  // ---------- Navigation ----------
  async function navigate(p, fromRoute = false) {
    const nav = window.AxonNavigation;
    if (nav?.ready && !nav.applying && !fromRoute) {
      const target = p || S.cwd || '~';
      const prior = fileLocations[target] || (target===S.cwd ? captureFiles() : undefined);
      return nav.go(nav.url('files', { ...fileParams(), path: target, item: null, edit: null, ...(target!==S.cwd?{search:null,q:S.filter || null}:{}) }), { view: prior });
    }
    S.catalogMark='';syncCatalogControls();
    S.navId++;
    void refreshVolumes();
    const request = S.navId;
    if (S.searchMode) toggleSearch(false);
    S.anchor = null;
    S.cursor = null;
    showList();
    if (S.view === 'cols') {
      S.cols = [];
      setState('');
      render(); // syncs container visibility before the first drill lands
      await drill(p ?? S.cwd ?? '', true);
      return;
    }
    S.sel.clear();
    setState('Cargando…');
    try {
      const q = p ? `?path=${encodeURIComponent(p)}` : '';
      const data = await api(`/api/files${q}`, { signal: AbortSignal.timeout(25_000) });
      if (request !== S.navId) return;
      S.cwd = data.path;
      S.volume=data.volume;
      S.renderLimit = RENDER_PAGE;
      if (!S.home && data.home) S.home = data.home;
      if (inTrash(data.path)) await loadTrashNames(data.path);
      await AxonFileCatalog.load(true).catch(()=>toast('No se pudo cargar la organización. Usá Actualizar para reintentar.','warn'));if(request!==S.navId)return;syncCatalogControls();
      S.entries = trashify(data.entries || [], data.path);
      renderCrumbs();
      render();
      refreshDf();
    } catch (err) {
      S.entries=[];S.sel.clear();render();
      setState('No se pudo cargar el directorio');
      errToast(err);
    }
  }

  function loadFiles() {
    if (window.AxonNavigation) return;
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

  let signedIn = false;
  document.addEventListener('axon:authenticated', () => { signedIn = true; });
  document.addEventListener('axon:session-expired', () => { signedIn = false; });

  let lastVolSync = 0;
  async function silentRefresh() {
    if (!signedIn || !sec.classList.contains('active') || dormant() || document.hidden || S.editingPath || !S.cwd) return;
    // The volume snapshot spawns a full disk inventory on the host — once a
    // minute is plenty for a passive poll (navigation refreshes on its own).
    if (Date.now() - lastVolSync > 60_000) { lastVolSync = Date.now(); void refreshVolumes(); }
    try {
      const data = await api(`/api/files?path=${encodeURIComponent(S.cwd)}`, {
        signal: AbortSignal.timeout(20_000),
      });
      await AxonFileCatalog.load().catch(()=>{});
      const list = data.entries || [];
      // Column view keeps ancestor listings on screen; refresh them too or
      // external changes stay invisible until the next drill.
      if (S.view === 'cols') {
        for (const c of S.cols) {
          if (c.path === S.cwd) continue;
          api(`/api/files?path=${encodeURIComponent(c.path)}`, { signal: AbortSignal.timeout(20_000) })
            .then((d) => {
              const next = trashify(d.entries || [], c.path);
              if (entriesSig(next) === entriesSig(c.entries)) return;
              c.entries = next;
              renderCols();
            })
            .catch(() => {});
        }
      }
      if (entriesSig(list) === entriesSig(S.entries)) return;
      if (inTrash(S.cwd)) await loadTrashNames(S.cwd);
      const names = new Set(list.map((e) => e.name));
      for (const n of [...S.sel]) if (!names.has(n)) S.sel.delete(n);
      S.entries = trashify(list, S.cwd);
      const col = S.cols.find((c) => c.path === S.cwd);
      if (col) col.entries = S.entries;
      render();
      updateSelbar();
    } catch(err) {
      if(err.status===404 || err.status===403 || err.status===409){S.entries=[];S.sel.clear();render();setState(err.message);}
    }
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
  let documentPreview = null;
  let previewGeneration = 0;
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

  function openPreview(name, fromRoute = false) {
    const nav = window.AxonNavigation;
    if (nav?.ready && !nav.applying && !fromRoute && (nav.current.params.item !== name || nav.current.params.edit)) {
      void nav.go(nav.url('files', { ...fileParams(), item: name, edit: null }), { view: captureFiles(), transient: true });
      return;
    }
    const entry = S.entries.find((e) => e.name === name);
    const p = join(S.cwd, name);
    const kind = kindFor(name);
    documentPreview?.destroy(); documentPreview = null;
    const generation = ++previewGeneration;
    S.preview = { path: p, name, kind };
    syncPreviewNavigation();
    window.AxonRecent?.add({section:'files',name,path:p,url:window.AxonNavigation.url('files',{...fileParams(),item:name,edit:null})});
    el('fm-preview').classList.remove('hidden');
    el('fm-resize').classList.remove('hidden');
    el('fm-prev-name').textContent = name;
    el('fm-prev-name').title = p;
    el('fm-prev-ic').innerHTML = icon(iconFor({ name, type: 'file' }));
    el('fm-prev-meta').textContent = entry
      ? `${fmtSize(entry.size)} · ${fmtDate(entry.mtime)}${entry.mode ? ' · ' + entry.mode : ''}`
      : '';
    el('fm-prev-edit').classList.toggle('hidden', kind !== 'text' && !window.AxonDocumentViewer?.isMarkdown(name));
    // Library tools: share any file, optimize media, open the rich viewer for what it supports.
    const L = window.AxonLibrary;
    el('fm-prev-share').classList.toggle('hidden', !L || inTrash(S.cwd));
    el('fm-prev-tools').classList.toggle('hidden', !L?.canTool(p));
    el('fm-prev-viewer').classList.toggle('hidden', !L || !LIB_VIEW_KINDS.has(L.kindOf(p)));

    const body = el('fm-prev-body');
    body.innerHTML = '<div class="fm-pv-loading">Cargando…</div>';
    const stale = () => previewGeneration !== generation || S.preview?.path !== p; // user already clicked another file

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
    } else if (kind === 'document') {
      documentPreview = window.AxonDocumentViewer.mount(body, {
        name, path: p, sourceUrl: previewUrl(p), textUrl: '/api/files/read?path=' + encodeURIComponent(p), documentUrl: '/api/files/document?path=' + encodeURIComponent(p),
        downloadUrl: '/api/files/download?path=' + encodeURIComponent(p),
      });
    } else if (kind === 'text') {
      api(`/api/files/read?path=${encodeURIComponent(p)}`, { signal: AbortSignal.timeout(20_000) })
        .then((data) => {
          if (stale()) return;
          if (data.binary || String(data.content || '').includes('\u0000')) {
            renderPrevFallback('Archivo binario — sin vista de texto');
            return;
          }
          const pre = document.createElement('pre');
          pre.className = 'fm-pv-text mono';
          pre.textContent = data.content || '';
          body.replaceChildren(pre);
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

  function closePreview(fromRoute = false) {
    if (!fromRoute && window.AxonNavigation?.ready && !window.AxonNavigation.applying && window.AxonNavigation.current.params.item && !S.editingPath) {
      window.AxonNavigation.close({ ...fileParams(), item: null, edit: null }); return;
    }
    if (!S.preview) return;
    S.preview = null; previewGeneration++;
    documentPreview?.destroy(); documentPreview = null;
    // innerHTML reset also stops any playing audio/video.
    el('fm-prev-body').innerHTML = '';
    el('fm-preview').classList.add('hidden');
    el('fm-resize').classList.add('hidden');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  el('fm-prev-close').addEventListener('click', closePreview);
  el('fm-prev-share').addEventListener('click', () => { if (S.preview) window.AxonLibrary?.share([S.preview.path]); });
  el('fm-prev-tools').addEventListener('click', () => { if (S.preview) window.AxonLibrary?.tools([S.preview.path]); });
  el('fm-prev-viewer').addEventListener('click', () => { if (S.preview) window.AxonLibrary?.view([S.preview.path]); });
  el('fm-prev-dl').addEventListener('click', () => {
    if (S.preview) download(S.preview.path, S.preview.name);
  });
  el('fm-prev-ext').addEventListener('click', () => {
    if (S.preview) window.open(S.preview.kind === 'document' ? window.AxonNavigation.url('files', { ...fileParams(), edit: null }) : previewUrl(S.preview.path), '_blank', 'noopener');
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

  function previewQueue() {
    return visibleEntries().filter(entry => entry.type !== 'dir').map(entry => entry.name);
  }
  function syncPreviewNavigation() {
    const queue = previewQueue(), index = queue.indexOf(S.preview?.name);
    el('fm-prev-previous').disabled = index <= 0;
    el('fm-prev-next').disabled = index < 0 || index >= queue.length - 1;
    el('fm-prev-position').textContent = index < 0 ? '' : `${index + 1} / ${queue.length}`;
  }
  function stepPreview(delta) {
    const queue = previewQueue(), index = queue.indexOf(S.preview?.name);
    if (index >= 0 && queue[index + delta]) openPreview(queue[index + delta]);
  }
  el('fm-prev-previous').onclick = () => stepPreview(-1);
  el('fm-prev-next').onclick = () => stepPreview(1);
  document.addEventListener('keydown', (e) => {
    if (!S.preview || !sec.classList.contains('active') || S.editingPath || e.target.closest('.axon-doc')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (document.querySelector('.modal:not(.hidden), dialog[open], :popover-open')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'video', 'audio', 'select', 'iframe'].includes(tag)) return;
    e.preventDefault();
    stepPreview(e.key === 'ArrowLeft' ? -1 : 1);
  });

  // ---------- Editor ----------
  let editorPreview = null;
  let editorTruncated = false, editorBinary = false;
  let documentMode = 'edit';
  const markdownFile = p => window.AxonDocumentViewer?.isMarkdown(p);
  function setDocumentMode(mode, updateRoute = true, focus = true) {
    const markdown = markdownFile(S.editingPath);
    documentMode = markdown && mode === 'read' ? 'read' : 'edit';
    const reading = documentMode === 'read';
    el('fm-document-modes').classList.toggle('hidden', !markdown);
    for (const [id, selected] of [['fm-document-read', reading], ['fm-document-edit', !reading]]) {
      el(id).classList.toggle('active', selected); el(id).setAttribute('aria-pressed', String(selected));
    }
    el('fm-editor-text').classList.toggle('hidden', reading);
    el('fm-editor-preview').classList.toggle('hidden', !reading);
    editorPreview?.destroy(); editorPreview = null;
    if (reading) {
      editorPreview = window.AxonDocumentViewer.mount(el('fm-editor-preview'), {
        name: S.editingPath.split('/').pop(), path: S.editingPath,
        content: el('fm-editor-text').value, truncated: editorTruncated, binary: editorBinary,
        note: isDirty() ? 'Vista de tus cambios sin guardar' : 'Vista de lectura',
        downloadUrl: '/api/files/download?path=' + encodeURIComponent(S.editingPath),
      });
      if (focus) el('fm-editor-preview').querySelector('.axon-doc').focus();
    } else if (focus) el('fm-editor-text').focus();
    el('fm-editor-help').textContent = markdown
      ? 'Visualizador ↔ Editor: Ctrl/Cmd+E · Ctrl/Cmd+S guarda · Esc vuelve a la lista'
      : 'Ctrl/Cmd+S guarda · Tab indenta (Shift+Tab quita) · Esc vuelve a la lista';
    if (updateRoute) window.AxonNavigation?.update('files', fileParams());
  }
  el('fm-document-read').addEventListener('click', () => setDocumentMode('read'));
  el('fm-document-edit').addEventListener('click', () => setDocumentMode('edit'));
  document.addEventListener('keydown', e => {
    if (!sec.classList.contains('active') || !S.editingPath || document.querySelector('.modal:not(.hidden)')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e' && markdownFile(S.editingPath)) {
      e.preventDefault(); setDocumentMode(documentMode === 'read' ? 'edit' : 'read');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && documentMode === 'read') {
      e.preventDefault(); el('fm-save-btn').click();
    }
  });
  async function openEditor(p, fromRoute = false, mode = 'edit') {
    const nav = window.AxonNavigation;
    if (nav?.ready && !nav.applying && !fromRoute) {
      return nav.go(nav.url('files', { ...fileParams(), path: parentOf(p), item: p.split('/').pop(), edit: mode === 'read' ? null : '1' }), { view: captureFiles(), transient: true });
    }
    const routeParams=nav?.current?.params;
    try {
      const data = await api(`/api/files/read?path=${encodeURIComponent(p)}`);
      if(nav?.ready && (nav.current.section!=='files' || nav.current.params!==routeParams)) return;
      window.AxonRecent?.add({section:'files',name:p.split('/').pop(),path:p,url:nav.url('files',{...fileParams(),path:parentOf(p),item:p.split('/').pop(),edit:'1'})});
      S.editingPath = data.path;
      S.editRevision=data.revision;
      const binary = data.binary || String(data.content || '').includes('\u0000');
      editorTruncated = Boolean(data.truncated); editorBinary = Boolean(binary);
      S.readOnly = Boolean(data.truncated) || binary;

      el('fm-editor-name').textContent = data.path;
      el('fm-editor-text').value = data.content || '';
      S.lineEnding = /\r\n/.test(data.content || '') ? '\r\n' : '\n';
      S.originalContent = el('fm-editor-text').value;
      el('fm-editor-text').readOnly = S.readOnly;
      el('fm-save-btn').disabled = S.readOnly;
      updateDirty();

      const flag = el('fm-editor-flag');
      if (data.truncated) {
        flag.textContent = 'Truncado (>512KB) — solo lectura';
        flag.classList.remove('hidden');
      } else if (binary) {
        flag.textContent = 'Binario o codificación distinta de UTF-8 — solo lectura';
        flag.classList.remove('hidden');
      } else {
        flag.classList.add('hidden');
      }

      el('fm-main').classList.add('hidden');
      el('fm-editor').classList.remove('hidden');
      setDocumentMode(binary ? 'edit' : mode, false);
    } catch (err) {
      errToast(err);
    }
  }

  function closeEditor(refresh) {
    if (window.AxonNavigation?.ready && !window.AxonNavigation.applying && window.AxonNavigation.current.params.item) {
      window.AxonNavigation.close({ ...fileParams(), item: null, edit: null }); return;
    }
    S.editingPath = null;
    editorPreview?.destroy(); editorPreview = null;
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
      S.originalContent = el('fm-editor-text').value;
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
    const savedPath = S.editingPath;
    const bytes = S.lineEnding === '\r\n' ? content.replace(/\r?\n/g, '\r\n') : content;
    try {
      const result=await api('/api/files/write', {
        method: 'POST',
        body: { path: savedPath, content: bytes,revision:S.editRevision },
      });
      if (S.editingPath === savedPath) { S.editRevision=result.revision;S.originalContent = content; updateDirty(); if(documentMode === 'read') setDocumentMode('read', false, false); }
      toast(`Guardado: ${savedPath.split('/').pop()}`, 'ok', '', 3000);
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
    if (document.querySelector('.fm-diff-modal')) return;
    const rows = diffLines(S.originalContent, newVal) || diffFallback(S.originalContent, newVal);
    const adds = rows.reduce((k, r) => k + (r.t === 'add' ? 1 : 0), 0);
    const dels = rows.reduce((k, r) => k + (r.t === 'del' ? 1 : 0), 0);
    const modal = document.createElement('div');
    modal.className = 'modal fm-diff-modal';
    modal.innerHTML = `
      <div class="modal-content fm-diff-content">
        <h3>Revisar cambios antes de guardar</h3>
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
      return;
    }
    // Tab indents instead of leaving the field (editor semantics); Shift+Tab
    // outdents. With a multi-line selection every covered line moves.
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const ta = e.target;
      if (ta.readOnly) return;
      const v = ta.value;
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      if (s === en && !e.shiftKey) {
        ta.setRangeText('\t', s, en, 'end');
        updateDirty();
        return;
      }
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      // A selection ending on a newline boundary shouldn't tag the next line.
      const le = en > s && v[en - 1] === '\n' ? en - 1 : en;
      const block = v.slice(ls, le);
      const next = !e.shiftKey
        ? block.split('\n').map((l) => '\t' + l).join('\n')
        : block.split('\n').map((l) => (l.startsWith('\t') ? l.slice(1) : l.replace(/^ {1,2}/, ''))).join('\n');
      ta.setRangeText(next, ls, le, 'select');
      updateDirty();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (dormant() || document.querySelector('dialog[open], :popover-open')) return;
    if (e.key !== 'Escape' && e.target.closest('.axon-doc')) return;
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

  // Folder or multi-name selection → server streams a zip built on the fly.
  function downloadZip(dirOrPath, names) {
    const href = names?.length
      ? `/api/files/download-zip?dir=${encodeURIComponent(dirOrPath)}&items=${encodeURIComponent(JSON.stringify(names))}`
      : `/api/files/download-zip?path=${encodeURIComponent(dirOrPath)}`;
    if (href.length > 7000) {
      toast('Demasiados elementos para el enlace — usá Comprimir para generar el .zip', 'warn');
      return;
    }
    const a = document.createElement('a');
    a.href = href;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function doAction(act, name, type, dir) {
    const base = dir || S.cwd;
    const p = join(base, name);
    if (act === 'download') {
      download(p, name);
    } else if (act === 'zipdl') {
      downloadZip(p);
    } else if (act === 'share') {
      window.AxonLibrary?.share([p]);
    } else if (act === 'organize') { AxonFileCatalog.edit([p]);
    } else if (act === 'rename') {
      const nn = await fmPrompt('Renombrar', `Nuevo nombre para «${name}»`, name, true);
      if (!nn || nn === name) return;
      if (nn.includes('/') || nn === '.' || nn === '..') {
        toast('Nombre inválido — sin "/", "." ni ".."', 'error');
        return;
      }
      const to = join(base, nn);
      try {
        await apiRename(p, to);
        journaled({
          label: `Renombrar ${name}`,
          undo: async () => { await apiRename(to, p); },
          redo: async () => { await apiRename(p, to); },
        });
        toast('Renombrado — Ctrl+Z deshace', 'ok', '', 2500);
        navigate(base);
      } catch (err) {
        errToast(err);
      }
    } else if (act === 'delete') {
      await deleteTargets([name], base);
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
    const chosen = [...S.sel].map((name) => S.entries.find((e) => e.name === name)).filter(Boolean);
    const bytes = chosen.filter((e) => e.type !== 'dir').reduce((a, e) => a + (e.size || 0), 0);
    el('fm-sel-size').textContent = bytes ? fmtSize(bytes) : '';
    const trash = inTrash(S.cwd);
    const files = chosen.filter((e) => e.type !== 'dir');
    // Sharing and the media tools are library features: files only, never inside the trash.
    el('fm-sel-share').classList.toggle('hidden', trash || !window.AxonLibrary || !files.length);
    for (const id of ['fm-sel-copy', 'fm-sel-move', 'fm-sel-organize', 'fm-sel-dl']) el(id).classList.toggle('hidden', trash);
    el('fm-sel-del').title = trash ? 'Borrado definitivo — no se puede deshacer' : 'Enviar a la papelera (Supr)';
    el('fm-sel-del').querySelector('span').textContent = trash ? 'Borrar' : 'Eliminar';
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
    const scope = S.searchMode ? el('fm-tbody') : S.view === 'grid' ? el('fm-grid') : S.view === 'cols' ? lastCol() : el('fm-tbody');
    const rows = Array.from(scope?.querySelectorAll('[data-name]') || []);
    const current = S.cursor || rows[0]?.dataset.name;
    rows.forEach((row) => {
      row.tabIndex = row.dataset.name === current ? 0 : -1;
      row.setAttribute('aria-selected', String(S.sel.has(row.dataset.name)));
      if(S.view!=='list')row.setAttribute('role','option');
    });
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
    if (e.target.closest('.fm-more-btn')) {
      S.renderLimit += RENDER_PAGE;
      render();
      return;
    }
    const tr = e.target.closest('tr.fm-row');
    const actBtn = e.target.closest('.fm-act');
    if (actBtn && tr) {
      e.stopPropagation();
      if (actBtn.dataset.act === 'more') {
        const r = actBtn.getBoundingClientRect();
        showEntryMenu({ clientX: r.right - 8, clientY: r.bottom + 4 }, tr);
        return;
      }
      // Search hits live in another directory — act on tr.dataset.dir.
      if (tr.classList.contains('fm-search-hit')) {
        const dir = tr.dataset.dir;
        if(actBtn.dataset.act==='organize')AxonFileCatalog.edit([join(dir,tr.dataset.name)]);
        else if (actBtn.dataset.act === 'download') download(join(dir, tr.dataset.name), tr.dataset.name);
        else if (actBtn.dataset.act === 'goto') {
          const name = tr.dataset.name;
          exitSearch();
          navigate(dir).then((ok) => { if (ok !== false) selectName(name); });
        }
        return;
      }
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
      navigate(dir).then((ok) => { if (ok !== false) selectName(name); });
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
    S.cursor = name;
    if (opensOnClick()) { if (S.sel.size) clearSel(); openEntry(name, type); } else selectOnly(name, type);
  });
  el('fm-table').addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr.fm-row');
    if (!tr || e.target.closest('.fm-act, .fm-check') || tr.classList.contains('fm-search-hit') || tr.dataset.name === '..' || opensOnClick()) return;
    openEntry(tr.dataset.name, tr.dataset.type);
  });

  // Shared "activate an entry" logic for the list and grid views.
  // Media that already lives in the library opens in its full viewer; everything else keeps the
  // inline preview pane. Text and code go straight to the editor.
  function openEntry(name, type) {
    if (type === 'dir') return navigate(join(S.cwd, name));
    const p = join(S.cwd, name);
    if (markdownFile(name)) return openEditor(p, false, 'read');
    const L = window.AxonLibrary;
    if (L && ['image', 'raw', 'video', 'audio', 'pdf', 'vector', 'design'].includes(L.kindOf(p)) && L.peek(p)) return L.view([p]);
    if (kindFor(name) === 'text') openEditor(p);
    else openPreview(name);
  }
  async function openEntryAt(base, name, type) {
    if (base !== S.cwd) {
      if (S.searchMode) exitSearch();
      if (await navigate(base) === false) return;
    }
    openEntry(name, type);
  }

  // One click selects (Explorer); a double click, Enter or a tap on touch screens opens.
  const coarse = matchMedia('(pointer: coarse)');
  const opensOnClick = () => coarse.matches || localStorage.getItem('fm-click') === 'single';
  // Plain click on a row/card: select it alone and keep an open preview in step with the selection.
  function selectOnly(name, type) {
    S.cursor = name;
    S.anchor = name;
    S.sel = new Set([name]);
    applySelToDom();
    if (S.preview && type !== 'dir') openPreview(name);
  }

  el('fm-grid').addEventListener('click', (e) => {
    if (e.target.closest('.fm-more-btn')) {
      S.renderLimit += RENDER_PAGE;
      render();
      return;
    }
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
    S.cursor = name;
    if (opensOnClick()) { if (S.sel.size) clearSel(); openEntry(name, type); } else selectOnly(name, type);
  });
  el('fm-grid').addEventListener('dblclick', (e) => {
    const card = e.target.closest('.fm-card');
    if (!card || card.dataset.name === '..' || opensOnClick()) return;
    openEntry(card.dataset.name, card.dataset.type);
  });

  el('fm-cols').addEventListener('click', colClick);

  // ---------- Clipboard (Explorer semantics) ----------
  // Ctrl+X marks a "move intent" — items ghost at ~50% until pasted or Esc.
  // Ctrl+C clears any pending cut and copies paths; paste duplicates.
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('axon-fm-clip') : null;

  function setClip(clip) {
    if(clip && !clip.volume)clip.volume=volumeToken(clip.dir);
    S.clip = clip;
    try {
      if (clip) localStorage.setItem('fm-clip', JSON.stringify(clip));
      else localStorage.removeItem('fm-clip');
    } catch { /* quota */ }
    bc?.postMessage({ type: 'clip', clip });
    applySelToDom();
    renderClipboard();
  }

  if (bc) {
    bc.addEventListener('message', (e) => {
      if (e.data?.type === 'clip') {
        S.clip = e.data.clip;
        applySelToDom();
        renderClipboard();
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
    if (S.transferBusy || !S.clip || !S.clip.names.length) return;
    S.transferBusy=true;renderClipboard();
    try {
    const { mode, dir, names } = S.clip;
    const destDir = intoDir || S.cwd;
    if (volumeAt(destDir)?.readOnly) {
      toast('Este volumen es de solo lectura', 'warn', 'Elegí un destino escribible.');
      return;
    }
    const r = await transferItems(names, dir, destDir, mode, S.clip.volume);
    journalTransfer(r, mode, dir, destDir);
    if(mode==='cut'){
      const completed=new Set(r.moved.map(item=>item.from.split('/').pop()));
      const remaining=names.filter(name=>!completed.has(name));
      setClip(remaining.length?{...S.clip,names:remaining}:null);
    }
    if (r.failed.length && !r.errorsPresented) toast(`Error en ${r.failed.length} elemento${r.failed.length === 1 ? '' : 's'}`, 'error', r.failed.slice(0, 5).join('\n'));
    const okN = r.moved.length + r.copied.length;
    if (okN) toast(`${okN} ${mode === 'cut' ? 'movido' : 'copiado'}${okN === 1 ? '' : 's'} — Ctrl+Z deshace`, 'ok', '', 3000);
    if (!okN && r.skipped && !r.failed.length && !r.cancelled) toast('Nada que mover — origen y destino iguales', 'warn', '', 2500);
    navigate(destDir === S.cwd ? S.cwd : destDir);
    } finally {S.transferBusy=false;renderClipboard();}
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
  const inTrash = (dir) => (S.trashDirs || [S.trashDir]).filter(Boolean).some(root => {
    // A '…/files' root also covers its parent (Trash/, .Trash-1000/): files and
    // info are structure, never user content.
    if (root.endsWith('/files')) root = root.slice(0, -6);
    return dir === root || dir.startsWith(root + '/');
  }) || S.volumes.some(v => v.path && v.path !== '/' && /^\/\.Trash(?:-\d+|\/\d+)(?:\/|$)/.test(dir.slice(v.path.replace(/\/$/, '').length)) && dir.startsWith(v.path.replace(/\/$/, '') + '/'));

  // Trashed items live under random ids; the manifest maps them back to the
  // original name/location for a readable listing (ops still use the id).
  async function loadTrashNames(dir) {
    S.trashNames = {};
    try {
      const r = await api('/api/files/trash/info');
      S.trashDirs = r.dirs || [r.dir];
      for (const it of r.items || []) if (it.path.startsWith(dir + '/')) S.trashNames[it.key] = {...it, name:it.name, orig:it.orig};
    } catch (err) { toast('No se pudieron leer los metadatos de papelera', 'error', err.message); }
  }

  const trashify = (entries, dir) => {
    if (!inTrash(dir)) return entries;
    return (entries || [])
      .filter((e) => e.name !== '.manifest.json' && !e.name.startsWith('.axon-') && !e.name.startsWith('.manifest-') && !e.name.startsWith('.metadata-') && !e.name.startsWith('.state-'))
      .map((e) => {
        const meta = S.trashNames[e.name];
        return meta ? { ...e, trashName: meta.name, trashOrig: meta.orig } : e;
      });
  };

  const dispName = (e) => e.trashName || e.name;

  async function apiTrash(paths) {
    const data = await api('/api/files/trash', { method: 'POST', body: { paths } });
    if (data.failed?.length && !data.items?.length) {
      throw Object.assign(new Error(data.failed[0].error || 'No se pudo enviar a la papelera'), { failed: data.failed,raw:data.failed[0] });
    }
    return data;
  }
  const apiRestore = (ids) => api('/api/files/trash/restore', { method: 'POST', body: { ids: ids.map(id => S.trashNames[id]?.id || id) } });
  const apiRename = async (from,to) => {try{return await window.AxonTransfers.run(from,to,'move');}catch(error){if(!error.cancelled){await window.AxonTransfers.showError(error,{mode:'move',from,to});error.presented=true;}throw error;}};
  const apiMkdir = (p) => api('/api/files/mkdir', { method: 'POST', body: { path: p } });


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

  // Delete = move to trash (reversible). Inside the trash zone, delete is a
  // real permanent purge of the selected trash items — one strong confirm,
  // then the durable worker removes each entry with identity verification.
  async function forceDelete(paths, why) {
    const preview = paths.slice(0, 6).map((p) => p.split('/').pop()).join(', ') + (paths.length > 6 ? ` y ${paths.length - 6} más` : '');
    const ok = await confirmDialog(`Borrar definitivamente — ${paths.length} elemento${paths.length === 1 ? '' : 's'}`,
      `${why ? why + ' ' : ''}Se borra sin pasar por la papelera, con permisos de administrador, y no se puede deshacer: ${preview}.`, 'Borrar definitivamente');
    if (!ok) return;
    try {
      const r = await api('/api/files/delete-now', { method: 'POST', body: { paths } });
      if (r.done?.length) toast(`${r.done.length} borrado${r.done.length === 1 ? '' : 's'} definitivamente`, 'ok', '', 3000);
      if (r.failed?.length) toast(`${r.failed.length} no se pudieron borrar`, 'error', r.failed.map((f) => `${f.path.split('/').pop()}: ${f.error}`).join('\n'));
    } catch (err) { errToast(err); }
    navigate(S.cwd);
  }

  async function deleteTargets(names, dir, permanent) {
    if (!names.length) return;
    if (permanent && !inTrash(dir || S.cwd)) return forceDelete(names.map((n) => join(dir || S.cwd, n)));
    const srcDir = dir || S.cwd;
    let paths = names.map((n) => join(srcDir, n));
    const trashRoot = (p) => /\/\.Trash-\d+$|\/\.Trash\/\d+$|\/\.local\/share\/Trash$/.test(p) ? p + '/files' : /\/\.local\/share\/axon-trash$/.test(p) ? p : null;
    if (!inTrash(srcDir)) {
      const roots = paths.map(trashRoot).filter(Boolean);
      if (roots.length) {
        paths = paths.filter((p) => !trashRoot(p));
        const ok = await confirmDialog('Vaciar papelera', 'Una de las carpetas seleccionadas es una papelera: no se borra ella misma, se vacía su contenido definitivamente. Es irreversible.', 'Vaciar papelera');
        if (ok) for (const root of roots) {
          try {
            const r = await api('/api/files/trash/empty', { method: 'POST', body: { root } });
            if (r.operation) trackPurge(r.operation.id, r.operation.total || 0);
            else toast(r.message || 'La papelera ya está vacía', 'ok', '', 3000);
          } catch (err) { errToast(err); }
        }
        if (!paths.length) return;
        names = paths.map((p) => p.slice(srcDir.length).replace(/^\//, ''));
      }
    }
    if (inTrash(srcDir)) {
      await loadTrashNames(srcDir).catch(() => {});
      const known = names.filter((n) => S.trashNames[n]?.id);
      const structural = names.filter((n) => !S.trashNames[n]?.id);
      if (structural.length) toast('Estructura de papelera', 'warn', `${structural.length} elemento${structural.length === 1 ? ' es' : 's son'} parte de la estructura de la papelera (files/, info/, metadatos) y no se borra por separado.`);
      if (!known.length) return;
      const preview = known.slice(0, 6).map((n) => S.trashNames[n].name || n).join(', ') + (known.length > 6 ? ` y ${known.length - 6} más` : '');
      const ok = await confirmDialog(
        `Borrado definitivo — ${known.length} elemento${known.length === 1 ? '' : 's'}`,
        `Es irreversible y no tiene Deshacer: ${preview}. Se verifica la identidad de cada elemento antes de borrarlo y queda un recibo en el historial.`,
        'Borrar definitivamente'
      );
      if (!ok) return;
      try {
        const r = await api('/api/files/trash/purge', { method: 'POST', body: { ids: known.map((n) => S.trashNames[n].id) } });
        if (r.operation) trackPurge(r.operation.id, known.length);
      } catch (err) { errToast(err); }
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
      if (r.failed?.length) {
        const bad = r.failed.map((f) => f.path).filter(Boolean);
        if (bad.length) { navigate(srcDir === S.cwd ? S.cwd : srcDir); return forceDelete(bad, `No se pudo enviar a la papelera (${r.failed[0].error}).`); }
        toast(`${r.failed.length} no se pudieron mover`, 'error', r.failed.map((f) => f.error).join('\n'));
      }
    } catch (err) {
      if (err.failed?.length && err.failed.every((f) => f.path)) { return forceDelete(err.failed.map((f) => f.path), `No se pudo enviar a la papelera (${err.message}).`); }
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
    const root = (S.trashDirs || []).find((r) => S.cwd === r || S.cwd.startsWith(r + '/') || join(S.cwd, 'files') === r);
    if (!root) return toast('No se reconoce esta papelera', 'error', 'Navegá dentro de una papelera conocida para vaciarla.');
    const count = Object.values(S.trashNames).filter((i) => i.path?.startsWith(root + '/')).length;
    const ok = await confirmDialog('Vaciar papelera',
      `Se eliminan definitivamente todos los elementos de esta papelera${count ? ` (${count} actualmente)` : ''}, uno por uno, con identidad verificada y recibo durable. Es irreversible; lo que llegue durante el vaciado se conserva.`,
      'Vaciar papelera');
    if (!ok) return;
    try {
      const r = await api('/api/files/trash/empty', { method: 'POST', body: { root } });
      if (r.operation) trackPurge(r.operation.id, r.operation.total || 0);
      else toast(r.message || 'La papelera ya está vacía', 'ok', '', 3000);
    } catch (err) { errToast(err); }
  }

  // Poll a trash purge operation and report the verified outcome.
  function trackPurge(opId, total) {
    const rec = { label: `Borrado definitivo (${total})`, pct: 0, error: null, done: null, cancel: null };
    rec.done = (async () => {
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        const cur = S.jobs.get(opId);
        if (!cur) return;
        try {
          const { operation, receipts } = await api(`/api/files/trash/operations/${opId}`, { fresh: true });
          const finished = (receipts || []).filter((x) => !['running'].includes(x.state)).length;
          cur.pct = total ? Math.min(99, Math.floor((finished * 100) / total)) : 0;
          renderJobs();
          if (!['running', 'planned'].includes(operation.state)) {
            S.jobs.delete(opId);
            renderJobs();
            const freed = (receipts || []).reduce((a, x) => a + BigInt(x.retiredBytes || '0'), 0n);
            if (operation.state === 'verified')
              toast(`Borrado definitivo verificado: ${total} elemento${total === 1 ? '' : 's'}`, 'ok',
                freed ? `Bloques retirados: ${fmtSize(Number(freed))}. El espacio libre real puede variar por actividad concurrente.` : '', 6000);
            else if (operation.state === 'skipped')
              toast('Borrado parcial', 'warn', operation.receipt?.message || 'Algunos elementos se conservaron para revisar.', 9000);
            else
              toast('El borrado necesita revisión', 'error',
                `${operation.receipt?.message || ''}\nAbrí Almacenamiento → Historial → "Comprobar resultado real".`, 9000);
            if (inTrash(S.cwd)) await loadTrashNames(S.cwd).catch(() => {});
            navigate(S.cwd);
            return;
          }
        } catch (err) {
          S.jobs.delete(opId);
          renderJobs();
          errToast(err);
          return;
        }
      }
    })();
    S.jobs.set(opId, rec);
    renderJobs();
  }

  // ---------- Shared move/copy used by paste and drag & drop ----------
  // Returns {moved:[{from,to}], copied:[{from,to}], skipped, failed:[...]} so
  // callers can journal precisely.
  async function transferItems(names, srcDir, destDir, mode, fromVolume=volumeToken(srcDir)) {
    if (inTrash(srcDir) || inTrash(destDir)) {
      toast('La papelera no admite transferencias', 'warn', 'Usá Restaurar para recuperar elementos o Borrar definitivamente para eliminarlos.');
      return { moved: [], copied: [], skipped: 0, failed: [] };
    }
    if (volumeAt(destDir)?.readOnly) {
      toast('Este volumen es de solo lectura', 'warn', 'Elegí un destino escribible.');
      return { moved: [], copied: [], skipped: 0, failed: [] };
    }
    const toVolume=volumeToken(destDir);
    const taken = new Set(await dirNames(destDir));
    const out = { moved: [], copied: [], skipped: 0, failed: [] };
    for (const name of names) {
      const from = join(srcDir, name);
      if (mode === 'cut' && srcDir === destDir) { out.skipped++; continue; }
      // A folder can never move inside itself (also reachable via paste).
      if (mode === 'cut' && (destDir === from || destDir.startsWith(from + '/'))) {
        out.failed.push(`${name}: no se puede mover dentro de sí misma`);
        continue;
      }
      const target = freeName(name, taken);
      const to = join(destDir, target);
      try {
        if (mode === 'cut') {
          await copyWithJobs(from,to,name,'move',fromVolume,toVolume);
          out.moved.push({ from, to });
        } else {
          await copyWithJobs(from, to, name,'copy',fromVolume,toVolume);
          out.copied.push({ from, to });
        }
        taken.add(target);
      } catch (err) {
        if(err.cancelled){out.cancelled=true;break;}
        out.failed.push(`${name}: ${err.message}`);
        await window.AxonTransfers.showError(err,{mode:mode==='cut'?'move':'copy',from,to});
        out.errorsPresented=true;
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
  async function copyWithJobs(from, to, label, mode='copy',fromVolume,toVolume) {
    const operation=await window.AxonTransfers.start(from,to,mode,{fromVolume,toVolume});
    const jobId = operation.id;
    if (!jobId) return;
    trackJob(jobId, label);
    // Resolve once the job reports done — trackJob polls in the background and
    // resolves the shared promise kept on the job record.
    const rec = S.jobs.get(jobId);
    await rec.done;
    if (rec.error) throw Object.assign(new Error(rec.error), rec.cancelled ? { cancelled: true } : {});
  }

  let transferOperations=[],transferDialog=null;
  el('fm-transfers-btn').onclick=()=>{
    if(transferDialog)return;
    const focus=document.activeElement,history=document.createElement('dialog');
    history.id='fm-transfer-history';history.className='fm-transfer-dialog';history.setAttribute('aria-labelledby','fm-transfer-title');
    transferDialog=history;
    history.addEventListener('close',()=>{history.remove();transferDialog=null;focus?.focus();});
    history.addEventListener('click',e=>{if(e.target.closest('[data-close]'))history.close();});
    document.body.append(history);renderTransferHistory();history.showModal();
  };
  function renderTransferHistory(){
    const history=transferDialog;if(!history)return;
    history.innerHTML=`<div class="fm-transfer-heading"><h3 id="fm-transfer-title">Historial de transferencias (${transferOperations.length})</h3><button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon("x")}</button></div><p>Los movimientos entre discos conservan un original recuperable. No liberan espacio automáticamente.</p>${transferOperations.map(op=>`<article><b>${esc(op.mode==='move'?'Movimiento':'Copia')} · ${esc(op.state)}</b><p class="maint-path">${esc(op.from)} → ${esc(op.to)}</p><p>${esc(op.message||'Resultado en curso')}</p>${op.recoveryPath?`<p>Original conservado: <span class="maint-path">${esc(op.recoveryPath)}</span>. Podés copiarlo desde Archivos a un destino libre.</p>`:''}${op.partialPath?`<p>Contenido parcial conservado: <span class="maint-path">${esc(op.partialPath)}</span>. Revisalo antes de decidir qué conservar.</p>`:''}${op.mode==='move'&&['verified','interrupted'].includes(op.state)?`<button class="btn-secondary" data-transfer-recover="${esc(op.id)}">Devolver original al origen</button>`:''}<button class="btn-secondary" data-transfer-refresh="${esc(op.id)}">Comprobar resultado</button></article>`).join('')||'<p>Todavía no hay transferencias.</p>'}`;
    history.querySelectorAll('[data-transfer-recover]').forEach(b=>b.onclick=async()=>{if(!await confirmDialog('Recuperar original','Se devuelve el original a su origen si está libre; se conservan las copias.'))return;try{await api(`/api/files/transfers/${b.dataset.transferRecover}/recover`,{method:'POST',body:{}});await restoreTransfers();}catch(e){errToast(e);}});
    history.querySelectorAll('[data-transfer-refresh]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api(`/api/files/transfers/${b.dataset.transferRefresh}`,{fresh:true});await restoreTransfers();}catch(e){errToast(e);}finally{b.disabled=false;}});
    refreshIcons(history);
  }

  async function restoreTransfers(){
    try {
      const result=await api('/api/files/transfers',{fresh:true});
      for(const op of result.operations||[])if(['running','planned','cancel-requested'].includes(op.state)&&!S.jobs.has(op.id))trackJob(op.id,op.to.split('/').pop());
      transferOperations=result.operations||[];el('fm-transfers-count').textContent=String(transferOperations.length);
      renderTransferHistory();
    }catch(e){errToast(e);}
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
          if (st.error) { rec2.error = st.error; S.jobs.delete(jobId); renderJobs();await restoreTransfers();return; }
          if (st.done) { S.jobs.delete(jobId); renderJobs();await restoreTransfers();return; }
        } catch (err) {
          rec2.error = err.message;
          S.jobs.delete(jobId);
          renderJobs();
          return;
        }
      }
    })();
    rec.cancel = async () => {
      rec.cancelled = true;
      rec.error = 'Cancelado';
      S.jobs.delete(jobId);
      renderJobs();
      try { await api(`/api/files/copyjob/${jobId}`, { method: 'DELETE' });await restoreTransfers(); } catch(e) {errToast(e);}
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
        ${j.cancel ? `<button class="fm-job-x" title="Cancelar">${icon('x')}</button>` : ''}
      </div>`).join('');
    wrap.querySelectorAll('.fm-job').forEach((row) => {
      row.querySelector('.fm-job-x')?.addEventListener('click', () => S.jobs.get(row.dataset.job)?.cancel?.());
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
          <tr><td>${st.ftype === 'directory' ? 'Tamaño de los archivos' : 'Tamaño'}</td><td class="fp-size"></td></tr>
          ${st.ftype === 'directory' ? '<tr><td>Espacio ocupado en disco</td><td class="fm-props-disk"></td></tr>' : ''}
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
    m.querySelector('.fp-size').textContent = st.ftype === 'directory' ? 'Calculando…' : `${fmtSize(st.size)} (${st.size.toLocaleString('es')} B)`;
    if (st.ftype === 'directory') m.querySelector('.fm-props-disk').textContent = st.diskSize == null ? 'Sin calcular' : `${fmtSize(st.diskSize)} (${st.diskSize.toLocaleString('es')} B)`;
    m.querySelector('.fp-mtime').textContent = fmtDate(st.mtime);
    m.querySelector('.fp-owner').textContent = `${st.user}:${st.group}`;
    // Permisos: checkboxes rwx por grupo, sincronizados con el octal.
    const permCell = m.querySelector('.fm-props-perms');
    const oct = String(st.mode || '').trim();
    const digits = (oct.length === 4 ? oct.slice(1) : oct).padStart(3, '0').slice(-3);
    permCell.innerHTML = `<span class="mono fm-perm-str">${esc(st.modeStr)}</span>
      <span class="fm-chmod">${['Dueño', 'Grupo', 'Otros'].map((who, gi) => `
        <fieldset class="fm-chmod-col"><legend>${who}</legend>${['R', 'W', 'X'].map((b, bi) =>
          `<label><input type="checkbox" data-g="${gi}" data-bit="${4 >> bi}"${(parseInt(digits[gi], 8) & (4 >> bi)) ? ' checked' : ''}> ${b}</label>`
        ).join('')}</fieldset>`).join('')}
      </span>
      <input type="text" class="fm-chmod-input mono" value="${esc(oct)}" maxlength="4" size="4" title="Octal — ej: 755">
      ${st.ftype === 'directory' ? '<label class="fm-chmod-rec"><input type="checkbox" class="fm-chmod-recur"> Aplicar también al contenido (recursivo)</label>' : ''}`;
    const octInput = permCell.querySelector('.fm-chmod-input');
    permCell.querySelectorAll('.fm-chmod input[data-g]').forEach((cb) =>
      cb.addEventListener('change', () => {
        let v = '';
        for (let g = 0; g < 3; g++) {
          let d = 0;
          permCell.querySelectorAll(`input[data-g="${g}"]`).forEach((b) => { if (b.checked) d += Number(b.dataset.bit); });
          v += d;
        }
        const cur = octInput.value.trim();
        octInput.value = (/^[0-7]{4}$/.test(cur) ? cur[0] : '') + v; // keep the special bit
      })
    );
    octInput.addEventListener('input', () => {
      const v = octInput.value.trim();
      if (!/^[0-7]{3,4}$/.test(v)) return;
      const ds = (v.length === 4 ? v.slice(1) : v).padStart(3, '0').slice(-3);
      permCell.querySelectorAll('.fm-chmod input[data-g]').forEach((b) => {
        b.checked = Boolean(parseInt(ds[b.dataset.g], 8) & Number(b.dataset.bit));
      });
    });
    const done = () => { m.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
    document.addEventListener('keydown', onKey, true);
    m.querySelector('.fm-p-cancel').addEventListener('click', done);
    m.addEventListener('click', (e) => { if (e.target === m) done(); });
    m.querySelector('.fm-p-chmod').addEventListener('click', async () => {
      const mode = octInput.value.trim();
      const recursive = Boolean(permCell.querySelector('.fm-chmod-recur')?.checked);
      try {
        await api('/api/files/chmod', { method: 'POST', body: { path: p, mode, recursive } });
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
    // Directory metadata bytes are not the total of its files. Allocated
    // space already came from stat; only request the apparent content total.
    if (st.ftype === 'directory') {
      api(`/api/files/dirsize?path=${encodeURIComponent(p)}`)
        .then((r) => {
          const c = m.querySelector('.fp-size');
          if (c && m.isConnected) c.textContent = `${fmtSize(r.bytes)} (${r.bytes.toLocaleString('es')} B)`;
        })
        .catch(() => {
          const c = m.querySelector('.fp-size');
          if (c && m.isConnected) c.textContent = 'Sin calcular';
        });
    }
  }

  // ---------- Right-click context menus ----------
  const isArchive = (name) =>
    /\.(tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|zip)$/i.test(name);

  // ---------- Context menus ----------
  // One layout for every surface (list, grid, columns, search hits, nav tree): a quick row, then groups —
  // open · share & process · organize · move · properties · delete. Library tools (share link, optimize,
  // transcribe, viewer) go through window.AxonLibrary, which resolves paths to indexed items on demand.
  const LIB_VIEW_KINDS = new Set(['image', 'raw', 'video', 'audio', 'pdf', 'vector', 'design']);
  const lib = () => window.AxonLibrary;
  const quote = (path) => `'${path.replace(/'/g, `'\\''`)}'`;

  async function transferTo(names, base, mode) {
    const dest = await window.AxonStorage?.pick({ title: mode === 'cut' ? 'Mover a…' : 'Copiar a…', start: base, writable: true });
    if (!dest) return;
    if (dest === base) return toast('Ya están en esa carpeta', 'warn', '', 2000);
    if (names.some((n) => { const src = join(base, n); return dest === src || dest.startsWith(src + '/'); })) return toast('No se puede mover una carpeta dentro de sí misma', 'warn', '', 2500);
    const r = await transferItems(names, base, dest, mode);
    journalTransfer(r, mode, base, dest);
    const n = r.moved.length + r.copied.length;
    if (n) toast(`${n} ${mode === 'cut' ? 'movido' : 'copiado'}${n === 1 ? '' : 's'} a ${dest.split('/').pop() || '/'} — Ctrl+Z deshace`, 'ok', '', 3500);
    if (r.failed.length && !r.errorsPresented) toast(`${r.failed.length} fallaron`, 'error', r.failed.slice(0, 4).join('\n'));
    if (S.cwd === base || S.cwd === dest) navigate(S.cwd);
  }

  // Clicked entry + current selection → the entries a menu action applies to.
  function menuTargets({ name, type, base, col, hit }) {
    const inSel = col === null && !hit && S.sel.has(name);
    const names = inSel ? [...S.sel] : [name];
    const entryOf = (n) => (col !== null ? S.cols[col]?.entries : S.entries)?.find((x) => x.name === n);
    const types = names.map((n) => (n === name ? type : entryOf(n)?.type || 'file'));
    return { names, types, paths: names.map((n) => join(base, n)), entryOf };
  }

  function openTrashMenu(x, y, ctx) {
    const { name, base, col } = ctx;
    const t = menuTargets(ctx);
    const ids = t.names.filter((n) => S.trashNames[n]?.id);
    const p = join(base, name);
    const items = [];
    if (ids.length) items.push(
      { icon: 'undo-2', label: `Restaurar${ids.length > 1 ? ` (${ids.length})` : ''}`, run: () => restoreTrashed(ids) },
      { icon: 'trash-2', label: 'Borrar definitivamente', danger: true, kbd: 'Supr', run: () => deleteTargets(ids, base) },
      { sep: true });
    items.push(
      { icon: 'clipboard', label: 'Copiar ruta', run: () => copyPath(p) },
      { icon: 'info', label: 'Propiedades', kbd: 'Alt+Enter', run: () => { const ent = t.entryOf(name); showProps(p, ent?.trashName || name, ent?.trashOrig); } });
    showCtxMenu(items, x, y);
  }

  function entryMenu(ctx) {
    const { name, type, base, col, hit } = ctx;
    const t = menuTargets(ctx);
    const { names, paths } = t;
    const many = names.length > 1;
    const p = join(base, name);
    const isDir = type === 'dir';
    const dirs = t.types.filter((x) => x === 'dir').length;
    const files = names.filter((n, i) => t.types[i] !== 'dir');
    const filePaths = files.map((n) => join(base, n));
    const readOnly = Boolean(volumeAt(base)?.readOnly);
    const L = lib();
    const kind = !isDir && L ? L.kindOf(p) : null;
    const catalogOf = paths.map((x) => AxonFileCatalog.get(x));
    const allFav = catalogOf.every((m) => m.favorite);
    const allPinned = catalogOf.every((m) => m.pinned);
    const withDir = (fn) => () => { if (col !== null && S.cols[col]) { S.cwd = base; S.entries = S.cols[col].entries; } return fn(); };
    const items = [{ row: [
      { icon: 'scissors', label: 'Cortar', kbd: 'Ctrl+X', disabled: readOnly, run: () => setClip({ mode: 'cut', dir: base, names }) },
      { icon: 'copy', label: 'Copiar', kbd: 'Ctrl+C', run: () => setClip({ mode: 'copy', dir: base, names }) },
      { icon: 'clipboard-paste', label: 'Pegar', short: 'Pegar', kbd: 'Ctrl+V', disabled: !S.clip || readOnly, run: () => paste(isDir && !many ? p : base) },
      { icon: 'pencil', label: 'Renombrar', short: 'Renombrar', kbd: 'F2', disabled: many || readOnly, run: () => doAction('rename', name, type, base) },
      { icon: 'trash-2', label: 'Eliminar', kbd: 'Supr', danger: true, disabled: readOnly, run: () => deleteTargets(names, base) },
    ] }];

    // ── open
    const open = [];
    if (!many) {
      if (isDir) open.push({ icon: 'folder-open', label: 'Abrir', kbd: 'Enter', run: () => navigate(p) });
      else {
        open.push({ icon: 'external-link', label: 'Abrir', kbd: 'Enter', run: withDir(() => openEntryAt(base, name, type)) });
        open.push({ icon: 'eye', label: 'Vista previa', kbd: 'Espacio', run: withDir(() => openPreview(name)) });
        if (kind && L) open.push({ icon: 'maximize', label: 'Abrir en el visor', hint: 'Visor a pantalla completa con zoom, información y transcripción', run: () => L.view([p]) });
        if (['text', 'other'].includes(kindFor(name)) && !readOnly) open.push({ icon: 'file-pen', label: 'Editar', run: () => openEditor(p) });
      }
      if (isDir && typeof openTermCmd === 'function') open.push({ icon: 'terminal', label: 'Abrir terminal acá', run: () => openTermCmd(`cd ${quote(p)}`) });
      if (isDir) open.push({ icon: 'file-plus', label: 'Nuevo archivo en esta carpeta', disabled: readOnly, run: () => createFile(p) });
      if (hit) open.push({ icon: 'folder-search', label: 'Abrir carpeta contenedora', run: () => { exitSearch(); navigate(base).then((ok) => { if (ok !== false) selectName(name); }); } });
    }
    open.push(isDir || dirs
      ? { icon: 'archive', label: many ? 'Descargar como .zip' : 'Descargar como .zip', run: () => (many ? downloadZip(base, names) : downloadZip(p)) }
      : { icon: 'download', label: many ? `Descargar ${names.length} archivos` : 'Descargar', run: () => (many ? names.forEach((n, i) => setTimeout(() => download(join(base, n), n), i * 350)) : download(p, name)) });
    items.push({ sep: true }, ...open);

    // ── share & process (library tools)
    if (L && files.length) {
      const share = [{ icon: 'share-2', label: files.length > 1 ? `Compartir ${files.length} archivos…` : 'Compartir link…', kbd: 'Ctrl+Shift+S', run: () => L.share(filePaths) }];
      const media = files.filter((n) => L.canTool(join(base, n)));
      const av = files.filter((n) => L.canTranscribe(join(base, n)));
      if (media.length) share.push({ icon: 'wand-2', label: media.length > 1 ? `Optimizar / convertir ${media.length}…` : 'Optimizar / convertir…', run: () => L.tools(media.map((n) => join(base, n))) });
      if (av.length) {
        const known = av.length === 1 ? L.peek(join(base, av[0])) : null;
        if (known?.tr) share.push({ icon: 'captions', label: 'Ver transcripción', run: () => L.transcript([join(base, av[0])]) });
        share.push({ icon: 'captions', label: av.length > 1 ? `Transcribir ${av.length}…` : known?.tr ? 'Transcribir de nuevo…' : 'Transcribir…', run: () => L.transcribe(av.map((n) => join(base, n))) });
      }
      items.push({ sep: true }, ...share);
    }

    // ── organize
    items.push({ sep: true },
      { icon: 'tags', label: 'Colores, etiquetas y marcas…', run: () => AxonFileCatalog.edit(paths) },
      { icon: 'star', label: 'Favorito', checked: allFav, run: () => AxonFileCatalog.patch(paths, { favorite: !allFav }).catch(errToast) });

    // ── move & more
    items.push({ sep: true },
      { icon: 'folder-input', label: 'Mover a…', disabled: readOnly, run: () => transferTo(names, base, 'cut') },
      { icon: 'copy-plus', label: 'Copiar a…', run: () => transferTo(names, base, 'copy') });
    const more = [
      { icon: 'pin', label: 'Fijar en acceso rápido', checked: allPinned, run: () => AxonFileCatalog.patch(paths, { pinned: !allPinned }).catch(errToast) },
    ];
    if (L && files.length) more.push(
      { icon: 'folder-plus', label: 'Agregar a una colección…', run: () => L.addToCollection(filePaths) },
      { icon: 'link-2', label: 'Agregar a un link existente…', run: () => L.addToShare(filePaths) });
    more.push({ sep: true },
      { icon: 'copy-plus', label: 'Duplicar', disabled: readOnly, run: async () => { setClip({ mode: 'copy', dir: base, names }); await paste(base); } },
      { icon: 'archive', label: 'Comprimir…', disabled: readOnly, run: () => compressTargets(base, names) });
    if (!many && !isDir && isArchive(name)) more.push({ icon: 'package-open', label: 'Extraer acá', disabled: readOnly, run: () => extractArchive(p, base) });
    more.push({ sep: true }, { icon: 'clipboard', label: many ? 'Copiar rutas' : 'Copiar ruta', kbd: 'Ctrl+Shift+C', run: () => copyPath(paths.join('\n')) });
    if (!many) more.push({ icon: 'link', label: 'Copiar enlace de AXON', run: () => { const u = new URL(window.AxonNavigation.url('files', isDir ? { path: p } : { path: base, item: name }), location.origin).href; navigator.clipboard.writeText(u).then(() => toast('Enlace copiado', 'ok', '', 2000)); } });
    if (files.length && !readOnly) more.push({ sep: true }, { icon: 'trash-2', label: 'Borrar definitivamente…', danger: true, kbd: 'Shift+Supr', run: () => deleteTargets(names, base, true) });
    items.push({ icon: 'more-horizontal', label: 'Más acciones', children: more });

    // ── properties
    items.push({ sep: true }, { icon: 'info', label: 'Propiedades', kbd: 'Alt+Enter', run: () => { const ent = t.entryOf(name); showProps(p, ent?.trashName || name, ent?.trashOrig); } });
    return items;
  }

  // Menu for empty space inside a folder (or the folder itself from the nav tree).
  function folderMenu(dir, { tree = false } = {}) {
    const trash = inTrash(dir);
    const ro = Boolean(volumeAt(dir)?.readOnly);
    const here = dir === S.cwd;
    const items = [];
    if (!trash) {
      items.push(
        { icon: 'folder-plus', label: 'Nueva carpeta', kbd: 'Ctrl+Shift+N', disabled: ro, run: () => (here ? el('fm-mkdir-btn').click() : mkdirIn(dir)) },
        { icon: 'file-plus', label: 'Nuevo archivo', kbd: 'Ctrl+Alt+N', disabled: ro, run: () => createFile(dir) });
      if (here) items.push({ icon: 'upload', label: 'Subir archivos…', kbd: 'Ctrl+U', disabled: ro, run: () => el('fm-file-input').click() }, { icon: 'folder-up', label: 'Subir carpeta…', disabled: ro, run: () => el('fm-dir-input').click() });
      if (S.clip) items.push({ icon: 'clipboard-paste', label: `Pegar (${S.clip.names.length})`, kbd: 'Ctrl+V', disabled: ro, run: () => paste(dir) });
      items.push({ sep: true });
    }
    if (here) {
      items.push({ icon: 'layout-template', label: 'Vista', children: viewItems() });
      items.push({ icon: 'arrow-up-down', label: 'Ordenar por', children: sortItems() });
      items.push({ icon: 'refresh-cw', label: 'Actualizar', kbd: 'F5', run: () => el('fm-refresh-btn').click() }, { sep: true });
    } else if (tree) {
      items.push({ icon: 'folder-open', label: 'Abrir', run: () => navigate(dir) }, { sep: true });
    }
    if (!trash) {
      items.push({ icon: 'tags', label: 'Organizar esta carpeta…', run: () => AxonFileCatalog.edit([dir]) });
      if (typeof openTermCmd === 'function') items.push({ icon: 'terminal', label: 'Abrir terminal acá', run: () => openTermCmd(`cd ${quote(dir)}`) });
      if (!here && S.clip) items.push({ icon: 'clipboard-paste', label: `Pegar (${S.clip.names.length})`, disabled: ro, run: () => paste(dir) });
      items.push({ icon: 'archive', label: 'Descargar como .zip', run: () => downloadZip(dir) });
    }
    if (trash) items.push({ icon: 'trash-2', label: 'Vaciar papelera', danger: true, run: emptyTrash });
    else if (S.trashDir) {
      const disk = volumeAt(dir), local = (S.trashDirs || []).find((x) => disk?.path && disk.path !== '/' && x.startsWith(disk.path + '/'));
      items.push({ icon: 'trash-2', label: 'Abrir papelera', run: () => navigate(local || S.trashDir) });
    }
    items.push({ sep: true }, { icon: 'clipboard', label: 'Copiar ruta', run: () => copyPath(dir) });
    if (lib() && !trash) items.push({ icon: 'images', label: 'Ver como galería de la biblioteca', run: () => window.AxonNavigation.go(window.AxonNavigation.url('library', { type: 'folder', value: dir })) });
    if (here) items.push({ icon: 'info', label: 'Propiedades de la carpeta', kbd: 'Alt+Enter', run: () => showProps(dir, dir.split('/').pop() || '/') });
    return items;
  }

  async function mkdirIn(dir) {
    const name = await fmPrompt('Nueva carpeta', 'Nombre');
    if (!name) return;
    if (name.includes('/') || name === '.' || name === '..') return toast('Nombre inválido — sin "/", "." ni ".."', 'error');
    try { await apiMkdir(join(dir, name)); toast('Carpeta creada', 'ok', '', 2000); if (dir === S.cwd) navigate(S.cwd); window.dispatchEvent(new CustomEvent('axon:files-changed', { detail: { dir } })); }
    catch (err) { errToast(err); }
  }

  function sortItems() {
    const keys = [['name', 'Nombre', 'a-large-small'], ['size', 'Tamaño', 'ruler'], ['mtime', 'Fecha de modificación', 'calendar']];
    return [
      ...keys.map(([k, label, ic]) => ({ icon: ic, label, checked: S.sort.key === k, run: () => setSort(k, S.sort.dir) })),
      { sep: true },
      { icon: 'arrow-up', label: 'Ascendente', checked: S.sort.dir === 1, run: () => setSort(S.sort.key, 1) },
      { icon: 'arrow-down', label: 'Descendente', checked: S.sort.dir === -1, run: () => setSort(S.sort.key, -1) },
    ];
  }
  function setSort(key, dir) {
    S.sort = { key, dir };
    localStorage.setItem('fm-sort', JSON.stringify(S.sort));
    syncCommandBar();
    render();
    window.AxonNavigation?.update('files', fileParams());
  }

  function showEntryMenu(e, row) {
    const colI = row.dataset.col !== undefined ? parseInt(row.dataset.col, 10) : null;
    const ctx = {
      name: row.dataset.name, type: row.dataset.type, col: colI, hit: row.classList.contains('fm-search-hit'),
      base: row.dataset.dir || (colI !== null ? S.cols[colI]?.path || S.cwd : S.cwd),
    };
    // Right-click selects the row, but never deselects a multi-selection that already contains it.
    if (colI === null && !ctx.hit && !S.sel.has(ctx.name)) {
      S.sel.clear(); S.sel.add(ctx.name); S.anchor = ctx.name; S.cursor = ctx.name;
      applySelToDom();
    }
    if (inTrash(ctx.base)) return openTrashMenu(e.clientX, e.clientY, ctx);
    showCtxMenu(entryMenu(ctx), e.clientX, e.clientY);
  }

  el('fm-list').addEventListener('contextmenu', (e) => {
    if (typeof showCtxMenu !== 'function') return;
    const row = e.target.closest('tr.fm-row, .fm-card, .fm-col-row');
    e.preventDefault();
    if (!row || row.dataset.name === '..') {
      const col = e.target.closest('.fm-col');
      const dir = col ? S.cols[parseInt(col.dataset.col, 10)]?.path || S.cwd : S.cwd;
      if (S.catalogMark || S.searchMode) return;
      showCtxMenu(folderMenu(dir), e.clientX, e.clientY);
      return;
    }
    showEntryMenu(e, row);
  });

  // Keyboard-invoked menu (Menu key / Shift+F10) for the focused entry.
  function menuForCursor() {
    const name = S.cursor || [...S.sel][0];
    const row = name && sec.querySelector(`[data-name="${CSS.escape(name)}"]`);
    if (!row) return false;
    const r = row.getBoundingClientRect();
    const synthetic = { clientX: r.left + 60, clientY: r.top + r.height / 2 };
    showEntryMenu(synthetic, row);
    return true;
  }

  el('fm-breadcrumb').addEventListener('click', (e) => {
    const b = e.target.closest('.fm-crumb');
    if (b?.dataset.pc) void window.AxonNavigation.go(window.AxonNavigation.url('files', { pc: '1' }));
    else if (b) navigate(b.dataset.p);
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
  el('fm-sel-organize').addEventListener('click',()=>AxonFileCatalog.edit([...S.sel].map(n=>join(S.cwd,n))));
  el('fm-sel-clear').addEventListener('click', clearSel);
  el('fm-sel-all').addEventListener('click', () => {
    for (const n of visibleNames()) S.sel.add(n);
    applySelToDom();
  });
  el('fm-sel-dl').addEventListener('click', () => {
    const names = [...S.sel];
    // Any folder in the mix → one streamed .zip of the whole selection.
    if (names.some((n) => S.entries.find((e) => e.name === n)?.type === 'dir')) {
      downloadZip(S.cwd, names);
      toast('Preparando el .zip de la selección…', 'ok', '', 2500);
      return;
    }
    let i = 0;
    for (const name of names) {
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
    const scope = S.view === 'cols' ? lastCol() : sec;
    scope
      ?.querySelector(`[data-name="${CSS.escape(S.cursor)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
    scope?.querySelector(`[data-name="${CSS.escape(S.cursor)}"]`)?.focus({ preventScroll: true });
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
      if(window.AxonNavigation?.ready && !window.AxonNavigation.applying){const snap=captureFiles();snap.cols.pop();void window.AxonNavigation.go(window.AxonNavigation.url('files',{...fileParams(),path:snap.cols.at(-1).path,item:null,edit:null}),{view:snap});return;}
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
    if (!sec.classList.contains('active') || dormant() || S.editingPath || e.target.closest('.axon-doc')) return;
    if (document.querySelector('.modal:not(.hidden), dialog[open], :popover-open')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const kl = k.toLowerCase();
    // The navigation pane is a tree with its own keys; only modified shortcuts reach the folder view from there.
    if (!mod && e.target.closest('#fm-nav')) return;
    // Enter/Space on a focused button/link should activate it, not our
    // shortcuts — every other key still works while a button holds focus.
    if (!mod && (tag === 'button' || tag === 'a') && (k === 'Enter' || k === ' ')) return;

    // F-keys and the menu key
    if (!mod && (k === 'F5')) { e.preventDefault(); el('fm-refresh-btn').click(); return; }
    if (!mod && (k === 'F4')) { e.preventDefault(); editLocation(); return; }
    if (k === 'ContextMenu' || (e.shiftKey && k === 'F10')) {
      if (menuForCursor()) { e.preventDefault(); e.stopPropagation(); } return;
    }
    if (e.altKey && k === 'Enter') {
      e.preventDefault();
      const name = [...S.sel][0] || S.cursor;
      if (name) showProps(join(S.cwd, name), name); else showProps(S.cwd, S.cwd.split('/').pop() || '/');
      return;
    }
    if (mod && e.shiftKey) {
      const view = { Digit1: 'list', Digit2: 'grid', Digit3: 'cols' }[e.code];
      if (view) { e.preventDefault(); setView(view); return; }
      if (kl === 'c') { const paths = selPaths(); if (paths.length) { e.preventDefault(); copyPath(paths.join('\n')); } return; }
      if (kl === 's') {
        const files = selPaths().filter((p) => S.entries.find((x) => join(S.cwd, x.name) === p)?.type !== 'dir');
        if (files.length && window.AxonLibrary) { e.preventDefault(); window.AxonLibrary.share(files); }
        return;
      }
    }
    if (mod && !e.shiftKey && !e.altKey) {
      if (kl === 'b') { e.preventDefault(); window.AxonExplorer?.toggleNav(); return; }
      if (kl === 'u') { e.preventDefault(); if (!volumeAt(S.cwd)?.readOnly) el('fm-file-input').click(); return; }
      if (kl === 'l') { e.preventDefault(); editLocation(); return; }
      if (kl === 'e') { e.preventDefault(); el('fm-filter').focus(); el('fm-filter').select(); return; }
    }
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
      } else if (kl === 'n' && e.altKey) {
        e.preventDefault();
        el('fm-new-file-btn').click();
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
          if (e.shiftKey) deleteTargets([...S.sel], S.cwd, true); else el('fm-sel-del').click();
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
      ['Clic · doble clic · Enter', 'Seleccionar · abrir · abrir'],
      ['Backspace · Alt+↑', 'Subir un nivel'],
      ['Ctrl+C / X / V', 'Copiar / cortar / pegar'],
      ['Ctrl+Z · Ctrl+Shift+Z · Ctrl+Y', 'Deshacer · rehacer'],
      ['F2', 'Renombrar'],
      ['Supr', 'A la papelera (dentro de ella: borrado con revisión)'],
      ['Ctrl+H', 'Mostrar/ocultar archivos ocultos'],
      ['Ctrl+F', 'Búsqueda recursiva'],
      ['Ctrl+Alt+N · Ctrl+Shift+N', 'Nuevo archivo · nueva carpeta'],
      ['Ctrl+U', 'Subir archivos'],
      ['Ctrl+L · F4', 'Escribir una ruta'],
      ['Ctrl+E · /', 'Enfocar la búsqueda'],
      ['Ctrl+B', 'Mostrar/ocultar el panel de navegación'],
      ['Ctrl+Shift+1 / 2 / 3', 'Vista de lista / íconos / columnas'],
      ['Ctrl+Shift+S', 'Compartir link de la selección'],
      ['Ctrl+Shift+C', 'Copiar la ruta'],
      ['Alt+Enter', 'Propiedades'],
      ['Menú · Shift+F10', 'Menú contextual del elemento enfocado'],
      ['F5', 'Actualizar'],
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
  function fmPrompt(title, label, value = '', stem = false) {
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
      // With stem=true (rename) only the base name is pre-selected so typing
      // never nukes the extension by accident.
      const dot = stem ? value.lastIndexOf('.') : -1;
      if (stem && dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    });
  }

  // ---------- New file ----------
  async function createFile(dir = S.cwd) {
    if (!dir || inTrash(dir) || document.querySelector('.fm-create-modal')) return;
    // Let the existing navigation guard resolve unsaved editor changes first.
    if (S.editingPath) {
      if (window.AxonNavigation?.ready) {
        const left = await window.AxonNavigation.go(window.AxonNavigation.url('files', { ...fileParams(), item: null, edit: null }));
        if (!left) return;
      } else {
        await confirmCloseEditor();
        if (S.editingPath) return;
      }
    }
    const modal = document.createElement('div');
    modal.className = 'modal fm-create-modal';
    modal.innerHTML = `
      <form class="modal-content fm-create-form">
        <h3>Nuevo archivo</h3>
        <p class="listener-note">Se creará vacío en <span class="mono fm-create-path"></span></p>
        <label class="fm-prompt-label" for="fm-create-name"><span>Nombre completo, incluida la extensión</span></label>
        <input id="fm-create-name" class="fm-prompt-input" required autocomplete="off" spellcheck="false"
          placeholder="archivo.txt, .env, config.json…" aria-describedby="fm-create-help fm-create-error">
        <div class="fm-create-presets" role="group" aria-label="Nombres rápidos">
          <button type="button" class="btn-secondary" data-name="archivo.txt">${icon('file-text')} Texto (.txt)</button>
          <button type="button" class="btn-secondary" data-name=".env">${icon('file-code')} Entorno (.env)</button>
          <button type="button" class="btn-secondary" data-name="config.json">JSON</button>
        </div>
        <p id="fm-create-help" class="listener-note">Podés usar cualquier extensión o dejarlo sin extensión. Después se abre el editor de texto.</p>
        <p id="fm-create-error" class="fm-create-error hidden" role="alert"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary fm-create-cancel">Cancelar</button>
          <button type="submit" class="btn-primary fm-create-submit">${icon('file-plus')} Crear y editar</button>
        </div>
      </form>`;
    modal.querySelector('.fm-create-path').textContent = dir;
    const input = modal.querySelector('#fm-create-name');
    const error = modal.querySelector('#fm-create-error');
    let pending = false;
    const cancel = () => { if (!pending) modal.remove(); };
    modal.querySelector('.fm-create-cancel').addEventListener('click', cancel);
    modal.addEventListener('axon:dialog-cancel', cancel);
    modal.addEventListener('click', e => { if (e.target === modal) cancel(); });
    modal.querySelectorAll('[data-name]').forEach(button => button.addEventListener('click', () => {
      input.value = button.dataset.name; input.focus(); input.select(); error.classList.add('hidden');
    }));
    modal.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      if (pending) return;
      const name = input.value.trim();
      error.classList.add('hidden');
      if (!name || name === '.' || name === '..' || /[/\\\x00-\x1f\x7f]/.test(name) || new TextEncoder().encode(name).length > 255) {
        error.textContent = 'Usá un nombre sin barras, de hasta 255 bytes.'; error.classList.remove('hidden'); input.focus(); return;
      }
      pending = true;
      input.disabled = true;
      modal.querySelectorAll('button[type="button"]').forEach(button => button.disabled = true);
      try {
        const created = await api('/api/files/create', { method: 'POST', body: { path: dir, name }, busy: modal.querySelector('.fm-create-submit') });
        modal.remove();
        if (name.startsWith('.')) { S.showHidden = true; localStorage.setItem('fm-hidden', '1'); updateHiddenBtn(); }
        toast(`Archivo creado: ${name}`, 'ok', '', 2500);
        if (window.AxonNavigation?.ready) {
          await window.AxonNavigation.go(window.AxonNavigation.url('files', {
            ...fileParams(), path: parentOf(created.path), item: name, edit: '1', hidden: S.showHidden ? '1' : '0', q: null, search: null,
          }));
        } else { S.filter = ''; el('fm-filter').value = ''; await navigate(dir); await openEditor(created.path); }
      } catch (err) {
        error.textContent = err.message || 'No se pudo crear el archivo'; error.classList.remove('hidden');
      } finally {
        pending = false;
        input.disabled = false;
        modal.querySelectorAll('button[type="button"]').forEach(button => button.disabled = false);
        if (modal.isConnected) input.focus();
      }
    });
    document.body.appendChild(modal); refreshIcons(); input.focus();
  }

  // ---------- Toolbar ----------
  el('fm-new-file-btn').addEventListener('click', () => createFile());
  el('fm-refresh-btn').addEventListener('click', async () => {
    // Restoring reloads the editor from disk — confirm first when it holds
    // unsaved changes (same guard as any other navigation).
    if (window.AxonPages?.files?.canLeave && !(await window.AxonPages.files.canLeave({ section: 'files', params: {} }))) return;
    const snap=captureFiles();
    if(window.AxonNavigation?.current?.params)await restoreFiles(window.AxonNavigation.current.params,snap);else navigate(S.cwd);
    window.AxonNavigation?.checkpoint();
  });

  el('fm-filter').addEventListener('input', (e) => {
    if (S.searchMode) {
      S.searchQ = e.target.value;
      scheduleSearch();
      return;
    }
    S.filter = e.target.value;
    S.renderLimit = RENDER_PAGE;
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

  sec.querySelectorAll('.fm-vbtn[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === S.view);
    b.addEventListener('click', () => setView(b.dataset.view));
  });
  el('fm-hidden-btn').addEventListener('click', toggleHidden);
  updateHiddenBtn();

  // ---------- View options (size, density, what is shown) ----------
  const TILES = [['small', 'Pequeños'], ['medium', 'Medianos'], ['large', 'Grandes'], ['xl', 'Extra grandes']];
  const DENSITIES = [['compact', 'Compacta'], ['normal', 'Normal'], ['comfortable', 'Cómoda']];
  function applyViewPrefs() {
    sec.dataset.fmTile = S.tile;
    sec.dataset.fmDensity = S.density;
    sec.dataset.fmChecks = S.checks ? 'on' : 'off';
  }
  function setViewPref(key, value) {
    S[key] = value;
    try { localStorage.setItem({ tile: 'fm-tile', density: 'fm-density', checks: 'fm-checks' }[key], key === 'checks' ? (value ? '1' : '0') : value); } catch { /* private mode */ }
    applyViewPrefs();
    if (key === 'tile' && S.view !== 'grid') setView('grid'); else render();
  }
  function viewItems() {
    return [
      { header: 'Vista' },
      ...[['list', 'Lista', 'list'], ['grid', 'Íconos', 'layout-grid'], ['cols', 'Columnas', 'columns']].map(([v, label, ic]) => ({ icon: ic, label, checked: S.view === v, run: () => setView(v) })),
      { sep: true }, { header: 'Tamaño de íconos' },
      ...TILES.map(([v, label]) => ({ icon: 'image', label, checked: S.view === 'grid' && S.tile === v, run: () => setViewPref('tile', v) })),
      { sep: true }, { header: 'Densidad de la lista' },
      ...DENSITIES.map(([v, label]) => ({ icon: 'rows-3', label, checked: S.density === v, run: () => setViewPref('density', v) })),
      { sep: true }, { header: 'Mostrar' },
      { icon: 'panel-left', label: 'Panel de navegación', kbd: 'Ctrl+B', checked: !sec.classList.contains('fm-nav-hidden'), run: () => window.AxonExplorer?.toggleNav() },
      { icon: 'square-check', label: 'Casillas de selección', checked: S.checks, run: () => setViewPref('checks', !S.checks) },
      { icon: 'eye', label: 'Archivos ocultos', kbd: 'Ctrl+H', checked: S.showHidden, run: toggleHidden },
    ];
  }
  applyViewPrefs();
  el('fm-view-btn').addEventListener('click', () => showCtxMenu(viewItems(), 0, 0, { anchor: el('fm-view-btn') }));

  // ---------- Command bar: sort menu, expandable filters ----------
  const drawer = el('fm-drawer');
  const SORT_LABEL = { name: 'Nombre', size: 'Tamaño', mtime: 'Fecha' };
  function setDrawer(open, persist = true) {
    drawer.hidden = !open;
    el('fm-more-btn').setAttribute('aria-expanded', String(open));
    el('fm-more-btn').classList.toggle('active', open);
    if (persist) try { localStorage.setItem('fm-drawer', open ? '1' : '0'); } catch { /* private mode */ }
  }
  function activeFilterCount() {
    return [S.catalogMark, S.catalogColor, S.catalogTag, S.catalogKind].filter(Boolean).length;
  }
  function syncCommandBar() {
    el('fm-sort-label').textContent = `${SORT_LABEL[S.sort.key] || 'Nombre'} ${S.sort.dir === 1 ? '↑' : '↓'}`;
    const n = activeFilterCount();
    const summary = el('fm-filter-summary');
    summary.textContent = n ? `${n} filtro${n === 1 ? '' : 's'} activo${n === 1 ? '' : 's'}` : '';
    summary.classList.toggle('hidden', !n);
    el('fm-clear-filters').classList.toggle('hidden', !n);
    el('fm-more-btn').dataset.filters = n ? String(n) : '';
    // Filters in effect must never hide behind a closed drawer.
    if (n && drawer.hidden) setDrawer(true, false);
  }
  setDrawer(localStorage.getItem('fm-drawer') === '1', false);
  el('fm-more-btn').addEventListener('click', () => setDrawer(drawer.hidden));
  el('fm-sort-btn').addEventListener('click', () => showCtxMenu(sortItems(), 0, 0, { anchor: el('fm-sort-btn') }));
  el('fm-clear-filters').addEventListener('click', () => {
    S.catalogMark = ''; S.catalogColor = ''; S.catalogTag = ''; S.catalogKind = '';
    syncCatalogControls(); S.sel.clear(); render(); updateSelbar();
    window.AxonNavigation?.update('files', fileParams());
  });
  el('fm-sel-share').addEventListener('click', () => window.AxonLibrary?.share(selPaths().filter((p) => S.entries.find((e) => join(S.cwd, e.name) === p)?.type !== 'dir')));
  el('fm-sel-more').addEventListener('click', () => {
    const name = [...S.sel][0] || S.cursor;
    const ent = S.entries.find((x) => x.name === name);
    if (!ent) return;
    const r = el('fm-sel-more').getBoundingClientRect();
    const items = inTrash(S.cwd) ? [] : entryMenu({ name, type: ent.type, base: S.cwd, col: null, hit: false });
    // Wide screens already show cut/copy/delete in the bar, so the menu starts at the grouped actions;
    // on phones the bar is trimmed and the whole menu (quick row included) is needed.
    showCtxMenu(matchMedia('(max-width: 600px)').matches ? items : items.slice(1), r.left, r.top - 8, { anchor: el('fm-sel-more') });
  });
  const selPaths = () => (S.sel.size ? [...S.sel] : S.cursor ? [S.cursor] : []).map((n) => join(S.cwd, n));

  el('fm-table').querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('.fm-th-sort');
    if (!th) return;
    const k = th.dataset.sort;
    if (S.sort.key === k) S.sort.dir *= -1;
    else S.sort = { key: k, dir: 1 };
    localStorage.setItem('fm-sort', JSON.stringify(S.sort));
    render();
  });

  el('fm-tbody').addEventListener('error', (e) => { if (e.target.classList?.contains('fm-row-thumb')) e.target.remove(); }, true);
  // Library data arrives after the folder paints: swap icons for thumbnails once it is there.
  document.addEventListener('axon:library', () => { if (sec.classList.contains('active') && !dormant() && !S.editingPath && S.view !== 'cols' && !S.dragging) render(); });
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

  // Leaving mid-upload/mid-copy/dirty-editor kills work — warn once.
  window.addEventListener('beforeunload', (e) => {
    if (uploadAbort || S.jobs.size || isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  function setUploadBar(done, total, label) {
    const wrap = el('fm-upload-progress');
    wrap.classList.remove('hidden');
    el('fm-up-label').textContent = label;
    el('fm-up-bar').style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  }

  async function uploadRequest(url, options = {}) {
    const res = await fetch(url, { credentials: 'same-origin', ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok !== true) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.detail = data.detail;
      err.status = res.status;
      err.received = data.received;
      throw err;
    }
    return data;
  }

  async function uploadFileParts(p, signal, progress) {
    let id;
    let finished = false;
    try {
      // Let init finish even if Cancel is pressed so its temporary directory
      // can always be cleaned using the returned id.
      const init = await uploadRequest('/api/files/upload/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p.dir, name: p.finalName, size: p.f.size }),
      });
      id = init.id;
      let offset = 0;
      while (offset < p.f.size) {
        signal.throwIfAborted();
        const end = Math.min(p.f.size, offset + init.chunkSize);
        const blob = p.f.slice(offset, end);
        let next;
        for (let attempt = 0; ; attempt++) {
          try {
            const data = await uploadRequest(`/api/files/upload/${id}?offset=${offset}`, {
              method: 'PUT', body: blob, signal,
            });
            next = data.received;
            break;
          } catch (err) {
            signal.throwIfAborted();
            // The response may have been lost after the server wrote this
            // block. Its acknowledged offset makes the retry idempotent.
            if (err.status === 409 && err.received === end) { next = end; break; }
            if (attempt >= 3 || (err.status && err.status < 500 && err.status !== 409)) throw err;
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
        if (next !== end) throw new Error('El servidor confirmó un tamaño de bloque inválido');
        offset = next;
        progress(p.f.size ? offset / p.f.size : 1);
      }
      signal.throwIfAborted();
      // Completion is an atomic rename. Await its outcome even when Cancel
      // is pressed so the journal records a file that was already committed.
      for (let attempt = 0; ; attempt++) {
        try {
          const done = await uploadRequest(`/api/files/upload/${id}/finish`, { method: 'POST' });
          finished = true;
          return done;
        } catch (err) {
          if (attempt >= 3 || (err.status && err.status < 500)) throw err;
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    } finally {
      if (id && !finished) {
        await uploadRequest(`/api/files/upload/${id}`, { method: 'DELETE' }).catch(() => {});
      }
    }
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
    if (uploadAbort) return toast('Ya hay una subida en curso', 'warn', '', 2500);
    destDir = destDir || S.cwd;
    if (inTrash(destDir)) return toast('La papelera no admite subidas', 'warn', 'Subí los archivos a una carpeta normal.');
    if (volumeAt(destDir)?.readOnly) return toast('Este volumen es de solo lectura', 'warn', 'No se pueden subir archivos aquí.');
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
    if (uploadAbort) return toast('Ya hay una subida en curso', 'warn', '', 2500);
    uploadAbort = new AbortController();
    el('fm-up-cancel').disabled = false;
    // Progress is tracked in bytes so the bar can show speed + ETA.
    const totalBytes = todo.reduce((a, p) => a + p.f.size, 0) || 0;
    let bytesSent = 0;
    const t0 = Date.now();
    const fmtEta = (s) => (!Number.isFinite(s) || s < 0 ? '' : s < 90 ? `~${Math.ceil(s)}s` : `~${Math.round(s / 60)}m`);
    const failed = [];
    const created = [];
    let okCount = 0;
    const tick = (label) => {
      const elaps = (Date.now() - t0) / 1000;
      const spd = elaps > 0.5 ? bytesSent / elaps : 0;
      setUploadBar(bytesSent, totalBytes || total,
        `${label || `Subiendo ${okCount + failed.length}/${total}…`}` +
        `${totalBytes ? ` · ${Math.min(99, Math.round((bytesSent / totalBytes) * 100))}%` : ''}` +
        `${spd ? ` · ${fmtSize(Math.round(spd))}/s · ${fmtEta((totalBytes - bytesSent) / spd)}` : ''}`);
    };
    tick('Subiendo…');
    // Two files at a time — strictly serial uploads wasted idle bandwidth.
    let nextUp = 0;
    const worker = async () => {
      while (nextUp < todo.length) {
        if (uploadAbort.signal.aborted) return;
        const p = todo[nextUp++];
        try {
          const done = await uploadFileParts(p, uploadAbort.signal, (fraction) => {
            bytesSent += fraction * p.f.size - (p._sent || 0);
            p._sent = fraction * p.f.size;
            tick(`Subiendo ${Math.min(total, okCount + failed.length + 1)}/${total}: ${p.finalName}`);
          });
          okCount++;
          if (!p.overwritten) created.push(done.path);
        } catch (err) {
          if (uploadAbort.signal.aborted) return;
          failed.push(`${p.rel}: ${err.message || 'Error'}`);
        }
        bytesSent += p.f.size - (p._sent || 0);
        p._sent = p.f.size;
        tick();
      }
    };
    await Promise.all([worker(), worker()]);
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
    const target = dropTargetOf(e) || S.cwd || '/';
    el('fm-drop-text').textContent = `Soltá para subir a ${target}`;
    clearDropMarks();
    e.target.closest?.('[data-drop-path]')?.classList.add('fm-drop-target');
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
    const node = e.target.closest('[data-drop-path]');
    if (node) return node.dataset.dropPath;
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
    // A dragged folder can't land on itself or anywhere inside its subtree.
    if (dir && S.dragging.names.some((n) => {
      const src = join(S.dragging.dir, n);
      return dir === src || dir.startsWith(src + '/');
    })) dir = null;
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
      .closest('tr.fm-row, .fm-card, .fm-col-row, .fm-crumb, .fm-col, [data-drop-path]')
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
    if (drag.names.some((n) => {
      const src = join(drag.dir, n);
      return dir === src || dir.startsWith(src + '/');
    })) {
      toast('No se puede mover una carpeta dentro de sí misma', 'warn', '', 2500);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const mode = e.ctrlKey || e.altKey ? 'copy' : 'cut';
    const r = await transferItems(drag.names, drag.dir, dir, mode);
    journalTransfer(r, mode, drag.dir, dir);
    const n = r.moved.length + r.copied.length;
    if (n) toast(`${n} ${mode === 'cut' ? 'movido' : 'copiado'}${n === 1 ? '' : 's'} — Ctrl+Z deshace`, 'ok', '', 3000);
    if (r.failed.length && !r.errorsPresented) toast(`${r.failed.length} fallaron`, 'error', r.failed.slice(0, 4).join('\n'));
    if (r.skipped && !n && !r.failed.length) toast('Mismo origen y destino', 'warn', '', 2000);
    // Refresh whichever view holds the destination.
    if (S.view === 'cols') {
      // Source and destination may live in different columns — refresh all.
      for (const col of S.cols.filter((c) => c.path === dir || c.path === drag.dir)) {
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
  el('fm-nav').addEventListener('dragover', dndOver);
  el('fm-nav').addEventListener('drop', dndDrop);
  document.addEventListener('dragend', dndEnd);
  document.addEventListener('drop', dndEnd); // dropped outside → clear state

  // Trash location — resolved once; needed for in-trash behaviors.
  document.addEventListener('axon:authenticated', () => api('/api/files/trash/info').then(r => { S.trashDir = r.dir; S.trashDirs = r.dirs || [r.dir]; }).catch(() => {}), { once: true });
  // Location snapshots contain UI state only, never editor contents.
  const fileLocations = (() => { try { const d=JSON.parse(localStorage.getItem('axon:file-locations:v1') || '{}');return d && typeof d==='object' && !Array.isArray(d)?d:{}; } catch { return {}; } })();
  function fileParams() {
    if (sec.classList.contains('fm-cloud-mode')) return window.AxonDropbox.params();
    if (window.AxonExplorer?.pcActive) return { pc: '1' };
    return { mark:S.catalogMark||null,color:S.catalogColor||null,tag:S.catalogTag||null,kind:S.catalogKind||null,path: S.cwd || '~', view: S.view, sort: S.sort.key, order: S.sort.dir === 1 ? 'asc' : 'desc', q: (S.searchMode?S.searchQ:S.filter) || null, search:S.searchMode?'1':null, hidden: S.showHidden ? '1' : '0',
      item: S.editingPath?.split('/').pop() || S.preview?.name || null, edit: S.editingPath && documentMode === 'edit' ? '1' : null };
  }
  function captureFiles() {
    if (sec.classList.contains('fm-cloud-mode')) return window.AxonDropbox.capture();
    const scroll = {};
    for (const id of ['fm-table-wrap','fm-grid','fm-cols']) scroll[id] = [el(id).scrollLeft, el(id).scrollTop];
    const snapshot = { cursor: S.cursor, sel: [...S.sel].slice(0, 500), anchor: S.anchor, scroll,
      cols: S.cols.map((c,i) => ({path:c.path, sel:[...c.sel], top:el('fm-cols').children[i]?.scrollTop || 0})),
      focus: Boolean(document.activeElement?.closest('#tab-files [data-name]')) };
    if (S.cwd) {
      fileLocations[S.cwd] = snapshot;
      const keys = Object.keys(fileLocations);
      while (keys.length > 40) delete fileLocations[keys.shift()];
      try { localStorage.setItem('axon:file-locations:v1',JSON.stringify(fileLocations)); } catch { /* full storage */ }
    }
    return snapshot;
  }
  async function restoreFiles(params, snapshot) {
    if (S.editingPath && join(params.path || S.cwd, params.item || '') === S.editingPath && isDirty()) {
      setDocumentMode(params.edit === '1' ? 'edit' : 'read', false);
      return;
    }
    editorPreview?.destroy(); editorPreview = null;
    S.editingPath = null;
    closePreview(true);
    if (params.pc === '1' && window.AxonExplorer) { window.AxonDropbox?.hide(); await window.AxonExplorer.showPc(); window.AxonNavigation?.controls(); return; }
    window.AxonExplorer?.hidePc();
    if (['dropbox','gdrive','onedrive'].includes(params.source) && window.AxonCloud) { await window.AxonDropbox.restore(params, snapshot); return; }
    window.AxonDropbox?.hide();
    S.view = ['list','grid','cols'].includes(params.view) ? params.view : S.view;
    S.sort = {key:['name','size','mtime'].includes(params.sort) ? params.sort : S.sort.key, dir:params.order ? (params.order==='desc' ? -1 : 1) : S.sort.dir};
    S.showHidden = params.hidden ? params.hidden==='1' : S.showHidden;
    S.filter = params.search==='1' ? '' : params.q || '';
    el('fm-filter').value = S.filter;
    sec.querySelectorAll('.fm-vbtn[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===S.view));
    await navigate(params.path || '~', true);
    S.catalogMark=params.mark==='*'||Object.hasOwn(AxonFileCatalog.marks,params.mark||'')?params.mark:'';S.catalogColor=params.color||'';S.catalogTag=params.tag||'';S.catalogKind=['dir','file'].includes(params.kind)?params.kind:'';syncCatalogControls();render();
    await restoreTransfers();
    if (window.AxonNavigation.current.section !== 'files' || window.AxonNavigation.current.params !== params) return;
    snapshot ||= fileLocations[S.cwd];
    if (S.view==='cols' && snapshot?.cols?.length) {
      const stop=snapshot.cols.findIndex(c=>c.path===S.cwd);
      if (stop >= 0) {
        S.cols=[];
        for (const c of snapshot.cols.slice(0,stop+1)) { await drill(c.path,true); const col=S.cols.at(-1); if(col) col.sel=new Set(c.sel); }
        syncColCwd(); renderCols();
        snapshot.cols.slice(0,stop+1).forEach((c,i)=>{if(el('fm-cols').children[i]) el('fm-cols').children[i].scrollTop=c.top || 0;});
      }
    }
    if(params.search==='1'){toggleSearch(true);S.searchQ=params.q || '';el('fm-filter').value=S.searchQ;await runSearch();if(window.AxonNavigation.current.params!==params)return;}
    const available=new Set((S.searchMode?S.searchResults || []:S.entries).map(e=>e.name));
    S.sel=new Set((snapshot?.sel || []).filter(n=>available.has(n)));
    S.cursor=available.has(snapshot?.cursor) ? snapshot.cursor : null;
    S.anchor=snapshot?.anchor || null;
    if(S.view==='cols' && S.cols.length) S.cols.at(-1).sel=S.sel;
    applySelToDom();
    for(const [id,xy] of Object.entries(snapshot?.scroll || {})) { const node=el(id); if(node){node.scrollLeft=xy[0];node.scrollTop=xy[1];} }
    if(snapshot?.focus && S.cursor) sec.querySelector(`[data-name="${CSS.escape(S.cursor)}"]`)?.focus({preventScroll:true});
    if(params.item && !params.item.includes('/') && available.has(params.item)) {
      S.cursor=params.item;
      if(params.edit==='1' || markdownFile(params.item)) await openEditor(join(S.cwd,params.item),true,params.edit==='1' ? 'edit' : 'read'); else openPreview(params.item,true);
    }
    if(params.action==='upload') { el('fm-file-input').click(); }
    window.AxonNavigation.update('files',fileParams());
    window.AxonNavigation.controls();
  }
  window.AxonPages ||= {};
  window.AxonPages.files={capture:captureFiles,params:fileParams,restore:restoreFiles,dirty:isDirty,
    canLeave:async next=>{
      if(!isDirty() || (next.section==='files' && join(next.params.path || S.cwd,next.params.item || '')===S.editingPath)) return true;
      return confirmDialog('Cambios sin guardar','Si salís del editor se pierden los cambios de este archivo.','Salir sin guardar');
    }, leave:()=>{closePreview(true);editorPreview?.destroy();editorPreview=null;}};
  const address=sec.querySelector('.fm-address');
  const editLocation=()=>{address.classList.add('is-editing');el('fm-location').focus();el('fm-location').select();};
  const closeLocation=()=>{address.classList.remove('is-editing');el('fm-location').value=S.cwd;};
  el('fm-edit-location').addEventListener('click',editLocation);
  el('fm-location').addEventListener('blur',closeLocation);
  el('fm-location').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeLocation();el('fm-edit-location').focus();}});
  el('fm-location-form').addEventListener('submit',e=>{e.preventDefault();const path=el('fm-location').value.trim();closeLocation();navigate(path);});
  const createMenu=el('fm-create-menu');
  el('fm-create-btn').addEventListener('click',()=>{const rect=el('fm-create-btn').getBoundingClientRect();createMenu.style.top=`${rect.bottom+6}px`;createMenu.style.left=`${Math.max(8,Math.min(rect.right-210,innerWidth-218))}px`;});
  createMenu.addEventListener('click',e=>{if(e.target.closest('button'))createMenu.hidePopover();});
  // Only a real change of location dismisses the open dialog: the first route event of a page load (or a refresh of
  // the same URL) must not close a disks dialog the user just opened.
  let lastRouteUrl=null;
  document.addEventListener('axon:route',e=>{const url=e.detail?.url,changed=lastRouteUrl!==null&&url!==lastRouteUrl;lastRouteUrl=url;if(!changed)return;if(disksDialog.open)disksDialog.close();if(createMenu.matches(':popover-open'))createMenu.hidePopover();});
  el('fm-parent').addEventListener('click',()=>navigate(parentOf(S.cwd)));
  el('fm-keys').addEventListener('click',showHelp);
  document.addEventListener('keydown',e=>{
    if(!sec.classList.contains('active') || dormant() || document.querySelector('dialog[open], :popover-open')) return;
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='l'){e.preventDefault();editLocation();}
  });
  const saveLocation=()=>{if(!sec.classList.contains('active') || dormant())return;queueMicrotask(()=>{
    if(!window.AxonNavigation?.ready || window.AxonNavigation.applying) return;
    markCursor(); window.AxonNavigation.update('files',fileParams());
  });};
  sec.addEventListener('focusin',e=>{const row=e.target.closest('[data-name]');if(row){S.cursor=row.dataset.name;markCursor();saveLocation();}});
  ['click','keyup','input','change'].forEach(type=>sec.addEventListener(type,saveLocation));
  sec.addEventListener('scroll',saveLocation,{capture:true,passive:true});
  el('fm-grid').setAttribute('role','listbox');el('fm-grid').setAttribute('aria-label','Archivos');
  el('fm-grid').setAttribute('aria-multiselectable','true');
  el('fm-table').setAttribute('role','grid');el('fm-table').setAttribute('aria-label','Archivos');
  const oldRender=render; render=function(){oldRender(); markCursor();};
  window.AxonFilesLocal = { location:()=>S.cwd || S.home || '~', params:fileParams,
    // Surface used by the explorer shell (feat-explorer.js): navigation pane, gallery and menus.
    get cwd() { return S.cwd; }, get home() { return S.home; }, get volumes() { return S.volumes; }, get view() { return S.view; },
    get showHidden() { return S.showHidden; }, get clip() { return S.clip; },
    navigate, setView, toggleHidden, refreshVolumes, volumeAt, fmtSize, inTrash, folderMenu, mkdirIn, paste, setSort, syncCommandBar,
    iconFor, kindFor, entriesLoaded: () => S.entries.length, trashDirs: () => S.trashDirs || (S.trashDir ? [S.trashDir] : []),
    showTransfers: () => el('fm-transfers-btn').click(), openTrash: () => el('fm-trash').click(), showDisks: () => el('fm-disks-open').click(),
    setDrawer: (open) => setDrawer(open), toggleHelp: showHelp, showProps };
})();
