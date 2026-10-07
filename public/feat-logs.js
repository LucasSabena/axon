/* AXON — feature: Logs en vivo
   Tab "Logs": tail -f / journalctl / docker logs sobre /ws/logs, renderizado
   en un pane xterm (mismo vendor que la terminal). Se auto-contiene: inyecta
   su <section>, su botón de nav y su CSS. Cierra el WS al salir del tab y lo
   retoma al volver solo si estaba conectado.
   Seguridad: todo el output pasa por un filtro que conserva solo SGR (color)
   y descarta el resto de secuencias de escape — el host nunca puede mover el
   cursor, borrar el scrollback ni inyectar OSC (portapapeles/título/links). */
(() => {
'use strict';
if (document.getElementById('tab-logs')) return;

// ---------- Scoped styles ----------
const style = document.createElement('style');
style.textContent = `
.content:has(> #tab-logs.active) { padding: 0; overflow: hidden; }
#tab-logs.tab-content.active {
  display: flex; flex-direction: column;
  height: calc(100vh - var(--header-h)); height: calc(100dvh - var(--header-h));
  max-width: none; padding: 0;
}
#tab-logs .logs-toolbar {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 8px 10px; border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
#tab-logs .logs-src { min-width: 200px; max-width: 300px; }
#tab-logs select.filter-input { appearance: auto; }
#tab-logs .logs-search { min-width: 0; width: 150px; }
#tab-logs .logs-filter { min-width: 0; width: 110px; }
#tab-logs .logs-prio { width: auto; }
#tab-logs .logs-sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; flex-shrink: 0; }
#tab-logs .logs-count { color: var(--text-faint); font-size: 0.76rem; font-family: var(--font-mono); min-width: 34px; }
#tab-logs .logs-toggle-on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
#tab-logs .hidden { display: none !important; }
#logs-pane { flex: 1; min-height: 0; background: var(--bg-canvas, #0b0e14); padding: 6px; }
#logs-pane .xterm { height: 100%; }
`;
document.head.appendChild(style);

// ---------- DOM ----------
const section = document.createElement('section');
section.id = 'tab-logs';
section.className = 'tab-content';
section.innerHTML = `
  <div class="logs-toolbar">
    <span class="logs-status logs-status-disconnected" id="logs-status" role="status" aria-live="polite">Desconectado</span>
    <select id="logs-src" aria-label="Fuente de logs" class="filter-input logs-src"><option value="">Cargando fuentes…</option></select>
    <input type="text" id="logs-custom" aria-label="Ruta del archivo de logs" class="filter-input hidden" placeholder="/ruta/al/archivo.log">
    <button id="logs-connect" class="btn-primary"><i data-lucide="play" class="lucide-icon"></i> Conectar</button>
    <button id="logs-reconnect" class="btn-action hidden"><i data-lucide="rotate-cw" class="lucide-icon"></i> Reconectar</button>
    <span class="logs-sep"></span>
    <input type="text" id="logs-since" aria-label="Desde (ej: 1h, 2024-01-01)" class="filter-input logs-filter" placeholder="Desde: 1h" title="Filtro server-side --since (journal/docker): 30m, 2h, 2024-01-01, yesterday…">
    <select id="logs-prio" aria-label="Severidad mínima" class="filter-input logs-prio hidden" title="Severidad mínima (solo journal)">
      <option value="">Nivel: todos</option><option value="err">err+</option><option value="warning">warning+</option><option value="notice">notice+</option><option value="info">info+</option><option value="debug">debug</option>
    </select>
    <input type="text" id="logs-grep" aria-label="Filtrar líneas (regex)" class="filter-input logs-filter" placeholder="Filtrar: regex" title="Filtro server-side (grep -E): solo llegan al pane las líneas que coinciden">
    <button id="logs-hist" class="btn-secondary" title="Solo histórico: carga el tail sin seguir en vivo"><i data-lucide="history" class="lucide-icon"></i></button>
    <span class="logs-sep"></span>
    <button id="logs-pause" class="btn-secondary" title="Pausar"><i data-lucide="pause" class="lucide-icon"></i></button>
    <button id="logs-clear" class="btn-secondary" title="Limpiar"><i data-lucide="eraser" class="lucide-icon"></i></button>
    <button id="logs-follow" class="btn-secondary logs-toggle-on" title="Seguir abajo"><i data-lucide="arrow-down-to-line" class="lucide-icon"></i></button>
    <button id="logs-export" class="btn-secondary" title="Exportar el buffer visible"><i data-lucide="download" class="lucide-icon"></i></button>
    <span class="logs-sep"></span>
    <input type="text" id="logs-search" aria-label="Buscar en los logs" class="filter-input logs-search" placeholder="Buscar…">
    <button id="logs-prev" class="btn-secondary" title="Anterior"><i data-lucide="chevron-up" class="lucide-icon"></i></button>
    <button id="logs-next" class="btn-secondary" title="Siguiente"><i data-lucide="chevron-down" class="lucide-icon"></i></button>
    <span id="logs-match-count" class="logs-count" aria-live="polite"></span>
  </div>
  <div id="logs-pane"></div>`;
document.querySelector('main.content')?.appendChild(section);

// Nav button — replicates app.js tab switching (its listener only bound to
// the buttons that existed when app.js ran).
const navBtn = document.createElement('button');
navBtn.className = 'nav-item tab-btn';
navBtn.dataset.tab = 'logs';
navBtn.innerHTML = '<i data-lucide="scroll-text" class="lucide-icon"></i><span class="nav-label">Logs</span>';
const navAnchor = document.querySelector('.nav-item[data-tab="navegador"]')
  || document.querySelector('.nav-item[data-tab="terminal"]');
if (navAnchor) navAnchor.insertAdjacentElement('afterend', navBtn);
else document.querySelector('.sidebar-nav')?.appendChild(navBtn);
navBtn.addEventListener('click', () => {
  if (document.querySelector('.tab-btn[data-tab="navegador"]')?.classList.contains('active')) {
    try { unloadBrowser(); } catch { /* not loaded yet */ }
  }
  $$('.tab-btn').forEach((b) => b.classList.remove('active'));
  $$('.tab-content').forEach((t) => t.classList.remove('active'));
  navBtn.classList.add('active');
  section.classList.add('active');
  loaders.logs?.();
});

// ---------- ANSI sanitizer ----------
// Byte stream → text with only safe SGR sequences kept. Escape sequences can
// split across chunks, so the filter is stateful: a trailing partial sequence
// is carried into the next chunk (bounded — hostile unterminated OSC is cut).
const MAX_CARRY = 4096;
function createLogFilter() {
  const dec = new TextDecoder('utf-8');
  let carry = '';
  return (chunk) => {
    const s = carry + (typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true }));
    carry = '';
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\x1b') {
        if (i + 1 >= s.length) { carry = s.slice(i); break; }
        const t = s[i + 1];
        if (t === '[') {
          // CSI: params/intermediates, final byte 0x40–0x7E. Keep SGR only.
          let j = i + 2;
          while (j < s.length && !(s.charCodeAt(j) >= 0x40 && s.charCodeAt(j) <= 0x7e)) j++;
          if (j >= s.length) { carry = s.slice(i); break; }
          const seq = s.slice(i, j + 1);
          if (/^\x1b\[[0-9;:]*m$/.test(seq)) out += seq;
          i = j + 1;
        } else if (t === ']' || t === 'P' || t === '_' || t === '^' || t === 'X') {
          // OSC/DCS/APC/PM/SOS: drop until BEL or ST (ESC \).
          let j = i + 2; let end = -1;
          while (j < s.length) {
            if (s[j] === '\x07') { end = j + 1; break; }
            if (s[j] === '\x1b') {
              if (j + 1 >= s.length) { carry = s.slice(i); i = s.length; break; }
              end = s[j + 1] === '\\' ? j + 2 : j; // unterminated → reprocess ESC
              break;
            }
            j++;
          }
          if (carry) break;
          if (end < 0) { carry = s.slice(i); break; }
          i = end;
        } else if ('()*+-./'.includes(t)) {
          // Charset designation ESC <t> <final> — 3 bytes, drop.
          if (i + 2 >= s.length) { carry = s.slice(i); break; }
          i += 3;
        } else {
          i += 2; // two-byte escape — drop
        }
      } else {
        const code = c.charCodeAt(0);
        if (c === '\n' || c === '\r' || c === '\t') out += c;
        else if (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)) out += c;
        i++;
      }
    }
    if (carry.length > MAX_CARRY) carry = ''; // unterminated hostile seq — drop
    return out;
  };
}
let logFilter = createLogFilter();

