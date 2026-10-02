/* AXON — frontend */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Lucide icons (vendored, optional) ----------

const icon = (name, cls = '') => `<i data-lucide="${esc(name)}" class="lucide-icon${cls ? ' ' + cls : ''}"></i>`;
const refreshIcons = () => { try { window.lucide?.createIcons(); } catch { /* icons are decorative */ } };
const isLucideName = (s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s || '');
const CATEGORY_ICON = { project: 'folder-git-2', service: 'server', docker: 'container', system: 'cpu', unknown: 'help-circle' };
const lucideName = (name, fallback = 'box') => (isLucideName(name) ? name : fallback);

function relTime(ts) {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!t || Number.isNaN(t)) return '-';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)}m`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)}h`;
  return `hace ${Math.floor(s / 86400)}d`;
}

// ---------- API wrapper with error toasts ----------

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw { error: 'Sin conexión con el servidor', detail: String(err) };
  }
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok || data.ok === false) {
    // Session expired — drop back to the login screen instead of spamming
    // "Unauthorized" toasts from every background poll.
    if (res.status === 401) {
      $('#login-screen')?.classList.remove('hidden');
    }
    const e = new Error(data.error || `HTTP ${res.status}`);
    e.detail = data.detail;
    e.command = data.command;
    e.status = res.status;
    e.raw = data;
    throw e;
  }
  return data;
}

function toast(msg, type = 'error', detail = '', ms = 6000) {
  const box = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<div class="toast-msg">${esc(msg)}</div>${detail ? `<details><summary>Detalle</summary><pre>${esc(detail)}</pre></details>` : ''}`;
  box.appendChild(el);
  setTimeout(() => el.classList.add('toast-show'), 10);
  setTimeout(() => { el.classList.remove('toast-show'); setTimeout(() => el.remove(), 300); }, ms);
}

function errToast(err) {
  const parts = [err.detail, err.command ? `Comando: ${err.command}` : ''].filter(Boolean);
  toast(err.message || 'Error', 'error', parts.join('\n\n'));
}

function fmtUptime(sec) {
  if (!sec) return '-';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

// ---------- Auth ----------

async function initAuth() {
  try {
    const me = await api('/api/me');
    $('#login-code').classList.toggle('hidden', !me.totpEnabled);
    if (me.authenticated) {
      $('#login-screen').classList.add('hidden');
      $('#main-screen').classList.remove('hidden');
      bootMain();
      return;
    }
  } catch { /* fallthrough to login */ }
  $('#login-screen').classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('/api/login', {
      method: 'POST',
      body: { username: $('#username').value, password: $('#password').value, code: $('#login-code').value.trim() },
    });
    location.reload();
  } catch (err) {
    $('#login-error').textContent = err.message;
    // Server says the 2FA code is wrong/required — make sure the field is visible.
    if ((err.message || '').toLowerCase().includes('código')) $('#login-code').classList.remove('hidden');
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

// ---------- Tabs ----------

const loaders = {
  ports: loadPorts,
  programs: loadPrograms,
  projects: loadProjects,
  docker: loadDocker,
  domains: loadDomains,
};

let activeTabName = 'ports';
$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach((b) => b.classList.remove('active'));
    $$('.tab-content').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
    // Leaving the browser tab tears the viewer down so it isn't streaming
    // screencast frames in the background; the server Chrome keeps running.
    if (activeTabName === 'navegador' && btn.dataset.tab !== 'navegador') unloadBrowser();
    activeTabName = btn.dataset.tab;
    loaders[btn.dataset.tab]?.();
  });
});

// ---------- Header stats ----------

let serverHosts = [];
const sparkHist = { cpu: [], ram: [] };
const SPARK_MAX = 48;

function drawSpark(id, values) {
  const cv = document.getElementById(id);
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5e6ad2';
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  if (values.length < 2) return;
  const max = Math.max(10, ...values);
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 2 - (v / max) * (h - 4);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // soft fill under the line
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.globalAlpha = 0.12; ctx.fillStyle = accent; ctx.fill();
  ctx.globalAlpha = 1;
}

function pushSpark(key, v) {
  sparkHist[key].push(v);
  if (sparkHist[key].length > SPARK_MAX) sparkHist[key].shift();
}

async function loadStats() {
  try {
    const { stats } = await api('/api/stats');
    serverHosts = stats.hosts || [];
    $('#stat-cpu').textContent = `${stats.cpuPercent}%`;
    $('#stat-ram').textContent = `${stats.memoryPercent}%`;
    $('#stat-disk').textContent = `${stats.diskPercent}%`;
    $('#stat-load').textContent = stats.loadAverage.map((v) => v.toFixed(2)).join(' ') || '-';
    pushSpark('cpu', stats.cpuPercent);
    pushSpark('ram', stats.memoryPercent);
    drawSpark('spark-cpu', sparkHist.cpu);
    drawSpark('spark-ram', sparkHist.ram);
  } catch { /* header stats are best-effort */ }
}

function bestNetworkHost() {
  const ts = serverHosts.find((h) => h.kind === 'tailscale');
  const lan = serverHosts.find((h) => h.kind === 'lan');
  return (ts || lan || serverHosts[0])?.host || '';
}

// ---------- Ports ----------

let portsFilter = 'all';
let portsData = [];
let networkHost = '';
let codeServerPort = null;
let editorUrl = '';
const collapsedGroups = new Set();

function netHost() {
  return networkHost || bestNetworkHost() || '';
}

$('#ports-filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  $$('#ports-filters .chip').forEach((c) => c.classList.remove('active'));
  btn.classList.add('active');
  portsFilter = btn.dataset.filter;
  renderPorts();
});

$('#ports-refresh').addEventListener('click', loadPorts);

const CATEGORY_BADGE = {
  project: ['Proyecto', 'badge-node'],
  service: ['Servicio', 'badge-docker'],
  docker: ['Docker', 'badge-docker'],
  system: ['Sistema', 'badge-other'],
  unknown: ['?', 'badge-other'],
};

async function loadPorts() {
  try {
    const data = await api('/api/ports');
    portsData = data.processes || [];
    if (data.networkHost !== undefined) networkHost = data.networkHost || '';
    codeServerPort = data.codeServerPort ?? null;
    editorUrl = data.editorUrl || '';
    $('#ports-updated').textContent = `Actualizado ${new Date().toLocaleTimeString()}`;
    renderPorts();
  } catch (err) {
    errToast(err);
  }
}

function healthDotFor(port, listeners) {
  const l = (listeners || []).find((x) => x.port === port);
  if (!l || l.proto === 'udp' || l.healthy === null || l.healthy === undefined) {
    return '<span class="health-dot health-unknown" title="Sin verificar"></span>';
  }
  const ms = l.latencyMs !== undefined ? `<span class="health-ms">${l.latencyMs}ms</span>` : '';
  const slow = l.latencyMs !== undefined && l.latencyMs > 200;
  return l.healthy
    ? `<span class="health-dot ${slow ? 'health-warn' : 'health-ok'}" title="Responde en ${l.latencyMs ?? '?'}ms"></span>${ms}`
    : '<span class="health-dot health-bad" title="No responde"></span>';
}

function isLoopbackAddr(addr) {
  return !addr || addr === '::1' || addr === 'localhost' || addr.startsWith('127.');
}

function remoteReachable(port, listeners) {
  const ls = (listeners || []).filter((l) => l.port === port);
  if (!ls.length) return true;
  return ls.some((l) => !isLoopbackAddr(l.address));
}

function isLocalClient() {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
}

function portLinksHtml(port, listeners) {
  const dot = healthDotFor(port, listeners);
  const net = netHost();
  const proxy = `<a class="link-proxy" href="/p/${port}/" target="_blank" rel="noopener" title="Abrir :${port} a través del proxy (funciona incluso si el proceso solo escucha en 127.0.0.1)">${icon('route')} :${port}</a>`;

  // Remote client (laptop via Tailscale/domain): localhost links don't reach the
  // server — route everything through the built-in proxy, or direct host:port
  // when we browsed by raw IP and the service binds a public interface.
  if (!isLocalClient()) {
    const hostIsIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname);
    const direct = hostIsIp && remoteReachable(port, listeners)
      ? `<a class="link-network" href="http://${location.hostname}:${port}" target="_blank" rel="noopener" title="Directo al servidor">${esc(location.hostname)}:${port}</a>`
      : '';
    return `<span class="port-links">${dot}${direct}${proxy}</span>`;
  }

  const local = `${dot}<a class="link-local" href="http://localhost:${port}" target="_blank" rel="noopener" title="Abrir localhost:${port}">localhost:${port}</a>`;
  let remote = '';
  if (net) {
    remote = remoteReachable(port, listeners)
      ? `<a class="link-network" href="http://${net}:${port}" target="_blank" rel="noopener" title="Abrir ${esc(net)}:${port}">${esc(net)}:${port}</a>`
      : `<span class="link-network link-dead" title="${esc(net)}:${port} no es accesible: este proceso solo escucha en 127.0.0.1 (usá --host o un dominio)">${esc(net)}:${port}</span>`;
  }
  return `<span class="port-links">${local}${remote}</span>`;
}

function processRow(p, isChild, groupRoot) {
  const tr = document.createElement('tr');
  if (isChild) { tr.className = 'project-child'; tr.dataset.groupRoot = groupRoot || ''; }
  const [catLabel, catClass] = CATEGORY_BADGE[p.identity.category] || CATEGORY_BADGE.unknown;
  const portChips = (p.ports || []).map((port) => portLinksHtml(port, p.listeners)).join(' ');
  const frameworkBadge = p.identity.framework
    ? `<span class="badge badge-python">${esc(p.identity.framework)}</span>` : '';
  const unitBadge = p.identity.unit
    ? `<span class="badge badge-other" title="Supervisado por ${esc(p.identity.unit)} — al cerrarlo se reinicia solo">${icon('refresh-ccw')} systemd</span>` : '';
  const domainLink = p.domain
    ? `<a class="domain-link" href="https://${esc(p.domain.fullDomain)}" target="_blank" rel="noopener">${icon('globe')} ${esc(p.domain.subdomain)}</a>` : '';
  const folderCell = p.identity.projectRoot || p.cwd || '-';
  const actions = p.pid > 0
    ? `<button class="btn-action act-detail" data-pid="${p.pid}" title="Info">${icon('info')} Info</button>
       <button class="btn-action act-menu" data-pid="${p.pid}" title="Más acciones">${icon('ellipsis-vertical')}</button>
       ${p.identity.protected
         ? `<button class="btn-danger" disabled title="${esc(p.identity.protectionReason || 'Protegido')}">${icon('lock')}</button>`
         : `<button class="btn-danger act-kill" data-pid="${p.pid}" title="Cerrar">${icon('power')}</button>`}`
    : `<span class="listener-note">kernel</span>`;

  tr.innerHTML = `
    <td class="icon-cell">${icon(lucideName(p.identity.icon, CATEGORY_ICON[p.identity.category] || 'box'))}</td>
    <td>
      <strong>${esc(p.identity.label)}</strong> ${frameworkBadge}<br>
      <span class="badge ${catClass}">${catLabel}</span> ${unitBadge}
      <span class="cmd-cell" style="display:block;max-width:340px" title="${esc(p.cmd)}">${esc(p.name)} · ${esc(p.user)}</span>
    </td>
    <td>${portChips} ${domainLink}</td>
    <td class="cmd-cell" title="${esc(folderCell)}">${esc(folderCell)}</td>
    <td class="num">${p.pid || '-'}</td>
    <td class="num">${p.memoryMb ? p.memoryMb + ' MB' : '-'}</td>
    <td class="num">${fmtUptime(p.uptimeSeconds)}</td>
    <td><div class="actions">${actions}</div></td>`;
  return tr;
}

function projectHeaderRow(root, procs) {
  const tr = document.createElement('tr');
  tr.className = 'folder-row';
  const framework = procs.find((p) => p.identity.framework)?.identity.framework;
  const label = root.split('/').filter(Boolean).pop() || procs[0].identity.label;
  const allPorts = [...new Set(procs.flatMap((p) => p.ports || []))].sort((a, b) => a - b);
  const allListeners = procs.flatMap((p) => p.listeners || []);
  const ram = procs.reduce((s, p) => s + (p.memoryMb || 0), 0);
  const up = Math.max(0, ...procs.map((p) => p.uptimeSeconds || 0));
  const killable = procs.filter((p) => p.pid > 0 && !p.identity.protected).map((p) => p.pid);
  const editorBtn = (editorUrl || codeServerPort)
    ? `<button class="btn-action act-editor" data-root="${esc(root)}" title="Abrir en el editor">${icon('code')} Editor</button>` : '';
  const killAllBtn = killable.length
    ? `<button class="btn-danger act-kill-all" data-pids="${killable.join(',')}" title="Cerrar todos los procesos del proyecto">${icon('x-circle')} Cerrar todo</button>` : '';
  const collapsed = collapsedGroups.has(root);
  if (collapsed) tr.classList.add('group-collapsed');
  tr.dataset.root = root;
  tr.innerHTML = `
    <td class="icon-cell"><span class="group-caret">${icon('chevron-down')}</span></td>
    <td><strong>${icon('folder-git-2')} ${esc(label)}</strong> ${framework ? `<span class="badge badge-python">${esc(framework)}</span>` : ''} <span class="badge badge-node">Proyecto</span></td>
    <td>${allPorts.map((pt) => portLinksHtml(pt, allListeners)).join(' ')}</td>
    <td class="cmd-cell folder-path" title="${esc(root)}">${esc(root)}</td>
    <td>·</td>
    <td>${ram ? `${Math.round(ram)} MB` : '-'}</td>
    <td>${fmtUptime(up)}</td>
    <td><div class="actions">
      <button class="btn-action act-copy" data-path="${esc(root)}" title="Copiar ruta">${icon('copy')}</button>
      ${editorBtn}
      ${killAllBtn}
    </div></td>`;
  return tr;
}

function renderPorts() {
  const tbody = $('#ports-table tbody');
  const filtered = portsData.filter((p) => {
    if (portsFilter === 'all') return true;
    if (portsFilter === 'project') return p.identity.category === 'project';
    if (portsFilter === 'service') return p.identity.category === 'service' || p.identity.category === 'docker';
    if (portsFilter === 'system') return p.identity.category === 'system' || p.identity.category === 'unknown';
    return true;
  });
  tbody.innerHTML = '';
  $('#ports-empty').classList.toggle('hidden', filtered.length > 0);

  // Group project processes by projectRoot; everything else renders flat
  const groups = new Map();
  const flat = [];
  for (const p of filtered) {
    if (p.identity.category === 'project' && p.identity.projectRoot) {
      const root = p.identity.projectRoot;
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(p);
    } else {
      flat.push(p);
    }
  }

  const minPort = (p) => Math.min(...(p.ports || []), Infinity);
  const units = [
    ...[...groups.entries()].map(([root, procs]) => ({ kind: 'group', root, procs, minPort: Math.min(...procs.map(minPort)) })),
    ...flat.map((p) => ({ kind: 'proc', p, minPort: minPort(p) })),
  ].sort((a, b) => a.minPort - b.minPort);

  for (const u of units) {
    if (u.kind === 'group') {
      tbody.appendChild(projectHeaderRow(u.root, u.procs));
      if (!collapsedGroups.has(u.root)) {
        for (const p of [...u.procs].sort((a, b) => minPort(a) - minPort(b))) {
          tbody.appendChild(processRow(p, true, u.root));
        }
      }
    } else {
      tbody.appendChild(processRow(u.p, false));
    }
  }
  const nc = $('#nav-count-ports');
  if (nc) nc.textContent = portsData.length || '';
  refreshIcons();
}

$('#ports-table').addEventListener('click', (e) => {
  const grow = e.target.closest('tr.folder-row');
  if (!grow || e.target.closest('button') || e.target.closest('a')) return;
  const root = grow.dataset.root;
  if (collapsedGroups.has(root)) collapsedGroups.delete(root);
  else collapsedGroups.add(root);
  renderPorts();
});

$('#ports-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  e.stopPropagation();
  if (btn.classList.contains('act-kill')) {
    openKillModal(parseInt(btn.dataset.pid, 10));
  } else if (btn.classList.contains('act-detail')) {
    openDetailModal(parseInt(btn.dataset.pid, 10));
  } else if (btn.classList.contains('act-menu')) {
    const p = portsData.find((x) => x.pid === parseInt(btn.dataset.pid, 10));
    if (p) openProcMenu(p, btn);
  } else if (btn.classList.contains('act-copy')) {
    await navigator.clipboard.writeText(btn.dataset.path).catch(() => {});
    toast('Ruta copiada', 'ok', '', 2000);
  } else if (btn.classList.contains('act-editor')) {
    const root = btn.dataset.root;
    const base = editorUrl || (codeServerPort ? `http://${netHost() || location.hostname}:${codeServerPort}` : '');
    if (!base) return;
    window.open(`${base}/?folder=${encodeURIComponent(root)}`, '_blank', 'noopener');
  } else if (btn.classList.contains('act-kill-all')) {
    const pids = (btn.dataset.pids || '').split(',').map((n) => parseInt(n, 10)).filter(Boolean);
    if (!pids.length) return;
    if (!confirm(`Se cerrarán ${pids.length} proceso(s) del proyecto.\nPIDs: ${pids.join(', ')}`)) return;
    btn.disabled = true;
    let okCount = 0;
    let failCount = 0;
    for (const pid of pids) {
      try { await api(`/api/ports/${pid}/kill`, { method: 'POST' }); okCount++; }
      catch { failCount++; }
    }
    toast(`Proyecto: ${okCount} proceso(s) cerrado(s)${failCount ? `, ${failCount} fallaron` : ''}`, failCount ? 'warn' : 'ok');
    loadPorts();
  }
});

