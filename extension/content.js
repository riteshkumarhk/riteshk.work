/* Résumé Autofill — on-page widget (content script).
   Renders a draggable floating button + panel, an inline "⚡ Autofill" chip
   near text fields, and handles insert requests from the right-click menu. */
(function () {
  "use strict";

  if (window.__afLoaded) return;
  window.__afLoaded = true;

  var Store = window.AFStore;
  var Insert = window.AFInsert;
  if (!Store || !Insert) return;

  var data = null;
  var mode = "full"; // active Full/Snippet mode in the panel
  var appendMode = false;
  var ui = {};

  var host, shadow, fab, panel, chip, toastEl;
  var chipFor = null; // the field the chip is attached to

  /* ---------- text builders ---------- */
  function pick(primary, fallback) {
    primary = (primary || "").trim();
    return primary || (fallback || "").trim();
  }
  function summaryText(m) {
    return m === "snippet" ? pick(data.summary.snippet, data.summary.full) : pick(data.summary.full, data.summary.snippet);
  }
  function experienceText(exp, m) {
    return m === "snippet" ? pick(exp.snippet, exp.full) : pick(exp.full, exp.snippet);
  }
  function experiencesText(m) {
    return (data.experiences || [])
      .map(function (e) {
        var head = [e.role, e.company].filter(Boolean).join(" — ");
        var dates = [e.start, e.end].filter(Boolean).join(" – ");
        if (head && dates) head += "  (" + dates + ")";
        var body = experienceText(e, m);
        return (head ? head + "\n" : "") + body;
      })
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean)
      .join("\n\n");
  }
  function skillsText(m) {
    var base = m === "snippet" ? pick(data.skills.snippet, data.skills.full) : pick(data.skills.full, data.skills.snippet);
    if (base) return base;
    return (data.skills.list || []).filter(Boolean).join(", ");
  }
  function blockText(block, m) {
    if (block === "summary") return summaryText(m);
    if (block === "experience") return experiencesText(m);
    if (block === "skills") return skillsText(m);
    return "";
  }

  /* ---------- insertion ---------- */
  function doInsert(text, label) {
    if (!text) {
      toast("Nothing saved for “" + label + "” yet.");
      return;
    }
    var el = Insert.target();
    if (!el) {
      copy(text);
      toast("No field focused — copied to clipboard. Click a field and paste.");
      return;
    }
    Insert.insertInto(el, text, appendMode ? "append" : "replace");
    toast((appendMode ? "Appended " : "Inserted ") + label + " (" + mode + ")");
  }

  function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)["catch"](function () {
          legacyCopy(text);
        });
        return;
      }
    } catch (e) {}
    legacyCopy(text);
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) {}
  }

  /* ---------- contact autofill ---------- */
  function autofillContact() {
    if (!data) return;
    var p = data.profile;
    var nameParts = (p.name || "").trim().split(/\s+/);
    var first = nameParts[0] || "";
    var last = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
    var fields = document.querySelectorAll("input, textarea");
    var filled = 0;
    fields.forEach(function (el) {
      if (!Insert.isEditable(el)) return;
      var hasValue = (el.value || "").trim();
      if (hasValue) return;
      var sig = Insert.fieldSignature(el);
      var type = (el.type || "").toLowerCase();
      var val = "";
      var isCompany = /company|organi[sz]ation|employer/.test(sig);
      if (type === "email" || /e-?mail/.test(sig)) val = p.email;
      else if (type === "tel" || /phone|mobile|contact number/.test(sig)) val = p.phone;
      else if (/linkedin/.test(sig)) val = p.links.linkedin;
      else if (/github/.test(sig)) val = p.links.github;
      else if (/portfolio|website|personal site|url/.test(sig)) val = p.links.portfolio || p.links.other;
      else if (/city|location|town/.test(sig)) val = p.location;
      else if (!isCompany && /(first|given)\s*name/.test(sig)) val = first;
      else if (!isCompany && /(last|family|sur)\s*name/.test(sig)) val = last;
      else if (!isCompany && /(full\s*name|your name|^name$|\bname\b)/.test(sig) && !/user|screen|file/.test(sig)) val = p.name;
      if (val) {
        Insert.insertInto(el, val, "replace");
        filled++;
      }
    });
    toast(filled ? "Filled " + filled + " contact field" + (filled > 1 ? "s" : "") : "No matching empty contact fields found.");
  }

  /* ---------- shadow UI ---------- */
  var CSS = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}",
    ".fab{position:fixed;right:20px;bottom:20px;width:46px;height:46px;border-radius:50%;",
    "background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;border:none;cursor:pointer;",
    "box-shadow:0 6px 20px rgba(79,70,229,.45);font-size:22px;line-height:1;z-index:2147483647;",
    "display:flex;align-items:center;justify-content:center;touch-action:none;transition:transform .12s}",
    ".fab:hover{transform:scale(1.06)}",
    ".panel{position:fixed;right:20px;bottom:76px;width:300px;max-height:70vh;overflow:auto;background:#fff;",
    "border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 16px 48px rgba(2,6,23,.28);z-index:2147483647;",
    "display:none;color:#0f172a}",
    ".panel.open{display:block}",
    ".ph{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #eef2f7;position:sticky;top:0;background:#fff;border-radius:14px 14px 0 0}",
    ".ph b{font-size:13px;font-weight:700;flex:1}",
    ".x{border:none;background:#f1f5f9;border-radius:8px;width:24px;height:24px;cursor:pointer;font-size:14px;color:#475569}",
    ".seg{display:flex;gap:4px;padding:10px 14px 4px}",
    ".seg button{flex:1;border:1px solid #e2e8f0;background:#fff;color:#334155;padding:6px 0;border-radius:9px;cursor:pointer;font-size:12px;font-weight:600}",
    ".seg button.on{background:#4f46e5;border-color:#4f46e5;color:#fff}",
    ".opt{display:flex;align-items:center;gap:8px;padding:2px 14px 8px;font-size:11.5px;color:#64748b}",
    ".opt button{border:1px solid #e2e8f0;background:#fff;border-radius:7px;padding:3px 8px;cursor:pointer;font-size:11px;color:#475569}",
    ".opt button.on{background:#eef2ff;border-color:#c7d2fe;color:#4338ca}",
    ".list{padding:6px 8px 10px}",
    ".row{display:block;width:100%;text-align:left;border:none;background:transparent;padding:9px 10px;border-radius:9px;cursor:pointer;color:#0f172a;font-size:13px}",
    ".row:hover{background:#f5f7ff}",
    ".row small{display:block;color:#94a3b8;font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".grp{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;padding:10px 12px 4px;font-weight:700}",
    ".foot{border-top:1px solid #eef2f7;padding:9px 12px;display:flex;gap:8px;align-items:center}",
    ".foot a{color:#4f46e5;font-size:12px;cursor:pointer;text-decoration:none;font-weight:600}",
    ".empty{padding:16px 14px;color:#64748b;font-size:12.5px;line-height:1.5}",
    ".chip{position:fixed;z-index:2147483646;background:#4f46e5;color:#fff;border:none;border-radius:999px;",
    "padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(79,70,229,.4);display:none}",
    ".chip.show{display:inline-flex;align-items:center;gap:5px}",
    ".toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#0f172a;color:#fff;",
    "padding:9px 14px;border-radius:10px;font-size:12.5px;z-index:2147483647;opacity:0;transition:opacity .2s;max-width:80vw;text-align:center}",
    ".toast.show{opacity:.97}"
  ].join("");

  function build() {
    host = document.createElement("div");
    host.id = "af-root";
    host.style.all = "initial";
    shadow = host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);

    fab = el("button", "fab", "⚡");
    fab.title = "Résumé Autofill";
    panel = el("div", "panel");
    chip = el("button", "chip", "⚡ Autofill");
    toastEl = el("div", "toast");
    shadow.append(fab, panel, chip, toastEl);
    (document.body || document.documentElement).appendChild(host);

    // Keep the page field focused when interacting with our UI.
    host.addEventListener("mousedown", function (e) {
      e.preventDefault();
    });

    wireFab();
    chip.addEventListener("click", function () {
      openPanel();
    });
    applyUi();
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderPanel() {
    if (!panel) return;
    panel.innerHTML = "";
    var head = el("div", "ph");
    head.appendChild(el("b", null, "Résumé Autofill"));
    var x = el("button", "x", "✕");
    x.addEventListener("click", closePanel);
    head.appendChild(x);
    panel.appendChild(head);

    var seg = el("div", "seg");
    ["full", "snippet"].forEach(function (m) {
      var b = el("button", mode === m ? "on" : null, m === "full" ? "Full" : "Snippet");
      b.addEventListener("click", function () {
        mode = m;
        persistMode();
        renderPanel();
      });
      seg.appendChild(b);
    });
    panel.appendChild(seg);

    var opt = el("div", "opt");
    opt.appendChild(document.createTextNode("Insert mode:"));
    var rep = el("button", !appendMode ? "on" : null, "Replace");
    var app = el("button", appendMode ? "on" : null, "Append");
    rep.addEventListener("click", function () {
      appendMode = false;
      renderPanel();
    });
    app.addEventListener("click", function () {
      appendMode = true;
      renderPanel();
    });
    opt.append(rep, app);
    panel.appendChild(opt);

    var hasAny =
      summaryText(mode) || experiencesText(mode) || skillsText(mode) || (data.experiences && data.experiences.length);
    if (!hasAny) {
      var empty = el("div", "empty");
      empty.innerHTML = "No résumé data yet. Open the widget’s <b>options</b> to add your summary, experiences and skills — or OCR a resume.";
      panel.appendChild(empty);
    } else {
      var list = el("div", "list");
      addRow(list, "Summary", preview(summaryText(mode)), function () {
        doInsert(summaryText(mode), "summary");
      });
      if (data.experiences && data.experiences.length) {
        addRow(list, "All experiences", data.experiences.length + " role" + (data.experiences.length > 1 ? "s" : ""), function () {
          doInsert(experiencesText(mode), "experiences");
        });
        list.appendChild(grp("Individual roles"));
        data.experiences.forEach(function (exp) {
          var title = [exp.role, exp.company].filter(Boolean).join(" — ") || "Experience";
          addRow(list, title, preview(experienceText(exp, mode)), function () {
            doInsert(experienceText(exp, mode), title);
          });
        });
      }
      addRow(list, "Skills", preview(skillsText(mode)), function () {
        doInsert(skillsText(mode), "skills");
      });
      if (data.custom && data.custom.length) {
        list.appendChild(grp("Custom"));
        data.custom.forEach(function (c) {
          var t = mode === "snippet" ? pick(c.snippet, c.full) : pick(c.full, c.snippet);
          addRow(list, c.label || "Custom", preview(t), function () {
            doInsert(t, c.label || "custom");
          });
        });
      }
      list.appendChild(grp("Quick"));
      addRow(list, "Auto-fill contact fields", "Name, email, phone, links", function () {
        autofillContact();
      });
      panel.appendChild(list);
    }

    var foot = el("div", "foot");
    var edit = el("a", null, "Edit / add résumé data");
    edit.addEventListener("click", function () {
      chrome.runtime.sendMessage({ type: "openOptions" });
    });
    foot.appendChild(edit);
    panel.appendChild(foot);
  }

  function grp(t) {
    return el("div", "grp", t);
  }
  function addRow(list, title, sub, fn) {
    var b = el("button", "row");
    b.appendChild(document.createTextNode(title));
    if (sub) b.appendChild(el("small", null, sub));
    b.addEventListener("click", fn);
    list.appendChild(b);
  }
  function preview(t) {
    t = (t || "").replace(/\s+/g, " ").trim();
    return t ? (t.length > 46 ? t.slice(0, 46) + "…" : t) : "— empty —";
  }

  function openPanel() {
    renderPanel();
    panel.classList.add("open");
  }
  function closePanel() {
    panel.classList.remove("open");
  }
  function togglePanel() {
    panel.classList.contains("open") ? closePanel() : openPanel();
  }

  /* ---------- FAB drag ---------- */
  function wireFab() {
    var down = false,
      moved = false,
      sx = 0,
      sy = 0,
      ox = 0,
      oy = 0;
    fab.addEventListener("pointerdown", function (e) {
      down = true;
      moved = false;
      sx = e.clientX;
      sy = e.clientY;
      var r = fab.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - sx,
        dy = e.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (moved) {
        var nx = Math.max(6, Math.min(window.innerWidth - 52, ox + dx));
        var ny = Math.max(6, Math.min(window.innerHeight - 52, oy + dy));
        fab.style.left = nx + "px";
        fab.style.top = ny + "px";
        fab.style.right = "auto";
        fab.style.bottom = "auto";
      }
    });
    fab.addEventListener("pointerup", function (e) {
      down = false;
      try {
        fab.releasePointerCapture(e.pointerId);
      } catch (er) {}
      if (!moved) {
        togglePanel();
      } else {
        var r = fab.getBoundingClientRect();
        ui.fab = { left: r.left, top: r.top };
        Store.setUi(ui);
        positionPanel();
      }
    });
  }

  function positionPanel() {
    if (ui.fab) {
      // open panel near the FAB
      panel.style.left = Math.max(6, Math.min(window.innerWidth - 306, ui.fab.left - 254)) + "px";
      panel.style.top = Math.max(6, ui.fab.top - 10) + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
  }

  function applyUi() {
    var op = (data && data.settings && data.settings.onPage) || {};
    fab.style.display = op.fab === false ? "none" : "flex";
    if (ui.fab) {
      fab.style.left = ui.fab.left + "px";
      fab.style.top = ui.fab.top + "px";
      fab.style.right = "auto";
      fab.style.bottom = "auto";
      positionPanel();
    }
  }

  /* ---------- inline chip ---------- */
  function maybeShowChip(elm) {
    if (!data || !data.settings.onPage.chip) return;
    if (!(elm && (elm.tagName === "TEXTAREA" || elm.isContentEditable))) {
      hideChip();
      return;
    }
    chipFor = elm;
    positionChip();
    chip.classList.add("show");
  }
  function positionChip() {
    if (!chipFor || !chipFor.isConnected) {
      hideChip();
      return;
    }
    var r = chipFor.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      hideChip();
      return;
    }
    chip.style.left = Math.max(6, Math.min(window.innerWidth - 96, r.right - 88)) + "px";
    chip.style.top = Math.max(6, r.top + 6) + "px";
  }
  function hideChip() {
    chip.classList.remove("show");
    chipFor = null;
  }

  document.addEventListener(
    "focusin",
    function (e) {
      maybeShowChip(e.target);
    },
    true
  );
  document.addEventListener(
    "focusout",
    function () {
      // small delay so a chip click (which we preventDefault) still works
      setTimeout(function () {
        if (document.activeElement !== chipFor) {
          /* keep chip if still in same field */
        }
      }, 0);
    },
    true
  );
  window.addEventListener(
    "scroll",
    function () {
      if (chipFor) positionChip();
    },
    true
  );
  window.addEventListener("resize", function () {
    if (chipFor) positionChip();
    if (ui.fab) positionPanel();
  });

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2600);
  }

  /* ---------- data + messaging ---------- */
  function persistMode() {
    if (data) {
      data.settings.defaultMode = mode;
      Store.saveData(data);
    }
  }

  async function refresh() {
    data = await Store.loadData();
    mode = (data.settings && data.settings.defaultMode) || "full";
    ui = await Store.getUi();
    if (panel && panel.classList.contains("open")) renderPanel();
    if (fab) applyUi();
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg) return;
    if (msg.type === "insert") {
      doInsert(blockText(msg.block, msg.mode), msg.block);
    } else if (msg.type === "openPanel") {
      openPanel();
    } else if (msg.type === "autofillContact") {
      autofillContact();
    }
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" || area === "sync") refresh();
  });

  /* ---------- init ---------- */
  function init() {
    build();
    refresh();
  }
  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);
})();
