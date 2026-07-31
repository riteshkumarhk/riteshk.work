/* Riteshk Requests — service worker.
   Caches the app shell for a fast, offline-tolerant launch (API calls to the Worker always pass
   straight through, never cached) + handles Web Push ("push" + "notificationclick"). */
const CACHE = "rk-inbox-v8";
const SHELL = [
  "/inbox/",
  "/inbox/index.html",
  "/inbox/inbox.js",
  "/inbox/manifest.webmanifest",
  "/inbox/icon.svg",
  "/inbox/icon-192.png",
  "/inbox/icon-512.png"
];

// VAPID public key (same as the app + the Worker's VAPID_PRIVATE) — needed to re-subscribe on rotation.
const VAPID_PUBLIC = "BNvPqxaZXo1uLqMAXeW-l6WCPMceklB7Z5RzgpAL3p8N8MtkATL5j0w6YMwdFmNPD0nkcN4NWY_msYNewlZKCHQ";
function vapidKey() {
  const s = VAPID_PUBLIC.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad); const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

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
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  const title = d.title || "New access request";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "Open the app to review.",
    icon: "/inbox/icon-192.png",
    badge: "/inbox/icon-192.png",
    tag: d.tag || "rk-req",
    renotify: true,
    requireInteraction: true,   // stay on screen until tapped — a recruiter ping must not be missed
    vibrate: [90, 40, 90, 40, 90],
    data: { url: d.url || "/inbox/" }
  }));
});

// If the browser rotates our push subscription, re-subscribe immediately so getSubscription() stays valid;
// the app re-registers the fresh endpoint with the server on its next launch (ensurePush).
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() }).catch(() => {}));
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
