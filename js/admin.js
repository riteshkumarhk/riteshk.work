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

  // The live-preview iframe loads this very file — it must stay inert there.
  if (new URLSearchParams(location.search).has("preview")) return;

  const HASH_KEY = "rk:admin:hash";
  const DRAFT_KEY = "rk:content:draft";
  const THEME_KEY = "rk:theme";
  const MUSIC_ON_KEY = "rk:music:on";
  const MUSIC_TRACK_KEY = "rk:music:track";
  const DEFAULT_TRACKS = [
    { title: "Midnight", gen: "midnight" },
    { title: "Ember Glow", gen: "ember" },
    { title: "Undertow", gen: "undertow" }
  ];
  const MUS_ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 6h2v12h-2zM6 6v12l8.5-6z"/></svg>'
  };
  const EDIT_URL = "https://github.com/riteshkumarhk/riteshk.work/edit/main/content.json";
  const GH_OWNER = "riteshkumarhk";
  const GH_REPO = "riteshk.work";
  const GH_BRANCH = "main";
  const GH_API = "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/content.json";
  const GH_TOKEN_KEY = "rk:gh:token";
  const GH_NEW_TOKEN_URL = "https://github.com/settings/tokens/new?description=riteshk.work%20publishing&scopes=public_repo";
  const DRAFT_SIG_KEY = "rk:content:draft:sig";
  const PREVIEW_SRC = "index.html?preview=1&lite=1";
  const ADMIN_MIN = 900; // below this the split editor can't fit — admin is disabled
  const AI_PROVIDERS = [
    ["openai", "OpenAI"],
    ["gemini", "Google Gemini"],
    ["anthropic", "Anthropic (Claude)"],
    ["custom", "Custom (OpenAI-compatible)"],
  ];
  const AI_DEFAULT_MODEL = { openai: "gpt-image-1", gemini: "gemini-2.0-flash-preview-image-generation", anthropic: "claude-3-5-sonnet-latest", custom: "" };
  const AI_TEXT_MODEL = { openai: "gpt-4o", gemini: "gemini-2.0-flash", anthropic: "claude-3-5-sonnet-latest", custom: "" };
  const AI_DEFAULT_BASE = { openai: "https://api.openai.com/v1", gemini: "https://generativelanguage.googleapis.com/v1beta", anthropic: "https://api.anthropic.com/v1", custom: "" };
  const AI_IMAGE_PROVIDERS = ["openai", "gemini", "custom"];
  // Ranked preferences (best first) used to auto-pick the strongest AVAILABLE model per provider.
  const AI_MODEL_RANK = {
    openai: { txt: [/^gpt-4o$/, /^gpt-4\.1$/, /^gpt-4o-\d{4}/, /^chatgpt-4o-latest$/, /^gpt-4-turbo$/, /^o3$/, /^o1$/, /^gpt-4o-mini$/, /^gpt-4/], img: [/^gpt-image-1$/, /^dall-e-3$/, /^dall-e-2$/] },
    anthropic: { txt: [/sonnet-4/, /3-7-sonnet/, /3-5-sonnet-\d{8}$/, /3-5-sonnet/, /opus-4/, /3-opus/, /sonnet/, /haiku/], img: [] },
    gemini: { txt: [/^gemini-2\.\d-flash$/, /^gemini-2\.\d-pro/, /^gemini-1\.5-pro$/, /^gemini-1\.5-flash$/, /flash$/, /pro$/], img: [/flash.*image/, /imagen/] },
  };
  const AI_TEXT_FALLBACK = { openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"], anthropic: ["claude-3-5-sonnet-latest", "claude-3-5-sonnet-20241022", "claude-3-7-sonnet-latest", "claude-sonnet-4-20250514", "claude-3-haiku-20240307"], gemini: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"], custom: [] };
  const AI_IMG_FALLBACK = { openai: ["gpt-image-1", "dall-e-3", "dall-e-2"], gemini: ["gemini-2.0-flash-preview-image-generation", "imagen-3.0-generate-002"], anthropic: [], custom: [] };
  const STUDY_BLOCK_TYPES = [
    ["text", "Text"], ["statement", "Statement"], ["metrics", "Metrics"],
    ["steps", "Steps"], ["media", "Media"], ["split", "Before / after"], ["faq", "FAQ"],
  ];

  let data = null;
  let activeTab = "landing";
  let openStudy = -1; // index of the work item whose case-study editor is expanded
  let root = null, body = null, frame = null;
  let l2 = null, l2body = null, l2title = null, l2PreviewTimer = 0;
  let saveTimer = null;
  let menuEl = null;
  const ticketPlain = {}; // owner-only plaintext tickets, never published
  const studyUnlockPlain = {}; // owner-only plaintext deeper-cut passes, never published

  const TABS = [
    ["landing", "Landing"],
    ["highlights", "Highlights"],
    ["capabilities", "Capabilities"],
    ["work", "Work"],
    ["path", "Path"],
    ["recognition", "Recognition"],
    ["education", "Education"],
    ["contact", "Contact"],
    ["special", "Special Views"],
    ["ai", "AI"],
  ];
  const THEMES = ["edge", "auth", "search", "auto", "xbox", "grid", "aurora", "orbit", "wave", "mesh", "ember"];

  /* Premium animated placeholder plates — the real site plates, offered as ready thumbnails. */
  const PLATE_THEMES = [
    ["edge", "Signal grid"],
    ["aurora", "Aurora"],
    ["auth", "Sonar"],
    ["orbit", "Orbit"],
    ["search", "Equalizer"],
    ["wave", "Light wave"],
    ["mesh", "Constellation"],
    ["auto", "Highway"],
    ["ember", "Embers"],
    ["xbox", "Neon grid"],
  ];
  function platePreview(th) {
    return (window.RK && window.RK.plateInner) ? window.RK.plateInner(th) : "";
  }

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

  /* ---------- live preview (iframe) + persist ---------- */
  function apply(immediate) {
    previewApply();
    saveDraft(immediate);
  }

  function saveDraft(immediate) {
    clearTimeout(saveTimer);
    const save = () => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
        localStorage.setItem(DRAFT_SIG_KEY, (window.RK && window.RK.publishedSig) || "");
      } catch (e) {}
      status("Draft saved locally");
    };
    if (immediate) save();
    else saveTimer = setTimeout(save, 400);
  }

  function readDraft() {
    try { const d = localStorage.getItem(DRAFT_KEY); return d ? JSON.parse(d) : null; }
    catch (e) { return null; }
  }

  // Push the working data into the same-origin live-preview iframe.
  function previewApply() {
    const w = frame && frame.contentWindow;
    if (w && w.RK && w.RK.render) {
      try { w.RK.render(data); forceRevealDoc(w.document); } catch (e) {}
    }
  }

  function forceRevealDoc(doc) {
    if (!doc) return;
    if (doc.body) doc.body.classList.remove("site-loading");
    doc.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-in"));
    doc.querySelectorAll(".hero__title .line, .contact__mail-line").forEach((el) => el.classList.add("is-in"));
    doc.querySelectorAll(".count").forEach((c) => { c.textContent = c.dataset.count; });
  }
  function forceReveal() { forceRevealDoc(document); }

  function status(msg, ok) {
    const s = root && root.querySelector(".adm__status");
    if (s) { s.textContent = msg; s.classList.toggle("ok", !!ok); }
  }

  /* =================================================================
     SMART AUTO-STYLE — turns plain landing copy into the editorial
     palette: bronze on products/brands, bold on "leading …" phrases,
     italic on the rhetorical closing word (why / how / what).
     ================================================================= */
  const ACCENT_TERMS = [
    "Microsoft AI", "Microsoft Edge", "Microsoft Search", "Microsoft 365",
    "Microsoft Account", "Microsoft Copilot", "Microsoft Teams", "Windows Hello",
    "Copilot", "SharePoint", "Outlook", "Windows", "Bing", "Teams",
    "FIDO Alliance", "FIDO", "Passkeys", "Jaguar Land Rover", "Tata Elxsi", "Microsoft"
  ].sort((a, b) => b.length - a.length);
  const EM_WORDS = ["why", "how", "what", "who", "when", "where"];
  const LEAD_VERBS =
    "leading|led|lead|owning|owned|own|driving|drove|drive|shaping|shaped|shape|" +
    "heading|headed|head|building|built|build|designing|designed|design|" +
    "championing|championed|delivering|delivered|running|ran";

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function stripMarks(s) {
    return String(s == null ? "" : s)
      .replace(/\[\[(.+?)\]\]/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1");
  }
  function hasMarks(s) { return /\[\[|\*/.test(String(s == null ? "" : s)); }

  function accentSpans(text) {
    const out = [];
    ACCENT_TERMS.forEach((term) => {
      const re = new RegExp("\\b" + escapeRe(term) + "\\b", "g");
      let m; while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length, "accent"]);
    });
    return out;
  }
  function boldSpans(text) {
    const out = [];
    const cap = "[A-Z][\\w’'&-]*";
    const re = new RegExp(
      "\\b(?:" + LEAD_VERBS + ")\\s+(?:the\\s+)?" +
      "(" + cap + "(?:\\s+(?:for|of|and|to|the|&|in|on|at|with)\\s+" + cap + "|\\s+" + cap + ")*)",
      "g"
    );
    let m; while ((m = re.exec(text))) {
      const phrase = m[1];
      const start = m.index + m[0].length - phrase.length;
      out.push([start, start + phrase.length, "bold"]);
    }
    return out;
  }
  function emSpan(text) {
    const m = text.match(/([A-Za-z]+)([.!?…]*)\s*$/);
    if (m && EM_WORDS.indexOf(m[1].toLowerCase()) !== -1) {
      return [m.index, m.index + m[1].length + m[2].length, "em"];
    }
    return null;
  }
  function resolveSpans(spans) {
    spans.sort((a, b) => a[0] - b[0] || (b[1] - b[0]) - (a[1] - a[0]));
    const kept = []; let end = -1;
    spans.forEach((s) => { if (s[0] >= end) { kept.push(s); end = s[1]; } });
    return kept;
  }
  function markup(text, spans) {
    spans = resolveSpans(spans);
    let out = "", pos = 0;
    spans.forEach((s) => {
      out += text.slice(pos, s[0]);
      const seg = text.slice(s[0], s[1]);
      out += s[2] === "accent" ? "[[" + seg + "]]" : s[2] === "bold" ? "**" + seg + "**" : "*" + seg + "*";
      pos = s[1];
    });
    return out + text.slice(pos);
  }
  function styleField(kind, value) {
    const plain = stripMarks(value);
    if (!plain.trim()) return value;
    let spans;
    if (kind === "statement") { spans = accentSpans(plain); const e = emSpan(plain); if (e) spans.push(e); }
    else if (kind === "intro") { spans = boldSpans(plain).concat(accentSpans(plain)); }
    else if (kind === "accent") { spans = accentSpans(plain); }
    else return value;
    return markup(plain, spans);
  }
  // force = re-derive everything; otherwise only style fields still left plain.
  function autoStyleLanding(force) {
    const L = data.landing || (data.landing = {});
    const fields = [["statement", "statement"], ["intro", "intro"], ["presence", "accent"]];
    let changed = 0;
    fields.forEach((f) => {
      const key = f[0], kind = f[1];
      if (!force && hasMarks(L[key])) return;
      const next = styleField(kind, L[key]);
      if (next !== L[key]) { L[key] = next; changed++; }
    });
    return changed;
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
  function addBar(list, label, disabled) {
    return '<div class="adm__addbar"><button class="btn btn--add" data-act="add" data-list="' + list + '"' + (disabled ? " disabled" : "") + ">+ " + label + "</button></div>";
  }

  function imageryBlock(w, i) {
    const has = !!w.image;
    const cfg = aiCfg("img");
    const canGen = aiSupportsImages();
    const aiHint = !aiSupportsImages() ? "This service (Claude) can't generate images \u2014 pick OpenAI or Gemini"
      : !cfg.key ? "Describe an image \u2014 you'll be asked for a key"
      : "Describe an image to generate\u2026";
    const plates = PLATE_THEMES.map(function (t) {
      const th = t[0];
      const on = (!w.image && (w.theme || "edge") === th) ? " is-on" : "";
      return '<button class="imgblk__plate' + on + '" data-act="plate-sample" data-index="' + i + '" data-theme="' + th + '" title="' + escAttr(t[1]) + ' \u2014 animated placeholder"><span class="imgblk__plate-media case__media case__media--' + th + '"><span class="plate">' + platePreview(th) + "</span></span><span class=\"imgblk__plate-name\">" + escHtml(t[1]) + "</span></button>";
    }).join("");
    return '<div class="imgblk"><div class="af__label">Project image</div>' +
      '<div class="imgblk__preview' + (has ? " has" : "") + '">' + (has ? '<img src="' + escAttr(w.image) + '" alt="" />' : "<span>No image \u2014 the animated placeholder is shown</span>") + "</div>" +
      '<input type="text" data-list="work" data-index="' + i + '" data-field="image" value="' + escAttr(w.image || "") + '" placeholder="Paste an image URL\u2026" />' +
      '<div class="imgblk__row"><button class="btn btn--ghost" data-act="img-upload" data-index="' + i + '">Upload\u2026</button>' +
      (has ? '<button class="btn btn--ghost" data-act="img-clear" data-index="' + i + '">Remove</button>' : "") + "</div>" +
      '<div class="af__label" style="margin:.7rem 0 .2rem">Or use an animated placeholder \u2014 no upload, always on-brand</div>' +
      '<div class="imgblk__plates">' + plates + "</div>" +
      '<div class="imgblk__ai"><input type="text" data-aiprompt="' + i + '" placeholder="' + aiHint + '"' + (canGen ? "" : " disabled") + " />" +
      '<div class="imgblk__row"><button class="btn btn--auto" data-act="img-generate" data-index="' + i + '"' + (canGen ? "" : " disabled") + ">Generate</button>" +
      '<button class="btn btn--ghost" data-act="img-modify" data-index="' + i + '"' + (canGen && has ? "" : " disabled") + ">Modify current</button></div>" +
      '<div class="imgblk__hint">Uploaded &amp; generated images are embedded in your published file \u2014 a URL keeps it lighter.</div></div></div>';
  }

  function resumeBlock() {
    const url = (data.contact && data.contact.resume) || "";
    const has = !!url;
    const isData = /^data:/.test(url);
    return '<div class="imgblk"><div class="af__label">R\u00e9sum\u00e9 (PDF)</div>' +
      '<div class="af__hint" style="margin-bottom:.5rem">When set, a <em>R\u00e9sum\u00e9</em> button appears in the floating dock (bottom-left) and opens this file. Uploading embeds the PDF into your published file \u2014 for a large PDF, commit it to the repo and paste its path instead (e.g. /resume.pdf).</div>' +
      '<input type="text" data-path="contact.resume" value="' + escAttr(url) + '" placeholder="Paste a r\u00e9sum\u00e9 URL\u2026 e.g. /resume.pdf" />' +
      '<div class="imgblk__row"><button class="btn btn--ghost" data-act="resume-upload">Upload PDF\u2026</button>' +
      (has ? '<button class="btn btn--ghost" data-act="resume-open">Open</button><button class="btn btn--ghost" data-act="resume-clear">Remove</button>' : "") + "</div>" +
      '<div class="imgblk__hint">' + (has ? ("In use: " + escHtml(isData ? "embedded PDF" : url) + " \u00b7 the dock button is now visible") : "Not set \u2014 the r\u00e9sum\u00e9 button stays hidden until you add one.") + "</div></div>";
  }

  /* ---------- case study (L2) authoring ---------- */
  function blankStudy() {
    return { tagline: "", role: "", team: "", timeline: "", scope: "", cover: "", unlockHash: "", blocks: [] };
  }
  function blankBlock(type) {
    switch (type) {
      case "statement": return { type: "statement", nav: "", kicker: "", body: "", sub: "" };
      case "metrics": return { type: "metrics", nav: "", kicker: "", heading: "", items: [] };
      case "steps": return { type: "steps", nav: "", kicker: "", heading: "", items: [] };
      case "media": return { type: "media", nav: "", kicker: "", heading: "", items: [] };
      case "split": return { type: "split", nav: "", kicker: "", heading: "", leftLabel: "Before", left: [], rightLabel: "After", right: [] };
      case "faq": return { type: "faq", nav: "", kicker: "", items: [] };
      default: return { type: "text", nav: "Section", kicker: "", heading: "", body: "", list: [] };
    }
  }
  function studyLines(text) { return String(text || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean); }
  function studyPipe(line) { var k = line.indexOf("|"); return k === -1 ? [line.trim(), ""] : [line.slice(0, k).trim(), line.slice(k + 1).trim()]; }
  function parseItems(type, text) {
    return studyLines(text).map(function (line) {
      var p = studyPipe(line);
      if (type === "metrics") return { value: p[0], label: p[1] };
      if (type === "steps") return { title: p[0], body: p[1] };
      if (type === "faq") return { q: p[0], a: p[1] };
      if (type === "media") return p[0] ? { src: p[0], caption: p[1] } : { caption: p[1] };
      return {};
    });
  }
  function itemsToText(type, items) {
    return (items || []).map(function (it) {
      if (type === "metrics") return (it.value || "") + " | " + (it.label || "");
      if (type === "steps") return (it.title || "") + " | " + (it.body || "");
      if (type === "faq") return (it.q || "") + " | " + (it.a || "");
      if (type === "media") return (it.src || it.image || "") + " | " + (it.caption || "");
      return "";
    }).join("\n");
  }
  function listToText(arr) { return (arr || []).join("\n"); }

  function sfInput(i, j, field, label, hint) {
    var b = data.work[i].study.blocks[j];
    return '<div class="af"><label class="af__label">' + label + '</label><input type="text" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="' + field + '" value="' + escAttr(b[field] || "") + '" />' + (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
  }
  function sfArea(i, j, field, label, value, rows, hint) {
    return '<div class="af"><label class="af__label">' + label + '</label><textarea data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="' + field + '" rows="' + (rows || 3) + '">' + escHtml(value) + "</textarea>" + (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
  }
  function blockEditor(i, b, j, len) {
    var head = '<div class="card__bar"><span class="card__idx">' + (j + 1) + " \u00b7 " + escHtml(b.type) + "</span>" +
      '<div class="card__ops">' +
      '<button class="iconbtn" data-act="study-blockup" data-index="' + i + '" data-bindex="' + j + '"' + (j === 0 ? " disabled" : "") + ' title="Move up">\u2191</button>' +
      '<button class="iconbtn" data-act="study-blockdown" data-index="' + i + '" data-bindex="' + j + '"' + (j === len - 1 ? " disabled" : "") + ' title="Move down">\u2193</button>' +
      '<button class="iconbtn iconbtn--danger" data-act="study-blockremove" data-index="' + i + '" data-bindex="' + j + '" title="Remove">\u2715</button>' +
      "</div></div>";
    var common = sfInput(i, j, "nav", "Section label", "Shows in the left nav \u2014 leave blank to hide it there") + sfInput(i, j, "kicker", "Kicker", "small label above the block");
    var body = "";
    if (b.type === "text") body = sfInput(i, j, "heading", "Heading") + sfArea(i, j, "body", "Body", b.body, 4) + sfArea(i, j, "list", "Bullets \u2014 one per line", listToText(b.list), 3);
    else if (b.type === "statement") body = sfArea(i, j, "body", "Statement", b.body, 3) + sfArea(i, j, "sub", "Sub-line", b.sub, 2);
    else if (b.type === "metrics") body = sfInput(i, j, "heading", "Heading") + sfArea(i, j, "items", "Metrics \u2014 one per line:  value | label", itemsToText("metrics", b.items), 4);
    else if (b.type === "steps") body = sfInput(i, j, "heading", "Heading") + sfArea(i, j, "items", "Steps \u2014 one per line:  title | body", itemsToText("steps", b.items), 5);
    else if (b.type === "media") body = sfInput(i, j, "heading", "Heading") + sfArea(i, j, "items", "Media \u2014 one per line:  url | caption", itemsToText("media", b.items), 4, "URL can be an image, gif, video, Figma prototype, PDF or slide deck \u2014 the type is auto-detected and interactive embeds get a Fullscreen button. For Figma, paste the Share link (turn on \u201cAnyone with the link\u201d). Leave the url blank for a redacted placeholder.");
    else if (b.type === "split") body = sfInput(i, j, "heading", "Heading") + '<div class="af__row">' + sfInput(i, j, "leftLabel", "Left label") + sfInput(i, j, "rightLabel", "Right label") + "</div>" + sfArea(i, j, "left", "Left items \u2014 one per line", listToText(b.left), 3) + sfArea(i, j, "right", "Right items \u2014 one per line", listToText(b.right), 3);
    else if (b.type === "faq") body = sfArea(i, j, "items", "Q&A \u2014 one per line:  question | answer", itemsToText("faq", b.items), 4);
    var locked = '<label class="chk"><input type="checkbox" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="locked"' + (b.locked ? " checked" : "") + " /> Locked \u2014 only after the deeper-cut pass</label>";
    return '<div class="card study__block">' + head + common + body + locked + "</div>";
  }
  function smeta(i, field, label, hint) {
    var st = data.work[i].study;
    return '<div class="af"><label class="af__label">' + label + '</label><input type="text" data-study="' + i + '" data-sfield="' + field + '" value="' + escAttr(st[field] || "") + '" />' + (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
  }
  function studyEditor(w, i) {
    var st = w.study;
    var blocks = st.blocks || (st.blocks = []);
    var cover = typeof st.cover === "string" ? st.cover : (st.cover && (st.cover.src || st.cover.image)) || "";
    var isVid = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(cover) || /^data:video\//i.test(cover);
    var unlockVal = studyUnlockPlain[w.id] || "";
    var meta = smeta(i, "tagline", "Tagline", "one line under the title") +
      '<div class="af__row">' + smeta(i, "role", "Role") + smeta(i, "timeline", "Timeline") + "</div>" +
      '<div class="af__row">' + smeta(i, "team", "Team") + smeta(i, "scope", "Scope") + "</div>";
    var coverPrev = cover ? (isVid ? '<video src="' + escAttr(cover) + '" muted loop autoplay playsinline></video>' : '<img src="' + escAttr(cover) + '" alt="" />') : "<span>No cover \u2014 a themed title card is shown</span>";
    var coverBlock = '<div class="imgblk"><div class="af__label">Cover \u2014 image, gif or video</div>' +
      '<div class="imgblk__preview' + (cover ? " has" : "") + '">' + coverPrev + "</div>" +
      '<input type="text" data-study="' + i + '" data-sfield="cover" value="' + escAttr(cover) + '" placeholder="Paste an image / gif / video URL\u2026" />' +
      '<div class="imgblk__row"><button class="btn btn--ghost" data-act="study-cover-upload" data-index="' + i + '">Upload\u2026</button>' + (cover ? '<button class="btn btn--ghost" data-act="study-cover-clear" data-index="' + i + '">Remove</button>' : "") + "</div>" +
      '<div class="imgblk__hint">Video &amp; gif are best pasted as a URL \u2014 uploads embed into your published file.</div></div>';
    var unlockBlock = '<div class="af"><label class="af__label">Deeper-cut pass</label>' +
      '<input type="text" data-study="' + i + '" data-sfield="unlock" value="' + escAttr(unlockVal) + '" placeholder="' + (st.unlockHash && !unlockVal ? "Set \u2014 type to change" : "e.g. edge-2026") + '" />' +
      '<div class="af__hint">' + (st.unlockHash ? "Pass set \u2713" : "Not set") + " \u00b7 unlocks the \u201cLocked\u201d blocks \u00b7 case-insensitive \u00b7 locked content still ships in your file (soft gate)</div></div>";
    var list = blocks.map(function (b, j) { return blockEditor(i, b, j, blocks.length); }).join("") || '<div class="adm__empty">No sections yet \u2014 add one below.</div>';
    var add = '<div class="study__add">' + STUDY_BLOCK_TYPES.map(function (t) { return '<button class="btn btn--add study__addbtn" data-act="study-addblock" data-index="' + i + '" data-type="' + t[0] + '">+ ' + t[1] + "</button>"; }).join("") + "</div>";
    return '<div class="study__panel">' +
      '<div class="adm__sec-note" style="margin:.2rem 0 1rem">Compose the case study as a stack of sections. Each <em>Section label</em> becomes a left-nav item on the project page.</div>' +
      csgenPanel(w, i) +
      meta + coverBlock + unlockBlock +
      '<div class="study__blocks">' + list + "</div>" + add +
      '<div class="study__foot"><button class="btn btn--ghost" data-act="study-preview" data-index="' + i + '">Preview case study \u2197</button><button class="btn btn--ghost" data-act="study-close" data-index="' + i + '">Done</button></div>' +
      "</div>";
  }
  function studyToggle(w, i) {
    var n = (w.study && w.study.blocks && w.study.blocks.length) || 0;
    if (openStudy === i) {
      return '<div class="study__toggle is-open"><button class="btn study__editbtn is-open" data-act="study-toggle" data-index="' + i + '">\u25be Close case-study editor</button></div>';
    }
    var count = n ? n + " section" + (n > 1 ? "s" : "") + " \u00b7 click to edit" : (w.study ? "empty \u2014 add sections" : "no page yet \u2014 click to build one");
    var preview = n ? '<button class="btn btn--ghost study__previewbtn" data-act="study-preview" data-index="' + i + '" title="Open this project page in a new tab">Preview \u2197</button>' : "";
    return '<div class="study__toggle">' +
      '<button class="btn study__editbtn" data-act="study-toggle" data-index="' + i + '">\u270e Edit case-study page</button>' +
      '<span class="study__meta">' + count + "</span>" + preview +
      "</div>";
  }
  function setStudyUnlock(st, phrase) {
    phrase = String(phrase || "").trim().toLowerCase();
    return sha256(phrase ? phrase : "\u0000").then(function (h) {
      st.unlockHash = phrase ? h : "";
      saveDraft(true);
      status(phrase ? "Deeper-cut pass set" : "Pass cleared", !!phrase);
    });
  }
  function onStudyMeta(t) {
    var i = +t.dataset.study; var w = data.work[i]; if (!w || !w.study) return;
    var f = t.dataset.sfield;
    if (f === "unlock") { studyUnlockPlain[w.id] = t.value; setStudyUnlock(w.study, t.value); return; }
    w.study[f] = t.value;
    saveDraft();
    refreshL2Preview();
  }
  function onStudyBlock(t) {
    var i = +t.dataset.sblock, j = +t.dataset.bindex, f = t.dataset.bfield;
    var st = data.work[i] && data.work[i].study; if (!st || !st.blocks[j]) return;
    var b = st.blocks[j];
    if (f === "list" || f === "left" || f === "right") b[f] = studyLines(t.value);
    else if (f === "items") b.items = parseItems(b.type, t.value);
    else b[f] = t.value;
    saveDraft();
    refreshL2Preview();
  }

  /* ---------- section renderers ---------- */
  const sections = {
    landing() {
      return (
        secHead("Landing", "Write plainly, then hit <em>Auto-style</em> and the editorial colour is applied for you: products like Microsoft&nbsp;AI turn bronze, &ldquo;leading Growth Design for Microsoft Edge&rdquo; turns bold, and the closing word (why) turns italic. It also runs on publish.") +
        '<div class="adm__autobar"><button class="btn btn--auto" data-act="autostyle">Auto-style landing</button><button class="btn btn--auto" data-act="landing-ai" style="margin-left:.5rem">\u2728 Draft with AI</button><span class="adm__auto-note">Auto-style paints the accents; <em>Draft with AI</em> writes the hero, highlights, capabilities &amp; about from a brief \u2014 preview before applying.</span></div>' +
        input("Eyebrow", "landing.eyebrow") +
        input("Domains", "landing.domains", { hint: "e.g. Growth · AI · Identity" }) +
        input("Main statement", "landing.statement", { type: "textarea", rows: 3, hint: "One line per row. The closing word (why / how) gets the italic accent." }) +
        input("Description", "landing.intro", { type: "textarea", rows: 4, hint: "Products auto-bronze; “leading …” phrases auto-bold." }) +
        input("Footer line", "landing.presence", { hint: "e.g. Currently at Microsoft — Hyderabad, India" }) +
        input("About — lead line", "landing.aboutLead", { type: "textarea", rows: 2, hint: "The big opening line of the About section. *italic* for emphasis." }) +
        input("About — paragraphs", "landing.about", { type: "textarea", rows: 7, hint: "Separate paragraphs with a blank line. **bold**, *italic*, [[Product]] bronze." }) +
        input("About — sign-off", "landing.aboutSign", { hint: "The closing personal line, e.g. an off-the-clock note." })
      );
    },
    contact() {
      return (
        secHead("Contact", "Used across the contact section, menu, footer and the floating dock.") +
        input("Email", "contact.email") +
        '<div class="af__row">' +
        input("Phone (display)", "contact.phone") +
        input("Phone (dial)", "contact.phoneRaw", { hint: "no spaces, e.g. +918197809767" }) +
        "</div>" +
        input("LinkedIn URL", "contact.linkedin") +
        input("Website URL", "contact.website") +
        resumeBlock()
      );
    },
    highlights() {
      const list = data.highlights || [];
      let html = secHead("Highlights", "The numbers after the reel. Up to 8 (stack 4×2). Values like <em>11+</em>, <em>Billions</em>, <em>2B+</em> — leading digits count up.") + addBar("highlights", "Add highlight", list.length >= 8);
      list.forEach((h, i) => {
        html += '<div class="card">' + cardHead("Highlight " + (i + 1), "highlights", i, list.length) +
          '<div class="af__row">' + itemField("highlights", i, "value", "Value") + itemField("highlights", i, "label", "Label") + "</div></div>";
      });
      return html;
    },
    capabilities() {
      const list = data.capabilities || [];
      let html = secHead("Capabilities", "Drives the Capabilities list AND the scrolling reel.") + addBar("capabilities", "Add capability");
      list.forEach((c, i) => {
        html += '<div class="card"><div class="card__bar" style="margin-bottom:.5rem"><span class="card__idx">' + (i + 1) + "</span>" + ops("capabilities", i, list.length) + "</div>" +
          '<input type="text" data-list="capabilities" data-index="' + i + '" data-scalar="1" value="' + escAttr(c) + '" /></div>';
      });
      return html;
    },
    work() {
      const list = data.work || [];
      const featured = list.filter((w) => w.featured).length;
      let html = secHead("Selected Work", "Add any number. Tick up to 4 to feature on the homepage (currently " + featured + "/4).") + addBar("work", "Add work");
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
          imageryBlock(w, i) +
          studyToggle(w, i) +
          "</div>";
      });
      return html;
    },
    path() {
      const list = data.path || [];
      let html = secHead("The Path", "Your experience timeline.") + addBar("path", "Add experience");
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
      return html;
    },
    recognition() {
      return titleMetaList("recognition", "Recognition", "Awards, talks and honours.");
    },
    education() {
      return titleMetaList("education", "Education", "Degrees and schooling.");
    },
    special() {
      const list = data.specialViews || (data.specialViews = []);
      let html = secHead("Special Views",
        "Curated, ticketed versions of the site for one audience (say an automotive company). Choose the work, numbers and skills they see, set a ticket phrase and an optional expiry. Up to 6. <em>Tickets are a soft gate — the curated content still ships in your published file, so don't put anything confidential here.</em>") +
        '<div class="adm__addbar"><button class="btn btn--add" data-act="sv-add"' + (list.length >= 6 ? " disabled" : "") + ">+ New special view</button></div>";
      if (!list.length) html += '<div class="adm__empty">No special views yet.</div>';
      list.forEach(function (sv, i) { html += svCard(sv, i); });
      if (list.length >= 6) html += '<div class="af__hint">Maximum of 6 special views reached.</div>';
      return html;
    },
    ai() {
      const same = aiSameKey();
      const imgOK = aiSupportsImages();
      let html = secHead("AI",
        "Connect providers for AI features. <em>Keys are stored only in this browser and are never written to your published file.</em>") +
        '<label class="chk aiblk__same"><input type="checkbox" id="aiSame"' + (same ? " checked" : "") + " /> Use the same service &amp; key for content and image</label>";
      if (same) {
        html += aiBlock("all", "AI service", "content + image");
      } else {
        html += aiBlock("txt", "Content generation", "text");
        html += aiBlock("img", "Image generation", "imagery");
      }
      html += '<div class="af__hint" style="margin:.1rem 0 1rem">' + (imgOK ? "Image service supports generation." : "Your image service (Claude) can't generate images \u2014 pick OpenAI or Gemini for imagery.") + "</div>";
      html += '<div class="imgblk__row"><button class="btn btn--primary" data-act="ai-save">Save</button><button class="btn btn--ghost" data-act="ai-clear">Remove keys</button></div>';
      html += '<div class="adm__empty" style="text-align:left;margin-top:1.1rem;line-height:1.6">Security: keys live only in this browser, are sent only to the service you pick, and are never committed to your site. Calling these APIs from the browser exposes the key to that provider \u2014 use a limited key. Some providers block browser calls (CORS); OpenAI and Gemini generally work directly.</div>';
      return html;
    },
  };

  function svCard(sv, i) {
    const works = data.work || [], highs = data.highlights || [], caps = data.capabilities || [];
    const expired = window.RK.svExpired(sv), left = window.RK.svDaysLeft(sv);
    const status = !sv.days ? "No expiry" : expired ? "Expired" : (left <= 0 ? "Expires today" : left + " day" + (left > 1 ? "s" : "") + " left");
    const tv = ticketPlain[sv.id] || "";
    const wItems = works.map(function (w, wi) { return { on: (sv.workIds || []).indexOf(w.id) !== -1, val: w.id, label: (w.client || w.title || ("Work " + (wi + 1))) }; });
    const hItems = highs.map(function (h, hi) { return { on: (sv.highlightIdx || []).indexOf(hi) !== -1, val: hi, label: ((h.value || "") + " \u00b7 " + (h.label || "")) }; });
    const cItems = caps.map(function (c, ci) { return { on: (sv.capabilityIdx || []).indexOf(ci) !== -1, val: ci, label: c }; });
    return '<div class="card sv-card' + (expired ? " sv-card--exp" : "") + '">' +
      '<div class="card__bar"><span class="card__idx">' + escHtml(sv.name || ("View " + (i + 1))) + (expired ? ' <b class="sv-badge">expired</b>' : "") + "</span>" +
        '<div class="card__ops"><button class="iconbtn iconbtn--danger" data-act="sv-remove" data-index="' + i + '" title="Remove">\u2715</button></div></div>' +
      '<div class="af"><label class="af__label">Name (only you see this)</label><input type="text" data-sv="' + i + '" data-field="name" value="' + escAttr(sv.name) + '" /></div>' +
      '<div class="af"><label class="af__label">Audience line (replaces the hero eyebrow)</label><input type="text" data-sv="' + i + '" data-field="audience" value="' + escAttr(sv.audience) + '" placeholder="e.g. Prepared for Jaguar Land Rover" /></div>' +
      '<div class="af__row">' +
        '<div class="af"><label class="af__label">Ticket phrase</label><input type="text" data-sv="' + i + '" data-field="ticket" value="' + escAttr(tv) + '" placeholder="' + (sv.ticketHash && !tv ? "Set \u2014 type to change" : "e.g. jaguar-2026") + '" /><div class="af__hint">' + (sv.ticketHash ? "Ticket set \u2713" : "Not set") + " \u00b7 case-insensitive</div></div>" +
        '<div class="af"><label class="af__label">Auto-hide after (days)</label><input type="number" min="0" step="1" data-sv="' + i + '" data-field="days" value="' + (sv.days || 0) + '" /><div class="af__hint">' + escHtml(status) + " \u00b7 0 = never</div></div>" +
      "</div>" +
      svChecklist(i, "work", "Work shown", wItems) +
      svChecklist(i, "highlights", "Numbers shown", hItems) +
      svChecklist(i, "capabilities", "Capabilities shown", cItems) +
      '<div class="sv-card__foot"><button class="btn btn--ghost" data-act="sv-preview" data-index="' + i + '">Preview in panel \u2192</button><span class="af__hint">Publish to make it live.</span></div>' +
      "</div>";
  }

  function svChecklist(i, kind, label, items) {
    const boxes = items.map(function (it) {
      return '<label class="svchk"><input type="checkbox" data-sv="' + i + '" data-sel="' + kind + '" data-val="' + escAttr(String(it.val)) + '"' + (it.on ? " checked" : "") + " /><span>" + escHtml(it.label) + "</span></label>";
    }).join("");
    return '<div class="sv-sel"><div class="sv-sel__label">' + label + ' <span>(none = show default)</span></div><div class="svchk__grid">' + (boxes || '<span class="af__hint">Nothing to choose yet.</span>') + "</div></div>";
  }

  function titleMetaList(list, name, note) {
    const items = data[list] || [];
    let html = secHead(name, note) + addBar(list, "Add " + name.toLowerCase());
    items.forEach((a, i) => {
      html += '<div class="card">' + cardHead(name + " " + (i + 1), list, i, items.length) +
        itemField(list, i, "title", "Title") + itemField(list, i, "meta", "Meta / date") + "</div>";
    });
    return html;
  }

  function secHead(title, note) {
    return '<div class="adm__sec-title">' + title + '</div><div class="adm__sec-note">' + note + "</div>";
  }

  function renderBody() {
    body.innerHTML = sections[activeTab]();
    root.querySelectorAll(".adm__tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === activeTab));
  }

  /* ---------- L2 case-study editor + auto live preview ---------- */
  function frameWin() { return frame && frame.contentWindow; }
  function previewProject(id, keep) {
    const w = frameWin();
    if (!(w && w.RK)) return;
    try { w.RK.data = clone(data); } catch (e) {}
    if (!keep) { try { w.RK.render(data); forceRevealDoc(w.document); } catch (e) {} }
    if (w.RK.openProject) { try { w.RK.openProject(id, { push: false, keepScroll: !!keep, silent: !!keep }); } catch (e) {} }
  }
  function previewLanding() {
    const w = frameWin();
    if (!(w && w.RK)) return;
    if (w.RK.closeProject) { try { w.RK.closeProject({ push: false }); } catch (e) {} }
    try { w.RK.data = clone(data); w.RK.render(data); forceRevealDoc(w.document); } catch (e) {}
  }
  function refreshL2Preview() {
    if (openStudy < 0) return;
    clearTimeout(l2PreviewTimer);
    l2PreviewTimer = setTimeout(function () {
      if (openStudy < 0 || !data.work[openStudy]) return;
      previewProject(data.work[openStudy].id, true);
    }, 180);
  }
  function openL2(i) {
    if (!data.work[i]) return;
    if (!data.work[i].study) data.work[i].study = blankStudy();
    openStudy = i;
    const w = data.work[i];
    if (l2title) l2title.textContent = w.client || w.title || "Case study";
    l2body.innerHTML = studyEditor(w, i);
    body.hidden = true;
    l2.hidden = false;
    requestAnimationFrame(function () { l2.classList.add("is-open"); });
    const ed = root.querySelector(".adm__editor"); if (ed) ed.scrollTop = 0;
    saveDraft();
    previewProject(w.id, false);
  }
  function renderL2() {
    if (openStudy < 0 || !data.work[openStudy]) return;
    const w = data.work[openStudy];
    l2body.innerHTML = studyEditor(w, openStudy);
    if (l2title) l2title.textContent = w.client || w.title || "Case study";
    previewProject(w.id, true);
  }
  function closeL2(opts) {
    opts = opts || {};
    openStudy = -1;
    if (l2) { l2.hidden = true; l2.classList.remove("is-open"); }
    if (body) body.hidden = false;
    const ed = root.querySelector(".adm__editor"); if (ed) ed.scrollTop = 0;
    previewLanding();
    if (opts.render !== false) renderBody();
  }

  /* ---------- blank templates ---------- */
  function blankSv() {
    return { id: "sv" + Date.now().toString(36), name: "New view", audience: "", ticketHash: "", createdAt: Date.now(), days: 3, workIds: [], highlightIdx: [], capabilityIdx: [] };
  }
  function blank(list) {
    switch (list) {
      case "highlights": return { value: "0+", label: "New metric" };
      case "capabilities": return "New capability";
      case "work": return { id: "w" + Date.now(), featured: false, theme: "grid", plateTag: "Tag", client: "Client", period: "Year", title: "Project title", desc: "What you did and the impact.", tags: ["Tag"], image: "" };
      case "path": return { years: "Year", present: false, role: "Role", org: "Organisation", desc: "What you did." };
      case "recognition":
      case "education": return { title: "New entry", meta: "" };
      default: return {};
    }
  }

  /* ---------- events ---------- */
  function onInput(e) {
    const t = e.target;
    if (t.dataset.csgen !== undefined) { const s = csgenState(t.dataset.csid); s[t.dataset.csgen] = t.value; return; }
    if (t.dataset.study !== undefined && t.dataset.sfield) { onStudyMeta(t); return; }
    if (t.dataset.sblock !== undefined && t.dataset.bfield && t.dataset.bfield !== "locked") { onStudyBlock(t); return; }
    if (t.dataset.path) { setPath(data, t.dataset.path, t.value); apply(); return; }
    if (t.dataset.sv !== undefined && t.dataset.field) { onSvInput(t); return; }
    if (t.dataset.list && t.dataset.scalar) { data[t.dataset.list][+t.dataset.index] = t.value; apply(); return; }
    if (t.dataset.list && t.dataset.field) {
      let v = t.value;
      if (t.dataset.field === "tags") v = t.value.split(",").map((x) => x.trim()).filter(Boolean);
      data[t.dataset.list][+t.dataset.index][t.dataset.field] = v;
      apply();
    }
  }

  function onSvInput(t) {
    const sv = (data.specialViews || [])[+t.dataset.sv];
    if (!sv) return;
    const f = t.dataset.field;
    if (f === "days") { sv.days = Math.max(0, parseInt(t.value, 10) || 0); if (!sv.createdAt) sv.createdAt = Date.now(); saveDraft(); status("Expiry updated"); return; }
    if (f === "ticket") { ticketPlain[sv.id] = t.value; setSvTicket(sv, t.value); return; }
    sv[f] = t.value;
    saveDraft();
  }

  async function setSvTicket(sv, phrase) {
    phrase = String(phrase || "").trim().toLowerCase();
    sv.ticketHash = phrase ? await sha256(phrase) : "";
    saveDraft(true);
    status(phrase ? "Ticket set" : "Ticket cleared", !!phrase);
  }

  function onChange(e) {
    const t = e.target;
    if (t.dataset.csgen !== undefined) { const s = csgenState(t.dataset.csid); s[t.dataset.csgen] = t.value; return; }
    if (t.dataset.sblock !== undefined && t.dataset.bfield === "locked") {
      const wi = +t.dataset.sblock, bj = +t.dataset.bindex;
      if (data.work[wi] && data.work[wi].study && data.work[wi].study.blocks[bj]) {
        data.work[wi].study.blocks[bj].locked = t.checked;
        saveDraft(true);
      }
      return;
    }
    if (t.id === "aiSame") { aiPersistVisible(); localStorage.setItem("rk:ai:same", t.checked ? "1" : "0"); renderBody(); return; }
    if (t.dataset.aiscope) { aiPickProvider(t.dataset.aiscope, t.value); return; }
    if (t.dataset.sv !== undefined && t.dataset.sel) { onSvToggle(t); return; }
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

  function onSvToggle(t) {
    const sv = (data.specialViews || [])[+t.dataset.sv];
    if (!sv) return;
    const sel = t.dataset.sel;
    const key = sel === "work" ? "workIds" : sel === "highlights" ? "highlightIdx" : "capabilityIdx";
    const val = sel === "work" ? t.dataset.val : +t.dataset.val;
    sv[key] = sv[key] || [];
    const at = sv[key].indexOf(val);
    if (t.checked && at === -1) sv[key].push(val);
    else if (!t.checked && at !== -1) sv[key].splice(at, 1);
    if (sel === "work") { const order = (data.work || []).map(function (w) { return w.id; }); sv.workIds.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); }); }
    else sv[key].sort(function (a, b) { return a - b; });
    saveDraft();
  }

  function svPreview(i) {
    const sv = (data.specialViews || [])[i];
    const w = frame && frame.contentWindow;
    if (w && w.RK && sv) {
      try { w.RK.render(w.RK.deriveSpecialData(data, sv)); forceRevealDoc(w.document); } catch (e) {}
      status("Previewing \u201c" + (sv.name || "view") + "\u201d \u2014 edit anything to return to the full site.");
    }
  }

  function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act, list = b.dataset.list, i = +b.dataset.index;
    if (act === "sv-add") {
      data.specialViews = data.specialViews || [];
      if (data.specialViews.length >= 6) { status("Up to 6 special views."); return; }
      data.specialViews.push(blankSv());
      saveDraft(true); renderBody(); return;
    }
    if (act === "sv-remove") { (data.specialViews || []).splice(i, 1); saveDraft(true); renderBody(); return; }
    if (act === "sv-preview") { svPreview(i); return; }
    if (act === "plate-sample") { data.work[i].theme = b.dataset.theme; data.work[i].image = ""; apply(true); renderBody(); status("Motion placeholder applied.", true); return; }
    if (act === "img-clear") { data.work[i].image = ""; apply(true); renderBody(); status("Image removed."); return; }
    if (act === "img-upload") { pickImage(function (uri) { data.work[i].image = uri; apply(true); renderBody(); status("Image uploaded.", true); }); return; }
    if (act === "img-generate") { imgGenerate(i); return; }
    if (act === "img-modify") { imgModify(i); return; }
    if (act === "resume-upload") { pickResume(function (uri) { setPath(data, "contact.resume", uri); apply(true); renderBody(); status("R\u00e9sum\u00e9 embedded \u2014 the dock button is now visible.", true); }); return; }
    if (act === "resume-clear") { setPath(data, "contact.resume", ""); apply(true); renderBody(); status("R\u00e9sum\u00e9 removed."); return; }
    if (act === "resume-open") { const u = data.contact && data.contact.resume; if (u && window.RK && window.RK.openResume) window.RK.openResume(u); else if (u) window.open(u, "_blank", "noopener"); return; }
    if (act === "ai-save") { aiSave(); return; }
    if (act === "ai-clear") { Object.keys(localStorage).forEach(function (k) { if (/^rk:ai:[a-z]+:key$/.test(k)) localStorage.removeItem(k); }); renderBody(); status("Keys removed."); return; }
    if (act === "autostyle") {
      const n = autoStyleLanding(true);
      apply(true); renderBody();
      status(n ? "Auto-styled — bronze products, bold phrases, italic closing word." : "Add some copy first, then Auto-style.", n > 0);
      return;
    }
    if (act === "landing-ai") { landingAiModal(); return; }
    if (act === "csgen-run") { csgenRun(i, false); return; }
    if (act === "csgen-variant") { csgenRun(i, true); return; }
    if (act === "csgen-pdf") { csgenAddPdf(i); return; }
    if (act === "csgen-ref-toggle") { const wrap = b.closest(".csgen__ref"); if (wrap) { const open = wrap.classList.toggle("is-open"); b.textContent = (open ? "\u2212" : "+") + " Paste a reference case study to echo (optional)"; const cw = data.work[i]; if (cw) csgenState(cw.id).refShow = open; } return; }
    if (act === "study-toggle") { openL2(i); return; }
    if (act === "study-close") { closeL2(); return; }
    if (act === "study-addblock") {
      const st = data.work[i].study || (data.work[i].study = blankStudy());
      st.blocks = st.blocks || [];
      st.blocks.push(blankBlock(b.dataset.type));
      saveDraft(true); renderL2(); return;
    }
    if (act === "study-blockup") { const s = data.work[i].study.blocks, j = +b.dataset.bindex; if (j > 0) { [s[j - 1], s[j]] = [s[j], s[j - 1]]; saveDraft(true); renderL2(); } return; }
    if (act === "study-blockdown") { const s = data.work[i].study.blocks, j = +b.dataset.bindex; if (j < s.length - 1) { [s[j + 1], s[j]] = [s[j], s[j + 1]]; saveDraft(true); renderL2(); } return; }
    if (act === "study-blockremove") { data.work[i].study.blocks.splice(+b.dataset.bindex, 1); saveDraft(true); renderL2(); return; }
    if (act === "study-cover-upload") { pickImage(function (uri) { const st = data.work[i].study || (data.work[i].study = blankStudy()); st.cover = uri; saveDraft(true); renderL2(); status("Cover set.", true); }); return; }
    if (act === "study-cover-clear") { if (data.work[i].study) data.work[i].study.cover = ""; saveDraft(true); renderL2(); return; }
    if (act === "study-preview") { saveDraft(true); window.open("/work/" + data.work[i].id, "_blank", "noopener"); status("Opened the case study in a new tab (using your draft)."); return; }
    if (act === "add") { data[list].push(blank(list)); apply(true); renderBody(); }
    else if (act === "remove") { data[list].splice(i, 1); apply(true); renderBody(); }
    else if (act === "up" && i > 0) { const a = data[list]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; apply(true); renderBody(); }
    else if (act === "down" && i < data[list].length - 1) { const a = data[list]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; apply(true); renderBody(); }
  }

  /* ---------- publish / revert ---------- */
  /* ---------- publish ---------- */
  function publish() {
    const token = localStorage.getItem(GH_TOKEN_KEY);
    if (token) ghPublish(token);
    else publishModal();
  }

  function beforePublish() {
    const styled = autoStyleLanding(false);
    if (styled) { if (activeTab === "landing") renderBody(); apply(true); }
    return JSON.stringify(data, null, 2);
  }

  function ghHeaders(token) {
    return {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }
  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }

  async function ghPublish(token) {
    const json = beforePublish();
    status("Publishing to GitHub\u2026");
    try {
      let sha;
      const getRes = await fetch(GH_API + "?ref=" + GH_BRANCH + "&t=" + Date.now(), { headers: ghHeaders(token) });
      if (getRes.status === 401 || getRes.status === 403) { authFailed(); return; }
      if (getRes.ok) { const j = await getRes.json(); sha = j.sha; }
      else if (getRes.status !== 404) throw new Error("read HTTP " + getRes.status);
      const body = { message: "Update content.json via admin", content: b64(json), branch: GH_BRANCH };
      if (sha) body.sha = sha;
      const putRes = await fetch(GH_API, { method: "PUT", headers: ghHeaders(token), body: JSON.stringify(body) });
      const pj = await putRes.json().catch(() => ({}));
      if (putRes.status === 401 || putRes.status === 403) { authFailed(); return; }
      if (!putRes.ok) throw new Error((pj && pj.message) || ("HTTP " + putRes.status));
      // Success: this data is now the published content — clear the draft so it can't go stale.
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(DRAFT_SIG_KEY);
      if (window.RK) { window.RK.published = clone(data); if (window.RK.sig) window.RK.publishedSig = window.RK.sig(JSON.stringify(data)); }
      status("Published \u2014 your site updates in about a minute.", true);
    } catch (e) {
      // Transient/network hiccup — keep the connection, just ask them to retry.
      status("Couldn\u2019t reach GitHub just now. Hit Publish again to retry.");
    }
  }

  // GitHub rejected the saved token: drop it so the next Publish re-prompts sign-in.
  function authFailed() {
    localStorage.removeItem(GH_TOKEN_KEY);
    status("GitHub didn\u2019t accept that sign-in. Hit Publish again to reconnect.");
  }

  function publishManual() {
    const json = beforePublish();
    try {
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "content.json";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {}
    if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {});
    window.open(EDIT_URL, "_blank", "noopener");
    status("Downloaded + copied \u2014 paste into the GitHub tab and Commit.", true);
  }

  function publishModal(msg) {
    const saved = localStorage.getItem(GH_TOKEN_KEY);
    const modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">Connect GitHub to publish</div>' +
      '<div class="pass__sub">' + (msg ? escHtml(msg) :
        "This publishes your changes to your live site. It needs a GitHub token once \u2014 stored only in this browser and sent only to GitHub.") + "</div>" +
      (saved ? "" :
        '<ol class="pass__steps">' +
          '<li>Click <b>Create token</b> below \u2014 GitHub opens with the right access already filled in.</li>' +
          '<li>On that page, scroll down and click <b>Generate token</b>, then copy it.</li>' +
          '<li>Come back here, paste it, and press <b>Connect &amp; publish</b>.</li>' +
        "</ol>") +
      '<input type="password" placeholder="' + (saved ? "Saved \u2014 paste to replace" : "Paste your token (ghp_\u2026)") + '" autocomplete="off" />' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions">' +
        '<a class="btn btn--ghost" href="' + GH_NEW_TOKEN_URL + '" target="_blank" rel="noopener">Create token \u2197</a>' +
        '<button class="btn btn--primary" data-go>Connect &amp; publish</button></div>' +
      '<button class="pass__link" data-manual>Publish manually instead</button>' +
      (saved ? '<button class="pass__link" data-forget>Forget saved token</button>' : "") +
      '<div class="pass__note">Prefer tighter access? Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a> limited to just this repo (Contents: Read and write).</div></div>';
    document.body.appendChild(modal);
    const inp = modal.querySelector("input"), err = modal.querySelector(".pass__err");
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 30);
    const done = () => modal.remove();
    modal.addEventListener("click", (e) => { if (e.target === modal) done(); });
    const forget = modal.querySelector("[data-forget]");
    if (forget) forget.addEventListener("click", () => { localStorage.removeItem(GH_TOKEN_KEY); done(); status("Saved token forgotten."); });
    modal.querySelector("[data-manual]").addEventListener("click", () => { done(); publishManual(); });
    function go() {
      const typed = inp.value.trim();
      const t = typed || saved;
      if (!t) { err.textContent = "Paste a token to connect, or choose Publish manually."; return; }
      if (typed) localStorage.setItem(GH_TOKEN_KEY, typed);
      done();
      ghPublish(t);   // once connected, publish runs automatically
    }
    modal.querySelector("[data-go]").addEventListener("click", go);
    modal.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); if (e.key === "Escape") done(); });
  }

  function revert() {
    if (!confirm("Discard local changes and reload the published content?")) return;
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(DRAFT_SIG_KEY);
    location.reload();
  }

  /* ---------- imagery + AI ---------- */
  function pickImage(cb) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = function () { const f = inp.files && inp.files[0]; if (!f) return; fileToDataUri(f).then(compressDataUri).then(cb); };
    inp.click();
  }
  function pickResume(cb) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "application/pdf,.pdf";
    inp.onchange = function () { const f = inp.files && inp.files[0]; if (!f) return; fileToDataUri(f).then(cb); };
    inp.click();
  }
  function fileToDataUri(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  function compressDataUri(uri, maxW, quality) {
    maxW = maxW || 1280; quality = quality || 0.82;
    return new Promise(function (resolve) {
      if (!/^data:image\//.test(uri) || /^data:image\/svg/.test(uri)) return resolve(uri);
      const img = new Image();
      img.onload = function () {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        try { resolve(c.toDataURL("image/jpeg", quality)); } catch (e) { resolve(uri); }
      };
      img.onerror = function () { resolve(uri); };
      img.src = uri;
    });
  }
  function aiSameKey() { return localStorage.getItem("rk:ai:same") === "1"; }
  function aiScope(purpose) { return aiSameKey() ? "all" : (purpose || "img"); }
  function aiSupportsImages() { return AI_IMAGE_PROVIDERS.indexOf(aiCfg("img").provider) !== -1; }
  function modelHint(p) {
    return p === "openai" ? "gpt-image-1, dall-e-3, dall-e-2"
      : p === "gemini" ? "gemini-2.0-flash-preview-image-generation, imagen-3.0-generate-002"
      : p === "anthropic" ? "claude-3-5-sonnet-latest (no image generation)"
      : "your model id";
  }
  function aiGet(scope, k) { return localStorage.getItem("rk:ai:" + scope + ":" + k); }
  function providerName(p) { const x = AI_PROVIDERS.find(function (a) { return a[0] === p; }); return x ? x[1] : p; }
  function bestModel(p, purpose) { return ((purpose === "txt" ? AI_TEXT_MODEL[p] : AI_DEFAULT_MODEL[p]) || "").trim(); }
  function aiSetProvider(scope, p) {
    localStorage.setItem("rk:ai:" + scope + ":provider", p);
    localStorage.removeItem("rk:ai:" + scope + ":model"); // known providers auto-pick the best; custom re-enters it
    localStorage.removeItem("rk:ai:" + scope + ":base");
    localStorage.removeItem("rk:ai:" + scope + ":key");
  }
  function aiCfg(purpose) {
    const scope = aiScope(purpose);
    const p = aiGet(scope, "provider") || "openai";
    return {
      purpose: purpose || "img", scope: scope, provider: p,
      key: aiGet(scope, "key") || "",
      model: (aiGet(scope, "model") || bestModel(p, purpose) || AI_DEFAULT_MODEL[p] || "").trim(),
      base: (aiGet(scope, "base") || AI_DEFAULT_BASE[p] || "").trim().replace(/\/+$/, ""),
    };
  }
  function aiBlock(scope, label, note) {
    const p = aiGet(scope, "provider") || "openai";
    const key = aiGet(scope, "key") || "";
    const masked = key ? (key.slice(0, 3) + "\u2022\u2022\u2022\u2022\u2022\u2022" + key.slice(-4)) : "";
    const opts = AI_PROVIDERS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === p ? " selected" : "") + ">" + x[1] + "</option>"; }).join("");
    let advanced;
    if (p === "custom") {
      const model = aiGet(scope, "model") || "";
      const base = aiGet(scope, "base") || "";
      advanced = '<div class="af__row"><div class="af"><label class="af__label">Model</label><input type="text" id="aiModel_' + scope + '" value="' + escAttr(model) + '" placeholder="your-model-id" /><div class="af__hint">' + escHtml(modelHint(p)) + '</div></div>' +
        '<div class="af"><label class="af__label">API base URL</label><input type="text" id="aiBase_' + scope + '" value="' + escAttr(base) + '" placeholder="https://\u2026/v1" /></div></div>';
    } else {
      advanced = '<div class="af__hint aiblk__auto">\u2728 Model &amp; endpoint are chosen automatically \u2014 always the best available for ' + escHtml(providerName(p)) + '.</div>';
    }
    return '<div class="aiblk"><div class="aiblk__head">' + label + (note ? ' <span>' + note + "</span>" : "") + "</div>" +
      '<div class="af"><label class="af__label">Service</label><select id="aiProvider_' + scope + '" data-aiscope="' + scope + '">' + opts + "</select></div>" +
      '<div class="af"><label class="af__label">API key</label><input type="password" id="aiKey_' + scope + '" placeholder="' + (key ? "Saved \u2014 paste to replace" : "Paste your key") + '" autocomplete="off" /><div class="af__hint">' + (key ? ("In use: " + escHtml(masked)) : "Not set") + "</div></div>" +
      advanced + "</div>";
  }
  function aiPickProvider(scope, p) {
    aiSetProvider(scope, p);
    if (activeTab === "ai") renderBody();
  }
  function aiPersistVisible() {
    ["all", "txt", "img"].forEach(function (scope) {
      const sel = root.querySelector("#aiProvider_" + scope);
      if (!sel) return;
      const p = sel.value;
      localStorage.setItem("rk:ai:" + scope + ":provider", p);
      const k = root.querySelector("#aiKey_" + scope), m = root.querySelector("#aiModel_" + scope), bs = root.querySelector("#aiBase_" + scope);
      if (k && k.value.trim()) localStorage.setItem("rk:ai:" + scope + ":key", k.value.trim());
      if (p === "custom") {
        if (m) localStorage.setItem("rk:ai:" + scope + ":model", m.value.trim());
        if (bs) localStorage.setItem("rk:ai:" + scope + ":base", bs.value.trim());
      } else {
        localStorage.removeItem("rk:ai:" + scope + ":model");
        localStorage.removeItem("rk:ai:" + scope + ":base");
      }
    });
  }
  function aiSave() { aiPersistVisible(); renderBody(); status("AI settings saved \u2014 local only.", true); }
  function aiPromptFor(i) {
    const el = root.querySelector('[data-aiprompt="' + i + '"]');
    return el ? el.value.trim() : "";
  }
  async function imgGenerate(i) {
    if (!aiHasKey("img")) { aiKeyModal("img", function () { imgGenerate(i); }); return; }
    const cfg = aiCfg("img");
    if (!aiSupportsImages()) return status("This service can\u2019t generate images \u2014 pick OpenAI or Gemini.");
    const p = aiPromptFor(i);
    if (!p) return status("Type a prompt to generate an image.");
    status("Generating image\u2026 this can take a moment.");
    try {
      const uri = await compressDataUri(await aiImage(cfg, p, null));
      data.work[i].image = uri; apply(true); renderBody(); status("Image generated.", true);
    } catch (e) { status("Generate failed: " + e.message); }
  }
  async function imgModify(i) {
    if (!aiHasKey("img")) { aiKeyModal("img", function () { imgModify(i); }); return; }
    const cfg = aiCfg("img");
    if (!aiSupportsImages()) return status("This service can\u2019t generate images \u2014 pick OpenAI or Gemini.");
    const cur = data.work[i].image;
    if (!cur) return status("No current image to modify.");
    const p = aiPromptFor(i);
    if (!p) return status("Describe how to change the image.");
    status("Reimagining the image\u2026");
    try {
      const uri = await compressDataUri(await aiImage(cfg, p, cur));
      data.work[i].image = uri; apply(true); renderBody(); status("Image updated.", true);
    } catch (e) { status("Modify failed: " + e.message); }
  }
  async function aiImage(cfg, prompt, sourceImage) {
    if (cfg.provider === "anthropic") throw new Error("Claude can't generate images \u2014 pick OpenAI or Gemini.");
    const cands = await aiModelCandidates(cfg, "img");
    const c2 = Object.assign({}, cfg, { model: cands[0] || cfg.model });
    if (c2.provider === "gemini") return aiImageGemini(c2, prompt, sourceImage);
    return aiImageOpenAI(c2, prompt, sourceImage);
  }
  async function aiImageOpenAI(cfg, prompt, sourceImage) {
    let res;
    if (sourceImage) {
      const blob = await (await fetch(sourceImage)).blob();
      const fd = new FormData();
      fd.append("model", cfg.model); fd.append("prompt", prompt);
      fd.append("image", blob, "image.png"); fd.append("n", "1"); fd.append("size", "1024x1024");
      res = await fetch(cfg.base + "/images/edits", { method: "POST", headers: { Authorization: "Bearer " + cfg.key }, body: fd });
    } else {
      const body = { model: cfg.model, prompt: prompt, n: 1, size: "1024x1024" };
      if (/^dall-e/.test(cfg.model)) body.response_format = "b64_json";
      res = await fetch(cfg.base + "/images/generations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key }, body: JSON.stringify(body) });
    }
    let j; try { j = await res.json(); } catch (e) { throw new Error("HTTP " + res.status); }
    if (!res.ok) throw new Error((j && j.error && j.error.message) || ("HTTP " + res.status));
    const d = (j.data && j.data[0]) || {};
    if (d.b64_json) return "data:image/png;base64," + d.b64_json;
    if (d.url) return d.url;
    throw new Error("No image returned");
  }
  async function aiImageGemini(cfg, prompt, sourceImage) {
    const url = cfg.base + "/models/" + encodeURIComponent(cfg.model) + ":generateContent?key=" + encodeURIComponent(cfg.key);
    const parts = [{ text: prompt }];
    if (sourceImage) {
      const sp = await dataUriParts(sourceImage);
      if (sp.b64) parts.push({ inlineData: { mimeType: sp.mime, data: sp.b64 } });
    }
    const body = { contents: [{ parts: parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let j; try { j = await res.json(); } catch (e) { throw new Error("HTTP " + res.status); }
    if (!res.ok) throw new Error((j && j.error && j.error.message) || ("HTTP " + res.status));
    const cand = (j.candidates && j.candidates[0]) || {};
    const outParts = (cand.content && cand.content.parts) || [];
    for (var i = 0; i < outParts.length; i++) {
      const d = outParts[i].inlineData || outParts[i].inline_data;
      if (d && d.data) return "data:" + (d.mimeType || d.mime_type || "image/png") + ";base64," + d.data;
    }
    throw new Error("No image returned by Gemini");
  }
  function dataUriParts(uri) {
    return new Promise(function (resolve) {
      if (/^data:/.test(uri)) {
        const m = uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
        resolve({ mime: (m && m[1]) || "image/png", b64: (m && m[2]) ? m[3] : "" });
      } else {
        fetch(uri).then(function (r) { return r.blob(); }).then(function (blob) {
          const fr = new FileReader();
          fr.onload = function () {
            const res = String(fr.result), c = res.indexOf(",");
            resolve({ mime: res.slice(5, res.indexOf(";")) || "image/png", b64: res.slice(c + 1) });
          };
          fr.readAsDataURL(blob);
        }).catch(function () { resolve({ mime: "image/png", b64: "" }); });
      }
    });
  }

  /* ---------- AI text generation (writing) ---------- */
  function aiHasKey(purpose) { return !!aiCfg(purpose).key; }
  // ---- model auto-resolution: list what the key can actually use, pick the best, fall back gracefully ----
  const aiModelsCache = {};
  async function aiListModels(cfg) {
    const ck = cfg.provider + "|" + cfg.base;
    if (aiModelsCache[ck]) return aiModelsCache[ck];
    let ids = [];
    try {
      if (cfg.provider === "anthropic") {
        const r = await fetch(cfg.base + "/models?limit=1000", { headers: { "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } });
        const j = await r.json(); ids = ((j && j.data) || []).map(function (m) { return m.id; });
      } else if (cfg.provider === "gemini") {
        const r = await fetch(cfg.base + "/models?pageSize=1000&key=" + encodeURIComponent(cfg.key));
        const j = await r.json(); ids = ((j && j.models) || []).map(function (m) { return String(m.name || "").replace(/^models\//, ""); });
      } else if (cfg.provider === "openai") {
        const r = await fetch(cfg.base + "/models", { headers: { Authorization: "Bearer " + cfg.key } });
        const j = await r.json(); ids = ((j && j.data) || []).map(function (m) { return m.id; });
      }
    } catch (e) { ids = []; }
    aiModelsCache[ck] = ids || [];
    return aiModelsCache[ck];
  }
  async function aiModelCandidates(cfg, purpose) {
    if (cfg.provider === "custom") return cfg.model ? [cfg.model] : [];
    const list = [];
    const ids = await aiListModels(cfg);
    const ranks = (AI_MODEL_RANK[cfg.provider] || {})[purpose] || [];
    if (ids && ids.length) {
      ranks.forEach(function (rx) { ids.forEach(function (id) { if (rx.test(id) && list.indexOf(id) === -1) list.push(id); }); });
      if (purpose === "txt") ids.forEach(function (id) { if (list.indexOf(id) === -1 && !/image|dall|imagen|embed|whisper|tts|audio|moderation|realtime|search|vision/i.test(id)) list.push(id); });
    }
    (((purpose === "txt" ? AI_TEXT_FALLBACK : AI_IMG_FALLBACK)[cfg.provider]) || []).forEach(function (m) { if (m && list.indexOf(m) === -1) list.push(m); });
    const def = purpose === "txt" ? AI_TEXT_MODEL[cfg.provider] : AI_DEFAULT_MODEL[cfg.provider];
    if (def && list.indexOf(def) === -1) list.push(def);
    return list;
  }
  function aiIsModelErr(r) { return r && (r.status === 404 || /model|not[ ._-]?found|does not exist|unknown|deprecat|unsupported/i.test(r.err || "")); }
  async function aiChatOnce(cfg, model, system, user, opts) {
    var p = cfg.provider, key = cfg.key, base = cfg.base;
    var maxTokens = opts.maxTokens || 4096;
    var temp = opts.temperature != null ? opts.temperature : 0.7;
    var res, j;
    if (p === "anthropic") {
      res = await fetch(base + "/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model: model, max_tokens: maxTokens, temperature: temp, system: system, messages: [{ role: "user", content: user }] }) });
      j = await res.json().catch(function () { return null; });
      if (!res.ok) return { ok: false, status: res.status, err: (j && j.error && j.error.message) || ("HTTP " + res.status) };
      return { ok: true, text: ((((j && j.content) || [])).map(function (b) { return b.text || ""; }).join("")).trim() };
    }
    if (p === "gemini") {
      var url = base + "/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);
      var gb = { contents: [{ role: "user", parts: [{ text: user }] }], systemInstruction: { parts: [{ text: system }] }, generationConfig: { maxOutputTokens: maxTokens, temperature: temp } };
      if (opts.json) gb.generationConfig.responseMimeType = "application/json";
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(gb) });
      j = await res.json().catch(function () { return null; });
      if (!res.ok) return { ok: false, status: res.status, err: (j && j.error && j.error.message) || ("HTTP " + res.status) };
      var cand = (j && j.candidates && j.candidates[0]) || {};
      return { ok: true, text: ((((cand.content && cand.content.parts) || [])).map(function (x) { return x.text || ""; }).join("")).trim() };
    }
    var ob = { model: model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: temp, max_tokens: maxTokens };
    if (opts.json) ob.response_format = { type: "json_object" };
    res = await fetch(base + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(ob) });
    j = await res.json().catch(function () { return null; });
    if (!res.ok) return { ok: false, status: res.status, err: (j && j.error && j.error.message) || ("HTTP " + res.status) };
    return { ok: true, text: ((j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").trim() };
  }
  async function aiText(cfg, system, user, opts) {
    opts = opts || {};
    var candidates = await aiModelCandidates(cfg, "txt");
    if (!candidates.length) throw new Error("No model available \u2014 check your API key.");
    var lastErr = "";
    for (var i = 0; i < candidates.length; i++) {
      var r = await aiChatOnce(cfg, candidates[i], system, user, opts);
      if (r.ok) return r.text;
      lastErr = r.err;
      if (!aiIsModelErr(r)) throw new Error(r.err); // real problem (auth, rate limit, network) \u2014 don't keep trying models
    }
    throw new Error(lastErr || "No usable model for this key.");
  }
  // Inline "connect an AI service" dialog, shown from a feature when its key is missing.
  // Lets the author pick a provider + key and choose ONE shared key (text + image) or a separate one.
  function aiKeyModal(purpose, onReady) {
    var modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">Connect an AI service</div>' +
      '<div class="pass__sub">This uses AI to ' + (purpose === "img" ? "generate imagery" : "write copy") + '. Add an API key once \u2014 it\u2019s stored only in this browser and sent only to the service you choose.</div>' +
      '<label class="chk aikm__same"><input type="checkbox" id="aikmSame"' + (aiSameKey() ? " checked" : "") + " /> Use one key for both writing and image generation</label>" +
      '<div class="aikm"></div>' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button><button class="btn btn--primary" data-go>Save &amp; continue</button></div>' +
      '<div class="pass__note">Keys never touch your published site. Some providers block browser calls (CORS); OpenAI &amp; Gemini work directly.</div></div>';
    document.body.appendChild(modal);
    var err = modal.querySelector(".pass__err");
    var sameBox = modal.querySelector("#aikmSame");
    var holder = modal.querySelector(".aikm");
    function scopeNow() { return sameBox.checked ? "all" : (purpose || "img"); }
    function paint() {
      var scope = scopeNow();
      var label = scope === "all" ? "AI service" : (purpose === "img" ? "Image AI" : "Writing AI");
      var note = scope === "all" ? "content + image" : (purpose === "img" ? "imagery" : "text");
      holder.innerHTML = aiBlock(scope, label, note);
      var sel = holder.querySelector("#aiProvider_" + scope);
      if (sel) sel.addEventListener("change", function () { aiSetProvider(scope, sel.value); paint(); });
    }
    paint();
    sameBox.addEventListener("change", paint);
    var close = function () { modal.remove(); };
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    modal.querySelector("[data-cancel]").addEventListener("click", close);
    modal.querySelector("[data-go]").addEventListener("click", function () {
      var scope = scopeNow();
      localStorage.setItem("rk:ai:same", sameBox.checked ? "1" : "0");
      var sel = holder.querySelector("#aiProvider_" + scope), p = sel ? sel.value : "openai";
      localStorage.setItem("rk:ai:" + scope + ":provider", p);
      var k = holder.querySelector("#aiKey_" + scope), m = holder.querySelector("#aiModel_" + scope), b = holder.querySelector("#aiBase_" + scope);
      if (k && k.value.trim()) localStorage.setItem("rk:ai:" + scope + ":key", k.value.trim());
      if (p === "custom") {
        if (m) localStorage.setItem("rk:ai:" + scope + ":model", m.value.trim());
        if (b) localStorage.setItem("rk:ai:" + scope + ":base", b.value.trim());
      } else {
        localStorage.removeItem("rk:ai:" + scope + ":model");
        localStorage.removeItem("rk:ai:" + scope + ":base");
      }
      if (!aiHasKey(purpose)) { err.textContent = "Paste a key to continue."; return; }
      close();
      if (onReady) onReady();
    });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  /* ---------- AI case-study generator (per project, into the editable blocks) ---------- */
  const csgen = {}; // per work-id draft inputs
  function csgenState(id) { return csgen[id] || (csgen[id] = { material: "", links: "", tone: "senior", reference: "", refShow: false }); }
  function csgenStatus(i, msg, kind) {
    var el = root && root.querySelector('[data-csgen-status="' + i + '"]');
    if (el) { el.textContent = msg || ""; el.className = "csgen__status" + (kind ? " is-" + kind : ""); }
  }
  function csgenPanel(w, i) {
    var g = csgenState(w.id);
    var toneOpts = [["senior", "Senior"], ["principal", "Principal"], ["executive", "Executive"]].map(function (t) {
      return '<option value="' + t[0] + '"' + (g.tone === t[0] ? " selected" : "") + ">" + t[1] + "</option>";
    }).join("");
    var hasStudy = !!(w.study && w.study.blocks && w.study.blocks.length);
    return '<div class="csgen"><div class="csgen__head"><span class="csgen__spark">\u2728</span> Generate case study with AI<span class="csgen__note">Turn notes, a deck &amp; links into a full, editable case study.</span></div>' +
      '<div class="csgen__body">' +
      '<div class="af"><label class="af__label">Source material</label>' +
      '<textarea data-csgen="material" data-csid="' + escAttr(w.id) + '" rows="5" placeholder="Paste context, notes, a deck\u2019s text, research findings, metrics, the decisions you made\u2026 the more the better.">' + escHtml(g.material) + "</textarea>" +
      '<div class="af__hint">Nothing here is published until you save. Images stay yours \u2014 the AI writes the words and leaves captioned image slots.</div></div>' +
      '<div class="af"><label class="af__label">Reference links</label>' +
      '<input type="text" data-csgen="links" data-csid="' + escAttr(w.id) + '" value="' + escAttr(g.links) + '" placeholder="Live URLs, articles, Figma\u2026 (comma separated)" />' +
      '<div class="af__hint">Sent as text context only \u2014 the AI can\u2019t open them, so summarise anything important in the notes above.</div></div>' +
      '<div class="af__row">' +
      '<div class="af"><label class="af__label">Tone</label><select data-csgen="tone" data-csid="' + escAttr(w.id) + '">' + toneOpts + '</select><div class="af__hint">Altitude of the storytelling voice.</div></div>' +
      '<div class="af"><label class="af__label">Deck / PDF</label><button class="btn btn--ghost csgen__pdf" data-act="csgen-pdf" data-index="' + i + '">Add PDF / deck\u2026</button><div class="af__hint">Extracts the text and appends it above.</div></div>' +
      "</div>" +
      '<div class="csgen__ref' + (g.refShow ? " is-open" : "") + '">' +
      '<button class="csgen__reftoggle" data-act="csgen-ref-toggle" data-index="' + i + '">' + (g.refShow ? "\u2212" : "+") + ' Paste a reference case study to echo (optional)</button>' +
      '<div class="af csgen__reffield"><textarea data-csgen="reference" data-csid="' + escAttr(w.id) + '" rows="4" placeholder="Paste a case study whose structure and voice you admire. The AI mirrors its shape, never its content.">' + escHtml(g.reference) + "</textarea></div>" +
      "</div>" +
      '<div class="csgen__actions"><button class="btn btn--auto" data-act="csgen-run" data-index="' + i + '">' + (hasStudy ? "Regenerate case study" : "Generate case study") + "</button>" +
      (hasStudy ? '<button class="btn btn--ghost" data-act="csgen-variant" data-index="' + i + '">Try a variant</button>' : "") +
      '<span class="csgen__status" data-csgen-status="' + i + '"></span></div>' +
      "</div></div>";
  }
  function csgenParse(raw) {
    if (!raw) return null;
    var s = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    try { return JSON.parse(s); } catch (e) {}
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a !== -1 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
    return null;
  }
  function csgenSystem(tone) {
    var toneGuide = {
      senior: "Voice: a Senior Product Designer. Confident, craft-forward and specific. Show the hands-on decisions and the reasoning behind them.",
      principal: "Voice: a Principal Product Designer. Strategic and systemic \u2014 frame the problem space, the bets, the tradeoffs and the influence across teams. Fewer pixels, more leverage.",
      executive: "Voice: a design executive / Head of Design. Business outcomes first, org and strategy altitude, crisp and declarative. Lead with impact and the shape of the decision, not process detail.",
    }[tone] || "";
    return [
      "You are a world-class product-design storyteller who ghost-writes portfolio case studies for senior designers. You write with restraint, specificity and momentum \u2014 no filler, no buzzwords, no AI throat-clearing.",
      toneGuide,
      "Follow this proven narrative arc (adapt it, don\u2019t label it mechanically): Overview \u2192 Impact snapshot \u2192 Quick context for outsiders \u2192 The problem (a sharp, surprising truth) \u2192 What we got wrong at first \u2192 Approach / research \u2192 The reframe \u2192 Design goal (a How-might-we) \u2192 Key decisions \u2192 Before / after \u2192 Outcome & impact \u2192 Reflection (with an \u2018if I had more time\u2019).",
      "Rules:",
      "- Ground everything in the material provided. NEVER invent specific numbers. If impact isn\u2019t given, use honest qualitative or clearly-directional phrasing (\u2018directional lift\u2019, \u2018double-digit\u2019, \u2018millions of sessions\u2019).",
      "- Short, declarative sentences. Vary the rhythm. Write like a person, not a deck.",
      "- nav labels are 1\u20132 words; kickers are tiny (\u2018Overview\u2019, \u2018The problem\u2019).",
      "- Leave imagery to the author: media blocks carry captions only, never URLs.",
      "Return ONLY valid JSON (no markdown, no commentary) matching EXACTLY this shape:",
      '{"tagline":string,"role":string,"team":string,"timeline":string,"scope":string,"blocks":[Block]}',
      "Block is one of:",
      '{"type":"text","nav":string,"kicker":string,"heading":string,"body":string,"list":[string]}',
      '{"type":"statement","nav":string,"kicker":string,"body":string,"sub":string}',
      '{"type":"metrics","nav":string,"kicker":string,"heading":string,"items":[{"value":string,"label":string}]}',
      '{"type":"steps","nav":string,"kicker":string,"heading":string,"items":[{"title":string,"body":string}]}',
      '{"type":"media","nav":string,"kicker":string,"heading":string,"items":[{"caption":string}]}',
      '{"type":"split","nav":string,"kicker":string,"heading":string,"leftLabel":string,"left":[string],"rightLabel":string,"right":[string]}',
      '{"type":"faq","nav":string,"kicker":string,"items":[{"q":string,"a":string}]}',
      "body supports light markdown (**bold**, *italic*). Aim for 8\u201312 blocks. Open with a text overview then a metrics snapshot; close with a reflection statement.",
    ].join("\n");
  }
  function csgenUser(w, g, variant) {
    var lines = ["PROJECT", "Title: " + (w.title || "")];
    if (w.client) lines.push("Client / context: " + w.client);
    if (w.period) lines.push("Period: " + w.period);
    if (w.desc) lines.push("One-liner: " + w.desc);
    if (w.tags && w.tags.length) lines.push("Themes: " + w.tags.join(", "));
    lines.push("", "SOURCE MATERIAL", g.material.trim() || "(none provided \u2014 infer a credible, non-fabricated narrative from the project fields above, keeping specifics vague where unknown.)");
    if (g.links.trim()) lines.push("", "REFERENCE LINKS (context only, cannot be opened): " + g.links.trim());
    if (g.reference.trim()) lines.push("", "STYLE REFERENCE (echo its structure and voice, NOT its content):", g.reference.trim());
    lines.push("", "TASK: Write the full case study as JSON per the schema. Tone: " + g.tone + ".");
    if (variant) lines.push("This is an ALTERNATE take \u2014 find a different angle, hook and structure from the obvious one, while staying faithful to the facts.");
    return lines.join("\n");
  }
  function csgenNormalize(obj, prev) {
    prev = prev || {};
    var str = function (v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); };
    var arr = function (v) { return Array.isArray(v) ? v.map(str).map(function (x) { return x.trim(); }).filter(Boolean) : []; };
    var out = blankStudy();
    out.cover = typeof prev.cover === "string" ? prev.cover : (prev.cover ? prev.cover : "");
    out.unlockHash = prev.unlockHash || "";
    ["tagline", "role", "team", "timeline", "scope"].forEach(function (k) { out[k] = str(obj[k]).trim() || prev[k] || ""; });
    var allowed = ["text", "statement", "metrics", "steps", "media", "split", "faq"];
    out.blocks = (Array.isArray(obj.blocks) ? obj.blocks : []).map(function (raw) {
      raw = raw || {};
      var b = blankBlock(allowed.indexOf(raw.type) !== -1 ? raw.type : "text");
      b.nav = str(raw.nav).trim(); b.kicker = str(raw.kicker).trim();
      if (b.type === "text") { b.heading = str(raw.heading).trim(); b.body = str(raw.body).trim(); b.list = arr(raw.list); }
      else if (b.type === "statement") { b.body = str(raw.body).trim(); b.sub = str(raw.sub).trim(); }
      else if (b.type === "metrics") { b.heading = str(raw.heading).trim(); b.items = (Array.isArray(raw.items) ? raw.items : []).map(function (it) { it = it || {}; return { value: str(it.value).trim(), label: str(it.label).trim() }; }).filter(function (it) { return it.value || it.label; }); }
      else if (b.type === "steps") { b.heading = str(raw.heading).trim(); b.items = (Array.isArray(raw.items) ? raw.items : []).map(function (it) { it = it || {}; return { title: str(it.title).trim(), body: str(it.body).trim() }; }).filter(function (it) { return it.title || it.body; }); }
      else if (b.type === "media") { b.heading = str(raw.heading).trim(); b.items = (Array.isArray(raw.items) ? raw.items : []).map(function (it) { return { caption: str(it && (it.caption != null ? it.caption : it)).trim() }; }).filter(function (it) { return it.caption; }); }
      else if (b.type === "split") { b.heading = str(raw.heading).trim(); b.leftLabel = str(raw.leftLabel).trim() || "Before"; b.rightLabel = str(raw.rightLabel).trim() || "After"; b.left = arr(raw.left); b.right = arr(raw.right); }
      else if (b.type === "faq") { b.items = (Array.isArray(raw.items) ? raw.items : []).map(function (it) { it = it || {}; return { q: str(it.q).trim(), a: str(it.a).trim() }; }).filter(function (it) { return it.q || it.a; }); }
      return b;
    });
    var locked = (prev.blocks || []).filter(function (b) { return b && b.locked; });
    out.blocks = out.blocks.concat(locked);
    return out;
  }
  async function csgenRun(i, variant) {
    var w = data.work[i]; if (!w) return;
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { csgenRun(i, variant); }); return; }
    var g = csgenState(w.id);
    if (!g.material.trim() && !g.links.trim() && !g.reference.trim()) { csgenStatus(i, "Add some notes or links first.", "err"); return; }
    var sel = '[data-act="csgen-run"][data-index="' + i + '"],[data-act="csgen-variant"][data-index="' + i + '"]';
    root.querySelectorAll(sel).forEach(function (b) { b.disabled = true; });
    csgenStatus(i, variant ? "Writing a fresh variant\u2026" : "Writing the case study\u2026 this can take a moment.", "run");
    try {
      var raw = await aiText(aiCfg("txt"), csgenSystem(g.tone), csgenUser(w, g, variant), { json: true, maxTokens: 4096, temperature: variant ? 0.95 : 0.65 });
      var obj = csgenParse(raw);
      if (!obj || !Array.isArray(obj.blocks) || !obj.blocks.length) throw new Error("The AI didn\u2019t return usable sections \u2014 try again or add more detail.");
      data.work[i].study = csgenNormalize(obj, w.study);
      saveDraft(true);
      renderL2();
      csgenStatus(i, "Done \u2014 every section below is editable.", "ok");
      status("Case study generated \u2014 review and edit anything.", true);
    } catch (e) {
      csgenStatus(i, (e && e.message) || "Generation failed.", "err");
      root.querySelectorAll(sel).forEach(function (b) { b.disabled = false; });
    }
  }
  function ensurePdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (ensurePdfJs._p) return ensurePdfJs._p;
    ensurePdfJs._p = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = function () { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; } catch (e) {} resolve(window.pdfjsLib); };
      s.onerror = function () { ensurePdfJs._p = null; reject(new Error("Couldn\u2019t load the PDF reader.")); };
      document.head.appendChild(s);
    });
    return ensurePdfJs._p;
  }
  function csgenAddPdf(i) {
    var w = data.work[i]; if (!w) return;
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "application/pdf,.pdf,.txt,.md,.markdown";
    inp.onchange = async function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var g = csgenState(w.id);
      csgenStatus(i, "Reading " + f.name + "\u2026", "run");
      try {
        var text = "";
        if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
          var pdfjs = await ensurePdfJs();
          var pdf = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
          var parts = [];
          for (var p = 1; p <= pdf.numPages; p++) {
            var page = await pdf.getPage(p);
            var content = await page.getTextContent();
            parts.push(content.items.map(function (it) { return it.str; }).join(" "));
          }
          text = parts.join("\n\n");
        } else { text = await f.text(); }
        text = (text || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        if (!text) throw new Error("No selectable text found (a scanned PDF has no text layer).");
        g.material = (g.material.trim() ? g.material.trim() + "\n\n" : "") + "\u2014 From " + f.name + " \u2014\n" + text;
        renderL2();
        csgenStatus(i, "Added text from " + f.name + ".", "ok");
      } catch (e) { csgenStatus(i, (e && e.message) || "Couldn\u2019t read that file.", "err"); }
    };
    inp.click();
  }

  /* ---------- AI landing formatter (propose \u2192 preview \u2192 accept) ---------- */
  function landingBrief() {
    var L = data.landing || {}, lines = ["CURRENT SITE (improve on this \u2014 don\u2019t just copy):",
      "Eyebrow: " + (L.eyebrow || ""), "Domains: " + (L.domains || ""),
      "Statement: " + String(L.statement || "").replace(/\n/g, " / "),
      "Intro: " + (L.intro || ""), "Presence: " + (L.presence || "")];
    if (L.aboutLead) lines.push("About lead: " + L.aboutLead);
    if (L.about) lines.push("About: " + String(L.about).replace(/\n+/g, " "));
    if (data.highlights && data.highlights.length) lines.push("Highlights: " + data.highlights.map(function (h) { return h.value + " " + h.label; }).join("; "));
    if (data.capabilities && data.capabilities.length) lines.push("Capabilities: " + data.capabilities.join(", "));
    return lines.join("\n");
  }
  function landingSystem(tone, picks) {
    var toneGuide = {
      senior: "Voice: a Senior Product Designer \u2014 confident, craft-forward, specific.",
      principal: "Voice: a Principal Product Designer \u2014 strategic, systemic, high-leverage.",
      executive: "Voice: a design executive \u2014 outcomes-first, crisp, declarative.",
    }[tone] || "";
    var want = [];
    if (picks.hero) want.push('"eyebrow": 2\u20134 word label; "domains": 2\u20134 dot-separated domains like "Growth \u00b7 AI \u00b7 Identity"; "statement": a 2\u20134 line hero headline using \\n between lines and *italics* on the final why/how word; "intro": one vivid sentence using **bold** for a leading role phrase and [[Name]] for products/companies; "presence": a short "Currently at [[Company]] \u2014 City" line');
    if (picks.about) want.push('"aboutLead": one strong opening line (may use *italics*); "about": 2\u20133 paragraphs separated by \\n\\n (use **bold**, *italics*, [[Name]]); "aboutSign": one personal closing line');
    if (picks.highlights) want.push('"highlights": 4\u20138 objects {"value","label"} \u2014 value is a punchy stat ("11+", "Billions", "2B+"), label is 2\u20134 words');
    if (picks.capabilities) want.push('"capabilities": 8\u201316 short capability phrases, 2\u20134 words each');
    return [
      "You are an elite portfolio copywriter for senior product designers. Precision and restraint \u2014 editorial, confident, zero fluff or AI clich\u00e9s.",
      toneGuide,
      "Site markdown: **bold** for a leading role phrase, *italics* for an emphasised closing word, [[Name]] to accent a product or company. Use them tastefully.",
      "Never fabricate employers, titles or numbers that contradict the brief. Improve clarity and impact while staying truthful.",
      "Return ONLY valid JSON with EXACTLY these keys: " + want.join("; ") + ".",
    ].join("\n");
  }
  function landingAiModal() {
    if (!aiHasKey("txt")) { aiKeyModal("txt", landingAiModal); return; }
    var modal = document.createElement("div");
    modal.className = "pass pass--wide";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">Draft your landing with AI</div>' +
      '<div class="pass__sub">Give it a brief, choose what to write, and preview before anything changes.</div>' +
      '<div class="laig">' +
      '<div class="af"><label class="af__label">Brief \u2014 who you are, what to emphasise</label><textarea id="laigBrief" rows="6">' + escHtml(landingBrief()) + "</textarea>" +
      '<div class="af__hint">Paste a bio, r\u00e9sum\u00e9 highlights or notes \u2014 edit the pre-filled context freely.</div></div>' +
      '<div class="af__row"><div class="af"><label class="af__label">Voice</label><select id="laigTone"><option value="senior">Senior</option><option value="principal">Principal</option><option value="executive">Executive</option></select></div>' +
      '<div class="af"><label class="af__label">Write</label><div class="laig__picks">' +
      '<label class="chk"><input type="checkbox" data-laig="hero" checked /> Hero</label>' +
      '<label class="chk"><input type="checkbox" data-laig="highlights" checked /> Highlights</label>' +
      '<label class="chk"><input type="checkbox" data-laig="capabilities" checked /> Capabilities</label>' +
      '<label class="chk"><input type="checkbox" data-laig="about" checked /> About</label>' +
      "</div></div></div></div>" +
      '<div class="laig__review" hidden></div>' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button><button class="btn btn--auto" data-gen>Generate draft</button><button class="btn btn--primary" data-apply hidden>Apply to site</button></div>' +
      '<div class="pass__note">Keys stay in this browser. Nothing is published \u2014 you still hit Publish when ready.</div></div>';
    document.body.appendChild(modal);
    var err = modal.querySelector(".pass__err");
    var review = modal.querySelector(".laig__review");
    var close = function () { modal.remove(); };
    function fld(label, id, val, area, rows) {
      return '<div class="af"><label class="af__label">' + label + "</label>" +
        (area ? '<textarea id="' + id + '" rows="' + (rows || 3) + '">' + escHtml(val || "") + "</textarea>" : '<input type="text" id="' + id + '" value="' + escAttr(val || "") + '" />') + "</div>";
    }
    function renderReview(o, picks) {
      var h = '<div class="laig__reviewhd">Review &amp; edit \u2014 nothing changes until you Apply.</div>';
      if (picks.hero) h += '<div class="laig__grp"><div class="laig__grptitle">Hero</div>' + fld("Eyebrow", "rvEyebrow", o.eyebrow) + fld("Domains", "rvDomains", o.domains) + fld("Statement (one line per row)", "rvStatement", Array.isArray(o.statement) ? o.statement.join("\n") : o.statement, true, 3) + fld("Intro", "rvIntro", o.intro, true, 3) + fld("Presence", "rvPresence", o.presence) + "</div>";
      if (picks.about) h += '<div class="laig__grp"><div class="laig__grptitle">About</div>' + fld("Lead line", "rvAboutLead", o.aboutLead, true, 2) + fld("Paragraphs (blank line between)", "rvAbout", Array.isArray(o.about) ? o.about.join("\n\n") : o.about, true, 6) + fld("Sign-off", "rvAboutSign", o.aboutSign) + "</div>";
      if (picks.highlights) h += '<div class="laig__grp"><div class="laig__grptitle">Highlights</div>' + fld("value | label per line", "rvHighlights", (o.highlights || []).map(function (x) { x = x || {}; return (x.value || "") + " | " + (x.label || ""); }).join("\n"), true, 5) + "</div>";
      if (picks.capabilities) h += '<div class="laig__grp"><div class="laig__grptitle">Capabilities</div>' + fld("one per line", "rvCaps", (o.capabilities || []).join("\n"), true, 6) + "</div>";
      review.innerHTML = h;
    }
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    modal.querySelector("[data-cancel]").addEventListener("click", close);
    modal.querySelector("[data-gen]").addEventListener("click", async function () {
      var picks = {}; modal.querySelectorAll("[data-laig]").forEach(function (c) { picks[c.dataset.laig] = c.checked; });
      if (!picks.hero && !picks.highlights && !picks.capabilities && !picks.about) { err.textContent = "Pick at least one section."; return; }
      err.textContent = "";
      var brief = modal.querySelector("#laigBrief").value.trim(), tone = modal.querySelector("#laigTone").value;
      var genBtn = modal.querySelector("[data-gen]"); genBtn.disabled = true; genBtn.textContent = "Writing\u2026";
      try {
        var obj = csgenParse(await aiText(aiCfg("txt"), landingSystem(tone, picks), "BRIEF / CONTEXT:\n" + (brief || "(none \u2014 infer tastefully from a senior product designer profile)") + "\n\nWrite the requested sections as JSON.", { json: true, maxTokens: 2048, temperature: 0.7 }));
        if (!obj) throw new Error("The AI didn\u2019t return usable copy \u2014 try again.");
        renderReview(obj, picks);
        review.hidden = false; modal.querySelector(".laig").hidden = true; genBtn.hidden = true;
        modal.querySelector("[data-apply]").hidden = false;
      } catch (e) { err.textContent = (e && e.message) || "Failed."; genBtn.disabled = false; genBtn.textContent = "Generate draft"; }
    });
    modal.querySelector("[data-apply]").addEventListener("click", function () {
      var g = function (id) { var el = modal.querySelector("#" + id); return el ? el.value : null; };
      var L = data.landing || (data.landing = {});
      if (g("rvEyebrow") != null) { L.eyebrow = g("rvEyebrow").trim(); L.domains = g("rvDomains").trim(); L.statement = g("rvStatement").replace(/\r/g, "").trim(); L.intro = g("rvIntro").trim(); L.presence = g("rvPresence").trim(); }
      if (g("rvAboutLead") != null) { L.aboutLead = g("rvAboutLead").trim(); L.about = g("rvAbout").replace(/\r/g, "").trim(); L.aboutSign = g("rvAboutSign").trim(); }
      if (g("rvHighlights") != null) data.highlights = g("rvHighlights").split("\n").map(function (ln) { return ln.trim(); }).filter(Boolean).map(function (ln) { var k = ln.indexOf("|"); return k === -1 ? { value: ln, label: "" } : { value: ln.slice(0, k).trim(), label: ln.slice(k + 1).trim() }; });
      if (g("rvCaps") != null) data.capabilities = g("rvCaps").split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
      close();
      renderBody(); apply(true);
      status("AI draft applied to your landing \u2014 review it, then Publish when ready.", true);
    });
  }

  /* ---------- shell / open / exit ---------- */
  function buildShell() {
    root = document.createElement("div");
    root.className = "adm";
    root.setAttribute("data-lenis-prevent", ""); // let the editor pane scroll natively (Lenis owns the page wheel)
    root.innerHTML =
      '<header class="adm__bar">' +
        '<div class="adm__brand"><span class="adm__pulse"></span>Admin Mode <small>content studio</small></div>' +
        '<nav class="adm__tabs">' + TABS.map((t) => '<button class="adm__tab" data-tab="' + t[0] + '">' + t[1] + "</button>").join("") + "</nav>" +
        '<div class="adm__actions">' +
          '<span class="adm__status">Editing local draft</span>' +
          '<button class="btn btn--ghost adm__viewtoggle" data-view>Preview</button>' +
          '<button class="btn btn--ghost" data-revert>Revert</button>' +
          '<button class="btn btn--ghost adm__pubcfg" data-pubcfg title="Publishing settings" aria-label="Publishing settings">\u2699</button>' +
          '<button class="btn btn--primary" data-publish>Publish</button>' +
          '<button class="btn adm__exit" data-exit aria-label="Exit admin">Exit ✕</button>' +
        "</div>" +
      "</header>" +
      '<div class="adm__main">' +
        '<div class="adm__editor"><div class="adm__body"></div>' +
          '<div class="adm__l2" hidden>' +
            '<div class="adm__l2-bar">' +
              '<button class="btn btn--ghost adm__l2-back" data-l2-back><span aria-hidden="true">\u2039</span> Back to projects</button>' +
              '<span class="adm__l2-title"></span>' +
            "</div>" +
            '<div class="adm__l2-body"></div>' +
          "</div>" +
        "</div>" +
        '<section class="adm__preview" aria-label="Live preview">' +
          '<div class="adm__preview-head"><span class="adm__preview-dot"></span>Live preview<small>riteshk.work</small></div>' +
          '<iframe class="adm__frame" title="Live preview of your site" src="' + PREVIEW_SRC + '"></iframe>' +
        "</section>" +
      "</div>";
    document.body.appendChild(root);
    body = root.querySelector(".adm__body");
    l2 = root.querySelector(".adm__l2");
    l2body = root.querySelector(".adm__l2-body");
    l2title = root.querySelector(".adm__l2-title");
    frame = root.querySelector(".adm__frame");

    // Guaranteed wheel scrolling for the editor pane. The site's Lenis smooth-scroll
    // captures the page wheel and preventDefaults it (even data-lenis-prevent can be
    // unreliable across builds), so we scroll the editor ourselves and stop the event
    // before it reaches Lenis. Scoped to the editor side; the preview iframe scrolls itself.
    root.addEventListener("wheel", function (e) {
      const ed = root.querySelector(".adm__editor");
      if (!ed || !ed.contains(e.target)) return;
      const factor = e.deltaMode === 1 ? 32 : (e.deltaMode === 2 ? Math.round(ed.clientHeight * 0.9) : 1);
      ed.scrollTop += e.deltaY * factor;
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false, capture: true });

    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    root.addEventListener("click", onClick);
    root.querySelectorAll(".adm__tab").forEach((t) =>
      t.addEventListener("click", () => { if (openStudy >= 0) closeL2({ render: false }); activeTab = t.dataset.tab; renderBody(); })
    );
    root.querySelector("[data-publish]").addEventListener("click", publish);
    root.querySelector("[data-pubcfg]").addEventListener("click", () => publishModal());
    root.querySelector("[data-revert]").addEventListener("click", revert);
    root.querySelector("[data-exit]").addEventListener("click", exit);
    root.querySelector("[data-l2-back]").addEventListener("click", () => closeL2());
    root.querySelector("[data-view]").addEventListener("click", (e) => {
      root.classList.toggle("is-preview");
      e.currentTarget.textContent = root.classList.contains("is-preview") ? "Edit" : "Preview";
    });
    frame.addEventListener("load", previewApply);
    document.addEventListener("keydown", onKey);
  }

  function onKey(e) { if (e.key === "Escape" && root && root.classList.contains("is-open")) exit(); }

  function open() {
    // Always base the editor on the latest PUBLISHED content. Only resume a saved
    // draft if it was built on that same published content (matching signature);
    // otherwise it's stale (content.json changed under it) and is discarded so the
    // admin never shows outdated modules or republishes over newer content.
    const pub = (window.RK && window.RK.published) ? window.RK.published : (window.RK && window.RK.data);
    const draft = readDraft();
    const draftSig = localStorage.getItem(DRAFT_SIG_KEY);
    const pubSig = (window.RK && window.RK.publishedSig) || "";
    let staleDiscarded = false;
    if (draft && draftSig && pubSig && draftSig === pubSig) {
      data = draft;
    } else {
      if (draft) { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(DRAFT_SIG_KEY); staleDiscarded = true; }
      data = clone(pub);
    }
    if (!root) buildShell();
    activeTab = "landing";
    openStudy = -1;
    if (l2) { l2.hidden = true; l2.classList.remove("is-open"); }
    if (body) body.hidden = false;
    renderBody();
    document.documentElement.classList.add("adm-lock");
    document.body.classList.add("adm-lock");
    requestAnimationFrame(() => root.classList.add("is-open"));
    if (frame && frame.contentWindow && frame.contentWindow.RK) previewApply();
    if (staleDiscarded) status("Loaded the latest published content (an old local draft was discarded).", true);
  }

  function exit() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) {}
    if (window.RK) { window.RK.data = clone(data); try { window.RK.render(data); } catch (e) {} forceReveal(); }
    if (root) root.classList.remove("is-open");
    document.documentElement.classList.remove("adm-lock");
    document.body.classList.remove("adm-lock");
  }

  /* ---------- passphrase gate (always asks) ---------- */
  function gate() {
    if (window.innerWidth < ADMIN_MIN) { flash("Admin mode needs a wider screen — open it on a laptop or desktop."); return; }
    const stored = localStorage.getItem(HASH_KEY);
    const creating = !stored;
    const modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">' + (creating ? "Set admin key" : "Admin mode") + "</div>" +
      '<div class="pass__sub">' + (creating
        ? "Create a key for this browser. (It guards this editor only — publishing still requires your repo.)"
        : "Enter your key to open the studio. Required every time.") + "</div>" +
      '<input type="password" placeholder="Key" autofocus />' +
      (creating ? '<input type="password" placeholder="Confirm key" data-confirm />' : "") +
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
      if (!val) { err.textContent = "Enter your key"; return; }
      if (creating) {
        if (val.length < 4) { err.textContent = "Use at least 4 characters"; return; }
        if (confirm2 && confirm2.value !== val) { err.textContent = "Keys don't match"; return; }
        localStorage.setItem(HASH_KEY, await sha256(val));
        done(); open();
      } else {
        if ((await sha256(val)) === stored) { done(); open(); }
        else { err.textContent = "Incorrect key"; }
      }
    }
    modal.querySelector("[data-go]").addEventListener("click", submit);
    modal.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") done(); });
  }

  /* ---------- control menu (clock flyout) ---------- */
  /* ---------- ambient music player (Web Audio synth, with optional audio files) ---------- */
  let audioEl = null, synth = null, musCur = 0, musArmed = false, musPlaying = false, musLastLight = null, musAnnounced = false, musVisArmed = false, soundToastTimer = 0;
  function musTracks() {
    var m = window.RK && window.RK.data && window.RK.data.music;
    var ok = Array.isArray(m) ? m.filter(function (t) { return t && (t.src || t.gen); }) : [];
    return ok.length ? ok : DEFAULT_TRACKS;
  }
  function musCurTrack() { var l = musTracks(); return l[musCur] || l[0]; }
  function musDefaultTrack() {
    var light = window.__theme ? window.__theme.isLight() : (document.documentElement.getAttribute("data-appearance") === "light");
    return Math.min(light ? 1 : 0, Math.max(0, musTracks().length - 1));
  }
  /* Evolving low ambient pad synthesised in the browser — one preset per mood. */
  function makeSynth() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    var ctx, master, filter, lfo, lfoGain, voices = [], vol = 0.16, pending = "midnight";
    var P = {
      midnight: { f: [55, 82.41, 110, 164.81], cut: 620, vol: 0.17, sweep: 130, rate: 0.035 },
      ember: { f: [65.41, 98, 130.81, 164.81], cut: 850, vol: 0.15, sweep: 150, rate: 0.05 },
      undertow: { f: [49, 73.42, 110, 146.83], cut: 470, vol: 0.17, sweep: 120, rate: 0.03 }
    };
    function build() {
      ctx = new Ctx();
      master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
      filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 600; filter.Q.value = 0.8; filter.connect(master);
      lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.04;
      lfoGain = ctx.createGain(); lfoGain.gain.value = 130; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start();
    }
    function preset(name) {
      if (!ctx) build();
      var p = P[name] || P.midnight;
      voices.forEach(function (o) { try { o.stop(); } catch (e) {} }); voices = [];
      var g0 = 1 / (p.f.length * 2 + 1);
      p.f.forEach(function (freq) {
        [-6, 6].forEach(function (dt) {
          var o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = freq; o.detune.value = dt;
          var g = ctx.createGain(); g.gain.value = g0;
          o.connect(g); g.connect(filter); o.start(); voices.push(o);
        });
      });
      filter.frequency.value = p.cut; lfoGain.gain.value = p.sweep; lfo.frequency.value = p.rate; vol = p.vol;
    }
    return {
      play: function (name) { if (!ctx) build(); if (name) preset(name); else if (!voices.length) preset(pending); if (ctx.state === "suspended") ctx.resume(); master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(vol, ctx.currentTime, 2.2); },
      pause: function () { if (!ctx) return; master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(0, ctx.currentTime, 0.5); },
      set: function (name) { pending = name; if (ctx) preset(name); },
      running: function () { return !!ctx && ctx.state === "running"; }
    };
  }
  function synthEnsure() { if (synth === null) synth = makeSynth(); return synth; }
  function audioEnsure() {
    if (audioEl) return audioEl;
    audioEl = new Audio(); audioEl.preload = "none"; audioEl.volume = 0.07; audioEl.loop = true;
    audioEl.addEventListener("playing", musRefresh);
    audioEl.addEventListener("pause", musRefresh);
    audioEl.addEventListener("volumechange", musRefresh);  // fires on mute/unmute
    audioEl.addEventListener("error", musSync);
    return audioEl;
  }
  function musStop() { if (audioEl) audioEl.pause(); if (synth) synth.pause(); }
  function musLoad(i, play) {
    var list = musTracks(); if (!list.length) return;
    musCur = ((i % list.length) + list.length) % list.length;
    try { localStorage.setItem(MUSIC_TRACK_KEY, String(musCur)); } catch (e) {}
    var t = list[musCur];
    if (t.src) { var a = audioEnsure(); if (a.getAttribute("src") !== t.src) a.src = t.src; if (synth) synth.pause(); }
    else { if (audioEl) audioEl.pause(); var s = synthEnsure(); if (s) s.set(t.gen || "midnight"); }
    if (play) musPlay(); else musSync();
  }
  function musArm() {
    if (musArmed) return; musArmed = true;
    // These count as a user gesture, so the browser lets audio start: a click/tap anywhere,
    // keyboard scrolling (Space / arrows / PageDown), touch scrolling, or dragging the scrollbar.
    var act = ["pointerdown", "mousedown", "keydown", "touchstart"];
    var opts = { capture: true, passive: true };
    var triedWheel = false;
    function disarm() {
      musArmed = false;
      act.forEach(function (ev) { window.removeEventListener(ev, go, opts); });
      window.removeEventListener("wheel", onWheel, opts);
      if (audioEl) audioEl.removeEventListener("playing", disarm);
    }
    function go() {
      if (localStorage.getItem(MUSIC_ON_KEY) === "0") { disarm(); return; }
      musPlay();
    }
    function onWheel() { if (triedWheel) return; triedWheel = true; go(); }  // one attempt (a mouse wheel usually isn't a valid unlock gesture)
    act.forEach(function (ev) { window.addEventListener(ev, go, opts); });
    window.addEventListener("wheel", onWheel, opts);
    var a = audioEnsure(); if (a) a.addEventListener("playing", disarm);  // stop once sound truly starts
  }
  function musAutoStart() {
    var t = musCurTrack(); if (!t) return;
    if (!t.src) { musArm(); return; }
    musPlay();          // try TRUE audible autoplay now (succeeds if the browser already trusts this site)
    musArmVisible();    // ...and retry when the tab gains focus (opened-in-a-background-tab then switched to — YouTube-style)
    setTimeout(function () {   // if the browser blocked autoplay, invite the one tap that unlocks sound
      if (localStorage.getItem(MUSIC_ON_KEY) === "0") return;
      if (audioEl && !audioEl.paused && !audioEl.muted) return;   // already audible — the browser trusted it
      musAttract(true);
    }, 1000);
  }
  function musAttract(show) {
    var cue = document.querySelector(".hero__cue");
    if (cue) cue.classList.toggle("is-attract", !!show);
  }
  function musToast() {
    var el = document.querySelector(".soundtoast");
    if (!el) {
      el = document.createElement("button");
      el.className = "soundtoast";
      el.setAttribute("aria-label", "Sound on");
      el.innerHTML = '<span class="soundtoast__eq" aria-hidden="true"><i></i><i></i><i></i></span><span>Sound on</span>';
      el.addEventListener("click", function () { musToastHide(); });
      document.body.appendChild(el);
    }
    requestAnimationFrame(function () { el.classList.add("is-on"); });
    clearTimeout(soundToastTimer);
    soundToastTimer = setTimeout(musToastHide, 8000);
  }
  function musToastHide() {
    var el = document.querySelector(".soundtoast");
    if (el) el.classList.remove("is-on");
    clearTimeout(soundToastTimer);
  }
  function musArmVisible() {
    if (musVisArmed) return; musVisArmed = true;
    function disarm() { musVisArmed = false; document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); }
    function onVis() {
      if (document.hidden) return;
      if (localStorage.getItem(MUSIC_ON_KEY) === "0") { disarm(); return; }
      if (audioEl && !audioEl.paused && !audioEl.muted) { disarm(); return; }   // already audible
      musPlay();   // focus counts for browsers that trust the site (engagement/MEI); otherwise it stays paused until a click
    }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
  }
  function musPlay() {
    var t = musCurTrack(); if (!t) return;
    try { localStorage.setItem(MUSIC_ON_KEY, "1"); } catch (e) {}
    if (t.src) {
      if (synth) synth.pause();
      var a = audioEnsure();
      a.muted = false;
      var p = a.play();
      if (p && p.catch) p.catch(function () { musArm(); });
      // musPlaying flips true via the audio 'playing'/'volumechange' events when sound is audible
    } else {
      if (audioEl) audioEl.pause();
      var s = synthEnsure();
      if (!s) { musArm(); musSync(); return; }
      s.play(t.gen || "midnight");
      if (s.running()) musPlaying = true; else musArm();
      musSync();
    }
  }
  function musPause() { musStop(); musPlaying = false; try { localStorage.setItem(MUSIC_ON_KEY, "0"); } catch (e) {} musAttract(false); musToastHide(); musSync(); }
  function musToggle() { if (musPlaying) musPause(); else musPlay(); }
  function musRefresh() {
    var ct = musCurTrack();
    if (ct && ct.src) {
      var audible = !!(audioEl && !audioEl.paused && !audioEl.muted);
      if (audible) {
        musAttract(false);
        if (!musAnnounced) { musAnnounced = true; musToast(); }
      }
      musPlaying = audible;
    }
    musSync();
  }
  function musSync() {
    var mw = document.querySelector(".nav__morewrap");
    if (mw) mw.classList.toggle("is-hint", musPlaying);
    if (!menuEl) return;
    var btn = menuEl.querySelector('[data-mus="toggle"]');
    if (btn) { btn.innerHTML = musPlaying ? MUS_ICON.pause : MUS_ICON.play; btn.setAttribute("aria-label", musPlaying ? "Pause" : "Play"); }
    var title = menuEl.querySelector(".mus__title");
    if (title) { var t = musCurTrack(); title.textContent = (t && t.title) || "Ambient"; }
    var sub = menuEl.querySelector(".mus__sub");
    if (sub) {
      var ct = musCurTrack();
      var E = (window.RK && window.RK.esc) || function (s) { return String(s); };
      if (ct && ct.src && audioEl && audioEl.error) { sub.textContent = "Track unavailable"; }
      else if (ct && ct.artist) {
        var who = ct.url ? '<a href="' + E(ct.url) + '" target="_blank" rel="noopener">' + E(ct.artist) + "</a>" : E(ct.artist);
        sub.innerHTML = who + (ct.license ? ' \u00b7 <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">' + E(ct.license) + "</a>" : "");
      } else { sub.textContent = "Deep ambient \u00b7 loops"; }
    }
  }
  function musThemeChange(e) {
    var light = (e && e.detail && typeof e.detail.light === "boolean") ? e.detail.light : (window.__theme ? window.__theme.isLight() : false);
    if (musLastLight === light) return;
    musLastLight = light;
    var target = Math.min(light ? 1 : 0, musTracks().length - 1);
    if (target === musCur) { musSync(); return; }
    musLoad(target, musPlaying);
  }
  function musInit() {
    if (!musTracks().length) return;
    musLastLight = window.__theme ? window.__theme.isLight() : (document.documentElement.getAttribute("data-appearance") === "light");
    musCur = musDefaultTrack();
    musLoad(musCur, false);
    var heroCue = document.querySelector(".hero__cue");
    if (heroCue && !heroCue.__musBound) {
      heroCue.__musBound = true;
      heroCue.addEventListener("click", function () {
        if (localStorage.getItem(MUSIC_ON_KEY) === "0") return;          // respect an explicit “off”
        if (!(audioEl && !audioEl.paused && !audioEl.muted)) musPlay();  // start / keep the music going, never pause
      });
    }
    window.addEventListener("theme:change", musThemeChange);
    if (localStorage.getItem(MUSIC_ON_KEY) !== "0") musAutoStart();
  }

  function buildMenu() {
    const theme = (window.__theme ? window.__theme.mode() : (localStorage.getItem(THEME_KEY) || "system"));
    const narrow = window.innerWidth < ADMIN_MIN;
    menuEl = document.createElement("div");
    menuEl.className = "cmenu";
    menuEl.innerHTML =
      '<div class="cmenu__grp"><div class="cmenu__head">Ambience</div>' +
        '<div class="mus">' +
          '<button class="mus__btn" data-mus="prev" aria-label="Previous track">' + MUS_ICON.prev + "</button>" +
          '<button class="mus__btn mus__btn--play" data-mus="toggle" aria-label="Play">' + MUS_ICON.play + "</button>" +
          '<button class="mus__btn" data-mus="next" aria-label="Next track">' + MUS_ICON.next + "</button>" +
          '<div class="mus__meta"><div class="mus__title">Ambient</div><div class="mus__sub">Deep ambient \u00b7 loops</div></div>' +
        "</div></div>" +
      '<div class="cmenu__sep"></div>' +
      '<div class="cmenu__grp"><div class="cmenu__head">Appearance</div>' +
        '<div class="cmenu__themes">' +
          [["day", "Light", "Always light"], ["night", "Dark", "Always dark"], ["system", "System", "Match your device"], ["local", "Local", "Light by day, dark by night \u2014 your local time"]].map(function (t) {
            return '<button class="cmenu__theme' + (t[0] === theme ? " is-on" : "") + '" data-theme="' + t[0] + '" title="' + t[2] + '">' + t[1] + "</button>";
          }).join("") +
        "</div></div>" +
      '<div class="cmenu__sep"></div>' +
      '<button class="cmenu__item" data-open="special"><span class="cmenu__ico">\u25c7</span><span><b>Special view</b><i>Enter a ticket for a curated view</i></span></button>' +
      '<button class="cmenu__item" data-open="admin"' + (narrow ? " disabled" : "") + '><span class="cmenu__ico">\u2726</span><span><b>Admin mode</b><i>' + (narrow ? "Needs a wider screen" : "Edit &amp; curate the site") + "</i></span></button>";
    document.body.appendChild(menuEl);
    positionMenu();
    musSync();
    menuEl.addEventListener("click", onMenuClick);
    window.addEventListener("resize", positionMenu);
    setTimeout(function () { document.addEventListener("click", onDocClick); }, 0);
  }
  function positionMenu() {
    const anchor = document.getElementById("moreBtn") || document.getElementById("clock");
    if (!anchor || !menuEl) return;
    const r = anchor.getBoundingClientRect();
    menuEl.style.top = (r.bottom + 12) + "px";
    menuEl.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + "px";
  }
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove(); menuEl = null;
    document.removeEventListener("click", onDocClick);
    window.removeEventListener("resize", positionMenu);
  }
  function onDocClick(e) { if (menuEl && !menuEl.contains(e.target) && e.target.id !== "clock") closeMenu(); }
  function toggleMenu(e) { if (e) e.stopPropagation(); if (menuEl) closeMenu(); else buildMenu(); }
  function onMenuClick(e) {
    const mus = e.target.closest("[data-mus]");
    if (mus) {
      const m = mus.dataset.mus;
      if (m === "toggle") musToggle();
      else if (m === "next") musLoad(musCur + 1, musPlaying);
      else if (m === "prev") musLoad(musCur - 1, musPlaying);
      return;
    }
    const th = e.target.closest(".cmenu__theme");
    if (th) {
      if (window.__theme) window.__theme.set(th.dataset.theme);
      else localStorage.setItem(THEME_KEY, th.dataset.theme);
      menuEl.querySelectorAll(".cmenu__theme").forEach(function (b) { b.classList.toggle("is-on", b === th); });
      return;
    }
    const it = e.target.closest("[data-open]");
    if (!it || it.disabled) return;
    const which = it.dataset.open;
    closeMenu();
    if (which === "special") ticketDialog();
    else if (which === "admin") gate();
  }

  /* ---------- ticket entry (visitor) ---------- */
  function ticketDialog() {
    const modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">Special view</div>' +
      '<div class="pass__sub">Enter the ticket you were given to unlock a curated view of the work.</div>' +
      '<input type="text" placeholder="Your ticket" autocomplete="off" autofocus />' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button>' +
      '<button class="btn btn--primary" data-go>Enter</button></div></div>';
    document.body.appendChild(modal);
    const inp = modal.querySelector("input");
    const err = modal.querySelector(".pass__err");
    inp.focus();
    const done = () => modal.remove();
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    modal.addEventListener("click", (e) => { if (e.target === modal) done(); });
    async function submit() {
      const val = inp.value.trim();
      if (!val) { err.textContent = "Enter your ticket"; return; }
      const h = await sha256(val.toLowerCase());
      const views = (window.RK && window.RK.data && window.RK.data.specialViews) || [];
      const match = views.filter(function (v) { return v.ticketHash === h; })[0];
      if (!match) { err.textContent = "That ticket doesn't match anything."; return; }
      if (window.RK.svExpired(match)) { err.textContent = "This curated view has expired."; return; }
      done();
      window.RK.applySpecialView(match.id);
    }
    modal.querySelector("[data-go]").addEventListener("click", submit);
    modal.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") done(); });
  }

  /* ---------- tiny toast ---------- */
  let flashTimer = null;
  function flash(msg) {
    let el = document.querySelector(".rk-flash");
    if (!el) { el = document.createElement("div"); el.className = "rk-flash"; document.body.appendChild(el); }
    el.textContent = msg;
    requestAnimationFrame(function () { el.classList.add("is-on"); });
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove("is-on"); }, 2600);
  }

  /* ---------- bootstrap ---------- */
  function init() {
    const clock = document.getElementById("clock");
    if (clock) clock.addEventListener("click", toggleMenu);
    const more = document.getElementById("moreBtn");
    if (more) more.addEventListener("click", toggleMenu);
    musInit();
  }
  if (window.__siteRendered) init();
  else document.addEventListener("site:rendered", init, { once: true });
})();