// ---------- Kill modal ----------

let killPid = null;

async function openKillModal(pid) {
  killPid = pid;
  $('#kill-error').textContent = '';
  $('#kill-plan-body').innerHTML = 'Cargando…';
  $('#kill-modal').classList.remove('hidden');
  $('#kill-confirm').disabled = true;
  try {
    const { plan } = await api(`/api/ports/${pid}/plan`);
    const tree = plan.tree.map((t, i) =>
      `<div class="kill-tree-row">${icon(i === 0 ? 'chevron-right' : 'corner-down-right')} <code>${t.pid}</code> ${esc(t.name)} <span class="cmd-cell">${esc(t.cmd.slice(0, 80))}</span></div>`
    ).join('');
    $('#kill-plan-body').innerHTML = `
      <p>Vas a cerrar <strong>${icon(lucideName(plan.identity.icon, 'box'))} ${esc(plan.identity.label)}</strong> (<code>${esc(plan.name)}</code>, PID ${plan.pid}).</p>
      ${plan.portsFreed.length ? `<p>Se liberarán los puertos: <strong>${plan.portsFreed.join(', ')}</strong></p>` : ''}
      ${plan.cwd ? `<p class="cmd-cell">Ruta: ${esc(plan.cwd)}</p>` : ''}
      ${plan.warnings.map((w) => `<p class="warning-line">${icon('triangle-alert')} ${esc(w)}</p>`).join('')}
      <details><summary>Procesos que se cerrarán (${plan.tree.length})</summary>${tree}</details>`;
    refreshIcons();
    const stopBtn = $('#kill-stop-service');
    if (plan.identity.unit) {
      stopBtn.classList.remove('hidden');
      stopBtn.dataset.unit = plan.identity.unit;
      stopBtn.dataset.scope = plan.identity.unitScope || 'user';
    } else {
      stopBtn.classList.add('hidden');
      delete stopBtn.dataset.unit;
    }
    if (plan.blocked) {
      $('#kill-error').textContent = `Bloqueado: ${plan.blocked}`;
      $('#kill-confirm').disabled = true;
    } else {
      $('#kill-confirm').disabled = false;
    }
  } catch (err) {
    $('#kill-plan-body').innerHTML = '';
    $('#kill-error').textContent = err.message;
  }
}

$('#kill-cancel').addEventListener('click', () => $('#kill-modal').classList.add('hidden'));

$('#kill-stop-service').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const unit = btn.dataset.unit;
  const scope = btn.dataset.scope || 'user';
  if (!unit) return;
  if (!confirm(`Detener el servicio "${unit}"?\nSe detiene de verdad (systemd no lo reinicia). También se puede deshabilitar para que no arranque solo.`)) return;
  btn.disabled = true;
  try {
    await api('/api/systemd/stop', { method: 'POST', body: { unit, scope } });
    $('#kill-modal').classList.add('hidden');
    toast(`Servicio ${unit} detenido`, 'ok', 'Sigue habilitado al arranque — deshabilitalo con: systemctl --user disable ' + unit, 6000);
    loadPorts();
  } catch (err) {
    errToast(err);
  } finally {
    btn.disabled = false;
  }
});
$('#kill-confirm').addEventListener('click', async () => {
  if (!killPid) return;
  $('#kill-confirm').disabled = true;
  try {
    const res = await api(`/api/ports/${killPid}/kill`, { method: 'POST' });
    $('#kill-modal').classList.add('hidden');
    toast(`Proceso cerrado (${res.killed.length} PIDs)`, 'ok');
    loadPorts();
  } catch (err) {
    $('#kill-error').textContent = err.message;
    if (err.detail) toast(err.detail, 'error');
  } finally {
    $('#kill-confirm').disabled = false;
  }
});

// ---------- Detail modal ----------

let detailPid = null;

