/* Theme and motion controls for the public entrance; no authenticated assets. */
(() => {
  'use strict';
  const screen = document.querySelector('#login-screen');
  const theme = document.querySelector('#login-theme');
  const motion = document.querySelector('#login-motion');
  const updateTheme = () => {
    const dark = window.AxonThemes.current().effective === 'dark';
    theme.setAttribute('aria-label', dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    theme.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}" aria-hidden="true"></i>`;
    window.lucide?.createIcons();
  };
  theme.addEventListener('click', () => window.AxonThemes.setMode(window.AxonThemes.current().effective === 'dark' ? 'light' : 'dark'));
  document.addEventListener('axon:theme', updateTheme);
  updateTheme();
  motion.addEventListener('click', () => {
    const paused = screen.dataset.motion !== 'paused';
    screen.dataset.motion = paused ? 'paused' : 'running';
    motion.setAttribute('aria-pressed', String(paused));
    motion.setAttribute('aria-label', paused ? 'Reanudar animación' : 'Pausar animación');
    motion.innerHTML = `<i data-lucide="${paused ? 'play' : 'pause'}" aria-hidden="true"></i>`;
    window.lucide?.createIcons();
  });

  // Unencrypted LAN warning: credentials travel in plain text over plain HTTP.
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  if (location.protocol === 'http:' && !local) {
    const warn = document.createElement('p');
    warn.className = 'login-warning';
    warn.setAttribute('role', 'note');
    warn.innerHTML = '<i data-lucide="shield-alert" aria-hidden="true"></i> Conexión sin cifrar — la contraseña viaja en texto plano por la red local.';
    document.querySelector('.login-security')?.before(warn);
    window.lucide?.createIcons();
  }

  // Autofocus + cleanup: focus the user field when the screen appears, and
  // clear a rejected TOTP code so the next attempt starts empty.
  const user = document.querySelector('#username');
  const code = document.querySelector('#login-code');
  const error = document.querySelector('#login-error');
  const focusUser = () => { if (!screen.classList.contains('hidden') && !user.value) user.focus(); };
  new MutationObserver(focusUser).observe(screen, { attributes: true, attributeFilter: ['class'] });
  focusUser();
  if (error && code) new MutationObserver(() => {
    if (error.textContent.trim() && !code.classList.contains('hidden')) { code.value = ''; code.focus(); }
  }).observe(error, { childList: true, characterData: true, subtree: true });
})();
