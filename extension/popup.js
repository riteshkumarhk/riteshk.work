/* Résumé Autofill — popup logic. */
(function () {
  "use strict";
  var Store = window.AFStore;
  var data = null;

  var $ = function (id) {
    return document.getElementById(id);
  };

  function timeAgo(ts) {
    if (!ts) return "not saved yet";
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  }

  function pill(text, warn) {
    var s = document.createElement("span");
    s.className = "pill" + (warn ? " warn" : "");
    s.textContent = text;
    return s;
  }

  function renderSummary() {
    var box = $("summary");
    box.innerHTML = "";
    var s = data.summary;
    box.appendChild(pill("Summary " + (s.full || s.snippet ? "✓" : "—"), !(s.full || s.snippet)));
    var n = (data.experiences || []).length;
    box.appendChild(pill(n + " experience" + (n === 1 ? "" : "s"), n === 0));
    var hasSkills = data.skills.full || data.skills.snippet || (data.skills.list || []).length;
    box.appendChild(pill("Skills " + (hasSkills ? "✓" : "—"), !hasSkills));
    if (data.custom && data.custom.length) box.appendChild(pill(data.custom.length + " custom"));
  }

  function renderMode() {
    var seg = $("modeSeg");
    seg.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.mode === data.settings.defaultMode);
    });
  }

  function renderToggles() {
    var op = data.settings.onPage;
    $("tFab").checked = op.fab !== false;
    $("tChip").checked = op.chip !== false;
    $("tMenu").checked = op.menu !== false;
  }

  async function save() {
    await Store.saveData(data);
    $("status").textContent = "Saved · updated " + timeAgo(data.updatedAt);
  }

  function wire() {
    $("modeSeg").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-mode]");
      if (!b) return;
      data.settings.defaultMode = b.dataset.mode;
      renderMode();
      save();
    });
    $("tFab").addEventListener("change", function (e) {
      data.settings.onPage.fab = e.target.checked;
      save();
    });
    $("tChip").addEventListener("change", function (e) {
      data.settings.onPage.chip = e.target.checked;
      save();
    });
    $("tMenu").addEventListener("change", function (e) {
      data.settings.onPage.menu = e.target.checked;
      save();
    });
    $("btnEdit").addEventListener("click", function () {
      chrome.runtime.openOptionsPage();
    });
    $("btnOcr").addEventListener("click", function () {
      chrome.storage.local.set({ af_open: "ocr" }, function () {
        chrome.runtime.openOptionsPage();
      });
    });
    $("btnSync").addEventListener("click", async function () {
      var btn = $("btnSync");
      btn.disabled = true;
      btn.textContent = "Pulling…";
      try {
        data = await Store.syncFromUrl(data.settings.syncUrl);
        renderAll();
        $("status").textContent = "Pulled from site · " + timeAgo(data.updatedAt);
      } catch (e) {
        $("status").textContent = "Pull failed: " + e.message;
      }
      btn.disabled = false;
      btn.textContent = "Pull latest from my site";
    });
  }

  function renderAll() {
    renderMode();
    renderSummary();
    renderToggles();
    $("btnSync").hidden = !(data.settings && data.settings.syncUrl);
    $("status").textContent = "Updated " + timeAgo(data.updatedAt);
  }

  async function init() {
    data = await Store.loadData();
    renderAll();
    wire();
  }
  init();
})();
