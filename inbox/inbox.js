/* Riteshk Requests PWA — passkey-gated inbox for recruiter access requests.
   Standalone page (NOT part of the esbuild bundle). Talks to the Cloudflare Worker.
   Flow: QR ?pair -> enrol a passkey on THIS phone -> onboarding -> request list.
   Returning visits: passkey sign-in -> request list. Every action is passkey-session gated. */
(function () {
  "use strict";
  var WORKER = "https://rk-ai-proxy.riteshkumarhk.workers.dev";
  var SS = "rk:inbox:sess";
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
    if (subscribed) return openInbox();   // already set up for push → straight to the inbox
    return showOnboarding();               // otherwise guide notifications + install first
  }

  function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
  function showOnboarding() {
    var installed = isStandalone();
    screen([brand(), h("div", { class: "card", "data-ob": "1" }, [
      h("h1", { text: "Two quick steps" }),
      h("p", { class: "muted", text: "So a recruiter request pings this phone even when the app is closed." }),
      step("1", "Turn on notifications", notifBlock()),
      step("2", installed ? "Added to Home Screen ✓" : "Add to Home Screen", installed ? h("div", { class: "muted small", text: "Done — you’ll get an app icon too." }) : installBlock()),
      btn("Open my requests →", "primary", openInbox)
    ])]);
  }
  function step(n, title, body) {
    return h("div", { class: "step" }, [h("div", { class: "step__n", text: n }), h("div", { class: "step__b" }, [h("div", { class: "step__t", text: title }), body])]);
  }
  function installBlock() {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      var wrap = h("div", {}, [h("div", { class: "muted small", text: ios ? "Tap the Share icon, then “Add to Home Screen.”" : "Tap Chrome’s ⋮ menu, then “Add to Home screen” / “Install app.”" })]);
    if (deferredInstall) {
      var ib = btn("Install", "ghost");
      ib.addEventListener("click", async function () { try { deferredInstall.prompt(); await deferredInstall.userChoice; } catch (e) {} deferredInstall = null; ib.remove(); });
      wrap.appendChild(ib);
    }
    return wrap;
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
    showOnboarding();
  }

  async function openInbox() {
    screen([brand(), h("div", { class: "card" }, [h("div", { class: "spinner" }), h("p", { class: "muted", text: "Loading requests…" })])]);
    var r = await api("/admin/requests", { headers: authHdr() });
    if (r.status === 401) { localStorage.removeItem(SS); return showVerify(); }
    if (!r.ok) return showError((r.json && r.json.error) || "Couldn’t load requests.", "Try again", openInbox);
    renderInbox((r.json && r.json.requests) || []);
  }
  function renderInbox(reqs) {
    var body = reqs.length
      ? h("div", { class: "list" }, reqs.map(reqCard))
      : h("div", { class: "empty" }, [h("p", { class: "muted", text: "No pending requests. You’re all caught up." })]);
    screen([
      h("div", { class: "topbar" }, [brand(), h("div", { class: "topbar__acts" }, [
        h("button", { class: "iconbtn", title: "Notifications", onclick: showOnboarding, html: "&#128276;" }),
        h("button", { class: "iconbtn", title: "Refresh", onclick: openInbox, html: "&#8635;" })
      ])]),
      body
    ]);
  }
  function reqCard(rq) {
    var card = h("div", { class: "req" }, [
      h("div", { class: "req__top" }, [
        h("div", {}, [h("span", { class: "req__name", text: rq.name || "Someone" }), rq.company ? h("span", { class: "req__co", text: " · " + rq.company }) : false]),
        h("span", { class: "req__time", text: timeAgo(rq.at) })
      ]),
      rq.email ? h("a", { class: "req__email", href: "mailto:" + rq.email, text: rq.email }) : false,
      rq.context ? h("div", { class: "req__meta", text: "Wants: " + rq.context }) : false,
      rq.note ? h("div", { class: "req__note", text: "“" + rq.note + "”" }) : false,
      h("div", { class: "req__acts" }, [
        actBtn("Allow", "primary", rq, "/admin/requests/allow", card, "Access sent ✓"),
        actBtn("Decline", "warn", rq, "/admin/requests/decline", card, "Declined ✓"),
        actBtn("Dismiss", "ghost", rq, "/admin/requests/delete", card, "Dismissed")
      ])
    ]);
    return card;
  }
  function actBtn(label, cls, rq, path, card, doneMsg) {
    var b = btn(label, cls);
    b.addEventListener("click", async function () {
      var acts = card.querySelector(".req__acts");
      Array.prototype.forEach.call(acts.querySelectorAll("button"), function (x) { x.disabled = true; });
      b.textContent = "…";
      var r = await api(path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHdr()), body: JSON.stringify({ id: rq.id }) });
      if (r.status === 401) { localStorage.removeItem(SS); return showVerify(); }
      if (!r.ok) {
        Array.prototype.forEach.call(acts.querySelectorAll("button"), function (x) { x.disabled = false; });
        b.textContent = label;
        var ex = card.querySelector(".note"); if (ex) ex.remove();
        card.appendChild(h("div", { class: "note err", text: (r.json && r.json.error) || "Failed — try again." }));
        return;
      }
      card.classList.add("done");
      acts.replaceWith(h("div", { class: "req__done", text: doneMsg }));
    });
    return b;
  }

  /* ---------- init ---------- */
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/inbox/sw.js").catch(function () {});
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferredInstall = e; if (document.querySelector("[data-ob]")) showOnboarding(); });

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
