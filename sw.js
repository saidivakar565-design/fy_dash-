/* Offline shell for the cockpit. Network first (always the newest file when online), cached copy when offline.
   Never caches or touches Fyers API / socket traffic.
   data/*.json is fetched no-store and stored only as an offline fallback of the last good copy — not pinned at install. */
const C = 'cockpit-cal-20261102b';
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.search.includes('auth_code')) return;
  if (/\/data\/[^/]+\.json$/i.test(u.pathname)) {
    e.respondWith((async () => {
      try {
        const r = await fetch(e.request, {cache:'no-store'});
        if (r.ok) {
          const c = await caches.open(C);
          await c.put(u.pathname, r.clone());
        }
        return r;
      } catch (err) {
        const hit = await caches.match(u.pathname);
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(u.pathname.endsWith('/') ? './' : e.request, cp)); }
    return r;
  }).catch(() => caches.match(u.pathname.endsWith('/') || u.pathname.endsWith('index.html') ? './' : e.request)));
});