async function openDetailModal(pid) {
  detailPid = pid;
  $('#detail-modal').classList.remove('hidden');
  $('#detail-title').textContent = '…';
  try {
    const { detail } = await api(`/api/ports/${pid}/detail`);
    $('#detail-title').innerHTML = `${icon(lucideName(detail.identity.icon, 'box'))} ${esc(detail.identity.label)}`;
    refreshIcons();
    $('#detail-meta').innerHTML = `
      <span class="badge ${CATEGORY_BADGE[detail.identity.category]?.[1] || 'badge-other'}">${CATEGORY_BADGE[detail.identity.category]?.[0] || '?'}</span>
      ${detail.identity.framework ? `<span class="badge badge-python">${esc(detail.identity.framework)}</span>` : ''}
      ${detail.ports.map((p) => `<span class="listener-note">:${p}</span>`).join(' ')}`;
    $('#detail-cwd').textContent = detail.identity.projectRoot || detail.cwd || '-';
    $('#detail-pid').textContent = `${detail.pid} / ${detail.ppid}`;
    $('#detail-user').textContent = detail.user;
    $('#detail-start').textContent = detail.startedAt ? new Date(detail.startedAt).toLocaleString() : '-';
    $('#detail-cmd').textContent = detail.cmd;
    $('#detail-kill-btn').style.display = detail.identity.protected ? 'none' : '';
    renderEnv(detail.env);
  } catch (err) {
    errToast(err);
    $('#detail-modal').classList.add('hidden');
  }
}

function renderEnv(env) {
  const tbody = $('#detail-env-table tbody');
  const filter = ($('#detail-env-filter').value || '').toLowerCase();
  tbody.innerHTML = Object.entries(env)
    .filter(([k, v]) => `${k}=${v}`.toLowerCase().includes(filter))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="env-value">${esc(v)}</td></tr>`)
    .join('');
}

$('#detail-env-filter').addEventListener('input', () => {
  if (detailPid) openDetailModalEnvOnly();
});
async function openDetailModalEnvOnly() {
  try {
    const { detail } = await api(`/api/ports/${detailPid}/detail`);
    renderEnv(detail.env);
  } catch { /* ignore */ }
}

$$('.detail-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.detail-tab-btn').forEach((b) => b.classList.remove('active'));
    $$('.detail-tab-content').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $(`#detail-tab-${btn.dataset.detailTab}`).classList.add('active');
  });
});

$('#detail-close').addEventListener('click', () => $('#detail-modal').classList.add('hidden'));
$('#detail-kill-btn').addEventListener('click', () => {
  $('#detail-modal').classList.add('hidden');
  if (detailPid) openKillModal(detailPid);
});
$('#detail-domain-btn').addEventListener('click', () => {
  if (!detailPid) return;
  const p = portsData.find((x) => x.pid === detailPid);
  if (!p) return;
  openDomainModal({
    port: p.ports[0],
    processType: 'process',
    projectName: p.identity.label,
    label: p.identity.label,
  });
});

// ---------- Programs / updater ----------

let jobPollTimer = null;
let currentJobId = null;
let programsData = [];

async function loadPrograms(fresh = false) {
  try {
    const { programs } = await api(fresh ? '/api/programs?fresh=1' : '/api/programs');
    programsData = programs || [];
    $('#programs-updated').textContent = `Actualizado ${new Date().toLocaleTimeString()}`;
    renderPrograms(programsData);
    const pending = programsData.filter((p) => p.pendingUpdates || p.latestVersion).length;
    const nc = $('#nav-count-programs');
    if (nc) { nc.textContent = pending || ''; nc.classList.toggle('nav-alert', pending > 0); }
    // Cargar el inventario una sola vez al entrar a la sección
    if (!installedData) loadInstalled().catch(() => {});
  } catch (err) {
    errToast(err);
  }
  loadJobsHistory();
}

function renderPrograms(programs) {
  const grid = $('#programs-grid');
  grid.innerHTML = '';
  const installed = programs.filter((p) => p.installed);
  const notInstalled = programs.filter((p) => !p.installed);
  $('#programs-empty').classList.toggle('hidden', installed.length > 0);

  for (const p of [...installed, ...notInstalled]) {
    const card = document.createElement('div');
    const hasUpdate = !!(p.latestVersion || p.pendingUpdates);
    card.className = `program-card ${p.installed ? '' : 'program-off'} ${hasUpdate ? 'has-update' : ''}`;
    const stepsInfo = p.steps.map((s) => `<code>${esc(s.cmd)}</code> <span class="listener-note">${esc(s.user)}</span>`).join('<br>');
    const versionBadge = p.latestVersion
      ? `<span class="badge badge-bun" title="Hay una versión nueva">${icon('arrow-up')} ${esc(p.version || '?')} → ${esc(p.latestVersion)}</span>`
      : p.pendingUpdates ? `<span class="badge badge-bun">${esc(p.pendingUpdates)} updates</span>` : '';
    const authHtml = p.auth ? `
      <div class="program-auth">
        <span class="health-dot ${p.auth.loggedIn ? 'health-ok' : 'health-bad'}"></span>
        <span class="${p.auth.loggedIn ? 'auth-account' : 'listener-note'}">${p.auth.loggedIn ? esc(p.auth.account || 'Sesión activa') : 'Sin sesión'}</span>
        ${p.auth.loggedIn && p.auth.canLogout ? `<button class="auth-btn program-auth-act" data-id="${esc(p.id)}" data-act="logout" title="Cerrar sesión">${icon('log-out')} Salir</button>` : ''}
        ${!p.auth.loggedIn && p.auth.canLogin ? `<button class="auth-btn program-auth-act" data-id="${esc(p.id)}" data-act="login" title="Inicia el flujo de login — la URL/código aparece en el log del job">${icon('log-in')} Entrar</button>` : ''}
        ${!p.auth.loggedIn && !p.auth.canLogin && p.auth.loginHint ? `<span class="auth-hint" title="${esc(p.auth.loginHint)}">${icon('info')} cómo entrar</span>` : ''}
      </div>` : '';
    card.innerHTML = `
      <div class="program-head">
        <span class="program-icon">${p.brandIcon
          ? `<img class="brand-svg" src="${esc(p.brandIcon)}" alt="" onerror="this.nextElementSibling.classList.remove('hidden'); this.remove()"><span class="hidden">${icon(lucideName(p.icon, 'package'))}</span>`
          : icon(lucideName(p.icon, 'package'))}</span>
        <div>
          <strong>${esc(p.name)}</strong>
          <div class="program-meta">
            <span class="badge badge-${p.channel === 'apt' ? 'docker' : p.channel === 'pnpm' ? 'node' : 'other'}">${esc(p.channel)}</span>
            ${p.version && !p.latestVersion ? `<span class="listener-note">${esc(p.version)}</span>` : ''}
            ${versionBadge}
          </div>
        </div>
      </div>
      ${p.desc ? `<p class="program-desc">${esc(p.desc)}</p>` : ''}
      ${authHtml}
      <details class="program-steps"><summary>Comandos</summary>${stepsInfo}</details>
      <div class="program-actions">
        ${p.installed ? (hasUpdate
          ? `<button class="btn-primary program-update" data-id="${esc(p.id)}">${icon('arrow-up-circle')} Actualizar</button>`
          : `<span class="program-ok">${icon('check-circle-2')} Al día</span>`)
          : '<button class="btn-action" disabled>No instalado</button>'}
      </div>`;
    grid.appendChild(card);
  }
  refreshIcons();
}

$('#programs-grid').addEventListener('click', async (e) => {
  const authBtn = e.target.closest('.program-auth-act');
  if (authBtn) {
    try {
      const { job } = await api(`/api/programs/${authBtn.dataset.id}/${authBtn.dataset.act}`, { method: 'POST' });
      openJobModal(job);
      if (authBtn.dataset.act === 'login') {
        toast('Seguí el log del job: ahí aparece la URL o código para autorizar', 'ok');
      }
    } catch (err) { errToast(err); }
    return;
  }
  const btn = e.target.closest('.program-update');
  if (!btn || btn.disabled) return;
  try {
    const { job } = await api(`/api/programs/${btn.dataset.id}/update`, { method: 'POST' });
    openJobModal(job);
  } catch (err) {
    errToast(err);
  }
});

$('#update-all-btn').addEventListener('click', async () => {
  try {
    const { job } = await api('/api/programs/update-all', { method: 'POST' });
    openJobModal(job);
  } catch (err) {
    errToast(err);
  }
});

$('#programs-refresh').addEventListener('click', () => loadPrograms(true));

$('#installed-load').addEventListener('click', loadInstalled);
$('#installed-filter').addEventListener('input', () => renderInstalledFilter());

let installedData = null;

async function loadInstalled() {
  try {
    installedData = await api('/api/programs/installed');
    renderInstalled();
  } catch (err) {
    errToast(err);
  }
}

function renderInstalled() {
  if (!installedData) return;
  const { desktopApps, packages } = installedData;
  const sum = $('#installed-summary');
  sum.classList.remove('hidden');
  sum.innerHTML = `
    <span class="listener-note">${icon('package')} ${packages.apt.total} paquetes apt</span>
    <span class="listener-note">${icon('archive')} ${packages.snaps.length} snaps</span>
    <span class="listener-note">${icon('terminal')} ${packages.pnpmGlobals.length} globales pnpm</span>
    <span class="listener-note">${icon('cookie')} ${(packages.bunGlobals || []).length} globales bun</span>
    <span class="listener-note">${icon('monitor')} ${desktopApps.length} apps desktop</span>`;
  renderInstalledFilter();
}

function renderInstalledFilter() {
  if (!installedData) return;
  const q = ($('#installed-filter').value || '').toLowerCase();
  const grid = $('#installed-apps');
  const { desktopApps, packages } = installedData;
  const cliItems = [
    ...(packages.pnpmGlobals || []).map((g) => ({ name: g.name, version: g.version, source: 'pnpm' })),
    ...(packages.bunGlobals || []).map((g) => ({ name: g.name, version: g.version, source: 'bun' })),
    ...(packages.snaps || []).map((s) => ({ name: s.name, version: s.version, source: 'snap' })),
  ];
  const cliHtml = cliItems
    .filter((c) => c.name.toLowerCase().includes(q))
    .map((c) => `
      <div class="app-chip" title="${esc(c.name)}">
        ${icon('terminal')}
        <span class="mono">${esc(c.name)}</span>
        ${c.version ? `<span class="listener-note">${esc(c.version)}</span>` : ''}
        <span class="chip-src">${esc(c.source)}</span>
      </div>`).join('');
  const apps = desktopApps.filter((a) => a.name.toLowerCase().includes(q));
  const desktopHtml = apps.map((a) => `
    <div class="app-chip" title="${esc(a.exec || '')}">
      ${a.icon
        ? `<img src="/api/icons/${encodeURIComponent(a.icon)}" onerror="this.nextElementSibling.classList.remove('hidden'); this.remove()" alt=""><span class="hidden">${icon('monitor')}</span>`
        : icon('monitor')}
      <span>${esc(a.name)}</span>
      <span class="chip-src">${esc(a.source)}</span>
    </div>`).join('');
  grid.innerHTML = cliHtml + desktopHtml;
  refreshIcons();
}

