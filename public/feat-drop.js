/* AXON — feat: Drop (pair-drop) + sesiones/dispositivos
   IIFE. Usa los globales de app.js: $, $$, api, esc, icon, toast, errToast,
   confirmDialog, refreshIcons, relTime, loaders, unloadBrowser, activeTabName.
   QR: window.qrcode (kazuhiko, vendored) con fallback a window.QRCode.
   Cargar DESPUÉS de app.js. */
(function () {
  'use strict';

  var TAB = 'drop';

  function dropUrl(id) { return location.origin + '/x/drop/' + id; }

  function fmtBytes(n) {
    if (n === undefined || n === null || isNaN(n)) return '-';
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var v = n;
    for (var i = 0; i < units.length; i++) {
      v /= 1024;
      if (v < 1024) return v.toFixed(v < 10 ? 1 : 0) + ' ' + units[i];
    }
    return v.toFixed(0) + ' TB';
  }

  function fmtExp(ts) {
    var d = new Date(ts);
    if (!ts || isNaN(d.getTime())) return '-';
    if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString();
    return d.toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // Opciones compartidas por los tres creadores de links (subir, serve, texto).
  function linkOpts() {
    var o = {};
    var el;
    el = document.getElementById('drop-ttl');
    if (el && parseFloat(el.value) > 0) o.ttl = parseFloat(el.value);
    el = document.getElementById('drop-pw');
    if (el && el.value) o.pw = el.value;
    el = document.getElementById('drop-max');
    if (el && parseInt(el.value, 10) > 0) o.max = parseInt(el.value, 10);
    return o;
  }

  function qrSvg(text) {
    try {
      if (typeof qrcode === 'function') {
        var q = qrcode(0, 'M');
        q.addData(text);
        q.make();
        return q.createSvgTag(4, 6);
      }
    } catch (e) { /* fall through */ }
    try {
      if (window.QRCode) {
        var d = document.createElement('div');
        new window.QRCode(d, {
          text: text, width: 168, height: 168,
          correctLevel: window.QRCode.CorrectLevel && window.QRCode.CorrectLevel.M,
        });
        return d.innerHTML;
      }
    } catch (e) { /* no QR lib — degrade silently */ }
    return '';
  }

  // ---------- UI injection ----------

  function injectUi() {
    // CSS: auto-inyectado por si el integrador olvida el <link>.
    if (!document.querySelector('link[href*="feat-drop.css"]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/feat-drop.css';
      document.head.appendChild(link);
    }

    var main = document.querySelector('main.content');
    if (!main || document.getElementById('tab-drop')) return;

    var section = document.createElement('section');
    section.id = 'tab-drop';
    section.className = 'tab-content';
    section.innerHTML =
      '<div class="section-header">' +
        '<h2>Drop</h2>' +
        '<div class="section-actions">' +
          '<span class="last-updated" id="drop-updated"></span>' +
          '<button id="drop-refresh" class="btn-secondary" title="Recargar">' + icon('refresh-cw') + '</button>' +
        '</div>' +
      '</div>' +
      '<p class="listener-note drop-note-top">Pasá archivos y texto entre tus dispositivos y el servidor. ' +
      'Los links públicos viven 24 h por defecto — un link = un archivo, sin login.</p>' +
      '<details class="drop-opts">' +
        '<summary>' + icon('settings-2') + ' Opciones de los links</summary>' +
        '<div class="drop-opts-row">' +
          '<span class="drop-opt"><label class="drop-label" for="drop-ttl">Vencimiento</label>' +
          '<select id="drop-ttl" class="drop-input">' +
            '<option value="1">1 hora</option><option value="6">6 horas</option><option value="24" selected>24 horas</option>' +
            '<option value="72">3 días</option><option value="168">7 días</option>' +
          '</select></span>' +
          '<span class="drop-opt"><label class="drop-label" for="drop-pw">Contraseña</label>' +
          '<input type="password" id="drop-pw" class="drop-input" placeholder="opcional" autocomplete="off"></span>' +
          '<span class="drop-opt"><label class="drop-label" for="drop-max">Máx. descargas</label>' +
          '<input type="number" id="drop-max" class="drop-input drop-max" min="1" max="10000" placeholder="ilimitadas"></span>' +
        '</div>' +
      '</details>' +
      '<div class="drop-grid">' +

        '<div class="card drop-card">' +
          '<div class="drop-card-title">' + icon('upload') + ' Subir → servidor</div>' +
          '<div id="drop-zone" class="drop-zone" role="group" aria-label="Subir archivos al servidor" tabindex="0">' +
            '<div class="drop-zone-inner">' + icon('upload') +
              '<span>Arrastrá archivos acá o <button type="button" class="drop-link" id="drop-browse">elegilos</button></span>' +
              '<small>máx. 50 MB c/u · también podés pegar desde el portapapeles</small>' +
            '</div>' +
          '</div>' +
          '<input type="file" id="drop-file-input" class="hidden" multiple>' +
          '<div class="drop-save">' +
            '<label class="drop-label" for="drop-saveto">Guardar también en el servidor (opcional)</label>' +
            '<input type="text" id="drop-saveto" class="drop-input mono" placeholder="/home/usuario/descargas/ (carpeta) o ruta completa" spellcheck="false">' +
          '</div>' +
          '<div id="drop-upload-out"></div>' +
        '</div>' +

        '<div class="card drop-card">' +
          '<div class="drop-card-title">' + icon('download') + ' Bajar ← servidor</div>' +
          '<label class="drop-label" for="drop-serve-path">Ruta del archivo en el servidor</label>' +
          '<input type="text" id="drop-serve-path" class="drop-input mono" placeholder="/home/usuario/archivo.tar.gz" spellcheck="false">' +
          '<div class="drop-btnrow">' +
            '<button id="drop-serve-btn" class="btn-primary btn-inline">' + icon('link') + ' Generar link</button>' +
          '</div>' +
          '<div id="drop-serve-out"></div>' +
        '</div>' +

        '<div class="card drop-card">' +
          '<div class="drop-card-title">' + icon('clipboard') + ' Texto</div>' +
          '<textarea id="drop-text" class="drop-textarea mono" rows="5" placeholder="Pegá texto acá — comando, URL, snippet…" spellcheck="false"></textarea>' +
          '<div class="drop-btnrow">' +
            '<button id="drop-clip-send" class="btn-action">' + icon('upload') + ' Enviar al servidor</button>' +
            '<button id="drop-text-link" class="btn-action">' + icon('link') + ' Crear link de texto</button>' +
          '</div>' +
          '<div id="drop-text-out"></div>' +
          '<div class="drop-clip">' +
            '<div class="drop-clip-head">' +
              '<span class="drop-label">Clipboard del servidor</span>' +
              '<button id="drop-clip-fetch" class="btn-secondary">' + icon('download') + ' Traer</button>' +
            '</div>' +
            '<pre id="drop-clip-view" class="drop-clip-view mono hidden"></pre>' +
          '</div>' +
        '</div>' +

        '<div class="card drop-card">' +
          '<div class="drop-card-title">' + icon('smartphone') + ' Dispositivos conectados</div>' +
          '<div class="table-wrapper drop-table-wrap">' +
            '<table id="drop-sessions" class="data-table">' +
              '<thead><tr><th>Dispositivo</th><th>Usuario</th><th>Creado</th><th>Último uso</th><th></th></tr></thead>' +
              '<tbody></tbody>' +
            '</table>' +
          '</div>' +
          '<div id="drop-sessions-empty" class="listener-note hidden">Sin sesiones registradas todavía — se registran desde el próximo login.</div>' +
          '<div class="drop-btnrow drop-sessions-actions">' +
            '<button id="drop-revoke-others" class="btn-danger">' + icon('log-out') + ' Cerrar todas las demás</button>' +
            '<button id="drop-sessions-reload" class="btn-secondary" title="Recargar">' + icon('refresh-cw') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="section-header drop-list-header"><h2>Drops recientes</h2></div>' +
      '<div class="table-wrapper">' +
        '<table id="drop-table" class="data-table">' +
          '<thead><tr><th></th><th>Nombre / preview</th><th>Tamaño</th><th>Creado</th><th>Vence</th><th>Acciones</th></tr></thead>' +
          '<tbody></tbody>' +
        '</table>' +
      '</div>' +
      '<div id="drop-empty" class="empty-state hidden">Todavía no hay drops</div>';

    main.appendChild(section);

    // Nav button — solo si el integrador no lo puso en el HTML.
    if (!document.querySelector('.tab-btn[data-tab="drop"]')) {
      var nav = document.createElement('button');
      nav.className = 'nav-item tab-btn';
      nav.dataset.tab = TAB;
      nav.innerHTML = icon('arrow-down-up') + '<span class="nav-label">Drop</span>';
      nav.addEventListener('click', function () {
        $$('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        $$('.tab-content').forEach(function (t) { t.classList.remove('active'); });
        nav.classList.add('active');
        section.classList.add('active');
        try {
          if (typeof activeTabName !== 'undefined' && activeTabName === 'navegador' && typeof unloadBrowser === 'function') unloadBrowser();
        } catch (e) { /* best effort */ }
        try { activeTabName = 'drop'; } catch (e) { /* older app.js */ }
        loadDrop();
      });
      var navEl = document.querySelector('.sidebar-nav');
      var anchor = document.querySelector('.tab-btn[data-tab="navegador"]');
      if (anchor && navEl) anchor.insertAdjacentElement('afterend', nav);
      else if (navEl) navEl.appendChild(nav);
    }
    refreshIcons();
  }

  // ---------- Drop list ----------

  function kindIcon(d) {
    if (d.kind === 'text') return 'type';
    if (d.kind === 'serve') return 'server';
    return 'file';
  }

  function dropTitle(d) {
    if (d.kind === 'text') return (d.preview || '(texto)').replace(/\s+/g, ' ').slice(0, 90);
    return d.name || d.hostPath || '(archivo)';
  }

  function renderDrops(list) {
    var tbody = document.querySelector('#drop-table tbody');
    if (!tbody) return;
    document.getElementById('drop-empty').classList.toggle('hidden', list.length > 0);
    tbody.innerHTML = '';
    list.forEach(function (d) {
      var url = dropUrl(d.id);
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="icon-cell">' + icon(kindIcon(d)) + '</td>' +
        '<td>' + (d['protected'] ? '<span class="drop-lock" title="Con contraseña">' + icon('lock') + '</span>' : '') +
        '<span class="drop-preview" title="' + esc(d.hostPath || d.name || d.preview || '') + '">' + esc(dropTitle(d)) + '</span></td>' +
        '<td class="num">' + (d.size !== undefined ? fmtBytes(d.size) : '-') + '</td>' +
        '<td class="num">' + relTime(d.t) + '</td>' +
        '<td class="num" title="' + esc(new Date(d.expires).toLocaleString('es-AR')) + '">' + esc(fmtExp(d.expires)) + '</td>' +
        '<td><div class="actions">' +
          '<button class="btn-action drop-copy" data-url="' + esc(url) + '" title="Copiar link">' + icon('copy') + '</button>' +
          '<button class="btn-action drop-qrtoggle" title="Mostrar QR">' + icon('qr-code') + '</button>' +
          '<a class="btn-action" href="' + esc(url) + '" target="_blank" rel="noopener" title="Abrir">' + icon('external-link') + '</a>' +
          '<button class="btn-danger drop-del" data-id="' + esc(d.id) + '" title="Eliminar">' + icon('trash-2') + '</button>' +
        '</div></td>';
      var qrTr = document.createElement('tr');
      qrTr.className = 'drop-qr-row hidden';
      qrTr.innerHTML = '<td colspan="6"><div class="drop-qr"></div><div class="drop-url mono">' + esc(url) + '</div></td>';
      tbody.appendChild(tr);
      tbody.appendChild(qrTr);
    });
    refreshIcons();
  }

  async function loadDrops() {
    var data = await api('/api/drop');
    renderDrops(data.drops || []);
  }

  // ---------- Sessions ----------

  function prettyDevice(ua) {
    if (!ua) return 'Dispositivo';
    var os = /windows/i.test(ua) ? 'Windows'
      : /android/i.test(ua) ? 'Android'
      : /iphone|ipad|ipod/i.test(ua) ? 'iOS'
      : /mac os|macintosh/i.test(ua) ? 'macOS'
      : /linux/i.test(ua) ? 'Linux' : '?';
    var br = /edg\//i.test(ua) ? 'Edge'
      : /opr\/|opera/i.test(ua) ? 'Opera'
      : /firefox/i.test(ua) ? 'Firefox'
      : /chrome|crios/i.test(ua) ? 'Chrome'
      : /safari/i.test(ua) ? 'Safari' : 'Navegador';
    return br + (/mobile|android|iphone/i.test(ua) ? ' móvil' : '') + ' · ' + os;
  }

  function renderSessions(list) {
    var tbody = document.querySelector('#drop-sessions tbody');
    if (!tbody) return;
    document.getElementById('drop-sessions-empty').classList.toggle('hidden', list.length > 0);
    tbody.innerHTML = list.map(function (s) {
      var mobile = /mobile|android|iphone|ipad/i.test(s.ua || '');
      var badges = (s.current ? ' <span class="badge badge-node">esta sesión</span>' : '') +
        (s.revoked ? ' <span class="badge badge-other">revocada</span>' : '');
      var revokeBtn = (s.current || s.revoked) ? '' :
        '<button class="btn-danger drop-revoke" data-jti="' + esc(s.jti) + '" title="Cerrar esta sesión">' + icon('log-out') + '</button>';
      return '<tr class="' + (s.current ? 'drop-self' : '') + '">' +
        '<td><span class="drop-device">' + icon(mobile ? 'smartphone' : 'monitor') + ' ' + esc(prettyDevice(s.ua)) + '</span>' + badges + '</td>' +
        '<td>' + esc(s.username || '-') + '</td>' +
        '<td class="num">' + new Date(s.created).toLocaleDateString() + '</td>' +
        '<td class="num">' + relTime(s.lastSeen) + '</td>' +
        '<td>' + revokeBtn + '</td></tr>';
    }).join('');
    refreshIcons();
  }

  async function loadSessions() {
    var data = await api('/api/sessions');
    renderSessions(data.sessions || []);
  }

  async function loadDrop() {
    try {
      var r = await Promise.all([loadDrops(), loadSessions().catch(function () { return null; })]);
      var upd = document.getElementById('drop-updated');
      if (upd) upd.textContent = 'Actualizado ' + new Date().toLocaleTimeString();
    } catch (err) { errToast(err); }
  }

  // ---------- Upload / serve / text / clip ----------

  function showLinkResult(container, url, saved, meta) {
    meta = meta || {};
    var note = meta.deduped ? 'Link reutilizado — ya existía uno activo' : 'Público';
    if (meta.expires) note += ' · vence ' + fmtExp(meta.expires);
    if (meta.pw) note += ' · con contraseña';
    if (meta.max) note += ' · máx. ' + meta.max + ' descarga' + (meta.max === 1 ? '' : 's');
    container.innerHTML =
      '<div class="drop-result">' +
        (saved
          ? '<div class="drop-status ' + (saved.ok ? 'ok' : 'err') + '">' + icon(saved.ok ? 'check' : 'triangle-alert') +
            '<span>' + (saved.ok
              ? 'Guardado en <code class="mono">' + esc(saved.path || '') + '</code>'
              : 'No se pudo guardar en el servidor: ' + esc(saved.error || '')) + '</span></div>'
          : '') +
        '<div class="drop-url mono">' + esc(url) + '</div>' +
        '<div class="drop-btnrow">' +
          '<button class="btn-secondary drop-copy" data-url="' + esc(url) + '">' + icon('copy') + ' Copiar link</button>' +
          '<button class="btn-secondary drop-qrbtn">' + icon('qr-code') + ' QR</button>' +
          '<a class="btn-secondary" href="' + esc(url) + '" target="_blank" rel="noopener">' + icon('external-link') + ' Abrir</a>' +
        '</div>' +
        '<div class="drop-qr hidden"></div>' +
        '<div class="drop-note">' + esc(note) + ' · un link = un archivo</div>' +
      '</div>';
    refreshIcons();
  }

  // XHR porque fetch no reporta progreso de subida.
  function uploadOne(file, idx, total) {
    if (file.size > 50 * 1024 * 1024) {
      toast('«' + file.name + '» supera el máximo de 50 MB', 'warn');
      return Promise.resolve(false);
    }
    var out = document.getElementById('drop-upload-out');
    var label = total > 1 ? ' (' + (idx + 1) + '/' + total + ')' : '';
    out.innerHTML =
      '<div class="drop-status">' + icon('loader-circle') + ' Subiendo ' + esc(file.name) +
      ' (' + fmtBytes(file.size) + ')' + label + ' — <span class="drop-pct">0%</span></div>' +
      '<div class="drop-prog"><span class="drop-prog-fill"></span></div>';
    refreshIcons();
    var fill = out.querySelector('.drop-prog-fill');
    var pct = out.querySelector('.drop-pct');
    var fd = new FormData();
    fd.append('file', file);
    var o = linkOpts();
    if (o.ttl) fd.append('ttl', String(o.ttl));
    if (o.pw) fd.append('pw', o.pw);
    if (o.max) fd.append('max', String(o.max));
    var saveTo = document.getElementById('drop-saveto').value.trim();
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/drop/file' + (saveTo ? '?saveTo=' + encodeURIComponent(saveTo) : ''));
      xhr.withCredentials = true;
      xhr.timeout = 120000;
      xhr.upload.onprogress = function (e) {
        if (!e.lengthComputable || !e.total) return;
        var p = Math.min(100, Math.round((e.loaded / e.total) * 100));
        if (fill) fill.style.width = p + '%';
        if (pct) pct.textContent = p + '%';
      };
      xhr.onload = function () {
        var data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { /* respuesta no-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) {
          showLinkResult(out, data.url || dropUrl(data.id), data.saved, {
            pw: o.pw, max: o.max, expires: data.expires, deduped: data.deduped,
          });
          resolve(true);
        } else {
          out.innerHTML = '';
          errToast(new Error(data.error || 'HTTP ' + xhr.status));
          resolve(false);
        }
      };
      xhr.onerror = xhr.ontimeout = function () {
        out.innerHTML = '';
        errToast(new Error('La subida falló — revisá la conexión con el servidor'));
        resolve(false);
      };
      xhr.send(fd);
    });
  }

  async function uploadFiles(list) {
    var files = Array.prototype.slice.call(list || []).filter(Boolean);
    if (!files.length) return;
    var ok = 0;
    for (var i = 0; i < files.length; i++) {
      if (await uploadOne(files[i], i, files.length)) ok++;
    }
    if (ok) toast(ok === 1 ? 'Archivo subido' : ok + ' archivos subidos', 'ok', '', 2500);
    loadDrops().catch(function () {});
  }

  async function createServe() {
    var input = document.getElementById('drop-serve-path');
    var p = input.value.trim();
    if (!p) { toast('Escribí la ruta del archivo en el servidor', 'warn'); return; }
    var out = document.getElementById('drop-serve-out');
    try {
      var o = linkOpts();
      var data = await api('/api/drop/serve', { method: 'POST', body: { path: p, ttl: o.ttl, pw: o.pw, max: o.max } });
      showLinkResult(out, data.url || dropUrl(data.id), undefined, {
        pw: o.pw, max: o.max, expires: data.expires, deduped: data.deduped,
      });
      toast(data.deduped ? 'Link reutilizado — ya existía uno activo' : 'Link generado — ' + (data.name || 'archivo'), 'ok', '', 2500);
      loadDrops().catch(function () {});
    } catch (err) {
      out.innerHTML = '';
      errToast(err);
    }
  }

  async function sendClip() {
    var text = document.getElementById('drop-text').value;
    if (!text.trim()) { toast('Escribí algo primero', 'warn'); return; }
    try {
      await api('/api/drop/clip', { method: 'POST', body: { text: text } });
      toast('Texto enviado al servidor — ya podés pegarlo allá con "Traer"', 'ok');
    } catch (err) { errToast(err); }
  }

  async function fetchClip() {
    try {
      var data = await api('/api/drop/clip');
      var view = document.getElementById('drop-clip-view');
      view.textContent = data.text || '(vacío)';
      view.classList.remove('hidden');
      if (data.text) {
        var copied = await navigator.clipboard.writeText(data.text).then(function () { return true; }, function () { return false; });
        toast(copied ? 'Clipboard del servidor traído y copiado' : 'Traído — copialo a mano (el navegador bloqueó el portapapeles)', copied ? 'ok' : 'warn', '', 2500);
      }
    } catch (err) { errToast(err); }
  }

  async function createTextLink() {
    var text = document.getElementById('drop-text').value;
    if (!text.trim()) { toast('Escribí algo primero', 'warn'); return; }
    var out = document.getElementById('drop-text-out');
    try {
      var o = linkOpts();
      var data = await api('/api/drop/text', { method: 'POST', body: { text: text, ttl: o.ttl, pw: o.pw, max: o.max } });
      showLinkResult(out, data.url || dropUrl(data.id), undefined, {
        pw: o.pw, max: o.max, expires: data.expires, deduped: data.deduped,
      });
      toast('Link de texto creado', 'ok', '', 2500);
      loadDrops().catch(function () {});
    } catch (err) {
      out.innerHTML = '';
      errToast(err);
    }
  }

  // ---------- Wiring ----------

  function wire() {
    var zone = document.getElementById('drop-zone');
    var input = document.getElementById('drop-file-input');

    document.getElementById('drop-browse').addEventListener('click', function (e) {
      e.stopPropagation();
      input.click();
    });
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () {
      uploadFiles(input.files);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('drop-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('drop-over'); });
    });
    zone.addEventListener('drop', function (e) {
      uploadFiles(e.dataTransfer && e.dataTransfer.files);
    });

    // Pegar un archivo copiado (captura de pantalla, archivo del gestor) con
    // la sección visible lo sube directo.
    document.addEventListener('paste', function (e) {
      var tab = document.getElementById('tab-drop');
      if (!tab || !tab.classList.contains('active')) return;
      var files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) { e.preventDefault(); uploadFiles(files); }
    });

    document.getElementById('drop-serve-btn').addEventListener('click', createServe);
    document.getElementById('drop-serve-path').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') createServe();
    });
    document.getElementById('drop-clip-send').addEventListener('click', sendClip);
    document.getElementById('drop-clip-fetch').addEventListener('click', fetchClip);
    document.getElementById('drop-text-link').addEventListener('click', createTextLink);
    document.getElementById('drop-refresh').addEventListener('click', loadDrop);
    document.getElementById('drop-sessions-reload').addEventListener('click', function () {
      loadSessions().catch(errToast);
    });

    document.getElementById('drop-revoke-others').addEventListener('click', async function () {
      var ok = await confirmDialog(
        'Cerrar las demás sesiones',
        'Todos los demás dispositivos van a tener que volver a iniciar sesión.',
        'Cerrar sesiones'
      );
      if (!ok) return;
      try {
        var res = await api('/api/sessions/revoke-others', { method: 'POST' });
        toast(res.revoked + ' sesión(es) cerrada(s)', 'ok');
        loadSessions().catch(function () {});
      } catch (err) { errToast(err); }
    });

    // Delegación: copiar / QR / eliminar / revocar.
    document.getElementById('tab-drop').addEventListener('click', async function (e) {
      var copyBtn = e.target.closest('.drop-copy');
      if (copyBtn) {
        var copied = await navigator.clipboard.writeText(copyBtn.dataset.url).then(function () { return true; }, function () { return false; });
        if (copied) toast('Link copiado', 'ok', '', 2000);
        else toast('No se pudo copiar — seleccioná el link y copialo a mano', 'warn');
        return;
      }
      var qrBtn = e.target.closest('.drop-qrbtn');
      if (qrBtn) {
        var box = qrBtn.closest('.drop-result').querySelector('.drop-qr');
        box.classList.toggle('hidden');
        if (!box.classList.contains('hidden') && !box.innerHTML) {
          box.innerHTML = qrSvg(qrBtn.closest('.drop-result').querySelector('.drop-url').textContent.trim());
        }
        return;
      }
      var qrTgl = e.target.closest('.drop-qrtoggle');
      if (qrTgl) {
        var row = qrTgl.closest('tr').nextElementSibling;
        if (row && row.classList.contains('drop-qr-row')) {
          row.classList.toggle('hidden');
          var q = row.querySelector('.drop-qr');
          if (!row.classList.contains('hidden') && q && !q.innerHTML) {
            q.innerHTML = qrSvg(row.querySelector('.drop-url').textContent.trim());
          }
        }
        return;
      }
      var delBtn = e.target.closest('.drop-del');
      if (delBtn) {
        var okDel = await confirmDialog('Eliminar drop', 'El link deja de funcionar y el archivo se borra del servidor.');
        if (!okDel) return;
        try {
          await api('/api/drop/' + delBtn.dataset.id, { method: 'DELETE' });
          toast('Drop eliminado', 'ok', '', 2000);
          loadDrops().catch(function () {});
        } catch (err) { errToast(err); }
        return;
      }
      var revBtn = e.target.closest('.drop-revoke');
      if (revBtn) {
        var okRev = await confirmDialog('Cerrar sesión', 'Ese dispositivo va a tener que volver a iniciar sesión.', 'Cerrar sesión');
        if (!okRev) return;
        try {
          await api('/api/sessions/' + encodeURIComponent(revBtn.dataset.jti) + '/revoke', { method: 'POST' });
          toast('Sesión cerrada', 'ok', '', 2000);
          loadSessions().catch(function () {});
        } catch (err) { errToast(err); }
      }
    });
  }

  function init() {
    injectUi();
    if (document.getElementById('tab-drop')) {
      wire();
      // Integración con el tab-switcher de app.js por si el integrador agregó
      // el botón en el HTML en vez del inyectado.
      try { loaders.drop = loadDrop; } catch (e) { /* app.js viejo sin loaders */ }
      try { window.AxonPages = window.AxonPages || {}; window.AxonPages.drop = { restore: loadDrop }; } catch (e) { /* sin navegación por secciones */ }
      // Auto-refresh suave mientras la sección está visible.
      setInterval(function () {
        try {
          var main = document.getElementById('main-screen');
          if (typeof activeTabName !== 'undefined' && activeTabName === 'drop' && main && !main.classList.contains('hidden') &&
              !document.hidden && !document.querySelector('.modal:not(.hidden)')) loadDrop();
        } catch (e) { /* best effort */ }
      }, 30000);
      refreshIcons();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
