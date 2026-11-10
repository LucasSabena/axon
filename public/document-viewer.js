/* Shared, local viewer. The heavy PDF parser is loaded only on first open. */
(() => {
  const office = new Set('doc docx docm dot dotx odt ott rtf ppt pptx pptm pps ppsx pot potx odp otp xls xlsx xlsm xlt xltx ods ots'.split(' '));
  const ext = name => String(name).split('.').pop().toLowerCase();
  const isMarkdown = name => ['md', 'markdown'].includes(ext(name));
  let pdfFlight;
  function pdfLibrary() {
    return pdfFlight ||= import('/vendor/pdf.js?v=57456c8e0c81').then(pdf => {
      pdf.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.js?v=9536359f1b83';
      return pdf;
    }).catch(e => { pdfFlight = null; throw e; });
  }
  const element = (tag, cls, text) => {
    const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el;
  };
  window.AxonDocumentViewer = {
    isMarkdown,
    supports: name => isMarkdown(name) || office.has(ext(name)) || ['pdf', 'csv', 'tsv'].includes(ext(name)),
    mount(container, options) {
      const root = element('div', 'axon-doc');
      root.setAttribute('aria-label', 'Visor de ' + options.name);
      root.setAttribute('role', 'region'); root.setAttribute('aria-busy', 'true');
      root.tabIndex = 0;
      container.replaceChildren(root);
      const controls = element('div', 'axon-doc-controls');
      const status = element('div', 'axon-doc-status', 'Cargando documento…'); status.setAttribute('role', 'status');
      const stage = element('div', 'axon-doc-stage');
      stage.tabIndex = 0; stage.setAttribute('role', 'group'); stage.setAttribute('aria-label', 'Contenido del documento');
      const footer = element('div', 'axon-doc-footer');
      const note = element('span', '', office.has(ext(options.name)) ? 'Vista de lectura · el original se conserva' : 'Vista de lectura');
      const download = element('a', '', 'Descargar original'); download.href = options.downloadUrl;
      footer.append(note, download); root.append(controls, status, stage, footer);
      const abort = new AbortController();
      let disposed = false, loading, pdf, renderTask, textLayer, resize, renderVersion = 0, stopExtra = () => {};
      const active = () => !disposed && root.isConnected;
      const button = (label, text, run) => {
        const b = element('button', 'btn-secondary', text); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
        b.addEventListener('click', run); controls.append(b); return b;
      };
      const fail = message => {
        if (!active()) return;
        root.removeAttribute('aria-busy'); status.hidden = false; status.textContent = message;
        controls.replaceChildren(); stage.replaceChildren();
        button('Reintentar vista previa', 'Reintentar', () => { stop(); window.AxonDocumentViewer.mount(container, { ...options, retry: true }); });
      };
      const request = async (url, method = 'GET') => {
        const r = await fetch(url, { method, signal: abort.signal, credentials: 'same-origin', cache: 'no-store' });
        const data = await r.json(); if (!r.ok || !data.ok) throw new Error(data.error || 'No se pudo preparar el documento.'); return data;
      };
      async function prepare() {
        let url = options.documentUrl;
        if (options.retry) url += (url.includes('?') ? '&' : '?') + 'retry=1';
        let state = await request(url, 'POST');
        const deadline = Date.now() + 180000;
        while (active() && !['done', 'error'].includes(state.state)) {
          status.textContent = state.state === 'queued' ? 'Documento en cola…' : 'Preparando vista previa…';
          await new Promise((resolve, reject) => {
            const done = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', cancel); resolve(); };
            const cancel = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', cancel); reject(new DOMException('Aborted', 'AbortError')); };
            const timer = setTimeout(done, 750); abort.signal.addEventListener('abort', cancel, { once: true });
            if (abort.signal.aborted) cancel();
          });
          if (Date.now() > deadline) throw new Error('La preparación sigue en curso. Podés volver a abrir el archivo en unos segundos.');
          state = await request(options.documentUrl);
          if (state.state === 'none') throw new Error('El documento cambió durante la preparación. Reintentá la vista previa.');
        }
        if (state.state === 'error') throw new Error(state.error);
        return state;
      }
      async function showPdf() {
        root.setAttribute('aria-busy', 'true');
        const prepared = office.has(ext(options.name)) ? await prepare() : { url: options.sourceUrl, kind: 'pdf' };
        if (!active()) return;
        if (prepared.kind === 'table') {
          const r = await fetch(prepared.url, { signal: abort.signal, cache: 'no-store' });
          if (!r.ok) throw new Error('La planilla cambió. Reintentá la vista previa.');
          await showTable(await r.json()); root.removeAttribute('aria-busy'); return;
        }
        const lib = await pdfLibrary(), url = prepared.url;
        if (!active()) return;
        loading = lib.getDocument({ url, isEvalSupported: false, enableXfa: false,
          cMapUrl: '/vendor/pdf/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdf/standard_fonts/',
          wasmUrl: '/vendor/pdf/wasm/', iccUrl: '/vendor/pdf/iccs/', disableAutoFetch: true });
        loading.onPassword = (_update, reason) => { fail(reason === 1 ? 'Este PDF está protegido con contraseña. Descargalo para abrirlo.' : 'No se pudo desbloquear el PDF.'); loading.destroy().catch(() => {}); };
        pdf = await loading.promise;
        if (!active()) { await pdf.destroy(); return; }
        const total = pdf.numPages, first = (await pdf.getPage(1)).getViewport({ scale: 1 });
        if (!active()) return;
        status.hidden = true; root.removeAttribute('aria-busy'); root.classList.add('axon-doc-pdf');
        root.dataset.pages = String(total);
        const slides = /\.(pptx?|pptm|ppsx?|potx?|odp|otp)$/i.test(options.name);
        let number = 1, zoom = slides ? 'fit' : 'width', rotation = 0, scale = 1, quietUntil = 0;
        const sizes = new Array(total).fill(null); sizes[0] = { w: first.width, h: first.height };
        const group = () => { const g = element('div', 'axon-doc-group'); controls.append(g); return g; };
        const tool = (parent, label, glyph, fallback, run) => {
          const b = element('button', 'btn-secondary axon-doc-tool'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
          if (typeof icon === 'function') b.innerHTML = icon(glyph); else b.textContent = fallback;
          b.addEventListener('click', run); parent.append(b); return b;
        };
        // ---- Toolbar: thumbnails · pages · zoom · rotate · search · open/fullscreen
        const gSide = group(), gPages = group(), gZoom = group(), gFind = group(), gEnd = group();
        gEnd.classList.add('axon-doc-group-end');
        const sideBtn = tool(gSide, 'Miniaturas de páginas', 'panel-left', '▤', () => toggleSide());
        const previous = tool(gPages, 'Página anterior', 'chevron-left', '‹', () => go(number - 1));
        const pageInput = element('input'); pageInput.type = 'number'; pageInput.min = '1'; pageInput.max = String(total); pageInput.value = '1';
        pageInput.setAttribute('aria-label', 'Número de página'); gPages.append(pageInput);
        const count = element('span', 'axon-doc-count', '/ ' + total); gPages.append(count);
        const next = tool(gPages, 'Página siguiente', 'chevron-right', '›', () => go(number + 1));
        tool(gZoom, 'Alejar', 'zoom-out', '−', () => zoomBy(1 / 1.2));
        const select = element('select'); select.setAttribute('aria-label', 'Zoom del documento');
        const custom = element('option', '', ''); custom.value = 'custom'; custom.hidden = true;
        for (const [value, label] of [['width', 'Ajustar al ancho'], ['fit', 'Página completa'], ['0.5', '50 %'], ['0.75', '75 %'], ['1', '100 %'], ['1.25', '125 %'], ['1.5', '150 %'], ['2', '200 %'], ['3', '300 %'], ['4', '400 %']]) {
          const o = element('option', '', label); o.value = value; select.append(o);
        }
        select.append(custom); gZoom.append(select);
        tool(gZoom, 'Acercar', 'zoom-in', '+', () => zoomBy(1.2));
        tool(gZoom, 'Rotar página', 'rotate-cw', '⟳', () => { rotation = (rotation + 90) % 360; relayout(true); });
        const search = element('input'); search.type = 'search'; search.placeholder = 'Buscar en el PDF'; search.setAttribute('aria-label', 'Buscar en el PDF');
        gFind.append(search);
        const hitPrev = tool(gFind, 'Coincidencia anterior', 'chevron-up', '▲', () => stepHit(-1));
        const hitNext = tool(gFind, 'Coincidencia siguiente', 'chevron-down', '▼', () => stepHit(1));
        const hits = element('span', 'axon-doc-count axon-doc-hits'); gFind.append(hits); hitPrev.disabled = hitNext.disabled = true;
        tool(gEnd, 'Abrir en una pestaña nueva', 'external-link', '↗', () => window.open(url, '_blank', 'noopener'));
        tool(gEnd, 'Pantalla completa', 'maximize', '⛶', () => {
          if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
          else root.requestFullscreen?.().catch(() => { note.textContent = 'Este navegador no permite pantalla completa.'; });
        });
        if (typeof refreshIcons === 'function') refreshIcons(controls);
        // ---- Layout: optional thumbnail rail + continuous pages
        const body = element('div', 'axon-doc-body'), side = element('nav', 'axon-doc-thumbs');
        side.setAttribute('aria-label', 'Miniaturas'); stage.replaceWith(body); body.append(side, stage);
        stage.classList.add('axon-doc-scroll');
        const sheets = [], thumbs = [], painted = new Map(), textLayers = new Map();
        // Scroll only the viewer's own panes — scrollIntoView would also move the page behind it.
        const reveal = (box, el, center = false) => {
          const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
          if (center) { box.scrollTop += r.top - b.top - (b.height - r.height) / 2; if (r.left < b.left || r.right > b.right) box.scrollLeft += r.left - b.left - (b.width - r.width) / 2; }
          else if (r.top < b.top) box.scrollTop += r.top - b.top - 8; else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8;
        };
        for (let i = 0; i < total; i++) {
          const sheet = element('div', 'axon-doc-page'); sheet.dataset.page = String(i + 1); sheets.push(sheet); stage.append(sheet);
          const t = element('button', 'axon-doc-thumb'); t.type = 'button'; t.setAttribute('aria-label', 'Ir a la página ' + (i + 1));
          t.append(element('span', 'axon-doc-thumb-sheet'), element('small', '', String(i + 1)));
          t.addEventListener('click', () => go(i + 1)); thumbs.push(t); side.append(t);
        }
        const dims = i => { const s = sizes[i] || sizes[number - 1] || sizes[0]; return rotation % 180 ? { w: s.h, h: s.w } : s; };
        const fitScale = () => {
          const d = dims(number - 1), w = Math.max(80, stage.clientWidth - 32), h = Math.max(80, stage.clientHeight - 24);
          return zoom === 'fit' ? Math.min(w / d.w, h / d.h, 4) : zoom === 'width' ? Math.min(w / d.w, 4) : Number(zoom);
        };
        function syncZoomControl() {
          if ([...select.options].some(o => o.value === String(zoom) && o !== custom)) { select.value = String(zoom); custom.hidden = true; }
          else { custom.textContent = Math.round(scale * 100) + ' %'; custom.hidden = false; select.value = 'custom'; }
        }
        function sizeSheet(i) {
          const d = dims(i), sheet = sheets[i];
          sheet.style.width = Math.round(d.w * scale) + 'px'; sheet.style.height = Math.round(d.h * scale) + 'px';
          const ts = thumbs[i].firstChild, tw = 104; ts.style.width = tw + 'px'; ts.style.height = Math.round(tw * d.h / d.w) + 'px';
        }
        // Resizes every sheet at once; existing canvases stretch until redrawn so zooming never flashes blank.
        function relayout(force = false, anchor) {
          const before = scale, keep = anchor || { x: stage.clientWidth / 2, y: 0 };
          const ox = stage.scrollLeft + keep.x, oy = stage.scrollTop + keep.y;
          const pageTop = sheets[number - 1].offsetTop;
          scale = fitScale(); syncZoomControl();
          for (let i = 0; i < total; i++) sizeSheet(i);
          if (force) for (const i of [...painted.keys()]) painted.get(i).key = '';
          if (anchor) { const r = scale / before; stage.scrollLeft = ox * r - keep.x; stage.scrollTop = oy * r - keep.y; }
          else if (before !== scale || force) { quietUntil = Date.now() + 250; stage.scrollTop = sheets[number - 1].offsetTop - 8 + (stage.scrollTop - pageTop + 8) * (scale / before); }
          schedule();
        }
        function zoomBy(factor, anchor) { zoom = String(Math.max(0.1, Math.min(6, Math.round(scale * factor * 100) / 100))); relayout(false, anchor); }
        select.addEventListener('change', () => { if (select.value !== 'custom') { zoom = select.value; relayout(); } });
        // ---- Lazy page rendering: only pages near the viewport keep a canvas.
        const near = new Set();
        const io = new IntersectionObserver(entries => {
          for (const e of entries) { const i = Number(e.target.dataset.page) - 1; if (e.isIntersecting) near.add(i); else { near.delete(i); release(i); } }
          schedule();
        }, { root: stage, rootMargin: '120% 0px' });
        sheets.forEach(s => io.observe(s));
        let timer = 0, busy = false;
        function schedule() { clearTimeout(timer); timer = setTimeout(pump, 60); }
        async function pump() {
          if (busy || !active()) return; busy = true;
          try {
            const order = [...near].sort((a, b) => Math.abs(a - (number - 1)) - Math.abs(b - (number - 1)));
            for (const i of order) { if (!active()) return; await paint(i); }
          } finally { busy = false; }
          if ([...near].some(i => painted.get(i)?.key !== scale + '/' + rotation)) schedule();
        }
        function release(i) {
          const p = painted.get(i); if (!p) return;
          p.task?.cancel(); p.text?.cancel(); painted.delete(i); textLayers.delete(i);
          sheets[i].replaceChildren(); delete sheets[i].dataset.ready;
        }
        async function paint(i) {
          const key = scale + '/' + rotation, prev = painted.get(i);
          if (prev?.key === key) return;
          const page = await pdf.getPage(i + 1); if (!active()) return;
          const natural = page.getViewport({ scale: 1 });
          if (!sizes[i] || sizes[i].w !== natural.width || sizes[i].h !== natural.height) { sizes[i] = { w: natural.width, h: natural.height }; sizeSheet(i); }
          const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
          // Bound canvas memory, including unusually large PDF page boxes.
          const ratio = Math.min(devicePixelRatio || 1, 2, 8192 / viewport.width, 8192 / viewport.height, Math.sqrt(16000000 / (viewport.width * viewport.height)));
          const canvas = element('canvas'); canvas.width = Math.max(1, Math.floor(viewport.width * ratio)); canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
          canvas.setAttribute('aria-label', `Página ${i + 1} de ${total} de ${options.name}`);
          const entry = { key, task: page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] }) };
          prev?.task?.cancel(); prev?.text?.cancel(); painted.set(i, entry);
          try { await entry.task.promise; } catch (e) { if (painted.get(i) === entry) painted.delete(i); if (e?.name !== 'RenderingCancelledException') throw e; return; }
          if (!active() || painted.get(i) !== entry) return;
          const text = element('div', 'textLayer'); sheets[i].style.setProperty('--total-scale-factor', scale); sheets[i].style.setProperty('--scale-factor', scale);
          sheets[i].replaceChildren(canvas, text); sheets[i].dataset.ready = 'true';
          if (i === number - 1) { root.dataset.page = String(number); root.dataset.rendered = 'true'; }
          entry.text = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
          try { await entry.text.render(); } catch { return; }
          if (painted.get(i) !== entry) return;
          textLayers.set(i, text); highlight(i);
          if (thumbsOn && !thumbs[i].dataset.drawn) void drawThumb(i);
        }
        // ---- Thumbnails
        let thumbsOn = false;
        try { thumbsOn = localStorage.getItem('axon-doc-thumbs') === '1' || (localStorage.getItem('axon-doc-thumbs') == null && total > 1 && root.clientWidth >= 900); } catch {}
        const thumbIo = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) void drawThumb(thumbs.indexOf(e.target)); }, { root: side, rootMargin: '200px 0px' });
        thumbs.forEach(t => thumbIo.observe(t));
        async function drawThumb(i) {
          const t = thumbs[i]; if (!thumbsOn || !t || t.dataset.drawn) return; t.dataset.drawn = '1';
          try {
            const page = await pdf.getPage(i + 1); if (!active()) return;
            const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 }), viewport = page.getViewport({ scale: 208 / base.width, rotation: (page.rotate + rotation) % 360 });
            const c = element('canvas'); c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
            if (active()) t.firstChild.replaceChildren(c);
          } catch { delete t.dataset.drawn; }
        }
        function toggleSide(on = !thumbsOn) {
          thumbsOn = on; root.classList.toggle('axon-doc-side-on', on); sideBtn.classList.toggle('on', on); sideBtn.setAttribute('aria-pressed', String(on));
          try { localStorage.setItem('axon-doc-thumbs', on ? '1' : '0'); } catch {}
          if (on) { if (thumbs[number - 1]) reveal(side, thumbs[number - 1]); thumbs.forEach(t => { thumbIo.unobserve(t); thumbIo.observe(t); }); }
          if (['fit', 'width'].includes(zoom)) requestAnimationFrame(() => relayout());
        }
        // ---- Current page follows scrolling; buttons, input and keys jump.
        function setCurrent(n, fromScroll = false) {
          number = Math.max(1, Math.min(total, n));
          pageInput.value = String(number); previous.disabled = number === 1; next.disabled = number === total;
          root.dataset.page = String(number);
          thumbs.forEach((t, i) => t.classList.toggle('active', i === number - 1));
          if (thumbsOn && fromScroll) reveal(side, thumbs[number - 1]);
        }
        function go(value) {
          const n = Math.max(1, Math.min(total, Number.isFinite(value) ? Math.floor(value) : 1));
          setCurrent(n); quietUntil = Date.now() + 400;
          stage.scrollTop = sheets[n - 1].offsetTop - 8; if (thumbsOn) reveal(side, thumbs[n - 1]);
          schedule();
        }
        stage.addEventListener('scroll', () => {
          if (Date.now() < quietUntil) return;
          const line = stage.scrollTop + stage.clientHeight * 0.35;
          let n = 1; for (let i = 0; i < total; i++) { if (sheets[i].offsetTop <= line) n = i + 1; else break; }
          if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2) { for (let i = total - 1; i >= 0; i--) if (sheets[i].offsetTop >= stage.scrollTop) n = i + 1; else break; }
          if (n !== number) setCurrent(n, true);
        }, { passive: true });
        pageInput.addEventListener('change', () => go(Number(pageInput.value)));
        // Ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer.
        stage.addEventListener('wheel', e => {
          if (!e.ctrlKey && !e.metaKey) return; e.preventDefault();
          const r = stage.getBoundingClientRect();
          zoomBy(Math.exp(-e.deltaY * 0.0025), { x: e.clientX - r.left, y: e.clientY - r.top });
        }, { passive: false });
        root.addEventListener('keydown', e => {
          if (e.target === search) {
            if (e.key === 'Enter') { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); }
            else if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; runSearch(''); }
            return;
          }
          if ((e.ctrlKey || e.metaKey) && ['=', '+', '-', '0', 'f'].includes(e.key.toLowerCase())) {
            e.preventDefault(); e.stopPropagation();
            if (e.key.toLowerCase() === 'f') { search.focus(); search.select(); }
            else if (e.key === '0') { zoom = slides ? 'fit' : 'width'; relayout(); }
            else zoomBy(e.key === '-' ? 1 / 1.2 : 1.2);
            return;
          }
          if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
          if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); go(number + 1); }
          else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); go(number - 1); }
          else if (e.key === 'Home' && e.target !== stage) { e.preventDefault(); go(1); }
          else if (e.key === 'End' && e.target !== stage) { e.preventDefault(); go(total); }
        });
        // ---- Search across every page, with highlights in the text layer.
        const pageText = new Map();
        const textOf = i => { if (!pageText.has(i)) pageText.set(i, pdf.getPage(i + 1).then(p => p.getTextContent()).then(c => c.items.map(it => it.str || '').join('').toLocaleLowerCase()).catch(() => '')); return pageText.get(i); };
        let query = '', matches = [], current = -1, searchRun = 0, searchTimer = 0;
        search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(search.value), 250); });
        async function runSearch(value) {
          const run = ++searchRun; query = value.trim().toLocaleLowerCase(); matches = []; current = -1;
          hitPrev.disabled = hitNext.disabled = true; hits.textContent = query ? 'Buscando…' : '';
          for (const i of textLayers.keys()) highlight(i);
          if (!query) return;
          for (let i = 0; i < total; i++) {
            const str = await textOf(i); if (run !== searchRun || !active()) return;
            for (let at = str.indexOf(query); at !== -1; at = str.indexOf(query, at + query.length)) matches.push({ page: i, at });
            if (current < 0 && matches.length && matches.at(-1).page >= number - 1) { current = matches.findIndex(m => m.page >= number - 1); showHit(); }
            if (i % 20 === 19) hits.textContent = `${matches.length} · buscando…`;
          }
          if (current < 0 && matches.length) { current = 0; showHit(); }
          hits.textContent = matches.length ? `${current + 1} / ${matches.length}` : 'Sin resultados';
          hitPrev.disabled = hitNext.disabled = matches.length < 2;
          for (const i of textLayers.keys()) highlight(i);
        }
        function stepHit(d) { if (!matches.length) return; current = (current + d + matches.length) % matches.length; hits.textContent = `${current + 1} / ${matches.length}`; showHit(); }
        function showHit() {
          const m = matches[current]; if (!m) return;
          if (m.page !== number - 1 || !textLayers.has(m.page)) go(m.page + 1);
          for (const i of textLayers.keys()) highlight(i);
        }
        function highlight(i) {
          const layer = textLayers.get(i); if (!layer) return;
          const spans = [...layer.querySelectorAll('span:not(.markedContent)')].filter(s => !s.querySelector('span'));
          let offset = 0; const runs = spans.map(s => { const text = s.dataset.text ??= s.textContent; const r = { s, text, start: offset }; offset += text.length; return r; });
          for (const r of runs) if (r.s.querySelector('mark')) r.s.textContent = r.text;
          if (!query) return;
          const own = matches.map((m, n) => ({ ...m, n })).filter(m => m.page === i);
          let focus = null;
          for (const r of runs) {
            const cuts = own.filter(m => m.at < r.start + r.text.length && m.at + query.length > r.start);
            if (!cuts.length) continue;
            r.s.replaceChildren(); let pos = 0;
            for (const m of cuts) {
              const a = Math.max(0, m.at - r.start), b = Math.min(r.text.length, m.at + query.length - r.start);
              if (a > pos) r.s.append(r.text.slice(pos, a));
              const mark = element('mark', 'axon-doc-hit' + (m.n === current ? ' current' : ''), r.text.slice(a, b)); r.s.append(mark);
              if (m.n === current && !focus) focus = mark; pos = b;
            }
            if (pos < r.text.length) r.s.append(r.text.slice(pos));
          }
          if (focus) { quietUntil = Date.now() + 400; reveal(stage, focus, true); }
        }
        resize = new ResizeObserver(() => { if (['fit', 'width'].includes(zoom) && active()) relayout(); }); resize.observe(stage);
        const cleanup = stopExtra; stopExtra = () => { cleanup(); io.disconnect(); thumbIo.disconnect(); clearTimeout(timer); clearTimeout(searchTimer); for (const p of painted.values()) { p.task?.cancel(); p.text?.cancel(); } };
        toggleSide(thumbsOn); scale = fitScale(); for (let i = 0; i < total; i++) sizeSheet(i); syncZoomControl(); setCurrent(1);
        await paint(0);
      }
      async function showTable(workbook = null) {
        let parsed, encoding = '', sheets, csvText, csvParser;
        if (workbook) {
          sheets = workbook.sheets;
          if (!Array.isArray(sheets) || !sheets.length) throw new Error('No se encontraron hojas en la planilla.');
          parsed = { rows: sheets[0].rows, truncated: workbook.truncated };
        } else {
          const lib = await import('/document-table.js?v=ddc187f237fd');
          const response = await fetch(options.sourceUrl, { signal: abort.signal, cache: 'no-store' });
          const data = await lib.readTable(response, abort.signal); encoding = data.encoding; csvText = data.text; csvParser = lib.parseDelimited;
          parsed = lib.parseDelimited(data.text, ext(options.name) === 'tsv' ? '\t' : '');
        }
        if (!active()) return;
        status.hidden = true;
        let page = 0, filtered = parsed.rows.map((row, i) => ({ row, index: i + 1 }));
        if (sheets) {
          const selector = element('select'); selector.setAttribute('aria-label', 'Hoja de la planilla');
          sheets.forEach((sheet, i) => { const option = element('option', '', sheet.name); option.value = String(i); selector.append(option); });
          selector.addEventListener('change', () => { parsed.rows = sheets[Number(selector.value)].rows; search.value = ''; applyFilter(); });
          controls.append(selector);
        } else {
          const separator = element('select'); separator.setAttribute('aria-label', 'Separador de columnas');
          for (const [value, label] of [[',', 'Coma'], [';', 'Punto y coma'], ['\t', 'Tabulación']]) {
            const option = element('option', '', label); option.value = value; separator.append(option);
          }
          separator.value = parsed.separator;
          separator.addEventListener('change', () => { try { parsed = csvParser(csvText, separator.value); applyFilter(); } catch (e) { fail(e.message); } });
          controls.append(separator);
        }
        const previous = button('Filas anteriores', '‹', () => { page--; draw(); });
        const info = element('span', 'axon-doc-count'); controls.append(info);
        const next = button('Filas siguientes', '›', () => { page++; draw(); });
        const search = element('input'); search.type = 'search'; search.placeholder = 'Buscar en la tabla'; search.setAttribute('aria-label', 'Buscar en la tabla'); controls.append(search);
        function applyFilter() { const q = search.value.toLocaleLowerCase(); filtered = parsed.rows.map((row, i) => ({ row, index: i + 1 })).filter(x => x.row.some(c => c.toLocaleLowerCase().includes(q))); page = 0; draw(); }
        search.addEventListener('input', applyFilter);
        stage.classList.add('axon-doc-table-stage');
        const column = n => { let label = ''; do { label = String.fromCharCode(65 + n % 26) + label; n = Math.floor(n / 26) - 1; } while (n >= 0); return label; };
        function draw() {
          note.textContent = `${parsed.rows.length.toLocaleString('es')} filas${encoding ? ' · ' + encoding : ' · valores de lectura'}${parsed.truncated ? ' · Vista limitada: hasta 50 hojas, 10.000 filas, 100 columnas y 100.000 celdas' : ''}`;
          const from = page * 100, visible = filtered.slice(from, from + 100);
          previous.disabled = page === 0; next.disabled = from + 100 >= filtered.length;
          info.textContent = filtered.length ? `${from + 1}–${Math.min(from + 100, filtered.length)} / ${filtered.length}` : 'Sin filas';
          const table = element('table', 'axon-doc-table'); table.setAttribute('aria-label', options.name);
          const head = element('thead'), tr = element('tr'); tr.append(element('th', '', '#'));
          const columns = Math.max(0, ...visible.map(x => x.row.length));
          for (let i = 0; i < columns; i++) { const th = element('th', '', column(i)); th.scope = 'col'; tr.append(th); }
          head.append(tr); table.append(head); const body = element('tbody');
          for (const { row, index } of visible) { const tr = element('tr'); const th = element('th', '', index); th.scope = 'row'; tr.append(th); for (let i = 0; i < columns; i++) tr.append(element('td', '', row[i] || '')); body.append(tr); }
          table.append(body); stage.replaceChildren(table); root.dataset.rendered = 'true';
        }
        draw(); root.removeAttribute('aria-busy');
      }
      async function showMarkdown() {
        let data = { content: options.content, truncated: options.truncated, binary: options.binary };
        if (options.content == null) {
          if (options.textUrl) data = await request(options.textUrl);
          else {
            const response = await fetch(options.sourceUrl, { signal: abort.signal, credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) throw new Error('No se pudo leer el archivo.');
            const reader = response.body.getReader(), chunks = []; let size = 0;
            const limit = 512 * 1024;
            while (size <= limit) {
              const { done, value } = await reader.read(); if (done) break;
              const take = value.subarray(0, limit + 1 - size); chunks.push(take); size += take.length;
            }
            await reader.cancel();
            data.truncated = size > limit;
            const bytes = new Uint8Array(Math.min(size, limit)); let offset = 0;
            for (const chunk of chunks) { const take = chunk.subarray(0, bytes.length - offset); bytes.set(take, offset); offset += take.length; }
            // Streaming decode ignores an incomplete final character in a limited view.
            data.content = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: data.truncated });
          }
        }
        if (data.binary || String(data.content || '').includes('\u0000')) throw new Error('Archivo binario o codificación distinta de UTF-8 — sin vista Markdown.');
        const lib = await import('/vendor/markdown.js?v=f75ea506309f');
        if (!active()) return;
        stage.classList.add('axon-doc-markdown-stage');
        const article = element('article', 'axon-markdown'); article.setAttribute('aria-label', options.name);
        lib.renderMarkdown(article, data.content || '', { path: options.path, signal: abort.signal });
        if (!String(data.content || '').trim()) article.append(element('p', 'axon-markdown-empty', 'Este archivo está vacío.'));
        stage.replaceChildren(article);
        note.textContent = data.truncated ? 'Vista limitada a los primeros 512 KB' : options.note || 'Vista de lectura';
        button('Pantalla completa', '⛶', () => {
          if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
          else root.requestFullscreen?.().catch(() => { note.textContent = 'Este navegador no permite pantalla completa.'; });
        });
        status.hidden = true; root.removeAttribute('aria-busy'); root.dataset.rendered = 'true';
      }
      function stop() {
        if (disposed) return;
        disposed = true; abort.abort(); resize?.disconnect(); renderVersion++; stopExtra();
        renderTask?.cancel(); textLayer?.cancel();
        if (loading) loading.destroy().catch(() => {});
        root.remove();
      }
      const start = isMarkdown(options.name) ? showMarkdown() : ['csv', 'tsv'].includes(ext(options.name)) ? showTable() : showPdf();
      void start.catch(e => { if (active() && e.name !== 'AbortError') fail(e.message || 'No se pudo abrir el documento.'); });
      return { destroy: stop };
    },
  };
})();