// ---------- Jobs (live update logs + history) ----------

async function loadJobsHistory() {
  try {
    const { jobs } = await api('/api/jobs');
    renderJobsHistory(jobs || []);
  } catch { /* history is best-effort */ }
}

const JOB_STATUS_ICON = { ok: 'circle-check', failed: 'circle-x', running: 'loader' };

function renderJobsHistory(jobs) {
  const sorted = [...jobs]
    .sort((a, b) => (typeof b.startedAt === 'number' ? b.startedAt : Date.parse(b.startedAt)) - (typeof a.startedAt === 'number' ? a.startedAt : Date.parse(a.startedAt)))
    .slice(0, 10);
  $('#jobs-empty').classList.toggle('hidden', sorted.length > 0);
  $('#jobs-history').innerHTML = sorted.map((j) => {
    const status = j.status || 'ok';
    const iconName = JOB_STATUS_ICON[status] || 'circle';
    const cls = status === 'ok' ? 'jh-ok' : status === 'failed' ? 'jh-fail' : 'jh-run';
    const spin = status === 'running' ? ' spin' : '';
    const hints = (j.steps || [])
      .filter((s) => s.status === 'failed')
      .map((s) => `${s.label}: ${s.hint || `exit ${s.exitCode}`}`)
      .join(' · ');
    return `<div class="job-row" data-id="${esc(j.id)}" title="Ver log">
      ${icon(iconName, cls + spin)}
      <span class="job-title">${esc(j.title)}</span>
      ${hints ? `<span class="job-hint">${esc(hints)}</span>` : ''}
      <span class="job-time">${relTime(j.startedAt)}</span>
    </div>`;
  }).join('');
  refreshIcons();
}

$('#jobs-history').addEventListener('click', async (e) => {
  const row = e.target.closest('.job-row');
  if (!row) return;
  try {
    const { job } = await api(`/api/jobs/${row.dataset.id}`);
    openJobModal(job);
  } catch (err) { errToast(err); }
});

$('#jobs-refresh').addEventListener('click', loadJobsHistory);

function openJobModal(job) {
  // Ask once for notification permission when the user first runs a job —
  // job completion then alerts even with the tab unfocused (remote usage).
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  currentJobId = job.id;
  $('#job-modal').classList.remove('hidden');
  renderJob(job);
  if (jobPollTimer) { clearInterval(jobPollTimer); jobPollTimer = null; }
  if (job.status === 'running') {
    jobPollTimer = setInterval(pollJob, 1000);
  }
}

async function pollJob() {
  if (!currentJobId) return;
  try {
    const { job } = await api(`/api/jobs/${currentJobId}`);
    renderJob(job);
    if (job.status !== 'running') {
      clearInterval(jobPollTimer);
      jobPollTimer = null;
      const failed = job.steps.filter((s) => s.status === 'failed');
      if (failed.length) {
        const hints = failed.map((s) => `${s.label}: ${s.hint || `exit ${s.exitCode}`}`).join('\n');
        toast(`${job.title}: ${failed.length} paso(s) fallaron`, 'error', hints, 10000);
      } else {
        toast(`${job.title} completado`, 'ok');
      }
      // OS notification when the tab isn't focused — useful when managing remotely
      if ((document.hidden || !document.hasFocus()) && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(job.title, {
          body: failed.length ? `${failed.length} paso(s) fallaron` : 'Completado',
          icon: '/icons/app.svg',
        });
      }
      loadPrograms().catch(() => {});
      loadJobsHistory().catch(() => {});
    }
  } catch {
    // Job deleted or endpoint unreachable — stop polling instead of
    // hammering a 404 every second until the modal is closed.
    clearInterval(jobPollTimer);
    jobPollTimer = null;
  }
}

function renderJob(job) {
  $('#job-title').textContent = job.title;
  const st = $('#job-status');
  if (job.status === 'running') { st.textContent = 'Corriendo'; st.className = 'logs-status logs-status-connecting'; }
  else if (job.status === 'ok') { st.textContent = 'Completado'; st.className = 'logs-status logs-status-connected'; }
  else { st.textContent = 'Falló'; st.className = 'logs-status logs-status-disconnected'; }
  const STEP_ICON = { ok: 'circle-check', failed: 'circle-x', running: 'loader', skipped: 'circle-minus', pending: 'circle' };
  $('#job-steps').innerHTML = job.steps.map((s) => {
    const stepIcon = icon(STEP_ICON[s.status] || 'circle', s.status === 'running' ? 'spin' : '');
    const title = s.hint ? ` title="${esc(s.hint)}"` : '';
    return `<span class="job-step job-step-${s.status}"${title}>${stepIcon} ${esc(s.label)}${s.exitCode !== undefined && s.status === 'failed' ? ` (exit ${s.exitCode})` : ''}${s.hint ? ` — ${esc(s.hint)}` : ''}</span>`;
  }).join('');
  // Topgrade-style summary: one chip per group (program), aggregated status
  if (job.status !== 'running') {
    const groups = new Map();
    for (const s of job.steps) {
      const g = s.group || s.label;
      const cur = groups.get(g) || 'ok';
      if (s.status === 'failed') groups.set(g, 'failed');
      else if (s.status === 'skipped' && cur === 'ok') groups.set(g, 'skipped');
      else if (s.status !== 'skipped' && !groups.has(g)) groups.set(g, 'ok');
    }
    const CH = { ok: 'circle-check', failed: 'circle-x', skipped: 'circle-minus' };
    $('#job-groups').innerHTML = Array.from(groups, ([g, st]) =>
      `<span class="job-group job-group-${st}">${icon(CH[st] || 'circle')} ${esc(g)}</span>`).join('');
  } else {
    $('#job-groups').innerHTML = '';
  }
  refreshIcons();
  const pre = $('#job-log');
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
  pre.textContent = job.log;
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

$('#job-close').addEventListener('click', () => {
  $('#job-modal').classList.add('hidden');
  if (jobPollTimer) { clearInterval(jobPollTimer); jobPollTimer = null; }
});

// ---------- Projects ----------

async function loadProjects() {
  try {
    const { projects } = await api('/api/projects');
    $('#projects-updated').textContent = `Actualizado ${new Date().toLocaleTimeString()}`;
    renderProjects(projects);
    const nc = $('#nav-count-projects');
    if (nc) nc.textContent = (projects || []).length || '';
  } catch (err) {
    errToast(err);
  }
}

const TYPE_BADGE = { node: 'badge-node', bun: 'badge-bun', python: 'badge-python', rust: 'badge-other', go: 'badge-other', static: 'badge-other', other: 'badge-other' };

function renderProjects(projects) {
  const tbody = $('#projects-table tbody');
  tbody.innerHTML = '';
  $('#projects-empty').classList.toggle('hidden', projects.length > 0);
  for (const p of projects) {
    const tr = document.createElement('tr');
    const running = !!p.running;
    const ports = p.running?.ports?.length
      ? p.running.ports.map((pt) => portLinksHtml(pt, p.running.listeners)).join(' ')
      : (p.port ? `:${p.port}` : '-');
    tr.innerHTML = `
      <td><strong>${esc(p.name)}</strong>${p.framework ? ` <span class="badge badge-python">${esc(p.framework)}</span>` : ''}</td>
      <td><span class="badge ${TYPE_BADGE[p.type] || 'badge-other'}">${esc(p.type)}</span></td>
      <td><span class="badge ${running ? 'badge-status-running' : 'badge-status-stopped'}">${running ? `corriendo · pid ${p.running.pid}` : 'detenido'}</span></td>
      <td>${ports}</td>
      <td class="cmd-cell" title="${esc(p.cwd)}">${esc(p.cwd)}</td>
      <td><div class="actions">
        ${running
          ? `<button class="btn-danger pj-stop" data-id="${p.id}">${icon('square')} Parar</button>`
          : `<button class="btn-action pj-start" data-id="${p.id}">${icon('play')} Iniciar</button>`}
        ${!running && (p.type === 'node' || p.type === 'bun' || p.type === 'python') ? `<button class="btn-action pj-install" data-id="${p.id}">${icon('package-plus')} Deps</button>` : ''}
        <button class="btn-secondary pj-logs" data-id="${p.id}">${icon('file-text')} Logs</button>
        <button class="btn-secondary pj-edit" data-id="${p.id}" title="Editar">${icon('pencil')}</button>
      </div></td>`;
    tbody.appendChild(tr);
  }
  tbody.dataset.projects = JSON.stringify(projects.map((p) => ({ id: p.id, name: p.name, cwd: p.cwd, command: p.command, port: p.port, type: p.type })));
  refreshIcons();
}

$('#projects-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  const list = JSON.parse($('#projects-table tbody').dataset.projects || '[]');
  const project = list.find((p) => p.id === id);

  if (btn.classList.contains('pj-start')) {
    btn.disabled = true;
    btn.innerHTML = icon('loader', 'spin');
    refreshIcons();
    try {
      const res = await api(`/api/projects/${id}/start`, { method: 'POST' });
      toast(`Iniciado (pid ${res.pid})`, 'ok', res.command || '');
      loadProjects();
    } catch (err) {
      errToast(err);
      if (err.raw?.needsInstall) {
        toast('Primero instalá las dependencias con el botón "Deps"', 'warn');
      }
      loadProjects();
    }
  } else if (btn.classList.contains('pj-stop')) {
    try {
      await api(`/api/projects/${id}/stop`, { method: 'POST' });
      toast('Proyecto detenido', 'ok');
      loadProjects();
    } catch (err) { errToast(err); }
  } else if (btn.classList.contains('pj-install')) {
    try {
      const { job } = await api(`/api/projects/${id}/install`, { method: 'POST' });
      openJobModal(job);
    } catch (err) { errToast(err); }
  } else if (btn.classList.contains('pj-logs')) {
    openProjectLogs(project);
  } else if (btn.classList.contains('pj-edit')) {
    openProjectEdit(project);
  }
});

$('#projects-detect-btn').addEventListener('click', async () => {
  try {
    const { projects } = await api('/api/projects/detect', { method: 'POST' });
    toast(`${projects.length} proyectos detectados`, 'ok');
    renderProjects(projects);
  } catch (err) { errToast(err); }
});

$('#projects-add-btn').addEventListener('click', () => openProjectEdit(null));

// Project logs modal (polling tail)
let logsProjectId = null;
$('#logs-close').addEventListener('click', () => { $('#logs-modal').classList.add('hidden'); logsProjectId = null; });
$('#logs-reload').addEventListener('click', () => { if (logsProjectId) fetchProjectLogs(logsProjectId); });

function openProjectLogs(project) {
  logsProjectId = project.id;
  $('#logs-modal-title').textContent = `Logs — ${project.name}`;
  $('#logs-modal').classList.remove('hidden');
  fetchProjectLogs(project.id);
}

