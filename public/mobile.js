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
    const open=body.classList.contains('sidebar-open');
    menuBtn.setAttribute('aria-expanded',open?'true':'false');
    const sidebar=document.querySelector('.sidebar');if(sidebar)sidebar.inert=mq.matches&&!open;
  };
  const close = () => { body.classList.remove('sidebar-open'); syncBtn(); };
  const toggle = () => {
    if (!mq.matches) return;
    body.classList.toggle('sidebar-open');
    syncBtn();
    if(body.classList.contains('sidebar-open'))document.querySelector('.sidebar .nav-item')?.focus();
  };

  // Backdrop created here (styles in app.css); clicking it = outside click → close.
  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  body.appendChild(backdrop);
  backdrop.addEventListener('click', close);

  syncBtn();
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
    if(e.key==='Tab'&&mq.matches&&body.classList.contains('sidebar-open')){
      const controls=[menuBtn,...document.querySelectorAll('.sidebar a[href], .sidebar button')].filter(n=>!n.disabled&&n.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  });
  document.addEventListener('axon:section',close);
  new MutationObserver(syncBtn).observe(body,{attributes:true,attributeFilter:['class']});

  // Always reset the drawer when leaving the mobile breakpoint.
  const onBreakpoint = () => { if (!mq.matches) close(); else syncBtn(); };
  if (mq.addEventListener) mq.addEventListener('change', onBreakpoint);
  else if (mq.addListener) mq.addListener(onBreakpoint); // Safari < 14
})();
