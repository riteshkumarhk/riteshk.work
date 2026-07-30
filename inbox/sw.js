/* Riteshk Requests — service worker.
   Phase 1: cache the app shell for a fast, offline-tolerant launch. API calls to the Worker
   always pass straight through (never cached). Phase 2 will add "push" + "notificationclick". */
const CACHE = "rk-inbox-v1";
const SHELL = [
  "/inbox/",
  "/inbox/index.html",
  "/inbox/inbox.js",
  "/inbox/manifest.webmanifest",
  "/inbox/icon.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  // Only serve the local /inbox/ shell from cache; everything else (Worker API, etc.) goes to network.
  if (e.request.method !== "GET" || u.origin !== self.location.origin || !u.pathname.startsWith("/inbox/")) return;
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match("/inbox/"))
    )
  );
});
