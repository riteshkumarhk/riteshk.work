/* Riteshk Requests — service worker.
   Caches the app shell for a fast, offline-tolerant launch (API calls to the Worker always pass
   straight through, never cached) + handles Web Push ("push" + "notificationclick"). */
const CACHE = "rk-inbox-v21";
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

// App-icon badge = count of un-actioned request notifications still on screen (Badging API; progressive,
// no-ops where unsupported). Called after showing a push and after a notification is closed.
function refreshBadge() {
  try {
    if (!self.registration.getNotifications) return;
    self.registration.getNotifications().then((ns) => {
      const n = ns.filter((x) => x.data && (x.data.allow || x.data.cancel || x.data.accept || x.data.decline || x.data.reveal)).length;
      if (self.navigator && self.navigator.setAppBadge) {
        if (n > 0) self.navigator.setAppBadge(n).catch(() => {});
        else if (self.navigator.clearAppBadge) self.navigator.clearAppBadge().catch(() => {});
      }
    }).catch(() => {});
  } catch (e) {}
}

// Show the notification when a push arrives (payload = the JSON the Worker encrypted).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  const booking = d.kind === "booking";
  const title = d.title || (booking ? "New booking" : "New access request");
  const body = d.body || "Open the app to review.";
  const tag = d.tag || (booking ? "rk-book" : "rk-req");
  // iOS reveals notification actions only on long-press (a normal tap opens the PWA) and desktop clicks
  // are deliberate, so we attach the action buttons up front there. Android renders action buttons
  // INLINE with no long-press gate, so we start WITHOUT them and reveal on the first tap instead (see
  // notificationclick): first tap shows the buttons, a second tap opens the PWA - a stray tap sends nothing.
  // Booking = Accept/Decline (Cal.com); access request = Allow/Decline.
  const ua = (self.navigator && self.navigator.userAgent) || "";
  const isAndroid = /Android/i.test(ua);
  const yes = booking ? (d.accept || "") : (d.allow || "");
  const no = booking ? (d.decline || "") : (d.cancel || "");
  const hasActions = !!(yes || no);
  const actDefs = booking
    ? [{ action: "bk-accept", title: "Accept" }, { action: "bk-decline", title: "Decline" }]
    : [{ action: "allow", title: "Allow" }, { action: "decline", title: "Decline" }];
  const actions = (!isAndroid && hasActions) ? actDefs : [];
  e.waitUntil(self.registration.showNotification(title, {
    body: body,
    icon: "/inbox/icon-192.png",
    badge: "/inbox/icon-192.png",
    tag: tag,
    timestamp: d.timestamp || Date.now(),
    renotify: true,
    requireInteraction: true,   // stay on screen until tapped - a ping must not be missed
    vibrate: [90, 40, 90, 40, 90],
    actions: actions,
    data: { kind: d.kind || "request", url: d.url || "/inbox/", allow: d.allow || "", cancel: d.cancel || "", accept: d.accept || "", decline: d.decline || "", title: title, body: body, tag: tag, reveal: isAndroid && hasActions, stage: "initial" }
  }).then(refreshBadge));
});

// If the browser rotates our push subscription, re-subscribe immediately so getSubscription() stays valid;
// the app re-registers the fresh endpoint with the server on its next launch (ensurePush).
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() }).catch(() => {}));
});

// Tapping the notification (or an action button). One-tap actions POST the signed capability link
// straight from the SW and flash the result — no app open needed; a plain tap focuses/opens the app.
self.addEventListener("notificationclick", (e) => {
  const data = e.notification.data || {};
  const act = e.action;
  // Each action maps to its OWN signed URL + the endpoint it MUST contain, so a stale/mismatched payload
  // can never fire the opposite action (Accept can only ever POST /cal/accept, etc.). Booking = accept/
  // decline (Cal.com confirm/reject); access request = allow/cancel.
  const ACT = {
    "allow": { url: data.allow, ep: "/req/allow", ok: "Access sent \u2713" },
    "decline": { url: data.cancel, ep: "/req/cancel", ok: "Declined \u2713" },
    "bk-accept": { url: data.accept, ep: "/cal/accept", ok: "Accepted \u2713" },
    "bk-decline": { url: data.decline, ep: "/cal/decline", ok: "Declined \u2713" }
  };
  if (ACT[act]) {
    e.notification.close();
    refreshBadge();
    const a = ACT[act];
    if (a.url && a.url.indexOf(a.ep) !== -1) {
      e.waitUntil(
        fetch(a.url, { method: "POST" })
          .then((r) => r.text().catch(() => ""))
          .then((msg) => self.registration.showNotification(a.ok, { body: String(msg || "Done.").slice(0, 140), icon: "/inbox/icon-192.png", badge: "/inbox/icon-192.png", tag: "rk-act-done" }))
          .catch(() => self.registration.showNotification("Couldn\u2019t reach the server", { body: "Open the app and try again.", icon: "/inbox/icon-192.png", badge: "/inbox/icon-192.png", tag: "rk-act-done" }))
      );
      return;
    }
  } else if (data.reveal && data.stage !== "shown") {
    // Android two-stage: the FIRST tap reveals the action buttons in place (no app launch, nothing sent);
    // a SECOND tap opens the app (or, for a booking, the Cal.com manage page to reschedule).
    const booking = data.kind === "booking";
    const revealActs = booking
      ? [{ action: "bk-accept", title: "Accept" }, { action: "bk-decline", title: "Decline" }]
      : [{ action: "allow", title: "Allow" }, { action: "decline", title: "Decline" }];
    e.waitUntil(self.registration.showNotification(data.title || (booking ? "New booking" : "New access request"), {
      body: (data.body || "Open the app to review.") + " \u2014 tap again to open",
      icon: "/inbox/icon-192.png",
      badge: "/inbox/icon-192.png",
      tag: data.tag || (booking ? "rk-book" : "rk-req"),
      renotify: false,
      silent: true,
      requireInteraction: true,
      actions: revealActs,
      data: Object.assign({}, data, { stage: "shown" })
    }));
    return;
  }
  e.notification.close();
  refreshBadge();
  const target = data.url || "/inbox/";
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
  // Stale-while-revalidate: serve the cached shell INSTANTLY for a fast launch, then refresh the cache in
  // the background so the next open has the latest. Offline -> the cached shell. Shell changes ship with a
  // CACHE bump, which re-precaches fresh copies on activate, so "instant" never means "stuck on old".
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(e.request).then((cached) => {
        const fetching = fetch(e.request, { cache: "no-cache" }).then((resp) => {
          if (resp && resp.ok) cache.put(e.request, resp.clone());
          return resp;
        }).catch(() => null);
        e.waitUntil(fetching);
        return cached || fetching.then((r) => r || caches.match("/inbox/"));
      })
    )
  );
});
