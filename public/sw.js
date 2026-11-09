// Cache l'app + MediaPipe/modèles (cache-first) pour un fonctionnement hors ligne après un 1er chargement en ligne.
const C = "gs-v1", EXT = ["cdn.jsdelivr.net", "storage.googleapis.com", "huggingface.co", "cdn-lfs.huggingface.co"];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(["/", "/manifest.webmanifest"]))); });
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || !(u.origin === location.origin || EXT.includes(u.hostname))) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); } return r; })));
});
