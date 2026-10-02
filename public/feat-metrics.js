/* AXON — feature: Métricas históricas
   Tab "Métricas": gráficos canvas 2D (sin librerías) alimentados por
   /api/metrics + tabla "Top procesos" de /api/metrics/procs.
   Se auto-contiene: inyecta su <section>, su botón de nav y el <link> a
   feat-metrics.css. Auto-refresh cada 60s solo mientras el tab está activo. */
(() => {
'use strict';
if (document.getElementById('tab-metrics')) return;

const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = '/feat-metrics.css';
document.head.appendChild(link);

// ---------- DOM ----------
const CARDS = [
  { key: 'cpu', title: 'CPU', unit: '%', color: '--accent', fb: '#5e6ad2', yMax: 100 },
  { key: 'mem', title: 'RAM', unit: '%', color: '--ok', fb: '#4cb782', yMax: 100 },
  { key: 'disk', title: 'Disco', unit: '%', color: '--warn', fb: '#f2c94c', yMax: 100 },
  { key: 'load', title: 'Load (1m)', unit: '', color: '--info', fb: '#4ea7fc' },
  { key: 'net', title: 'Red', unit: 'kB/s', net: true },
];

const section = document.createElement('section');
section.id = 'tab-metrics';
section.className = 'tab-content';
section.innerHTML = `
  <div class="section-header">
    <h2>Métricas del servidor</h2>
    <div class="section-actions">
      <div class="filter-chips" id="metrics-ranges">
        <button class="chip" data-range="1h">1h</button>
        <button class="chip" data-range="6h">6h</button>
        <button class="chip" data-range="24h">24h</button>
        <button class="chip" data-range="7d">7d</button>
      </div>
      <button id="metrics-refresh" class="btn-secondary" title="Recargar"><i data-lucide="refresh-cw" class="lucide-icon"></i></button>
      <span class="last-updated" id="metrics-updated"></span>
    </div>
  </div>
  <div class="metrics-grid">
    ${CARDS.map((c) => `
      <div class="metric-card">
        <div class="metric-card-head">
          <span class="metric-title">${c.title}${c.unit ? ` <span class="metric-unit">(${c.unit})</span>` : ''}</span>
          <span class="metric-now" id="mx-now-${c.key}">-</span>
        </div>
        <canvas class="metric-canvas" id="mx-${c.key}"></canvas>
        <div class="metric-foot">
          <span id="mx-min-${c.key}"></span>
          ${c.net ? '<span class="metric-legend"><span><i class="dot dot-rx"></i>rx</span><span><i class="dot dot-tx"></i>tx</span></span>' : ''}
          <span id="mx-max-${c.key}"></span>
        </div>
      </div>`).join('')}
  </div>
  <div class="section-header metrics-procs-header">
    <h2>Top procesos</h2>
    <span class="last-updated" id="metrics-procs-updated"></span>
  </div>
  <div class="table-wrapper">
    <table id="metrics-procs-table">
      <thead><tr><th>Proceso</th><th>PID</th><th>CPU %</th><th>RAM</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
  <div id="metrics-procs-empty" class="empty-state hidden">Sin datos de procesos</div>`;
document.querySelector('main.content')?.appendChild(section);

const navBtn = document.createElement('button');
navBtn.className = 'nav-item tab-btn';
navBtn.dataset.tab = 'metrics';
navBtn.innerHTML = '<i data-lucide="activity" class="lucide-icon"></i><span class="nav-label">Métricas</span>';
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
  loaders.metrics?.();
});

// ---------- Canvas chart (shared helper, ~80 líneas) ----------
function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function fmtNum(v, unit) {
  if (unit === 'kB/s' && v >= 1024) return `${(v / 1024).toFixed(1)} MB/s`;
  const r = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${r}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
}

function fmtTime(t, long) {
  const d = new Date(t);
  const hm = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  return long ? `${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} ${hm}` : hm;
}