// ---------- State ----------
let term = null;
let fit = null;
let ws = null;
let connectGen = 0;
let lastSrc = '';
let lastLabel = '';
let resumeOnReturn = false;
let paused = false;
const pausedBuf = [];
let pausedBytes = 0;
let pausedDropped = 0;
const PAUSED_CAP = 512 * 1024;
let follow = true;
let historic = false;
let searchMatches = [];
let searchIdx = -1;
let searchDecos = [];
let matchDeco = null;
let retryCount = 0;
let retryTimer = null;
const RETRY_MAX = 5;

function ensureTerm() {
  if (term) return;
  const css = getComputedStyle(document.body);
  const bg = css.getPropertyValue('--bg-canvas').trim() || '#0b0e14';
  const mono = css.getPropertyValue('--font-mono').trim() || 'JetBrains Mono, monospace';
  term = new Terminal({
    cursorBlink: false,
    disableStdin: true,
    convertEol: true,
    fontSize: 13,
    fontFamily: mono,
    theme: { background: bg },
    scrollback: 5000,
    // registerMarker/registerDecoration (resaltado de búsqueda) son API
    // "proposed" en xterm.js — sin esto tiran y abortan la búsqueda.
    allowProposedApi: true,
  });
  fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('logs-pane'));
}

function setStatus(state, text) {
  const el = document.getElementById('logs-status');
  el.className = `logs-status logs-status-${state}`;
  el.textContent = text;
}

