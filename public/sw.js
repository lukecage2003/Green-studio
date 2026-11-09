// Hors ligne : l'app (même origine) en réseau d'abord, pour que les mises à jour arrivent ; repli sur le cache sans réseau.
// MediaPipe et les modèles (gros fichiers versionnés) en cache d'abord.
const C = "gs-v2", EXT = ["cdn.jsdelivr.net", "storage.googleapis.com", "huggingface.co", "cdn-lfs.huggingface.co"];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(["/", "/manifest.webmanifest"]))); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => clients.claim())));
const put = (req, r) => { if (r.ok) { const cp = r.clone(); caches.open(C).then((c) => c.put(req, cp)); } return r; };
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.origin === location.origin) e.respondWith(fetch(e.request).then((r) => put(e.request, r)).catch(() => caches.match(e.request).then((h) => h || (e.request.mode === "navigate" ? caches.match("/") : Response.error()))));
  else if (EXT.includes(u.hostname)) e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => put(e.request, r))));
});