async function fetchProjectLogs(id) {
  try {
    const { lines } = await api(`/api/projects/${id}/logs?tail=300`);
    const pre = $('#logs-pre');
    pre.textContent = lines.join('\n') || '(sin logs)';
    pre.scrollTop = pre.scrollHeight;
  } catch (err) { errToast(err); }
}

// Project edit modal
function openProjectEdit(project) {
  $('#project-edit-title').textContent = project ? 'Editar proyecto' : 'Agregar proyecto';
  $('#project-edit-id').value = project?.id || '';
  $('#project-edit-name').value = project?.name || '';
  $('#project-edit-command').value = project?.command || '';
  $('#project-edit-cwd').value = project?.cwd || '';
  $('#project-edit-port').value = project?.port || '';
  $('#project-edit-delete').classList.toggle('hidden', !project);
  $('#project-edit-error').textContent = '';
  $('#project-edit-modal').classList.remove('hidden');
}

$('#project-edit-cancel').addEventListener('click', () => $('#project-edit-modal').classList.add('hidden'));
$('#project-edit-delete').addEventListener('click', async () => {
  const id = $('#project-edit-id').value;
  if (!id || !confirm('¿Eliminar el proyecto del panel? (no borra archivos)')) return;
  try {
    await api(`/api/projects/${id}`, { method: 'DELETE' });
    $('#project-edit-modal').classList.add('hidden');
    loadProjects();
  } catch (err) { errToast(err); }
});

$('#project-edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#project-edit-id').value;
  const body = {
    id: id || undefined,
    name: $('#project-edit-name').value,
    cwd: $('#project-edit-cwd').value,
    command: $('#project-edit-command').value || undefined,
    port: parseInt($('#project-edit-port').value, 10) || undefined,
    type: 'other',
  };
  try {
    await api('/api/projects', { method: 'POST', body });
    $('#project-edit-modal').classList.add('hidden');
    loadProjects();
  } catch (err) {
    $('#project-edit-error').textContent = err.message;
  }
});

// ---------- Docker ----------

async function loadDocker() {
  try {
    const { containers } = await api('/api/docker');
    $('#docker-updated').textContent = `Actualizado ${new Date().toLocaleTimeString()}`;
    const ncd = $('#nav-count-docker');
    if (ncd) ncd.textContent = (containers || []).length || '';
    const tbody = $('#docker-table tbody');
    tbody.innerHTML = '';
    $('#docker-empty').classList.toggle('hidden', containers.length > 0);
    for (const ct of containers) {
      const tr = document.createElement('tr');
      const ports = ct.publicPorts.length
        ? ct.publicPorts.map((p) => portLinksHtml(p, null)).join(' ')
        : esc(ct.ports || '-');
      const domainLink = ct.domain ? `<a class="domain-link" href="https://${esc(ct.domain.fullDomain)}" target="_blank">${icon('globe')} ${esc(ct.domain.subdomain)}</a>` : '';
      tr.innerHTML = `
        <td><strong>${esc(ct.names)}</strong>${ct.composeProject ? ` <span class="listener-note">${esc(ct.composeProject)}</span>` : ''}</td>
        <td class="cmd-cell">${esc(ct.image)}</td>
        <td><span class="badge ${ct.state === 'running' ? 'badge-status-running' : 'badge-status-stopped'}">${esc(ct.status)}</span></td>
        <td>${ports} ${domainLink}</td>
        <td><div class="actions">
          ${ct.state === 'running'
            ? `<button class="btn-secondary dk-restart" data-id="${ct.id}" title="Reiniciar">${icon('rotate-cw')}</button>`
            : `<button class="btn-secondary dk-start" data-id="${ct.id}" title="Iniciar">${icon('play')}</button>`}
          ${ct.state === 'running'
            ? `<button class="btn-secondary dk-term" data-id="${ct.id}" data-name="${esc(ct.names)}" title="Terminal">${icon('terminal')}</button>`
            : ''}
          <button class="btn-secondary dk-logs" data-id="${ct.id}">${icon('file-text')} Logs</button>
          <button class="btn-action dk-domain" data-id="${ct.id}" data-ports="${ct.publicPorts.join(',')}" data-name="${esc(ct.names)}">${icon('globe')} Dominio</button>
          <button class="btn-danger dk-stop" data-id="${ct.id}">${icon('square')} Parar</button>
        </div></td>`;
      tbody.appendChild(tr);
    }
    refreshIcons();
  } catch (err) {
    errToast(err);
  }
}

$('#docker-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains('dk-stop')) {
    if (!confirm('¿Parar este contenedor?')) return;
    try {
      await api(`/api/docker/${id}/stop`, { method: 'POST' });
      toast('Contenedor detenido', 'ok');
      loadDocker();
    } catch (err) { errToast(err); }
  } else if (btn.classList.contains('dk-start') || btn.classList.contains('dk-restart')) {
    const restart = btn.classList.contains('dk-restart');
    if (restart && !confirm(`¿Reiniciar ${id}?`)) return;
    btn.disabled = true;
    try {
      await api(`/api/docker/${id}/${restart ? 'restart' : 'start'}`, { method: 'POST' });
      toast(restart ? 'Contenedor reiniciado' : 'Contenedor iniciado', 'ok');
      loadDocker();
    } catch (err) { errToast(err); loadDocker(); }
  } else if (btn.classList.contains('dk-term')) {
    openTermExec(id, btn.dataset.name || id);
  } else if (btn.classList.contains('dk-logs')) {
    $('#logs-modal-title').textContent = `Logs — ${id}`;
    $('#logs-modal').classList.remove('hidden');
    logsProjectId = null;
    try {
      const { lines } = await api(`/api/docker/${id}/logs`);
      const pre = $('#logs-pre');
      pre.textContent = lines.join('\n') || '(sin logs)';
      pre.scrollTop = pre.scrollHeight;
    } catch (err) { errToast(err); }
  } else if (btn.classList.contains('dk-domain')) {
    const port = parseInt((btn.dataset.ports || '').split(',')[0], 10);
    if (!port) { toast('El contenedor no publica puertos', 'warn'); return; }
    openDomainModal({ port, processType: 'docker', projectName: btn.dataset.name, label: btn.dataset.name });
  }
});

// ---------- Domains ----------

async function loadDomains() {
  try {
    const { domains } = await api('/api/domains');
    const ncm = $('#nav-count-domains');
    if (ncm) ncm.textContent = (domains || []).length || '';
    if (domains?.[0]) {
      $('#domain-suffix-text').textContent = domains[0].fullDomain.split('.').slice(1).join('.');
    }
    const tbody = $('#domains-table tbody');
    tbody.innerHTML = '';
    $('#domains-empty').classList.toggle('hidden', domains.length > 0);
    for (const d of domains) {
      const tr = document.createElement('tr');
      tr.dataset.domainId = d.id;
      tr.innerHTML = `
        <td class="sel-col"><input type="checkbox" class="dm-sel" data-id="${d.id}"${domainSel.has(d.id) ? ' checked' : ''}></td>
        <td><a class="domain-link" href="https://${esc(d.fullDomain)}" target="_blank">${icon('globe')} ${esc(d.fullDomain)}</a></td>
        <td class="domain-status"><span class="health-dot health-unknown"></span> <span class="listener-note">…</span></td>
        <td>${esc(d.projectName)} <span class="listener-note">${esc(d.processType)}</span></td>
        <td class="cmd-cell">${esc(d.target)}</td>
        <td>${new Date(d.createdAt).toLocaleDateString()}</td>
        <td><div class="actions">
          <button class="btn-action dm-edit" data-id="${d.id}" data-sub="${esc(d.subdomain)}">${icon('pencil')} Editar</button>
          <button class="btn-danger dm-del" data-id="${d.id}">${icon('trash-2')} Eliminar</button>
        </div></td>`;
      tbody.appendChild(tr);
    }
    refreshIcons();
    loadDomainStatuses();
  } catch (err) { errToast(err); }
}

// Uptime Kuma-style tick strip + 24h % per domain, from persisted heartbeats.
async function loadUptimeStrips() {
  const { heartbeats, uptime } = await api('/api/domains/heartbeats');
  for (const [id, strip] of Object.entries(
    Object.fromEntries($$('.uptime-strip[data-domain-id]').map((el) => [el.dataset.domainId, el]))
  )) {
    const ticks = (heartbeats[id] || []).slice(-48);
    if (!ticks.length) { strip.innerHTML = '<span class="listener-note">Sin datos aún</span>'; continue; }
    const bars = ticks.map((h) =>
      `<span class="upt tick-${h.s}" title="${new Date(h.t).toLocaleString()} — ${h.s}${h.ms !== undefined ? ` · ${h.ms}ms` : ''}"></span>`
    ).join('');
    const pct = uptime[id];
    strip.innerHTML = `${bars}<span class="uptime-pct">${pct === null || pct === undefined ? '' : pct + '%'}</span>`;
  }
}

async function loadDomainStatuses() {
  try {
    const { statuses } = await api('/api/domains/status');
    for (const [id, s] of Object.entries(statuses || {})) {
      const cell = document.querySelector(`tr[data-domain-id="${id}"] .domain-status`);
      if (!cell) continue;
      const label = s.state === 'up' ? 'Activo' : s.state === 'warn' ? `HTTP ${s.httpStatus}` : 'Caído';
      const cls = s.state === 'up' ? 'health-ok' : s.state === 'warn' ? 'health-warn' : 'health-bad';
      const ms = s.ms !== undefined ? ` <span class="health-ms">${s.ms}ms</span>` : '';
      cell.innerHTML = `<span class="health-dot ${cls}"></span> <span class="listener-note">${label}</span>${ms}<div class="uptime-strip" data-domain-id="${id}"></div>`;
      cell.title = s.reason || (s.state === 'up' ? `Responde HTTP ${s.httpStatus}` : '');
      cell.closest('tr').classList.toggle('domain-dead', s.state === 'down');
    }
    loadUptimeStrips().catch(() => {});
    // Nav badge turns red when any domain is down
    const down = Object.values(statuses || {}).filter((s) => s.state === 'down').length;
    const ncm = $('#nav-count-domains');
    if (ncm) {
      ncm.textContent = down ? `${Object.keys(statuses).length} · ${down} caídos` : Object.keys(statuses).length || '';
      ncm.classList.toggle('nav-alert', down > 0);
      ncm.title = down ? `${down} dominio(s) caídos` : '';
    }
  } catch { /* statuses are best-effort */ }
}

// Domain selection + bulk delete
const domainSel = new Set();

function updateDomainBulkbar() {
  const n = domainSel.size;
  $('#domains-bulkbar').classList.toggle('hidden', n === 0);
  $('#domains-sel-count').textContent = `${n} seleccionado${n === 1 ? '' : 's'}`;
  $('#domains-sel-all').checked = n > 0 && n === document.querySelectorAll('.dm-sel').length;
}

