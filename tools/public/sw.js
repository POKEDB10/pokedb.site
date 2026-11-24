// tools/public/sw.js
// Service Worker for PokeDB Tools Hub (Task P6.7, PWA-001).

const CACHE_NAME = 'pokedb-tools-v2-build';

const PRECACHE_ASSETS = [
  '/tools/',
  '/shared/theme.css',
  '/shared/theme-switcher.js',
  '/shared/qrcode.min.js',
  '/fonts/fonts.css',
  '/fonts/ibm-plex-mono-400.woff2',
  '/fonts/ibm-plex-sans-400.woff2',
  '/manifest.webmanifest',
  '/icon-192.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NetworkOnly for APIs, UGC, health, drops, pastes, and redirects
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/d/') ||
    url.pathname.startsWith('/v/') ||
    url.pathname.startsWith('/b/') ||
    url.pathname.startsWith('/raw/') ||
    url.pathname.startsWith('/health') ||
    url.pathname === '/healthz' ||
    url.pathname === '/readyz'
  ) {
    return; // Pass directly to network
  }

  // CacheFirst for immutable hashed assets and self-hosted fonts
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // StaleWhileRevalidate for tool HTML shell and pages
  if (event.request.mode === 'navigate' || event.request.destination === 'document' || url.pathname.endsWith('.html')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((networkRes) => {
          if (networkRes.ok) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkRes;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Default: Cache first with network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});
