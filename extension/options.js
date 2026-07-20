/* Résumé Autofill — options page logic. */
(function () {
  "use strict";
  var Store = window.AFStore;
  var M = window.AF_MODEL;
  var data = null;
  var dirty = false;

  var $ = function (id) {
    return document.getElementById(id);
  };
  var val = function (id) {
    var e = $(id);
    return e ? e.value : "";
  };
  var setv = function (id, v) {
    var e = $(id);
    if (e) e.value = v == null ? "" : v;
  };
  var chk = function (id) {
    var e = $(id);
    return !!(e && e.checked);
  };
  var setchk = function (id, v) {
    var e = $(id);
    if (e) e.checked = !!v;
  };

  var SCHEMA_PROMPT =
    "You are a precise résumé parser. Read the résumé and return ONLY a JSON object with this exact shape:\n" +
    '{"profile":{"name":"","title":"","email":"","phone":"","location":"","links":{"linkedin":"","portfolio":"","github":""}},' +
    '"summary":{"full":"","snippet":""},' +
    '"experiences":[{"company":"","role":"","start":"","end":"","location":"","full":"","snippet":""}],' +
    '"skills":{"full":"","snippet":"","list":[]},' +
    '"education":[{"school":"","degree":"","field":"","year":"","full":"","snippet":""}]}\n' +
    "Rules: 'full' = the detailed multi-sentence version (keep bullets/metrics). " +
    "'snippet' = a condensed 1–2 line version of the same item. " +
    "skills.list = an array of individual skills. " +
    "Do NOT invent facts; leave any unknown field as an empty string. Return JSON only.";

  /* ---------- AI ---------- */
  async function aiChat(messages, opts) {
    opts = opts || {};
    var key = (val("ai_key") || "").trim();
    if (!key) key = await Store.getAiKey();
    if (!key) throw new Error("Add your API key first.");
    var model = (val("ai_model") || "gpt-4o").trim();
    var body = { model: model, messages: messages, temperature: 0.2 };
    if (opts.json) body.response_format = { type: "json_object" };
    var res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var t = await res.text();
      throw new Error("AI error " + res.status + ": " + t.slice(0, 160));
    }
    var j = await res.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  }

  function parseJson(txt) {
    try {
      return JSON.parse(txt);
    } catch (e) {}
    var a = txt.indexOf("{"),
      b = txt.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(txt.slice(a, b + 1));
      } catch (e2) {}
    }
    throw new Error("Could not read the AI response as JSON.");
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.classList.toggle("is-busy", !!on);
    btn.disabled = !!on;
  }

  /* ---------- render lists ---------- */
  function itemFromTpl(tplId) {
    return $(tplId).content.firstElementChild.cloneNode(true);
  }
  function fillItem(node, obj) {
    node.dataset.id = obj.id || M.uid();
    node.querySelectorAll("[data-f]").forEach(function (inp) {
      inp.value = obj[inp.getAttribute("data-f")] || "";
    });
  }
  function readItem(node) {
    var o = { id: node.dataset.id || M.uid() };
    node.querySelectorAll("[data-f]").forEach(function (inp) {
      o[inp.getAttribute("data-f")] = inp.value.trim();
    });
    return o;
  }
  function renderList(containerId, tplId, arr) {
    var c = $(containerId);
    c.innerHTML = "";
    (arr || []).forEach(function (obj) {
      var node = itemFromTpl(tplId);
      fillItem(node, obj);
      c.appendChild(node);
    });
  }
  function collectList(containerId) {
    return Array.prototype.map.call($(containerId).children, readItem);
  }

  /* ---------- populate / collect ---------- */
  async function populate(d) {
    data = d;
    setv("p_name", d.profile.name);
    setv("p_title", d.profile.title);
    setv("p_email", d.profile.email);
    setv("p_phone", d.profile.phone);
    setv("p_location", d.profile.location);
    setv("p_linkedin", d.profile.links.linkedin);
    setv("p_portfolio", d.profile.links.portfolio);
    setv("p_github", d.profile.links.github);
    setv("sum_full", d.summary.full);
    setv("sum_snip", d.summary.snippet);
    setv("sk_full", d.skills.full);
    setv("sk_snip", d.skills.snippet);
    setv("sk_list", (d.skills.list || []).join(", "));
    setv("sync_url", d.settings.syncUrl);
    setv("def_mode", d.settings.defaultMode);
    setv("ai_provider", d.settings.ai.provider || "openai");
    setv("ai_model", d.settings.ai.model || "gpt-4o");
    setchk("op_fab", d.settings.onPage.fab !== false);
    setchk("op_chip", d.settings.onPage.chip !== false);
    setchk("op_menu", d.settings.onPage.menu !== false);
    setv("ai_key", await Store.getAiKey());
    renderList("expList", "expTpl", d.experiences);
    renderList("eduList", "eduTpl", d.education);
    renderList("customList", "customTpl", d.custom);
  }

  function collect() {
    var d = data || M.emptyData();
    d.profile.name = val("p_name").trim();
    d.profile.title = val("p_title").trim();
    d.profile.email = val("p_email").trim();
    d.profile.phone = val("p_phone").trim();
    d.profile.location = val("p_location").trim();
    d.profile.links.linkedin = val("p_linkedin").trim();
    d.profile.links.portfolio = val("p_portfolio").trim();
    d.profile.links.github = val("p_github").trim();
    d.summary.full = val("sum_full").trim();
    d.summary.snippet = val("sum_snip").trim();
    d.skills.full = val("sk_full").trim();
    d.skills.snippet = val("sk_snip").trim();
    d.skills.list = val("sk_list")
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    d.experiences = collectList("expList");
    d.education = collectList("eduList");
    d.custom = collectList("customList");
    d.settings.syncUrl = val("sync_url").trim();
    d.settings.defaultMode = val("def_mode");
    d.settings.ai.provider = val("ai_provider");
    d.settings.ai.model = val("ai_model").trim() || "gpt-4o";
    d.settings.onPage.fab = chk("op_fab");
    d.settings.onPage.chip = chk("op_chip");
    d.settings.onPage.menu = chk("op_menu");
    return d;
  }

  /* ---------- status / banner ---------- */
  function status(msg) {
    $("status").textContent = msg;
  }
  function banner(msg, isErr) {
    var b = $("banner");
    b.hidden = false;
    b.className = "banner" + (isErr ? " err" : "");
    b.innerHTML = msg;
  }
  function markDirty() {
    dirty = true;
    status("Unsaved changes");
  }

  async function save() {
    data = collect();
    await Store.saveData(data);
    await Store.setAiKey(val("ai_key").trim());
    dirty = false;
    status("Saved · " + new Date().toLocaleTimeString());
  }

  /* ---------- OCR / import ---------- */
  function applyExtract(out) {
    out = out || {};
    var cur = collect();
    function keep(a, b) {
      return b != null && String(b).trim() !== "" ? String(b).trim() : a;
    }
    var p = out.profile || {};
    var links = p.links || {};
    cur.profile.name = keep(cur.profile.name, p.name);
    cur.profile.title = keep(cur.profile.title, p.title);
    cur.profile.email = keep(cur.profile.email, p.email);
    cur.profile.phone = keep(cur.profile.phone, p.phone);
    cur.profile.location = keep(cur.profile.location, p.location);
    cur.profile.links.linkedin = keep(cur.profile.links.linkedin, links.linkedin);
    cur.profile.links.portfolio = keep(cur.profile.links.portfolio, links.portfolio);
    cur.profile.links.github = keep(cur.profile.links.github, links.github);
    if (out.summary) {
      cur.summary.full = keep(cur.summary.full, out.summary.full);
      cur.summary.snippet = keep(cur.summary.snippet, out.summary.snippet);
    }
    if (out.skills) {
      cur.skills.full = keep(cur.skills.full, out.skills.full);
      cur.skills.snippet = keep(cur.skills.snippet, out.skills.snippet);
      if (Array.isArray(out.skills.list) && out.skills.list.length) cur.skills.list = out.skills.list;
    }
    if (Array.isArray(out.experiences) && out.experiences.length) {
      cur.experiences = out.experiences.map(function (e) {
        return {
          id: M.uid(),
          company: e.company || "",
          role: e.role || "",
          start: e.start || "",
          end: e.end || "",
          location: e.location || "",
          full: e.full || "",
          snippet: e.snippet || ""
        };
      });
    }
    if (Array.isArray(out.education) && out.education.length) {
      cur.education = out.education.map(function (e) {
        return {
          id: M.uid(),
          school: e.school || "",
          degree: e.degree || "",
          field: e.field || "",
          year: e.year || "",
          full: e.full || "",
          snippet: e.snippet || ""
        };
      });
    }
    populate(cur);
    markDirty();
    banner("✅ Imported — <b>review the fields below</b>, then click <b>Save</b>. Nothing is stored until you save.");
  }

  async function extractFromText(btn) {
    var content = val("ocr_text").trim();
    if (!content) {
      banner("Paste your resume text first.", true);
      return;
    }
    busy(btn, true);
    try {
      var out = parseJson(
        await aiChat([{ role: "system", content: SCHEMA_PROMPT }, { role: "user", content: "Resume text:\n\n" + content }], {
          json: true
        })
      );
      applyExtract(out);
    } catch (e) {
      banner(e.message, true);
    } finally {
      busy(btn, false);
    }
  }

  function extractFromImage(file) {
    var reader = new FileReader();
    reader.onload = async function () {
      $("ocrMsg").textContent = "Reading image…";
      try {
        var out = parseJson(
          await aiChat(
            [
              { role: "system", content: SCHEMA_PROMPT },
              {
                role: "user",
                content: [
                  { type: "text", text: "Extract this resume image into the JSON schema." },
                  { type: "image_url", image_url: { url: reader.result } }
                ]
              }
            ],
            { json: true }
          )
        );
        applyExtract(out);
        $("ocrMsg").textContent = "";
      } catch (e) {
        banner(e.message, true);
        $("ocrMsg").textContent = "";
      }
    };
    reader.readAsDataURL(file);
  }

  /* ---------- export / import / sync ---------- */
  function exportJson() {
    var d = collect();
    var clean = JSON.parse(JSON.stringify(d));
    var blob = new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "resume-autofill.json";
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
  }
  function importFile(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var parsed = Store.mergeShape(M.emptyData(), JSON.parse(r.result));
        populate(parsed);
        markDirty();
        banner("Imported from file — review and Save.");
      } catch (e) {
        banner("That file isn’t valid JSON.", true);
      }
    };
    r.readAsText(file);
  }
  async function pull(btn) {
    var url = val("sync_url").trim();
    if (!url) {
      banner("Enter your autofill.json URL first.", true);
      return;
    }
    busy(btn, true);
    try {
      data = await Store.syncFromUrl(url);
      await populate(data);
      dirty = false;
      status("Pulled from site");
      banner("Pulled the latest from your site and saved it on this device.");
    } catch (e) {
      banner("Pull failed: " + e.message, true);
    } finally {
      busy(btn, false);
    }
  }

  /* ---------- wiring ---------- */
  function wire() {
    $("btnSave").addEventListener("click", save);
    $("btnSave2").addEventListener("click", save);
    $("btnExport").addEventListener("click", exportJson);
    $("fileImport").addEventListener("change", function (e) {
      if (e.target.files[0]) importFile(e.target.files[0]);
      e.target.value = "";
    });
    $("btnExtractText").addEventListener("click", function (e) {
      extractFromText(e.currentTarget);
    });
    $("ocr_img").addEventListener("change", function (e) {
      if (e.target.files[0]) extractFromImage(e.target.files[0]);
      e.target.value = "";
    });
    $("btnPull").addEventListener("click", function (e) {
      pull(e.currentTarget);
    });
    $("addExp").addEventListener("click", function () {
      var node = itemFromTpl("expTpl");
      fillItem(node, M.newExperience());
      $("expList").appendChild(node);
      markDirty();
    });
    $("addEdu").addEventListener("click", function () {
      var node = itemFromTpl("eduTpl");
      fillItem(node, M.newEducation());
      $("eduList").appendChild(node);
      markDirty();
    });
    $("addCustom").addEventListener("click", function () {
      var node = itemFromTpl("customTpl");
      fillItem(node, M.newCustom());
      $("customList").appendChild(node);
      markDirty();
    });

    // delegated actions inside item lists
    document.addEventListener("click", async function (e) {
      var del = e.target.closest('[data-act="del"]');
      if (del) {
        var item = del.closest(".item");
        if (item) {
          item.remove();
          markDirty();
        }
        return;
      }
      var snip = e.target.closest('[data-act="ai-snip"]');
      if (snip) {
        var it = snip.closest(".item");
        var full = it.querySelector('[data-f="full"]').value.trim();
        if (!full) {
          banner("Add the full text first, then draft a snippet.", true);
          return;
        }
        busy(snip, true);
        try {
          var out = await aiChat([
            {
              role: "system",
              content:
                "Condense this résumé experience into a punchy 1–2 line snippet (max ~240 characters). Keep concrete outcomes and metrics. Output plain text only, no quotes or labels."
            },
            { role: "user", content: full }
          ]);
          it.querySelector('[data-f="snippet"]').value = out.trim();
          markDirty();
        } catch (err) {
          banner(err.message, true);
        } finally {
          busy(snip, false);
        }
      }
    });

    document.addEventListener("input", function () {
      if (!dirty) markDirty();
    });
    window.addEventListener("beforeunload", function (e) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  async function init() {
    await populate(await Store.loadData());
    status("Updated " + (data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"));
    wire();
    chrome.storage.local.get("af_open", function (v) {
      if (v && v.af_open === "ocr") {
        $("ocrCard").scrollIntoView({ behavior: "smooth" });
        chrome.storage.local.remove("af_open");
      }
    });
  }
  init();
})();
