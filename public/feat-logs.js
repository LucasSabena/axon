/* AXON — feature: Logs en vivo
   Tab "Logs": tail -f / journalctl / docker logs sobre /ws/logs, renderizado
   en un pane xterm (mismo vendor que la terminal). Se auto-contiene: inyecta
   su <section>, su botón de nav y su CSS. Cierra el WS al salir del tab y lo
   retoma al volver solo si estaba conectado. */
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
#tab-logs .logs-sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; flex-shrink: 0; }
#tab-logs .logs-count { color: var(--text-faint); font-size: 0.76rem; font-family: var(--font-mono); min-width: 34px; }
#tab-logs .logs-toggle-on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
#tab-logs .hidden { display: none !important; }
#logs-pane { flex: 1; min-height: 0; background: #0b0e14; padding: 6px; }
#logs-pane .xterm { height: 100%; }
`;
document.head.appendChild(style);

// ---------- DOM ----------
const section = document.createElement('section');
section.id = 'tab-logs';
section.className = 'tab-content';
section.innerHTML = `
  <div class="logs-toolbar">
    <span class="logs-status logs-status-disconnected" id="logs-status">Desconectado</span>
    <select id="logs-src" aria-label="Fuente de logs" class="filter-input logs-src"><option value="">Cargando fuentes…</option></select>
    <input type="text" id="logs-custom" aria-label="Ruta del archivo de logs" class="filter-input hidden" placeholder="/ruta/al/archivo.log">
    <button id="logs-connect" class="btn-primary"><i data-lucide="play" class="lucide-icon"></i> Conectar</button>
    <button id="logs-reconnect" class="btn-action hidden"><i data-lucide="rotate-cw" class="lucide-icon"></i> Reconectar</button>
    <span class="logs-sep"></span>
    <button id="logs-pause" class="btn-secondary" title="Pausar"><i data-lucide="pause" class="lucide-icon"></i></button>
    <button id="logs-clear" class="btn-secondary" title="Limpiar"><i data-lucide="eraser" class="lucide-icon"></i></button>
    <button id="logs-follow" class="btn-secondary logs-toggle-on" title="Seguir abajo"><i data-lucide="arrow-down-to-line" class="lucide-icon"></i></button>
    <span class="logs-sep"></span>
    <input type="text" id="logs-search" aria-label="Buscar en los logs" class="filter-input logs-search" placeholder="Buscar…">
    <button id="logs-prev" class="btn-secondary" title="Anterior"><i data-lucide="chevron-up" class="lucide-icon"></i></button>
    <button id="logs-next" class="btn-secondary" title="Siguiente"><i data-lucide="chevron-down" class="lucide-icon"></i></button>
    <span id="logs-match-count" class="logs-count"></span>
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

// ---------- State ----------
let term = null;
let fit = null;
let ws = null;
let lastSrc = '';
let resumeOnReturn = false;
let paused = false;
const pausedBuf = [];
let pausedBytes = 0;
const PAUSED_CAP = 512 * 1024;
let follow = true;
let searchMatches = [];
let searchIdx = -1;

