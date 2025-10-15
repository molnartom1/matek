// sw.js — iOS-friendly (no redirect caching)
const CACHE_VERSION = 'v1.0.2';
const ASSETS = [
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png'
];
const INDEX_URL = 'index.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // 1) Cache a clean, non-redirected copy of index.html
    try {
      const res = await fetch(INDEX_URL, { cache: 'reload', redirect: 'follow' });
      if (res.ok && !res.redirected) {
        await cache.put(INDEX_URL, res.clone());
      } else {
        // If browser marks it as redirected, clone body to force a fresh 200 in cache
        const text = await res.text();
        await cache.put(INDEX_URL, new Response(text, { headers: { 'Content-Type': 'text/html' } }));
      }
    } catch (e) {
      // no network at install — cache will be filled later
    }
    // 2) Cache static assets (icons, manifest)
    await cache.addAll(ASSETS);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE_VERSION) await caches.delete(key);
    }
  })());
  self.clients.claim();
});

// Cache-first for same-origin GET (except index.html which we manage explicitly)
async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (req.method === 'GET' && new URL(req.url).origin === self.location.origin && !req.url.endsWith(INDEX_URL)) {
    cache.put(req, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Navigation requests: try network, fallback to cached index.html (never cache redirected nav responses)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const netRes = await fetch(req);
        // Do not put navigation responses in cache (may be redirect on some servers)
        return netRes;
      } catch (e) {
        const cached = await cache.match(INDEX_URL);
        return cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Same-origin GET (non-navigation)
  if (url.origin === self.location.origin && req.method === 'GET') {
    if (url.pathname.endsWith(INDEX_URL)) {
      // Serve cached index when requested directly
      event.respondWith((async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(INDEX_URL);
        if (cached) return cached;
        try {
          const fresh = await fetch(INDEX_URL, { cache: 'reload' });
          if (fresh.ok) cache.put(INDEX_URL, fresh.clone());
          return fresh;
        } catch (e) {
          return new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
        }
      })());
      return;
    }
    event.respondWith(cacheFirst(req));
    return;
  }

  // Cross-origin: network-first with quiet offline fallback
  event.respondWith((async () => {
    try { return await fetch(req); } catch (e) { return new Response('', { status: 204 }); }
  })());
});
