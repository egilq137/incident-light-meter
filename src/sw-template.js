/**
 * Offline shell. The precache list and version are substituted at build time by
 * the plugin in vite.config.ts, so this file is never edited by hand with a
 * stale file list in it.
 *
 * Strategy: cache-first for the precached shell (the app is a calculator, it has
 * no server to be stale against), network-first for anything else.
 */

const VERSION = __VERSION__;
const CACHE = `incident-light-meter-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // A navigation with no network falls back to the cached app shell.
          if (request.mode === 'navigate') return caches.match('/');
          throw new Error('offline');
        });
    }),
  );
});
