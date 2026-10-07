/* Shared, local viewer. The heavy PDF parser is loaded only on first open. */
(() => {
  const office = new Set('doc docx docm dot dotx odt ott rtf ppt pptx pptm pps ppsx pot potx odp otp xls xlsx xlsm xlt xltx ods ots'.split(' '));
  const ext = name => String(name).split('.').pop().toLowerCase();
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
    supports: name => office.has(ext(name)) || ['pdf', 'csv', 'tsv'].includes(ext(name)),
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
      let disposed = false, loading, pdf, renderTask, textLayer, resize, renderVersion = 0;
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
        status.hidden = true; root.removeAttribute('aria-busy');
        let number = 1, zoom = /\.(pptx?|pptm|ppsx?|potx?|odp|otp)$/i.test(options.name) ? 'fit' : 'width';
        const previous = button('Página anterior', '‹', () => go(number - 1));
        const pageInput = element('input'); pageInput.type = 'number'; pageInput.min = '1'; pageInput.max = String(pdf.numPages); pageInput.value = '1';
        pageInput.setAttribute('aria-label', 'Número de página'); controls.append(pageInput);
        const count = element('span', 'axon-doc-count', '/ ' + pdf.numPages); controls.append(count);
        const next = button('Página siguiente', '›', () => go(number + 1));
        const select = element('select'); select.setAttribute('aria-label', 'Zoom del documento');
        for (const [value, label] of [['width', 'Ancho'], ['fit', 'Página'], ['1', '100 %'], ['1.5', '150 %'], ['2', '200 %']]) {
          const o = element('option', '', label); o.value = value; select.append(o);
        }
        select.value = zoom;
        controls.append(select);
        select.addEventListener('change', () => { zoom = select.value; void render(); });
        button('Pantalla completa', '⛶', () => {
          if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
          else root.requestFullscreen?.().catch(() => { note.textContent = 'Este navegador no permite pantalla completa.'; });
        });
        pageInput.addEventListener('change', () => go(Number(pageInput.value)));
        function go(value) { number = Math.max(1, Math.min(pdf.numPages, Number.isFinite(value) ? Math.floor(value) : 1)); void render(); }
        async function render() {
          const version = ++renderVersion;
          renderTask?.cancel(); textLayer?.cancel();
          try {
            const page = await pdf.getPage(number);
            if (!active() || version !== renderVersion) return;
            pageInput.value = String(number); previous.disabled = number === 1; next.disabled = number === pdf.numPages;
            const base = page.getViewport({ scale: 1 });
            const scale = zoom === 'fit' ? Math.max(.1, Math.min((stage.clientWidth - 24) / base.width, (stage.clientHeight - 24) / base.height, 2))
              : zoom === 'width' ? Math.max(.1, Math.min((stage.clientWidth - 24) / base.width, 2)) : Number(zoom);
            const viewport = page.getViewport({ scale });
            // Bound canvas memory, including unusually large PDF page boxes.
            const ratio = Math.min(devicePixelRatio || 1, 2, 8192 / viewport.width, 8192 / viewport.height, Math.sqrt(16000000 / (viewport.width * viewport.height)));
            const sheet = element('div', 'axon-doc-page'); sheet.style.width = viewport.width + 'px'; sheet.style.height = viewport.height + 'px';
            sheet.style.setProperty('--total-scale-factor', scale); sheet.style.setProperty('--scale-factor', scale);
            const canvas = element('canvas'); canvas.width = Math.max(1, Math.floor(viewport.width * ratio)); canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
            canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
            canvas.setAttribute('aria-label', `Página ${number} de ${pdf.numPages} de ${options.name}`);
            const text = element('div', 'textLayer'); sheet.append(canvas, text); stage.replaceChildren(sheet);
            renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
            await renderTask.promise;
            if (!active() || version !== renderVersion) return;
            textLayer = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
            await textLayer.render();
            root.dataset.page = String(number); root.dataset.pages = String(pdf.numPages); root.dataset.rendered = 'true';
          } catch (e) { if (active() && version === renderVersion && e.name !== 'RenderingCancelledException' && e.name !== 'AbortException') fail('No se pudo dibujar esta página. Podés reintentar o descargar el original.'); }
        }
        resize = new ResizeObserver(() => { if (['fit', 'width'].includes(zoom) && active()) void render(); }); resize.observe(stage);
        root.addEventListener('keydown', e => {
          if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
          if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); go(number + 1); }
          else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); go(number - 1); }
        });
        await render();
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
      function stop() {
        if (disposed) return;
        disposed = true; abort.abort(); resize?.disconnect(); renderVersion++;
        renderTask?.cancel(); textLayer?.cancel();
        if (loading) loading.destroy().catch(() => {});
      }
      const start = ['csv', 'tsv'].includes(ext(options.name)) ? showTable() : showPdf();
      void start.catch(e => { if (active() && e.name !== 'AbortError') fail(e.message || 'No se pudo abrir el documento.'); });
      return { destroy: stop };
    },
  };
})();
