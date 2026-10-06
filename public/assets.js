/* Local, bounded asset loading. Failed loads can be retried; no CDN dependencies. */
(() => {
  const flights = new Map();
  function script(src, module = false) {
    if (flights.has(src)) return flights.get(src);
    const promise = new Promise((resolve, reject) => {
      const node = document.createElement('script');
      if (module) node.type = 'module';
      else node.async = false;
      node.src = src;
      node.onload = resolve;
      node.onerror = () => { node.remove(); flights.delete(src); reject(new Error('No se pudo cargar una herramienta. Reintentá la acción.')); };
      document.head.append(node);
    });
    flights.set(src, promise); return promise;
  }
  function stylesheet(href) {
    const key = `css:${href}`;
    if (flights.has(key)) return flights.get(key);
    const promise = new Promise((resolve, reject) => {
      const node = document.createElement('link'); node.rel='stylesheet'; node.href=href;
      node.onload=resolve; node.onerror=()=>{node.remove();flights.delete(key);reject(new Error('No se pudo cargar el estilo de una herramienta'));};
      document.head.insertBefore(node, document.querySelector('link[href^="/design-system.css"]'));
    }); flights.set(key,promise);return promise;
  }
  let featureFlight;
  window.AxonAssets = {
    script,
    features() {
      return featureFlight ||= (async () => {
        const nodes = [...document.querySelectorAll('script[type="text/axon-feature"]')];
        // Fetch classic scripts concurrently, execute in declaration order.
        await Promise.all([...document.querySelectorAll('[data-axon-style]')].map(n=>stylesheet(n.dataset.axonStyle)).concat([script('/vendor/axon-ui.js?v=20261005a', true), ...nodes.filter(n=>n.dataset.module !== 'true').map(n=>script(n.dataset.src))]));
        for (const node of nodes.filter(n=>n.dataset.module === 'true')) await script(node.dataset.src, true);
      })().catch(err => { featureFlight = null; throw err; });
    },
    async terminal() {
      await Promise.all([stylesheet('/vendor/xterm.css'), script('/vendor/xterm.js')]);
      await script('/vendor/xterm-addon-fit.js');
    },
  };
})();