function drawChart(cv, datasets, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.parentElement?.clientWidth || 300;
  const h = 140;
  if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr);
  if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const first = datasets.find((d) => d.pts.length >= 2);
  if (!first) {
    ctx.fillStyle = cssVar('--text-faint', '#666');
    ctx.font = `11px ${cssVar('--font-sans', 'sans-serif')}`;
    ctx.fillText('Sin datos todavía — se muestrea cada 60s', 12, h / 2);
    return;
  }
  const tMin = first.pts[0].t;
  const tMax = first.pts[first.pts.length - 1].t;
  const span = Math.max(1, tMax - tMin);
  let yMax = opts.yMax;
  if (yMax == null) {
    yMax = 0;
    for (const ds of datasets) for (const p of ds.pts) yMax = Math.max(yMax, p.v);
    yMax = yMax <= 0 ? 1 : yMax * 1.15;
  }
  const padL = 34, padR = 8, padT = 8, padB = 16;
  const iw = w - padL - padR, ih = h - padT - padB;
  const x = (t) => padL + ((t - tMin) / span) * iw;
  const y = (v) => padT + ih - (Math.min(v, yMax) / yMax) * ih;
  // grid + y labels
  ctx.strokeStyle = cssVar('--border', 'rgba(255,255,255,.07)');
  ctx.fillStyle = cssVar('--text-faint', '#888');
  ctx.font = `9px ${cssVar('--font-mono', 'monospace')}`;
  ctx.lineWidth = 1;
  for (const g of [0, 0.5, 1]) {
    const gy = y(yMax * g);
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(w - padR, gy);
    ctx.stroke();
    ctx.fillText(fmtNum(yMax * g, opts.unit), 2, gy + 3);
  }
  // x labels: inicio / ahora
  const longFmt = span > 26 * 3600e3;
  ctx.fillText(fmtTime(tMin, longFmt), padL, h - 4);
  const nowW = ctx.measureText('ahora').width;
  ctx.fillText('ahora', w - padR - nowW, h - 4);
  // series
  for (const ds of datasets) {
    ctx.beginPath();
    ds.pts.forEach((p, i) => {
      const px = x(p.t), py = y(p.v);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.strokeStyle = ds.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (ds.fill !== false) {
      ctx.lineTo(x(tMax), padT + ih);
      ctx.lineTo(x(tMin), padT + ih);
      ctx.closePath();
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = ds.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    const lp = ds.pts[ds.pts.length - 1];
    ctx.beginPath();
    ctx.arc(x(lp.t), y(lp.v), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = ds.color;
    ctx.fill();
  }
}

// ---------- Data ----------
let range = '24h';
try { range = localStorage.getItem('pm.metricsRange') || '24h'; } catch { /* default */ }

function renderSeries(series) {
  for (const c of CARDS) {
    const now = document.getElementById(`mx-now-${c.key}`);
    const minEl = document.getElementById(`mx-min-${c.key}`);
    const maxEl = document.getElementById(`mx-max-${c.key}`);
    if (c.net) {
      const rx = series.netRx || [];
      const tx = series.netTx || [];
      const rxColor = cssVar('--accent', '#5e6ad2');
      const txColor = cssVar('--warn', '#f2c94c');
      drawChart(
        document.getElementById('mx-net'),
        [
          { pts: rx, color: rxColor, fill: false },
          { pts: tx, color: txColor, fill: false },
        ],
        { unit: 'kB/s' }
      );
      const last = rx[rx.length - 1]?.v ?? 0;
      const all = [...rx, ...tx].map((p) => p.v);
      now.textContent = `↓ ${fmtNum(last, 'kB/s')}`;
      if (all.length) {
        minEl.textContent = `mín ${fmtNum(Math.min(...all), 'kB/s')}`;
        maxEl.textContent = `máx ${fmtNum(Math.max(...all), 'kB/s')}`;
      } else { minEl.textContent = maxEl.textContent = ''; }
      continue;
    }
    const pts = series[c.key] || [];
    const color = cssVar(c.color, c.fb);
    drawChart(document.getElementById(`mx-${c.key}`), [{ pts, color }], { yMax: c.yMax, unit: c.unit });
    const last = pts[pts.length - 1]?.v;
    now.textContent = last == null ? '-' : fmtNum(last, c.unit);
    now.style.color = color;
    if (pts.length) {
      const vals = pts.map((p) => p.v);
      minEl.textContent = `mín ${fmtNum(Math.min(...vals), c.unit)}`;
      maxEl.textContent = `máx ${fmtNum(Math.max(...vals), c.unit)}`;
    } else { minEl.textContent = maxEl.textContent = ''; }
  }
}

async function loadProcs() {
  try {
    const { procs } = await api('/api/metrics/procs?n=12');
    const tbody = document.querySelector('#metrics-procs-table tbody');
    const empty = document.getElementById('metrics-procs-empty');
    empty.classList.toggle('hidden', !!procs?.length);
    const maxRss = Math.max(1, ...(procs || []).map((p) => p.rssMB));
    const accent = cssVar('--accent', '#5e6ad2');
    const ok = cssVar('--ok', '#4cb782');
    tbody.innerHTML = (procs || []).map((p) => `
      <tr>
        <td class="proc-name">${esc(p.name)}</td>
        <td class="proc-pid">${p.pid}</td>
        <td><div class="proc-bar-wrap"><div class="proc-bar" style="width:${Math.min(100, p.cpu)}%;background:${p.cpu > 60 ? cssVar('--danger', '#eb5757') : accent}"></div><span>${p.cpu}%</span></div></td>
        <td><div class="proc-bar-wrap"><div class="proc-bar" style="width:${(p.rssMB / maxRss * 100).toFixed(1)}%;background:${ok}"></div><span>${p.rssMB} MB</span></div></td>
      </tr>`).join('');
    document.getElementById('metrics-procs-updated').textContent = `actualizado ${new Date().toLocaleTimeString('es-AR')}`;
  } catch { /* tabla best-effort */ }
}

async function loadMetrics() {
  try {
    const { series } = await api(`/api/metrics?range=${encodeURIComponent(range)}`);
    renderSeries(series);
    document.getElementById('metrics-updated').textContent = `actualizado ${new Date().toLocaleTimeString('es-AR')}`;
  } catch (err) {
    errToast(err);
  }
  loadProcs();
}

// ---------- Wiring ----------
document.querySelectorAll('#metrics-ranges .chip').forEach((chip) => {
  chip.classList.toggle('active', chip.dataset.range === range);
  chip.addEventListener('click', () => {
    range = chip.dataset.range;
    try { localStorage.setItem('pm.metricsRange', range); } catch { /* noop */ }
    document.querySelectorAll('#metrics-ranges .chip').forEach((b) => b.classList.toggle('active', b === chip));
    loadMetrics();
  });
});
document.getElementById('metrics-refresh').addEventListener('click', loadMetrics);
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!section.classList.contains('active')) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => loadMetrics(), 400);
});

setInterval(() => {
  if (section.classList.contains('active')) loadMetrics();
}, 60_000);

loaders.metrics = () => loadMetrics();

refreshIcons();
})();
