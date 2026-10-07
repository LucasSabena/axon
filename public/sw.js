// Build-time stamp; only versioned vendor assets are cached per release.
const CACHE = 'axon-bdf832f53d79';

// A new release stays "waiting" until the user accepts the reload bar —
// swapping the shell mid-session could strand open edits and jobs.
self.addEventListener('message', (e) => { if (e.data === 'axon:skip-waiting') self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('axon-') && k !== CACHE).map(k => caches.delete(k)))).then(() => clients.claim())
));

const OFFLINE_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#080c10"><title>AXON</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080c10;color:#c9d4de;font-family:system-ui,sans-serif;text-align:center}
.c{max-width:26rem;padding:2rem}.spin{width:32px;height:32px;margin:0 auto 1rem;border:3px solid #26323d;border-top-color:#5ea1ff;border-radius:50%;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}p{line-height:1.5;color:#8b99a7}</style></head>
<body><div class="c"><div class="spin"></div><p id="m">Axon no responde — probablemente se está actualizando. Reintentando automáticamente…</p>
<button onclick="location.reload()" style="margin-top:1rem;padding:8px 18px;border:1px solid #26323d;border-radius:8px;background:transparent;color:#c9d4de;font:inherit;cursor:pointer">Reintentar ahora</button></div>
<script>// Backoff exponencial (1.5s→24s, tope 30s) persistente entre recargas.
var n=0;try{n=+sessionStorage.getItem('axon:offline-retry')||0;sessionStorage.setItem('axon:offline-retry',n+1)}catch(e){}
setTimeout(function(){location.reload()},Math.min(1500*Math.pow(2,n),30000))</script></body></html>`;

const offlinePage = () => new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (!u.protocol.startsWith('http') || e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/p/') || u.pathname.startsWith('/x/') || u.pathname.startsWith('/s/')) return;

  // Never fall back to an old shell: it could load scripts from a new release.
  // Keep the URL and retry automatically until the current server returns.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request, { cache: 'no-store' }).then(res => res.status >= 500 ? offlinePage() : res).catch(offlinePage));
    return;
  }

  // Unversioned assets and app scripts always reach the running server.
  if (/^[a-f0-9]{12}$/.test(u.searchParams.get('v') || '') && (u.pathname.startsWith('/vendor/') || u.pathname.startsWith('/icons/') || u.pathname.startsWith('/fonts/'))) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) e.waitUntil(c.put(e.request, res.clone()).catch(() => {}));
      return res;
    }))));
    return;
  }
  e.respondWith(fetch(e.request, { cache: 'no-store' }));
});