function confirmDialog(title, body, okLabel = 'Eliminar') {
  return new Promise((resolve) => {
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    $('#confirm-ok').textContent = okLabel;
    $('#confirm-modal').classList.remove('hidden');
    const done = (v) => {
      $('#confirm-modal').classList.add('hidden');
      $('#confirm-ok').onclick = $('#confirm-cancel').onclick = null;
      resolve(v);
    };
    $('#confirm-ok').onclick = () => done(true);
    $('#confirm-cancel').onclick = () => done(false);
  });
}

function removeDomainRows(ids) {
  for (const id of ids) {
    domainSel.delete(id);
    document.querySelector(`tr[data-domain-id="${id}"]`)?.remove();
  }
  updateDomainBulkbar();
  const tbody = $('#domains-table tbody');
  const remaining = tbody.querySelectorAll('tr').length;
  $('#domains-empty').classList.toggle('hidden', remaining > 0);
  const nc = $('#nav-count-domains');
  if (nc) nc.textContent = remaining || '';
}

$('#domains-sel-all').addEventListener('change', (e) => {
  const on = e.target.checked;
  document.querySelectorAll('.dm-sel').forEach((cb) => {
    cb.checked = on;
    on ? domainSel.add(cb.dataset.id) : domainSel.delete(cb.dataset.id);
  });
  updateDomainBulkbar();
});

$('#domains-del-sel').addEventListener('click', async () => {
  const ids = [...domainSel];
  if (!ids.length) return;
  const ok = await confirmDialog(
    `Eliminar ${ids.length} dominio${ids.length === 1 ? '' : 's'}`,
    'Se borran los registros DNS de Cloudflare y las rutas del túnel de todos los seleccionados.'
  );
  if (!ok) return;
  try {
    const res = await api('/api/domains/bulk-delete', { method: 'POST', body: { ids } });
    removeDomainRows(ids.filter((id) => !(res.failedIds || []).includes(id)));
    toast(`${res.removed} eliminado${res.removed === 1 ? '' : 's'}${res.failed ? `, ${res.failed} fallaron` : ''}`, res.failed ? 'warn' : 'ok');
    if (!res.syncOk) toast('El sync del túnel falló — revisá cloudflared', 'err');
    loadDomains();
  } catch (err) { errToast(err); }
});

$('#domains-table').addEventListener('click', async (e) => {
  const cb = e.target.closest('.dm-sel');
  if (cb) {
    cb.checked ? domainSel.add(cb.dataset.id) : domainSel.delete(cb.dataset.id);
    updateDomainBulkbar();
    return;
  }
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains('dm-del')) {
    const ok = await confirmDialog('Eliminar dominio', 'Se borra el DNS de Cloudflare y la ruta del túnel.');
    if (!ok) return;
    try {
      await api(`/api/domains/${id}`, { method: 'DELETE' });
      removeDomainRows([id]);
      toast('Dominio eliminado', 'ok');
      loadDomains();
    } catch (err) { errToast(err); }
  } else if (btn.classList.contains('dm-edit')) {
    $('#domain-modal-info').textContent = 'Editar subdominio';
    $('#domain-input').value = btn.dataset.sub;
    $('#domain-id').value = id;
    $('#domain-error').textContent = '';
    $('#domain-modal').classList.remove('hidden');
  }
});

$('#domains-import-btn').addEventListener('click', async () => {
  try {
    const res = await api('/api/domains/import', { method: 'POST' });
    toast(`Importados ${res.imported.length} dominios — ${res.skipped.length} omitidos${res.blocked?.length ? `, ${res.blocked.length} bloqueados (los habías eliminado)` : ''}`, 'ok');
    loadDomains();
  } catch (err) { errToast(err); }
});

function openDomainModal({ port, processType, projectName, label, suggest }) {
  $('#domain-modal-info').textContent = `Asignar subdominio a ${label} (puerto ${port})`;
  $('#domain-input').value = suggest || '';
  $('#domain-port').value = port;
  $('#domain-type').value = processType;
  $('#domain-project').value = projectName;
  $('#domain-id').value = '';
  $('#domain-error').textContent = '';
  $('#domain-modal').classList.remove('hidden');
}

$('#domain-cancel').addEventListener('click', () => $('#domain-modal').classList.add('hidden'));

$('#domain-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#domain-id').value;
  try {
    if (id) {
      await api(`/api/domains/${id}`, { method: 'PUT', body: { subdomain: $('#domain-input').value } });
    } else {
      await api('/api/domains', {
        method: 'POST',
        body: {
          subdomain: $('#domain-input').value,
          port: parseInt($('#domain-port').value, 10),
          processType: $('#domain-type').value,
          projectName: $('#domain-project').value,
        },
      });
    }
    $('#domain-modal').classList.add('hidden');
    toast('Dominio guardado', 'ok');
    loadDomains();
  } catch (err) {
    $('#domain-error').textContent = err.message + (err.detail ? ` — ${err.detail}` : '');
  }
});

// ---------- Settings ----------

$('#settings-btn').addEventListener('click', async () => {
  try {
    const { config } = await api('/api/config');
    const s = config.settings;
    $('#settings-scan-interval').value = s.scanIntervalMs;
    $('#settings-protected-pids').value = (s.protectedPids || []).join(', ');
    $('#settings-protected-ports').value = (s.protectedPorts || []).join(', ');
    $('#settings-ignored-patterns').value = (s.ignoredPatterns || []).join('\n');
    $('#settings-scan-dirs').value = (s.scanDirs || []).join('\n');
    $('#settings-known-services').value = Object.entries(s.knownServices || {})
      .map(([port, svc]) => `${port}:${svc.name}:${svc.icon || ''}`)
      .join('\n');
    $('#settings-notify-url').value = s.notifyUrl || '';
    updateTotpStatus(!!config.auth?.totpEnabled);
    $('#settings-error').textContent = '';
    $('#settings-modal').classList.remove('hidden');
  } catch (err) { errToast(err); }
});

$('#settings-cancel').addEventListener('click', () => $('#settings-modal').classList.add('hidden'));

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const numList = (v) => v.split(/[,\n]/).map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n));
  const strList = (v) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const knownServices = {};
  for (const line of $('#settings-known-services').value.split('\n')) {
    const m = line.match(/^(\d+):([^:]+):?(.*)$/);
    if (m) knownServices[m[1]] = { name: m[2].trim(), icon: m[3].trim() || 'wrench' };
  }
  try {
    await api('/api/config', {
      method: 'PUT',
      body: {
        scanIntervalMs: parseInt($('#settings-scan-interval').value, 10) || 5000,
        protectedPids: numList($('#settings-protected-pids').value),
        protectedPorts: numList($('#settings-protected-ports').value),
        ignoredPatterns: strList($('#settings-ignored-patterns').value),
        scanDirs: strList($('#settings-scan-dirs').value),
        notifyUrl: $('#settings-notify-url').value.trim(),
        knownServices,
      },
    });
    $('#settings-modal').classList.add('hidden');
    toast('Configuración guardada', 'ok');
  } catch (err) {
    $('#settings-error').textContent = err.message;
  }
});

// ---------- TOTP (2FA) ----------
// The settings row mirrors config.auth.totpEnabled; the modal is reused for
// enable (QR + manual key) and disable (code only).

function updateTotpStatus(enabled) {
  $('#totp-status').textContent = enabled ? 'Activada' : 'Desactivada';
  $('#totp-enable-btn').classList.toggle('hidden', enabled);
  $('#totp-disable-btn').classList.toggle('hidden', !enabled);
}

let totpMode = 'enable';

function openTotpModal(mode) {
  totpMode = mode;
  const enabling = mode === 'enable';
  $('#totp-title').textContent = enabling ? 'Activar verificación en dos pasos' : 'Desactivar verificación en dos pasos';
  $('#totp-desc').textContent = enabling
    ? 'Escaneá el QR con tu app autenticadora (Google Authenticator, Aegis, 1Password…) e ingresá el código de 6 dígitos para confirmar.'
    : 'Ingresá el código actual de tu app autenticadora para desactivar el 2FA.';
  $('#totp-qr').innerHTML = '';
  $('#totp-secret').textContent = '';
  $('#totp-qr').classList.toggle('hidden', !enabling);
  $('#totp-secret-wrap').classList.toggle('hidden', !enabling);
  $('#totp-code').value = '';
  $('#totp-error').textContent = '';
  $('#totp-modal').classList.remove('hidden');
  if (enabling) {
    api('/api/auth/totp/setup', { method: 'POST' })
      .then((res) => {
        const qr = qrcode(0, 'M');
        qr.addData(res.uri);
        qr.make();
        $('#totp-qr').innerHTML = qr.createSvgTag(6, 8);
        $('#totp-secret').textContent = res.secret;
      })
      .catch((err) => { $('#totp-error').textContent = err.message; });
  }
  setTimeout(() => $('#totp-code').focus(), 50);
}

$('#totp-enable-btn').addEventListener('click', () => openTotpModal('enable'));
$('#totp-disable-btn').addEventListener('click', () => openTotpModal('disable'));
$('#totp-cancel').addEventListener('click', () => $('#totp-modal').classList.add('hidden'));
$('#totp-confirm').addEventListener('click', async () => {
  $('#totp-error').textContent = '';
  try {
    await api(`/api/auth/totp/${totpMode}`, { method: 'POST', body: { code: $('#totp-code').value.trim() } });
    $('#totp-modal').classList.add('hidden');
    updateTotpStatus(totpMode === 'enable');
    toast(totpMode === 'enable' ? '2FA activado — el próximo login pide el código' : '2FA desactivado', 'ok');
  } catch (err) {
    $('#totp-error').textContent = err.message;
  }
});
$('#totp-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#totp-confirm').click(); }
});

// ---------- Boot ----------

let portsTimer = null;

function bootMain() {
  loadStats();
  loadPorts();
  // Preload the other sections so sidebar counters are populated immediately
  loadProjects().catch(() => {});
  loadDocker().catch(() => {});
  loadDomains().catch(() => {});
  loadPrograms().catch(() => {});
  setInterval(loadStats, 5000);
  portsTimer = setInterval(() => {
    // don't clobber the table while a modal that depends on ports data is open
    if ($('#kill-modal').classList.contains('hidden') && $('#tab-ports').classList.contains('active')) {
      loadPorts();
    }
  }, 5000);
}

// ---------- Theme + sidebar ----------

const THEME_KEY = 'pm-theme';
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
  $$('.theme-option').forEach((b) => b.classList.toggle('active', b.dataset.theme === t));
  drawSpark('spark-cpu', sparkHist.cpu);
  drawSpark('spark-ram', sparkHist.ram);
}
$$('.theme-option').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.theme)));
setTheme(localStorage.getItem(THEME_KEY) || 'axon');

