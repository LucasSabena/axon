/* AXON — frontend */
'use strict';

// Marks app.js as loaded so the inline boot watchdog knows its retry button
// can call initAuth() instead of reloading the page.
window.__axonApp = true;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Lucide icons (vendored, optional) ----------

const icon = (name, cls = '') => `<i data-lucide="${esc(name)}" class="lucide-icon${cls ? ' ' + cls : ''}"></i>`;
const refreshIcons = () => {
  try { window.lucide?.createIcons(); } catch { /* icons are decorative */ }
  for (const button of document.querySelectorAll('button[title]:not([aria-label])')) if (!button.textContent.trim()) button.setAttribute('aria-label', button.title);
};
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
  const ttl = path === '/api/stats' ? 1000 : /^\/api\/agents(?:\/[^/]+)?$/.test(path) ? 10_000 : 0;
  return window.AxonUI.request(path, { cacheMs: ttl, ...opts });
}
document.addEventListener('axon:session-expired', () => {
  // Guardar la ruta actual para volver tras el login — sin esto una sesión
  // expirada en /dominios o /proyectos volvía siempre a la raíz.
  try {
    const back = location.pathname + location.search + location.hash;
    if (back && back !== '/') sessionStorage.setItem('axon:return', back);
  } catch { /* storage no disponible */ }
  $('#login-screen')?.classList.remove('hidden');
  $('#main-screen')?.classList.add('hidden');
  const status = $('#login-status');
  if (status) status.textContent = 'Tu sesión expiró — al ingresar volvés a donde estabas.';
});

function toast(msg, type = 'error', detail = '', ms = 6000) {
  const box = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role',type==='error'?'alert':'status');
  el.innerHTML = `${icon(type==='ok'?'circle-check':type==='warn'?'triangle-alert':'circle-alert')}<div class="toast-content"><div class="toast-msg">${esc(msg)}</div>${detail?'<button class="toast-detail">Ver detalle</button>':''}</div><button class="toast-close" aria-label="Cerrar aviso">${icon('x')}</button>`;
  const close=()=>{clearTimeout(timer);el.remove();};
  el.querySelector('.toast-close').onclick=close;
  el.querySelector('.toast-detail')?.addEventListener('click',()=>{void window.AxonTransfers?.showError({message:msg,detail});close();});
  box.appendChild(el);refreshIcons();
  const timer=setTimeout(close,ms);
  while(box.children.length>4)box.firstElementChild.remove();
}

function errToast(err) {
  if(err.cancelled||err.presented)return;
  if(err.raw?.code==='operation-pending'){void window.AxonTransfers.showError(err);return;}
  const parts = [err.detail, err.command ? `Comando: ${err.command}` : ''].filter(Boolean);
  toast(err.message || 'No se pudo completar la acción', 'error', parts.join('\n\n'));
}

function fmtUptime(sec) {
  if (!sec) return '-';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

// ---------- Auth ----------

// Deferred feature scripts register their hooks before the authenticated boot event.
const axonDomReady = document.readyState !== 'loading' ? Promise.resolve()
  : new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once:true }));
// Deploys restart the container: the server is unreachable for a few seconds
// and the first reload used to die on a stuck boot screen. Retry the whole
// auth+asset boot with backoff so a restart window reads as a slow load, not
// a broken page. bootRetryTimer keeps manual retries from stacking flows.
const BOOT_RETRY_LIMIT = 5;
const BOOT_RETRY_DELAY_MS = 1500;
let bootRetryTimer = null;
let bootDone = false;
function setLoginSecondFactor(enabled) {
  $('#login-code').classList.toggle('hidden', !enabled);
  $('#login-code-label').classList.toggle('hidden', !enabled);
  $('#login-code-help').classList.toggle('hidden', !enabled);
  // Nunca required: /api/me ya no revela si la cuenta usa 2FA antes de
  // autenticar, así que el campo aparece tras el primer intento fallido y
  // quienes no usan 2FA lo dejan vacío.
  $('#login-code').required = false;
}
async function initAuth(attempt = 0) {
  clearTimeout(bootRetryTimer);
  try {
    const me = await api('/api/me');
    await axonDomReady;
    setLoginSecondFactor(Boolean(me.totpEnabled));
    if (me.authenticated) {
      await AxonAssets.features();
      if (bootDone) return;
      bootDone = true;
      scanIntervalMs = me.scanIntervalMs || 5000;
      $('#boot-screen').classList.add('hidden');
      $('#login-screen').classList.add('hidden');
      $('#main-screen').classList.remove('hidden');
      bootMain();
      return;
    }
  } catch (err) {
    await axonDomReady;
    if (err.status !== 401) {
      if (attempt < BOOT_RETRY_LIMIT) {
        $('#boot-message').textContent = 'El servidor no responde — reintentando…';
        bootRetryTimer = setTimeout(() => void initAuth(attempt + 1), BOOT_RETRY_DELAY_MS * (attempt + 1));
        return;
      }
      $('#boot-message').textContent = err.message + '. Tus datos se conservan. Podés reintentar.';
      $('#boot-retry').classList.remove('hidden');
      return;
    }
  }
  await axonDomReady;
  // Fresh installs get the guided setup before the login form — the
  // installer prints a one-time ?setup=… link that authorizes creating the
  // admin account in the browser. Returns true while the wizard is up.
  if (await window.AxonOnboarding?.start?.()) return;
  $('#boot-screen').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
}

$('#boot-retry').addEventListener('click', () => { $('#boot-retry').classList.add('hidden'); $('#boot-message').textContent='Preparando tu espacio…'; void initAuth(); });

