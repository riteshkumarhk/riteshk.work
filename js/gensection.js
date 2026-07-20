/* Résumé site — Generated Sections interpreter (RKGen).
   ISOLATED from the site's normal blocks: this renders a NEW "gen" block type from a
   declarative, whitelisted spec. It never executes generated code — the AI only ever
   produces DATA (a layout tree of known primitives + token styles), which we validate,
   sanitize and render as safe HTML strings (same model as the rest of the site).

   Safety model:
   - Only known node types + known style tokens survive `clean()`; everything else is dropped.
   - Text is PLAIN (with a tiny **bold** / *italic* / [label](url) / newline markup that WE
     turn into fixed, escaped HTML). No AI-authored HTML is ever rendered.
   - URLs are scheme-checked (http/https/mailto/root-relative/data:image|video only).
   - No inline styles, no class names from the AI, no event handlers, no <script>. */
(function (root) {
  "use strict";

  var CONTAINERS = { stack: 1, row: 1, grid: 1, split: 1, card: 1, section: 1 };
  var LEAVES = { heading: 1, text: 1, quote: 1, stat: 1, pill: 1, icon: 1, media: 1, button: 1, divider: 1, spacer: 1 };
  var SIZES = { sm: 1, md: 1, lg: 1, xl: 1 };
  var TONES = { default: 1, dim: 1, faint: 1, accent: 1 };
  var ALIGNS = { left: 1, center: 1, right: 1 };
  var VALIGNS = { top: 1, center: 1, bottom: 1 };
  var GAPS = { none: 1, sm: 1, md: 1, lg: 1, xl: 1 };
  var PADS = { none: 1, sm: 1, md: 1, lg: 1 };
  var COLS = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 };
  var RADII = { none: 1, sm: 1, md: 1, lg: 1 };
  var BGS = { none: 1, elev: 1, accent: 1, line: 1 };
  var RATIOS = { "16x9": 1, "4x3": 1, "1x1": 1, "3x2": 1, "3x4": 1, "9x16": 1, auto: 1 };
  var FITS = { cover: 1, contain: 1 };
  var MEDIA_KINDS = { image: 1, video: 1, embed: 1 };

  function pick(v, table, dflt) { return (v != null && table[v]) ? v : dflt; }
  function pickNum(v, table, dflt) { return (v != null && table[String(v)]) ? Number(v) : dflt; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeUrl(u) {
    u = String(u == null ? "" : u).trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (/^mailto:/i.test(u)) return u;
    if (/^\/[^\/]/.test(u) || u === "/") return u; // root-relative (not //host)
    if (/^data:image\//i.test(u) || /^data:video\//i.test(u)) return u;
    return "";
  }
  // Plain text with a tiny, safe inline markup -> fixed escaped HTML.
  function rich(str) {
    var out = esc(str);
    out = out.replace(/\[([^\]]{1,120})\]\(([^)\s]{1,600})\)/g, function (_, label, url) {
      // url here is already escaped; re-check scheme on the escaped form
      var ok = /^(https?:\/\/|mailto:|\/[^\/]|data:image\/|data:video\/)/i.test(url);
      return ok ? '<a href="' + url + '" target="_blank" rel="noopener">' + label + "</a>" : label;
    });
    out = out.replace(/\*\*([^*]{1,600})\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*])\*([^*]{1,600})\*/g, "$1<em>$2</em>");
    out = out.replace(/\r?\n/g, "<br>");
    return out;
  }

  /* ---------- clean (validate + normalize a spec, dropping anything unknown) ---------- */
  function cleanProps(p) {
    p = p || {};
    return {
      gap: pick(p.gap, GAPS, "md"),
      align: pick(p.align, ALIGNS, "left"),
      valign: pick(p.valign, VALIGNS, "top"),
      cols: pickNum(p.cols, COLS, 2),
      pad: pick(p.pad, PADS, "none"),
      radius: pick(p.radius, RADII, "none"),
      bg: pick(p.bg, BGS, "none")
    };
  }
  function cleanLeaf(t, n) {
    switch (t) {
      case "heading": return { type: t, text: String(n.text || ""), size: pick(n.size, SIZES, "lg") };
      case "text": return { type: t, text: String(n.text || ""), size: pick(n.size, SIZES, "md"), tone: pick(n.tone, TONES, "default"), align: pick(n.align, ALIGNS, "left") };
      case "quote": return { type: t, text: String(n.text || ""), cite: String(n.cite || "") };
      case "stat": return { type: t, value: String(n.value || ""), label: String(n.label || "") };
      case "pill": return { type: t, text: String(n.text || ""), tone: pick(n.tone, TONES, "accent") };
      case "icon": return { type: t, name: String(n.name || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40), size: pick(n.size, SIZES, "md") };
      case "media": return { type: t, src: safeUrl(n.src), kind: pick(n.kind, MEDIA_KINDS, "image"), ratio: pick(n.ratio, RATIOS, "16x9"), fit: pick(n.fit, FITS, "cover"), alt: String(n.alt || "").slice(0, 200), caption: String(n.caption || "").slice(0, 300) };
      case "button": return { type: t, label: String(n.label || "").slice(0, 120), href: safeUrl(n.href) };
      case "divider": return { type: t };
      case "spacer": return { type: t, size: pick(n.size, SIZES, "md") };
    }
    return null;
  }
  function cleanNode(n, depth) {
    if (depth > 10 || !n || typeof n !== "object") return null;
    var t = String(n.type || "").toLowerCase();
    if (CONTAINERS[t]) {
      var out = { type: t, props: cleanProps(n.props), children: [] };
      var kids = Array.isArray(n.children) ? n.children : [];
      for (var i = 0; i < kids.length && out.children.length < 40; i++) {
        var c = cleanNode(kids[i], depth + 1);
        if (c) out.children.push(c);
      }
      return out;
    }
    if (LEAVES[t]) return cleanLeaf(t, n);
    return null;
  }
  function clean(spec) {
    spec = spec || {};
    var r = spec.root || (spec.type ? spec : null);
    var rn = cleanNode(r, 0) || { type: "stack", props: cleanProps({}), children: [] };
    return { version: 1, root: rn };
  }

  /* ---------- render (cleaned spec -> safe HTML string) ---------- */
  function iconSvg(name) {
    try {
      if (typeof window !== "undefined" && window.RK && window.RK.iconSvg) return window.RK.iconSvg(name);
    } catch (e) {}
    return "";
  }
  function contProps(p) {
    return " gs-gap-" + p.gap + " gs-al-" + p.align + " gs-va-" + p.valign +
      (p.pad !== "none" ? " gs-pad-" + p.pad : "") +
      (p.radius !== "none" ? " gs-rad-" + p.radius : "") +
      (p.bg !== "none" ? " gs-bg-" + p.bg : "");
  }
  function renderChildren(kids) {
    return (kids || []).map(function (c) { return renderNode(c); }).join("");
  }
  function mediaInner(n) {
    if (!n.src) return '<div class="gs-media-ph">Visual</div>';
    if (n.kind === "video") return '<video class="gs-media-el" src="' + esc(n.src) + '" muted loop autoplay playsinline></video>';
    if (n.kind === "embed") return '<iframe class="gs-media-el" src="' + esc(n.src) + '" loading="lazy" allowfullscreen referrerpolicy="no-referrer"></iframe>';
    return '<img class="gs-media-el" src="' + esc(n.src) + '" alt="' + esc(n.alt) + '" loading="lazy">';
  }
  function renderNode(n) {
    if (!n) return "";
    var t = n.type;
    if (CONTAINERS[t]) {
      var cls = "gs-" + t + contProps(n.props) + (t === "grid" ? " gs-cols-" + n.props.cols : "");
      return '<div class="' + cls + '">' + renderChildren(n.children) + "</div>";
    }
    switch (t) {
      case "heading": return '<h3 class="gs-h gs-h--' + n.size + '">' + rich(n.text) + "</h3>";
      case "text": return '<div class="gs-text gs-tx--' + n.size + " gs-tone-" + n.tone + " gs-al-" + n.align + '">' + rich(n.text) + "</div>";
      case "quote": return '<blockquote class="gs-quote">' + rich(n.text) + (n.cite ? '<cite class="gs-cite">' + esc(n.cite) + "</cite>" : "") + "</blockquote>";
      case "stat": return '<div class="gs-stat"><span class="gs-stat-v">' + esc(n.value) + '</span><span class="gs-stat-l">' + esc(n.label) + "</span></div>";
      case "pill": return '<span class="gs-pill gs-pill--' + n.tone + '">' + esc(n.text) + "</span>";
      case "icon": return '<span class="gs-icon gs-icon--' + n.size + '">' + (iconSvg(n.name) || '<span class="gs-icon-dot"></span>') + "</span>";
      case "media": return '<figure class="gs-media gs-media--' + n.ratio + " gs-fit-" + n.fit + '">' + mediaInner(n) + (n.caption ? '<figcaption class="gs-cap">' + esc(n.caption) + "</figcaption>" : "") + "</figure>";
      case "button": return n.href ? '<a class="gs-btn" href="' + esc(n.href) + '" target="_blank" rel="noopener">' + esc(n.label) + "</a>" : '<span class="gs-btn gs-btn--dead">' + esc(n.label) + "</span>";
      case "divider": return '<hr class="gs-divider">';
      case "spacer": return '<div class="gs-spacer gs-sp--' + n.size + '"></div>';
    }
    return "";
  }
  function renderHtml(spec) {
    var s = clean(spec);
    return '<div class="gsec">' + renderNode(s.root) + "</div>";
  }
  function isEmpty(spec) {
    var s = clean(spec);
    return !s.root.children || !s.root.children.length;
  }

  function blankSpec() {
    return {
      version: 1,
      root: {
        type: "stack", props: { gap: "md", align: "left" }, children: [
          { type: "heading", text: "New section", size: "lg" },
          { type: "text", text: "Describe it, or add nodes below.", size: "md", tone: "dim" }
        ]
      }
    };
  }

  // Compact contract handed to the AI so it only ever emits valid, safe specs.
  function describe() {
    return [
      "You output ONLY a JSON layout spec: { \"version\":1, \"root\": Node }.",
      "A Node is a container or a leaf. NEVER output HTML, CSS, classes, styles, scripts or URLs to code.",
      "Containers (have \"children\":[Node]) + \"props\": stack | row | grid | split | card | section.",
      "  props: gap(none|sm|md|lg|xl) align(left|center|right) valign(top|center|bottom) cols(1-6, grid only) pad(none|sm|md|lg) radius(none|sm|md|lg) bg(none|elev|accent|line).",
      "Leaves:",
      "  heading {text, size(sm|md|lg|xl)}",
      "  text {text, size, tone(default|dim|faint|accent), align} — text may use **bold** *italic* [label](url) and newlines ONLY.",
      "  quote {text, cite}",
      "  stat {value, label}   e.g. value \"689M+\", label \"accounts\"",
      "  pill {text, tone}",
      "  icon {name, size}     name from a line-icon set (users, chart, target, spark, bolt, shield, star, rocket, globe, check, heart, layers...).",
      "  media {src, kind(image|video|embed), ratio(16x9|4x3|1x1|3x2|3x4|9x16|auto), fit(cover|contain), alt, caption} — leave src empty to show a placeholder.",
      "  button {label, href}",
      "  divider {}   spacer {size}",
      "Design: restrained, editorial, dark; use accent sparingly; prefer grid/row for multi-item layouts; use stat for metrics; keep copy tight.",
      "Return the JSON object only."
    ].join("\n");
  }

  root.RKGen = {
    VERSION: 1,
    clean: clean,
    renderHtml: renderHtml,
    blankSpec: blankSpec,
    isEmpty: isEmpty,
    describe: describe,
    vocab: {
      containers: Object.keys(CONTAINERS), leaves: Object.keys(LEAVES),
      sizes: Object.keys(SIZES), tones: Object.keys(TONES), aligns: Object.keys(ALIGNS),
      valigns: Object.keys(VALIGNS), gaps: Object.keys(GAPS), pads: Object.keys(PADS),
      cols: Object.keys(COLS), radii: Object.keys(RADII), bgs: Object.keys(BGS),
      ratios: Object.keys(RATIOS), fits: Object.keys(FITS), mediaKinds: Object.keys(MEDIA_KINDS)
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.RKGen;
})(typeof self !== "undefined" ? self : this);