$('#sidebar-collapse').addEventListener('click', () => {
  document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('pm-sidebar', document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
});
if (localStorage.getItem('pm-sidebar') === '1') document.body.classList.add('sidebar-collapsed');

$('#sidebar-settings').addEventListener('click', () => $('#settings-btn').click());

function gotoTab(tab) {
  document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click();
}

// ---------- Command palette (⌘K) ----------

const cmdkOverlay = $('#cmdk-overlay');
const cmdkInput = $('#cmdk-input');
const cmdkList = $('#cmdk-list');
let cmdkIndex = 0;
let cmdkItems = [];

function cmdkCommands() {
  const net = netHost();
  const cmds = [
    { icon: 'plug', label: 'Ir a Puertos', hint: 'sección', run: () => gotoTab('ports') },
    { icon: 'folder-git-2', label: 'Ir a Proyectos', hint: 'sección', run: () => gotoTab('projects') },
    { icon: 'package', label: 'Ir a Programas', hint: 'sección', run: () => gotoTab('programs') },
    { icon: 'container', label: 'Ir a Docker', hint: 'sección', run: () => gotoTab('docker') },
    { icon: 'globe', label: 'Ir a Dominios', hint: 'sección', run: () => gotoTab('domains') },
    { icon: 'bot', label: 'Ir a Agents', hint: 'sección', run: () => document.querySelector('.tab-btn[data-tab="agents"]')?.click() },
    { icon: 'layout-grid', label: 'Agents: matriz de MCPs', hint: 'sección', run: () => window.pmGotoAgent?.('__matrix') },
    { icon: 'file-text', label: 'Agents: documentos', hint: 'sección', run: () => window.pmGotoAgent?.('__docs') },
    ...(window.__pmAgents || []).filter((a) => a.installed).map((a) => ({
      icon: 'bot', label: `Agente: ${a.name}`, hint: `${a.counts?.skills || 0} skills · ${a.counts?.mcps || 0} mcp`, run: () => window.pmGotoAgent?.(a.id),
    })),
    { icon: 'settings', label: 'Abrir configuración', hint: 'acción', run: () => $('#settings-btn').click() },
    { icon: 'refresh-cw', label: 'Recargar puertos', hint: 'acción', run: () => loadPorts() },
    { icon: 'arrow-up-circle', label: 'Actualizar todo', hint: 'job', run: () => { gotoTab('programs'); $('#update-all-btn').click(); } },
    { icon: 'moon', label: 'Tema: Linear', hint: 'tema', run: () => setTheme('linear') },
    { icon: 'moon', label: 'Tema: Netdata', hint: 'tema', run: () => setTheme('netdata') },
    { icon: 'moon', label: 'Tema: Warp', hint: 'tema', run: () => setTheme('warp') },
  ];
  for (const p of portsData) {
    const label = p.identity.label;
    for (const port of p.ports.slice(0, 4)) {
      if (isLocalClient()) {
        cmds.push({ icon: 'external-link', label: `Abrir ${label} :${port} (local)`, hint: 'localhost', run: () => window.open(`http://localhost:${port}`, '_blank') });
        if (net) cmds.push({ icon: 'external-link', label: `Abrir ${label} :${port} (red)`, hint: net, run: () => window.open(`http://${net}:${port}`, '_blank') });
      }
      cmds.push({ icon: 'route', label: `Abrir ${label} :${port} (proxy)`, hint: 'funciona remoto', run: () => window.open(`/p/${port}/`, '_blank') });
    }
    if (p.pid > 0 && !p.identity.protected) {
      cmds.push({ icon: 'power', label: `Cerrar ${label} (PID ${p.pid})`, hint: 'proceso', run: () => openKillModal(p.pid) });
    }
  }
  for (const pr of programsData.filter((x) => x.installed)) {
    cmds.push({ icon: 'arrow-up-circle', label: `Actualizar ${pr.name}`, hint: 'programa', run: async () => {
      try {
        const { job } = await api(`/api/programs/${pr.id}/update`, { method: 'POST' });
        gotoTab('programs');
        openJobModal(job);
      } catch (err) { errToast(err); }
    }});
  }
  return cmds;
}

function cmdkRender() {
  const q = cmdkInput.value.trim().toLowerCase();
  cmdkItems = cmdkCommands().filter((c) => !q || `${c.label} ${c.hint}`.toLowerCase().includes(q));
  cmdkIndex = Math.min(cmdkIndex, Math.max(0, cmdkItems.length - 1));
  cmdkList.innerHTML = cmdkItems.length
    ? cmdkItems.map((c, i) => `
      <div class="cmdk-item ${i === cmdkIndex ? 'selected' : ''}" data-i="${i}">
        ${icon(c.icon)} <span>${esc(c.label)}</span> <span class="cmdk-hint">${esc(c.hint)}</span>
      </div>`).join('')
    : `<div class="cmdk-empty">Sin resultados</div>`;
  refreshIcons();
}

function openCmdk() {
  cmdkOverlay.classList.remove('hidden');
  cmdkInput.value = '';
  cmdkIndex = 0;
  cmdkRender();
  cmdkInput.focus();
}
function closeCmdk() { cmdkOverlay.classList.add('hidden'); }

$('#cmdk-open').addEventListener('click', openCmdk);
cmdkOverlay.addEventListener('click', (e) => { if (e.target === cmdkOverlay) closeCmdk(); });
cmdkInput.addEventListener('input', () => { cmdkIndex = 0; cmdkRender(); });
cmdkInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdkIndex = Math.min(cmdkIndex + 1, cmdkItems.length - 1); cmdkRender(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkIndex = Math.max(cmdkIndex - 1, 0); cmdkRender(); }
  else if (e.key === 'Enter') { const c = cmdkItems[cmdkIndex]; if (c) { closeCmdk(); c.run(); } }
  else if (e.key === 'Escape') closeCmdk();
});
cmdkList.addEventListener('click', (e) => {
  const item = e.target.closest('.cmdk-item');
  if (item) { closeCmdk(); cmdkItems[parseInt(item.dataset.i, 10)]?.run(); }
});
cmdkList.addEventListener('mousemove', (e) => {
  const item = e.target.closest('.cmdk-item');
  if (item) { cmdkIndex = parseInt(item.dataset.i, 10); cmdkRender(); }
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    cmdkOverlay.classList.contains('hidden') ? openCmdk() : closeCmdk();
  } else if (e.key === 'Escape' && !cmdkOverlay.classList.contains('hidden')) {
    closeCmdk();
  }
});

refreshIcons();
initAuth();

// PWA: installable from laptop/phone (secure context: https tunnel or localhost)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || isLocalClient())) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---------- Row context menu ----------

const ctxMenu = $('#ctx-menu');
let ctxOpen = false;

function hideCtxMenu() {
  ctxMenu.classList.add('hidden');
  ctxMenu.innerHTML = '';
  ctxOpen = false;
}

function showCtxMenu(items, x, y) {
  ctxMenu.innerHTML = items
    .filter(Boolean)
    .map((it, i) => it.sep
      ? '<div class="ctx-sep"></div>'
      : `<button class="ctx-item${it.danger ? ' ctx-danger' : ''}" data-i="${i}">${icon(it.icon)} ${esc(it.label)}</button>`)
    .join('');
  ctxMenu.classList.remove('hidden');
  const rect = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = `${Math.min(x, innerWidth - rect.width - 8)}px`;
  ctxMenu.style.top = `${Math.min(y, innerHeight - rect.height - 8)}px`;
  refreshIcons();
  ctxMenu.querySelectorAll('.ctx-item').forEach((el) => {
    el.addEventListener('click', () => { const it = items[parseInt(el.dataset.i, 10)]; hideCtxMenu(); it.run(); });
  });
  ctxOpen = true;
}

document.addEventListener('click', (e) => { if (ctxOpen && !ctxMenu.contains(e.target)) hideCtxMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ctxOpen) hideCtxMenu(); });

function procFirstUrl(p) {
  const port = (p.ports || [])[0];
  return port ? `/p/${port}/` : null;
}

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function openProcMenu(p, anchor, coords) {
  const port = (p.ports || [])[0];
  const net = netHost();
  const cwd = p.identity.projectRoot || p.cwd || '';
  const items = [];
  if (port) {
    items.push(
      { icon: 'monitor', label: `Abrir :${port} en el navegador`, run: () => openInServerBrowser(`http://localhost:${port}`) },
      { icon: 'external-link', label: `Abrir :${port} (proxy)`, run: () => window.open(`/p/${port}/`, '_blank', 'noopener') },
      { icon: 'house', label: `Abrir localhost:${port}`, run: () => window.open(`http://localhost:${port}`, '_blank', 'noopener') },
    );
    if (net) items.push({ icon: 'network', label: `Abrir ${net}:${port}`, run: () => window.open(`http://${net}:${port}`, '_blank', 'noopener') });
    items.push({ icon: 'link', label: 'Copiar URL', run: () => { navigator.clipboard.writeText(`${location.origin}/p/${port}/`).catch(() => {}); toast('URL copiada', 'ok', '', 2000); } });
    items.push({ sep: true });
  }
  items.push({ icon: 'info', label: 'Info del proceso', run: () => openDetailModal(p.pid) });
  if (cwd) items.push({ icon: 'terminal', label: 'Terminal en esta carpeta', run: () => openTerm(cwd) });
  if (!p.domain && port) {
    items.push({ icon: 'globe', label: 'Exponer dominio…', run: () => openDomainModal({ port, processType: 'process', projectName: p.identity.projectRoot?.split('/').pop() || p.identity.label, label: p.identity.label, suggest: slugify(p.identity.projectRoot?.split('/').pop() || p.identity.label) }) });
  }
  if (!p.identity.unit) {
    items.push({ icon: 'shield-plus', label: 'Convertir en servicio…', run: () => openServiceModal(p.pid, slugify(p.identity.projectRoot?.split('/').pop() || p.name || 'app')) });
  }
  if (!p.identity.protected) {
    items.push({ sep: true }, { icon: 'power', label: 'Cerrar proceso', danger: true, run: () => openKillModal(p.pid) });
  }
  const r = anchor ? anchor.getBoundingClientRect() : null;
  showCtxMenu(items, coords ? coords.x : r.right + 4, coords ? coords.y : r.bottom + 4);
}

// Right-click on a process row opens the same menu
$('#ports-table').addEventListener('contextmenu', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || tr.classList.contains('folder-row')) return;
  const killBtn = tr.querySelector('.act-kill, .act-menu, .act-detail');
  const pid = killBtn ? parseInt(killBtn.dataset.pid || '0', 10) : 0;
  const p = portsData.find((x) => x.pid === pid);
  if (!p) return;
  e.preventDefault();
  openProcMenu(p, null, { x: e.clientX, y: e.clientY });
});

// ---------- Convert to systemd service ----------

let servicePid = null;

