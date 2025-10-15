// sw.js — robust offline handler
const CACHE_VERSION = 'v1.0.1';
const APP_SHELL = [
  'index.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Helper: cache-first for same-origin GET
async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (req.method === 'GET' && new URL(req.url).origin === self.location.origin) {
    cache.put(req, fresh.clone());
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Navigate requests: try network, fall back to cached index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const fresh = await fetch(req);
        // keep cached index fresh when online
        try {
          const ireq = new Request('index.html', {cache: 'reload'});
          const ires = await fetch(ireq);
          cache.put('index.html', ires.clone());
        } catch(e) {}
        return fresh;
      } catch (e) {
        const cachedIndex = await cache.match('index.html');
        return cachedIndex || new Response('<h1>Offline</h1>', {headers:{'Content-Type':'text/html'}});
      }
    })());
    return;
  }

  // Same-origin assets -> cache-first
  if (new URL(req.url).origin === self.location.origin && req.method === 'GET') {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Cross-origin: network-first, no throw if offline
  event.respondWith((async () => {
    try {
      return await fetch(req);
    } catch (e) {
      // give up quietly offline
      return new Response('', {status: 204});
    }
  })());
});
