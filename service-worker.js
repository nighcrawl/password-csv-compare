/*
 * Simple service worker to enable offline use of the Password CSV Compare app.
 * It caches the core application shell on install and serves cached content
 * during subsequent visits. No data is stored or synchronized.
 */

const CACHE_NAME = 'pwd-csv-compare-v1';

// List of local resources to cache for offline access.
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

// Intercept fetch requests and respond with cached versions when available.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return (
        cachedResponse ||
        fetch(event.request).catch(() => {
          // Optionally, fallback to offline page or default here
          return cachedResponse;
        })
      );
    })
  );
});

// Remove outdated caches when a new service worker activates.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});