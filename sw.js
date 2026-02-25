const CACHE = "conference-timer-v3";
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

// Network first: tenta sempre o servidor, usa cache só se offline
self.addEventListener("fetch", e => {
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Actualiza a cache com a versão mais recente
        const clone = response.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
