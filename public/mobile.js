/* ============================================================
   AXON — mobile UX (viewports ≤ 768px)
   Wires the hamburger button to an off-canvas sidebar drawer:
   - toggles body.sidebar-open
   - closes on nav-item click, Escape, and backdrop (outside) click
   Defensive: no-ops if the expected markup is missing.
   ============================================================ */
(() => {
  'use strict';

  const body = document.body;
  const menuBtn = document.getElementById('mobile-menu-btn');
  const mq = window.matchMedia('(max-width: 768px)');

  // Render Lucide icons (menu glyph) — prefers app.js's refreshIcons().
  const paintIcons = () => {
    try {
      if (typeof refreshIcons === 'function') { refreshIcons(); return; }
    } catch (_) { /* app.js binding not initialized yet */ }
    try { if (window.lucide) window.lucide.createIcons(); } catch (_) { /* decorative */ }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paintIcons, { once: true });
  } else {
    paintIcons();
  }

  if (!menuBtn) return; // no hamburger in markup — nothing else to do

  const syncBtn = () => {
    menuBtn.setAttribute('aria-expanded', body.classList.contains('sidebar-open') ? 'true' : 'false');
  };
  const close = () => { body.classList.remove('sidebar-open'); syncBtn(); };
  const toggle = () => {
    if (!mq.matches) return;
    body.classList.toggle('sidebar-open');
    syncBtn();
  };

  // Backdrop created here (styles in app.css); clicking it = outside click → close.
  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  body.appendChild(backdrop);
  backdrop.addEventListener('click', close);

  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });

  // Close the drawer once a destination is picked.
  const nav = document.querySelector('.sidebar-nav');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('.nav-item')) close();
    });
  }

  // Escape closes and returns focus to the trigger.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && body.classList.contains('sidebar-open')) {
      close();
      menuBtn.focus();
    }
  });

  // Always reset the drawer when leaving the mobile breakpoint.
  const onBreakpoint = () => { if (!mq.matches) close(); };
  if (mq.addEventListener) mq.addEventListener('change', onBreakpoint);
  else if (mq.addListener) mq.addListener(onBreakpoint); // Safari < 14
})();
