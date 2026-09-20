/* ==========================================================================
   GitHub Markdown Explorer - Service Worker (Offline PWA Engine)
   ========================================================================== */

const CACHE_NAME = 'gh-md-explorer-v2';

// Static assets to precache (App Shell & CDN Dependencies)
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './icon.jpeg',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-light.min.css',
  'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css',
  'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  'https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js',
  'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js'
];

// Install Event: Precache all static resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Precaching static resources...');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[Service Worker] Precache partial warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Cache-First strategy for static assets, Network-Only for GitHub API
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Ignore non-GET requests or GitHub API requests (API offline is handled via IndexedDB)
  if (event.request.method !== 'GET' || requestUrl.hostname.includes('api.github.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached response immediately
        return cachedResponse;
      }

      // If not in cache, fetch from network & store copy in cache
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' && networkResponse.type !== 'cors') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch((fetchErr) => {
        console.warn('[Service Worker] Fetch failed, resource unavailable offline:', event.request.url);
        // Fallback for navigation HTML requests if offline
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