$('#password-toggle').addEventListener('click', () => {
  const visible = $('#password').type === 'password';
  $('#password').type = visible ? 'text' : 'password';
  $('#password-toggle').setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
  $('#password-toggle').setAttribute('aria-pressed', String(visible));
  $('#password-toggle').innerHTML = icon(visible ? 'eye-off' : 'eye');
  refreshIcons();
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = $('#login-form'), submit = $('#login-submit');
  if (submit.disabled) return;
  $('#login-error').textContent = '';
  submit.disabled = true;
  form.setAttribute('aria-busy', 'true');
  $('#login-submit-label').textContent = 'Ingresando…';
  $('#login-status').textContent = 'Verificando tu acceso…';
  try {
    await api('/api/login', {
      method: 'POST',
      body: { username: $('#username').value, password: $('#password').value, code: $('#login-code').value.trim() },
    });
    $('#login-submit-label').textContent = 'Abriendo tu espacio…';
    $('#login-status').textContent = 'Acceso verificado. Abriendo tu espacio.';
    // Volver a la sección donde expiró la sesión (guardada en axon:return).
    let back = '';
    try { back = sessionStorage.getItem('axon:return') || ''; sessionStorage.removeItem('axon:return'); } catch { /* noop */ }
    if (back && back !== location.pathname + location.search) location.assign(back);
    else location.reload();
  } catch (err) {
    $('#login-error').textContent = err.message;
    submit.disabled = false;
    form.setAttribute('aria-busy', 'false');
    $('#login-submit-label').textContent = 'Ingresar';
    $('#login-status').textContent = '';
    // Mostrar el campo de código tras cualquier intento fallido: quienes
    // tienen 2FA reintentan con su código; el resto lo deja vacío.
    setLoginSecondFactor(true); $('#login-code').focus();
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
function activateAxonSection(tab, load = true) {
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-content').forEach((t) => t.classList.toggle('active', t.id === `tab-${tab}`));
  if (activeTabName === 'navegador' && tab !== 'navegador') unloadBrowser();
  activeTabName = tab;
  if (load) loaders[tab]?.();
  document.dispatchEvent(new CustomEvent('axon:section', { detail: tab }));
}
window.activateAxonSection = activateAxonSection;
$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    activateAxonSection(btn.dataset.tab);
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
  // ss/devuelve [::1] con corchetes para IPv6 — sin normalizar, un listener
  // solo-loopback parecía accesible desde la red.
  const a = String(addr || '').replace(/^\[|\]$/g, '');
  return !a || a === '::1' || a === 'localhost' || a.startsWith('127.');
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
  const proxy = `<a class="link-proxy" href="/p/${port}/" target="_blank" rel="noopener noreferrer" title="Abrir :${port} a través del proxy (funciona incluso si el proceso solo escucha en 127.0.0.1)">${icon('route')} :${port}</a>`;

  // Remote client (laptop via Tailscale/domain): localhost links don't reach the
  // server — route everything through the built-in proxy, or direct host:port
  // when we browsed by raw IP and the service binds a public interface.
  if (!isLocalClient()) {
    const hostIsIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname);
    const direct = hostIsIp && remoteReachable(port, listeners)
      ? `<a class="link-network" href="http://${location.hostname}:${port}" target="_blank" rel="noopener noreferrer" title="Directo al servidor">${esc(location.hostname)}:${port}</a>`
      : '';
    return `<span class="port-links">${dot}${direct}${proxy}</span>`;
  }

  const local = `${dot}<a class="link-local" href="http://localhost:${port}" target="_blank" rel="noopener noreferrer" title="Abrir localhost:${port}">localhost:${port}</a>`;
  let remote = '';
  if (net) {
    remote = remoteReachable(port, listeners)
      ? `<a class="link-network" href="http://${net}:${port}" target="_blank" rel="noopener noreferrer" title="Abrir ${esc(net)}:${port}">${esc(net)}:${port}</a>`
      : `<span class="link-network link-dead" title="${esc(net)}:${port} no es accesible: este proceso solo escucha en loopback (usá --host o un dominio)">${esc(net)}:${port}</span>`;
  }
  return `<span class="port-links">${local}${remote}</span>`;
}

function domainLinksHtml(domains) {
  return (domains || []).map(d => `<a class="domain-link" href="https://${esc(d.fullDomain)}" target="_blank" rel="noopener noreferrer">${icon('globe')} ${esc(d.subdomain)}</a>`).join(' ');
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
  const domainLink = domainLinksHtml(p.domains || (p.domain ? [p.domain] : []));
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
  const domains = [...new Map(procs.flatMap(p => p.domains || (p.domain ? [p.domain] : [])).map(d => [d.id, d])).values()];
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
    <td>${allPorts.map((pt) => portLinksHtml(pt, allListeners)).join(' ')} ${domainLinksHtml(domains)}</td>
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
    if (!(await confirmDialog('Detener proyecto', `Se cerrarán ${pids.length} proceso(s) del proyecto.\nPIDs: ${pids.join(', ')}`, 'Detener'))) return;
    btn.disabled = true;
    try {
      let okCount = 0;
      let failCount = 0;
      for (const pid of pids) {
        try { await api(`/api/ports/${pid}/kill`, { method: 'POST' }); okCount++; }
        catch { failCount++; }
      }
      toast(`Proyecto: ${okCount} proceso(s) cerrado(s)${failCount ? `, ${failCount} fallaron` : ''}`, failCount ? 'warn' : 'ok');
      loadPorts();
    } finally { if (btn.isConnected) btn.disabled = false; }
  }
});

// ---------- Kill modal ----------

let killPid = null;
let killTicket = 0;

