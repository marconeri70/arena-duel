const CACHE='lane-battle-v1';
const ASSETS=[
  './',
  './index.html',
  './main.js',
  './manifest.webmanifest',
  './assets/sprites/tank.png',
  './assets/sprites/scout.png',
  './assets/sprites/healer.png',
  './assets/sprites/spark.png',
  './assets/sprites/projectile.png'
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch',e=>{
  e.respondWith(caches.match(e.request).then(res=>res||fetch(e.request)));
});