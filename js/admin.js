/* =================================================================
   ADMIN MODE — private, client-side content editor.
   Trigger: click the nav clock. Gated by a passphrase (hashed in
   this browser). Edits live-preview + save to a localStorage draft.
   Publishing = download content.json + clipboard + open GitHub editor.
   NOTE: the passphrase is a deterrent only — the real lock is that
   the live site changes only when content.json is committed.
   ================================================================= */
(function () {
  "use strict";

  const HASH_KEY = "rk:admin:hash";
  const SESSION_KEY = "rk:admin:session";
  const DRAFT_KEY = "rk:content:draft";
  const EDIT_URL = "https://github.com/riteshkumarhk/riteshk.work/edit/main/content.json";

  let data = null;
  let activeTab = "landing";
  let root = null, body = null;
  let saveTimer = null;

  const TABS = [
    ["landing", "Landing"],
    ["highlights", "Highlights"],
    ["capabilities", "Capabilities"],
    ["work", "Work"],
    ["path", "Path"],
    ["recognition", "Recognition"],
    ["education", "Education"],
    ["contact", "Contact"],
  ];
  const THEMES = ["edge", "auth", "search", "auto", "grid"];

  /* ---------- utils ---------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const escHtml = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escAttr = (s) => escHtml(s).replace(/"/g, "&quot;");

  async function sha256(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  function setPath(obj, path, val) {
    const keys = path.split(".");
    const last = keys.pop();
    let o = obj;
    keys.forEach((k) => { if (o[k] == null) o[k] = {}; o = o[k]; });
    o[last] = val;
  }

  /* ---------- live preview + persist ---------- */
  function apply(immediate) {
    window.RK.render(data);
    forceReveal();
    clearTimeout(saveTimer);
    const save = () => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) {}
      status("Draft saved locally");
    };
    if (immediate) save();
    else saveTimer = setTimeout(save, 400);
  }

  function forceReveal() {
    document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-in"));
    document.querySelectorAll(".hero__title .line, .contact__mail-line").forEach((el) => el.classList.add("is-in"));
    document.querySelectorAll(".count").forEach((c) => { c.textContent = c.dataset.count; });
  }

  function status(msg, ok) {
    const s = root && root.querySelector(".admin__status");
    if (s) { s.textContent = msg; s.classList.toggle("ok", !!ok); }
  }

  /* ---------- field builders ---------- */
  function input(label, path, opts) {
    opts = opts || {};
    const val = getPath(data, path);
    const hint = opts.hint ? '<div class="af__hint">' + escHtml(opts.hint) + "</div>" : "";
    let control;
    if (opts.type === "textarea") {
      control = '<textarea data-path="' + path + '" rows="' + (opts.rows || 3) + '">' + escHtml(val) + "</textarea>";
    } else {
      control = '<input type="text" data-path="' + path + '" value="' + escAttr(val) + '" />';
    }
    return '<div class="af"><label class="af__label">' + label + "</label>" + control + hint + "</div>";
  }

  // item field: edits data[list][index][field]
  function itemField(list, index, field, label, opts) {
    opts = opts || {};
    const val = (data[list][index] || {})[field];
    const attrs = 'data-list="' + list + '" data-index="' + index + '" data-field="' + field + '"';
    let control;
    if (opts.type === "textarea") {
      control = "<textarea " + attrs + ' rows="' + (opts.rows || 2) + '">' + escHtml(val) + "</textarea>";
    } else {
      control = '<input type="text" ' + attrs + ' value="' + escAttr(val) + '" />';
    }
    const hint = opts.hint ? '<div class="af__hint">' + escHtml(opts.hint) + "</div>" : "";
    return '<div class="af"><label class="af__label">' + label + "</label>" + control + hint + "</div>";
  }

  function ops(list, i, len) {
    return (
      '<div class="card__ops">' +
      '<button class="iconbtn" data-act="up" data-list="' + list + '" data-index="' + i + '"' + (i === 0 ? " disabled" : "") + ' title="Move up">↑</button>' +
      '<button class="iconbtn" data-act="down" data-list="' + list + '" data-index="' + i + '"' + (i === len - 1 ? " disabled" : "") + ' title="Move down">↓</button>' +
      '<button class="iconbtn iconbtn--danger" data-act="remove" data-list="' + list + '" data-index="' + i + '" title="Remove">✕</button>' +
      "</div>"
    );
  }

  function cardHead(idxLabel, list, i, len) {
    return '<div class="card__bar"><span class="card__idx">' + idxLabel + "</span>" + ops(list, i, len) + "</div>";
  }

  function addBtn(list, label) {
    return '<button class="btn btn--add" data-act="add" data-list="' + list + '">+ ' + label + "</button>";
  }

  /* ---------- section renderers ---------- */
  const sections = {
    landing() {
      return (
        secHead("Landing", "The first screen. Markdown: <em>*word*</em> = accent italic, <em>**word**</em> = bold, <em>[[word]]</em> = bronze.") +
        input("Eyebrow", "landing.eyebrow") +
        input("Domains", "landing.domains", { hint: "e.g. Growth · AI · Identity" }) +
        input("Main statement", "landing.statement", { type: "textarea", rows: 3, hint: "One line per row. Use *word* for the accent." }) +
        input("Description", "landing.intro", { type: "textarea", rows: 4, hint: "**bold** and [[bronze]] supported." }) +
        input("Footer line", "landing.presence", { hint: "e.g. Currently at Microsoft — Hyderabad, India" })
      );
    },
    contact() {
      return (
        secHead("Contact", "Used across the contact section, menu and footer.") +
        input("Email", "contact.email") +
        '<div class="af__row">' +
        input("Phone (display)", "contact.phone") +
        input("Phone (dial)", "contact.phoneRaw", { hint: "no spaces, e.g. +918197809767" }) +
        "</div>" +
        input("LinkedIn URL", "contact.linkedin") +
        input("Website URL", "contact.website")
      );
    },
    highlights() {
      const list = data.highlights || [];
      let html = secHead("Highlights", "The numbers after the reel. Up to 8 (stack 4×2). Values like <em>11+</em>, <em>Billions</em>, <em>2B+</em> — leading digits count up.");
      list.forEach((h, i) => {
        html += '<div class="card">' + cardHead("Highlight " + (i + 1), "highlights", i, list.length) +
          '<div class="af__row">' + itemField("highlights", i, "value", "Value") + itemField("highlights", i, "label", "Label") + "</div></div>";
      });
      if (list.length < 8) html += addBtn("highlights", "Add highlight");
      return html;
    },
    capabilities() {
      const list = data.capabilities || [];
      let html = secHead("Capabilities", "Drives the Capabilities list AND the scrolling reel.");
      list.forEach((c, i) => {
        html += '<div class="card"><div class="card__bar" style="margin-bottom:.5rem"><span class="card__idx">' + (i + 1) + "</span>" + ops("capabilities", i, list.length) + "</div>" +
          '<input type="text" data-list="capabilities" data-index="' + i + '" data-scalar="1" value="' + escAttr(c) + '" /></div>';
      });
      html += addBtn("capabilities", "Add capability");
      return html;
    },
    work() {
      const list = data.work || [];
      const featured = list.filter((w) => w.featured).length;
      let html = secHead("Selected Work", "Add any number. Tick up to 4 to feature on the homepage (currently " + featured + "/4).");
      list.forEach((w, i) => {
        html += '<div class="card">' + cardHead(w.client || "Work " + (i + 1), "work", i, list.length) +
          '<label class="chk" style="margin-bottom:.7rem"><input type="checkbox" data-act="feature" data-index="' + i + '"' + (w.featured ? " checked" : "") + " /> Feature on homepage</label>" +
          '<div class="af__row">' +
          '<div class="af"><label class="af__label">Theme</label><select data-list="work" data-index="' + i + '" data-field="theme">' +
          THEMES.map((t) => '<option value="' + t + '"' + (w.theme === t ? " selected" : "") + ">" + t + "</option>").join("") +
          "</select></div>" +
          itemField("work", i, "plateTag", "Plate tag") +
          "</div>" +
          '<div class="af__row">' + itemField("work", i, "client", "Client") + itemField("work", i, "period", "Period") + "</div>" +
          itemField("work", i, "title", "Title") +
          itemField("work", i, "desc", "Description", { type: "textarea", rows: 3 }) +
          itemField("work", i, "tags", "Tags", { hint: "comma-separated" }) +
          "</div>";
      });
      html += addBtn("work", "Add work");
      return html;
    },
    path() {
      const list = data.path || [];
      let html = secHead("The Path", "Your experience timeline.");
      list.forEach((p, i) => {
        html += '<div class="card">' + cardHead(p.role || "Role " + (i + 1), "path", i, list.length) +
          '<div class="af__row">' + itemField("path", i, "years", "Years") +
          '<div class="af"><label class="af__label">Present</label><label class="chk" style="padding-top:.4rem"><input type="checkbox" data-act="present" data-index="' + i + '"' + (p.present ? " checked" : "") + " /> I work here now</label></div>" +
          "</div>" +
          itemField("path", i, "role", "Role") +
          itemField("path", i, "org", "Organisation") +
          itemField("path", i, "desc", "Description", { type: "textarea", rows: 3 }) +
          "</div>";
      });
      html += addBtn("path", "Add experience");
      return html;
    },
    recognition() {
      return titleMetaList("recognition", "Recognition", "Awards, talks and honours.");
    },
    education() {
      return titleMetaList("education", "Education", "Degrees and schooling.");
    },
  };

  function titleMetaList(list, name, note) {
    const items = data[list] || [];
    let html = secHead(name, note);
    items.forEach((a, i) => {
      html += '<div class="card">' + cardHead(name + " " + (i + 1), list, i, items.length) +
        itemField(list, i, "title", "Title") + itemField(list, i, "meta", "Meta / date") + "</div>";
    });
    html += addBtn(list, "Add " + name.toLowerCase());
    return html;
  }

  function secHead(title, note) {
    return '<div class="admin__sec-title">' + title + '</div><div class="admin__sec-note">' + note + "</div>";
  }

  function renderBody() {
    body.innerHTML = sections[activeTab]();
    root.querySelectorAll(".admin__tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === activeTab));
  }

  /* ---------- blank templates ---------- */
  function blank(list) {
    switch (list) {
      case "highlights": return { value: "0+", label: "New metric" };
      case "capabilities": return "New capability";
      case "work": return { id: "w" + Date.now(), featured: false, theme: "grid", plateTag: "Tag", client: "Client", period: "Year", title: "Project title", desc: "What you did and the impact.", tags: ["Tag"] };
      case "path": return { years: "Year", present: false, role: "Role", org: "Organisation", desc: "What you did." };
      case "recognition":
      case "education": return { title: "New entry", meta: "" };
      default: return {};
    }
  }

  /* ---------- events ---------- */
  function onInput(e) {
    const t = e.target;
    if (t.dataset.path) { setPath(data, t.dataset.path, t.value); apply(); return; }
    if (t.dataset.list && t.dataset.scalar) { data[t.dataset.list][+t.dataset.index] = t.value; apply(); return; }
    if (t.dataset.list && t.dataset.field) {
      let v = t.value;
      if (t.dataset.field === "tags") v = t.value.split(",").map((x) => x.trim()).filter(Boolean);
      data[t.dataset.list][+t.dataset.index][t.dataset.field] = v;
      apply();
    }
  }

  function onChange(e) {
    const t = e.target;
    if (t.dataset.act === "feature") {
      const i = +t.dataset.index;
      if (t.checked && data.work.filter((w) => w.featured).length >= 4) {
        t.checked = false;
        status("Only 4 works can be featured — unfeature one first");
        return;
      }
      data.work[i].featured = t.checked;
      apply(true);
      renderBody();
    } else if (t.dataset.act === "present") {
      data.path[+t.dataset.index].present = t.checked;
      apply(true);
    } else if (t.tagName === "SELECT") {
      data[t.dataset.list][+t.dataset.index][t.dataset.field] = t.value;
      apply(true);
    }
  }

  function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act, list = b.dataset.list, i = +b.dataset.index;
    if (act === "add") { data[list].push(blank(list)); apply(true); renderBody(); }
    else if (act === "remove") { data[list].splice(i, 1); apply(true); renderBody(); }
    else if (act === "up" && i > 0) { const a = data[list]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; apply(true); renderBody(); }
    else if (act === "down" && i < data[list].length - 1) { const a = data[list]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; apply(true); renderBody(); }
  }

  /* ---------- publish / revert ---------- */
  function publish() {
    const json = JSON.stringify(data, null, 2);
    try {
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "content.json";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {}
    if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {});
    window.open(EDIT_URL, "_blank", "noopener");
    status("Downloaded + copied. Paste into the GitHub tab and Commit to publish.", true);
  }

  function revert() {
    if (!confirm("Discard local changes and reload the published content?")) return;
    localStorage.removeItem(DRAFT_KEY);
    location.reload();
  }

  /* ---------- open / close ---------- */
  function buildPanel() {
    root = document.createElement("div");
    root.className = "admin";
    root.innerHTML =
      '<div class="admin__scrim" data-close></div>' +
      '<aside class="admin__panel" role="dialog" aria-label="Content editor">' +
      '<div class="admin__head"><div class="admin__brand"><b>Admin</b><span>content editor</span></div>' +
      '<button class="admin__close" data-close aria-label="Close">✕</button></div>' +
      '<div class="admin__tabs">' + TABS.map((t) => '<button class="admin__tab" data-tab="' + t[0] + '">' + t[1] + "</button>").join("") + "</div>" +
      '<div class="admin__body"></div>' +
      '<div class="admin__foot"><span class="admin__status">Editing local draft</span>' +
      '<button class="btn btn--ghost" data-revert>Revert</button>' +
      '<button class="btn btn--primary" data-publish>Publish</button></div>' +
      "</aside>";
    document.body.appendChild(root);
    body = root.querySelector(".admin__body");

    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    root.addEventListener("click", onClick);
    root.querySelectorAll(".admin__tab").forEach((t) =>
      t.addEventListener("click", () => { activeTab = t.dataset.tab; renderBody(); })
    );
    root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", close));
    root.querySelector("[data-publish]").addEventListener("click", publish);
    root.querySelector("[data-revert]").addEventListener("click", revert);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root.classList.contains("is-open")) close(); });
  }

  function open() {
    data = clone(window.RK.data);
    if (!root) buildPanel();
    renderBody();
    requestAnimationFrame(() => root.classList.add("is-open"));
  }
  function close() { if (root) root.classList.remove("is-open"); }

  /* ---------- passphrase gate ---------- */
  function gate() {
    if (sessionStorage.getItem(SESSION_KEY) === "1") return open();
    const stored = localStorage.getItem(HASH_KEY);
    const creating = !stored;
    const modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">' + (creating ? "Set admin passphrase" : "Admin") + "</div>" +
      '<div class="pass__sub">' + (creating
        ? "Create a passphrase for this browser. (It only guards this editor — publishing still requires your repo.)"
        : "Enter your passphrase to edit the site.") + "</div>" +
      '<input type="password" placeholder="Passphrase" autofocus />' +
      (creating ? '<input type="password" placeholder="Confirm passphrase" data-confirm />' : "") +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button>' +
      '<button class="btn btn--primary" data-go>' + (creating ? "Create" : "Enter") + "</button></div></div>";
    document.body.appendChild(modal);
    const pass = modal.querySelector('input[type="password"]');
    const confirm2 = modal.querySelector("[data-confirm]");
    const err = modal.querySelector(".pass__err");
    pass.focus();

    const done = () => modal.remove();
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    modal.addEventListener("click", (e) => { if (e.target === modal) done(); });

    async function submit() {
      const val = pass.value;
      if (!val) { err.textContent = "Enter a passphrase"; return; }
      if (creating) {
        if (val.length < 4) { err.textContent = "Use at least 4 characters"; return; }
        if (confirm2 && confirm2.value !== val) { err.textContent = "Passphrases don't match"; return; }
        localStorage.setItem(HASH_KEY, await sha256(val));
        sessionStorage.setItem(SESSION_KEY, "1");
        done(); open();
      } else {
        if ((await sha256(val)) === stored) {
          sessionStorage.setItem(SESSION_KEY, "1");
          done(); open();
        } else { err.textContent = "Incorrect passphrase"; }
      }
    }
    modal.querySelector("[data-go]").addEventListener("click", submit);
    modal.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") done(); });
  }

  /* ---------- bootstrap ---------- */
  function init() {
    const clock = document.getElementById("clock");
    if (clock) clock.addEventListener("click", gate);
  }
  if (window.__siteRendered) init();
  else document.addEventListener("site:rendered", init, { once: true });
})();
