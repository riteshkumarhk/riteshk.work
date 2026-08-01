/* Riteshk Requests PWA — passkey-gated inbox for recruiter access requests.
   Standalone page (NOT part of the esbuild bundle). Talks to the Cloudflare Worker.
   Flow: QR ?pair -> enrol a passkey on THIS phone -> onboarding -> request list.
   Returning visits: passkey sign-in -> request list. Every action is passkey-session gated. */
(function () {
  "use strict";
  var WORKER = "https://rk-ai-proxy.riteshkumarhk.workers.dev";
  var SS = "rk:inbox:sess";
  var INST = "rk:inbox:installed";
  var pushEnsured = false;   // re-register this device's push subscription once per launch (self-heals rotation)
  // VAPID public key (paired with the Worker's VAPID_PRIVATE secret) — used as applicationServerKey.
  var VAPID_PUBLIC = "BNvPqxaZXo1uLqMAXeW-l6WCPMceklB7Z5RzgpAL3p8N8MtkATL5j0w6YMwdFmNPD0nkcN4NWY_msYNewlZKCHQ";
  var app = document.getElementById("app");
  var deferredInstall = null;

  /* ---------- tiny DOM + utils ---------- */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") e.className = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function screen(kids) { app.innerHTML = ""; app.appendChild(h("div", { class: "wrap" }, kids)); }
  function brand() {
    return h("div", { class: "brand" }, [
      h("div", { class: "logo", html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="#D8A657"><path d="M5.25 9a6.75 6.75 0 0 1 13.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 0 1-.297 1.206 24.6 24.6 0 0 1-4.831 1.243 3.75 3.75 0 1 1-7.48 0 24.585 24.585 0 0 1-4.831-1.244.75.75 0 0 1-.298-1.205A8.217 8.217 0 0 0 5.25 9.75V9Z"/></svg>' }),
      h("span", { text: "Requests" })
    ]);
  }
  function btn(label, cls, on) { return h("button", { class: "btn " + (cls || ""), onclick: on || function () {} }, [label]); }
  function timeAgo(iso) {
    try { var d = (Date.now() - new Date(iso).getTime()) / 1000;
      if (d < 60) return "just now"; if (d < 3600) return Math.floor(d / 60) + "m ago";
      if (d < 86400) return Math.floor(d / 3600) + "h ago"; return Math.floor(d / 86400) + "d ago";
    } catch (e) { return ""; }
  }
  function b64urlToBuf(s) { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); var pad = s.length % 4 ? "=".repeat(4 - s.length % 4) : ""; var bin = atob(s + pad); var b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; }
  function bufToB64url(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

  async function api(path, opts) {
    opts = opts || {}; opts.headers = opts.headers || {};
    var r, j = null;
    try { r = await fetch(WORKER + path, opts); } catch (e) { return { ok: false, status: 0, json: { error: "Couldn’t reach the server." } }; }
    try { j = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, json: j };
  }
  function sess() { return localStorage.getItem(SS) || ""; }
  function authHdr() { return { "Authorization": "Bearer " + sess() }; }

  /* ---------- WebAuthn (verify only — enrolment happens in the desktop studio) ---------- */
  async function authPasskey() {
    var beg = await api("/admin/webauthn/auth/begin", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!beg.ok) throw new Error((beg.json && beg.json.error) || "Couldn’t start sign-in.");
    var o = beg.json;
    var as;
    try {
      as = await navigator.credentials.get({ publicKey: {
        challenge: b64urlToBuf(o.challenge), rpId: o.rpId, timeout: o.timeout,
        userVerification: o.userVerification || "preferred",
        allowCredentials: (o.allowCredentials || []).map(function (c) { return { type: c.type, id: b64urlToBuf(c.id) }; })
      } });
    } catch (e) {
      throw new Error("No passkey was approved on this device. If you haven’t added this phone yet, see the steps below.");
    }
    var fin = await api("/admin/webauthn/auth/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: as.id, response: { clientDataJSON: bufToB64url(as.response.clientDataJSON), authenticatorData: bufToB64url(as.response.authenticatorData), signature: bufToB64url(as.response.signature) } }) });
    if (!fin.ok || !fin.json || !fin.json.token) throw new Error((fin.json && fin.json.error) || "Sign-in failed.");
    localStorage.setItem(SS, fin.json.token);
    return true;
  }

  /* ---------- screens ---------- */
  function showError(msg, retryLabel, retry) {
    screen([brand(), h("div", { class: "card" }, [
      h("h1", { text: "Hmm." }), h("p", { class: "muted", text: msg }),
      retry ? btn(retryLabel || "Try again", "primary", retry) : null
    ])]);
  }
  async function runBtn(b, fn, onErr) {
    var label = b.textContent; b.disabled = true; b.textContent = "…";
    try { await fn(); } catch (e) { b.disabled = false; b.textContent = label; onErr((e && e.message) || "Something went wrong."); }
  }

  function showVerify(errMsg) {
    var b = btn("Verify with passkey", "primary");
    b.addEventListener("click", function () { runBtn(b, async function () { await authPasskey(); afterVerify(); }, function (m) { showVerify(m); }); });
    var kids = [
      h("h1", { text: "Verify it’s you" }),
      h("p", { class: "muted", text: "Approve with the passkey you added from your computer to open your requests." }),
      b
    ];
    if (errMsg) kids.push(h("div", { class: "note err", text: errMsg }));
    kids.push(addPasskeyHelp());
    screen([brand(), h("div", { class: "card" }, kids)]);
  }
  function addPasskeyHelp() {
    return h("details", { class: "help" }, [
      h("summary", { text: "No passkey on this phone?" }),
      h("div", { class: "muted small", html: "Passkeys are added from your computer — not here — so nobody can grant themselves access from a link.<br><br>On your computer, open <b>riteshk.work/studio</b> → sign in → open the <b>⋯</b> menu → <b>Passkeys</b> → <b>Add a passkey</b>, and pick <b>“Use a phone or tablet.”</b> Scan the code with this phone to save the passkey here, then come back and tap <b>Verify</b>." })
    ]);
  }
  async function afterVerify() {
    var subscribed = false;
    try { if (("serviceWorker" in navigator) && ("PushManager" in window)) { var reg = await navigator.serviceWorker.ready; subscribed = !!(await reg.pushManager.getSubscription()); } } catch (e) {}
    if (subscribed && isInstalled()) return openInbox();   // fully set up (push + Home Screen) → inbox
    return showOnboarding();                                 // else nudge notifications + Add to Home Screen
  }

  function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
  function isInstalled() { if (isStandalone()) return true; try { return localStorage.getItem(INST) === "1"; } catch (e) { return false; } }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1); }
  function shareSvg() {
    return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M12 3v11"/><path d="M8.5 6.5 12 3l3.5 3.5"/><path d="M7 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18.5 11H17"/></svg>';
  }
  function iosInstallCard() {
    return h("div", { class: "card", "data-ob": "1" }, [
      h("h1", { text: "Add me to your Home Screen" }),
      h("p", { class: "muted", text: "On iPhone, notifications only switch on once this app sits on your Home Screen \u2014 that\u2019s Apple\u2019s rule, not ours. Takes about 10 seconds:" }),
      step("1", "Tap Share in Safari", h("div", { class: "muted small", html: "the " + shareSvg() + " icon in Safari\u2019s toolbar." })),
      step("2", "Tap \u201cAdd to Home Screen\u201d", h("div", { class: "muted small", text: "scroll the share sheet down a little if you don\u2019t see it, then tap Add." })),
      step("3", "Open the \u201cRequests\u201d icon", h("div", { class: "muted small", text: "launch it from your Home Screen, verify once, then \u201cTurn on notifications.\u201d" })),
      h("p", { class: "muted small", text: "After that it behaves exactly like Android \u2014 a ping the moment a recruiter asks." }),
      btn("Look at requests first \u2192", "ghost", openInbox)
    ]);
  }
  function showOnboarding() {
    if (isIOS() && !isStandalone()) return screen([brand(), iosInstallCard()]);
    var inst = isInstalled();
    var relBlk = reliabilityBlock();
    var card = [
      h("h1", { text: inst ? "You’re all set 🎉" : (relBlk ? "Three quick steps" : "Two quick steps") }),
      h("p", { class: "muted", text: inst ? "Notifications on, and the app lives on your Home Screen — you’re good." : "So a recruiter request pings this phone even when the app is closed." }),
      step("1", "Turn on notifications", notifBlock()),
      step("2", inst ? "On your Home Screen ✓" : "Add to Home Screen", inst ? h("div", { class: "muted small", text: "Launch it from the Home Screen icon — it won’t get lost in browser tabs." }) : installBlock()),
      relBlk ? step("3", "Keep pings reliable", relBlk) : null,
      btn("Open my requests →", inst ? "primary" : "ghost", openInbox)
    ].filter(Boolean);
    screen([brand(), h("div", { class: "card", "data-ob": "1" }, card)]);
  }
  function step(n, title, body) {
    return h("div", { class: "step" }, [h("div", { class: "step__n", text: n }), h("div", { class: "step__b" }, [h("div", { class: "step__t", text: title }), body])]);
  }
  function installBlock() {
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return h("div", { class: "muted small", text: "Tap the Share icon, then “Add to Home Screen.”" });
    if (deferredInstall) {
      var ab = btn("Add to Home Screen", "primary");
      ab.addEventListener("click", function () { maybePromptInstall(); });
      return h("div", {}, [ab, h("div", { class: "muted small", text: "One tap — keeps the app on your Home Screen so it never gets lost in tabs." })]);
    }
    return h("div", { class: "muted small", text: "Tap Chrome’s ⋮ menu, then “Add to Home screen” / “Install app.”" });
  }
  function relItem(key, title, why, path) {
    var done = false; try { done = localStorage.getItem("rk:rel:" + key) === "1"; } catch (e) {}
    var cb = h("input", { type: "checkbox" }); cb.checked = done;
    var row = h("label", { class: "rel__row" + (done ? " rel__row--done" : "") }, [
      cb,
      h("div", { class: "rel__b" }, [
        h("div", { class: "rel__t", html: title }),
        h("div", { class: "rel__d muted small", text: why }),
        h("div", { class: "rel__p", text: path })
      ])
    ]);
    cb.addEventListener("change", function () {
      try { localStorage.setItem("rk:rel:" + key, cb.checked ? "1" : "0"); } catch (e) {}
      row.className = "rel__row" + (cb.checked ? " rel__row--done" : "");
    });
    return row;
  }
  // Android-only: the OEM battery/data/notification toggles that keep a push instant even when locked.
  // Mirrors the exact Settings paths; a tickable checklist (persisted) so setup feels finished.
  function reliabilityBlock() {
    if (isIOS()) return null;
    return h("div", { class: "rel" }, [
      h("div", { class: "muted small", html: "Android sleeps background apps \u2014 three toggles keep a ping instant even when locked. Long-press the app icon \u203a <b>App info</b>." }),
      relItem("batt", "Battery \u203a <b>Always allow</b>", "Lets the app wake while your phone sleeps.", "App battery usage"),
      relItem("data", "Mobile data \u203a <b>Background</b> + <b>Unrestricted</b>", "Pings arrive on data and in Data Saver.", "Mobile data & Wi-Fi"),
      relItem("alert", "Notifications \u203a <b>Default</b> + <b>Override Do Not Disturb</b>", "It rings and shows on the lock screen.", "Notifications")
    ]);
  }
  async function maybePromptInstall() {
    if (!isInstalled() && deferredInstall) {
      try { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; } catch (e) { /* needs a fresh gesture — keep the button so a tap can retry */ }
    }
    if (document.querySelector("[data-ob]")) showOnboarding();
  }
  function notifBlock() {
    var box = h("div", {});
    function set(kids) { box.innerHTML = ""; kids.forEach(function (c) { if (c) box.appendChild(c); }); }
    var hasPush = ("Notification" in window) && ("serviceWorker" in navigator) && ("PushManager" in window);
    if (!hasPush) { set([h("div", { class: "muted small", text: "This browser can’t receive push. On iPhone, add this app to your Home Screen first (Share → Add to Home Screen), then reopen it here." })]); return box; }
    if (Notification.permission === "denied") { set([h("div", { class: "muted small", text: "Notifications are blocked in settings — turn them on for this app to get pinged." })]); return box; }
    set([h("div", { class: "muted small", text: "Checking…" })]);
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (existing) {
      if (existing && Notification.permission === "granted") set([h("div", { class: "muted small", text: "On ✓ — you’ll get pinged on new requests." }), testBtn(box)]);
      else set([h("div", { class: "muted small", text: "Get a ping the moment a recruiter asks for access." }), enableBtn(box)]);
    }).catch(function () { set([h("div", { class: "muted small", text: "Get a ping the moment a recruiter asks for access." }), enableBtn(box)]); });
    return box;
  }
  function enableBtn(box) {
    var b = btn("Enable notifications", "ghost");
    b.addEventListener("click", function () { runBtn(b, subscribePush, function (m) { b.disabled = false; b.textContent = "Enable notifications"; noteErr(box, m); }); });
    return b;
  }
  function testBtn(box) {
    var b = btn("Send a test", "ghost");
    b.addEventListener("click", function () {
      runBtn(b, async function () {
        var r = await api("/inbox/test", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHdr()), body: "{}" });
        if (r.status === 401) { localStorage.removeItem(SS); return showVerify(); }
        if (!r.ok) throw new Error((r.json && r.json.error) || "Couldn’t send the test.");
        b.textContent = "Sent — check your phone ✓";
      }, function (m) { b.disabled = false; b.textContent = "Send a test"; noteErr(box, m); });
    });
    return b;
  }
  function noteErr(box, m) { var ex = box.querySelector(".note"); if (ex) ex.remove(); box.appendChild(h("div", { class: "note err", text: m })); }
  async function subscribePush() {
    var perm = Notification.permission;
    if (perm !== "granted") { try { perm = await Notification.requestPermission(); } catch (e) {} }
    if (perm !== "granted") throw new Error("Allow notifications to get pinged on new requests.");
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(b64urlToBuf(VAPID_PUBLIC)) });
    var r = await api("/inbox/subscribe", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHdr()), body: JSON.stringify({ subscription: sub.toJSON() }) });
    if (r.status === 401) { localStorage.removeItem(SS); showVerify(); return; }
    if (!r.ok) throw new Error((r.json && r.json.error) || "Couldn’t save the subscription.");
    await maybePromptInstall();  // notifications on - now offer Add to Home Screen (fires the install dialog)
  }
  // Push subscriptions rotate (e.g. after installing to the Home Screen, or when the browser refreshes them),
  // which silently leaves the server holding a dead endpoint (410). On every launch, quietly re-register the
  // current subscription so the server always has a live endpoint. Idempotent — the Worker dedupes by endpoint.
  async function ensurePush() {
    try {
      if (!(("Notification" in window) && ("serviceWorker" in navigator) && ("PushManager" in window))) return;
      if (Notification.permission !== "granted" || !sess()) return;
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(b64urlToBuf(VAPID_PUBLIC)) });
      if (!sub) return;
      await api("/inbox/subscribe", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHdr()), body: JSON.stringify({ subscription: sub.toJSON() }) });
    } catch (e) {}
  }

  var accessTab = "requests";     // requests | approved | curated
  var showDeclined = false;
  async function openInbox() {
    if (!pushEnsured) { pushEnsured = true; ensurePush(); }
    renderShell();
    loadTab();
  }
  function tabBtn(id, label) {
    var b = h("button", { class: "tab" + (accessTab === id ? " tab--on" : "") }, [label]);
    b.addEventListener("click", function () { if (accessTab !== id) { accessTab = id; showDeclined = false; } openInbox(); });
    return b;
  }
  // Persistent in-app nudge: the ONLY reason a request won't ping this phone is no live push
  // subscription. Show it right in the inbox (not just onboarding) until notifications are on.
  function notifNudge() {
    if (!(("Notification" in window) && ("serviceWorker" in navigator) && ("PushManager" in window))) return null;
    if (Notification.permission === "granted") return null;
    var denied = Notification.permission === "denied";
    var bar = h("div", { class: "nudge" }, [
      h("span", { class: "nudge__txt", text: denied
        ? "Notifications are blocked — turn them on for this app in your phone’s Settings to get pinged."
        : "Turn on notifications so new requests reach this phone even when the app is closed." })
    ]);
    if (!denied) {
      var b = h("button", { class: "nudge__btn" }, ["Enable"]);
      b.addEventListener("click", function () {
        b.disabled = true; b.textContent = "…";
        subscribePush().then(function () { toast("Notifications on ✓"); openInbox(); },
          function (m) { b.disabled = false; b.textContent = "Enable"; toast((m && m.message) || "Couldn’t enable — try again"); });
      });
      bar.appendChild(b);
    }
    return bar;
  }
  function renderShell() {
    screen([
      h("div", { class: "topbar" }, [brand(), h("div", { class: "topbar__acts" }, [
        h("button", { class: "iconbtn", title: "Notifications", onclick: showOnboarding, html: "&#128276;" }),
        h("button", { class: "iconbtn", title: "Refresh", onclick: loadTab, html: "&#8635;" })
      ])]),
      notifNudge(),
      h("div", { class: "tabs" }, [tabBtn("requests", "Requests"), tabBtn("approved", "Approved"), tabBtn("curated", "Curated")]),
      h("div", { class: "tabbody", id: "tabbody" }, [h("div", { class: "spinner" })])
    ].filter(Boolean));
  }
  function setBody(kids) { var el = document.getElementById("tabbody"); if (!el) return; el.innerHTML = ""; kids.forEach(function (k) { if (k) el.appendChild(k); }); }
  async function loadTab() {
    setBody([h("div", { class: "spinner" })]);
    if (accessTab === "requests") return loadRequests();
    return loadGrants();
  }
  async function loadRequests() {
    var r = await api("/admin/requests?status=" + (showDeclined ? "declined" : "pending"), { headers: authHdr() });
    if (r.status === 401) { localStorage.removeItem(SS); return showVerify(); }
    if (!r.ok) return setBody([h("div", { class: "note err", text: (r.json && r.json.error) || "Couldn\u2019t load." })]);
    var reqs = (r.json && r.json.requests) || [];
    var sw = h("label", { class: "switch" }, [h("input", { type: "checkbox" }), h("span", { text: "Show declined" })]);
    var cb = sw.querySelector("input"); if (showDeclined) cb.checked = true;
    cb.addEventListener("change", function () { showDeclined = cb.checked; loadTab(); });
    var kids = [sw];
    if (reqs.length) reqs.forEach(function (rq) { kids.push(reqCard(rq)); });
    else kids.push(h("div", { class: "empty" }, [h("p", { class: "muted", text: showDeclined ? "No declined requests." : "No pending requests. You\u2019re all caught up." })]));
    setBody(kids);
  }
  async function loadGrants() {
    var r = await api("/admin/access", { headers: authHdr() });
    if (r.status === 401) { localStorage.removeItem(SS); return showVerify(); }
    if (!r.ok) return setBody([h("div", { class: "note err", text: (r.json && r.json.error) || "Couldn\u2019t load." })]);
    var grants = (r.json && r.json.grants) || [];
    var curated = accessTab === "curated";
    var list = grants.filter(function (g) { return ((g.mode || "all") === "curated") === curated; });
    var kids = [];
    if (list.length) list.forEach(function (g) { kids.push(grantCard(g)); });
    else kids.push(h("div", { class: "empty" }, [h("p", { class: "muted", text: curated ? "No curated grants yet." : "No approved grants yet." })]));
    setBody(kids);
  }
  function reqCard(rq) {
    var declined = (rq.status === "declined");
    var acts = declined
      ? [actBtn("Delete", "warn", rq, "/admin/requests/delete", "Deleted")]
      : [actBtn("Approve", "primary", rq, "/admin/requests/allow", "Access sent \u2713"), curateBtn(rq), actBtn("Decline", "ghost", rq, "/admin/requests/decline", "Declined \u2713")];
    return h("div", { class: "req" }, [
      h("div", { class: "req__top" }, [
        h("div", {}, [h("span", { class: "req__name", text: rq.name || "Someone" }), rq.company ? h("span", { class: "req__co", text: " \u00b7 " + rq.company }) : false]),
        h("span", { class: "req__time", text: timeAgo(declined ? (rq.declinedAt || rq.at) : rq.at) })
      ]),
      rq.email ? h("a", { class: "req__email", href: "mailto:" + rq.email, text: rq.email }) : false,
      rq.context ? h("div", { class: "req__meta", text: "Wants: " + rq.context }) : false,
      rq.note ? h("div", { class: "req__note", text: "\u201c" + rq.note + "\u201d" }) : false,
      h("div", { class: "req__acts" }, acts)
    ]);
  }
  function actBtn(label, cls, rq, path, doneMsg) {
    var b = btn(label, cls);
    b.addEventListener("click", async function () {
      var card = b.closest(".req");                        // resolve at click time — the card ref isn't ready when actBtn is built
      var acts = card && card.querySelector(".req__acts");
      if (!acts) return;
      Array.prototype.forEach.call(acts.querySelectorAll("button"), function (x) { x.disabled = true; });
      b.textContent = "\u2026";
      var r = await api(path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHdr()), body: JSON.stringify({ id: rq.id }) });
      if (r.status === 401) { localStorage.removeItem(SS); return showVerify(); }
      if (!r.ok) {
        Array.prototype.forEach.call(acts.querySelectorAll("button"), function (x) { x.disabled = false; });
        b.textContent = label;
        var ex = card.querySelector(".note"); if (ex) ex.remove();
        card.appendChild(h("div", { class: "note err", text: (r.json && r.json.error) || "Failed \u2014 try again." }));
        return;
      }
      card.classList.add("done");
      acts.replaceWith(h("div", { class: "req__done", text: doneMsg }));
    });
    return b;
  }
  function curateBtn(rq) {
    var b = btn("Curate\u2026", "ghost");
    b.addEventListener("click", function () { curateScreen(rq); });
    return b;
  }
  // Phone-friendly curation: scope exactly what a recruiter sees, then POST /admin/requests/curate
  // (mints a scoped /?k= link + emails it). Mirrors the studio's simplified foldable dialog.
  async function curateScreen(rq) {
    screen([brand(), h("div", { class: "card" }, [h("div", { class: "spinner" }), h("p", { class: "muted", style: "text-align:center;margin:2px 0 0", text: "Loading your content\u2026" })])]);
    var content;
    try { content = await (await fetch("/content.json?cb=" + Date.now(), { cache: "no-cache" })).json(); }
    catch (e) { return screen([brand(), h("div", { class: "card" }, [h("h1", { text: "Hmm." }), h("p", { class: "muted", text: "Couldn\u2019t load your content \u2014 check your connection and try again." }), btn("Back to requests", "primary", openInbox)])]); }
    var works = content.work || [], highs = content.highlights || [], caps = content.capabilities || [];
    var wItems = works.map(function (w, i) { return { val: w.id, label: (w.client || w.title || ("Work " + (i + 1))) }; });
    var hItems = highs.map(function (hh, i) { return { val: i, label: ((hh.value || "") + " \u00b7 " + (hh.label || "")) }; });
    var cItems = caps.map(function (c, i) { return { val: i, label: String(c) }; });
    function grp(title, hint, open, items, defOn) {
      var grid = h("div", { class: "curgrp__grid" }, items.map(function (it) {
        var cb = h("input", { type: "checkbox" }); cb.checked = defOn; it.cb = cb;
        return h("label", { class: "curchk" }, [cb, h("span", { text: it.label })]);
      }));
      var sum = h("summary", {}, [h("span", { text: title }), h("span", { class: "curgrp__hint", text: hint })]);
      return h("details", open ? { open: "", class: "curgrp" } : { class: "curgrp" }, [sum, grid]);
    }
    function pick(items) { return items.filter(function (it) { return it.cb && it.cb.checked; }).map(function (it) { return it.val; }); }
    var daysIn = h("input", { type: "number", min: "0", step: "1", value: "15", class: "curdays__in" });
    var errBox = h("div", {});
    var go = btn("Send curated access \u2192", "primary");
    go.addEventListener("click", function () {
      errBox.innerHTML = "";
      runBtn(go, async function () {
        var days = parseInt(daysIn.value, 10); if (!(days >= 0)) days = 15;
        var r = await api("/admin/requests/curate", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHdr()), body: JSON.stringify({ id: rq.id, workIds: pick(wItems), highlightIdx: pick(hItems), capabilityIdx: pick(cItems), days: days }) });
        if (r.status === 401) { localStorage.removeItem(SS); return showVerify(); }
        if (!r.ok) throw new Error((r.json && r.json.error) || "Couldn\u2019t curate \u2014 try again.");
        toast("Curated access emailed \u2713");
        accessTab = "curated"; openInbox();
      }, function (m) { errBox.appendChild(h("div", { class: "note err", text: m })); });
    });
    screen([brand(), h("div", { class: "card" }, [
      h("h1", { text: rq.name ? ("Curate for " + rq.name) : "Curate access" }),
      h("p", { class: "muted small", text: "Pick exactly what they see \u2014 the rest of your site stays out of their view. They get a private, expiring link." }),
      grp("Work shown", "none = all work", true, wItems, false),
      grp("Numbers shown", "all by default", false, hItems, true),
      grp("Capabilities shown", "all by default", false, cItems, true),
      h("div", { class: "curdays" }, [h("label", {}, [h("span", { text: "Link lasts" }), daysIn, h("span", { text: "days (0 = no expiry)" })])]),
      go, errBox,
      btn("Cancel", "ghost", openInbox)
    ])]);
  }
  function toast(msg) {
    var t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.classList.add("toast--in"); }, 10);
    setTimeout(function () { t.classList.remove("toast--in"); setTimeout(function () { t.remove(); }, 300); }, 1600);
  }
  function copyText(t) { try { navigator.clipboard.writeText(t).then(function () { toast("Copied"); }, function () { toast("Copy failed"); }); } catch (e) { toast("Copy failed"); } }
  function gbtn(label, cls, on) { var b = btn(label, cls); b.addEventListener("click", on); return b; }
  function grantCard(g) {
    var daysLeft = g.expiresAt ? Math.max(0, Math.ceil((g.expiresAt - Date.now()) / 86400000)) : null;
    var link = "https://riteshk.work/?k=" + g.token;
    var meta = "Opened " + (g.uses || 0) + "\u00d7" + (g.mode === "curated" ? " \u00b7 curated" : "") + (g.days ? " \u00b7 " + g.days + "d" : "");
    return h("div", { class: "req" + (g.revoked ? " req--off" : "") }, [
      h("div", { class: "req__top" }, [
        h("div", {}, [h("span", { class: "req__name", text: g.name || g.email || "Recruiter" }), g.company ? h("span", { class: "req__co", text: " \u00b7 " + g.company }) : false]),
        h("span", { class: "req__time", text: g.revoked ? "Revoked" : (daysLeft != null ? daysLeft + "d left" : "") })
      ]),
      g.email ? h("a", { class: "req__email", href: "mailto:" + g.email, text: g.email }) : false,
      h("div", { class: "req__meta", text: meta }),
      h("div", { class: "req__acts" }, [
        gbtn("Copy link", "ghost", function () { copyText(link); }),
        gbtn("Duration", "ghost", function () { var d = prompt("Days this link stays live (1\u2013365):", g.days || 15); if (d && parseInt(d, 10) > 0) setGrant(g.token, { days: parseInt(d, 10) }); }),
        gbtn(g.revoked ? "Restore" : "Revoke", g.revoked ? "primary" : "warn", function () { setGrant(g.token, { revoke: !g.revoked }); }),
        gbtn("Delete", "ghost", function () { if (confirm("Delete this grant permanently?")) setGrant(g.token, { delete: true }); })
      ])
    ]);
  }
  async function setGrant(token, body) {
    var r = await api("/admin/access", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHdr()), body: JSON.stringify(Object.assign({ token: token }, body)) });
    if (r.status === 401) { localStorage.removeItem(SS); return showVerify(); }
    if (!r.ok) { toast((r.json && r.json.error) || "Failed"); return; }
    toast("Updated"); loadTab();
  }

  /* ---------- init ---------- */
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/inbox/sw.js").catch(function () {});
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferredInstall = e; if (document.querySelector("[data-ob]")) showOnboarding(); });
  window.addEventListener("appinstalled", function () { try { localStorage.setItem(INST, "1"); } catch (e) {} deferredInstall = null; if (document.querySelector("[data-ob]")) showOnboarding(); });

  (function init() {
    if (!window.PublicKeyCredential || !(navigator.credentials && navigator.credentials.get)) {
      return showError("This browser doesn’t support passkeys. Open riteshk.work/inbox in Chrome (Android) or Safari (iOS 16.4+).");
    }
    // Strip any legacy ?pair token from an old QR — enrolment happens only in the desktop studio now.
    if (new URLSearchParams(location.search).get("pair")) { try { history.replaceState({}, "", "/inbox/"); } catch (e) {} }
    if (sess()) return openInbox();
    return showVerify();
  })();
})();