// ---------- WebSocket ----------
function clearRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

function closeWs() {
  const s = ws;
  ws = null;
  if (s) { try { s.close(); } catch { /* gone */ } }
}

function collectOpts() {
  const o = {};
  const since = document.getElementById('logs-since').value.trim();
  const grep = document.getElementById('logs-grep').value.trim();
  const prio = document.getElementById('logs-prio').value;
  if (since) o.since = since;
  if (grep) o.grep = grep;
  if (prio) o.priority = prio;
  if (historic) o.follow = false;
  return Object.keys(o).length ? o : null;
}

function resolveSrc() {
  const v = document.getElementById('logs-src').value;
  const custom = document.getElementById('logs-custom').value.trim();
  let spec = v;
  if (v === '__file__') spec = custom ? `file:${custom}` : '';
  else if (v === '__sysunit__') spec = custom ? `journal:sys:${custom}` : '';
  if (!spec) return { src: '', label: '' };
  const opts = collectOpts();
  return { src: spec + (opts ? `||${JSON.stringify(opts)}` : ''), label: spec };
}

function emit(data) {
  const text = logFilter(data);
  if (!text) return;
  term?.write(text);
  if (follow) term?.scrollToBottom();
}

function openSocket(src) {
  const gen = connectGen;
  logFilter = createLogFilter(); // no partial-sequence carry across sources
  setStatus('connecting', retryCount ? `Reconectando (${retryCount}/${RETRY_MAX})…` : 'Conectando…');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws/logs?src=${encodeURIComponent(src)}`);
  ws = sock;
  sock.binaryType = 'arraybuffer';
  sock.onopen = () => {
    if (ws !== sock) { try { sock.close(); } catch { /* gone */ } return; }
    retryCount = 0;
    setStatus('connected', 'Conectado');
    document.getElementById('logs-reconnect').classList.add('hidden');
    ensureTerm();
    // Banner delimits the source — and each reconnect — inside the stream.
    // lastLabel is user input: strip control chars before writing it raw.
    const shown = lastLabel.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
    term.write(`\x1b[2m—— ${shown} · ${new Date().toLocaleTimeString()} ——\x1b[0m\r\n`);
    requestAnimationFrame(() => fit?.fit());
  };
  sock.onmessage = (e) => {
    if (ws !== sock) { try { sock.close(); } catch { /* gone */ } return; }
    const data = typeof e.data === 'string' ? e.data : new Uint8Array(e.data);
    if (paused) {
      const size = typeof data === 'string' ? data.length : data.byteLength;
      pausedBuf.push(data);
      pausedBytes += size;
      while (pausedBytes > PAUSED_CAP && pausedBuf.length > 1) {
        const d = pausedBuf.shift();
        pausedDropped++;
        pausedBytes -= typeof d === 'string' ? d.length : d.byteLength;
      }
      if (pausedDropped) {
        document.getElementById('logs-pause').title = `Reanudar (${pausedDropped} fragmentos descartados por límite de buffer)`;
      }
      return;
    }
    emit(data);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    // Unexpected drop while the tab is visible → auto-reconnect with backoff.
    // Leaving the tab goes through closeWs() first (ws=null), so it can't
    // reach this branch; historic mode exits quietly without cycling.
    if (section.classList.contains('active') && lastSrc && retryCount < RETRY_MAX) {
      retryCount++;
      const delay = Math.min(15000, 1000 * 2 ** (retryCount - 1));
      setStatus('connecting', `Reconectando en ${Math.round(delay / 1000)}s (${retryCount}/${RETRY_MAX})…`);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!ws && section.classList.contains('active') && gen === connectGen) openSocket(lastSrc);
      }, delay);
      return;
    }
    setStatus('disconnected', 'Desconectado');
    if (lastSrc) document.getElementById('logs-reconnect').classList.remove('hidden');
  };
  sock.onerror = () => { /* onclose follows */ };
}

async function connect(src, label) {
  clearRetry();
  retryCount = 0;
  closeWs();
  const gen = ++connectGen;
  if (!src) return;
  try { await AxonAssets.terminal(); ensureTerm(); }
  catch (err) { setStatus('disconnected', err.message); errToast(err); return; }
  if (gen !== connectGen) return; // a newer connect() superseded this one
  if (!section.classList.contains('active')) { lastSrc = src; lastLabel = label || src; resumeOnReturn = true; return; } // tab left while awaiting assets
  // Preflight: a denied upgrade (file: fuera de la allowlist, filtro inválido)
  // llega al WS solo como un close genérico — chequear antes para explicarlo.
  try {
    const chk = await api(`/api/logs/check?src=${encodeURIComponent(src)}`);
    if (gen !== connectGen) return;
    if (chk && chk.ok === false) { setStatus('disconnected', 'Fuente inválida'); toast(chk.error || 'Fuente inválida', 'warn'); return; }
  } catch { /* preflight opcional — intentar el WS igual */ }
  lastSrc = src;
  lastLabel = label || src;
  openSocket(src);
}

// ---------- Sources ----------
function addOpt(group, value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  group.appendChild(o);
}

async function loadSources() {
  const sel = document.getElementById('logs-src');
  const prev = sel.value;
  sel.innerHTML = '<option value="">Elegir fuente…</option>';
  try {
    const res = await api('/api/logs/sources');
    if (res.units?.length) {
      const g = document.createElement('optgroup');
      g.label = 'Journal (usuario)';
      for (const u of res.units) addOpt(g, `journal:${u}`, u);
      sel.appendChild(g);
    }
    if (res.systemUnits?.length) {
      const g = document.createElement('optgroup');
      g.label = 'Journal (sistema)';
      for (const u of res.systemUnits) addOpt(g, `journal:sys:${u}`, u);
      sel.appendChild(g);
    }
    if (res.fileRoots?.length) {
      const custom = document.getElementById('logs-custom');
      custom.dataset.roots = res.fileRoots.join(', ');
    }
  } catch { /* sin unidades */ }
  try {
    const { containers } = await api('/api/docker');
    if (containers?.length) {
      const g = document.createElement('optgroup');
      g.label = 'Docker';
      for (const ct of containers) {
        const name = (ct.names || '').split(',')[0] || ct.id;
        addOpt(g, `docker:${name}`, `${ct.names || name} (${ct.id})`);
      }
      sel.appendChild(g);
    }
  } catch { /* sin docker */ }
  const g = document.createElement('optgroup');
  g.label = 'Otro';
  addOpt(g, '__sysunit__', 'Journal sistema: unidad…');
  addOpt(g, '__file__', 'Archivo…');
  sel.appendChild(g);
  if (Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
  onSrcChange();
}

function onSrcChange() {
  const v = document.getElementById('logs-src').value;
  const custom = document.getElementById('logs-custom');
  const needsInput = v === '__file__' || v === '__sysunit__';
  custom.classList.toggle('hidden', !needsInput);
  document.getElementById('logs-prio').classList.toggle('hidden', !(v.startsWith('journal:') || v === '__sysunit__'));
  if (needsInput) {
    custom.placeholder = v === '__sysunit__'
      ? 'unidad.service (journal de sistema)'
      : `/ruta/al/archivo.log (${custom.dataset.roots || '/var/log/…'})`;
    custom.focus();
  }
}

// ---------- Search ----------
function disposeDecos() {
  for (const d of searchDecos) { try { d.dispose(); } catch { /* gone */ } }
  searchDecos = [];
  try { matchDeco?.dispose(); } catch { /* gone */ }
  matchDeco = null;
}

function markCurrent() {
  try { matchDeco?.dispose(); } catch { /* gone */ }
  matchDeco = null;
  if (!term || searchIdx < 0 || !searchMatches.length) return;
  const buf = term.buffer.active;
  const lineNo = searchMatches[searchIdx];
  const q = document.getElementById('logs-search').value.trim().toLowerCase();
  const line = buf.getLine(lineNo)?.translateToString(true) || '';
  const col = line.toLowerCase().indexOf(q);
  const marker = term.registerMarker(lineNo - buf.baseY - buf.cursorY);
  if (!marker) return;
  matchDeco = term.registerDecoration({
    marker,
    x: Math.max(0, col),
    width: Math.max(1, q.length),
    backgroundColor: '#f0b429',
    foregroundColor: '#000000',
    layer: 'top',
  });
}

function runSearch() {
  const q = document.getElementById('logs-search').value.trim().toLowerCase();
  disposeDecos();
  searchMatches = [];
  searchIdx = -1;
  if (term && q) {
    const buf = term.buffer.active;
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i)?.translateToString(true) || '';
      if (line.toLowerCase().includes(q)) searchMatches.push(i);
    }
    // Overview-ruler ticks for every match (capped — thousands of markers
    // would cost more than they help).
    for (const lineNo of searchMatches.slice(0, 1000)) {
      const marker = term.registerMarker(lineNo - buf.baseY - buf.cursorY);
      if (!marker) continue;
      const d = term.registerDecoration({ marker, overviewRulerOptions: { color: '#f0b429', position: 'center' } });
      if (d) searchDecos.push(d);
    }
  }
  const count = document.getElementById('logs-match-count');
  count.textContent = searchMatches.length ? `/${searchMatches.length}` : (q ? '0' : '');
  if (searchMatches.length) jumpTo(0);
}

function jumpTo(idx) {
  if (!searchMatches.length) return;
  searchIdx = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
  term.scrollToLine(searchMatches[searchIdx]);
  document.getElementById('logs-match-count').textContent = `${searchIdx + 1}/${searchMatches.length}`;
  markCurrent();
}

// ---------- Export ----------
function exportBuffer() {
  if (!term) { toast('No hay logs para exportar', 'warn'); return; }
  const buf = term.buffer.active;
  const lines = [];
  for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(false) ?? '');
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length) { toast('No hay logs para exportar', 'warn'); return; }
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  a.download = `axon-logs-${stamp}.log`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Wiring ----------
document.getElementById('logs-src').addEventListener('change', onSrcChange);
document.getElementById('logs-connect').addEventListener('click', () => {
  const { src, label } = resolveSrc();
  if (!src) { toast('Elegí una fuente de logs', 'warn'); return; }
  connect(src, label);
});
document.getElementById('logs-custom').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('logs-connect').click();
});
for (const id of ['logs-since', 'logs-grep']) {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('logs-connect').click();
  });
}
document.getElementById('logs-prio').addEventListener('change', () => {
  if (ws) document.getElementById('logs-connect').click();
});
document.getElementById('logs-hist').addEventListener('click', (e) => {
  historic = !historic;
  e.currentTarget.classList.toggle('logs-toggle-on', historic);
  e.currentTarget.title = historic ? 'Modo histórico activo — volver a en vivo' : 'Solo histórico: carga el tail sin seguir en vivo';
  if (ws) { // rebuild src — lastSrc carries the old opts JSON
    const { src, label } = resolveSrc();
    if (src) connect(src, label);
  }
});
document.getElementById('logs-reconnect').addEventListener('click', () => {
  // Reconnect applies the filter values currently in the toolbar.
  const { src, label } = resolveSrc();
  if (src) connect(src, label);
  else if (lastSrc) connect(lastSrc, lastLabel);
});
document.getElementById('logs-pause').addEventListener('click', (e) => {
  paused = !paused;
  const btn = e.currentTarget;
  btn.classList.toggle('logs-toggle-on', paused);
  btn.innerHTML = `<i data-lucide="${paused ? 'play' : 'pause'}" class="lucide-icon"></i>`;
  btn.title = paused ? 'Reanudar' : 'Pausar';
  refreshIcons();
  if (!paused && pausedBuf.length) {
    if (pausedDropped) {
      term?.write(`\x1b[2m[pausa: ${pausedDropped} fragmentos descartados por límite de buffer]\x1b[0m\r\n`);
    }
    for (const d of pausedBuf) emit(d);
    pausedBuf.length = 0;
    pausedBytes = 0;
    pausedDropped = 0;
    if (follow) term?.scrollToBottom();
  }
});
document.getElementById('logs-clear').addEventListener('click', () => {
  try { term?.clear(); } catch { try { term?.reset(); } catch { /* noop */ } }
  disposeDecos();
  searchMatches = [];
  searchIdx = -1;
  document.getElementById('logs-match-count').textContent = '';
});
document.getElementById('logs-follow').addEventListener('click', (e) => {
  follow = !follow;
  e.currentTarget.classList.toggle('logs-toggle-on', follow);
  if (follow) term?.scrollToBottom();
});
document.getElementById('logs-export').addEventListener('click', exportBuffer);
document.getElementById('logs-search').addEventListener('input', runSearch);
document.getElementById('logs-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') jumpTo(searchIdx + 1);
});
document.getElementById('logs-prev').addEventListener('click', () => jumpTo(searchIdx - 1));
document.getElementById('logs-next').addEventListener('click', () => jumpTo(searchIdx + 1));
window.addEventListener('resize', () => { if (section.classList.contains('active')) fit?.fit(); });

// Leaving the tab tears down the socket; returning reconnects only if the
// stream was live when we left (no silent auto-reconnect loops otherwise).
new MutationObserver(() => {
  const active = section.classList.contains('active');
  if (!active) {
    clearRetry();
    if (ws && ws.readyState <= WebSocket.OPEN) resumeOnReturn = true;
    closeWs();
    setStatus('disconnected', 'Desconectado');
  } else {
    requestAnimationFrame(() => fit?.fit());
    if (resumeOnReturn && lastSrc) {
      resumeOnReturn = false;
      connect(lastSrc, lastLabel);
    }
  }
}).observe(section, { attributes: true, attributeFilter: ['class'] });

// ---------- Loader ----------
let loadFlight;
loaders.logs = () => loadFlight ||= (async () => {
  try {
    await AxonAssets.terminal();
    ensureTerm();
    requestAnimationFrame(() => fit?.fit());
    await loadSources();
  } catch (err) { setStatus('disconnected', err.message); errToast(err); }
})().finally(() => { loadFlight = null; });
window.AxonPages ||= {};
window.AxonPages.logs = {
  // Deep-link /logs?src=journal:sys:unidad.service — usado desde Salud y
  // Proyectos. Mapea la spec al selector (o al input custom) y conecta.
  restore: async (params = {}) => {
    await loaders.logs();
    const spec = (typeof params.src === 'string' ? params.src : '').split('||')[0];
    if (!spec) return;
    const sel = document.getElementById('logs-src');
    const custom = document.getElementById('logs-custom');
    const known = (v) => Array.from(sel.options).some((o) => o.value === v);
    if (spec.startsWith('file:')) { sel.value = '__file__'; custom.value = spec.slice(5); }
    else if (spec.startsWith('journal:sys:') && !known(spec)) { sel.value = '__sysunit__'; custom.value = spec.slice(12); }
    else if (known(spec)) sel.value = spec;
    else { toast(`Fuente de logs desconocida: ${spec}`, 'warn'); return; }
    onSrcChange();
    const { src, label } = resolveSrc();
    if (src) connect(src, label);
  },
  params: () => (lastLabel ? { src: lastLabel } : {}),
};

refreshIcons();
})();
