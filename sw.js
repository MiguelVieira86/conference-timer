const CACHE = "conference-timer-v1";
const FILES = [
  "./index.html",
  "./style.css",
  "./script.js",
  "./Technology.ttf",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Instalação: guarda todos os ficheiros em cache
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(FILES))
  );
  self.skipWaiting();
});

// Activação: limpa caches antigas
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Pedidos: serve sempre da cache (offline first)
self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
