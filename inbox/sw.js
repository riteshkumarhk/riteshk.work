/* Riteshk Requests — service worker.
   Caches the app shell for a fast, offline-tolerant launch (API calls to the Worker always pass
   straight through, never cached) + handles Web Push ("push" + "notificationclick"). */
const CACHE = "rk-inbox-v4";
const SHELL = [
  "/inbox/",
  "/inbox/index.html",
  "/inbox/inbox.js",
  "/inbox/manifest.webmanifest",
  "/inbox/icon.svg",
  "/inbox/icon-192.png",
  "/inbox/icon-512.png"
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

// Show the notification when a push arrives (payload = the JSON the Worker encrypted).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { try { d = { body: e.data.text() }; } catch (y) { d = {}; } }
  const title = d.title || "New access request";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "Open the app to review.",
    icon: "/inbox/icon.svg",
    badge: "/inbox/icon.svg",
    tag: d.tag || "rk-req",
    renotify: true,
    vibrate: [80, 40, 80],
    data: { url: d.url || "/inbox/" }
  }));
});

// Tapping the notification focuses an open inbox tab, or opens the app.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/inbox/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cls) => {
      for (const c of cls) { if (c.url.indexOf("/inbox") !== -1 && "focus" in c) return c.focus(); }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  // Local /inbox/ shell only; Worker API + everything else goes straight to network.
  if (e.request.method !== "GET" || u.origin !== self.location.origin || !u.pathname.startsWith("/inbox/")) return;
  // Network-first so the freshest app code always loads online; the cache is just the offline fallback.
  e.respondWith(
    fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/inbox/")))
  );
});
