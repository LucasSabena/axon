/* AXON — context menu: sections, submenus, shortcut hints, quick-action row and full keyboard control.
 * Backward compatible with the original showCtxMenu(items, x, y) contract:
 *   { icon, label, run, danger }  ·  { sep: true }
 * Additions: { header }, { kbd }, { disabled }, { checked }, { hint }, { children: [...] },
 *            { row: [{ icon, label, run, danger, disabled, kbd }] }  (icon-only quick actions)
 */
(() => {
  'use strict';
  const rootEl = () => document.getElementById('ctx-menu');
  const clean = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (name) => (name && typeof icon === 'function' ? icon(name) : '');

  let stack = [];          // open menus, root first
  let returnFocus = null;
  let hoverTimer = 0;
  let typed = '', typedTimer = 0;
  let openedAt = 0;

  const itemsOf = (menu) => [...menu.querySelectorAll(':scope > .ctx-item:not([disabled]), :scope > .ctx-quick > .ctx-qbtn:not([disabled])')];
  const top = () => stack[stack.length - 1];
  const isOpen = () => stack.length > 0;

  function build(items, menu) {
    menu.replaceChildren();
    menu.setAttribute('role', 'menu');
    menu.tabIndex = -1;
    menu._items = [];
    let html = '';
    let pendingSep = false;
    let any = false;
    const flat = (items || []).filter(Boolean);
    flat.forEach((it, i) => {
      if (it.sep) { pendingSep = any; return; }
      if (pendingSep) { html += '<div class="ctx-sep" role="separator"></div>'; pendingSep = false; }
      any = true;
      menu._items[i] = it;
      if (it.header) { html += `<div class="ctx-header" role="presentation">${clean(it.header)}</div>`; return; }
      if (it.row) {
        html += `<div class="ctx-quick" role="group">${it.row.map((q, j) => {
          menu._items[`${i}.${j}`] = q;
          const label = q.kbd ? `${q.label} (${q.kbd})` : q.label;
          return `<button type="button" class="ctx-qbtn${q.danger ? ' ctx-danger' : ''}" role="menuitem" tabindex="-1" data-i="${i}.${j}" aria-label="${clean(label)}" title="${clean(label)}"${q.disabled ? ' disabled' : ''}>${ic(q.icon)}<span>${clean(q.short || q.label)}</span></button>`;
        }).join('')}</div>`;
        return;
      }
      const role = it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem';
      const sub = Array.isArray(it.children) && it.children.length;
      html += `<button type="button" class="ctx-item${it.danger ? ' ctx-danger' : ''}${it.checked ? ' is-checked' : ''}" role="${role}" tabindex="-1" data-i="${i}"${it.checked !== undefined ? ` aria-checked="${Boolean(it.checked)}"` : ''}${sub ? ' aria-haspopup="menu" aria-expanded="false"' : ''}${it.disabled ? ' disabled' : ''}${it.hint ? ` title="${clean(it.hint)}"` : ''}>`
        + `<span class="ctx-ic">${ic(it.icon)}</span>`
        + `<span class="ctx-label">${clean(it.label)}</span>`
        + (it.kbd ? `<kbd class="ctx-kbd">${clean(it.kbd)}</kbd>` : '')
        + (it.checked !== undefined ? `<span class="ctx-tick">${it.checked ? ic('check') : ''}</span>` : '')
        + (sub ? `<span class="ctx-chev">${ic('chevron-right')}</span>` : '')
        + `</button>`;
    });
    menu.innerHTML = html;
    if (typeof refreshIcons === 'function') refreshIcons(menu);
  }

  function place(menu, x, y, anchorRect, below) {
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.classList.remove('hidden');
    const pad = 8;
    const { width, height } = menu.getBoundingClientRect();
    let left = x, topPos = y;
    if (below) {
      // Menu opened from a button: hang under it, or sit above when the screen ends first.
      left = below.left;
      topPos = below.bottom + 4;
      if (topPos + height > innerHeight - pad) topPos = below.top - height - 4;
      if (left + width > innerWidth - pad) left = below.right - width;
    } else if (anchorRect) {
      // Submenu: prefer the right side of its parent, flip when there is no room.
      left = anchorRect.right - 4;
      if (left + width > innerWidth - pad) left = Math.max(pad, anchorRect.left - width + 4);
      topPos = anchorRect.top - 5;
    } else if (left + width > innerWidth - pad) left = Math.max(pad, left - width);
    if (topPos + height > innerHeight - pad) topPos = Math.max(pad, anchorRect ? innerHeight - height - pad : topPos - height);
    menu.style.left = `${Math.max(pad, left)}px`;
    menu.style.top = `${Math.max(pad, topPos)}px`;
  }

  function closeFrom(level) {
    while (stack.length > level) {
      const menu = stack.pop();
      if (menu.id !== 'ctx-menu') menu.remove();
      else { menu.classList.add('hidden'); menu.replaceChildren(); }
    }
    stack[stack.length - 1]?.querySelectorAll('[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }

  function hide(restoreFocus = true) {
    clearTimeout(hoverTimer);
    if (!stack.length) return;
    const root = stack[0];
    const hadFocus = root.contains(document.activeElement) || stack.some((m) => m.contains(document.activeElement));
    closeFrom(0);
    if (restoreFocus && hadFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function openSub(menu, button) {
    const it = menu._items[button.dataset.i];
    if (!it?.children?.length) return null;
    const level = stack.indexOf(menu);
    if (stack[level + 1]?._owner === button) return stack[level + 1];
    closeFrom(level + 1);
    const sub = document.createElement('div');
    sub.className = 'ctx-menu ctx-sub';
    sub._owner = button;
    document.body.append(sub);
    build(it.children, sub);
    stack.push(sub);
    button.setAttribute('aria-expanded', 'true');
    place(sub, 0, 0, button.getBoundingClientRect());
    return sub;
  }

  function activate(menu, button) {
    const it = menu._items[button.dataset.i];
    if (!it || it.disabled) return;
    if (it.children?.length) { const sub = openSub(menu, button); itemsOf(sub)[0]?.focus(); return; }
    hide(false);
    // Run after the menu is gone so dialogs opened by the action take focus cleanly.
    try { const r = it.run?.(); if (r && typeof r.catch === 'function') r.catch((e) => window.errToast?.(e)); }
    catch (e) { window.errToast?.(e); }
  }

  function show(items, x, y, opts = {}) {
    hide(false);
    const root = rootEl();
    if (!root || !items?.some((i) => i && !i.sep)) return;
    if (window.event?.axonKeyboard) opts = { ...opts, keyboard: true };
    returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    build(items, root);
    stack = [root];
    openedAt = Date.now();
    const anchor = opts.anchor instanceof Element ? opts.anchor.getBoundingClientRect() : null;
    place(root, x, y, null, anchor);
    // Keyboard invocation lands on the first entry; the mouse leaves focus on the menu so arrows work.
    if (opts.keyboard || opts.focusFirst) itemsOf(root)[0]?.focus({ preventScroll: true });
    else root.focus({ preventScroll: true });
  }

  // ---------- Interaction ----------
  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    const button = e.target.closest?.('.ctx-item, .ctx-qbtn');
    const menu = button?.closest('.ctx-menu');
    if (button && menu && stack.includes(menu)) { e.preventDefault(); activate(menu, button); return; }
    if (!stack.some((m) => m.contains(e.target))) hide(false);
  }, true);

  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !stack.some((m) => m.contains(e.target))) hide(false);
  }, true);

  document.addEventListener('mouseover', (e) => {
    if (!isOpen()) return;
    const button = e.target.closest?.('.ctx-item, .ctx-qbtn');
    const menu = button?.closest('.ctx-menu');
    if (!button || !menu || !stack.includes(menu) || button.disabled) return;
    if (document.activeElement !== button) button.focus({ preventScroll: true });
    clearTimeout(hoverTimer);
    const level = stack.indexOf(menu);
    if (button.getAttribute('aria-haspopup')) hoverTimer = setTimeout(() => openSub(menu, button), 140);
    else hoverTimer = setTimeout(() => closeFrom(level + 1), 200);
  });

  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    const menu = top();
    const k = e.key;
    const buttons = itemsOf(menu);
    const current = buttons.indexOf(document.activeElement);
    const move = (next) => { e.preventDefault(); e.stopPropagation(); buttons[(next + buttons.length) % buttons.length]?.focus({ preventScroll: true }); };
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); if (stack.length > 1) { const owner = menu._owner; closeFrom(stack.length - 1); owner?.focus(); } else hide(); return; }
    if (k === 'Tab') { hide(); return; }
    if (k === 'ArrowDown') return move(current < 0 ? 0 : current + 1);
    if (k === 'ArrowUp') return move(current < 0 ? buttons.length - 1 : current - 1);
    if (k === 'Home') return move(0);
    if (k === 'End') return move(buttons.length - 1);
    if (k === 'ArrowRight') {
      const btn = document.activeElement;
      if (btn?.getAttribute?.('aria-haspopup')) { e.preventDefault(); e.stopPropagation(); const sub = openSub(menu, btn); itemsOf(sub)[0]?.focus(); }
      else if (btn?.classList.contains('ctx-qbtn')) move(current + 1);
      return;
    }
    if (k === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      const btn = document.activeElement;
      if (btn?.classList.contains('ctx-qbtn') && current > 0) return move(current - 1);
      if (stack.length > 1) { const owner = menu._owner; closeFrom(stack.length - 1); owner?.focus(); }
      return;
    }
    if (k === 'Enter' || k === ' ') {
      const btn = document.activeElement;
      if (btn && menu.contains(btn) && btn.matches('.ctx-item, .ctx-qbtn')) { e.preventDefault(); e.stopPropagation(); activate(menu, btn); }
      return;
    }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead jumps to the next entry whose label starts with the typed text.
      e.preventDefault(); e.stopPropagation();
      clearTimeout(typedTimer);
      typed += k.toLocaleLowerCase('es');
      typedTimer = setTimeout(() => { typed = ''; }, 700);
      const labels = buttons.map((b) => b.textContent.trim().toLocaleLowerCase('es'));
      const from = typed.length === 1 ? current + 1 : Math.max(0, current);
      const hit = [...labels.keys()].map((n) => (n + from) % labels.length).find((n) => labels[n].startsWith(typed));
      if (hit !== undefined) buttons[hit].focus({ preventScroll: true });
    }
  }, true);

  // The menu is anchored to coordinates, so anything that moves the page closes it.
  window.addEventListener('resize', () => hide(false));
  window.addEventListener('blur', () => hide(false));
  document.addEventListener('scroll', (e) => { if (isOpen() && Date.now() - openedAt > 80 && !stack.some((m) => m.contains(e.target))) hide(false); }, true);
  document.addEventListener('axon:route', () => hide(false));
  document.addEventListener('axon:section', () => hide(false));
  document.addEventListener('contextmenu', (e) => { if (isOpen() && !stack.some((m) => m.contains(e.target))) hide(false); }, true);

  window.showCtxMenu = (items, x, y, opts) => show(items, x, y, opts);
  window.hideCtxMenu = () => hide(false);
  window.AxonMenu = { show: (items, x, y, opts) => show(items, x, y, opts), hide: () => hide(false), get open() { return isOpen(); } };

  // Menu key / Shift+F10 on any element that declares a menu handler through "contextmenu".
  document.addEventListener('keydown', (e) => {
    if (isOpen() || !(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
    const target = document.activeElement;
    if (!target || target === document.body) return;
    const r = target.getBoundingClientRect();
    const synthetic = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + Math.min(40, r.width / 2), clientY: r.top + Math.min(r.height - 4, 22) });
    synthetic.axonKeyboard = true;
    if (!target.dispatchEvent(synthetic) ) { e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
