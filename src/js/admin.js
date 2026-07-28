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
  rkPbkHex, rkGateRecord, rkGateVerify, getPath, setPath, adminLogin, ADMIN_WORKER,
  vaultSignedUrl
} from "./admin-core.js";

(function () {
  "use strict";

  // Bridge the vault resolver onto window.RK for the viewer (project.js is a separate bundle
  // that shares via window.RK). Done BEFORE the preview early-return so the studio's preview
  // iframe — which loads this file with ?preview and bails out below — still gets it.
  try { (window.RK = window.RK || {}).vaultSignedUrl = vaultSignedUrl; } catch (e) {}

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
  let activeTab = "landing";
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
  /* ---------- passphrase gate (always asks) ---------- */
  function gate() {
    if (window.innerWidth < ADMIN_MIN) { flash("Admin mode needs a wider screen — open it on a laptop or desktop."); return; }
    thDismiss(true);   // clear the landing “have a ticket?” nudge before the gate/editor (it sits above them)
    const publishedGate = (window.RK && window.RK.published && window.RK.published.adminGate) || null;
    const stored = localStorage.getItem(HASH_KEY);
    // A server admin (the Cloudflare Worker) is the source of truth for the key, so any browser —
    // fresh device included — must ENTER the real key (verified server-side), never self-serve a
    // local "create". Create mode only survives as a true first-run fallback with no Worker set.
    const creating = !ADMIN_WORKER && !publishedGate && !stored;
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
        try { localStorage.setItem(GATE_KEY, JSON.stringify(await rkGateRecord(val))); } catch (e) {}
        done(); openStudio();
        return;
      }
      // Prefer a server login (Cloudflare Worker): a short session — not a repo token in your
      // browser — authorises publishing. If the Worker rejects or is unreachable, fall back to
      // the existing local / published-gate check so you're never locked out.
      const go = modal.querySelector("[data-go]");
      if (go) go.disabled = true;
      const login = await adminLogin(val);
      if (login.ok) {
        try { localStorage.setItem(HASH_KEY, await sha256(val)); localStorage.setItem(GATE_KEY, JSON.stringify(await rkGateRecord(val))); } catch (e) {}
        done(); openStudio();
        return;
      }
      var ok = false;
      if (publishedGate && await rkGateVerify(val, publishedGate)) ok = true;
      else if (stored && (await sha256(val)) === stored) ok = true;
      if (ok) {
        try { localStorage.setItem(HASH_KEY, await sha256(val)); localStorage.setItem(GATE_KEY, JSON.stringify(await rkGateRecord(val))); } catch (e) {}
        done(); openStudio();
      } else { if (go) go.disabled = false; err.textContent = "Incorrect key"; }
    }
    modal.querySelector("[data-go]").addEventListener("click", submit);
    modal.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") done(); });
  }


  /* ---------- lazy studio loader: the heavy editor + AI load ONLY after the gate passes ---------- */
  function musSilence() { musResumeOnExit = musPlaying; musStop(); musPlaying = false; musAttract(false); musToastHide(); musSync(); }
  function musRestore() { if (musResumeOnExit) { musResumeOnExit = false; musPlay(); } }
  let __studioLoading = null;
  function loadStudio() {
    if (window.__RKStudio) return Promise.resolve();
    if (__studioLoading) return __studioLoading;
    __studioLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "/js/admin-studio.js"; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { __studioLoading = null; reject(new Error("studio load failed")); };
      document.head.appendChild(s);
    });
    return __studioLoading;
  }
  function studioUrlExit() { try { if (location.pathname === "/studio") history.replaceState({}, "", "/"); } catch (e) {} }
  function openStudio() {
    loadStudio().then(function () {
      if (window.__RKStudio) {
        window.__RKStudio.open({ musSilence: musSilence, musRestore: musRestore, thDismiss: thDismiss, onExit: studioUrlExit });
        try { history.replaceState({}, "", "/studio"); } catch (e) {}   // reflect admin mode in the URL, however you entered
      }
    }).catch(function () { flash("Couldn\u2019t load the editor \u2014 check your connection and try again."); });
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
    placeSoundToast();   // tuck it below the ticket nudge / under the open ··· menu — never on top
    clearTimeout(soundToastTimer);
    soundToastTimer = setTimeout(musToastHide, 8000);
  }
  function musToastHide() {
    var el = document.querySelector(".soundtoast");
    if (el) el.classList.remove("is-on");
    clearTimeout(soundToastTimer);
  }
  function placeSoundToast() {
    var el = document.querySelector(".soundtoast");
    if (!el) return;
    if (menuEl) {                                    // ··· menu open → sit below it, never over it
      var mr = menuEl.getBoundingClientRect();
      var cw = document.documentElement.clientWidth;  // excludes the scrollbar so the edge lines up with the menu
      el.classList.remove("soundtoast--low");
      el.style.right = Math.max(12, Math.round(cw - mr.right)) + "px";
      el.style.top = Math.round(mr.bottom + 10) + "px";
    } else {                                         // menu closed → default corner; drop below the ticket nudge when it's up
      el.style.right = "";
      el.style.top = "";
      el.classList.toggle("soundtoast--low", !!document.querySelector(".tickethint"));
    }
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
    const owner = !!localStorage.getItem(HASH_KEY);   // only the owner's own browser gets Present mode
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
      (owner ? '<button class="cmenu__item" data-open="present"><span class="cmenu__ico">\u25b6</span><span><b>Present mode</b><i>Unlock all work for presenting, not editing</i></span></button>' : "") +
      '<button class="cmenu__item" data-open="admin"' + (narrow ? " disabled" : "") + '><span class="cmenu__ico">\u2726</span><span><b>Admin mode</b><i>' + (narrow ? "Needs a wider screen" : "Edit &amp; curate the site") + "</i></span></button>";
    document.body.appendChild(menuEl);
    positionMenu();
    placeSoundToast();   // push any live “sound on” toast below the menu we just opened
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
    placeSoundToast();
  }
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove(); menuEl = null;
    document.removeEventListener("click", onDocClick);
    window.removeEventListener("resize", positionMenu);
    placeSoundToast();   // menu gone → return the toast to the corner
  }
  function onDocClick(e) { if (menuEl && !menuEl.contains(e.target) && e.target.id !== "clock") closeMenu(); }
  function toggleMenu(e) { if (e) e.stopPropagation(); menuUsed = true; thDismiss(true); if (menuEl) closeMenu(); else buildMenu(); }
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
    else if (which === "present") presentDialog();
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
      try { sessionStorage.setItem("rk:sv:code", val); } catch (e) {}   // survive a reload
      if (window.RK.decryptActiveTicket) { try { await window.RK.decryptActiveTicket(window.RK.data, match, val); } catch (e) {} }
      window.RK.applySpecialView(match.id);
      ticketArrived(match);
    }
    modal.querySelector("[data-go]").addEventListener("click", submit);
    modal.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") done(); });
  }
  function ticketArrived(sv) {
    flash("Ticket accepted \u2014 your curated projects are in the Work section below.");
    const el = document.getElementById("work");
    if (el && el.scrollIntoView) requestAnimationFrame(function () { try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {} });
  }

  /* ---------- present mode (owner: unlock everything to present) ---------- */
  function presentDialog() {
    if (!(window.RK && window.RK.presentAll)) { flash("Present mode isn't ready yet - reload and try again."); return; }
    // Nothing protected? Just show everything unlocked, no passphrase needed.
    if (window.RK.rkHasProtected && !window.RK.rkHasProtected()) {
      Promise.resolve(window.RK.presentAll("")).then(function (r) { if (r && r.ok) presentArrived(r); });
      return;
    }
    const modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">Present mode</div>' +
      '<div class="pass__sub">Enter your recovery passphrase to open every case study fully unlocked - for presenting, not editing.</div>' +
      '<input type="password" placeholder="Recovery passphrase" autocomplete="off" autofocus />' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button>' +
      '<button class="btn btn--primary" data-go>Present</button></div></div>';
    document.body.appendChild(modal);
    const inp = modal.querySelector("input");
    const err = modal.querySelector(".pass__err");
    const goBtn = modal.querySelector("[data-go]");
    inp.focus();
    const done = function () { modal.remove(); };
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    modal.addEventListener("click", function (e) { if (e.target === modal) done(); });
    async function submit() {
      const val = inp.value.trim();
      if (!val) { err.textContent = "Enter your recovery passphrase"; return; }
      err.textContent = ""; goBtn.disabled = true;
      const was = goBtn.textContent; goBtn.textContent = "Unlocking...";
      let res;
      try { res = await window.RK.presentAll(val); } catch (e) { res = { ok: false, reason: "err" }; }
      goBtn.disabled = false; goBtn.textContent = was;
      if (!res || !res.ok) { err.textContent = (res && res.reason === "pass") ? "That passphrase didn't unlock your protected work." : "Couldn't start present mode."; return; }
      done();
      presentArrived(res);
    }
    goBtn.addEventListener("click", submit);
    modal.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); if (e.key === "Escape") done(); });
  }
  function presentArrived(res) {
    flash("Present mode on - every case study is unlocked. Click any project to present.");
    const el = document.getElementById("work");
    if (el && el.scrollIntoView) requestAnimationFrame(function () { try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {} });
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

  /* ---------- “have a ticket?” nudge (points at the More menu on landing) ---------- */
  var thTimer = 0;
  function thAlign() {
    var el = document.querySelector(".tickethint");
    var mb = document.getElementById("moreBtn");
    if (!el || !mb) { window.removeEventListener("resize", thAlign); return; }
    var mr = mb.getBoundingClientRect(), fr = el.getBoundingClientRect();
    el.style.setProperty("--beak", Math.max(12, Math.round(fr.right - (mr.left + mr.width / 2))) + "px");   // point the tail at the ··· centre
  }
  function thDismiss(now) {
    var el = document.querySelector(".tickethint");
    window.removeEventListener("resize", thAlign);
    if (!el) return;
    el.classList.remove("is-on");
    clearTimeout(thTimer);
    if (now) { el.remove(); placeSoundToast(); return; }   // instant kill (entering admin / opening the menu)
    setTimeout(function () { if (el.parentNode) el.remove(); placeSoundToast(); }, 420);
  }
  function ticketHint() {
    if (menuUsed || menuEl) return;   // visitor already opened the ··· menu — don't nudge them to it
    if (document.querySelector(".tickethint")) return;
    if (!document.getElementById("moreBtn")) return;
    var el = document.createElement("button");
    el.type = "button";
    el.className = "tickethint";
    el.setAttribute("aria-label", "Have a ticket? Open the menu to enter it");
    el.innerHTML = '<span class="tickethint__t">Have a ticket? <b>Click here</b></span><span class="tickethint__x" aria-hidden="true">\u00d7</span>';
    document.body.appendChild(el);
    placeSoundToast();   // keep the ticket on top; push any “sound on” toast below it
    thAlign();
    window.addEventListener("resize", thAlign);
    requestAnimationFrame(function () { el.classList.add("is-on"); });
    clearTimeout(thTimer);
    thTimer = setTimeout(thDismiss, 11000);
    el.addEventListener("click", function (e) {
      var closing = !!e.target.closest(".tickethint__x");
      thDismiss();
      if (!closing && !menuEl) toggleMenu();   // open the “···” menu (Special view → enter ticket); leaves the sound toast untouched
    });
  }

  /* ---------- bootstrap ---------- */
  function init() {
    const clock = document.getElementById("clock");
    if (clock) clock.addEventListener("click", toggleMenu);
    const more = document.getElementById("moreBtn");
    if (more) more.addEventListener("click", toggleMenu);
    musInit();
    setTimeout(ticketHint, 1600);
    // Direct studio entry: /studio (and /admin) arrive here as ?studio=1 via the 404 SPA
    // fallback. Tidy the address bar to /studio and open the same gate the clock menu uses.
    try {
      if (new URLSearchParams(location.search || "").get("studio") === "1") {
        try { history.replaceState({}, "", "/studio"); } catch (e) {}
        setTimeout(gate, 350);
      }
    } catch (e) {}
  }
  if (window.__siteRendered) init();
  else document.addEventListener("site:rendered", init, { once: true });
})();
