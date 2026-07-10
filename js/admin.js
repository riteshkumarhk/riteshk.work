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
  const AI_DEFAULT_BASE = { openai: "https://api.openai.com/v1", gemini: "https://generativelanguage.googleapis.com/v1beta", anthropic: "https://api.anthropic.com/v1", custom: "" };
  const AI_IMAGE_PROVIDERS = ["openai", "gemini", "custom"];
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
    const canGen = !!cfg.key && aiSupportsImages();
    const aiHint = !cfg.key ? "Add an API key in the AI tab to enable this"
      : !aiSupportsImages() ? "This service (Claude) can't generate images"
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
    else if (b.type === "media") body = sfInput(i, j, "heading", "Heading") + sfArea(i, j, "items", "Media \u2014 one per line:  url | caption", itemsToText("media", b.items), 4, "URL may be an image, gif or video. Leave the url blank for a redacted placeholder.");
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
        '<div class="adm__autobar"><button class="btn btn--auto" data-act="autostyle">Auto-style landing</button><span class="adm__auto-note">One click applies the bronze / bold / italic accents. You can still fine-tune by hand.</span></div>' +
        input("Eyebrow", "landing.eyebrow") +
        input("Domains", "landing.domains", { hint: "e.g. Growth · AI · Identity" }) +
        input("Main statement", "landing.statement", { type: "textarea", rows: 3, hint: "One line per row. The closing word (why / how) gets the italic accent." }) +
        input("Description", "landing.intro", { type: "textarea", rows: 4, hint: "Products auto-bronze; “leading …” phrases auto-bold." }) +
        input("Footer line", "landing.presence", { hint: "e.g. Currently at Microsoft — Hyderabad, India" })
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
  function aiCfg(purpose) {
    const scope = aiScope(purpose);
    const p = aiGet(scope, "provider") || "openai";
    return {
      purpose: purpose || "img", scope: scope, provider: p,
      key: aiGet(scope, "key") || "",
      model: (aiGet(scope, "model") || AI_DEFAULT_MODEL[p] || "").trim(),
      base: (aiGet(scope, "base") || AI_DEFAULT_BASE[p] || "").trim().replace(/\/+$/, ""),
    };
  }
  function aiBlock(scope, label, note) {
    const p = aiGet(scope, "provider") || "openai";
    const key = aiGet(scope, "key") || "";
    const model = aiGet(scope, "model") || AI_DEFAULT_MODEL[p] || "";
    const base = aiGet(scope, "base") || AI_DEFAULT_BASE[p] || "";
    const masked = key ? (key.slice(0, 3) + "\u2022\u2022\u2022\u2022\u2022\u2022" + key.slice(-4)) : "";
    const opts = AI_PROVIDERS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === p ? " selected" : "") + ">" + x[1] + "</option>"; }).join("");
    return '<div class="aiblk"><div class="aiblk__head">' + label + (note ? ' <span>' + note + "</span>" : "") + "</div>" +
      '<div class="af"><label class="af__label">Service</label><select id="aiProvider_' + scope + '" data-aiscope="' + scope + '">' + opts + "</select></div>" +
      '<div class="af"><label class="af__label">API key</label><input type="password" id="aiKey_' + scope + '" placeholder="' + (key ? "Saved \u2014 paste to replace" : "Paste your key") + '" autocomplete="off" /><div class="af__hint">' + (key ? ("In use: " + escHtml(masked)) : "Not set") + "</div></div>" +
      '<div class="af__row"><div class="af"><label class="af__label">Model</label><input type="text" id="aiModel_' + scope + '" value="' + escAttr(model) + '" /><div class="af__hint">' + escHtml(modelHint(p)) + "</div></div>" +
      '<div class="af"><label class="af__label">API base URL</label><input type="text" id="aiBase_' + scope + '" value="' + escAttr(base) + '" /></div></div></div>';
  }
  function aiPickProvider(scope, p) {
    localStorage.setItem("rk:ai:" + scope + ":provider", p);
    localStorage.setItem("rk:ai:" + scope + ":model", AI_DEFAULT_MODEL[p] || "");
    localStorage.setItem("rk:ai:" + scope + ":base", AI_DEFAULT_BASE[p] || "");
    localStorage.removeItem("rk:ai:" + scope + ":key");
    const mEl = root.querySelector("#aiModel_" + scope);
    if (mEl) { mEl.value = AI_DEFAULT_MODEL[p] || ""; const h = mEl.parentElement.querySelector(".af__hint"); if (h) h.textContent = modelHint(p); }
    const bEl = root.querySelector("#aiBase_" + scope);
    if (bEl) bEl.value = AI_DEFAULT_BASE[p] || "";
    const kEl = root.querySelector("#aiKey_" + scope);
    if (kEl) { kEl.value = ""; kEl.placeholder = "Paste your key"; const h = kEl.parentElement.querySelector(".af__hint"); if (h) h.textContent = "Not set"; }
  }
  function aiPersistVisible() {
    ["all", "txt", "img"].forEach(function (scope) {
      const sel = root.querySelector("#aiProvider_" + scope);
      if (!sel) return;
      const p = sel.value;
      localStorage.setItem("rk:ai:" + scope + ":provider", p);
      const k = root.querySelector("#aiKey_" + scope), m = root.querySelector("#aiModel_" + scope), bs = root.querySelector("#aiBase_" + scope);
      if (k && k.value.trim()) localStorage.setItem("rk:ai:" + scope + ":key", k.value.trim());
      if (m) localStorage.setItem("rk:ai:" + scope + ":model", m.value.trim() || AI_DEFAULT_MODEL[p] || "");
      if (bs) localStorage.setItem("rk:ai:" + scope + ":base", bs.value.trim() || AI_DEFAULT_BASE[p] || "");
    });
  }
  function aiSave() { aiPersistVisible(); renderBody(); status("AI settings saved \u2014 local only.", true); }
  function aiPromptFor(i) {
    const el = root.querySelector('[data-aiprompt="' + i + '"]');
    return el ? el.value.trim() : "";
  }
  async function imgGenerate(i) {
    const cfg = aiCfg("img");
    if (!cfg.key) return status("Add your API key in the AI tab first.");
    const p = aiPromptFor(i);
    if (!p) return status("Type a prompt to generate an image.");
    status("Generating image\u2026 this can take a moment.");
    try {
      const uri = await compressDataUri(await aiImage(cfg, p, null));
      data.work[i].image = uri; apply(true); renderBody(); status("Image generated.", true);
    } catch (e) { status("Generate failed: " + e.message); }
  }
  async function imgModify(i) {
    const cfg = aiCfg("img");
    if (!cfg.key) return status("Add your API key in the AI tab first.");
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
    if (cfg.provider === "gemini") return aiImageGemini(cfg, prompt, sourceImage);
    if (cfg.provider === "anthropic") throw new Error("Claude can't generate images \u2014 pick OpenAI or Gemini.");
    return aiImageOpenAI(cfg, prompt, sourceImage);
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
  function buildMenu() {
    const theme = (window.__theme ? window.__theme.mode() : (localStorage.getItem(THEME_KEY) || "system"));
    const narrow = window.innerWidth < ADMIN_MIN;
    menuEl = document.createElement("div");
    menuEl.className = "cmenu";
    menuEl.innerHTML =
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
  }
  if (window.__siteRendered) init();
  else document.addEventListener("site:rendered", init, { once: true });
})();
