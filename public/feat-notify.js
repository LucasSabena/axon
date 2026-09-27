/* Ports Manager — notification center (bell + dropdown + active alerts)
 *
 * The integrator adds this button to the topbar:
 *   <button id="notif-bell" class="icon-btn"><i data-lucide="bell"></i><span id="notif-badge" class="hidden"></span></button>
 * and loads this file + feat-notify.css. Everything else is self-contained:
 * the panel is built at runtime and appended to document.body.
 */
(function () {
  'use strict';

  // --- Resolve app.js helpers if present (esc/icon/relTime are `const`
  // lexical globals there — not on window — so reach them by bare name inside
  // try/catch; a missing binding throws ReferenceError, which we catch).
  const $ = (sel) => document.querySelector(sel);

  const escFallback = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const apiFallback = async (path, opts = {}) => {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const e = new Error(data.error || `HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return data;
  };

  const iconFallback = (name, cls = '') =>
    `<i data-lucide="${_esc(name)}" class="lucide-icon${cls ? ' ' + cls : ''}"></i>`;

  const relTimeFallback = (ts) => {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `hace ${s}s`;
    if (s < 3600) return `hace ${Math.floor(s / 60)}m`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)}h`;
    return `hace ${Math.floor(s / 86400)}d`;
  };

  let _api, _esc, _icon, _relTime;
  try { _api = api; } catch { _api = apiFallback; }
  try { _esc = esc; } catch { _esc = escFallback; }
  if (typeof _esc !== 'function') _esc = escFallback;
  try { _icon = icon; } catch { _icon = iconFallback; }
  if (typeof _icon !== 'function') _icon = iconFallback;
  try { _relTime = relTime; } catch { _relTime = relTimeFallback; }
  if (typeof _relTime !== 'function') _relTime = relTimeFallback;

  function refreshIcons() {
    try { window.lucide?.createIcons(); } catch { /* decorative */ }
  }

  // --- state
  const POLL_MS = 30_000;
  let panel = null;
  let bell = null;
  let badge = null;
  let open = false;
  let knownIds = null; // Set of event ids seen so far (null until first poll)

  // --- panel construction (lazy, needs a live bell to anchor to)
  function buildPanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'notif-panel';
    panel.className = 'hidden';
    panel.innerHTML = `
      <div class="notif-head">
        <span class="notif-title">Notificaciones</span>
        <div class="notif-head-actions">
          <button id="notif-read-all" class="notif-btn" title="Marcar todas como leídas">Marcar leídas</button>
          <button id="notif-clear" class="notif-btn notif-btn-danger" title="Vaciar el historial">Limpiar</button>
        </div>
      </div>
      <div id="notif-alerts" class="notif-alerts hidden">
        <div class="notif-section-title">Alertas activas</div>
        <div id="notif-alerts-list"></div>
      </div>
      <div id="notif-list" class="notif-list"><div class="notif-empty">Cargando…</div></div>`;
    document.body.appendChild(panel);

    $('#notif-read-all').addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await _api('/api/events/read', { method: 'POST' }); } catch { /* best-effort */ }
      updateBadge(0);
      panel.querySelectorAll('.notif-item-unread').forEach((el) => el.classList.remove('notif-item-unread'));
    });
    $('#notif-clear').addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await _api('/api/events/clear', { method: 'POST' }); } catch { /* best-effort */ }
      updateBadge(0);
      $('#notif-list').innerHTML = '<div class="notif-empty">Sin notificaciones</div>';
    });
    return panel;
  }

  function positionPanel() {
    if (!panel || !bell) return;
    const r = bell.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom) + 8}px`;
    panel.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
    panel.style.left = 'auto';
  }

  function setOpen(next) {
    if (!panel) return;
    open = next;
    panel.classList.toggle('hidden', !open);
    if (open) {
      positionPanel();
      refresh().catch(() => {});
    }
  }

  // --- rendering
  const TYPE_ICON = { alert: 'alert-triangle', job: 'check-circle', domain: 'globe', system: 'cpu', info: 'info' };

  function iconFor(ev) {
    if (ev.type === 'job' && /(fall|fail|error)/i.test(ev.title || '')) {
      return { name: 'x-circle', cls: 'notif-ic-danger' };
    }
    if (ev.type === 'alert') return { name: 'alert-triangle', cls: 'notif-ic-danger' };
    if (ev.type === 'job') return { name: TYPE_ICON.job, cls: 'notif-ic-ok' };
    return { name: TYPE_ICON[ev.type] || 'info', cls: '' };
  }

  function renderEvents(events) {
    const list = $('#notif-list');
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<div class="notif-empty">Sin notificaciones</div>';
      return;
    }
    list.innerHTML = events
      .map((ev) => {
        const ic = iconFor(ev);
        return `<div class="notif-item${ev.read ? '' : ' notif-item-unread'}">
          <span class="notif-ic ${ic.cls}">${_icon(ic.name)}</span>
          <div class="notif-body">
            <div class="notif-item-title">${_esc(ev.title)}</div>
            ${ev.detail ? `<div class="notif-detail">${_esc(ev.detail)}</div>` : ''}
            <div class="notif-time">${_relTime(ev.t)}</div>
          </div>
        </div>`;
      })
      .join('');
  }

  function renderAlerts(alerts) {
    const box = $('#notif-alerts');
    const list = $('#notif-alerts-list');
    if (!box || !list) return;
    if (!alerts.length) {
      box.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    box.classList.remove('hidden');
    list.innerHTML = alerts
      .map(
        (a) => `<div class="notif-alert notif-alert-${_esc(a.severity || 'warning')}">
          <span class="notif-ic notif-ic-danger">${_icon('alert-triangle')}</span>
          <div class="notif-body">
            <div class="notif-item-title">${_esc(a.title)}</div>
            ${a.detail ? `<div class="notif-detail">${_esc(a.detail)}</div>` : ''}
            <div class="notif-time">desde ${_relTime(a.since)}</div>
          </div>
        </div>`
      )
      .join('');
  }

  function updateBadge(unread) {
    if (!badge) return;
    if (!unread) {
      badge.classList.add('hidden');
      badge.textContent = '';
    } else {
      badge.classList.remove('hidden');
      badge.textContent = unread > 99 ? '99+' : String(unread);
    }
  }

  // --- data
  async function refresh() {
    const [eventsRes, alertsRes] = await Promise.allSettled([
      _api('/api/events'),
      _api('/api/alerts'),
    ]);

    if (eventsRes.status === 'fulfilled') {
      const { events = [], unread = 0 } = eventsRes.value;
      updateBadge(unread);
      if (open) {
        renderEvents(events);
        // Panel is visible → everything shown is implicitly read.
        _api('/api/events/read', { method: 'POST' })
          .then(() => updateBadge(0))
          .catch(() => {});
      }
      maybeNotify(events);
      knownIds = new Set(events.map((e) => e.id));
    }
    if (alertsRes.status === 'fulfilled' && open) {
      renderAlerts(alertsRes.value.alerts || []);
    }
  }

  // OS notification for NEW alert-type events only, and only when the tab
  // isn't being watched — same pattern as app.js job notifications.
  function maybeNotify(events) {
    const prev = knownIds;
    if (!prev) return; // first poll seeds the set, nothing is "new"
    const fresh = events.filter((e) => e.type === 'alert' && !prev.has(e.id));
    if (!fresh.length) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return;
    for (const ev of fresh.slice(0, 3)) {
      try { new Notification(ev.title, { body: ev.detail || '', icon: '/icons/app.svg' }); } catch { /* noop */ }
    }
  }

  // --- wiring
  function attach(b) {
    if (b.dataset.notifAttached) return; // idempotent — a double-eval must not stack listeners/polls
    b.dataset.notifAttached = '1';
    bell = b;
    badge = $('#notif-badge');
    buildPanel();

    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!open);
    });

    document.addEventListener('click', (e) => {
      if (!open) return;
      if (panel.contains(e.target) || bell.contains(e.target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) setOpen(false);
    });
    window.addEventListener('resize', () => { if (open) positionPanel(); });
    window.addEventListener('scroll', () => { if (open) positionPanel(); }, true);

    refresh().catch(() => {});
    setInterval(() => { refresh().catch(() => {}); }, POLL_MS);
  }

  // The integrator may inject the bell after this script runs — keep looking
  // until it appears (cheap: one getElementById every 2s).
  function waitForBell() {
    const b = $('#notif-bell');
    if (b) { attach(b); return; }
    setTimeout(waitForBell, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForBell);
  } else {
    waitForBell();
  }
})();
