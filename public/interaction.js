/* Axon's shared interaction primitives. No network activity before sign-in. */
(() => {
  'use strict';
  let source = null;
  const busy = new WeakMap();
  // crypto.randomUUID is secure-context only; plain-HTTP LAN deploys need a fallback.
  const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  function track(button) {
    if (!button) return () => {};
    let state = busy.get(button);
    if (!state) {
      state = { count: 0, disabled: button.disabled };
      busy.set(button, state);
    }
    state.count++;
    button.disabled = true;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    return () => {
      if (--state.count) return;
      button.disabled = state.disabled;
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
      busy.delete(button);
    };
  }
  document.addEventListener('click', e => {
    source = e.target.closest('button,wa-button');
    const button = source;
    setTimeout(() => { if (source === button) source = null; }, 0);
  }, true);
  document.addEventListener('submit', e => {
    source = e.submitter || e.target.querySelector('button[type=submit]');
    const button = source;
    setTimeout(() => { if (source === button) source = null; }, 0);
  }, true);
  const client = AxonRequestClient.create({
    onStart: (path, opts) => {
      const done = track(opts.busy || source);
      document.dispatchEvent(new CustomEvent('axon:request-start', { detail: { path } }));
      return () => { done(); document.dispatchEvent(new CustomEvent('axon:request-end', { detail: { path } })); };
    },
    onError: (path,error) => document.dispatchEvent(new CustomEvent('axon:request-error',{detail:{path,error}})),
    onAuth: () => document.dispatchEvent(new Event('axon:session-expired')),
  });
  window.AxonUI = {
    skeleton(label='Cargando datos', rows=4) {
      return `<div class="loading-shell" role="status" aria-label="${String(label).replace(/[&<>"']/g, '')}" aria-busy="true">${'<wa-skeleton effect="sheen"></wa-skeleton>'.repeat(Math.max(1,Math.min(8,rows)))}</div>`;
    },
    request: client.request,
    invalidate: client.invalidate,
    async busy(button, work) { const done = track(button); try { return await work(); } finally { done(); } },
  };

  // Retrofitted dialogs keep their existing cancel logic (including promise resolution).
  const stack = [], states = new WeakMap();
  const candidates = '.modal:not(.hidden)';
  const focusables = el => [...el.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
    .filter(n => !n.disabled && !n.hidden && n.tabIndex >= 0 && n.getClientRects().length);
  function cancel(modal) {
    const controls = [...modal.querySelectorAll('button')].filter(b => !b.classList.contains('dialog-close'));
    const button = controls.find(b => /^(cancelar|cerrar|listo|volver|seguir editando)$/i.test(b.textContent.trim()))
      || modal.querySelector('[data-close], .ag-drawer-close, [id$="-cancel"], [id$="-close"]');
    if (button) button.click();
    else modal.dispatchEvent(new Event('axon:dialog-cancel'));
  }
  let queued = false;
  function sync() {
    queued = false;
    for (const modal of [...stack]) {
      if (!modal.isConnected || modal.classList.contains('hidden') || !modal.matches('.modal')) {
        stack.splice(stack.indexOf(modal), 1);
        const state = states.get(modal);
        states.delete(modal);
        if (state?.focus?.isConnected) state.focus.focus({ preventScroll: true });
      }
    }
    document.querySelectorAll(candidates).forEach(modal => {
      const content = modal.querySelector('.modal-content');
      if (!content) return;
      if (!content.querySelector(':scope > .dialog-close')) {
        const close = document.createElement('button');
        close.type = 'button'; close.className = 'dialog-close icon-btn';
        close.setAttribute('aria-label', 'Cerrar diálogo'); close.textContent = '×';
        close.addEventListener('click', () => cancel(modal));
        content.prepend(close);
      }
      if (states.has(modal)) return;
      states.set(modal, { focus: document.activeElement });
      stack.push(modal);
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
      const title = content.querySelector('h3');
      if (title) {
        title.id ||= `dialog-title-${uid()}`;
        modal.setAttribute('aria-labelledby', title.id);
      }
      modal.style.zIndex = String(1100 + stack.length);
      content.scrollTop = 0;
      queueMicrotask(() => {
        if (stack.at(-1) === modal && !modal.contains(document.activeElement)) {
          (content.querySelector('input:not([readonly]), textarea, [autofocus]') || focusables(content).find(b=>!b.classList.contains('dialog-close')) || content).focus();
        }
      });
    });
    document.body.classList.toggle('has-dialog', stack.length > 0);
  }
  const observer = new MutationObserver(records => {
    const relevant = records.some(r => states.has(r.target) || r.target.closest?.('.modal') || [...r.addedNodes].some(n=>n.nodeType===1 && (n.matches?.('.modal') || n.querySelector?.('.modal'))) || [...r.removedNodes].some(n=>n.nodeType===1 && (states.has(n) || n.querySelector?.('.modal'))));
    if (!relevant) return;
    if (queued) return; queued = true; queueMicrotask(sync);
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', e => {
    const modal = stack.at(-1);
    if (!modal || document.querySelector('wa-dialog[open]')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(modal); }
    if (e.key === 'Tab') {
      const els = focusables(modal), first = els[0], last = els.at(-1);
      if (!first) { e.preventDefault(); return; }
      if (!modal.contains(document.activeElement) || (!e.shiftKey && document.activeElement === last)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    }
  }, true);
  document.addEventListener('mousedown', e => {
    if (e.target === stack.at(-1)) { e.preventDefault(); e.stopImmediatePropagation(); cancel(e.target); }
  }, true);
  document.addEventListener('focusin', e => {
    const modal = stack.at(-1);
    if (modal && !document.querySelector('wa-dialog[open]') && !modal.contains(e.target)) focusables(modal)[0]?.focus();
  });
})();
