/* ==========================================================================
   GitHub Markdown Explorer - Service Worker (Offline PWA Engine)
   ========================================================================== */

const CACHE_NAME = 'gh-md-explorer-v29';

// Static assets to precache (App Shell & CDN Dependencies)
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './styles.css?v=29',
  './app.js',
  './app.js?v=29',
  './manifest.webmanifest',
  './manifest.webmanifest?v=29',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icon.jpeg',
  'https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-light.min.css',
  'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css',
  'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  'https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js',
  'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/contrib/auto-render.min.js'
];

// Install Event: Precache all static resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Precaching static resources...');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[Service Worker] Precache partial warning:', err);
      });
    })
  );
});

// Message Event: Listen for skipWaiting from In-App Update flow (Rule 6D)
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
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

// Fetch Event: Network-First for local assets with cache fallback (PWA Standards Rule 4)
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Ignore non-HTTP protocols (e.g. data:, blob:, chrome-extension:)
  if (!requestUrl.protocol.startsWith('http')) {
    return;
  }

  // Ignore non-GET requests or GitHub API requests (API offline is handled via IndexedDB)
  if (event.request.method !== 'GET' || requestUrl.hostname.includes('api.github.com')) {
    return;
  }

  // Do NOT intercept requests to other apps on the same domain outside this app's scope (e.g. /MyQuizlet/)
  if (requestUrl.origin === self.location.origin && !event.request.url.startsWith(self.registration.scope)) {
    return;
  }

  const isLocalAsset = event.request.url.startsWith(self.registration.scope);

  if (isLocalAsset) {
    // Network-First for local app code: ensures latest edits are immediately loaded
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback
          return caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            if (event.request.mode === 'navigate' && event.request.url.startsWith(self.registration.scope)) {
              return caches.match('./index.html', { ignoreSearch: true });
            }
          });
        })
    );
  } else {
    // Cache-First for external CDN dependencies
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
  }
});
