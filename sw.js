self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  clients.claim();
});

self.addEventListener('fetch', event => {
  // Lascia passare tutte le richieste in rete (no cache complessa)
  return;
});