function ensureTerm() {
  if (term) return;
  term = new Terminal({
    cursorBlink: false,
    disableStdin: true,
    convertEol: true,
    fontSize: 13,
    fontFamily: 'JetBrains Mono, monospace',
    theme: { background: '#0b0e14' },
    scrollback: 5000,
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
function closeWs() {
  const s = ws;
  ws = null;
  if (s) { try { s.close(); } catch { /* gone */ } }
}

async function connect(src) {
  closeWs();
  if (!src) return;
  try { await AxonAssets.terminal(); ensureTerm(); }
  catch (err) { setStatus('disconnected', err.message); errToast(err); return; }
  lastSrc = src;
  setStatus('connecting', 'Conectando…');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws/logs?src=${encodeURIComponent(src)}`);
  ws = sock;
  sock.binaryType = 'arraybuffer';
  sock.onopen = () => {
    if (ws !== sock) return;
    setStatus('connected', 'Conectado');
    document.getElementById('logs-reconnect').classList.add('hidden');
    ensureTerm();
    term.write(`\x1b[2m—— ${src} ——\x1b[0m\r\n`);
    requestAnimationFrame(() => fit?.fit());
  };
  sock.onmessage = (e) => {
    const data = typeof e.data === 'string' ? e.data : new Uint8Array(e.data);
    if (paused) {
      const size = typeof data === 'string' ? data.length : data.byteLength;
      pausedBuf.push(data);
      pausedBytes += size;
      while (pausedBytes > PAUSED_CAP && pausedBuf.length > 1) {
        const d = pausedBuf.shift();
        pausedBytes -= typeof d === 'string' ? d.length : d.byteLength;
      }
      return;
    }
    term?.write(data);
    if (follow) term?.scrollToBottom();
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    setStatus('disconnected', 'Desconectado');
    if (lastSrc) document.getElementById('logs-reconnect').classList.remove('hidden');
  };
  sock.onerror = () => { /* onclose follows */ };
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
    const { units } = await api('/api/logs/sources');
    if (units?.length) {
      const g = document.createElement('optgroup');
      g.label = 'Journal (usuario)';
      for (const u of units) addOpt(g, `journal:${u}`, u);
      sel.appendChild(g);
    }
  } catch { /* sin unidades de usuario */ }
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

function resolveSrc() {
  const v = document.getElementById('logs-src').value;
  const custom = document.getElementById('logs-custom').value.trim();
  if (v === '__file__') return custom ? `file:${custom}` : '';
  if (v === '__sysunit__') return custom ? `journal:sys:${custom}` : '';
  return v;
}

function onSrcChange() {
  const v = document.getElementById('logs-src').value;
  const custom = document.getElementById('logs-custom');
  const needsInput = v === '__file__' || v === '__sysunit__';
  custom.classList.toggle('hidden', !needsInput);
  if (needsInput) {
    custom.placeholder = v === '__sysunit__' ? 'unidad.service (journal de sistema)' : '/ruta/al/archivo.log';
    custom.focus();
  }
}

// ---------- Search ----------
function runSearch() {
  const q = document.getElementById('logs-search').value.trim().toLowerCase();
  searchMatches = [];
  searchIdx = -1;
  if (term && q) {
    const buf = term.buffer.active;
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i)?.translateToString(true) || '';
      if (line.toLowerCase().includes(q)) searchMatches.push(i);
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
}

// ---------- Wiring ----------
document.getElementById('logs-src').addEventListener('change', onSrcChange);
document.getElementById('logs-connect').addEventListener('click', () => {
  const src = resolveSrc();
  if (!src) { toast('Elegí una fuente de logs', 'warn'); return; }
  connect(src);
});
document.getElementById('logs-custom').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('logs-connect').click();
});
document.getElementById('logs-reconnect').addEventListener('click', () => {
  if (lastSrc) connect(lastSrc);
});
document.getElementById('logs-pause').addEventListener('click', (e) => {
  paused = !paused;
  const btn = e.currentTarget;
  btn.classList.toggle('logs-toggle-on', paused);
  btn.title = paused ? 'Reanudar' : 'Pausar';
  if (!paused && pausedBuf.length) {
    for (const d of pausedBuf) term?.write(d);
    pausedBuf.length = 0;
    pausedBytes = 0;
    if (follow) term?.scrollToBottom();
  }
});
document.getElementById('logs-clear').addEventListener('click', () => {
  try { term?.clear(); } catch { try { term?.reset(); } catch { /* noop */ } }
});
document.getElementById('logs-follow').addEventListener('click', (e) => {
  follow = !follow;
  e.currentTarget.classList.toggle('logs-toggle-on', follow);
  if (follow) term?.scrollToBottom();
});
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
    if (ws && ws.readyState <= WebSocket.OPEN) resumeOnReturn = true;
    closeWs();
    setStatus('disconnected', 'Desconectado');
  } else {
    requestAnimationFrame(() => fit?.fit());
    if (resumeOnReturn && lastSrc) {
      resumeOnReturn = false;
      connect(lastSrc);
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
window.AxonPages.logs = { restore: loaders.logs };

refreshIcons();
})();
