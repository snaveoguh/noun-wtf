// stupidfont service worker: offline app shell.
// Bump V whenever the shell files change so clients refresh their cache.
const V = 'stupidfont-v3';
const SHELL = ['./', './index.html', './opentype.min.js', './Pip3Beef-Regular.ttf', './Pip3Beef-Regular.woff2',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png', './privacy.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Navigations: network first so updates land immediately, cache when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(V).then(c => c.put('./index.html', copy)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // Everything else: cache first, refresh in the background.
  e.respondWith(caches.match(req).then(hit => {
    const refresh = fetch(req).then(r => { if (r.ok) caches.open(V).then(c => c.put(req, r.clone())); return r; }).catch(() => hit);
    return hit || refresh;
  }));
});
