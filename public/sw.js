const CACHE = 'pm-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => clients.claim()))
);
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  // Ignore non-http schemes (chrome-extension:// etc.) and non-GETs.
  if (!u.protocol.startsWith('http') || e.request.method !== 'GET') return;
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/p/')) return;
  // Immutable-ish statics: cache-first.
  if (u.pathname.startsWith('/vendor/') || u.pathname.startsWith('/icons/') || u.pathname.startsWith('/fonts/')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
        return res;
      }))
    );
    return;
  }
  // HTML/JS/CSS shell: network-first so deploys show up immediately; cached
  // copy is only the offline fallback.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || Response.error()))
  );
});
