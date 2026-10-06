/* AXON — primer arranque: asistente de configuración + lista "Primeros pasos".
   Corre antes del login (script defer como login.js): cuando la instalación
   es nueva, el instalador imprime un enlace ?setup=… que abre el paso de
   creación de cuenta; después el wizard sigue ya autenticado. Instalaciones
   antiguas no tienen onboarding.json y esta pantalla nunca aparece. */
(() => {
  'use strict';

  const urlToken = new URLSearchParams(location.search).get('setup') || '';
  const STEP_LABELS = { welcome: 'Bienvenida', account: 'Tu cuenta', detect: 'Tu servidor', prefs: 'A tu gusto', done: 'Listo' };

  const ITEM_META = {
    account: { icon: 'key-round', label: 'Cuenta de administrador lista' },
    projects: { icon: 'folder-git-2', label: 'Detectar tus proyectos', hint: 'AXON busca package.json, pyproject y más en tus carpetas', href: '/proyectos' },
    domain: { icon: 'globe', label: 'Conectar un dominio', hint: 'Publicá tus proyectos con HTTPS o importá desde Cloudflare', href: '/dominios' },
    backup: { icon: 'archive', label: 'Crear tu primer backup', hint: 'Unos pocos pasos y tus carpetas tienen su copia', href: '/backups' },
    twofa: { icon: 'shield-check', label: 'Activar verificación en dos pasos', hint: 'Un código extra protege cada ingreso', href: '/configuracion?section=security' },
    explore: { icon: 'store', label: 'Explorar la Tienda', hint: 'Aplicaciones instalables en un click', href: '/tienda', manual: true },
  };

  let statusPromise = null;
  let wiz = null;
  let checklistEl = null;

  function status() {
    statusPromise ||= api('/api/onboarding/status').catch(() => ({ ok: false, step: 'legacy', pending: false }));
    return statusPromise;
  }

  function shell() {
    let el = document.getElementById('onboarding-screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'onboarding-screen';
      el.className = 'onb-screen hidden';
      document.getElementById('app').append(el);
    }
    return el;
  }

  function showLogin() {
    shell().classList.add('hidden');
    document.getElementById('boot-screen')?.classList.add('hidden');
    document.getElementById('login-screen')?.classList.remove('hidden');
  }

  function finish() {
    history.replaceState(null, '', '/');
    location.reload();
  }

  function extractToken(raw) {
    const text = String(raw || '').trim();
    const viaUrl = text.match(/[?&]setup=([A-Za-z0-9_-]+)/);
    return viaUrl ? viaUrl[1] : text;
  }

  function passwordHint(pw) {
    if (!pw) return 'Mínimo 8 caracteres.';
    if (pw.length < 8) return 'Corta — mínimo 8 caracteres.';
    const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(pw)).length;
    if (pw.length >= 16 || (pw.length >= 12 && variety >= 3)) return 'Fuerte.';
    if (pw.length >= 8 && variety >= 2) return 'Correcta — más larga y variada es mejor.';
    return 'Débil — mezclá mayúsculas, números o símbolos.';
  }

  // ---------- Wizard ----------

  function openWizard(mode) {
    const steps = mode === 'setup'
      ? ['welcome', 'account', 'detect', 'prefs', 'done']
      : ['welcome', 'detect', 'prefs', 'done'];
    wiz = { mode, steps, step: 0, token: urlToken, probe: undefined };
    shell().classList.remove('hidden');
    render();
  }

  function bodyFor(step) {
    if (step === 'welcome') {
      return `<div class="onb-hero" aria-hidden="true"><img src="/marca/Isotipo.svg" alt=""></div>
        <h2 id="onb-title">Bienvenido a AXON</h2>
        <p class="onb-lead">Tu servidor, tu espacio. En un par de minutos queda listo: ${wiz.mode === 'setup' ? 'tu cuenta, ' : ''}lo que AXON ya encontró y tus preferencias.</p>`;
    }
    if (step === 'account') {
      return `<h2 id="onb-title">Creá tu cuenta</h2>
        <p class="onb-lead">La cuenta vive en tu servidor — no hay recuperación por mail. Guardala en un lugar seguro.</p>
        ${wiz.token ? '' : `<label for="onb-token">Código de configuración<input id="onb-token" data-autofocus autocomplete="off" spellcheck="false" placeholder="Pegá el enlace o el código del instalador"><small class="onb-hint">El instalador imprimió un enlace con <code>?setup=…</code> al terminar — podés pegarlo entero.</small></label>`}
        <label for="onb-user">Usuario<input id="onb-user" value="admin" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
        <label for="onb-pass">Contraseña<div class="password-field"><input type="password" id="onb-pass" ${wiz.token ? 'data-autofocus' : ''} autocomplete="new-password"><button type="button" id="onb-pass-toggle" class="icon-btn" aria-label="Mostrar contraseña"><i data-lucide="eye"></i></button></div><small class="onb-hint" id="onb-strength">Mínimo 8 caracteres.</small></label>
        <label for="onb-pass2">Confirmar contraseña<input type="password" id="onb-pass2" autocomplete="new-password"></label>
        <p class="onb-note">${icon('shield-check')} Después podés activar la verificación en dos pasos desde Configuración.</p>`;
    }
    if (step === 'detect') {
      if (wiz.probe === undefined) {
        return `<h2 id="onb-title">Mirando tu servidor</h2><p class="onb-lead">AXON ya está revisando qué hay instalado.</p>
          <div class="onb-scan" role="status">${['Docker', 'Proyectos', 'Discos', 'Recursos'].map((n) => `<div class="onb-scan-row"><span class="onb-scan-dot"></span>${n}<span class="onb-scan-wait">detectando…</span></div>`).join('')}</div>`;
      }
      const p = wiz.probe || {};
      const rows = [];
      rows.push(p.docker?.available
        ? { icon: 'container', ok: true, label: `Docker ${p.docker.version || ''}`.trim(), detail: p.docker.running ? `${p.docker.running} contenedor${p.docker.running === 1 ? '' : 'es'} corriendo` : 'sin contenedores corriendo todavía' }
        : { icon: 'container', ok: false, label: 'Docker no responde', detail: 'Se vuelve a consultar en la sección Docker' });
      rows.push(p.projects?.count
        ? { icon: 'folder-git-2', ok: true, label: `${p.projects.count} proyecto${p.projects.count === 1 ? '' : 's'} en tu servidor`, detail: p.projects.sample.map((s) => s.name).join(', ') }
        : { icon: 'folder-git-2', ok: null, label: 'Sin proyectos detectados', detail: 'El botón Detectar de Proyectos vuelve a buscarlos' });
      const disks = (p.disks || []).filter((d) => d.available != null);
      rows.push(disks.length
        ? { icon: 'hard-drive', ok: true, label: `${disks.length} disco${disks.length === 1 ? '' : 's'} disponible${disks.length === 1 ? '' : 's'}`, detail: disks.map((d) => `${d.name} · ${fmtGb(d.available)} libres`).join(' · ') }
        : { icon: 'hard-drive', ok: null, label: 'Discos sin relevar', detail: 'Almacenamiento los lista cuando los necesites' });
      if (p.memoryTotalMb) rows.push({ icon: 'cpu', ok: true, label: `${Math.round(p.memoryTotalMb / 1024)} GB de memoria`, detail: `usuario del servidor: ${esc(p.hostUser || '')}` });
      return `<h2 id="onb-title">Esto ya encontró AXON</h2><p class="onb-lead">Sin tocar nada, ya ve lo que corre en tu servidor.</p>
        <div class="onb-scan">${rows.map((r) => `<div class="onb-scan-row">${icon(r.ok === true ? 'circle-check' : r.ok === false ? 'circle-alert' : 'minus-circle', r.ok === true ? 'onb-ok' : r.ok === false ? 'onb-bad' : 'onb-mid')}<div><b>${esc(r.label)}</b><small>${esc(r.detail)}</small></div></div>`).join('')}</div>`;
    }
    if (step === 'prefs') {
      const mode = window.AxonThemes?.current()?.mode || 'system';
      return `<h2 id="onb-title">Dejalo a tu gusto</h2><p class="onb-lead">Elegí el modo de color. Hay 20 temas completos en Configuración → Apariencia.</p>
        <div class="appearance-modes onb-modes" role="group" aria-label="Modo de color">
          <button type="button" data-onb-mode="light" aria-pressed="${mode === 'light'}">${icon('sun')} Claro</button>
          <button type="button" data-onb-mode="dark" aria-pressed="${mode === 'dark'}">${icon('moon')} Oscuro</button>
          <button type="button" data-onb-mode="system" aria-pressed="${mode === 'system'}">${icon('monitor')} Sistema</button>
        </div>`;
    }
    return `<div class="onb-hero onb-hero-done" aria-hidden="true">${icon('circle-check')}</div>
      <h2 id="onb-title">Todo listo</h2>
      <p class="onb-lead">${wiz.mode === 'setup' ? 'Cuenta creada y servidor relevado. ' : ''}Te dejamos una lista de primeros pasos en Inicio — desaparece sola cuando la completes.</p>`;
  }

  function footFor(step) {
    if (step === 'welcome') {
      const alt = wiz.mode === 'setup'
        ? '<button type="button" class="btn-secondary" data-login>Ya tengo mi contraseña</button>'
        : '<button type="button" class="btn-secondary" data-skip>Saltar la configuración</button>';
      return `${alt}<button type="button" class="btn-primary" data-next>Comenzar ${icon('arrow-right')}</button>`;
    }
    if (step === 'account') return `<button type="button" class="btn-secondary" data-prev>Anterior</button><button type="button" class="btn-primary" data-account>Crear cuenta ${icon('arrow-right')}</button>`;
    if (step === 'done') return `<button type="button" class="btn-primary" data-finish>Entrar a AXON ${icon('arrow-right')}</button>`;
    return `<button type="button" class="btn-secondary" data-skip>Omitir</button><button type="button" class="btn-primary" data-next>Continuar ${icon('arrow-right')}</button>`;
  }

  function fmtGb(bytes) {
    const gb = bytes / 2 ** 30;
    return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(gb)} GB`;
  }

  function error(msg) {
    const el = shell().querySelector('#onb-error');
    if (el) el.textContent = msg || '';
  }

  async function submitAccount(btn) {
    const token = wiz.token || extractToken(shell().querySelector('#onb-token')?.value);
    const username = shell().querySelector('#onb-user')?.value.trim() || 'admin';
    const pass = shell().querySelector('#onb-pass')?.value || '';
    const pass2 = shell().querySelector('#onb-pass2')?.value || '';
    if (!token) return error('Necesitás el enlace o código que imprimió el instalador.');
    if (pass.length < 8) return error('La contraseña necesita al menos 8 caracteres.');
    if (pass !== pass2) return error('Las contraseñas no coinciden.');
    btn.disabled = true;
    btn.innerHTML = `Creando cuenta… ${icon('loader-circle')}`;
    try {
      await api('/api/onboarding/setup', { method: 'POST', body: { token, username, password: pass } });
      wiz.step++;
      render();
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `Crear cuenta ${icon('arrow-right')}`;
      error(err.message);
      refreshIcons();
    }
  }

  function runProbe() {
    if (wiz.probe !== undefined) return;
    wiz.probe = undefined;
    api('/api/onboarding/probe')
      .then((res) => { wiz.probe = res.probe || {}; })
      .catch(() => { wiz.probe = {}; })
      .finally(() => { if (wiz && wiz.steps[wiz.step] === 'detect') render(); });
  }

  function bind(step, el) {
    el.querySelector('[data-next]')?.addEventListener('click', () => {
      wiz.step++;
      if (wiz.steps[wiz.step] === 'detect') runProbe();
      render();
    });
    el.querySelector('[data-prev]')?.addEventListener('click', () => { wiz.step--; render(); });
    el.querySelector('[data-login]')?.addEventListener('click', showLogin);
    el.querySelector('[data-account]')?.addEventListener('click', (e) => submitAccount(e.currentTarget));
    el.querySelector('[data-skip]')?.addEventListener('click', async () => {
      await api('/api/onboarding/complete', { method: 'POST' }).catch(() => {});
      finish();
    });
    el.querySelector('[data-finish]')?.addEventListener('click', async () => {
      await api('/api/onboarding/complete', { method: 'POST' }).catch(() => {});
      finish();
    });
    if (step === 'account') {
      const pw = el.querySelector('#onb-pass'), hint = el.querySelector('#onb-strength');
      pw?.addEventListener('input', () => { hint.textContent = passwordHint(pw.value); });
      el.querySelector('#onb-pass-toggle')?.addEventListener('click', (e) => {
        const visible = pw.type === 'password';
        pw.type = visible ? 'text' : 'password';
        e.currentTarget.innerHTML = `<i data-lucide="${visible ? 'eye-off' : 'eye'}"></i>`;
        refreshIcons();
      });
      el.querySelector('#onb-token')?.addEventListener('input', (e) => { e.target.value = extractToken(e.target.value) || e.target.value; });
      el.querySelector('#onb-pass2')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.querySelector('[data-account]')?.click(); });
    }
    if (step === 'prefs') {
      el.querySelectorAll('[data-onb-mode]').forEach((b) => b.addEventListener('click', () => {
        window.AxonThemes?.setMode(b.dataset.onbMode);
        el.querySelectorAll('[data-onb-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }));
    }
  }

  function render() {
    const el = shell();
    const step = wiz.steps[wiz.step];
    el.innerHTML = `<div class="onb-card" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <header class="onb-head"><img src="/marca/isologotipo.svg" alt="AXON" class="onb-logo"><span class="onb-pos">Paso ${wiz.step + 1} de ${wiz.steps.length}</span></header>
      <ol class="onb-dots" aria-hidden="true">${wiz.steps.map((s, i) => `<li class="${i < wiz.step ? 'is-done' : ''} ${i === wiz.step ? 'is-now' : ''}" title="${esc(STEP_LABELS[s])}"></li>`).join('')}</ol>
      <div class="onb-body">${bodyFor(step)}</div>
      <p class="onb-error" id="onb-error" role="alert" aria-live="polite"></p>
      <footer class="onb-foot">${footFor(step)}</footer>
    </div>`;
    bind(step, el);
    refreshIcons();
    el.querySelector('[data-autofocus]')?.focus();
  }

  // ---------- Checklist "Primeros pasos" ----------

  async function refreshChecklist() {
    const st = await api('/api/onboarding/state').catch(() => null);
    if (!st?.ok || !st.items?.length || st.dismissed || st.items.every((i) => i.done)) {
      checklistEl?.remove();
      checklistEl = null;
      return;
    }
    const anchor = document.querySelector('#tab-dashboard .home-quick');
    if (!anchor) return;
    if (!checklistEl) {
      checklistEl = document.createElement('section');
      checklistEl.className = 'onb-checklist';
      checklistEl.setAttribute('aria-label', 'Primeros pasos');
      anchor.after(checklistEl);
    }
    const done = st.items.filter((i) => i.done).length;
    checklistEl.innerHTML = `<header class="onb-check-head"><div><h2>Primeros pasos</h2><p>${done} de ${st.items.length} listos</p></div><button type="button" class="onb-dismiss" data-dismiss title="Ya conozco el panel">${icon('x')}<span class="onb-dismiss-label">Ocultar</span></button></header>
      <div class="onb-check-bar" aria-hidden="true"><i style="width:${Math.round((done / st.items.length) * 100)}%"></i></div>
      <ol class="onb-check-items">${st.items.map((i) => {
        const m = ITEM_META[i.id] || { icon: 'circle', label: i.id };
        const inner = `${icon(i.done ? 'circle-check' : m.icon, i.done ? 'onb-ok' : '')}<span class="onb-item-text"><b>${esc(m.label)}</b>${m.hint ? `<small>${esc(m.hint)}</small>` : ''}</span>${m.href && !i.done ? icon('arrow-right') : ''}`;
        return `<li class="${i.done ? 'is-done' : ''}">${m.href ? `<a href="${esc(m.href)}" data-item="${esc(i.id)}">${inner}</a>` : `<span class="onb-item-static">${inner}</span>`}</li>`;
      }).join('')}</ol>`;
    refreshIcons();
    checklistEl.querySelector('[data-dismiss]').addEventListener('click', async () => {
      await api('/api/onboarding/dismiss', { method: 'POST' }).catch(() => {});
      checklistEl.remove();
      checklistEl = null;
    });
    checklistEl.querySelectorAll('a[data-item]').forEach((a) => a.addEventListener('click', () => {
      const meta = ITEM_META[a.dataset.item];
      if (meta?.manual) api('/api/onboarding/check', { method: 'POST', body: { id: a.dataset.item } }).catch(() => {});
    }));
  }

  // ---------- Boot integration ----------

  async function start() {
    const st = await status();
    if (st.step !== 'setup') {
      if (urlToken) history.replaceState(null, '', '/'); // consumed/stale link — keep it out of history
      return false;
    }
    openWizard('setup');
    document.getElementById('boot-screen')?.classList.add('hidden');
    return true;
  }

  document.addEventListener('axon:authenticated', async () => {
    const st = await api('/api/onboarding/state').catch(() => null);
    // Pending setup/wizard survives a direct login (e.g. initial password file)
    // — finish the guided part first, without the account step.
    if (st?.ok && !st.dismissed && (st.step === 'setup' || st.step === 'wizard')) {
      openWizard('wizard');
      return;
    }
    refreshChecklist();
  });
  document.addEventListener('axon:section', (e) => {
    if (e.detail === 'dashboard') refreshChecklist();
  });

  window.AxonOnboarding = { start, showLogin };
})();