async function openServiceModal(pid, suggested) {
  servicePid = pid;
  $('#service-name').value = suggested || '';
  $('#service-preview').textContent = 'Cargando…';
  $('#service-error').textContent = '';
  $('#service-modal').classList.remove('hidden');
  try {
    const res = await api('/api/systemd/preview-service', { method: 'POST', body: { pid, name: $('#service-name').value } });
    $('#service-preview').textContent = res.unit;
  } catch (err) {
    $('#service-preview').textContent = '';
    $('#service-error').textContent = err.message;
  }
}

$('#service-name').addEventListener('input', async () => {
  if (!servicePid) return;
  try {
    const res = await api('/api/systemd/preview-service', { method: 'POST', body: { pid: servicePid, name: $('#service-name').value } });
    $('#service-preview').textContent = res.unit;
  } catch { /* preview is best-effort */ }
});

$('#service-cancel').addEventListener('click', () => $('#service-modal').classList.add('hidden'));

$('#service-create').addEventListener('click', async () => {
  const btn = $('#service-create');
  btn.disabled = true;
  try {
    const res = await api('/api/systemd/create-service', { method: 'POST', body: { pid: servicePid, name: $('#service-name').value } });
    $('#service-modal').classList.add('hidden');
    toast(`Servicio ${res.service} creado e iniciado — ahora se reinicia solo`, 'ok');
    loadPorts();
  } catch (err) {
    $('#service-error').textContent = err.message + (err.detail ? ` — ${err.detail}` : '');
  } finally {
    btn.disabled = false;
  }
});

// ---------- Terminal page (multi-session tmux tabs) ----------

const termSessions = new Map(); // name → {term, fit, ws, page, tabBtn}
let termCounter = 0;
let activeTerm = null;
const TERM_SESSIONS_KEY = 'pm.termSessions';

function savedTermSessions() {
  try { return JSON.parse(localStorage.getItem(TERM_SESSIONS_KEY) || '[]'); } catch { return []; }
}
function saveTermSessions() {
  // Only tmux-backed sessions persist across reloads; docker exec tabs die
  // with their socket and must not be restored.
  localStorage.setItem(TERM_SESSIONS_KEY, JSON.stringify([...termSessions.values()].filter((s) => !s.exec).map((s) => s.name)));
}

// opts.exec: open a docker exec shell into that container id/name instead of a
// tmux session. opts.label: text shown on the tab (defaults to name).
function openTermTab(name, cwd, opts = {}) {
  if (termSessions.has(name)) { activateTermTab(name); return termSessions.get(name); }
  const page = document.createElement('div');
  page.className = 'term-page';
  $('#term-pages').appendChild(page);

  const t = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: 'JetBrains Mono, monospace', theme: { background: '#0b0e14' } });
  const fit = new FitAddon.FitAddon();
  t.loadAddon(fit);
  t.open(page);

  const tabBtn = document.createElement('button');
  tabBtn.className = 'term-tab';
  tabBtn.innerHTML = `${icon('terminal')} <span>${esc(opts.label || name)}</span> <span class="term-tab-x" data-x="1">×</span>`;
  tabBtn.addEventListener('click', (e) => {
    if (e.target.dataset.x) { closeTermTab(name); return; }
    activateTermTab(name);
  });
  $('#term-tabs').appendChild(tabBtn);

  const sess = { term: t, fit, ws: null, page, tabBtn, name, exec: opts.exec || '', pendingCwd: cwd || '' };
  termSessions.set(name, sess);
  saveTermSessions();

  t.onData((d) => { if (sess.ws?.readyState === 1) sess.ws.send(JSON.stringify({ t: 'i', d })); });
  t.onResize(({ cols, rows }) => { if (sess.ws?.readyState === 1) sess.ws.send(JSON.stringify({ t: 'r', c: cols, r: rows })); });

  connectTermTab(sess);
  activateTermTab(name);
  refreshIcons();
  return sess;
}

function connectTermTab(sess) {
  const old = sess.ws;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = sess.exec
    ? `${proto}://${location.host}/ws/term?exec=${encodeURIComponent(sess.exec)}&c=${sess.term.cols}&r=${sess.term.rows}`
    : `${proto}://${location.host}/ws/term?s=${encodeURIComponent(sess.name)}&c=${sess.term.cols}&r=${sess.term.rows}`;
  const ws = new WebSocket(wsUrl);
  // Swap the reference BEFORE closing the old socket so its onclose can't
  // mark the new connection as offline.
  sess.ws = ws;
  if (old) { try { old.close(); } catch { /* gone */ } }
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    sess.tabBtn.classList.remove('term-tab-offline');
    if (sess.pendingCwd) { ws.send(JSON.stringify({ t: 'i', d: `cd ${JSON.stringify(sess.pendingCwd)}\n` })); sess.pendingCwd = ''; }
  };
  ws.onmessage = (e) => sess.term.write(new Uint8Array(e.data));
  ws.onclose = () => {
    // A stale socket closing must not mark the replacement as offline.
    if (sess.ws !== ws) return;
    sess.term.write('\r\n\x1b[33m[desconectado — click para reconectar]\x1b[0m\r\n');
    sess.tabBtn.classList.add('term-tab-offline');
  };
}

function activateTermTab(name) {
  activeTerm = name;
  for (const [n, s] of termSessions) {
    s.page.classList.toggle('active', n === name);
    s.tabBtn.classList.toggle('active', n === name);
  }
  const s = termSessions.get(name);
  if (s) requestAnimationFrame(() => { s.fit.fit(); s.term.focus(); });
}

function closeTermTab(name) {
  const s = termSessions.get(name);
  if (!s) return;
  try { s.ws?.close(); } catch { /* gone */ }
  s.term.dispose();
  s.page.remove();
  s.tabBtn.remove();
  termSessions.delete(name);
  saveTermSessions();
  if (activeTerm === name) {
    const next = termSessions.keys().next().value;
    if (next) activateTermTab(next);
    else activeTerm = null;
  }
}

function openTerm(cwd) {
  document.querySelector('.tab-btn[data-tab="terminal"]')?.click();
  if (cwd) {
    termCounter++;
    openTermTab(`axon-term-${termCounter}`, cwd);
  } else if (!termSessions.size) {
    termCounter++;
    openTermTab('axon-term');
  }
}

// Reconnect on click when offline
$('#term-pages').addEventListener('click', () => {
  const s = termSessions.get(activeTerm);
  if (s && s.ws?.readyState !== 1) connectTermTab(s);
});

$('#term-btn').addEventListener('click', () => openTerm());
$('#term-new-tab').addEventListener('click', () => {
  termCounter++;
  openTermTab(`axon-term-${termCounter}`);
});
window.addEventListener('resize', () => { if (activeTerm) termSessions.get(activeTerm)?.fit.fit(); });

// openTermCmd(cmd): open a fresh terminal tab and type a command into it —
// used by other features (docker exec, journalctl viewer, kill menus).
function openTermCmd(cmd) {
  document.querySelector('.tab-btn[data-tab="terminal"]')?.click();
  termCounter++;
  const sess = openTermTab(`axon-term-${termCounter}`);
  const t = setInterval(() => {
    if (sess.ws?.readyState === 1) {
      clearInterval(t);
      sess.ws.send(JSON.stringify({ t: 'i', d: cmd + '\n' }));
    }
  }, 200);
  setTimeout(() => clearInterval(t), 8000);
}

// openTermExec(id, name): open a fresh terminal tab running an interactive
// shell inside a docker container (`docker exec -it`). Not tmux-persistent —
// the session dies when the tab/socket closes.
function openTermExec(id, name) {
  document.querySelector('.tab-btn[data-tab="terminal"]')?.click();
  termCounter++;
  const label = (name || id).length > 20 ? `${(name || id).slice(0, 19)}…` : (name || id);
  openTermTab(`pm-exec-${termCounter}`, '', { exec: id, label });
}

loaders.terminal = () => {
  if (!termSessions.size) {
    const saved = savedTermSessions();
    termCounter = saved.length;
    for (const name of saved) openTermTab(name);
    if (!termSessions.size) openTermTab('axon-term');
  } else if (activeTerm) {
    termSessions.get(activeTerm)?.fit.fit();
  }
};

// ---------- Server-side browser (Steel session viewer) ----------

// Chromium real (jlesage/chromium + noVNC) — full browser running on the
// server with a persistent profile (accounts/cookies stay logged in).
const BROWSER_PORT = 5800;
const browserUrl = `/p/${BROWSER_PORT}/?autoconnect=true&resize=scale&path=p/${BROWSER_PORT}/websockify`;
let browserLoaded = false;

function loadBrowser() {
  if (!browserLoaded) {
    $('#browser-frame').src = browserUrl;
    browserLoaded = true;
  }
}
function unloadBrowser() {
  if (browserLoaded) {
    $('#browser-frame').src = 'about:blank';
    browserLoaded = false;
  }
}

loaders.navegador = loadBrowser;

// Open a URL inside the embedded Chromium and jump to its tab. The URL is
// resolved on the SERVER, so localhost:* means the server's own services.
async function openInServerBrowser(url) {
  try {
    await api('/api/browser/open', { method: 'POST', body: { url } });
  } catch (e) {
    toast(e.message || 'El navegador del server no respondió', 'error', e.detail || '', 4000);
    return false;
  }
  document.querySelector('.tab-btn[data-tab="navegador"]')?.click();
  loadBrowser();
  return true;
}
window.openInServerBrowser = openInServerBrowser;

$('#browser-open-ext').addEventListener('click', () => window.open(browserUrl, '_blank', 'noopener'));
$('#browser-reload').addEventListener('click', () => { unloadBrowser(); loadBrowser(); });

// ---------- QR pairing ----------

$('#pair-btn').addEventListener('click', async () => {
  $('#pair-qr').innerHTML = '';
  $('#pair-url').textContent = '';
  $('#pair-modal').classList.remove('hidden');
  try {
    const res = await api('/api/pair/create', { method: 'POST' });
    const qr = qrcode(0, 'M');
    qr.addData(res.url);
    qr.make();
    $('#pair-qr').innerHTML = qr.createSvgTag(6, 8);
    $('#pair-url').textContent = res.url;
  } catch (err) {
    $('#pair-qr').innerHTML = '';
    $('#pair-url').textContent = `Error: ${err.message}`;
  }
});

$('#pair-close').addEventListener('click', () => $('#pair-modal').classList.add('hidden'));

// ---------- Remote power ----------

async function powerAction(action, word) {
  const typed = prompt(`El servidor se va a ${word === 'REINICIAR' ? 'reiniciar' : 'apagar'} y el dashboard se desconecta.\n\nEscribí ${word} para confirmar:`);
  if (typed === null) return;
  try {
    await api('/api/system/power', { method: 'POST', body: { action, confirm: typed.trim().toUpperCase() } });
    toast(`${word === 'REINICIAR' ? 'Reinicio' : 'Apagado'} programado en 3 segundos`, 'ok');
  } catch (err) { errToast(err); }
}

$('#power-reboot').addEventListener('click', () => powerAction('reboot', 'REINICIAR'));
$('#power-off').addEventListener('click', () => powerAction('poweroff', 'APAGAR'));