async function openKillModal(pid) {
  const ticket = ++killTicket;
  killPid = pid;
  $('#kill-error').textContent = '';
  $('#kill-plan-body').innerHTML = 'Cargando…';
  $('#kill-modal').classList.remove('hidden');
  $('#kill-confirm').disabled = true;
  try {
    const { plan } = await api(`/api/ports/${pid}/plan`);
    if (ticket !== killTicket) return;
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
    if (ticket !== killTicket) return;
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
  if (!(await confirmDialog('Detener servicio', `Se detiene ${unit}. También se puede deshabilitar para que no arranque solo.`, 'Detener'))) return;
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
let detailTicket = 0;

async function openDetailModal(pid) {
  const ticket = ++detailTicket;
  detailPid = pid;
  $('#detail-modal').classList.remove('hidden');
  $('#detail-title').textContent = '…';
  try {
    const { detail } = await api(`/api/ports/${pid}/detail`);
    if (ticket !== detailTicket) return;
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
    detailEnvCache = detail.env || {};
    renderEnv(detailEnvCache);
  } catch (err) {
    if (ticket !== detailTicket) return;
    errToast(err);
    $('#detail-modal').classList.add('hidden');
  }
}

// El env del modal de detalle se cachea al abrir — filtrar por tecla ya no
// dispara un /detail completo (hostExec por keystroke) sino render local.
let detailEnvCache = {};

function renderEnv(env) {
  const tbody = $('#detail-env-table tbody');
  const filter = ($('#detail-env-filter').value || '').toLowerCase();
  tbody.innerHTML = Object.entries(env)
    .filter(([k, v]) => `${k}=${v}`.toLowerCase().includes(filter))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="env-value">${esc(v)}</td></tr>`)
    .join('');
}

$('#detail-env-filter').addEventListener('input', () => renderEnv(detailEnvCache));

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
let jobPollTimer=null;
let currentJobId=null;
let programsData=[];
async function loadPrograms(fresh=false){
 const snapshot=await window.AxonSoftware.load(fresh);
 programsData=(snapshot?.installations||[]).map(p=>({...p,installed:true,latestVersion:p.canUpdate?p.targetVersion:undefined}));
 loadJobsHistory();
}
async function loadInstalled(){await loadPrograms();window.AxonSoftware.installed();}

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
  if (currentJobId !== job.id) {
    const pre = $('#job-log'), selection = window.getSelection();
    if (selection && pre.contains(selection.anchorNode)) selection.removeAllRanges();
    pre.dataset.logText = ''; pre.scrollTop = 0;
  }
  currentJobId = job.id;
  $('#job-modal').classList.remove('hidden');
  renderJob(job);
  if (jobPollTimer) { clearInterval(jobPollTimer); jobPollTimer = null; }
  if (job.status === 'running') {
    jobPollTimer = setInterval(pollJob, 1000);
  }
}

let jobPollFlight = false;
async function pollJob() {
  if (!currentJobId || jobPollFlight) return;
  jobPollFlight = true;
  const id = currentJobId;
  try {
    const { job } = await api(`/api/jobs/${id}`);
    if (currentJobId !== id) return;
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
      loadPrograms().catch(() => {});
      loadJobsHistory().catch(() => {});
      document.dispatchEvent(new CustomEvent('axon:job-complete', { detail: job }));
    }
  } catch (error) {
    if (currentJobId !== id) return;
    if (error.status === 404 || error.status === 401) {
      clearInterval(jobPollTimer); jobPollTimer = null;
    }
    $('#job-status').textContent = error.status === 404 ? 'Trabajo no disponible' : 'Sin conexión · reintentando';
    $('#job-status').className = 'logs-status logs-status-disconnected';
  } finally { jobPollFlight = false; }
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
  const text = AxonTerminalTools.clean(job.log);
  AxonTerminalTools.renderLog(pre, text);
  const links = [...new Set(AxonTerminalTools.urls(text).map(link => link.url))].slice(-8);
  const box = $('#job-login-links'), signature = JSON.stringify(links);
  if (box.dataset.signature !== signature) {
    box.dataset.signature = signature;
    box.replaceChildren();
    for (const url of links) {
      const row = document.createElement('div'); row.className = 'job-login-link';
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = url;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-secondary'; button.textContent = 'Copiar link'; button.onclick = () => AxonTerminalTools.copy(url);
      row.append(a, button); box.append(row);
    }
  }
}

$('#job-copy').addEventListener('click', () => AxonTerminalTools.copy($('#job-log').dataset.logText || $('#job-log').textContent));
$('#job-select').addEventListener('click', () => { const range = document.createRange(); range.selectNodeContents($('#job-log')); const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); });
$('#job-bottom').addEventListener('click', () => { const pre = $('#job-log'); pre.scrollTop = pre.scrollHeight; });

$('#job-close').addEventListener('click', () => {
  $('#job-modal').classList.add('hidden');
  currentJobId = null;
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
      <td><a class="project-hub-link" href="/proyectos?id=${encodeURIComponent(p.id)}"><strong>${esc(p.name)}</strong></a>${p.framework ? ` <span class="badge badge-python">${esc(p.framework)}</span>` : ''}</td>
      <td><span class="badge ${TYPE_BADGE[p.type] || 'badge-other'}">${esc(p.type)}</span></td>
      <td><span class="badge ${running ? 'badge-status-running' : 'badge-status-stopped'}">${running ? `corriendo · pid ${p.running.pid}` : 'detenido'}</span></td>
      <td>${ports} ${domainLinksHtml(p.domains)}</td>
      <td class="cmd-cell" title="${esc(p.cwd)}">${esc(p.cwd)}</td>
      <td><div class="actions">
        ${running
          ? `<button class="btn-danger pj-stop" data-id="${esc(p.id)}">${icon('square')} Parar</button>`
          : `<button class="btn-action pj-start" data-id="${esc(p.id)}">${icon('play')} Iniciar</button>`}
        ${!running && (p.type === 'node' || p.type === 'bun' || p.type === 'python') ? `<button class="btn-action pj-install" data-id="${esc(p.id)}">${icon('package-plus')} Deps</button>` : ''}
        <button class="btn-secondary pj-logs" data-id="${esc(p.id)}">${icon('file-text')} Logs</button>
        <button class="btn-secondary pj-edit" data-id="${esc(p.id)}" title="Editar">${icon('pencil')}</button>
      </div></td>`;
    tbody.appendChild(tr);
  }
  tbody.dataset.projects = JSON.stringify(projects.map((p) => ({ id: p.id, name: p.name, cwd: p.cwd, command: p.command, port: p.port, type: p.type, framework: p.framework, packageManager: p.packageManager })));
  refreshIcons();
}

$('#projects-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  const eid = encodeURIComponent(id);
  const list = JSON.parse($('#projects-table tbody').dataset.projects || '[]');
  const project = list.find((p) => p.id === id);

  if (btn.classList.contains('pj-start')) {
    try {
      const res = await api(`/api/projects/${eid}/start`, { method: 'POST',busy:btn });
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
    if(!await confirmDialog('Detener proyecto',`Se detiene ${project?.name || 'el proyecto'} y deja de atender solicitudes.`,'Detener'))return;
    try {
      await api(`/api/projects/${eid}/stop`, { method: 'POST',busy:btn });
      toast('Proyecto detenido', 'ok');
      loadProjects();
    } catch (err) { errToast(err); }
  } else if (btn.classList.contains('pj-install')) {
    try {
      const { job } = await api(`/api/projects/${eid}/install`, { method: 'POST' });
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

// Project logs modal (polling tail). The same #logs-pre is shared with docker
// logs — logsReload remembers which fetch to repeat and logsTicket discards
// responses that resolve after the modal switched source.
let logsProjectId = null;
let logsReload = null;
let logsTicket = 0;
let logsSocket = null;
function closeLogsSocket() {
  const s = logsSocket;
  logsSocket = null;
  try { s?.close(); } catch { /* cerrado */ }
}
// Docker logs llegan con escapes ANSI de las apps — el <pre> del modal no los
// interpreta, así que los limpiamos acá (no vale la pena cargar xterm).
const stripAnsi = (s) => s
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  .replace(/\x1b[()#%*+-./][0-9A-Za-z]/g, '')
  .replace(/\x1b[=>NO\\\^_]|[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

function connectDockerLogs(name) {
  closeLogsSocket();
  const ticket = ++logsTicket;
  const pre = $('#logs-pre');
  pre.textContent = '';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/logs?src=${encodeURIComponent(`docker:${name}`)}`);
  logsSocket = ws;
  ws.binaryType = 'arraybuffer';
  const decoder = new TextDecoder();
  ws.onmessage = (e) => {
    if (logsSocket !== ws || ticket !== logsTicket) return;
    const raw = typeof e.data === 'string' ? e.data : decoder.decode(e.data, { stream: true });
    const text = stripAnsi(raw).replace(/\r\n|\r/g, '\n');
    if (!text) return;
    const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 60;
    pre.textContent += text;
    if (pre.textContent.length > 200_000) pre.textContent = pre.textContent.slice(-120_000);
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  };
  ws.onclose = () => {
    if (logsSocket !== ws || ticket !== logsTicket) return;
    if (!pre.textContent.trim()) pre.textContent = '(sin logs)';
    pre.textContent += '\n[stream desconectado — Recargar para reintentar]';
  };
  ws.onerror = () => { /* onclose le sigue */ };
}

$('#logs-close').addEventListener('click', () => { $('#logs-modal').classList.add('hidden'); logsProjectId = null; logsReload = null; logsTicket++; closeLogsSocket(); });
$('#logs-reload').addEventListener('click', () => { logsReload?.(); });

function openProjectLogs(project) {
  closeLogsSocket();
  logsProjectId = project.id;
  logsReload = () => fetchProjectLogs(project.id);
  $('#logs-modal-title').textContent = `Logs — ${project.name}`;
  $('#logs-modal').classList.remove('hidden');
  fetchProjectLogs(project.id);
}

async function fetchProjectLogs(id) {
  const ticket = ++logsTicket;
  try {
    const { lines } = await api(`/api/projects/${encodeURIComponent(id)}/logs?tail=300`);
    if (ticket !== logsTicket) return;
    const pre = $('#logs-pre');
    pre.textContent = lines.join('\n') || '(sin logs)';
    pre.scrollTop = pre.scrollHeight;
  } catch (err) { if (ticket === logsTicket) errToast(err); }
}

// Project edit modal
function openProjectEdit(project) {
  $('#project-edit-title').textContent = project ? 'Editar proyecto' : 'Agregar proyecto';
  $('#project-edit-id').value = project?.id || '';
  $('#project-edit-name').value = project?.name || '';
  $('#project-edit-command').value = project?.command || '';
  $('#project-edit-cwd').value = project?.cwd || '';
  $('#project-edit-port').value = project?.port || '';
  // Detected metadata isn't editable but must survive the save round-trip —
  // re-submitting 'other' would strip the framework badge and the Deps button.
  const form = $('#project-edit-form');
  form.dataset.type = project?.type || '';
  form.dataset.framework = project?.framework || '';
  form.dataset.packageManager = project?.packageManager || '';
  $('#project-edit-delete').classList.toggle('hidden', !project);
  $('#project-edit-error').textContent = '';
  $('#project-edit-modal').classList.remove('hidden');
}

$('#project-edit-cancel').addEventListener('click', () => $('#project-edit-modal').classList.add('hidden'));
$('#project-edit-delete').addEventListener('click', async () => {
  const id = $('#project-edit-id').value;
  if (!id || !(await confirmDialog('Eliminar proyecto del panel', 'Los archivos del proyecto se conservan.'))) return;
  try {
    await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE',busy:$('#project-edit-delete') });
    $('#project-edit-modal').classList.add('hidden');
    loadProjects();
  } catch (err) { errToast(err); }
});

$('#project-edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#project-edit-id').value.trim();
  const form = $('#project-edit-form');
  // Mismo formato que el server (^[a-z0-9-]{1,64}$), con la misma exención:
  // un id legado ya existente se puede editar, uno nuevo inválido se rechaza.
  const known = JSON.parse($('#projects-table tbody').dataset.projects || '[]').some((p) => p.id === id);
  if (id && !known && !/^[a-z0-9-]{1,64}$/.test(id)) {
    $('#project-edit-error').textContent = 'ID de proyecto inválido (solo minúsculas, números y guiones, máx. 64).';
    return;
  }
  const body = {
    id: id || undefined,
    name: $('#project-edit-name').value,
    cwd: $('#project-edit-cwd').value,
    command: $('#project-edit-command').value || undefined,
    port: parseInt($('#project-edit-port').value, 10) || undefined,
    type: form.dataset.type || 'other',
    framework: form.dataset.framework || undefined,
    packageManager: form.dataset.packageManager || undefined,
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

// Puertos web típicos para elegir cuál publicar como dominio (ver dk-domain).
const DOCKER_WEB_PORTS = [80, 443, 3000, 4200, 5000, 5173, 8000, 8080, 8081, 8443, 9000];

async function loadDocker() {
  try {
    const { containers, daemonError } = await api('/api/docker');
    const daemonBox = $('#docker-daemon-error');
    if (daemonBox) {
      // Sin esto, un daemon caído se ve idéntico a "sin contenedores".
      daemonBox.classList.toggle('hidden', !daemonError);
      daemonBox.textContent = daemonError ? `Docker no responde: ${daemonError}` : '';
    }
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
      const domainLink = ct.domain ? `<a class="domain-link" href="https://${esc(ct.domain.fullDomain)}" target="_blank" rel="noopener noreferrer">${icon('globe')} ${esc(ct.domain.subdomain)}</a>` : '';
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
          <button class="btn-secondary dk-logs" data-id="${ct.id}" data-name="${esc(ct.names)}">${icon('file-text')} Logs</button>
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
    if (!(await confirmDialog('Detener contenedor', 'Sus servicios van a dejar de responder hasta que vuelvas a iniciarlo.', 'Detener'))) return;
    try {
      await api(`/api/docker/${id}/stop`, { method: 'POST',busy:btn });
      toast('Contenedor detenido', 'ok');
      loadDocker();
    } catch (err) { errToast(err); }
  } else if (btn.classList.contains('dk-start') || btn.classList.contains('dk-restart')) {
    const restart = btn.classList.contains('dk-restart');
    if (restart && !(await confirmDialog('Reiniciar contenedor', `Se reinicia ${id}.`, 'Reiniciar'))) return;
    try {
      await api(`/api/docker/${id}/${restart ? 'restart' : 'start'}`, { method: 'POST',busy:btn });
      toast(restart ? 'Contenedor reiniciado' : 'Contenedor iniciado', 'ok');
      loadDocker();
    } catch (err) { errToast(err); loadDocker(); }
  } else if (btn.classList.contains('dk-term')) {
    openTermExec(id, btn.dataset.name || id);
  } else if (btn.classList.contains('dk-logs')) {
    // Logs en vivo por /ws/logs (docker logs -f) — antes el modal era una
    // foto estática que había que recargar a mano.
    const name = (btn.dataset.name || id).split(',')[0] || id;
    $('#logs-modal-title').textContent = `Logs — ${name}`;
    $('#logs-modal').classList.remove('hidden');
    logsProjectId = null;
    logsReload = () => connectDockerLogs(name);
    connectDockerLogs(name);
  } else if (btn.classList.contains('dk-domain')) {
    const ports = (btn.dataset.ports || '').split(',').map((n) => parseInt(n, 10)).filter(Boolean);
    // Preferir el puerto web típico en vez del primero declarado (que puede
    // ser un puerto interno como 5432 o un agente).
    const port = ports.find((p) => DOCKER_WEB_PORTS.includes(p)) || ports[0];
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
        <td class="sel-col"><input type="checkbox" class="dm-sel" aria-label="Seleccionar ${esc(d.fullDomain)}" data-id="${d.id}"${domainSel.has(d.id) ? ' checked' : ''}></td>
        <td><a class="domain-link" href="https://${esc(d.fullDomain)}" target="_blank" rel="noopener noreferrer">${icon('globe')} ${esc(d.fullDomain)}</a></td>
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
    // Re-render completo: podar la selección de dominios que ya no existen y
    // refrescar la barra de acción masiva (antes quedaba desincronizada).
    const alive = new Set(domains.map((d) => d.id));
    for (const id of [...domainSel]) if (!alive.has(id)) domainSel.delete(id);
    updateDomainBulkbar();
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

let pendingConfirm = null;
async function confirmDialog(title, body, okLabel = 'Eliminar') {
  if (pendingConfirm) await pendingConfirm(false);
  await customElements.whenDefined('wa-dialog');
  const dialog = $('#confirm-modal');
  await dialog.updateComplete;
  const trigger = document.activeElement;
  let settled = false, closeFlight;
  return new Promise((resolve) => {
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    $('#confirm-ok').textContent = okLabel;
    dialog.label = title;
    const done = value => {
      if (settled) return closeFlight;
      settled = true;
      closeFlight = new Promise(finished => {
        const finish = () => {
          dialog.classList.add('hidden');
          dialog.removeEventListener('wa-hide', cancel);
          $('#confirm-ok').onclick = $('#confirm-cancel').onclick = null;
          if (pendingConfirm === done) pendingConfirm = null;
          if (trigger?.isConnected) trigger.focus({preventScroll:true});
          resolve(value); finished();
        };
        if (dialog.dialog?.open) {
          dialog.addEventListener('wa-after-hide', finish, {once:true});
          dialog.open = false;
        } else finish();
      });
      return closeFlight;
    };
    const cancel = () => done(false);
    pendingConfirm = done;
    dialog.addEventListener('wa-hide', cancel);
    $('#confirm-ok').onclick = () => done(true);
    $('#confirm-cancel').onclick = () => done(false);
    dialog.classList.remove('hidden');
    dialog.open = true;
    dialog.addEventListener('wa-after-show', () => $('#confirm-cancel').focus(), {once:true});
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
    const res = await api('/api/domains/bulk-delete', { method: 'POST', body: { ids },busy:$('#domains-del-sel') });
    removeDomainRows(ids.filter((id) => !(res.failedIds || []).includes(id)));
    toast(`${res.removed} eliminado${res.removed === 1 ? '' : 's'}${res.failed ? `, ${res.failed} fallaron` : ''}`, res.failed ? 'warn' : 'ok');
    if (!res.syncOk) toast('El sync del túnel falló — revisá cloudflared', 'error');
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
    const fqdn = btn.closest('tr')?.querySelector('.domain-link')?.textContent.trim() || id;
    const ok = await confirmDialog('Eliminar dominio', `Se borra ${fqdn}: el DNS de Cloudflare y la ruta del túnel.`);
    if (!ok) return;
    try {
      await api(`/api/domains/${id}`, { method: 'DELETE',busy:btn });
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
    await Promise.all([loadDomains(), loadPorts(), loadProjects()]);
  } catch (err) {
    $('#domain-error').textContent = err.message + (err.detail ? ` — ${err.detail}` : '');
  }
});

// ---------- Settings ----------

async function loadSettings() {
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
    $('#settings-notify-provider').value = s.notifyProvider || 'auto';
    $('#settings-host-user').value = s.hostUser || '';
    localStorage.setItem('axon:scan-interval', String(s.scanIntervalMs));
    updateTotpStatus(!!config.auth?.totpEnabled);
    $('#settings-error').textContent = '';
    $('#settings-modal').classList.remove('hidden');
    window.AxonSettings?.loaded();
  } catch (err) { errToast(err); }
}
$('#settings-btn').addEventListener('click', () => window.AxonNavigation?.ready
  ? window.AxonNavigation.go('/configuracion') : loadSettings());
window.AxonPages ||= {};
window.AxonPages.settings = { restore: loadSettings };

$('#settings-cancel').addEventListener('click', () => {
  if (window.AxonNavigation?.ready) {
    if (window.AxonNavigation.current.index > 0) history.back(); else window.AxonNavigation.go('/');
  } else $('#settings-modal').classList.add('hidden');
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const numList = (v) => v.split(/[,\n]/).map(x=>x.trim()).filter(Boolean).map(x=>{if(!/^\d+$/.test(x))throw new Error('Los puertos y PID deben ser números enteros, separados por comas.');return Number(x);});
  const strList = (v) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  try {
    const knownServices = {};
    for (const line of $('#settings-known-services').value.split('\n').map(x=>x.trim()).filter(Boolean)) {
      const m = line.match(/^(\d+):([^:]+):?(.*)$/);
      if(!m)throw new Error('Cada servicio conocido debe usar el formato puerto:nombre:icono.');
      knownServices[m[1]] = { name: m[2].trim(), icon: m[3].trim() || 'wrench' };
    }
    await api('/api/config', {
      method: 'PUT',
      body: {
        scanIntervalMs: Number($('#settings-scan-interval').value),
        protectedPids: numList($('#settings-protected-pids').value),
        protectedPorts: numList($('#settings-protected-ports').value),
        ignoredPatterns: strList($('#settings-ignored-patterns').value),
        scanDirs: strList($('#settings-scan-dirs').value),
        notifyUrl: $('#settings-notify-url').value.trim(),
        notifyProvider: $('#settings-notify-provider').value,
        hostUser: $('#settings-host-user').value.trim(),
        knownServices,
      },
    });
    if (!window.AxonNavigation?.ready) $('#settings-modal').classList.add('hidden');
    localStorage.setItem('axon:scan-interval', $('#settings-scan-interval').value);
    scanIntervalMs = Number($('#settings-scan-interval').value); scheduleSectionPoll();
    window.AxonSettings?.loaded();
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
let totpTicket = 0;

function openTotpModal(mode) {
  totpMode = mode;
  const enabling = mode === 'enable';
  $('#totp-title').textContent = enabling ? 'Activar verificación en dos pasos' : 'Desactivar verificación en dos pasos';
  $('#totp-desc').textContent = enabling
    ? 'Escaneá el QR con tu app autenticadora (Google Authenticator, Aegis, 1Password…) e ingresá el código de 6 dígitos y tu contraseña actual para confirmar.'
    : 'Ingresá tu contraseña actual (o el código de tu app autenticadora) para desactivar el 2FA.';
  $('#totp-qr').innerHTML = '';
  $('#totp-secret').textContent = '';
  $('#totp-qr').classList.toggle('hidden', !enabling);
  $('#totp-secret-wrap').classList.toggle('hidden', !enabling);
  $('#totp-code').value = '';
  $('#totp-password').value = '';
  $('#totp-error').textContent = '';
  $('#totp-recovery').classList.add('hidden');
  $('#totp-recovery-codes').innerHTML = '';
  $('#totp-code').classList.remove('hidden');
  $('#totp-password').classList.remove('hidden');
  $('#totp-confirm').classList.remove('hidden');
  $('#totp-cancel').textContent = 'Cancelar';
  $('#totp-modal').classList.remove('hidden');
  // Invalidate any in-flight setup request on every open — a stale rejection
  // must not write its error into a modal reopened in the other mode.
  const ticket = ++totpTicket;
  if (enabling) {
    api('/api/auth/totp/setup', { method: 'POST' })
      .then((res) => {
        // A slow response from a previous open must not overwrite the newest
        // pending secret — the backend only keeps the latest one.
        if (ticket !== totpTicket) return;
        const qr = qrcode(0, 'M');
        qr.addData(res.uri);
        qr.make();
        $('#totp-qr').innerHTML = qr.createSvgTag(6, 8);
        $('#totp-secret').textContent = res.secret;
      })
      .catch((err) => { if (ticket === totpTicket) $('#totp-error').textContent = err.message; });
  }
  setTimeout(() => $('#totp-code').focus(), 50);
}

$('#totp-enable-btn').addEventListener('click', () => openTotpModal('enable'));
$('#totp-disable-btn').addEventListener('click', () => openTotpModal('disable'));
$('#totp-cancel').addEventListener('click', () => { totpTicket++; $('#totp-modal').classList.add('hidden'); });
$('#totp-confirm').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  $('#totp-error').textContent = '';
  try {
    const res = await api(`/api/auth/totp/${totpMode}`, { method: 'POST', body: { code: $('#totp-code').value.trim(), password: $('#totp-password').value } });
    if (totpMode === 'enable' && Array.isArray(res.recovery) && res.recovery.length) {
      // Mostrar una sola vez — quedan hasheados en el servidor.
      $('#totp-recovery-codes').innerHTML = res.recovery.map(c => `<code>${esc(c)}</code>`).join('');
      $('#totp-recovery').classList.remove('hidden');
      $('#totp-qr').classList.add('hidden');
      $('#totp-secret-wrap').classList.add('hidden');
      $('#totp-code').classList.add('hidden');
      $('#totp-password').classList.add('hidden');
      $('#totp-confirm').classList.add('hidden');
      $('#totp-cancel').textContent = 'Cerrar';
      $('#totp-desc').textContent = '2FA activado.';
      updateTotpStatus(true);
      toast('2FA activado — guardá los códigos de recuperación', 'ok');
      return;
    }
    $('#totp-modal').classList.add('hidden');
    updateTotpStatus(totpMode === 'enable');
    toast(totpMode === 'enable' ? '2FA activado — el próximo login pide el código' : '2FA desactivado', 'ok');
  } catch (err) {
    $('#totp-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
$('#totp-recovery-copy').addEventListener('click', async () => {
  const codes = [...$('#totp-recovery-codes').querySelectorAll('code')].map(c => c.textContent).join('\n');
  try { await navigator.clipboard.writeText(codes); toast('Códigos copiados', 'ok'); }
  catch { $('#totp-error').textContent = 'No se pudo copiar — guardalos a mano.'; }
});
$('#totp-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#totp-password').focus(); }
});
$('#totp-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#totp-confirm').click(); }
});

// ---------- Password change (local account — no recovery flow) ----------
// The trigger button lives in the lazy-loaded settings pane — see
// settings.js. Modal markup is static in index.html.

$('#password-cancel').addEventListener('click', () => $('#password-modal').classList.add('hidden'));
$('#password-save').addEventListener('click', async () => {
  const err = $('#password-error');
  err.textContent = '';
  const current = $('#password-current').value;
  const password = $('#password-new').value;
  if (password.length < 8) { err.textContent = 'La contraseña nueva necesita al menos 8 caracteres.'; return; }
  if (password !== $('#password-confirm').value) { err.textContent = 'Las contraseñas nuevas no coinciden.'; return; }
  try {
    await api('/api/auth/password', { method: 'POST', body: { current, password } });
    $('#password-modal').classList.add('hidden');
    toast('Contraseña actualizada — se cerraron las demás sesiones', 'ok');
  } catch (e) {
    err.textContent = e.message;
  }
});
['password-current', 'password-new', 'password-confirm'].forEach((id) => {
  $('#' + id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#password-save').click(); }
  });
});

// Empty-state CTAs mirror the section header buttons (data-empty-target=id)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-empty-target]');
  if (btn) document.getElementById(btn.dataset.emptyTarget)?.click();
});

// ---------- Boot ----------

let portsTimer = null;
let scanIntervalMs = 5000;

function bootMain() {
  document.dispatchEvent(new Event('axon:authenticated'));
  loadStats(); // primer fetch: también puebla serverHosts para los links de red
  // Stats del topbar: si #server-stats está oculto (móvil/legacy shell), no
  // seguir polleando — el DOM no muestra nada igualmente.
  setInterval(() => {
    if (!document.hidden && !$('#main-screen').classList.contains('hidden') && $('#server-stats')?.offsetParent) loadStats();
  }, 5000);
  scheduleSectionPoll();
}
function scheduleSectionPoll() {
  clearTimeout(portsTimer);
  portsTimer = setTimeout(async () => {
    // No re-renderizar mientras hay un modal abierto (incluye el wa-dialog de
    // confirmación — antes una fila borrada "resucitaba" por el poll), ni
    // mientras el usuario edita un input/selecciona texto en la sección.
    const ae = document.activeElement;
    const editing = !!(ae?.closest?.('#main-screen input, #main-screen textarea, #main-screen select, #main-screen [contenteditable]'));
    const sel = window.getSelection();
    const selecting = !!(sel && !sel.isCollapsed && sel.anchorNode && $('#main-screen')?.contains(sel.anchorNode));
    const modalOpen = !!document.querySelector('.modal:not(.hidden), wa-dialog[open]') || !!pendingConfirm;
    if (!document.hidden && !$('#main-screen').classList.contains('hidden') && !modalOpen && !editing && !selecting && ['ports','projects','docker','domains'].includes(activeTabName)) {
      await loaders[activeTabName]?.();
    }
    scheduleSectionPoll();
  }, Math.max(1000, Math.min(60_000, scanIntervalMs)));

}

// ---------- Theme + sidebar ----------

function setTheme(t) {
  // Desde ⌘K "Tema: X" el usuario espera VER el tema — en modo Sistema,
  // select() sólo precargaría la variante sin cambiar nada visible.
  const th = window.AxonThemes?.byId?.get?.(t);
  if (th) window.AxonThemes.setMode(th.mode);
  window.AxonThemes?.select(t);
}
document.addEventListener('axon:theme', () => {
  drawSpark('spark-cpu', sparkHist.cpu); drawSpark('spark-ram', sparkHist.ram);
  const style = getComputedStyle(document.documentElement);
  for (const tab of termSessions.values()) if(tab.term) {
    tab.term.options.theme = { background:style.getPropertyValue('--terminal-bg').trim(), foreground:style.getPropertyValue('--terminal-fg').trim(), cursor:style.getPropertyValue('--accent').trim() };
    tab.term.options.fontFamily = style.getPropertyValue('--font-mono').trim();
  }
});
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

const CMDK_SECTION_ICON = {
  dashboard:'house', ports:'plug', projects:'folder-git-2', docker:'container', domains:'globe',
  files:'folder-open', library:'images', terminal:'terminal', navegador:'globe', programs:'package',
  store:'store', drop:'upload-cloud', metrics:'chart-line', logs:'scroll-text', ops:'heart-pulse',
  scripts:'code', storage:'hard-drive', compose:'layers', agents:'bot', settings:'settings',
  backups:'archive', audit:'history', access:'plug', desktop:'monitor',
};

function cmdkCommands() {
  const net = netHost();
  const cmds = [];
  // Secciones reales desde el modelo de navegación (antes era una lista
  // hardcodeada con ~8 de las 24 secciones).
  const sections = window.AxonNavigation?.sections
    || Object.fromEntries($$('.tab-btn').map((b) => [b.dataset.tab, ['', b.textContent.trim()]]));
  for (const [key, [, label]] of Object.entries(sections)) {
    cmds.push({ icon: CMDK_SECTION_ICON[key] || 'box', label: `Ir a ${label || key}`, hint: 'sección', run: () => gotoTab(key) });
  }
  cmds.push(
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
  );
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
  for (const pr of programsData.filter((x) => x.canUpdate)) {
    cmds.push({ icon: 'arrow-up-circle', label: `Actualizar ${pr.name}`, hint: 'programa', run: async () => {
      try {
        gotoTab('programs');
        await window.AxonSoftware.review([pr.id]);
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
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => {});
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
    );
    // localhost solo tiene sentido si el cliente está en el propio servidor;
    // para un cliente remoto (Tailscale/dominio) ese link no resuelve nada.
    if (isLocalClient()) items.push({ icon: 'house', label: `Abrir localhost:${port}`, run: () => window.open(`http://localhost:${port}`, '_blank', 'noopener') });
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
let serviceTicket = 0;

async function openServiceModal(pid, suggested) {
  const ticket = ++serviceTicket;
  servicePid = pid;
  $('#service-name').value = suggested || '';
  $('#service-preview').textContent = 'Cargando…';
  $('#service-error').textContent = '';
  $('#service-modal').classList.remove('hidden');
  try {
    const res = await api('/api/systemd/preview-service', { method: 'POST', body: { pid, name: $('#service-name').value } });
    if (ticket !== serviceTicket) return;
    $('#service-preview').textContent = res.unit;
  } catch (err) {
    if (ticket !== serviceTicket) return;
    $('#service-preview').textContent = '';
    $('#service-error').textContent = err.message;
  }
}

$('#service-name').addEventListener('input', async () => {
  const ticket = ++serviceTicket;
  if (!servicePid) return;
  try {
    const res = await api('/api/systemd/preview-service', { method: 'POST', body: { pid: servicePid, name: $('#service-name').value } });
    if (ticket !== serviceTicket) return;
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
  try { const v = JSON.parse(localStorage.getItem(TERM_SESSIONS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveTermSessions() {
  // Only tmux-backed sessions persist across reloads; docker exec tabs die
  // with their socket and must not be restored.
  localStorage.setItem(TERM_SESSIONS_KEY, JSON.stringify([...termSessions.values()].filter((s) => !s.exec).map((s) => s.name)));
}

// opts.exec: open a docker exec shell into that container id/name instead of a
// tmux session. opts.label: text shown on the tab (defaults to name).
async function openTermTab(name, cwd, opts = {}) {
  if(cwd&&!opts.exec){try{await api('/api/files?path='+encodeURIComponent(cwd));}catch(e){errToast(e);return;}}
  try { await AxonAssets.terminal(); } catch (err) { errToast(err); return; }
  if (termSessions.has(name)) { activateTermTab(name); return termSessions.get(name); }
  const page = document.createElement('div');
  page.className = 'term-page';
  $('#term-pages').appendChild(page);

  const t = new Terminal({ cursorBlink: true, fontSize: Math.max(12, Math.min(20, Number(localStorage.getItem('axon:terminal-font')) || 14)), fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim(), theme: { background: getComputedStyle(document.documentElement).getPropertyValue('--terminal-bg').trim(), foreground: getComputedStyle(document.documentElement).getPropertyValue('--terminal-fg').trim(), cursor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() } });
  const fit = new FitAddon.FitAddon();
  t.loadAddon(fit);
  t.open(page);
  t.options.scrollback = 10000;
  t.options.altClickMovesCursor = false;
  t.options.linkHandler = { activate: (_event, url) => AxonTerminalTools.open(url) };
  AxonTerminalTools.attach(t, page);

  const tabBtn = document.createElement('div');
  tabBtn.className = 'term-tab';
  tabBtn.innerHTML = `<button class="term-tab-select" type="button">${icon('terminal')} <span>${esc(opts.label || name)}</span></button><button class="term-tab-x" type="button" aria-label="Cerrar sesión ${esc(opts.label || name)}">×</button>`;
  tabBtn.querySelector('.term-tab-select').addEventListener('click', () => activateTermTab(name));
  tabBtn.querySelector('.term-tab-x').addEventListener('click', async () => {
    if(opts.exec && !(await confirmDialog('Cerrar terminal del contenedor', 'Se cierra esta sesión interactiva.', 'Cerrar sesión')))return;
    closeTermTab(name);
  });
  $('#term-tabs').appendChild(tabBtn);

  const sess = { term: t, fit, ws: null, page, tabBtn, name, exec: opts.exec || '', pendingCwd: cwd || '', pendingCommand: opts.command || '', retries: 0, closed: false, retryTimer: null, resizeTimer: null, ctrlArmed: false, altArmed: false };
  t.parser.registerOscHandler(777, data => {
    if (data !== 'axon-ready') return false;
    if (sess.ws?.readyState === 1) {
      if (sess.pendingCwd) { sess.ws.send(JSON.stringify({ t: 'i', d: `cd '${sess.pendingCwd.replace(/'/g, `'"'"'`)}'\n` })); sess.pendingCwd = ''; }
      if (sess.pendingCommand) { sess.ws.send(JSON.stringify({ t: 'i', d: sess.pendingCommand + '\n' })); sess.pendingCommand = ''; }
    }
    return true;
  });
  termSessions.set(name, sess);
  saveTermSessions();

  t.onData((d) => sendTermInput(sess, d));
  // Debounce: cada resize dispara un hostExec con tmux en el servidor — sin
  // pausa, arrastrar una ventana spawnea decenas de procesos.
  t.onResize(({ cols, rows }) => {
    clearTimeout(sess.resizeTimer);
    sess.resizeTimer = setTimeout(() => {
      if (sess.ws?.readyState === 1) sess.ws.send(JSON.stringify({ t: 'r', c: cols, r: rows }));
    }, 250);
  });

  connectTermTab(sess);
  activateTermTab(name);
  refreshIcons();
  return sess;
}

// Input al ws aplicando el Ctrl "pegajoso" de la barra de teclas móvil:
// si está armado, el próximo carácter se convierte en su código de control
// (Ctrl+C → \x03) y las flechas en sus variantes Ctrl+flecha.
const TERM_CTRL_SEQ = { '\x1b[A': '\x1b[1;5A', '\x1b[B': '\x1b[1;5B', '\x1b[C': '\x1b[1;5C', '\x1b[D': '\x1b[1;5D' };
function sendTermInput(sess, d) {
  if (sess.ctrlArmed) {
    sess.ctrlArmed = false;
    syncTermCtrl(sess);
    if (d.length === 1) {
      const c = d.toUpperCase().charCodeAt(0);
      if (c >= 64 && c < 96) d = String.fromCharCode(c - 64);
    } else if (TERM_CTRL_SEQ[d]) d = TERM_CTRL_SEQ[d];
  }
  if (sess.altArmed) {
    sess.altArmed = false;
    syncTermCtrl(sess);
    d = '\x1b' + d;
  }
  if (sess.ws?.readyState === 1) sess.ws.send(JSON.stringify({ t: 'i', d }));
}
function syncTermCtrl(sess) {
  const host = sess.tabBtn?.closest('.term-tabbar')?.parentElement;
  const paint = (b, on) => {
    b.classList.toggle('term-key-armed', on);
    b.style.outline = on ? '2px solid var(--accent, #5e6ad2)' : '';
    b.style.outlineOffset = '-2px';
  };
  const active = termSessions.get(activeTerm) === sess;
  host?.querySelectorAll('.term-key-ctrl').forEach((b) => paint(b, active && sess.ctrlArmed));
  host?.querySelectorAll('.term-key-alt').forEach((b) => paint(b, active && sess.altArmed));
}

// Barra de teclas especiales para móviles (sin teclado físico: Esc/Tab/Ctrl
// y flechas son inalcanzables). Se inyecta desde JS porque es funcionalidad
// de la sesión, no del markup estático.
const TERM_KEYBAR = [
  ['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl', 'ctrl'], ['Alt', 'alt'],
  ['←', '\x1b[D'], ['↓', '\x1b[B'], ['↑', '\x1b[A'], ['→', '\x1b[C'],
  ['Home', '\x1b[H'], ['End', '\x1b[F'], ['PgUp', '\x1b[5~'], ['PgDn', '\x1b[6~'],
];
function ensureTermKeybar() {
  if ($('#term-keybar')) return;
  const bar = document.createElement('div');
  bar.id = 'term-keybar';
  bar.className = 'term-keybar';
  bar.style.cssText = 'display:flex;gap:6px;padding:4px 8px;overflow-x:auto;flex:0 0 auto;touch-action:manipulation;border-bottom:1px solid var(--border, #262c3a);background:var(--bg-surface, #10141d)';
  for (const [label, key] of TERM_KEYBAR) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-secondary' + (key === 'ctrl' ? ' term-key-ctrl' : key === 'alt' ? ' term-key-alt' : '');
    b.textContent = label;
    b.style.cssText = 'padding:4px 10px;white-space:nowrap;flex:0 0 auto';
    b.addEventListener('click', () => {
      const sess = termSessions.get(activeTerm);
      if (!sess) return;
      // Ctrl/Alt son "pegajosos": modifican la próxima tecla (del teclado
      // virtual del SO o de esta barra) y se sueltan solos.
      if (key === 'ctrl') { sess.ctrlArmed = !sess.ctrlArmed; sess.altArmed = false; syncTermCtrl(sess); sess.term.focus(); return; }
      if (key === 'alt') { sess.altArmed = !sess.altArmed; sess.ctrlArmed = false; syncTermCtrl(sess); sess.term.focus(); return; }
      sendTermInput(sess, key);
      sess.term.focus();
    });
    bar.appendChild(b);
  }
  const host = $('#tab-terminal');
  host.insertBefore(bar, $('#term-pages'));
  syncTermKeybarVisibility();
  window.matchMedia('(pointer:coarse)').addEventListener('change', syncTermKeybarVisibility);
}
function syncTermKeybarVisibility() {
  const bar = $('#term-keybar');
  if (bar) bar.style.display = window.matchMedia('(pointer:coarse)').matches || !window.matchMedia('(pointer:fine)').matches ? 'flex' : 'none';
}

function updateTermStatus() {
  const el = $('#term-connection'), sess = termSessions.get(activeTerm);
  if (!el) return;
  const ready = sess?.ws?.readyState;
  el.textContent = !sess ? 'Sin sesión' : ready === 1 ? `Conectada · ${sess.name}` : ready === 0 ? 'Conectando…' : 'Desconectada · podés reconectar';
}
function connectTermTab(sess) {
  if (sess.closed || sess.ws?.readyState === 0 || sess.ws?.readyState === 1) return;
  clearTimeout(sess.retryTimer);
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
  updateTermStatus();
  ws.onopen = () => {
    if (sess.ws !== ws || sess.closed) return;
    sess.retries = 0; updateTermStatus();
    sess.tabBtn.classList.remove('term-tab-offline');
  };
  ws.onmessage = (e) => {
    if (sess.ws !== ws || sess.closed) return;
    sess.term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
  };
  ws.onclose = () => {
    // A stale socket closing must not mark the replacement as offline.
    if (sess.ws !== ws || sess.closed) return;
    updateTermStatus();
    // Reintento ilimitado con backoff (tope 30s) también con la pestaña en
    // background — antes se rendía a los ~6 intentos y solo si la sección
    // estaba activa, dejando la sesión muda sin aviso.
    if (!sess.exec) {
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(sess.retries++, 5));
      sess.retryTimer = setTimeout(() => connectTermTab(sess), delay);
    }
    sess.term.write('\r\n[desconectado — reintentando]\r\n');
    sess.tabBtn.classList.add('term-tab-offline');
  };
}

function activateTermTab(name) {
  activeTerm = name;
  updateTermStatus();
  for (const [n, s] of termSessions) {
    s.page.classList.toggle('active', n === name);
    s.tabBtn.classList.toggle('active', n === name);
    s.tabBtn.querySelector('.term-tab-select')?.setAttribute('aria-pressed', String(n===name));
  }
  const s = termSessions.get(name);
  // Si la pestaña quedó offline en background, activarla la reconecta.
  if (s) { connectTermTab(s); syncTermCtrl(s); requestAnimationFrame(() => { s.fit.fit(); s.term.focus(); }); }
}

function closeTermTab(name) {
  const s = termSessions.get(name);
  if (!s) return;
  s.closed = true; clearTimeout(s.retryTimer); clearTimeout(s.resizeTimer);
  try { s.ws?.close(); } catch { /* gone */ }
  s.term.dispose();
  s.page.remove();
  s.tabBtn.remove();
  termSessions.delete(name);
  saveTermSessions();
  // La sesión tmux del host sobrevive al detach y quedaba huérfana
  // (axon-term-* acumuladas). Kill best-effort: si el endpoint falta, el
  // 404 se ignora en silencio.
  if (!s.exec) api(`/api/term/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
  if (activeTerm === name) {
    const next = termSessions.keys().next().value;
    if (next) activateTermTab(next);
    else activeTerm = null;
  }
  updateTermStatus();
}

function openTerm(cwd) {
  document.querySelector('.tab-btn[data-tab="terminal"]')?.click();
  if (cwd) {
    termCounter++;
    openTermTab(`axon-term-${Date.now().toString(36)}-${termCounter}`, cwd);
  } else if (!termSessions.size) {
    termCounter++;
    openTermTab('axon-term');
  }
}

// Reconnect on click when offline
$('#term-pages').addEventListener('click', () => {
  const s = termSessions.get(activeTerm);
  if (s && s.ws?.readyState > 1) connectTermTab(s);
});

$('#term-btn').addEventListener('click', () => openTerm());
$('#term-new-tab').addEventListener('click', () => {
  termCounter++;
  openTermTab(`axon-term-${termCounter}`);
});
new ResizeObserver(() => { if (activeTerm && activeTabName === 'terminal') termSessions.get(activeTerm)?.fit.fit(); }).observe($('#term-pages'));
document.addEventListener('axon:terminal-font', e => { for(const s of termSessions.values()) s.term.options.fontSize = e.detail; termSessions.get(activeTerm)?.fit.fit(); });
document.addEventListener('visibilitychange', () => { if(!document.hidden && activeTabName === 'terminal') { const s=termSessions.get(activeTerm); if(s)connectTermTab(s); } });

// openTermCmd(cmd): open a fresh terminal tab and type a command into it —
// used by other features (docker exec, journalctl viewer, kill menus).
function openTermCmd(cmd, opts = {}) {
  document.querySelector('.tab-btn[data-tab="terminal"]')?.click();
  termCounter++;
  return openTermTab(`axon-term-${Date.now().toString(36)}-${termCounter}`, null, { ...opts, command: cmd });
}

// openTermExec(id, name): open a fresh terminal tab running an interactive
// shell inside a docker container (`docker exec -it`). Not tmux-persistent —
// the session dies when the tab/socket closes.
async function openTermExec(id, name) {
  // docker exec abre una shell con los privilegios del contenedor — pedir
  // confirmación nombrando el container antes de lanzarla.
  if (!(await confirmDialog('Terminal en contenedor', `Se abre una shell interactiva (docker exec) en ${name || id}.`, 'Abrir terminal'))) return;
  document.querySelector('.tab-btn[data-tab="terminal"]')?.click();
  termCounter++;
  const label = (name || id).length > 20 ? `${(name || id).slice(0, 19)}…` : (name || id);
  openTermTab(`pm-exec-${termCounter}`, '', { exec: id, label });
}

loaders.terminal = async () => {
  try { await AxonAssets.terminal(); } catch (err) { errToast(err); return; }
  ensureTermKeybar();
  updateTermStatus();
  if (!termSessions.size) {
    const saved = savedTermSessions();
    termCounter = saved.length;
    for (const name of saved) await openTermTab(name);
    if (!termSessions.size) await openTermTab('axon-term');
  } else if (activeTerm) {
    const s=termSessions.get(activeTerm); s?.fit.fit(); if(s)connectTermTab(s);
  }
};

// ---------- Server-side browser (Steel session viewer) ----------

// Chromium real (jlesage/chromium + noVNC) — full browser running on the
// server with a persistent profile (accounts/cookies stay logged in).
const BROWSER_PORT = 5800;
const browserUrl = `/p/${BROWSER_PORT}/?autoconnect=true&resize=scale&path=p/${BROWSER_PORT}/websockify`;
let browserLoaded = false;
let browserTicket = 0;

async function loadBrowser() {
  const ticket = ++browserTicket, status = $('#browser-state');
  if (browserLoaded) {
    // El iframe puede quedar mostrando un 502 viejo del proxy aunque la
    // página cargó OK — verificar que el contenedor siga vivo al volver.
    try {
      const r = await api('/api/browser/status');
      if (ticket !== browserTicket) return;
      if (r.available) return;
      browserLoaded = false;
      $('#browser-frame').src = 'about:blank';
    } catch { if (ticket !== browserTicket) return; }
  }
  status.dataset.state='loading'; status.innerHTML=`${icon('loader','spin')} Conectando con Chromium…`; refreshIcons();
  try {
    const result=await api('/api/browser/status');
    if(ticket!==browserTicket)return;
    if(!result.available)throw new Error('Chromium no responde. Revisá el contenedor desde Docker.');
    $('#browser-frame').src = browserUrl;
    browserLoaded = true;
    status.textContent='Abriendo la sesión del navegador…';
  } catch(e) { if(ticket!==browserTicket)return;status.dataset.state='error';status.textContent=e.message + ' Usá Recargar para reintentar.'; }
}
function unloadBrowser(force = false) {
  // Preserve the established viewer when moving between sections.
  if (force) { browserTicket++; $('#browser-frame').src='about:blank'; browserLoaded=false; }
}
$('#browser-frame').addEventListener('load', async ()=>{
  // El evento load también dispara con la página de error 502 del proxy —
  // no declarar "listo" hasta confirmar que Chromium responde de verdad.
  if(!browserLoaded)return;
  const ticket = browserTicket, status = $('#browser-state');
  try {
    const r = await api('/api/browser/status');
    if(ticket!==browserTicket || !browserLoaded)return;
    if(!r.available)throw new Error('no disponible');
    status.dataset.state='ready'; status.textContent='Visor del navegador cargado';
  } catch {
    if(ticket!==browserTicket)return;
    status.dataset.state='error';
    status.textContent='Chromium no responde — puede seguir arrancando. Reintentando…';
    // Reintento diferido: si el contenedor está levantando, vuelve solo.
    setTimeout(()=>{ if(ticket===browserTicket){browserLoaded=false;$('#browser-frame').src='about:blank';loadBrowser();} }, 4000);
  }
});

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
$('#browser-reload').addEventListener('click', e => AxonUI.busy(e.currentTarget, async () => { unloadBrowser(true); await loadBrowser(); }));

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
  const typed = await window.AxonSettings.promptPower(word);
  if (typed === null) return;
  try {
    await api('/api/system/power', { method: 'POST', body: { action, confirm: typed.trim().toUpperCase() } });
    toast(`${word === 'REINICIAR' ? 'Reinicio' : 'Apagado'} programado en 3 segundos`, 'ok');
  } catch (err) { errToast(err); }
}

$('#power-reboot').addEventListener('click', () => powerAction('reboot', 'REINICIAR'));
$('#power-off').addEventListener('click', () => powerAction('poweroff', 'APAGAR'));
