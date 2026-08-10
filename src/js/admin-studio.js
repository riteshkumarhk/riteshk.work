/* =================================================================
   ADMIN MODE — private, client-side content editor.
   Trigger: click the nav clock. Gated by an admin key — verified
   against a salted hash published in content.json, so a fresh browser
   must know the real key (no self-serve "create"). Edits live-preview
   + save to a localStorage draft.
   Publishing = download content.json + clipboard + open GitHub editor.
   NOTE: the gate is still a client-side deterrent — content.json is
   public, and the real lock is that the live site changes only when
   content.json is committed (which needs your GitHub token).
   ================================================================= */
import {
  clone, escHtml, escAttr, RK_KDF_IT, sha256,
  rkNormPass, rkB64, rkUnb64, rkDeriveKey, rkNewSek, rkImportSek,
  rkEncWithSek, rkDecWithSek, rkWrapSek, rkUnwrapSek, rkEncBytes, rkDecBytes,
  rkPbkHex, rkGateRecord, rkGateVerify, getPath, setPath,
  ADMIN_WORKER, adminSession, clearAdminSession, vaultUpload, vaultRegisterGrant, vaultSignedUrl,
  webauthnSupported, webauthnRegister, webauthnList, webauthnRemove, webauthnAuth, publishProof, publishStatus, publishConfig, authStatus, authConfig, deviceTrust, deviceTrusted, stepUp, keyringGet, keyringPut
} from "./admin-core.js";
import { WORLD_LAND } from "./worldland.js";

(function () {
  "use strict";

  // The live-preview iframe loads this very file — it must stay inert there.
  if (new URLSearchParams(location.search).has("preview")) return;

  const HASH_KEY = "rk:admin:hash";
  const GATE_KEY = "rk:admin:gate"; // salted PBKDF2 record embedded in content.json at publish
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
  const AUTOPUB_ON_KEY = "rk:autopub:on";       // auto-publish enabled ("1"/"0")
  const AUTOPUB_EVERY_KEY = "rk:autopub:every"; // interval in minutes ("30"/"60")
  const GH_NEW_TOKEN_URL = "https://github.com/settings/tokens/new?description=riteshk.work%20publishing&scopes=public_repo";
  const GH_RAW = "https://raw.githubusercontent.com/" + GH_OWNER + "/" + GH_REPO + "/" + GH_BRANCH + "/";
  const GH_FILE_API = "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/";
  const UPLOAD_DIR = "assets/uploads/";
  // Where a visitor actually sees the site — used to confirm a publish is live.
  const LIVE_ORIGIN = (/(^|\.)riteshk\.work$/i.test(location.hostname) || /\.github\.io$/i.test(location.hostname)) ? location.origin : "https://riteshk.work";
  const PUBLISH_HARD_CAP = 40 * 1024 * 1024; // skip an obviously-doomed content.json commit (GitHub rejects very large blobs)
  const DRAFT_SIG_KEY = "rk:content:draft:sig";
  const PREVIEW_SRC = "/index.html?preview=1&lite=1";
  const ADMIN_MIN = 900; // below this the split editor can't fit — admin is disabled
  const AI_PROVIDERS = [
    ["openai", "OpenAI"],
    ["gemini", "Google Gemini"],
    ["anthropic", "Anthropic (Claude)"],
    ["custom", "Custom (OpenAI-compatible)"],
  ];
  const AI_DEFAULT_MODEL = { openai: "gpt-image-1", gemini: "gemini-2.0-flash-preview-image-generation", anthropic: "claude-3-5-sonnet-latest", custom: "" };
  const AI_TEXT_MODEL = { openai: "gpt-4o", gemini: "gemini-2.0-flash", anthropic: "claude-3-5-sonnet-latest", custom: "" };
  // Vision-capable models (cheap first) used to LOOK at case images and curate the skim reel.
  const AI_VISION_MODEL = { openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"], gemini: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash"], anthropic: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", "claude-3-haiku-20240307"], custom: [] };
  const visionCache = {}; // src -> { type, ux, desc } (session-only, never published)
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
    { type: "workflow", name: "Workflow", tag: "Flow", desc: "A process as a left-to-right flow or a repeating loop \u2014 split a step with // to fork into parallel branches that merge back.", best: "Pipelines \u00b7 review cycles \u00b7 fork / merge" },
    { type: "media", name: "Media", tag: "Visuals", desc: "Images, video, Figma, PDF or slides with captions.", best: "Screens \u00b7 prototypes \u00b7 before/after shots" },
    { type: "split", name: "Before / after", tag: "Compare", desc: "Two labelled columns placed side by side.", best: "Before vs after \u00b7 problem vs solution" },
    { type: "faq", name: "FAQ", tag: "Q & A", desc: "A list of question-and-answer pairs.", best: "Objections \u00b7 context \u00b7 scope \u00b7 details" },
    { type: "cards", name: "Cards", tag: "Columns", desc: "A row of titled cards, each with a short line \u2014 no step numbers.", best: "Feature sets \u00b7 principles \u00b7 pillars" },
    { type: "gallery", name: "Gallery", tag: "Carousel", desc: "A swipeable strip of visuals with captions and a 1/N counter.", best: "Key features \u00b7 screen tours \u00b7 shots" },
    { type: "mediagrid", name: "Media grid", tag: "Grid", desc: "Several images in a compact grid \u2014 uniform tiles or a staggered cluster. Multi-select to add many at once.", best: "Moodboards \u00b7 screen sets \u00b7 explorations" },
    { type: "device", name: "Devices", tag: "Mockup", desc: "Wrap screens in an abstract phone, tablet, laptop or watch — pick a preset ratio or let the frame fit your media. Narrow devices pack side by side.", best: "App screens · responsive · device showcases" },
    { type: "isolayers", name: "Isometric layers", tag: "3D", desc: "Stack screens or UI layers into a soft isometric explosion with depth — the showpiece. One stack per section, up to 12 layers.", best: "Design systems · UI teardown · flows" },
    { type: "figure", name: "Figure", tag: "Image + text", desc: "A visual beside a short write-up \u2014 image left or right.", best: "A decision explained next to its screen" },
    { type: "columns", name: "Columns", tag: "Text table", desc: "Multiple columns of titled text \u2014 add a heading or image to any column.", best: "Overview + What I did \u00b7 feature columns" },
    { type: "rows", name: "Rows", tag: "Text table", desc: "Stacked rows of titled cells \u2014 a labelled row header with cells side by side.", best: "Comparisons \u00b7 phased breakdowns \u00b7 matrices" },
    { type: "compare", name: "Before / after slider", tag: "Compare", desc: "Two images overlaid with a divider you drag to reveal before vs after.", best: "Redesigns \u00b7 visual transformations" },
    { type: "stickies", name: "Sticky notes", tag: "Research", desc: "Staggered note cards \u2014 each with a label, heading, body and image, with a gentle hover lift.", best: "Research methods \u00b7 findings \u00b7 inspiration" },
    { type: "voices", name: "Voices", tag: "Qual", desc: "Verbatims, thoughts or a chat thread \u2014 quote bubbles with a sharp, soft or two-way tail.", best: "User quotes \u00b7 assumption vs reality \u00b7 insights" },
    { type: "focus", name: "Focus & annotate", tag: "Interactive", desc: "One image with pinned + markers \u2014 click a marker for a note, and add a focus area to blur everything but that region. Full-screen lists every annotation.", best: "UI teardown \u00b7 spec callouts \u00b7 walkthroughs" },
  ];

  let data = null;
  let activeTab = "insights";
  let openStudy = -1; // index of the work item whose case-study editor is expanded
  let openBlock = -1; // which section (block) is expanded in the L2 sections accordion
  let journeyOpen = false; // is the Design Journey editor open in the L2 panel?
  let openJC = -1; // which journey chapter is expanded in the accordion
  let jrnPreviewTimer = 0;
  let musResumeOnExit = false; // was music playing when admin opened? → resume on exit
  let root = null, body = null, frame = null;
  let l2 = null, l2body = null, l2title = null, l2PreviewTimer = 0;
  let autopubTimer = 0, publishing = false;
  let saveTimer = null;
  let sortState = null;
  let menuEl = null;
  let menuUsed = false;   // set once the visitor opens the ··· menu — the ticket nudge stays hidden afterwards
  const ticketPlain = {}; // owner-only plaintext tickets, never published
  const studyUnlockPlain = {}; // owner-only plaintext deeper-cut passes, never published
  const hostedBytes = {}; // "/assets/uploads/<hash>.<ext>" -> data URI (this session) for instant local preview

  const TABS = [
    ["insights", "Insights"],
    ["landing", "Landing"],
    ["highlights", "Highlights"],
    ["capabilities", "Capabilities"],
    ["work", "Work"],
    ["aboutpage", "About"],
    ["path", "Path"],
    ["recognition", "Recognition"],
    ["education", "Education"],
    ["contact", "Contact"],
    ["special", "Special Views"],
    ["ai", "Prepare"],
    ["autofill", "More"],
  ];
  // Files bundled into the downloadable Résumé Autofill extension (served from /extension/).
  const EXT_FILES = [
    "manifest.json", "background.js", "content.js",
    "popup.html", "popup.js", "popup.css",
    "options.html", "options.js", "options.css", "README.md",
    "src/model.js", "src/store.js", "src/insert.js",
    "icons/icon16.png", "icons/icon48.png", "icons/icon128.png"
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

  /* ---------- host bridge: the shell hands the studio a few shell-owned actions ---------- */
  let __host = {};
  function musSilence() { if (__host.musSilence) __host.musSilence(); }
  function musRestore() { if (__host.musRestore) __host.musRestore(); }
  function thDismiss(n) { if (__host.thDismiss) __host.thDismiss(n); }
  function hostExit() { if (__host.onExit) __host.onExit(); }
  function platePreview(th) {
    return (window.RK && window.RK.plateInner) ? window.RK.plateInner(th) : "";
  }

  /* Shared crypto + utils (clone/esc, sha256, the rk* encryption envelope,
     the salted gate hash, getPath/setPath) now live in ./admin-core.js and
     are imported at the top of this file. */

  /* ---------- live preview (iframe) + persist ---------- */
  function apply(immediate) {
    previewApply();
    saveDraft(immediate);
  }

  function saveDraft(immediate) {
    updateDirtyUI();
    clearTimeout(saveTimer);
    const save = () => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
        localStorage.setItem(DRAFT_SIG_KEY, (window.RK && window.RK.publishedSig) || "");
        status("Draft saved locally");
      } catch (e) {
        status("\u26a0 Draft too big to auto-save locally \u2014 your images are safe at full quality here. Hit Publish to store them (large ones are hosted as files automatically).");
      }
      histPush();
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
      try { w.RK.render(resolvePreviewData(data)); forceRevealDoc(w.document); if (w.__rkInitDepth) w.__rkInitDepth(); } catch (e) {}
    }
    syncPreviewPage();
  }

  // Keep the preview on the page whose content the active tab edits, so About-page
  // tabs (layout, path, recognition, education, capabilities) show the About page.
  const ABOUT_TABS = { aboutpage: 1, path: 1, recognition: 1, education: 1, capabilities: 1 };
  function syncPreviewPage() {
    const w = frame && frame.contentWindow;
    if (!(w && typeof w.__rkShowPage === "function")) return;
    if (openStudy >= 0 || journeyOpen) return; // a case study / journey owns the preview
    try { w.__rkShowPage(ABOUT_TABS[activeTab] ? "about" : "work"); } catch (e) {}
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

  // The Publish button + the "\u2715" leave-options flyout are contextual: they only
  // appear once the working draft differs from the published site. When we can't be
  // sure (no signature yet), default to "dirty" so publishing is never hidden away.
  function isDirty() {
    try {
      if (!window.RK || !window.RK.sig) return true;
      var pub = window.RK.publishedSig || "";
      if (!pub) return true;
      return window.RK.sig(JSON.stringify(data)) !== pub;
    } catch (e) { return true; }
  }
  function updateDirtyUI() {
    if (!root) return;
    var dirty = isDirty();
    var pb = root.querySelector("[data-publish]"); if (pb) pb.hidden = !dirty;
    root.classList.toggle("is-dirty", dirty);
    if (!dirty) closeExitPop();
    updateHistUI();
  }
  function closeMorePop() {
    if (!root) return;
    var p = root.querySelector(".adm__more-pop"); if (p) p.hidden = true;
    var b = root.querySelector("[data-more]"); if (b) b.setAttribute("aria-expanded", "false");
  }
  function closeExitPop() {
    if (!root) return;
    var p = root.querySelector(".adm__exit-pop"); if (p) p.hidden = true;
  }
  function closeBarPops() { closeMorePop(); closeExitPop(); }

  // ---- undo / redo (session snapshots of `data`) + tab-strip overflow flippers ----
  var histStack = [], histIndex = -1, histRestoring = false, tabsRaf = 0;
  function histSnap() { try { return JSON.stringify(data); } catch (e) { return null; } }
  function histReset() {
    var cur = histSnap() || "{}", pub = null;
    if (window.RK && window.RK.published) { try { pub = JSON.stringify(window.RK.published); } catch (e) {} }
    if (pub && pub !== cur) { histStack = [pub, cur]; histIndex = 1; }   // resumed a dirty draft: undo can reach the published baseline
    else { histStack = [cur]; histIndex = 0; }
    updateHistUI();
  }
  function histPush() {
    if (histRestoring) return;
    var snap = histSnap(); if (snap == null) return;
    if (histIndex >= 0 && histStack[histIndex] === snap) return;   // nothing changed
    histStack = histStack.slice(0, histIndex + 1);
    histStack.push(snap);
    while (histStack.length > 80) histStack.shift();
    histIndex = histStack.length - 1;
    updateHistUI();
  }
  function histRerender() {
    if (journeyOpen) { renderJourneyEditor(); return; }
    if (openStudy >= 0) {
      if (data.work && data.work[openStudy]) { renderL2(); return; }
      openStudy = -1; if (l2) { l2.hidden = true; l2.classList.remove("is-open"); } if (body) body.hidden = false;
    }
    renderBody();
  }
  function histRestore(idx) {
    if (idx < 0 || idx >= histStack.length) return;
    histIndex = idx; histRestoring = true;
    try { data = JSON.parse(histStack[idx]); } catch (e) {}
    histRerender();
    previewApply();
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); localStorage.setItem(DRAFT_SIG_KEY, (window.RK && window.RK.publishedSig) || ""); } catch (e) {}
    histRestoring = false;
    updateDirtyUI();
  }
  function histUndo() { if (histIndex > 0) histRestore(histIndex - 1); }
  function histRedo() { if (histIndex < histStack.length - 1) histRestore(histIndex + 1); }
  function updateHistUI() {
    if (!root) return;
    var dirty = isDirty();
    var wrap = root.querySelector("[data-hist]"); if (wrap) wrap.hidden = !dirty;   // whole undo/redo cluster hides once you're back at the published baseline
    var u = root.querySelector("[data-undo]"); if (u) u.disabled = histIndex <= 0;
    var r = root.querySelector("[data-redo]"); if (r) r.disabled = histIndex >= histStack.length - 1;
  }
  function tabScroll(dir) {
    var t = root && root.querySelector(".adm__tabs"); if (!t) return;
    t.scrollBy({ left: dir * Math.max(160, Math.round(t.clientWidth * 0.7)), behavior: "smooth" });
    // refresh the \u2039 \u203A once the smooth scroll settles (scrollend where supported, timeout fallback otherwise)
    var done = false, fin = function () { if (done) return; done = true; tabsSync(); };
    try { t.addEventListener("scrollend", fin, { once: true }); } catch (e) {}
    setTimeout(fin, 700);
  }
  function tabsSync() {
    if (!root) return;
    var t = root.querySelector(".adm__tabs");
    var prev = root.querySelector("[data-tabflip='-1']"), next = root.querySelector("[data-tabflip='1']");
    if (!t || !prev || !next) return;
    var overflow = t.scrollWidth - t.clientWidth > 2;
    // No overflow -> remove both flippers (no wasted space). Overflow -> keep BOTH
    // in the layout (constant tab-strip width, no scroll feedback loop) and just
    // disable the one that can't scroll further.
    prev.hidden = next.hidden = !overflow;
    prev.disabled = !overflow || t.scrollLeft <= 1;
    next.disabled = !overflow || (t.scrollLeft + t.clientWidth >= t.scrollWidth - 1);
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
    // opts.toggle = a landing show-key ("eyebrow" etc.). Adds a Shown/Hidden switch on the
    // label row that flips data.landing.show[key]; the field stays editable while hidden.
    let labelBlock, off = false;
    if (opts.toggle) {
      const on = landingShown(opts.toggle); off = !on;
      labelBlock = '<div class="af__labelrow"><label class="af__label">' + label + "</label>" +
        '<label class="af__tog" title="Show this on the landing page"><input type="checkbox" data-act="landing-show" data-showkey="' + opts.toggle + '"' + (on ? " checked" : "") + ' /><span class="af__tog-state">' + (on ? "Shown" : "Hidden") + "</span></label></div>";
    } else {
      labelBlock = '<label class="af__label">' + label + "</label>";
    }
    return '<div class="af' + (opts.md ? " af--md" : "") + (off ? " af--off" : "") + '">' + labelBlock + (opts.md ? mdBar() : "") + control + hint + "</div>";
  }
  // A landing content piece is shown unless its show-flag is explicitly false (back-compat: missing = shown).
  function landingShown(key) {
    const s = ((data.landing || {}).show) || {};
    return s[key] !== false;
  }
  // A small formatting toolbar for the mini-markdown fields. It only wraps the current selection with
  // the same **bold** / *italic* / [[bronze]] markers the site already understands — the stored text
  // and every existing accent stay exactly as they are; clicking a button toggles its marker on/off.
  function mdBar() {
    return '<div class="mdbar" role="toolbar" aria-label="Formatting">' +
      '<button type="button" class="mdbar__b" data-act="md-fmt" data-md="bold" title="Bold \u2014 **text**"><b>B</b></button>' +
      '<button type="button" class="mdbar__b" data-act="md-fmt" data-md="italic" title="Italic \u2014 *text*"><i>I</i></button>' +
      '<button type="button" class="mdbar__b mdbar__b--acc" data-act="md-fmt" data-md="accent" title="Bronze accent \u2014 [[text]]">A</button>' +
      "</div>";
  }
  function mdFmt(btn) {
    var af = btn.closest(".af"); if (!af) return;
    var field = af.querySelector("textarea[data-path], input[data-path], textarea[data-field], input[data-field]"); if (!field) return;
    var pairs = { bold: ["**", "**"], italic: ["*", "*"], accent: ["[[", "]]"] };
    var p = pairs[btn.dataset.md]; if (!p) return;
    mdWrap(field, p[0], p[1], btn.dataset.md);
  }
  // Toggle-aware: if the selection (or its immediate surroundings) already carries the marker, strip
  // it; otherwise wrap. Guards against mistaking ** (bold) for * (italic) so nothing gets corrupted.
  function mdWrap(el, before, after, kind) {
    var v = el.value, s = el.selectionStart, e = el.selectionEnd;
    if (s == null) { s = e = v.length; }
    var sel = v.slice(s, e);
    var italicClash = kind === "italic" && v.slice(Math.max(0, s - 2), s) === "**";
    if (sel.length >= before.length + after.length && sel.slice(0, before.length) === before && sel.slice(sel.length - after.length) === after && !(kind === "italic" && sel.slice(0, 2) === "**")) {
      var inner = sel.slice(before.length, sel.length - after.length);
      el.value = v.slice(0, s) + inner + v.slice(e);
      el.setSelectionRange(s, s + inner.length); mdFire(el); return;
    }
    if (v.slice(Math.max(0, s - before.length), s) === before && v.slice(e, e + after.length) === after && !italicClash) {
      el.value = v.slice(0, s - before.length) + sel + v.slice(e + after.length);
      el.setSelectionRange(s - before.length, e - before.length); mdFire(el); return;
    }
    var ph = sel || (kind === "accent" ? "product" : kind === "bold" ? "bold text" : "text");
    el.value = v.slice(0, s) + before + ph + after + v.slice(e);
    el.setSelectionRange(s + before.length, s + before.length + ph.length); mdFire(el);
  }
  function mdFire(el) {
    try { el.focus(); } catch (x) {}
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
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
    return '<div class="af' + (opts.md ? " af--md" : "") + '"><label class="af__label">' + label + "</label>" + (opts.md ? mdBar() : "") + control + hint + "</div>";
  }

  function ops(list, i, len, dupAct) {
    return (
      '<div class="card__ops">' +
      '<button class="iconbtn" data-act="up" data-list="' + list + '" data-index="' + i + '"' + (i === 0 ? " disabled" : "") + ' title="Move up">↑</button>' +
      '<button class="iconbtn" data-act="down" data-list="' + list + '" data-index="' + i + '"' + (i === len - 1 ? " disabled" : "") + ' title="Move down">↓</button>' +
      (dupAct ? '<button class="iconbtn" data-act="' + dupAct + '" data-list="' + list + '" data-index="' + i + '" title="Duplicate — creates a hidden copy"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' : "") +
      '<button class="iconbtn iconbtn--danger" data-act="remove" data-list="' + list + '" data-index="' + i + '" title="Remove">✕</button>' +
      "</div>"
    );
  }

  function cardHead(idxLabel, list, i, len, dupAct) {
    return '<div class="card__bar"><span class="sortgrip" data-grip data-sortkey="list:' + list + '" title="Drag to reorder" aria-label="Drag to reorder">' + GRIP_SVG + '</span><span class="card__idx">' + idxLabel + "</span>" + ops(list, i, len, dupAct) + "</div>";
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
      '<div class="imgblk__preview' + (has ? " has imgblk__preview--parx" : "") + '"' + (has ? ' data-parx-prev="' + i + '"' : "") + '>' + (has ? '<img src="' + escAttr(previewSrc(w.image)) + '" alt="" />' + parxOverlay(w, i) : "<span>No image \u2014 the animated placeholder is shown</span>") + "</div>" +
      (has ? depthPanel(w, i) : "") +
      '<input type="text" data-list="work" data-index="' + i + '" data-field="image" value="' + escAttr(w.image || "") + '" placeholder="Paste an image URL\u2026" />' +
      '<div class="imgblk__row"><button class="btn btn--ghost" data-act="img-upload" data-index="' + i + '">Upload\u2026</button>' +
      (has ? '<button class="btn btn--ghost" data-act="img-clear" data-index="' + i + '">Remove</button>' : "") + mediaSizeTag(w.image) + "</div>" +
      '<div class="af__label" style="margin:.7rem 0 .2rem">Or use an animated placeholder \u2014 no upload, always on-brand</div>' +
      '<div class="imgblk__plates">' + plates + "</div>" +
      itemField("work", i, "plateTag", "Tag on the cover / plate", { hint: "the small label shown on the card & cover, e.g. \u201cFirst Run Experience\u201d" }) +
      '<div class="imgblk__ai"><input type="text" data-aiprompt="' + i + '" placeholder="' + aiHint + '"' + (canGen ? "" : " disabled") + " />" +
      '<div class="imgblk__row"><button class="btn btn--auto" data-act="img-generate" data-index="' + i + '"' + (canGen ? "" : " disabled") + ">Generate</button>" +
      '<button class="btn btn--ghost" data-act="img-modify" data-index="' + i + '"' + (canGen && has ? "" : " disabled") + ">Modify current</button></div>" +
      '<div class="imgblk__hint">Uploads are embedded at full, original quality \u2014 no compression or resizing. For very large images, host them and paste a URL to keep the published file lean.</div></div></div>';
  }

  var PARX_COPY_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var PARX_CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var DEPTH_DOTS_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
  // Compact parallax control overlaid on the cover-image preview (keeps the header card tidy).
  // Direction (up/down) + intensity (0..100, 0 = off). Persists to w.parDir / w.parAmt.
  function parxOverlay(w, i) {
    const set = w.parAmt != null && w.parAmt !== "";
    const amt = set ? Math.max(0, Math.min(100, +w.parAmt || 0)) : 50;
    const dir = w.parDir === "down" ? "down" : "up";
    return '<div class="parx" title="Scroll parallax for this thumbnail \u2014 scroll the editor to preview it">' +
      '<span class="parx__lead">Parallax</span>' +
      '<div class="parx__dir" role="group" aria-label="Parallax direction">' +
        '<button type="button" class="parx__dirbtn' + (dir === "up" ? " is-on" : "") + '" data-act="par-dir" data-index="' + i + '" data-dir="up" title="Drift up as you scroll">\u2191</button>' +
        '<button type="button" class="parx__dirbtn' + (dir === "down" ? " is-on" : "") + '" data-act="par-dir" data-index="' + i + '" data-dir="down" title="Drift down as you scroll">\u2193</button>' +
      '</div>' +
      '<input type="range" class="parx__range" min="0" max="100" step="1" value="' + amt + '" style="--fill:' + amt + '%" data-parx="' + i + '" aria-label="Parallax intensity" />' +
      '<span class="parx__valwrap">' +
        '<input type="text" inputmode="numeric" maxlength="3" class="parx__val" data-parxnum="' + i + '" value="' + amt + '" aria-label="Parallax intensity value" title="Intensity value - paste across cases" />' +
        '<button type="button" class="parx__copy" data-act="par-copy" data-index="' + i + '" title="Copy intensity value" aria-label="Copy intensity value">' + PARX_COPY_SVG + '</button>' +
      '</span>' +
      '<button type="button" class="parx__more" data-act="depth-open" data-index="' + i + '" title="3D depth settings" aria-label="3D depth settings">' + DEPTH_DOTS_SVG + '</button>' +
      '</div>';
  }

  // "3D depth" per-cover controls (the "..." on the cover overlay opens this panel). Persists to
  // w.depth {on,strength,softness,focus,zoom}; render.js emits them as data-depth-* for the runtime.
  function depthOf(w) {
    var d = w.depth || {};
    return {
      on: d.on !== false,
      strength: d.strength != null && d.strength !== "" ? +d.strength : 0.028,
      softness: d.softness != null && d.softness !== "" ? +d.softness : 0.014,
      focus: d.focus != null && d.focus !== "" ? +d.focus : 0.5,
      zoom: d.zoom != null && d.zoom !== "" ? +d.zoom : 1.075
    };
  }
  function ensureDepth(w) { if (!w.depth) w.depth = {}; return w.depth; }
  function depthMapUrl(w) {
    if (w.depth && w.depth.map) return previewSrc(w.depth.map);
    var m = String(w.image || "").match(/(\/?assets\/uploads\/[^./?#]+)\.[a-z0-9]+$/i);
    if (!m) return "";
    var p = m[1] + ".depth.png";
    return p.charAt(0) === "/" ? p : "/" + p;
  }
  function depthPanel(w, i) {
    var d = depthOf(w);
    function sl(field, label, min, max, step, val, hint) {
      return '<div class="depthp__row"><span class="depthp__lbl">' + label + '</span>' +
        '<input type="range" class="depthp__range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" data-depth-field="' + field + '" data-index="' + i + '" />' +
        '<span class="depthp__val">' + val + '</span></div>' +
        (hint ? '<div class="depthp__hint">' + hint + '</div>' : '');
    }
    return '<div class="depthp" data-depth-panel="' + i + '" hidden>' +
      '<div class="depthp__head">3D depth <span class="depthp__sub">cursor \u00b7 tilt parallax on this cover</span></div>' +
      '<div class="depthp__body">' +
        '<label class="depthp__toggle"><input type="checkbox" data-depth-on="' + i + '"' + (d.on ? " checked" : "") + ' /> <span>Enabled</span></label>' +
        sl("strength", "Strength", 0, 0.09, 0.002, d.strength) +
        sl("zoom", "Depth pull-back", 1, 1.3, 0.005, d.zoom, "Lower = a bigger dolly-out on hover = more sense of depth.") +
        sl("softness", "Edge softness", 0, 0.03, 0.001, d.softness) +
        sl("focus", "Focus plane", 0, 1, 0.02, d.focus) +
        '<div class="depthp__gen"><button class="btn btn--auto" data-act="depth-gen" data-index="' + i + '" title="Generate a depth map on your GPU (WebGPU)">Generate depth map</button>' +
        '<button class="btn btn--ghost" data-act="depth-suggest" data-index="' + i + '" title="Let AI look at the cover and suggest strength, focus &amp; pull-back">Suggest settings</button>' +
        '<span class="depthp__note">Generate builds the depth map on your GPU. Suggest uses your AI key to tune strength / focus / pull-back for this cover.</span></div>' +
      '</div>' +
      '<div class="depthp__preview is-empty" data-depth-preview>' +
        '<div class="depthp__map" data-depth-src="' + escAttr(depthMapUrl(w)) + '"></div>' +
        '<div class="depthp__ph"><span class="depthp__ph-t">No depth map yet</span><span class="depthp__ph-s">Generate one to preview it here</span></div>' +
        '<span class="depthp__preview-cap">Depth map</span>' +
      '</div>' +
    '</div>';
  }
  function onDepthSlider(t) {
    var i = +t.dataset.index, w = data.work[i]; if (!w) return;
    ensureDepth(w)[t.dataset.depthField] = parseFloat(t.value);
    var row = t.closest(".depthp__row"), vo = row && row.querySelector(".depthp__val");
    if (vo) vo.textContent = t.value;
    saveDraft(); apply();
  }
  function onDepthToggle(t) {
    var i = +t.dataset.depthOn, w = data.work[i]; if (!w) return;
    ensureDepth(w).on = t.checked;
    saveDraft(true); apply(true);
  }
  // Probe the cover's depth map (naming convention) and show it in the panel preview, else the placeholder.
  function depthPreviewLoad(panel) {
    var box = panel.querySelector("[data-depth-preview]"), mapDiv = panel.querySelector(".depthp__map");
    if (!box || !mapDiv || mapDiv.dataset.loaded) return;
    var src = mapDiv.dataset.depthSrc || "";
    if (!src) { box.classList.add("is-empty"); return; }
    var probe = new Image();
    probe.onload = function () { mapDiv.style.backgroundImage = "url('" + src + "')"; mapDiv.dataset.loaded = "1"; box.classList.remove("is-empty"); };
    probe.onerror = function () { box.classList.add("is-empty"); };
    probe.src = src;
  }

  // --- Piece 2b: generate a depth map on the owner's GPU (transformers.js Depth-Anything, WebGPU). ---
  // The model + lib load ONLY on click (lazy, then browser-cached) so the studio stays light otherwise.
  function ensureDepthLib() {
    if (ensureDepthLib._p) return ensureDepthLib._p;
    // esm.sh serves a proper ES module (the bare jsdelivr URL served CommonJS -> import() fails).
    var urls = ["https://esm.sh/@huggingface/transformers@3", "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm"];
    ensureDepthLib._p = (async function () {
      var lastErr;
      for (var k = 0; k < urls.length; k++) {
        try {
          var lib = await import(urls[k]);
          // transformers.js hardcodes jsdelivr for its ONNX-runtime WebGPU files
          // (ort-wasm-*.jsep.mjs); some networks can't reach jsdelivr, so point them at
          // unpkg, which serves the raw runtime files. numThreads=1: GitHub Pages isn't
          // cross-origin isolated, so SharedArrayBuffer (threads) is unavailable.
          try {
            var ver = (lib.env && lib.env.version) || "3.8.1";
            lib.env.backends.onnx.wasm.wasmPaths = "https://unpkg.com/@huggingface/transformers@" + ver + "/dist/";
            lib.env.backends.onnx.wasm.numThreads = 1;
          } catch (e2) {}
          return lib;
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error("could not load the depth library");
    })().catch(function (e) { ensureDepthLib._p = null; throw e; });
    return ensureDepthLib._p;
  }
  function getDepthPipe(t) {
    if (getDepthPipe._p) return getDepthPipe._p;
    var dev = (typeof navigator !== "undefined" && navigator.gpu) ? "webgpu" : "wasm";
    getDepthPipe._p = t.pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", { device: dev })
      .catch(function (e) { getDepthPipe._p = null; throw e; });
    return getDepthPipe._p;
  }
  function rawDepthToPng(raw, maxDim) {
    var w = raw.width, h = raw.height, ch = raw.channels || 1, dat = raw.data;
    var s = document.createElement("canvas"); s.width = w; s.height = h;
    var sc = s.getContext("2d"), id = sc.createImageData(w, h), px = id.data;
    for (var i = 0; i < w * h; i++) { var v = dat[i * ch]; px[i * 4] = v; px[i * 4 + 1] = v; px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
    sc.putImageData(id, 0, 0);
    var scale = Math.min(1, maxDim / Math.max(w, h));
    var dw = Math.max(1, Math.round(w * scale)), dh = Math.max(1, Math.round(h * scale));
    var d = document.createElement("canvas"); d.width = dw; d.height = dh;
    d.getContext("2d").drawImage(s, 0, 0, dw, dh);
    return d.toDataURL("image/png");
  }
  async function depthGenerate(idx, btn) {
    var w = data.work[idx]; if (!w || !w.image) { status("Add a cover image first."); return; }
    if (typeof navigator === "undefined" || !navigator.gpu) status("No WebGPU here - use Chrome or Edge for GPU speed; falling back to CPU (slower).");
    var lbl = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Loading model..."; }
    status("Loading the depth model (one-time ~40MB, then cached)...");
    try {
      var t = await ensureDepthLib();
      var pipe = await getDepthPipe(t);
      if (btn) btn.textContent = "Generating...";
      status("Generating depth on your GPU...");
      var out = await pipe(previewSrc(w.image));
      var raw = out && (out.depth || out);
      if (!raw || !raw.data) throw new Error("no depth output");
      var uri = rawDepthToPng(raw, 900);
      var panel = root.querySelector('[data-depth-panel="' + idx + '"]');
      if (panel) {
        var md = panel.querySelector(".depthp__map"); if (md) { md.dataset.depthSrc = uri; md.dataset.loaded = ""; }
        var cbx = panel.querySelector("[data-depth-on]"); if (cbx) cbx.checked = true;
        depthPreviewLoad(panel);
      }
      ensureDepth(w).on = true; ensureDepth(w).map = uri; saveDraft(true);
      hostUploaded(uri, { name: (w.id || "cover") + ".depth.png" }, function (path) { ensureDepth(w).map = path; saveDraft(true); apply(true); });
      status("Depth map generated. Hover the cover on the live site to see it.", true);
    } catch (e) {
      status("Depth generation failed: " + ((e && e.message) || e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = lbl; }
    }
  }

  // --- Piece 3: let AI look at the cover and suggest tasteful depth settings. ---
  function syncDepthPanel(panel, d) {
    if (!panel) return;
    var setR = function (field, val) {
      var inp = panel.querySelector('.depthp__range[data-depth-field="' + field + '"]');
      if (!inp) return;
      inp.value = val;
      var row = inp.closest(".depthp__row"), vo = row && row.querySelector(".depthp__val");
      if (vo) vo.textContent = inp.value;
    };
    setR("strength", d.strength); setR("zoom", d.zoom); setR("softness", d.softness); setR("focus", d.focus);
    var cbx = panel.querySelector("[data-depth-on]"); if (cbx) cbx.checked = d.on !== false;
  }
  async function depthSuggest(idx, btn) {
    var w = data.work[idx]; if (!w || !w.image) { status("Add a cover image first."); return; }
    var cfg = aiCfg("txt");
    if (!cfg || !cfg.key) { status("Add an AI provider key in the AI tab first - Suggest reads the cover with vision."); return; }
    var lbl = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Looking..."; }
    status("Looking at the cover to suggest depth settings...");
    try {
      var part = await imgToVisionPart(previewSrc(w.image));
      if (!part) throw new Error("couldn't read the cover image (vector/SVG isn't supported)");
      var models = await visionModels(cfg); if (!models.length) models = [cfg.model].filter(Boolean);
      if (!models.length) throw new Error("no vision-capable model available for this provider");
      var sys = "You tune a subtle cursor/tilt 'depth parallax' effect on a portfolio case-study COVER image. The effect displaces pixels by a depth map toward the pointer; too much warps the image. Judge the image and answer with STRICT JSON only.";
      var prompt = "Look at this case-study cover and recommend settings for a subtle depth-parallax effect. Return STRICT JSON with keys: suitable (true or false), strength (0.00 to 0.09), focus (0.0 to 1.0), zoom (1.00 to 1.15), subject (up to 6 words), reason (up to 14 words). Rules: set suitable=false for flat UI screenshots, text-heavy screens, diagrams or logos because depth would warp them, and then keep strength tiny. strength: a clear foreground vs background such as people, products or scenes with real depth = 0.03 to 0.05; mild or mixed = 0.02 to 0.03; flat <= 0.015. focus: the depth plane the MAIN SUBJECT sits on so it stays stable, where 0 is far background and 1 is near foreground, usually 0.35 to 0.6. zoom: the hover dolly-back from 1.03 to 1.10 where lower means more depth, about 1.05 by default and 1.03 only for strong depth. Be conservative and tasteful.";
      var r = null;
      for (var mi = 0; mi < models.length; mi++) {
        r = await aiVisionOnce(cfg, models[mi], sys, prompt, [part]);
        if (r && r.ok) break;
        if (!aiIsModelErr(r)) break;
      }
      if (!r || !r.ok) throw new Error((r && r.err) || "AI unavailable");
      var j = csgenParse(r.text) || {};
      var rnd = function (v, step, lo, hi, dflt) { v = parseFloat(v); if (isNaN(v)) v = dflt; v = Math.round(v / step) * step; return Math.max(lo, Math.min(hi, +v.toFixed(4))); };
      var d = ensureDepth(w);
      var st = rnd(j.strength, 0.002, 0, 0.09, 0.03);
      var fo = rnd(j.focus, 0.02, 0, 1, 0.5);
      var zo = rnd(j.zoom, 0.005, 1, 1.3, 1.05);
      d.strength = st; d.focus = fo; d.zoom = zo;
      if (j.suitable === false) {
        status("AI: this cover looks flat - " + (j.reason || "depth may warp it") + ". Applied a gentle setting; consider turning 3D off for it.", true);
      } else {
        d.on = true;
        status("Suggested - strength " + st.toFixed(3) + ", focus " + fo.toFixed(2) + ", pull-back " + zo.toFixed(2) + (j.subject ? " (" + j.subject + ")" : ""), true);
      }
      var panel = root.querySelector('[data-depth-panel="' + idx + '"]');
      if (panel) syncDepthPanel(panel, depthOf(w));
      saveDraft(true); apply(true);
    } catch (e) {
      status("Suggest failed: " + ((e && e.message) || e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = lbl; }
    }
  }

  function onParxInput(t) {
    const i = +t.dataset.parx, w = data.work[i];
    if (!w) return;
    const amt = Math.max(0, Math.min(100, parseInt(t.value, 10) || 0));
    w.parAmt = amt;
    if (w.parDir !== "up" && w.parDir !== "down") w.parDir = "up";
    const box = root && root.querySelector('[data-parxnum="' + i + '"]');
    if (box) box.value = amt;
    parxSetFill(t, amt);
    parxDemoUpdate();   // live feedback on the cover preview
    saveDraft();        // debounced persist (the homepage effect shows on the live site / on scroll)
  }

  // The numeric field mirrors the slider (two-way) so a value can be read, copied and pasted across cases.
  function onParxNum(t) {
    const i = +t.dataset.parxnum, w = data.work[i];
    if (!w) return;
    let amt = parseInt(t.value, 10);
    if (isNaN(amt)) amt = 0;
    amt = Math.max(0, Math.min(100, amt));
    w.parAmt = amt;
    if (w.parDir !== "up" && w.parDir !== "down") w.parDir = "up";
    const rng = root && root.querySelector('[data-parx="' + i + '"]');
    if (rng) { rng.value = amt; parxSetFill(rng, amt); }
    parxDemoUpdate();
    saveDraft();
  }

  // Live demo: the cover-image preview parallaxes as the editor scrolls, using the same math as
  // the site, so the direction + intensity can be felt right here without publishing.
  function parxSetFill(el, amt) { if (el) el.style.setProperty("--fill", Math.max(0, Math.min(100, amt)) + "%"); }
  let parxRaf = 0;
  function parxScheduleDemo() { if (parxRaf) return; parxRaf = requestAnimationFrame(function () { parxRaf = 0; parxDemoUpdate(); }); }
  function parxDemoUpdate() {
    const el = root && root.querySelector(".imgblk__preview--parx");
    if (!el) return;
    const img = el.querySelector("img");
    if (!img) return;
    const w = data.work[+el.dataset.parxPrev];
    if (!w) { img.style.transform = ""; return; }
    const set = w.parAmt != null && w.parAmt !== "";
    const amt = set ? Math.max(0, Math.min(100, +w.parAmt || 0)) : 50;
    if (amt <= 0) { img.style.transform = "translateY(0)"; return; }
    const sign = w.parDir === "down" ? -1 : 1;
    const factor = sign * (amt / 100) * 0.24;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    const tt = (r.top + r.height / 2 - vh / 2) / vh;
    let yv = tt * r.height * factor;
    const max = r.height * (0.03 + (amt / 100) * 0.10);
    if (yv > max) yv = max; else if (yv < -max) yv = -max;
    img.style.transform = "translateY(" + yv.toFixed(1) + "px)";
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
  var AVATAR_PLACEHOLDER_SVG = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" style="opacity:.4"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-6.5 8-6.5s8 2.1 8 6.5"/></svg>';
  function avatarBlock() {
    const url = (data.contact && data.contact.avatar) || "";
    const has = !!url;
    return '<div class="imgblk"><div class="af__label">Display picture</div>' +
      '<div class="af__hint" style="margin-bottom:.6rem">Your photo \u2014 shown on the admin sign-in card. A square image works best.</div>' +
      '<div style="display:flex;align-items:center;gap:14px">' +
        '<div style="width:64px;height:64px;border-radius:50%;overflow:hidden;flex:0 0 64px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center">' + (has ? '<img src="' + escAttr(previewSrc(url)) + '" alt="" style="width:100%;height:100%;object-fit:cover" />' : AVATAR_PLACEHOLDER_SVG) + '</div>' +
        '<div class="imgblk__row" style="margin:0"><button class="btn btn--ghost" data-act="avatar-upload">' + (has ? "Replace\u2026" : "Upload photo\u2026") + '</button>' + (has ? '<button class="btn btn--ghost" data-act="avatar-clear">Remove</button>' : "") + "</div>" +
      "</div></div>";
  }
  // ---- Site icon / logo (favicon + header brand mark; a monochrome SVG adapts to light/dark) ----
  function svgSanitizeIcon(s) {
    return String(s || "")
      .replace(/<\?xml[\s\S]*?\?>/gi, "")
      .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
      .replace(/(?:href|xlink:href)\s*=\s*(["'])\s*(?:javascript:|data:text\/html)[^"']*\1/gi, "")
      .trim();
  }
  function svgIsMono(s) {
    s = String(s || "");
    if (/<(?:linear|radial)Gradient|url\(\s*#/i.test(s)) return false;
    var colors = {}, re = /(?:fill|stroke)\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)/g, m;
    while ((m = re.exec(s))) {
      var c = m[1].toLowerCase();
      if (c === "none" || c === "transparent" || c === "currentcolor" || c === "inherit" || c === "context-fill" || c === "context-stroke") continue;
      colors[c] = 1;
    }
    return Object.keys(colors).length <= 1;
  }
  function svgAspectIcon(s) {
    var vb = /viewBox\s*=\s*["']\s*[\d.eE+-]+[\s,]+[\d.eE+-]+[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)/i.exec(s || "");
    if (vb) { var w = parseFloat(vb[1]), h = parseFloat(vb[2]); if (w > 0 && h > 0) return w / h; }
    return 1;
  }
  function pickIcon() {
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/svg+xml,image/png,image/jpeg,.svg,.png,.jpg,.jpeg";
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var isSvg = /svg/i.test(f.type) || /\.svg$/i.test(f.name);
      if (isSvg) {
        var rd = new FileReader();
        rd.onload = function () {
          var svg = svgSanitizeIcon(rd.result);
          if (!/<svg[\s>]/i.test(svg)) { status("That file doesn't look like an SVG."); return; }
          var mono = svgIsMono(svg);
          data.landing = data.landing || {};
          data.landing.siteIcon = { svg: svg, mono: mono };
          saveDraft(true); apply(true); renderBody();
          status(mono ? "Logo added - monochrome SVG, so it adapts to light and dark automatically." : "Logo added - multi-colour SVG, used as-is.", true);
        };
        rd.readAsText(f);
      } else if (/^image\/(png|jpe?g)$/i.test(f.type) || /\.(png|jpe?g)$/i.test(f.name)) {
        fileToDataUri(f).then(function (uri) {
          data.landing = data.landing || {};
          data.landing.siteIcon = { src: uri, mono: false };
          saveDraft(true); apply(true); renderBody();
          hostUploaded(uri, f, function (path) { if (data.landing && data.landing.siteIcon) { data.landing.siteIcon.src = path; saveDraft(true); apply(true); } });
          status("Logo added - image used as-is (no light/dark switching).", true);
        });
      } else { status("Use an SVG, PNG or JPEG."); }
    };
    inp.click();
  }
  function siteIconBlock() {
    var ic = (data.landing && data.landing.siteIcon) || null;
    var has = !!(ic && (ic.svg || ic.src));
    var isSvg = !!(ic && ic.svg);
    var mono = !!(ic && ic.mono && isSvg);
    var url = has ? (isSvg ? ("data:image/svg+xml," + encodeURIComponent(ic.svg).replace(/'/g, "%27")) : previewSrc(ic.src)) : "";
    var inner;
    if (!has) inner = '<span style="font-family:var(--serif);font-size:1.15rem;color:var(--text-dim)">RK</span>';
    else if (mono) inner = '<span style="height:26px;aspect-ratio:' + svgAspectIcon(ic.svg).toFixed(3) + ';background:currentColor;-webkit-mask:url(\'' + url + '\') center/contain no-repeat;mask:url(\'' + url + '\') center/contain no-repeat;display:block"></span>';
    else inner = '<img src="' + escAttr(url) + '" alt="" style="max-width:100%;max-height:100%;object-fit:contain" />';
    var toggle = isSvg
      ? '<label class="chk" style="margin-top:.7rem;display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.9rem"><input type="checkbox" data-act="siteicon-mono"' + (mono ? " checked" : "") + ' /> <span>Adapt to light &amp; dark (treat as monochrome)</span></label>' +
        '<div class="af__hint">' + (svgIsMono(ic.svg) ? "Auto-detected as monochrome." : "This SVG looks multi-colour - turning this on flattens it to one colour.") + '</div>'
      : "";
    return '<div class="imgblk"><div class="af__label">Site icon / logo</div>' +
      '<div class="af__hint" style="margin-bottom:.6rem">Shown as the header brand mark (replacing the &ldquo;RK&rdquo; monogram) and the browser-tab favicon. SVG, PNG or JPEG. A <strong>monochrome SVG</strong> auto-switches colour for light &amp; dark; a multi-colour SVG or a PNG/JPEG is used exactly as uploaded. No logo keeps the RK initials.</div>' +
      '<div style="display:flex;align-items:center;gap:14px">' +
        '<div style="width:72px;height:46px;border-radius:8px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;overflow:hidden;color:var(--text)">' + inner + '</div>' +
        '<div class="imgblk__row" style="margin:0"><button class="btn btn--ghost" data-act="siteicon-upload">' + (has ? "Replace..." : "Upload logo...") + '</button>' + (has ? '<button class="btn btn--ghost" data-act="siteicon-clear">Remove</button>' : "") + "</div>" +
      "</div>" + toggle + "</div>";
  }
  function atsPanelHtml(has) {
    var lvls = IPREP_LEVELS.map(function (l) {
      return '<button type="button" class="ats__lvl' + (atsLevel === l[0] ? " is-on" : "") + '" data-act="ats-level" data-lvl="' + l[0] + '"><b>' + l[1] + "</b><span>" + l[2] + "</span></button>";
    }).join("");
    return '<div class="ats">' +
      '<div class="ats__head"><span class="ats__badge">ATS</span><div><b>ATS r\u00e9sum\u00e9 check</b><span>Is your r\u00e9sum\u00e9 parseable and tuned for the level you\u2019re targeting?</span></div></div>' +
      '<div class="ats__levels">' + lvls + "</div>" +
      '<div class="imgblk__row"><button class="btn btn--primary" data-act="ats-check"' + (has ? "" : " disabled") + ">Check ATS rating</button>" +
      '<label class="btn btn--ghost ats__file">Check a different file\u2026<input type="file" accept=".pdf,.docx,.txt,.md" data-ats-file hidden></label></div>' +
      (has ? "" : '<div class="af__hint">Add your r\u00e9sum\u00e9 above (or pick a file) to run the check.</div>') +
      '<div class="ats__out" data-ats-out></div>' +
      "</div>";
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
      case "workflow": return { type: "workflow", nav: "", kicker: "", heading: "", flow: "linear", caption: "", items: [] };
      case "media": return { type: "media", nav: "", kicker: "", heading: "", items: [] };
      case "split": return { type: "split", nav: "", kicker: "", heading: "", leftLabel: "Before", left: [], leftImg: "", rightLabel: "After", right: [], rightImg: "" };
      case "faq": return { type: "faq", nav: "", kicker: "", items: [] };
      case "cards": return { type: "cards", nav: "", kicker: "", heading: "", items: [] };
      case "gallery": return { type: "gallery", nav: "", kicker: "", heading: "", items: [] };
      case "mediagrid": return { type: "mediagrid", nav: "", kicker: "", heading: "", gridLayout: "uniform", items: [] };
      case "device": return { type: "device", nav: "", kicker: "", heading: "", device: "phone", preset: "iphone", fill: "", items: [] };
      case "isolayers": return { type: "isolayers", nav: "", kicker: "", heading: "", mode: "stack", dir: "topR", distance: "40", depth: "14", parallax: false, transparency: "", items: [] };
      case "figure": return { type: "figure", nav: "", kicker: "", heading: "", body: "", src: "", caption: "", flip: false };
      case "columns": return { type: "columns", nav: "", kicker: "", heading: "", items: [] };
      case "rows": return { type: "rows", nav: "", kicker: "", heading: "", items: [] };
      case "compare": return { type: "compare", nav: "", kicker: "", heading: "", beforeSrc: "", afterSrc: "", beforeLabel: "Before", afterLabel: "After", body: "" };
      case "stickies": return { type: "stickies", nav: "", kicker: "", heading: "", stickySize: "natural", items: [] };
      case "voices": return { type: "voices", nav: "", kicker: "", heading: "", mode: "verbatim", vsize: "", items: [] };
      case "focus": return { type: "focus", nav: "", kicker: "", heading: "", src: "", caption: "", sticky: false, annotations: [] };
      case "gen": return { type: "gen", name: "", nav: "", kicker: "", heading: "", spec: (window.RKGen ? window.RKGen.blankSpec() : { version: 1, root: { type: "stack", props: {}, children: [] } }) };
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
      if (type === "workflow") return { label: p[0], note: p[1] };
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
      if (type === "workflow") return (it.label || "") + " | " + (it.note || "");
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

  function hsizeGlyph(v) { return '<span class="hsize__h hsize__h--' + (v === "sm" ? "sm" : v === "lg" ? "lg" : "std") + '">H</span>'; }
  function hsizeSel(i, j, b) {
    var cur = b.hsize === "sm" ? "sm" : b.hsize === "lg" ? "lg" : "";
    var curName = ({ "": "Standard", "sm": "Compact", "lg": "Large" })[cur];
    var opts = [["sm", "Compact"], ["", "Standard"], ["lg", "Large"]].map(function (o) {
      return '<button type="button" class="hsize__opt' + (cur === o[0] ? " is-sel" : "") + '" data-act="hsize-set" data-index="' + i + '" data-bindex="' + j + '" data-hsize="' + o[0] + '">' + hsizeGlyph(o[0]) + '<span class="hsize__lbl">' + o[1] + "</span></button>";
    }).join("");
    return '<div class="hsize" title="Heading size">' +
      '<button type="button" class="hsize__cur" data-act="hsize-toggle" data-index="' + i + '" data-bindex="' + j + '" aria-label="Heading size: ' + curName + '">' + hsizeGlyph(cur) + '<svg class="hsize__chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<div class="hsize__pop">' + opts + "</div>" +
    "</div>";
  }
  function sfInput(i, j, field, label, hint) {
    var b = data.work[i].study.blocks[j];
    var input = '<input type="text" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="' + field + '" value="' + escAttr(b[field] || "") + '" />';
    var control = (field === "heading") ? '<div class="af__headrow">' + input + hsizeSel(i, j, b) + "</div>" : input;
    return '<div class="af"><label class="af__label">' + label + '</label>' + control + (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
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
      t("dim", "\u25D0", "Tone \u2014 mute the selected text to grey (tap again to brighten)") +
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
    var html = isRtHtml(v) ? v : v.split(/\n\n+/).map(function (p) { return "<p>" + rtInlineMd(escForRt(p)).replace(/\n/g, "<br>") + "</p>"; }).join("");
    return rtHostImgsForEdit(html);
  }
  // In the editor, hosted /assets/uploads images must display via a URL that works locally
  // (in-memory bytes or the raw GitHub URL) — the bare path 404s on the dev server and collapses
  // to a thin line. Keep the canonical path in data-src so serialize restores the lean path.
  function rtHostImgsForEdit(html) {
    if (!html || html.indexOf("assets/uploads/") === -1 || typeof document === "undefined") return html;
    try {
      var tmp = document.createElement("div");
      tmp.innerHTML = html;
      tmp.querySelectorAll("img").forEach(function (im) {
        var s = im.getAttribute("src") || "";
        if (isHostedPath(s) && !im.getAttribute("data-src")) { im.setAttribute("data-src", s); im.setAttribute("src", previewSrc(s)); }
      });
      return tmp.innerHTML;
    } catch (e) { return html; }
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
    var clone = area.cloneNode(true);
    clone.querySelectorAll(".rt__rz").forEach(function (h) { h.remove(); });
    clone.querySelectorAll(".rt__fig.is-imgsel").forEach(function (f) { f.classList.remove("is-imgsel"); });
    clone.querySelectorAll("img[data-src]").forEach(function (im) { im.setAttribute("src", im.getAttribute("data-src")); im.removeAttribute("data-src"); });
    var html = rtClean(clone.innerHTML).trim();
    if (/^(\s|<br\s*\/?>|<p>(\s|<br\s*\/?>)*<\/p>|<div>(\s|<br\s*\/?>)*<\/div>)*$/i.test(html)) html = "";
    if (area.dataset.rtjrn !== undefined) {
      var jc = +area.dataset.jc, je = +area.dataset.je;
      var jd = data.journey && data.journey.chapters && data.journey.chapters[jc];
      var jent = jd && jd.entries && jd.entries[je];
      if (jent) { jent[area.dataset.rtjrn] = html; saveDraft(); refreshJourneyPreview(); }
      return;
    }
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
      // pickImage calls back TWICE (instant data-URI, then the hosted path) — insert once, then swap.
      // For the hosted path, display via previewSrc (works locally) and keep the canonical path in data-src.
      var imgFig = null;
      pickImage(function (uri) {
        var hosted = isHostedPath(uri);
        if (imgFig && area.contains(imgFig)) {
          var im = imgFig.querySelector("img");
          if (im) { if (hosted) { im.setAttribute("data-src", uri); im.setAttribute("src", previewSrc(uri)); } else im.setAttribute("src", uri); }
        } else {
          var srcAttr = hosted ? ('data-src="' + escAttr(uri) + '" src="' + escAttr(previewSrc(uri)) + '"') : ('src="' + escAttr(uri) + '"');
          area.insertAdjacentHTML("beforeend", '<figure class="rt__fig"><img ' + srcAttr + ' alt="" /></figure><p><br></p>');
          var figs = area.querySelectorAll("figure.rt__fig");
          imgFig = figs[figs.length - 1] || null;
        }
        rtSerialize(area);
      });
      return;
    }
    if (cmd === "dim") { rtToggleDim(area); return; }
    try { document.execCommand(cmd, false, null); } catch (e) {}
    rtSerialize(area);
  }
  // Tone: mute the selected body text to grey by wrapping it in <span class="tdim">,
  // or brighten it (back to the default) if the selection is already muted. Uses
  // insertHTML so both directions are natively undoable (Ctrl+Z / Undo button).
  function rtToggleDim(area) {
    area.focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    if (!area.contains(sel.anchorNode) || !area.contains(sel.focusNode)) return;
    var anchorEl = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    var existing = anchorEl && anchorEl.closest ? anchorEl.closest(".tdim") : null;
    if (existing && area.contains(existing)) {
      var r = document.createRange();
      r.selectNode(existing);
      sel.removeAllRanges(); sel.addRange(r);
      try { document.execCommand("insertHTML", false, existing.innerHTML || ""); }
      catch (e) { var host = existing.parentNode; while (existing.firstChild) host.insertBefore(existing.firstChild, existing); host.removeChild(existing); host.normalize(); }
      rtSerialize(area);
      status("Text brightened.");
      return;
    }
    var range = sel.getRangeAt(0);
    if (range.collapsed) { status("Select some body text first, then tap the tone button."); return; }
    var tmp = document.createElement("div");
    tmp.appendChild(range.cloneContents());
    tmp.querySelectorAll(".tdim").forEach(function (n) { var p = n.parentNode; while (n.firstChild) p.insertBefore(n.firstChild, n); p.removeChild(n); });
    var inner = rtClean(tmp.innerHTML);
    try { document.execCommand("insertHTML", false, '<span class="tdim">' + inner + "</span>"); }
    catch (e) {
      var span = document.createElement("span"); span.className = "tdim";
      try { range.surroundContents(span); } catch (e2) { span.appendChild(range.extractContents()); range.insertNode(span); }
    }
    rtSerialize(area);
    status("Text muted to grey.");
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
  // A CTA mid-AI-work: show a spinner (.is-busy) + optional label; btnIdle restores it.
  function btnBusy(btn, label) {
    if (!btn) return "";
    var prev = btn.innerHTML;
    btn.disabled = true; btn.classList.add("is-busy");
    if (label != null) btn.textContent = label;
    return prev;
  }
  function btnIdle(btn, label) {
    if (!btn) return;
    btn.disabled = false; btn.classList.remove("is-busy");
    if (label != null) { if (String(label).indexOf("<") !== -1) btn.innerHTML = label; else btn.textContent = label; }
  }

  /* ---------- Résumé Autofill extension: build a .zip in the browser (STORED entries, no deps) ---------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function buildExtensionZip() {
    const base = location.origin + "/extension/";
    const local = [], central = [];
    const w16 = (a, n) => a.push(n & 255, (n >>> 8) & 255);
    const w32 = (a, n) => a.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
    const wStr = (a, s) => { for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 255); };
    const wBytes = (a, u8) => { for (let i = 0; i < u8.length; i++) a.push(u8[i]); };
    for (let f = 0; f < EXT_FILES.length; f++) {
      const res = await fetch(base + EXT_FILES[f], { cache: "no-store" });
      if (!res.ok) throw new Error("Couldn\u2019t read " + EXT_FILES[f] + " (" + res.status + ")");
      const bytes = new Uint8Array(await res.arrayBuffer());
      const name = "resume-autofill/" + EXT_FILES[f];
      const crc = crc32(bytes), off = local.length;
      w32(local, 0x04034b50); w16(local, 20); w16(local, 0x0800); w16(local, 0); w16(local, 0); w16(local, 0);
      w32(local, crc); w32(local, bytes.length); w32(local, bytes.length);
      w16(local, name.length); w16(local, 0); wStr(local, name); wBytes(local, bytes);
      central.push({ name: name, crc: crc, size: bytes.length, off: off });
    }
    const cd = [], cdStart = local.length;
    central.forEach((c) => {
      w32(cd, 0x02014b50); w16(cd, 20); w16(cd, 20); w16(cd, 0x0800); w16(cd, 0); w16(cd, 0); w16(cd, 0);
      w32(cd, c.crc); w32(cd, c.size); w32(cd, c.size);
      w16(cd, c.name.length); w16(cd, 0); w16(cd, 0); w16(cd, 0); w16(cd, 0); w32(cd, 0); w32(cd, c.off);
      wStr(cd, c.name);
    });
    const eo = [];
    w32(eo, 0x06054b50); w16(eo, 0); w16(eo, 0); w16(eo, central.length); w16(eo, central.length);
    w32(eo, cd.length); w32(eo, cdStart); w16(eo, 0);
    return new Blob([new Uint8Array(local.concat(cd).concat(eo))], { type: "application/zip" });
  }
  async function extDownload(btn) {
    const was = btnBusy(btn, "Packaging\u2026");
    try {
      const blob = await buildExtensionZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "resume-autofill.zip";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      status("Extension downloaded \u2014 unzip it, then load the folder in edge://extensions.", true);
    } catch (e) {
      status("Download failed: " + (e && e.message || e));
    } finally {
      btnIdle(btn, was);
    }
  }

  /* ---------- One-page résumé PDF (vector, clickable case-study links + QR) ---------- */
  var RPDF_NL = String.fromCharCode(10);
  function rpdfPlain(s) {
    s = String(s == null ? "" : s);
    s = s.split("[[").join("").split("]]").join("");
    s = s.split("**").join("").split("*").join("");
    s = s.split(RPDF_NL).join(" ");
    s = s.split(String.fromCharCode(0x2014)).join("-").split(String.fromCharCode(0x2013)).join("-");
    s = s.split(String.fromCharCode(0x2192)).join(">");
    while (s.indexOf("  ") !== -1) s = s.split("  ").join(" ");
    return s.trim();
  }
  function rpdfNoProto(u) { return String(u || "").split("https://").join("").split("http://").join(""); }
  function ensureJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (ensureJsPdf._p) return ensureJsPdf._p;
    ensureJsPdf._p = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = function () { (window.jspdf && window.jspdf.jsPDF) ? resolve(window.jspdf.jsPDF) : reject(new Error("The PDF engine didn\u2019t initialise.")); };
      s.onerror = function () { ensureJsPdf._p = null; reject(new Error("Couldn\u2019t load the PDF engine.")); };
      document.head.appendChild(s);
    });
    return ensureJsPdf._p;
  }
  function ensureQrLib() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (ensureQrLib._p) return ensureQrLib._p;
    ensureQrLib._p = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
      s.onload = function () { resolve(window.qrcode || null); };
      s.onerror = function () { ensureQrLib._p = null; resolve(null); };
      document.head.appendChild(s);
    });
    return ensureQrLib._p;
  }
  // Render a QR to riteshk.work/inbox so the owner can open the requests inbox on their phone. No token
  // is minted: enrolment is studio-only (Passkeys menu + the browser's cross-device flow) \u2014 the phone
  // only VERIFIES an existing passkey, so an inbox link alone can never grant anyone access.
  async function phoneQr(btn) {
    var box = document.querySelector("[data-phoneqr]");
    if (!box) return;
    var label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "\u2026"; }
    box.innerHTML = '<div class="af__hint">Preparing the QR\u2026</div>';
    try {
      var url = LIVE_ORIGIN.replace(/\/+$/, "") + "/inbox/";
      var qrcode = await ensureQrLib();
      var img = "";
      if (qrcode) { try { var qr = qrcode(0, "M"); qr.addData(url); qr.make(); img = qr.createDataURL(6, 4); } catch (e) {} }
      box.innerHTML =
        (img ? '<div style="background:#fff;border-radius:14px;padding:14px;display:inline-block"><img src="' + img + '" alt="Inbox QR" style="display:block;width:220px;height:220px;image-rendering:pixelated"></div>' : "") +
        '<div class="af__hint" style="margin-top:12px">Scan to open the requests inbox on your phone, then verify with your passkey. Add this phone as a passkey first via <b>\u22EF \u2192 Passkeys</b> above.</div>' +
        '<div class="af__hint" style="opacity:.65;word-break:break-all">Or open on the phone: ' + escHtml(url) + "</div>";
    } catch (e) {
      box.innerHTML = '<div class="af__hint">Couldn\u2019t build the QR. Try again.</div>';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }
  function rpdfDrawQr(doc, qrcode, url, x, y, size) {
    if (!qrcode) return false;
    try {
      var qr = qrcode(0, "M"); qr.addData(url); qr.make();
      var n = qr.getModuleCount(), cell = size / n;
      doc.setFillColor(28, 26, 23);
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) doc.rect(x + c * cell, y + r * cell, cell + 0.05, cell + 0.05, "F");
      return true;
    } catch (e) { return false; }
  }
  async function resumePdfBuild() {
    var jsPDF = await ensureJsPdf();
    var qrcode = await ensureQrLib();
    var d = data, c = d.contact || {}, L = d.landing || {};
    var SITE = LIVE_ORIGIN;
    var work = (d.work || []).filter(function (w) { return w && !w.hidden && !w.encWork; }).slice(0, 4);
    var highs = (d.highlights || []).slice(0, 6);
    var caps = d.capabilities || [], path = d.path || [], rec = d.recognition || [], edu = d.education || [];

    var doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    var PW = 210, PH = 297, M = 14, CW = PW - M * 2;
    var INK = [28, 26, 23], MUT = [101, 92, 83], FAINT = [154, 147, 138], ACC = [154, 106, 36], LINE = [225, 216, 205];
    var y = M;
    function ink() { doc.setTextColor(INK[0], INK[1], INK[2]); }
    function mut() { doc.setTextColor(MUT[0], MUT[1], MUT[2]); }
    function faint() { doc.setTextColor(FAINT[0], FAINT[1], FAINT[2]); }
    function acc() { doc.setTextColor(ACC[0], ACC[1], ACC[2]); }
    function rule(yy, x1, x2) { doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2); doc.line(x1 == null ? M : x1, yy, x2 == null ? PW - M : x2, yy); }
    function need(h) { if (y + h > PH - M - 4) { doc.addPage(); y = M; } }
    function pdfSec(t) { need(12); acc(); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setCharSpace(0.5); doc.text(t.toUpperCase(), M, y); doc.setCharSpace(0); y += 2; rule(y); y += 4.2; }

    ink(); doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("Ritesh Kumar", M, y + 6);
    var eyebrow = rpdfPlain(L.eyebrow || "Product Design"); if (L.domains) eyebrow += " \u00b7 " + rpdfPlain(L.domains);
    acc(); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setCharSpace(0.4); doc.text(eyebrow.toUpperCase(), M, y + 11); doc.setCharSpace(0);
    if (L.presence) { mut(); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(rpdfPlain(L.presence), M, y + 15.5); }
    var cy = y + 1.5, rx = PW - M; doc.setFontSize(9);
    function rlink(txt, url) { ink(); doc.setFont("helvetica", "normal"); var w = doc.getTextWidth(txt); doc.textWithLink(txt, rx - w, cy, { url: url }); cy += 4.4; }
    if (c.email) rlink(c.email, "mailto:" + c.email);
    if (c.phone) rlink(rpdfPlain(c.phone), "tel:" + (c.phoneRaw || c.phone));
    if (c.linkedin) rlink("in/riteshkumarhk", c.linkedin);
    rlink(rpdfNoProto(SITE), SITE);
    y += 18; doc.setDrawColor(INK[0], INK[1], INK[2]); doc.setLineWidth(0.4); doc.line(M, y, PW - M, y); y += 6.5;

    ink(); doc.setFont("times", "italic"); doc.setFontSize(15);
    var stmtLines = doc.splitTextToSize(rpdfPlain(L.statement || ""), CW); doc.text(stmtLines, M, y); y += stmtLines.length * 6.2;
    if (L.intro) { y += 1; mut(); doc.setFont("helvetica", "normal"); doc.setFontSize(9); var il = doc.splitTextToSize(rpdfPlain(L.intro), CW); doc.text(il, M, y); y += il.length * 4.4; }
    y += 3.5;

    if (highs.length) {
      rule(y); y += 5; var mx = M;
      highs.forEach(function (h) {
        var v = rpdfPlain(h.value || ""), lb = rpdfPlain(h.label || "");
        doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); var vw = doc.getTextWidth(v);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); var lw = doc.getTextWidth(lb);
        var itemW = vw + 1.5 + lw + 7;
        if (mx + itemW > PW - M + 2) { mx = M; y += 6; }
        ink(); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.text(v, mx, y);
        mut(); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.text(lb, mx + vw + 1.5, y);
        mx += itemW;
      });
      y += 3.5; rule(y); y += 6.5;
    }

    if (work.length) {
      pdfSec("Selected work");
      work.forEach(function (w, wi) {
        var url = SITE + "/work/" + w.id;
        var one = rpdfPlain((w.study && w.study.tagline) || w.desc || "");
        var qrSize = 21, textW = CW - qrSize - 6;
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); var tagLines = doc.splitTextToSize(one, textW);
        var textH = 4 + (w.client ? 3.8 : 0) + 4.5 + tagLines.length * 4 + 5;
        var blockH = Math.max(qrSize, textH) + 4; need(blockH);
        var top = y, qx = PW - M - qrSize;
        rpdfDrawQr(doc, qrcode, url, qx, top, qrSize);
        ink(); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(rpdfPlain(w.title || ""), M, top + 3.5);
        var ty = top + 3.5;
        if (w.client) { ty += 4; faint(); doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setCharSpace(0.3); doc.text(rpdfPlain(w.client).toUpperCase(), M, ty); doc.setCharSpace(0); }
        ty += 4.5; mut(); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(tagLines, M, ty); ty += tagLines.length * 4 + 1;
        acc(); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.textWithLink("View the live case study", M, ty + 1.5, { url: url });
        y = Math.max(top + qrSize, ty + 1.5) + 5;
        if (wi < work.length - 1) rule(y - 2.5);
      });
      y += 2.5;
    }

    if (path.length) {
      pdfSec("Experience");
      path.forEach(function (p) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); var dLines = p.desc ? doc.splitTextToSize(rpdfPlain(p.desc), CW) : [];
        need(4 + 4 + (p.org ? 3.8 : 0) + dLines.length * 4 + 4);
        faint(); doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setCharSpace(0.3); doc.text(rpdfPlain(p.years || "").toUpperCase(), M, y); doc.setCharSpace(0);
        y += 4; ink(); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.text(rpdfPlain(p.role || ""), M, y);
        if (p.org) { y += 3.8; acc(); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(rpdfPlain(p.org), M, y); }
        if (dLines.length) { y += 4; mut(); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.text(dLines, M, y); y += dLines.length * 4; }
        y += 4;
      });
      y += 1;
    }

    if (caps.length) {
      pdfSec("Capabilities");
      mut(); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
      var capStr = caps.map(function (x) { return rpdfPlain(x); }).join("   \u00b7   ");
      var cl = doc.splitTextToSize(capStr, CW); need(cl.length * 4.4 + 4); doc.text(cl, M, y); y += cl.length * 4.4 + 5;
    }

    function liList(title, arr) {
      if (!arr.length) return;
      pdfSec(title);
      arr.forEach(function (r) {
        need(5.2);
        ink(); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.text(rpdfPlain(r.title || ""), M, y);
        var meta = rpdfPlain(r.meta || "");
        if (meta) { faint(); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); var mw = doc.getTextWidth(meta); doc.text(meta, PW - M - mw, y); }
        y += 4.6;
      });
      y += 2.5;
    }
    liList("Recognition", rec);
    liList("Education", edu);

    var pages = doc.getNumberOfPages();
    for (var pi = 1; pi <= pages; pi++) {
      doc.setPage(pi);
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2); doc.line(M, PH - 10, PW - M, PH - 10);
      faint(); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
      doc.text("Scan a code or tap a link to open the live, interactive case study.", M, PH - 6.2);
      var sw = doc.getTextWidth(rpdfNoProto(SITE)); doc.text(rpdfNoProto(SITE), PW - M - sw, PH - 6.2);
    }
    return doc;
  }
  async function resumePdfDownload(btn) {
    var was = btnBusy(btn, "Building PDF\u2026");
    try {
      var doc = await resumePdfBuild();
      doc.save("Ritesh-Kumar-Portfolio.pdf");
      status("PDF downloaded \u2014 with clickable, live case-study links.", true);
    } catch (e) {
      status("PDF failed: " + (e && e.message || e));
    } finally {
      btnIdle(btn, was);
    }
  }

  /* ---------- ATS résumé check (Contact tab, beside the résumé upload) ---------- */
  var atsLevel = "staff";
  function atsLevelName(l) { return ({ senior: "Senior", staff: "Principal / Staff", leader: "Design leadership" })[l] || l; }
  async function resumeToFile(url) {
    var p = parseDataUri(url);
    if (p) {
      var bytes = p.base64 ? b64ToBytes(p.data) : new TextEncoder().encode(decodeURIComponent(p.data));
      return new File([bytes], "resume." + extForMime(p.mime), { type: p.mime });
    }
    var src = isHostedPath(url) ? (hostedBytes[url] || rawUrlFor(url)) : url;
    var pd = parseDataUri(src);
    if (pd) { var b = pd.base64 ? b64ToBytes(pd.data) : new TextEncoder().encode(decodeURIComponent(pd.data)); return new File([b], "resume." + extForMime(pd.mime), { type: pd.mime }); }
    var res = await fetch(src, { cache: "no-store" });
    if (!res.ok) throw new Error("Couldn\u2019t fetch the r\u00e9sum\u00e9 (" + res.status + ").");
    var blob = await res.blob();
    var clean = String(url).split("?")[0].split("#")[0];
    var dot = clean.lastIndexOf("."), ext = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
    if (!ext || ext.length > 5) ext = extForMime(blob.type) || "pdf";
    var mime = ext === "pdf" ? "application/pdf" : (blob.type || "application/octet-stream");
    return new File([blob], "resume." + ext, { type: mime });
  }
  async function atsResumeText(file) {
    if (file) return await fbExtractFile(file);
    var url = (data.contact && data.contact.resume) || "";
    if (!url) throw new Error("Add your r\u00e9sum\u00e9 above first \u2014 upload a PDF or paste its URL.");
    return await fbExtractFile(await resumeToFile(url));
  }
  function atsSystem(level) {
    var lvl = {
      senior: "TARGET LEVEL: Senior Product Designer. Weight craft, execution quality, shipped outcomes and clear ownership; expect concrete UX/interaction work with impact metrics.",
      staff: "TARGET LEVEL: Staff / Principal Product Designer. Weight scope, ambiguity, systems thinking, cross-team influence, strategy and leverage over hands-on pixels; expect evidence of driving direction across teams.",
      leader: "TARGET LEVEL: VP / Head of Design. Weight org building, team growth, design strategy, business outcomes, executive communication and vision \u2014 leadership scope over IC craft."
    }[level] || "";
    return [
      "You are an expert technical recruiter and resume ATS (Applicant Tracking System) analyst for product-design roles.",
      "You are given the EXTRACTED TEXT of a candidate's resume (already parsed from their file). Judge (a) how ATS-FRIENDLY / parseable it is and (b) how well it is optimised for the target level below.",
      lvl,
      "ATS signals to weigh: single-column reading order; standard section headings (Experience, Skills, Education); machine-readable text (garbled or near-empty text = image-based = fails); a clear contact block; reverse-chronological dated roles; quantified impact; relevant role & skill KEYWORDS for the level; standard fonts; sensible length; no reliance on tables/graphics/text-in-images/headers-footers; consistent date formats.",
      "Be honest, specific and actionable. Base everything ONLY on the provided text; never invent facts. If the text is sparse or garbled, say the file may not be ATS-parseable.",
      "Return ONLY valid JSON (no markdown) matching EXACTLY this shape:",
      '{"score":0,"band":"Strong|Good|Needs work|At risk","summary":"one honest sentence","checks":[{"label":"short label","status":"pass|warn|fail","note":"one line"}],"fixes":[{"priority":"high|med|low","point":"what to change","how":"a concrete rewrite or action","anchor":{"type":"quote|section|global","quote":"the EXACT text from the resume this refers to, copied verbatim (only when type=quote)","section":"the section heading it concerns, e.g. Experience (only when type=section)","replacement":"a ready-to-paste rewrite of the quoted text (optional)"}}],"keywords":{"present":["..."],"missing":["..."]}}',
      "score is 0-100 reflecting BOTH ATS parseability AND fit for the target level. Give 5-8 checks, 4-8 fixes ordered by priority, and level-appropriate missing keywords.",
      "For EACH fix, set anchor.type to one of: 'quote' when the fix is about a specific phrase or line — copy that phrase into anchor.quote EXACTLY as written above (verbatim, no paraphrase; a few words up to about one line) so it can be pinned on the page; 'section' when it concerns a whole section — put the section heading in anchor.section; 'global' for document-wide issues such as length, column/table layout, a missing section, overall tone, or keywords. Include anchor.replacement whenever you can give a concrete rewrite of the quoted text.",
      "Output ONE compact JSON object and nothing else. Do not wrap it in markdown fences, and do not put literal newlines inside any string value; keep every note and how on a single line."
    ].join("\n");
  }
  function atsUser(text, level) {
    return "TARGET LEVEL: " + atsLevelName(level) + "\n\nRESUME TEXT (extracted from the candidate's file):\n\n" + String(text).slice(0, 12000);
  }
  function atsRenderHtml(res, level, thin) {
    var score = Math.max(0, Math.min(100, Math.round(+res.score || 0)));
    var band = res.band || (score >= 80 ? "Strong" : score >= 65 ? "Good" : score >= 45 ? "Needs work" : "At risk");
    var tone = score >= 80 ? "good" : score >= 65 ? "ok" : score >= 45 ? "warn" : "bad";
    var checks = Array.isArray(res.checks) ? res.checks : [];
    var fixes = Array.isArray(res.fixes) ? res.fixes : [];
    var kw = res.keywords || {}, pres = (kw.present || []).filter(Boolean), miss = (kw.missing || []).filter(Boolean);
    var html = '<div class="ats__result">';
    if (thin) html += '<div class="ats__thin">\u26A0 Only a little text was extracted \u2014 if this PDF is image-based or heavily column/table-based, real ATS parsers may also struggle. A clean, text-based PDF scores best.</div>';
    html += '<div class="ats__score ats__score--' + tone + '"><div class="ats__ring" style="--p:' + score + '"><span>' + score + '</span></div>' +
      '<div class="ats__score-x"><b>' + escHtml(band) + '</b><span>ATS + ' + escHtml(atsLevelName(level)) + ' fit</span>' + (res.summary ? '<p>' + escHtml(res.summary) + '</p>' : '') + '</div></div>';
    if (fixes.length) html += '<div class="ats__viewrow"><button class="btn btn--primary" type="button" data-act="ats-view">Show fixes on your résumé →</button></div>';
    if (checks.length) html += '<div class="ats__checks">' + checks.map(function (c) {
      var s = c.status === "pass" ? "pass" : c.status === "fail" ? "fail" : "warn", ic = s === "pass" ? "\u2713" : s === "fail" ? "\u2715" : "!";
      return '<div class="ats__chk ats__chk--' + s + '"><span class="ats__chk-i">' + ic + '</span><div><b>' + escHtml(c.label || "") + '</b>' + (c.note ? '<span>' + escHtml(c.note) + '</span>' : '') + '</div></div>';
    }).join("") + '</div>';
    if (fixes.length) html += '<div class="ats__fixes"><div class="ats__sub">How to optimise for ' + escHtml(atsLevelName(level)) + '</div>' + fixes.map(function (f) {
      var pr = f.priority === "high" ? "high" : f.priority === "low" ? "low" : "med";
      return '<div class="ats__fix ats__fix--' + pr + '"><span class="ats__pri">' + pr + '</span><div><b>' + escHtml(f.point || "") + '</b>' + (f.how ? '<span>' + escHtml(f.how) + '</span>' : '') + '</div></div>';
    }).join("") + '</div>';
    if (pres.length || miss.length) {
      html += '<div class="ats__kw">';
      if (miss.length) html += '<div class="ats__kw-grp"><span class="ats__kw-lbl">Consider adding</span>' + miss.map(function (k) { return '<span class="ats__chip ats__chip--miss">' + escHtml(k) + '</span>'; }).join("") + '</div>';
      if (pres.length) html += '<div class="ats__kw-grp"><span class="ats__kw-lbl">Already covered</span>' + pres.map(function (k) { return '<span class="ats__chip">' + escHtml(k) + '</span>'; }).join("") + '</div>';
      html += '</div>';
    }
    html += '<div class="af__hint" style="margin-top:.7rem">An AI review of the extracted text \u2014 helpful guidance, not a guaranteed ATS pass. Re-run after edits.</div></div>';
    return html;
  }
  async function atsRun(panel, file) {
    if (!panel) return;
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { atsRun(panel, file); }); return; }
    var out = panel.querySelector("[data-ats-out]");
    var btn = panel.querySelector('[data-act="ats-check"]');
    var was = btnBusy(btn, "Checking\u2026");
    if (out) out.innerHTML = '<div class="ats__load"><span class="ats__spin"></span> Reading your r\u00e9sum\u00e9 and scoring it\u2026</div>';
    try {
      var url = (data.contact && data.contact.resume) || "";
      if (!file && !url) throw new Error("Add your résumé above first — upload a PDF or paste its URL.");
      var f = file || await resumeToFile(url);
      var text = ((await fbExtractFile(f)) || "").replace(/\s+/g, " ").trim();
      if (text.length < 40) throw new Error("I couldn\u2019t read text from that r\u00e9sum\u00e9. If it\u2019s an image-only or scanned PDF, that\u2019s itself a major ATS red flag \u2014 export a text-based PDF from your design tool or Word.");
      var res = csgenParse(await aiText(aiCfg("txt"), atsSystem(atsLevel), atsUser(text, atsLevel), { json: true, maxTokens: 5000, temperature: 0.3 }));
      if (!res) throw new Error("The check came back unreadable \u2014 please try again.");
      atsLast = { file: f, res: res, level: atsLevel };
      if (out) out.innerHTML = atsRenderHtml(res, atsLevel, text.length < 500);
      status("ATS check done.", true);
    } catch (e) {
      if (out) out.innerHTML = '<div class="ats__err">' + escHtml(e && e.message || String(e)) + '</div>';
      status("ATS check failed.");
    } finally {
      btnIdle(btn, was);
    }
  }

  /* ---------- ATS résumé viewer: pins the AI's fixes onto the rendered PDF ----------
     Feedback is mixed: some fixes point at an exact phrase (anchor.type "quote"),
     some at a section ("section"), some are document-wide ("global"). We render the
     PDF with pdf.js, locate quote/section anchors in the text layer and pin them; the
     qualitative rest lives in an "Overall" rail. Everything degrades gracefully. */
  var atsLast = null; // { file, res, level } — set after a successful check
  function atsIsPdf(f) { return !!f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name || "")); }
  function atsAnchor(fx) {
    var a = (fx && fx.anchor) || {};
    var type = a.type;
    if (type !== "quote" && type !== "section" && type !== "global") type = a.quote ? "quote" : (a.section ? "section" : "global");
    return { type: type, quote: String(a.quote || ""), section: String(a.section || ""), replacement: String((a.replacement != null ? a.replacement : (fx && fx.replacement)) || "") };
  }
  // Build a punctuation/whitespace-tolerant matcher from a snippet (alphanumeric tokens only).
  function atsRegex(text) {
    var toks = String(text || "").toLowerCase().match(/[a-z0-9]+/g);
    if (!toks || !toks.length) return null;
    if (toks.length > 16) toks = toks.slice(0, 16);
    try { return new RegExp(toks.join("[^a-z0-9]+")); } catch (e) { return null; }
  }
  function atsUnionByLine(itemSet, rects) {
    var idxs = Object.keys(itemSet).map(Number).sort(function (a, b) { return a - b; });
    var lines = [];
    idxs.forEach(function (i) {
      var r = rects[i]; if (!r) return;
      var line = null;
      for (var L = 0; L < lines.length; L++) { if (Math.abs(lines[L].top - r.top) <= Math.max(6, r.h * 0.6)) { line = lines[L]; break; } }
      if (!line) lines.push({ left: r.left, top: r.top, right: r.left + r.w, bottom: r.top + r.h });
      else { line.left = Math.min(line.left, r.left); line.top = Math.min(line.top, r.top); line.right = Math.max(line.right, r.left + r.w); line.bottom = Math.max(line.bottom, r.top + r.h); }
    });
    return lines.map(function (l) { return { left: l.left, top: l.top, w: l.right - l.left, h: l.bottom - l.top }; });
  }
  // Find a snippet across a set of page indexes; returns { pageNum, rects[] } or null.
  function atsLocate(text, pages) {
    var re = atsRegex(text); if (!re) return null;
    for (var p = 0; p < pages.length; p++) {
      var pg = pages[p], m = re.exec(pg.H);
      if (m) {
        var start = m.index, end = m.index + m[0].length, set = {};
        for (var k = start; k < end; k++) { var ii = pg.map[k]; if (ii != null) set[ii] = 1; }
        var rects = atsUnionByLine(set, pg.rects);
        if (rects.length) return { pageNum: pg.pageNum, rects: rects };
      }
    }
    return null;
  }
  // Concatenate a page's text layer into a lowercase string + a char→item map + item rects (CSS px).
  async function atsPageIndex(page, viewport) {
    var content = await page.getTextContent();
    var H = "", map = [], rects = [];
    content.items.forEach(function (it) {
      var tr = window.pdfjsLib.Util.transform(viewport.transform, it.transform);
      var h = Math.hypot(tr[2], tr[3]) || Math.abs(tr[3]) || ((it.height || 0) * viewport.scale) || 12;
      var w = (it.width || 0) * viewport.scale, left = tr[4], top = tr[5] - h, idx = rects.length;
      rects.push({ left: left, top: top, w: w, h: h });
      var s = (it.str || "").toLowerCase();
      for (var c = 0; c < s.length; c++) { H += s[c]; map.push(idx); }
      H += " "; map.push(idx);
    });
    return { H: H, map: map, rects: rects };
  }
  function atsvEl(t, c) { var e = document.createElement(t); if (c) e.className = c; return e; }

  async function atsOpenViewer() {
    if (!atsLast || !atsLast.res) { status("Run an ATS check first."); return; }
    var res = atsLast.res, file = atsLast.file, level = atsLast.level || atsLevel;
    var modal = atsvEl("div", "atsv");
    modal.innerHTML =
      '<div class="atsv__bar">' +
        '<div class="atsv__ttl"><span class="ats__badge">ATS</span> Résumé review <span class="atsv__lvl">' + escHtml(atsLevelName(level)) + '</span></div>' +
        '<div class="atsv__tools">' +
          '<span class="atsv__pageno" data-atsv-pageno></span>' +
          '<button class="atsv__tbtn" data-atsv-zoom="out" title="Zoom out">−</button>' +
          '<button class="atsv__tbtn" data-atsv-zoom="fit" title="Fit width">Fit</button>' +
          '<button class="atsv__tbtn" data-atsv-zoom="in" title="Zoom in">+</button>' +
          '<button class="atsv__tbtn atsv__x" data-atsv-close title="Close (Esc)">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="atsv__body">' +
        '<div class="atsv__stage" data-atsv-stage><div class="atsv__loading">Rendering your résumé…</div></div>' +
        '<div class="atsv__rail" data-atsv-rail></div>' +
      '</div>';
    document.body.appendChild(modal);
    function onKey(e) { if (e.key === "Escape") close(); }
    function close() { document.removeEventListener("keydown", onKey); modal.remove(); }
    document.addEventListener("keydown", onKey);
    modal.addEventListener("click", function (e) { if (e.target === modal || e.target.closest("[data-atsv-close]")) close(); });

    var ctx = { modal: modal, res: res, file: file, level: level, scale: 1, pdf: null, pages: [], located: {}, onPage: [], overall: [] };
    if (atsIsPdf(file)) {
      try { var pdfjs = await ensurePdfJs(); ctx.pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise; }
      catch (e) { ctx.pdf = null; }
    }
    await atsvBuild(ctx, true);
    atsvWire(ctx);
  }

  async function atsvBuild(ctx, first) {
    var stage = ctx.modal.querySelector("[data-atsv-stage]");
    if (!ctx.pdf) {
      stage.innerHTML = '<div class="atsv__nopdf"><b>Pins need a text-based PDF résumé.</b><span>Your full review is on the right. Add a text PDF résumé (not a scan or DOCX) to see fixes pinned on the page.</span></div>';
      if (first) { ctx.onPage = []; ctx.overall = (ctx.res.fixes || []).map(function (f, i) { return i; }); atsvPaintRail(ctx); }
      return;
    }
    if (first || ctx._needFit) {
      var page1 = await ctx.pdf.getPage(1), vp1 = page1.getViewport({ scale: 1 });
      var avail = Math.max(360, (stage.clientWidth || 760) - 52);
      ctx.scale = Math.min(2.2, Math.max(0.5, avail / vp1.width));
      ctx._needFit = false;
    }
    stage.innerHTML = "";
    ctx.pages = [];
    var pageIdx = [];
    for (var p = 1; p <= ctx.pdf.numPages; p++) {
      var page = await ctx.pdf.getPage(p);
      var viewport = page.getViewport({ scale: ctx.scale });
      var wrap = atsvEl("div", "atsv__page"); wrap.style.width = viewport.width + "px"; wrap.style.height = viewport.height + "px"; wrap.dataset.page = p;
      var canvas = document.createElement("canvas");
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
      var cctx = canvas.getContext("2d"); cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var layer = atsvEl("div", "atsv__layer");
      wrap.appendChild(canvas); wrap.appendChild(layer); stage.appendChild(wrap);
      await page.render({ canvasContext: cctx, viewport: viewport }).promise;
      var index = await atsPageIndex(page, viewport);
      ctx.pages.push({ pageNum: p, layer: layer, wrap: wrap });
      pageIdx.push({ pageNum: p, H: index.H, map: index.map, rects: index.rects });
    }
    ctx.located = {};
    (ctx.res.fixes || []).forEach(function (fx, fi) {
      var a = atsAnchor(fx);
      if (a.type === "quote" || a.type === "section") {
        var loc = atsLocate(a.type === "quote" ? a.quote : a.section, pageIdx);
        if (loc) ctx.located[fi] = loc;
      }
    });
    if (first) {
      ctx.onPage = []; ctx.overall = [];
      (ctx.res.fixes || []).forEach(function (fx, fi) { if (ctx.located[fi]) ctx.onPage.push(fi); else ctx.overall.push(fi); });
      atsvPaintRail(ctx);
    }
    atsvPaintPins(ctx);
    atsvUpdatePageNo(ctx);
  }

  function atsvPaintPins(ctx) {
    ctx.pages.forEach(function (pg) { pg.layer.innerHTML = ""; });
    Object.keys(ctx.located).forEach(function (fiKey) {
      var fi = +fiKey, loc = ctx.located[fi], fx = ctx.res.fixes[fi];
      var pg = null; for (var i = 0; i < ctx.pages.length; i++) { if (ctx.pages[i].pageNum === loc.pageNum) { pg = ctx.pages[i]; break; } }
      if (!pg) return;
      var pr = fx.priority === "high" ? "high" : fx.priority === "low" ? "low" : "med";
      loc.rects.forEach(function (r) {
        var hl = atsvEl("div", "atsv__hl atsv__hl--" + pr); hl.dataset.fi = fi;
        hl.style.left = r.left + "px"; hl.style.top = r.top + "px"; hl.style.width = r.w + "px"; hl.style.height = r.h + "px";
        pg.layer.appendChild(hl);
      });
      var r0 = loc.rects[0], num = ctx.onPage.indexOf(fi) + 1;
      var pin = atsvEl("button", "atsv__pin atsv__pin--" + pr); pin.dataset.fi = fi; pin.textContent = num; pin.title = fx.point || "";
      pin.style.left = Math.max(2, r0.left - 26) + "px"; pin.style.top = (r0.top - 3) + "px";
      pg.layer.appendChild(pin);
    });
  }

  function atsvItemHtml(ctx, fi, num, anchored) {
    var fx = ctx.res.fixes[fi], a = atsAnchor(fx);
    var pr = fx.priority === "high" ? "high" : fx.priority === "low" ? "low" : "med";
    var badge = anchored ? '<span class="atsv__num atsv__num--' + pr + '">' + num + '</span>' : '<span class="atsv__dot atsv__dot--' + pr + '"></span>';
    var loc = anchored ? "" : (a.type === "section" && a.section ? '<span class="atsv__loc">' + escHtml(a.section) + '</span>' : (a.type === "quote" && a.quote ? '<span class="atsv__loc atsv__loc--miss">couldn’t pinpoint</span>' : ''));
    var rep = a.replacement ? '<div class="atsv__rep"><code>' + escHtml(a.replacement) + '</code><button class="atsv__copy" type="button" data-atsv-copy>Copy</button></div>' : "";
    return '<div class="atsv__item atsv__item--' + pr + '" data-fi="' + fi + '">' +
      '<div class="atsv__ihead">' + badge + '<span class="atsv__pri atsv__pri--' + pr + '">' + pr + '</span>' + loc + '</div>' +
      '<div class="atsv__point">' + escHtml(fx.point || "") + '</div>' +
      (fx.how ? '<div class="atsv__how">' + escHtml(fx.how) + '</div>' : "") + rep + '</div>';
  }

  function atsvPaintRail(ctx) {
    var res = ctx.res, level = ctx.level;
    var score = Math.max(0, Math.min(100, Math.round(+res.score || 0)));
    var band = res.band || (score >= 80 ? "Strong" : score >= 65 ? "Good" : score >= 45 ? "Needs work" : "At risk");
    var tone = score >= 80 ? "good" : score >= 65 ? "ok" : score >= 45 ? "warn" : "bad";
    var html = '<div class="atsv__score atsv__score--' + tone + '"><div class="ats__ring" style="--p:' + score + '"><span>' + score + '</span></div><div class="atsv__score-x"><b>' + escHtml(band) + '</b><span>ATS + ' + escHtml(atsLevelName(level)) + ' fit</span>' + (res.summary ? '<p>' + escHtml(res.summary) + '</p>' : '') + '</div></div>';
    html += '<div class="atsv__grp"><div class="atsv__grptitle">On the page <span>' + ctx.onPage.length + '</span></div>';
    html += ctx.onPage.length ? ctx.onPage.map(function (fi, n) { return atsvItemHtml(ctx, fi, n + 1, true); }).join("") : '<div class="atsv__empty">No fixes mapped to an exact spot on the page.</div>';
    html += '</div>';
    var checks = (Array.isArray(res.checks) ? res.checks : []).filter(function (c) { return c.status === "warn" || c.status === "fail"; });
    var kw = res.keywords || {}, miss = (kw.missing || []).filter(Boolean), pres = (kw.present || []).filter(Boolean);
    var count = ctx.overall.length + checks.length + (miss.length || pres.length ? 1 : 0);
    html += '<div class="atsv__grp"><div class="atsv__grptitle">Overall <span>' + count + '</span></div>';
    ctx.overall.forEach(function (fi) { html += atsvItemHtml(ctx, fi, null, false); });
    if (checks.length) html += '<div class="atsv__checks">' + checks.map(function (c) {
      var s = c.status === "fail" ? "fail" : "warn";
      return '<div class="atsv__chk atsv__chk--' + s + '"><span class="atsv__chki">' + (s === "fail" ? "✕" : "!") + '</span><div><b>' + escHtml(c.label || "") + '</b>' + (c.note ? '<span>' + escHtml(c.note) + '</span>' : '') + '</div></div>';
    }).join("") + '</div>';
    if (miss.length || pres.length) {
      html += '<div class="atsv__kw">';
      if (miss.length) html += '<div class="atsv__kwrow"><span class="atsv__kwlbl">Add for ' + escHtml(atsLevelName(level)) + '</span>' + miss.map(function (k) { return '<span class="atsv__chip atsv__chip--miss">' + escHtml(k) + '</span>'; }).join("") + '</div>';
      if (pres.length) html += '<div class="atsv__kwrow"><span class="atsv__kwlbl">Covered</span>' + pres.map(function (k) { return '<span class="atsv__chip">' + escHtml(k) + '</span>'; }).join("") + '</div>';
      html += '</div>';
    }
    html += '</div>';
    ctx.modal.querySelector("[data-atsv-rail]").innerHTML = html;
  }

  function atsvActivate(ctx, fi) {
    ctx.modal.querySelectorAll(".is-active[data-fi]").forEach(function (x) { x.classList.remove("is-active"); });
    if (fi == null) return;
    ctx.modal.querySelectorAll('[data-fi="' + fi + '"]').forEach(function (x) { x.classList.add("is-active"); });
  }
  function atsvFocusPin(ctx, fi) {
    var pin = ctx.modal.querySelector('.atsv__pin[data-fi="' + fi + '"]');
    if (pin) pin.scrollIntoView({ behavior: "smooth", block: "center" });
    atsvActivate(ctx, fi);
    var item = ctx.modal.querySelector('.atsv__item[data-fi="' + fi + '"]');
    if (item) item.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function atsvWire(ctx) {
    var modal = ctx.modal, stage = modal.querySelector("[data-atsv-stage]"), rail = modal.querySelector("[data-atsv-rail]");
    rail.addEventListener("click", function (e) {
      var cp = e.target.closest("[data-atsv-copy]");
      if (cp) { var it = cp.closest(".atsv__item"), code = it && it.querySelector("code"); if (code) { try { navigator.clipboard.writeText(code.textContent); } catch (x) {} cp.textContent = "Copied"; setTimeout(function () { cp.textContent = "Copy"; }, 1200); } return; }
      var item = e.target.closest(".atsv__item"); if (item && item.dataset.fi) atsvFocusPin(ctx, item.dataset.fi);
    });
    stage.addEventListener("click", function (e) { var pin = e.target.closest(".atsv__pin"); if (pin) atsvFocusPin(ctx, pin.dataset.fi); });
    stage.addEventListener("mouseover", function (e) { var t = e.target.closest(".atsv__pin,.atsv__hl"); if (t) atsvActivate(ctx, t.dataset.fi); });
    stage.addEventListener("scroll", function () { atsvUpdatePageNo(ctx); });
    modal.querySelectorAll("[data-atsv-zoom]").forEach(function (b) {
      b.addEventListener("click", function () {
        var z = b.dataset.zoom;
        if (z === "fit") ctx._needFit = true;
        else ctx.scale = Math.min(3, Math.max(0.4, ctx.scale * (z === "in" ? 1.2 : 1 / 1.2)));
        atsvBuild(ctx, false);
      });
    });
  }
  function atsvUpdatePageNo(ctx) {
    var pn = ctx.modal.querySelector("[data-atsv-pageno]"); if (!pn) return;
    if (!ctx.pdf) { pn.textContent = ""; return; }
    var stage = ctx.modal.querySelector("[data-atsv-stage]"), mid = stage.scrollTop + stage.clientHeight / 2, cur = 1;
    ctx.pages.forEach(function (pg) { if (pg.wrap.offsetTop <= mid) cur = pg.pageNum; });
    pn.textContent = "Page " + cur + " / " + ctx.pdf.numPages;
  }

  async function rtImprove(area, btn) {
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { rtImprove(area, btn); }); return; }
    var text = (area.innerText || "").trim();
    if (!text) { status("Write something first, then Improve."); return; }
    var lbl = btnBusy(btn, "\u2728");
    status("Improving with AI\u2026");
    try {
      var out = await aiText(aiCfg("txt"),
        "You are a sharp product-design portfolio editor. Rewrite the case-study copy to fix grammar, tighten wording, and make it more confident and value/impact-oriented \u2014 keep the author's meaning and voice, and don't invent facts or numbers. Return ONLY the rewritten copy as clean minimal HTML using <p>, <strong>, <em> and <ul>/<li> where natural \u2014 no headings, no preamble, no markdown, no code fences.",
        text, { maxTokens: 900, temperature: 0.5 });
      var html = rtClean(String(out || "").replace(/```[a-z]*/gi, "").replace(/```/g, "").trim());
      if (html) { rtSetHtml(area, html); rtSerialize(area); status("Improved \u2014 not right? Press Ctrl+Z or the Undo button to revert.", true); }
      else status("The AI didn\u2019t return usable copy \u2014 try again.");
    } catch (e) { status("Improve failed: " + ((e && e.message) || "error")); }
    btnIdle(btn, lbl || "\u2728 Improve");
  }

  /* ---------- structured item repeaters ---------- */
  var ITEM_SPEC = {
    metrics: { title: "Metrics", one: "Metric", add: "Add metric", fields: [["value", "Value (e.g. +45%)", "input"], ["label", "Label", "input"]] },
    steps: { title: "Steps", one: "Step", add: "Add step", fields: [["title", "Title", "input"], ["body", "Body", "rich"]] },
    workflow: { title: "Steps", one: "Step", add: "Add step", fields: [["label", "Step \u2014 use // to fork into parallel branches (e.g. Design // Eng // Legal)", "input"], ["note", "Note (optional)", "input"]] },
    faq: { title: "Questions", one: "Q", add: "Add question", fields: [["q", "Question", "input"], ["a", "Answer", "rich"]] },
    media: { title: "Media", one: "Item", add: "Add media", fields: [["src", "Image / video / Figma / PDF / deck URL", "media"], ["caption", "Caption", "input"], ["_imgsize", "Image size", "imgsize"]] },
    gallery: { title: "Slides", one: "Slide", add: "Add slide", fields: [["src", "Image / video / embed URL", "media"], ["caption", "Caption", "input"]] },
    mediagrid: { title: "Images", one: "Image", add: "Add image", fields: [["src", "Image / video URL", "media"], ["caption", "Caption (optional)", "input"]] },
    device: { title: "Screens", one: "Screen", add: "Add screen", fields: [["src", "Image / video / GIF URL", "media"], ["caption", "Caption (optional)", "input"]] },
    isolayers: { title: "Layers", one: "Layer", add: "Add layer", fields: [["src", "Image / PNG URL", "media"], ["heightColor", "Height colour", "isohc"], ["depth", "Depth override", "select", [["", "Match block"], ["0", "Flat"], ["4", "Super slim"], ["8", "Slim"], ["14", "Medium"], ["22", "Thick"], ["34", "Extra"]]]] },
    cards: { title: "Cards", one: "Card", add: "Add card", fields: [["title", "Title", "input"], ["body", "Body", "rich"], ["icon", "Icon", "icon"], ["src", "Image (optional \u2014 replaces the icon)", "media"]] },
    columns: { title: "Columns", one: "Column", add: "Add column", fields: [["label", "Label (optional)", "input"], ["cells", "Cells", "cells"]] },
    rows: { title: "Rows", one: "Row", add: "Add row", fields: [["label", "Row label (optional)", "input"], ["cells", "Cells", "cells"]] },
    stickies: { title: "Notes", one: "Note", add: "Add note", fields: [["label", "Label (e.g. 01)", "input"], ["heading", "Heading", "input"], ["body", "Body", "rich"], ["src", "Image (optional)", "media"]] },
    voices: { title: "Voices", one: "Voice", add: "Add voice", fields: [["side", "Side (Left / Right)", "select", [["left", "Left"], ["right", "Right"]]], ["heading", "Heading (verbatim, optional)", "input"], ["body", "Text / quote", "rich"], ["cite", "Attribution / label", "input"]] }
  };
  var ICON_NAMES = ["users", "idea", "coins", "chart", "target", "lock", "spark", "clock", "shield", "check", "bolt", "layers"];
  function admIcon(n) { return (window.RK && window.RK.iconSvg) ? window.RK.iconSvg(n) : ""; }
  function admIconNames() { return (window.RK && window.RK.iconNames) ? window.RK.iconNames() : ICON_NAMES; }
  // Split a Figma-exported SVG (a frame whose direct children are the layers) into
  // one data-URI SVG per layer — each keeps the original viewBox + <defs> so it
  // renders identically and aligns when stacked. Handles raster <image>, vector and
  // hybrid layers; falls back to the whole SVG if it can't find distinct layers.
  function isoSplitSvg(svgText) {
    try {
      var doc = new DOMParser().parseFromString(String(svgText || ""), "image/svg+xml");
      if (doc.querySelector("parsererror")) return [];
      var svg = doc.querySelector("svg"); if (!svg) return [];
      var kids = function (el) { return [].slice.call(el.children).filter(function (n) { return n.nodeType === 1; }); };
      var isG = function (n) { return n.tagName && n.tagName.toLowerCase() === "g"; };
      var defs = svg.querySelector("defs");
      var groups = kids(svg).filter(isG);
      var guard = 0;
      while (groups.length === 1 && guard++ < 4) {
        var inner = kids(groups[0]).filter(isG);
        if (inner.length >= 2) { groups = inner; break; }
        if (inner.length === 1) groups = inner; else break;
      }
      var nodes = groups.length >= 2 ? groups : kids(svg).filter(function (n) { return n.tagName && n.tagName.toLowerCase() !== "defs"; });
      if (!nodes.length) return [];
      var vb = svg.getAttribute("viewBox") || ("0 0 " + (parseFloat(svg.getAttribute("width")) || 300) + " " + (parseFloat(svg.getAttribute("height")) || 600));
      var defsHtml = defs ? defs.outerHTML : "";
      return nodes.map(function (node) {
        var s = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="' + vb + '">' + defsHtml + node.outerHTML + "</svg>";
        return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(s)));
      });
    } catch (e) { return []; }
  }
  function blankItem(type) {
    switch (type) {
      case "metrics": return { value: "", label: "" };
      case "steps": return { title: "", body: "" };
      case "workflow": return { label: "", note: "" };
      case "faq": return { q: "", a: "" };
      case "isolayers": return { src: "", heightColor: "", depth: "" };
      case "media": case "gallery": case "mediagrid": case "device": return { src: "", caption: "" };
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
        (v ? '<button class="btn btn--ghost" data-act="item-clear" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-ifield="' + key + '">Remove</button>' : "") + mediaSizeTag(v) + "</div></div>";
    }
    if (kind === "imgsize") return mediaSizeCtl(i, j, k, it);
    if (kind === "isohc") {
      var hcv = it[key] || "";
      return '<div class="af imgsz"><label class="af__label">' + label + '</label>' +
        '<div class="imgsz__bg"><span class="imgsz__bglbl">Height side</span>' +
        '<span class="imgsz__sw"' + (hcv ? ' style="background:' + escAttr(hcv) + '"' : "") + '></span>' +
        '<input type="color" class="imgsz__color" ' + da + ' value="' + escAttr(hcv || "#333333") + '" />' +
        '<button type="button" class="imgsz__eye" data-act="iso-eyedrop" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-ifield="' + key + '" title="Pick a colour from the screen / an image">\uD83D\uDD0D</button>' +
        (hcv ? '<button type="button" class="imgsz__clear" data-act="item-clear" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-ifield="' + key + '">Auto</button>' : '<span class="imgsz__note">auto from image</span>') +
        '</div></div>';
    }
    return '<div class="af"><label class="af__label">' + label + '</label><input type="text" ' + da + ' value="' + escAttr(it[key] || "") + '" /></div>';
  }
  function mediaSizeCtl(i, j, k, it) {
    var da = 'data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '"';
    var size = (it.size === "fit" || it.size === "custom") ? it.size : "fill";
    var ratio = it.fitRatio || "16:9";
    var shrink = Math.max(0, Math.min(90, Math.round(+it.shrink || 0)));
    var bg = it.bg || "";
    var sizeOpts = [["fill", "Fill \u2014 box fits the image"], ["fit", "Fit \u2014 image in a framed mat"], ["custom", "Custom \u2014 shrink the image"]]
      .map(function (o) { return '<option value="' + o[0] + '"' + (size === o[0] ? " selected" : "") + ">" + escHtml(o[1]) + "</option>"; }).join("");
    var ratioOpts = [["16:9", "16:9 \u2014 wide"], ["4:3", "4:3"], ["1:1", "1:1 \u2014 square"], ["3:2", "3:2"]]
      .map(function (o) { return '<option value="' + o[0] + '"' + (ratio === o[0] ? " selected" : "") + ">" + escHtml(o[1]) + "</option>"; }).join("");
    return '<div class="af imgsz" data-size="' + size + '"><label class="af__label">Image size</label>' +
      '<div class="imgsz__row">' +
        '<select data-msz="size" ' + da + '>' + sizeOpts + '</select>' +
        '<span class="imgsz__ratio"><select data-msz="fitRatio" ' + da + '>' + ratioOpts + '</select></span>' +
        '<span class="imgsz__shrink"><input type="number" min="0" max="90" step="5" data-msz="shrink" ' + da + ' value="' + shrink + '" /><span class="imgsz__pctlbl">% smaller</span></span>' +
      '</div>' +
      '<div class="imgsz__bg"><span class="imgsz__bglbl">Background</span>' +
        '<span class="imgsz__sw"' + (bg ? ' style="background:' + escAttr(bg) + '"' : "") + '></span>' +
        '<input type="color" class="imgsz__color" data-msz="bg" ' + da + ' value="' + escAttr(bg || "#0e0e12") + '" />' +
        '<button type="button" class="imgsz__eye" data-act="media-eyedrop" ' + da + ' title="Pick a colour from the screen / an image">\uD83D\uDD0D</button>' +
        (bg ? '<button type="button" class="imgsz__clear" data-act="media-bgclear" ' + da + '>Clear</button>' : '<span class="imgsz__note">transparent</span>') +
      '</div>' +
      '<div class="af__hint">Fill grows the box to the image (edge to edge). Fit centres the image in a framed mat of the chosen ratio \u2014 the surrounding space always shows the background. Custom shrinks the image and shows the background around it.</div></div>';
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
    var fields = spec.fields;
    var rows = items.map(function (it, k) {
      var flds = fields.map(function (f) { return itemFieldEl(i, j, k, it, f); }).join("");
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
    var bulk = /^(gallery|media|mediagrid|device|isolayers)$/.test(b.type) ? '<button class="btn btn--add rep__add" data-act="item-upload-multi" data-index="' + i + '" data-bindex="' + j + '" title="Pick several images at once">+ Add images\u2026</button>' : "";
    var single = (b.type === "mediagrid") ? "" : '<button class="btn btn--add rep__add" data-act="item-add" data-index="' + i + '" data-bindex="' + j + '">+ ' + spec.add + "</button>";
    return '<div class="rep"><div class="rep__head"><label class="af__label">' + spec.title + '</label>' + bulk + single + "</div>" + rows + "</div>";
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
    sortState = { key: key, rows: rows, row: row, from: from, to: from, y: e.clientY, scrollEl: root.querySelector(".adm__editor"), raf: 0, isBlock: key.split(":")[0] === "block", pv: -1 };
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
    if (s.isBlock) {                                   // mirror the drop point in the live preview on the right
      var pidx = insert >= rows.length ? rows.length - 1 : insert;
      if (pidx !== s.pv) { s.pv = pidx; sortPreview(pidx); }
    }
  }
  function sortPreview(idx) {
    try { var fw = frameWin(); if (fw) fw.postMessage({ __rk: "dragBlock", index: idx }, "*"); } catch (e) {}
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
    if (s.isBlock) { try { var fw = frameWin(); if (fw) fw.postMessage({ __rk: "dragBlockEnd" }, "*"); } catch (e) {} }
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
    } else if (p[0] === "jchap") {
      arr = journeyData().chapters; after = function () { openJC = -1; saveDraft(true); renderJourneyEditor(); };
    } else if (p[0] === "jentry") {
      var jch = journeyData().chapters[+p[1]]; if (!jch || !jch.entries) return; arr = jch.entries; after = function () { saveDraft(true); renderJourneyEditor(); };
    } else if (p[0] === "jimg") {
      var jen = journeyData().chapters[+p[1]] && journeyData().chapters[+p[1]].entries[+p[2]]; if (!jen || !jen.images) return; arr = jen.images; after = function () { saveDraft(true); renderJourneyEditor(); };
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
  function onMediaSizeInput(t) {
    var i = +t.dataset.index, j = +t.dataset.bindex, k = +t.dataset.iindex, f = t.dataset.msz;
    var b = data.work[i] && data.work[i].study && data.work[i].study.blocks[j];
    if (!b || !b.items || !b.items[k]) return;
    var v = t.value;
    if (f === "shrink") v = Math.max(0, Math.min(90, Math.round(+v || 0)));
    b.items[k][f] = v;
    var box = t.closest(".imgsz");
    if (box) { if (f === "size") box.setAttribute("data-size", v); if (f === "bg") { var sw = box.querySelector(".imgsz__sw"); if (sw) sw.style.background = v; } }
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
        (img ? '<button class="btn btn--ghost" data-act="cell-clear" data-index="' + i + '" data-bindex="' + j + '" data-iindex="' + k + '" data-cindex="' + c + '">Remove</button>' : "") + mediaSizeTag(img) +
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
      (v ? '<button class="btn btn--ghost" data-act="bfield-clear" data-index="' + i + '" data-bindex="' + j + '" data-bfield="' + field + '">Remove</button>' : "") + mediaSizeTag(v) + "</div>" +
      (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
  }

  // Owner-only: turn a project's encrypted stubs back into editable plaintext using
  // the recovery passphrase. On Publish they are re-encrypted automatically.
  async function decryptStudyForEdit(i) {
    const w = data.work[i]; if (!w || !w.study) return;
    const st = w.study;
    const wrap = st.enc && st.enc.wraps && st.enc.wraps.owner;
    const hasVault = (st.blocks || []).some(function (b) { return b && b.locked && b.vaultBlock; });
    if (!wrap && !hasVault) { status("This project has no protected sections to unlock."); return; }
    // 1) Restore vault-hosted sections: fetch their plain JSON with your session and re-flag them vault
    //    so they re-vault on Publish (content.json keeps shipping only a pointer).
    if (hasVault) {
      if (!adminSession()) { status("Sign in to edit this project\u2019s vault-hosted sections."); return; }
      try {
        const out = st.blocks.slice();
        for (let k = 0; k < out.length; k++) {
          const bk = out[k];
          if (bk && bk.locked && bk.vaultBlock) {
            const url = await vaultSignedUrl(bk.vaultBlock);
            if (!url) { status("The vault declined \u2014 sign in again to edit these sections."); return; }
            const full = await (await fetch(url)).json();
            if (full && typeof full === "object") { full.locked = true; full.vault = true; out[k] = full; }
          }
        }
        st.blocks = out;
      } catch (e) { status("Couldn\u2019t fetch the vault-hosted sections."); return; }
    }
    // 2) Decrypt any legacy .enc sections with the recovery passphrase.
    if (wrap) {
      const recovery = await ensureRecoveryPass();
      if (recovery === null) return;
      let sek;
      try { sek = await rkUnwrapSek(recovery, wrap); }
      catch (e) { recoveryPassCache = null; status("That recovery passphrase didn\u2019t unlock this project."); return; }
      try {
        const out = st.blocks.slice();
        for (let k = 0; k < out.length; k++) { const bk = out[k]; if (bk && bk.encStub && bk.iv && bk.ct) { out[k] = await rkDecWithSek(sek, bk); await rkResolveEncToDataUri(out[k], sek); } }
        st.blocks = out;
      } catch (e) { status("Couldn\u2019t decrypt the protected sections."); return; }
    }
    saveDraft(true); renderL2();
    status("Protected sections unlocked for editing \u2014 they\u2019ll be re-protected on Publish.", true);
  }
  // Owner-only: turn a hidden encrypted project back into an editable one.
  async function decryptWorkForEdit(i) {
    const stub = data.work[i];
    if (!stub || !stub.encWork) return;
    const wrap = stub.enc && stub.enc.wraps && stub.enc.wraps.owner;
    if (!wrap) { status("This project can only be recovered with a ticket."); return; }
    const recovery = await ensureRecoveryPass();
    if (recovery === null) return;
    let full;
    try { const sek = await rkUnwrapSek(recovery, wrap); full = await rkDecWithSek(sek, stub); await rkResolveEncToDataUri(full, sek); }
    catch (e) { recoveryPassCache = null; status("That recovery passphrase didn\u2019t unlock this project."); return; }
    data.work[i] = full;
    saveDraft(true); renderBody();
    status("Hidden project unlocked for editing \u2014 it re-encrypts on Publish.", true);
  }
  /* ---------- focus & annotate editor ----------
     One image, N annotations. Each annotation is a % point (marker) with an optional
     % focus box. Click to place a marker; select one to edit its title/body; tick Focus
     and drag on the image to draw/move/resize the spotlight region. All %-based → scales. */
  var faSel = -1, faPlacing = false, faDrag = null, faJustMoved = false;
  function faPct(v) { v = parseFloat(v); return isNaN(v) ? 0 : Math.max(0, Math.min(100, v)); }
  function faBlock(i, j) { var w = data.work[i]; var st = w && w.study; return st && st.blocks && st.blocks[j]; }
  function focusAnnEditor(i, j, b) {
    b.annotations = b.annotations || [];
    if (faSel >= b.annotations.length) faSel = b.annotations.length - 1;
    if (!b.src) return '<div class="af__hint">Add an image above first \u2014 then you can drop annotations onto it.</div>';
    var src = (typeof previewSrc === "function" ? previewSrc(b.src) : b.src) || b.src;
    var overlay = b.annotations.map(function (a, k) {
      var sel = k === faSel, box = "";
      if (sel && a.focus) {
        var f = a.focus, shape = f.shape || "rect";
        box = '<div class="faed__box" data-faed-box style="left:' + faPct(f.x) + "%;top:" + faPct(f.y) + "%;width:" + Math.max(1, faPct(f.w)) + "%;height:" + Math.max(1, faPct(f.h)) + "%;border-radius:" + (shape === "circle" ? "50%" : (shape === "square" ? "8px" : "4px")) + '"><span class="faed__handle" data-faed-handle></span></div>';
      }
      return box + '<button type="button" class="faed__mark' + (sel ? " is-sel" : "") + '" data-act="fa-select" data-index="' + i + '" data-bindex="' + j + '" data-aindex="' + k + '" style="left:' + faPct(a.x) + "%;top:" + faPct(a.y) + '%" title="Annotation ' + (k + 1) + '">' + (k + 1) + "</button>";
    }).join("");
    var canvas = '<div class="faed' + (faPlacing ? " is-placing" : "") + '" data-faed data-index="' + i + '" data-bindex="' + j + '"><img src="' + escAttr(src) + '" alt="" draggable="false" />' + overlay + "</div>";
    var addbar = '<div class="adm__addbar"><button class="btn btn--add' + (faPlacing ? " is-on" : "") + '" data-act="fa-add" data-index="' + i + '" data-bindex="' + j + '">' + (faPlacing ? "\u2716 Click the image to place\u2026" : "+ Add annotation") + "</button></div>";
    var rows = b.annotations.map(function (a, k) {
      var sel = k === faSel, hasFocus = !!a.focus;
      var da = 'data-index="' + i + '" data-bindex="' + j + '" data-aindex="' + k + '"';
      var shapeSel = hasFocus ? '<div class="faed__shape"><label>Shape</label><select data-fann ' + da + ' data-afield="fshape">' +
        [["rect", "Rectangle (free)"], ["square", "Square"], ["circle", "Circle"]].map(function (o) { return '<option value="' + o[0] + '"' + ((a.focus.shape || "rect") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></div>" : "";
      return '<div class="faed__row' + (sel ? " is-sel" : "") + '">' +
        '<div class="faed__row-head"><button type="button" class="faed__row-n" data-act="fa-select" ' + da + ' title="Select">' + (k + 1) + "</button>" +
          '<input type="text" placeholder="Title (optional)" data-fann ' + da + ' data-afield="title" value="' + escAttr(a.title || "") + '" />' +
          '<button class="iconbtn iconbtn--danger" data-act="fa-remove" ' + da + ' title="Remove">\u2715</button></div>' +
        '<textarea rows="2" placeholder="Body (optional \u2014 **bold** and *italic* welcome)" data-fann ' + da + ' data-afield="body">' + escHtml(a.body || "") + "</textarea>" +
        '<label class="chk"><input type="checkbox" data-act="fa-focustoggle" ' + da + (hasFocus ? " checked" : "") + " /> Focus area \u2014 spotlight this region (blur the rest)</label>" +
        shapeSel + "</div>";
    }).join("");
    return '<div class="faed-wrap">' + canvas + addbar + '<div class="faed__rows">' + (rows || '<div class="af__hint">No annotations yet \u2014 add one above.</div>') + "</div>" +
      '<div class="af__hint">Hit <b>Add annotation</b>, then click the image to drop a numbered marker \u2014 drag a marker anytime to reposition it. Select one (click its number) to edit it. Tick <b>Focus area</b> and a box appears on the image \u2014 drag it to move, drag the corner to resize (square &amp; circle stay even), or drag on open image to redraw. Everything is a % of the image, so points and focus regions scale on mobile.</div></div>';
  }
  function onFocusAnn(t) {
    var i = +t.dataset.index, j = +t.dataset.bindex, k = +t.dataset.aindex, f = t.dataset.afield;
    var b = faBlock(i, j); if (!b || !b.annotations || !b.annotations[k]) return;
    var a = b.annotations[k];
    if (f === "fshape") {
      if (!a.focus) a.focus = { shape: "rect", x: 30, y: 30, w: 30, h: 30 };
      a.focus.shape = t.value;
      saveDraft(); renderL2(); return;   // re-render so the editor box picks up the new shape
    }
    a[f] = t.value;
    saveDraft(); refreshL2Preview();       // text edits: preview only, keep input focus
  }
  function faPointerDown(e) {
    var canvas = e.target.closest(".faed"); if (!canvas) return;
    var i = +canvas.dataset.index, j = +canvas.dataset.bindex;
    var b = faBlock(i, j); if (!b) return;
    var img = canvas.querySelector("img"); if (!img) return;
    var rect = img.getBoundingClientRect();
    var aspect = rect.height ? rect.width / rect.height : 1.6;
    var p = { x: Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100)) };
    if (faPlacing) {
      b.annotations = b.annotations || [];
      b.annotations.push({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), title: "", body: "" });
      faSel = b.annotations.length - 1; faPlacing = false;
      saveDraft(true); renderL2(); e.preventDefault(); return;
    }
    // Drag an existing marker to reposition it; a plain click (no real movement) still selects it.
    var mk = e.target.closest(".faed__mark");
    if (mk) {
      faDrag = { mode: "mark", i: i, j: j, k: +mk.getAttribute("data-aindex"), rect: rect, el: mk, sx: e.clientX, sy: e.clientY, moved: false };
      document.addEventListener("pointermove", faPointerMove);
      document.addEventListener("pointerup", faPointerEnd);
      return;
    }
    var a = b.annotations && b.annotations[faSel]; if (!a || !a.focus) return;
    var f = a.focus;
    if (e.target.closest("[data-faed-handle]")) faDrag = { mode: "resize", i: i, j: j, k: faSel, rect: rect, aspect: aspect };
    else if (e.target.closest("[data-faed-box]")) faDrag = { mode: "move", i: i, j: j, k: faSel, rect: rect, aspect: aspect, offX: p.x - faPct(f.x), offY: p.y - faPct(f.y) };
    else { f.x = +p.x.toFixed(1); f.y = +p.y.toFixed(1); f.w = 2; f.h = 2; faDrag = { mode: "draw", i: i, j: j, k: faSel, rect: rect, aspect: aspect, startX: p.x, startY: p.y }; }
    e.preventDefault();
    document.addEventListener("pointermove", faPointerMove);
    document.addEventListener("pointerup", faPointerEnd);
  }
  function faApplyBox(d, f) {
    var canvas = root.querySelector('.faed[data-index="' + d.i + '"][data-bindex="' + d.j + '"]'); if (!canvas) return;
    var box = canvas.querySelector("[data-faed-box]"); if (!box) return;
    box.style.left = f.x + "%"; box.style.top = f.y + "%"; box.style.width = f.w + "%"; box.style.height = f.h + "%";
  }
  function faPointerMove(e) {
    if (!faDrag) return;
    var b = faBlock(faDrag.i, faDrag.j); if (!b) return;
    if (faDrag.mode === "mark") {
      var a0 = b.annotations[faDrag.k]; if (!a0) return;
      if (!faDrag.moved) {
        if (Math.hypot(e.clientX - faDrag.sx, e.clientY - faDrag.sy) < 4) return;   // ignore tiny jitters so a click still selects
        faDrag.moved = true; faSel = faDrag.k;
        var cv = faDrag.el.closest(".faed");
        if (cv) [].forEach.call(cv.querySelectorAll(".faed__mark"), function (m) { m.classList.toggle("is-sel", m === faDrag.el); });
        faDrag.el.classList.add("is-drag");
      }
      var mx = Math.max(0, Math.min(100, (e.clientX - faDrag.rect.left) / faDrag.rect.width * 100));
      var my = Math.max(0, Math.min(100, (e.clientY - faDrag.rect.top) / faDrag.rect.height * 100));
      a0.x = +mx.toFixed(1); a0.y = +my.toFixed(1);
      faDrag.el.style.left = a0.x + "%"; faDrag.el.style.top = a0.y + "%";
      e.preventDefault();
      return;
    }
    var a = b.annotations[faDrag.k]; if (!a || !a.focus) return;
    var f = a.focus, r = faDrag.rect;
    var px = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100));
    var py = Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100));
    var uniform = (f.shape === "square" || f.shape === "circle");
    if (faDrag.mode === "move") {
      f.x = +Math.max(0, Math.min(100 - f.w, px - faDrag.offX)).toFixed(1);
      f.y = +Math.max(0, Math.min(100 - f.h, py - faDrag.offY)).toFixed(1);
    } else if (faDrag.mode === "resize") {
      f.w = +Math.max(2, Math.min(100 - f.x, px - f.x)).toFixed(1);
      f.h = uniform ? +Math.max(2, Math.min(100 - f.y, f.w * faDrag.aspect)).toFixed(1) : +Math.max(2, Math.min(100 - f.y, py - f.y)).toFixed(1);
    } else if (faDrag.mode === "draw") {
      var x0 = Math.min(faDrag.startX, px), y0 = Math.min(faDrag.startY, py);
      var w2 = Math.abs(px - faDrag.startX), h2 = Math.abs(py - faDrag.startY);
      if (uniform) h2 = w2 * faDrag.aspect;
      f.x = +x0.toFixed(1); f.y = +y0.toFixed(1);
      f.w = +Math.max(2, Math.min(100 - f.x, w2)).toFixed(1);
      f.h = +Math.max(2, Math.min(100 - f.y, h2)).toFixed(1);
    }
    faApplyBox(faDrag, f);
    e.preventDefault();
  }
  function faPointerEnd() {
    document.removeEventListener("pointermove", faPointerMove);
    document.removeEventListener("pointerup", faPointerEnd);
    if (!faDrag) return;
    var d = faDrag; faDrag = null;
    if (d.mode === "mark") {
      if (d.moved) { faSel = d.k; saveDraft(true); renderL2(); faJustMoved = true; setTimeout(function () { faJustMoved = false; }, 350); }
      return;   // no real move => it was a click; let fa-select handle it
    }
    var wasDraw = d.mode === "draw";
    saveDraft(true);
    if (wasDraw) renderL2(); else refreshL2Preview();
  }

  function blockEditor(i, b, j, len, open) {
    var typeName = ({ text: "Text", statement: "Statement", metrics: "Metrics", steps: "Steps", media: "Media", split: "Before / after", faq: "FAQ", cards: "Cards", gallery: "Gallery", mediagrid: "Media grid", figure: "Figure", columns: "Columns", rows: "Rows", compare: "Before / after slider", stickies: "Sticky notes", voices: "Voices", workflow: "Workflow", device: "Devices", isolayers: "Isometric layers", focus: "Focus & annotate", gen: "Generated" })[b.type] || b.type;
    if (b.encStub) {
      return '<div class="card study__block study__block--enc">' +
        '<div class="study__block-head study__block-head--enc">' +
          '<span class="study__block-badge">\uD83D\uDD12 Protected</span>' +
          '<span class="study__block-label">' + escHtml(typeName) + ' \u2014 encrypted at rest</span>' +
          '<span class="study__block-ops"><button class="iconbtn iconbtn--danger" data-act="study-blockremove" data-index="' + i + '" data-bindex="' + j + '" title="Remove">\u2715</button></span>' +
        '</div>' +
        '<div class="study__enc-note">Its content isn\u2019t in your published file. <button class="btn btn--ghost" data-act="study-decrypt" data-index="' + i + '">Unlock to edit</button></div>' +
      '</div>';
    }
    if (b.vaultBlock) {
      return '<div class="card study__block study__block--enc">' +
        '<div class="study__block-head study__block-head--enc">' +
          '<span class="study__block-badge">\uD83D\uDD12 Vaulted</span>' +
          '<span class="study__block-label">' + escHtml(typeName) + ' \u2014 stored in your private vault</span>' +
          '<span class="study__block-ops"><button class="iconbtn iconbtn--danger" data-act="study-blockremove" data-index="' + i + '" data-bindex="' + j + '" title="Remove">\u2715</button></span>' +
        '</div>' +
        '<div class="study__enc-note">Your content is safe in your private vault \u2014 it just isn\u2019t in the published file, so it looks empty here. <button class="btn btn--ghost" data-act="study-decrypt" data-index="' + i + '">Unlock to edit</button></div>' +
      '</div>';
    }
    var custom = (typeof b.editorName === "string" && b.editorName.trim()) ? b.editorName.trim() : "";
    var raw = custom || b.name || b.nav || b.kicker || b.heading || b.body || (b.items && b.items[0] && (b.items[0].q || b.items[0].title || b.items[0].value || b.items[0].caption || b.items[0].heading || b.items[0].label)) || "Untitled";
    var label = String(raw).replace(/[\*\[\]]/g, "").replace(/\s+/g, " ").trim();
    if (label.length > 48) label = label.slice(0, 48) + "\u2026";
    var head = '<div class="study__block-head" data-act="study-blocktoggle" data-index="' + i + '" data-bindex="' + j + '">' +
      '<span class="sortgrip study__block-grip" data-grip data-sortkey="block:' + i + '" title="Drag to reorder" aria-label="Drag to reorder">' + GRIP_SVG + '</span>' +
      '<span class="study__block-badge">' + escHtml(typeName) + "</span>" +
      '<span class="study__block-label' + (custom ? " is-custom" : "") + '" title="Double-click to rename">' + escHtml(label) + "</span>" +
      '<span class="study__block-ops">' +
      '<button class="iconbtn" data-act="study-blockadd" data-index="' + i + '" data-bindex="' + j + '" title="Add a section above" aria-label="Add a section above"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>' +
      '<button class="iconbtn" data-act="study-blockup" data-index="' + i + '" data-bindex="' + j + '"' + (j === 0 ? " disabled" : "") + ' title="Move up">\u2191</button>' +
      '<button class="iconbtn" data-act="study-blockdown" data-index="' + i + '" data-bindex="' + j + '"' + (j === len - 1 ? " disabled" : "") + ' title="Move down">\u2193</button>' +
      '<button class="iconbtn" data-act="study-blockdup" data-index="' + i + '" data-bindex="' + j + '" title="Duplicate section" aria-label="Duplicate section"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '<button class="iconbtn iconbtn--danger" data-act="study-blockremove" data-index="' + i + '" data-bindex="' + j + '" title="Remove">\u2715</button>' +
      "</span>" +
      '<button class="iconbtn study__block-lock' + (b.locked ? " is-locked" : "") + '" data-act="study-blocklock" data-index="' + i + '" data-bindex="' + j + '" title="' + (b.locked ? "Locked \u2014 click to unlock" : "Lock this section \u2014 deeper-cut only") + '" aria-label="' + (b.locked ? "Unlock section" : "Lock section") + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/>' + (b.locked ? '<path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>' : '<path d="M8 10.5V6.8a4 4 0 0 1 7.5-1.6"/>') + "</svg></button>" +
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
    else if (b.type === "mediagrid") body = sfInput(i, j, "heading", "Heading") + sfSelect(i, j, "gridLayout", "Layout", [["uniform", "Uniform \u2014 equal tiles in a grid"], ["cluster", "Cluster \u2014 staggered, like sticky notes"]], "Uniform lines images up in equal tiles (no cropping \u2014 the extra space shows a mat); cluster staggers them like pinned notes.") + itemRepeater(i, j, b) + '<div class="af__hint">Smaller previews than the slideshow. Use \u201cAdd images\u201d to pick several at once.</div>';
    else if (b.type === "device") {
      var dvc = /^(phone|tablet|laptop|watch)$/.test(b.device) ? b.device : "phone";
      var presetOpts = ({
        phone: [["iphone", "iPhone — 9:19.5"], ["android", "Android — 9:20"], ["landscape", "Landscape — 19.5:9"], ["auto", "Fit the media"]],
        tablet: [["portrait", "Portrait — 3:4"], ["landscape", "Landscape — 4:3"], ["auto", "Fit the media"]],
        laptop: [["wide", "16:10"], ["hd", "16:9"], ["auto", "Fit the media"]],
        watch: [["circle", "Circle"], ["square", "Square"]]
      })[dvc];
      var widthCtl = /^(laptop|tablet)$/.test(dvc) ? sfSelect(i, j, "fill", "Width", [["", "Natural"], ["34", "Three-quarters"], ["full", "Full — end to end"]], "How much of the column the device spans — handy for a laptop hero.") : "";
      body = sfInput(i, j, "heading", "Heading") + '<div class="af__row">' + sfSelect(i, j, "device", "Device", [["phone", "Phone"], ["tablet", "Tablet"], ["laptop", "Laptop"], ["watch", "Watch"]], "") + sfSelect(i, j, "preset", "Screen", presetOpts, "") + "</div>" + widthCtl + itemRepeater(i, j, b) + '<div class="af__hint">Each screen sits in the chosen device. “Fit the media” wraps the frame around whatever you upload (no crop); presets fill the screen. Narrow devices (phone, watch) pack several per row — use “Add images” to add many at once. Tapping a screen on the live page opens it full-screen.</div>';
    }
    else if (b.type === "isolayers") {
      var isoIf = b.mode === "interface";
      var transCtl = isoIf ? sfSelect(i, j, "transparency", "Layer transparency", [["", "Opaque \u2014 keep the PNG as-is"], ["light", "Light"], ["medium", "Medium"], ["strong", "Strong"]], "Interface layers already show their PNG transparency \u2014 reduce it further here.") : "";
      body = sfInput(i, j, "heading", "Heading") +
        '<div class="af__row">' + sfSelect(i, j, "mode", "Type", [["stack", "Screen stack \u2014 opaque layers"], ["interface", "Interface \u2014 transparent UI layers"]], "") + sfSelect(i, j, "dir", "Direction", [["topR", "Top-right"], ["topL", "Top-left"], ["right", "Right"], ["left", "Left"]], "") + "</div>" +
        '<div class="af__row">' + sfSelect(i, j, "distance", "Distance between layers", [["14", "Super tight"], ["24", "Tight"], ["40", "Medium"], ["60", "Roomy"], ["85", "Wide"]], "") + sfSelect(i, j, "depth", "Depth \u2014 slab thickness", [["0", "Flat"], ["4", "Super slim"], ["8", "Slim"], ["14", "Medium"], ["22", "Thick"]], "") + "</div>" +
        '<label class="chk"><input type="checkbox" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="parallax"' + (b.parallax ? " checked" : "") + ' /> Parallax on scroll \u2014 layers start stacked and fan out as the section reaches the centre of the screen</label>' +
        transCtl + '<div class="adm__addbar"><button class="btn btn--add" data-act="iso-import-svg" data-index="' + i + '" data-bindex="' + j + '">+ Import layers from a Figma SVG\u2026</button></div>' + itemRepeater(i, j, b) +
        sfInput(i, j, "caption", "Caption") +
        '<div class="af__hint">One stack per section (max 12 layers), added bottom \u2192 top \u2014 the last layer sits on top. Depth follows each image\u2019s shape, so rounded/transparent PNGs get soft rounded depth. Each layer has an optional <em>Depth override</em> to make just that layer thicker or flatter than the block default. Turn on <em>Parallax</em> and the layers start stacked and fan out to your chosen distance as you scroll the section to the centre of the screen. The height colour auto-derives from each image (or set one \u2014 eyedropper included). Double-click the stack on the live page to open every layer full-screen.</div>';
    }
    else if (b.type === "figure") body = sfInput(i, j, "heading", "Heading") + richBlock(i, j, "body", "Body") + mediaInputBlock(i, j, "src", "Image / video / embed URL") + sfInput(i, j, "caption", "Caption") + '<label class="chk" style="margin-top:.2rem"><input type="checkbox" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="flip"' + (b.flip ? " checked" : "") + " /> Image on the left</label>";
    else if (b.type === "columns" || b.type === "rows") body = sfInput(i, j, "heading", "Heading") + itemRepeater(i, j, b);
    else if (b.type === "workflow") { var wfCycle = b.flow === "cycle"; var stepOpts = (b.items || []).map(function (it, k) { var t = it && it.label ? String(it.label).split("//")[0].trim() : ""; return [String(k + 1), (k + 1) + (t ? ". " + t.slice(0, 22) : "")]; }); if (!stepOpts.length) stepOpts = [["1", "1"]]; var loopCtl = wfCycle ? ('<div class="af__row">' + sfSelect(i, j, "loopFrom", "Loop from step", stepOpts, "") + sfSelect(i, j, "loopTo", "Loop to step", stepOpts, "") + "</div>") : ""; body = sfInput(i, j, "heading", "Heading") + sfSelect(i, j, "flow", "Layout", [["linear", "Linear \u2014 left to right"], ["loop", "Loop \u2014 a repeating cycle"], ["cycle", "Cycle \u2014 loop a range of steps"]], "How the steps connect.") + loopCtl + itemRepeater(i, j, b) + sfInput(i, j, "caption", "Caption") + '<div class="af__hint">' + (wfCycle ? "Cycle keeps the steps in a line and arcs a return loop over the range you pick. Leave it at the full span for a classic \u201cthe whole thing repeats\u201d cycle, or narrow it (e.g. 2 \u2192 3) to loop just those steps." : "Steps flow left to right with arrows. Split a step with <b>//</b> to fork into parallel branches that merge back \u2014 e.g. <em>Design // Eng // Legal</em>.") + "</div>"; }
    else if (b.type === "stickies") body = sfInput(i, j, "heading", "Heading") + sfSelect(i, j, "stickySize", "Note size", [["natural", "Natural \u2014 physical sticky shape (squarish)"], ["uniform", "Uniform \u2014 all notes match the tallest"], ["none", "None \u2014 each note fits its content"]], "Uniform gives every note the tallest note\u2019s height; natural keeps a squarish physical-sticky shape; none lets each note size to its content.") + itemRepeater(i, j, b) + '<div class="af__hint">Cards stagger up and down automatically and lift on hover. Give each a short label (e.g. 01), a heading, a line or two, and an optional image.</div>';
    else if (b.type === "voices") body = sfInput(i, j, "heading", "Heading") + sfSelect(i, j, "mode", "Style", [["verbatim", "Verbatim \u2014 sharp quote bubble"], ["thought", "Thought \u2014 soft bubble"], ["chat", "Chat \u2014 a two-way conversation"]], "Verbatim is a sharp quote bubble, thought a soft one, chat the tighter two-way style. Each voice can sit left or right below.") + sfSelect(i, j, "vsize", "Verbatim heading size", [["", "Standard"], ["lg", "Large"]]) + itemRepeater(i, j, b) + '<div class="af__hint">Side puts each bubble on the left or right \u2014 in Chat, the sides alternate automatically until you set them yourself. Heading only shows on Verbatim. Attribution is the small label under the bubble (e.g. \u201cWhat clients actually said\u201d).</div>';
    else if (b.type === "compare") body = sfInput(i, j, "heading", "Heading") + '<div class="af__row">' + mediaInputBlock(i, j, "beforeSrc", "Before image") + mediaInputBlock(i, j, "afterSrc", "After image") + "</div>" + '<div class="af__row">' + sfInput(i, j, "beforeLabel", "Before label") + sfInput(i, j, "afterLabel", "After label") + "</div>" + richBlock(i, j, "body", "Description below \u2014 what changed", "Both images should be the same size. Visitors drag the divider to compare.");
    else if (b.type === "focus") body = sfInput(i, j, "heading", "Heading") + mediaInputBlock(i, j, "src", "Image to annotate") + focusAnnEditor(i, j, b) + '<label class="chk"><input type="checkbox" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="sticky"' + (b.sticky ? " checked" : "") + ' /> Show annotations as a pill list below the image (number + title, or the description if there\u2019s no title) \u2014 clicking a pill or marker opens its flyout and highlights the matching pill. Full-screen keeps its own list.</label>' + sfInput(i, j, "caption", "Caption");
    else if (b.type === "gen") body = genEditor(i, j, b);
    var hasHeading = /^(text|metrics|steps|media|split|cards|gallery|mediagrid|device|isolayers|figure|columns|rows|compare|stickies|voices|workflow|focus)$/.test(b.type);
    var sizeCtl = (b.type === "statement") ? sfSelect(i, j, "hsize", "Statement size", [["", "Standard"], ["sm", "Compact \u2014 easier to read"], ["lg", "Large \u2014 display"]], "Shrink it if the standard size feels too big for the copy.") : "";
    var sepCtl = '<label class="chk block-sep"><input type="checkbox" data-sblock="' + i + '" data-bindex="' + j + '" data-bfield="sep"' + (b.sep !== false ? " checked" : "") + " /> Separator line above \u2014 uncheck to flow into the previous section</label>";
    return '<div class="card study__block' + (open ? " is-open" : "") + (b.locked ? " is-locked" : "") + '">' + head +
      '<div class="study__block-body">' + sepCtl + common + body + sizeCtl + "</div></div>";
  }
  function smeta(i, field, label, hint, ph) {
    var st = data.work[i].study;
    return '<div class="af"><label class="af__label">' + label + '</label><input type="text" data-study="' + i + '" data-sfield="' + field + '" value="' + escAttr(st[field] || "") + '"' + (ph ? ' placeholder="' + escAttr(ph) + '"' : "") + ' />' + (hint ? '<div class="af__hint">' + escHtml(hint) + "</div>" : "") + "</div>";
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
      case "mediagrid":
        return '<span class="secprev secprev--mediagrid"><span class="sp__gt"></span><span class="sp__gt"></span><span class="sp__gt"></span><span class="sp__gt"></span><span class="sp__gt"></span><span class="sp__gt"></span></span>';
      case "device":
        return '<span class="secprev secprev--device"><span class="sp__dev sp__dev--phone"></span><span class="sp__dev sp__dev--phone"></span><span class="sp__dev sp__dev--laptop"></span></span>';
      case "isolayers":
        return '<span class="secprev secprev--iso"><span class="sp__iso"></span><span class="sp__iso"></span><span class="sp__iso"></span></span>';
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
      case "workflow":
        return '<span class="secprev secprev--workflow"><span class="sp__wf">Review</span><span class="sp__wfa">\u2192</span><span class="sp__wf">Refine</span><span class="sp__wfa">\u2192</span><span class="sp__wf">Align</span><span class="sp__wfa">\u2192</span><span class="sp__wf">Ship</span></span>';
      case "focus":
        return '<span class="secprev secprev--focus"><span class="sp__fa"><span class="sp__fa-box"></span><span class="sp__fa-pin sp__fa-pin--a">+</span><span class="sp__fa-pin sp__fa-pin--b">+</span></span></span>';
      default:
        return '<span class="secprev secprev--text"><span class="sp__kick">Context</span><span class="sp__h">The problem</span><span class="sp__body">A short paragraph that sets up the situation and the stakes.</span><span class="sp__bul">Point one</span><span class="sp__bul">Point two</span></span>';
    }
  }
  /* ---------- Generated sections: isolated "gen" block — visual tree editor + AI generator ---------- */
  function gspec(b) {
    if (!b.spec || typeof b.spec !== "object") b.spec = (window.RKGen ? window.RKGen.blankSpec() : { version: 1, root: { type: "stack", props: {}, children: [] } });
    if (!b.spec.root) b.spec.root = { type: "stack", props: {}, children: [] };
    return b.spec;
  }
  function gParsePath(s) { return String(s == null ? "" : s).split(".").filter(function (x) { return x !== ""; }).map(Number); }
  function gNodeAt(sp, path) { var n = sp.root; for (var k = 0; k < path.length; k++) { if (!n.children || !n.children[path[k]]) return null; n = n.children[path[k]]; } return n; }
  function gParentAt(sp, path) { if (!path.length) return null; var parent = gNodeAt(sp, path.slice(0, -1)); return parent && parent.children ? { parent: parent, idx: path[path.length - 1] } : null; }
  var GEN_CONTAINERS = ["stack", "row", "grid", "split", "card", "section"];
  function gBlank(type) {
    switch (type) {
      case "heading": return { type: "heading", text: "Heading", size: "lg" };
      case "text": return { type: "text", text: "Some copy the reader can edit.", size: "md", tone: "default", align: "left" };
      case "quote": return { type: "quote", text: "A short, memorable quote.", cite: "" };
      case "stat": return { type: "stat", value: "100%", label: "label" };
      case "pill": return { type: "pill", text: "Label", tone: "accent" };
      case "icon": return { type: "icon", name: "spark", size: "md" };
      case "media": return { type: "media", src: "", kind: "image", ratio: "16x9", fit: "cover", caption: "" };
      case "button": return { type: "button", label: "Learn more", href: "" };
      case "divider": return { type: "divider" };
      case "spacer": return { type: "spacer", size: "md" };
      default: return { type: GEN_CONTAINERS.indexOf(type) !== -1 ? type : "stack", props: {}, children: [] };
    }
  }
  function gField(i, j, ps, field, label, value, ph) {
    return '<label class="gsx__f"><span>' + escHtml(label) + '</span><input type="text" data-gpath="' + ps + '" data-gfield="' + field + '" data-index="' + i + '" data-bindex="' + j + '" value="' + escAttr(value || "") + '"' + (ph ? ' placeholder="' + escAttr(ph) + '"' : "") + " /></label>";
  }
  function gArea(i, j, ps, field, label, value) {
    return '<label class="gsx__f gsx__f--area"><span>' + escHtml(label) + '</span><textarea rows="2" data-gpath="' + ps + '" data-gfield="' + field + '" data-index="' + i + '" data-bindex="' + j + '">' + escHtml(value || "") + "</textarea></label>";
  }
  function gSel(i, j, ps, field, label, opts, value) {
    return '<label class="gsx__f gsx__f--sel"><span>' + escHtml(label) + '</span><select data-gpath="' + ps + '" data-gfield="' + field + '" data-index="' + i + '" data-bindex="' + j + '">' + opts.map(function (o) { return '<option value="' + escAttr(o[0]) + '"' + (String(value) === String(o[0]) ? " selected" : "") + ">" + escHtml(o[1]) + "</option>"; }).join("") + "</select></label>";
  }
  var GEN_SIZ = [["sm", "S"], ["md", "M"], ["lg", "L"], ["xl", "XL"]];
  var GEN_TON = [["default", "Default"], ["dim", "Dim"], ["faint", "Faint"], ["accent", "Accent"]];
  var GEN_ALN = [["left", "Left"], ["center", "Center"], ["right", "Right"]];
  function genLeafFields(n, ps, i, j) {
    switch (n.type) {
      case "heading": return gField(i, j, ps, "text", "Text", n.text) + gSel(i, j, ps, "size", "Size", GEN_SIZ, n.size || "lg");
      case "text": return gArea(i, j, ps, "text", "Text \u2014 **bold** *italic* [link](url)", n.text) + '<div class="gsx__row3">' + gSel(i, j, ps, "size", "Size", GEN_SIZ, n.size || "md") + gSel(i, j, ps, "tone", "Tone", GEN_TON, n.tone || "default") + gSel(i, j, ps, "align", "Align", GEN_ALN, n.align || "left") + "</div>";
      case "quote": return gArea(i, j, ps, "text", "Quote", n.text) + gField(i, j, ps, "cite", "Attribution", n.cite);
      case "stat": return '<div class="gsx__row2">' + gField(i, j, ps, "value", "Value", n.value, "689M+") + gField(i, j, ps, "label", "Label", n.label, "accounts") + "</div>";
      case "pill": return gField(i, j, ps, "text", "Text", n.text) + gSel(i, j, ps, "tone", "Tone", GEN_TON, n.tone || "accent");
      case "icon": return gField(i, j, ps, "name", "Icon", n.name, "spark, chart, target, shield\u2026") + gSel(i, j, ps, "size", "Size", GEN_SIZ, n.size || "md");
      case "media": return gField(i, j, ps, "src", "Media URL", n.src, "paste a URL, or upload \u2192") + '<div class="gsx__up"><button class="btn btn--ghost" data-act="gen-upload" data-gpath="' + ps + '" data-index="' + i + '" data-bindex="' + j + '">Upload\u2026</button></div>' + '<div class="gsx__row3">' + gSel(i, j, ps, "kind", "Kind", [["image", "Image"], ["video", "Video"], ["embed", "Embed"]], n.kind || "image") + gSel(i, j, ps, "ratio", "Ratio", [["16x9", "16:9"], ["4x3", "4:3"], ["1x1", "1:1"], ["3x2", "3:2"], ["3x4", "3:4"], ["9x16", "9:16"], ["auto", "Auto"]], n.ratio || "16x9") + gSel(i, j, ps, "fit", "Fit", [["cover", "Cover"], ["contain", "Contain"]], n.fit || "cover") + "</div>" + gField(i, j, ps, "caption", "Caption", n.caption);
      case "button": return '<div class="gsx__row2">' + gField(i, j, ps, "label", "Label", n.label) + gField(i, j, ps, "href", "Link URL", n.href) + "</div>";
      case "spacer": return gSel(i, j, ps, "size", "Size", GEN_SIZ, n.size || "md");
      case "divider": return '<div class="gsx__mini">A thin divider line.</div>';
    }
    return "";
  }
  function genNode(node, path, i, j) {
    var ps = path.join(".");
    var isRoot = path.length === 0;
    var isCont = GEN_CONTAINERS.indexOf(node.type) !== -1;
    var ops = isRoot ? "" : '<span class="gsx__ops">' +
      '<button class="iconbtn" data-act="gen-up" data-gpath="' + ps + '" data-index="' + i + '" data-bindex="' + j + '" title="Move up">\u2191</button>' +
      '<button class="iconbtn" data-act="gen-down" data-gpath="' + ps + '" data-index="' + i + '" data-bindex="' + j + '" title="Move down">\u2193</button>' +
      '<button class="iconbtn iconbtn--danger" data-act="gen-del" data-gpath="' + ps + '" data-index="' + i + '" data-bindex="' + j + '" title="Remove">\u2715</button></span>';
    var body;
    if (isCont) {
      var p = node.props || {};
      var props = '<div class="gsx__props">' +
        gSel(i, j, ps, "type", "Layout", [["stack", "Stack"], ["row", "Row"], ["grid", "Grid"], ["split", "Split"], ["card", "Card"], ["section", "Section"]], node.type) +
        gSel(i, j, ps, "props.gap", "Gap", [["none", "None"], ["sm", "S"], ["md", "M"], ["lg", "L"], ["xl", "XL"]], p.gap || "md") +
        gSel(i, j, ps, "props.align", "Align", GEN_ALN, p.align || "left") +
        (node.type === "grid" ? gSel(i, j, ps, "props.cols", "Cols", [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]], p.cols || 2) : "") +
        gSel(i, j, ps, "props.pad", "Pad", [["none", "None"], ["sm", "S"], ["md", "M"], ["lg", "L"]], p.pad || "none") +
        gSel(i, j, ps, "props.bg", "Panel", [["none", "None"], ["elev", "Elevated"], ["line", "Panel"], ["accent", "Accent"]], p.bg || "none") +
        "</div>";
      var kids = (node.children || []).map(function (c, ci) { return genNode(c, path.concat(ci), i, j); }).join("");
      var addOpts = [["text", "Text"], ["heading", "Heading"], ["stat", "Stat"], ["media", "Media"], ["quote", "Quote"], ["pill", "Pill"], ["icon", "Icon"], ["button", "Button"], ["divider", "Divider"], ["spacer", "Spacer"], ["stack", "Stack"], ["row", "Row"], ["grid", "Grid"], ["split", "Split"], ["card", "Card"]];
      var addbar = '<div class="gsx__add"><select class="gsx__addsel">' + addOpts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("") + '</select><button class="btn btn--add" data-act="gen-add" data-gpath="' + ps + '" data-index="' + i + '" data-bindex="' + j + '">+ Add</button></div>';
      body = props + '<div class="gsx__kids">' + (kids || '<div class="gsx__empty">Empty \u2014 add a block below.</div>') + "</div>" + addbar;
    } else {
      body = '<div class="gsx__fields">' + genLeafFields(node, ps, i, j) + "</div>";
    }
    return '<div class="gsx__node gsx__node--' + (isCont ? "cont" : "leaf") + '"><div class="gsx__nhead"><span class="gsx__badge">' + escHtml(node.type) + "</span>" + ops + "</div>" + body + genStyleField(node, ps, i, j) + "</div>";
  }
  function genStyleField(node, ps, i, j) {
    return '<details class="gsx__style"' + (node.style ? " open" : "") + '><summary>Style - on-brand custom CSS (materials, 3D)</summary><textarea rows="2" data-gpath="' + ps + '" data-gfield="style" data-index="' + i + '" data-bindex="' + j + '" placeholder="border-radius: 28px; box-shadow: 18px 18px 40px rgba(0,0,0,.5), inset 0 1px 2px rgba(255,255,255,.12); background: linear-gradient(145deg, var(--bg-elev), var(--bg));">' + escHtml(node.style || "") + "</textarea></details>";
  }
  function genEditor(i, j, b) {
    var sp = gspec(b);
    return '<div class="gsx">' +
      '<div class="gsx__bar"><input class="gsx__name" type="text" data-gen-name data-index="' + i + '" data-bindex="' + j + '" value="' + escAttr(b.name || "") + '" placeholder="Section name (only you see this)" />' +
      '<button class="btn btn--auto" data-act="gen-refine" data-index="' + i + '" data-bindex="' + j + '">\u2728 Refine with AI</button></div>' +
      sfInput(i, j, "heading", "Heading (optional \u2014 shown above the section)") +
      '<div class="gsx__tree">' + genNode(sp.root, [], i, j) + "</div>" +
      '<div class="af__hint">Built from safe layout blocks \u2014 edit any field live, add / reorder / remove blocks, or hit \u2728 Refine to change it with AI. Nothing here runs code.</div>' +
      "</div>";
  }
  function onGenEdit(t) {
    var i = +t.dataset.index, j = +t.dataset.bindex;
    var b = data.work[i] && data.work[i].study && data.work[i].study.blocks[j];
    if (!b) return;
    if (t.dataset.genName !== undefined) { b.name = t.value; saveDraft(); refreshL2Preview(); return; }
    var sp = gspec(b), node = gNodeAt(sp, gParsePath(t.dataset.gpath));
    if (!node) return;
    var f = t.dataset.gfield;
    if (f.indexOf("props.") === 0) { node.props = node.props || {}; node.props[f.slice(6)] = t.value; saveDraft(); refreshL2Preview(); return; }
    if (f === "type") { node.type = t.value; saveDraft(); renderL2(); return; }
    node[f] = t.value; saveDraft(); refreshL2Preview();
  }
  function genAction(act, el) {
    var i = +el.dataset.index, j = +el.dataset.bindex;
    var blk = data.work[i] && data.work[i].study && data.work[i].study.blocks[j];
    if (!blk) return;
    if (act === "gen-refine") { genModal(i, { editJ: j, seedSpec: blk.spec, seedName: blk.name }); return; }
    var sp = gspec(blk), path = gParsePath(el.dataset.gpath);
    if (act === "gen-add") {
      var container = gNodeAt(sp, path) || sp.root;
      var sel = el.closest(".gsx__add") && el.closest(".gsx__add").querySelector(".gsx__addsel");
      container.children = container.children || [];
      container.children.push(gBlank(sel ? sel.value : "text"));
      saveDraft(true); renderL2(); return;
    }
    if (act === "gen-upload") {
      var mnode = gNodeAt(sp, path); if (!mnode) return;
      pickMedia(function (uri) { mnode.src = uri; if (/^data:video|\.(mp4|webm|mov|m4v|ogv)($|\?)/i.test(uri)) mnode.kind = "video"; saveDraft(true); renderL2(); });
      return;
    }
    var pr = gParentAt(sp, path); if (!pr) return;
    if (act === "gen-del") { pr.parent.children.splice(pr.idx, 1); saveDraft(true); renderL2(); return; }
    if (act === "gen-up" && pr.idx > 0) { var a = pr.parent.children, x = a[pr.idx - 1]; a[pr.idx - 1] = a[pr.idx]; a[pr.idx] = x; saveDraft(true); renderL2(); return; }
    if (act === "gen-down" && pr.idx < pr.parent.children.length - 1) { var a2 = pr.parent.children, y = a2[pr.idx + 1]; a2[pr.idx + 1] = a2[pr.idx]; a2[pr.idx] = y; saveDraft(true); renderL2(); return; }
  }
  function genSystem() {
    return [
      "You are a senior product designer composing ONE section for a dark, editorial, restrained portfolio case-study page. You can build ANY kind of UI - a device mockup, a sticky-note wall, a glass panel, a stat band, a testimonial row - but it MUST feel native to THIS site.",
      "SITE LOOK & FEEL - obey it. Use these CSS variables in style values, do NOT hardcode brand colours: --bg (#08080a), --bg-2, --bg-elev (near-black surfaces); --text (warm ivory), --text-dim, --text-faint (muted); --accent (ONE bronze ~#D8A657, used sparingly); --line / --line-soft (hairline borders); --serif (Fraunces display serif, for headings), --mono (JetBrains Mono, for tiny labels). Body copy is a clean sans. Generous whitespace, soft radii, quiet high craft. Never garish, never bright/primary colours.",
      "So: text colours = var(--text)/var(--text-dim)/var(--accent); surfaces = var(--bg-elev) or subtle gradients between the bg vars; borders = 1px solid var(--line); clay/soft shadows use rgba(0,0,0,...) plus faint white or accent highlights. A generated component should look like it always belonged on the site.",
      window.RKGen.describe(),
      "Match the user's prompt and any reference image in STRUCTURE and INTENT. Write tight, believable placeholder copy the author edits. Leave media src EMPTY (the author adds visuals). One focused, on-brand section. Return the JSON object only."
    ].join("\n\n");
  }
  function genPickerCards() {
    var presets = ((data && data.genSections) || []).map(function (p) {
      return '<button type="button" class="secpick__preset" data-gen-preset="' + escAttr(p.id) + '">' +
        '<span class="secpick__preset-prev">' + (window.RKGen ? window.RKGen.renderHtml(p.spec) : "") + "</span>" +
        '<span class="secpick__preset-name">' + escHtml(p.name || "Section") + "</span>" +
        '<button type="button" class="secpick__preset-del" data-gen-preset-del="' + escAttr(p.id) + '" title="Delete">\u2715</button></button>';
    }).join("");
    return '<div class="secpick__gen">' +
      '<button type="button" class="secpick__gencard" data-gen-new><span class="secpick__genic">\u2728</span><span class="secpick__gentx"><b>Generate a section</b><span>Describe it or drop a reference image \u2014 AI builds it, you preview &amp; approve. Added as its own block; your other sections are untouched.</span></span></button>' +
      (presets ? '<div class="secpick__presets"><div class="secpick__presets-h">Your generated sections</div><div class="secpick__presets-grid">' + presets + "</div></div>" : "") +
      "</div>";
  }
  function genModal(i, opts) {
    opts = opts || {};
    var editJ = (opts.editJ != null) ? opts.editJ : null;
    var imgs = [];
    var curSpec = opts.seedSpec ? window.RKGen.clean(opts.seedSpec) : null;
    var modal = document.createElement("div");
    modal.className = "pass pass--wide gen-modal";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">' + (editJ != null ? "Refine this section" : "Generate a section") + "</div>" +
      '<div class="pass__sub">Describe the section and optionally drop reference images. AI proposes a layout from safe building blocks \u2014 preview it, then ' + (editJ != null ? "apply" : "add") + " it. No code is generated or run.</div>" +
      '<textarea class="gen__prompt" id="genPrompt" rows="3" placeholder="e.g. A testimonial wall \u2014 three quote cards in a row, each with a name and role, on a subtle panel."></textarea>' +
      '<div class="gen__imgs"><label class="btn btn--ghost">Add reference image\u2026<input type="file" accept="image/*" multiple hidden class="gen__file" /></label><div class="gen__thumbs"></div></div>' +
      '<div class="gen__err pass__err"></div>' +
      '<div class="gen__stage"></div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Close</button><button class="btn btn--primary" data-gen-run>\u2728 Generate</button></div></div>';
    document.body.appendChild(modal);
    var stage = modal.querySelector(".gen__stage"), errEl = modal.querySelector(".gen__err"), thumbs = modal.querySelector(".gen__thumbs");
    var onKey = function (e) { if (e.key === "Escape") close(); };
    var close = function () { modal.remove(); document.removeEventListener("keydown", onKey); };
    document.addEventListener("keydown", onKey);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    modal.querySelector("[data-cancel]").addEventListener("click", close);
    function renderThumbs() {
      thumbs.innerHTML = "";
      imgs.forEach(function (u, k) {
        var s = document.createElement("span"); s.className = "gen__thumb";
        var im = document.createElement("img"); im.src = u; s.appendChild(im);
        var x = document.createElement("button"); x.textContent = "\u2715"; x.addEventListener("click", function () { imgs.splice(k, 1); renderThumbs(); });
        s.appendChild(x); thumbs.appendChild(s);
      });
    }
    modal.querySelector(".gen__file").addEventListener("change", function (e) {
      [].forEach.call(e.target.files, function (f) { var r = new FileReader(); r.onload = function () { imgs.push(r.result); renderThumbs(); }; r.readAsDataURL(f); });
      e.target.value = "";
    });
    function renderStage() {
      if (!curSpec) { stage.innerHTML = ""; return; }
      stage.innerHTML =
        '<div class="gen__result"><div class="gen__prevhead">Preview</div>' +
        '<div class="gen__preview">' + window.RKGen.renderHtml(curSpec) + "</div>" +
        '<div class="gen__save"><input type="text" class="gen__name" id="genName" placeholder="Name this section" value="' + escAttr(opts.seedName || "") + '" />' +
        (editJ != null
          ? '<button class="btn btn--primary" data-gen-apply>Apply to this section</button>'
          : '<button class="btn btn--primary" data-gen-insert>Add to this study</button><button class="btn btn--ghost" data-gen-savepreset>Save as reusable section</button>') +
        "</div></div>";
      if (window.RKGen && RKGen.hydrate) RKGen.hydrate(stage); // let the author test drag/zoom right in the preview
      var ap = stage.querySelector("[data-gen-apply]");
      if (ap) ap.addEventListener("click", function () {
        var b = data.work[i].study.blocks[editJ]; if (b) { b.spec = curSpec; var nm = (modal.querySelector("#genName").value || "").trim(); if (nm) b.name = nm; saveDraft(true); renderL2(); status("Section updated.", true); } close();
      });
      var ins = stage.querySelector("[data-gen-insert]");
      if (ins) ins.addEventListener("click", function () {
        var nm = ((modal.querySelector("#genName").value || "").trim()) || "Section";
        var st = data.work[i].study || (data.work[i].study = blankStudy()); st.blocks = st.blocks || [];
        var block = blankBlock("gen"); block.spec = curSpec; block.name = nm; block.nav = nm;
        var pos; if (opts.above) { pos = Math.max(0, Math.min(opts.at, st.blocks.length)); st.blocks.splice(pos, 0, block); } else { st.blocks.push(block); pos = st.blocks.length - 1; }
        openBlock = pos; close(); saveDraft(true); renderL2(); status("Added your generated section \u2014 edit it below.", true);
      });
      var sv = stage.querySelector("[data-gen-savepreset]");
      if (sv) sv.addEventListener("click", function () {
        var nm = ((modal.querySelector("#genName").value || "").trim()) || "Section";
        data.genSections = data.genSections || []; data.genSections.push({ id: "g" + Date.now(), name: nm, spec: curSpec, createdAt: Date.now() });
        saveDraft(true); sv.textContent = "Saved \u2713"; sv.disabled = true; status("Saved \u2014 it\u2019s now in your Add-section dialog.", true);
      });
    }
    modal.querySelector("[data-gen-run]").addEventListener("click", async function (e) {
      var prompt = (modal.querySelector("#genPrompt").value || "").trim();
      if (!prompt && !imgs.length && !curSpec) { errEl.textContent = "Describe the section, or add a reference image."; return; }
      if (!aiHasKey("txt")) { aiKeyModal("txt", function () {}); return; }
      var btn = e.currentTarget, was = btnBusy(btn, "Generating\u2026"); errEl.textContent = "";
      try {
        var cfg = aiCfg("txt");
        var userText = "Section brief:\n" + (prompt || "(see reference image)") + (curSpec ? "\n\nRefine this existing layout (JSON):\n" + JSON.stringify(curSpec.root) : "");
        var user;
        if (imgs.length && /^(openai|custom)$/.test(cfg.provider)) user = [{ type: "text", text: userText }].concat(imgs.map(function (u) { return { type: "image_url", image_url: { url: u } }; }));
        else if (imgs.length && cfg.provider === "anthropic") user = [{ type: "text", text: userText }].concat(imgs.map(function (u) { var c = u.indexOf(","); var mt = u.slice(5, c).split(";")[0]; return c > 0 ? { type: "image", source: { type: "base64", media_type: mt || "image/png", data: u.slice(c + 1) } } : null; }).filter(Boolean));
        else user = userText + (imgs.length ? "\n\n(Reference image supplied; this provider reads text only, using the brief.)" : "");
        var parsed = csgenParse(await aiText(cfg, genSystem(), user, { json: true, maxTokens: 2200, temperature: 0.55 }));
        if (!parsed) throw new Error("The AI didn\u2019t return a valid layout \u2014 try rephrasing.");
        curSpec = window.RKGen.clean(parsed);
        if (window.RKGen.isEmpty(curSpec)) throw new Error("Came back empty \u2014 add detail and retry.");
        renderStage();
      } catch (err) { errEl.textContent = err.message || String(err); }
      finally { btnIdle(btn, was); }
    });
    if (curSpec) renderStage();
  }

  function sectionPicker(i, at) {
    var above = typeof at === "number" && at >= 0;
    var modal = document.createElement("div");
    modal.className = "pass pass--wide secpick";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">' + (above ? "Add a section above" : "Add a section") + "</div>" +
      '<div class="pass__sub">Pick the layout that fits your content \u2014 this is how each one looks on your live page.</div>' +
      genPickerCards() +
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
        var pos;
        if (above) { pos = Math.max(0, Math.min(at, st.blocks.length)); st.blocks.splice(pos, 0, blankBlock(type)); }
        else { st.blocks.push(blankBlock(type)); pos = st.blocks.length - 1; }
        openBlock = pos;
        close();
        saveDraft(true); renderL2();
        var meta = SECTION_GALLERY.filter(function (x) { return x.type === type; })[0] || { name: type };
        status("Added a \u201c" + meta.name + "\u201d section \u2014 fill it in below.", true);
      });
    });
    var gnew = modal.querySelector("[data-gen-new]");
    if (gnew) gnew.addEventListener("click", function () { close(); genModal(i, { above: above, at: at }); });
    modal.querySelectorAll("[data-gen-preset]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        if (e.target.closest("[data-gen-preset-del]")) return;
        var id = btn.getAttribute("data-gen-preset");
        var pr = ((data.genSections) || []).filter(function (x) { return x.id === id; })[0];
        if (!pr) return;
        var st = data.work[i].study || (data.work[i].study = blankStudy()); st.blocks = st.blocks || [];
        var block = blankBlock("gen"); block.spec = JSON.parse(JSON.stringify(pr.spec)); block.name = pr.name; block.nav = pr.name;
        var pos; if (above) { pos = Math.max(0, Math.min(at, st.blocks.length)); st.blocks.splice(pos, 0, block); } else { st.blocks.push(block); pos = st.blocks.length - 1; }
        openBlock = pos; close(); saveDraft(true); renderL2(); status("Added \u201c" + (pr.name || "section") + "\u201d.", true);
      });
    });
    modal.querySelectorAll("[data-gen-preset-del]").forEach(function (x) {
      x.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = x.getAttribute("data-gen-preset-del");
        data.genSections = ((data.genSections) || []).filter(function (p) { return p.id !== id; });
        saveDraft(true);
        var card = x.closest(".secpick__preset"); if (card) card.remove();
        status("Removed from your sections.");
      });
    });
  }
  // ---------- AI-generated Skim: read the whole case, distil an impact-first, visual-forward highlight reel ----------
  function skimGather(w, includeLocked) {
    var st = w.study || {}, media = [], seen = {};
    function add(src, caption) { if (src && typeof src === "string" && !seen[src] && media.length < 40) { seen[src] = 1; media.push({ src: src, caption: caption || "" }); } }
    function walk(node) { if (!node || typeof node !== "object") return; if (Array.isArray(node)) { node.forEach(walk); return; } if (typeof node.src === "string") add(node.src, node.caption); for (var k in node) { var v = node[k]; if (v && typeof v === "object") walk(v); } }
    function sm(s) { return String(s == null ? "" : s).replace(/<[^>]+>/g, " ").replace(/\[\[|\]\]|\*\*|\*/g, "").replace(/\s+/g, " ").trim(); }
    function arr(x) { return Array.isArray(x) ? x : []; }
    function colText(val, label) {
      var push = function (v) { var t = sm(v); if (t) lines.push((label ? sm(label) + ": " : "") + t); };
      if (Array.isArray(val)) val.forEach(push); else if (val) push(val);
    }
    add((st.cover && typeof st.cover === "object") ? st.cover.src : st.cover, "cover");
    add(w.image, "");
    var lines = ["TITLE: " + (w.title || "")];
    if (st.tagline) lines.push("TAGLINE: " + sm(st.tagline));
    var meta = [st.role && ("Role " + st.role), st.team && ("Team " + st.team), (st.timeline || w.period) && ("Timeline " + (st.timeline || w.period)), st.scope && ("Scope " + st.scope)].filter(Boolean);
    if (meta.length) lines.push("META: " + meta.join(" \u00b7 "));
    arr(st.blocks).forEach(function (b) {
      if (!b || b.encStub) return;
      if (b.locked && !includeLocked) return;
      walk(b);
      // media that lives on bare string fields (before/after + split images), not caught by walk()
      add(b.beforeSrc, sm(b.beforeLabel || b.heading || ""));
      add(b.afterSrc, sm(b.afterLabel || b.heading || ""));
      add(b.leftImg, sm(b.leftLabel || ""));
      add(b.rightImg, sm(b.rightLabel || ""));
      if (b.kicker) lines.push("(" + sm(b.kicker) + ")");
      if (b.heading) lines.push("## " + sm(b.heading));
      if (b.body) lines.push(sm(b.body));
      if (b.sub) lines.push(sm(b.sub));
      arr(b.list).forEach(function (x) { var t = sm(x); if (t) lines.push("- " + t); });
      arr(b.items).forEach(function (m) {
        if (!m || typeof m !== "object") { var mt = sm(m); if (mt) lines.push("- " + mt); return; }
        if (b.type === "metrics") lines.push("METRIC: " + (m.value || "") + " \u2014 " + (m.label || ""));
        else if (b.type === "steps") lines.push("STEP: " + (m.title || "") + " \u2014 " + sm(m.body || ""));
        else if (b.type === "faq") lines.push("Q: " + (m.q || "") + " / A: " + sm(m.a || ""));
        else if (m.caption) lines.push("[image: " + sm(m.caption) + "]");
      });
      colText(b.left, b.leftLabel);
      colText(b.right, b.rightLabel);
    });
    return { text: lines.join("\n"), media: media };
  }
  // Instance-only: deep-clone the work with locked sections decrypted (vault + .enc) so AI/vision can
  // read the full project. Never persisted — the real draft stays locked. null = user cancelled/failed.
  async function skimUnlockedClone(w) {
    var clone;
    try { clone = JSON.parse(JSON.stringify(w)); } catch (e) { return null; }
    var st = clone.study; if (!st || !Array.isArray(st.blocks)) return clone;
    var wrap = st.enc && st.enc.wraps && st.enc.wraps.owner;
    var hasVault = st.blocks.some(function (b) { return b && b.locked && b.vaultBlock; });
    if (hasVault && typeof adminSession === "function" && adminSession()) {
      try {
        for (var k = 0; k < st.blocks.length; k++) {
          var bk = st.blocks[k];
          if (bk && bk.locked && bk.vaultBlock) {
            var url = await vaultSignedUrl(bk.vaultBlock);
            if (url) { var full = await (await fetch(url)).json(); if (full && typeof full === "object") { full.locked = true; st.blocks[k] = full; } }
          }
        }
      } catch (e) {}
    }
    if (wrap) {
      var recovery = await ensureRecoveryPass();
      if (recovery === null) return null;
      var sek;
      try { sek = await rkUnwrapSek(recovery, wrap); }
      catch (e) { recoveryPassCache = null; status("That recovery passphrase didn’t unlock this project."); return null; }
      try {
        for (var m = 0; m < st.blocks.length; m++) { var bb = st.blocks[m]; if (bb && bb.encStub && bb.iv && bb.ct) { st.blocks[m] = await rkDecWithSek(sek, bb); await rkResolveEncToDataUri(st.blocks[m], sek); } }
      } catch (e) {}
    }
    return clone;
  }
  async function skimGenerate(i, btn) {
    var w = data.work[i];
    if (!w || !w.study) { status("Add some case-study sections first."); return; }
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { skimGenerate(i, btn); }); return; }
    var srcW = w, includeLocked = false;
    var lockedN = (w.study.blocks || []).filter(function (b) { return b && b.locked; }).length;
    if (lockedN) {
      includeLocked = await confirmModal({ title: "Include your locked sections?", sub: "Let the AI + vision read your " + lockedN + " locked section" + (lockedN > 1 ? "s" : "") + " so the key moves capture the full project. Used only for this run \u2014 nothing is saved unlocked. The moves may reference locked details, so review them before you publish.", cancel: "Public only", cta: "Include locked" });
      if (includeLocked) { var uc = await skimUnlockedClone(w); if (uc) srcW = uc; else includeLocked = false; }
    }
    var g;
    try { g = skimGather(srcW, includeLocked); } catch (e) { status("Couldn\u2019t read this case study: " + ((e && e.message) || "error")); return; }
    if (!g.text || g.text.length < 60) { status("Not enough case content to skim yet \u2014 add a few sections first."); return; }
    if (btn) { btn.disabled = true; btn.textContent = "Reading the case\u2026"; }
    status("Reading the case & finding the key moves\u2026");
    var cfg = aiCfg("txt");
    // Optional vision grounding: let the model SEE the case screens so the moves stay concrete + accurate.
    // Fully graceful - any failure (no vision model, CORS, error) falls back to text-only silently.
    var visualNote = "", groundedN = 0;
    try {
      if (g.media && g.media.length && ((AI_VISION_MODEL[cfg.provider] || []).length || (cfg.provider === "custom" && cfg.model))) {
        status("Looking at the case screens\u2026");
        var enr = await visionEnrich(cfg, g.media.slice(0, 12));
        var vseen = {}, vlines = [];
        g.media.forEach(function (m) { var v = enr && enr[m.src]; if (v && v.ux && v.desc && !vseen[v.desc]) { vseen[v.desc] = 1; vlines.push("- " + v.desc + (m.caption ? " (" + m.caption + ")" : "")); } });
        groundedN = vlines.length;
        if (vlines.length) visualNote = "\n\nWHAT THE CASE SCREENS SHOW (seen by vision - GROUND the moves in these real screens; name the actual controls & surfaces you see, not abstractions):\n" + vlines.slice(0, 16).join("\n");
      }
    } catch (e) { visualNote = ""; }
    status("Writing the key moves\u2026");
    var system = "You are a senior product-design portfolio editor writing the 'Key Moves' of a case study as a SKIM for a time-pressed hiring manager - three glance-able cards they grasp in five seconds, NOT a summary they read. Each line is a HEADLINE: telegraphic, low-verbosity, concrete and specific. LEAD WITH THE KEY THING - the result, the artifact, the surface or the number - so the eye catches it first, and cut every word that isn't pulling weight (articles, filler, connective tissue). Name the real thing - the actual control, surface, flow or artifact on the screen - never an abstract paraphrase. Use ONLY facts and media from the case; never invent numbers. Three short parts per move: problem = the tension as a short tag - what was wrong on the screen or in the flow; move = a headline for the decision, leading with the specific thing you built or changed, NOT a full sentence; outcome = the payoff in a crisp phrase - a metric, a shift, or the systems it now serves. Present tense for what is now true; zero filler adjectives. FORMATTING (a restrained finish - the bronze accent is a SPOTLIGHT, not a highlighter): across the WHOLE set, wrap AT MOST ONE genuinely coined artifact - a proper noun you could trademark, like [[Context Object]] - in [[double brackets]]; zero if nothing is truly coined; NEVER a verb phrase, concept or generic descriptor. You may bold ONE pivotal word or short list with **double asterisks** in a single outcome line; never format the problem line. Order moves strongest-first. Return STRICT JSON only, no prose.";
    var user = "CASE STUDY:\n" + g.text + visualNote +
      "\n\nWrite 2-3 Key Moves for THIS case as a SKIM - three headlines a recruiter grasps at a glance, never full summary sentences. GROUND every line in what the case and its screens actually show; if the notes above name a real control or surface (a 'more choices' menu, a consent dialog, a setup flow), use THAT concrete detail. Match the PUNCH, brevity and rhythm of this example - copy the STYLE, never the words:" +
      "\n{\"beats\":[" +
      "\n {\"problem\":\"Trust buried in dense dialog text\",\"move\":\"One [[Context Object]] for identity, destination & intent\",\"outcome\":\"People see what they're approving, before authenticating\"}," +
      "\n {\"problem\":\"A 'more choices' menu stole focus\",\"move\":\"Authentication the hero; controls stay secondary\",\"outcome\":\"Confidence first - auth stays the primary job\"}," +
      "\n {\"problem\":\"Every scenario was a bespoke screen\",\"move\":\"One reusable framework for every scenario\",\"outcome\":\"Scales across **Passkeys, UAC, Remote Desktop & Store**\"}" +
      "\n]}" +
      "\n\nRules: SKIM, don't summarize - each line is a HEADLINE grasped in a second, not a sentence you read. LEAD WITH THE KEY THING and cut connective tissue: 'Condensed identity, intent and destination into one Context Object' -> 'One Context Object for identity, intent & destination'. CONCRETE beats abstract - name the real surface you can see ('a more choices menu', NOT 'context's prominence competed'). Say 'People', not 'Users'. Present tense (stay/remains/see/scales, never stayed/remained). No filler adjectives ('dialog text' not 'dense, unreadable dialog text'). Name things plainly ('reusable framework' beats 'Credential UX architecture'). problem <= 7 words, move <= 9 words, outcome <= 8 words - shorter is better; the caps are the MAX, aim well under. Write moves true to THIS case - never reuse the example's words. FORMATTING: at most ONE [[coined artifact]] across all moves (the example accents only move 1; the others are plain concepts with no accent); zero if nothing is truly coined; never accent a verb phrase. Bold one pivotal word or short list in a single outcome line; never the problem line. Return STRICT JSON {\"beats\":[{\"problem\":\"\",\"move\":\"\",\"outcome\":\"\"}]} only.";
    try {
      var out = await aiText(aiCfg("txt"), system, user, { maxTokens: 1500, temperature: 0.4, json: true });
      var j = csgenParse(out);
      var beats = (j && Array.isArray(j.beats) ? j.beats : []).filter(function (b) { return b && (b.problem || b.move || b.outcome); }).slice(0, 3).map(function (b) { return { problem: String(b.problem || "").trim(), move: String(b.move || "").trim(), outcome: String(b.outcome || "").trim() }; });
      if (!beats.length) { status("The AI didn\u2019t return usable key moves \u2014 try again."); if (btn) { btn.disabled = false; btn.textContent = "\u2728 Generate Key Moves"; } return; }
      w.study.skim = w.study.skim || {};
      w.study.skim.beats = beats;
      w.study.skim.generatedAt = Date.now();
      saveDraft(true);
      if (btn) { btn.disabled = false; btn.textContent = "\u2728 Generate Key Moves"; }
      status("Key moves generated \u2014 " + beats.length + " card" + (beats.length > 1 ? "s" : "") + (groundedN ? " \u00b7 grounded in " + groundedN + " screen" + (groundedN > 1 ? "s" : "") : " \u00b7 from text only \u2014 add screens or a vision-capable text model for sharper, screen-grounded moves") + ". They show at the top of the case.", true);
      if (openStudy === i) renderL2();
    } catch (e) { status("Key moves generation failed: " + ((e && e.message) || "error")); if (btn) { btn.disabled = false; btn.textContent = "\u2728 Generate Key Moves"; } }
  }
  function beatEditor(i, b, j) {
    return '<div class="adm__beat"><div class="adm__beat-h"><span class="adm__beat-n">' + (j + 1) + '</span> Key move ' + (j + 1) + '<button type="button" class="adm__beat-x" data-act="beat-remove" data-index="' + i + '" data-bindex="' + j + '" title="Remove this key move" aria-label="Remove key move ' + (j + 1) + '">\u2715</button></div>' +
      '<input type="text" class="adm__beat-f" data-beat="' + i + '" data-bindex="' + j + '" data-bkey="problem" value="' + escAttr(b.problem || "") + '" placeholder="Problem \u2014 the tension, in a few words" />' +
      '<textarea class="adm__beat-f" rows="2" data-beat="' + i + '" data-bindex="' + j + '" data-bkey="move" placeholder="Move \u2014 the decision you made">' + escHtml(b.move || "") + '</textarea>' +
      '<input type="text" class="adm__beat-f" data-beat="' + i + '" data-bindex="' + j + '" data-bkey="outcome" value="' + escAttr(b.outcome || "") + '" placeholder="Outcome \u2014 the concrete result" />' +
      '</div>';
  }
  function ovmArr(i) { var w = data.work[i]; return w && w.study && w.study.skim && Array.isArray(w.study.skim.media) ? w.study.skim.media : null; }
  function ovmItem(i, m, j, n) {
    var src = m.src || "";
    var thumb = src ? (isVideoVal(src) ? '<video src="' + escAttr(previewSrc(src)) + '" muted></video>' : '<img src="' + escAttr(previewSrc(src)) + '" alt="" />') : '<span class="adm__ovm-empty">empty</span>';
    return '<div class="adm__ovm">' +
      '<div class="adm__ovm-h"><span class="adm__ovm-n">' + (j + 1) + '</span>' +
        '<div class="adm__ovm-ops">' +
          '<button type="button" data-act="ovm-up" data-index="' + i + '" data-ovmindex="' + j + '"' + (j === 0 ? " disabled" : "") + ' title="Move up">\u2191</button>' +
          '<button type="button" data-act="ovm-down" data-index="' + i + '" data-ovmindex="' + j + '"' + (j === n - 1 ? " disabled" : "") + ' title="Move down">\u2193</button>' +
          '<button type="button" data-act="ovm-remove" data-index="' + i + '" data-ovmindex="' + j + '" title="Remove">\u2715</button>' +
        '</div></div>' +
      '<div class="adm__ovm-body">' +
        '<div class="adm__ovm-thumb' + (src ? " has" : "") + '">' + thumb + '</div>' +
        '<div class="adm__ovm-fields">' +
          '<input type="text" class="adm__ovm-f" data-ovm="' + i + '" data-ovmindex="' + j + '" data-ovmfield="src" value="' + escAttr(src) + '" placeholder="Image / GIF / video URL\u2026" />' +
          '<div class="imgblk__row"><button class="btn btn--ghost" data-act="ovm-upload" data-index="' + i + '" data-ovmindex="' + j + '">Upload\u2026</button>' + (src ? '<button class="btn btn--ghost" data-act="ovm-clear" data-index="' + i + '" data-ovmindex="' + j + '">Clear</button>' : "") + mediaSizeTag(src) + '</div>' +
          '<input type="text" class="adm__ovm-f" data-ovm="' + i + '" data-ovmindex="' + j + '" data-ovmfield="caption" value="' + escAttr(m.caption || "") + '" placeholder="Caption (optional)" />' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  function overviewMediaBlock(w, i) {
    var st = w.study || (w.study = {});
    var sk = st.skim || (st.skim = {});
    var media = Array.isArray(sk.media) ? sk.media : (sk.media = []);
    var MAX = 6;
    var items = media.map(function (m, j) { return ovmItem(i, m, j, media.length); }).join("");
    var addBtn = media.length < MAX
      ? '<button type="button" class="btn btn--add" data-act="ovm-add" data-index="' + i + '">+ Add media</button>'
      : '<div class="af__hint">Up to ' + MAX + ' extra media (plus your cover = ' + (MAX + 1) + ' slides).</div>';
    return '<section class="l2grp"><div class="l2grp__head">Overview slideshow <span>\u2014 cover + up to 6 media, shown as a preview reel atop the case</span></div>' +
      '<div class="af__hint" style="margin:-.2rem 0 .6rem">Your cover image is slide 1. Add images, GIFs or short videos to build a Steam-style preview \u2014 each auto-plays (3.5s; videos play fully), and visitors can click a thumbnail or go fullscreen.</div>' +
      (items || '<div class="adm__empty">No extra media yet \u2014 just the cover shows.</div>') +
      addBtn +
      "</section>";
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
      '<div class="af__row">' + smeta(i, "role", "Role") + smeta(i, "timeline", "Timeline", "Optional \u2014 leave blank to reuse the Period shown on the home card.", w.period || "") + "</div>" +
      '<div class="af__row">' + smeta(i, "team", "Team") + smeta(i, "scope", "Scope") + "</div>" +
      '<div class="af"><label class="af__label">Key moves \u2014 AI-generated</label>' +
      '<div class="adm__autobar"><button class="btn btn--auto" data-act="skim-gen" data-index="' + i + '">\u2728 Generate Key Moves</button>' +
      '<span class="adm__auto-note">Reads the whole case and writes the 2\u20133 decisions that show senior judgement (problem \u2192 move \u2192 outcome). They appear as cards at the top of the case study, above <b>Read the full case</b>.</span></div>' +
      (st.skim && st.skim.beats && st.skim.beats.length ? '<div class="af__hint">' + st.skim.beats.length + ' move' + (st.skim.beats.length > 1 ? "s" : "") + (st.skim.generatedAt ? ' \u00b7 generated ' + new Date(st.skim.generatedAt).toLocaleDateString() : "") + ' \u00b7 edit or remove to refine</div>' : "") +
      "</div>" +
      (st.skim && st.skim.beats && st.skim.beats.length ? st.skim.beats.map(function (b, j) { return beatEditor(i, b, j); }).join("") : "") +
      '<button type="button" class="btn btn--add adm__beat-add" data-act="beat-add" data-index="' + i + '">+ Add a key move</button>' +
      "</section>";
    var list = blocks.map(function (b, j) { return blockEditor(i, b, j, blocks.length, openBlock === j); }).join("") || '<div class="adm__empty">No sections yet \u2014 add the first one below.</div>';
    var add = '<div class="study__add"><button class="btn btn--add study__pickbtn" data-act="study-pick" data-index="' + i + '">+ Add a section\u2026</button></div>';
    var unlockBlock = '<section class="l2grp"><div class="l2grp__head">Deeper-cut pass <span>\u2014 optional gate for \u201cLocked\u201d sections</span></div>' +
      '<div class="af"><input type="text" data-study="' + i + '" data-sfield="unlock" value="' + escAttr(unlockVal) + '" placeholder="' + (st.unlockHash && !unlockVal ? "Set \u2014 type to change" : "e.g. edge-2026") + '" />' +
      '<div class="af__hint">' + (st.unlockHash ? "Pass set \u2713" : "Not set") + " \u00b7 unlocks the \u201cLocked\u201d blocks for pass-holders \u00b7 case-insensitive \u00b7 Locked sections are moved to your private vault on Publish (zero content in your file)</div></div>" +
      "</section>";
    return '<div class="study__panel">' +
      csgenPanel(w, i) +
      header + meta + overviewMediaBlock(w, i) +
      '<section class="l2grp"><div class="l2grp__head">Sections <span>\u2014 click a section to expand &amp; edit it</span>' + (blocks.length ? '<span class="l2grp__actions"><button class="btn btn--auto l2grp__ai" data-act="fbrev-open" data-index="' + i + '" title="Paste or upload feedback \u2014 AI maps each point to the right section">\u2728 Review feedback</button><button class="btn btn--auto l2grp__ai" data-act="iprep-open" data-index="' + i + '" title="Generate likely interview questions from this case study">\uD83C\uDF99 Interview prep</button><button class="btn btn--auto l2grp__ai" data-act="story-open" data-index="' + i + '" title="Build a presentation narrative \u2014 pick a length &amp; audience, get story angles + a beat-by-beat script">\uD83D\uDCD6 Design storyteller</button></span>' : "") + "</div>" +
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
    if (f === "skim" || f === "skimpts") {
      var sk = w.study.skim = w.study.skim || {};
      if (f === "skim") { if (t.value.trim()) sk.hook = t.value; else delete sk.hook; delete sk.summary; }
      else {
        var pts = t.value.split(/\r?\n/).map(function (ln) { var pp = ln.split("|"); return { value: (pp[0] || "").trim(), label: (pp[1] || "").trim() }; }).filter(function (p) { return p.value || p.label; }).slice(0, 4);
        if (pts.length) sk.points = pts; else delete sk.points;
      }
      var empty = !((sk.hook || "").trim()) && !(sk.points && sk.points.length) && !(sk.beats && sk.beats.length) && !(sk.visuals && sk.visuals.length) && !sk.generatedAt;
      if (empty) delete w.study.skim;
      saveDraft(); refreshL2Preview(); return;
    }
    // Timeline is a year range — auto-swap any typed hyphen for the site's em dash
    // ("2023 - 2024" -> "2023 — 2024"). It's a 1:1 character swap, so the caret stays put.
    if (f === "timeline" && t.value.indexOf("-") !== -1) {
      var caret = t.selectionStart;
      t.value = t.value.replace(/-/g, "\u2014");
      try { t.setSelectionRange(caret, caret); } catch (e) {}
    }
    w.study[f] = t.value;
    saveDraft();
    refreshL2Preview();
  }
  function onBeatEdit(t) {
    var i = +t.dataset.beat, j = +t.dataset.bindex, k = t.dataset.bkey;
    var w = data.work[i]; if (!w || !w.study || !w.study.skim || !Array.isArray(w.study.skim.beats) || !w.study.skim.beats[j]) return;
    w.study.skim.beats[j][k] = t.value;
    saveDraft(); refreshL2Preview();
  }
  function onOvmEdit(t) {
    var i = +t.dataset.ovm, j = +t.dataset.ovmindex, f = t.dataset.ovmfield;
    var arr = ovmArr(i); if (!arr || !arr[j]) return;
    arr[j][f] = t.value;
    if (f === "src") { if (isVideoVal(t.value)) arr[j].kind = "video"; else delete arr[j].kind; }
    saveDraft(); refreshL2Preview();
  }
  function onStudyBlock(t) {
    var i = +t.dataset.sblock, j = +t.dataset.bindex, f = t.dataset.bfield;
    var st = data.work[i] && data.work[i].study; if (!st || !st.blocks[j]) return;
    var b = st.blocks[j];
    if (f === "list" || f === "left" || f === "right") b[f] = studyLines(t.value);
    else if (f === "items") b.items = parseItems(b.type, t.value);
    else b[f] = t.value;
    if (b.type === "device" && f === "device") { b.preset = ({ phone: "iphone", tablet: "portrait", laptop: "wide", watch: "circle" })[b.device] || ""; if (b.device !== "laptop" && b.device !== "tablet") b.fill = ""; saveDraft(); renderL2(); return; }
    if (b.type === "isolayers" && f === "mode") { if (b.mode !== "interface") b.transparency = ""; saveDraft(); renderL2(); return; }
    if (b.type === "workflow" && f === "flow") { if (b.flow === "cycle") { if (!b.loopFrom) b.loopFrom = "1"; if (!b.loopTo) b.loopTo = String((b.items || []).length || 1); } saveDraft(); renderL2(); return; }
    saveDraft();
    refreshL2Preview();
  }

  /* ---------- section renderers ---------- */
  // ============================ INSIGHTS (analytics readout) ============================
  // First-party intent events (from the site's track()) via the Worker's KV, plus Cloudflare Web
  // Analytics traffic/geo when CF_ANALYTICS_TOKEN is set. Your own visits are excluded upstream.
  let insData = null, insLoading = false, insErr = "", insDays = 30, insLoaded = false;

  async function loadInsights(days) {
    if (typeof days === "number") insDays = days;
    var sess = adminSession();
    if (!sess) { insErr = "Sign in to view analytics."; insLoaded = true; if (activeTab === "insights") renderBody(); return; }
    insLoading = true; insErr = "";
    if (activeTab === "insights") renderBody();
    try {
      var r = await fetch(ADMIN_WORKER + "/admin/insights?days=" + insDays, { headers: { Authorization: "Bearer " + sess } });
      if (r.status === 401) { insErr = "Your studio session expired \u2014 sign in again."; insData = null; }
      else if (!r.ok) { insErr = "Couldn\u2019t load analytics (" + r.status + ")."; }
      else { insData = await r.json(); insErr = ""; }
    } catch (e) { insErr = "Network error loading analytics."; }
    insLoading = false; insLoaded = true;
    if (activeTab === "insights") renderBody();
  }

  function insToggleMute() {
    var muted = localStorage.getItem("rk:owner") === "1";
    try { if (muted) localStorage.removeItem("rk:owner"); else localStorage.setItem("rk:owner", "1"); } catch (e) {}
    status(muted ? "This device now counts in analytics." : "This device is muted \u2014 your visits won\u2019t count.", true);
    if (activeTab === "insights") renderBody();
  }

  function insFlag(cc) {
    cc = String(cc || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return "\uD83C\uDF10";
    return String.fromCodePoint.apply(null, [].map.call(cc, function (c) { return 127397 + c.charCodeAt(0); }));
  }
  // ISO-2 -> [name, lat, lon] centroids for a working set of well-trafficked countries.
  const INS_CENTROID = { US: ["United States", 39, -98], CA: ["Canada", 56, -106], MX: ["Mexico", 23, -102], BR: ["Brazil", -10, -55], AR: ["Argentina", -34, -64], CL: ["Chile", -33, -71], CO: ["Colombia", 4, -73], GB: ["United Kingdom", 54, -2], IE: ["Ireland", 53, -8], FR: ["France", 46, 2], DE: ["Germany", 51, 10], ES: ["Spain", 40, -4], PT: ["Portugal", 39.5, -8], IT: ["Italy", 42, 12], NL: ["Netherlands", 52, 5], BE: ["Belgium", 50.5, 4.5], CH: ["Switzerland", 47, 8], AT: ["Austria", 47.5, 14], SE: ["Sweden", 62, 15], NO: ["Norway", 62, 10], DK: ["Denmark", 56, 10], FI: ["Finland", 64, 26], PL: ["Poland", 52, 19], CZ: ["Czechia", 49.8, 15.5], RU: ["Russia", 61, 90], UA: ["Ukraine", 49, 32], TR: ["Turkey", 39, 35], IN: ["India", 22, 79], PK: ["Pakistan", 30, 70], BD: ["Bangladesh", 24, 90], LK: ["Sri Lanka", 7.5, 80.7], CN: ["China", 35, 105], JP: ["Japan", 36, 138], KR: ["South Korea", 36.5, 128], TW: ["Taiwan", 23.7, 121], HK: ["Hong Kong", 22.3, 114.2], SG: ["Singapore", 1.35, 103.8], MY: ["Malaysia", 4, 102], ID: ["Indonesia", -2, 118], TH: ["Thailand", 15, 101], VN: ["Vietnam", 16, 106], PH: ["Philippines", 13, 122], AU: ["Australia", -25, 133], NZ: ["New Zealand", -41, 174], AE: ["UAE", 24, 54], SA: ["Saudi Arabia", 24, 45], IL: ["Israel", 31, 35], EG: ["Egypt", 26, 30], ZA: ["South Africa", -29, 24], NG: ["Nigeria", 10, 8], KE: ["Kenya", 0, 38], MA: ["Morocco", 32, -6] };
  const INS_NAME2ISO = (function () { var m = {}; for (var k in INS_CENTROID) m[INS_CENTROID[k][0].toLowerCase()] = k; m["united states of america"] = "US"; m["usa"] = "US"; m["uk"] = "GB"; m["russian federation"] = "RU"; m["viet nam"] = "VN"; m["republic of korea"] = "KR"; m["korea, south"] = "KR"; m["united arab emirates"] = "AE"; return m; })();
  const INS_EV_LABEL = { case_open: "Case opened", deepcut_unlock: "Deeper-cut unlocked", resume_download: "R\u00e9sum\u00e9 opened", contact_submit: "Contact clicked", request_access: "Access requested", vcard_download: "Contact saved (vCard)", booking_open: "Booking opened", skim_open: "Skim view" };

  function insGeoToIso(geo) {
    var out = {};
    for (var k in (geo || {})) {
      var n = geo[k] || 0; if (!n) continue;
      var iso = /^[A-Za-z]{2}$/.test(k) ? k.toUpperCase() : (INS_NAME2ISO[k.toLowerCase()] || "");
      if (!iso) { out.__other = (out.__other || 0) + n; continue; }
      out[iso] = (out[iso] || 0) + n;
    }
    return out;
  }
  function insNum(n) { n = n || 0; if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"; if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k"; return String(n); }
  function insTop(obj) { if (!obj) return ""; var best = "", bn = -1; for (var k in obj) { if (obj[k] > bn) { bn = obj[k]; best = k; } } if (!best) return ""; var w = ((data && data.work) || []).filter(function (x) { return x && x.id === best; })[0]; var label = w ? (w.client || w.title || best) : best; if (label.length > 24) label = label.slice(0, 22) + "\u2026"; return "Top: " + label; }
  function insAgo(ts) { var s = Math.max(0, (Date.now() - (ts || 0)) / 1000); if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago"; }

  function insMap(isoGeo) {
    var W = 760, H = 380, pad = 10;
    function px(lon) { return pad + (lon + 180) / 360 * (W - 2 * pad); }
    function py(lat) { return pad + (90 - lat) / 180 * (H - 2 * pad); }
    var land = "";
    for (var li = 0; li < WORLD_LAND.length; li++) {
      var ring = WORLD_LAND[li], seg = "";
      for (var pi = 0; pi < ring.length; pi += 2) seg += (pi === 0 ? "M" : "L") + px(ring[pi]).toFixed(1) + "," + py(ring[pi + 1]).toFixed(1);
      land += seg + "Z";
    }
    var entries = [];
    for (var iso in isoGeo) { if (iso === "__other") continue; var c = INS_CENTROID[iso]; if (c) entries.push([iso, isoGeo[iso], c]); }
    var max = entries.reduce(function (m, e) { return Math.max(m, e[1]); }, 1);
    entries.sort(function (a, b) { return a[1] - b[1]; });
    var bubbles = entries.map(function (e) {
      var r = 5 + Math.sqrt(e[1] / max) * 26;
      var x = px(e[2][2]).toFixed(1), y = py(e[2][1]).toFixed(1);
      return '<g class="ins__bub"><title>' + escHtml(e[2][0]) + " \u2014 " + e[1] + '</title><circle cx="' + x + '" cy="' + y + '" r="' + r.toFixed(1) + '"/><text x="' + x + '" y="' + (parseFloat(y) + 4).toFixed(1) + '">' + insFlag(e[0]) + "</text></g>";
    }).join("");
    var note = entries.length ? "" : '<text class="ins__map-note" x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle">No located visits in this window yet</text>';
    return '<svg class="ins__map" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Visitor world map"><rect class="ins__map-bg" x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" rx="10"/><path class="ins__land" d="' + land + '"/>' + bubbles + note + "</svg>";
  }
  function insSpark(series) {
    series = series || [];
    if (series.length < 2) return '<div class="ins__spark-empty">Not enough data yet for a trend.</div>';
    var W = 720, H = 90, pad = 6, n = series.length;
    var max = series.reduce(function (m, p) { return Math.max(m, p.count || 0); }, 1);
    var pts = series.map(function (p, i) { var x = pad + i / (n - 1) * (W - 2 * pad); var y = H - pad - (p.count || 0) / max * (H - 2 * pad); return x.toFixed(1) + "," + y.toFixed(1); });
    var area = "M" + pad + "," + (H - pad) + " L" + pts.join(" L") + " L" + (W - pad) + "," + (H - pad) + " Z";
    return '<svg class="ins__spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true"><path class="ins__spark-area" d="' + area + '"/><polyline class="ins__spark-line" points="' + pts.join(" ") + '"/></svg>';
  }
  function insBars(obj, labelMap) {
    var arr = Object.keys(obj || {}).map(function (k) { return [k, obj[k]]; }).filter(function (e) { return e[1]; });
    if (!arr.length) return '<div class="ins__empty">Nothing yet.</div>';
    arr.sort(function (a, b) { return b[1] - a[1]; });
    var max = arr[0][1] || 1;
    return '<div class="ins__bars">' + arr.map(function (e) {
      var label = (labelMap && labelMap[e[0]]) || e[0];
      return '<div class="ins__bar"><span class="ins__bar-l" title="' + escAttr(label) + '">' + escHtml(label) + '</span><span class="ins__bar-t"><span class="ins__bar-f" style="width:' + Math.round(e[1] / max * 100) + '%"></span></span><span class="ins__bar-n">' + e[1] + "</span></div>";
    }).join("") + "</div>";
  }
  // Map a case-open target (a work id like w1784\u2026) to its human title so the Insights
  // "Most-opened cases" list + recent feed read like case studies, not opaque ids.
  function insCaseLabels() {
    var m = {};
    (data.work || []).forEach(function (w) { if (w && w.id) m[w.id] = w.title || w.client || w.id; });
    return m;
  }
  function insTopList(arr, keyName) {
    arr = arr || [];
    if (!arr.length) return '<div class="ins__empty">Nothing yet.</div>';
    var max = arr[0].count || 1;
    return '<div class="ins__bars">' + arr.slice(0, 10).map(function (e) {
      var v = e[keyName] || "\u2014";
      return '<div class="ins__bar"><span class="ins__bar-l" title="' + escAttr(v) + '">' + escHtml(v) + '</span><span class="ins__bar-t"><span class="ins__bar-f" style="width:' + Math.round((e.count || 0) / max * 100) + '%"></span></span><span class="ins__bar-n">' + (e.count || 0) + "</span></div>";
    }).join("") + "</div>";
  }
  function insCountryList(isoGeo) {
    var arr = [];
    for (var iso in isoGeo) { if (iso === "__other") continue; arr.push([iso, isoGeo[iso]]); }
    if (isoGeo.__other) arr.push(["__other", isoGeo.__other]);
    if (!arr.length) return "";
    arr.sort(function (a, b) { return b[1] - a[1]; });
    var max = arr[0][1] || 1;
    return '<div class="ins__countries">' + arr.slice(0, 12).map(function (e) {
      var name = e[0] === "__other" ? "Other" : ((INS_CENTROID[e[0]] && INS_CENTROID[e[0]][0]) || e[0]);
      var fl = e[0] === "__other" ? "\uD83C\uDF10" : insFlag(e[0]);
      return '<div class="ins__ctry"><span class="ins__ctry-f">' + fl + '</span><span class="ins__ctry-n">' + escHtml(name) + '</span><span class="ins__bar-t"><span class="ins__bar-f" style="width:' + Math.round(e[1] / max * 100) + '%"></span></span><span class="ins__ctry-c">' + e[1] + "</span></div>";
    }).join("") + "</div>";
  }
  function insRecent(recent) {
    if (!recent || !recent.length) return '<div class="ins__empty">No events captured yet.</div>';
    var cl = insCaseLabels();
    return '<ul class="ins__feed">' + recent.slice(0, 20).map(function (r) {
      var label = INS_EV_LABEL[r.t] || r.t;
      var what = r.id ? (' <b>' + escHtml(cl[r.id] || r.id) + "</b>") : "";
      var where = r.c ? (insFlag(r.c) + " ") : "";
      return '<li><span class="ins__feed-w">' + where + '</span><span class="ins__feed-l">' + escHtml(label) + what + '</span><span class="ins__feed-t">' + insAgo(r.at) + "</span></li>";
    }).join("") + "</ul>";
  }
  function insCard(n, label, sub) {
    return '<div class="ins__card"><div class="ins__card-n">' + n + '</div><div class="ins__card-l">' + escHtml(label) + "</div>" + (sub ? '<div class="ins__card-s">' + escHtml(sub) + "</div>" : "") + "</div>";
  }

  function insightsSection() {
    if (!insLoaded && !insLoading) loadInsights();
    var muted = localStorage.getItem("rk:owner") === "1";
    var head = secHead("Insights", "How your portfolio is doing \u2014 page views, geography, devices and the intent signals only your site can see (case opens, unlocks, r\u00e9sum\u00e9, contact). Your own visits are excluded.");
    var dayBtns = [1, 7, 30, 90].map(function (d) { return '<button class="ins__dbtn' + (insDays === d ? " is-on" : "") + '" data-act="ins-days" data-days="' + d + '">' + (d === 1 ? "24h" : d + "d") + "</button>"; }).join("");
    var controls = '<div class="ins__ctrls"><div class="ins__days">' + dayBtns + '</div><button class="btn btn--ghost" data-act="ins-refresh">\u21bb Refresh</button><button class="ins__mute' + (muted ? " is-on" : "") + '" data-act="ins-mute" title="When on, this device\u2019s visits don\u2019t count">' + (muted ? "\u25cf This device muted" : "\u25cb Count this device") + "</button></div>";
    if (insErr) return head + controls + '<div class="ins__err">' + escHtml(insErr) + "</div>";
    if (!insData) return head + controls + '<div class="ins__loading">Loading your numbers\u2026</div>';
    var ev = insData.events || {}, tr = insData.traffic || {};
    // Once Cloudflare is connected, prefer its (owner-excluded, bot-filtered) numbers — but only when it
    // actually has data. Until a real visitor lands, keep showing the first-party page views + map so
    // connecting Cloudflare never blanks the dashboard (CF excludes your own visits, so it reads 0 at first).
    var cfHas = tr.configured && !tr.error && (tr.total || 0) > 0;
    var isoGeo = insGeoToIso(cfHas ? tr.geo : ev.geo);
    var pvNum = cfHas ? (tr.total || 0) : (ev.pageviews || 0);
    var rng = insDays === 1 ? "24h" : insDays + "d";
    var cards = '<div class="ins__cards">' +
      insCard(insNum(pvNum), "Page views", cfHas ? (rng + " \u00b7 Cloudflare") : (rng + " \u00b7 first-party")) +
      insCard(insNum(ev.total || 0), "Intent events", rng + " \u00b7 first-party") +
      insCard(insNum((ev.types && ev.types.case_open) || 0), "Case opens", insTop((ev.targets || {}).case_open)) +
      insCard(insNum((ev.types && ev.types.deepcut_unlock) || 0), "Deeper-cut unlocks", insTop((ev.targets || {}).deepcut_unlock)) +
      "</div>";
    var mapBlock = '<div class="ins__panel"><div class="ins__panel-h">Where visitors are</div>' + insMap(isoGeo) + insCountryList(isoGeo) + "</div>";
    var techBlock = '<div class="ins__grid3"><div class="ins__panel"><div class="ins__panel-h">Devices</div>' + insBars(ev.devices, null) + '</div><div class="ins__panel"><div class="ins__panel-h">Browsers</div>' + insBars(ev.browsers, null) + '</div><div class="ins__panel"><div class="ins__panel-h">Operating system</div>' + insBars(ev.os, null) + "</div></div>";
    var trendPanel = '<div class="ins__panel"><div class="ins__panel-h">Traffic trend \u00b7 ' + (cfHas ? "Cloudflare" : "first-party page views") + '</div>' + insSpark(cfHas ? tr.series : ev.series) + "</div>";
    var trafficBlock;
    if (tr.configured && !tr.error) {
      trafficBlock = trendPanel + '<div class="ins__grid2"><div class="ins__panel"><div class="ins__panel-h">Top referrers</div>' + insTopList(tr.referers, "host") + '</div><div class="ins__panel"><div class="ins__panel-h">Top pages</div>' + insTopList(tr.pages, "path") + "</div></div>";
    } else {
      trafficBlock = trendPanel + '<div class="ins__connect"><div class="ins__connect-h">Add referrers, top pages &amp; Cloudflare geo</div><p>Page views, devices, browsers, OS and the country map are already live from first-party data. Connect a Cloudflare API token (<b>Account \u00b7 Account Analytics \u00b7 Read</b>) to also see referrers and top pages:</p><pre class="ins__code">cd worker\nnpx wrangler secret put CF_ANALYTICS_TOKEN</pre>' + (tr.error ? '<p class="ins__connect-err">Cloudflare said: ' + escHtml(tr.error) + "</p>" : "") + "</div>";
    }
    var eventsBlock = '<div class="ins__grid2"><div class="ins__panel"><div class="ins__panel-h">Intent events</div>' + insBars(ev.types, INS_EV_LABEL) + '</div><div class="ins__panel"><div class="ins__panel-h">Most-opened cases</div>' + insBars((ev.targets || {}).case_open, insCaseLabels()) + '</div></div><div class="ins__panel"><div class="ins__panel-h">Recent activity</div>' + insRecent(ev.recent) + "</div>";
    return head + controls + cards + mapBlock + techBlock + trafficBlock + eventsBlock;
  }

  const sections = {
    insights() { return insightsSection(); },
    landing() {
      return (
        secHead("Landing", "Write plainly, then hit <em>Auto-style</em> and the editorial colour is applied for you: products like Microsoft&nbsp;AI turn bronze, &ldquo;leading Growth Design for Microsoft Edge&rdquo; turns bold, and the closing word (why) turns italic. It also runs on publish.") +
        group(workReorderBlock()) +
        '<div class="adm__autobar"><button class="btn btn--auto" data-act="autostyle">Auto-style landing</button><button class="btn btn--auto" data-act="landing-ai" style="margin-left:.5rem">\u2728 Draft with AI</button><span class="adm__auto-note">Auto-style paints the accents; <em>Draft with AI</em> writes the hero, highlights, capabilities &amp; about from a brief \u2014 preview before applying.</span></div>' +
        group(siteIconBlock()) +
        input("Eyebrow", "landing.eyebrow", { toggle: "eyebrow" }) +
        input("Domains", "landing.domains", { toggle: "domains", hint: "e.g. Growth · AI · Identity" }) +
        input("Main statement", "landing.statement", { md: true, type: "textarea", rows: 3, hint: "One line per row. The closing word (why / how) gets the italic accent." }) +
        stmtSizeBlock() +
        input("Description", "landing.intro", { md: true, type: "textarea", rows: 4, toggle: "intro", hint: "Products auto-bronze; “leading …” phrases auto-bold." }) +
        input("Footer line", "landing.presence", { md: true, toggle: "presence", hint: "e.g. Currently at Microsoft — Hyderabad, India" }) +
        '<div class="af"><label class="af__label">Availability badge</label>' +
        '<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.9rem"><input type="checkbox" data-act="avail-toggle"' + ((((data.landing || {}).available) || {}).on ? " checked" : "") + ' /><span>Show an \u201copen to work\u201d pill in the hero</span></label>' +
        '<div class="af__hint">Off by default. A quiet pill with a live green dot appears under the hero when on.</div></div>' +
        input("Availability text", "landing.available.text", { hint: "e.g. Open to Principal / Staff Product Design roles" }) +
        '<div class="af"><label class="af__label">Selected-work cue</label>' +
        '<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.9rem"><input type="checkbox" data-act="cue-toggle"' + (((((data.landing || {}).show) || {}).cue !== false) ? " checked" : "") + ' /><span>Show the \u201cSelected work \u2193\u201d cue in the hero</span></label>' +
        '<div class="af__hint">A gentle scroll hint at the bottom of the hero. Shown by default; auto-hidden if Selected&nbsp;work sits above the hero.</div></div>'
      );
    },
    contact() {
      return (
        secHead("Contact", "Used across the contact section, menu, footer and the floating dock.") +
        group(avatarBlock()) +
        group(
          input("Full name", "contact.name", { hint: "used for the \u201cSave contact\u201d vCard download" }) +
          input("Display email", "contact.email", { hint: "Shown on your site, the CV / r\u00e9sum\u00e9 PDF and the Save-contact card." }) +
          input("Service email", "contact.serviceEmail", { hint: "Where access-request and booking alerts are sent (also the reply-to). Leave blank to use your display email." }) +
          '<div class="af__row">' +
          input("Phone (display)", "contact.phone") +
          input("Phone (dial)", "contact.phoneRaw", { hint: "no spaces, e.g. +918197809767" }) +
          "</div>" +
          input("LinkedIn URL", "contact.linkedin") +
          input("Website URL", "contact.website") +
          input("Booking link", "contact.booking", { hint: "Cal.com / Calendly / any scheduler URL \u2014 shows a \u201cBook a call\u201d button in Contact. Leave blank to hide." })
        ) +
        group(resumeBlock()) +
        group(contactBadgesBlock())
      );
    },
    highlights() {
      const list = data.highlights || [];
      let html = secHead("Highlights", "The at-a-glance numbers &mdash; they run as a marquee under the hero. Up to 8. Values like <em>11+</em>, <em>Billions</em>, <em>2B+</em>: leading digits count up as each chip scrolls in. Select text, then use B / I / A for bold, italic or a bronze accent.") + addBar("highlights", "Add highlight", list.length >= 8);
      list.forEach((h, i) => {
        html += '<div class="card">' + cardHead("Highlight " + (i + 1), "highlights", i, list.length) +
          '<div class="af__row">' + itemField("highlights", i, "value", "Value", { md: true }) + itemField("highlights", i, "label", "Label", { md: true }) + "</div></div>";
      });
      return html + group(logosBlock());
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
      const wl = data.workLayout || "grid-2";
      const wlOpt = (v, lbl) => '<option value="' + v + '"' + (wl === v ? " selected" : "") + ">" + lbl + "</option>";
      let html = secHead("Selected Work", "Your projects. Tick up to 4 to feature on the homepage (currently " + featured + "/4). Title, story, images, tags &amp; theme all live inside each project\u2019s case-study editor.") +
        '<div class="af"><label class="af__label">Homepage layout</label><select data-worklayout>' +
          wlOpt("grid-2", "Grid \u2014 2 columns") + wlOpt("grid-3", "Grid \u2014 3 columns") + wlOpt("list", "Linear list") +
        '</select><div class="af__hint">How projects are arranged on the homepage. A grid surfaces more case studies at once, so visitors explore beyond the first one.</div></div>' +
        addBar("work", "Add work");
      list.forEach((w, i) => {
        if (w.encWork) {
          html += '<div class="card workcard workcard--enc">' +
            '<div class="workcard__enc-head"><span class="study__block-badge">\uD83D\uDD12 Hidden &amp; encrypted project</span></div>' +
            '<div class="study__enc-note">Hidden from the default site \u2014 its content isn\u2019t in your published file. <button class="btn btn--ghost" data-act="work-decrypt" data-index="' + i + '">Unlock to edit</button></div>' +
            '</div>';
          return;
        }
        html += '<div class="card workcard">' + cardHead(w.client || w.title || ("Work " + (i + 1)), "work", i, list.length, "work-dup") +
          '<div class="block-flags workcard__flags">' +
            '<label class="chk workcard__feat"><input type="checkbox" data-act="feature" data-index="' + i + '"' + (w.featured ? " checked" : "") + " /> Feature on homepage</label>" +
            '<label class="chk"><input type="checkbox" data-act="work-hidden" data-index="' + i + '"' + (w.hidden ? " checked" : "") + " /> Hidden from the default site \u2014 only shown via a ticket</label>" +
          '</div>' +
          '<div class="af__row">' + itemField("work", i, "client", "Client") + itemField("work", i, "period", "Period") + "</div>" +
          '<div class="workcard__name' + (w.title && w.title !== "Project title" ? "" : " workcard__name--hint") + '">' + (w.title && w.title !== "Project title" ? escHtml(w.title) : "Edit the case study to add a project title") + "</div>" +
          studyToggle(w, i) +
          "</div>";
      });
      return html;
    },
    aboutpage() {
      const RK = window.RK || {};
      const defs = RK.ABOUT_SECTIONS || [["about", "About"], ["recognition", "Recognition"], ["capabilities", "Capabilities"], ["path", "The Path"], ["education", "Education"]];
      const labels = {}; defs.forEach((s) => { labels[s[0]] = s[1]; });
      const where = { about: "Edit the text + photos below in this tab", recognition: "Edit in the Recognition tab", capabilities: "Edit in the Capabilities tab", path: "Edit in the Path tab", education: "Edit in the Education tab" };
      const layout = RK.aboutLayout ? RK.aboutLayout(data) : defs.map((s) => ({ key: s[0], on: true }));
      let html = secHead("About page", "Reorder the sections on your About page and show or hide any of them. Use the arrows to move a section up or down, and untick to hide it from visitors. Each section\u2019s content is edited in its own tab \u2014 the About text and Photos live right here.");
      html += '<ul class="adm__seclist">';
      layout.forEach((s, i) => {
        html += '<li class="adm__secrow' + (s.on ? "" : " is-off") + '">' +
          '<span class="adm__secrow-ops">' +
            '<button class="iconbtn" data-act="aboutsec-up" data-i="' + i + '"' + (i === 0 ? " disabled" : "") + ' title="Move up">\u2191</button>' +
            '<button class="iconbtn" data-act="aboutsec-down" data-i="' + i + '"' + (i === layout.length - 1 ? " disabled" : "") + ' title="Move down">\u2193</button>' +
          "</span>" +
          '<span class="adm__secrow-main"><span class="adm__secrow-name">' + escHtml(labels[s.key] || s.key) + '</span><span class="adm__secrow-where">' + escHtml(where[s.key] || "") + "</span></span>" +
          '<label class="adm__secrow-tog"><input type="checkbox" data-act="aboutsec-toggle" data-key="' + s.key + '"' + (s.on ? " checked" : "") + ' /><span class="adm__secrow-state">' + (s.on ? "Shown" : "Hidden") + "</span></label>" +
          "</li>";
      });
      html += "</ul>";
      html += group(
        secHead("About me", "The opening lines of your About section. (Also written by \u2728 Draft with AI in the Landing tab.)") +
        input("Lead line", "landing.aboutLead", { md: true, type: "textarea", rows: 2, hint: "The big opening line of the About section. *italic* for emphasis." }) +
        input("Paragraphs", "landing.about", { md: true, type: "textarea", rows: 7, hint: "Separate paragraphs with a blank line. **bold**, *italic*, [[Product]] bronze." }) +
        input("Sign-off", "landing.aboutSign", { md: true, hint: "The closing personal line, e.g. an off-the-clock note." })
      );
      html += group(aboutGalleryBlock());
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
      html += journeyCard();
      return html;
    },
    recognition() {
      return titleMetaList("recognition", "Recognition", "Awards, talks and honours.");
    },
    education() {
      return titleMetaList("education", "Education", "Degrees and schooling.");
    },
    special() {
      // Special Views is now the single access hub: Requests / Approved / Curated (incoming) + Custom (the
      // ticketed views you build). accessSection() renders the sub-tabs; the Custom pane = customViewsPane().
      return accessSection();
    },
    ai() {
      let html = secHead("Prepare",
        "AI-assisted job-hunt tools \u2014 ATS r\u00e9sum\u00e9 check, cover letters, interview prep and more. Connect your AI provider once in <b>\u22EF \u2192 AI settings</b>; keys stay in this browser and never touch your published site.");
      const resumeSet = !!(data.contact && data.contact.resume);
      html += atsPanelHtml(resumeSet) + clPanelHtml() + iprepPanelHtml() + storyPanelHtml() + wbPanelHtml();
      return html;
    },
    autofill() {
      return (
        secHead("More", "Bookings, your phone notifications app, a one-page PDF r\u00e9sum\u00e9, and the browser autofill extension.") +
        bookingsBlock() +
        '<div class="adm__ext">' +
          '<div class="adm__ext-head"><span class="adm__ext-logo">' + extIcon("phone") + '</span><div><b>Phone \u2014 requests app</b><span>Approve requests from your phone</span></div></div>' +
          '<p class="adm__ext-lead">First add your phone as a passkey: <b>\u22EF \u2192 Passkeys \u2192 Add a passkey</b>, then pick <b>\u201cUse a phone or tablet\u201d</b> and scan with your phone. Then open <b>riteshk.work/inbox</b> on the phone, verify with that passkey, and Add\u00a0to\u00a0Home\u00a0Screen. Enrolment happens only here in the studio \u2014 the phone can only <i>verify</i>, never create a passkey, so a link alone can never grant access.</p>' +
          '<div class="imgblk__row"><button class="btn btn--primary" data-act="phone-qr">' + extIcon("qr", 15) + ' Show inbox QR</button></div>' +
          '<div data-phoneqr style="margin-top:14px"></div>' +
        "</div>" +
        '<div class="adm__ext">' +
          '<div class="adm__ext-head"><span class="adm__ext-logo">' + extIcon("doc") + '</span><div><b>One-page r\u00e9sum\u00e9 \u2014 PDF</b><span>Clickable case-study links + QR codes</span></div></div>' +
          '<p class="adm__ext-lead">A print-ready A4 one-pager built live from your content: positioning, key metrics, your top four case studies (each a live link), experience, capabilities, recognition and education. A real PDF with clickable links \u2014 no browser print dialog.</p>' +
          '<div class="imgblk__row"><button class="btn btn--primary" data-act="resume-pdf">' + extIcon("dl", 15) + ' Download PDF r\u00e9sum\u00e9</button></div>' +
          '<div class="af__hint">Built from what you have in admin right now \u2014 publish first so the case-study links resolve on your live site (they point to riteshk.work/work/\u2026).</div>' +
        "</div>" +
        '<div class="adm__ext">' +
          '<div class="adm__ext-head"><span class="adm__ext-logo">' + extIcon("media") + '</span><div><b>Media library</b><span>See every uploaded file, spot unused ones, free up space</span></div></div>' +
          '<p class="adm__ext-lead">Your images and PDFs live in the repo at <code>assets/uploads</code>. Open the library to see totals, find files your content no longer references, and delete the unused ones.</p>' +
          '<div class="imgblk__row"><button class="btn btn--primary" data-act="media-open">' + extIcon("media", 15) + ' Manage media</button></div>' +
        "</div>" +
        '<div class="adm__ext">' +
          '<div class="adm__ext-head"><span class="adm__ext-logo">' + extIcon("zap") + '</span><div><b>R\u00e9sum\u00e9 Autofill</b><span>Edge / Chrome extension</span></div></div>' +
          '<p class="adm__ext-lead">On any job site: open the floating \u26A1 button, right-click a field, or use the inline chip \u2014 pick <b>Full</b> or <b>Snippet</b> and it drops your experience straight into the form.</p>' +
          '<div class="imgblk__row"><button class="btn btn--primary" data-act="ext-download">' + extIcon("dl", 15) + ' Download the extension (.zip)</button></div>' +
          '<ol class="adm__ext-steps">' +
            "<li>Unzip the downloaded file somewhere you\u2019ll keep it.</li>" +
            "<li>Open <code>edge://extensions</code> (or <code>chrome://extensions</code>) and turn on <b>Developer mode</b>.</li>" +
            "<li>Click <b>Load unpacked</b> and pick the unzipped <b>resume-autofill</b> folder.</li>" +
            "<li>Pin it, then open its options to add your r\u00e9sum\u00e9 (or OCR one).</li>" +
          "</ol>" +
          '<div class="af__hint">Your data stays in the browser and syncs across your PCs when you\u2019re signed into the same Edge/Chrome profile. Reinstall the same way on any device \u2014 for security, browsers don\u2019t let a website install an extension automatically.</div>' +
        "</div>"
      );
    },
  };

  // ---------- access-requests inbox (top of the Special Views tab) ----------
  var reqCache = [];
  function reqAgo(iso) {
    var t = Date.parse(iso || ""); if (!t) return "";
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }
  function reqMailto(q) {
    var sub = encodeURIComponent("Your access to my work \u2014 Ritesh Kumar");
    var body = encodeURIComponent("Hi " + (q.name || "") + ",\n\nThanks for the interest \u2014 here's your code: [PASTE CODE]\nOr open it directly: " + location.origin + "/?ticket=[CODE]\n\n\u2014 Ritesh");
    return "mailto:" + (q.email || "") + "?subject=" + sub + "&body=" + body;
  }
  function reqInboxHtml() {
    if (!reqCache.length) return '<div class="rkinbox__empty">No requests yet. When a visitor taps \u201cRequest access\u201d, it lands here.</div>';
    return reqCache.map(function (q) {
      var mt = reqMailto(q);
      return '<div class="rkinbox__row">' +
        '<div class="rkinbox__main">' +
          '<div class="rkinbox__who"><b>' + escHtml(q.name || "\u2014") + "</b>" + (q.company ? ' <span class="rkinbox__co">\u00b7 ' + escHtml(q.company) + "</span>" : "") + ' <span class="rkinbox__ago">' + escHtml(reqAgo(q.at)) + "</span></div>" +
          '<a class="rkinbox__mail" href="' + escAttr(mt) + '">' + escHtml(q.email || "") + "</a>" +
          (q.context ? '<div class="rkinbox__ctx">' + escHtml(q.context) + "</div>" : "") +
          (q.note ? '<div class="rkinbox__note">\u201c' + escHtml(q.note) + "\u201d</div>" : "") +
        "</div>" +
        '<div class="rkinbox__acts">' +
          '<a class="btn btn--ghost" href="' + escAttr(mt) + '">Email</a>' +
          '<button class="btn btn--ghost" data-act="req-dismiss" data-id="' + escAttr(q.id) + '">Dismiss</button>' +
        "</div>" +
      "</div>";
    }).join("");
  }
  function reqInboxSection() {
    return '<div class="rkinbox"><div class="rkinbox__head">Access requests' + (reqCache.length ? ' <span class="rkinbox__badge">' + reqCache.length + "</span>" : "") + '</div><div data-reqbox>' + reqInboxHtml() + "</div></div>";
  }
  async function loadRequests() {
    try {
      var sess = adminSession(); if (!sess) return;
      var r = await fetch(ADMIN_WORKER + "/admin/requests", { headers: { Authorization: "Bearer " + sess } });
      if (!r.ok) return;
      var j = await r.json();
      reqCache = (j && j.requests) || [];
      if (activeTab === "special") renderBody();
    } catch (e) {}
  }

  // ---------- one-tap Full-access quick-grant (the link the request notification's Allow button emails) ----------
  var qgCache = null; // {code?, expiresAt?, updatedAt?} from the Worker, or null until loaded
  function qgStatusText() {
    if (!qgCache || !qgCache.code) return "Not set \u2014 pick a view and Save to enable one-tap Allow.";
    if (qgCache.expiresAt && Date.now() > qgCache.expiresAt) return "Expired \u2014 re-save to refresh the link.";
    if (!qgCache.expiresAt) return "Active \u00b7 no expiry.";
    var d = Math.ceil((qgCache.expiresAt - Date.now()) / 86400000);
    return "Active \u00b7 " + (d <= 0 ? "expires today" : d + " day" + (d > 1 ? "s" : "") + " left") + ".";
  }
  // The pinned "One-tap Allow" control + its dedicated hidden "Full access" special view (empty scope =
  // all work) that the notification's Allow button hands out. Decoupled from your shareable views; on/off
  // + editable scope. Duration is NOT set here (each recruiter link is minted with its own 15-day life).
  function fullAccessView() { return (data.specialViews || []).filter(function (v) { return v && v.fullAccess; })[0] || null; }
  async function ensureFullAccessView() {
    var v = fullAccessView();
    if (v) return v;
    data.specialViews = data.specialViews || [];
    var phrase = "fa-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
    v = { id: "sv-fullaccess-" + Date.now().toString(36), name: "Full access", fullAccess: true, audience: "", ticketHash: await sha256(phrase), createdAt: Date.now(), days: 0, workIds: [], highlightIdx: [], capabilityIdx: [] };
    ticketPlain[v.id] = phrase;
    data.specialViews.push(v);
    saveDraft(true);
    return v;
  }
  var allowMeta = { on: false, legacy: false, scope: "all your work" };
  async function computeAllowMeta() {
    var v = fullAccessView();
    var code = qgCache && qgCache.code;
    var enabled = !!(qgCache && qgCache.enabled !== false);
    var pointsFull = false;
    if (v && code) { try { pointsFull = (await sha256(code)) === v.ticketHash; } catch (e) {} }
    var nWork = v ? (v.workIds || []).length : 0;
    allowMeta = {
      on: !!(code && enabled && pointsFull),
      legacy: !!(code && !pointsFull),
      scope: (!v || !nWork) ? "all your work" : (nWork + (nWork > 1 ? " works" : " work"))
    };
  }
  function quickGrantPanel() {
    var on = allowMeta.on, legacy = allowMeta.legacy, scope = allowMeta.scope;
    return '<div class="rkqg' + (on ? " is-on" : "") + '">' +
      '<div class="rkqg__head">One-tap Allow <span class="rkqg__sub">what tapping <b>Allow</b> on a request hands out</span></div>' +
      '<div class="rkqg__row rkqg__row--toggle"><label class="rkacc__switch"><input type="checkbox" data-act="allow-toggle"' + (on ? " checked" : "") + " /> Enable one-tap Allow</label>" +
        '<button class="btn btn--ghost" data-act="allow-edit">Edit scope\u2026</button></div>' +
      '<div class="rkqg__status' + (on ? " is-on" : "") + '"><span>' + (on
        ? "On \u00b7 approved recruiters see <b>" + escHtml(scope) + "</b> on a fresh 15-day link"
        : legacy
          ? "\u26A0 Allow is wired to an older link right now. Turn it on to switch it to <b>full access</b> \u2014 all your work."
          : "Off \u2014 tapping <b>Allow</b> won\u2019t hand out access") + "</span></div>" +
      '<div class="af__hint">A unique 15-day link is minted per recruiter (duration is per link, not set here). This controls <b>whether</b> Allow works and <b>what</b> they see \u2014 all your work by default. <b>Publish</b> after turning it on or editing scope so the links resolve. Turning it off stops new approvals but won\u2019t cut off recruiters you already approved.</div>' +
    "</div>";
  }
  async function toggleAllowDefault(onDone) {
    var sess = adminSession(); if (!sess) return;
    var refresh = onDone || function () { if (activeTab === "special") renderBody(); };
    try {
      if (allowMeta.on) {
        var r = await fetch(ADMIN_WORKER + "/admin/quickgrant", { method: "POST", headers: { Authorization: "Bearer " + sess, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
        if (!r.ok) throw 0;
        qgCache = qgCache || {}; qgCache.enabled = false;
        refresh();
        status("One-tap Allow turned off \u2014 links you already sent still work.", true);
      } else {
        // ON = ensure the hidden Full-access view + point the quick-grant AT IT (fresh phrase),
        // enabled + permanent. This repoints away from any older/legacy code (e.g. Adobe).
        var v = await ensureFullAccessView();
        var phrase = ticketPlain[v.id];
        if (!phrase) {
          phrase = "fa-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
          ticketPlain[v.id] = phrase;
          v.ticketHash = await sha256(phrase);
          saveDraft(true);
        }
        var r3 = await fetch(ADMIN_WORKER + "/admin/quickgrant", { method: "POST", headers: { Authorization: "Bearer " + sess, "Content-Type": "application/json" }, body: JSON.stringify({ code: phrase, enabled: true, expiresAt: 0 }) });
        if (!r3.ok) throw 0;
        qgCache = { code: phrase, enabled: true, expiresAt: 0, updatedAt: Date.now() };
        refresh();
        status("One-tap Allow is on \u2014 hit Publish to make it live.", true);
      }
    } catch (e) { status("Couldn\u2019t reach the server \u2014 try again.", false); }
  }
  function allowEditModal(onDone, opts) {
    opts = opts || {};
    ensureFullAccessView().then(function (sv) {
      var works = data.work || [], highs = data.highlights || [], caps = data.capabilities || [];
      var wOpts = works.map(function (w, wi) { return '<label class="svchk"><input type="checkbox" data-cur="work" value="' + escAttr(w.id) + '"' + ((sv.workIds || []).indexOf(w.id) !== -1 ? " checked" : "") + ' /><span>' + escHtml(w.client || w.title || ("Work " + (wi + 1))) + "</span></label>"; }).join("");
      var hOpts = highs.map(function (hh, hi) { return '<label class="svchk"><input type="checkbox" data-cur="high" value="' + hi + '"' + ((sv.highlightIdx || []).indexOf(hi) !== -1 ? " checked" : "") + ' /><span>' + escHtml((hh.value || "") + " \u00b7 " + (hh.label || "")) + "</span></label>"; }).join("");
      var cOpts = caps.map(function (c, ci) { return '<label class="svchk"><input type="checkbox" data-cur="cap" value="' + ci + '"' + ((sv.capabilityIdx || []).indexOf(ci) !== -1 ? " checked" : "") + ' /><span>' + escHtml(c) + "</span></label>"; }).join("");
      var modal = document.createElement("div"); modal.className = "pass";
      modal.innerHTML =
        '<div class="pass__box pass__box--wide"><div class="pass__title">Select what they see</div>' +
        '<div class="pass__sub">Leave a section untouched to show everything (recommended). Tick items only to narrow what an approved recruiter sees.</div>' +
        '<details open class="rkcur__grp"><summary>Work shown <span>(none ticked = all work)</span></summary><div class="svchk__grid">' + wOpts + "</div></details>" +
        '<details class="rkcur__grp"><summary>Numbers shown <span>(all by default)</span></summary><div class="svchk__grid">' + hOpts + "</div></details>" +
        '<details class="rkcur__grp"><summary>Capabilities shown <span>(all by default)</span></summary><div class="svchk__grid">' + cOpts + "</div></details>" +
        '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button><button class="btn btn--primary" data-go>Save scope</button></div></div>';
      document.body.appendChild(modal);
      settingsMount(modal, opts);
      var done = function () { if (opts.onClose) opts.onClose(); else modal.remove(); };
      var pick = function (sel) { return Array.prototype.map.call(modal.querySelectorAll('[data-cur="' + sel + '"]:checked'), function (x) { return x.value; }); };
      modal.querySelector("[data-cancel]").addEventListener("click", done);
      if (!opts.mount) {
        modal.addEventListener("click", function (e) { if (e.target === modal) done(); });
        modal.addEventListener("keydown", function (e) { if (e.key === "Escape") done(); });
      }
      modal.querySelector("[data-go]").addEventListener("click", function () {
        sv.workIds = pick("work");
        sv.highlightIdx = pick("high").map(Number);
        sv.capabilityIdx = pick("cap").map(Number);
        var order = (data.work || []).map(function (w) { return w.id; });
        sv.workIds.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
        sv.highlightIdx.sort(function (a, b) { return a - b; });
        sv.capabilityIdx.sort(function (a, b) { return a - b; });
        saveDraft(true); done();
        if (!opts.mount) (onDone || function () { if (activeTab === "special") renderBody(); })();
        status("Scope saved \u2014 publish to apply.", true);
      });
    });
  }
  function allowSettingsModal() {
    var modal = document.createElement("div"); modal.className = "pass";
    modal.innerHTML = '<div class="pass__box pass__box--wide"><div data-allow-body></div><div class="pass__actions"><button class="btn btn--primary" data-close>Done</button></div></div>';
    document.body.appendChild(modal);
    var body = modal.querySelector("[data-allow-body]");
    var done = function () { modal.remove(); };
    var paint = function () { computeAllowMeta().then(function () { body.innerHTML = quickGrantPanel(); }); };
    paint();
    // refresh from the server so the toggle reflects the true current state, then repaint the sheet
    (async function () { try { var sess = adminSession(); if (!sess) return; var r = await fetch(ADMIN_WORKER + "/admin/quickgrant", { headers: { Authorization: "Bearer " + sess } }); if (r.ok) { qgCache = await r.json(); paint(); } } catch (e) {} })();
    modal.addEventListener("click", function (e) {
      if (e.target === modal || e.target.closest("[data-close]")) { done(); return; }
      var b = e.target.closest("[data-act]"); if (!b) return;
      var act = b.dataset.act;
      if (act === "allow-toggle") { toggleAllowDefault(paint); return; }
      if (act === "allow-edit") { allowEditModal(paint); return; }
    });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") done(); });
  }
  async function loadQuickGrant() {
    try {
      var sess = adminSession(); if (!sess) return;
      var r = await fetch(ADMIN_WORKER + "/admin/quickgrant", { headers: { Authorization: "Bearer " + sess } });
      if (!r.ok) return;
      qgCache = await r.json();
      if (activeTab === "special") renderBody();
    } catch (e) {}
  }

  // ---------- dedicated Access tab: Requests / Approved / Curated ----------
  // NOTE: fully independent of the legacy Special-Views inbox (its own caches) so the
  // recruiter's live `all`-mode flow is never perturbed. Curated is a separate branch.
  var accReqCache = [];
  var accGrantCache = [];
  var accSubTab = "requests";       // requests | approved | curated
  var accShowDeclined = false;
  var accShowRevoked = false;       // Approved/Curated: when on, show ONLY revoked grants (where Delete lives)
  var accLoading = false;
  var accPendingCount = 0;          // pending requests awaiting action -> drives the Access tab + Requests sub-tab count badges
  var accVisBound = false;          // one-time guard for the tab-focus auto-refresh

  function accSubBtn(id, label) {
    var badge = (id === "requests" && accPendingCount > 0) ? ' <span class="rkacc__badge">' + (accPendingCount > 99 ? "99+" : accPendingCount) + "</span>" : "";
    return '<button class="rkacc__tab' + (accSubTab === id ? " is-on" : "") + '" data-act="acc-tab" data-tab="' + id + '">' + escHtml(label) + badge + "</button>";
  }
  // Top "Access" tab + Requests sub-tab show a live count of pending requests. The tab bar is built once,
  // so the top badge is updated in place; accSyncBadges() recomputes the count whenever the pending list changes.
  var accLastPending = -1;          // last count we reflected; a rise means new request(s) arrived -> pulse
  function updateAccessBadges() {
    var el = document.querySelector("[data-accbadge]");
    if (el) el.textContent = accPendingCount > 0 ? (accPendingCount > 99 ? "99+" : String(accPendingCount)) : "";
    if (accLastPending >= 0 && accPendingCount > accLastPending) pulseBadges();
    accLastPending = accPendingCount;
  }
  function pulseBadges() {
    var els = document.querySelectorAll(".adm__tabbadge, .rkacc__badge");
    for (var i = 0; i < els.length; i++) { var b = els[i]; b.classList.remove("is-pulse"); void b.offsetWidth; b.classList.add("is-pulse"); }
  }
  function accSyncBadges() {
    if (!accShowDeclined) accPendingCount = accReqCache.length;
    updateAccessBadges();
  }

  /* ---------- Bookings (Cal.com) — list in the More tab + a new-count badge on that tab ---------- */
  var bookCache = [], bookLoaded = false, bookLoading = false, bookLastNew = -1;
  function bookSeen() { try { return parseInt(localStorage.getItem("rk:book:seen") || "0", 10) || 0; } catch (e) { return 0; } }
  function bookNew() { var s = bookSeen(), n = 0; for (var i = 0; i < bookCache.length; i++) if ((bookCache[i].at || 0) > s) n++; return n; }
  function updateBookBadge() {
    var n = bookNew();
    var el = document.querySelector("[data-bookbadge]");
    if (el) el.textContent = n > 0 ? (n > 99 ? "99+" : String(n)) : "";
    if (bookLastNew >= 0 && n > bookLastNew) pulseBadges();
    bookLastNew = n;
  }
  function bookMarkSeen() {
    var mx = 0; for (var i = 0; i < bookCache.length; i++) if ((bookCache[i].at || 0) > mx) mx = bookCache[i].at;
    try { localStorage.setItem("rk:book:seen", String(Math.max(mx, Date.now()))); } catch (e) {}
    bookLastNew = 0; updateBookBadge(); if (activeTab === "autofill") renderBody();
  }
  async function loadBookings() {
    var sess = adminSession(); if (!sess || bookLoading) return;
    bookLoading = true; if (activeTab === "autofill" && !bookLoaded) renderBody();
    try {
      var r = await fetch(ADMIN_WORKER + "/admin/bookings", { headers: { Authorization: "Bearer " + sess } });
      if (r.ok) { bookCache = (await r.json()).bookings || []; bookLoaded = true; }
    } catch (e) {}
    bookLoading = false; updateBookBadge(); if (activeTab === "autofill") renderBody();
  }
  async function bookDo(uid, action, btn) {
    var b = null; for (var i = 0; i < bookCache.length; i++) if (bookCache[i].uid === uid) { b = bookCache[i]; break; }
    if (!b) return;
    if (btn) { btn.disabled = true; btn.textContent = "\u2026"; }
    try {
      var ok = false;
      if (action === "dismiss") {
        var rd = await fetch(ADMIN_WORKER + "/admin/bookings/delete", { method: "POST", headers: { Authorization: "Bearer " + adminSession(), "Content-Type": "application/json" }, body: JSON.stringify({ uid: uid }) });
        ok = rd.ok;
      } else {
        var link = action === "accept" ? b.accept : b.decline;
        if (link) { var ra = await fetch(link, { method: "POST" }); ok = ra.ok; }
      }
      if (ok) {
        bookCache = bookCache.filter(function (x) { return x.uid !== uid; });
        status(action === "accept" ? "Accepted \u2014 it\u2019s on your calendar \u2713" : action === "decline" ? "Declined \u2713" : "Dismissed");
        updateBookBadge(); if (activeTab === "autofill") renderBody();
      } else { status("Couldn\u2019t " + action + " \u2014 try again, or open it in Cal.com."); if (activeTab === "autofill") renderBody(); }
    } catch (e) { status("Couldn\u2019t " + action + " \u2014 check your connection."); if (activeTab === "autofill") renderBody(); }
  }
  function bookStatusLabel(b) {
    if (b.pending) return "Pending";
    return b.trig === "BOOKING_CANCELLED" ? "Cancelled" : b.trig === "BOOKING_REJECTED" ? "Declined" : b.trig === "BOOKING_RESCHEDULED" ? "Rescheduled" : "Confirmed";
  }
  function bookingCard(b) {
    var acts = b.pending
      ? '<button class="btn btn--primary" data-act="book-accept" data-uid="' + escAttr(b.uid) + '">Accept</button>' +
        '<button class="btn btn--ghost" data-act="book-decline" data-uid="' + escAttr(b.uid) + '">Decline</button>' +
        (b.manage ? '<a class="btn btn--ghost" href="' + escAttr(b.manage) + '" target="_blank" rel="noopener">Reschedule \u2197</a>' : "")
      : (b.manage ? '<a class="btn btn--ghost" href="' + escAttr(b.manage) + '" target="_blank" rel="noopener">Open \u2197</a>' : "") +
        '<button class="btn btn--ghost" data-act="book-dismiss" data-uid="' + escAttr(b.uid) + '">Dismiss</button>';
    var isNew = (b.at || 0) > bookSeen();
    return '<div class="rkinbox__row">' +
      '<div class="rkinbox__main">' +
        '<div class="rkinbox__who">' + (isNew ? '<span title="New" style="color:var(--accent)">\u25cf</span> ' : "") + "<b>" + escHtml(b.who || "Someone") + "</b>" +
          ' <span class="rkinbox__co">\u00b7 ' + escHtml(bookStatusLabel(b)) + "</span>" +
          (b.when ? ' <span class="rkinbox__ago">' + escHtml(b.when) + "</span>" : "") + "</div>" +
        '<div class="rkinbox__ctx">' + escHtml(b.title || "Call") + "</div>" +
        (b.email ? '<a class="rkinbox__mail" href="mailto:' + escAttr(b.email) + '">' + escHtml(b.email) + "</a>" : "") +
        (b.notes ? '<div class="rkinbox__note">\u201c' + escHtml(b.notes) + "\u201d</div>" : "") +
      "</div>" +
      '<div class="rkinbox__acts">' + acts + "</div>" +
    "</div>";
  }
  // Consistent monochrome line-icons for the More-tab "ext" cards (white on the purple chip, or
  // currentColor on buttons) — replaces the tiny mismatched emojis.
  function extIcon(k, s) {
    s = s || 21;
    var P = {
      phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/>',
      doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
      media: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>',
      zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><line x1="17.5" y1="14" x2="17.5" y2="21"/><line x1="21" y1="14" x2="21" y2="21"/><line x1="14" y1="17.5" x2="17.5" y2="17.5"/>',
      dl: '<path d="M12 3v12"/><polyline points="7 11 12 16 17 11"/><line x1="5" y1="21" x2="19" y2="21"/>'
    };
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[k] || "") + "</svg>";
  }
  function bookingsBlock() {
    var inner;
    if (!adminSession()) inner = '<p class="adm__ext-lead">Sign in to see your bookings.</p>';
    else if (bookLoading && !bookLoaded) inner = '<div class="spinner"></div>';
    else if (!bookCache.length) inner = '<p class="adm__ext-lead">No bookings yet. When someone books a call through your <b>Book a call</b> link, it appears here \u2014 accept, decline or reschedule right from this panel, and it syncs to your calendar.</p>';
    else inner = '<div class="rkinbox">' + bookCache.map(bookingCard).join("") + "</div>";
    return '<div class="adm__ext">' +
      '<div class="adm__ext-head"><span class="adm__ext-logo">' + extIcon("cal") + '</span><div><b>Bookings</b><span>Call requests \u2014 accept, decline or reschedule</span></div></div>' +
      '<div class="imgblk__row"><button class="btn btn--ghost" data-act="book-refresh">\u21bb Refresh</button></div>' +
      inner +
    "</div>";
  }
  /* ---------- Media library (More tab): grouped by where-used, searchable, size-labelled ---------- */
  var mediaOverlay = null, mediaFiles = null, mediaLoading = false;
  var mediaSearch = "", mediaSeg = "all", mediaSort = "size", mediaActive = null;
  function mediaFmt(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function mediaShort(s) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > 34 ? s.slice(0, 32) + "\u2026" : s; }
  // Walk the content and map each uploaded filename -> the human places it's used (case study / section).
  function mediaUsage() {
    var map = {}, files = mediaFiles || [];
    if (!files.length) return map;
    var fileSet = {}; files.forEach(function (f) { fileSet[f.name] = true; });
    function add(name, label) { (map[name] || (map[name] = [])); if (map[name].indexOf(label) === -1) map[name].push(label); }
    function scan(str, label) {
      if (!str || str.indexOf("assets/uploads/") === -1) return;
      var re = /assets\/uploads\/([\w.\-]+)/g, m;
      while ((m = re.exec(str))) { if (fileSet[m[1]]) add(m[1], label); }
    }
    function walk(node, label) {
      if (node == null) return;
      var t = typeof node;
      if (t === "string") { scan(node, label); return; }
      if (t !== "object") return;
      if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) walk(node[i], label); return; }
      for (var k in node) { if (Object.prototype.hasOwnProperty.call(node, k)) walk(node[k], label); }
    }
    var SECT = { landing: "Landing & hero", contact: "Contact & r\u00e9sum\u00e9", highlights: "Highlights", capabilities: "Capabilities", recognition: "Recognition", education: "Education", specialViews: "Special views", journey: "Journey" };
    var d = data || {};
    for (var k in d) {
      if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
      if (k === "work" && Array.isArray(d.work)) { d.work.forEach(function (w) { walk(w, mediaShort((w && (w.client || w.title)) || "Case study")); }); }
      else walk(d[k], SECT[k] || k);
    }
    return map;
  }
  function mediaOpen() {
    if (!adminSession()) { status("Sign in to manage media."); return; }
    mediaSearch = ""; mediaSeg = "all"; mediaSort = "size"; mediaActive = null; mediaFiles = null;
    mediaOverlay = document.createElement("div"); mediaOverlay.className = "mlib";
    mediaOverlay.innerHTML = mediaShell();
    document.body.appendChild(mediaOverlay);
    mediaOverlay.addEventListener("click", mediaClick);
    var srch = mediaOverlay.querySelector("[data-mlib-search]");
    if (srch) srch.addEventListener("input", function () { mediaSearch = this.value.toLowerCase(); mediaRender(); });
    mediaRender(); mediaLoad();
  }
  function mediaClose() { if (mediaOverlay) { mediaOverlay.remove(); mediaOverlay = null; } }
  function mediaShell() {
    return '<div class="mlib__sheet">' +
      '<div class="mlib__bar"><div class="mlib__h"><b>Media library</b><span data-mlib-sum>Loading\u2026</span></div>' +
        '<div class="mlib__acts"><button class="btn btn--ghost" data-act="media-refresh" title="Refresh">\u21bb</button><button class="btn adm__exit" data-act="media-close" aria-label="Close">\u2715</button></div></div>' +
      '<div class="mlib__controls">' +
        '<input class="mlib__search" data-mlib-search type="search" placeholder="Search by name or where it\u2019s used\u2026" autocomplete="off" />' +
        '<div class="mlib__segs" data-mlib-segs><button class="mlib__seg is-on" data-act="media-seg" data-seg="all">All</button><button class="mlib__seg" data-act="media-seg" data-seg="inuse">In use</button><button class="mlib__seg" data-act="media-seg" data-seg="unused">Unused</button></div>' +
        '<div class="mlib__segs" data-mlib-sortsegs><button class="mlib__seg is-on" data-act="media-sort" data-sort="size">Largest</button><button class="mlib__seg" data-act="media-sort" data-sort="name">Name</button></div>' +
        '<span class="mlib__clean" data-mlib-clean></span>' +
      '</div>' +
      '<div class="mlib__main"><div class="mlib__panel" data-mlib-panel></div><nav class="mlib__nav" data-mlib-nav></nav></div>' +
      '<div class="mlib__note">\u201cIn use\u201d = the file is referenced in your current content. Deleting commits a removal to your repo \u2014 remove <b>Unused</b> ones only; it can\u2019t be undone from here.</div>' +
    "</div>";
  }
  async function mediaLoad() {
    mediaLoading = true; mediaRender();
    try {
      var r = await fetch(ghContentsUrl("assets/uploads"), { headers: ghHeaders() });
      if (r.ok) { var arr = await r.json(); mediaFiles = (Array.isArray(arr) ? arr : []).filter(function (f) { return f.type === "file"; }).map(function (f) { return { name: f.name, size: f.size || 0, sha: f.sha }; }); }
      else mediaFiles = [];
    } catch (e) { mediaFiles = []; }
    mediaLoading = false; mediaRender();
  }
  function mediaRender() {
    if (!mediaOverlay) return;
    var sumEl = mediaOverlay.querySelector("[data-mlib-sum]");
    var navEl = mediaOverlay.querySelector("[data-mlib-nav]");
    var panelEl = mediaOverlay.querySelector("[data-mlib-panel]");
    var cleanEl = mediaOverlay.querySelector("[data-mlib-clean]");
    if (!navEl || !panelEl) return;
    mediaOverlay.querySelectorAll("[data-mlib-segs] .mlib__seg").forEach(function (b) { b.classList.toggle("is-on", b.getAttribute("data-seg") === mediaSeg); });
    mediaOverlay.querySelectorAll("[data-mlib-sortsegs] .mlib__seg").forEach(function (b) { b.classList.toggle("is-on", b.getAttribute("data-sort") === mediaSort); });
    if (mediaLoading || mediaFiles === null) { if (sumEl) sumEl.textContent = "Loading\u2026"; if (cleanEl) cleanEl.innerHTML = ""; navEl.innerHTML = ""; panelEl.innerHTML = '<div class="mlib__empty">Loading your media\u2026</div>'; return; }
    var files = mediaFiles || [], usage = mediaUsage();
    var totalB = files.reduce(function (a, f) { return a + f.size; }, 0);
    var unused = files.filter(function (f) { return !(usage[f.name] && usage[f.name].length); });
    var unusedB = unused.reduce(function (a, f) { return a + f.size; }, 0);
    if (sumEl) sumEl.innerHTML = files.length + " files \u00b7 " + mediaFmt(totalB) + " \u00b7 " + (files.length - unused.length) + " in use" + (unused.length ? ' \u00b7 <b class="mlib__unw">' + unused.length + " unused (" + mediaFmt(unusedB) + ")</b>" : " \u00b7 all in use");
    if (cleanEl) cleanEl.innerHTML = unused.length ? '<button class="btn btn--ghost mlib__cleanbtn" data-act="media-delorphans">Delete ' + unused.length + " unused</button>" : "";
    if (!files.length) { navEl.innerHTML = ""; panelEl.innerHTML = '<div class="mlib__empty">No uploaded media in <code>assets/uploads</code> yet.</div>'; return; }
    var q = mediaSearch.trim();
    var groups = {}, order = [];
    function grp(label) { if (!groups[label]) { groups[label] = { files: [], size: 0 }; order.push(label); } return groups[label]; }
    files.forEach(function (f) {
      var labels = usage[f.name] || [], isUnused = !labels.length;
      if (mediaSeg === "inuse" && isUnused) return;
      if (mediaSeg === "unused" && !isUnused) return;
      if (q && (f.name + " " + labels.join(" ")).toLowerCase().indexOf(q) === -1) return;
      var g = grp(isUnused ? "Unused" : labels[0]); g.files.push(f); g.size += f.size;
    });
    if (!order.length) { navEl.innerHTML = ""; panelEl.innerHTML = '<div class="mlib__empty">Nothing matches \u2014 try a different search or filter.</div>'; return; }
    order.sort(function (a, b) { if (a === "Unused") return -1; if (b === "Unused") return 1; return groups[b].size - groups[a].size; });
    if (order.indexOf(mediaActive) === -1) mediaActive = order[0];
    navEl.innerHTML = '<div class="mlib__navhd">Groups \u00b7 ' + order.length + '</div>' + order.map(function (label) {
      var g = groups[label];
      return '<button class="mlib__navitem' + (label === mediaActive ? " is-on" : "") + (label === "Unused" ? " is-unused" : "") + '" data-act="media-nav" data-group="' + escAttr(label) + '"><span class="mlib__navname">' + escHtml(label) + '</span><span class="mlib__navmeta">' + g.files.length + " \u00b7 " + mediaFmt(g.size) + "</span></button>";
    }).join("");
    var sortFn = mediaSort === "name" ? function (a, b) { return a.name.localeCompare(b.name); } : function (a, b) { return b.size - a.size; };
    var ag = groups[mediaActive]; ag.files.sort(sortFn);
    panelEl.innerHTML = '<div class="mlib__panelhd"><b>' + escHtml(mediaActive) + "</b><span>" + ag.files.length + (ag.files.length === 1 ? " item" : " items") + " \u00b7 " + mediaFmt(ag.size) + "</span></div>" +
      '<div class="mlib__grid">' + ag.files.map(function (f) { return mediaTile(f, usage); }).join("") + "</div>";
  }
  function mediaTile(f, usage) {
    var flabels = usage[f.name] || [], isUnused = !flabels.length;
    var isImg = /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(f.name);
    var thumb = isImg ? '<img loading="lazy" src="/assets/uploads/' + escAttr(f.name) + '" alt="" />' : '<div class="mlib__file">' + escHtml((f.name.split(".").pop() || "?").toUpperCase()) + "</div>";
    var extra = flabels.length > 1 ? '<span class="mlib__more" title="' + escAttr("Also in: " + flabels.slice(1).join(", ")) + '">+' + (flabels.length - 1) + "</span>" : "";
    return '<div class="mlib__card' + (isUnused ? " is-orphan" : "") + '">' +
      '<div class="mlib__thumb">' + thumb + '</div>' +
      '<div class="mlib__meta"><span class="mlib__size">' + mediaFmt(f.size) + '</span>' + (isUnused ? '<span class="mlib__tag">Unused</span>' : extra) + '</div>' +
      '<button class="mlib__del" data-act="media-del" data-name="' + escAttr(f.name) + '" data-sha="' + escAttr(f.sha) + '" title="Delete">\u2715</button>' +
    '</div>';
  }
  function mediaClick(e) {
    var b = e.target.closest("[data-act]");
    if (!b) { if (e.target === mediaOverlay) mediaClose(); return; }
    var act = b.dataset.act;
    if (act === "media-close") { mediaClose(); return; }
    if (act === "media-refresh") { mediaLoad(); return; }
    if (act === "media-nav") { mediaActive = b.dataset.group || null; mediaRender(); return; }
    if (act === "media-seg") { mediaSeg = b.dataset.seg || "all"; mediaActive = null; mediaRender(); return; }
    if (act === "media-sort") { mediaSort = b.dataset.sort || "size"; mediaRender(); return; }
    if (act === "media-delorphans") { mediaDelOrphans(); return; }
    if (act === "media-del") { if (confirm("Delete " + (b.dataset.name || "this file") + "? This commits a deletion to your repo.")) mediaDel(b.dataset.name, b.dataset.sha, b); return; }
  }
  async function mediaDel(name, sha, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "\u2026"; }
    try {
      var r = await fetch(ADMIN_WORKER + "/admin/media/delete", { method: "POST", headers: ghHeaders(), body: JSON.stringify({ name: name, sha: sha }) });
      var j = null; try { j = await r.json(); } catch (e) {}
      if (r.ok) { mediaFiles = (mediaFiles || []).filter(function (f) { return f.name !== name; }); mediaRender(); return true; }
      if (j && j.needStepup) status("This device isn\u2019t verified to delete \u2014 run a Publish once to set it up.");
      else status((j && j.error) || "Delete failed.");
    } catch (e) { status("Delete failed \u2014 check your connection."); }
    if (btn) { btn.disabled = false; btn.textContent = "\u2715"; }
    return false;
  }
  async function mediaDelOrphans() {
    var usage = mediaUsage();
    var orphans = (mediaFiles || []).filter(function (f) { return !(usage[f.name] && usage[f.name].length); });
    if (!orphans.length) return;
    if (!confirm("Delete " + orphans.length + " unused media file(s)? This commits deletions to your repo and can\u2019t be undone.")) return;
    status("Deleting " + orphans.length + " unused files\u2026");
    var done = 0;
    for (var i = 0; i < orphans.length; i++) { if (await mediaDel(orphans[i].name, orphans[i].sha, null)) done++; }
    status("Deleted " + done + " of " + orphans.length + " unused files.");
  }

  function accGrantLeft(g) {
    if (g.revoked) return "revoked";
    if (!g.expiresAt) return "no expiry";
    var d = Math.ceil((g.expiresAt - Date.now()) / 86400000);
    return d <= 0 ? "expired" : d + "d left";
  }
  function accReqRow(q) {
    var declined = q.status === "declined";
    var acts = declined
      ? '<button class="btn btn--ghost" data-act="acc-req-delete" data-id="' + escAttr(q.id) + '">Delete</button>'
      : '<button class="btn btn--primary" data-act="acc-req-approve" data-id="' + escAttr(q.id) + '">Approve</button>' +
        '<button class="btn btn--ghost" data-act="acc-req-curate" data-id="' + escAttr(q.id) + '">Curate\u2026</button>' +
        '<button class="btn btn--ghost" data-act="acc-req-decline" data-id="' + escAttr(q.id) + '">Decline</button>';
    return '<div class="rkinbox__row">' +
      '<div class="rkinbox__main">' +
        '<div class="rkinbox__who"><b>' + escHtml(q.name || "\u2014") + "</b>" + (q.company ? ' <span class="rkinbox__co">\u00b7 ' + escHtml(q.company) + "</span>" : "") + ' <span class="rkinbox__ago">' + escHtml(reqAgo(declined ? (q.declinedAt || q.at) : q.at)) + "</span></div>" +
        (q.email ? '<a class="rkinbox__mail" href="mailto:' + escAttr(q.email) + '">' + escHtml(q.email) + "</a>" : "") +
        (q.context ? '<div class="rkinbox__ctx">' + escHtml(q.context) + "</div>" : "") +
        (q.note ? '<div class="rkinbox__note">\u201c' + escHtml(q.note) + "\u201d</div>" : "") +
      "</div>" +
      '<div class="rkinbox__acts">' + acts + "</div>" +
    "</div>";
  }
  function accGrantRow(g) {
    var meta = "Opened " + (g.uses || 0) + "\u00d7" + (g.days ? " \u00b7 " + g.days + "d link" : "");
    // Active grants: copy / duration / revoke (NO hard delete — revoke first; it's reversible and tells the
    // recruiter). Revoked grants: restore, or permanently delete (surfaced via the "Show revoked" filter).
    var acts = g.revoked
      ? '<button class="btn btn--primary" data-act="acc-grant-revoke" data-token="' + escAttr(g.token) + '" data-on="1">Restore</button>' +
        '<button class="btn btn--danger" data-act="acc-grant-delete" data-token="' + escAttr(g.token) + '">Delete</button>'
      : '<button class="btn btn--ghost" data-act="acc-grant-copy" data-token="' + escAttr(g.token) + '">Copy link</button>' +
        '<button class="btn btn--ghost" data-act="acc-grant-days" data-token="' + escAttr(g.token) + '" data-days="' + escAttr(String(g.days || 15)) + '">Duration</button>' +
        '<button class="btn btn--ghost" data-act="acc-grant-revoke" data-token="' + escAttr(g.token) + '" data-on="0">Revoke</button>';
    return '<div class="rkinbox__row' + (g.revoked ? " is-off" : "") + '">' +
      '<div class="rkinbox__main">' +
        '<div class="rkinbox__who"><b>' + escHtml(g.name || g.email || "Recruiter") + "</b>" + (g.company ? ' <span class="rkinbox__co">\u00b7 ' + escHtml(g.company) + "</span>" : "") + ' <span class="rkinbox__ago">' + escHtml(accGrantLeft(g)) + "</span></div>" +
        (g.email ? '<a class="rkinbox__mail" href="mailto:' + escAttr(g.email) + '">' + escHtml(g.email) + "</a>" : "") +
        '<div class="rkinbox__ctx">' + escHtml(meta) + "</div>" +
      "</div>" +
      '<div class="rkinbox__acts">' + acts + "</div>" +
    "</div>";
  }
  // The "Custom" sub-tab body: reusable ticketed special views you build yourself (New / Tailor to a role)
  // plus the one-tap Full-access grant. Same revoke-first model as Approved/Curated: Revoke -> Show revoked
  // -> Restore/Delete. Each view is a slim card; Edit opens the low-density picker dialog (svEditModal).
  function customViewsPane() {
    const list = data.specialViews || (data.specialViews = []);
    const showRevoked = accShowRevoked;
    // The hidden "Full access" view (the Allow default, managed in the ⋯ menu) never shows here.
    const shown = list.map(function (sv, i) { return { sv: sv, i: i }; }).filter(function (x) { return !x.sv.fullAccess && !!x.sv.revoked === showRevoked; });
    const userCount = list.filter(function (sv) { return !sv.fullAccess; }).length;
    let html = '<label class="rkacc__switch"><input type="checkbox" data-act="acc-revoked"' + (showRevoked ? " checked" : "") + " /> Show revoked</label>";
    if (!showRevoked) {
      html += '<div class="adm__addbar rolekit__bar"><button class="btn btn--add" data-act="sv-add"' + (userCount >= 6 ? " disabled" : "") + '>+ New special view</button>' +
        '<button class="btn btn--auto rolekit__cta" data-act="sv-tailor">\u2728 Tailor to a role</button></div>';
      html += '<p class="af__hint" style="margin:.1rem 0 1rem">Curated, ticketed versions of the site for one audience (say an automotive company). Choose the work, numbers and skills they see, set a ticket phrase and an optional expiry. Up to 6. <em>Tickets are a soft gate \u2014 the curated content still ships in your published file, so don\u2019t put anything confidential here.</em></p>';
      if (userCount >= 6) html += '<div class="af__hint">Maximum of 6 special views reached.</div>';
    }
    if (!shown.length) html += '<div class="adm__empty">' + (showRevoked ? "No revoked views." : "No special views yet.") + "</div>";
    shown.forEach(function (x) { html += svCard(x.sv, x.i); });
    return html;
  }
  function accessSection() {
    var head = '<div class="rkacc__tabs">' + accSubBtn("requests", "Requests") + accSubBtn("approved", "Approved") + accSubBtn("curated", "Curated") + accSubBtn("custom", "Custom") + "</div>";
    var inner;
    if (accSubTab === "custom") {
      inner = customViewsPane();
    } else if (accLoading) {
      inner = '<div class="rkinbox__empty">Loading\u2026</div>';
    } else if (accSubTab === "requests") {
      inner = '<label class="rkacc__switch"><input type="checkbox" data-act="acc-declined"' + (accShowDeclined ? " checked" : "") + " /> Show declined</label>" +
        (accReqCache.length ? accReqCache.map(accReqRow).join("") : '<div class="rkinbox__empty">' + (accShowDeclined ? "No declined requests." : "No pending requests \u2014 you\u2019re all caught up.") + "</div>");
    } else {
      var curated = accSubTab === "curated";
      var gs = accGrantCache.filter(function (g) { return ((g.mode || "all") === "curated") === curated; })
        .filter(function (g) { return !!g.revoked === accShowRevoked; });
      var gempty = accShowRevoked ? "No revoked grants here." : (curated ? "No curated grants yet \u2014 use Curate\u2026 on a request." : "No approved grants yet.");
      inner = '<label class="rkacc__switch"><input type="checkbox" data-act="acc-revoked"' + (accShowRevoked ? " checked" : "") + " /> Show revoked</label>" +
        (gs.length ? gs.map(accGrantRow).join("") : '<div class="rkinbox__empty">' + gempty + "</div>");
    }
    return secHead("Special Views", "One place for who sees your work \u2014 approve incoming requests, mint scoped <code>/?k=</code> links, and build reusable ticketed views for specific audiences.") +
      '<div class="rkinbox">' + head + '<div data-accbody>' + inner + "</div></div>";
  }
  async function loadAccessData() {
    var sess = adminSession(); if (!sess) return;
    accLoading = true; if (activeTab === "special") renderBody();
    try {
      var rq = await fetch(ADMIN_WORKER + "/admin/requests?status=" + (accShowDeclined ? "declined" : "pending"), { headers: { Authorization: "Bearer " + sess } });
      if (rq.ok) accReqCache = (await rq.json()).requests || [];
      var rg = await fetch(ADMIN_WORKER + "/admin/access", { headers: { Authorization: "Bearer " + sess } });
      if (rg.ok) accGrantCache = (await rg.json()).grants || [];
    } catch (e) {}
    accLoading = false; accSyncBadges(); if (activeTab === "special") renderBody();
  }

  // Foldable curation dialog — pick exactly what a recruiter sees, then mint a scoped link.
  function curateModal(reqId) {
    var q = accReqCache.filter(function (x) { return x.id === reqId; })[0] || {};
    var works = data.work || [], highs = data.highlights || [], caps = data.capabilities || [];
    var wOpts = works.map(function (w, wi) { return '<label class="svchk"><input type="checkbox" data-cur="work" value="' + escAttr(w.id) + '" /><span>' + escHtml(w.client || w.title || ("Work " + (wi + 1))) + "</span></label>"; }).join("");
    var hOpts = highs.map(function (hh, hi) { return '<label class="svchk"><input type="checkbox" data-cur="high" value="' + hi + '" checked /><span>' + escHtml((hh.value || "") + " \u00b7 " + (hh.label || "")) + "</span></label>"; }).join("");
    var cOpts = caps.map(function (c, ci) { return '<label class="svchk"><input type="checkbox" data-cur="cap" value="' + ci + '" checked /><span>' + escHtml(c) + "</span></label>"; }).join("");
    var modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box pass__box--wide"><div class="pass__title">Curate access \u2014 ' + escHtml(q.name || "recruiter") + "</div>" +
      '<div class="pass__sub">Approving emails a private link scoped to exactly this selection.</div>' +
      '<details open class="rkcur__grp"><summary>Work shown <span>(none ticked = all work)</span></summary><div class="svchk__grid">' + wOpts + "</div></details>" +
      '<details class="rkcur__grp"><summary>Numbers shown <span>(all by default)</span></summary><div class="svchk__grid">' + hOpts + "</div></details>" +
      '<details class="rkcur__grp"><summary>Capabilities shown <span>(all by default)</span></summary><div class="svchk__grid">' + cOpts + "</div></details>" +
      '<div class="rkcur__days"><label>Link lasts <input type="number" min="0" step="1" value="15" data-cur-days /> days <span>(0 = no expiry)</span></label></div>' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button>' +
      '<button class="btn btn--primary" data-go>Approve &amp; email link</button></div></div>';
    document.body.appendChild(modal);
    var err = modal.querySelector(".pass__err"), go = modal.querySelector("[data-go]");
    var done = function () { modal.remove(); };
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    modal.addEventListener("click", function (e) { if (e.target === modal) done(); });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") done(); });
    go.addEventListener("click", async function () {
      var pick = function (sel) { return Array.prototype.map.call(modal.querySelectorAll('[data-cur="' + sel + '"]:checked'), function (x) { return x.value; }); };
      var workIds = pick("work");
      var highlightIdx = pick("high").map(Number);
      var capabilityIdx = pick("cap").map(Number);
      var days = Math.max(0, parseInt((modal.querySelector("[data-cur-days]") || {}).value || "15", 10) || 0);
      go.disabled = true; err.textContent = ""; var was = go.textContent; go.textContent = "Sending\u2026";
      try {
        var r = await fetch(ADMIN_WORKER + "/admin/requests/curate", { method: "POST", headers: { Authorization: "Bearer " + adminSession(), "Content-Type": "application/json" }, body: JSON.stringify({ id: reqId, workIds: workIds, highlightIdx: highlightIdx, capabilityIdx: capabilityIdx, days: days }) });
        if (!r.ok) throw 0;
        done();
        accReqCache = accReqCache.filter(function (x) { return x.id !== reqId; });
        renderBody();
        status("Curated access emailed.", true);
        loadAccessData();
      } catch (e) { go.disabled = false; go.textContent = was; err.textContent = "Couldn\u2019t send \u2014 try again."; }
    });
  }

  function svCard(sv, i) {
    const revoked = !!sv.revoked;
    const expired = window.RK.svExpired(sv), left = window.RK.svDaysLeft(sv);
    const exp = !sv.days ? "no expiry" : expired ? "expired" : (left <= 0 ? "expires today" : left + "d left");
    const nWork = (sv.workIds || []).length;
    const meta = (sv.audience ? escHtml(sv.audience) + " \u00b7 " : "") + (sv.ticketHash ? "ticket set" : "no ticket") + " \u00b7 " + (nWork ? nWork + (nWork > 1 ? " works" : " work") : "all work") + " \u00b7 " + exp;
    const badge = revoked ? ' <span class="rkinbox__ago">revoked</span>' : (expired ? ' <span class="rkinbox__ago">expired</span>' : "");
    const acts = revoked
      ? '<button class="btn btn--primary" data-act="sv-restore" data-index="' + i + '">Restore</button>' +
        '<button class="btn btn--danger" data-act="sv-delete" data-index="' + i + '">Delete</button>'
      : '<div class="svshare"><button class="btn btn--ghost svshare__btn" data-act="sv-share" data-index="' + i + '">Share \u25be</button>' +
          '<div class="svshare__menu" hidden><button class="svshare__item" data-act="sv-copylink" data-index="' + i + '">Copy link</button><button class="svshare__item" data-act="sv-copycode" data-index="' + i + '">Copy code</button></div></div>' +
        '<button class="btn btn--ghost" data-act="sv-edit" data-index="' + i + '">Edit</button>' +
        '<button class="btn btn--warn" data-act="sv-revoke" data-index="' + i + '">Revoke</button>';
    return '<div class="rkinbox__row' + (revoked ? " is-off" : "") + '">' +
      '<div class="rkinbox__main">' +
        '<div class="rkinbox__who"><b>' + escHtml(sv.name || ("View " + (i + 1))) + "</b>" + badge + "</div>" +
        '<div class="rkinbox__ctx">' + meta + "</div>" +
      "</div>" +
      '<div class="rkinbox__acts">' + acts + "</div>" +
    "</div>";
  }
  // Low-density Edit dialog for a special view: name / audience / ticket / expiry + foldable Work / Numbers /
  // Capabilities pickers (reuses the curate dialog's .rkcur__grp + .svchk styles). Gathers on Save/Preview.
  function svEditModal(i) {
    const sv = (data.specialViews || [])[i];
    if (!sv) return;
    const works = data.work || [], highs = data.highlights || [], caps = data.capabilities || [];
    const wOpts = works.map(function (w, wi) { return '<label class="svchk"><input type="checkbox" data-cur="work" value="' + escAttr(w.id) + '"' + ((sv.workIds || []).indexOf(w.id) !== -1 ? " checked" : "") + ' /><span>' + escHtml(w.client || w.title || ("Work " + (wi + 1))) + "</span></label>"; }).join("");
    const hOpts = highs.map(function (hh, hi) { return '<label class="svchk"><input type="checkbox" data-cur="high" value="' + hi + '"' + ((sv.highlightIdx || []).indexOf(hi) !== -1 ? " checked" : "") + ' /><span>' + escHtml((hh.value || "") + " \u00b7 " + (hh.label || "")) + "</span></label>"; }).join("");
    const cOpts = caps.map(function (c, ci) { return '<label class="svchk"><input type="checkbox" data-cur="cap" value="' + ci + '"' + ((sv.capabilityIdx || []).indexOf(ci) !== -1 ? " checked" : "") + ' /><span>' + escHtml(c) + "</span></label>"; }).join("");
    const tv = ticketPlain[sv.id] || "";
    const modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box pass__box--wide"><div class="pass__title">Edit view</div>' +
      '<div class="pass__sub">A curated, ticketed version of your site for one audience. Pick what shows, set a ticket, publish to share.</div>' +
      '<div class="af"><label class="af__label">Name (only you see this)</label><input type="text" data-e="name" value="' + escAttr(sv.name) + '" /></div>' +
      '<div class="af"><label class="af__label">Audience line (replaces the hero eyebrow)</label><input type="text" data-e="audience" value="' + escAttr(sv.audience) + '" placeholder="e.g. Prepared for Jaguar Land Rover" /></div>' +
      '<div class="af__row"><div class="af"><label class="af__label">Ticket phrase</label><input type="text" data-e="ticket" value="' + escAttr(tv) + '" placeholder="' + (sv.ticketHash && !tv ? "Set \u2014 type to change" : "e.g. jaguar-2026") + '" /><div class="af__hint">' + (sv.ticketHash ? "Ticket set \u2713" : "Not set") + " \u00b7 case-insensitive</div></div>" +
        '<div class="af"><label class="af__label">Auto-hide after (days)</label><input type="number" min="0" step="1" data-e="days" value="' + (sv.days || 0) + '" /><div class="af__hint">0 = never</div></div></div>' +
      '<details open class="rkcur__grp"><summary>Work shown <span>(none ticked = all work)</span></summary><div class="svchk__grid">' + wOpts + "</div></details>" +
      '<details class="rkcur__grp"><summary>Numbers shown <span>(all by default)</span></summary><div class="svchk__grid">' + hOpts + "</div></details>" +
      '<details class="rkcur__grp"><summary>Capabilities shown <span>(all by default)</span></summary><div class="svchk__grid">' + cOpts + "</div></details>" +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button><button class="btn btn--ghost" data-preview>Preview \u2192</button><button class="btn btn--primary" data-go>Save</button></div></div>';
    document.body.appendChild(modal);
    const done = function () { modal.remove(); };
    function pick(sel) { return Array.prototype.map.call(modal.querySelectorAll('[data-cur="' + sel + '"]:checked'), function (x) { return x.value; }); }
    function applyFields() {
      sv.name = (modal.querySelector('[data-e="name"]').value || "").trim() || sv.name;
      sv.audience = modal.querySelector('[data-e="audience"]').value;
      sv.days = Math.max(0, parseInt(modal.querySelector('[data-e="days"]').value, 10) || 0);
      if (!sv.createdAt) sv.createdAt = Date.now();
      sv.workIds = pick("work");
      sv.highlightIdx = pick("high").map(Number);
      sv.capabilityIdx = pick("cap").map(Number);
      const order = (data.work || []).map(function (w) { return w.id; });
      sv.workIds.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
      sv.highlightIdx.sort(function (a, b) { return a - b; });
      sv.capabilityIdx.sort(function (a, b) { return a - b; });
    }
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    modal.addEventListener("click", function (e) { if (e.target === modal) done(); });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") done(); });
    modal.querySelector("[data-preview]").addEventListener("click", function () { applyFields(); saveDraft(); svPreview(i); });
    modal.querySelector("[data-go]").addEventListener("click", async function () {
      applyFields();
      const ticket = (modal.querySelector('[data-e="ticket"]').value || "").trim();
      if (ticket !== (tv || "").trim()) { ticketPlain[sv.id] = ticket; await setSvTicket(sv, ticket); }
      else saveDraft(true);
      done(); renderBody(); status("View updated.", true);
    });
  }

  function svChecklist(i, kind, label, items) {
    const boxes = items.map(function (it) {
      return '<label class="svchk"><input type="checkbox" data-sv="' + i + '" data-sel="' + kind + '" data-val="' + escAttr(String(it.val)) + '"' + (it.on ? " checked" : "") + " /><span>" + escHtml(it.label) + "</span></label>";
    }).join("");
    return '<div class="sv-sel"><div class="sv-sel__label">' + label + ' <span>(none = show default)</span></div><div class="svchk__grid">' + (boxes || '<span class="af__hint">Nothing to choose yet.</span>') + "</div></div>";
  }

  function titleMetaList(list, name, note) {
    const items = data[list] || [];
    let html = secHead(name, note) +
      '<div class="adm__autobar"><button class="btn btn--auto" data-act="icon-gen-all" data-list="' + list + '"' + (items.length ? "" : " disabled") + '>\u2728 Auto-icons</button>' +
      '<span class="adm__auto-note">AI reads each entry and matches a crisp line icon. Pick, regenerate (\u2728) or remove (\u2715) any icon below.</span></div>' +
      addBar(list, "Add " + name.toLowerCase());
    items.forEach((a, i) => {
      html += '<div class="card">' + cardHead(name + " " + (i + 1), list, i, items.length) +
        itemField(list, i, "title", "Title") + itemField(list, i, "meta", "Meta / date") +
        iconField(list, i, a) + "</div>";
    });
    return html;
  }

  // Per-entry icon control: live preview + manual picker + AI regenerate + remove.
  function iconField(list, i, a) {
    const RK = window.RK || {};
    const set = RK.RECOGNITION_ICONS || [];
    const cur = (a && a.icon && (!RK.RECOGNITION_ICON_SVG || RK.RECOGNITION_ICON_SVG[a.icon])) ? a.icon : "";
    const preview = (cur && RK.recIcon) ? RK.recIcon(cur) : '<span class="adm__iconf-none">\u2014</span>';
    const opts = '<option value="">No icon</option>' + set.map(function (s) {
      return '<option value="' + s[0] + '"' + (s[0] === cur ? " selected" : "") + ">" + escHtml(s[1]) + "</option>";
    }).join("");
    return '<div class="af adm__iconf"><label class="af__label">Icon</label>' +
      '<div class="adm__iconf-row">' +
        '<span class="adm__iconf-prev' + (cur ? " has" : "") + '">' + preview + "</span>" +
        '<select data-iconpick="' + list + '" data-index="' + i + '">' + opts + "</select>" +
        '<button class="iconbtn" data-act="icon-regen" data-list="' + list + '" data-index="' + i + '" title="Regenerate with AI" aria-label="Regenerate icon with AI">\u2728</button>' +
        '<button class="iconbtn iconbtn--danger" data-act="icon-remove" data-list="' + list + '" data-index="' + i + '" title="Remove icon" aria-label="Remove icon"' + (cur ? "" : " disabled") + ">\u2715</button>" +
      "</div></div>";
  }

  /* ---------- AI-matched recognition / education icons ---------- */
  function iconEntryStr(a) { return [a && a.title, a && a.meta].map(function (x) { return String(x || "").trim(); }).filter(Boolean).join(" \u2014 "); }
  async function aiPickIcons(entries) {
    const RK = window.RK || {};
    const set = RK.RECOGNITION_ICONS || [];
    const names = set.map(function (s) { return s[0]; });
    const listDesc = set.map(function (s) { return "- " + s[0] + ": " + s[1]; }).join("\n");
    const system = "You label each portfolio entry (an award, talk, hackathon, certification, degree, competition, sport result or similar) with the single best-fitting icon from a FIXED set, matching on the MEANING/type of the entry. Return STRICT JSON only: {\"icons\":[\"name\", ...]} with exactly one icon name per entry, IN THE SAME ORDER as given. Use only names from the set. If nothing fits well, use \"star\".";
    const user = "ICON SET (name: when to use):\n" + listDesc +
      "\n\nENTRIES (label each, in order):\n" + entries.map(function (e, k) { return (k + 1) + ". " + e; }).join("\n") +
      "\n\nReturn {\"icons\":[...]} with exactly " + entries.length + " icon name" + (entries.length > 1 ? "s" : "") + ", one per entry, in order.";
    const out = await aiText(aiCfg("txt"), system, user, { json: true, maxTokens: 500, temperature: 0.2 });
    const j = csgenParse(out);
    const arr = (j && Array.isArray(j.icons)) ? j.icons : [];
    return entries.map(function (_, k) { const n = String(arr[k] || "").trim().toLowerCase(); return names.indexOf(n) !== -1 ? n : "star"; });
  }
  async function iconGenerateAll(list, btn) {
    const items = data[list] || [];
    if (!items.length) { status("Add some entries first."); return; }
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { iconGenerateAll(list, btn); }); return; }
    if (btn) { btn.disabled = true; btn.textContent = "Matching icons\u2026"; }
    status("Reading your entries and matching icons\u2026");
    try {
      const icons = await aiPickIcons(items.map(iconEntryStr));
      items.forEach(function (a, k) { a.icon = icons[k] || "star"; });
      apply(true);
      if (activeTab === list) renderBody();
      status("Matched " + items.length + " icon" + (items.length > 1 ? "s" : "") + " \u2014 pick, regenerate or remove any below.", true);
    } catch (e) { status("Icon matching failed: " + ((e && e.message) || "error")); }
    if (btn) { btn.disabled = false; btn.textContent = "\u2728 Auto-icons"; }
  }
  async function iconRegen(list, i) {
    const a = (data[list] || [])[i];
    if (!a) return;
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { iconRegen(list, i); }); return; }
    status("Matching an icon\u2026");
    try {
      const icons = await aiPickIcons([iconEntryStr(a)]);
      a.icon = icons[0] || "star";
      apply(true);
      if (activeTab === list) renderBody();
      status("Icon updated.", true);
    } catch (e) { status("Couldn\u2019t match an icon: " + ((e && e.message) || "error")); }
  }
  function iconRemove(list, i) {
    const a = (data[list] || [])[i];
    if (!a) return;
    delete a.icon;
    apply(true);
    if (activeTab === list) renderBody();
  }

  /* ---------- About-page photo grid (up to 6) ---------- */
  function aboutGalleryArr() { return Array.isArray(data.aboutGallery) ? data.aboutGallery : (data.aboutGallery = []); }
  function galleryItemEditor(g, j, n) {
    const src = g.src || "";
    const thumb = src ? '<img src="' + escAttr(previewSrc(src)) + '" alt="" />' : '<span class="adm__gal-empty">empty</span>';
    return '<div class="adm__gal-item">' +
      '<div class="adm__gal-h"><span class="adm__ovm-n">' + (j + 1) + "</span>" +
        '<div class="adm__ovm-ops">' +
          '<button type="button" data-act="gal-up" data-gindex="' + j + '"' + (j === 0 ? " disabled" : "") + ' title="Move up">\u2191</button>' +
          '<button type="button" data-act="gal-down" data-gindex="' + j + '"' + (j === n - 1 ? " disabled" : "") + ' title="Move down">\u2193</button>' +
          '<button type="button" data-act="gal-remove" data-gindex="' + j + '" title="Remove">\u2715</button>' +
        "</div></div>" +
      '<div class="adm__gal-thumb' + (src ? " has" : "") + '">' + thumb + "</div>" +
      '<div class="imgblk__row"><button class="btn btn--ghost" data-act="gal-upload" data-gindex="' + j + '">' + (src ? "Replace\u2026" : "Upload\u2026") + "</button>" + (src ? '<button class="btn btn--ghost" data-act="gal-clear" data-gindex="' + j + '">Clear</button>' : "") + mediaSizeTag(src) + "</div>" +
      '<input type="text" class="adm__gal-cap" data-galedit="' + j + '" data-galfield="caption" value="' + escAttr(g.caption || "") + '" placeholder="Caption (optional)" />' +
      "</div>";
  }
  function aboutGalleryBlock() {
    const arr = aboutGalleryArr();
    const MAX = 6;
    const items = arr.map(function (g, j) { return galleryItemEditor(g, j, arr.length); }).join("");
    const add = arr.length < MAX
      ? '<button type="button" class="btn btn--add" data-act="gal-add">+ Add photo</button>'
      : '<div class="af__hint">Up to ' + MAX + " photos.</div>";
    return secHead("Photos", "A small strip of up to 6 personal shots \u2014 you working, riding, whatever tells your story. It shows right after your About text (hidden until you add one).") +
      '<div class="adm__gal">' + (items || '<div class="adm__empty">No photos yet \u2014 add up to 6.</div>') + "</div>" +
      add;
  }
  function onGalEdit(t) {
    const arr = data.aboutGallery, j = +t.dataset.galedit;
    if (!arr || !arr[j]) return;
    arr[j][t.dataset.galfield] = t.value;
    apply();
  }

  /* ---------- Landing brands / product logos (marquee) ---------- */
  function logosArr() { return Array.isArray((data.landing || {}).logos) ? data.landing.logos : ((data.landing = data.landing || {}).logos = []); }
  function logoItemEditor(g, j, n) {
    const src = g.src || "";
    const thumb = src ? '<img src="' + escAttr(previewSrc(src)) + '" alt="" />' : '<span class="adm__gal-empty">empty</span>';
    return '<div class="adm__gal-item">' +
      '<div class="adm__gal-h"><span class="adm__ovm-n">' + (j + 1) + "</span>" +
        '<div class="adm__ovm-ops">' +
          '<button type="button" data-act="logo-up" data-lindex="' + j + '"' + (j === 0 ? " disabled" : "") + ' title="Move up">\u2191</button>' +
          '<button type="button" data-act="logo-down" data-lindex="' + j + '"' + (j === n - 1 ? " disabled" : "") + ' title="Move down">\u2193</button>' +
          '<button type="button" data-act="logo-remove" data-lindex="' + j + '" title="Remove">\u2715</button>' +
        "</div></div>" +
      '<div class="adm__gal-thumb' + (src ? " has" : "") + '">' + thumb + "</div>" +
      '<div class="imgblk__row"><button class="btn btn--ghost" data-act="logo-upload" data-lindex="' + j + '">' + (src ? "Replace\u2026" : "Upload\u2026") + "</button>" + (src ? '<button class="btn btn--ghost" data-act="logo-clear" data-lindex="' + j + '">Clear</button>' : "") + mediaSizeTag(src) + "</div>" +
      '<input type="text" class="adm__gal-cap" data-logoedit="' + j + '" data-logofield="name" value="' + escAttr(g.name || "") + '" placeholder="Name (shown on hover)" />' +
      '<select class="adm__logo-size" data-logosize="' + j + '" style="width:100%;margin-top:.4rem" title="Logo size within its card">' +
        '<option value="sm"' + (g.size === "sm" ? " selected" : "") + ">Small</option>" +
        '<option value="md"' + (!g.size || g.size === "md" ? " selected" : "") + ">Medium</option>" +
        '<option value="lg"' + (g.size === "lg" ? " selected" : "") + ">Large</option>" +
      "</select>" +
      "</div>";
  }
  function logosBlock() {
    const arr = logosArr();
    const MAX = 24;
    const items = arr.map(function (g, j) { return logoItemEditor(g, j, arr.length); }).join("");
    const add = arr.length < MAX
      ? '<button type="button" class="btn btn--add" data-act="logo-add">+ Add logo</button>'
      : '<div class="af__hint">Up to ' + MAX + " logos.</div>";
    return secHead("Brands &amp; products", "Logos of the companies and products you\u2019ve worked with \u2014 they run in a marquee at the bottom of the landing\u2019s first screen (the name shows on hover). Transparent PNG or SVG works best. Hidden until you add one.") +
      '<div class="adm__gal adm__gal--logos">' + (items || '<div class="adm__empty">No logos yet.</div>') + "</div>" +
      add;
  }
  function onLogoEdit(t) {
    const arr = (data.landing || {}).logos, j = +t.dataset.logoedit;
    if (!arr || !arr[j]) return;
    arr[j][t.dataset.logofield] = t.value;
    apply();
  }

  /* ---------- contact section badges (which pills to show) ---------- */
  const CONTACT_BADGES = [
    ["email", "Email"],
    ["phone", "Phone"],
    ["linkedin", "LinkedIn"],
    ["vcard", "Save contact"],
    ["resume", "R\u00e9sum\u00e9"],
    ["booking", "Book a call"],
  ];
  function contactBadgesBlock() {
    const B = (data.contact && data.contact.badges) || {};
    const rows = CONTACT_BADGES.map(function (d) {
      return '<label class="chk"><input type="checkbox" data-act="badge-toggle" data-badge="' + d[0] + '"' + (B[d[0]] !== false ? " checked" : "") + " /> " + escHtml(d[1]) + "</label>";
    }).join("");
    return secHead("Contact badges", "Choose which pills show in the contact section. A pill still needs its value above to appear (e.g. Book a call needs a booking link).") +
      '<div class="adm__badges">' + rows + "</div>";
  }

  /* ---------- About-page section order + visibility ---------- */
  function aboutLayoutArr() {
    const RK = window.RK || {};
    if (RK.aboutLayout) return RK.aboutLayout(data).map((s) => ({ key: s.key, on: s.on !== false }));
    return (RK.ABOUT_SECTIONS || []).map((s) => ({ key: s[0], on: true }));
  }
  function setAboutLayout(arr) {
    data.aboutSections = arr.map((s) => ({ key: s.key, on: s.on !== false }));
    apply(true);
    if (activeTab === "aboutpage") renderBody();
  }

  /* ---------- Landing / work-page section order + visibility ---------- */
  function workLayoutArr() {
    const RK = window.RK || {};
    if (RK.workLayout) return RK.workLayout(data).map((s) => ({ key: s.key, on: s.on !== false }));
    return (RK.WORK_SECTIONS || []).map((s) => ({ key: s[0], on: true }));
  }
  function setWorkLayout(arr) {
    data.workSections = arr.map((s) => ({ key: s.key, on: s.on !== false }));
    apply(true);
    if (activeTab === "landing") renderBody();
  }
  function workReorderBlock() {
    const RK = window.RK || {};
    const defs = RK.WORK_SECTIONS || [["hero", "Hero"], ["highlights", "Highlights"], ["work", "Selected work"], ["capabilities", "Capabilities"]];
    const labels = {}; defs.forEach((s) => { labels[s[0]] = s[1]; });
    const where = { hero: "The statement, intro & cue (fields below)", highlights: "Brands & numbers, from the Highlights tab", work: "Edit in the Work tab", capabilities: "Edit in the Capabilities tab" };
    const layout = RK.workLayout ? RK.workLayout(data) : defs.map((s) => ({ key: s[0], on: true }));
    let html = secHead("Landing sections", "Reorder the landing sections and show or hide any of them \u2014 use the arrows to move a section, untick to hide it. Contact always stays at the end.");
    html += '<ul class="adm__seclist">';
    layout.forEach((s, i) => {
      html += '<li class="adm__secrow' + (s.on ? "" : " is-off") + '">' +
        '<span class="adm__secrow-ops">' +
        '<button class="iconbtn" data-act="worksec-up" data-i="' + i + '"' + (i === 0 ? " disabled" : "") + ' title="Move up">\u2191</button>' +
        '<button class="iconbtn" data-act="worksec-down" data-i="' + i + '"' + (i === layout.length - 1 ? " disabled" : "") + ' title="Move down">\u2193</button>' +
        "</span>" +
        '<span class="adm__secrow-main"><span class="adm__secrow-name">' + escHtml(labels[s.key] || s.key) + '</span><span class="adm__secrow-where">' + escHtml(where[s.key] || "") + "</span></span>" +
        '<label class="adm__secrow-tog"><input type="checkbox" data-act="worksec-toggle" data-key="' + s.key + '"' + (s.on ? " checked" : "") + ' /><span class="adm__secrow-state">' + (s.on ? "Shown" : "Hidden") + "</span></label>" +
        "</li>";
    });
    html += "</ul>";
    return html;
  }

  function stmtSizeBlock() {
    var sz = ((data.landing || {}).statementSize) || "large";
    var opt = function (v, lbl) { return '<option value="' + v + '"' + (sz === v ? " selected" : "") + ">" + lbl + "</option>"; };
    return '<div class="af"><label class="af__label">Statement size</label><select data-statementsize>' +
      opt("large", "Large \u2014 full hero") + opt("standard", "Standard") + opt("compact", "Compact \u2014 matches Selected work") +
      '</select><div class="af__hint">Large is the full hero scale. Compact matches the \u201cSelected work\u201d heading \u2014 handy when the statement sits lower in the page.</div></div>';
  }
  function secHead(title, note) {
    return '<div class="adm__sec-title">' + title + '</div><div class="adm__sec-note">' + note + "</div>";
  }
  // Wrap a group of controls in a card. A secHead inside a card renders as a small mono heading.
  function group(inner) {
    return '<section class="adm__group">' + inner + "</section>";
  }

  /* ---------- Design Journey editor (L2 panel) ---------- */
  function journeyData() {
    if (!data.journey || typeof data.journey !== "object") data.journey = { enabled: false, chapters: [] };
    if (!Array.isArray(data.journey.chapters)) data.journey.chapters = [];
    return data.journey;
  }
  function blankChapter() { return { id: "jc" + Date.now().toString(36), name: "New chapter", entries: [] }; }
  function blankEntry() { return { id: "je" + Date.now().toString(36) + Math.floor(Math.random() * 999), period: "", title: "", body: "", workId: "", layout: "auto", images: [] }; }
  function journeyCard() {
    var j = data.journey || {};
    var on = !!j.enabled;
    var chaps = (j.chapters || []).length;
    var entries = (j.chapters || []).reduce(function (n, c) { return n + ((c && c.entries) ? c.entries.length : 0); }, 0);
    return '<div class="card jrncard">' +
      '<div class="adm__sec-title" style="margin-top:.2rem">Design Journey</div>' +
      '<div class="adm__sec-note">An immersive, scrollable timeline of your whole journey \u2014 chapters (Microsoft / Jaguar Land Rover / \u2026) each with dated entries, rich descriptions and images. It\u2019s an owner-only presentation aid: the \u201cView full journey\u201d button appears only in Present mode (\u22ef menu \u2192 Present mode), not on the public site.</div>' +
      '<label class="chk jrncard__chk"><input type="checkbox" data-act="journey-toggle"' + (on ? " checked" : "") + " /> Enable the journey (shown in Present mode)</label>" +
      '<div class="jrncard__row"><button class="btn btn--primary" data-act="journey-edit">Edit journey \u2192</button>' +
      '<span class="jrncard__meta">' + (chaps ? (chaps + " chapter" + (chaps > 1 ? "s" : "") + " \u00b7 " + entries + " entr" + (entries === 1 ? "y" : "ies")) : "No chapters yet") + "</span></div></div>";
  }
  function previewJourney() {
    var w = frameWin();
    if (!(w && w.RK && w.RK.openJourney)) return;
    try { w.RK.data = resolvePreviewData(data); } catch (e) {}
    try { w.RK.openJourney({ preview: true, silent: true }); } catch (e) {}
  }
  function refreshJourneyPreview() {
    if (!journeyOpen) return;
    clearTimeout(jrnPreviewTimer);
    jrnPreviewTimer = setTimeout(function () { if (journeyOpen) previewJourney(); }, 180);
  }
  function setL2BackLabel(txt) {
    var bk = root && root.querySelector(".adm__l2-back");
    if (bk) bk.innerHTML = '<span aria-hidden="true">\u2039</span> ' + txt;
  }
  function openJourneyEditor() {
    journeyData();
    journeyOpen = true;
    openStudy = -1;
    if (l2title) l2title.textContent = "Design Journey";
    setL2BackLabel("Back to Path");
    l2body.innerHTML = journeyEditor();
    resolveMediaSizes(l2body);
    body.hidden = true;
    l2.hidden = false;
    if (root) root.classList.add("is-l2");
    requestAnimationFrame(function () { l2.classList.add("is-open"); });
    var ed = root.querySelector(".adm__editor"); if (ed) ed.scrollTop = 0;
    saveDraft();
    previewJourney();
    l2PreviewApply();
  }
  function renderJourneyEditor() {
    if (!journeyOpen) return;
    l2body.innerHTML = journeyEditor();
    resolveMediaSizes(l2body);
    refreshJourneyPreview();
  }
  function closeJourneyEditor(opts) {
    opts = opts || {};
    journeyOpen = false;
    if (l2) { l2.hidden = true; l2.classList.remove("is-open"); }
    if (root) { root.classList.remove("is-l2"); root.classList.remove("is-preview"); root.classList.remove("is-noprev"); }
    if (body) body.hidden = false;
    setL2BackLabel("Back to projects");
    var ed = root.querySelector(".adm__editor"); if (ed) ed.scrollTop = 0;
    var vt = root && root.querySelector("[data-view]"); if (vt) vt.textContent = "Preview";
    try { var w = frameWin(); if (w && w.RK && w.RK.closeJourney) w.RK.closeJourney(); } catch (e) {}
    previewLanding();
    if (opts.render !== false) renderBody();
  }
  function richJourney(c, e, val) {
    return '<div class="af rt"><label class="af__label">Description (optional)</label>' + richTools() +
      richArea('data-rtjrn="body" data-jc="' + c + '" data-je="' + e + '"', val) + "</div>";
  }
  function journeyWorkOptions(sel) {
    var opts = '<option value="">\u2014 no case study \u2014</option>';
    (data.work || []).forEach(function (w) {
      if (!w || w.encWork) return;
      var label = (w.title && w.title !== "Project title") ? w.title : (w.client || w.id);
      opts += '<option value="' + escAttr(w.id) + '"' + (sel === w.id ? " selected" : "") + ">" + escHtml(label) + "</option>";
    });
    return opts;
  }
  function journeyLayoutOptions(sel) {
    var L = [["auto", "Auto \u2014 flowing columns"], ["grid", "Grid \u2014 even 4:3 tiles"], ["showcase", "Showcase \u2014 hero + thumbnails"], ["stack", "Stack \u2014 one per row"]];
    return L.map(function (o) { return '<option value="' + o[0] + '"' + ((sel || "auto") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
  }
  function journeyImageRow(c, e, k, im) {
    var src = (im && im.src) || "";
    return '<div class="rep__item jimg">' +
      '<div class="rep__bar"><span class="sortgrip" data-grip data-sortkey="jimg:' + c + ':' + e + '" title="Drag to reorder">' + GRIP_SVG + '</span>' +
      '<span class="rep__n">Image ' + (k + 1) + '</span><span class="rep__ops">' +
      '<button class="iconbtn iconbtn--danger" data-act="jimg-del" data-jc="' + c + '" data-je="' + e + '" data-jk="' + k + '" title="Remove">\u2715</button></span></div>' +
      '<div class="jimg__preview' + (src ? " has" : "") + '">' + (src ? '<img src="' + escAttr(previewSrc(src)) + '" alt="" />' : "<span>No image</span>") + "</div>" +
      '<input type="text" data-jimg="src" data-jc="' + c + '" data-je="' + e + '" data-jk="' + k + '" value="' + escAttr(src) + '" placeholder="Paste an image URL\u2026" />' +
      '<div class="imgblk__row"><button class="btn btn--ghost" data-act="jimg-upload" data-jc="' + c + '" data-je="' + e + '" data-jk="' + k + '">Replace\u2026</button>' + mediaSizeTag(src) + "</div>" +
      '<input type="text" data-jimg="caption" data-jc="' + c + '" data-je="' + e + '" data-jk="' + k + '" value="' + escAttr((im && im.caption) || "") + '" placeholder="Caption (optional)" /></div>';
  }
  function journeyEntryHtml(c, entry, e) {
    var imgRows = (entry.images || []).map(function (im, k) { return journeyImageRow(c, e, k, im); }).join("");
    return '<div class="card jentry">' +
      '<div class="card__bar"><span class="sortgrip" data-grip data-sortkey="jentry:' + c + '" title="Drag to reorder">' + GRIP_SVG + '</span>' +
      '<span class="card__idx">' + escHtml(entry.title || entry.period || "Entry " + (e + 1)) + '</span>' +
      '<div class="card__ops"><button class="iconbtn iconbtn--danger" data-act="jentry-del" data-jc="' + c + '" data-je="' + e + '" title="Remove entry">\u2715</button></div></div>' +
      '<div class="af__row">' +
      '<div class="af"><label class="af__label">Period</label><input type="text" data-jfield="period" data-jc="' + c + '" data-je="' + e + '" value="' + escAttr(entry.period || "") + '" placeholder="e.g. 2022 \u2014 2023" /></div>' +
      '<div class="af"><label class="af__label">Title</label><input type="text" data-jfield="title" data-jc="' + c + '" data-je="' + e + '" value="' + escAttr(entry.title || "") + '" placeholder="What you worked on" /></div>' +
      "</div>" +
      richJourney(c, e, entry.body) +
      '<div class="af__row">' +
      '<div class="af"><label class="af__label">Image layout</label><select data-jsel="layout" data-jc="' + c + '" data-je="' + e + '">' + journeyLayoutOptions(entry.layout) + "</select></div>" +
      '<div class="af"><label class="af__label">Link to a case study</label><select data-jsel="workId" data-jc="' + c + '" data-je="' + e + '">' + journeyWorkOptions(entry.workId) + "</select></div>" +
      "</div>" +
      '<div class="rep"><div class="rep__head"><span>Images</span><button class="btn btn--add rep__add" data-act="jimg-add" data-jc="' + c + '" data-je="' + e + '">+ Add images\u2026</button></div>' +
      (imgRows || '<div class="rep__empty">No images yet.</div>') + "</div></div>";
  }
  function journeyChapterHtml(chap, c) {
    var open = openJC === c;
    var entries = (chap.entries || []);
    var entriesHtml = entries.map(function (en, e) { return journeyEntryHtml(c, en, e); }).join("");
    return '<div class="card jchap' + (open ? " is-open" : "") + '">' +
      '<div class="jchap__head" data-act="journey-chaptoggle" data-jc="' + c + '">' +
      '<span class="sortgrip" data-grip data-sortkey="jchap" title="Drag to reorder">' + GRIP_SVG + '</span>' +
      '<input type="text" class="jchap__name" data-jname data-jc="' + c + '" value="' + escAttr(chap.name || "") + '" placeholder="Chapter name (e.g. Microsoft)" />' +
      '<span class="jchap__count" title="entries">' + entries.length + '</span>' +
      '<span class="card__ops"><button class="iconbtn iconbtn--danger" data-act="jchap-del" data-jc="' + c + '" title="Remove chapter">\u2715</button></span>' +
      '<span class="study__block-chev">\u203a</span></div>' +
      '<div class="jchap__body">' +
      '<div class="af"><label class="af__label">Company logo (optional)</label>' +
      '<div class="jimg__preview jlogo__preview' + (chap.logo ? " has" : "") + '">' + (chap.logo ? '<img src="' + escAttr(previewSrc(chap.logo)) + '" alt="" />' : "<span>No logo</span>") + "</div>" +
      '<div class="imgblk__row"><button class="btn btn--ghost" data-act="jlogo-upload" data-jc="' + c + '">' + (chap.logo ? "Replace\u2026" : "Upload\u2026") + "</button>" +
      (chap.logo ? '<button class="btn btn--ghost" data-act="jlogo-clear" data-jc="' + c + '">Clear</button>' : "") + mediaSizeTag(chap.logo) + "</div></div>" +
      (entriesHtml || '<div class="rep__empty">No entries yet.</div>') +
      '<button class="btn btn--add" data-act="jentry-add" data-jc="' + c + '">+ Add entry</button></div></div>';
  }
  function journeyEditor() {
    var j = journeyData();
    var chaps = (j.chapters || []).map(function (chap, c) { return journeyChapterHtml(chap, c); }).join("");
    return '<div class="l2grp"><div class="l2grp__head">Journey header <span>The intro shown at the top of the immersive view.</span></div>' +
      '<div class="af"><label class="af__label">Eyebrow</label><input type="text" data-jmeta="eyebrow" value="' + escAttr(j.eyebrow || "") + '" placeholder="Design Journey" /></div>' +
      '<div class="af"><label class="af__label">Title</label><input type="text" data-jmeta="title" value="' + escAttr(j.title || "") + '" placeholder="Eleven years, from \u2026 to \u2026" /></div>' +
      '<div class="af"><label class="af__label">Intro</label><textarea data-jmeta="intro" rows="2" placeholder="One or two lines that set the scene.">' + escHtml(j.intro || "") + "</textarea></div></div>" +
      '<div class="l2grp"><div class="l2grp__head">Chapters <span>Group entries by company or era. Each chapter is a stop on the left timeline.</span></div>' +
      (chaps || '<div class="adm__empty">No chapters yet \u2014 add your first below.</div>') +
      '<button class="btn btn--add" data-act="jchap-add" style="margin-top:.6rem">+ Add chapter</button></div>' +
      '<div class="l2grp__foot"><button class="btn btn--primary" data-act="journey-close">Done</button></div>';
  }
  function onJourneyEdit(t) {
    var j = journeyData();
    if (t.dataset.jmeta !== undefined) { j[t.dataset.jmeta] = t.value; saveDraft(); refreshJourneyPreview(); return; }
    var chap = j.chapters[+t.dataset.jc];
    if (!chap) return;
    if (t.dataset.jname !== undefined) { chap.name = t.value; saveDraft(); refreshJourneyPreview(); return; }
    var ent = chap.entries && chap.entries[+t.dataset.je];
    if (!ent) return;
    if (t.dataset.jfield !== undefined) { ent[t.dataset.jfield] = t.value; saveDraft(); refreshJourneyPreview(); return; }
    if (t.dataset.jsel !== undefined) { ent[t.dataset.jsel] = t.value; saveDraft(); refreshJourneyPreview(); return; }
    if (t.dataset.jimg !== undefined) { var im = ent.images && ent.images[+t.dataset.jk]; if (im) { im[t.dataset.jimg] = t.value; saveDraft(); refreshJourneyPreview(); } }
  }

  function renderBody() {
    body.innerHTML = sections[activeTab]();
    root.querySelectorAll(".adm__tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === activeTab));
    resolveMediaSizes(body);
    syncPreviewPage();
  }

  /* ---------- L2 case-study editor + auto live preview ---------- */
  function frameWin() { return frame && frame.contentWindow; }
  // Tell the live-preview which section is selected so it can show/refresh its floating
  // action toolbar (add-above / move / duplicate / delete) on that section.
  function syncPreviewSelection() {
    try { var w = frameWin(); if (w) w.postMessage({ __rk: "selectInPreview", index: (openStudy >= 0 ? openBlock : -1) }, "*"); } catch (e) {}
  }
  function previewProject(id, keep) {
    const w = frameWin();
    if (!(w && w.RK)) return;
    const pd = resolvePreviewData(data);
    try { w.RK.data = pd; } catch (e) {}
    if (!keep) { try { w.RK.render(pd); forceRevealDoc(w.document); } catch (e) {} }
    if (w.RK.openProject) { try { w.RK.openProject(id, { push: false, keepScroll: !!keep, silent: !!keep }); } catch (e) {} }
    syncPreviewSelection();
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
    resolveMediaSizes(l2body);
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
    resolveMediaSizes(l2body);
    parxScheduleDemo();
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
  // ---------- Settings side-pane (right drawer): declutters the "\u22EF" menu; each setting is a panel
  // instead of a stacked dialog. Simple ones inline (One-tap Allow / Recruiter / Backup); Passkeys /
  // Publishing / AI launch their existing proven dialogs from here.
  var SET_CATS = [["allow", "\u26A1 One-tap Allow"], ["recruiter", "\uD83C\uDFAB Recruiter mode"], ["autopub", "\u21BB Auto-publish"], ["security", "\uD83D\uDD10 Security"], ["publish", "\u2699 Publishing"], ["ai", "\u2728 AI"], ["history", "\uD83D\uDD52 Version history"], ["backup", "\uD83D\uDCBE Backup"]];
  var setPane, setNav, setPanel, activeSetCat = "allow", setSub = null;
  function openSettings() {
    if (!setPane) return;
    setPane.hidden = false;
    setSub = null;
    requestAnimationFrame(function () { setPane.classList.add("is-open"); });
    renderSettings();
    var esc = function (ev) { if (ev.key === "Escape" && !document.querySelector(".pass")) { closeSettings(); } };
    document.addEventListener("keydown", esc, true);
    setPane._esc = esc;
  }
  function closeSettings() {
    if (!setPane) return;
    if (setPane._esc) { document.removeEventListener("keydown", setPane._esc, true); setPane._esc = null; }
    setPane.classList.remove("is-open");
    setTimeout(function () { if (setPane && !setPane.classList.contains("is-open")) setPane.hidden = true; }, 260);
  }
  function renderSettings() {
    if (!setNav) return;
    setNav.innerHTML = SET_CATS.map(function (c) { return '<button class="adm__set-tab' + (activeSetCat === c[0] ? " is-on" : "") + '" data-act="settings-cat" data-cat="' + c[0] + '" type="button">' + escHtml(c[1]) + "</button>"; }).join("");
    renderSetPanel();
  }
  function renderSetPanel() {
    if (!setPanel) return;
    if (setSub) { renderSetSub(); return; }
    if (activeSetCat === "allow") { computeAllowMeta().then(function () { if (setPanel && !setSub) setPanel.innerHTML = quickGrantPanel(); }); return; }
    if (activeSetCat === "autopub") { setPanel.innerHTML = autopubPanelHtml(); wireAutopub(setPanel); return; }
    if (activeSetCat === "history") { setPanel.innerHTML = versionsPanelHtml(); loadVersions(); return; }
    setPanel.innerHTML = settingsPanelHtml(activeSetCat);
    if (activeSetCat === "recruiter") recruiterStateSync();
  }
  // Drill into a deeper view (Select what they see / Passkeys / Publishing / AI) inside the right
  // panel, keeping the rail visible, with a back arrow to the category's main view.
  function renderSetSub() {
    if (!setPanel) return;
    setPanel.innerHTML = '<button class="adm__set-back" data-act="set-back" type="button"><span aria-hidden="true">\u2190</span> Back</button>' +
      '<div class="adm__set-sub" data-set-sub></div>';
    var host = setPanel.querySelector("[data-set-sub]");
    var back = function () { setSub = null; renderSetPanel(); };
    if (setSub === "allow-edit") allowEditModal(null, { mount: host, onClose: back });
    else if (setSub === "passkeys") passkeyModal({ mount: host, onClose: back });
    else if (setSub === "publish") publishModal(null, { mount: host, onClose: back });
    else if (setSub === "ai") aiSettingsModal({ mount: host, onClose: back });
    else if (setSub === "adminkey") changeKeyModal({ mount: host, onClose: back });
    else { setSub = null; renderSetPanel(); }
  }
  function launchPanelHtml(title, sub, act, label) {
    return '<div class="rkqg"><div class="rkqg__head">' + escHtml(title) + "</div>" +
      '<div class="af__hint" style="margin:.2rem 0 .9rem">' + escHtml(sub) + "</div>" +
      '<div class="rkqg__row"><button class="btn btn--primary" data-act="' + act + '">' + escHtml(label) + "</button></div></div>";
  }
  function settingsPanelHtml(cat) {
    if (cat === "recruiter") {
      var on = !!data.recruiterMode;
      return '<div class="rkqg"><div class="rkqg__head">Recruiter mode <span class="rkqg__sub">show the ticket prompt to every visitor</span></div>' +
        '<div class="rkqg__row rkqg__row--toggle"><label class="rkacc__switch"><input type="checkbox" data-act="recruiter-toggle"' + (on ? " checked" : "") + " /> Show the ticket prompt on landing</label> <span data-recstate style=\"opacity:.55;font-family:var(--mono);font-size:.7rem\"></span></div>" +
        '<div class="af__hint">When on, every visitor to your live site sees the \u201center a ticket\u201d prompt. <b>Publish</b> to apply.</div></div>';
    }
    if (cat === "backup") {
      return '<div class="rkqg"><div class="rkqg__head">Content backup <span class="rkqg__sub">a local copy of your content</span></div>' +
        '<div class="rkqg__row"><button class="btn btn--primary" data-act="backup-dl">\uD83D\uDCBE Download content backup</button></div>' +
        '<div class="af__hint">Saves an unencrypted <code>content.json</code> to this device \u2014 keep it private. Handy before big edits.</div></div>';
    }
    if (cat === "security") {
      return '<div class="rkqg"><div class="rkqg__head">Security <span class="rkqg__sub">how you sign in to the studio</span></div>' +
        '<div class="af__hint" style="margin:.2rem 0 1rem">Sign in with a passkey \u2014 Windows Hello, Face ID or a security key \u2014 or change the admin key you type on this device. Both keep working.</div>' +
        '<div class="rkqg__row"><button class="btn btn--primary" data-act="open-passkeys">\uD83D\uDD11 Manage passkeys</button></div>' +
        '<div class="rkqg__row" style="margin-top:.6rem"><button class="btn btn--ghost" data-act="open-adminkey">\uD83D\uDD12 Change admin key</button></div></div>';
    }
    if (cat === "publish") return launchPanelHtml("Publishing", "Connect GitHub, replace the token, or publish manually.", "open-publish", "Open publishing settings");
    if (cat === "ai") return launchPanelHtml("AI", "Connect OpenAI, Gemini or Claude for the Prepare tools.", "open-ai", "Open AI settings");
    return "";
  }
  function autopubPanelHtml() {
    return '<div class="rkqg"><div class="rkqg__head">Auto-publish <span class="rkqg__sub">publish your draft on a timer</span></div>' +
      '<div class="adm__auto" data-autopub>' +
        '<button class="adm__auto-sw" type="button" data-autopub-toggle role="switch" aria-checked="false" title="Auto-publish on a timer"><span class="adm__auto-lbl">Auto-publish</span><span class="adm__auto-track"><span class="adm__auto-knob"></span></span></button>' +
        '<label class="adm__auto-opt"><input type="radio" name="autopub-every" value="30" data-autopub-every /><span>Every 30 minutes</span></label>' +
        '<label class="adm__auto-opt"><input type="radio" name="autopub-every" value="60" data-autopub-every /><span>Every hour</span></label>' +
      "</div>" +
      '<div class="af__hint">When on, your draft publishes automatically on the interval you pick. You can still Publish manually anytime.</div></div>';
  }
  function wireAutopub(c) {
    var tog = c.querySelector("[data-autopub-toggle]"); if (tog) tog.addEventListener("click", autopubToggle);
    c.querySelectorAll("[data-autopub-every]").forEach(function (r) { r.addEventListener("change", function () { autopubSetEvery(+r.value); }); });
    autopubSync();
  }
  // ---------- version history: browse & restore past published content.json ----------
  // Every Publish is a GitHub commit to content.json, so its commit log IS the version
  // history. We list those commits (GET, allowed by the proxy) and can load any past
  // version straight into the editor — the owner reviews it in the live preview and
  // Publishes to roll back (or Reverts to discard). No new write route needed.
  var versionList = null, versionsLoading = false;
  function versionsPanelHtml() {
    return '<div class="rkqg"><div class="rkqg__head">Version history <span class="rkqg__sub">every published version of your content</span></div>' +
      '<div class="af__hint" style="margin:.2rem 0 .9rem">Every time you Publish, a snapshot is kept. Load an older one into the editor, review it in the preview, then <b>Publish</b> to roll back \u2014 or <b>Revert</b> to discard.</div>' +
      '<div class="rkver" data-versions>Loading history\u2026</div>' +
      '<div class="rkqg__row" style="margin-top:.7rem"><button class="btn btn--ghost" data-act="ver-refresh" type="button">\u21BB Refresh</button></div></div>';
  }
  function verHost() { return setPanel && setPanel.querySelector("[data-versions]"); }
  async function loadVersions() {
    versionsLoading = true; var host = verHost(); if (host) host.textContent = "Loading history\u2026";
    try {
      var url = ghApiRoot() + "/repos/" + GH_OWNER + "/" + GH_REPO + "/commits?path=content.json&per_page=30";
      var r = await fetch(url, { headers: ghHeaders() });
      if (!r.ok) throw new Error("http " + r.status);
      versionList = await r.json();
    } catch (e) { versionList = e; }
    versionsLoading = false;
    paintVersions();
  }
  function verAgo(iso) {
    var t = new Date(iso).getTime(); if (!t) return "";
    var s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60); if (m < 60) return m + "m ago";
    var h = Math.round(m / 60); if (h < 24) return h + "h ago";
    var d = Math.round(h / 24); if (d < 30) return d + "d ago";
    var mo = Math.round(d / 30); if (mo < 12) return mo + "mo ago";
    return Math.round(mo / 12) + "y ago";
  }
  function paintVersions() {
    var host = verHost(); if (!host) return;
    if (versionsLoading) { host.textContent = "Loading history\u2026"; return; }
    if (!Array.isArray(versionList)) { host.innerHTML = '<div class="rkver__empty">Couldn\u2019t load history \u2014 check your connection and Refresh.</div>'; return; }
    if (!versionList.length) { host.innerHTML = '<div class="rkver__empty">No history yet \u2014 Publish once to start a trail.</div>'; return; }
    host.innerHTML = versionList.map(function (c, i) {
      var msg = (((c.commit && c.commit.message) || "").split("\n")[0]) || "(no message)";
      var when = (c.commit && c.commit.author && c.commit.author.date) || "";
      var who = (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || "";
      var sha = c.sha || "";
      var cur = i === 0;
      var sub = escHtml(verAgo(when)) + (who ? " \u00B7 " + escHtml(who) : "") + " \u00B7 " + escHtml(sha.slice(0, 7));
      return '<div class="rkver__row' + (cur ? " is-current" : "") + '">' +
        '<div class="rkver__meta"><span class="rkver__msg">' + escHtml(msg) + '</span><span class="rkver__sub">' + sub + (cur ? " \u00B7 live now" : "") + "</span></div>" +
        (cur ? '<span class="rkver__cur">Current</span>'
             : '<button class="rkver__btn" data-act="ver-load" data-sha="' + escAttr(sha) + '" data-when="' + escAttr(verAgo(when)) + '" type="button">Load</button>') +
        "</div>";
    }).join("");
  }
  async function applyVersion(sha, whenLabel) {
    if (!sha) return;
    status("Loading that version\u2026");
    try {
      var url = ghApiRoot() + "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/content.json?ref=" + encodeURIComponent(sha);
      var r = await fetch(url, { headers: ghHeaders() });
      if (!r.ok) throw new Error("http " + r.status);
      var j = await r.json();
      var parsed = JSON.parse(new TextDecoder().decode(b64ToBytes(String(j.content || "").replace(/\s/g, ""))));
      data = parsed;
      renderBody();
      apply(true);
      histReset();
      closeSettings();
      status("Loaded the version from " + (whenLabel || "history") + " \u2014 review it in the preview, then Publish to roll back (or Revert to discard).", true);
    } catch (e) {
      status("\u26A0 Couldn\u2019t load that version \u2014 " + ((e && e.message) || "try again") + ".");
    }
  }
  // Mount a settings dialog INSIDE the settings panel (in-panel drill-down) instead of a centered
  // dialog: strips the modal chrome so its content renders in the right panel. Returns true if mounted.
  function settingsMount(modal, opts) {
    if (!opts || !opts.mount || !modal) return false;
    modal.classList.add("pass--inpanel");
    opts.mount.innerHTML = "";
    opts.mount.appendChild(modal);
    return true;
  }
  function l2PreviewApply() {
    var off = localStorage.getItem(L2PREV_KEY) === "0";
    if (root) root.classList.toggle("is-noprev", off && (openStudy >= 0 || journeyOpen));
    var btn = root && root.querySelector("[data-l2-prev]");
    if (btn) {
      btn.classList.toggle("is-off", off);
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>' + (off ? '<line x1="3" y1="3" x2="21" y2="21"/>' : "") + "</svg>" + (off ? " Show preview" : " Hide preview");
    }
  }
  // Clicking a non-interactive part of a section in the live preview (it postMessages the
  // block index) jumps the editor straight to that block — expand it, scroll to it, flash it.
  function selectPreviewBlock(idx) {
    if (openStudy < 0 || !data.work[openStudy] || !data.work[openStudy].study) return;
    var blocks = data.work[openStudy].study.blocks || [];
    if (!(idx >= 0 && idx < blocks.length)) return;
    openBlock = idx;
    var wrap = l2body && l2body.querySelector(".study__blocks");
    if (!wrap) return;
    var items = wrap.querySelectorAll(".study__block");
    items.forEach(function (x, k) { x.classList.toggle("is-open", k === idx); });
    var target = items[idx];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("is-flash");
      setTimeout(function () { target.classList.remove("is-flash"); }, 1100);
    }
    syncPreviewSelection();
  }
  // Preview → editor: the floating preview toolbar posts a section action. Apply the same
  // mutation the editor row ops do, then re-render (renderL2 re-syncs the preview toolbar).
  function previewBlockAct(act, j) {
    if (openStudy < 0 || !data.work[openStudy] || !data.work[openStudy].study) return;
    var i = openStudy, s = data.work[i].study.blocks;
    if (!Array.isArray(s) || !(j >= 0 && j < s.length)) return;
    if (act === "add") { openBlock = j; sectionPicker(i, j); return; }
    if (act === "up") { if (j <= 0) return; var a = s[j - 1]; s[j - 1] = s[j]; s[j] = a; openBlock = j - 1; }
    else if (act === "down") { if (j >= s.length - 1) return; var c = s[j + 1]; s[j + 1] = s[j]; s[j] = c; openBlock = j + 1; }
    else if (act === "dup") { s.splice(j + 1, 0, JSON.parse(JSON.stringify(s[j]))); openBlock = j + 1; status("Section duplicated \u2014 editing the copy.", true); }
    else if (act === "lock") { s[j].locked = !s[j].locked; openBlock = j; status(s[j].locked ? "Section locked \u2014 hidden behind the deeper-cut pass." : "Section unlocked.", true); }
    else if (act === "del") { s.splice(j, 1); openBlock = -1; }
    else return;
    saveDraft(true); renderL2();
  }

  /* ---------- blank templates ---------- */
  function blankSv() {
    return { id: "sv" + Date.now().toString(36), name: "New view", audience: "", ticketHash: "", createdAt: Date.now(), days: 3, workIds: [], highlightIdx: [], capabilityIdx: [] };
  }
  function blank(list) {
    switch (list) {
      case "highlights": return { value: "0+", label: "New metric" };
      case "capabilities": return "New capability";
      case "work": return { id: "w" + Date.now(), featured: false, theme: "grid", plateTag: "Tag", client: "Client", period: "Year", title: "", desc: "What you did and the impact.", tags: ["Tag"], image: "" };
      case "path": return { years: "Year", present: false, role: "Role", org: "Organisation", desc: "What you did." };
      case "recognition":
      case "education": return { title: "New entry", meta: "" };
      default: return {};
    }
  }

  /* ---------- events ---------- */
  function onInput(e) {
    const t = e.target;
    if (t.dataset.gpath !== undefined || t.dataset.genName !== undefined) { onGenEdit(t); return; }
    if (t.dataset.rtfield !== undefined || t.dataset.rtifield !== undefined || t.dataset.rtcellfield !== undefined || t.dataset.rtjrn !== undefined) { rtSerialize(t); return; }
    if (t.dataset.jmeta !== undefined || t.dataset.jname !== undefined || t.dataset.jfield !== undefined || t.dataset.jimg !== undefined) { onJourneyEdit(t); return; }
    if (t.dataset.msz !== undefined) { onMediaSizeInput(t); return; }
    if (t.dataset.parx !== undefined) { onParxInput(t); return; }
    if (t.dataset.parxnum !== undefined) { onParxNum(t); return; }
    if (t.dataset.depthField !== undefined) { onDepthSlider(t); return; }
    if (t.dataset.sitem !== undefined && t.dataset.ifield) { onItemInput(t); return; }
    if (t.dataset.cell !== undefined && t.dataset.cfield) { onCellInput(t); return; }
    if (t.dataset.fann !== undefined && t.dataset.afield) { onFocusAnn(t); return; }
    if (t.dataset.csgen !== undefined) { const s = csgenState(t.dataset.csid); s[t.dataset.csgen] = t.value; return; }
    if (t.dataset.beat !== undefined && t.dataset.bkey) { onBeatEdit(t); return; }
    if (t.dataset.ovm !== undefined && t.dataset.ovmfield) { onOvmEdit(t); return; }
    if (t.dataset.galedit !== undefined && t.dataset.galfield) { onGalEdit(t); return; }
    if (t.dataset.logoedit !== undefined && t.dataset.logofield) { onLogoEdit(t); return; }
    if (t.dataset.study !== undefined && t.dataset.sfield) { onStudyMeta(t); return; }
    if (t.dataset.sblock !== undefined && t.dataset.bfield && t.dataset.bfield !== "locked") { onStudyBlock(t); return; }
    if (t.dataset.path) { setPath(data, t.dataset.path, t.value); apply(); return; }
    if (t.dataset.sv !== undefined && t.dataset.field) { onSvInput(t); return; }
    if (t.dataset.list && t.dataset.scalar) { data[t.dataset.list][+t.dataset.index] = t.value; apply(); return; }
    if (t.dataset.list && t.dataset.field) {
      let v = t.value;
      if (t.dataset.field === "tags") v = t.value.split(",").map((x) => x.trim()).filter(Boolean);
      else if (t.dataset.list === "work" && t.dataset.field === "period" && v.indexOf("-") !== -1) {
        // Period is the date range that also feeds the case-study Timeline — same em-dash swap.
        const caret = t.selectionStart;
        v = v.replace(/-/g, "\u2014"); t.value = v;
        try { t.setSelectionRange(caret, caret); } catch (e) {}
      }
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
    if (t.dataset.worklayout !== undefined) { data.workLayout = t.value; saveDraft(true); apply(true); return; }
    if (t.dataset.statementsize !== undefined) { data.landing = data.landing || {}; data.landing.statementSize = t.value; saveDraft(true); apply(true); return; }
    if (t.dataset.logosize !== undefined) { const arr = (data.landing || {}).logos, k = +t.dataset.logosize; if (arr && arr[k]) { arr[k].size = t.value; apply(true); } return; }
    if (t.dataset.parxnum !== undefined) { const _pw = data.work[+t.dataset.parxnum]; if (_pw) t.value = (_pw.parAmt != null ? _pw.parAmt : 0); return; }
    if (t.dataset.depthOn !== undefined) { onDepthToggle(t); return; }
    if (t.dataset.act === "aboutsec-toggle") {
      const arr = aboutLayoutArr(), key = t.dataset.key;
      for (let k = 0; k < arr.length; k++) if (arr[k].key === key) arr[k].on = t.checked;
      setAboutLayout(arr);
      return;
    }
    if (t.dataset.act === "worksec-toggle") {
      const arr = workLayoutArr(), key = t.dataset.key;
      for (let k = 0; k < arr.length; k++) if (arr[k].key === key) arr[k].on = t.checked;
      setWorkLayout(arr);
      return;
    }
    if (t.dataset.act === "landing-show") {
      data.landing = data.landing || {};
      data.landing.show = data.landing.show || {};
      data.landing.show[t.dataset.showkey] = t.checked;
      saveDraft(true);
      apply(true);
      if (activeTab === "landing") renderBody();
      return;
    }
    if (t.dataset.iconpick !== undefined) {
      const arr = data[t.dataset.iconpick] || [], it = arr[+t.dataset.index];
      if (it) { if (t.value) it.icon = t.value; else delete it.icon; apply(true); if (activeTab === t.dataset.iconpick) renderBody(); }
      return;
    }
    if (t.dataset.act === "badge-toggle") {
      data.contact = data.contact || {};
      data.contact.badges = data.contact.badges || {};
      data.contact.badges[t.dataset.badge] = t.checked;
      apply(true);
      return;
    }
    if (t.dataset.act === "siteicon-mono") {
      if (data.landing && data.landing.siteIcon) { data.landing.siteIcon.mono = t.checked; saveDraft(true); apply(true); if (activeTab === "landing") renderBody(); }
      return;
    }
    if (t.dataset.gpath !== undefined) { onGenEdit(t); return; }
    if (t.dataset.jsel !== undefined) { onJourneyEdit(t); return; }
    if (t.dataset.act === "journey-toggle") { journeyData().enabled = t.checked; saveDraft(true); apply(true); renderBody(); return; }
    if (t.dataset.atsFile !== undefined) { if (t.files && t.files[0]) atsRun(t.closest(".ats"), t.files[0]); t.value = ""; return; }
    if (t.dataset.msz !== undefined) { onMediaSizeInput(t); return; }
    if (t.dataset.csgen !== undefined) { const s = csgenState(t.dataset.csid); s[t.dataset.csgen] = t.value; return; }
    if (t.dataset.sitem !== undefined && t.dataset.ifield) { onItemInput(t); return; }
    if (t.dataset.fann !== undefined && t.dataset.afield) { onFocusAnn(t); return; }
    if (t.dataset.sblock !== undefined && t.type === "checkbox") {
      const wi = +t.dataset.sblock, bj = +t.dataset.bindex;
      if (data.work[wi] && data.work[wi].study && data.work[wi].study.blocks[bj]) {
        data.work[wi].study.blocks[bj][t.dataset.bfield] = t.checked;
        saveDraft(true); refreshL2Preview();
      }
      return;
    }
    if (t.id === "aiSame") { aiPersistVisible(); localStorage.setItem("rk:ai:same", t.checked ? "1" : "0"); renderBody(); return; }
    if (t.id === "aiProxyOn") { aiPersistProxy(); renderBody(); return; }
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
    } else if (t.dataset.act === "work-hidden") {
      data.work[+t.dataset.index].hidden = t.checked;
      saveDraft(true);
      apply(true);
      renderBody();
    } else if (t.dataset.act === "present") {
      data.path[+t.dataset.index].present = t.checked;
      apply(true);
    } else if (t.dataset.act === "avail-toggle") {
      data.landing = data.landing || {};
      data.landing.available = data.landing.available || {};
      data.landing.available.on = t.checked;
      saveDraft(true);
      apply(true);
      renderBody();
    } else if (t.dataset.act === "cue-toggle") {
      data.landing = data.landing || {};
      data.landing.show = data.landing.show || {};
      data.landing.show.cue = t.checked;
      saveDraft(true);
      apply(true);
      renderBody();
    } else if (t.tagName === "SELECT" && t.dataset.list) {
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
      try { (sv.workIds || []).forEach(function (id) { if (w.RK.setStudyUnlocked) w.RK.setStudyUnlocked(id); }); } catch (e) {}
      try { w.RK.render(resolvePreviewData(w.RK.deriveSpecialData(data, sv))); forceRevealDoc(w.document); } catch (e) {}
      status("Previewing \u201c" + (sv.name || "view") + "\u201d \u2014 edit anything to return to the full site.");
    }
  }

  var blockRenameTimer = 0;
  function onDblClick(e) {
    var lab = e.target.closest(".study__block-label");
    if (!lab) return;
    var head = lab.closest(".study__block-head");
    if (!head || head.dataset.act !== "study-blocktoggle") return;
    e.preventDefault();
    clearTimeout(blockRenameTimer);
    startBlockRename(lab, +head.dataset.index, +head.dataset.bindex);
  }
  function startBlockRename(lab, i, j) {
    var b = data.work[i] && data.work[i].study && data.work[i].study.blocks[j];
    if (!b || lab.querySelector("input")) return;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "study__block-rename";
    input.maxLength = 60;
    input.value = b.editorName ? String(b.editorName) : lab.textContent;
    input.placeholder = "Section name";
    input.setAttribute("aria-label", "Section name (overrides the auto-name)");
    lab.textContent = "";
    lab.classList.add("is-editing");
    lab.appendChild(input);
    input.focus(); input.select();
    var done = false;
    function commit(save) {
      if (done) return; done = true;
      if (save) {
        var v = input.value.replace(/\s+/g, " ").trim();
        if (v) b.editorName = v; else delete b.editorName;
        saveDraft(true);
      }
      renderL2();
    }
    input.addEventListener("keydown", function (ev) {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); commit(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", function () { commit(true); });
    ["click", "dblclick", "pointerdown", "mousedown"].forEach(function (evt) {
      input.addEventListener(evt, function (ev) { ev.stopPropagation(); });
    });
  }
  function onClick(e) {
    if (e.target && e.target.classList && e.target.classList.contains("adm__settings")) { closeSettings(); return; }
    if (root && !e.target.closest(".hsize")) { var _oh = root.querySelectorAll(".hsize.is-open"); if (_oh.length) _oh.forEach(function (x) { x.classList.remove("is-open"); }); }
    const rtb = e.target.closest("[data-rt]");
    if (rtb) { rtAction(rtb); return; }
    if (e.target.closest("[data-grip]")) return; // grip is a drag handle, not a click target
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "md-fmt") { mdFmt(b); return; }
    const act = b.dataset.act, list = b.dataset.list, i = +b.dataset.index;
    if (act === "depth-open") { var _dp = root.querySelector('[data-depth-panel="' + i + '"]'); if (_dp) { _dp.hidden = !_dp.hidden; b.classList.toggle("is-on", !_dp.hidden); if (!_dp.hidden) depthPreviewLoad(_dp); } return; }
    if (act === "depth-gen") { depthGenerate(i, b); return; }
    if (act === "depth-suggest") { depthSuggest(i, b); return; }
    if (act === "aboutsec-up" || act === "aboutsec-down") {
      const arr = aboutLayoutArr(), idx = +b.dataset.i, j = act === "aboutsec-up" ? idx - 1 : idx + 1;
      if (idx < 0 || j < 0 || j >= arr.length) return;
      const tmp = arr[j]; arr[j] = arr[idx]; arr[idx] = tmp;
      setAboutLayout(arr);
      return;
    }
    if (act === "worksec-up" || act === "worksec-down") {
      const arr = workLayoutArr(), idx = +b.dataset.i, j = act === "worksec-up" ? idx - 1 : idx + 1;
      if (idx < 0 || j < 0 || j >= arr.length) return;
      const tmp = arr[j]; arr[j] = arr[idx]; arr[idx] = tmp;
      setWorkLayout(arr);
      return;
    }
    if (act === "icon-gen-all") { iconGenerateAll(list, b); return; }
    if (act === "icon-regen") { iconRegen(list, i); return; }
    if (act === "icon-remove") { iconRemove(list, i); return; }
    if (act === "gal-add") { const arr = aboutGalleryArr(); if (arr.length < 6) { arr.push({ src: "", caption: "" }); saveDraft(true); renderBody(); } return; }
    if (act === "gal-remove") { const arr = data.aboutGallery, k = +b.dataset.gindex; if (arr && arr[k] !== undefined) { arr.splice(k, 1); apply(true); renderBody(); } return; }
    if (act === "gal-up") { const arr = data.aboutGallery, k = +b.dataset.gindex; if (arr && k > 0) { const tmp = arr[k - 1]; arr[k - 1] = arr[k]; arr[k] = tmp; apply(true); renderBody(); } return; }
    if (act === "gal-down") { const arr = data.aboutGallery, k = +b.dataset.gindex; if (arr && k < arr.length - 1) { const tmp = arr[k + 1]; arr[k + 1] = arr[k]; arr[k] = tmp; apply(true); renderBody(); } return; }
    if (act === "gal-clear") { const arr = data.aboutGallery, k = +b.dataset.gindex; if (arr && arr[k]) { arr[k].src = ""; apply(true); renderBody(); } return; }
    if (act === "gal-upload") { const k = +b.dataset.gindex; pickImage(function (uri) { const arr = data.aboutGallery; if (arr && arr[k]) { arr[k].src = uri; apply(true); renderBody(); } }); return; }
    if (act === "logo-add") { const arr = logosArr(); if (arr.length < 24) { arr.push({ src: "", name: "" }); saveDraft(true); renderBody(); } return; }
    if (act === "logo-remove") { const arr = (data.landing || {}).logos, k = +b.dataset.lindex; if (arr && arr[k] !== undefined) { arr.splice(k, 1); apply(true); renderBody(); } return; }
    if (act === "logo-up") { const arr = (data.landing || {}).logos, k = +b.dataset.lindex; if (arr && k > 0) { const tmp = arr[k - 1]; arr[k - 1] = arr[k]; arr[k] = tmp; apply(true); renderBody(); } return; }
    if (act === "logo-down") { const arr = (data.landing || {}).logos, k = +b.dataset.lindex; if (arr && k < arr.length - 1) { const tmp = arr[k + 1]; arr[k + 1] = arr[k]; arr[k] = tmp; apply(true); renderBody(); } return; }
    if (act === "logo-clear") { const arr = (data.landing || {}).logos, k = +b.dataset.lindex; if (arr && arr[k]) { arr[k].src = ""; apply(true); renderBody(); } return; }
    if (act === "logo-upload") { const k = +b.dataset.lindex; pickImage(function (uri) { const arr = (data.landing || {}).logos; if (arr && arr[k]) { arr[k].src = uri; apply(true); renderBody(); } }); return; }
    if (act === "ins-days") { loadInsights(+b.dataset.days || 30); return; }
    if (act === "ins-refresh") { loadInsights(); return; }
    if (act === "ins-mute") { insToggleMute(); return; }
    if (act === "book-accept") { bookDo(b.dataset.uid, "accept", b); return; }
    if (act === "book-decline") { bookDo(b.dataset.uid, "decline", b); return; }
    if (act === "book-dismiss") { bookDo(b.dataset.uid, "dismiss", b); return; }
    if (act === "book-refresh") { loadBookings(); return; }
    if (act === "media-open") { mediaOpen(); return; }
    if (act === "ver-refresh") { loadVersions(); return; }
    if (act === "ver-load") { if (confirm("Load this version into the editor? Your current unsaved edits will be replaced \u2014 Publishing is still required to make it live.")) applyVersion(b.dataset.sha, b.dataset.when); return; }
    if (act === "settings-close") { closeSettings(); return; }
    if (act === "settings-cat") { activeSetCat = b.dataset.cat; setSub = null; renderSettings(); return; }
    if (act === "allow-toggle") { toggleAllowDefault(renderSetPanel); return; }
    if (act === "allow-edit") { setSub = "allow-edit"; renderSetPanel(); return; }
    if (act === "set-back") { setSub = null; renderSetPanel(); return; }
    if (act === "recruiter-toggle") { recruiterToggle(); renderSetPanel(); return; }
    if (act === "backup-dl") { downloadContentBackup(); return; }
    if (act === "open-passkeys") { setSub = "passkeys"; renderSetPanel(); return; }
    if (act === "open-publish") { setSub = "publish"; renderSetPanel(); return; }
    if (act === "open-ai") { setSub = "ai"; renderSetPanel(); return; }
    if (act === "open-adminkey") { setSub = "adminkey"; renderSetPanel(); return; }
    if (act === "sv-add") {
      data.specialViews = data.specialViews || [];
      if (data.specialViews.length >= 6) { status("Up to 6 special views."); return; }
      data.specialViews.push(blankSv());
      saveDraft(true); renderBody(); return;
    }
    if (act === "sv-remove") { (data.specialViews || []).splice(i, 1); saveDraft(true); renderBody(); return; }
    if (act === "sv-edit") { svEditModal(i); return; }
    if (act === "sv-share") { var _shm = b.parentNode.querySelector(".svshare__menu"); var _wh = _shm && _shm.hidden; if (root) root.querySelectorAll(".svshare__menu").forEach(function (m) { m.hidden = true; }); if (_shm) _shm.hidden = !_wh; return; }
    if (act === "sv-revoke") { var _rv = (data.specialViews || [])[i]; if (_rv) { _rv.revoked = true; saveDraft(true); renderBody(); status("View revoked \u2014 tick Show revoked to restore or delete it.", true); } return; }
    if (act === "sv-restore") { var _rs = (data.specialViews || [])[i]; if (_rs) { _rs.revoked = false; saveDraft(true); renderBody(); status("View restored.", true); } return; }
    if (act === "sv-delete") { if (!confirm("Delete this special view permanently?")) return; (data.specialViews || []).splice(i, 1); saveDraft(true); renderBody(); status("View deleted."); return; }
    if (act === "req-dismiss") {
      var _rid = b.dataset.id; b.disabled = true;
      fetch(ADMIN_WORKER + "/admin/requests/delete", { method: "POST", headers: { Authorization: "Bearer " + adminSession(), "Content-Type": "application/json" }, body: JSON.stringify({ id: _rid }) })
        .then(function () { reqCache = reqCache.filter(function (x) { return x.id !== _rid; }); renderBody(); status("Request dismissed.", true); })
        .catch(function () { b.disabled = false; status("Couldn\u2019t dismiss \u2014 try again.", false); });
      return;
    }
    if (act === "acc-tab") { accSubTab = b.dataset.tab; renderBody(); return; }
    if (act === "acc-declined") { accShowDeclined = !accShowDeclined; loadAccessData(); return; }
    if (act === "acc-revoked") { accShowRevoked = !accShowRevoked; renderBody(); return; }
    if (act === "acc-req-approve") {
      var _aid = b.dataset.id; b.disabled = true; status("Approving\u2026", true);
      fetch(ADMIN_WORKER + "/admin/requests/allow", { method: "POST", headers: { Authorization: "Bearer " + adminSession(), "Content-Type": "application/json" }, body: JSON.stringify({ id: _aid }) })
        .then(function (r) { if (!r.ok) throw 0; accReqCache = accReqCache.filter(function (x) { return x.id !== _aid; }); accSyncBadges(); renderBody(); status("Approved \u2014 access link emailed.", true); loadAccessData(); })
        .catch(function () { b.disabled = false; status("Couldn\u2019t approve \u2014 try again.", false); });
      return;
    }
    if (act === "acc-req-curate") { curateModal(b.dataset.id); return; }
    if (act === "acc-req-decline") {
      var _did = b.dataset.id; b.disabled = true;
      fetch(ADMIN_WORKER + "/admin/requests/decline", { method: "POST", headers: { Authorization: "Bearer " + adminSession(), "Content-Type": "application/json" }, body: JSON.stringify({ id: _did }) })
        .then(function (r) { if (!r.ok) throw 0; accReqCache = accReqCache.filter(function (x) { return x.id !== _did; }); accSyncBadges(); renderBody(); status("Declined \u2014 a polite note was sent.", true); })
        .catch(function () { b.disabled = false; status("Couldn\u2019t decline \u2014 try again.", false); });
      return;
    }
    if (act === "acc-req-delete") {
      var _xid = b.dataset.id; b.disabled = true;
      fetch(ADMIN_WORKER + "/admin/requests/delete", { method: "POST", headers: { Authorization: "Bearer " + adminSession(), "Content-Type": "application/json" }, body: JSON.stringify({ id: _xid }) })
        .then(function () { accReqCache = accReqCache.filter(function (x) { return x.id !== _xid; }); renderBody(); status("Deleted.", true); })
        .catch(function () { b.disabled = false; status("Couldn\u2019t delete \u2014 try again.", false); });
      return;
    }
    if (act === "acc-grant-copy") {
      var _gl = location.origin + "/?k=" + (b.dataset.token || "");
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(_gl).then(function () { status("Access link copied.", true); }, function () { status(_gl); });
      else status(_gl);
      return;
    }
    if (act === "acc-grant-days") {
      var _gt = b.dataset.token, _nd = prompt("Days this link stays live (1\u2013365):", b.dataset.days || "15");
      if (!_nd) return; var _ndn = parseInt(_nd, 10); if (!(_ndn > 0)) return;
      fetch(ADMIN_WORKER + "/admin/access", { method: "POST", headers: { Authorization: "Bearer " + adminSession(), "Content-Type": "application/json" }, body: JSON.stringify({ token: _gt, days: Math.min(_ndn, 365) }) })
        .then(function (r) { if (!r.ok) throw 0; status("Duration updated.", true); loadAccessData(); })
        .catch(function () { status("Couldn\u2019t update \u2014 try again.", false); });
      return;
    }
    if (act === "acc-grant-revoke") {
      var _rt = b.dataset.token, _on = b.dataset.on === "1";
      fetch(ADMIN_WORKER + "/admin/access", { method: "POST", headers: { Authorization: "Bearer " + adminSession(), "Content-Type": "application/json" }, body: JSON.stringify({ token: _rt, revoke: !_on }) })
        .then(function (r) { if (!r.ok) throw 0; status(_on ? "Access restored." : "Access revoked.", true); loadAccessData(); })
        .catch(function () { status("Couldn\u2019t update \u2014 try again.", false); });
      return;
    }
    if (act === "acc-grant-delete") {
      var _dt = b.dataset.token;
      if (!confirm("Delete this grant permanently? Their link stops working.")) return;
      fetch(ADMIN_WORKER + "/admin/access", { method: "POST", headers: { Authorization: "Bearer " + adminSession(), "Content-Type": "application/json" }, body: JSON.stringify({ token: _dt, delete: true }) })
        .then(function (r) { if (!r.ok) throw 0; status("Grant deleted.", true); loadAccessData(); })
        .catch(function () { status("Couldn\u2019t delete \u2014 try again.", false); });
      return;
    }
    if (act === "sv-tailor") { roleKitModal(); return; }
    if (/^gen-(add|del|up|down|upload|refine)$/.test(act)) { genAction(act, b); return; }
    if (act === "sv-preview") { svPreview(i); return; }
    if (act === "sv-copylink") {
      var _sv = (data.specialViews || [])[i]; if (!_sv) return;
      var _tin = document.querySelector('input[data-sv="' + i + '"][data-field="ticket"]');
      var _code = (_tin && _tin.value.trim()) || ticketPlain[_sv.id] || "";
      var _finish = function (c) {
        if (!c) { status("Set a ticket phrase for this view first.", false); return; }
        var link = location.origin + "/?ticket=" + encodeURIComponent(c);
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { status("Recruiter link copied \u2014 paste it to a recruiter.", true); }, function () { status(link); });
        else status(link);
      };
      if (_code) _finish(_code);
      else if (_sv.ticketHash) ensureTicketCode(_sv).then(_finish, function () {});
      else _finish("");
      return;
    }
    if (act === "qg-set") {
      var _panel = b.closest(".rkqg"); if (!_panel) return;
      var _sel = _panel.querySelector("[data-qg-view]"), _daysEl = _panel.querySelector("[data-qg-days]");
      var _svId = _sel && _sel.value;
      var _qsv = (data.specialViews || []).filter(function (v) { return v.id === _svId; })[0];
      if (!_qsv) { status("Pick a special view first.", false); return; }
      var _days = Math.max(0, parseInt((_daysEl && _daysEl.value) || "0", 10) || 0);
      var _finishQg = function (code) {
        if (!code) { status("Set a ticket phrase on that view first.", false); return; }
        var _sess = adminSession(); if (!_sess) { status("Sign in first.", false); return; }
        var _exp = _days > 0 ? Date.now() + _days * 86400000 : 0;
        fetch(ADMIN_WORKER + "/admin/quickgrant", { method: "POST", headers: { Authorization: "Bearer " + _sess, "Content-Type": "application/json" }, body: JSON.stringify({ code: code, expiresAt: _exp }) })
          .then(function (r) { if (!r.ok) throw 0; qgCache = { code: code, expiresAt: _exp, updatedAt: Date.now() }; renderBody(); status("One-tap Full access set \u2014 tapping Allow now emails this view.", true); })
          .catch(function () { status("Couldn\u2019t save the quick-grant \u2014 try again.", false); });
      };
      var _pc = rkNormPass(ticketPlain[_qsv.id]) ? ticketPlain[_qsv.id] : "";
      if (_pc) _finishQg(_pc);
      else ensureTicketCode(_qsv).then(_finishQg, function () {});
      return;
    }
    if (act === "qg-revoke") {
      var _sess2 = adminSession(); if (!_sess2) return;
      fetch(ADMIN_WORKER + "/admin/quickgrant", { method: "POST", headers: { Authorization: "Bearer " + _sess2, "Content-Type": "application/json" }, body: JSON.stringify({ revoke: true }) })
        .then(function () { qgCache = {}; renderBody(); status("One-tap Full access revoked.", true); })
        .catch(function () { status("Couldn\u2019t revoke \u2014 try again.", false); });
      return;
    }
    if (act === "qg-copylink") {
      var _l = location.origin + "/?ticket=" + encodeURIComponent((qgCache && qgCache.code) || "");
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(_l).then(function () { status("Full-access link copied.", true); }, function () { status(_l); });
      else status(_l);
      return;
    }
    if (act === "qg-copycode") {
      var _c2 = (qgCache && qgCache.code) || "";
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(_c2).then(function () { status("Full-access code copied.", true); }, function () { status(_c2); });
      else status(_c2);
      return;
    }
    if (act === "sv-copycode") {
      var _sv3 = (data.specialViews || [])[i]; if (!_sv3) return;
      var _tin3 = document.querySelector('input[data-sv="' + i + '"][data-field="ticket"]');
      var _code3 = (_tin3 && _tin3.value.trim()) || ticketPlain[_sv3.id] || "";
      var _fin3 = function (c) {
        if (!c) { status("Set a ticket phrase for this view first.", false); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(c).then(function () { status("Ticket code copied.", true); }, function () { status(c); });
        else status(c);
      };
      if (_code3) _fin3(_code3);
      else if (_sv3.ticketHash) ensureTicketCode(_sv3).then(_fin3, function () {});
      else _fin3("");
      return;
    }
    if (act === "plate-sample") { data.work[i].theme = b.dataset.theme; data.work[i].image = ""; apply(true); if (openStudy >= 0) renderL2(); else renderBody(); status("Motion placeholder applied.", true); return; }
    if (act === "img-clear") { data.work[i].image = ""; apply(true); if (openStudy >= 0) renderL2(); else renderBody(); status("Image removed."); return; }
    if (act === "img-upload") { pickImage(function (uri) { data.work[i].image = uri; apply(true); if (openStudy >= 0) renderL2(); else renderBody(); }); return; }
    if (act === "img-generate") { imgGenerate(i); return; }
    if (act === "img-modify") { imgModify(i); return; }
    if (act === "par-dir") {
      const pw = data.work[i]; if (!pw) return;
      pw.parDir = b.dataset.dir === "down" ? "down" : "up";
      if (pw.parAmt == null || pw.parAmt === "") pw.parAmt = 50;
      const grp = b.parentNode; if (grp) grp.querySelectorAll(".parx__dirbtn").forEach(function (x) { x.classList.toggle("is-on", x === b); });
      const box = b.closest(".parx"), range = box && box.querySelector(".parx__range");
      if (range) { range.value = pw.parAmt; parxSetFill(range, pw.parAmt); }
      const num = box && box.querySelector(".parx__val"); if (num) num.value = pw.parAmt;
      parxDemoUpdate();
      saveDraft(true);
      return;
    }
    if (act === "par-copy") {
      const pw = data.work[i];
      const nb = root && root.querySelector('[data-parxnum="' + i + '"]');
      const val = nb ? nb.value : (pw && pw.parAmt != null ? String(pw.parAmt) : "");
      const flash = function () { b.classList.add("is-copied"); b.innerHTML = PARX_CHECK_SVG; setTimeout(function () { b.innerHTML = PARX_COPY_SVG; b.classList.remove("is-copied"); }, 1200); status("Copied intensity " + val, true); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(val).then(flash, function () { status(val); });
      else flash();
      return;
    }
    if (act === "resume-upload") { pickResume(function (uri) { setPath(data, "contact.resume", uri); apply(true); renderBody(); status("R\u00e9sum\u00e9 embedded \u2014 the dock button is now visible.", true); }); return; }
    if (act === "resume-clear") { setPath(data, "contact.resume", ""); apply(true); renderBody(); status("R\u00e9sum\u00e9 removed."); return; }
    if (act === "avatar-upload") { pickImage(function (uri) { setPath(data, "contact.avatar", uri); apply(true); renderBody(); status("Display picture updated.", true); }); return; }
    if (act === "avatar-clear") { setPath(data, "contact.avatar", ""); apply(true); renderBody(); status("Display picture removed."); return; }
    if (act === "siteicon-upload") { pickIcon(); return; }
    if (act === "siteicon-clear") { if (data.landing) delete data.landing.siteIcon; saveDraft(true); apply(true); renderBody(); status("Logo removed - the RK initials are back."); return; }
    if (act === "resume-open") { const u = data.contact && data.contact.resume; if (u && window.RK && window.RK.openResume) window.RK.openResume(u); else if (u) window.open(u, "_blank", "noopener"); return; }
    if (act === "ai-save") { aiSave(); return; }
    if (act === "ai-clear") { Object.keys(localStorage).forEach(function (k) { if (/^rk:ai:[a-z]+:key$/.test(k)) localStorage.removeItem(k); }); renderBody(); status("Keys removed."); return; }
    if (act === "ext-download") { extDownload(b); return; }
    if (act === "resume-pdf") { resumePdfDownload(b); return; }
    if (act === "phone-qr") { phoneQr(b); return; }
    if (act === "ats-check") { atsRun(b.closest(".ats"), null); return; }
    if (act === "ats-view") { atsOpenViewer(); return; }
    if (act === "ats-level") { atsLevel = b.dataset.lvl; var ap = b.closest(".ats"); if (ap) ap.querySelectorAll(".ats__lvl").forEach(function (x) { x.classList.toggle("is-on", x === b); }); return; }
    if (act === "cl-level") { clLevel = b.dataset.lvl; var clp = b.closest(".cl"); if (clp) clp.querySelectorAll(".ats__lvl").forEach(function (x) { x.classList.toggle("is-on", x === b); }); return; }
    if (act === "cl-length") { clState.length = b.dataset.len; var clp2 = b.closest(".cl"); if (clp2) clp2.querySelectorAll(".cl__lenbtn").forEach(function (x) { x.classList.toggle("is-on", x === b); }); return; }
    if (act === "cl-fetch") { clFetchToPanel(b.closest(".cl")); return; }
    if (act === "cl-generate") { clRun(b.closest(".cl"), false); return; }
    if (act === "cl-regen") { clRun(b.closest(".cl"), true); return; }
    if (act === "cl-copy") { if (clLast && navigator.clipboard) { navigator.clipboard.writeText(clLast).then(function () { status("Copied to clipboard.", true); }).catch(function () {}); } return; }
    if (act === "cl-download") { clDownload(); return; }
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
    if (act === "iprep-open") { iprepModal(i); return; }
    if (act === "story-open") { storyModal(i); return; }
    if (act === "skim-gen") { skimGenerate(i, b); return; }
    if (act === "beat-add") {
      const bw = data.work[i]; if (!bw || !bw.study) return;
      bw.study.skim = bw.study.skim || {};
      if (!Array.isArray(bw.study.skim.beats)) bw.study.skim.beats = [];
      bw.study.skim.beats.push({ problem: "", move: "", outcome: "" });
      saveDraft(true); renderL2(); status("Key move added \u2014 fill it in.", true); return;
    }
    if (act === "beat-remove") {
      const bw = data.work[i], arr = bw && bw.study && bw.study.skim && bw.study.skim.beats;
      if (!Array.isArray(arr)) return;
      arr.splice(+b.dataset.bindex, 1);
      saveDraft(true); renderL2(); status("Key move removed.", true); return;
    }
    if (act === "ovm-add") { const ow = data.work[i]; if (!ow) return; ow.study = ow.study || {}; ow.study.skim = ow.study.skim || {}; if (!Array.isArray(ow.study.skim.media)) ow.study.skim.media = []; if (ow.study.skim.media.length < 6) { ow.study.skim.media.push({ src: "", caption: "" }); saveDraft(true); renderL2(); } return; }
    if (act === "ovm-remove") { const arr = ovmArr(i); if (arr) { arr.splice(+b.dataset.ovmindex, 1); saveDraft(true); renderL2(); } return; }
    if (act === "ovm-up") { const arr = ovmArr(i), k = +b.dataset.ovmindex; if (arr && k > 0) { const tmp = arr[k - 1]; arr[k - 1] = arr[k]; arr[k] = tmp; saveDraft(true); renderL2(); } return; }
    if (act === "ovm-down") { const arr = ovmArr(i), k = +b.dataset.ovmindex; if (arr && k < arr.length - 1) { const tmp = arr[k + 1]; arr[k + 1] = arr[k]; arr[k] = tmp; saveDraft(true); renderL2(); } return; }
    if (act === "ovm-clear") { const arr = ovmArr(i), it = arr && arr[+b.dataset.ovmindex]; if (it) { it.src = ""; delete it.kind; saveDraft(true); renderL2(); } return; }
    if (act === "ovm-upload") { const k = +b.dataset.ovmindex; pickMedia(function (uri) { const arr = ovmArr(i); if (arr && arr[k]) { arr[k].src = uri; if (isVideoVal(uri)) arr[k].kind = "video"; else delete arr[k].kind; saveDraft(true); renderL2(); } }); return; }
    if (act === "wb-open") { wbModal(); return; }
    if (act === "iprep-open-ai") { iprepModal(); return; }
    if (act === "story-open-ai") { storyModal(); return; }
    if (act === "csgen-ref-toggle") { const wrap = b.closest(".csgen__ref"); if (wrap) { const open = wrap.classList.toggle("is-open"); b.textContent = (open ? "\u2212" : "+") + " Paste a reference case study to echo (optional)"; const cw = data.work[i]; if (cw) csgenState(cw.id).refShow = open; } return; }
    if (act === "study-toggle") { openL2(i); return; }
    if (act === "study-close") { closeL2(); return; }
    if (act === "journey-edit") { openJourneyEditor(); return; }
    if (act === "journey-close") { closeJourneyEditor(); return; }
    if (act === "journey-chaptoggle") {
      if (e.target.closest("input, button, [data-grip], .card__ops")) return;
      var jtc = +b.dataset.jc;
      openJC = (openJC === jtc) ? -1 : jtc;
      if (l2body) l2body.querySelectorAll(".jchap").forEach(function (x, k) { x.classList.toggle("is-open", k === openJC); });
      return;
    }
    if (act === "jchap-add") { journeyData().chapters.push(blankChapter()); openJC = data.journey.chapters.length - 1; saveDraft(true); renderJourneyEditor(); return; }
    if (act === "jchap-del") {
      var jdc = +b.dataset.jc;
      confirmModal({ title: "Remove this chapter?", sub: "All of its entries will be removed from the journey. This can\u2019t be undone.", cta: "Remove chapter" }).then(function (ok) {
        if (!ok) return;
        data.journey.chapters.splice(jdc, 1);
        if (openJC >= data.journey.chapters.length) openJC = -1;
        saveDraft(true); renderJourneyEditor();
      });
      return;
    }
    if (act === "jentry-add") { var jac = journeyData().chapters[+b.dataset.jc]; if (jac) { jac.entries = jac.entries || []; jac.entries.push(blankEntry()); openJC = +b.dataset.jc; saveDraft(true); renderJourneyEditor(); } return; }
    if (act === "jentry-del") { var jec = journeyData().chapters[+b.dataset.jc]; if (jec && jec.entries) { jec.entries.splice(+b.dataset.je, 1); saveDraft(true); renderJourneyEditor(); } return; }
    if (act === "jimg-add") {
      var jic = journeyData().chapters[+b.dataset.jc], jie = jic && jic.entries[+b.dataset.je];
      if (!jie) return; jie.images = jie.images || [];
      pickMediaMulti(function () { var im = { src: "", caption: "" }; jie.images.push(im); return im; }, function () { saveDraft(true); renderJourneyEditor(); });
      return;
    }
    if (act === "jimg-upload") {
      var juc = journeyData().chapters[+b.dataset.jc], jue = juc && juc.entries[+b.dataset.je], juk = +b.dataset.jk;
      if (!jue || !jue.images || !jue.images[juk]) return;
      pickMedia(function (uri) { jue.images[juk].src = uri; saveDraft(true); renderJourneyEditor(); });
      return;
    }
    if (act === "jimg-del") { var jdd = journeyData().chapters[+b.dataset.jc], jde = jdd && jdd.entries[+b.dataset.je]; if (jde && jde.images) { jde.images.splice(+b.dataset.jk, 1); saveDraft(true); renderJourneyEditor(); } return; }
    if (act === "jlogo-upload") {
      var jlc = journeyData().chapters[+b.dataset.jc];
      if (!jlc) return;
      pickMedia(function (uri) { jlc.logo = uri; saveDraft(true); renderJourneyEditor(); });
      return;
    }
    if (act === "jlogo-clear") { var jlcc = journeyData().chapters[+b.dataset.jc]; if (jlcc) { jlcc.logo = ""; saveDraft(true); renderJourneyEditor(); } return; }
    if (act === "study-pick") { sectionPicker(i); return; }
    if (act === "study-blockadd") { sectionPicker(i, +b.dataset.bindex); return; }
    if (act === "study-decrypt") { decryptStudyForEdit(i); return; }
    if (act === "work-decrypt") { decryptWorkForEdit(i); return; }
    if (act === "study-blocktoggle") {
      if (e.detail > 1) return; // 2nd click of a double-click - let dblclick handle rename
      const j = +b.dataset.bindex;
      const wrap = b.closest(".study__blocks");
      clearTimeout(blockRenameTimer);
      blockRenameTimer = setTimeout(function () {
        openBlock = (openBlock === j) ? -1 : j;
        if (wrap) wrap.querySelectorAll(".study__block").forEach(function (x, k) { x.classList.toggle("is-open", k === openBlock); });
        try { const fw = frameWin(); if (fw) fw.postMessage({ __rk: "gotoBlock", index: j }, "*"); } catch (err) {}
        syncPreviewSelection();
      }, 220);
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
    if (act === "study-blockdup") { const s = data.work[i].study.blocks, j = +b.dataset.bindex; if (s[j]) { s.splice(j + 1, 0, JSON.parse(JSON.stringify(s[j]))); openBlock = j + 1; saveDraft(true); renderL2(); status("Section duplicated \u2014 editing the copy.", true); } return; }
    if (act === "study-blocklock") { const s = data.work[i].study.blocks, j = +b.dataset.bindex; if (s[j]) { s[j].locked = !s[j].locked; saveDraft(true); renderL2(); status(s[j].locked ? "Section locked \u2014 hidden behind the deeper-cut pass." : "Section unlocked.", true); } return; }
    if (act === "hsize-toggle") { var hsSel = b.closest(".hsize"); if (hsSel) { var wasHsOpen = hsSel.classList.contains("is-open"); if (root) root.querySelectorAll(".hsize.is-open").forEach(function (x) { x.classList.remove("is-open"); }); if (!wasHsOpen) hsSel.classList.add("is-open"); } return; }
    if (act === "hsize-set") { const s = data.work[i].study.blocks, j = +b.dataset.bindex; if (s[j]) { s[j].hsize = b.dataset.hsize || ""; saveDraft(true); renderL2(); } return; }
    if (act === "item-add") { const bl = data.work[i].study.blocks[+b.dataset.bindex]; bl.items = bl.items || []; bl.items.push(blankItem(bl.type)); saveDraft(true); renderL2(); return; }
    if (act === "item-remove") { const bl = data.work[i].study.blocks[+b.dataset.bindex]; bl.items.splice(+b.dataset.iindex, 1); saveDraft(true); renderL2(); return; }
    if (act === "item-up") { const bl = data.work[i].study.blocks[+b.dataset.bindex], k = +b.dataset.iindex; if (k > 0) { [bl.items[k - 1], bl.items[k]] = [bl.items[k], bl.items[k - 1]]; saveDraft(true); renderL2(); } return; }
    if (act === "item-down") { const bl = data.work[i].study.blocks[+b.dataset.bindex], k = +b.dataset.iindex; if (k < bl.items.length - 1) { [bl.items[k + 1], bl.items[k]] = [bl.items[k], bl.items[k + 1]]; saveDraft(true); renderL2(); } return; }
    if (act === "media-eyedrop") { const bj = +b.dataset.bindex, k = +b.dataset.iindex; const bl = data.work[i].study.blocks[bj]; const it = bl && bl.items && bl.items[k]; if (!it) return; if (!window.EyeDropper) { status("This browser has no eyedropper \u2014 use the colour box.", false); return; } new EyeDropper().open().then(function (res) { it.bg = res.sRGBHex; saveDraft(true); renderL2(); refreshL2Preview(); }).catch(function () {}); return; }
    if (act === "iso-eyedrop") { const bj = +b.dataset.bindex, k = +b.dataset.iindex, f = b.dataset.ifield; const bl = data.work[i].study.blocks[bj]; const it = bl && bl.items && bl.items[k]; if (!it) return; if (!window.EyeDropper) { status("This browser has no eyedropper \u2014 use the colour box.", false); return; } new EyeDropper().open().then(function (res) { it[f] = res.sRGBHex; saveDraft(true); renderL2(); refreshL2Preview(); }).catch(function () {}); return; }
    if (act === "iso-import-svg") {
      const bj = +b.dataset.bindex; const bl = data.work[i].study.blocks[bj]; if (!bl) return;
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".svg,image/svg+xml";
      inp.onchange = function () {
        const f = inp.files && inp.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = function () {
          const layers = isoSplitSvg(rd.result);
          if (!layers.length) { status("Couldn\u2019t find layers in that SVG \u2014 give each layer its own group/frame in Figma.", false); return; }
          bl.items = bl.items || [];
          let added = 0;
          layers.forEach(function (src) { if (bl.items.length < 12) { bl.items.push({ src: src, heightColor: "" }); added++; } });
          saveDraft(true); renderL2();
          status(added + " layer" + (added > 1 ? "s" : "") + " imported" + (layers.length > added ? " (capped at 12)" : "") + ".", true);
        };
        rd.readAsText(f);
      };
      inp.click();
      return;
    }
    if (act === "media-bgclear") { const bj = +b.dataset.bindex, k = +b.dataset.iindex; const bl = data.work[i].study.blocks[bj]; const it = bl && bl.items && bl.items[k]; if (it) { it.bg = ""; saveDraft(true); renderL2(); refreshL2Preview(); } return; }
    if (act === "item-upload") { const bj = +b.dataset.bindex, k = +b.dataset.iindex, f = b.dataset.ifield; pickMedia(function (uri) { const bl = data.work[i].study.blocks[bj]; if (bl && bl.items && bl.items[k]) { bl.items[k][f] = uri; if (isVideoVal(uri)) bl.items[k].controls = true; saveDraft(true); renderL2(); } }, { vault: !!(data.work[i].study.blocks[bj] && data.work[i].study.blocks[bj].locked) }); return; }
    if (act === "item-upload-multi") { const bl = data.work[i].study.blocks[+b.dataset.bindex]; if (!bl) return; bl.items = bl.items || []; pickMediaMulti(function () { const it = blankItem(bl.type); bl.items.push(it); return it; }, function () { saveDraft(true); renderL2(); }, { vault: !!bl.locked }); return; }
    if (act === "item-icon") { const bj = +b.dataset.bindex, k = +b.dataset.iindex, f = b.dataset.ifield, name = b.dataset.icon; const bl = data.work[i].study.blocks[bj]; if (bl && bl.items && bl.items[k]) { bl.items[k][f] = name; saveDraft(true); refreshL2Preview(); const grid = b.closest(".iconpick"); if (grid) grid.querySelectorAll(".iconpick__b").forEach(function (x) { x.classList.toggle("is-on", x === b); }); const dd = b.closest(".icondd"); if (dd) { const cur = dd.querySelector(".icondd__cur"); if (cur) cur.innerHTML = name ? admIcon(name) : "\u2205"; const nm = dd.querySelector(".icondd__name"); if (nm) nm.textContent = name || "No icon"; if (dd.tagName === "DETAILS") dd.open = false; } } return; }
    if (act === "item-clear") { const bl = data.work[i].study.blocks[+b.dataset.bindex], k = +b.dataset.iindex; if (bl && bl.items && bl.items[k]) { bl.items[k][b.dataset.ifield] = ""; saveDraft(true); renderL2(); } return; }
    if (act === "cell-add") { const it = data.work[i].study.blocks[+b.dataset.bindex].items[+b.dataset.iindex]; it.cells = it.cells || []; if (it.cells.length < 5) { it.cells.push(blankCell()); saveDraft(true); renderL2(); } return; }
    if (act === "cell-remove") { const it = data.work[i].study.blocks[+b.dataset.bindex].items[+b.dataset.iindex]; if (it.cells) { it.cells.splice(+b.dataset.cindex, 1); if (!it.cells.length) it.cells.push(blankCell()); saveDraft(true); renderL2(); } return; }
    if (act === "cell-up") { const it = data.work[i].study.blocks[+b.dataset.bindex].items[+b.dataset.iindex], c = +b.dataset.cindex; if (it.cells && c > 0) { const tmp = it.cells[c - 1]; it.cells[c - 1] = it.cells[c]; it.cells[c] = tmp; saveDraft(true); renderL2(); } return; }
    if (act === "cell-down") { const it = data.work[i].study.blocks[+b.dataset.bindex].items[+b.dataset.iindex], c = +b.dataset.cindex; if (it.cells && c < it.cells.length - 1) { const tmp = it.cells[c + 1]; it.cells[c + 1] = it.cells[c]; it.cells[c] = tmp; saveDraft(true); renderL2(); } return; }
    if (act === "cell-upload") { const bj = +b.dataset.bindex, k = +b.dataset.iindex, c = +b.dataset.cindex; pickMedia(function (uri) { const it = data.work[i].study.blocks[bj].items[k]; if (it && it.cells && it.cells[c]) { it.cells[c].src = uri; saveDraft(true); renderL2(); } }, { vault: !!(data.work[i].study.blocks[bj] && data.work[i].study.blocks[bj].locked) }); return; }
    if (act === "cell-clear") { const it = data.work[i].study.blocks[+b.dataset.bindex].items[+b.dataset.iindex], c = +b.dataset.cindex; if (it.cells && it.cells[c]) { it.cells[c].src = ""; saveDraft(true); renderL2(); } return; }
    if (act === "bfield-upload") { const bj = +b.dataset.bindex, f = b.dataset.bfield; pickMedia(function (uri) { const bl = data.work[i].study.blocks[bj]; if (bl) { bl[f] = uri; if (isVideoVal(uri)) bl.controls = true; saveDraft(true); renderL2(); } }, { vault: !!(data.work[i].study.blocks[bj] && data.work[i].study.blocks[bj].locked) }); return; }
    if (act === "bfield-clear") { const bl = data.work[i].study.blocks[+b.dataset.bindex]; if (bl) { bl[b.dataset.bfield] = ""; saveDraft(true); renderL2(); } return; }
    if (act === "fa-add") { faPlacing = !faPlacing; renderL2(); return; }
    if (act === "fa-select") { if (faJustMoved) { faJustMoved = false; return; } faSel = +b.dataset.aindex; faPlacing = false; renderL2(); return; }
    if (act === "fa-remove") { const bl = faBlock(i, +b.dataset.bindex); if (bl && bl.annotations) { bl.annotations.splice(+b.dataset.aindex, 1); if (faSel >= bl.annotations.length) faSel = bl.annotations.length - 1; saveDraft(true); renderL2(); } return; }
    if (act === "fa-focustoggle") { const bl = faBlock(i, +b.dataset.bindex); const a = bl && bl.annotations && bl.annotations[+b.dataset.aindex]; if (a) { if (a.focus) delete a.focus; else a.focus = { shape: "rect", x: 25, y: 25, w: 35, h: 35 }; faSel = +b.dataset.aindex; saveDraft(true); renderL2(); } return; }
    if (act === "study-preview") { saveDraft(true); status("Opening your current draft in a new tab\u2026"); return; }
    if (act === "work-dup") {
      const src = data.work[i];
      if (!src || src.encWork) return;
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = "w" + Date.now();   // new unique id so routing/keying doesn't clash with the original
      copy.hidden = true;           // the copy stays off the live site until the owner is ready
      copy.featured = false;        // a copy shouldn't take one of the 4 homepage feature slots
      if (copy.title && copy.title !== "Project title") copy.title += " (copy)";
      data.work.splice(i + 1, 0, copy);
      apply(true); renderBody();
      status("Case study duplicated \u2014 the copy is Hidden from the site until you\u2019re ready to publish it.", true);
      return;
    }
    if (act === "add") { data[list].unshift(blank(list)); apply(true); renderBody(); const ed = root.querySelector(".adm__editor"); if (ed) ed.scrollTop = 0; status("Added at the top \u2014 edit it right here.", true); }
    else if (act === "remove") {
      if (list === "work") {
        const w = data.work[i] || {};
        const nm = (w.title && w.title !== "Project title") ? w.title : (w.client || "this case study");
        confirmModal({ title: "Delete this case study?", sub: "\u201c" + nm + "\u201d and all of its sections will be permanently removed. This can\u2019t be undone.", cta: "Delete case study" })
          .then(function (ok) { if (ok) { data.work.splice(i, 1); apply(true); renderBody(); status("Case study deleted.", true); } });
      } else { data[list].splice(i, 1); apply(true); renderBody(); }
    }
    else if (act === "up" && i > 0) { const a = data[list]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; apply(true); renderBody(); }
    else if (act === "down" && i < data[list].length - 1) { const a = data[list]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; apply(true); renderBody(); }
  }

  /* ---------- publish / revert ---------- */
  /* ---------- publish ---------- */
  function publish() {
    if (adminSession()) { ghPublish("session"); return; }   // session authorises publishing via the Worker
    const token = localStorage.getItem(GH_TOKEN_KEY);
    if (token) ghPublish(token);
    else publishModal();
  }

  /* ---------- auto-publish (publishes changes on a timer while the studio is open) ---------- */
  function autopubOn() { return localStorage.getItem(AUTOPUB_ON_KEY) === "1"; }
  function autopubEvery() { return localStorage.getItem(AUTOPUB_EVERY_KEY) === "60" ? 60 : 30; }
  function autopubStop() { if (autopubTimer) { clearInterval(autopubTimer); autopubTimer = 0; } }
  function autopubStart() { autopubStop(); if (autopubOn()) autopubTimer = setInterval(autopubTick, autopubEvery() * 60000); }
  function autopubTick() {
    if (!autopubOn()) { autopubStop(); return; }
    if (publishing || !root || !root.classList.contains("is-open")) return;
    const token = adminSession() ? "session" : localStorage.getItem(GH_TOKEN_KEY);
    if (!token) return;                        // not connected \u2014 can't publish silently
    const ae = document.activeElement;          // don't yank focus mid-edit; catch it next tick
    if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return;
    const cur = (window.RK && window.RK.sig) ? window.RK.sig(JSON.stringify(data)) : null;
    const pub = (window.RK && window.RK.publishedSig) || "";
    if (cur && pub && cur === pub) return;      // nothing changed since the last publish
    status("Auto-publishing your changes\u2026", true);
    ghPublish(token);
  }
  function autopubSync() {
    if (!root) return;
    const on = autopubOn(), every = autopubEvery();
    const wrap = root.querySelector("[data-autopub]");
    if (wrap) wrap.classList.toggle("is-on", on);
    const sw = root.querySelector("[data-autopub-toggle]");
    if (sw) sw.setAttribute("aria-checked", on ? "true" : "false");
    const lbl = root.querySelector(".adm__auto-lbl");
    if (lbl) lbl.textContent = on ? ("Auto-publish \u00b7 " + (every === 60 ? "1h" : "30m")) : "Auto-publish";
    root.querySelectorAll("[data-autopub-every]").forEach(function (r) { r.checked = (+r.value === every); });
  }
  function autopubToggle() {
    const turningOn = !autopubOn();
    if (turningOn && !adminSession() && !localStorage.getItem(GH_TOKEN_KEY)) publishModal();  // needs a session or saved token to run
    try { localStorage.setItem(AUTOPUB_ON_KEY, turningOn ? "1" : "0"); } catch (e) {}
    autopubSync(); autopubStart();
    status(turningOn ? ("Auto-publish on \u2014 every " + (autopubEvery() === 60 ? "hour" : "30 minutes") + ".") : "Auto-publish off.", true);
  }
  function autopubSetEvery(mins) {
    try { localStorage.setItem(AUTOPUB_EVERY_KEY, mins === 60 ? "60" : "30"); } catch (e) {}
    autopubSync(); if (autopubOn()) autopubStart();
    status("Auto-publish every " + (mins === 60 ? "hour" : "30 minutes") + ".", true);
  }

  // Build the JSON to publish: auto-style, then clone and encrypt every plaintext
  // Locked block per project, wrapping its key for recovery + pass + curating tickets.
  // AUTO-VAULT ON PUBLISH: every plaintext Locked section is moved into the private vault at publish time
  // so content.json ships only a pointer (zero content). Runs on the publish CLONE (pubData) — the live
  // draft is never mutated, so your editor keeps the section fully editable. Per section it's ATOMIC: all
  // of the section's media must upload to R2 before the section is flagged `vault`; if you're not signed in,
  // or any upload fails, that section is left untouched and encryptLockedForPublish protects it with the
  // in-file .enc gate instead (a Locked section is therefore never left unprotected, and publish never breaks).
  async function autoVaultLockedForPublish(pubData) {
    if (!adminSession()) return;                       // no session -> nothing to upload with -> all Locked -> .enc
    var works = (pubData && pubData.work) || [];
    for (var wi = 0; wi < works.length; wi++) {
      var w = works[wi];
      if (!w || w.hidden || w.encWork || !w.study || !Array.isArray(w.study.blocks)) continue;
      var blocks = w.study.blocks;
      for (var bi = 0; bi < blocks.length; bi++) {
        var b = blocks[bi];
        if (!b || !b.locked || b.encStub || b.vault || b.vaultBlock) continue;   // only plaintext Locked, not already vaulted (pointer or in-file .enc) -- STABLE KEYS: never re-vault an unchanged pointer
        var targets = [];
        (function scan(o) {
          if (!o || typeof o !== "object") return;
          for (var k in o) { var v = o[k]; if (typeof v === "string") { if (isVaultMigratable(v)) targets.push({ o: o, k: k, src: v }); } else if (v && typeof v === "object") scan(v); }
        })(b);
        // Upload all of this section's media FIRST; only commit the ref swaps + vault flag if every one succeeds.
        var uploaded = [], ok = true;
        for (var ti = 0; ti < targets.length; ti++) {
          var t = targets[ti];
          try {
            var url = /^data:/i.test(t.src) ? t.src : (t.src.charAt(0) === "/" ? t.src : "/" + t.src);
            var r = await fetch(url); if (!r.ok) { ok = false; break; }
            var blob = await r.blob();
            var key = await vaultUpload(blob, vaultMediaExt(t.src, blob));
            uploaded.push({ o: t.o, k: t.k, key: key });
          } catch (e) { ok = false; if (e && e.auth) { clearAdminSession(); return; } break; }
        }
        if (!ok) continue;                              // leave this section untouched -> .enc fallback
        uploaded.forEach(function (u) { u.o[u.k] = "vault:" + u.key; });
        b.vault = true;
      }
    }
  }

  async function buildPublishJson(token) {
    const styled = autoStyleLanding(false);
    if (styled) { if (activeTab === "landing") renderBody(); apply(true); }
    const pubData = JSON.parse(JSON.stringify(data));
    // Never publish the admin-key hash — in a public repo it was an offline brute-force target. The
    // Cloudflare Worker is the source of truth for admin auth now (password login + passkeys).
    try { delete pubData.adminGate; } catch (e) {}
    // Auto-vault: move every plaintext Locked section into the private vault (on the CLONE, so the live
    // draft stays editable). Needs your session; any section it can't fully move stays for the .enc gate below.
    await autoVaultLockedForPublish(pubData);
    // With a token, protected images are encrypted into their own /assets/protected/<hash>.enc
    // files (content.json stays tiny). Without one (manual publish), fall back to inlining them.
    if (!token) await inlineProtectedImages(pubData);
    await loadTicketKeyring();
    await encryptLockedForPublish(pubData, token || null);
    await registerVaultGrants(pubData);
    await saveTicketKeyring();
    return JSON.stringify(pubData, null, 2);
  }
  // ---------- per-image protected media: encrypt each image and host it as its own
  //   /assets/protected/<hash>.enc file, so content.json never bloats with big media. ----------
  function isBareUploadPath(v) {
    return typeof v === "string" && v.indexOf(" ") === -1 &&
      (v.indexOf("/assets/uploads/") === 0 || v.indexOf("assets/uploads/") === 0);
  }
  async function getImageBytes(ref) {
    if (/^data:/i.test(ref)) {
      var parts = parseDataUri(ref); if (!parts) return null;
      var rb = parts.base64 ? parts.data : b64(decodeURIComponent(parts.data));
      return { bytes: b64ToBytes(rb), mime: parts.mime || "application/octet-stream" };
    }
    var url = ref.charAt(0) === "/" ? ref : "/" + ref;
    var res = await fetch(url); if (!res.ok) return null;
    var blob = await res.blob();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || "application/octet-stream" };
  }
  async function hostEncFile(ctBytes, token) {
    var hash = await sha256Hex(ctBytes);
    var repoPath = "assets/protected/" + hash + ".enc";
    var put;
    try { put = await fetch(ghContentsUrl(repoPath), { method: "PUT", headers: ghHeaders(token), body: JSON.stringify({ message: "Add " + hash + ".enc via admin", content: rkB64(ctBytes), branch: GH_BRANCH }) }); }
    catch (e) { var ne = new Error("network"); ne.network = 1; throw ne; }
    if (put.status === 422) return "/" + repoPath;
    if (put.status === 401 || put.status === 403) { var ae = new Error("auth"); ae.auth = 1; throw ae; }
    if (!put.ok) { var j = await put.json().catch(function () { return {}; }); var er = new Error((j && j.message) || ("HTTP " + put.status)); er.http = put.status; if (put.status === 413 || /too large|too big|exceed/i.test(er.message)) er.tooLarge = 1; throw er; }
    return "/" + repoPath;
  }
  // Encrypt every image/video inside `node` with `sek`, host each as an .enc file, and replace
  // the reference with a compact "rkenc:" token that holds {path, iv, mime}. Best-effort per item.
  async function encImagesInSubtree(node, sekBytes, token) {
    var targets = [];
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      for (var k in o) {
        var v = o[k];
        if (typeof v === "string") {
          if (!/^rkenc:/.test(v) && (isBareUploadPath(v) || /^data:(image|video|application)\//i.test(v))) targets.push({ o: o, k: k });
        } else if (v && typeof v === "object") walk(v);
      }
    })(node);
    var cache = {};
    for (var i = 0; i < targets.length; i++) {
      var o = targets[i].o, k = targets[i].k, v = o[k];
      try {
        if (!(v in cache)) {
          var got = await getImageBytes(v);
          if (!got) { cache[v] = null; }
          else {
            var enc = await rkEncBytes(sekBytes, got.bytes);
            var webPath = await hostEncFile(enc.ct, token);
            cache[v] = "rkenc:" + btoa(JSON.stringify({ p: webPath, iv: enc.iv, m: got.mime }));
          }
        }
        if (cache[v]) o[k] = cache[v];
      } catch (e) { if (e && e.auth) throw e; /* else leave the ref as-is (stays inside the encrypted blob) */ }
    }
  }
  // Owner side: turn "rkenc:" refs back into viewable data: URIs (decrypt the .enc files) so
  // protected media shows in the editor; they re-encrypt to fresh .enc files on Publish.
  async function rkResolveEncToDataUri(node, sekBytes) {
    var targets = [];
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      for (var k in o) { var v = o[k]; if (typeof v === "string") { if (/^rkenc:/.test(v)) targets.push({ o: o, k: k }); } else if (v && typeof v === "object") walk(v); }
    })(node);
    for (var i = 0; i < targets.length; i++) {
      var o = targets[i].o, k = targets[i].k;
      try {
        var meta = JSON.parse(atob(o[k].slice(6)));
        var res = await fetch(meta.p); if (!res.ok) continue;
        var bytes = await rkDecBytes(sekBytes, meta.iv, new Uint8Array(await res.arrayBuffer()));
        o[k] = "data:" + (meta.m || "application/octet-stream") + ";base64," + rkB64(bytes);
      } catch (e) { /* leave as rkenc: */ }
    }
  }
  // Inline (as data URIs) any hosted image referenced inside a Locked block or a
  // Hidden project, so its bytes get encrypted with that block/work rather than
  // remaining a public /assets/uploads file. Best-effort: anything it can't fetch
  // is left as-is.
  async function inlineProtectedImages(pubData) {
    var works = (pubData && pubData.work) || [];
    var nodes = [];
    (function collect(o, prot) {
      if (!o || typeof o !== "object") return;
      var p = prot || o.hidden === true || o.locked === true;
      for (var k in o) {
        var v = o[k];
        if (typeof v === "string") { if (p && /assets\/uploads\//.test(v) && !/^data:/i.test(v)) nodes.push({ o: o, k: k }); }
        else if (v && typeof v === "object") collect(v, p);
      }
    })({ work: works }, false);
    var cache = {};
    for (var i = 0; i < nodes.length; i++) {
      var o = nodes[i].o, k = nodes[i].k, str = o[k];
      var paths = str.match(/(?:\/)?assets\/uploads\/[A-Za-z0-9._\-]+\.[A-Za-z0-9]+/g);
      if (!paths) continue;
      var uniq = paths.filter(function (x, ix) { return paths.indexOf(x) === ix; });
      for (var pi = 0; pi < uniq.length; pi++) {
        var path = uniq[pi];
        try {
          if (!(path in cache)) {
            var url = path.charAt(0) === "/" ? path : "/" + path;
            var res = await fetch(url);
            if (!res.ok) { cache[path] = null; }
            else {
              var blob = await res.blob();
              cache[path] = await new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = reject; r.readAsDataURL(blob); });
            }
          }
          if (cache[path]) o[k] = o[k].split(path).join(cache[path]);
        } catch (e) { /* leave untouched */ }
      }
    }
  }
  // Already-encrypted content (encWork stubs / stub-only studies) is preserved verbatim across
  // publishes — so a special view created AFTER a section was first encrypted would never carry a
  // key to open it. This tops up the missing per-view ticket wraps (unwrapping the section key with
  // the recovery pass) and prunes wraps for views that no longer include the work. Publish-payload
  // only (pubData is a clone); the recovery pass is cached per session.
  async function syncStubTickets(enc, workId, svAll) {
    if (!enc || !enc.wraps || !enc.wraps.owner) return;
    var qualify = {};
    (svAll || []).forEach(function (sv) { if (sv && sv.ticketHash && (sv.workIds || []).indexOf(workId) !== -1) qualify[sv.id] = sv; });
    var have = enc.wraps.tickets || {};
    var missing = Object.keys(qualify).filter(function (id) { return !have[id]; });
    var stale = Object.keys(have).filter(function (id) { return !qualify[id]; });
    if (!missing.length && !stale.length) return;
    stale.forEach(function (id) { delete have[id]; });
    if (missing.length) {
      var recovery = await ensureRecoveryPass();
      if (recovery === null) throw { rkEnc: true, cancelled: true };
      var sek;
      try { sek = await rkUnwrapSek(recovery, enc.wraps.owner); } catch (e) { throw { rkEnc: true, cancelled: true }; }
      for (var i = 0; i < missing.length; i++) {
        var code = await ensureTicketCode(qualify[missing[i]]);
        if (code === null) throw { rkEnc: true, cancelled: true };
        have[missing[i]] = await rkWrapSek(code, sek);
      }
    }
    if (Object.keys(have).length) enc.wraps.tickets = have; else if (enc.wraps.tickets) delete enc.wraps.tickets;
  }
  // Vault-section keys collected during a publish (workId -> [vaultBlock key, ...inner vault: media keys]),
  // so registerVaultGrants can scope each pass's grant to the sections it opens. Reset every publish.
  var vaultBlockKeys = {};
  // Upload a whole locked section to the private vault as plain JSON and return a lean {vaultBlock:key}
  // pointer for the published payload (content.json ships zero content). Records the section's vault keys
  // (itself + any inner vault: media) for grant scoping. Returns null on failure so the caller can fall
  // back to .enc protection rather than ever ship the section as plaintext.
  async function vaultBlockPointer(workId, block) {
    try {
      var json = JSON.stringify(block, function (k, v) { return k === "vault" ? undefined : v; });
      var key = await vaultUpload(new Blob([json], { type: "application/json" }), "json");
      var keys = [key];
      (function scan(o) { if (!o || typeof o !== "object") return; for (var kk in o) { var v = o[kk]; if (typeof v === "string") { var m = /^vault:(.+)$/i.exec(v); if (m && m[1].indexOf("/") === -1) keys.push(m[1]); } else if (v && typeof v === "object") scan(v); } })(block);
      vaultBlockKeys[workId] = (vaultBlockKeys[workId] || []).concat(keys);
      var ptr = { type: block.type, locked: true, vaultBlock: key };
      if (block.nav) ptr.nav = block.nav;
      if (block.kicker) ptr.kicker = block.kicker;
      if (block.sep === false) ptr.sep = false;
      if (block.hsize) ptr.hsize = block.hsize;
      return ptr;
    } catch (e) { return null; }
  }
  async function encryptLockedForPublish(pubData, token) {
    var works = (pubData && pubData.work) || [];
    var svAll = (pubData.specialViews || []);
    vaultBlockKeys = {};
    for (var wi = 0; wi < works.length; wi++) {
      var w = works[wi], st = w && w.study;
      if (w && w.encWork) { await syncStubTickets(w.enc, w.id, svAll); continue; }   // already-encrypted stub - keep verbatim, but sync its ticket wraps
      // --- hidden whole-project encryption (ticket-only + owner recovery) ---
      if (w && w.hidden) {
        var wrecovery = await ensureRecoveryPass();
        if (wrecovery === null) throw { rkEnc: true, cancelled: true };
        var wsek = rkNewSek();
        if (token) await encImagesInSubtree(w, wsek, token);
        var wenc = await rkEncWithSek(wsek, w);
        var wwraps = { owner: await rkWrapSek(wrecovery, wsek) };
        var wtks = {};
        for (var wsi = 0; wsi < svAll.length; wsi++) {
          var wsv = svAll[wsi];
          if (!wsv || !wsv.ticketHash || (wsv.workIds || []).indexOf(w.id) === -1) continue;
          var wcode = await ensureTicketCode(wsv);
          if (wcode === null) throw { rkEnc: true, cancelled: true };
          wtks[wsv.id] = await rkWrapSek(wcode, wsek);
        }
        if (Object.keys(wtks).length) wwraps.tickets = wtks;
        works[wi] = { id: w.id, hidden: true, encWork: true, enc: { v: 1, it: RK_KDF_IT, wraps: wwraps }, iv: wenc.iv, ct: wenc.ct };
        continue;
      }
      // --- per-block locked-section: vault whole sections, encrypt the rest ---
      if (!st || !Array.isArray(st.blocks)) continue;
      var plain = [], stubs = 0, vaultBlks = [], alreadyVaulted = [];
      for (var bi = 0; bi < st.blocks.length; bi++) {
        var b = st.blocks[bi];
        if (!b || !b.locked) continue;
        if (b.vaultBlock && !b.vault) alreadyVaulted.push(bi);   // a lean vault pointer reopened without unlocking — keep it verbatim, never re-encrypt it
        else if (b.vault && !b.encStub) vaultBlks.push(bi);   // owner marked "store this whole section privately in the vault"
        else if (b.encStub) stubs++;
        else plain.push(bi);
      }
      // Upload each vault-flagged section as plain JSON -> replace with a lean pointer. On failure
      // (e.g. no session) fall back to encrypting it in place so it is never shipped as plaintext.
      for (var vbi = 0; vbi < vaultBlks.length; vbi++) {
        var vidx = vaultBlks[vbi], vptr = await vaultBlockPointer(w.id, st.blocks[vidx]);
        if (vptr) st.blocks[vidx] = vptr; else plain.push(vidx);
      }
      // Already-vaulted pointers ship verbatim (content.json keeps the lean pointer, R2 stays untouched, the
      // R2 key is unchanged). Re-scan each one's stored JSON so this publish's grants still cover its inner
      // media keys — otherwise the grant would shrink and revoke a pass-holder's access to those images.
      for (var avi = 0; avi < alreadyVaulted.length; avi++) {
        var apb = st.blocks[alreadyVaulted[avi]], akeys = [apb.vaultBlock];
        try {
          var aurl = adminSession() ? await vaultSignedUrl(apb.vaultBlock) : null;
          if (aurl) {
            var afull = await (await fetch(aurl)).json();
            (function scan(o) { if (!o || typeof o !== "object") return; for (var kk in o) { var v = o[kk]; if (typeof v === "string") { var m = /^vault:(.+)$/i.exec(v); if (m && m[1].indexOf("/") === -1) akeys.push(m[1]); } else if (v && typeof v === "object") scan(v); } })(afull);
          }
        } catch (e) {}
        vaultBlockKeys[w.id] = (vaultBlockKeys[w.id] || []).concat(akeys);
      }
      // Recover the ticket codes that open this project's vault sections. Vault sections aren't
      // per-pass-wrapped like .enc, but registerVaultGrants still needs the plaintext code to scope
      // each pass's grant — so recover it here (ensureTicketCode caches; mirrors the .enc loop below).
      // Reopened-but-not-unlocked pointers (alreadyVaulted) count too, so their grants still refresh.
      if (vaultBlks.length || alreadyVaulted.length) {
        for (var vsi = 0; vsi < svAll.length; vsi++) {
          var vsv = svAll[vsi];
          if (!vsv || !vsv.ticketHash || (vsv.workIds || []).indexOf(w.id) === -1) continue;
          if (await ensureTicketCode(vsv) === null) throw { rkEnc: true, cancelled: true };
        }
      }
      if (!plain.length) { await syncStubTickets(st.enc, w.id, svAll); continue; }   // stub-only (or vault-only) - sync ticket wraps, keep verbatim
      if (stubs) throw { rkEnc: true, mixed: true, work: w };    // never mix plaintext + already-encrypted
      var recovery = await ensureRecoveryPass();
      if (recovery === null) throw { rkEnc: true, cancelled: true };
      var sek = rkNewSek();
      for (var pi = 0; pi < plain.length; pi++) { var idx = plain[pi]; if (token) await encImagesInSubtree(st.blocks[idx], sek, token); st.blocks[idx] = await makeStub(sek, st.blocks[idx]); }
      var wraps = { owner: await rkWrapSek(recovery, sek) };
      var deeper = await ensureStudyPass(w, st);
      if (rkNormPass(deeper)) wraps.pass = await rkWrapSek(deeper, sek);
      var tks = {};
      for (var si = 0; si < svAll.length; si++) {
        var sv = svAll[si];
        if (!sv || !sv.ticketHash || (sv.workIds || []).indexOf(w.id) === -1) continue;
        var code = await ensureTicketCode(sv);
        if (code === null) throw { rkEnc: true, cancelled: true };
        tks[sv.id] = await rkWrapSek(code, sek);
      }
      if (Object.keys(tks).length) wraps.tickets = tks;
      st.enc = { v: 1, it: RK_KDF_IT, wraps: wraps };
    }
  }
  // ---- curated-view vault grants ----
  // After a publish has encrypted everything, register/refresh a server-side grant for each pass
  // (a special-view ticket or a deeper-cut pass) so its holder can mint signed URLs for exactly the
  // vault media inside the sections that pass opens — nothing more. The grant is keyed server-side by
  // an HMAC of the pass (the raw pass never leaves the browser except as the code the recruiter
  // already has) and scoped to the union of vault keys across every project the pass unlocks. Each
  // /vault/grant call REPLACES the pass's key set, so we always send the full union. Best-effort:
  // any failure here never blocks the publish — the .enc protection already applies regardless.
  var VAULT_GRANT_MAX_DAYS = 3650;   // 10y — the horizon for a "never"-expiring ticket / deeper-cut pass (refreshed each publish); dated tickets use their own exact expiry
  // The absolute time a pass's vault grant should expire — kept identical to the special view's own
  // auto-hide (createdAt + days; days === 0 means "never", so a rolling max-length window refreshed on
  // each publish). Recomputed every publish from that FIXED expiry, so a dated ticket is never rolled
  // forward — the grant lapses exactly when the curated view does (svExpired uses the same formula).
  function grantExpForSv(sv) {
    var d = parseInt(sv && sv.days, 10) || 0;
    if (d <= 0) return Date.now() + VAULT_GRANT_MAX_DAYS * 86400000;
    return (sv.createdAt || 0) + d * 86400000;
  }
  async function registerVaultGrants(pubData) {
    try {
      if (!adminSession()) return;                 // /vault/grant is owner-session gated
      if (recoveryPassCache === null && !Object.keys(vaultBlockKeys).length) return;   // no master key AND no vault sections -> leave existing grants untouched
      var works = (pubData && pubData.work) || [];
      var svAll = (pubData.specialViews || []);
      var now = Date.now();
      var scope = {};                              // normalised pass -> { keys:{key:1}, exp:ms }
      function want(code, exp) {
        var c = rkNormPass(code); if (!c) return null;
        if (!scope[c]) scope[c] = { keys: {}, exp: 0, complete: true };
        if (exp > scope[c].exp) scope[c].exp = exp;   // a shared code stays valid as long as its longest-lived pass
        return scope[c];
      }
      function scanKeys(node, into) {
        if (!node || typeof node !== "object") return;
        for (var k in node) {
          var v = node[k];
          if (typeof v === "string") { var m = /^vault:(.+)$/i.exec(v); if (m && m[1].indexOf("/") === -1) into[m[1]] = 1; }
          else if (v && typeof v === "object") scanKeys(v, into);
        }
      }
      for (var wi = 0; wi < works.length; wi++) {
        var w = works[wi]; if (!w) continue;
        // Which passes open this project, and until when? (codes were recovered during encryption — never prompt here.)
        var codes = [];
        for (var si = 0; si < svAll.length; si++) {
          var sv = svAll[si];
          if (!sv || !sv.ticketHash || (sv.workIds || []).indexOf(w.id) === -1) continue;
          if (!rkNormPass(ticketPlain[sv.id])) continue;
          var exp = grantExpForSv(sv);
          if (exp > now + 60000) codes.push({ code: ticketPlain[sv.id], exp: exp });   // skip a ticket that has already auto-hidden
        }
        if (rkNormPass(studyUnlockPlain[w.id])) codes.push({ code: studyUnlockPlain[w.id], exp: now + VAULT_GRANT_MAX_DAYS * 86400000 });  // deeper-cut pass carries no expiry
        if (!codes.length) continue;               // no live pass opens this project -> nothing to grant
        // Collect this project's vault keys. encStub media needs the master key to read; vault-section keys
        // come from the publish stash. If we can't fully read the project, mark it incomplete so we never
        // POST a shrunk key set (which would revoke access a pass already had).
        var keys = {}, readable = true;
        try {
          if (w.encWork && w.enc && w.enc.wraps && w.enc.wraps.owner) {
            if (recoveryPassCache) scanKeys(await rkDecWithSek(await rkUnwrapSek(recoveryPassCache, w.enc.wraps.owner), w), keys);
            else readable = false;
          } else if (w.study && Array.isArray(w.study.blocks)) {
            var st = w.study, sek = null;
            for (var bi = 0; bi < st.blocks.length; bi++) {
              var b = st.blocks[bi]; if (!b) continue;
              if (b.encStub && b.iv && b.ct) {
                if (!recoveryPassCache) { readable = false; break; }
                if (!sek && st.enc && st.enc.wraps && st.enc.wraps.owner) sek = await rkUnwrapSek(recoveryPassCache, st.enc.wraps.owner);
                if (sek) scanKeys(await rkDecWithSek(sek, b), keys); else readable = false;
              } else if (b.locked && !b.vaultBlock) { scanKeys(b, keys); }   // plaintext locked (token-less publish) — safe to scan
            }
          }
        } catch (e) { readable = false; }
        (vaultBlockKeys[w.id] || []).forEach(function (k) { if (k) keys[k] = 1; });   // vault-section keys: the pointer + any inner media
        var kl = Object.keys(keys);
        for (var ci = 0; ci < codes.length; ci++) { var sc = want(codes[ci].code, codes[ci].exp); if (!sc) continue; if (!readable) sc.complete = false; for (var ki = 0; ki < kl.length; ki++) sc.keys[kl[ki]] = 1; }
      }
      var passes = Object.keys(scope), okN = 0;
      for (var pi = 0; pi < passes.length; pi++) {
        var entry = scope[passes[pi]], ks = Object.keys(entry.keys);
        if (!entry.complete || !ks.length) continue;   // incomplete read -> leave the prior grant intact (never shrink)
        try { await vaultRegisterGrant(passes[pi], ks, { exp: entry.exp }); okN++; } catch (er) {}
      }
      // Seed the per-work vault key cache so /access/redeem can mint a fresh per-LINK grant scoped to
      // each recruiter's works (decoupled from the shared quick-grant view grant, always current keys).
      try {
        var kmap = {};
        Object.keys(vaultBlockKeys).forEach(function (wid) { var arr = (vaultBlockKeys[wid] || []).filter(Boolean); if (arr.length) kmap[wid] = arr; });
        if (Object.keys(kmap).length) await fetch(ADMIN_WORKER + "/admin/vault/keycache", { method: "POST", headers: { Authorization: "Bearer " + adminSession(), "Content-Type": "application/json" }, body: JSON.stringify({ map: kmap }) });
      } catch (e) {}
      if (okN) status(okN + " pass" + (okN === 1 ? "" : "es") + " can now open its private-vault content.", true);
    } catch (e) { /* grants are best-effort; never block a publish */ }
  }
  function makeStub(sek, block) {
    return rkEncWithSek(sek, block).then(function (e) {
      var stub = { type: block.type, locked: true, encStub: true, iv: e.iv, ct: e.ct };
      if (block.kicker) stub.kicker = block.kicker;
      if (block.nav) stub.nav = block.nav;               // keep nav so the locked section still appears in the contents
      if (block.sep === false) stub.sep = false;
      return stub;
    });
  }
  // Destructive-action confirm — resolves true ONLY on a deliberate click of the
  // danger button. Escape / backdrop / Cancel all resolve false, and Cancel is
  // focused so a stray Enter never deletes anything. Matches the .pass modal style.
  function confirmModal(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var modal = document.createElement("div");
      modal.className = "pass pass--confirm";
      modal.innerHTML =
        '<div class="pass__box"><div class="pass__title">' + escHtml(opts.title || "Are you sure?") + "</div>" +
        (opts.sub ? '<div class="pass__sub">' + escHtml(opts.sub) + "</div>" : "") +
        '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>' + escHtml(opts.cancel || "Cancel") + "</button>" +
        '<button class="btn btn--danger" data-ok>' + escHtml(opts.cta || "Delete") + "</button></div></div>";
      document.body.appendChild(modal);
      var done = function (v) { modal.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
      var onKey = function (e) { if (e.key === "Escape") { e.preventDefault(); done(false); } };
      document.addEventListener("keydown", onKey);
      modal.addEventListener("click", function (e) { if (e.target === modal) done(false); });
      modal.querySelector("[data-cancel]").addEventListener("click", function () { done(false); });
      modal.querySelector("[data-ok]").addEventListener("click", function () { done(true); });
      var c = modal.querySelector("[data-cancel]"); if (c) c.focus();
    });
  }

  // Generic credential prompt — resolves to the plaintext value, or null if cancelled.
  function credModal(opts) {
    return new Promise(function (resolve) {
      var modal = document.createElement("div");
      modal.className = "pass";
      modal.innerHTML =
        '<div class="pass__box"><div class="pass__title">' + escHtml(opts.title) + '</div>' +
        '<div class="pass__sub">' + escHtml(opts.sub) + '</div>' +
        '<input type="password" placeholder="' + escAttr(opts.placeholder || "Passphrase") + '" autocomplete="off" />' +
        (opts.confirm ? '<input type="password" placeholder="Confirm" data-confirm autocomplete="off" />' : "") +
        '<div class="pass__err"></div>' +
        '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn--primary" data-go>' + escHtml(opts.cta || "Continue") + '</button></div></div>';
      document.body.appendChild(modal);
      var inp = modal.querySelector("input"), cf = modal.querySelector("[data-confirm]"), err = modal.querySelector(".pass__err");
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 30);
      var closed = false;
      function finish(v) { if (closed) return; closed = true; modal.remove(); resolve(v); }
      modal.querySelector("[data-cancel]").addEventListener("click", function () { finish(null); });
      modal.addEventListener("click", function (e) { if (e.target === modal) finish(null); });
      async function go() {
        var v = inp.value.trim();
        if (!v) { err.textContent = "Enter a value"; return; }
        if (opts.minLen && v.length < opts.minLen) { err.textContent = "Use at least " + opts.minLen + " characters"; return; }
        if (opts.confirm && cf && cf.value !== v) { err.textContent = "They don\u2019t match"; return; }
        if (opts.verifyHash) { var h = await sha256(rkNormPass(v)); if (h !== opts.verifyHash) { err.textContent = opts.mismatch || "That doesn\u2019t match."; return; } }
        finish(v);
      }
      modal.querySelector("[data-go]").addEventListener("click", go);
      modal.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); if (e.key === "Escape") finish(null); });
    });
  }
  var RECOVERY_HASH_KEY = "rk:recovery:hash";
  var recoveryPassCache = null;
  async function ensureRecoveryPass() {
    if (recoveryPassCache !== null) return recoveryPassCache;
    var have = localStorage.getItem(RECOVERY_HASH_KEY);
    var pass = await credModal(have
      ? { title: "Recovery passphrase", sub: "Enter your recovery passphrase to protect and re-open your NDA content.", cta: "Unlock", verifyHash: have, mismatch: "That\u2019s not your recovery passphrase." }
      : { title: "Set a recovery passphrase", sub: "Your master key for all NDA / protected content \u2014 it lets you always edit, even on a new device. Store it safely: it can\u2019t be reset without losing access to that content.", cta: "Set", confirm: true, minLen: 8 });
    if (pass === null) return null;
    if (!have) localStorage.setItem(RECOVERY_HASH_KEY, await sha256(rkNormPass(pass)));
    recoveryPassCache = pass;
    return pass;
  }
  async function ensureTicketCode(sv) {
    if (rkNormPass(ticketPlain[sv.id])) return ticketPlain[sv.id];
    var code = await credModal({ title: "Ticket code needed", sub: "Enter the code for \u201c" + (sv.name || "this ticket") + "\u201d so its holders can open the projects you assigned to it.", cta: "Use code", verifyHash: sv.ticketHash || "", mismatch: "That doesn\u2019t match this ticket." });
    if (code === null) return null;
    ticketPlain[sv.id] = code;
    return code;
  }
  // Ticket keyring: your recovery passphrase unlocks EVERY special-view ticket code at publish, so you
  // type each code once (ever) and never re-enter them per view. A recovery-encrypted {svId:code} blob
  // lives server-side (cross-device); the backend only ever sees ciphertext.
  async function encryptKeyring(recovery, map) {
    var sek = rkNewSek();
    return { v: 1, wrap: await rkWrapSek(recovery, sek), data: await rkEncWithSek(sek, map) };
  }
  async function decryptKeyring(recovery, blob) {
    var sek = await rkUnwrapSek(recovery, blob.wrap);
    return await rkDecWithSek(sek, blob.data);
  }
  async function loadTicketKeyring() {
    try {
      if (!(data.specialViews || []).some(function (sv) { return sv && sv.ticketHash; })) return;
      var needs = (data.work || []).some(function (w) { return w && (w.hidden || w.encWork || (w.study && Array.isArray(w.study.blocks) && w.study.blocks.some(function (b) { return b && b.locked; }))); });
      if (!needs) return;
      var rec = await ensureRecoveryPass();
      if (rec === null) return;
      var blob = await keyringGet();
      if (!blob || !blob.wrap || !blob.data) return;
      var map = await decryptKeyring(rec, blob);
      Object.keys(map || {}).forEach(function (id) { if (!rkNormPass(ticketPlain[id])) ticketPlain[id] = map[id]; });
    } catch (e) { /* best-effort — falls back to per-ticket prompts */ }
  }
  async function saveTicketKeyring() {
    try {
      if (recoveryPassCache === null) return;
      var map = {};
      (data.specialViews || []).forEach(function (sv) { if (sv && sv.id && rkNormPass(ticketPlain[sv.id])) map[sv.id] = ticketPlain[sv.id]; });
      if (!Object.keys(map).length) return;
      await keyringPut(await encryptKeyring(recoveryPassCache, map));
    } catch (e) { /* best-effort */ }
  }
  // Include a deeper-cut-pass unlock ONLY if the owner already has that pass on
  // hand this session (typed into the study editor's Deeper-cut pass field). Never
  // prompt at publish — tickets and the recovery passphrase already open protected
  // sections, so nagging for a legacy pass the owner may not have set is just noise.
  async function ensureStudyPass(w, st) {
    return rkNormPass(studyUnlockPlain[w.id]) ? studyUnlockPlain[w.id] : "";
  }

  // Publish step-up factors (a fresh passkey token + the recovery proof), gathered at the start of a
  // publish and attached to every repo write via ghHeaders; null when the step-up is off.
  var publishStepup = null;
  function ghHeaders(token) {
    const sess = adminSession();
    const h = {
      Authorization: sess ? ("Bearer " + sess) : ("Bearer " + token),
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (publishStepup && publishStepup.token) h["X-Publish-Token"] = publishStepup.token;
    if (publishStepup && publishStepup.proof) h["X-Publish-Proof"] = publishStepup.proof;
    var _dt = deviceTrust(); if (_dt) h["X-Device-Trust"] = _dt;
    return h;
  }
  // With an admin session, GitHub calls go through the Worker (which holds the real token,
  // scoped to this one repo); otherwise they hit the GitHub API directly with the saved token.
  function ghApiRoot() { return adminSession() ? (ADMIN_WORKER + "/admin/gh") : "https://api.github.com"; }
  function ghContentsUrl(repoPath) { return ghApiRoot() + "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + repoPath; }
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
  var mediaSizeCache = {};
  function fmtBytes(n) {
    if (n == null || n < 0) return "";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  function b64ByteLen(uri) {
    var comma = (uri || "").indexOf(","); if (comma < 0) return 0;
    var meta = uri.slice(0, comma), s = uri.slice(comma + 1);
    if (/;base64/i.test(meta)) { var pad = (s.match(/=+$/) || [""])[0].length; return Math.max(0, Math.floor(s.length * 3 / 4) - pad); }
    return s.length;
  }
  function mediaSizeSync(v) {
    if (!v || typeof v !== "string") return null;
    if (/^data:/i.test(v)) return b64ByteLen(v);
    if (hostedBytes[v]) return b64ByteLen(hostedBytes[v]);
    if (v in mediaSizeCache) return mediaSizeCache[v];
    return null;
  }
  // A small file-size badge for a media value. Hosted files resolve their byte size lazily
  // (a HEAD request) after render via resolveMediaSizes, so the owner can see what's heavy.
  function mediaSizeTag(v) {
    if (!v || typeof v !== "string") return "";
    var isData = /^data:/i.test(v);
    if (!isData && v.indexOf(UPLOAD_DIR) === -1) return "";
    var s = mediaSizeSync(v);
    var big = s != null && s >= 4 * 1048576;
    var attr = (s == null && !isData) ? ' data-msize="' + escAttr(v) + '" data-msize-pending="1"' : "";
    return '<span class="af__msize' + (big ? " af__msize--big" : "") + '"' + attr + ' title="File size on your published site">' + (s == null ? "\u2026" : fmtBytes(s)) + "</span>";
  }
  function resolveMediaSizes(scope) {
    var els = [].slice.call((scope || document).querySelectorAll(".af__msize[data-msize-pending]"));
    els.forEach(function (el) {
      var v = el.getAttribute("data-msize"); el.removeAttribute("data-msize-pending");
      if (!v || !isHostedPath(v)) { el.textContent = ""; return; }
      fetch(v, { method: "HEAD", cache: "force-cache" }).then(function (r) {
        var len = (r && r.ok) ? +(r.headers.get("content-length") || 0) : 0;
        if (len > 0) { mediaSizeCache[v] = len; el.textContent = fmtBytes(len); if (len >= 4 * 1048576) el.classList.add("af__msize--big"); }
        else { el.textContent = ""; }
      }).catch(function () { el.textContent = ""; });
    });
  }

  function previewSrc(v) {
    if (!isHostedPath(v)) return v;
    if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(v)) return hostedVideoSrc(v);
    // Images preview from the in-memory data URI (instant) or the raw GitHub URL; documents go
    // through an external viewer (Office/Google) that must fetch a PUBLIC URL.
    if (/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(v)) return hostedBytes[v] || rawUrlFor(v);
    return rawUrlFor(v);
  }
  // A hosted video is unreliable as a live <video src> from a data URI (huge) or from
  // raw.githubusercontent.com (flaky range requests → black/stuck). Serve it from a stable
  // blob instead: built from the in-memory bytes this session, or fetched once after a reload.
  var vidBlobByPath = new Map(), vidFetching = {};
  function hostedVideoSrc(path) {
    var hit = vidBlobByPath.get(path);
    if (hit) return hit;
    var du = hostedBytes[path];
    if (du && du.indexOf("data:") === 0) { var b = vcVideoBlobUrl(du); vidBlobByPath.set(path, b); return b; }
    if (!vidFetching[path]) {
      vidFetching[path] = 1;
      fetch(rawUrlFor(path)).then(function (r) { return r.ok ? r.blob() : null; }).then(function (bl) {
        if (bl) { vidBlobByPath.set(path, URL.createObjectURL(bl)); refreshL2Preview(); }
      }).catch(function () {});
    }
    return rawUrlFor(path); // until the blob is ready; a refresh then swaps it in
  }
  // A big embedded video (data:video/...) is unreliable as a live <video src> in the churny
  // preview (huge string re-parsed on every refresh) and can't save to the draft. For the
  // preview only, hand the iframe a stable blob URL built from the bytes — plays at any size.
  var vcPreviewBlobs = new Map();
  function vcVideoBlobUrl(uri) {
    var hit = vcPreviewBlobs.get(uri); if (hit) return hit;
    try {
      var comma = uri.indexOf(","); if (comma < 0) return uri;
      var meta = uri.slice(5, comma), mime = (meta.split(";")[0]) || "video/mp4";
      var dataPart = uri.slice(comma + 1), bytes;
      if (/;base64/i.test(meta)) { var bin = atob(dataPart); bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }
      else bytes = new TextEncoder().encode(decodeURIComponent(dataPart));
      var url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      if (vcPreviewBlobs.size > 12) { var oldK = vcPreviewBlobs.keys().next().value; try { URL.revokeObjectURL(vcPreviewBlobs.get(oldK)); } catch (e) {} vcPreviewBlobs.delete(oldK); }
      vcPreviewBlobs.set(uri, url);
      return url;
    } catch (e) { return uri; }
  }
  function resolvePreviewData(d) {
    const c = clone(d);
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      for (const k in o) {
        const v = o[k];
        if (typeof v === "string") {
          // A video is swapped for a blob: URL in preview, which drops the ".mp4" extension — so
          // the renderer's extension-based detection falls back to <img> (broken-image icon, and a
          // 0-height collapse in "Fit the media"). Pin kind:"video" on the media item's src/image
          // field so it still renders as a <video>. Preview-only (this is a clone).
          var isVid = /^data:video\//i.test(v) || (isHostedPath(v) && /\.(mp4|webm|mov|m4v|ogv)($|\?|#)/i.test(v));
          if (/^data:video\//i.test(v)) o[k] = vcVideoBlobUrl(v);
          else if (isHostedPath(v)) o[k] = previewSrc(v);
          if (isVid && (k === "src" || k === "image")) o.kind = "video";
        }
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
    let put;
    try { put = await fetch(ghContentsUrl(repoPath), { method: "PUT", headers: ghHeaders(token), body: JSON.stringify({ message: "Add " + name + " via admin", content: rawB64, branch: GH_BRANCH }) }); }
    catch (netErr) { const e = new Error("network"); e.network = 1; throw e; }
    if (put.status === 422) return webPath; // identical file already hosted → reuse
    if (put.status === 401 || put.status === 403) { const e = new Error("auth"); e.auth = 1; throw e; }
    if (!put.ok) {
      const j = await put.json().catch(function () { return {}; });
      const msg = (j && j.message) || ("HTTP " + put.status);
      const e = new Error(msg); e.http = put.status;
      if (put.status === 413 || /too large|too big|exceed/i.test(msg)) e.tooLarge = 1;
      throw e;
    }
    return webPath;
  }
  /* ---------- publish progress bar + live-site confirmation ---------- */
  let pubCreep = null;
  function pubEl() { return root && root.querySelector(".adm__pub"); }
  function pubProgress(pct, label, opts) {
    opts = opts || {};
    const el = pubEl();
    // The publish bar (row 3) is the single home for progress/status while publishing — don't
    // also mirror the message into the top .adm__status (that was the duplicated text on screen).
    if (!el) { status(label, !!opts.done); return; }
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
      // Confirm the ACTUAL Pages deploy (riteshk.work), not just raw.githubusercontent: raw updates
      // within seconds of the commit, but Pages takes ~1 min to rebuild — matching raw would call it
      // "live" too early and a hard-refresh right after would still show the old page. On the Pages
      // origin, poll only it (same-origin, no CORS); cross-origin, keep raw as a fallback.
      const sameOrigin = (location.origin === LIVE_ORIGIN);
      const urls = sameOrigin
        ? [LIVE_ORIGIN + "/content.json?t=" + Date.now()]
        : [LIVE_ORIGIN + "/content.json?t=" + Date.now(), GH_RAW + "content.json?t=" + Date.now()];
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

  // Replace every still-embedded data: asset in `data` with a hosted path (used at publish).
  // Non-auth failures are COLLECTED (never silently swallowed): an asset that can't be hosted
  // would otherwise stay inline and bloat content.json past GitHub's blob limit ("input too
  // large to process"). ghPublish inspects the returned failures and stops with a precise,
  // fixable message instead of committing a doomed request.
  async function hostEmbeddedImages(token, onProg) {
    const targets = [];
    // Skip media inside Locked blocks / Hidden projects: it must stay inline so it
    // encrypts with that block/work instead of becoming a public /assets file.
    (function walk(o, prot, ctx) {
      if (!o || typeof o !== "object") return;
      const p = prot || o.hidden === true || o.locked === true;
      const here = (o && (o.title || o.name)) ? String(o.title || o.name) : ctx;
      for (const k in o) {
        const v = o[k];
        if (typeof v === "string") { if (!p && /^data:(image|video|application)\//i.test(v)) targets.push({ o: o, k: k, ctx: here }); }
        else if (v && typeof v === "object") walk(v, p, here);
      }
    })(data, false, "");
    const total = targets.length;
    let done = 0; const failed = [];
    if (onProg && total) onProg(0, total);
    for (const t of targets) {
      const uri = t.o[t.k];
      try { t.o[t.k] = await hostDataUri(uri, token); }
      catch (e) {
        if (e && e.auth) throw e;
        const mm = /^data:([^;,]+)/i.exec(uri); const mime = (mm && mm[1]) || "";
        const kind = /^video\//i.test(mime) ? "video" : /^image\//i.test(mime) ? "image" : "file";
        const bytes = Math.round((String(uri).length * 3) / 4);
        failed.push({ kind: kind, mb: Math.max(1, Math.round(bytes / 1048576)), where: t.ctx || "", tooLarge: !!(e && e.tooLarge), network: !!(e && e.network), msg: (e && e.message) || "" });
        /* leave embedded for now; ghPublish decides whether it's safe or must stop */
      }
      done++;
      if (onProg && total) onProg(done, total);
    }
    return { hosted: done - failed.length, failed: failed };
  }

  // Commit content.json via the Git Data API (blob -> tree -> commit -> ref).
  // Robust for any size: the Contents API PUT can return HTTP 500 on some content; this path does not.
  async function ghCommitViaGitData(token, json, message) {
    const repo = ghApiRoot() + "/repos/" + GH_OWNER + "/" + GH_REPO;
    const api = async (url, opts) => {
      const res = await fetch(url, Object.assign({ headers: ghHeaders(token), cache: "no-store" }, opts || {}));
      let body = null; try { body = await res.json(); } catch (e) { body = null; }
      if (res.status === 401 || res.status === 403) { const er = new Error("auth"); er.auth = true; throw er; }
      if (!res.ok) { const er = new Error((body && body.message) || ("HTTP " + res.status)); er.http = res.status; if (res.status === 413 || /too large|too big|exceed/i.test(String(er.message))) er.tooLarge = true; throw er; }
      return body;
    };
    const ref = await api(repo + "/git/ref/heads/" + GH_BRANCH);
    const headSha = ref.object.sha;
    const headCommit = await api(repo + "/git/commits/" + headSha);
    const blob = await api(repo + "/git/blobs", { method: "POST", body: JSON.stringify({ content: b64(json), encoding: "base64" }) });
    const tree = await api(repo + "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: [{ path: "content.json", mode: "100644", type: "blob", sha: blob.sha }] }) });
    const commit = await api(repo + "/git/commits", { method: "POST", body: JSON.stringify({ message: message, tree: tree.sha, parents: [headSha] }) });
    await api(repo + "/git/refs/heads/" + GH_BRANCH, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
    return commit.sha;
  }

  function jsonByteLen(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return (s || "").length; } }
  // Turn GitHub's cryptic "input too large to process" into an actionable message that names
  // the offending media so the owner can compress it or host it externally.
  function mediaTooLargeMsg(fails, jsonBytes) {
    var items = (fails || []).filter(Boolean).slice().sort(function (a, b) { return (b.mb || 0) - (a.mb || 0); }).slice(0, 3).map(function (f) {
      return "a " + (f.mb || 1) + " MB " + (f.kind || "file") + (f.where ? " in \u201c" + f.where + "\u201d" : "");
    });
    if (items.length) {
      var many = items.length > 1;
      return "Can\u2019t publish \u2014 " + items.join(", ") + (many ? " are" : " is") + " too large for GitHub to store from the browser. Replace " + (many ? "them" : "it") + " with a smaller / compressed version (the built-in video compressor helps) or host it on Vimeo/YouTube/Stream and paste the link, then Publish.";
    }
    var mb = Math.max(1, Math.round((jsonBytes || 0) / 1048576));
    return "Can\u2019t publish \u2014 your content is " + mb + " MB, too large for GitHub to store from the browser. It\u2019s usually one very large image or a locked section with big media \u2014 compress the largest media or host it externally, then Publish.";
  }

  // Count hosted (already-public) images that sit inside a Hidden project or Locked block.
  // At publish these get pulled inline + encrypted (inlineProtectedImages); a lot of them
  // is what blows content.json past GitHub's size limit.
  function protectedHostedCount(d) {
    var n = 0;
    (function walk(o, prot) {
      if (!o || typeof o !== "object") return;
      var p = prot || o.hidden === true || o.locked === true;
      for (var k in o) {
        var v = o[k];
        if (typeof v === "string") { if (p && v.indexOf("assets/uploads/") !== -1 && v.slice(0, 5).toLowerCase() !== "data:") n++; }
        else if (v && typeof v === "object") walk(v, p);
      }
    })({ work: (d && d.work) || [] }, false);
    return n;
  }

  async function ghPublish(token) {
    if (publishing) return;
    publishing = true;
    var viaSession = (token === "session");
    // Device-trust: an unverified device (e.g. you just signed in with your phone) must verify + set up
    // a passkey before it can publish. Trusted devices publish straight through.
    if (viaSession && !deviceTrusted()) {
      const _ok = await deviceStepUpModal({ sub: "To publish from this device, first verify it\u2019s you \u2014 recovery passphrase + admin password." });
      if (!_ok) { publishing = false; status("Publish cancelled \u2014 verify to publish from this device."); return; }
      if (confirm("Add a passkey to this device before publishing?\n\nRecommended \u2014 then this device is set up and won\u2019t ask again here.")) {
        try { await webauthnRegister(); status("Passkey added to this device.", true); }
        catch (e) { status((e && e.message) || "Couldn\u2019t add a passkey \u2014 continuing.", false); }
      }
    }
    pubProgress(6, "Preparing your content\u2026");
    try {
      // Publish step-up: when enabled, gather BOTH factors up front (fresh passkey assertion + recovery
      // proof) so every repo write — image uploads included — carries them. A stolen session alone fails.
      publishStepup = null;
      if (viaSession) {
        var _pst = await publishStatus().catch(function () { return { enabled: false }; });
        if (_pst && _pst.enabled) {
          var _rec = await ensureRecoveryPass();
          if (_rec === null) { pubStopCreep(); pubProgress(100, "Publish needs your recovery passphrase.", { error: true }); return; }
          var _proof = await publishProof(_rec), _tok;
          try { pubProgress(7, "Confirm it\u2019s you \u2014 tap your passkey\u2026"); _tok = (await webauthnAuth("publish")).publishToken; }
          catch (e) { pubStopCreep(); pubProgress(100, (e && e.message) || "Passkey step-up was cancelled.", { error: true }); return; }
          publishStepup = { token: _tok, proof: _proof };
        }
      }
      const hostRes = await hostEmbeddedImages(token, function (n, total) {
        pubProgress(6 + Math.round((n / Math.max(1, total)) * 40), "Uploading images at full quality \u2014 " + n + " of " + total + "\u2026");
      });
      pubProgress(50, "Saving your content to GitHub\u2026");
      const json = await buildPublishJson(token);
      const jsonBytes = jsonByteLen(json);
      const fails = (hostRes && hostRes.failed) || [];
      const tooLargeFails = fails.filter(function (f) { return f.tooLarge; });
      // An embedded asset that couldn't be hosted stays inline and bloats content.json past
      // GitHub's blob limit. Stop here with a precise, fixable message rather than committing a
      // doomed request (and wasting a long upload). Let GitHub be the authority otherwise.
      if (tooLargeFails.length || jsonBytes > PUBLISH_HARD_CAP) {
        pubStopCreep();
        const protN = protectedHostedCount(data);
        if (!tooLargeFails.length && fails.length && fails.every(function (f) { return f.network; })) {
          pubProgress(100, "Couldn\u2019t reach " + (viaSession ? "the publishing service" : "GitHub (api.github.com)") + " to upload your media \u2014 a VPN, ad-blocker or firewall may be blocking it. Check your connection, then hit Publish again.", { error: true });
        } else if (!tooLargeFails.length && protN >= 5 && jsonBytes > PUBLISH_HARD_CAP) {
          pubProgress(100, "Can\u2019t publish \u2014 hiding or locking a project bundles all of its images into the file so they can be encrypted (here that\u2019s ~" + protN + " images \u2192 " + Math.round(jsonBytes / 1048576) + " MB), which is too large for GitHub. Keep the project visible (it can still be Featured on the homepage), or use far fewer / smaller images inside the hidden or locked section.", { error: true });
        } else {
          pubProgress(100, mediaTooLargeMsg(tooLargeFails.length ? tooLargeFails : fails, jsonBytes), { error: true });
        }
        return;
      }
      const mySig = (window.RK && window.RK.sig) ? window.RK.sig(JSON.stringify(JSON.parse(json))) : null;
      try {
        await ghCommitViaGitData(token, json, "Update content.json via admin");
      } catch (e1) {
        if (e1 && e1.tooLarge) { pubStopCreep(); pubProgress(100, mediaTooLargeMsg(fails, jsonBytes), { error: true }); return; }
        else if (e1 && (e1.http === 409 || e1.http === 422)) await ghCommitViaGitData(token, json, "Update content.json via admin"); // ref/tree conflict: refresh + retry once
        else throw e1;
      }
      // Committed. This data is now the published content — clear the draft so it can't go stale.
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(DRAFT_SIG_KEY);
      if (viaSession) localStorage.removeItem(GH_TOKEN_KEY); // published via the Worker session — the repo token no longer needs to live in this browser
      if (window.RK) { window.RK.published = clone(data); if (window.RK.sig) window.RK.publishedSig = window.RK.sig(JSON.stringify(data)); }
      updateDirtyUI();
      histReset();
      pubProgress(64, "Saved to GitHub. Building your live site\u2026");
      const live = await waitForLive(mySig);
      pubStopCreep();
      const viewUrl = LIVE_ORIGIN + "/?t=" + Date.now();
      if (live) pubProgress(100, "Your site is live and ready to view.", { done: true, viewUrl: viewUrl });
      else pubProgress(100, "Published. It can take another minute to appear \u2014 open your site to check.", { done: true, viewUrl: viewUrl });
    } catch (e) {
      pubStopCreep();
      // A ticket code typed this session must survive a failed publish so the next attempt doesn't
      // re-ask for it — persist the recovery keyring best-effort before surfacing the error.
      try { await saveTicketKeyring(); } catch (_) {}
      if (e && e.rkEnc) {
        pubProgress(100, e.mixed
          ? "Unlock this project\u2019s protected sections (enter its pass) before publishing."
          : "Publish paused \u2014 a passphrase for a protected project wasn\u2019t provided.", { error: true });
        return;
      }
      if (e && e.auth) {
        if (viaSession) { clearAdminSession(); pubProgress(100, "Your admin session ended \u2014 exit the studio and sign in again to publish.", { error: true }); }
        else { authFailed(); pubProgress(100, "GitHub didn\u2019t accept that sign-in \u2014 hit Publish to reconnect.", { error: true }); }
        return;
      }
      var emsg = (e && e.message) ? String(e.message).slice(0, 160) : "";
      if (e && e.http) {
        pubProgress(100, "GitHub couldn\u2019t save it \u2014 " + emsg + ". Hit Publish to retry.", { error: true });
      } else if (!emsg || /Failed to fetch|NetworkError|load failed|ERR_|network/i.test(emsg)) {
        var _svc = viaSession ? "the publishing service" : "GitHub (api.github.com)";
        var _msg = "Couldn\u2019t reach " + _svc + " \u2014 a VPN, ad-blocker or firewall may be blocking it. Check your connection, then hit Publish again.";
        if (protectedHostedCount(data)) _msg += " If it keeps failing, a large image or video in a locked / vaulted section may be timing out \u2014 compress it or host it externally.";
        pubProgress(100, _msg, { error: true });
      } else {
        pubProgress(100, "Publish hit a snag: " + emsg + " \u2014 hit Publish to retry.", { error: true });
      }
    } finally { publishing = false; publishStepup = null; }
  }

  // GitHub rejected the saved token: drop it so the next Publish re-prompts sign-in.
  function authFailed() {
    localStorage.removeItem(GH_TOKEN_KEY);
    status("GitHub didn\u2019t accept that sign-in. Hit Publish again to reconnect.");
  }

  // Owner-only, LOCAL-ONLY safety net: save the full current content (including any sections
  // you've unlocked for editing) to a file on THIS device. Purely a client-side Blob download —
  // no network, no upload, no clipboard — and it never touches the encryption/publish/grant code.
  // The file holds plaintext locked-section content, so it's sensitive; it does NOT contain your
  // admin key, recovery passphrase or session token (those are never part of the content model).
  function downloadContentBackup() {
    try {
      var json = JSON.stringify(data, null, 2);
      var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      var blob = new Blob([json], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "riteshk-content-backup-" + stamp + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 4000);
      status("Backup saved to this device \u2014 it holds your unlocked content in plain text, so keep it private (don\u2019t commit or share it).", true);
    } catch (e) { status("Couldn\u2019t create the backup."); }
  }

  async function publishManual() {
    let json;
    try { json = await buildPublishJson(); }
    catch (e) { status(e && e.rkEnc ? (e.mixed ? "Unlock the protected sections first, then publish." : "Publish paused \u2014 a protected project\u2019s passphrase wasn\u2019t provided.") : "Couldn\u2019t prepare content to publish."); return; }
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

  function publishModal(msg, opts) {
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
    settingsMount(modal, opts);
    const inp = modal.querySelector("input"), err = modal.querySelector(".pass__err");
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 30);
    const done = () => { if (opts && opts.onClose) opts.onClose(); else modal.remove(); };
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
    // Called only from the "\u2715" leave flyout's explicit red "Discard changes" option,
    // which is itself the confirmation. Drop the draft and go to the published site.
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(DRAFT_SIG_KEY);
    location.href = "/";
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
  function pickMedia(cb, opts) {
    opts = opts || {};
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = MEDIA_ACCEPT;
    inp.onchange = function () {
      const f = inp.files && inp.files[0]; if (!f) return;
      prepareUpload(f).then(function (f0) {
        if (!f0) return;
        maybeTagVideo(f0).then(function (file) {
          if (file !== f0) status("Tagged \u201c" + (f0.name || "video") + "\u201d as BT.709 \u2014 true-to-life colour on OLED & wide-gamut screens.");
          fileToDataUri(file).then(function (uri) { cb(uri); if (opts.vault) vaultHost(uri, file, cb); else hostUploaded(uri, file, cb); });
        });
      });
    };
    inp.click();
  }
  // Pick several images/videos at once — create the items in order up front, then fill each in
  // as its bytes are read, and host them (swapping the embedded data URI for a lean path).
  function pickMediaMulti(makeItem, done, opts) {
    opts = opts || {};
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = MEDIA_ACCEPT; inp.multiple = true;
    inp.onchange = function () {
      const files = [].slice.call(inp.files || []);
      (function next(idx) {
        if (idx >= files.length) return;
        prepareUpload(files[idx]).then(function (f0) {
          if (f0) {
            const it = makeItem();
            if (done) done();
            maybeTagVideo(f0).then(function (file) {
              fileToDataUri(file).then(function (uri) {
                it.src = uri; if (isVideoVal(uri)) it.controls = true; if (done) done();
                var swap = function (path) { it.src = path; if (isVideoVal(path)) it.controls = true; if (done) done(); };
                if (opts.vault) vaultHost(uri, file, swap); else hostUploaded(uri, file, swap);
              });
            });
          }
          next(idx + 1);
        });
      })(0);
    };
    inp.click();
  }
  // Host the freshly-read file and, on success, swap the embedded data URI for its lean path.
  function hostUploaded(uri, file, cb) {
    const nm = (file && file.name) || "File";
    const ext = extFromName(nm);
    const isImg = /^data:image\//i.test(uri);
    const finish = function (low, note) {
      const token = adminSession() ? "session" : localStorage.getItem(GH_TOKEN_KEY);
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

  // Store gated (Locked-block) media straight in the private R2 vault instead of the public
  // repo, swapping the reference for a compact "vault:<key>" token. Needs an owner session;
  // on any failure the item keeps its embedded data URI, which Publish then protects as an
  // .enc file (safety net), so gated media is never left plaintext-public.
  function vaultHost(uri, file, cb) {
    const nm = (file && file.name) || "File";
    const ext = extFromName(nm) || (/^data:video\//i.test(uri) ? "mp4" : /^data:image\//i.test(uri) ? "png" : "");
    if (!adminSession()) { status("\u201c" + nm + "\u201d added \u2014 embedded for now; sign in to store it privately in the vault."); return; }
    status("Storing \u201c" + nm + "\u201d privately in your vault\u2026");
    vaultUpload(file, ext).then(function (key) {
      cb("vault:" + key);
      status("\u201c" + nm + "\u201d stored privately \u2014 only you (and people you grant a pass) can view it.", true);
    }).catch(function (e) {
      if (e && e.auth) status("Your session ended \u2014 \u201c" + nm + "\u201d stays embedded; sign in and re-add to store it privately.");
      else status("Couldn\u2019t reach the vault \u2014 \u201c" + nm + "\u201d stays embedded and will be protected on Publish.");
    });
  }

  // ---- migrate a project's Locked-section media into the private vault ----
  // Scans Locked blocks for images/videos still hosted as public /assets/uploads files or inline
  // data: URIs (i.e. sections that are unlocked for editing) and returns them as move targets;
  // still-encrypted (🔒 Protected) blocks are counted so we can tell the owner to unlock first.
  var VAULT_MEDIA_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg|mp4|webm|mov|m4v|ogv)($|\?|#)/i;
  // A public/embedded image or video that isn't already a vault ref — eligible to move into the vault.
  function isVaultMigratable(v) {
    return typeof v === "string" && !/^vault:/i.test(v) &&
      (/^data:(image|video)\//i.test(v) || (isBareUploadPath(v) && VAULT_MEDIA_EXT_RE.test(v)));
  }
  // Pick a file extension for the vault key so the viewer renders <img> vs <video> correctly.
  function vaultMediaExt(src, blob) {
    var e = extFromName(src); if (e) return e;
    var mt = String((blob && blob.type) || "").toLowerCase();
    var map = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/bmp": "bmp", "image/svg+xml": "svg", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-m4v": "m4v", "video/ogg": "ogv" };
    if (map[mt]) return map[mt];
    if (mt.indexOf("/") >= 0) return mt.split("/")[1].replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
    return /^data:image\//i.test(src) ? "png" : "mp4";
  }
  function lockedMediaTargets(w) {
    var out = [], encryptedLeft = 0, sections = 0;
    var blocks = (w && w.study && w.study.blocks) || [];
    blocks.forEach(function (b) {
      if (!b) return;
      if (b.encStub) { encryptedLeft++; return; }
      if (!b.locked) return;
      sections++;   // a plaintext locked section that can be moved wholesale into the vault
      (function scan(o) {
        if (!o || typeof o !== "object") return;
        for (var k in o) {
          var v = o[k];
          if (typeof v === "string") {
            if (isVaultMigratable(v)) out.push({ o: o, k: k, src: v });
          } else if (v && typeof v === "object") scan(v);
        }
      })(b);
    });
    return { targets: out, encryptedLeft: encryptedLeft, sections: sections };
  }
  function vaultMigrateProject(i) {
    var w = data.work[i]; if (!w) return;
    if (!adminSession()) { status("Sign in first \u2014 moving content to the vault needs your session."); return; }
    var info = lockedMediaTargets(w), targets = info.targets;
    if (!targets.length && !info.sections) {
      status(info.encryptedLeft ? "Nothing to move yet \u2014 click \u201cUnlock to edit\u201d on the \uD83D\uDD12 Protected sections first, then run this again." : "No Locked sections to move in this project.");
      return;
    }
    // Flag every plaintext locked section to be stored wholesale in the vault at Publish (content.json
    // then ships only a pointer). Media inside is uploaded first so the stored section holds vault: refs.
    function markSections() {
      var n = 0, blocks = (w.study && w.study.blocks) || [];
      blocks.forEach(function (b) { if (b && b.locked && !b.encStub && !b.vault) { b.vault = true; n++; } });
      return n;
    }
    if (!targets.length) {
      var n0 = markSections();
      saveDraft(true); renderBody();
      status(n0 + " Locked section" + (n0 === 1 ? "" : "s") + " will move to your private vault on Publish.", true);
      return;
    }
    status("Moving " + targets.length + " media file" + (targets.length > 1 ? "s" : "") + " to your private vault\u2026");
    var done = 0;
    (function next(idx) {
      if (idx >= targets.length) {
        var n1 = markSections();
        saveDraft(true); renderBody();
        status(done + " media file" + (done === 1 ? "" : "s") + " + " + n1 + " section" + (n1 === 1 ? "" : "s") + " set to move to your private vault. Publish, then the public copies can be removed.", true);
        return;
      }
      var t = targets[idx];
      var url = /^data:/i.test(t.src) ? t.src : (t.src.charAt(0) === "/" ? t.src : "/" + t.src);
      fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
        .then(function (blob) {
          return vaultUpload(blob, vaultMediaExt(t.src, blob)).then(function (key) { t.o[t.k] = "vault:" + key; done++; });
        })
        .then(function () { next(idx + 1); })
        .catch(function (e) {
          if (e && e.auth) { clearAdminSession(); saveDraft(true); renderBody(); status("Your session ended \u2014 " + done + " moved. Sign in again and retry."); return; }
          next(idx + 1);
        });
    })(0);
  }

  /* ===================== In-app video compressor (WebCodecs) =====================
     Big UX-demo reels (100MB+) can't be embedded (localStorage/45MB cap) and don't
     belong in the repo at full size. This transcodes them in the browser with the
     native, hardware-accelerated H.264 encoder — no ffmpeg.wasm, no SharedArrayBuffer
     and no COOP/COEP header hacks (which would break the site's iframe embeds).
     Admin-only, so WebCodecs (Edge/Chrome) is a safe requirement; anything else falls
     back to the "host it & paste a link" message. Video only for now (audio dropped). */
  var VC = {
    mp4box: "https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js",
    muxer: "https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.min.js",
    libs: null, caps: undefined
  };
  function vcLoadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src;
      s.onload = function () { res(1); };
      s.onerror = function () { rej(new Error("Couldn\u2019t load a compression library (offline?).")); };
      document.head.appendChild(s);
    });
  }
  function vcLoadLibs() {
    if (VC.libs) return Promise.resolve(VC.libs);
    return vcLoadScript(VC.mp4box).then(function () { return vcLoadScript(VC.muxer); }).then(function () {
      if (!window.MP4Box || !window.DataStream || !window.Mp4Muxer) throw new Error("Compression libraries didn\u2019t initialise.");
      VC.libs = { MP4Box: window.MP4Box, DataStream: window.DataStream, Mp4Muxer: window.Mp4Muxer };
      return VC.libs;
    });
  }
  // Cached: the first supported H.264 profile string, or null if WebCodecs can't encode here.
  function vcSupported() {
    if (VC.caps !== undefined) return Promise.resolve(VC.caps);
    if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined" || typeof VideoFrame === "undefined" || typeof OffscreenCanvas === "undefined") { VC.caps = null; return Promise.resolve(null); }
    var profiles = ["avc1.640028", "avc1.4d0028", "avc1.42001f"], i = 0;
    function tryNext() {
      if (i >= profiles.length) { VC.caps = null; return null; }
      var codec = profiles[i++];
      return VideoEncoder.isConfigSupported({ codec: codec, width: 1280, height: 720, bitrate: 3000000, framerate: 30 }).then(function (s) {
        if (s && s.supported) { VC.caps = codec; return codec; }
        return tryNext();
      }).catch(function () { return tryNext(); });
    }
    return Promise.resolve(tryNext());
  }
  function vcIsCompressible(file) {
    if (!file) return false;
    var nm = (file.name || "").toLowerCase();
    return file.type === "video/mp4" || file.type === "video/quicktime" || /\.(mp4|m4v|mov)$/.test(nm);
  }
  function vcEven(n) { n = Math.round(n); return n % 2 ? n - 1 : n; }
  // Cap the SHORTER side, so "1080p" means 1080 lines tall for landscape (1920x1080 stays full)
  // and 1080 wide for portrait — the conventional meaning. Capping the long side instead made
  // "720p" a blurry 720x405 that destroyed fine screen-recording text.
  function vcScaleDims(w, h, cap) {
    var shorter = Math.min(w, h);
    if (!cap || shorter <= cap) return { w: vcEven(w), h: vcEven(h) };
    var scale = cap / shorter;
    return { w: vcEven(w * scale), h: vcEven(h * scale) };
  }
  // Screen recordings (sharp text/edges) need a lot more bitrate than video; the old 0.18 bpp
  // ceiling looked terrible even at max. Range ~0.06–0.30 bpp.
  function vcBitrate(w, h, fps, q) { var bpp = 0.06 + 0.24 * Math.max(0, Math.min(1, q)); return Math.max(150000, Math.round(w * h * fps * bpp)); }
  function vcFmtBytes(n) { if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(0) + " KB"; return (n / 1048576).toFixed(1) + " MB"; }
  function vcSleep(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
  // Demux an mp4/mov ArrayBuffer -> { track, samples[], description(avcC), durationSec, fps }
  // Build a minimal AAC-LC AudioSpecificConfig from sample rate + channels (screen recordings
  // are AAC-LC), so the copied audio track carries a valid decoder config in the output.
  function vcAacASC(sr, ch) {
    var rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    var idx = rates.indexOf(sr); if (idx < 0) idx = 4;
    return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | ((ch || 2) << 3)]);
  }
  function vcDemux(buf, libs) {
    return new Promise(function (resolve, reject) {
      var file = libs.MP4Box.createFile();
      var vs = [], as = [], vt = null, at = null, description = null, vTotal = 0, aTotal = 0, gotV = false, gotA = false;
      file.onError = function (e) { reject(new Error("This video couldn\u2019t be read (" + e + ").")); };
      file.onReady = function (info) {
        vt = info.videoTracks && info.videoTracks[0];
        if (!vt) { reject(new Error("No video track found in this file.")); return; }
        vTotal = vt.nb_samples;
        try {
          var entries = file.getTrackById(vt.id).mdia.minf.stbl.stsd.entries;
          for (var e = 0; e < entries.length; e++) {
            if (entries[e].avcC) { var ds = new libs.DataStream(undefined, 0, libs.DataStream.BIG_ENDIAN); entries[e].avcC.write(ds); description = new Uint8Array(ds.buffer, 8); break; }
          }
        } catch (err) {}
        if (!description) { reject(new Error("Only H.264 .mp4/.mov videos can be compressed here. Export to H.264, or host this file and paste a link.")); return; }
        at = info.audioTracks && info.audioTracks[0];
        if (at && !/^mp4a/.test(at.codec || "")) at = null; // only AAC can be copied through as-is
        aTotal = at ? at.nb_samples : 0;
        file.setExtractionOptions(vt.id, null, { nbSamples: Infinity });
        if (at) file.setExtractionOptions(at.id, null, { nbSamples: Infinity });
        file.start();
      };
      file.onSamples = function (id, user, s) {
        if (vt && id === vt.id) {
          for (var k = 0; k < s.length; k++) { var x = s[k]; vs.push({ type: x.is_sync ? "key" : "delta", timestamp: x.cts * 1e6 / vt.timescale, duration: x.duration * 1e6 / vt.timescale, data: x.data.slice(0) }); }
          gotV = vs.length >= vTotal;
        } else if (at && id === at.id) {
          for (var m = 0; m < s.length; m++) { var y = s[m]; as.push({ timestamp: y.cts * 1e6 / at.timescale, duration: y.duration * 1e6 / at.timescale, data: y.data.slice(0) }); }
          gotA = as.length >= aTotal;
        }
        if (gotV && (!at || gotA)) {
          var durationSec = (vt.duration / vt.timescale) || (vs.length ? (vs[vs.length - 1].timestamp + vs[vs.length - 1].duration) / 1e6 : 0);
          var fps = durationSec ? Math.min(60, Math.max(1, Math.round(vs.length / durationSec))) : 30;
          var audio = at ? { samples: as, sampleRate: at.audio.sample_rate, channels: at.audio.channel_count || 2, description: vcAacASC(at.audio.sample_rate, at.audio.channel_count) } : null;
          resolve({ track: vt, samples: vs, description: description, durationSec: durationSec, fps: fps, audio: audio });
        }
      };
      var ab = buf.slice(0); ab.fileStart = 0; file.appendBuffer(ab); file.flush();
    });
  }
  /* Transcode (pipelined w/ backpressure so a 100MB source stays within memory).
     opts: { demuxed, libs, cap, bitrate, codec, startSec, durSec, keepAudio, onProgress } */
  function vcTranscode(opts) {
    var d = opts.demuxed, libs = opts.libs, src = d.track.video;
    var dims = vcScaleDims(src.width, src.height, opts.cap);
    var fps = d.fps, gop = Math.max(1, fps * 2);
    var Mux = libs.Mp4Muxer;
    var withAudio = !!(d.audio && opts.keepAudio);
    var muxCfg = { target: new Mux.ArrayBufferTarget(), video: { codec: "avc", width: dims.w, height: dims.h }, fastStart: "in-memory" };
    if (withAudio) muxCfg.audio = { codec: "aac", numberOfChannels: d.audio.channels || 2, sampleRate: d.audio.sampleRate || 48000 };
    var muxer = new Mux.Muxer(muxCfg);
    var startUs = (opts.startSec || 0) * 1e6, endUs = opts.durSec ? startUs + opts.durSec * 1e6 : Infinity, offsetUs = startUs;
    var needScale = dims.w !== src.width || dims.h !== src.height;
    var cv = new OffscreenCanvas(dims.w, dims.h), ctx = cv.getContext("2d", { alpha: false });
    var encErr = null, decErr = null, enkIn = 0, total = 0;
    for (var t = 0; t < d.samples.length; t++) { var ts0 = d.samples[t].timestamp; if (ts0 >= startUs && ts0 < endUs) total++; }
    total = total || d.samples.length;
    var encoder = new VideoEncoder({ output: function (c, m) { muxer.addVideoChunk(c, m); }, error: function (e) { encErr = e; } });
    encoder.configure({ codec: opts.codec, width: dims.w, height: dims.h, bitrate: opts.bitrate, framerate: fps, avc: { format: "avc" } });
    var decoder = new VideoDecoder({
      output: function (frame) {
        var ts = frame.timestamp;
        if (ts >= startUs && ts < endUs) {
          var toEnc;
          if (needScale) { ctx.drawImage(frame, 0, 0, dims.w, dims.h); toEnc = new VideoFrame(cv, { timestamp: ts - offsetUs }); frame.close(); }
          else if (offsetUs) { toEnc = new VideoFrame(frame, { timestamp: ts - offsetUs }); frame.close(); }
          else { toEnc = frame; }
          var key = enkIn % gop === 0; enkIn++;
          try { encoder.encode(toEnc, { keyFrame: key }); } catch (e) { encErr = e; }
          toEnc.close();
          if (opts.onProgress) opts.onProgress(Math.min(1, enkIn / total));
        } else { frame.close(); }
      },
      error: function (e) { decErr = e; }
    });
    decoder.configure({ codec: d.track.codec, description: d.description, codedWidth: src.width, codedHeight: src.height });
    var startIdx = 0;
    if (startUs > 0) { for (var j = 0; j < d.samples.length; j++) { if (d.samples[j].timestamp > startUs) break; if (d.samples[j].type === "key") startIdx = j; } }
    return (async function () {
      for (var n = startIdx; n < d.samples.length; n++) {
        if (decErr || encErr) break;
        if (d.samples[n].timestamp >= endUs) break;
        while (decoder.decodeQueueSize > 6 || encoder.encodeQueueSize > 6) { await vcSleep(0); if (decErr || encErr) break; }
        decoder.decode(new EncodedVideoChunk(d.samples[n]));
      }
      if (!decErr) await decoder.flush();
      if (!encErr) await encoder.flush();
      if (withAudio) {
        try {
          var aud = d.audio;
          for (var ai = 0; ai < aud.samples.length; ai++) {
            var asmp = aud.samples[ai];
            if (asmp.timestamp < startUs) continue;
            if (asmp.timestamp >= endUs) break;
            muxer.addAudioChunk(new EncodedAudioChunk({ type: "key", timestamp: Math.max(0, asmp.timestamp - offsetUs), duration: asmp.duration, data: asmp.data }), { decoderConfig: { description: aud.description } });
          }
        } catch (e) { /* audio copy failed — ship video-only */ }
      }
      muxer.finalize();
      try { decoder.close(); } catch (e) {}
      try { encoder.close(); } catch (e) {}
      if (encErr) throw (encErr.message ? encErr : new Error("Encoding failed."));
      if (decErr) throw (decErr.message ? decErr : new Error("Decoding failed."));
      var buffer = muxer.target.buffer;
      return { buffer: buffer, bytes: buffer.byteLength, width: dims.w, height: dims.h };
    })();
  }
  // Sanity-check a freshly-encoded clip actually plays (some real recordings transcode to a
  // stream that loads but stalls on playback). Resolves { ok, reason }.
  function vcVerifyPlayable(blob) {
    return new Promise(function (resolve) {
      var v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.playsInline = true;
      var url = URL.createObjectURL(blob), settled = false;
      function finish(ok, reason) { if (settled) return; settled = true; clearTimeout(to); try { v.pause(); } catch (e) {} try { URL.revokeObjectURL(url); } catch (e) {} resolve({ ok: ok, reason: reason || "" }); }
      var to = setTimeout(function () { finish(false, "timed out"); }, 9000);
      v.onerror = function () { finish(false, "decode error"); };
      v.onloadeddata = function () {
        if (!v.videoWidth) { finish(false, "no video track"); return; }
        var p = v.play();
        (p && p.then ? p : Promise.resolve()).then(function () {
          setTimeout(function () {
            if (!(v.currentTime > 0.05)) { finish(false, "playback stalled"); return; }
            // Some real recordings transcode to an all-black stream that still "plays" (time
            // advances, audio runs) — catch it by sampling the rendered pixels. A blob URL is
            // same-origin, so the canvas isn't tainted and getImageData is allowed.
            try {
              var c = document.createElement("canvas"); c.width = 48; c.height = 27;
              var g = c.getContext("2d"); g.drawImage(v, 0, 0, 48, 27);
              var px = g.getImageData(0, 0, 48, 27).data, sum = 0, mx = 0;
              for (var i = 0; i < px.length; i += 4) { var lum = (px[i] + px[i + 1] + px[i + 2]) / 3; sum += lum; if (lum > mx) mx = lum; }
              if (sum / (px.length / 4) < 3 && mx < 12) { finish(false, "black frames"); return; }
            } catch (e) { /* can't sample — don't block on it */ }
            finish(true, "");
          }, 700);
        }).catch(function () { finish(false, "couldn\u2019t start playback"); });
      };
      v.src = url;
    });
  }
  // The compress panel: scrub to pick a clip, tune quality/resolution, preview A/B, then encode.
  function openCompressor(file, onApprove, onCancel) {
    var srcURL = URL.createObjectURL(file);
    var demuxed = null, codec = null, busy = false, ready = false, done = false, outFile = null;
    var box = document.createElement("div");
    box.className = "pass pass--wide vc";
    box.innerHTML =
      '<div class="pass__box vc__box">' +
        '<div class="vc__head"><strong>Compress video</strong><span class="vc__file"></span></div>' +
        '<div class="vc__body">' +
          '<div class="vc__stage">' +
            '<div class="vc__srcwrap"><video class="vc__src" controls muted playsinline></video><div class="vc__hint">Scrub to a moment that shows the detail you care about, then <b>Preview</b> \u2014 no auto-picked frames.</div></div>' +
            '<div class="vc__ab" hidden>' +
              '<figure class="vc__cell"><figcaption>Original clip</figcaption><video class="vc__orig" controls muted loop playsinline></video></figure>' +
              '<figure class="vc__cell"><figcaption>Compressed <span class="vc__cmpmeta"></span> \u2014 use the \u26f6 for full screen</figcaption><video class="vc__cmp" controls muted loop playsinline></video></figure>' +
            '</div>' +
          '</div>' +
          '<div class="vc__side">' +
            '<label class="af__label">Quality</label>' +
            '<input type="range" class="vc__q" min="0" max="100" value="55" />' +
            '<div class="vc__qlbl"><span>Smaller file</span><span>Higher quality</span></div>' +
            '<div class="af"><label class="af__label">Resolution</label><select class="vc__res"><option value="0">Original</option><option value="1080">1080p max</option><option value="720">720p max</option></select></div>' +
            '<div class="vc__est">Full file (est.): <b class="vc__estsize">\u2014</b></div>' +
            '<button class="btn btn--ghost vc__preview" disabled>Preview from here</button>' +
            '<label class="vc__chk" hidden><input type="checkbox" class="vc__audio" checked /> Keep audio (copied through)</label>' +
            '<div class="vc__note"></div>' +
          '</div>' +
        '</div>' +
        '<div class="vc__prog" hidden><div class="vc__bar"><i></i></div><span class="vc__progtxt">Compressing\u2026</span></div>' +
        '<div class="vc__foot"><button class="btn vc__cancel">Cancel</button><button class="btn btn--primary vc__go" disabled>Compress &amp; use</button></div>' +
      '</div>';
    document.body.appendChild(box);
    var el = function (s) { return box.querySelector(s); };
    var srcV = el(".vc__src"), qEl = el(".vc__q"), resEl = el(".vc__res");
    var previewBtn = el(".vc__preview"), goBtn = el(".vc__go"), cancelBtn = el(".vc__cancel");
    var abWrap = el(".vc__ab"), origV = el(".vc__orig"), cmpV = el(".vc__cmp"), cmpMeta = el(".vc__cmpmeta");
    var estSize = el(".vc__estsize"), prog = el(".vc__prog"), bar = el(".vc__bar i"), progTxt = el(".vc__progtxt");
    var audioChk = el(".vc__audio"), audioLbl = el(".vc__chk"), noteEl = el(".vc__note");
    el(".vc__file").textContent = (file.name || "video") + " \u00b7 " + vcFmtBytes(file.size);
    srcV.src = srcURL;
    function cleanup() {
      [srcURL, origV.src, cmpV.src].forEach(function (u) { if (u && u.slice(0, 5) === "blob:") try { URL.revokeObjectURL(u); } catch (e) {} });
      box.remove();
    }
    function close(approved) { cleanup(); if (approved && outFile) onApprove(outFile); else if (onCancel) onCancel(); }
    cancelBtn.onclick = function () { if (!busy) close(false); };
    box.addEventListener("click", function (e) { if (e.target === box && !busy) close(false); });
    function qVal() { return Math.max(0, Math.min(1, (+qEl.value || 0) / 100)); }
    function capVal() { return +resEl.value || 0; }
    function resetGo() { if (done) { done = false; outFile = null; goBtn.textContent = "Compress & use"; } }
    qEl.oninput = resetGo; resEl.onchange = resetGo; if (audioChk) audioChk.onchange = resetGo;
    function bitrateNow() { var dm = vcScaleDims(demuxed.track.video.width, demuxed.track.video.height, capVal()); return vcBitrate(dm.w, dm.h, demuxed.fps, qVal()); }
    function keepAudio() { return !!(demuxed && demuxed.audio && audioChk && audioChk.checked); }
    function run(startSec, durSec, onProg, withAud) { return vcTranscode({ demuxed: demuxed, libs: demuxed.__libs, cap: capVal(), bitrate: bitrateNow(), codec: codec, startSec: startSec, durSec: durSec, keepAudio: !!withAud, onProgress: onProg }); }

    status("Reading video\u2026");
    vcLoadLibs().then(function (libs) {
      return file.arrayBuffer().then(function (buf) { return vcDemux(buf, libs); }).then(function (dx) { demuxed = dx; demuxed.__libs = libs; });
    }).then(vcSupported).then(function (c) {
      codec = c || "avc1.4d0028"; ready = true;
      if (demuxed && demuxed.audio) { if (audioLbl) audioLbl.hidden = false; if (noteEl) noteEl.textContent = "Audio is copied through untouched \u2014 no quality loss."; }
      else if (noteEl) noteEl.textContent = "This clip has no audio track.";
      previewBtn.disabled = false; goBtn.disabled = false;
      status("Ready \u2014 scrub to a spot, then Preview or Compress.");
    }).catch(function (e) { status(""); close(false); setTimeout(function () { status((e && e.message) || "This video couldn\u2019t be prepared."); }, 20); });

    previewBtn.onclick = function () {
      if (busy || !ready) return;
      resetGo(); busy = true; previewBtn.disabled = true; goBtn.disabled = true; previewBtn.textContent = "Rendering\u2026";
      var start = Math.max(0, Math.min(srcV.currentTime || 0, Math.max(0, demuxed.durationSec - 0.2)));
      var dur = Math.min(5, Math.max(1, demuxed.durationSec - start));
      run(start, dur, null, false).then(function (r) {
        var blob = new Blob([r.buffer], { type: "video/mp4" });
        if (cmpV.src) URL.revokeObjectURL(cmpV.src);
        cmpV.src = URL.createObjectURL(blob); cmpV.play().catch(function () {});
        origV.src = srcURL;
        origV.onloadedmetadata = function () { try { origV.currentTime = start; } catch (e) {} origV.play().catch(function () {}); };
        origV.ontimeupdate = function () { if (origV.currentTime > start + dur || origV.currentTime < start - 0.1) { try { origV.currentTime = start; } catch (e) {} } };
        abWrap.hidden = false;
        var full = demuxed.durationSec ? r.bytes / dur * demuxed.durationSec : r.bytes;
        cmpMeta.textContent = "\u00b7 " + r.width + "\u00d7" + r.height + " \u00b7 " + vcFmtBytes(r.bytes) + " / " + dur.toFixed(1) + "s";
        estSize.textContent = vcFmtBytes(full) + " \u2014 was " + vcFmtBytes(file.size);
      }).catch(function (e) { status((e && e.message) || "Preview failed."); }).then(function () {
        busy = false; previewBtn.disabled = false; goBtn.disabled = false; previewBtn.textContent = "Preview from here";
      });
    };

    goBtn.onclick = function () {
      if (done && outFile) { close(true); return; }
      if (busy || !ready) return;
      busy = true; previewBtn.disabled = true; goBtn.disabled = true;
      prog.hidden = false; bar.style.width = "0%"; progTxt.textContent = "Compressing\u2026 0%";
      run(0, 0, function (p) { var pc = Math.round(p * 100); bar.style.width = pc + "%"; progTxt.textContent = "Compressing\u2026 " + pc + "%"; }, keepAudio()).then(function (r) {
        var blob = new Blob([r.buffer], { type: "video/mp4" });
        outFile = new File([blob], (file.name || "video").replace(/\.[^.]+$/, "") + "-compressed.mp4", { type: "video/mp4" });
        if (cmpV.src) URL.revokeObjectURL(cmpV.src);
        cmpV.src = URL.createObjectURL(blob); cmpV.play().catch(function () {});
        origV.src = srcURL; origV.onloadedmetadata = function () { origV.play().catch(function () {}); }; origV.ontimeupdate = null;
        abWrap.hidden = false;
        cmpMeta.textContent = "\u00b7 " + r.width + "\u00d7" + r.height + " \u00b7 " + vcFmtBytes(r.bytes);
        var pct = file.size ? Math.round((1 - r.bytes / file.size) * 100) : 0;
        estSize.textContent = vcFmtBytes(r.bytes) + " \u2014 was " + vcFmtBytes(file.size) + (pct > 0 ? " (" + pct + "% smaller)" : "");
        prog.hidden = true; done = true;
        goBtn.textContent = "Use this file \u2713";
        vcVerifyPlayable(blob).then(function (chk) {
          if (!chk.ok && noteEl) {
            noteEl.textContent = chk.reason === "black frames"
              ? "\u26a0 The compressed video came out black \u2014 this happens with some screen recordings in the browser encoder. Try Resolution = \u201cOriginal\u201d (it skips the rescale that\u2019s failing here), or compress it in HandBrake / ffmpeg and add the file directly."
              : "\u26a0 This clip didn\u2019t encode cleanly (" + chk.reason + ") \u2014 it may not play. For a reliable result, compress externally (HandBrake / ffmpeg) and add the file directly.";
            noteEl.classList.add("vc__note--warn");
            goBtn.textContent = "Use anyway";
          } else if (chk.ok && noteEl && noteEl.classList.contains("vc__note--warn")) {
            // a previous attempt warned; this re-encode is clean — clear the stale amber note
            noteEl.classList.remove("vc__note--warn");
            noteEl.textContent = (demuxed && demuxed.audio) ? "Audio is copied through untouched \u2014 no quality loss." : "";
          }
        });
      }).catch(function (e) { prog.hidden = true; status((e && e.message) || "Compression failed."); }).then(function () {
        busy = false; previewBtn.disabled = false; goBtn.disabled = false;
      });
    };
  }
  // Gate a picked file before upload: big videos go through the compressor; oversize
  // non-video (or unsupported browsers) get the existing "host it & paste a link" nudge.
  function prepareUpload(file) {
    return new Promise(function (resolve) {
      if (!file) { resolve(null); return; }
      if (vcIsCompressible(file) && file.size > 10 * 1024 * 1024) {
        vcSupported().then(function (c) {
          if (!c) {
            if (file.size > 45 * 1024 * 1024) { status("\u201c" + (file.name || "That file") + "\u201d is " + Math.round(file.size / 1048576) + " MB \u2014 too large to embed. Host it (YouTube, Vimeo, OneDrive/Stream) and paste the link instead."); resolve(null); }
            else resolve(file);
            return;
          }
          openCompressor(file, function (out) { resolve(out); }, function () { resolve(null); });
        });
        return;
      }
      if (file.size > 45 * 1024 * 1024) { status("\u201c" + (file.name || "That file") + "\u201d is " + Math.round(file.size / 1048576) + " MB \u2014 too large to embed. Host it (YouTube, Vimeo, OneDrive/Stream) and paste the link instead."); resolve(null); return; }
      resolve(file);
    });
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
  var AI_PROXY_PROVIDERS = ["openai", "gemini", "anthropic"];
  function aiProxy() {
    return {
      on: localStorage.getItem("rk:ai:proxy:on") === "1",
      url: (localStorage.getItem("rk:ai:proxy:url") || "").trim().replace(/\/+$/, ""),
      token: localStorage.getItem("rk:ai:proxy:token") || "",
    };
  }
  function aiCfg(purpose) {
    const scope = aiScope(purpose);
    const p = aiGet(scope, "provider") || "openai";
    const px = aiProxy();
    const viaProxy = px.on && !!px.url && AI_PROXY_PROVIDERS.indexOf(p) !== -1;
    return {
      purpose: purpose || "img", scope: scope, provider: p, proxied: viaProxy,
      key: viaProxy ? px.token : (aiGet(scope, "key") || ""),
      model: (aiGet(scope, "model") || bestModel(p, purpose) || AI_DEFAULT_MODEL[p] || "").trim(),
      base: viaProxy ? (px.url + "/" + p) : (aiGet(scope, "base") || AI_DEFAULT_BASE[p] || "").trim().replace(/\/+$/, ""),
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
  function aiProxyBlock(px) {
    const maskedTok = px.token ? (px.token.slice(0, 3) + "\u2022\u2022\u2022\u2022\u2022\u2022" + px.token.slice(-4)) : "";
    return '<div class="aiblk"><div class="aiblk__head">Private proxy <span>keeps keys off this site</span></div>' +
      '<label class="chk"><input type="checkbox" id="aiProxyOn"' + (px.on ? " checked" : "") + ' /> Route AI through my Cloudflare Worker</label>' +
      '<div class="af"><label class="af__label">Worker URL</label><input type="text" id="aiProxyUrl" value="' + escAttr(px.url) + '" placeholder="https://rk-ai-proxy.you.workers.dev" autocomplete="off" /></div>' +
      '<div class="af"><label class="af__label">Access token</label><input type="password" id="aiProxyToken" placeholder="' + (px.token ? "Saved \u2014 paste to replace" : "Paste your ACCESS_TOKEN") + '" autocomplete="off" /><div class="af__hint">' + (px.token ? ("In use: " + escHtml(maskedTok)) : "Not set") + "</div></div>" +
      '<div class="af__hint">When on, pick the provider below that matches a key you configured on the Worker \u2014 your own API key isn\u2019t needed here. Custom providers still call direct.</div></div>';
  }
  function aiPickProvider(scope, p) {
    aiSetProvider(scope, p);
    if (activeTab === "ai") renderBody();
  }
  function aiPersistVisible(scopeEl) {
    scopeEl = scopeEl || root;
    ["all", "txt", "img"].forEach(function (scope) {
      const sel = scopeEl.querySelector("#aiProvider_" + scope);
      if (!sel) return;
      const p = sel.value;
      localStorage.setItem("rk:ai:" + scope + ":provider", p);
      const k = scopeEl.querySelector("#aiKey_" + scope), m = scopeEl.querySelector("#aiModel_" + scope), bs = scopeEl.querySelector("#aiBase_" + scope);
      if (k && k.value.trim()) localStorage.setItem("rk:ai:" + scope + ":key", k.value.trim());
      if (p === "custom") {
        if (m) localStorage.setItem("rk:ai:" + scope + ":model", m.value.trim());
        if (bs) localStorage.setItem("rk:ai:" + scope + ":base", bs.value.trim());
      } else {
        localStorage.removeItem("rk:ai:" + scope + ":model");
        localStorage.removeItem("rk:ai:" + scope + ":base");
      }
    });
    aiPersistProxy(scopeEl);
  }
  function aiPersistProxy(scopeEl) {
    scopeEl = scopeEl || root;
    const on = scopeEl.querySelector("#aiProxyOn");
    const url = scopeEl.querySelector("#aiProxyUrl");
    const tok = scopeEl.querySelector("#aiProxyToken");
    if (on) localStorage.setItem("rk:ai:proxy:on", on.checked ? "1" : "0");
    if (url) localStorage.setItem("rk:ai:proxy:url", url.value.trim());
    if (tok && tok.value.trim()) localStorage.setItem("rk:ai:proxy:token", tok.value.trim());
  }
  function aiSave() { aiPersistVisible(); renderBody(); status("AI settings saved \u2014 local only.", true); }
  // Full AI settings dialog, opened from the More (...) menu. Mirrors the old AI-tab config: private proxy +
  // one/two provider blocks + save/remove. Self-contained (its own handlers) since it lives outside the tab
  // body, and persists via aiPersistVisible(modal) scoped to its own inputs.
  function aiSettingsModal(opts) {
    var modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">AI settings</div>' +
      '<div class="pass__sub">Connect a provider for the Prepare tools \u2014 ATS check, cover letters, interview prep and imagery. Keys are stored only in this browser and never written to your published site.</div>' +
      '<div class="aiset__body" style="max-height:58vh;overflow:auto;margin:.2rem 0 .4rem"></div>' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-clear>Remove keys</button><button class="btn btn--ghost" data-cancel>Close</button><button class="btn btn--primary" data-go>Save</button></div>' +
      '<div class="pass__note">Keys never touch your published site; they\u2019re sent only to the provider you pick. Some providers block browser calls (CORS) \u2014 OpenAI &amp; Gemini work directly, or route through your private proxy.</div></div>';
    document.body.appendChild(modal);
    settingsMount(modal, opts);
    var bodyEl = modal.querySelector(".aiset__body");
    function paint() {
      var same = aiSameKey();
      var imgOK = aiSupportsImages();
      var html = aiProxyBlock(aiProxy()) +
        '<label class="chk aiblk__same"><input type="checkbox" data-aiset-same' + (same ? " checked" : "") + " /> Use the same service &amp; key for content and image</label>";
      html += same ? aiBlock("all", "AI service", "content + image")
                   : (aiBlock("txt", "Content generation", "text") + aiBlock("img", "Image generation", "imagery"));
      html += '<div class="af__hint" style="margin:.1rem 0 .2rem">' + (imgOK ? "Image service supports generation." : "Your image service (Claude) can\u2019t generate images \u2014 pick OpenAI or Gemini for imagery.") + "</div>";
      bodyEl.innerHTML = html;
      bodyEl.querySelectorAll("[data-aiscope]").forEach(function (sel) {
        sel.addEventListener("change", function () { aiPersistVisible(modal); aiSetProvider(sel.getAttribute("data-aiscope"), sel.value); paint(); });
      });
      var sameCb = bodyEl.querySelector("[data-aiset-same]");
      if (sameCb) sameCb.addEventListener("change", function () { aiPersistVisible(modal); localStorage.setItem("rk:ai:same", sameCb.checked ? "1" : "0"); paint(); });
    }
    paint();
    var close = function () { if (opts && opts.onClose) opts.onClose(); else modal.remove(); };
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    modal.querySelector("[data-cancel]").addEventListener("click", close);
    modal.querySelector("[data-clear]").addEventListener("click", function () {
      Object.keys(localStorage).forEach(function (k) { if (/^rk:ai:[a-z]+:key$/.test(k)) localStorage.removeItem(k); });
      if (activeTab === "ai") renderBody();
      paint(); status("Keys removed.");
    });
    modal.querySelector("[data-go]").addEventListener("click", function () {
      aiPersistVisible(modal);
      if (activeTab === "ai") renderBody();
      status("AI settings saved \u2014 local only.", true);
      close();
    });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }
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
    const gb = root.querySelector('[data-act="img-generate"][data-index="' + i + '"]'); btnBusy(gb, "Generating\u2026");
    status("Generating image\u2026 this can take a moment.");
    try {
      const uri = await compressDataUri(await aiImage(cfg, p, null));
      data.work[i].image = uri; apply(true); if (openStudy >= 0) renderL2(); else renderBody(); status("Image generated.", true);
    } catch (e) { btnIdle(gb, "Generate"); status("Generate failed: " + e.message); }
  }
  async function imgModify(i) {
    if (!aiHasKey("img")) { aiKeyModal("img", function () { imgModify(i); }); return; }
    const cfg = aiCfg("img");
    if (!aiSupportsImages()) return status("This service can\u2019t generate images \u2014 pick OpenAI or Gemini.");
    const cur = data.work[i].image;
    if (!cur) return status("No current image to modify.");
    const p = aiPromptFor(i);
    if (!p) return status("Describe how to change the image.");
    const mb = root.querySelector('[data-act="img-modify"][data-index="' + i + '"]'); btnBusy(mb, "Reimagining\u2026");
    status("Reimagining the image\u2026");
    try {
      const uri = await compressDataUri(await aiImage(cfg, p, cur));
      data.work[i].image = uri; apply(true); if (openStudy >= 0) renderL2(); else renderBody(); status("Image updated.", true);
    } catch (e) { btnIdle(mb, "Modify current"); status("Modify failed: " + e.message); }
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
  // ---- Vision: actually LOOK at case images so the reel features real UI/design, not press screenshots ----
  async function imgToVisionPart(src) {
    try {
      var uri = src;
      if (!/^data:/.test(src)) {
        var blob = await (await fetch(src)).blob();
        uri = await new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result)); }; fr.onerror = rej; fr.readAsDataURL(blob); });
      }
      var small = await compressDataUri(uri, 512, 0.6); // downscale: classification doesn't need full res
      var parts = await dataUriParts(small);
      if (!parts.b64 || /svg/i.test(parts.mime)) return null;
      return { src: src, mime: parts.mime || "image/jpeg", b64: parts.b64 };
    } catch (e) { return null; }
  }
  async function aiVisionOnce(cfg, model, system, prompt, imgs) {
    var p = cfg.provider, key = cfg.key, base = cfg.base, res, j;
    if (p === "anthropic") {
      var content = [{ type: "text", text: prompt }];
      imgs.forEach(function (im) { content.push({ type: "image", source: { type: "base64", media_type: im.mime, data: im.b64 } }); });
      res = await fetch(base + "/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model: model, max_tokens: 2000, system: system, messages: [{ role: "user", content: content }] }) });
      j = await res.json().catch(function () { return null; });
      if (!res.ok) return { ok: false, status: res.status, err: (j && j.error && j.error.message) || ("HTTP " + res.status) };
      return { ok: true, text: (((j && j.content) || []).map(function (b) { return b.text || ""; }).join("")).trim() };
    }
    if (p === "gemini") {
      var parts = [{ text: prompt }];
      imgs.forEach(function (im) { parts.push({ inline_data: { mime_type: im.mime, data: im.b64 } }); });
      var gurl = base + "/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);
      var gb = { contents: [{ role: "user", parts: parts }], systemInstruction: { parts: [{ text: system }] }, generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2200 } };
      res = await fetch(gurl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(gb) });
      j = await res.json().catch(function () { return null; });
      if (!res.ok) return { ok: false, status: res.status, err: (j && j.error && j.error.message) || ("HTTP " + res.status) };
      var cand = (j && j.candidates && j.candidates[0]) || {};
      return { ok: true, text: (((cand.content && cand.content.parts) || []).map(function (x) { return x.text || ""; }).join("")).trim() };
    }
    var msgs = [{ role: "system", content: system }, { role: "user", content: [{ type: "text", text: prompt }].concat(imgs.map(function (im) { return { type: "image_url", image_url: { url: "data:" + im.mime + ";base64," + im.b64 } }; })) }];
    var ob = { model: model, messages: msgs, max_tokens: 2200, temperature: 0, response_format: { type: "json_object" } };
    res = await fetch(base + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(ob) });
    j = await res.json().catch(function () { return null; });
    if (!res.ok) return { ok: false, status: res.status, err: (j && j.error && j.error.message) || ("HTTP " + res.status) };
    return { ok: true, text: ((j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").trim() };
  }
  async function visionModels(cfg) {
    if (cfg.provider === "custom") return cfg.model ? [cfg.model] : [];
    var want = AI_VISION_MODEL[cfg.provider] || [];
    var ids = await aiListModels(cfg), out = [];
    if (ids && ids.length) {
      want.forEach(function (m) { if (ids.indexOf(m) !== -1 && out.indexOf(m) === -1) out.push(m); });
      ids.forEach(function (id) { if (out.indexOf(id) === -1 && /gpt-4o|gpt-4\.1|gemini.*(flash|pro)|claude-3|sonnet|haiku|vision/i.test(id) && !/audio|realtime|embed|tts|whisper|image|dall|imagen/i.test(id)) out.push(id); });
    }
    want.forEach(function (m) { if (out.indexOf(m) === -1) out.push(m); });
    return out;
  }
  var VISION_SYS = "You are a meticulous design-portfolio image classifier with vision. Judge whether each image is a real product/UX artifact worth featuring in a case-study reel, or filler like a press screenshot or logo. Return STRICT JSON only.";
  function visionPrompt(n) {
    return "You are given " + n + " image(s), indexed 0 to " + (n - 1) + " in the order provided. Look at each and return STRICT JSON: {\"items\":[{\"i\":<index>,\"type\":\"<ui|beforeafter|diagram|dataviz|flow|photo|article|logo|decorative|other>\",\"ux\":<true|false>,\"desc\":\"<= 8 words on what it shows\"}]}. Set ux=true ONLY for genuine product/UX design artifacts: real interface screens, mockups, wireframes, user flows, before/after UI comparisons, annotated product screens, design systems or data-viz from the work. Set ux=false for news / blog / press screenshots, marketing or landing pages, logos, headshots, stock photos and decorative gradients.";
  }
  async function visionEnrich(cfg, media) {
    var out = {}, cand = [];
    media.forEach(function (m) { if (m && m.src && cand.indexOf(m.src) === -1 && !/\.(mp4|webm|mov|ogg)(\?|$)/i.test(m.src) && !/^data:image\/svg/i.test(m.src) && !/\.svg(\?|$)/i.test(m.src)) cand.push(m.src); });
    cand = cand.slice(0, 24);
    var todo = cand.filter(function (s) { return !visionCache[s]; });
    if (todo.length) {
      var models = await visionModels(cfg); if (!models.length) models = [cfg.model].filter(Boolean);
      if (!models.length) throw new Error("no vision model available");
      var BATCH = 5, model = null;
      for (var b = 0; b < todo.length; b += BATCH) {
        var batch = todo.slice(b, b + BATCH);
        status("Looking at the visuals... " + Math.min(b + batch.length, todo.length) + "/" + todo.length);
        var imgs = [];
        for (var k = 0; k < batch.length; k++) { var part = await imgToVisionPart(batch[k]); if (part) imgs.push(part); }
        if (!imgs.length) continue;
        var r = model ? await aiVisionOnce(cfg, model, VISION_SYS, visionPrompt(imgs.length), imgs) : null;
        if (!model || (r && !r.ok && aiIsModelErr(r))) {
          for (var mi = 0; mi < models.length; mi++) {
            if (models[mi] === model) continue;
            var rr = await aiVisionOnce(cfg, models[mi], VISION_SYS, visionPrompt(imgs.length), imgs);
            r = rr; if (rr.ok) { model = models[mi]; break; }
            if (!aiIsModelErr(rr)) break;
          }
        }
        if (!r || !r.ok) throw new Error((r && r.err) || "vision unavailable");
        var j = csgenParse(r.text);
        var items = (j && (j.items || j.results)) || (Array.isArray(j) ? j : []);
        (items || []).forEach(function (it) { var idx = +it.i; if (idx >= 0 && idx < imgs.length) visionCache[imgs[idx].src] = { type: String(it.type || "other").toLowerCase(), ux: it.ux !== false && it.ux !== "false" && it.ux !== 0, desc: String(it.desc || "").trim() }; });
        imgs.forEach(function (im) { if (!visionCache[im.src]) visionCache[im.src] = { type: "other", ux: true, desc: "" }; });
      }
    }
    cand.forEach(function (s) { if (visionCache[s]) out[s] = visionCache[s]; });
    return out;
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
    // Last resort: repair loose/truncated JSON (unescaped control chars in strings,
    // trailing commas, or output cut off by the model's token limit) so a slightly
    // malformed reply still yields a usable object. Only runs AFTER strict parsing fails.
    var fixed = csgenRepair(a !== -1 ? s.slice(a) : s);
    if (fixed) { try { return JSON.parse(fixed); } catch (e3) {} }
    return null;
  }
  function csgenRepair(raw) {
    if (!raw) return null;
    var s = String(raw);
    var oi = s.indexOf("{"), ai = s.indexOf("[");
    var start = oi === -1 ? ai : (ai === -1 ? oi : Math.min(oi, ai));
    if (start === -1) return null;
    s = s.slice(start);
    var BS = String.fromCharCode(92); // backslash, without writing one literally
    var ctrl = { 10: BS + "n", 13: BS + "r", 9: BS + "t" };
    var stack = [], inStr = false, escd = false, out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), code = s.charCodeAt(i);
      if (inStr) {
        if (escd) { out += c; escd = false; continue; }
        if (c === BS) { out += c; escd = true; continue; }
        if (c === '"') { out += c; inStr = false; continue; }
        out += ctrl[code] || c; // escape raw newline/tab that would break JSON.parse
        continue;
      }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
      else if (c === "}" || c === "]") {
        if (stack.length) stack.pop();
        var e = out.length; // drop a trailing comma right before this closer:  ...,]  ->  ...]
        while (e > 0) { var w = out.charCodeAt(e - 1); if (w === 32 || w === 9 || w === 10 || w === 13) e--; else break; }
        if (e > 0 && out.charAt(e - 1) === ",") out = out.slice(0, e - 1);
      }
      out += c;
    }
    if (inStr) out += '"';
    var end = out.length;
    while (end > 0) { var cc = out.charCodeAt(end - 1); if (cc === 32 || cc === 9 || cc === 10 || cc === 13) end--; else break; }
    out = out.slice(0, end);
    var last = out.charAt(out.length - 1);
    if (last === ",") out = out.slice(0, -1);
    else if (last === ":") out += "null";
    for (var k = stack.length - 1; k >= 0; k--) out += stack[k];
    return out;
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
    root.querySelectorAll(sel).forEach(function (b) { b.disabled = true; b.classList.add("is-busy"); });
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
      root.querySelectorAll(sel).forEach(function (b) { b.disabled = false; b.classList.remove("is-busy"); });
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
      var genBtn = modal.querySelector("[data-gen]"); btnBusy(genBtn, "Writing\u2026");
      try {
        var obj = csgenParse(await aiText(aiCfg("txt"), landingSystem(tone, picks), "BRIEF / CONTEXT:\n" + (brief || "(none \u2014 infer tastefully from a senior product designer profile)") + "\n\nWrite the requested sections as JSON.", { json: true, maxTokens: 2048, temperature: 0.7 }));
        if (!obj) throw new Error("The AI didn\u2019t return usable copy \u2014 try again.");
        renderReview(obj, picks);
        review.hidden = false; modal.querySelector(".laig").hidden = true; genBtn.hidden = true;
        modal.querySelector("[data-apply]").hidden = false;
      } catch (e) { err.textContent = (e && e.message) || "Failed."; btnIdle(genBtn, "Generate draft"); }
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
  var FB_TYPE_NAMES = { text: "Text", statement: "Statement", metrics: "Metrics", steps: "Steps", media: "Media", split: "Before / after", faq: "FAQ", cards: "Cards", gallery: "Gallery", mediagrid: "Media grid", figure: "Figure", columns: "Columns", rows: "Rows", compare: "Compare", stickies: "Sticky notes", voices: "Voices", workflow: "Workflow", device: "Devices", isolayers: "Isometric layers", focus: "Focus & annotate" };
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
    // Detect the REAL format by magic bytes FIRST: hosted PDFs are often served as
    // application/octet-stream (e.g. raw.githubusercontent), which would name the file
    // "resume.bin" and fall through to f.text() below, dumping raw PDF bytes to the AI.
    try {
      var _h = new Uint8Array(await f.slice(0, 8).arrayBuffer()), _sig = "";
      for (var _i = 0; _i < _h.length; _i++) _sig += String.fromCharCode(_h[_i]);
      var _nm = String(f.name || "").toLowerCase();
      if (_sig.indexOf("%PDF") === 0 && _nm.slice(-4) !== ".pdf" && f.type !== "application/pdf") f = new File([f], "resume.pdf", { type: "application/pdf" });
      else if (_sig.indexOf("PK") === 0 && _nm.slice(-5) === ".docx" && !f.type) f = new File([f], _nm, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    } catch (_e) {}
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
      btnBusy(runBtn, "Reviewing\u2026");
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
        btnIdle(runBtn, "Review against case study");
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

  /* ---------- AI interview prep (per case study, level-aware) ---------- */
  var IPREP_LEVELS = [
    ["senior", "Senior", "Craft, execution &amp; the decisions behind the work"],
    ["staff", "Principal / Staff", "Ambiguity, strategy &amp; cross-team leverage"],
    ["leader", "Design Leader", "Vision, team, org &amp; business outcomes"]
  ];
  var iprepState = {};
  function iprepSt(id) { return iprepState[id] || (iprepState[id] = { level: "staff", scope: "study", jd: "" }); }
  function iprepStrip(s) { return String(s == null ? "" : s).replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim(); }
  function iprepFlat(o) {
    if (o == null) return "";
    if (typeof o === "string") return iprepStrip(o);
    if (Array.isArray(o)) return o.map(iprepFlat).filter(Boolean).join(" \u00b7 ");
    if (typeof o === "object") return Object.keys(o).map(function (k) { return typeof o[k] === "string" ? iprepStrip(o[k]) : (Array.isArray(o[k]) ? iprepFlat(o[k]) : ""); }).filter(Boolean).join(" \u00b7 ");
    return "";
  }
  function iprepContext(w, scope) {
    var lines = [], st = w.study || {};
    lines.push("# THIS CASE STUDY: " + (w.title || "Untitled"));
    if (w.desc) lines.push("Summary: " + iprepStrip(w.desc));
    [["tagline", "Tagline"], ["role", "My role"], ["team", "Team"], ["timeline", "Timeline"], ["scope", "Scope"]].forEach(function (p) { if (st[p[0]]) lines.push(p[1] + ": " + iprepStrip(st[p[0]])); });
    (st.blocks || []).forEach(function (b) {
      var parts = [];
      ["kicker", "heading", "body", "sub", "caption", "leftLabel", "rightLabel", "beforeLabel", "afterLabel"].forEach(function (f) { if (typeof b[f] === "string" && b[f].trim()) parts.push(iprepStrip(b[f])); });
      ["list", "left", "right"].forEach(function (f) { if (Array.isArray(b[f])) b[f].forEach(function (v) { if (v) parts.push("- " + iprepStrip(v)); }); else if (typeof b[f] === "string" && b[f].trim()) parts.push(iprepStrip(b[f])); });
      (b.items || []).forEach(function (it) {
        ["value", "label", "title", "heading", "body", "q", "a", "cite", "note"].forEach(function (f) { if (typeof it[f] === "string" && it[f].trim()) parts.push(iprepStrip(it[f])); });
        (it.cells || []).forEach(function (cell) { ["heading", "body"].forEach(function (f) { if (cell[f]) parts.push(iprepStrip(cell[f])); }); });
      });
      if (parts.length) lines.push("[" + (b.type || "section") + "] " + parts.join(" "));
    });
    if (scope === "portfolio") {
      var L = data.landing || {};
      var about = [L.aboutLead, L.about, L.aboutSign].map(iprepStrip).filter(Boolean).join(" ");
      if (about) lines.push("\n# ABOUT ME\n" + about);
      if (Array.isArray(data.capabilities) && data.capabilities.length) lines.push("\n# CAPABILITIES\n" + data.capabilities.map(iprepFlat).filter(Boolean).join(", "));
      if (Array.isArray(data.path) && data.path.length) { lines.push("\n# EXPERIENCE"); data.path.forEach(function (p) { var t = iprepFlat(p); if (t) lines.push("- " + t); }); }
      if (Array.isArray(data.recognition) && data.recognition.length) lines.push("\n# RECOGNITION\n" + data.recognition.map(iprepFlat).filter(Boolean).join("; "));
      var others = (data.work || []).filter(function (x) { return x && x.id !== w.id && !x.hidden && !x.encWork; });
      if (others.length) { lines.push("\n# OTHER PROJECTS"); others.forEach(function (x) { lines.push("- " + iprepStrip(x.title) + (x.desc ? ": " + iprepStrip(x.desc) : "")); }); }
    }
    var txt = lines.filter(Boolean).join("\n");
    return txt.length > 9000 ? txt.slice(0, 9000) + "\u2026" : txt;
  }
  // AI-tab entry: build context from one or more picked projects (and, when “whole portfolio”,
  // the about / capabilities / experience too). Mirrors iprepContext's per-work extraction.
  function iprepAiContext(works, whole) {
    var lines = [];
    (works || []).forEach(function (w) {
      var st = w.study || {};
      lines.push("# PROJECT: " + (w.title || "Untitled"));
      if (w.desc) lines.push("Summary: " + iprepStrip(w.desc));
      [["tagline", "Tagline"], ["role", "My role"], ["team", "Team"], ["timeline", "Timeline"], ["scope", "Scope"]].forEach(function (p) { if (st[p[0]]) lines.push(p[1] + ": " + iprepStrip(st[p[0]])); });
      (st.blocks || []).forEach(function (b) {
        var parts = [];
        ["kicker", "heading", "body", "sub", "caption", "leftLabel", "rightLabel", "beforeLabel", "afterLabel"].forEach(function (f) { if (typeof b[f] === "string" && b[f].trim()) parts.push(iprepStrip(b[f])); });
        ["list", "left", "right"].forEach(function (f) { if (Array.isArray(b[f])) b[f].forEach(function (v) { if (v) parts.push("- " + iprepStrip(v)); }); else if (typeof b[f] === "string" && b[f].trim()) parts.push(iprepStrip(b[f])); });
        (b.items || []).forEach(function (it) { ["value", "label", "title", "heading", "body", "q", "a", "cite", "note"].forEach(function (f) { if (typeof it[f] === "string" && it[f].trim()) parts.push(iprepStrip(it[f])); }); });
        if (parts.length) lines.push("[" + (b.type || "section") + "] " + parts.join(" "));
      });
      lines.push("");
    });
    if (whole) {
      var L = data.landing || {};
      var about = [L.aboutLead, L.about, L.aboutSign].map(iprepStrip).filter(Boolean).join(" ");
      if (about) lines.push("# ABOUT ME\n" + about);
      if (Array.isArray(data.capabilities) && data.capabilities.length) lines.push("# CAPABILITIES\n" + data.capabilities.map(iprepFlat).filter(Boolean).join(", "));
      if (Array.isArray(data.path) && data.path.length) { lines.push("# EXPERIENCE"); data.path.forEach(function (p) { var t = iprepFlat(p); if (t) lines.push("- " + t); }); }
      if (Array.isArray(data.recognition) && data.recognition.length) lines.push("# RECOGNITION\n" + data.recognition.map(iprepFlat).filter(Boolean).join("; "));
    }
    var txt2 = lines.filter(Boolean).join("\n");
    return txt2.length > 9000 ? txt2.slice(0, 9000) + "\u2026" : txt2;
  }
  function iprepSystem(level) {
    var lv = {
      senior: "a SENIOR product designer role \u2014 probe craft, execution detail, collaboration, and the reasoning behind concrete design decisions.",
      staff: "a PRINCIPAL/STAFF product designer role \u2014 probe ambiguity, problem framing, strategy, systems thinking and cross-team influence far more than pixel-level execution.",
      leader: "a DESIGN LEADERSHIP role (Head/Director of Design) \u2014 probe vision, team building, org design, hiring, stakeholder management and business outcomes."
    }[level] || "";
    return [
      "You are an experienced design hiring manager and interview coach. Given a candidate's REAL portfolio material, generate the questions a sharp interviewer would actually ask.",
      "Interviewing for: " + lv,
      "Center questions on the provided case study, but broaden naturally to role-level, behavioral, strategy and leadership questions where relevant.",
      "Rules:",
      "- Ground every question in the candidate's ACTUAL material \u2014 reference the real project, decision, metric or tradeoff. No generic filler.",
      "- Mix categories: Project deep-dive, Problem framing, Decisions & tradeoffs, Impact & metrics, Collaboration & stakeholders, and (for higher levels) Strategy / Vision / Leadership.",
      "- Calibrate difficulty and focus to the target level.",
      "- If a target role / job description is provided, tailor toward it.",
      "- Never invent facts about the candidate; ask about gaps instead of assuming.",
      "Return ONLY valid JSON (no markdown): {\"questions\":[{\"q\":string,\"category\":string,\"why\":string}]}. \"why\" = one short line on what a strong answer would show."
    ].join("\n");
  }
  function iprepQUser(ctx, jd, n) {
    return "TARGET ROLE / JOB DESCRIPTION (optional):\n" + (jd ? jd.trim() : "(none provided)") + "\n\nGenerate exactly " + n + " questions, ordered from opener to hardest.\n\nCANDIDATE MATERIAL:\n" + ctx;
  }
  function iprepAnsSystem(level) {
    return [
      "You are an interview coach helping a product designer rehearse. Given ONE interview question and the candidate's real portfolio material, draft a strong, honest answer IN FIRST PERSON that they could say aloud.",
      "Interviewing at level: " + level + ".",
      "Auto-pick the BEST format for THIS question:",
      "- Behavioral / 'tell me about a time' \u2192 STAR (Situation, Task, Action, Result), lightly signposted.",
      "- Project walkthrough \u2192 context \u2192 problem \u2192 my role \u2192 key decisions & tradeoffs \u2192 outcome \u2192 reflection.",
      "- Quick / factual \u2192 a few crisp talking-point sentences.",
      "Rules:",
      "- Use ONLY facts in the material. NEVER invent metrics, names or outcomes. If a needed detail is missing, insert a bracketed placeholder like [add the metric] so they can fill it.",
      "- Natural spoken voice, confident but not boastful. Usually 120\u2013220 words.",
      "- Return clean minimal HTML: <p> paragraphs, <strong> for STAR labels or key phrases, <ul><li> for talking points. No markdown, no preamble."
    ].join("\n");
  }
  function iprepAnsUser(q, ctx, jd) {
    return "QUESTION:\n" + q + "\n\n" + (jd ? "TARGET ROLE:\n" + jd.trim() + "\n\n" : "") + "CANDIDATE MATERIAL:\n" + ctx;
  }
  async function iprepResolveJd(raw) {
    var s = String(raw || "").trim();
    if (!s || !/^https?:\/\/\S+$/i.test(s)) return s;
    try {
      var r = await fetch(s);
      if (!r.ok) return s;
      var t = await r.text();
      t = t.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
      return t.length > 300 ? t.slice(0, 4000) : s;
    } catch (e) { return s; }
  }
  function iprepSafeHtml(s) {
    return String(s || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/ on\w+="[^"]*"/gi, "").replace(/ on\w+='[^']*'/gi, "").replace(/javascript:/gi, "");
  }
  /* ---------- tailor to a role: tailored view + cover note + gap analysis ---------- */
  var roleKitState = { level: "staff", jd: "" };
  var roleKitResumeCache = null; // { src, text }
  function rkLevelName(lv) { return ({ senior: "Senior", staff: "Principal / Staff", leader: "Design Leader" })[lv] || "Senior"; }
  function rkCleanHtml(s) { return String(s || "").replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").replace(/```/g, "").trim(); }

  // Whole-portfolio context: projects carry their id, numbers + capabilities carry an index,
  // so the AI can return exactly which to feature (workIds / highlightIdx / capabilityIdx).
  function roleKitContext() {
    var lines = [], L = data.landing || {};
    var about = [L.statement, L.intro, L.aboutLead, L.about, L.aboutSign].map(iprepStrip).filter(Boolean).join(" ");
    if (about) lines.push("# ABOUT ME\n" + about);
    lines.push("\n# PROJECTS (reference by id)");
    (data.work || []).filter(function (w) { return w && !w.encWork; }).forEach(function (w) {
      var st = w.study || {}, bits = [iprepStrip(w.desc)];
      ["tagline", "role", "scope", "timeline"].forEach(function (k) { if (st[k]) bits.push(k + ": " + iprepStrip(st[k])); });
      lines.push("- id=" + w.id + " | " + iprepStrip(w.client) + " \u2014 " + iprepStrip(w.title) + (w.hidden ? " (hidden)" : "") +
        (Array.isArray(w.tags) && w.tags.length ? " | tags: " + w.tags.join(", ") : "") +
        (bits.filter(Boolean).length ? "\n    " + bits.filter(Boolean).join(" \u00b7 ") : ""));
    });
    if (Array.isArray(data.highlights) && data.highlights.length) {
      lines.push("\n# NUMBERS (reference by index)");
      data.highlights.forEach(function (h, i) { lines.push("  [" + i + "] " + iprepStrip(h.value) + " \u2014 " + iprepStrip(h.label)); });
    }
    if (Array.isArray(data.capabilities) && data.capabilities.length) {
      lines.push("\n# CAPABILITIES (reference by index)");
      data.capabilities.forEach(function (c, i) { lines.push("  [" + i + "] " + iprepFlat(c)); });
    }
    if (Array.isArray(data.path) && data.path.length) { lines.push("\n# EXPERIENCE"); data.path.forEach(function (p) { var t = iprepFlat(p); if (t) lines.push("- " + t); }); }
    if (Array.isArray(data.recognition) && data.recognition.length) lines.push("\n# RECOGNITION\n" + data.recognition.map(iprepFlat).filter(Boolean).join("; "));
    if (Array.isArray(data.education) && data.education.length) lines.push("\n# EDUCATION\n" + data.education.map(iprepFlat).filter(Boolean).join("; "));
    var txt = lines.filter(Boolean).join("\n");
    return txt.length > 11000 ? txt.slice(0, 11000) + "\u2026" : txt;
  }
  // Pull the r\u00e9sum\u00e9 text (from Contact) so the cover note & gap analysis can use it. Best-effort.
  async function roleKitResume() {
    var src = (data.contact && data.contact.resume) || "";
    if (!src) return "";
    if (roleKitResumeCache && roleKitResumeCache.src === src) return roleKitResumeCache.text;
    var text = "";
    try {
      var url = (typeof previewSrc === "function") ? previewSrc(src) : src;
      var res = await fetch(url);
      var blob = await res.blob();
      var name = (src.split("?")[0].split("/").pop()) || "resume.pdf";
      if (!/\.(pdf|docx?|txt|md)$/i.test(name)) name += (blob.type === "application/pdf" ? ".pdf" : ".txt");
      text = ((await fbExtractFile(new File([blob], name, { type: blob.type }))) || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      if (text.length > 6000) text = text.slice(0, 6000) + "\u2026";
    } catch (e) { text = ""; }
    roleKitResumeCache = { src: src, text: text };
    return text;
  }
  function rkTailorSystem(level) {
    return [
      "You are a product-design portfolio strategist. Given a candidate's REAL portfolio (projects with ids, numbered metrics and capabilities) and a target job description, curate the version of their site that lands best for THIS role.",
      "Targeting: " + rkLevelName(level) + ".",
      "Choose and ORDER the most relevant projects (by their exact id), metrics (by index) and capabilities (by index). Prefer 3\u20135 projects, 4\u20136 metrics, 6\u201310 capabilities \u2014 lead with what the role cares about most.",
      "Write a one-line hero eyebrow tailored to the role (e.g. \"Tailored for the Staff Product Designer role \u2014 Growth & AI\"). Classy, not gimmicky. Only name a company if the JD names one.",
      "Use ONLY items that exist in the material. Never invent projects, metrics or capabilities.",
      "Return ONLY valid JSON (no markdown): {\"name\":string,\"audience\":string,\"workIds\":[string],\"highlightIdx\":[number],\"capabilityIdx\":[number],\"why\":string}. \"name\" = short internal label; \"why\" = 1\u20132 sentences on the angle."
    ].join("\n");
  }
  function rkCoverSystem(level) {
    return [
      "You are the candidate, writing a concise, specific cover note (usable as a recruiter message or the top of a cover letter). First person, in their real voice.",
      "Targeting: " + rkLevelName(level) + ".",
      "Ground every claim in their real portfolio + r\u00e9sum\u00e9 \u2014 cite specific work, decisions or metrics. Never invent facts, employers or numbers.",
      "Open with a hook tied to the role, connect 2\u20133 concrete proof points to what the role needs, and close with a confident, warm line. 130\u2013200 words. Avoid bracketed placeholders unless truly needed.",
      "Return clean minimal HTML only: <p> paragraphs, <strong> for key phrases. No markdown, no preamble, no subject line."
    ].join("\n");
  }
  function rkGapSystem(level) {
    return [
      "You are a candid, experienced design hiring manager. Compare the candidate's portfolio + r\u00e9sum\u00e9 against the target role and give an honest read \u2014 helpful, not flattering.",
      "Targeting: " + rkLevelName(level) + ".",
      "Use ONLY their real material; never assume unstated experience. When something is missing or thin, say so and give a concrete fix.",
      "Return ONLY valid JSON (no markdown): {\"fit\":\"strong\"|\"solid\"|\"stretch\",\"summary\":string,\"strengths\":[{\"point\":string,\"evidence\":string}],\"gaps\":[{\"point\":string,\"fix\":string}],\"talkingPoints\":[string]}.",
      "\"evidence\" cites a real project/metric. \"fix\" is a concrete action (e.g. \"add the outcome metric to the Edge onboarding study\" or \"reframe the Xbox work around strategy, not screens\"). 3\u20135 strengths, 3\u20135 gaps, 3\u20134 talking points."
    ].join("\n");
  }
  function rkUser(ctx, jd, resume) {
    return "TARGET JOB DESCRIPTION:\n" + (jd || "(none provided)") +
      "\n\nMY R\u00c9SUM\u00c9:\n" + (resume ? resume : "(no r\u00e9sum\u00e9 attached)") +
      "\n\nMY PORTFOLIO:\n" + ctx;
  }
  function rkRenderTailor(t) {
    var byId = {}; (data.work || []).forEach(function (w) { byId[w.id] = w; });
    var works = (t.workIds || []).map(function (id) { return byId[id]; }).filter(Boolean);
    var highs = (t.highlightIdx || []).map(function (i) { return (data.highlights || [])[i]; }).filter(Boolean);
    var caps = (t.capabilityIdx || []).map(function (i) { return (data.capabilities || [])[i]; }).filter(Boolean);
    var h = '<div class="rolekit__tailor">';
    h += '<div class="rolekit__lead"><span class="rolekit__lead-k">Hero eyebrow</span><span class="rolekit__lead-v">' + escHtml(t.audience || "\u2014") + "</span></div>";
    if (t.why) h += '<div class="rolekit__why">' + escHtml(t.why) + "</div>";
    h += '<div class="rolekit__pick"><span class="rolekit__pick-h">Featured work \u00b7 ' + works.length + "</span><ol>" + works.map(function (w) { return "<li>" + escHtml((w.client ? w.client + " \u2014 " : "") + (w.title || w.id)) + "</li>"; }).join("") + "</ol></div>";
    if (highs.length) h += '<div class="rolekit__pick"><span class="rolekit__pick-h">Numbers</span><div class="rolekit__chips">' + highs.map(function (x) { return '<span class="rolekit__chip">' + escHtml((x.value || "") + " \u00b7 " + (x.label || "")) + "</span>"; }).join("") + "</div></div>";
    if (caps.length) h += '<div class="rolekit__pick"><span class="rolekit__pick-h">Capabilities</span><div class="rolekit__chips">' + caps.map(function (c) { return '<span class="rolekit__chip">' + escHtml(iprepFlat(c)) + "</span>"; }).join("") + "</div></div>";
    h += '<div class="rolekit__act"><button class="btn btn--primary" data-rk-createview>Create this Special View \u2192</button><span class="af__hint">Adds it to Special Views \u2014 set a ticket &amp; publish to share.</span></div></div>';
    return h;
  }
  function rkRenderCover(html) {
    return '<div class="rolekit__cover"><div class="rolekit__cover-body">' + html + '</div><div class="rolekit__act"><button class="btn btn--ghost" data-rk-copy>Copy</button></div></div>';
  }
  function rkRenderGap(gp) {
    var fit = String(gp.fit || "solid").toLowerCase();
    var fitLabel = { strong: "Strong fit", solid: "Solid fit", stretch: "A stretch" }[fit] || "Read";
    var h = '<div class="rolekit__gap"><div class="rolekit__fit rolekit__fit--' + fit + '">' + escHtml(fitLabel) + "</div>";
    if (gp.summary) h += '<p class="rolekit__gap-sum">' + escHtml(gp.summary) + "</p>";
    if (Array.isArray(gp.strengths) && gp.strengths.length) h += '<div class="rolekit__gap-grp"><span class="rolekit__gap-h rolekit__gap-h--good">Strengths</span>' + gp.strengths.map(function (s) { return '<div class="rolekit__gap-row"><div class="rolekit__gap-pt">' + escHtml(s.point || "") + "</div>" + (s.evidence ? '<div class="rolekit__gap-ev">' + escHtml(s.evidence) + "</div>" : "") + "</div>"; }).join("") + "</div>";
    if (Array.isArray(gp.gaps) && gp.gaps.length) h += '<div class="rolekit__gap-grp"><span class="rolekit__gap-h rolekit__gap-h--warn">Gaps to close</span>' + gp.gaps.map(function (s) { return '<div class="rolekit__gap-row"><div class="rolekit__gap-pt">' + escHtml(s.point || "") + "</div>" + (s.fix ? '<div class="rolekit__gap-fix"><b>Fix:</b> ' + escHtml(s.fix) + "</div>" : "") + "</div>"; }).join("") + "</div>";
    if (Array.isArray(gp.talkingPoints) && gp.talkingPoints.length) h += '<div class="rolekit__gap-grp"><span class="rolekit__gap-h">Talking points</span><ul class="rolekit__tp">' + gp.talkingPoints.map(function (t) { return "<li>" + escHtml(t) + "</li>"; }).join("") + "</ul></div>";
    return h + "</div>";
  }
  function rkCreateView(t, closeFn) {
    if (!t) return;
    data.specialViews = data.specialViews || [];
    if (data.specialViews.length >= 6) { status("You already have 6 special views \u2014 remove one first.", false); return; }
    var wIds = (t.workIds || []).filter(function (id) { return (data.work || []).some(function (w) { return w.id === id; }); });
    var hIdx = (t.highlightIdx || []).map(Number).filter(function (n) { return n >= 0 && n < (data.highlights || []).length; });
    var cIdx = (t.capabilityIdx || []).map(Number).filter(function (n) { return n >= 0 && n < (data.capabilities || []).length; });
    var sv = blankSv();
    sv.name = String(t.name || "Tailored role").slice(0, 60);
    sv.audience = String(t.audience || "").slice(0, 120);
    if (wIds.length) sv.workIds = wIds;
    if (hIdx.length) sv.highlightIdx = hIdx;
    if (cIdx.length) sv.capabilityIdx = cIdx;
    data.specialViews.push(sv);
    saveDraft(true);
    if (openStudy >= 0) closeL2({ render: false });
    activeTab = "special";
    renderBody();
    if (typeof closeFn === "function") closeFn();
    status("Tailored view created \u2014 set a ticket phrase &amp; publish to share it.", true);
  }
  function roleKitModal() {
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { roleKitModal(); }); return; }
    var g = roleKitState;
    var out = {}, ctxCache = null, jdCache = "", resumeCache = null;
    var hasResume = !!(data.contact && data.contact.resume);
    var modal = document.createElement("div");
    modal.className = "pass pass--wide rolekit-modal";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">\uD83C\uDFAF Tailor to a role</div>' +
      '<div class="pass__sub">Paste a job description \u2014 I\u2019ll read your r\u00e9sum\u00e9 and portfolio, then give you a tailored view of your work, a cover note, and an honest gap analysis.</div>' +
      '<div class="rolekit__setup">' +
        '<div class="af"><label class="af__label">Targeting</label><div class="iprep__levels">' +
          IPREP_LEVELS.map(function (l) { return '<button type="button" class="iprep__lvl' + (g.level === l[0] ? " is-on" : "") + '" data-rk-lvl="' + l[0] + '"><span class="iprep__lvl-name">' + l[1] + '</span><span class="iprep__lvl-desc">' + l[2] + "</span></button>"; }).join("") +
        "</div></div>" +
        '<div class="af"><label class="af__label">Job description</label><textarea id="rkJd" rows="5" placeholder="Paste the JD text (or a link, or add a file)\u2026">' + escHtml(g.jd || "") + "</textarea>" +
        '<div class="af__hint">A link is sent as context (job sites often block reading \u2014 paste the text for best results). <button class="iprep__filebtn" data-rk-file type="button">Add PDF / Word / text\u2026</button></div></div>' +
        '<div class="rolekit__resume">' + (hasResume ? "\u2713 Using your r\u00e9sum\u00e9 from Contact." : "No r\u00e9sum\u00e9 attached \u2014 add one under Contact for a sharper cover note &amp; gap analysis.") + "</div>" +
      "</div>" +
      '<div class="rolekit__tabs" hidden>' +
        '<button type="button" class="rolekit__tab" data-rk-tab="tailor">Tailored work</button>' +
        '<button type="button" class="rolekit__tab" data-rk-tab="cover">Cover note</button>' +
        '<button type="button" class="rolekit__tab" data-rk-tab="gap">Gap analysis</button>' +
      "</div>" +
      '<div class="rolekit__out" hidden></div>' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions rolekit__foot">' +
        '<button class="btn btn--ghost" data-cancel>Close</button>' +
        '<button class="btn btn--ghost" data-rk-back hidden><span aria-hidden="true">\u2190</span> Role setup</button>' +
        '<button class="btn btn--auto" data-rk-run="tailor">Tailor my work</button>' +
        '<button class="btn btn--auto" data-rk-run="cover">Cover note</button>' +
        '<button class="btn btn--auto" data-rk-run="gap">Gap analysis</button>' +
      "</div>" +
      '<div class="pass__note">Uses only your own content + r\u00e9sum\u00e9. The cover note &amp; gap analysis are for you \u2014 not published. \u201cCreate view\u201d adds a Special View you can publish.</div></div>';
    document.body.appendChild(modal);
    var err = modal.querySelector(".pass__err");
    var setup = modal.querySelector(".rolekit__setup");
    var tabsBar = modal.querySelector(".rolekit__tabs");
    var outBox = modal.querySelector(".rolekit__out");
    var backBtn = modal.querySelector("[data-rk-back]");
    var runBtns = [].slice.call(modal.querySelectorAll("[data-rk-run]"));
    var jdEl = modal.querySelector("#rkJd");
    var close = function () { g.jd = jdEl.value; modal.remove(); };
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    modal.querySelector("[data-cancel]").addEventListener("click", close);
    modal.querySelectorAll("[data-rk-lvl]").forEach(function (b) { b.addEventListener("click", function () { g.level = b.dataset.rkLvl; modal.querySelectorAll("[data-rk-lvl]").forEach(function (x) { x.classList.toggle("is-on", x === b); }); }); });
    modal.querySelector("[data-rk-file]").addEventListener("click", function () {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = ".pdf,application/pdf,.docx,.txt,.md,.markdown,text/plain";
      inp.onchange = async function () { var f = inp.files && inp.files[0]; if (!f) return; try { var t = ((await fbExtractFile(f)) || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); if (t) { jdEl.value = (jdEl.value.trim() ? jdEl.value.trim() + "\n\n" : "") + t; err.textContent = ""; } } catch (e) { err.textContent = (e && e.message) || "Couldn\u2019t read that file."; } };
      inp.click();
    });
    backBtn.addEventListener("click", function () { setup.hidden = false; tabsBar.hidden = true; outBox.hidden = true; backBtn.hidden = true; runBtns.forEach(function (b) { b.hidden = false; }); err.textContent = ""; });
    function showTab(kind) { modal.querySelectorAll("[data-rk-tab]").forEach(function (t) { t.classList.toggle("is-on", t.dataset.rkTab === kind); }); }
    async function ensureCtx() {
      jdCache = await iprepResolveJd(jdEl.value);
      if (ctxCache == null) ctxCache = roleKitContext();
      if (resumeCache == null) resumeCache = await roleKitResume();
      return { ctx: ctxCache, jd: jdCache, resume: resumeCache };
    }
    async function run(kind) {
      g.jd = jdEl.value;
      if (!jdEl.value.trim()) { err.textContent = "Paste a job description first."; return; }
      err.textContent = "";
      setup.hidden = true; tabsBar.hidden = false; backBtn.hidden = false; runBtns.forEach(function (b) { b.hidden = true; });
      outBox.hidden = false; showTab(kind);
      if (out[kind]) { outBox.innerHTML = out[kind]; outBox.__tailor = out.__tailorData || null; return; }
      outBox.innerHTML = '<div class="rolekit__loading"><span class="rolekit__spin"></span> Reading the role and your work\u2026</div>';
      var tabEl = modal.querySelector('[data-rk-tab="' + kind + '"]'); if (tabEl) tabEl.classList.add("is-busy");
      try {
        var c = await ensureCtx();
        if (kind === "tailor") {
          var t = csgenParse(await aiText(aiCfg("txt"), rkTailorSystem(g.level), rkUser(c.ctx, c.jd, c.resume), { json: true, maxTokens: 1400, temperature: 0.5 }));
          if (!t || !Array.isArray(t.workIds)) throw new Error("Couldn\u2019t tailor that \u2014 try again.");
          out.__tailorData = t; outBox.__tailor = t; out[kind] = rkRenderTailor(t); outBox.innerHTML = out[kind];
        } else if (kind === "cover") {
          var html = await aiText(aiCfg("txt"), rkCoverSystem(g.level), rkUser(c.ctx, c.jd, c.resume), { maxTokens: 800, temperature: 0.6 });
          out[kind] = rkRenderCover(iprepSafeHtml(rkCleanHtml(html))); outBox.innerHTML = out[kind];
        } else {
          var gp = csgenParse(await aiText(aiCfg("txt"), rkGapSystem(g.level), rkUser(c.ctx, c.jd, c.resume), { json: true, maxTokens: 1900, temperature: 0.5 }));
          if (!gp || (!Array.isArray(gp.strengths) && !Array.isArray(gp.gaps))) throw new Error("Couldn\u2019t analyse that \u2014 try again.");
          out[kind] = rkRenderGap(gp); outBox.innerHTML = out[kind];
        }
      } catch (e2) { outBox.innerHTML = '<div class="rolekit__err-in">' + escHtml((e2 && e2.message) || "That didn\u2019t work \u2014 try again.") + "</div>"; }
      if (tabEl) tabEl.classList.remove("is-busy");
    }
    runBtns.forEach(function (b) { b.addEventListener("click", function () { run(b.dataset.rkRun); }); });
    modal.querySelectorAll("[data-rk-tab]").forEach(function (t) { t.addEventListener("click", function () { run(t.dataset.rkTab); }); });
    outBox.addEventListener("click", function (e) {
      if (e.target.closest("[data-rk-createview]")) { rkCreateView(outBox.__tailor, close); return; }
      var cp = e.target.closest("[data-rk-copy]");
      if (cp) { var body = outBox.querySelector(".rolekit__cover-body"); var txt = body ? body.innerText : ""; if (navigator.clipboard && txt) navigator.clipboard.writeText(txt).then(function () { cp.textContent = "Copied"; setTimeout(function () { cp.textContent = "Copy"; }, 1400); }).catch(function () {}); }
    });
  }

  /* ---------- Cover letter builder (paste a job link → personalised letter) ----------
     Sits next to the ATS panel. Reuses the role-kit engine: roleKitContext() (portfolio)
     + roleKitResume() to GROUND the letter in REAL material, IPREP_LEVELS for altitude.
     A job URL is read via a reader service (r.jina.ai) with a paste fallback. All inputs
     and the letter are EPHEMERAL — never written to content.json or published. */
  var clLevel = "staff";
  var clState = { jd: "", url: "", company: "", length: "full" };
  var clLast = "";
  var CL_NL = String.fromCharCode(10);
  function clPanelHtml() {
    var lvls = IPREP_LEVELS.map(function (l) {
      return '<button type="button" class="ats__lvl' + (clLevel === l[0] ? " is-on" : "") + '" data-act="cl-level" data-lvl="' + l[0] + '"><b>' + l[1] + "</b><span>" + l[2] + "</span></button>";
    }).join("");
    return '<div class="cl">' +
      '<div class="ats__head"><span class="ats__badge">CL</span><div><b>Cover letter builder</b><span>Paste a job link (or the description) \u2014 I\u2019ll write a letter grounded in your real work.</span></div></div>' +
      '<div class="ats__levels">' + lvls + "</div>" +
      '<div class="cl__row"><input type="url" class="cl__url" placeholder="Paste the job posting URL\u2026" value="' + escAttr(clState.url) + '" /><button class="btn btn--ghost" type="button" data-act="cl-fetch">Fetch</button></div>' +
      '<textarea class="cl__jd" rows="5" placeholder="\u2026or paste the job description here (best results \u2014 LinkedIn links often need pasting).">' + escHtml(clState.jd) + "</textarea>" +
      '<div class="cl__row2"><input type="text" class="cl__company" placeholder="Company / role (optional, sharpens it)" value="' + escAttr(clState.company) + '" />' +
        '<div class="cl__len"><button type="button" class="cl__lenbtn' + (clState.length === "short" ? " is-on" : "") + '" data-act="cl-length" data-len="short">Short</button><button type="button" class="cl__lenbtn' + (clState.length === "full" ? " is-on" : "") + '" data-act="cl-length" data-len="full">Full</button></div></div>' +
      '<div class="imgblk__row"><button class="btn btn--primary" type="button" data-act="cl-generate">Write my cover letter</button></div>' +
      '<div class="cl__note">A link is read via a reader service (r.jina.ai) to pull the page text \u2014 it\u2019s only your public job post. Nothing here is saved or published; the letter is grounded only in your own content + r\u00e9sum\u00e9.</div>' +
      '<div class="cl__out" data-cl-out></div>' +
      "</div>";
  }
  async function clFetchJd(url) {
    url = String(url || "").trim();
    if (!/^https?:/i.test(url)) throw new Error("Enter a full job URL (starting with http).");
    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 20000);
    try {
      var r = await fetch("https://r.jina.ai/" + url, { signal: ctrl.signal, headers: { "Accept": "text/plain" } });
      if (!r.ok) throw new Error("reader " + r.status);
      var t = ((await r.text()) || "").trim();
      if (t.length < 200) throw new Error("short");
      return t.length > 16000 ? t.slice(0, 16000) : t;
    } catch (e) {
      throw new Error("Couldn\u2019t read that link automatically (job sites often block it) \u2014 paste the description text instead.");
    } finally { clearTimeout(timer); }
  }
  function clSystem(level, length) {
    var words = length === "short" ? "about 180\u2013220 words" : "about 300\u2013360 words";
    return [
      "You are the candidate, writing a COMPLETE, personalised cover letter for a specific role \u2014 first person, in their real voice.",
      "Targeting: " + rkLevelName(level) + ".",
      "Ground EVERY claim in the candidate\u2019s real portfolio + r\u00e9sum\u00e9 below \u2014 cite specific projects, decisions or metrics that match what THIS role needs. Never invent employers, projects, numbers or outcomes. If a specific detail is genuinely missing, use a light bracket like [add metric] sparingly.",
      "Read the job description and mirror its priorities and language (without keyword-stuffing). Name the company and role when they appear in the posting.",
      "Structure: a greeting (use the company name if known, else \u2018Dear Hiring Team\u2019); an opening hook tied to THIS company/role; 2\u20133 short body paragraphs, each connecting one concrete proof point to a need in the JD; a short paragraph on why this company specifically; a warm, confident close; and a sign-off with the candidate\u2019s name from their material (else \u2018[Your name]\u2019).",
      "Voice: senior, warm, specific, human. No clich\u00e9s, no \u2018I am writing to apply\u2019, no buzzword soup, no AI throat-clearing. Calibrate altitude to the target level.",
      "Length: " + words + ".",
      "Return the letter as PLAIN TEXT only \u2014 real line breaks between paragraphs, no markdown, no bold, no commentary before or after."
    ].join(CL_NL);
  }
  function clUser(ctx, jd, resume, company) {
    return "TARGET JOB DESCRIPTION:" + CL_NL + (jd ? jd.trim() : "(none provided \u2014 write from the company/role hint)") +
      (company ? CL_NL + CL_NL + "COMPANY / ROLE HINT: " + company.trim() : "") +
      CL_NL + CL_NL + "MY R\u00c9SUM\u00c9:" + CL_NL + (resume || "(no r\u00e9sum\u00e9 attached)") +
      CL_NL + CL_NL + "MY PORTFOLIO:" + CL_NL + ctx +
      CL_NL + CL_NL + "Write the full cover letter now.";
  }
  function clRenderHtml(text) {
    var esc = escHtml(String(text || "").trim());
    var lines = esc.split(CL_NL), paras = [], cur = [];
    lines.forEach(function (ln) { if (ln.trim() === "") { if (cur.length) { paras.push(cur.join("<br>")); cur = []; } } else cur.push(ln); });
    if (cur.length) paras.push(cur.join("<br>"));
    var body = paras.map(function (p) { return "<p>" + p + "</p>"; }).join("") || "<p></p>";
    return '<div class="cl__result"><div class="cl__letter">' + body + "</div>" +
      '<div class="cl__acts"><button class="btn btn--ghost" type="button" data-act="cl-copy">Copy</button>' +
      '<button class="btn btn--ghost" type="button" data-act="cl-download">Download .txt</button>' +
      '<button class="btn btn--ghost" type="button" data-act="cl-regen">Regenerate</button></div>' +
      '<div class="af__hint" style="margin-top:.6rem">Review before sending \u2014 grounded in your material; fill any [bracketed] gaps.</div></div>';
  }
  async function clFetchToPanel(panel) {
    if (!panel) return;
    var urlEl = panel.querySelector(".cl__url"), jdEl = panel.querySelector(".cl__jd"), out = panel.querySelector("[data-cl-out]");
    var url = urlEl ? urlEl.value.trim() : "";
    if (!url) { status("Paste a job URL first."); return; }
    if (out) out.innerHTML = '<div class="cl__load"><span class="ats__spin"></span> Reading the job post\u2026</div>';
    try {
      var jd = await clFetchJd(url);
      if (jdEl) jdEl.value = jd; clState.jd = jd; clState.url = url;
      if (out) out.innerHTML = '<div class="cl__ok">\u2713 Pulled the job text \u2014 review it below, then write the letter.</div>';
      status("Job post read.", true);
    } catch (e) {
      if (out) out.innerHTML = '<div class="ats__err">' + escHtml((e && e.message) || "Couldn\u2019t read that link.") + "</div>";
      status("Couldn\u2019t read that link.");
    }
  }
  async function clRun(panel, variant) {
    if (!panel) return;
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { clRun(panel, variant); }); return; }
    var urlEl = panel.querySelector(".cl__url"), jdEl = panel.querySelector(".cl__jd"), coEl = panel.querySelector(".cl__company");
    var out = panel.querySelector("[data-cl-out]");
    clState.url = urlEl ? urlEl.value.trim() : "";
    clState.jd = jdEl ? jdEl.value.trim() : "";
    clState.company = coEl ? coEl.value.trim() : "";
    var btn = panel.querySelector('[data-act="cl-generate"]');
    var was = btn ? btnBusy(btn, "Writing\u2026") : null;
    try {
      var jd = clState.jd;
      if (!jd && clState.url) {
        if (out) out.innerHTML = '<div class="cl__load"><span class="ats__spin"></span> Reading the job post\u2026</div>';
        jd = await clFetchJd(clState.url);
        if (jdEl) jdEl.value = jd; clState.jd = jd;
      }
      if (!jd && !clState.company) throw new Error("Paste the job description (or a link, or at least the company/role).");
      if (out) out.innerHTML = '<div class="cl__load"><span class="ats__spin"></span> Writing a letter grounded in your work\u2026</div>';
      var ctx = roleKitContext();
      var resume = await roleKitResume();
      var text = await aiText(aiCfg("txt"), clSystem(clLevel, clState.length), clUser(ctx, jd, resume, clState.company), { maxTokens: 1200, temperature: variant ? 0.85 : 0.6 });
      text = String(text || "").replace(/^```[a-z]*/i, "").replace(/```$/, "").trim();
      if (!text) throw new Error("The letter came back empty \u2014 try again.");
      clLast = text;
      if (out) out.innerHTML = clRenderHtml(text);
      status("Cover letter ready.", true);
    } catch (e) {
      if (out) out.innerHTML = '<div class="ats__err">' + escHtml((e && e.message) || String(e)) + "</div>";
      status("Cover letter failed.");
    } finally { if (btn) btnIdle(btn, was); }
  }
  function clDownload() {
    if (!clLast) { status("Write a letter first."); return; }
    var blob = new Blob([clLast], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a"), url = URL.createObjectURL(blob);
    a.href = url; a.download = "cover-letter.txt"; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function iprepModal(i) {
    var fromAi = (i == null);
    var w = fromAi ? null : data.work[i]; if (!fromAi && !w) return;
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { iprepModal(i); }); return; }
    var aiWorks = (data.work || []).filter(function (x) { return x && !x.encWork; });
    if (fromAi && !aiWorks.length) return;
    var g = iprepSt(fromAi ? "__ai__" : w.id);
    var questions = [];
    var modal = document.createElement("div");
    modal.className = "pass pass--wide iprep-modal";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">\uD83C\uDF99 Interview prep' + (fromAi ? "" : " \u2014 " + escHtml(w.title || "case study")) + '</div>' +
      '<div class="pass__sub">Generate the questions an interviewer is likely to ask' + (fromAi ? " \u2014 on a project, a few, or your whole portfolio" : " about this work") + ', framed for the level you\u2019re targeting. Ask for a suggested answer on any question.</div>' +
      '<div class="iprep__setup">' +
        '<div class="af"><label class="af__label">Interviewing for</label><div class="iprep__levels">' +
          IPREP_LEVELS.map(function (l) { return '<button type="button" class="iprep__lvl' + (g.level === l[0] ? " is-on" : "") + '" data-iprep-lvl="' + l[0] + '"><span class="iprep__lvl-name">' + l[1] + '</span><span class="iprep__lvl-desc">' + l[2] + '</span></button>'; }).join("") +
        '</div></div>' +
        (fromAi
          ? '<div class="af"><label class="af__label">Focus <span class="af__opt">(tick projects \u2014 leave all unticked for your whole portfolio)</span></label><div class="iprep__projs">' + aiWorks.map(function (x, idx) { return '<label class="chk"><input type="checkbox" data-iprep-proj value="' + idx + '" /> ' + escHtml(x.title || ("Project " + (idx + 1))) + "</label>"; }).join("") + "</div></div>" +
            '<div class="af__row"><div class="af"><label class="af__label">How many</label><select id="iprepCount"><option>6</option><option selected>10</option><option>14</option></select></div><div class="af"></div></div>'
          : '<div class="af__row">' +
              '<div class="af"><label class="af__label">Focus</label><select id="iprepScope"><option value="study"' + (g.scope === "study" ? " selected" : "") + '>This case study (deep dive)</option><option value="portfolio"' + (g.scope === "portfolio" ? " selected" : "") + '>Whole portfolio</option></select></div>' +
              '<div class="af"><label class="af__label">How many</label><select id="iprepCount"><option>6</option><option selected>10</option><option>14</option></select></div>' +
            "</div>") +
        '<div class="af"><label class="af__label">Target role or job description <span class="af__opt">(optional)</span></label><textarea id="iprepJd" rows="3" placeholder="Paste a role title, the JD text, or a link\u2026">' + escHtml(g.jd || "") + '</textarea>' +
        '<div class="af__hint">A link is sent as context (job sites often block reading \u2014 paste the text for best results). <button class="iprep__filebtn" data-iprep-file type="button">Add PDF / Word / text\u2026</button></div></div>' +
      '</div>' +
      '<div class="iprep__list" hidden></div>' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions iprep__foot">' +
        '<button class="btn btn--ghost" data-cancel>Close</button>' +
        '<button class="btn btn--ghost" data-iprep-new hidden>\u2190 New set</button>' +
        '<button class="btn btn--auto" data-iprep-run>Generate questions</button>' +
      '</div>' +
      '<div class="pass__note">A prep tool only \u2014 nothing here is saved to or published on your site. Answers use only your own content.</div></div>';
    document.body.appendChild(modal);
    var err = modal.querySelector(".pass__err");
    var setup = modal.querySelector(".iprep__setup");
    var list = modal.querySelector(".iprep__list");
    var runBtn = modal.querySelector("[data-iprep-run]");
    var newBtn = modal.querySelector("[data-iprep-new]");
    var jdEl = modal.querySelector("#iprepJd");
    var close = function () { g.jd = jdEl.value; modal.remove(); };
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    modal.querySelector("[data-cancel]").addEventListener("click", close);
    modal.querySelectorAll("[data-iprep-lvl]").forEach(function (btn) {
      btn.addEventListener("click", function () { g.level = btn.dataset.iprepLvl; modal.querySelectorAll("[data-iprep-lvl]").forEach(function (b2) { b2.classList.toggle("is-on", b2 === btn); }); });
    });
    modal.querySelector("[data-iprep-file]").addEventListener("click", function () {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = ".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,.md,.markdown,text/plain";
      inp.onchange = async function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        try { var t = ((await fbExtractFile(f)) || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); if (t) { jdEl.value = (jdEl.value.trim() ? jdEl.value.trim() + "\n\n" : "") + t; err.textContent = ""; } } catch (e) { err.textContent = (e && e.message) || "Couldn\u2019t read that file."; }
      };
      inp.click();
    });
    newBtn.addEventListener("click", function () { list.hidden = true; setup.hidden = false; newBtn.hidden = true; runBtn.hidden = false; err.textContent = ""; });
    function renderQuestions() {
      list.innerHTML = questions.map(function (q, idx) {
        return '<div class="iprep__card" data-qi="' + idx + '">' +
          '<div class="iprep__q-top"><span class="iprep__cat">' + escHtml(q.category || "Question") + '</span><span class="iprep__n">' + (idx + 1) + "</span></div>" +
          '<div class="iprep__q">' + escHtml(q.q || "") + "</div>" +
          (q.why ? '<div class="iprep__why">' + escHtml(q.why) + "</div>" : "") +
          '<div class="iprep__a" hidden></div>' +
          '<div class="iprep__q-act"><button class="btn btn--ghost" data-iprep-ans="' + idx + '">\u2728 Suggest an answer</button></div>' +
          "</div>";
      }).join("");
      list.hidden = false; setup.hidden = true; runBtn.hidden = true; newBtn.hidden = false;
    }
    runBtn.addEventListener("click", async function () {
      err.textContent = "";
      g.jd = jdEl.value;
      var n = +modal.querySelector("#iprepCount").value || 10;
      btnBusy(runBtn, "Thinking\u2026");
      try {
        var ctx;
        if (fromAi) {
          var picked = [].slice.call(modal.querySelectorAll("[data-iprep-proj]:checked")).map(function (cb) { return aiWorks[+cb.value]; }).filter(Boolean);
          ctx = iprepAiContext(picked.length ? picked : aiWorks, picked.length === 0);
        } else {
          g.scope = modal.querySelector("#iprepScope").value;
          ctx = iprepContext(w, g.scope);
        }
        var jd = await iprepResolveJd(jdEl.value);
        var obj = csgenParse(await aiText(aiCfg("txt"), iprepSystem(g.level), iprepQUser(ctx, jd, n), { json: true, maxTokens: 2600, temperature: 0.75 }));
        var raw = obj && Array.isArray(obj.questions) ? obj.questions : (Array.isArray(obj) ? obj : null);
        if (!raw || !raw.length) throw new Error("The AI didn\u2019t return questions \u2014 try again.");
        questions = raw.map(function (q) { return typeof q === "string" ? { q: q } : (q && typeof q.q === "string" ? { q: q.q, category: q.category, why: q.why } : null); }).filter(Boolean);
        g.__ctx = ctx; g.__jd = jd;
        renderQuestions();
      } catch (e) { err.textContent = (e && e.message) || "Couldn\u2019t generate questions."; }
      btnIdle(runBtn, "Generate questions");
    });
    list.addEventListener("click", async function (e) {
      var btn = e.target.closest("[data-iprep-ans]"); if (!btn) return;
      var idx = +btn.dataset.iprepAns; var q = questions[idx]; if (!q) return;
      var card = list.querySelector('.iprep__card[data-qi="' + idx + '"]'); if (!card) return;
      var ansEl = card.querySelector(".iprep__a");
      var was = btnBusy(btn, "Drafting\u2026"); err.textContent = "";
      try {
        var html = await aiText(aiCfg("txt"), iprepAnsSystem(g.level), iprepAnsUser(q.q, g.__ctx || (fromAi ? "" : iprepContext(w, g.scope)), g.__jd || ""), { maxTokens: 900, temperature: 0.6 });
        html = String(html || "").replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
        ansEl.innerHTML = iprepSafeHtml(html); ansEl.hidden = false;
        card.querySelector(".iprep__q-act").innerHTML = '<button class="btn btn--ghost" data-iprep-ans="' + idx + '">\u21bb Regenerate</button><button class="btn btn--ghost" data-iprep-copy="' + idx + '">Copy</button>';
      } catch (e2) { err.textContent = (e2 && e2.message) || "Couldn\u2019t draft an answer."; btnIdle(btn, was); }
    });
    list.addEventListener("click", function (e) {
      var cb = e.target.closest("[data-iprep-copy]"); if (!cb) return;
      var idx = +cb.dataset.iprepCopy; var card = list.querySelector('.iprep__card[data-qi="' + idx + '"]'); if (!card) return;
      var ansEl = card.querySelector(".iprep__a"); var txt = ansEl ? ansEl.innerText : ""; if (!txt) return;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { cb.textContent = "Copied"; setTimeout(function () { cb.textContent = "Copy"; }, 1400); }).catch(function () {});
    });
  }

  /* ---------- Whiteboard coach (design-exercise trainer) ---------- */
  // Rehearse a live whiteboard/app-design exercise: pick a slot (60/45/30) + a mode
  // (Coach = prompt + timed game-plan + feedback on your written approach; Mock = the AI
  // role-plays the interviewer turn-by-turn, then scores you). Prep only, never published.
  var WB_MINS = [
    ["60", "60 min", "Full onsite exercise"],
    ["45", "45 min", "Standard slot"],
    ["30", "30 min", "Tight \u2014 lead with structure"]
  ];
  var WB_MODES = [
    ["coach", "Coach", "Prompt + timed plan, then feedback on your approach"],
    ["mock", "Mock interview", "I play the interviewer \u2014 back-and-forth, then a scorecard"]
  ];
  var WB_LEVELS = [
    ["exec", "VP / Exec", "Outcomes, strategy, business altitude"],
    ["staff", "Staff / Principal", "Ambiguity, systems, cross-team leverage"],
    ["senior", "Senior", "Craft, decisions &amp; the how"]
  ];
  var WB_KEY = "rk:wb";
  var wbState = (function () { try { var o = JSON.parse(localStorage.getItem(WB_KEY)); return (o && typeof o === "object") ? o : {}; } catch (e) { return {}; } })();
  if (!wbState.mins) wbState.mins = "60";
  if (!wbState.mode) wbState.mode = "coach";
  if (!wbState.level) wbState.level = "staff";
  function wbSave() { try { localStorage.setItem(WB_KEY, JSON.stringify({ mins: wbState.mins, mode: wbState.mode, level: wbState.level, brief: wbState.brief || "", company: wbState.company || "", jd: wbState.jd || "" })); } catch (e) {} }
  function wbMinsLabel(m) { for (var i = 0; i < WB_MINS.length; i++) if (WB_MINS[i][0] === m) return WB_MINS[i][1]; return m + " min"; }
  function wbCompany() { return String(wbState.company || "").trim(); }
  function wbJdText() { var t = String(wbState.jd || "").trim(); return t || storyJdText(); }
  function wbLevelMeta(id) { for (var i = 0; i < WB_LEVELS.length; i++) if (WB_LEVELS[i][0] === id) return WB_LEVELS[i]; return null; }
  function wbLevelLine() {
    var l = wbLevelMeta(wbState.level); if (!l) return "";
    var guide = {
      exec: "Calibrate the whole exercise to a VP / Executive design altitude: the prompt and every probe should pull toward business outcomes, strategy, org-level trade-offs and measurable impact \u2014 not pixels. Grade vision, prioritisation and executive-level communication the hardest.",
      staff: "Calibrate the whole exercise to a Staff / Principal altitude: reward navigating ambiguity, systems thinking, cross-team leverage and crisp problem-framing over polished UI. Push hardest on scope, trade-offs and how decisions ripple across teams and surfaces.",
      senior: "Calibrate the whole exercise to a Senior altitude: reward strong craft, sound design decisions and clear reasoning about the how \u2014 solid end-to-end execution with good user focus, structure and communication."
    };
    return "\n\n# LEVEL: " + l[1] + "\n" + (guide[wbState.level] || "");
  }
  function wbRoleLine() {
    var jd = wbJdText(), co = wbCompany();
    var s = wbLevelLine();
    if (!jd && !co) return s;
    s += "\n\n# TARGET";
    if (co) s += "\nCompany: " + co + " \u2014 tailor the exercise to how " + co + " actually runs design interviews at this level: the kind of whiteboard prompt they favour, the structure and answer depth they expect, and the collaboration/interaction they look for in the room.";
    if (jd) s += "\nJob description (what the role demands \u2014 bias the prompt, the probes and the scoring toward these):\n" + jd;
    return s;
  }
  function wbPortfolioHint() {
    var titles = (data.work || []).filter(function (w) { return w && !w.encWork; }).map(function (w) { return w.client || w.title; }).filter(Boolean).slice(0, 6);
    return titles.length ? "\n\nThe candidate's background spans: " + titles.join("; ") + ". A prompt adjacent to (not identical to) these lands best." : "";
  }
  function wbPromptSystem() {
    return [
      "You are a design-interview lead who sets whiteboard / app-design exercises for senior product designers.",
      "Invent ONE crisp, realistic prompt \u2014 an open design challenge (e.g. 'Design a X for Y who need to Z'), the kind given live in an onsite. It must be solvable in the time given, ambiguous enough to explore, and not a trick.",
      "Return ONLY valid JSON (no markdown): {\"prompt\":string,\"context\":string,\"watchfor\":[string]}. context = 1\u20132 lines of setup/constraints the interviewer would say. watchfor = 3\u20134 things the panel is secretly grading."
    ].join("\n");
  }
  function wbPromptUser(mins, brief) {
    return "Time: " + wbMinsLabel(mins) + ".\nDesired flavour / domain (optional): " + (brief || "(you choose \u2014 pick something juicy and current)") + "." + wbRoleLine() + wbPortfolioHint();
  }
  function wbPlanSystem(mins) {
    return [
      "You are an elite design-interview coach. Give a battle-tested GAME PLAN for whiteboarding the given prompt live in " + wbMinsLabel(mins) + ".",
      "Be specific to THIS prompt \u2014 no generic advice. Budget the minutes so they sum to about " + mins + ".",
      "Return ONLY valid JSON (no markdown): {\"clarifiers\":[string],\"assumptions\":[string],\"phases\":[{\"label\":string,\"mins\":string,\"move\":string,\"tip\":string}],\"curveballs\":[{\"q\":string,\"handle\":string}],\"closer\":string}. clarifiers = 3\u20135 sharp questions to ask BEFORE diving in. assumptions = 2\u20133 you'd state and move on. phases = the ordered arc (Clarify \u2192 Users \u2192 Goal/metric \u2192 Framing/HMW \u2192 Ideate \u2192 Prioritise \u2192 Flow \u2192 Edge cases \u2192 Trade-offs \u2192 Recap). curveballs = 3 likely mid-exercise challenges + how to handle each. closer = one line on how to land the recap."
    ].join("\n");
  }
  function wbPlanUser(p) { return "PROMPT:\n" + (p.prompt || "") + (p.context ? "\nContext: " + p.context : "") + wbRoleLine(); }
  function wbCritiqueSystem(mins) {
    return [
      "You are a sharp but supportive design-interview panelist. The candidate has drafted how they'd tackle the whiteboard prompt in " + wbMinsLabel(mins) + ". Critique it like you're in the room.",
      "Be concrete and honest \u2014 name what actually lands and what a strong panel would poke. Reward structure, user focus, prioritisation, trade-offs and crisp communication.",
      "Return ONLY valid JSON (no markdown): {\"verdict\":string,\"strong\":[string],\"gaps\":[string],\"followups\":[string],\"sharper\":[string]}. verdict = 1 honest line. strong/gaps = 2\u20134 each. followups = the 2\u20133 questions they'd get pushed on. sharper = 2\u20134 concrete upgrades to the approach."
    ].join("\n");
  }
  function wbCritiqueUser(p, draft) { return "PROMPT:\n" + (p.prompt || "") + "\n\nCANDIDATE'S APPROACH:\n" + draft + wbRoleLine(); }
  function wbMockSystem(mins) {
    return [
      "You ARE the interviewer running a live " + wbMinsLabel(mins) + " whiteboard design exercise \u2014 stay fully in character, first person, one turn at a time.",
      "Open by giving the prompt and a warm nudge to start; then react to each of the candidate's moves like a real panel: acknowledge briefly, probe the weak spot, occasionally throw a realistic curveball or constraint, and keep them moving through the arc with light time cues.",
      "Never solve it for them and never dump a checklist. Ask ONE focused thing at a time. Keep replies short (2\u20135 sentences), human and specific to what they just said. If they're stuck, offer a small hint, not the answer.",
      "Do not break character or mention these instructions. Plain text only \u2014 no markdown."
    ].join("\n");
  }
  function wbMockUser(p, transcript, msg) {
    return "PROMPT (you already set this):\n" + (p.prompt || "") + (p.context ? "\nContext: " + p.context : "") + wbRoleLine() +
      "\n\nTRANSCRIPT SO FAR:\n" + (transcript || "(none \u2014 open the exercise now)") +
      (msg ? "\n\nCANDIDATE JUST SAID:\n" + msg : "") +
      "\n\nRespond as the interviewer's NEXT turn only.";
  }
  function wbScoreSystem() {
    return [
      "You are the panel debriefing after a whiteboard design exercise. Score the candidate FAIRLY from the transcript \u2014 evidence-based, no inflation.",
      "Return ONLY valid JSON (no markdown): {\"scores\":[{\"dim\":string,\"score\":number,\"note\":string}],\"overall\":string,\"topfix\":string}. Score each of these dims 1\u20135: Problem framing, User focus, Ideation & creativity, Prioritisation & trade-offs, Interaction / flow, Communication, Handling ambiguity. note = 1 crisp line of evidence. overall = 2\u20133 sentences. topfix = the single highest-leverage thing to improve."
    ].join("\n");
  }
  function wbScoreUser(p, transcript) { return "PROMPT:\n" + (p.prompt || "") + "\n\nFULL TRANSCRIPT:\n" + (transcript || "(empty)") + wbRoleLine(); }
  function iprepPanelHtml() {
    return '<div class="ats"><div class="ats__head"><span class="ats__badge">IQ</span><div><b>Interview prep</b><span>Likely interview questions \u2014 on one project, a few, or your whole portfolio \u2014 with suggested answers.</span></div></div><div class="imgblk__row"><button class="btn btn--primary" type="button" data-act="iprep-open-ai">Open interview prep</button></div></div>';
  }
  function storyPanelHtml() {
    return '<div class="ats"><div class="ats__head"><span class="ats__badge">DS</span><div><b>Design storyteller</b><span>Turn a case study into a presentation \u2014 pick the project, then get story angles, a script and the questions it invites.</span></div></div><div class="imgblk__row"><button class="btn btn--primary" type="button" data-act="story-open-ai">Open design storyteller</button></div></div>';
  }
  function wbPanelHtml() {
    return '<div class="ats wb-card">' +
      '<div class="ats__head"><span class="ats__badge">WB</span><div><b>Whiteboard coach</b><span>Rehearse the live design exercise \u2014 a role-tailored prompt, a timed game-plan, then coaching or a mock interview.</span></div></div>' +
      '<div class="imgblk__row"><button class="btn btn--primary" type="button" data-act="wb-open">Open whiteboard coach</button></div>' +
      "</div>";
  }
  function wbList(arr) { return (arr || []).map(function (x) { return "<li>" + escHtml(x) + "</li>"; }).join(""); }
  function wbPromptCard(p) {
    return '<div class="wb__prompt"><span class="wb__prompt-k">Your prompt</span><div class="wb__prompt-t">' + escHtml(p.prompt || "") + "</div>" +
      (p.context ? '<div class="wb__prompt-c">' + escHtml(p.context) + "</div>" : "") +
      ((p.watchfor && p.watchfor.length) ? '<div class="wb__watch"><span>Panel is grading</span> ' + p.watchfor.map(function (x) { return escHtml(x); }).join(" \u00b7 ") + "</div>" : "") +
      '<button class="btn btn--ghost btn--auto wb__newp" type="button" data-wb-newprompt>\u21bb New prompt</button></div>';
  }
  function wbPlanCard(pl, mins) {
    pl = pl || {};
    var phases = (pl.phases || []).map(function (ph) {
      return '<div class="wb__phase"><div class="wb__phase-t"><span class="wb__phase-m">' + escHtml(String(ph.mins || "\u2022")) + "<small>min</small></span><b>" + escHtml(ph.label || "") + "</b></div>" +
        (ph.move ? '<div class="wb__phase-move">' + escHtml(ph.move) + "</div>" : "") +
        (ph.tip ? '<div class="wb__phase-tip">' + escHtml(ph.tip) + "</div>" : "") + "</div>";
    }).join("");
    var curve = (pl.curveballs || []).map(function (c) { return '<div class="wb__curve"><b>' + escHtml(c.q || "") + "</b>" + (c.handle ? "<span>" + escHtml(c.handle) + "</span>" : "") + "</div>"; }).join("");
    return '<div class="wb__plan">' +
      ((pl.clarifiers && pl.clarifiers.length) ? '<div class="wb__block"><h4>Clarify first \u2014 ask</h4><ul>' + wbList(pl.clarifiers) + "</ul></div>" : "") +
      ((pl.assumptions && pl.assumptions.length) ? '<div class="wb__block"><h4>State &amp; move on \u2014 assume</h4><ul>' + wbList(pl.assumptions) + "</ul></div>" : "") +
      (phases ? '<div class="wb__block"><h4>The arc \u00b7 ' + escHtml(wbMinsLabel(mins)) + '</h4><div class="wb__phases">' + phases + "</div></div>" : "") +
      (curve ? '<div class="wb__block"><h4>Curveballs to expect</h4>' + curve + "</div>" : "") +
      (pl.closer ? '<div class="wb__closer"><span>Land it</span> ' + escHtml(pl.closer) + "</div>" : "") +
      "</div>";
  }
  function wbDraftCard() {
    return '<div class="wb__draftwrap"><h4>Rehearse \u2014 draft your approach</h4>' +
      '<textarea class="cl__jd wb__draft" rows="6" placeholder="Talk through how you\u2019d attack it \u2014 clarifiers, users, goal, a couple of ideas, what you\u2019d prioritise and why, the core flow, edge cases, trade-offs\u2026"></textarea>' +
      '<div class="imgblk__row"><button class="btn btn--primary" type="button" data-wb-critique>Get coaching</button></div>' +
      '<div class="wb__crit"></div></div>';
  }
  function wbCritiqueHtml(c) {
    c = c || {};
    return '<div class="wb__feedback">' +
      (c.verdict ? '<div class="wb__verdict">' + escHtml(c.verdict) + "</div>" : "") +
      ((c.strong && c.strong.length) ? '<div class="wb__fb wb__fb--good"><h5>What lands</h5><ul>' + wbList(c.strong) + "</ul></div>" : "") +
      ((c.gaps && c.gaps.length) ? '<div class="wb__fb wb__fb--gap"><h5>What a panel would poke</h5><ul>' + wbList(c.gaps) + "</ul></div>" : "") +
      ((c.followups && c.followups.length) ? '<div class="wb__fb"><h5>Be ready for</h5><ul>' + wbList(c.followups) + "</ul></div>" : "") +
      ((c.sharper && c.sharper.length) ? '<div class="wb__fb wb__fb--up"><h5>Sharper</h5><ul>' + wbList(c.sharper) + "</ul></div>" : "") +
      "</div>";
  }
  function wbScoreHtml(s) {
    s = s || {};
    var rows = (s.scores || []).map(function (r) {
      var n = Math.max(0, Math.min(5, Math.round(+r.score || 0)));
      return '<div class="wb__score"><div class="wb__score-h"><b>' + escHtml(r.dim || "") + '</b><span class="wb__dots">' + wbRepeat("\u25CF", n) + wbRepeat("\u25CB", 5 - n) + "</span></div>" + (r.note ? '<div class="wb__score-n">' + escHtml(r.note) + "</div>" : "") + "</div>";
    }).join("");
    return '<div class="wb__scorecard"><h4>Scorecard</h4>' + rows +
      (s.overall ? '<div class="wb__overall">' + escHtml(s.overall) + "</div>" : "") +
      (s.topfix ? '<div class="wb__topfix"><span>Fix this first</span> ' + escHtml(s.topfix) + "</div>" : "") + "</div>";
  }
  function wbRepeat(ch, n) { var s = ""; for (var i = 0; i < n; i++) s += ch; return s; }
  function wbModal() {
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { wbModal(); }); return; }
    var st = wbState; if (!st.mins) st.mins = "60"; if (!st.mode) st.mode = "coach"; if (!st.level) st.level = "staff";
    var prompt = null, transcript = "";
    var modal = document.createElement("div");
    modal.className = "pass pass--wide wb-modal";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">\uD83E\uDDE9 Whiteboard coach</div>' +
      '<div class="pass__sub">Rehearse a live design exercise. Pick the length and a mode \u2014 I\u2019ll set a realistic prompt' + (storyJdText() ? " tailored to your target role" : "") + ", give you a timed game-plan, then coach you or run a mock.</div>" +
      '<div class="wb__setup">' +
        '<div class="af"><label class="af__label">How long is the exercise</label><div class="story__opts wb__opts3">' +
          WB_MINS.map(function (d) { return '<button type="button" class="story__opt' + (st.mins === d[0] ? " is-on" : "") + '" data-wb-mins="' + d[0] + '"><span class="story__opt-name">' + d[1] + '</span><span class="story__opt-desc">' + d[2] + "</span></button>"; }).join("") +
        "</div></div>" +
        '<div class="af"><label class="af__label">Mode</label><div class="story__opts">' +
          WB_MODES.map(function (d) { return '<button type="button" class="story__opt' + (st.mode === d[0] ? " is-on" : "") + '" data-wb-mode="' + d[0] + '"><span class="story__opt-name">' + d[1] + '</span><span class="story__opt-desc">' + d[2] + "</span></button>"; }).join("") +
        "</div></div>" +
        '<div class="af"><label class="af__label">The level you\u2019re whiteboarding for</label><div class="iprep__levels wb__levels">' +
          WB_LEVELS.map(function (d) { return '<button type="button" class="iprep__lvl' + (st.level === d[0] ? " is-on" : "") + '" data-wb-lvl="' + d[0] + '"><span class="iprep__lvl-name">' + d[1] + '</span><span class="iprep__lvl-desc">' + d[2] + "</span></button>"; }).join("") +
        '</div><div class="af__hint">Sets the altitude \u2014 the prompt, the probes and the scoring all shift to match.</div></div>' +
        '<div class="af"><label class="af__label">Company &amp; job description <span class="af__opt">(optional)</span></label>' +
          '<input type="text" class="wb__company" placeholder="Company you\u2019re interviewing at \u2014 e.g. Stripe, Google\u2026" value="' + escAttr(st.company || "") + '" />' +
          '<textarea class="cl__jd wb__jd" rows="4" placeholder="Paste the job description \u2014 I\u2019ll bias the prompt, the probes and the scoring toward what the role demands.">' + escHtml(st.jd || "") + '</textarea>' +
          '<div class="af__hint">Company \u2192 I match how they interview at this level (prompt type, answer depth, collaboration). ' + (storyJdText() ? 'Leave the description blank to reuse your \u201cAlign to a role\u201d target from the storyteller.' : 'Both optional.') + '</div>' +
        "</div>" +
        '<div class="af"><label class="af__label">Flavour / your own prompt (optional)</label>' +
          '<input type="text" class="wb__brief" placeholder="Domain or product to riff on \u2014 e.g. fintech onboarding, transit app\u2026" value="' + escAttr(st.brief || "") + '" />' +
          '<textarea class="cl__jd wb__own" rows="3" placeholder="\u2026or paste a specific prompt to use verbatim (leave blank and I\u2019ll invent one)."></textarea>' +
        "</div>" +
      "</div>" +
      '<div class="wb__stage" hidden></div>' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions wb__foot">' +
        '<button class="btn btn--ghost" data-cancel>Close</button>' +
        '<button class="btn btn--ghost" data-wb-back hidden>\u2190 Change setup</button>' +
        '<button class="btn btn--auto" data-wb-start>Start</button>' +
      "</div>" +
      '<div class="pass__note">A prep tool only \u2014 nothing here is saved to or published on your site.</div></div>';
    document.body.appendChild(modal);
    var err = modal.querySelector(".pass__err");
    var setup = modal.querySelector(".wb__setup");
    var stage = modal.querySelector(".wb__stage");
    var startBtn = modal.querySelector("[data-wb-start]");
    var backBtn = modal.querySelector("[data-wb-back]");
    var briefEl = modal.querySelector(".wb__brief");
    var ownEl = modal.querySelector(".wb__own");
    var companyEl = modal.querySelector(".wb__company");
    var jdEl = modal.querySelector(".wb__jd");
    var close = function () { modal.remove(); };
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    modal.querySelector("[data-cancel]").addEventListener("click", close);
    modal.querySelectorAll("[data-wb-mins]").forEach(function (b) { b.addEventListener("click", function () { st.mins = b.dataset.wbMins; modal.querySelectorAll("[data-wb-mins]").forEach(function (x) { x.classList.toggle("is-on", x === b); }); wbSave(); }); });
    modal.querySelectorAll("[data-wb-mode]").forEach(function (b) { b.addEventListener("click", function () { st.mode = b.dataset.wbMode; modal.querySelectorAll("[data-wb-mode]").forEach(function (x) { x.classList.toggle("is-on", x === b); }); wbSave(); }); });
    modal.querySelectorAll("[data-wb-lvl]").forEach(function (b) { b.addEventListener("click", function () { st.level = b.dataset.wbLvl; modal.querySelectorAll("[data-wb-lvl]").forEach(function (x) { x.classList.toggle("is-on", x === b); }); wbSave(); }); });
    if (briefEl) briefEl.addEventListener("input", function () { st.brief = briefEl.value; wbSave(); });
    if (companyEl) companyEl.addEventListener("input", function () { st.company = companyEl.value; wbSave(); });
    if (jdEl) jdEl.addEventListener("input", function () { st.jd = jdEl.value; wbSave(); });
    function showSetup() { setup.hidden = false; stage.hidden = true; backBtn.hidden = true; startBtn.hidden = false; err.textContent = ""; }
    function showStage() { setup.hidden = true; stage.hidden = false; backBtn.hidden = false; startBtn.hidden = true; err.textContent = ""; }
    backBtn.addEventListener("click", showSetup);
    startBtn.addEventListener("click", async function () {
      err.textContent = ""; btnBusy(startBtn, "Setting the prompt\u2026");
      try {
        var own = (ownEl && ownEl.value.trim()) || "";
        if (own) prompt = { prompt: own, context: "", watchfor: [] };
        else prompt = csgenParse(await aiText(aiCfg("txt"), wbPromptSystem(), wbPromptUser(st.mins, st.brief), { json: true, maxTokens: 700, temperature: 0.9 }));
        if (!prompt || !prompt.prompt) throw new Error("Couldn\u2019t set a prompt \u2014 try again.");
        transcript = "";
        showStage();
        if (st.mode === "coach") await wbRunCoach();
        else await wbRunMock(true);
      } catch (e) { err.textContent = (e && e.message) || "Something went wrong \u2014 try again."; showSetup(); }
      btnIdle(startBtn, "Start");
    });
    async function wbRunCoach() {
      stage.innerHTML = wbPromptCard(prompt) + '<div class="wb__loading">Building your game-plan\u2026</div>';
      try {
        var plan = csgenParse(await aiText(aiCfg("txt"), wbPlanSystem(st.mins), wbPlanUser(prompt), { json: true, maxTokens: 2000, temperature: 0.6 }));
        stage.innerHTML = wbPromptCard(prompt) + wbPlanCard(plan, st.mins) + wbDraftCard();
      } catch (e) { stage.innerHTML = wbPromptCard(prompt) + wbDraftCard(); err.textContent = (e && e.message) || "Couldn\u2019t build the plan \u2014 you can still rehearse below."; }
      wireStage();
    }
    async function wbRunMock(opening) {
      stage.innerHTML = wbPromptCard(prompt) + '<div class="wb__chat" data-wb-log></div>' +
        '<div class="wb__composer"><textarea class="wb__msg" rows="2" placeholder="Type your next move \u2014 think out loud like you would at the board (\u2318/Ctrl+Enter to send)\u2026"></textarea>' +
        '<div class="wb__composer-act"><button class="btn btn--auto" data-wb-send>Send</button><button class="btn btn--ghost" data-wb-score>Wrap up &amp; score me</button></div></div>';
      wireStage();
      var log = stage.querySelector("[data-wb-log]");
      var msgEl = stage.querySelector(".wb__msg");
      var sendBtn = stage.querySelector("[data-wb-send]");
      var scoreBtn = stage.querySelector("[data-wb-score]");
      function addTurn(who, text) { var d = document.createElement("div"); d.className = "wb__turn wb__turn--" + who; var wl = document.createElement("span"); wl.className = "wb__who"; wl.textContent = who === "int" ? "Interviewer" : "You"; var bu = document.createElement("div"); bu.className = "wb__bubble"; bu.textContent = text; d.appendChild(wl); d.appendChild(bu); log.appendChild(d); log.scrollTop = log.scrollHeight; }
      async function interviewerTurn(userMsg) {
        btnBusy(sendBtn, "\u2026");
        try {
          var reply = (await aiText(aiCfg("txt"), wbMockSystem(st.mins), wbMockUser(prompt, transcript, userMsg || ""), { maxTokens: 500, temperature: 0.75 }) || "").trim();
          if (reply) { addTurn("int", reply); transcript += (transcript ? "\n" : "") + "INTERVIEWER: " + reply; }
        } catch (e) { err.textContent = (e && e.message) || "The interviewer went quiet \u2014 try again."; }
        btnIdle(sendBtn, "Send");
      }
      if (sendBtn) sendBtn.addEventListener("click", async function () { var m = (msgEl && msgEl.value.trim()) || ""; if (!m) return; addTurn("you", m); transcript += (transcript ? "\n" : "") + "CANDIDATE: " + m; msgEl.value = ""; await interviewerTurn(m); });
      if (msgEl) msgEl.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (sendBtn) sendBtn.click(); } });
      if (scoreBtn) scoreBtn.addEventListener("click", async function () {
        if (!transcript) { err.textContent = "Have a bit of the exercise first \u2014 then I\u2019ll score it."; return; }
        err.textContent = ""; btnBusy(scoreBtn, "Scoring\u2026");
        try {
          var s = csgenParse(await aiText(aiCfg("txt"), wbScoreSystem(), wbScoreUser(prompt, transcript), { json: true, maxTokens: 1400, temperature: 0.4 }));
          var card = document.createElement("div"); card.className = "wb__scorewrap"; card.innerHTML = wbScoreHtml(s); stage.appendChild(card); card.scrollIntoView({ block: "nearest" });
        } catch (e) { err.textContent = (e && e.message) || "Couldn\u2019t score that \u2014 try again."; }
        btnIdle(scoreBtn, "Wrap up & score me");
      });
      if (opening) interviewerTurn("");
    }
    function wireStage() {
      var np = stage.querySelector("[data-wb-newprompt]");
      if (np) np.addEventListener("click", async function () {
        btnBusy(np, "New prompt\u2026");
        try {
          prompt = csgenParse(await aiText(aiCfg("txt"), wbPromptSystem(), wbPromptUser(st.mins, st.brief), { json: true, maxTokens: 700, temperature: 0.95 }));
          transcript = "";
          if (st.mode === "coach") await wbRunCoach(); else await wbRunMock(true);
        } catch (e) { err.textContent = (e && e.message) || "Try again."; btnIdle(np, "\u21bb New prompt"); }
      });
      var crit = stage.querySelector("[data-wb-critique]");
      if (crit) crit.addEventListener("click", async function () {
        var draftEl = stage.querySelector(".wb__draft");
        var d = (draftEl && draftEl.value.trim()) || "";
        if (d.length < 20) { err.textContent = "Jot a few lines of your approach first."; return; }
        err.textContent = ""; btnBusy(crit, "Reading the room\u2026");
        try {
          var c = csgenParse(await aiText(aiCfg("txt"), wbCritiqueSystem(st.mins), wbCritiqueUser(prompt, d), { json: true, maxTokens: 1500, temperature: 0.55 }));
          var out = stage.querySelector(".wb__crit"); if (out) out.innerHTML = wbCritiqueHtml(c);
        } catch (e) { err.textContent = (e && e.message) || "Couldn\u2019t get feedback \u2014 try again."; }
        btnIdle(crit, "Get coaching");
      });
    }
  }

  /* ---------- Design storyteller (prep only) ---------- */
  // Turns a case study into a live-presentation narrative: pick a length + audience,
  // get a few distinct story ANGLES, then a time-budgeted beat-by-beat script for one.
  var STORY_DUR = [
    ["2015", "20\u201315 min", "Deep dive \u2014 the full arc"],
    ["1510", "15\u201310 min", "Standard interview slot"],
    ["105", "10\u20135 min", "Tight \u2014 lead with impact"],
    ["5", "5 min", "Lightning \u2014 one thread + the punchline"]
  ];
  var STORY_TONE = [
    ["vp", "VP / Exec", "Outcomes, strategy, business altitude"],
    ["staff", "Staff / Principal", "Ambiguity, systems, cross-team leverage"],
    ["senior", "Senior", "Craft, decisions &amp; the how"]
  ];
  var STORY_BUDGET = { "2015": 17, "1510": 12, "105": 7, "5": 5 };
  var storyState = {};
  function storySt(id) { return storyState[id] || (storyState[id] = { dur: "1510", tone: "staff", qrole: "any" }); }
  // Optional “align to a role” target — one job at a time, shared across every case study's
  // storyteller and persisted locally (prep only, never published).
  var STORY_JD_KEY = "rk:story:jd";
  var storyJd = (function () { try { var o = JSON.parse(localStorage.getItem(STORY_JD_KEY)); return (o && typeof o === "object") ? o : {}; } catch (e) { return {}; } })();
  function saveStoryJd() { try { localStorage.setItem(STORY_JD_KEY, JSON.stringify({ on: !!storyJd.on, url: storyJd.url || "", text: storyJd.text || "" })); } catch (e) {} }
  function storyJdText() { return (storyJd.on && storyJd.text && String(storyJd.text).trim()) ? String(storyJd.text).trim() : ""; }
  function storyJdUserBlock() { var t = storyJdText(); return t ? "\n\nTARGET ROLE — JOB DESCRIPTION (bias the story toward what THIS role values — mirror its priorities and language — using ONLY real facts from the material above; never invent anything to fit the role):\n" + t : ""; }
  function storyDurLabel(dur) { for (var i = 0; i < STORY_DUR.length; i++) if (STORY_DUR[i][0] === dur) return STORY_DUR[i][1]; return ""; }
  function storyAudience(tone) {
    return {
      vp: "The room is a VP / executive panel \u2014 lead with business outcomes and strategic bets, stay at altitude over process, and be crisp and declarative.",
      staff: "The room is staff / principal designers and engineers \u2014 dwell on ambiguity, problem framing, systems thinking and cross-team leverage; judgment over pixels.",
      senior: "The room is senior designers \u2014 show craft, the concrete decisions and the reasoning behind them; the how, not just the what."
    }[tone] || "";
  }
  var STORY_VIS = { media: "image(s)", gallery: "image carousel", mediagrid: "image grid", device: "device mockup", isolayers: "layered UI visual", compare: "before/after slider", figure: "figure + text", focus: "annotated image", voices: "user quotes", metrics: "metric band", workflow: "process diagram", stickies: "sticky-note board", columns: "comparison columns", rows: "comparison rows", cards: "card grid" };
  function storyContext(w) {
    var base = iprepContext(w, "study"), vis = [];
    ((w.study && w.study.blocks) || []).forEach(function (b) {
      var kind = STORY_VIS[b.type]; if (!kind) return;
      var cap = iprepStrip(b.heading || b.caption || (b.items && b.items[0] && (b.items[0].caption || b.items[0].heading)) || "");
      vis.push("- " + kind + (cap ? " \u2014 " + cap : ""));
    });
    if (vis.length) base += "\n\n# VISUALS I CAN SHOW (tell me WHEN to pull each up)\n" + vis.join("\n");
    return base.length > 9200 ? base.slice(0, 9200) + "\u2026" : base;
  }
  function storyThemesSystem(tone, durLabel) {
    return [
      "You are an elite design-portfolio presentation coach. In an interview a designer gets roughly " + durLabel + " to present ONE case study live. From their REAL material, propose a few DISTINCT, high-impact STORY ANGLES to build the talk around \u2014 not a summary, but different SPINES for the narrative.",
      storyAudience(tone),
      "Each angle must be a genuinely different lens on the same project (e.g. a trust reframe, a metric that redirected the roadmap, a hard tradeoff, a systems bet, a user-insight turn). Make each vivid and specific to THIS work.",
      "Rules: use ONLY facts from the material; never invent metrics, names or outcomes; no generic filler; make the titles presentation-worthy.",
      "Return ONLY valid JSON (no markdown): {\"themes\":[{\"title\":string,\"hook\":string,\"why\":string,\"beats\":string}]}. hook = the one-line spine of the story. why = why this angle lands for THIS room. beats = a 4\u20136 word skeleton of the arc."
    ].join("\n");
  }
  function storyThemesUser(ctx) { return "Propose 4 distinct angles.\n\nCASE STUDY MATERIAL:\n" + ctx + storyJdUserBlock(); }
  function storyTellSystem(tone, durLabel, budget) {
    return [
      "You are an elite presentation coach. Script EXACTLY how the designer should PRESENT this case study live, built around the chosen story angle, to fit " + durLabel + ".",
      storyAudience(tone),
      "Produce a time-budgeted, beat-by-beat SPOKEN narrative: an opening hook; ordered beats (each with what to SAY in a natural spoken voice, how many minutes, and the ONE point that must land); a strong close; what to consciously SKIP given the time; and one delivery tip.",
      "Calibrate depth to the time budget \u2014 5 min = one thread and the punchline, skip the middle; 20 min = the full arc with detail. The beat minutes MUST sum to about " + budget + " minutes.",
      "Where a visual exists (see \u2018VISUALS I CAN SHOW\u2019), say WHEN to pull it up inside the relevant beat.",
      "Use ONLY facts from the material. NEVER invent metrics, names or outcomes; if a needed detail is missing, insert a bracketed placeholder like [add the metric].",
      "Return ONLY valid JSON (no markdown): {\"spine\":string,\"opener\":string,\"beats\":[{\"label\":string,\"mins\":string,\"say\":string,\"must\":string}],\"close\":string,\"skip\":string,\"tip\":string}. say = 1\u20133 sentences of what to actually say aloud. must = the single point that must land. mins = a number like \"2\"."
    ].join("\n");
  }
  function storyTellUser(t, ctx) {
    return "CHOSEN STORY ANGLE:\nTitle: " + (t.title || "") + "\nSpine: " + (t.hook || "") + (t.beats ? "\nArc: " + t.beats : "") + "\n\nCASE STUDY MATERIAL:\n" + ctx + storyJdUserBlock();
  }
  function storyRenderThemes(box, themes) {
    box.innerHTML = '<div class="story__themes-h">Pick an angle \u2014 I\u2019ll script the talk for it</div>' + themes.map(function (t, idx) {
      return '<div class="story__theme" data-ti="' + idx + '">' +
        '<div class="story__theme-h">' + escHtml(t.title || ("Angle " + (idx + 1))) + "</div>" +
        (t.hook ? '<div class="story__theme-hook">' + escHtml(t.hook) + "</div>" : "") +
        (t.beats ? '<div class="story__theme-arc">' + escHtml(t.beats) + "</div>" : "") +
        (t.why ? '<div class="story__theme-why">' + escHtml(t.why) + "</div>" : "") +
        '<div class="story__theme-act"><button class="btn btn--auto" data-story-tell="' + idx + '">Tell this story \u2192</button></div>' +
        "</div>";
    }).join("");
  }
  function storyRenderTale(box, s) {
    var beats = Array.isArray(s.beats) ? s.beats : [];
    var total = beats.reduce(function (a, b) { return a + (parseFloat(b.mins) || 0); }, 0);
    box.innerHTML =
      (s.spine ? '<div class="story__spine">' + escHtml(s.spine) + "</div>" : "") +
      (s.opener ? '<div class="story__step story__open"><span class="story__tag">Open with</span><p>' + escHtml(s.opener) + "</p></div>" : "") +
      '<div class="story__beats">' + beats.map(function (b, idx) {
        return '<div class="story__beat">' +
          '<div class="story__beat-time">' + escHtml(String(b.mins || "\u2022")) + (b.mins ? "<small>min</small>" : "") + "</div>" +
          '<div class="story__beat-main">' +
            '<div class="story__beat-label">' + escHtml(b.label || ("Beat " + (idx + 1))) + "</div>" +
            (b.say ? '<div class="story__beat-say">' + escHtml(b.say) + "</div>" : "") +
            (b.must ? '<div class="story__beat-must"><span>Must land</span> ' + escHtml(b.must) + "</div>" : "") +
          "</div>" +
        "</div>";
      }).join("") + "</div>" +
      (s.close ? '<div class="story__step story__land"><span class="story__tag">Land it</span><p>' + escHtml(s.close) + "</p></div>" : "") +
      (s.skip ? '<div class="story__aside"><span>Skip / don\u2019t dwell</span> ' + escHtml(s.skip) + "</div>" : "") +
      (s.tip ? '<div class="story__aside"><span>Delivery</span> ' + escHtml(s.tip) + "</div>" : "") +
      '<div class="story__tale-foot"><span class="story__total">' + (total ? "\u2248 " + total + " min total" : "") + '</span><span class="story__tale-act"><button class="btn btn--ghost" data-story-regen>\u21bb Regenerate</button><button class="btn btn--ghost" data-story-copy>Copy script</button></span></div>';
  }
  function storyPlain(s, title) {
    if (!s) return "";
    var L = [];
    if (title) L.push(String(title).toUpperCase());
    if (s.spine) L.push(s.spine);
    if (s.opener) L.push("", "OPEN WITH: " + s.opener);
    L.push("");
    (s.beats || []).forEach(function (b) {
      L.push("\u2022 " + (b.label || "") + (b.mins ? "  (" + b.mins + " min)" : ""));
      if (b.say) L.push("  " + b.say);
      if (b.must) L.push("  Must land: " + b.must);
      L.push("");
    });
    if (s.close) L.push("LAND IT: " + s.close);
    if (s.skip) L.push("", "SKIP: " + s.skip);
    if (s.tip) L.push("DELIVERY: " + s.tip);
    return L.join("\n").trim();
  }
  var STORY_ROLES = [
    ["any", "Anyone (a mix)"],
    ["pm", "Product Manager"],
    ["design", "Design"],
    ["research", "User Research"],
    ["a11y", "Accessibility"],
    ["marketing", "Marketing"],
    ["eng", "Engineering"],
    ["data", "Data Science"]
  ];
  var STORY_ROLE_LENS = {
    pm: "a Product Manager \u2014 probing problem framing, prioritisation, scope, tradeoffs, metrics and business impact",
    design: "a fellow designer / design manager \u2014 probing craft, critique, systems, the alternatives considered and the rationale",
    research: "a User Researcher \u2014 probing the evidence, method, how insights shaped decisions, and validation",
    a11y: "an Accessibility specialist \u2014 probing inclusive design, WCAG, edge cases, assistive tech and who might be excluded",
    marketing: "a Marketing / GTM partner \u2014 probing positioning, the story to customers, differentiation and adoption",
    eng: "an Engineer / tech lead \u2014 probing feasibility, constraints, handoff, edge cases and how the design met technical reality",
    data: "a Data Scientist \u2014 probing how the design was measured, experiment design, what the numbers really showed, and causality"
  };
  function storyRoleName(id) { for (var i = 0; i < STORY_ROLES.length; i++) if (STORY_ROLES[i][0] === id) return STORY_ROLES[i][1]; return id; }
  function storyQSystem(tone, role, n) {
    var lens = STORY_ROLE_LENS[role];
    return [
      "You role-play the cross-functional partners in a design-portfolio interview. The candidate has just PRESENTED this case study using a specific narrative angle. Generate the questions they'd get AFTER that talk.",
      storyAudience(tone),
      role === "any"
        ? "Spread " + n + " questions across the different partners a designer works with (Product, Design, Research, Accessibility, Marketing, Engineering, Data Science) \u2014 vary who is asking."
        : "All " + n + " questions come from " + (lens || (storyRoleName(role) + ", staying in that partner's voice and concerns")) + ".",
      "CRITICAL: these are questions the PARTNER asks the DESIGNER about the DESIGN work \u2014 NOT questions aimed at that partner's own craft. Keep DESIGN centrality in every question: probe the design thinking, decisions, tradeoffs, craft or impact, seen through that partner's lens.",
      "Ground each question in the candidate's ACTUAL material and the chosen angle \u2014 reference a real decision, metric or tradeoff. Match the room's altitude. No generic filler \u2014 make them the sharp questions that actually get asked.",
      "Return ONLY valid JSON (no markdown): {\"questions\":[{\"q\":string,\"role\":string,\"why\":string}]}. role = the partner asking (Product / Design / Research / Accessibility / Marketing / Engineering / Data Science). why = one short line on what a strong answer reveals."
    ].join("\n");
  }
  function storyQUser(ctx, angle, n) {
    return "CHOSEN NARRATIVE ANGLE:\nTitle: " + ((angle && angle.title) || "") + "\nSpine: " + ((angle && angle.hook) || "") + "\n\nGenerate exactly " + n + " questions.\n\nCASE STUDY MATERIAL:\n" + ctx + storyJdUserBlock();
  }
  function storyQAnsSystem(tone, roleStr) {
    return [
      "You coach a product designer to answer a question from a cross-functional partner right after they presented this case study. Draft a strong, honest answer IN FIRST PERSON they can say aloud.",
      storyAudience(tone),
      roleStr ? "The question comes from " + roleStr + " \u2014 speak to that partner's concern while keeping the design reasoning central." : "Speak to the asker's concern while keeping the design reasoning central.",
      "Use ONLY facts in the material. NEVER invent metrics, names or outcomes; if a detail is missing insert a bracketed placeholder like [add the metric].",
      "Natural spoken voice, confident but not boastful, about 90\u2013170 words. Return clean minimal HTML: <p> paragraphs, <strong> for key phrases, <ul><li> where it helps. No markdown, no preamble."
    ].join("\n");
  }
  function storyQAnsUser(q, ctx, angle) {
    return "QUESTION:\n" + q + "\n\n" + (angle ? "NARRATIVE ANGLE: " + (angle.title || "") + (angle.hook ? " \u2014 " + angle.hook : "") + "\n\n" : "") + "CASE STUDY MATERIAL:\n" + ctx;
  }
  function storyRenderQuestions(box, qs) {
    box.innerHTML = qs.map(function (q, idx) {
      return '<div class="story__q" data-qi="' + idx + '">' +
        '<div class="story__q-top">' + (q.role ? '<span class="story__q-role">' + escHtml(q.role) + "</span>" : "<span></span>") + '<span class="story__q-n">' + (idx + 1) + "</span></div>" +
        '<div class="story__q-text">' + escHtml(q.q || "") + "</div>" +
        (q.why ? '<div class="story__q-why">' + escHtml(q.why) + "</div>" : "") +
        '<div class="story__q-a" hidden></div>' +
        '<div class="story__q-act"><button class="btn btn--ghost" data-story-qans="' + idx + '">\u2728 Answer</button></div>' +
        "</div>";
    }).join("");
  }
  function storyModal(i) {
    var fromAi = (i == null);
    var stWorks = (data.work || []).filter(function (x) { return x && !x.encWork; });
    var w = fromAi ? (stWorks[0] || null) : data.work[i]; if (!w) return;
    if (!aiHasKey("txt")) { aiKeyModal("txt", function () { storyModal(i); }); return; }
    var g = storySt(fromAi ? "__ai__" : w.id);
    if (!g.qrole) g.qrole = "any";
    var themes = [], curTi = -1, questionsArr = [];
    var modal = document.createElement("div");
    modal.className = "pass pass--wide story-modal";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">\uD83D\uDCD6 Design storyteller' + (fromAi ? "" : " \u2014 " + escHtml(w.title || "case study")) + "</div>" +
      '<div class="pass__sub">Turn ' + (fromAi ? "a" : "this") + ' case study into a presentation. Pick how long you\u2019ll have and who\u2019s in the room \u2014 get a few story angles, then open one for a beat-by-beat script and the questions it invites.</div>' +
      '<div class="story__setup">' +
        (fromAi ? '<div class="af"><label class="af__label">Case study</label><select class="story__pick">' + stWorks.map(function (pw, idx) { return '<option value="' + idx + '">' + escHtml(pw.title || ("Project " + (idx + 1))) + "</option>"; }).join("") + "</select></div>" : "") +
        '<div class="af"><label class="af__label">How long to present</label><div class="story__opts">' +
          STORY_DUR.map(function (d) { return '<button type="button" class="story__opt' + (g.dur === d[0] ? " is-on" : "") + '" data-story-dur="' + d[0] + '"><span class="story__opt-name">' + d[1] + '</span><span class="story__opt-desc">' + d[2] + "</span></button>"; }).join("") +
        "</div></div>" +
        '<div class="af"><label class="af__label">Who\u2019s in the room</label><div class="story__opts">' +
          STORY_TONE.map(function (t) { return '<button type="button" class="story__opt' + (g.tone === t[0] ? " is-on" : "") + '" data-story-tone="' + t[0] + '"><span class="story__opt-name">' + t[1] + '</span><span class="story__opt-desc">' + t[2] + "</span></button>"; }).join("") +
        "</div></div>" +
        '<div class="af story__role"><label class="chk"><input type="checkbox" data-story-align' + (storyJd.on ? " checked" : "") + " /> Align to a role</label>" +
          '<div class="story__role-fields"' + (storyJd.on ? "" : " hidden") + '>' +
            '<div class="cl__row"><input type="url" class="cl__url" data-story-jd-url placeholder="Paste the job posting URL\u2026" value="' + escAttr(storyJd.url || "") + '" /><button class="btn btn--ghost" type="button" data-story-jd-fetch>Fetch</button></div>' +
            '<textarea class="cl__jd" data-story-jd-text rows="5" placeholder="\u2026or paste the full job description here (best results \u2014 LinkedIn links often need pasting).">' + escHtml(storyJd.text || "") + "</textarea>" +
            '<div class="cl__note">Angles and the script will lean toward what this role values, using only your real material. A link is read via a reader service (r.jina.ai) \u2014 only your public job post; nothing here is saved to or published on your site.</div>' +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="story__themes" hidden></div>' +
      '<div class="story__l2" hidden>' +
        '<div class="story__l2-bar"><button class="btn btn--ghost story__l2-back" data-story-l2back><span aria-hidden="true">\u2039</span> Other angles</button><span class="story__l2-title"></span></div>' +
        '<div class="story__l2-body">' +
          '<div class="story__tale"></div>' +
          '<div class="story__qa">' +
            '<div class="story__qa-head"><span>Questions they might ask</span><span class="story__qa-ctl"><select class="story__qrole" aria-label="Who is asking">' +
              STORY_ROLES.map(function (r) { return '<option value="' + r[0] + '"' + ((g.qrole || "any") === r[0] ? " selected" : "") + '>' + r[1] + "</option>"; }).join("") +
            '</select><button class="btn btn--auto" data-story-qgen>Generate questions</button></span></div>' +
            '<div class="story__qlist"></div>' +
            '<div class="story__qa-note">Framed as that partner would ask a designer, at the altitude you picked \u2014 hit Answer to rehearse a response. Anyone = 10 questions; a single role = 5.</div>' +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions story__foot">' +
        '<button class="btn btn--ghost" data-cancel>Close</button>' +
        '<button class="btn btn--ghost" data-story-back hidden>\u2190 Change setup</button>' +
        '<button class="btn btn--auto" data-story-run>Find story angles</button>' +
      "</div>" +
      '<div class="pass__note">A prep tool only \u2014 nothing here is saved to or published on your site. It uses only your own content.</div></div>';
    document.body.appendChild(modal);
    var err = modal.querySelector(".pass__err");
    var setup = modal.querySelector(".story__setup");
    var themesBox = modal.querySelector(".story__themes");
    var l2Box = modal.querySelector(".story__l2");
    var l2Title = modal.querySelector(".story__l2-title");
    var l2Body = modal.querySelector(".story__l2-body");
    var taleBox = modal.querySelector(".story__tale");
    var qlist = modal.querySelector(".story__qlist");
    var qroleSel = modal.querySelector(".story__qrole");
    var qgenBtn = modal.querySelector("[data-story-qgen]");
    var runBtn = modal.querySelector("[data-story-run]");
    var backBtn = modal.querySelector("[data-story-back]");
    var close = function () { modal.remove(); };
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    modal.querySelector("[data-cancel]").addEventListener("click", close);
    modal.querySelector("[data-story-l2back]").addEventListener("click", function () { showThemes(); });
    qroleSel.addEventListener("change", function () { g.qrole = qroleSel.value; });
    modal.querySelectorAll("[data-story-dur]").forEach(function (b) { b.addEventListener("click", function () { g.dur = b.dataset.storyDur; modal.querySelectorAll("[data-story-dur]").forEach(function (x) { x.classList.toggle("is-on", x === b); }); }); });
    modal.querySelectorAll("[data-story-tone]").forEach(function (b) { b.addEventListener("click", function () { g.tone = b.dataset.storyTone; modal.querySelectorAll("[data-story-tone]").forEach(function (x) { x.classList.toggle("is-on", x === b); }); }); });
    var storyPick = modal.querySelector(".story__pick");
    if (storyPick) storyPick.addEventListener("change", function () { var nw = stWorks[+storyPick.value]; if (nw) { w = nw; g.__ctx = null; } });
    var alignCb = modal.querySelector("[data-story-align]");
    var roleFields = modal.querySelector(".story__role-fields");
    var jdUrlEl = modal.querySelector("[data-story-jd-url]");
    var jdTextEl = modal.querySelector("[data-story-jd-text]");
    var jdFetchBtn = modal.querySelector("[data-story-jd-fetch]");
    if (alignCb) alignCb.addEventListener("change", function () { storyJd.on = alignCb.checked; if (roleFields) roleFields.hidden = !alignCb.checked; saveStoryJd(); });
    if (jdUrlEl) jdUrlEl.addEventListener("input", function () { storyJd.url = jdUrlEl.value; saveStoryJd(); });
    if (jdTextEl) jdTextEl.addEventListener("input", function () { storyJd.text = jdTextEl.value; saveStoryJd(); });
    if (jdFetchBtn) jdFetchBtn.addEventListener("click", async function () {
      err.textContent = "";
      btnBusy(jdFetchBtn, "Fetching\u2026");
      try {
        var jt = await clFetchJd(jdUrlEl ? jdUrlEl.value : "");
        if (jdTextEl) jdTextEl.value = jt;
        storyJd.text = jt; storyJd.on = true; if (alignCb) alignCb.checked = true; if (roleFields) roleFields.hidden = false; saveStoryJd();
      } catch (e2) { err.textContent = (e2 && e2.message) || "Couldn\u2019t read that link \u2014 paste the description instead."; }
      btnIdle(jdFetchBtn, "Fetch");
    });
    function showSetup() { setup.hidden = false; themesBox.hidden = true; l2Box.hidden = true; backBtn.hidden = true; runBtn.hidden = false; err.textContent = ""; }
    function showThemes() { setup.hidden = true; themesBox.hidden = false; l2Box.hidden = true; backBtn.hidden = false; runBtn.hidden = true; err.textContent = ""; }
    function showL2() { setup.hidden = true; themesBox.hidden = true; l2Box.hidden = false; backBtn.hidden = true; runBtn.hidden = true; err.textContent = ""; }
    backBtn.addEventListener("click", function () { showSetup(); });
    runBtn.addEventListener("click", async function () {
      err.textContent = "";
      btnBusy(runBtn, "Thinking\u2026");
      try {
        var ctx = storyContext(w); g.__ctx = ctx;
        var obj = csgenParse(await aiText(aiCfg("txt"), storyThemesSystem(g.tone, storyDurLabel(g.dur)), storyThemesUser(ctx), { json: true, maxTokens: 1500, temperature: 0.8 }));
        var raw = obj && Array.isArray(obj.themes) ? obj.themes : (Array.isArray(obj) ? obj : null);
        if (!raw || !raw.length) throw new Error("No angles came back \u2014 try again.");
        themes = raw.filter(function (t) { return t && (t.title || t.hook); });
        storyRenderThemes(themesBox, themes);
        showThemes();
      } catch (e) { err.textContent = (e && e.message) || "Couldn\u2019t find story angles."; }
      btnIdle(runBtn, "Find story angles");
    });
    async function tell(idx, srcBtn) {
      var t = themes[idx]; if (!t) return;
      var switching = idx !== curTi;
      var was = srcBtn ? srcBtn.textContent : "";
      btnBusy(srcBtn, "Scripting\u2026");
      err.textContent = "";
      try {
        var s = csgenParse(await aiText(aiCfg("txt"), storyTellSystem(g.tone, storyDurLabel(g.dur), STORY_BUDGET[g.dur] || 12), storyTellUser(t, g.__ctx || storyContext(w)), { json: true, maxTokens: 2200, temperature: 0.7 }));
        if (!s || (!Array.isArray(s.beats) && !s.opener)) throw new Error("The script didn\u2019t come through \u2014 try again.");
        curTi = idx; taleBox.__script = s; taleBox.__title = t.title || "";
        storyRenderTale(taleBox, s);
        if (switching) { questionsArr = []; qlist.innerHTML = ""; qgenBtn.textContent = "Generate questions"; }
        l2Title.textContent = t.title || "Your story";
        showL2(); if (l2Body) l2Body.scrollTop = 0;
      } catch (e2) { err.textContent = (e2 && e2.message) || "Couldn\u2019t script that story."; }
      finally { btnIdle(srcBtn, was); }
    }
    themesBox.addEventListener("click", function (e) { var b = e.target.closest("[data-story-tell]"); if (b) tell(+b.dataset.storyTell, b); });
    taleBox.addEventListener("click", function (e) {
      var rb = e.target.closest("[data-story-regen]");
      if (rb) { tell(curTi, rb); return; }
      var cb = e.target.closest("[data-story-copy]");
      if (cb) { var txt = storyPlain(taleBox.__script, taleBox.__title); if (navigator.clipboard && txt) navigator.clipboard.writeText(txt).then(function () { cb.textContent = "Copied"; setTimeout(function () { cb.textContent = "Copy script"; }, 1400); }).catch(function () {}); }
    });
    qgenBtn.addEventListener("click", async function () {
      if (curTi < 0 || !themes[curTi]) return;
      g.qrole = qroleSel.value;
      var n = g.qrole === "any" ? 10 : 5;
      btnBusy(qgenBtn, "Thinking\u2026"); err.textContent = "";
      try {
        var obj = csgenParse(await aiText(aiCfg("txt"), storyQSystem(g.tone, g.qrole, n), storyQUser(g.__ctx || storyContext(w), themes[curTi], n), { json: true, maxTokens: 1800, temperature: 0.8 }));
        var raw = obj && Array.isArray(obj.questions) ? obj.questions : (Array.isArray(obj) ? obj : null);
        if (!raw || !raw.length) throw new Error("No questions came back \u2014 try again.");
        questionsArr = raw.map(function (q) { return typeof q === "string" ? { q: q } : (q && q.q ? { q: q.q, role: q.role, why: q.why } : null); }).filter(Boolean);
        storyRenderQuestions(qlist, questionsArr);
      } catch (e) { err.textContent = (e && e.message) || "Couldn\u2019t generate questions."; }
      btnIdle(qgenBtn, questionsArr.length ? "Regenerate" : "Generate questions");
    });
    qlist.addEventListener("click", async function (e) {
      var ab = e.target.closest("[data-story-qans]");
      if (ab) {
        var idx = +ab.dataset.storyQans; var q = questionsArr[idx]; if (!q) return;
        var card = qlist.querySelector('.story__q[data-qi="' + idx + '"]'); if (!card) return;
        var aEl = card.querySelector(".story__q-a");
        var was = btnBusy(ab, "Drafting\u2026"); err.textContent = "";
        try {
          var html = await aiText(aiCfg("txt"), storyQAnsSystem(g.tone, q.role || storyRoleName(g.qrole)), storyQAnsUser(q.q, g.__ctx || storyContext(w), themes[curTi]), { maxTokens: 700, temperature: 0.6 });
          html = String(html || "").replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
          aEl.innerHTML = iprepSafeHtml(html); aEl.hidden = false;
          card.querySelector(".story__q-act").innerHTML = '<button class="btn btn--ghost" data-story-qans="' + idx + '">\u21bb Redo</button><button class="btn btn--ghost" data-story-qcopy="' + idx + '">Copy</button>';
        } catch (e2) { err.textContent = (e2 && e2.message) || "Couldn\u2019t draft an answer."; btnIdle(ab, was); }
        return;
      }
      var cb = e.target.closest("[data-story-qcopy]");
      if (cb) { var i2 = +cb.dataset.storyQcopy; var c2 = qlist.querySelector('.story__q[data-qi="' + i2 + '"]'); var a2 = c2 && c2.querySelector(".story__q-a"); var t2 = a2 ? a2.innerText : ""; if (navigator.clipboard && t2) navigator.clipboard.writeText(t2).then(function () { cb.textContent = "Copied"; setTimeout(function () { cb.textContent = "Copy"; }, 1400); }).catch(function () {}); }
    });
    showSetup();
  }

  /* ---------- shell / open / exit ---------- */
  function buildShell() {
    root = document.createElement("div");
    root.className = "adm";
    root.setAttribute("data-lenis-prevent", ""); // let the editor pane scroll natively (Lenis owns the page wheel)
    root.innerHTML =
      '<header class="adm__bar">' +
        '<div class="adm__brand"><span class="adm__pulse"></span>Admin Mode <small>content studio</small></div>' +
        '<div class="adm__tabswrap">' +
          '<button class="adm__tabflip adm__tabflip--prev" data-tabflip="-1" type="button" aria-label="Scroll tabs left" hidden>\u2039</button>' +
          '<nav class="adm__tabs">' + TABS.map((t) => '<button class="adm__tab" data-tab="' + t[0] + '">' + t[1] + (t[0] === "special" ? '<span class="adm__tabbadge" data-accbadge></span>' : t[0] === "autofill" ? '<span class="adm__tabbadge" data-bookbadge></span>' : "") + "</button>").join("") + "</nav>" +
          '<button class="adm__tabflip adm__tabflip--next" data-tabflip="1" type="button" aria-label="Scroll tabs right" hidden>\u203A</button>' +
        "</div>" +
        '<div class="adm__actions">' +
          '<div class="adm__actions-l">' +
            '<span class="adm__status">Editing local draft</span>' +
            '<div class="adm__hist" data-hist hidden>' +
              '<button class="adm__hist-btn" data-undo type="button" aria-label="Undo" title="Undo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg></button>' +
              '<button class="adm__hist-btn" data-redo type="button" aria-label="Redo" title="Redo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M20 9H9a5 5 0 0 0 0 10h1"/></svg></button>' +
            "</div>" +
          "</div>" +
          '<div class="adm__actions-r">' +
            '<button class="btn btn--ghost adm__viewtoggle" data-view>Preview</button>' +
            '<button class="btn btn--primary adm__publish" data-publish hidden>Publish</button>' +
          '<button class="btn btn--ghost adm__gear" data-opensettings type="button" aria-label="Settings" title="Settings"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>' +
          '<div class="adm__exitwrap" data-exit-wrap>' +
            '<button class="btn adm__exit" data-exit type="button" aria-label="Exit studio" title="Exit">\u2715</button>' +
            '<div class="adm__exit-pop" hidden>' +
              '<div class="adm__exit-pop-h">You have unsaved changes</div>' +
              '<button class="adm__exit-opt adm__exit-opt--save" data-exit-save type="button"><span class="adm__more-tx"><b>Save &amp; leave</b><small>Keep your changes as a local draft \u2014 publish them anytime</small></span></button>' +
              '<button class="adm__exit-opt adm__exit-opt--discard" data-exit-discard type="button"><span class="adm__more-tx"><b>Discard changes</b><small>Throw away everything changed since your last publish</small></span></button>' +
            "</div>" +
          "</div>" +
          "</div>" +
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
      "</div>" +
      '<div class="adm__settings" hidden><div class="adm__set-sheet">' +
        '<div class="adm__set-head"><h2>Settings</h2><button class="btn btn--ghost adm__set-x" data-act="settings-close" type="button" aria-label="Close settings">\u2715</button></div>' +
        '<div class="adm__set-body"><nav class="adm__set-nav" data-set-nav></nav><div class="adm__set-panel" data-set-panel></div></div>' +
      "</div></div>";
    document.body.appendChild(root);
    body = root.querySelector(".adm__body");
    l2 = root.querySelector(".adm__l2");
    l2body = root.querySelector(".adm__l2-body");
    l2title = root.querySelector(".adm__l2-title");
    frame = root.querySelector(".adm__frame");
    setPane = root.querySelector(".adm__settings");
    setNav = root.querySelector("[data-set-nav]");
    setPanel = root.querySelector("[data-set-panel]");

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
    root.addEventListener("pointerdown", faPointerDown);
    root.addEventListener("click", onClick);
    root.addEventListener("dblclick", onDblClick);
    // Live thumbnail-parallax demo: reflect the effect on the cover preview as the editor scrolls.
    root.addEventListener("scroll", parxScheduleDemo, true);
    // Drag-to-reorder any list with a grip handle (arrows still work).
    root.addEventListener("pointerdown", sortStart);
    // Keep the caret inside the rich-text area when a toolbar button is pressed.
    root.addEventListener("mousedown", function (e) { if (e.target.closest("[data-rt], [data-md]")) e.preventDefault(); });
    // Paste into a rich-text body as plain text (no foreign colours/fonts).
    root.addEventListener("paste", onRtPaste);
    root.querySelectorAll(".adm__tab").forEach((t) =>
      t.addEventListener("click", () => { if (openStudy >= 0) closeL2({ render: false }); if (journeyOpen) closeJourneyEditor({ render: false }); activeTab = t.dataset.tab; renderBody(); if (activeTab === "special") { loadAccessData(); loadQuickGrant(); } if (activeTab === "autofill") { loadBookings(); bookMarkSeen(); } try { t.scrollIntoView({ inline: "nearest", block: "nearest" }); } catch (e) {} tabsSync(); })
    );
    // tab-strip overflow flippers (\u2039 \u203A)
    root.querySelectorAll("[data-tabflip]").forEach((b) => b.addEventListener("click", () => tabScroll(+b.dataset.tabflip)));
    var _tabsEl = root.querySelector(".adm__tabs");
    if (_tabsEl) _tabsEl.addEventListener("scroll", function () { if (tabsRaf) return; tabsRaf = requestAnimationFrame(function () { tabsRaf = 0; tabsSync(); }); }, { passive: true });
    window.addEventListener("resize", tabsSync);
    var _undo = root.querySelector("[data-undo]"); if (_undo) _undo.addEventListener("click", histUndo);
    var _redo = root.querySelector("[data-redo]"); if (_redo) _redo.addEventListener("click", histRedo);
    root.querySelector("[data-publish]").addEventListener("click", publish);
    var _sett = root.querySelector("[data-opensettings]"); if (_sett) _sett.addEventListener("click", () => { closeBarPops(); openSettings(); });
    const pubCloseBtn = root.querySelector("[data-pub-close]");
    if (pubCloseBtn) pubCloseBtn.addEventListener("click", pubHide);
    // "\u2715" close: when there are unsaved changes, offer Save / Discard; a clean studio just exits.
    root.querySelector("[data-exit]").addEventListener("click", (e) => {
      e.stopPropagation(); closeMorePop();
      if (!isDirty()) { exit(); return; }
      const pop = root.querySelector(".adm__exit-pop"); if (pop) pop.hidden = !pop.hidden;
    });
    var _exSave = root.querySelector("[data-exit-save]"); if (_exSave) _exSave.addEventListener("click", () => { closeExitPop(); exit(); });
    var _exDiscard = root.querySelector("[data-exit-discard]"); if (_exDiscard) _exDiscard.addEventListener("click", () => { closeExitPop(); revert(); });
    document.addEventListener("click", (e) => {
      const ew = root.querySelector("[data-exit-wrap]");
      if (ew && !ew.contains(e.target)) closeExitPop();
    });
    root.querySelector("[data-l2-back]").addEventListener("click", () => { if (journeyOpen) closeJourneyEditor(); else closeL2(); });
    root.querySelector("[data-l2-prev]").addEventListener("click", () => {
      const wasOff = localStorage.getItem(L2PREV_KEY) === "0";
      try { localStorage.setItem(L2PREV_KEY, wasOff ? "1" : "0"); } catch (e) {}
      l2PreviewApply();
      if (wasOff && journeyOpen) previewJourney();
      else if (wasOff && openStudy >= 0 && data.work[openStudy]) previewProject(data.work[openStudy].id, false);
    });
    root.querySelector("[data-view]").addEventListener("click", (e) => {
      const on = root.classList.toggle("is-preview");
      e.currentTarget.textContent = on ? "Edit" : "Preview";
      if (on) { if (journeyOpen) previewJourney(); else if (openStudy >= 0 && data.work[openStudy]) previewProject(data.work[openStudy].id, false); else previewLanding(); }
    });
    frame.addEventListener("load", previewApply);
    document.addEventListener("keydown", onKey);
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || !d.__rk) return;
      if (d.__rk === "selectBlock" && typeof d.index === "number") selectPreviewBlock(d.index);
      else if (d.__rk === "blockAct" && typeof d.index === "number") previewBlockAct(d.act, d.index);
    });
  }

  function onKey(e) {
    if (e.key !== "Escape" || !root || !root.classList.contains("is-open")) return;
    var mp = root.querySelector(".adm__more-pop"), xp = root.querySelector(".adm__exit-pop");
    if ((mp && !mp.hidden) || (xp && !xp.hidden)) { closeMorePop(); closeExitPop(); return; }
    // Escape no longer dismisses the studio - leave the editor open; exit only via the More menu.
  }

  function open(hostApi) {
    if (hostApi) __host = hostApi;
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
    activeTab = "insights";
    openStudy = -1;
    journeyOpen = false;
    if (l2) { l2.hidden = true; l2.classList.remove("is-open"); }
    if (body) body.hidden = false;
    renderBody();
    loadQuickGrant(); // prefetch the one-tap Full-access quick-grant status
    loadAccessData(); // prefetch requests + grants for the merged Special Views tab
    loadBookings(); // prefetch Cal.com bookings so the More-tab badge shows a count on open
    // Live-ish: when the owner returns to this tab while the studio is open, re-check pending so a request
    // that arrived meanwhile shows up (and the badge pulses). Gated on adm-lock so it never runs when closed.
    if (!accVisBound) { accVisBound = true; document.addEventListener("visibilitychange", function () { if (!document.hidden && document.documentElement.classList.contains("adm-lock") && adminSession()) { loadAccessData(); loadBookings(); } }); }
    musSilence(); // silence the ambient music while editing
    thDismiss(true); // belt-and-suspenders: the ticket nudge must never linger over the editor
    document.documentElement.classList.add("adm-lock");
    document.body.classList.add("adm-lock");
    requestAnimationFrame(() => root.classList.add("is-open"));
    if (frame && frame.contentWindow && frame.contentWindow.RK) previewApply();
    autopubSync(); autopubStart();
    histReset();
    updateDirtyUI();
    requestAnimationFrame(tabsSync);
    if (staleDiscarded) status("Loaded the latest published content (an old local draft was discarded).", true);
  }

  function exit() {
    autopubStop();
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) {}
    if (window.RK) { window.RK.data = clone(data); try { window.RK.render(data); } catch (e) {} forceReveal(); }
    if (root) root.classList.remove("is-open");
    document.documentElement.classList.remove("adm-lock");
    document.body.classList.remove("adm-lock");
    musRestore(); // bring the music back if it was on before
    hostExit();   // let the shell restore the URL (/studio -> /)
  }

  /* ---------- change the admin key (requires the current key) ---------- */
  // Manage passkeys (enrol / list / remove). Enrolment is owner-gated by the current session, so the
  // first passkey is added right after a normal (password) sign-in; after that, passkeys sign you in.
  // Recruiter mode (published): show the landing ticket flyout to every visitor. Toggled from the ⋯ menu.
  function recruiterStateSync() {
    var el = document.querySelector("[data-recstate]");
    if (el) el.textContent = data.recruiterMode ? "\u00b7 On" : "\u00b7 Off";
  }
  function recruiterToggle() {
    data.recruiterMode = !data.recruiterMode;
    saveDraft(true);
    recruiterStateSync();
    status(data.recruiterMode ? "Recruiter mode on \u2014 Publish to show the ticket prompt on your live site." : "Recruiter mode off \u2014 Publish to apply.", true);
  }
  // Verify it’s you on an untrusted device (recovery passphrase + admin password) → device-trust token.
  function deviceStepUpModal(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      const modal = document.createElement("div");
      modal.className = "pass";
      modal.innerHTML =
        '<div class="pass__box"><div class="pass__title">Verify it\u2019s you</div>' +
        '<div class="pass__sub">' + escHtml(opts.sub || "This device isn\u2019t verified yet. Enter your recovery passphrase and admin password to continue.") + "</div>" +
        '<input type="password" placeholder="Recovery passphrase" data-rec autocomplete="off" autofocus />' +
        '<input type="password" placeholder="Admin password" data-pw autocomplete="off" />' +
        '<div class="pass__err"></div>' +
        '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn--primary" data-go>Verify</button></div></div>';
      document.body.appendChild(modal);
      const rec = modal.querySelector("[data-rec]"), pw = modal.querySelector("[data-pw]"), err = modal.querySelector(".pass__err"), go = modal.querySelector("[data-go]");
      try { rec.focus(); } catch (e) {}
      const done = function (v) { modal.remove(); resolve(v); };
      modal.querySelector("[data-cancel]").addEventListener("click", function () { done(false); });
      modal.addEventListener("click", function (e) { if (e.target === modal) done(false); });
      async function submit() {
        const r = rec.value.trim(); if (!r) { err.textContent = "Enter your recovery passphrase"; return; }
        go.disabled = true; err.textContent = ""; const was = go.textContent; go.textContent = "Verifying\u2026";
        try { await stepUp(r, pw.value); done(true); }
        catch (e) { go.disabled = false; go.textContent = was; err.textContent = (e && e.message) || "That didn\u2019t verify."; }
      }
      go.addEventListener("click", submit);
      modal.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); if (e.key === "Escape") done(false); });
    });
  }
  async function passkeyModal(opts) {
    if (!webauthnSupported()) { status("This browser doesn\u2019t support passkeys.", false); return; }
    const modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">Passkeys</div>' +
      '<div class="pass__sub">Sign in to admin with Windows Hello, Face ID or a security key. Enrol a few (laptop, phone, a backup) so you\u2019re never locked out \u2014 your admin key still works as a fallback.</div>' +
      '<div class="pass__err"></div>' +
      '<div data-pklist style="margin:4px 0 14px;font-size:13px">Loading\u2026</div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Done</button>' +
      '<button class="btn btn--primary" data-add>\uFF0B Add a passkey</button></div></div>';
    document.body.appendChild(modal);
    settingsMount(modal, opts);
    const err = modal.querySelector(".pass__err"), listEl = modal.querySelector("[data-pklist]");
    const done = () => { if (opts && opts.onClose) opts.onClose(); else modal.remove(); };
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    modal.addEventListener("click", (e) => { if (e.target === modal) done(); });
    modal.addEventListener("keydown", (e) => { if (e.key === "Escape") done(); });
    async function refresh() {
      const list = await webauthnList().catch(() => []);
      if (!list.length) { listEl.innerHTML = '<span style="opacity:.55">No passkeys yet \u2014 add one below.</span>'; return; }
      listEl.innerHTML = list.map((p) => '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.07)"><span>\uD83D\uDD11 ' + escHtml(p.label || "passkey") + '</span><button class="btn btn--ghost" data-rm="' + escAttr(p.id) + '" style="padding:3px 10px;font-size:12px">Remove</button></div>').join("");
      listEl.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true; err.textContent = "";
        try { await webauthnRemove(b.getAttribute("data-rm")); await refresh(); } catch (e) { b.disabled = false; err.textContent = (e && e.message) || "Couldn\u2019t remove that passkey."; }
      }));
    }
    modal.querySelector("[data-add]").addEventListener("click", async () => {
      const btn = modal.querySelector("[data-add]"); btn.disabled = true; err.textContent = "";
      try {
        try { await webauthnRegister(); }
        catch (e) {
          if (e && e.needStepup) {
            const ok = await deviceStepUpModal({ sub: "To add a passkey on this device, first verify it\u2019s you \u2014 recovery passphrase + admin password." });
            if (!ok) { btn.disabled = false; return; }
            await webauthnRegister();
          } else throw e;
        }
        await refresh(); status("Passkey added.", true);
      }
      catch (e) { err.textContent = (e && e.message) || "Enrolment failed."; }
      finally { btn.disabled = false; }
    });
    refresh();
  }

  function changeKeyModal(opts) {
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
    settingsMount(modal, opts);
    const cur = modal.querySelector("[data-cur]"), nw = modal.querySelector("[data-new]"), cf = modal.querySelector("[data-confirm]"), err = modal.querySelector(".pass__err");
    setTimeout(function () { try { cur.focus(); } catch (e) {} }, 30);
    const done = () => { if (opts && opts.onClose) opts.onClose(); else modal.remove(); };
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    modal.addEventListener("click", (e) => { if (e.target === modal) done(); });
    async function submit() {
      if (stored && (await sha256(cur.value)) !== stored) { err.textContent = "Current key is incorrect"; return; }
      const val = nw.value;
      if (val.length < 4) { err.textContent = "New key must be at least 4 characters"; return; }
      if (cf.value !== val) { err.textContent = "New keys don\u2019t match"; return; }
      if (stored && (await sha256(val)) === stored) { err.textContent = "That\u2019s already your current key"; return; }
      localStorage.setItem(HASH_KEY, await sha256(val));
      try { localStorage.setItem(GATE_KEY, JSON.stringify(await rkGateRecord(val))); } catch (e) {}
      done();
      status("Admin key updated \u2014 you\u2019ll use the new key next time you open admin. Publish to require it on your other devices too.", true);
    }
    modal.querySelector("[data-go]").addEventListener("click", submit);
    modal.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") done(); });
  }


  /* expose the studio entry so the shell can open it after the gate passes */
  window.__RKStudio = { open: open };
})();
