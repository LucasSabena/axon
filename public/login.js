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
})();
