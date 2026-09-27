/* Ports Manager — feature: Salud (ops) tab
 * Injects #tab-ops + its nav button; wires loaders['ops'].
 * Depends on app.js globals: $, $$, api, esc, icon, toast, errToast,
 * confirmDialog, refreshIcons, gotoTab, loaders (all top-level in app.js).
 * If a global is missing everything is guarded — the tab just won't appear.
 */
(() => {
  'use strict';

  const MAC_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;
  let opsLastData = null;

  // ---------- DOM injection ----------

  function activateOpsTab() {
    $$('.tab-btn').forEach((b) => b.classList.remove('active'));
    $$('.tab-content').forEach((t) => t.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="ops"]')?.classList.add('active');
    $('#tab-ops')?.classList.add('active');
    try {
      // eslint-disable-next-line no-undef
      if (typeof activeTabName !== 'undefined') {
        if (activeTabName === 'navegador' && typeof unloadBrowser === 'function') unloadBrowser();
        activeTabName = 'ops';
      }
    } catch { /* older app.js without those bindings */ }
    loadOps();
  }

  function ensureDom() {
    if ($('#tab-ops')) return;

    // Nav button — inside "Sistema", right before "Programas".
    const nav = $('.sidebar-nav');
    const anchor = document.querySelector('.tab-btn[data-tab="programs"]');
    if (nav && anchor) {
      const btn = document.createElement('button');
      btn.className = 'nav-item tab-btn';
      btn.dataset.tab = 'ops';
      btn.innerHTML = `
        <i data-lucide="activity" class="lucide-icon"></i>
        <span class="nav-label">Salud</span>
        <span class="nav-count nav-alert hidden" id="nav-count-ops"></span>`;
      nav.insertBefore(btn, anchor);
      btn.addEventListener('click', activateOpsTab);
    }

    const main = $('main.content');
    if (!main) return;
    const sec = document.createElement('section');
    sec.id = 'tab-ops';
    sec.className = 'tab-content';
    sec.innerHTML = `
      <div class="section-header">
        <h2>Salud del servidor</h2>
        <div class="section-actions">
          <button id="ops-refresh" class="btn-secondary" title="Recargar"><i data-lucide="refresh-cw" class="lucide-icon"></i></button>
          <span class="last-updated" id="ops-updated"></span>
        </div>
      </div>
      <div class="ops-grid" id="ops-grid">
        <div class="ops-card" id="ops-card-units">
          <div class="ops-card-head">${icon('server')}<h3>Unidades fallidas</h3><span class="ops-pill hidden" id="ops-units-pill"></span></div>
          <div class="ops-card-body" id="ops-units"><p class="ops-loading">Cargando…</p></div>
        </div>
        <div class="ops-card" id="ops-card-ssh">
          <div class="ops-card-head">${icon('key')}<h3>SSH — intentos fallidos</h3></div>
          <div class="ops-card-body" id="ops-ssh"><p class="ops-loading">Cargando…</p></div>
        </div>
        <div class="ops-card" id="ops-card-updates">
          <div class="ops-card-head">${icon('package')}<h3>Actualizaciones pendientes</h3></div>
          <div class="ops-card-body" id="ops-updates"><p class="ops-loading">Cargando…</p></div>
        </div>
        <div class="ops-card" id="ops-card-certs">
          <div class="ops-card-head">${icon('lock')}<h3>Certificados TLS</h3></div>
          <div class="ops-card-body" id="ops-certs"><p class="ops-loading">Cargando…</p></div>
        </div>
        <div class="ops-card" id="ops-card-system">
          <div class="ops-card-head">${icon('power')}<h3>Sistema</h3></div>
          <div class="ops-card-body" id="ops-system"><p class="ops-loading">Cargando…</p></div>
        </div>
        <div class="ops-card" id="ops-card-resources">
          <div class="ops-card-head">${icon('cpu')}<h3>Recursos</h3></div>
          <div class="ops-card-body" id="ops-resources"><p class="ops-loading">Cargando…</p></div>
        </div>
        <div class="ops-card ops-card-wide" id="ops-card-wol">
          <div class="ops-card-head">${icon('zap')}<h3>Wake-on-LAN</h3></div>
          <div class="ops-card-body" id="ops-wol"><p class="ops-loading">Cargando…</p></div>
        </div>
        <div class="ops-card" id="ops-card-power">
          <div class="ops-card-head">${icon('alarm-clock')}<h3>Apagado programado</h3></div>
          <div class="ops-card-body" id="ops-power"><p class="ops-loading">Cargando…</p></div>
        </div>
      </div>`;
    main.appendChild(sec);
    wireEvents();
    refreshIcons();
  }

  // ---------- Rendering helpers ----------

  const isErr = (s) => !s || typeof s !== 'object' || s.error !== undefined;
  const errHtml = (s) => `<p class="ops-err">${icon('alert-triangle')} ${esc(s?.error || 'No disponible')}</p>`;

  function setBody(id, html) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }

  function renderUnits(units) {
    const pill = $('#ops-units-pill');
    if (isErr(units)) { setBody('#ops-units', errHtml(units)); pill?.classList.add('hidden'); return; }
    const list = Array.isArray(units) ? units : [];
    if (pill) {
      pill.classList.toggle('hidden', list.length === 0);
      pill.textContent = list.length;
    }
    const nc = $('#nav-count-ops');
    if (nc) { nc.classList.toggle('hidden', list.length === 0); nc.textContent = list.length ? `${list.length} fallida${list.length === 1 ? '' : 's'}` : ''; }
    if (!list.length) {
      setBody('#ops-units', `<p class="ops-ok-line">${icon('check-circle-2')} Todo bien — sin unidades fallidas</p>`);
      return;
    }
    setBody('#ops-units', `<ul class="ops-units">${list.map((u) => `
      <li class="ops-unit">
        <span class="ops-unit-name mono" title="${esc(u.unit)}">${esc(u.unit)}</span>
        <span class="ops-scope">${esc(u.scope)}</span>
        <span class="ops-unit-acts">
          <button class="btn-action ops-mini ops-unit-restart" data-unit="${esc(u.unit)}" data-scope="${esc(u.scope)}" title="Reiniciar">${icon('rotate-cw')} Reiniciar</button>
          <button class="btn-secondary ops-mini ops-unit-logs" data-unit="${esc(u.unit)}" data-scope="${esc(u.scope)}" title="Ver logs en terminal">${icon('file-text')} Logs</button>
        </span>
      </li>`).join('')}</ul>`);
  }

  function renderSsh(ssh) {
    if (isErr(ssh)) { setBody('#ops-ssh', errHtml(ssh)); return; }
    const n = ssh.failed24h;
    if (n === null || n === undefined) { setBody('#ops-ssh', `<p class="ops-err">${icon('alert-triangle')} No disponible</p>`); return; }
    const cls = n > 10 ? 'ops-bad' : n > 0 ? 'ops-warn-t' : 'ops-good';
    setBody('#ops-ssh', `
      <div class="ops-big ${cls}">${n}</div>
      <p class="ops-sub">intentos fallidos en 24h${ssh.source ? ` <span class="ops-src">· ${esc(ssh.source)}</span>` : ''}</p>
      ${n > 10 ? `<p class="ops-err">${icon('shield-alert')} Muchos intentos — revisá fail2ban o el puerto SSH expuesto</p>` : ''}`);
  }

  function renderUpdates(u) {
    if (isErr(u)) { setBody('#ops-updates', errHtml(u)); return; }
    const sec = u.security > 0 ? `<span class="ops-chip ops-chip-bad">${u.security} de seguridad</span>` : '';
    setBody('#ops-updates', `
      <div class="ops-big ${u.total > 0 ? 'ops-warn-t' : 'ops-good'}">${u.total}</div>
      <p class="ops-sub">paquetes actualizables ${sec}</p>
      ${u.total > 0 ? `<button class="btn-primary btn-inline" id="ops-updates-go">${icon('arrow-up-circle')} Actualizar ahora</button>` : `<p class="ops-ok-line">${icon('check-circle-2')} Sistema al día</p>`}`);
  }

  function renderCerts(certs) {
    if (isErr(certs)) { setBody('#ops-certs', errHtml(certs)); return; }
    const list = Array.isArray(certs) ? certs : [];
    if (!list.length) { setBody('#ops-certs', `<p class="ops-sub">Sin dominios configurados</p>`); return; }
    setBody('#ops-certs', `<div class="ops-chips">${list.map((ct) => {
      if (ct.warn === 'error' || ct.daysLeft === null || ct.daysLeft === undefined) {
        return `<span class="ops-chip ops-chip-err" title="${esc(ct.error || 'Sin certificado')}">${esc(ct.domain)}: —</span>`;
      }
      const cls = ct.warn === 'bad' ? 'ops-chip-bad' : ct.warn === 'warn' ? 'ops-chip-warn' : 'ops-chip-ok';
      return `<span class="ops-chip ${cls}" title="${esc(ct.notAfter || '')}">${esc(ct.domain)}: ${ct.daysLeft}d</span>`;
    }).join('')}</div>`);
  }

  function renderSystem(sys, tunnel) {
    const parts = [];
    if (isErr(sys)) {
      parts.push(errHtml(sys));
    } else {
      parts.push(`
        <div class="ops-kv"><span>Uptime</span><strong>${esc(sys.uptime || '-')}</strong></div>
        <div class="ops-kv"><span>Último booteo</span><strong class="mono">${esc(sys.since || sys.bootTime || '-')}</strong></div>`);
    }
    if (isErr(tunnel)) {
      parts.push(`<div class="ops-kv"><span>Túnel cloudflared</span><strong class="ops-err-inline">no disponible</strong></div>`);
    } else {
      const st = tunnel.status || 'unknown';
      const cls = st === 'active' ? 'health-ok' : st === 'activating' || st === 'warn' ? 'health-warn' : 'health-bad';
      parts.push(`
        <div class="ops-kv"><span>Túnel cloudflared</span>
          <strong><span class="health-dot ${cls}"></span> ${esc(st)}${tunnel.source ? ` <span class="ops-src">${esc(tunnel.source)}</span>` : ''}</strong>
        </div>
        ${tunnel.detail ? `<p class="ops-sub mono">${esc(tunnel.detail)}</p>` : ''}`);
    }
    setBody('#ops-system', parts.join(''));
  }

  function bar(pct, warnAt = 85) {
    const v = Math.max(0, Math.min(100, pct ?? 0));
    const cls = pct == null ? '' : v >= warnAt ? 'ops-bar-bad' : v >= warnAt - 15 ? 'ops-bar-warn' : 'ops-bar-ok';
    return `<div class="ops-bar"><span class="${cls}" style="width:${v}%"></span></div>`;
  }

  function renderResources(r) {
    if (isErr(r)) { setBody('#ops-resources', errHtml(r)); return; }
    const disks = (r.disks || []).map((d) => `
      <div class="ops-kv"><span class="mono">${esc(d.mount)}</span><strong>${d.pcent}%</strong></div>${bar(d.pcent)}`).join('');
    const mem = r.memPct !== null && r.memPct !== undefined ? `
      <div class="ops-kv"><span>RAM</span><strong>${r.memPct}%${r.memUsedMb ? ` <span class="ops-src">${r.memUsedMb}/${r.memTotalMb} MB</span>` : ''}</strong></div>${bar(r.memPct)}` : '';
    const temps = (r.temps || []).length ? `
      <div class="ops-temps">${r.temps.map((t) => `<span class="ops-chip ${t.c >= 75 ? 'ops-chip-bad' : t.c >= 60 ? 'ops-chip-warn' : 'ops-chip-ok'}" title="${esc(t.label)}">${esc(t.label)}: ${t.c}°</span>`).join('')}</div>` : '';
    setBody('#ops-resources', disks + mem + temps || `<p class="ops-sub">Sin datos</p>`);
  }

  // ---------- WoL ----------

  function renderWol(data) {
    const devices = data.devices || [];
    const wakes = data.wakes || [];
    const rows = devices.map((d) => `
      <tr>
        <td><strong>${esc(d.name)}</strong></td>
        <td class="mono">${esc(d.mac)}</td>
        <td><div class="actions">
          <button class="btn-action ops-mini ops-wol-wake" data-mac="${esc(d.mac)}" data-name="${esc(d.name)}">${icon('zap')} Despertar</button>
          <button class="btn-danger ops-mini ops-wol-del" data-mac="${esc(d.mac)}">${icon('trash-2')}</button>
        </div></td>
      </tr>`).join('');
    const history = wakes.length ? `
      <details class="ops-wakes"><summary>Últimos envíos</summary>
        <ul>${wakes.map((w) => `<li class="ops-sub mono">${esc(w.name || w.mac)} → ${esc(w.broadcast || '')} · ${new Date(w.t).toLocaleString()}${w.method ? ` · ${esc(w.method)}` : ''}</li>`).join('')}</ul>
      </details>` : '';
    setBody('#ops-wol', `
      ${devices.length ? `<table class="ops-table"><tbody>${rows}</tbody></table>` : `<p class="ops-sub">Sin dispositivos guardados</p>`}
      <form id="ops-wol-form" class="ops-form">
        <input type="text" id="ops-wol-name" placeholder="Nombre (ej. PC escritorio)" required maxlength="60">
        <input type="text" id="ops-wol-mac" class="mono" placeholder="aa:bb:cc:dd:ee:ff" required>
        <button type="submit" class="btn-action ops-mini">${icon('plus')} Agregar</button>
      </form>
      <form id="ops-wol-quick" class="ops-form">
        <input type="text" id="ops-wol-quickmac" class="mono" placeholder="MAC para despertar sin guardar">
        <button type="submit" class="btn-secondary ops-mini">${icon('zap')} Despertar</button>
      </form>
      ${history}`);
  }

  async function sendWake(mac, name) {
    try {
      const res = await api('/api/ops/wol', { method: 'POST', body: { mac, name } });
      toast(`Paquete WoL enviado a ${name || mac}`, 'ok', res.method ? `vía ${res.method}` : '', 4000);
    } catch (err) { errToast(err); }
  }

  // ---------- Power ----------

  function renderPower(data) {
    const p = data.power;
    const pending = p ? `
      <p class="ops-err">${icon('alarm-clock')} <strong>${esc(p.action === 'reboot' ? 'Reinicio' : 'Apagado')}</strong> programado en ~${p.minutes} min
        <span class="ops-sub">(${new Date(p.fireAt).toLocaleTimeString()})</span></p>` :
      data.hostPending ? `<p class="ops-err">${icon('alarm-clock')} Hay un shutdown pendiente en el host</p>` : '';
    setBody('#ops-power', `
      ${pending}
      <form id="ops-power-form" class="ops-form">
        <select id="ops-power-action">
          <option value="shutdown">Apagar</option>
          <option value="reboot">Reiniciar</option>
        </select>
        <span class="ops-sub">en</span>
        <input type="number" id="ops-power-mins" min="1" max="10080" value="30" class="ops-num">
        <span class="ops-sub">min</span>
        <button type="submit" class="btn-danger ops-mini">${icon('timer')} Programar</button>
      </form>
      <button id="ops-power-cancel" class="btn-secondary ops-mini">${icon('timer-off')} Cancelar apagado</button>`);
  }

  // ---------- Load ----------

  async function loadOps() {
    ensureDom();
    const stamp = $('#ops-updated');
    if (stamp) stamp.textContent = 'Cargando…';
    const [ops, wol, power] = await Promise.allSettled([
      api('/api/ops'),
      api('/api/ops/wol/devices'),
      api('/api/ops/power'),
    ]);
    if (ops.status === 'fulfilled') {
      opsLastData = ops.value;
      const s = ops.value.sections || {};
      renderUnits(s.units);
      renderSsh(s.ssh);
      renderUpdates(s.updates);
      renderCerts(s.certs);
      renderSystem(s.system, s.tunnel);
      renderResources(s.resources);
    } else {
      errToast(ops.reason);
      setBody('#ops-units', errHtml({ error: 'No se pudo cargar' }));
    }
    if (wol.status === 'fulfilled') renderWol(wol.value);
    else setBody('#ops-wol', errHtml({ error: wol.reason?.message || 'No disponible' }));
    if (power.status === 'fulfilled') renderPower(power.value);
    else setBody('#ops-power', errHtml({ error: power.reason?.message || 'No disponible' }));
    if (stamp) stamp.textContent = `Actualizado ${new Date().toLocaleTimeString()}`;
    refreshIcons();
  }

  // ---------- Events (delegated — survives re-renders) ----------

  function wireEvents() {
    $('#ops-refresh')?.addEventListener('click', loadOps);

    $('#tab-ops').addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.id === 'ops-updates-go') {
        gotoTab('programs');
        setTimeout(() => document.getElementById('update-all-btn')?.click(), 400);
        return;
      }

      if (btn.id === 'ops-power-cancel') {
        const ok = await confirmDialog('Cancelar apagado', 'Se cancela cualquier shutdown/reboot programado en el host.', 'Cancelar programación');
        if (!ok) return;
        try {
          await api('/api/ops/power/cancel', { method: 'POST' });
          toast('Apagado programado cancelado', 'ok');
          loadOps();
        } catch (err) { errToast(err); }
        return;
      }

      if (btn.classList.contains('ops-unit-restart')) {
        btn.disabled = true;
        try {
          await api('/api/ops/unit/restart', { method: 'POST', body: { unit: btn.dataset.unit, scope: btn.dataset.scope } });
          toast(`${btn.dataset.unit} reiniciada`, 'ok');
          loadOps();
        } catch (err) { errToast(err); btn.disabled = false; }
        return;
      }

      if (btn.classList.contains('ops-unit-logs')) {
        const scopeFlag = btn.dataset.scope === 'system' ? '' : '--user ';
        if (typeof openTermCmd === 'function') {
          openTermCmd(`journalctl ${scopeFlag}-u ${btn.dataset.unit} -n 80 --no-pager`);
        } else {
          gotoTab('terminal');
        }
        return;
      }

      if (btn.classList.contains('ops-wol-wake')) {
        btn.disabled = true;
        await sendWake(btn.dataset.mac, btn.dataset.name);
        btn.disabled = false;
        loadOps();
        return;
      }

      if (btn.classList.contains('ops-wol-del')) {
        const ok = await confirmDialog('Eliminar dispositivo', `Se quita ${btn.dataset.mac} de la lista WoL.`, 'Eliminar');
        if (!ok) return;
        try {
          await api(`/api/ops/wol/devices/${encodeURIComponent(btn.dataset.mac)}`, { method: 'DELETE' });
          toast('Dispositivo eliminado', 'ok');
          loadOps();
        } catch (err) { errToast(err); }
        return;
      }
    });

    $('#tab-ops').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (e.target.id === 'ops-wol-form') {
        const name = $('#ops-wol-name').value.trim();
        const mac = $('#ops-wol-mac').value.trim().replace(/-/g, ':').toLowerCase();
        if (!MAC_RE.test(mac)) { toast('MAC inválida — formato aa:bb:cc:dd:ee:ff', 'warn'); return; }
        try {
          await api('/api/ops/wol/devices', { method: 'POST', body: { name, mac } });
          toast('Dispositivo guardado', 'ok');
          loadOps();
        } catch (err) { errToast(err); }
      } else if (e.target.id === 'ops-wol-quick') {
        const mac = $('#ops-wol-quickmac').value.trim().replace(/-/g, ':').toLowerCase();
        if (!MAC_RE.test(mac)) { toast('MAC inválida — formato aa:bb:cc:dd:ee:ff', 'warn'); return; }
        await sendWake(mac);
        loadOps();
      } else if (e.target.id === 'ops-power-form') {
        const action = $('#ops-power-action').value;
        const mins = Math.max(1, parseInt($('#ops-power-mins').value, 10) || 0);
        const label = action === 'reboot' ? 'reiniciar' : 'apagar';
        const ok = await confirmDialog(
          `${action === 'reboot' ? 'Reinicio' : 'Apagado'} programado`,
          `El servidor se va a ${label} en ${mins} minuto${mins === 1 ? '' : 's'}. El dashboard se desconecta en ese momento.`,
          'Programar'
        );
        if (!ok) return;
        try {
          await api('/api/ops/power/schedule', { method: 'POST', body: { action, delaySec: mins * 60 } });
          toast(`${action === 'reboot' ? 'Reinicio' : 'Apagado'} programado en ${mins} min`, 'ok');
          loadOps();
        } catch (err) { errToast(err); }
      }
    });
  }

  // ---------- Boot ----------

  function init() {
    try {
      ensureDom();
      if (typeof loaders === 'object' && loaders) loaders.ops = loadOps;
      refreshIcons();
    } catch (err) {
      console.error('feat-ops init failed:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
