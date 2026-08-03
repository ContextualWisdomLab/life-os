'use strict';

const CACHE_PREFIX = 'life-os-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const PUBLIC_ASSET_PATHS = Object.freeze([
  '/offline',
  '/manifest.webmanifest',
  '/icons/life-os.svg',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PUBLIC_ASSET_PATHS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME,
            )
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isPublicAsset(url) {
  return PUBLIC_ASSET_PATHS.includes(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const fallback = await caches.match('/offline');
        return fallback ?? Response.error();
      }),
    );
    return;
  }

  if (isPublicAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request)),
    );
  }
});
