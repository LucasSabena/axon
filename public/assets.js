/* Local, bounded asset loading. Failed loads can be retried; no CDN dependencies. */
(() => {
  const flights = new Map();
  function script(src, module = false) {
    if (flights.has(src)) return flights.get(src);
    const promise = new Promise((resolve, reject) => {
      const owner = document;
      const node = document.createElement('script');
      if (module) node.type = 'module';
      else node.async = false;
      node.src = src;
      node.onload = () => owner === window.document ? resolve() : reject(Object.assign(new Error('La página cambió durante la carga'), { cancelled: true }));
      node.onerror = () => { node.remove(); flights.delete(src); reject(new Error('No se pudo cargar una herramienta. Reintentá la acción.')); };
      document.head.append(node);
    });
    flights.set(src, promise); return promise;
  }
  function stylesheet(href) {
    const key = `css:${href}`;
    if (flights.has(key)) return flights.get(key);
    const promise = new Promise((resolve, reject) => {
      const owner = document;
      const node = document.createElement('link'); node.rel='stylesheet'; node.href=href;
      node.onload=()=>owner === window.document ? resolve() : reject(Object.assign(new Error('La página cambió durante la carga'), { cancelled:true })); node.onerror=()=>{node.remove();flights.delete(key);reject(new Error('No se pudo cargar el estilo de una herramienta'));};
      document.head.insertBefore(node, document.querySelector('link[href^="/design-system.css"]'));
    }); flights.set(key,promise);return promise;
  }
  let featureFlight;
  window.AxonAssets = {
    script,
    features() {
      return featureFlight ||= (async () => {
        const nodes = [...document.querySelectorAll('script[type="text/axon-feature"]')];
        // Preload in parallel, then stop execution at the first failed dependency.
        // Otherwise later modules execute with missing globals and cannot recover
        // when only the failed script is retried.
        const preloads = nodes.filter(n=>n.dataset.module !== 'true' && !flights.has(n.dataset.src)).map(n=>{
          const link=document.createElement('link');link.rel='preload';link.as='script';link.href=n.dataset.src;document.head.append(link);return link;
        });
        try {
          await Promise.all([...document.querySelectorAll('[data-axon-style]')].map(n=>stylesheet(n.dataset.axonStyle)).concat([script('/vendor/axon-ui.js?v=48642a34b605', true)]));
          for (const node of nodes) await script(node.dataset.src, node.dataset.module === 'true');
        } finally { for (const link of preloads) link.remove(); }
      })().catch(err => { featureFlight = null; throw err; });
    },
    async terminal() {
      await Promise.all([stylesheet('/vendor/xterm.css?v=ba8e69856694'), script('/vendor/xterm.js?v=1f991ac3b4b2')]);
      await script('/vendor/xterm-addon-fit.js?v=bdaefa370b1b');
      if (typeof window.Terminal !== 'function' || typeof window.FitAddon?.FitAddon !== 'function') throw new Error('No se pudo iniciar la terminal. Reintentá la acción.');
    },
  };
})();
