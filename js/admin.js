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
  const L2PREV_KEY = "rk:adm:l2prev"; // remember the L2 live-preview on/off choice
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
  const GH_RAW = "https://raw.githubusercontent.com/" + GH_OWNER + "/" + GH_REPO + "/" + GH_BRANCH + "/";
  const GH_FILE_API = "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/";
  const UPLOAD_DIR = "assets/uploads/";
  // Where a visitor actually sees the site — used to confirm a publish is live.
  const LIVE_ORIGIN = (/(^|\.)riteshk\.work$/i.test(location.hostname) || /\.github\.io$/i.test(location.hostname)) ? location.origin : "https://riteshk.work";
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
  const SECTION_GALLERY = [
    { type: "text", name: "Text", tag: "Narrative", desc: "A heading, a paragraph and optional bullets \u2014 your everyday storytelling block.", best: "Context \u00b7 problem \u00b7 approach \u00b7 learnings" },
    { type: "statement", name: "Statement", tag: "Pull-quote", desc: "One bold line that stands on its own, with an optional sub-line.", best: "A thesis \u00b7 a principle \u00b7 a takeaway" },
    { type: "metrics", name: "Metrics", tag: "Impact", desc: "A row of big numbers, each with a small label.", best: "Results \u2014 users, growth, ratings, revenue" },
    { type: "steps", name: "Steps", tag: "Process", desc: "A numbered sequence of titled steps.", best: "Your approach, method or timeline" },
    { type: "media", name: "Media", tag: "Visuals", desc: "Images, video, Figma, PDF or slides with captions.", best: "Screens \u00b7 prototypes \u00b7 before/after shots" },
    { type: "split", name: "Before / after", tag: "Compare", desc: "Two labelled columns placed side by side.", best: "Before vs after \u00b7 problem vs solution" },
    { type: "faq", name: "FAQ", tag: "Q & A", desc: "A list of question-and-answer pairs.", best: "Objections \u00b7 context \u00b7 scope \u00b7 details" },
    { type: "cards", name: "Cards", tag: "Columns", desc: "A row of titled cards, each with a short line \u2014 no step numbers.", best: "Feature sets \u00b7 principles \u00b7 pillars" },
    { type: "gallery", name: "Gallery", tag: "Carousel", desc: "A swipeable strip of visuals with captions and a 1/N counter.", best: "Key features \u00b7 screen tours \u00b7 shots" },
    { type: "figure", name: "Figure", tag: "Image + text", desc: "A visual beside a short write-up \u2014 image left or right.", best: "A decision explained next to its screen" },
    { type: "columns", name: "Columns", tag: "Text table", desc: "Multiple columns of titled text \u2014 add a heading or image to any column.", best: "Overview + What I did \u00b7 feature columns" },
    { type: "rows", name: "Rows", tag: "Text table", desc: "Stacked rows of titled cells \u2014 a labelled row header with cells side by side.", best: "Comparisons \u00b7 phased breakdowns \u00b7 matrices" },
    { type: "compare", name: "Before / after slider", tag: "Compare", desc: "Two images overlaid with a divider you drag to reveal before vs after.", best: "Redesigns \u00b7 visual transformations" },
    { type: "stickies", name: "Sticky notes", tag: "Research", desc: "Staggered note cards \u2014 each with a label, heading, body and image, with a gentle hover lift.", best: "Research methods \u00b7 findings \u00b7 inspiration" },
    { type: "voices", name: "Voices", tag: "Qual", desc: "Verbatims, thoughts or a chat thread \u2014 quote bubbles with a sharp, soft or two-way tail.", best: "User quotes \u00b7 assumption vs reality \u00b7 insights" },
  ];

  let data = null;
  let activeTab = "landing";
  let openStudy = -1; // index of the work item whose case-study editor is expanded
  let openBlock = -1; // which section (block) is expanded in the L2 sections accordion
  let musResumeOnExit = false; // was music playing when admin opened? → resume on exit
  let root = null, body = null, frame = null;
  let l2 = null, l2body = null, l2title = null, l2PreviewTimer = 0;
  let saveTimer = null;
  let sortState = null;
  let menuEl = null;
  const ticketPlain = {}; // owner-only plaintext tickets, never published
  const studyUnlockPlain = {}; // owner-only plaintext deeper-cut passes, never published
  const hostedBytes = {}; // "/assets/uploads/<hash>.<ext>" -> data URI (this session) for instant local preview

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
        status("Draft saved locally");
      } catch (e) {
        status("\u26a0 Draft too big to auto-save locally \u2014 your images are safe at full quality here. Hit Publish to store them (large ones are hosted as files automatically).");
      }
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
      try { w.RK.render(resolvePreviewData(data)); forceRevealDoc(w.document); } catch (e) {}
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
    return '<div class="card__bar"><span class="sortgrip" data-grip data-sortkey="list:' + list + '" title="Drag to reorder" aria-label="Drag to reorder">' + GRIP_SVG + '</span><span class="card__idx">' + idxLabel + "</span>" + ops(list, i, len) + "</div>";
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
    return '<div class="imgblk"><div class="af__label">Cover image</div>' +
      '<div class="af__hint" style="margin:-.15rem 0 .5rem">Used as the case-study cover AND the homepage card thumbnail. Leave empty to show an animated plate below.</div>' +
      '<div class="imgblk__preview' + (has ? " has" : "") + '">' + (has ? '<img src="' + escAttr(previewSrc(w.image)) + '" alt="" />' : "<span>No image \u2014 the animated placeholder is shown</span>") + "</div>" +
      '<input type="text" data-list="work" data-index="' + i + '" data-field="image" value="' + escAttr(w.image || "") + '" placeholder="Paste an image URL\u2026" />' +
      '<div class="imgblk__row"><button class="btn btn--ghost" data-act="img-upload" data-index="' + i + '">Upload\u2026</button>' +
      (has ? '<button class="btn btn--ghost" data-act="img-clear" data-index="' + i + '">Remove</button>' : "") + "</div>" +
      '<div class="af__label" style="margin:.7rem 0 .2rem">Or use an animated placeholder \u2014 no upload, always on-brand</div>' +
      '<div class="imgblk__plates">' + plates + "</div>" +
      itemField("work", i, "plateTag", "Tag on the cover / plate", { hint: "the small label shown on the card & cover, e.g. \u201cFirst Run Experience\u201d" }) +
      '<div class="imgblk__ai"><input type="text" data-aiprompt="' + i + '" placeholder="' + aiHint + '"' + (canGen ? "" : " disabled") + " />" +
      '<div class="imgblk__row"><button class="btn btn--auto" data-act="img-generate" data-index="' + i + '"' + (canGen ? "" : " disabled") + ">Generate</button>" +
      '<button class="btn btn--ghost" data-act="img-modify" data-index="' + i + '"' + (canGen && has ? "" : " disabled") + ">Modify current</button></div>" +
      '<div class="imgblk__hint">Uploads are embedded at full, original quality \u2014 no compression or resizing. For very large images, host them and paste a URL to keep the published file lean.</div></div></div>';
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
      case "statement": return { type: "statement", nav: "", kicker: "", body: "", sub: "", src: "", caption: "" };
      case "metrics": return { type: "metrics", nav: "", kicker: "", heading: "", items: [] };
      case "steps": return { type: "steps", nav: "", kicker: "", heading: "", items: [] };
      case "media": return { type: "media", nav: "", kicker: "", heading: "", items: [] };
      case "split": return { type: "split", nav: "", kicker: "", heading: "", leftLabel: "Before", left: [], leftImg: "", rightLabel: "After", right: [], rightImg: "" };
      case "faq": return { type: "faq", nav: "", kicker: "", items: [] };
      case "cards": return { type: "cards", nav: "", kicker: "", heading: "", items: [] };
      case "gallery": return { type: "gallery", nav: "", kicker: "", heading: "", items: [] };
      case "figure": return { type: "figure", nav: "", kicker: "", heading: "", body: "", src: "", caption: "", flip: false };
      case "columns": return { type: "columns", nav: "", kicker: "", heading: "", items: [] };
      case "rows": return { type: "rows", nav: "", kicker: "", heading: "", items: [] };
      case "compare": return { type: "compare", nav: "", kicker: "", heading: "", beforeSrc: "", afterSrc: "", beforeLabel: "Before", afterLabel: "After", body: "" };
      case "stickies": return { type: "stickies", nav: "", kicker: "", heading: "", items: [] };
      case "voices": return { type: "voices", nav: "", kicker: "", heading: "", mode: "verbatim", vsize: "", items: [] };
      default: return { type: "text", nav: "Section", kicker: "", heading: "", body: "", list: [], src: "", caption: "" };
    }
  }
  function studyLines(text) { return String(text || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean); }
  function studyPipe(line) { var k = line.indexOf("|"); return k === -1 ? [line.trim(), ""] : [line.slice(0, k).trim(), line.slice(k + 1).trim()]; }
  function parseItems(type, text) {
    return studyLines(text).map(function (line) {
      var p = studyPipe(line);
      var parts = line.split("|").map(function (s) { return s.trim(); });
      if (type === "metrics") return { value: p[0], label: p[1] };
      if (type === "steps") return { title: p[0], body: p[1] };
      if (type === "cards") return { title: parts[0] || "", body: parts[1] || "", icon: parts[2] || "", src: parts[3] || "" };
      if (type === "columns") return { label: parts[0] || "", heading: parts[1] || "", body: parts[2] || "", src: parts[3] || "" };
      if (type === "rows") return { label: parts[0] || "", heading: parts[1] || "", body: parts[2] || "", src: parts[3] || "" };
      if (type === "faq") return { q: p[0], a: p[1] };
      if (type === "media" || type === "gallery") return p[0] ? { src: p[0], caption: p[1] } : { caption: p[1] };
      return {};
    });
  }
  function joinPipes(arr) { var a = (arr || []).map(function (x) { return (x == null ? "" : String(x)); }); while (a.length > 1 && !a[a.length - 1]) a.pop(); return a.join(" | "); }
  function itemsToText(type, items) {
    return (items || []).map(function (it) {
      if (type === "metrics") return (it.value || "") + " | " + (it.label || "");
      if (type === "steps") return (it.title || "") + " | " + (it.body || "");
      if (type === "cards") return joinPipes([it.title, it.body, it.icon, it.src]);
      if (type === "columns") return joinPipes([it.label, it.heading, it.body, it.src]);
      if (type === "rows") return joinPipes([it.label, it.heading, it.body, it.src]);
      if (type === "faq") return (it.q || "") + " | " + (it.a || "");
      if (type === "media" || type === "gallery") return (it.src || it.image || "") + " | " + (it.caption || "");
      return "";
    }).join("\n");
  }
  function listToText(arr) { return (arr || []).join("\n"); }
  function arrToListHtml(arr) { return (arr && arr.length) ? "<ul>" + arr.map(function (x) { return "<li>" + rtInlineMd(escForRt(x)) + "</li>"; }).join("") + "</ul>" : ""; }

  function sfInput(i, j, field, label, hint) {
    var b = data.work[i].study.blocks[j];
    return '<div class="af"><label class="af__label">' + label + '</label><input type="text" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="' + field + '" value="' + escAttr(b[field] || "") + '" />' + (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
  }
  function sfArea(i, j, field, label, value, rows, hint) {
    return '<div class="af"><label class="af__label">' + label + '</label><textarea data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="' + field + '" rows="' + (rows || 3) + '">' + escHtml(value) + "</textarea>" + (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
  }
  function sfSelect(i, j, field, label, opts, hint) {
    var b = data.work[i].study.blocks[j];
    var cur = b[field] || "";
    var options = opts.map(function (o) { return '<option value="' + o[0] + '"' + (cur === o[0] ? " selected" : "") + ">" + escHtml(o[1]) + "</option>"; }).join("");
    return '<div class="af"><label class="af__label">' + label + '</label><select data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="' + field + '">' + options + "</select>" + (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
  }
  /* ---------- rich-text editor (contenteditable toolbar) ---------- */
  var RT_IMG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/></svg>';
  var RT_CLEAR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h11"/><path d="M14 4l6 6-8.5 8.5H7L3.5 15a1.6 1.6 0 0 1 0-2.3z"/><path d="M9 9l6 6"/></svg>';
  var RT_UNDO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6L4 11l5 5"/><path d="M4 11h10a6 6 0 0 1 0 12h-3"/></svg>';
  var RT_REDO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l5 5-5 5"/><path d="M20 11H10a6 6 0 0 0 0 12h3"/></svg>';
  function rtAlignIco(a) {
    var d = a === "center" ? "M6 6h12M4 11h16M6 16h12M4 21h16" : a === "right" ? "M8 6h12M4 11h16M8 16h12M4 21h16" : "M4 6h12M4 11h16M4 16h12M4 21h16";
    return '<svg viewBox="0 0 24 24" width="14" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="' + d + '"/></svg>';
  }
  function rtIndentIco(dir) {
    var lines = dir === "in" ? "M4 6h16M11 12h9M4 18h16" : "M20 6H4M20 12h-9M20 18H4";
    var arrow = dir === "in" ? "M4 9l3 3-3 3" : "M7 9l-3 3 3 3";
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + lines + '"/><path d="' + arrow + '"/></svg>';
  }
  function richTools() {
    function t(cmd, inner, title) { return '<button type="button" class="rt__b" data-rt="' + cmd + '" title="' + title + '" tabindex="-1">' + inner + "</button>"; }
    return '<div class="rt__bar">' +
      t("undo", RT_UNDO, "Undo (Ctrl+Z)") + t("redo", RT_REDO, "Redo (Ctrl+Y)") +
      '<span class="rt__sep"></span>' +
      t("bold", "<b>B</b>", "Bold") + t("italic", "<i>I</i>", "Italic") + t("strikeThrough", "<s>S</s>", "Strikethrough") +
      '<span class="rt__sep"></span>' +
      t("insertUnorderedList", "\u2022", "Bulleted list") + t("insertOrderedList", "1.", "Numbered list") +
      t("outdent", rtIndentIco("out"), "Decrease indent") + t("indent", rtIndentIco("in"), "Increase indent") +
      '<span class="rt__sep"></span>' +
      t("justifyLeft", rtAlignIco("left"), "Align left") + t("justifyCenter", rtAlignIco("center"), "Align centre") + t("justifyRight", rtAlignIco("right"), "Align right") +
      '<span class="rt__sep"></span>' +
      t("clear", RT_CLEAR, "Clear formatting \u2014 reset to plain text") +
      t("image", RT_IMG, "Insert an image") +
      '<button type="button" class="rt__b rt__ai" data-rt="ai" title="Improve with AI \u2014 fix grammar, tighten, sharpen the value" tabindex="-1">\u2728 Improve</button>' +
      "</div>";
  }
  function escForRt(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function rtInlineMd(s) { return s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>").replace(/~~([^~]+)~~/g, "<s>$1</s>"); }
  function isRtHtml(v) { return /<(p|ul|ol|li|strong|em|b|i|s|strike|br|div|h[1-6]|span|figure|img|blockquote)\b/i.test(v || ""); }
  function richInit(v) {
    v = v == null ? "" : String(v);
    if (!v) return "";
    if (isRtHtml(v)) return v;
    return v.split(/\n\n+/).map(function (p) { return "<p>" + rtInlineMd(escForRt(p)).replace(/\n/g, "<br>") + "</p>"; }).join("");
  }
  function rtClean(html) {
    return String(html == null ? "" : html)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/ on\w+="[^"]*"/gi, "").replace(/ on\w+='[^']*'/gi, "")
      .replace(/javascript:/gi, "").replace(/&nbsp;/g, " ");
  }
  function richArea(attrs, value) {
    return '<div class="rt__area" contenteditable="true" spellcheck="true" data-ph="Write here\u2026 use the bar above to format" ' + attrs + ">" + richInit(value) + "</div>";
  }
  function richBlock(i, j, field, label, hint) {
    var b = data.work[i].study.blocks[j];
    return '<div class="af rt"><label class="af__label">' + label + "</label>" + richTools() +
      richArea('data-sblock="' + i + '" data-bindex="' + j + '" data-rtfield="' + field + '"', b[field]) +
      (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
  }
  function richItem(i, j, k, field, label) {
    var it = (data.work[i].study.blocks[j].items[k]) || {};
    return '<div class="af rt"><label class="af__label">' + label + "</label>" + richTools() +
      richArea('data-sblock="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-rtifield="' + field + '"', it[field]) + "</div>";
  }
  function richCell(i, j, k, c, field, label) {
    var it = (data.work[i].study.blocks[j].items[k]) || {};
    var cell = (it.cells && it.cells[c]) || {};
    return '<div class="af rt"><label class="af__label">' + label + "</label>" + richTools() +
      richArea('data-sblock="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-ccell="' + c + '" data-rtcellfield="' + field + '"', cell[field]) + "</div>";
  }
  function rtSerialize(area) {
    var html = rtClean(area.innerHTML).trim();
    if (/^(\s|<br\s*\/?>|<p>(\s|<br\s*\/?>)*<\/p>|<div>(\s|<br\s*\/?>)*<\/div>)*$/i.test(html)) html = "";
    var i = +area.dataset.sblock, j = +area.dataset.bindex;
    var b = data.work[i] && data.work[i].study && data.work[i].study.blocks[j];
    if (!b) return;
    if (area.dataset.rtfield !== undefined) b[area.dataset.rtfield] = html;
    else if (area.dataset.rtifield !== undefined) { var k = +area.dataset.iindex; if (b.items && b.items[k]) b.items[k][area.dataset.rtifield] = html; }
    else if (area.dataset.rtcellfield !== undefined) { var kc = +area.dataset.iindex, cc = +area.dataset.ccell; var itc = b.items && b.items[kc]; if (itc && itc.cells && itc.cells[cc]) itc.cells[cc][area.dataset.rtcellfield] = html; }
    saveDraft(); refreshL2Preview();
  }
  function rtAction(btn) {
    var wrap = btn.closest(".rt");
    var area = wrap && wrap.querySelector(".rt__area");
    if (!area) return;
    var cmd = btn.dataset.rt;
    area.focus();
    if (cmd === "ai") { rtImprove(area, btn); return; }
    if (cmd === "clear") { rtClearFormat(area); return; }
    if (cmd === "indent" || cmd === "outdent") {
      try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
      try { document.execCommand(cmd, false, null); } catch (e) {}
      try { document.execCommand("styleWithCSS", false, false); } catch (e) {}
      rtStripMediaIndent(area);
      rtSerialize(area); return;
    }
    if (cmd === "image") {
      // pickImage calls back TWICE (instant data-URI, then the hosted path) — insert once, then just swap the src so the image isn't added twice.
      var imgFig = null;
      pickImage(function (uri) {
        if (imgFig && area.contains(imgFig)) {
          var im = imgFig.querySelector("img"); if (im) im.setAttribute("src", uri);
        } else {
          area.insertAdjacentHTML("beforeend", '<figure class="rt__fig"><img src="' + escAttr(uri) + '" alt="" /></figure><p><br></p>');
          var figs = area.querySelectorAll("figure.rt__fig");
          imgFig = figs[figs.length - 1] || null;
        }
        rtSerialize(area);
      });
      return;
    }
    try { document.execCommand(cmd, false, null); } catch (e) {}
    rtSerialize(area);
  }
  // Indentation is for text only — lift any image/media back out of an indent wrapper.
  function rtStripMediaIndent(area) {
    area.querySelectorAll("img, svg, video, iframe").forEach(function (el) {
      var node = el.closest("figure") || el;
      if (node.style) { node.style.marginLeft = ""; node.style.paddingLeft = ""; }
      var bq, guard = 0;
      while ((bq = node.closest("blockquote")) && area.contains(bq) && bq !== node && guard++ < 12) {
        bq.parentNode.insertBefore(node, bq.nextSibling);
      }
    });
    area.querySelectorAll("blockquote").forEach(function (bq) {
      if (!bq.textContent.trim() && !bq.querySelector("img, svg, video, iframe")) bq.remove();
    });
  }
  // Replace the whole area in an UNDOABLE way so native Ctrl+Z and the Undo button restore the previous content.
  function rtSetHtml(area, html) {
    area.focus();
    try {
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(area);
      sel.removeAllRanges(); sel.addRange(range);
      if (!document.execCommand("insertHTML", false, html || "<p><br></p>")) area.innerHTML = html;
    } catch (e) { area.innerHTML = html; }
  }
  function rtClearFormat(area) {
    area.focus();
    // With a highlighted selection, clear formatting on THAT text only (bold/italic/colour/alignment/indent) — images untouched.
    var sel = window.getSelection();
    var hasSel = sel && sel.rangeCount && !sel.isCollapsed && area.contains(sel.anchorNode) && area.contains(sel.focusNode);
    if (hasSel) {
      try { document.execCommand("removeFormat", false, null); } catch (e) {}
      try { document.execCommand("justifyLeft", false, null); } catch (e) {}
      try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
      for (var g = 0; g < 12; g++) { try { document.execCommand("outdent", false, null); } catch (e) {} }
      try { document.execCommand("styleWithCSS", false, false); } catch (e) {}
      rtSerialize(area);
      status("Formatting cleared for the selected text.");
      return;
    }
    // Nothing selected: strip formatting from ALL text, but keep images exactly where they are.
    var parts = [], buf = [];
    function figHtml(img) { return '<figure class="rt__fig"><img src="' + escAttr(img.getAttribute("src") || img.src || "") + '" alt="' + escAttr(img.getAttribute("alt") || "") + '" /></figure>'; }
    function flush() {
      if (!buf.length) return;
      buf.join("\n").split(/\n{2,}/).forEach(function (para) {
        var lines = para.split(/\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l; });
        if (lines.length) parts.push("<p>" + lines.map(escForRt).join("<br>") + "</p>");
      });
      buf = [];
    }
    Array.prototype.forEach.call(area.childNodes, function (node) {
      if (node.nodeType === 3) { if (node.textContent.trim()) buf.push(node.textContent); return; }
      if (node.nodeType !== 1) return;
      var media = node.matches("img, video, iframe, svg") ? [node] : Array.prototype.slice.call(node.querySelectorAll("img, video, iframe, svg"));
      if (media.length) {
        var txt = (node.innerText || node.textContent || "").replace(/\u00a0/g, " ").trim();
        if (txt) buf.push(txt);
        flush();
        media.forEach(function (m) { parts.push(m.tagName === "IMG" ? figHtml(m) : '<figure class="rt__fig">' + m.outerHTML + "</figure>"); });
        return;
      }
      buf.push((node.innerText || node.textContent || "").replace(/\u00a0/g, " "));
      buf.push("");
    });
    flush();
    rtSetHtml(area, parts.join("") || "<p><br></p>");
    rtSerialize(area);
    status("Text formatting cleared \u2014 images kept.");
  }
  // Paste as plain text so copied source styling/colours never leak into the body.
  function onRtPaste(e) {
    var area = e.target && e.target.closest && e.target.closest(".rt__area");
    if (!area) return;
    var cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    e.preventDefault();
    var text = cd.getData("text/plain") || "";
    if (!document.execCommand("insertText", false, text)) {
      var sel = window.getSelection();
      if (sel && sel.rangeCount) { var r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(text)); r.collapse(false); }
    }
    rtSerialize(area);
  }
  async function rtImprove(area, btn) {
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { rtImprove(area, btn); }); return; }
    var text = (area.innerText || "").trim();
    if (!text) { status("Write something first, then Improve."); return; }
    var lbl = btn && btn.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = "\u2728 \u2026"; }
    status("Improving with AI\u2026");
    try {
      var out = await aiText(aiCfg("txt"),
        "You are a sharp product-design portfolio editor. Rewrite the case-study copy to fix grammar, tighten wording, and make it more confident and value/impact-oriented \u2014 keep the author's meaning and voice, and don't invent facts or numbers. Return ONLY the rewritten copy as clean minimal HTML using <p>, <strong>, <em> and <ul>/<li> where natural \u2014 no headings, no preamble, no markdown, no code fences.",
        text, { maxTokens: 900, temperature: 0.5 });
      var html = rtClean(String(out || "").replace(/```[a-z]*/gi, "").replace(/```/g, "").trim());
      if (html) { rtSetHtml(area, html); rtSerialize(area); status("Improved \u2014 not right? Press Ctrl+Z or the Undo button to revert.", true); }
      else status("The AI didn\u2019t return usable copy \u2014 try again.");
    } catch (e) { status("Improve failed: " + ((e && e.message) || "error")); }
    if (btn) { btn.disabled = false; btn.innerHTML = lbl || "\u2728 Improve"; }
  }

  /* ---------- structured item repeaters ---------- */
  var ITEM_SPEC = {
    metrics: { title: "Metrics", one: "Metric", add: "Add metric", fields: [["value", "Value (e.g. +45%)", "input"], ["label", "Label", "input"]] },
    steps: { title: "Steps", one: "Step", add: "Add step", fields: [["title", "Title", "input"], ["body", "Body", "rich"]] },
    faq: { title: "Questions", one: "Q", add: "Add question", fields: [["q", "Question", "input"], ["a", "Answer", "rich"]] },
    media: { title: "Media", one: "Item", add: "Add media", fields: [["src", "Image / video / Figma / PDF / deck URL", "media"], ["caption", "Caption", "input"]] },
    gallery: { title: "Slides", one: "Slide", add: "Add slide", fields: [["src", "Image / video / embed URL", "media"], ["caption", "Caption", "input"]] },
    cards: { title: "Cards", one: "Card", add: "Add card", fields: [["title", "Title", "input"], ["body", "Body", "rich"], ["icon", "Icon", "icon"], ["src", "Image (optional \u2014 replaces the icon)", "media"]] },
    columns: { title: "Columns", one: "Column", add: "Add column", fields: [["label", "Label (optional)", "input"], ["cells", "Cells", "cells"]] },
    rows: { title: "Rows", one: "Row", add: "Add row", fields: [["label", "Row label (optional)", "input"], ["cells", "Cells", "cells"]] },
    stickies: { title: "Notes", one: "Note", add: "Add note", fields: [["label", "Label (e.g. 01)", "input"], ["heading", "Heading", "input"], ["body", "Body", "rich"], ["src", "Image (optional)", "media"]] },
    voices: { title: "Voices", one: "Voice", add: "Add voice", fields: [["side", "Side (chat only)", "select", [["left", "Left"], ["right", "Right"]]], ["heading", "Heading (verbatim, optional)", "input"], ["body", "Text / quote", "rich"], ["cite", "Attribution / label", "input"]] }
  };
  var ICON_NAMES = ["users", "idea", "coins", "chart", "target", "lock", "spark", "clock", "shield", "check", "bolt", "layers"];
  function admIcon(n) { return (window.RK && window.RK.iconSvg) ? window.RK.iconSvg(n) : ""; }
  function admIconNames() { return (window.RK && window.RK.iconNames) ? window.RK.iconNames() : ICON_NAMES; }
  function blankItem(type) {
    switch (type) {
      case "metrics": return { value: "", label: "" };
      case "steps": return { title: "", body: "" };
      case "faq": return { q: "", a: "" };
      case "media": case "gallery": return { src: "", caption: "" };
      case "cards": return { title: "", body: "", icon: "", src: "" };
      case "columns": return { label: "", cells: [{ heading: "", body: "", src: "" }] };
      case "rows": return { label: "", cells: [{ heading: "", body: "", src: "" }] };
      case "stickies": return { label: "", heading: "", body: "", src: "" };
      case "voices": return { side: "left", heading: "", body: "", cite: "" };
      default: return {};
    }
  }
  function itemFieldEl(i, j, k, it, f) {
    var key = f[0], label = f[1], kind = f[2];
    var da = 'data-sitem="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-ifield="' + key + '"';
    if (kind === "rich") return richItem(i, j, k, key, label);
    if (kind === "icon") {
      var cur = it[key] || "";
      var cell = function (n, inner, title, extra) {
        return '<button type="button" class="iconpick__b' + (extra || "") + (cur === n ? " is-on" : "") + '" data-act="item-icon" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-ifield="' + key + '" data-icon="' + n + '" title="' + (title || n) + '">' + inner + "</button>";
      };
      var grid = cell("", "\u2205", "No icon", " iconpick__b--none") + admIconNames().map(function (n) { return cell(n, admIcon(n), n); }).join("");
      return '<div class="af"><label class="af__label">' + label + '</label>' +
        '<details class="icondd"><summary class="icondd__trigger"><span class="icondd__cur">' + (cur ? admIcon(cur) : "\u2205") + '</span><span class="icondd__name">' + (cur || "No icon") + '</span><span class="icondd__chev" aria-hidden="true">\u25be</span></summary>' +
        '<div class="icondd__panel"><div class="iconpick">' + grid + "</div></div></details></div>";
    }
    if (kind === "select") {
      var cur0 = it[key] || "";
      var opts = (f[3] || []).map(function (o) { return '<option value="' + escAttr(o[0]) + '"' + (cur0 === o[0] ? " selected" : "") + ">" + escHtml(o[1]) + "</option>"; }).join("");
      return '<div class="af"><label class="af__label">' + label + '</label><select ' + da + ">" + opts + "</select></div>";
    }
    if (kind === "cells") return cellsEditor(i, j, k, it);
    if (kind === "media") {
      var v = it[key] || "";
      return '<div class="af"><label class="af__label">' + label + '</label><input type="text" ' + da + ' value="' + escAttr(v) + '" placeholder="Paste a URL\u2026" />' +
        '<div class="imgblk__row"><button class="btn btn--ghost" data-act="item-upload" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-ifield="' + key + '">Upload\u2026</button>' +
        (v ? '<button class="btn btn--ghost" data-act="item-clear" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-ifield="' + key + '">Remove</button>' : "") + "</div></div>";
    }
    return '<div class="af"><label class="af__label">' + label + '</label><input type="text" ' + da + ' value="' + escAttr(it[key] || "") + '" /></div>';
  }
  var GRIP_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="3" r="1.4"/><circle cx="10.5" cy="3" r="1.4"/><circle cx="5.5" cy="8" r="1.4"/><circle cx="10.5" cy="8" r="1.4"/><circle cx="5.5" cy="13" r="1.4"/><circle cx="10.5" cy="13" r="1.4"/></svg>';
  function itemLabel(it) {
    var v = (it && (it.caption || it.value || it.q || it.title || it.label || it.heading || it.name || it.icon || it.src)) || "";
    v = String(v).replace(/^data:[^,]*,.*$/, "\u2014").replace(/[\*\[\]#`]/g, "").replace(/\s+/g, " ").trim();
    return v.length > 42 ? v.slice(0, 42) + "\u2026" : v;
  }
  function itemRepeater(i, j, b) {
    var spec = ITEM_SPEC[b.type]; if (!spec) return "";
    var items = b.items || (b.items = []);
    var rows = items.map(function (it, k) {
      var flds = spec.fields.map(function (f) { return itemFieldEl(i, j, k, it, f); }).join("");
      return '<div class="rep__item"><div class="rep__bar">' +
        '<span class="rep__grip sortgrip" data-grip data-sortkey="item:' + i + ':' + j + '" title="Drag to reorder" aria-label="Drag to reorder">' + GRIP_SVG + '</span>' +
        '<span class="rep__n">' + escHtml(spec.one) + " " + (k + 1) + '</span>' +
        '<span class="rep__itemlabel">' + escHtml(itemLabel(it)) + '</span>' +
        '<span class="rep__ops">' +
        '<button class="iconbtn" data-act="item-up" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '"' + (k === 0 ? " disabled" : "") + ' title="Move up">\u2191</button>' +
        '<button class="iconbtn" data-act="item-down" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '"' + (k === items.length - 1 ? " disabled" : "") + ' title="Move down">\u2193</button>' +
        '<button class="iconbtn iconbtn--danger" data-act="item-remove" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" title="Remove">\u2715</button>' +
        "</span></div>" + flds + "</div>";
    }).join("") || '<div class="rep__empty">No ' + escHtml(spec.title.toLowerCase()) + " yet.</div>";
    return '<div class="rep"><div class="rep__head"><label class="af__label">' + spec.title + '</label><button class="btn btn--add rep__add" data-act="item-add" data-index="' + i + '" data-bindex="' + j + '">+ ' + spec.add + "</button></div>" + rows + "</div>";
  }
  /* ---------- generic drag-to-reorder (grips; works alongside the up/down arrows) ----------
     A list is sortable when each row carries a [data-grip][data-sortkey] handle.
     Keys: "list:<name>" (L1 lists) · "block:<i>" (case-study sections) ·
     "item:<i>:<j>" (repeater items). Pointer-based, so it's reliable across
     browsers and auto-scrolls the editor when you drag near an edge. */
  var SORT_ROW_SEL = ".rep__item, .study__block, .card, .cellrow";
  function sortRowsFor(key) {
    return [].slice.call(root.querySelectorAll('[data-grip][data-sortkey="' + key + '"]'))
      .map(function (g) { return g.closest(SORT_ROW_SEL); }).filter(Boolean);
  }
  function sortStart(e) {
    var grip = e.target.closest && e.target.closest("[data-grip]");
    if (!grip) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var key = grip.getAttribute("data-sortkey"); if (!key) return;
    var row = grip.closest(SORT_ROW_SEL); if (!row) return;
    var rows = sortRowsFor(key); if (rows.length < 2) return;
    var from = rows.indexOf(row); if (from < 0) return;
    e.preventDefault();
    sortState = { key: key, rows: rows, row: row, from: from, to: from, y: e.clientY, scrollEl: root.querySelector(".adm__editor"), raf: 0 };
    row.classList.add("is-sortdrag");
    document.body.classList.add("adm-sorting");
    sortMark(e.clientY);
    document.addEventListener("pointermove", sortMove, true);
    document.addEventListener("pointerup", sortEnd, true);
    document.addEventListener("pointercancel", sortEnd, true);
    sortState.raf = requestAnimationFrame(sortLoop);
  }
  function sortMark(y) {
    var s = sortState; if (!s) return;
    var insert = 0, rows = s.rows;
    for (var k = 0; k < rows.length; k++) { var r = rows[k].getBoundingClientRect(); if (y > r.top + r.height / 2) insert = k + 1; }
    s.to = insert > s.from ? insert - 1 : insert;
    rows.forEach(function (r) { r.classList.remove("is-drop-above", "is-drop-below"); });
    if (insert >= rows.length) rows[rows.length - 1].classList.add("is-drop-below");
    else rows[insert].classList.add("is-drop-above");
  }
  function sortMove(e) { if (!sortState) return; sortState.y = e.clientY; sortMark(e.clientY); }
  function sortLoop() {
    var s = sortState; if (!s) return;
    var el = s.scrollEl;
    if (el) {
      var b = el.getBoundingClientRect(), y = s.y, edge = 54, sp = 0;
      if (y < b.top + edge) sp = -Math.ceil((b.top + edge - y) / 5);
      else if (y > b.bottom - edge) sp = Math.ceil((y - (b.bottom - edge)) / 5);
      if (sp) { var was = el.scrollTop; el.scrollTop += sp; if (el.scrollTop !== was) sortMark(s.y); }
    }
    s.raf = requestAnimationFrame(sortLoop);
  }
  function sortEnd() {
    var s = sortState; if (!s) return;
    sortState = null;
    document.removeEventListener("pointermove", sortMove, true);
    document.removeEventListener("pointerup", sortEnd, true);
    document.removeEventListener("pointercancel", sortEnd, true);
    if (s.raf) cancelAnimationFrame(s.raf);
    s.rows.forEach(function (r) { r.classList.remove("is-drop-above", "is-drop-below", "is-sortdrag"); });
    document.body.classList.remove("adm-sorting");
    if (s.to !== s.from) sortApply(s.key, s.from, s.to);
  }
  function sortApply(key, from, to) {
    var p = key.split(":"), arr = null, after = null;
    if (p[0] === "list") { arr = data[p[1]]; after = function () { apply(true); renderBody(); }; }
    else if (p[0] === "block") {
      var bi = +p[1], st = data.work[bi] && data.work[bi].study; if (!st || !st.blocks) return; arr = st.blocks;
      after = function () {
        if (openBlock === from) openBlock = to;
        else { var ob = openBlock; if (from < ob) ob--; if (to <= ob) ob++; openBlock = ob; }
        saveDraft(true); renderL2();
      };
    } else if (p[0] === "item") {
      var wi = +p[1], bj = +p[2], bl = data.work[wi] && data.work[wi].study && data.work[wi].study.blocks[bj];
      if (!bl) return; bl.items = bl.items || []; arr = bl.items; after = function () { saveDraft(true); renderL2(); };
    } else if (p[0] === "cell") {
      var cwi = +p[1], cbj = +p[2], cci = +p[3], cit = data.work[cwi] && data.work[cwi].study && data.work[cwi].study.blocks[cbj] && data.work[cwi].study.blocks[cbj].items[cci];
      if (!cit || !cit.cells) return; arr = cit.cells; after = function () { saveDraft(true); renderL2(); };
    }
    if (!arr || from < 0 || from >= arr.length) return;
    to = Math.max(0, Math.min(arr.length - 1, to));
    if (from === to) return;
    var moved = arr.splice(from, 1)[0];
    arr.splice(to, 0, moved);
    if (after) after();
  }
  function onItemInput(t) {
    var i = +t.dataset.sitem, j = +t.dataset.bindex, k = +t.dataset.iindex, f = t.dataset.ifield;
    var b = data.work[i] && data.work[i].study && data.work[i].study.blocks[j];
    if (!b || !b.items || !b.items[k]) return;
    b.items[k][f] = t.value;
    saveDraft(); refreshL2Preview();
  }
  function blankCell() { return { heading: "", body: "", src: "" }; }
  function onCellInput(t) {
    var i = +t.dataset.cell, j = +t.dataset.cbindex, k = +t.dataset.citem, c = +t.dataset.ccell, f = t.dataset.cfield;
    var it = data.work[i] && data.work[i].study && data.work[i].study.blocks[j] && data.work[i].study.blocks[j].items[k];
    if (!it || !it.cells || !it.cells[c]) return;
    it.cells[c][f] = t.value;
    saveDraft(); refreshL2Preview();
  }
  // A column can hold up to 5 stacked cells, each with a heading, rich body and image.
  function cellsEditor(i, j, k, it) {
    if (!Array.isArray(it.cells) || !it.cells.length) { it.cells = [{ heading: it.heading || "", body: it.body || "", src: it.src || "" }]; delete it.heading; delete it.body; delete it.src; }
    var rows = it.cells.map(function (cell, c) {
      var img = cell.src || "";
      return '<div class="cellrow"><div class="cellrow__bar">' +
        '<span class="sortgrip" data-grip data-sortkey="cell:' + i + ':' + j + ':' + k + '" title="Drag to reorder" aria-label="Drag to reorder">' + GRIP_SVG + '</span>' +
        '<span class="cellrow__n">Cell ' + (c + 1) + '</span><span class="rep__ops">' +
        '<button class="iconbtn" data-act="cell-up" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-cindex="' + c + '"' + (c === 0 ? " disabled" : "") + ' title="Move up">\u2191</button>' +
        '<button class="iconbtn" data-act="cell-down" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-cindex="' + c + '"' + (c === it.cells.length - 1 ? " disabled" : "") + ' title="Move down">\u2193</button>' +
        '<button class="iconbtn iconbtn--danger" data-act="cell-remove" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-cindex="' + c + '" title="Remove">\u2715</button>' +
        "</span></div>" +
        '<div class="af"><label class="af__label">Heading</label><input type="text" data-cell="' + i + '" data-cbindex="' + j + '" data-citem="' + k + '" data-ccell="' + c + '" data-cfield="heading" value="' + escAttr(cell.heading || "") + '" /></div>' +
        richCell(i, j, k, c, "body", "Body") +
        '<div class="af"><label class="af__label">Image (optional)</label><input type="text" data-cell="' + i + '" data-cbindex="' + j + '" data-citem="' + k + '" data-ccell="' + c + '" data-cfield="src" value="' + escAttr(img) + '" placeholder="Paste a URL\u2026" />' +
        '<div class="imgblk__row"><button class="btn btn--ghost" data-act="cell-upload" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-cindex="' + c + '">Upload\u2026</button>' +
        (img ? '<button class="btn btn--ghost" data-act="cell-clear" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-cindex="' + c + '">Remove</button>' : "") +
        "</div></div></div>";
    }).join("");
    var foot = it.cells.length < 5
      ? '<button class="btn btn--add rep__add" data-act="cell-add" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '">+ Add cell</button>'
      : '<span class="af__hint">Up to 5 cells per column.</span>';
    return '<div class="cells">' + rows + '<div class="cells__foot">' + foot + "</div></div>";
  }
  function mediaInputBlock(i, j, field, label, hint) {
    var b = data.work[i].study.blocks[j]; var v = b[field] || "";
    return '<div class="af"><label class="af__label">' + label + '</label><input type="text" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="' + field + '" value="' + escAttr(v) + '" placeholder="Paste a URL\u2026" />' +
      '<div class="imgblk__row"><button class="btn btn--ghost" data-act="bfield-upload" data-index="' + i + '" data-bindex="' + j + '" data-bfield="' + field + '">Upload\u2026</button>' +
      (v ? '<button class="btn btn--ghost" data-act="bfield-clear" data-index="' + i + '" data-bindex="' + j + '" data-bfield="' + field + '">Remove</button>' : "") + "</div>" +
      (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
  }

  function blockEditor(i, b, j, len, open) {
    var typeName = ({ text: "Text", statement: "Statement", metrics: "Metrics", steps: "Steps", media: "Media", split: "Before / after", faq: "FAQ", cards: "Cards", gallery: "Gallery", figure: "Figure", columns: "Columns", rows: "Rows", compare: "Before / after slider", stickies: "Sticky notes", voices: "Voices" })[b.type] || b.type;
    var raw = b.nav || b.kicker || b.heading || b.body || (b.items && b.items[0] && (b.items[0].q || b.items[0].title || b.items[0].value || b.items[0].caption || b.items[0].heading || b.items[0].label)) || "Untitled";
    var label = String(raw).replace(/[\*\[\]]/g, "").replace(/\s+/g, " ").trim();
    if (label.length > 48) label = label.slice(0, 48) + "\u2026";
    var head = '<div class="study__block-head" data-act="study-blocktoggle" data-index="' + i + '" data-bindex="' + j + '">' +
      '<span class="sortgrip study__block-grip" data-grip data-sortkey="block:' + i + '" title="Drag to reorder" aria-label="Drag to reorder">' + GRIP_SVG + '</span>' +
      '<span class="study__block-badge">' + escHtml(typeName) + "</span>" +
      '<span class="study__block-label">' + escHtml(label) + "</span>" +
      '<span class="study__block-ops">' +
      '<button class="iconbtn" data-act="study-blockup" data-index="' + i + '" data-bindex="' + j + '"' + (j === 0 ? " disabled" : "") + ' title="Move up">\u2191</button>' +
      '<button class="iconbtn" data-act="study-blockdown" data-index="' + i + '" data-bindex="' + j + '"' + (j === len - 1 ? " disabled" : "") + ' title="Move down">\u2193</button>' +
      '<button class="iconbtn iconbtn--danger" data-act="study-blockremove" data-index="' + i + '" data-bindex="' + j + '" title="Remove">\u2715</button>' +
      "</span>" +
      '<span class="study__block-chev" aria-hidden="true">\u203a</span>' +
      "</div>";
    var common = sfInput(i, j, "nav", "Section label", "Shows in the left nav \u2014 leave blank to hide it there") + sfInput(i, j, "kicker", "Kicker", "small label above the block");
    var body = "";
    if (b.type === "text") body = sfInput(i, j, "heading", "Heading") + richBlock(i, j, "body", "Body", "Format with the bar above \u2014 bold, lists, alignment, insert an image, or hit \u2728 Improve.");
    else if (b.type === "statement") body = richBlock(i, j, "body", "Statement", "The big pull-quote.") + sfInput(i, j, "sub", "Sub-line");
    else if (b.type === "metrics") body = sfInput(i, j, "heading", "Heading") + itemRepeater(i, j, b);
    else if (b.type === "steps") body = sfInput(i, j, "heading", "Heading") + itemRepeater(i, j, b);
    else if (b.type === "media") body = sfInput(i, j, "heading", "Heading") + itemRepeater(i, j, b) + '<div class="af__hint">Upload or paste a URL \u2014 image, GIF, video, Figma, PDF or PowerPoint (.pptx). A .pptx renders as a live slideshow (Fullscreen button + the viewer\u2019s slide arrows); PowerPoint animations don\u2019t play in the embed, so for animation-perfect playback export the deck to MP4 and drop that in. Leave the URL blank for a redacted placeholder.</div>';
    else if (b.type === "split") {
      if (Array.isArray(b.left)) b.left = arrToListHtml(b.left);
      if (Array.isArray(b.right)) b.right = arrToListHtml(b.right);
      body = sfInput(i, j, "heading", "Heading") + '<div class="af__row">' + sfInput(i, j, "leftLabel", "Left label") + sfInput(i, j, "rightLabel", "Right label") + "</div>" + '<div class="af__row">' + mediaInputBlock(i, j, "leftImg", "Left image (optional)") + mediaInputBlock(i, j, "rightImg", "Right image (optional)") + "</div>" + richBlock(i, j, "left", "Left content", "Bold, italic, bullets, alignment \u2014 use the bar above.") + richBlock(i, j, "right", "Right content");
    }
    else if (b.type === "faq") body = itemRepeater(i, j, b);
    else if (b.type === "cards") body = sfInput(i, j, "heading", "Heading") + itemRepeater(i, j, b);
    else if (b.type === "gallery") body = sfInput(i, j, "heading", "Heading") + itemRepeater(i, j, b) + '<div class="af__hint">Same URLs as Media \u2014 shown as a swipeable carousel with 1/N counters.</div>';
    else if (b.type === "figure") body = sfInput(i, j, "heading", "Heading") + richBlock(i, j, "body", "Body") + mediaInputBlock(i, j, "src", "Image / video / embed URL") + sfInput(i, j, "caption", "Caption") + '<label class="chk" style="margin-top:.2rem"><input type="checkbox" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="flip"' + (b.flip ? " checked" : "") + " /> Image on the left</label>";
    else if (b.type === "columns" || b.type === "rows") body = sfInput(i, j, "heading", "Heading") + itemRepeater(i, j, b);
    else if (b.type === "stickies") body = sfInput(i, j, "heading", "Heading") + itemRepeater(i, j, b) + '<div class="af__hint">Cards stagger up and down automatically and lift on hover. Give each a short label (e.g. 01), a heading, a line or two, and an optional image.</div>';
    else if (b.type === "voices") body = sfInput(i, j, "heading", "Heading") + sfSelect(i, j, "mode", "Style", [["verbatim", "Verbatim \u2014 sharp quote bubble"], ["thought", "Thought \u2014 soft bubble"], ["chat", "Chat \u2014 a two-way conversation"]], "Verbatim & thought stack as quote bubbles; chat lays them left/right like a conversation.") + sfSelect(i, j, "vsize", "Verbatim heading size", [["", "Standard"], ["lg", "Large"]]) + itemRepeater(i, j, b) + '<div class="af__hint">Side only applies to Chat. Heading only shows on Verbatim. Attribution is the small label under the bubble (e.g. \u201cWhat clients actually said\u201d).</div>';
    else if (b.type === "compare") body = sfInput(i, j, "heading", "Heading") + '<div class="af__row">' + mediaInputBlock(i, j, "beforeSrc", "Before image") + mediaInputBlock(i, j, "afterSrc", "After image") + "</div>" + '<div class="af__row">' + sfInput(i, j, "beforeLabel", "Before label") + sfInput(i, j, "afterLabel", "After label") + "</div>" + richBlock(i, j, "body", "Description below \u2014 what changed", "Both images should be the same size. Visitors drag the divider to compare.");
    var hasHeading = /^(text|metrics|steps|media|split|cards|gallery|figure|columns|rows|compare|stickies|voices)$/.test(b.type);
    var sizeCtl = (hasHeading || b.type === "statement") ? sfSelect(i, j, "hsize", (b.type === "statement" ? "Statement size" : "Heading size"), [["", "Standard"], ["sm", "Compact \u2014 easier to read"], ["lg", "Large \u2014 display"]], "Shrink it if the standard size feels too big for the copy.") : "";
    var sepCtl = '<label class="chk"><input type="checkbox" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="sep"' + (b.sep !== false ? " checked" : "") + " /> Separator line above \u2014 uncheck to flow into the previous section</label>";
    var locked = '<label class="chk"><input type="checkbox" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="locked"' + (b.locked ? " checked" : "") + " /> Locked \u2014 only after the deeper-cut pass</label>";
    return '<div class="card study__block' + (open ? " is-open" : "") + '">' + head +
      '<div class="study__block-body">' + common + body + sizeCtl + '<div class="block-flags">' + sepCtl + locked + "</div></div></div>";
  }
  function smeta(i, field, label, hint) {
    var st = data.work[i].study;
    return '<div class="af"><label class="af__label">' + label + '</label><input type="text" data-study="' + i + '" data-sfield="' + field + '" value="' + escAttr(st[field] || "") + '" />' + (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
  }
  function sectionPreview(type) {
    switch (type) {
      case "statement":
        return '<span class="secprev secprev--statement"><span class="sp__quote">\u201cOne line that lands the whole point.\u201d</span><span class="sp__sub">a short supporting sub-line</span></span>';
      case "metrics":
        return '<span class="secprev secprev--metrics"><span class="sp__metric"><b>3.2M</b><i>users</i></span><span class="sp__metric"><b>+18%</b><i>retention</i></span><span class="sp__metric"><b>4.8</b><i>rating</i></span></span>';
      case "steps":
        return '<span class="secprev secprev--steps"><span class="sp__step"><b>01</b><i>Discover</i></span><span class="sp__step"><b>02</b><i>Design</i></span><span class="sp__step"><b>03</b><i>Ship</i></span></span>';
      case "media":
        return '<span class="secprev secprev--media"><span class="sp__frame">\u25b6</span><span class="sp__cap">A caption for the visual</span></span>';
      case "split":
        return '<span class="secprev secprev--split"><span class="sp__col"><em>Before</em><i></i><i></i></span><span class="sp__col sp__col--after"><em>After</em><i></i><i></i></span></span>';
      case "faq":
        return '<span class="secprev secprev--faq"><span class="sp__qa"><b>Q</b> Why this approach?</span><span class="sp__qa"><b>A</b> Because it earns trust fast.</span><span class="sp__qa"><b>Q</b> What changed?</span></span>';
      case "cards":
        return '<span class="secprev secprev--cards"><span class="sp__card"><b>Discover</b><i>a short line</i></span><span class="sp__card"><b>Design</b><i>a short line</i></span><span class="sp__card"><b>Ship</b><i>a short line</i></span></span>';
      case "gallery":
        return '<span class="secprev secprev--gallery"><span class="sp__gframe">\u25a4<span class="sp__gn">1 / 3</span></span><span class="sp__gdots"><i class="on"></i><i></i><i></i></span></span>';
      case "figure":
        return '<span class="secprev secprev--figure"><span class="sp__ffr">\u25a4</span><span class="sp__ftx"><b>Heading</b><i></i><i></i><i></i></span></span>';
      case "columns":
        return '<span class="secprev secprev--columns"><span class="sp__coln"><b>OVERVIEW</b><i></i><i></i><i></i></span><span class="sp__coln"><b>WHAT I DID</b><i></i><i></i></span></span>';
      case "rows":
        return '<span class="secprev secprev--rows"><span class="sp__row"><b>PHASE 1</b><span class="sp__rowcells"><i></i><i></i></span></span><span class="sp__row"><b>PHASE 2</b><span class="sp__rowcells"><i></i><i></i></span></span><span class="sp__row"><b>PHASE 3</b><span class="sp__rowcells"><i></i><i></i></span></span></span>';
      case "compare":
        return '<span class="secprev secprev--compare"><span class="sp__cmp"><span class="sp__cmp-l"></span><span class="sp__cmp-grip">\u2039\u203a</span></span></span>';
      case "stickies":
        return '<span class="secprev secprev--stickies"><span class="sp__note"><b>01</b><i>Heading</i><u></u></span><span class="sp__note sp__note--low"><b>02</b><i>Heading</i><u></u></span><span class="sp__note"><b>03</b><i>Heading</i><u></u></span></span>';
      case "voices":
        return '<span class="secprev secprev--voices"><span class="sp__vc sp__vc--l">“I wasn’t sure…”</span><span class="sp__vc sp__vc--r">“Where can I see it?”</span><span class="sp__vc sp__vc--l">“Is my balance usable?”</span></span>';
      default:
        return '<span class="secprev secprev--text"><span class="sp__kick">Context</span><span class="sp__h">The problem</span><span class="sp__body">A short paragraph that sets up the situation and the stakes.</span><span class="sp__bul">Point one</span><span class="sp__bul">Point two</span></span>';
    }
  }
  function sectionPicker(i) {
    var modal = document.createElement("div");
    modal.className = "pass pass--wide secpick";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">Add a section</div>' +
      '<div class="pass__sub">Pick the layout that fits your content \u2014 this is how each one looks on your live page.</div>' +
      '<div class="secpick__grid">' +
      SECTION_GALLERY.map(function (s) {
        return '<button type="button" class="secpick__card" data-pick="' + s.type + '">' +
          '<span class="secpick__prev">' + sectionPreview(s.type) + "</span>" +
          '<span class="secpick__name">' + escHtml(s.name) + '<span class="secpick__tag">' + escHtml(s.tag) + "</span></span>" +
          '<span class="secpick__desc">' + escHtml(s.desc) + "</span>" +
          '<span class="secpick__best">' + escHtml(s.best) + "</span></button>";
      }).join("") +
      "</div>" +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button></div></div>';
    document.body.appendChild(modal);
    var onKey = function (e) { if (e.key === "Escape") close(); };
    var close = function () { modal.remove(); document.removeEventListener("keydown", onKey); };
    document.addEventListener("keydown", onKey);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    modal.querySelector("[data-cancel]").addEventListener("click", close);
    modal.querySelectorAll("[data-pick]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var type = btn.getAttribute("data-pick");
        var st = data.work[i].study || (data.work[i].study = blankStudy());
        st.blocks = st.blocks || [];
        st.blocks.push(blankBlock(type));
        openBlock = st.blocks.length - 1;
        close();
        saveDraft(true); renderL2();
        var meta = SECTION_GALLERY.filter(function (x) { return x.type === type; })[0] || { name: type };
        status("Added a \u201c" + meta.name + "\u201d section \u2014 fill it in below.", true);
      });
    });
  }
  function studyEditor(w, i) {
    var st = w.study;
    var blocks = st.blocks || (st.blocks = []);
    var unlockVal = studyUnlockPlain[w.id] || "";
    var header = '<section class="l2grp"><div class="l2grp__head">Project header <span>\u2014 the homepage card &amp; case-study hero</span></div>' +
      itemField("work", i, "title", "Title") +
      itemField("work", i, "desc", "Description", { type: "textarea", rows: 3, hint: "The card summary and the case-study intro fallback." }) +
      itemField("work", i, "tags", "Tags", { hint: "comma-separated" }) +
      imageryBlock(w, i) +
      "</section>";
    var meta = '<section class="l2grp"><div class="l2grp__head">Story header</div>' +
      smeta(i, "tagline", "Tagline", "one line under the title") +
      '<div class="af__row">' + smeta(i, "role", "Role") + smeta(i, "timeline", "Timeline") + "</div>" +
      '<div class="af__row">' + smeta(i, "team", "Team") + smeta(i, "scope", "Scope") + "</div>" +
      "</section>";
    var list = blocks.map(function (b, j) { return blockEditor(i, b, j, blocks.length, openBlock === j); }).join("") || '<div class="adm__empty">No sections yet \u2014 add the first one below.</div>';
    var add = '<div class="study__add"><button class="btn btn--add study__pickbtn" data-act="study-pick" data-index="' + i + '">+ Add a section\u2026</button></div>';
    var unlockBlock = '<section class="l2grp"><div class="l2grp__head">Deeper-cut pass <span>\u2014 optional gate for \u201cLocked\u201d sections</span></div>' +
      '<div class="af"><input type="text" data-study="' + i + '" data-sfield="unlock" value="' + escAttr(unlockVal) + '" placeholder="' + (st.unlockHash && !unlockVal ? "Set \u2014 type to change" : "e.g. edge-2026") + '" />' +
      '<div class="af__hint">' + (st.unlockHash ? "Pass set \u2713" : "Not set") + " \u00b7 unlocks the \u201cLocked\u201d blocks \u00b7 case-insensitive \u00b7 locked content still ships in your file (soft gate)</div></div></section>";
    return '<div class="study__panel">' +
      csgenPanel(w, i) +
      header + meta +
      '<section class="l2grp"><div class="l2grp__head">Sections <span>\u2014 click a section to expand &amp; edit it</span>' + (blocks.length ? '<button class="btn btn--auto l2grp__ai" data-act="fbrev-open" data-index="' + i + '" title="Paste or upload feedback \u2014 AI maps each point to the right section">\u2728 Review feedback</button>' : "") + "</div>" +
      '<div class="study__blocks">' + list + "</div>" + add + "</section>" +
      unlockBlock +
      '<div class="study__foot"><a class="btn btn--ghost" href="/?work=' + encodeURIComponent(w.id) + '&draft" target="_blank" rel="noopener" data-act="study-preview" data-index="' + i + '">Preview case study \u2197</a><button class="btn btn--primary" data-act="study-close" data-index="' + i + '">Done</button></div>' +
      "</div>";
  }
  function studyToggle(w, i) {
    var n = (w.study && w.study.blocks && w.study.blocks.length) || 0;
    if (openStudy === i) {
      return '<div class="study__toggle is-open"><button class="btn study__editbtn is-open" data-act="study-toggle" data-index="' + i + '">\u25be Close case-study editor</button></div>';
    }
    var count = n ? n + " section" + (n > 1 ? "s" : "") + " \u00b7 click to edit" : (w.study ? "empty \u2014 add sections" : "no page yet \u2014 click to build one");
    var preview = n ? '<a class="btn btn--ghost study__previewbtn" href="/?work=' + encodeURIComponent(w.id) + '&draft" target="_blank" rel="noopener" data-act="study-preview" data-index="' + i + '" title="Open this project page in a new tab">Preview \u2197</a>' : "";
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
        html += '<div class="card"><div class="card__bar" style="margin-bottom:.5rem"><span class="sortgrip" data-grip data-sortkey="list:capabilities" title="Drag to reorder" aria-label="Drag to reorder">' + GRIP_SVG + '</span><span class="card__idx">' + (i + 1) + "</span>" + ops("capabilities", i, list.length) + "</div>" +
          '<input type="text" data-list="capabilities" data-index="' + i + '" data-scalar="1" value="' + escAttr(c) + '" /></div>';
      });
      return html;
    },
    work() {
      const list = data.work || [];
      const featured = list.filter((w) => w.featured).length;
      let html = secHead("Selected Work", "Your projects. Tick up to 4 to feature on the homepage (currently " + featured + "/4). Title, story, images, tags &amp; theme all live inside each project\u2019s case-study editor.") + addBar("work", "Add work");
      list.forEach((w, i) => {
        html += '<div class="card workcard">' + cardHead(w.client || w.title || ("Work " + (i + 1)), "work", i, list.length) +
          '<label class="chk workcard__feat"><input type="checkbox" data-act="feature" data-index="' + i + '"' + (w.featured ? " checked" : "") + " /> Feature on homepage</label>" +
          '<div class="af__row">' + itemField("work", i, "client", "Client") + itemField("work", i, "period", "Period") + "</div>" +
          '<div class="workcard__name">' + escHtml(w.title || "Untitled project") + "</div>" +
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
    const pd = resolvePreviewData(data);
    try { w.RK.data = pd; } catch (e) {}
    if (!keep) { try { w.RK.render(pd); forceRevealDoc(w.document); } catch (e) {} }
    if (w.RK.openProject) { try { w.RK.openProject(id, { push: false, keepScroll: !!keep, silent: !!keep }); } catch (e) {} }
  }
  function previewLanding() {
    const w = frameWin();
    if (!(w && w.RK)) return;
    if (w.RK.closeProject) { try { w.RK.closeProject({ push: false }); } catch (e) {} }
    try { const pd = resolvePreviewData(data); w.RK.data = pd; w.RK.render(pd); forceRevealDoc(w.document); } catch (e) {}
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
    openBlock = -1;
    const w = data.work[i];
    if (l2title) l2title.textContent = w.client || w.title || "Case study";
    l2body.innerHTML = studyEditor(w, i);
    body.hidden = true;
    l2.hidden = false;
    if (root) root.classList.add("is-l2");
    requestAnimationFrame(function () { l2.classList.add("is-open"); });
    const ed = root.querySelector(".adm__editor"); if (ed) ed.scrollTop = 0;
    saveDraft();
    previewProject(w.id, false);
    l2PreviewApply();
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
    openBlock = -1;
    if (l2) { l2.hidden = true; l2.classList.remove("is-open"); }
    if (root) { root.classList.remove("is-l2"); root.classList.remove("is-preview"); root.classList.remove("is-noprev"); }
    if (body) body.hidden = false;
    const ed = root.querySelector(".adm__editor"); if (ed) ed.scrollTop = 0;
    const vt = root && root.querySelector("[data-view]"); if (vt) vt.textContent = "Preview";
    previewLanding();
    if (opts.render !== false) renderBody();
  }
  function l2PreviewApply() {
    var off = localStorage.getItem(L2PREV_KEY) === "0";
    if (root) root.classList.toggle("is-noprev", off && openStudy >= 0);
    var btn = root && root.querySelector("[data-l2-prev]");
    if (btn) {
      btn.classList.toggle("is-off", off);
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>' + (off ? '<line x1="3" y1="3" x2="21" y2="21"/>' : "") + "</svg>" + (off ? " Show preview" : " Hide preview");
    }
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
    if (t.dataset.rtfield !== undefined || t.dataset.rtifield !== undefined || t.dataset.rtcellfield !== undefined) { rtSerialize(t); return; }
    if (t.dataset.sitem !== undefined && t.dataset.ifield) { onItemInput(t); return; }
    if (t.dataset.cell !== undefined && t.dataset.cfield) { onCellInput(t); return; }
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
    if (t.dataset.sitem !== undefined && t.dataset.ifield) { onItemInput(t); return; }
    if (t.dataset.sblock !== undefined && t.type === "checkbox") {
      const wi = +t.dataset.sblock, bj = +t.dataset.bindex;
      if (data.work[wi] && data.work[wi].study && data.work[wi].study.blocks[bj]) {
        data.work[wi].study.blocks[bj][t.dataset.bfield] = t.checked;
        saveDraft(true); refreshL2Preview();
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
      try { w.RK.render(resolvePreviewData(w.RK.deriveSpecialData(data, sv))); forceRevealDoc(w.document); } catch (e) {}
      status("Previewing \u201c" + (sv.name || "view") + "\u201d \u2014 edit anything to return to the full site.");
    }
  }

  function onClick(e) {
    const rtb = e.target.closest("[data-rt]");
    if (rtb) { rtAction(rtb); return; }
    if (e.target.closest("[data-grip]")) return; // grip is a drag handle, not a click target
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
    if (act === "plate-sample") { data.work[i].theme = b.dataset.theme; data.work[i].image = ""; apply(true); if (openStudy >= 0) renderL2(); else renderBody(); status("Motion placeholder applied.", true); return; }
    if (act === "img-clear") { data.work[i].image = ""; apply(true); if (openStudy >= 0) renderL2(); else renderBody(); status("Image removed."); return; }
    if (act === "img-upload") { pickImage(function (uri) { data.work[i].image = uri; apply(true); if (openStudy >= 0) renderL2(); else renderBody(); }); return; }
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
    if (act === "fbrev-open") { fbReviewModal(i); return; }
    if (act === "csgen-ref-toggle") { const wrap = b.closest(".csgen__ref"); if (wrap) { const open = wrap.classList.toggle("is-open"); b.textContent = (open ? "\u2212" : "+") + " Paste a reference case study to echo (optional)"; const cw = data.work[i]; if (cw) csgenState(cw.id).refShow = open; } return; }
    if (act === "study-toggle") { openL2(i); return; }
    if (act === "study-close") { closeL2(); return; }
    if (act === "study-pick") { sectionPicker(i); return; }
    if (act === "study-blocktoggle") {
      const j = +b.dataset.bindex;
      openBlock = (openBlock === j) ? -1 : j;
      const wrap = b.closest(".study__blocks");
      if (wrap) wrap.querySelectorAll(".study__block").forEach(function (x, k) { x.classList.toggle("is-open", k === openBlock); });
      return;
    }
    if (act === "study-addblock") {
      const st = data.work[i].study || (data.work[i].study = blankStudy());
      st.blocks = st.blocks || [];
      st.blocks.push(blankBlock(b.dataset.type));
      openBlock = st.blocks.length - 1;
      saveDraft(true); renderL2(); return;
    }
    if (act === "study-blockup") { const s = data.work[i].study.blocks, j = +b.dataset.bindex; if (j > 0) { [s[j - 1], s[j]] = [s[j], s[j - 1]]; if (openBlock === j) openBlock = j - 1; else if (openBlock === j - 1) openBlock = j; saveDraft(true); renderL2(); } return; }
    if (act === "study-blockdown") { const s = data.work[i].study.blocks, j = +b.dataset.bindex; if (j < s.length - 1) { [s[j + 1], s[j]] = [s[j], s[j + 1]]; if (openBlock === j) openBlock = j + 1; else if (openBlock === j + 1) openBlock = j; saveDraft(true); renderL2(); } return; }
    if (act === "study-blockremove") { const j = +b.dataset.bindex; data.work[i].study.blocks.splice(j, 1); if (openBlock === j) openBlock = -1; else if (openBlock > j) openBlock--; saveDraft(true); renderL2(); return; }
    if (act === "item-add") { const bl = data.work[i].study.blocks[+b.dataset.bindex]; bl.items = bl.items || []; bl.items.push(blankItem(bl.type)); saveDraft(true); renderL2(); return; }
    if (act === "item-remove") { const bl = data.work[i].study.blocks[+b.dataset.bindex]; bl.items.splice(+b.dataset.iindex, 1); saveDraft(true); renderL2(); return; }
    if (act === "item-up") { const bl = data.work[i].study.blocks[+b.dataset.bindex], k = +b.dataset.iindex; if (k > 0) { [bl.items[k - 1], bl.items[k]] = [bl.items[k], bl.items[k - 1]]; saveDraft(true); renderL2(); } return; }
    if (act === "item-down") { const bl = data.work[i].study.blocks[+b.dataset.bindex], k = +b.dataset.iindex; if (k < bl.items.length - 1) { [bl.items[k + 1], bl.items[k]] = [bl.items[k], bl.items[k + 1]]; saveDraft(true); renderL2(); } return; }
    if (act === "item-upload") { const bj = +b.dataset.bindex, k = +b.dataset.iindex, f = b.dataset.ifield; pickMedia(function (uri) { const bl = data.work[i].study.blocks[bj]; if (bl && bl.items && bl.items[k]) { bl.items[k][f] = uri; if (isVideoVal(uri)) bl.items[k].controls = true; saveDraft(true); renderL2(); } }); return; }
    if (act === "item-icon") { const bj = +b.dataset.bindex, k = +b.dataset.iindex, f = b.dataset.ifield, name = b.dataset.icon; const bl = data.work[i].study.blocks[bj]; if (bl && bl.items && bl.items[k]) { bl.items[k][f] = name; saveDraft(true); refreshL2Preview(); const grid = b.closest(".iconpick"); if (grid) grid.querySelectorAll(".iconpick__b").forEach(function (x) { x.classList.toggle("is-on", x === b); }); const dd = b.closest(".icondd"); if (dd) { const cur = dd.querySelector(".icondd__cur"); if (cur) cur.innerHTML = name ? admIcon(name) : "\u2205"; const nm = dd.querySelector(".icondd__name"); if (nm) nm.textContent = name || "No icon"; if (dd.tagName === "DETAILS") dd.open = false; } } return; }
    if (act === "item-clear") { const bl = data.work[i].study.blocks[+b.dataset.bindex], k = +b.dataset.iindex; if (bl && bl.items && bl.items[k]) { bl.items[k][b.dataset.ifield] = ""; saveDraft(true); renderL2(); } return; }
    if (act === "cell-add") { const it = data.work[i].study.blocks[+b.dataset.bindex].items[+b.dataset.iindex]; it.cells = it.cells || []; if (it.cells.length < 5) { it.cells.push(blankCell()); saveDraft(true); renderL2(); } return; }
    if (act === "cell-remove") { const it = data.work[i].study.blocks[+b.dataset.bindex].items[+b.dataset.iindex]; if (it.cells) { it.cells.splice(+b.dataset.cindex, 1); if (!it.cells.length) it.cells.push(blankCell()); saveDraft(true); renderL2(); } return; }
    if (act === "cell-up") { const it = data.work[i].study.blocks[+b.dataset.bindex].items[+b.dataset.iindex], c = +b.dataset.cindex; if (it.cells && c > 0) { const tmp = it.cells[c - 1]; it.cells[c - 1] = it.cells[c]; it.cells[c] = tmp; saveDraft(true); renderL2(); } return; }
    if (act === "cell-down") { const it = data.work[i].study.blocks[+b.dataset.bindex].items[+b.dataset.iindex], c = +b.dataset.cindex; if (it.cells && c < it.cells.length - 1) { const tmp = it.cells[c + 1]; it.cells[c + 1] = it.cells[c]; it.cells[c] = tmp; saveDraft(true); renderL2(); } return; }
    if (act === "cell-upload") { const bj = +b.dataset.bindex, k = +b.dataset.iindex, c = +b.dataset.cindex; pickMedia(function (uri) { const it = data.work[i].study.blocks[bj].items[k]; if (it && it.cells && it.cells[c]) { it.cells[c].src = uri; saveDraft(true); renderL2(); } }); return; }
    if (act === "cell-clear") { const it = data.work[i].study.blocks[+b.dataset.bindex].items[+b.dataset.iindex], c = +b.dataset.cindex; if (it.cells && it.cells[c]) { it.cells[c].src = ""; saveDraft(true); renderL2(); } return; }
    if (act === "bfield-upload") { const bj = +b.dataset.bindex, f = b.dataset.bfield; pickMedia(function (uri) { const bl = data.work[i].study.blocks[bj]; if (bl) { bl[f] = uri; if (isVideoVal(uri)) bl.controls = true; saveDraft(true); renderL2(); } }); return; }
    if (act === "bfield-clear") { const bl = data.work[i].study.blocks[+b.dataset.bindex]; if (bl) { bl[b.dataset.bfield] = ""; saveDraft(true); renderL2(); } return; }
    if (act === "study-preview") { saveDraft(true); status("Opening your current draft in a new tab\u2026"); return; }
    if (act === "add") { data[list].unshift(blank(list)); apply(true); renderBody(); const ed = root.querySelector(".adm__editor"); if (ed) ed.scrollTop = 0; status("Added at the top \u2014 edit it right here.", true); }
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

  /* ---------- image hosting: upload files to the repo, store lean paths ----------
     Uploaded images are written to the repo as real, content-addressed files
     (assets/uploads/<sha256>.<ext>) and referenced by a short path — so content.json
     stays tiny, the file is served at full, original quality, and the editor preview
     loads the very same file a visitor sees. No compression, ever. */
  function parseDataUri(uri) {
    const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(uri || "");
    if (!m) return null;
    return { mime: m[1] || "application/octet-stream", base64: !!m[2], data: m[3] };
  }
  function b64ToBytes(s) {
    const bin = atob(s); const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  async function sha256Hex(bytes) {
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  function extForMime(mime) {
    return ({
      "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/avif": "avif", "image/bmp": "bmp",
      "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
      "application/pdf": "pdf",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
      "application/vnd.ms-powerpoint": "ppt",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.ms-excel": "xls"
    })[String(mime).toLowerCase()] || (/^image\//i.test(mime) ? "png" : "bin");
  }
  function isHostedPath(v) { return typeof v === "string" && v.indexOf("/" + UPLOAD_DIR) === 0; }
  function rawUrlFor(path) { return GH_RAW + String(path).replace(/^\//, ""); }
  // In the admin preview a hosted path can't load from localhost until it's pulled —
  // so show the in-memory bytes (instant) or the raw GitHub URL (works right after hosting).
  function previewSrc(v) {
    if (!isHostedPath(v)) return v;
    // Images & videos can preview from the in-memory bytes; documents go through an external
    // viewer (Office/Google) that must fetch a PUBLIC URL, so hand those the raw GitHub URL.
    if (/\.(png|jpe?g|webp|gif|avif|bmp|svg|mp4|webm|mov|m4v|ogv)$/i.test(v)) return hostedBytes[v] || rawUrlFor(v);
    return rawUrlFor(v);
  }
  function resolvePreviewData(d) {
    const c = clone(d);
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      for (const k in o) {
        const v = o[k];
        if (typeof v === "string") { if (isHostedPath(v)) o[k] = previewSrc(v); }
        else if (v && typeof v === "object") walk(v);
      }
    })(c);
    return c;
  }
  function imgDims(uri) {
    return new Promise(function (resolve) {
      try {
        const im = new Image();
        im.onload = function () { resolve({ w: im.naturalWidth, h: im.naturalHeight }); };
        im.onerror = function () { resolve(null); };
        im.src = uri;
      } catch (e) { resolve(null); }
    });
  }
  // Write one data-URI image to the repo; returns its root-relative path. Identical
  // files collapse to the same path (content hash), so re-uploads never duplicate.
  async function hostDataUri(uri, token, extHint) {
    const parts = parseDataUri(uri);
    if (!parts) throw new Error("not a file");
    const rawB64 = parts.base64 ? parts.data : b64(decodeURIComponent(parts.data));
    const hash = await sha256Hex(b64ToBytes(rawB64));
    const name = hash + "." + String(extHint || extForMime(parts.mime)).toLowerCase();
    const repoPath = UPLOAD_DIR + name;
    const webPath = "/" + repoPath;
    hostedBytes[webPath] = uri;
    const put = await fetch(GH_FILE_API + repoPath, { method: "PUT", headers: ghHeaders(token), body: JSON.stringify({ message: "Add " + name + " via admin", content: rawB64, branch: GH_BRANCH }) });
    if (put.status === 422) return webPath; // identical file already hosted → reuse
    if (put.status === 401 || put.status === 403) { const e = new Error("auth"); e.auth = 1; throw e; }
    if (!put.ok) { const j = await put.json().catch(function () { return {}; }); throw new Error((j && j.message) || ("HTTP " + put.status)); }
    return webPath;
  }
  /* ---------- publish progress bar + live-site confirmation ---------- */
  let pubCreep = null;
  function pubEl() { return root && root.querySelector(".adm__pub"); }
  function pubProgress(pct, label, opts) {
    opts = opts || {};
    const el = pubEl();
    status(label, !!opts.done);
    if (!el) return;
    el.hidden = false;
    el.classList.toggle("is-done", !!opts.done);
    el.classList.toggle("is-error", !!opts.error);
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    const fill = el.querySelector(".adm__pub-fill");
    const labEl = el.querySelector(".adm__pub-label");
    const pctEl = el.querySelector(".adm__pub-pct");
    const view = el.querySelector(".adm__pub-view");
    const close = el.querySelector(".adm__pub-close");
    const hint = el.querySelector(".adm__pub-hint");
    if (fill) fill.style.width = p + "%";
    if (pctEl) pctEl.textContent = p + "%";
    if (labEl) labEl.textContent = label;
    if (view) { if (opts.viewUrl) { view.href = opts.viewUrl; view.hidden = false; } else view.hidden = true; }
    if (close) close.hidden = !(opts.done || opts.error);
    if (hint) hint.hidden = !!(opts.done || opts.error);
  }
  function pubStopCreep() { if (pubCreep) { clearInterval(pubCreep); pubCreep = null; } }
  function pubHide() { pubStopCreep(); const el = pubEl(); if (el) el.hidden = true; }
  // Ease the bar toward a target over N seconds while we wait on GitHub Pages.
  function pubCreepTo(target, seconds) {
    pubStopCreep();
    const el = pubEl(); if (!el) return;
    const fill = el.querySelector(".adm__pub-fill"), pctEl = el.querySelector(".adm__pub-pct");
    const from = parseFloat(fill && fill.style.width) || 0, span = Math.max(0, target - from), start = Date.now(), ms = seconds * 1000;
    pubCreep = setInterval(function () {
      const t = Math.min(1, (Date.now() - start) / ms);
      const val = from + span * (1 - Math.pow(1 - t, 2)); // ease-out
      if (fill) fill.style.width = val.toFixed(1) + "%";
      if (pctEl) pctEl.textContent = Math.round(val) + "%";
      if (t >= 1) pubStopCreep();
    }, 200);
  }
  // Poll the live site until it serves exactly what we just published (true = confirmed live).
  async function waitForLive(mySig) {
    if (!mySig) return false;
    const deadline = Date.now() + 120000; // give GitHub Pages up to 2 minutes
    pubCreepTo(94, 75);
    while (Date.now() < deadline) {
      await new Promise(function (r) { setTimeout(r, 4000); });
      const urls = [LIVE_ORIGIN + "/content.json?t=" + Date.now(), GH_RAW + "content.json?t=" + Date.now()];
      for (const u of urls) {
        try {
          const res = await fetch(u, { cache: "no-store" });
          if (!res.ok) continue;
          const txt = await res.text();
          let live = null;
          try { live = (window.RK && window.RK.sig) ? window.RK.sig(JSON.stringify(JSON.parse(txt))) : null; } catch (e) { live = null; }
          if (live && live === mySig) return true;
        } catch (e) { /* CORS/network hiccup — keep polling */ }
      }
    }
    return false;
  }

  // Replace every still-embedded data:image in `data` with a hosted path (used at publish).
  async function hostEmbeddedImages(token, onProg) {
    const targets = [];
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      for (const k in o) {
        const v = o[k];
        if (typeof v === "string") { if (/^data:(image|video|application)\//i.test(v)) targets.push([o, k]); }
        else if (v && typeof v === "object") walk(v);
      }
    })(data);
    const total = targets.length;
    let done = 0;
    if (onProg && total) onProg(0, total);
    for (const t of targets) {
      try { t[0][t[1]] = await hostDataUri(t[0][t[1]], token); }
      catch (e) { if (e && e.auth) throw e; /* otherwise leave embedded, it still publishes */ }
      done++;
      if (onProg && total) onProg(done, total);
    }
    return done;
  }

  async function ghPublish(token) {
    pubProgress(6, "Preparing your content\u2026");
    try {
      await hostEmbeddedImages(token, function (n, total) {
        pubProgress(6 + Math.round((n / Math.max(1, total)) * 40), "Uploading images at full quality \u2014 " + n + " of " + total + "\u2026");
      });
      pubProgress(50, "Saving your content to GitHub\u2026");
      const json = beforePublish();
      const mySig = (window.RK && window.RK.sig) ? window.RK.sig(JSON.stringify(JSON.parse(json))) : null;
      let sha;
      const getRes = await fetch(GH_API + "?ref=" + GH_BRANCH + "&t=" + Date.now(), { headers: ghHeaders(token) });
      if (getRes.status === 401 || getRes.status === 403) { authFailed(); pubProgress(100, "GitHub didn\u2019t accept that sign-in \u2014 hit Publish to reconnect.", { error: true }); return; }
      if (getRes.ok) { const j = await getRes.json(); sha = j.sha; }
      else if (getRes.status !== 404) throw new Error("read HTTP " + getRes.status);
      const body = { message: "Update content.json via admin", content: b64(json), branch: GH_BRANCH };
      if (sha) body.sha = sha;
      const putRes = await fetch(GH_API, { method: "PUT", headers: ghHeaders(token), body: JSON.stringify(body) });
      const pj = await putRes.json().catch(() => ({}));
      if (putRes.status === 401 || putRes.status === 403) { authFailed(); pubProgress(100, "GitHub didn\u2019t accept that sign-in \u2014 hit Publish to reconnect.", { error: true }); return; }
      if (!putRes.ok) throw new Error((pj && pj.message) || ("HTTP " + putRes.status));
      // Committed. This data is now the published content — clear the draft so it can't go stale.
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(DRAFT_SIG_KEY);
      if (window.RK) { window.RK.published = clone(data); if (window.RK.sig) window.RK.publishedSig = window.RK.sig(JSON.stringify(data)); }
      pubProgress(64, "Saved to GitHub. Building your live site\u2026");
      const live = await waitForLive(mySig);
      pubStopCreep();
      const viewUrl = LIVE_ORIGIN + "/?t=" + Date.now();
      if (live) pubProgress(100, "Your site is live and ready to view.", { done: true, viewUrl: viewUrl });
      else pubProgress(100, "Published. It can take another minute to appear \u2014 open your site to check.", { done: true, viewUrl: viewUrl });
    } catch (e) {
      pubStopCreep();
      if (e && e.auth) { authFailed(); pubProgress(100, "GitHub didn\u2019t accept that sign-in \u2014 hit Publish to reconnect.", { error: true }); return; }
      // Transient/network hiccup — keep the connection, just ask them to retry.
      pubProgress(100, "Couldn\u2019t reach GitHub just now. Hit Publish again to retry.", { error: true });
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
    inp.onchange = function () {
      const f = inp.files && inp.files[0]; if (!f) return;
      // Read the ORIGINAL bytes untouched — no downscaling, no re-encoding, no format change.
      fileToDataUri(f).then(function (uri) {
        cb(uri);                  // instant, full-quality preview + safe fallback value
        hostUploaded(uri, f, cb); // then host it as a real file and swap in the lean path
      });
    };
    inp.click();
  }
  function extFromName(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ""); return m ? m[1].toLowerCase() : ""; }
  function isVideoVal(v) { return /^data:video\//i.test(v) || /\.(mp4|webm|mov|m4v|ogv)($|\?|#)/i.test(v); }
  var MEDIA_ACCEPT = "image/*,video/*,.pptx,.ppt,.pdf,.key,.mp4,.webm,.mov,.gif,.docx,.xlsx";

  /* ---------- video colour tagging ----------
     Untagged H.264/SDR MP4s (common from screen recorders & editors) carry no
     colour-space metadata, so wide-gamut / OLED displays render them
     oversaturated. We insert the standard 19-byte BT.709 "colr" (nclx) box into
     the video sample entry — a lossless, metadata-only edit — and fix up the
     container box sizes + chunk-offset tables. On ANY structural uncertainty we
     return null and the original file is used untouched. */
  var VISUAL_SE = { avc1: 1, avc3: 1, hvc1: 1, hev1: 1, mp4v: 1, av01: 1, vp09: 1 };
  function videoTagEnabled() { return localStorage.getItem("rk:vid:bt709") !== "0"; }
  function mp4TagBt709(buf) {
    try {
      var dv = new DataView(buf), N = buf.byteLength;
      if (N < 16) return null;
      var u32 = function (o) { return dv.getUint32(o); };
      var typeAt = function (o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); };
      var find = function (list, t) { for (var i = 0; i < list.length; i++) if (list[i].type === t) return list[i]; return null; };
      // Parse the child boxes of [start,end). Returns a list, or null on malformed data.
      function boxes(start, end) {
        var out = [], o = start;
        while (o + 8 <= end) {
          var size = u32(o), hdr = 8, big = false;
          if (size === 1) {
            if (o + 16 > end) return null;
            var hi = u32(o + 8), lo = u32(o + 12);
            if (hi !== 0) return null;                 // > 4 GB — out of scope
            size = hi * 4294967296 + lo; hdr = 16; big = true;
          } else if (size === 0) { size = end - o; }    // extends to container end
          if (size < hdr || o + size > end) return null;
          out.push({ type: typeAt(o + 4), start: o, size: size, hdr: hdr, big: big, pstart: o + hdr, pend: o + size });
          o += size;
        }
        return out;
      }
      // Bail if an iloc box exists anywhere reachable — it carries its own absolute offsets.
      function scanIloc(list) {
        for (var i = 0; i < list.length; i++) {
          var b = list[i];
          if (b.type === "iloc") return true;
          if (b.type === "meta") { var k = boxes(b.pstart + 4, b.pend); if (!k || scanIloc(k)) return true; }
          else if (b.type === "moov" || b.type === "udta" || b.type === "trak") { var k2 = boxes(b.pstart, b.pend); if (k2 && scanIloc(k2)) return true; }
        }
        return false;
      }

      var top = boxes(0, N);
      if (!top) return null;
      for (var i = 0; i < top.length; i++) {
        var tt = top[i].type;
        if (tt === "moof" || tt === "sidx" || tt === "styp" || tt === "mfra") return null; // fragmented/streaming
      }
      if (scanIloc(top)) return null;
      var moov = find(top, "moov");
      if (!moov || find(top.filter(function (b) { return b.type === "moov"; }).slice(1), "moov")) return null;

      var chunkTables = [];   // {big, pstart, count}
      var videoEntries = [];  // untagged visual sample entries + their ancestor path
      var moovKids = boxes(moov.pstart, moov.pend);
      if (!moovKids) return null;
      for (var mi = 0; mi < moovKids.length; mi++) {
        var mk = moovKids[mi];
        if (mk.type !== "trak") continue;
        var trakKids = boxes(mk.pstart, mk.pend); if (!trakKids) return null;
        var mdia = find(trakKids, "mdia"); if (!mdia) continue;
        var mdiaKids = boxes(mdia.pstart, mdia.pend); if (!mdiaKids) return null;
        var hdlr = find(mdiaKids, "hdlr");
        var isVideo = hdlr ? typeAt(hdlr.pstart + 8) === "vide" : false;
        var minf = find(mdiaKids, "minf"); if (!minf) continue;
        var minfKids = boxes(minf.pstart, minf.pend); if (!minfKids) return null;
        var stbl = find(minfKids, "stbl"); if (!stbl) continue;
        var stblKids = boxes(stbl.pstart, stbl.pend); if (!stblKids) return null;
        if (find(stblKids, "saio")) return null;        // aux-info offsets (encryption) — out of scope

        var stco = find(stblKids, "stco"), co64 = find(stblKids, "co64");
        if (stco) { var c = u32(stco.pstart + 4); if (stco.pstart + 8 + c * 4 > stco.pend) return null; chunkTables.push({ big: false, pstart: stco.pstart + 8, count: c }); }
        if (co64) { var c2 = u32(co64.pstart + 4); if (co64.pstart + 8 + c2 * 8 > co64.pend) return null; chunkTables.push({ big: true, pstart: co64.pstart + 8, count: c2 }); }

        if (!isVideo) continue;
        var stsd = find(stblKids, "stsd"); if (!stsd) continue;
        var entries = boxes(stsd.pstart + 8, stsd.pend); if (!entries) return null; // after version/flags + entry_count
        for (var ei = 0; ei < entries.length; ei++) {
          var se = entries[ei];
          if (VISUAL_SE[se.type] !== 1) return null;     // unfamiliar entry — don't guess
          var kids = boxes(se.start + 8 + 78, se.pend); if (!kids) return null; // child boxes follow the 78-byte visual header
          if (find(kids, "colr")) return null;           // already colour-tagged — leave it
          videoEntries.push({ se: se, path: [mk, mdia, minf, stbl, stsd] });
        }
      }
      if (videoEntries.length !== 1) return null;         // 0 or many — avoid partial tagging
      var target = videoEntries[0];

      // Boxes whose size must grow by 19: moov + the path down to (and incl.) the sample entry.
      var grow = [], seen = {}, chain = [moov].concat(target.path).concat([target.se]);
      for (var gi = 0; gi < chain.length; gi++) { var gb = chain[gi]; if (!seen[gb.start]) { seen[gb.start] = 1; grow.push(gb); } }

      var insPos = target.se.pend; // append colr as the last child of the sample entry
      var COLR = new Uint8Array([0, 0, 0, 0x13, 0x63, 0x6f, 0x6c, 0x72, 0x6e, 0x63, 0x6c, 0x78, 0, 1, 0, 1, 0, 1, 0]);

      var srcU8 = new Uint8Array(buf);
      var out = new Uint8Array(N + 19);
      out.set(srcU8.subarray(0, insPos), 0);
      out.set(COLR, insPos);
      out.set(srcU8.subarray(insPos), insPos + 19);
      var odv = new DataView(out.buffer);

      for (var wi = 0; wi < grow.length; wi++) {
        var g = grow[wi];
        if (g.big) { odv.setUint32(g.start + 8, 0); odv.setUint32(g.start + 12, g.size + 19); }
        else { if (g.size + 19 > 0xffffffff) return null; odv.setUint32(g.start, g.size + 19); }
      }
      // Any chunk offset that points at/after the insertion shifts by +19. Table bytes
      // living after the insertion are themselves relocated by +19 in the new buffer.
      for (var ci = 0; ci < chunkTables.length; ci++) {
        var tb = chunkTables[ci], base = tb.pstart >= insPos ? tb.pstart + 19 : tb.pstart;
        for (var ri = 0; ri < tb.count; ri++) {
          if (tb.big) {
            var p = base + ri * 8, val = odv.getUint32(p) * 4294967296 + odv.getUint32(p + 4);
            if (val >= insPos) { val += 19; odv.setUint32(p, Math.floor(val / 4294967296)); odv.setUint32(p + 4, val >>> 0); }
          } else {
            var p2 = base + ri * 4, v = odv.getUint32(p2);
            if (v >= insPos) odv.setUint32(p2, v + 19);
          }
        }
      }
      return out;
    } catch (e) { return null; }
  }
  // Return the file to upload — a BT.709-tagged copy for untagged MP4s, else the original.
  function maybeTagVideo(file) {
    if (!videoTagEnabled()) return Promise.resolve(file);
    var nm = (file.name || "").toLowerCase();
    if (!(file.type === "video/mp4" || /\.(mp4|m4v)$/.test(nm))) return Promise.resolve(file);
    return file.arrayBuffer().then(function (b) {
      var out = mp4TagBt709(b);
      if (!out) return file;
      return new File([out], file.name || "video.mp4", { type: "video/mp4", lastModified: file.lastModified || Date.now() });
    }).catch(function () { return file; });
  }

  // Media slots accept images, video, PowerPoint & PDF — hosted in the repo just like images.
  function pickMedia(cb) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = MEDIA_ACCEPT;
    inp.onchange = function () {
      const f = inp.files && inp.files[0]; if (!f) return;
      if (f.size > 45 * 1024 * 1024) { status("\u201c" + (f.name || "That file") + "\u201d is " + Math.round(f.size / 1048576) + " MB \u2014 too large to embed. Host it (YouTube, Vimeo, OneDrive/Stream) and paste the link instead."); return; }
      maybeTagVideo(f).then(function (file) {
        if (file !== f) status("Tagged \u201c" + (f.name || "video") + "\u201d as BT.709 \u2014 true-to-life colour on OLED & wide-gamut screens.");
        fileToDataUri(file).then(function (uri) { cb(uri); hostUploaded(uri, file, cb); });
      });
    };
    inp.click();
  }
  // Host the freshly-read file and, on success, swap the embedded data URI for its lean path.
  function hostUploaded(uri, file, cb) {
    const nm = (file && file.name) || "File";
    const ext = extFromName(nm);
    const isImg = /^data:image\//i.test(uri);
    const finish = function (low, note) {
      const token = localStorage.getItem(GH_TOKEN_KEY);
      if (!token) { status("\u201c" + nm + "\u201d added" + note + " \u2014 embedded for now; connect GitHub on Publish and it becomes a hosted file automatically."); return; }
      status("Hosting \u201c" + nm + "\u201d\u2026");
      hostDataUri(uri, token, ext).then(function (path) {
        cb(path); // content.json + draft now carry just a lean path; the preview is the real file
        status("\u201c" + nm + "\u201d hosted" + (isImg ? " at full, original quality" : "") + note, !low);
      }).catch(function (e) {
        if (e && e.auth) status("GitHub didn\u2019t accept your sign-in \u2014 \u201c" + nm + "\u201d stays embedded and will be hosted when you Publish.");
        else status("Couldn\u2019t host \u201c" + nm + "\u201d just now \u2014 it\u2019s embedded and will be hosted on Publish.");
      });
    };
    if (isImg) {
      imgDims(uri).then(function (d) {
        const low = !!(d && d.w && d.w < 1400) && !/^data:image\/svg/i.test(uri);
        const dims = d && d.w ? d.w + "\u00d7" + d.h + "px" : "";
        finish(low, low ? " \u2014 heads up: " + dims + " is small for a full-width slot and may look soft when shown large." : (dims ? " (" + dims + ")" : ""));
      });
    } else { finish(false, ""); }
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
      data.work[i].image = uri; apply(true); if (openStudy >= 0) renderL2(); else renderBody(); status("Image generated.", true);
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
      data.work[i].image = uri; apply(true); if (openStudy >= 0) renderL2(); else renderBody(); status("Image updated.", true);
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

  /* ---------- AI feedback reviewer (map reviewer notes to the exact edits) ---------- */
  var FB_TYPE_NAMES = { text: "Text", statement: "Statement", metrics: "Metrics", steps: "Steps", media: "Media", split: "Before / after", faq: "FAQ", cards: "Cards", gallery: "Gallery", figure: "Figure", columns: "Columns", rows: "Rows", compare: "Compare", stickies: "Sticky notes", voices: "Voices" };
  var FB_FIELD_LABELS = { kicker: "kicker", nav: "nav label", heading: "heading", body: "body", sub: "sub-line", caption: "caption", leftLabel: "before label", rightLabel: "after label", beforeLabel: "before label", afterLabel: "after label", value: "value", label: "label", title: "title", q: "question", a: "answer", cite: "attribution" };
  function fbPlain(s) { return String(s == null ? "" : s).replace(/<[^>]+>/g, " ").replace(/\*\*|\*|~~|\[\[|\]\]/g, "").replace(/\s+/g, " ").trim(); }
  function fbBlockLoc(b) { return fbPlain(b.nav || b.kicker || b.heading || b.body || FB_TYPE_NAMES[b.type] || "Section").slice(0, 42) || "Section"; }
  // Flat, addressable map of every editable TEXT field in a study, with a live setter per field.
  function fbFieldMap(w) {
    var st = w.study || {};
    var out = [];
    function push(addr, label, value, setter) {
      if (typeof value !== "string" || !value.trim()) return;
      out.push({ addr: addr, label: label, value: value, set: setter });
    }
    push("meta.title", "Project \u00b7 title", w.title, function (v) { w.title = v; });
    push("meta.desc", "Project \u00b7 description", w.desc, function (v) { w.desc = v; });
    ["tagline", "role", "team", "timeline", "scope"].forEach(function (f) { push("meta." + f, "Story header \u00b7 " + f, st[f], function (v) { st[f] = v; }); });
    (st.blocks || []).forEach(function (b, j) {
      var loc = fbBlockLoc(b);
      function bf(f) { push("block." + j + "." + f, loc + " \u00b7 " + (FB_FIELD_LABELS[f] || f), b[f], function (v) { b[f] = v; }); }
      ["kicker", "nav", "heading", "body", "sub", "caption", "leftLabel", "rightLabel", "beforeLabel", "afterLabel"].forEach(function (f) { if (typeof b[f] === "string") bf(f); });
      if (Array.isArray(b.list)) b.list.forEach(function (v, n) { if (typeof v === "string") push("block." + j + ".list." + n, loc + " \u00b7 bullet " + (n + 1), v, function (nv) { b.list[n] = nv; }); });
      ["left", "right"].forEach(function (f) {
        if (Array.isArray(b[f])) b[f].forEach(function (v, n) { if (typeof v === "string") push("block." + j + "." + f + "." + n, loc + " \u00b7 " + f + " " + (n + 1), v, function (nv) { b[f][n] = nv; }); });
        else if (typeof b[f] === "string") bf(f);
      });
      (b.items || []).forEach(function (it, k) {
        ["value", "label", "title", "body", "q", "a", "caption", "heading", "cite"].forEach(function (f) {
          push("block." + j + ".item." + k + "." + f, loc + " \u00b7 " + (k + 1) + " \u00b7 " + (FB_FIELD_LABELS[f] || f), it[f], function (v) { it[f] = v; });
        });
        (it.cells || []).forEach(function (cell, c) {
          ["heading", "body"].forEach(function (f) { push("block." + j + ".item." + k + ".cell." + c + "." + f, loc + " \u00b7 col " + (k + 1) + " cell " + (c + 1) + " \u00b7 " + f, cell[f], function (v) { cell[f] = v; }); });
        });
      });
    });
    return out;
  }
  function ensureMammoth() {
    if (window.mammoth) return Promise.resolve(window.mammoth);
    if (ensureMammoth._p) return ensureMammoth._p;
    ensureMammoth._p = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js";
      s.onload = function () { window.mammoth ? resolve(window.mammoth) : reject(new Error("Couldn\u2019t load the Word reader.")); };
      s.onerror = function () { ensureMammoth._p = null; reject(new Error("Couldn\u2019t load the Word reader.")); };
      document.head.appendChild(s);
    });
    return ensureMammoth._p;
  }
  async function fbExtractFile(f) {
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
      var pdfjs = await ensurePdfJs();
      var pdf = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      var parts = [];
      for (var p = 1; p <= pdf.numPages; p++) {
        var page = await pdf.getPage(p);
        var content = await page.getTextContent();
        parts.push(content.items.map(function (it) { return it.str; }).join(" "));
      }
      return parts.join("\n\n");
    }
    if (/\.docx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      var mammoth = await ensureMammoth();
      var res = await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() });
      return (res && res.value) || "";
    }
    if (/\.doc$/i.test(f.name)) throw new Error("Old .doc isn\u2019t supported \u2014 save as .docx or PDF, or paste the text.");
    return await f.text();
  }
  function fbSystem() {
    return [
      "You are a meticulous product-design portfolio editor. You are given (A) the editable text fields of ONE case study \u2014 each with a unique \"addr\" and its current \"value\" \u2014 and (B) reviewer feedback on that case study.",
      "Map each actionable feedback point to the specific field(s) it affects, and propose a concrete revised value for each.",
      "Rules:",
      "- Use ONLY \"addr\" values that appear in the provided fields list. Never invent an address.",
      "- Include a field ONLY if the feedback calls for changing it. Leave everything else untouched.",
      "- Preserve the author\u2019s voice and every factual specific. NEVER invent or alter metrics, numbers, names or dates unless the feedback explicitly provides them.",
      "- If a field\u2019s current value contains HTML tags, return \"suggested\" as valid minimal HTML (<p>, <strong>, <em>, <ul>/<li>). Otherwise return plain text.",
      "- \"reason\" = one short sentence naming the feedback point you are addressing.",
      "- A single feedback point may touch several fields; emit one change per field.",
      "Return ONLY valid JSON (no markdown, no commentary): {\"changes\":[{\"addr\":string,\"suggested\":string,\"reason\":string}]}. If nothing is actionable, return {\"changes\":[]}."
    ].join("\n");
  }
  function fbUser(fields, feedback) {
    return "REVIEWER FEEDBACK:\n" + String(feedback).trim() + "\n\nEDITABLE FIELDS (JSON array of {addr,label,value}):\n" + JSON.stringify(fields.map(function (f) { return { addr: f.addr, label: fbPlain(f.label), value: f.value }; }));
  }
  function fbReviewModal(i) {
    var w = data.work[i]; if (!w || !w.study) return;
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { fbReviewModal(i); }); return; }
    var fields = fbFieldMap(w);
    var byAddr = {}; fields.forEach(function (f) { byAddr[f.addr] = f; });
    var changes = [];
    var modal = document.createElement("div");
    modal.className = "pass pass--wide fbrev-modal";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">Review feedback with AI</div>' +
      '<div class="pass__sub">Paste or upload the feedback (PDF, Word or text). The AI finds where each point applies and proposes edits \u2014 you approve what ships.</div>' +
      '<div class="fbrev__input">' +
        '<div class="af"><label class="af__label">Feedback</label><textarea id="fbrevText" rows="7" placeholder="Paste stakeholder notes, a design-review doc, comments\u2026 one point per line is ideal."></textarea>' +
        '<div class="af__hint" id="fbrevFileHint">' + fields.length + ' editable field' + (fields.length === 1 ? "" : "s") + ' in this case study \u00b7 nothing changes until you approve.</div></div>' +
        '<div class="fbrev__tools"><button class="btn btn--ghost" data-fbrev-file>Add PDF / Word / text\u2026</button></div>' +
      "</div>" +
      '<div class="fbrev__review" hidden></div>' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions fbrev__foot">' +
        '<button class="btn btn--ghost" data-cancel>Cancel</button>' +
        '<span class="fbrev__bulk" hidden><button class="btn btn--ghost" data-fbrev-all>Approve all</button><button class="btn btn--ghost" data-fbrev-none>Reject all</button></span>' +
        '<button class="btn btn--auto" data-fbrev-run>Review against case study</button>' +
        '<button class="btn btn--primary" data-fbrev-apply hidden>Apply approved</button>' +
      "</div>" +
      '<div class="pass__note">Keys stay in this browser. Applied edits go to your local draft \u2014 you still hit Publish when ready.</div></div>';
    document.body.appendChild(modal);
    var err = modal.querySelector(".pass__err");
    var review = modal.querySelector(".fbrev__review");
    var inputStage = modal.querySelector(".fbrev__input");
    var runBtn = modal.querySelector("[data-fbrev-run]");
    var applyBtn = modal.querySelector("[data-fbrev-apply]");
    var bulk = modal.querySelector(".fbrev__bulk");
    var ta = modal.querySelector("#fbrevText");
    var close = function () { modal.remove(); };
    function updateApplyCount() {
      var n = review.querySelectorAll("input[data-fbc]:checked").length;
      applyBtn.textContent = "Apply approved (" + n + ")";
      applyBtn.disabled = !n;
    }
    function renderReview() {
      if (!changes.length) {
        review.innerHTML = '<div class="fbrev__empty">The AI didn\u2019t find anything to change from that feedback \u2014 add more detail or be more specific, then try again.</div>';
        bulk.hidden = true; applyBtn.hidden = true; return;
      }
      review.innerHTML = '<div class="fbrev__reviewhd">' + changes.length + " proposed edit" + (changes.length > 1 ? "s" : "") + ' \u2014 approve the ones to apply, tweak any text, then Apply.</div>' +
        changes.map(function (c, idx) {
          return '<div class="fbrev__card">' +
            '<label class="fbrev__approve"><input type="checkbox" data-fbc="' + idx + '" checked /> <span class="fbrev__loc">' + escHtml(c.field.label) + "</span></label>" +
            '<div class="fbrev__reason">' + escHtml(c.reason || "") + "</div>" +
            '<div class="fbrev__diff"><div class="fbrev__before"><span class="fbrev__tag">Now</span>' + escHtml(fbPlain(c.field.value) || "\u2014") + "</div>" +
            '<div class="fbrev__after"><span class="fbrev__tag">Suggested</span><textarea class="fbrev__sug" data-fbs="' + idx + '" rows="3">' + escHtml(c.suggested) + "</textarea></div></div>" +
            "</div>";
        }).join("");
      bulk.hidden = false; applyBtn.hidden = false;
      updateApplyCount();
    }
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    modal.addEventListener("change", function (e) { if (e.target.matches("input[data-fbc]")) updateApplyCount(); });
    modal.querySelector("[data-cancel]").addEventListener("click", close);
    modal.querySelector("[data-fbrev-file]").addEventListener("click", function () {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,.md,.markdown,text/plain";
      inp.onchange = async function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        var hint = modal.querySelector("#fbrevFileHint");
        hint.textContent = "Reading " + f.name + "\u2026";
        try {
          var text = ((await fbExtractFile(f)) || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
          if (!text) throw new Error("No selectable text found in that file (a scanned PDF has no text layer).");
          ta.value = (ta.value.trim() ? ta.value.trim() + "\n\n" : "") + text;
          hint.textContent = "Added text from " + f.name + " \u2014 edit above if needed.";
        } catch (e) { hint.textContent = (e && e.message) || "Couldn\u2019t read that file."; }
      };
      inp.click();
    });
    runBtn.addEventListener("click", async function () {
      var feedback = ta.value.trim();
      if (!feedback) { err.textContent = "Paste or upload some feedback first."; return; }
      if (!fields.length) { err.textContent = "This case study has no editable text yet."; return; }
      err.textContent = "";
      runBtn.disabled = true; runBtn.textContent = "Reviewing\u2026";
      try {
        var obj = csgenParse(await aiText(aiCfg("txt"), fbSystem(), fbUser(fields, feedback), { json: true, maxTokens: 4096, temperature: 0.4 }));
        var raw = obj && Array.isArray(obj.changes) ? obj.changes : (Array.isArray(obj) ? obj : null);
        if (!raw) throw new Error("The AI didn\u2019t return usable suggestions \u2014 try again.");
        changes = raw.map(function (c) {
          if (!c || typeof c.addr !== "string") return null;
          var f = byAddr[c.addr]; if (!f) return null;
          var sug = typeof c.suggested === "string" ? c.suggested : "";
          if (!sug.trim() || sug.trim() === String(f.value).trim()) return null;
          return { addr: c.addr, suggested: sug, reason: typeof c.reason === "string" ? c.reason : "", field: f };
        }).filter(Boolean);
        inputStage.hidden = true; runBtn.hidden = true;
        review.hidden = false;
        renderReview();
      } catch (e) {
        err.textContent = (e && e.message) || "Review failed.";
        runBtn.disabled = false; runBtn.textContent = "Review against case study";
      }
    });
    modal.querySelector("[data-fbrev-all]").addEventListener("click", function () { review.querySelectorAll("input[data-fbc]").forEach(function (c) { c.checked = true; }); updateApplyCount(); });
    modal.querySelector("[data-fbrev-none]").addEventListener("click", function () { review.querySelectorAll("input[data-fbc]").forEach(function (c) { c.checked = false; }); updateApplyCount(); });
    applyBtn.addEventListener("click", function () {
      var applied = 0;
      review.querySelectorAll("input[data-fbc]:checked").forEach(function (cb) {
        var idx = +cb.dataset.fbc; var c = changes[idx]; if (!c) return;
        var sugEl = review.querySelector('textarea[data-fbs="' + idx + '"]');
        c.field.set(sugEl ? sugEl.value : c.suggested);
        applied++;
      });
      if (!applied) { err.textContent = "Approve at least one edit, or Cancel."; return; }
      saveDraft(true);
      renderL2();
      refreshL2Preview();
      close();
      status(applied + " feedback edit" + (applied > 1 ? "s" : "") + " applied \u2014 review below, then Publish when ready.", true);
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
          '<button class="btn btn--ghost adm__keycfg" data-keycfg title="Change admin key" aria-label="Change admin key"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3z"/></svg></button>' +
          '<button class="btn btn--ghost adm__pubcfg" data-pubcfg title="Publishing settings" aria-label="Publishing settings">\u2699</button>' +
          '<button class="btn btn--primary" data-publish>Publish</button>' +
          '<button class="btn adm__exit" data-exit aria-label="Exit admin">Exit ✕</button>' +
        "</div>" +
      "</header>" +
      '<div class="adm__pub" hidden aria-live="polite">' +
        '<div class="adm__pub-head"><span class="adm__pub-label">Publishing\u2026</span><span class="adm__pub-pct">0%</span>' +
          '<button class="adm__pub-close" data-pub-close type="button" aria-label="Dismiss" hidden>\u2715</button></div>' +
        '<div class="adm__pub-track"><div class="adm__pub-fill"></div></div>' +
        '<div class="adm__pub-foot"><span class="adm__pub-hint">Keep this tab open \u2014 confirming when your changes are live.</span>' +
          '<a class="btn btn--primary adm__pub-view" target="_blank" rel="noopener" hidden>View site \u2197</a></div>' +
      "</div>" +
      '<div class="adm__main">' +
        '<div class="adm__editor"><div class="adm__body"></div>' +
          '<div class="adm__l2" hidden>' +
            '<div class="adm__l2-bar">' +
              '<button class="btn btn--ghost adm__l2-back" data-l2-back><span aria-hidden="true">\u2039</span> Back to projects</button>' +
              '<span class="adm__l2-title"></span>' +
              '<button class="btn btn--ghost adm__l2-prev" data-l2-prev aria-label="Toggle live preview"></button>' +
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
    // Drag-to-reorder any list with a grip handle (arrows still work).
    root.addEventListener("pointerdown", sortStart);
    // Keep the caret inside the rich-text area when a toolbar button is pressed.
    root.addEventListener("mousedown", function (e) { if (e.target.closest("[data-rt]")) e.preventDefault(); });
    // Paste into a rich-text body as plain text (no foreign colours/fonts).
    root.addEventListener("paste", onRtPaste);
    root.querySelectorAll(".adm__tab").forEach((t) =>
      t.addEventListener("click", () => { if (openStudy >= 0) closeL2({ render: false }); activeTab = t.dataset.tab; renderBody(); })
    );
    root.querySelector("[data-publish]").addEventListener("click", publish);
    root.querySelector("[data-pubcfg]").addEventListener("click", () => publishModal());
    root.querySelector("[data-keycfg]").addEventListener("click", () => changeKeyModal());
    const pubCloseBtn = root.querySelector("[data-pub-close]");
    if (pubCloseBtn) pubCloseBtn.addEventListener("click", pubHide);
    root.querySelector("[data-revert]").addEventListener("click", revert);
    root.querySelector("[data-exit]").addEventListener("click", exit);
    root.querySelector("[data-l2-back]").addEventListener("click", () => closeL2());
    root.querySelector("[data-l2-prev]").addEventListener("click", () => {
      const wasOff = localStorage.getItem(L2PREV_KEY) === "0";
      try { localStorage.setItem(L2PREV_KEY, wasOff ? "1" : "0"); } catch (e) {}
      l2PreviewApply();
      if (wasOff && openStudy >= 0 && data.work[openStudy]) previewProject(data.work[openStudy].id, false);
    });
    root.querySelector("[data-view]").addEventListener("click", (e) => {
      const on = root.classList.toggle("is-preview");
      e.currentTarget.textContent = on ? "Edit" : "Preview";
      if (on) { if (openStudy >= 0 && data.work[openStudy]) previewProject(data.work[openStudy].id, false); else previewLanding(); }
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
    musResumeOnExit = musPlaying; musStop(); musPlaying = false; musAttract(false); musToastHide(); musSync(); // silence the ambient music while editing
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
    if (musResumeOnExit) { musResumeOnExit = false; musPlay(); } // bring the music back if it was on before
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

  /* ---------- change the admin key (requires the current key) ---------- */
  function changeKeyModal() {
    const stored = localStorage.getItem(HASH_KEY);
    const modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">Change admin key</div>' +
      '<div class="pass__sub">Confirm your current key, then set a new one. This changes the key for this browser only.</div>' +
      '<input type="password" placeholder="Current key" data-cur autocomplete="current-password" />' +
      '<input type="password" placeholder="New key" data-new autocomplete="new-password" />' +
      '<input type="password" placeholder="Confirm new key" data-confirm autocomplete="new-password" />' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button>' +
      '<button class="btn btn--primary" data-go>Update key</button></div></div>';
    document.body.appendChild(modal);
    const cur = modal.querySelector("[data-cur]"), nw = modal.querySelector("[data-new]"), cf = modal.querySelector("[data-confirm]"), err = modal.querySelector(".pass__err");
    setTimeout(function () { try { cur.focus(); } catch (e) {} }, 30);
    const done = () => modal.remove();
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    modal.addEventListener("click", (e) => { if (e.target === modal) done(); });
    async function submit() {
      if (stored && (await sha256(cur.value)) !== stored) { err.textContent = "Current key is incorrect"; return; }
      const val = nw.value;
      if (val.length < 4) { err.textContent = "New key must be at least 4 characters"; return; }
      if (cf.value !== val) { err.textContent = "New keys don\u2019t match"; return; }
      if (stored && (await sha256(val)) === stored) { err.textContent = "That\u2019s already your current key"; return; }
      localStorage.setItem(HASH_KEY, await sha256(val));
      done();
      status("Admin key updated \u2014 you\u2019ll use the new key next time you open admin.", true);
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
    if (document.documentElement.classList.contains("adm-lock")) return; // never play while the admin studio is open
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
