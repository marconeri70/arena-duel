self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('arena-duel-v2').then(cache => cache.addAll([
      './',
      './index.html',
      './manifest.webmanifest',
      './sw.js'
    ]))
  );
});
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
