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
  vaultSignedUrl, vaultRedeem, ownerVaultGrant, webauthnSupported, webauthnList, webauthnAuth, authStatus, cachedAuthMode, recoverWithPassphrase
} from "./admin-core.js";

(function () {
  "use strict";

  // Bridge the vault resolver + pass-redeem onto window.RK for the viewer (project.js/render.js are
  // separate bundles that share via window.RK). Done BEFORE the preview early-return so the studio's
  // preview iframe — which loads this file with ?preview and bails out below — still gets it.
  try { window.RK = window.RK || {}; window.RK.vaultSignedUrl = vaultSignedUrl; window.RK.vaultRedeem = vaultRedeem; window.RK.ownerVaultGrant = ownerVaultGrant; } catch (e) {}

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
    const avatarUrl = (window.RK && window.RK.published && window.RK.published.contact && window.RK.published.contact.avatar) || "";
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
      (creating ? "" : '<button class="btn btn--primary" data-passkey hidden style="width:100%;justify-content:center;margin-bottom:14px">\uD83D\uDD11 Sign in with a passkey</button><div class="pass__or" data-or hidden style="text-align:center;font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.4;margin:0 0 12px">or use your admin key</div>') +
      '<input type="password" placeholder="Key" autofocus />' +
      (creating ? '<input type="password" placeholder="Confirm key" data-confirm />' : "") +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button>' +
      '<button class="btn btn--primary" data-go>' + (creating ? "Create" : "Enter") + "</button></div>" +
      '<div class="pass__cred" style="margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,.09);display:flex;flex-direction:column;align-items:center;gap:13px">' +
        '<div style="width:60px;height:60px;border-radius:50%;overflow:hidden;flex:0 0 60px;background:rgba(255,255,255,.05);border:1px solid color-mix(in srgb, var(--accent) 45%, rgba(255,255,255,.14));display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 4px color-mix(in srgb, var(--accent) 9%, transparent)">' +
          (avatarUrl ? '<img src="' + avatarUrl + '" alt="Ritesh" style="width:100%;height:100%;object-fit:cover" />' : '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.4" style="opacity:.4"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-6.5 8-6.5s8 2.1 8 6.5"/></svg>') +
        "</div>" +
        '<div style="background:color-mix(in srgb, var(--accent) 8%, transparent);border:1px solid color-mix(in srgb, var(--accent) 24%, transparent);border-radius:13px;padding:13px 15px;text-align:center">' +
          '<div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:8px">\u2726 A little pride</div>' +
          '<div style="font-size:12.5px;line-height:1.62;opacity:.82">I was a core designer on the team that brought <b style="color:var(--accent);font-weight:600">passkeys to Windows</b> \u2014 yes, the very security behind sign-ins like this one. Endless gratitude to my teammates across the Windows security landscape for the opportunity and the collaboration. <span style="opacity:.7">\u2014 Ritesh</span></div>' +
        "</div>" +
      "</div></div>";
    document.body.appendChild(modal);
    const pass = modal.querySelector('input[type="password"]');
    const confirm2 = modal.querySelector("[data-confirm]");
    const err = modal.querySelector(".pass__err");
    pass.focus();

    // Offer passkey sign-in when any are enrolled (and the browser supports it). The password stays
    // as a fallback so a new/unenrolled device is never locked out.
    async function doPasskey() {
      const pkBtn = modal.querySelector("[data-passkey]");
      if (pkBtn) pkBtn.disabled = true; err.textContent = "";
      try { await webauthnAuth("login"); done(); openStudio(); }
      catch (e) { if (pkBtn) pkBtn.disabled = false; err.textContent = (e && e.message) || "Passkey sign-in didn’t work."; }
    }
    let recovering = false, recovery2fa = false;
    function showRecover() {
      recovering = true;
      const pkBtn = modal.querySelector("[data-passkey]"); if (pkBtn) pkBtn.style.display = "none";
      const link = modal.querySelector("[data-reclink]"); if (link) link.style.display = "none";
      const subEl = modal.querySelector(".pass__sub"); if (subEl) subEl.textContent = recovery2fa
        ? "Enter your recovery passphrase and your admin password to regain access, then add a new passkey."
        : "Enter your recovery passphrase to regain access, then add a new passkey.";
      pass.placeholder = "Recovery passphrase"; pass.style.display = ""; pass.value = ""; try { pass.focus(); } catch (e) {}
      // Second factor (when 2-factor recovery is on): the admin password.
      if (recovery2fa && !modal.querySelector("[data-recpw]")) {
        const pw2 = document.createElement("input");
        pw2.type = "password"; pw2.setAttribute("data-recpw", "1");
        pw2.placeholder = "Admin password"; pw2.autocomplete = "off";
        if (pass.parentNode) pass.parentNode.insertBefore(pw2, pass.nextSibling);
      }
      const go = modal.querySelector("[data-go]"); if (go) { go.style.display = ""; go.disabled = false; go.textContent = "Recover"; }
    }
    // Render the sign-in mode SYNCHRONOUSLY (before first paint) so a passkey-only account never flashes
    // the admin-key field. Cached from the last authStatus; optimistically passkey-first when unknown.
    function applyPasskeyOnly(hasRecovery) {
      const pkBtn = modal.querySelector("[data-passkey]"), orEl = modal.querySelector("[data-or]"), go = modal.querySelector("[data-go]"), subEl = modal.querySelector(".pass__sub");
      if (pass) pass.style.display = "none";
      if (go) go.style.display = "none";
      if (orEl) { orEl.hidden = true; orEl.style.display = "none"; }
      if (subEl && !recovering) subEl.textContent = "Sign in with your passkey.";
      if (pkBtn) { pkBtn.hidden = false; if (!pkBtn.dataset.wired) { pkBtn.dataset.wired = "1"; pkBtn.addEventListener("click", doPasskey); } }
      if (hasRecovery && !modal.querySelector("[data-reclink]")) {
        const rec = document.createElement("button");
        rec.type = "button"; rec.setAttribute("data-reclink", "1");
        rec.textContent = "Lost your passkey? Recover access";
        rec.style.cssText = "display:block;margin:10px auto 0;background:none;border:none;color:inherit;opacity:.5;font-size:12px;text-decoration:underline;cursor:pointer";
        rec.addEventListener("click", showRecover);
        const actions = modal.querySelector(".pass__actions");
        if (actions && actions.parentNode) actions.parentNode.insertBefore(rec, actions.nextSibling);
      }
    }
    function applyKeyMode(passkeys) {
      if (recovering) return;
      const pkBtn = modal.querySelector("[data-passkey]"), orEl = modal.querySelector("[data-or]"), go = modal.querySelector("[data-go]"), subEl = modal.querySelector(".pass__sub");
      if (pass) pass.style.display = "";
      if (go) go.style.display = "";
      if (subEl) subEl.textContent = "Enter your key to open the studio. Required every time.";
      if (passkeys > 0) {
        if (pkBtn) { pkBtn.hidden = false; if (!pkBtn.dataset.wired) { pkBtn.dataset.wired = "1"; pkBtn.addEventListener("click", doPasskey); } }
        if (orEl) { orEl.hidden = false; orEl.style.display = ""; }
      }
      try { if (pass) pass.focus(); } catch (e) {}
    }
    if (!creating && webauthnSupported()) {
      const cachedAuth = cachedAuthMode();
      recovery2fa = !!(cachedAuth && cachedAuth.hasAdminPass);
      // Instant render from the cached mode (passkey-first when unknown) → no admin-key flash.
      if (!cachedAuth || cachedAuth.passwordless) applyPasskeyOnly(cachedAuth && cachedAuth.hasRecovery);
      else applyKeyMode(cachedAuth.passkeys || 0);
      authStatus().then((st) => {
        recovery2fa = !!st.hasAdminPass;
        if (st.passwordless) applyPasskeyOnly(st.hasRecovery);
        else applyKeyMode(st.passkeys);
      }).catch(() => { if (!cachedAuth) applyKeyMode(0); });
    }

    const done = () => modal.remove();
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    modal.addEventListener("click", (e) => { if (e.target === modal) done(); });

    async function submit() {
      const val = pass.value;
      if (recovering) {
        if (!val) { err.textContent = "Enter your recovery passphrase"; return; }
        const pw2El = modal.querySelector("[data-recpw]");
        const adminPw = pw2El ? pw2El.value : "";
        if (recovery2fa && !adminPw) { err.textContent = "Enter your admin password"; return; }
        const go = modal.querySelector("[data-go]"); if (go) go.disabled = true; err.textContent = "";
        try { await recoverWithPassphrase(val, adminPw); done(); openStudio(); }
        catch (e) { if (go) go.disabled = false; err.textContent = (e && e.message) || "Recovery didn’t work."; }
        return;
      }
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
      // Cache-bust: the studio is owner-only and opened infrequently, so always load the freshest
      // build — otherwise the browser serves a stale admin-studio.js after a deploy.
      s.src = "/js/admin-studio.js?v=" + Date.now(); s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { __studioLoading = null; reject(new Error("studio load failed")); };
      document.head.appendChild(s);
    });
    return __studioLoading;
  }
  function studioUrlExit() { try { if (window.__STUDIO_PAGE) { location.href = "/"; return; } if (location.pathname === "/studio") history.replaceState({}, "", "/"); } catch (e) {} }
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
    } else {                                         // menu closed → sit just below the recruiter flyout if it's up, else the default corner
      var fly = document.querySelector(".rkfly");
      el.classList.remove("soundtoast--low");
      if (fly) {
        var cw2 = document.documentElement.clientWidth;
        var frr = fly.getBoundingClientRect();
        el.style.right = Math.max(12, Math.round(cw2 - frr.right)) + "px";
        el.style.top = Math.round(frr.bottom + 10) + "px";
      } else {
        el.style.right = "";
        el.style.top = "";
      }
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
    var _fly = document.querySelector(".rkfly"); if (_fly && _fly.__dismiss) _fly.__dismiss(true);   // fold the recruiter flyout away — the menu itself offers “Special view”
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
      '<button class="cmenu__item" data-open="special"><span class="cmenu__ico">\u25c7</span><span><b>Recruiter or hiring manager</b><i>Enter a ticket for a curated view</i></span></button>' +
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
      '<div class="pass__box"><div class="pass__title">Recruiter or hiring manager</div>' +
      '<div class="pass__sub">Enter the ticket you were given — a code or a link — to unlock a curated view of the work.</div>' +
      '<input type="text" placeholder="Ticket code or link" autocomplete="off" autofocus />' +
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
      const r = await applyTicketCode(val);
      if (!r.ok) { if (r.reason === "expired") { done(); expiredNotice({}); return; } err.textContent = ticketErr(r.reason); return; }
      done();
    }
    modal.querySelector("[data-go]").addEventListener("click", submit);
    modal.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") done(); });
  }
  function ticketArrived(sv) {
    flash("Ticket accepted \u2014 your curated projects are in the Work section below.");
    const el = document.getElementById("work");
    if (el && el.scrollIntoView) requestAnimationFrame(function () { try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {} });
  }
  // Turn a raw ticket string OR a full link into a code, then unlock its curated view. Shared by the
  // ⋯ dialog, the recruiter flyout, and the ?ticket= deep link.
  function extractTicketCode(raw) {
    raw = (raw || "").trim();
    if (!raw) return "";
    if (/[?&]ticket=/i.test(raw) || /^https?:\/\//i.test(raw)) {
      try { var u = new URL(raw, location.origin); var t = u.searchParams.get("ticket"); if (t) return t.trim(); } catch (e) {}
      var m = /[?&]ticket=([^&#\s]+)/i.exec(raw); if (m) { try { return decodeURIComponent(m[1]).trim(); } catch (e) { return m[1].trim(); } }
    }
    return raw;
  }
  async function applyTicketCode(raw, opts) {
    var code = extractTicketCode(raw);
    if (!code) return { ok: false, reason: "empty" };
    if (!(window.RK && window.RK.applySpecialView)) return { ok: false, reason: "notready" };
    var h = await sha256(code.toLowerCase());
    var views = (window.RK.data && window.RK.data.specialViews) || [];
    var match = views.filter(function (v) { return v.ticketHash === h; })[0];
    if (!match) return { ok: false, reason: "nomatch" };
    var skipExpiry = !!(opts && opts.skipExpiry);   // a server-validated per-recruiter token governs its own 15-day expiry
    try { if (skipExpiry) sessionStorage.setItem("rk:sv:tok", "1"); else sessionStorage.removeItem("rk:sv:tok"); } catch (e) {}
    if (!skipExpiry && window.RK.svExpired && window.RK.svExpired(match)) return { ok: false, reason: "expired" };
    try { sessionStorage.setItem("rk:sv:code", code); } catch (e) {}
    if (window.RK.showUnlockingBanner) window.RK.showUnlockingBanner("Unlocking\u2026");
    if (window.RK.decryptActiveTicket) { try { await window.RK.decryptActiveTicket(window.RK.data, match, code); } catch (e) {} }
    window.RK.applySpecialView(match.id);
    ticketArrived(match);
    return { ok: true, view: match };
  }
  function ticketErr(reason) {
    return reason === "expired" ? "That ticket has expired."
      : reason === "empty" ? "Enter your ticket or link."
      : reason === "notready" ? "One moment \u2014 the page is still loading. Try again."
      : "That ticket doesn\u2019t match anything.";
  }
  // Shared “request a code” panel — reachable from the recruiter flyout and the case-study deeper cut.
  // Posts to the Worker (which logs it + pings the owner); the owner then approves and issues a code.
  function requestAccessModal(opts) {
    opts = opts || {};
    if (document.querySelector(".rkreq")) return;
    var modal = document.createElement("div");
    modal.className = "pass rkreq";
    modal.innerHTML =
      '<div class="pass__box">' +
        '<div class="pass__title">Request access</div>' +
        '<div class="pass__sub">Most of my work is open. A few pieces are under NDA \u2014 tell me who you are and I\u2019ll email a code for the curated view.</div>' +
        '<div class="pass__note rkreq__ctx" hidden></div>' +
        '<input data-f="name" type="text" placeholder="Your name" autocomplete="name" />' +
        '<input data-f="email" type="email" placeholder="Work email" autocomplete="email" />' +
        '<input data-f="company" type="text" placeholder="Company / role" autocomplete="organization" />' +
        '<input data-f="note" type="text" placeholder="Anything specific? (optional)" />' +
        '<input data-f="hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" />' +
        '<div class="pass__err"></div>' +
        '<div class="pass__actions"><button class="btn btn--ghost" data-cancel type="button">Cancel</button><button class="btn btn--primary" data-go type="button">Send request</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    var box = modal.querySelector(".pass__box"), errEl = modal.querySelector(".pass__err"), go = modal.querySelector("[data-go]");
    if (opts.context) { var cx = modal.querySelector(".rkreq__ctx"); cx.textContent = "Requesting: " + opts.context; cx.hidden = false; }
    function done() { if (modal.parentNode) modal.remove(); }
    function val(f) { var e2 = modal.querySelector('[data-f="' + f + '"]'); return e2 ? e2.value.trim() : ""; }
    async function submit() {
      var name = val("name"), email = val("email"), company = val("company"), note = val("note"), hp = val("hp");
      if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { errEl.textContent = "Add your name, company/role and a valid work email."; return; }
      go.disabled = true; errEl.textContent = "Sending\u2026";
      try {
        var res = await fetch(ADMIN_WORKER + "/request-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, email: email, company: company, note: note, context: opts.context || "", hp: hp }) });
        var j = await res.json().catch(function () { return {}; });
        if (!res.ok || !j || !j.ok) { go.disabled = false; errEl.textContent = (j && j.error) || "Couldn\u2019t send that \u2014 try again."; return; }
        box.innerHTML = '<div class="pass__title">Request sent</div><div class="pass__sub"></div><div class="pass__actions"><button class="btn btn--primary" data-done type="button">Done</button></div>';
        box.querySelector(".pass__sub").textContent = "Thanks \u2014 I\u2019ll email a code to " + email + " soon. Everything else on the site is already open.";
        box.querySelector("[data-done]").addEventListener("click", done);
      } catch (e2) { go.disabled = false; errEl.textContent = "Network hiccup \u2014 try again."; }
    }
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    go.addEventListener("click", submit);
    modal.addEventListener("click", function (e) { if (e.target === modal) done(); });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") done(); else if (e.key === "Enter") submit(); });
    setTimeout(function () { try { modal.querySelector('[data-f="name"]').focus(); } catch (e) {} }, 40);
  }
  // An old or revoked ticket link that still matches a KNOWN-but-expired view: say so plainly and
  // offer a one-click path to request a fresh code (reuses the request-access panel).
  function expiredNotice(opts) {
    opts = opts || {};
    if (document.querySelector(".rkexp") || document.querySelector(".rkreq")) return;
    var modal = document.createElement("div");
    modal.className = "pass rkexp";
    modal.innerHTML =
      '<div class="pass__box">' +
        '<div class="pass__title">This access link has expired</div>' +
        '<div class="pass__sub">The curated view you were given is no longer active. Request a fresh code and I\u2019ll email you a new link.</div>' +
        '<div class="pass__actions"><button class="btn btn--ghost" data-cancel type="button">Not now</button><button class="btn btn--primary" data-new type="button">Request a new code</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    function done() { if (modal.parentNode) modal.remove(); }
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    modal.querySelector("[data-new]").addEventListener("click", function () { done(); requestAccessModal({ context: opts.context || "A new access code (my previous link expired)" }); });
    modal.addEventListener("click", function (e) { if (e.target === modal) done(); });
    modal.addEventListener("keydown", function (e) { if (e.key === "Escape") done(); });
  }
  // Soft, non-blocking landing prompt (anchored under the ··· menu) to enter a ticket (code or link).
  // Shown to every visitor once per session when the owner has turned Recruiter mode on.
  function recruiterFlyout(errNote) {
    if (document.querySelector(".rkfly")) return;
    var el = document.createElement("div");
    el.className = "rkfly";
    el.innerHTML =
      '<button class="rkfly__x" type="button" aria-label="Dismiss">\u00d7</button>' +
      '<div class="rkfly__title">Recruiter or hiring manager</div>' +
      '<div class="rkfly__sub">Recruiting? Enter the ticket you were given to unlock the NDA case studies shared with you \u2014 everything else here is already open.</div>' +
      '<input class="rkfly__inp" type="text" placeholder="Ticket code or link" autocomplete="off" />' +
      '<div class="rkfly__err"></div>' +
      '<div class="rkfly__row">' +
        '<button class="btn btn--ghost rkfly__cancel" type="button">Not now</button>' +
        '<button class="btn btn--ghost rkfly__back" type="button">Back</button>' +
        '<button class="btn btn--primary rkfly__next" type="button">I have a ticket</button>' +
        '<button class="btn btn--primary rkfly__go" type="button">Unlock</button>' +
      '</div>' +
      '<div class="rkfly__req">No code? <button type="button" class="rkfly__reqbtn">Request access</button></div>';
    document.body.appendChild(el);
    var inp = el.querySelector(".rkfly__inp"), errEl = el.querySelector(".rkfly__err"), go = el.querySelector(".rkfly__go");
    if (errNote) errEl.textContent = errNote;
    requestAnimationFrame(function () { el.classList.add("is-on"); placeSoundToast(); });   // push any live “sound on” toast below the flyout
    function dismiss(instant) {
      try { sessionStorage.setItem("rk:fly:dismissed", "1"); } catch (e) {}
      el.classList.remove("is-on");
      var kill = function () { if (el.parentNode) el.remove(); placeSoundToast(); };   // return the toast to the corner once we're gone
      if (instant) kill(); else setTimeout(kill, 300);
    }
    el.__dismiss = dismiss;   // let the ··· menu fold this away when it opens
    el.__hide = function () { if (el.parentNode) el.remove(); placeSoundToast(); };   // route change — remove WITHOUT marking it dismissed
    el.querySelector(".rkfly__cancel").addEventListener("click", function () { dismiss(); });
    el.querySelector(".rkfly__x").addEventListener("click", function () { dismiss(); });
    var _req = el.querySelector(".rkfly__reqbtn"); if (_req) _req.addEventListener("click", function () { requestAccessModal({}); });
    var _next = el.querySelector(".rkfly__next"); if (_next) _next.addEventListener("click", function () { el.classList.add("is-step2"); placeSoundToast(); setTimeout(function () { try { inp.focus(); } catch (e) {} }, 40); });
    var _back = el.querySelector(".rkfly__back"); if (_back) _back.addEventListener("click", function () { el.classList.remove("is-step2"); placeSoundToast(); });
    async function submit() {
      var v = inp.value.trim(); if (!v) { errEl.textContent = "Enter your ticket or link"; return; }
      go.disabled = true; errEl.textContent = "";
      var r = await applyTicketCode(v);
      if (!r.ok) { go.disabled = false; if (r.reason === "expired") { dismiss(true); expiredNotice({}); return; } errEl.textContent = ticketErr(r.reason); return; }
      try { sessionStorage.setItem("rk:fly:dismissed", "1"); } catch (e) {}
      if (el.parentNode) el.remove(); placeSoundToast();
    }
    go.addEventListener("click", submit);
    el.addEventListener("keydown", function (e) { if (e.key === "Enter" && inp.offsetParent !== null) submit(); if (e.key === "Escape") dismiss(); });
    setTimeout(function () { try { if (inp.offsetParent !== null) inp.focus(); } catch (e) {} }, 350);
  }
  // Exchange a per-recruiter ?k= link for the current access code (the Worker checks it's live, not
  // expired or revoked). Returns the code, or null after surfacing a friendly message.
  async function redeemAccessLink(token) {
    try {
      var res = await fetch(ADMIN_WORKER + "/access/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ k: token }) });
      var j = null; try { j = await res.json(); } catch (e) {}
      if (res.ok && j && j.code) return j;   // full response so recruiterInit can branch on mode (all vs curated)
      var reason = (j && j.reason) || "invalid";
      if (reason === "expired") { expiredNotice({}); return null; }
      maybeRecruiterFlyout(reason === "revoked" ? "This access link was turned off \u2014 reply to the email and I\u2019ll sort it out." : "This access link isn\u2019t valid \u2014 reply to the email and I\u2019ll send a fresh one.");
      return null;
    } catch (e) { maybeRecruiterFlyout("Couldn\u2019t reach the server \u2014 try again in a moment."); return null; }
  }
  // A server-minted per-recruiter CURATED grant: same full-access code, but the recruiter is shown
  // only the curated slice. Find the master view (whose ticket hash matches the code — it holds the
  // vault/study wraps) so render.js can decrypt-against-master, then display just the subset.
  async function applyCuratedGrant(res) {
    var code = res && res.code;
    if (!code || !(window.RK && window.RK.applyCuratedView)) return;
    var master = null;
    try {
      var h = await sha256(String(code).toLowerCase());
      var views = (window.RK.data && window.RK.data.specialViews) || [];
      master = views.filter(function (v) { return v.ticketHash === h; })[0] || null;
    } catch (e) {}
    var spec = {
      id: "__curated__", masterId: master ? master.id : "",
      name: res.name || "Curated view",
      audience: res.audience || (res.company ? "Prepared for " + res.company : ""),
      workIds: res.workIds || [], highlightIdx: res.highlightIdx || [], capabilityIdx: res.capabilityIdx || [],
      days: 0
    };
    try { await window.RK.applyCuratedView(spec, code); } catch (e) {}
  }
  function recruiterInit() {
    document.addEventListener("rk:route", syncRecruiterFlyout);   // a case study opens/closes over the landing without a reload
    var kTok = new URLSearchParams(location.search || "").get("k");
    if (kTok) {
      if (window.RK && window.RK.showUnlockingBanner) window.RK.showUnlockingBanner("Unlocking your access\u2026");   // instant feedback while we redeem + decrypt (the link open takes a moment)
      redeemAccessLink(kTok).then(function (res) {
        try { var u = new URL(location.href); u.searchParams.delete("k"); history.replaceState({}, "", u.pathname + (u.search || "") + u.hash); } catch (e) {}
        if (!res || !res.code) { if (window.RK && window.RK.removeSvBanner) window.RK.removeSvBanner(); return; }
        if (res.vaultGrant && window.RK && window.RK.applyVaultGrant) window.RK.applyVaultGrant(res.vaultGrant);   // per-link vault grant (scoped to this link's works, current keys) — beats the shared-code fallback
        if (res.mode === "curated") { applyCuratedGrant(res); return; }   // scoped view; the all-mode path below is unchanged
        applyTicketCode(res.code, { skipExpiry: true }).then(function (r) {
          if (!r || !r.ok) { if (window.RK && window.RK.removeSvBanner) window.RK.removeSvBanner(); if (r && r.reason === "expired") expiredNotice({}); else maybeRecruiterFlyout(ticketErr(r && r.reason)); }
        });
      });
      return;
    }
    var deep = new URLSearchParams(location.search || "").get("ticket");
    if (deep) {
      applyTicketCode(deep).then(function (r) {
        try { var u = new URL(location.href); u.searchParams.delete("ticket"); history.replaceState({}, "", u.pathname + (u.search || "") + u.hash); } catch (e) {}
        if (!r || !r.ok) { if (r && r.reason === "expired") expiredNotice({}); else maybeRecruiterFlyout(ticketErr(r && r.reason)); }
      });
      return;
    }
    maybeRecruiterFlyout();
  }
  function onLandingPath() {                                  // the main page only — not /work/… case studies, not /studio
    var p = location.pathname || "/";
    return p === "/" || /\/index\.html?$/i.test(p);
  }
  function maybeRecruiterFlyout(errNote) {
    if (!onLandingPath()) return;                            // only offer it on the landing page
    var d = (window.RK && (window.RK.data || window.RK.published)) || null;   // data === published on the live site
    if (!(d && d.recruiterMode)) return;                     // owner hasn't turned Recruiter mode on
    try { if (sessionStorage.getItem("rk:fly:dismissed")) return; } catch (e) {}
    if (document.querySelector(".sv-banner")) return;        // already in a curated / present view
    recruiterFlyout(errNote);
  }
  // A case study opens/closes over the landing without a reload; hide the flyout while one is open and
  // bring it back on return — but only if the visitor hasn't intentionally dismissed it.
  function syncRecruiterFlyout() {
    var el = document.querySelector(".rkfly");
    if (onLandingPath()) { if (!el) maybeRecruiterFlyout(); }
    else if (el && el.__hide) el.__hide();
  }
  function afterRender(fn) {
    if (window.__siteRendered) fn();
    else document.addEventListener("site:rendered", fn, { once: true });
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
      // Step aside so presentAll's “Unlocking…” toast is visible; the dialog returns only on error.
      modal.style.display = "none";
      let res;
      try { res = await window.RK.presentAll(val); } catch (e) { res = { ok: false, reason: "err" }; }
      if (!res || !res.ok) {
        modal.style.display = ""; goBtn.disabled = false; goBtn.textContent = was;
        err.textContent = (res && res.reason === "pass") ? "That passphrase didn't unlock your protected work." : "Couldn't start present mode.";
        return;
      }
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
    if (window.__STUDIO_PAGE) {
      // Dedicated /studio page: no landing to wire — just open the gate.
      try { if (window.RK) window.RK.requestAccess = requestAccessModal; } catch (e) {}
      setTimeout(gate, 60);
      return;
    }
    const clock = document.getElementById("clock");
    if (clock) clock.addEventListener("click", toggleMenu);
    const more = document.getElementById("moreBtn");
    if (more) more.addEventListener("click", toggleMenu);
    musInit();
    if (window.RK) window.RK.requestAccess = requestAccessModal;
    afterRender(recruiterInit);
  }
  if (window.__siteRendered) init();
  else document.addEventListener("site:rendered", init, { once: true });
})();
