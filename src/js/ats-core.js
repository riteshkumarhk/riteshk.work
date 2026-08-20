/* =================================================================
   ats-core.js — deterministic ATS analysis engine (pure, no DOM/network).
   Phase 1: keyword match-rate. Real ATS keyword screening is literal +
   stemmed + synonym-aware; this reproduces that deterministically so the
   "missing keywords" list and the match-% are precise and REPRODUCIBLE
   (same résumé + JD → same numbers), instead of an LLM guess.

   Pipeline: normalize → tokenize → longest-match against a curated skill
   ontology (canonical form + variants/acronyms) → light-stem fallback for
   generic domain terms → weighted match against the JD's real requirements.

   Bundled into admin-studio.js by esbuild (import); unit-tested directly in
   Node so the shipped code is what's verified (no copy drift).
   ================================================================= */

// Words that never count as keywords (matching intent, not exhaustive English).
export const ATS_STOP = new Set((
  "a an and are as at be been being by for from had has have he her his i in into is it its of on or " +
  "our so than that the their them then there these they this those to us was we were what when which " +
  "who will with you your they'll you'll about above after again all also am any because before below " +
  "between both but can cannot could did do does doing done down during each else etc few more most " +
  "must my no nor not now off once only other over own per same should some such via up using use used " +
  "very while within without would across able ability including include includes work working works " +
  "role team teams year years experience strong excellent good great new like across help helping build"
).split(/\s+/));

// Curated skill ontology: [canonical, weight, ...variants]. weight 3 = hard skill/tool,
// 2 = method/practice/domain, 1 = soft/generic. The canonical is matched too. Variants are
// exact phrases (already lowercased); acronyms and expansions both map to one canonical, so
// "UX" and "user experience" (or "React" and "React.js") count as the SAME requirement.
export const ATS_LEXICON = [
  // ---- tools (design) ----
  ["figma", 3, "figjam"], ["sketch", 3], ["adobe xd", 3, "xd"], ["framer", 3], ["principle", 3],
  ["invision", 3], ["protopie", 3], ["axure", 3], ["zeplin", 3], ["abstract", 3], ["miro", 3, "mural"],
  ["photoshop", 3], ["illustrator", 3], ["after effects", 3], ["adobe creative suite", 3, "creative cloud", "adobe cc"],
  ["maze", 3], ["dovetail", 3], ["usertesting", 3, "user testing platform"], ["lookback", 3], ["hotjar", 3],
  ["fullstory", 3], ["amplitude", 3], ["mixpanel", 3], ["google analytics", 3, "ga4"], ["storybook", 3],
  // ---- tools (eng/pm) ----
  ["jira", 3], ["confluence", 3], ["notion", 3], ["asana", 3], ["airtable", 3], ["linear", 3],
  ["html", 3, "html5"], ["css", 3, "css3", "scss", "sass"], ["javascript", 3, "js", "es6"],
  ["typescript", 3, "ts"], ["react", 3, "react.js", "reactjs"], ["vue", 3, "vue.js", "vuejs"],
  ["node", 3, "node.js", "nodejs"], ["sql", 3], ["python", 3], ["rest api", 3, "rest", "restful", "apis", "api"],
  ["graphql", 3], ["git", 3, "github", "gitlab"],
  // ---- design methods / practice ----
  ["user experience", 3, "ux", "ux design", "experience design"],
  ["user interface", 3, "ui", "ui design"],
  ["product design", 3, "product designer"],
  ["design system", 3, "design systems", "design language", "component library", "design tokens", "design token"],
  ["user research", 2, "ux research", "design research", "user studies"],
  ["usability testing", 2, "usability test", "usability study", "moderated testing", "unmoderated testing"],
  ["a/b testing", 2, "ab testing", "a b testing", "split testing", "multivariate testing"],
  ["wireframing", 2, "wireframe", "wireframes", "wireframed"],
  ["prototyping", 2, "prototype", "prototypes", "prototyped", "rapid prototyping", "interactive prototype"],
  ["information architecture", 2, "ia"],
  ["interaction design", 2, "ixd"],
  ["visual design", 2, "ui visual design"],
  ["accessibility", 3, "a11y", "wcag", "inclusive design", "ada compliance"],
  ["design thinking", 2],
  ["journey mapping", 2, "journey map", "customer journey", "user journey", "experience map"],
  ["personas", 2, "persona"],
  ["heuristic evaluation", 2, "heuristics"],
  ["service design", 2],
  ["design ops", 2, "designops"],
  ["motion design", 2, "motion", "micro-interactions", "microinteractions", "animation"],
  ["responsive design", 2, "responsive", "adaptive design"],
  ["design critique", 1, "critique", "design review"],
  ["storytelling", 1, "narrative"],
  ["data visualization", 2, "data viz", "dataviz", "information design"],
  ["end to end", 1, "end-to-end", "0 to 1", "0-to-1", "zero to one"],
  // ---- product / process ----
  ["agile", 2, "scrum", "kanban", "sprints", "sprint"],
  ["roadmap", 2, "roadmapping", "product roadmap"],
  ["stakeholder management", 2, "stakeholders", "stakeholder"],
  ["cross-functional", 2, "cross functional", "crossfunctional", "cross-functionally", "cross-functional collaboration"],
  ["product strategy", 2, "design strategy"],
  ["okrs", 2, "okr", "kpis", "kpi", "key results"],
  ["mvp", 1, "minimum viable product"],
  ["go to market", 1, "go-to-market", "gtm"],
  ["user-centered design", 2, "user centered design", "user centred design", "human-centered design", "human centered design", "hcd", "ucd"],
  // ---- domains ----
  ["fintech", 2, "financial services", "payments", "banking"],
  ["healthcare", 2, "health tech", "healthtech", "medical"],
  ["e-commerce", 2, "ecommerce", "e commerce", "retail"],
  ["enterprise", 2, "b2b", "saas", "b2b saas"],
  ["consumer", 2, "b2c"],
  ["mobile", 2, "ios", "android", "mobile app", "native app"],
  ["identity", 2, "authentication", "auth", "passkeys", "sign-in", "login"],
  ["ai", 2, "artificial intelligence", "machine learning", "ml", "generative ai", "genai", "llm", "llms"],
  // ---- leadership / soft (level-relevant) ----
  ["leadership", 2, "leading", "led", "lead"],
  ["mentorship", 1, "mentoring", "mentored", "coaching", "coached"],
  ["communication", 1, "presentation", "presenting"],
  ["collaboration", 1, "collaborative", "collaborating", "partnering", "partnered"]
];

// Build a phrase→canonical index (each variant + the canonical map to the canonical).
const _VAR = new Map();     // "user experience" -> "user experience", "ux" -> "user experience"
const _WEIGHT = new Map();  // canonical -> weight
const _MAXN = { n: 1 };     // longest phrase length in tokens
for (const row of ATS_LEXICON) {
  const canon = row[0], weight = row[1];
  _WEIGHT.set(canon, weight);
  for (const variant of [canon].concat(row.slice(2))) {
    const toks = atsTokens(variant);   // SAME normalization the résumé/JD scan uses, so react.js/adobe xd/a-b align
    if (!toks.length) continue;
    const key = toks.join(" ");
    _VAR.set(key, canon);
    if (toks.length > _MAXN.n) _MAXN.n = toks.length;
  }
}

/** Canonical lexicon weight for a canon term (default 2). */
export function atsWeight(canon) { return _WEIGHT.get(canon) || 2; }

/** Normalize free text: lowercase, unify separators so "a/b", "react.js", "cross-functional" survive. */
export function atsNormalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[’'`]/g, "")           // don't split contractions/possessives into tokens
    .replace(/a\/b/g, "ab")           // a/b testing → ab testing (slash would otherwise split)
    .replace(/[\u2010-\u2015]/g, "-") // normalize dashes
    .replace(/[^a-z0-9+#.\-\s]/gi, " ");
}

/** Tokenize normalized text into keyword tokens (keeps +, #, . inside tokens for c++, react.js). */
export function atsTokens(text) {
  return (atsNormalize(text).match(/[a-z0-9][a-z0-9+#.\-]*/g) || [])
    .map(function (t) { return t.replace(/^[-.]+|[-.]+$/g, ""); })
    .filter(Boolean);
}

/** Light stemmer for GENERIC (non-lexicon) domain words. Lexicon skills use curated variants,
 *  so this only needs to collapse common inflections (plurals, -ing/-ed) well enough to match. */
export function atsStem(w) {
  w = String(w || "");
  if (w.length <= 3) return w;
  w = w.replace(/(ization|isation)$/, "ize")
       .replace(/(ational)$/, "ate")
       .replace(/(iveness|fulness|ousness)$/, "")
       .replace(/(ments?)$/, "")
       .replace(/(ingly|edly)$/, "")
       .replace(/(ing)$/, "")
       .replace(/(ed)$/, "")
       .replace(/(ies)$/, "y")
       .replace(/(sses)$/, "ss")
       .replace(/([^s])s$/, "$1");
  return w.length >= 3 ? w : String(w || "");
}

function _ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}

/**
 * Index a résumé's text into what it demonstrably contains:
 *  - canon: Map(canonicalSkill → count)   (ontology hits, longest-match)
 *  - stems: Map(stemmedUnigram → count)   (generic term fallback)
 *  - stemBg: Set(stemmedBigram)           (generic 2-word term fallback)
 */
export function atsResumeIndex(text) {
  const tokens = atsTokens(text);
  const canon = new Map(), stems = new Map(), stemBg = new Set();
  const used = new Array(tokens.length).fill(false);
  // longest-match ontology scan
  for (let i = 0; i < tokens.length; i++) {
    for (let n = Math.min(_MAXN.n, tokens.length - i); n >= 1; n--) {
      const gram = tokens.slice(i, i + n).join(" ");
      const c = _VAR.get(gram);
      if (c) { canon.set(c, (canon.get(c) || 0) + 1); for (let k = i; k < i + n; k++) used[k] = true; i += n - 1; break; }
    }
  }
  // generic stem fallback for anything not consumed by the ontology
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (ATS_STOP.has(t) || t.length < 3) continue;
    const s = atsStem(t);
    if (s.length >= 3) stems.set(s, (stems.get(s) || 0) + 1);
    if (i + 1 < tokens.length && !ATS_STOP.has(tokens[i + 1]) && tokens[i + 1].length >= 3) {
      stemBg.add(s + " " + atsStem(tokens[i + 1]));
    }
  }
  return { canon: canon, stems: stems, stemBg: stemBg, tokenCount: tokens.length };
}

/** Cue phrases that mark the JD's requirements/qualifications region → terms there weigh more. */
const _REQ_CUE = /(requirement|qualification|must have|you have|you.ll have|what you|we.re looking|responsibilit|skills|proficien|experience (?:with|in)|expertise)/i;

/**
 * Extract the JD's real requirement keywords, weighted:
 *  - ontology skills (canonical) with their ontology weight (+1 if in a requirements region)
 *  - salient generic terms (stemmed uni/bi-grams) that recur or sit in requirements
 * Returns a de-duplicated, importance-sorted list capped to keep the match-% meaningful.
 */
export function atsExtractJdTerms(jd, cap) {
  cap = cap || 28;
  const raw = String(jd || "");
  if (!raw.trim()) return [];
  // weight-by-region: split into lines, flag lines in a requirements-ish region
  const lines = raw.split(/\n+/);
  let reqOn = false;
  const inReq = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (_REQ_CUE.test(lines[i])) reqOn = true;
    else if (/^\s*(about|who we are|benefits|perks|our team|company)\b/i.test(lines[i])) reqOn = false;
    inReq[i] = reqOn;
  }

  const skillHits = new Map();  // canon -> {weight, freq}
  const termHits = new Map();   // stem -> {display, weight, freq, n}
  for (let li = 0; li < lines.length; li++) {
    const boost = inReq[li] ? 1 : 0;
    const tokens = atsTokens(lines[li]);
    const used = new Array(tokens.length).fill(false);
    for (let i = 0; i < tokens.length; i++) {
      let matched = false;
      for (let n = Math.min(_MAXN.n, tokens.length - i); n >= 1; n--) {
        const gram = tokens.slice(i, i + n).join(" ");
        const c = _VAR.get(gram);
        if (c) {
          const cur = skillHits.get(c) || { weight: atsWeight(c), freq: 0 };
          cur.freq += 1; cur.weight = Math.max(cur.weight, atsWeight(c) + boost);
          skillHits.set(c, cur);
          for (let k = i; k < i + n; k++) used[k] = true;
          i += n - 1; matched = true; break;
        }
      }
      if (matched) continue;
    }
    // generic salient terms (unigrams + bigrams) not consumed by the ontology
    for (let i = 0; i < tokens.length; i++) {
      if (used[i] || ATS_STOP.has(tokens[i]) || tokens[i].length < 4) continue;
      const s = atsStem(tokens[i]);
      if (s.length < 4) continue;
      const cur = termHits.get(s) || { display: tokens[i], weight: 1 + boost, freq: 0, n: 1 };
      cur.freq += 1; cur.weight = Math.max(cur.weight, 1 + boost);
      termHits.set(s, cur);
    }
  }

  const out = [];
  skillHits.forEach(function (v, canon) { out.push({ term: canon, key: canon, kind: "skill", weight: v.weight, freq: v.freq }); });
  // generic terms: keep only those that recur (freq>=2) or sit in requirements (weight>1); dedupe vs skills
  const skillWords = new Set();
  skillHits.forEach(function (_v, canon) { canon.split(" ").forEach(function (w) { skillWords.add(atsStem(w)); }); });
  termHits.forEach(function (v, stem) {
    if (skillWords.has(stem)) return;
    if (v.freq >= 2 || v.weight > 1) out.push({ term: v.display, key: stem, kind: "term", weight: v.weight, freq: v.freq });
  });

  out.sort(function (a, b) { return (b.weight - a.weight) || (b.freq - a.freq) || (a.term < b.term ? -1 : 1); });
  return out.slice(0, cap);
}

/**
 * Deterministic keyword match of a résumé against a JD.
 * Returns { rate, hardRate, matched:[{term,count,weight,kind}], missing:[{term,weight,kind}], jdTerms }.
 *  - rate: weighted % of JD requirement weight the résumé covers (the headline "match rate")
 */
export function atsKeywordMatch(resumeText, jd) {
  const jdTerms = atsExtractJdTerms(jd);
  const idx = atsResumeIndex(resumeText);
  const matched = [], missing = [];
  let haveW = 0, totalW = 0, haveHardW = 0, totalHardW = 0;
  for (const t of jdTerms) {
    totalW += t.weight;
    const isHard = t.kind === "skill" && t.weight >= 3;
    if (isHard) totalHardW += t.weight;
    let count = 0;
    if (t.kind === "skill") count = idx.canon.get(t.key) || 0;
    else count = idx.stems.get(t.key) || (idx.stemBg.has(t.key) ? 1 : 0);
    if (count > 0) {
      matched.push({ term: t.term, count: count, weight: t.weight, kind: t.kind });
      haveW += t.weight; if (isHard) haveHardW += t.weight;
    } else {
      missing.push({ term: t.term, weight: t.weight, kind: t.kind });
    }
  }
  const rate = totalW ? Math.round((haveW / totalW) * 100) : null;
  const hardRate = totalHardW ? Math.round((haveHardW / totalHardW) * 100) : null;
  // rank missing high-value first so suggestions can target the biggest lifts
  missing.sort(function (a, b) { return b.weight - a.weight; });
  matched.sort(function (a, b) { return b.weight - a.weight; });
  return { rate: rate, hardRate: hardRate, matched: matched, missing: missing, jdTermCount: jdTerms.length };
}

// ---- deterministic structure/format checks from the STRUCTURED editor model ----
// The editor already holds the résumé as fields, so these are exact (not inferred from
// flattened text): contact completeness, standard headings, date consistency, section
// presence, quantified bullets, first-person voice, length. Reproducible → stable score.
export function atsModelChecks(model, opts) {
  opts = opts || {}; model = model || {};
  const checks = [];
  const c = model.contact || {};
  const sections = model.sections || [];
  const kinds = sections.map(function (s) { return s.kind; });
  function add(label, ok, note) { checks.push({ label: label, status: ok === true ? "pass" : ok === false ? "fail" : "warn", note: note || "" }); }

  const hasEmail = !!(c.email && /@/.test(c.email));
  const hasPhone = !!(c.phone && (String(c.phone).match(/\d/g) || []).length >= 7);
  const hasLoc = !!(c.location && String(c.location).trim());
  const hasLink = !!((c.links || []).some(function (l) { return l && (l.url || l.label); }));
  add("Contact block parses", hasEmail && hasPhone ? true : (hasEmail || hasPhone ? "warn" : false),
    [hasEmail ? "" : "no email", hasPhone ? "" : "no phone", hasLoc ? "" : "no location", hasLink ? "" : "no portfolio/LinkedIn"].filter(Boolean).join(", "));
  add("Target title present", !!(model.title && String(model.title).trim()), model.title ? "" : "add a headline / target title");

  const STD = /(experience|work|employment|skills|education|summary|profile|projects?|certification|awards?|recognition|publication|volunteer|leadership)/i;
  const nonStd = sections.filter(function (s) { return s.heading && !STD.test(s.heading); }).map(function (s) { return s.heading; });
  add("Standard section headings", nonStd.length === 0 ? true : "warn", nonStd.length ? "non-standard: " + nonStd.slice(0, 3).join(", ") : "");
  add("Has Experience section", kinds.indexOf("experience") >= 0, kinds.indexOf("experience") >= 0 ? "" : "no Experience section a parser can map");
  add("Dedicated Skills list", kinds.indexOf("skills") >= 0, kinds.indexOf("skills") >= 0 ? "" : "add a Skills section — the ATS keyword anchor");
  add("Has Education section", kinds.indexOf("education") >= 0, kinds.indexOf("education") >= 0 ? "" : "no Education section");
  add("Professional summary", model.summary != null && String(model.summary).trim() ? true : "warn", model.summary ? "" : "a 2\u20133 line summary sharpens keyword + title match");

  const expItems = [];
  sections.forEach(function (s) { if (s.kind === "experience") (s.items || []).forEach(function (it) { expItems.push(it); }); });
  const dated = expItems.filter(function (it) { return it.dates && String(it.dates).trim(); });
  const wellDated = dated.filter(function (it) { return /\b(0?[1-9]|1[0-2])\/\d{4}\b|\b\d{4}\s*[-\u2013]\s*(\d{4}|present)\b|\bpresent\b/i.test(it.dates); });
  add("Consistent MM/YYYY dates", expItems.length === 0 ? "warn" : (dated.length === expItems.length && wellDated.length === dated.length ? true : "warn"),
    dated.length < expItems.length ? (expItems.length - dated.length) + " role(s) missing dates" : (wellDated.length < dated.length ? "use MM/YYYY (or YYYY–Present)" : ""));

  let bullets = 0, quant = 0;
  expItems.forEach(function (it) { (it.bullets || []).forEach(function (b) { if (b && String(b).trim()) { bullets++; if (/\d|%|\$/.test(b)) quant++; } }); });
  const quantRate = bullets ? Math.round(quant / bullets * 100) : 0;
  add("Quantified achievements", bullets === 0 ? false : (quantRate >= 40 ? true : "warn"), bullets ? quantRate + "% of bullets carry a metric" : "no achievement bullets");

  const fp = expItems.some(function (it) { return (it.bullets || []).some(function (b) { return /^\s*(i|my|we|our)\b/i.test(b || ""); }); }) || /^\s*(i|my|we|our)\b/i.test(model.summary || "");
  add("No first-person voice", !fp, fp ? "found 'I/my/we' \u2014 lead with implied-subject action verbs" : "");

  if (opts.pages != null) {
    const maxP = opts.level === "leader" ? 3 : 2;
    add("Length \u2264 " + maxP + " pages", opts.pages <= maxP, opts.pages > maxP ? opts.pages + " pages \u2014 trim to " + maxP : "");
  }

  let sc = 0, tot = 0;
  checks.forEach(function (ch) { tot += 2; sc += ch.status === "pass" ? 2 : ch.status === "warn" ? 1 : 0; });
  return { checks: checks, structureScore: tot ? Math.round(sc / tot * 100) : 100, quantRate: quantRate };
}

/** Compact, deterministic "measured signals" block to inject into the LLM prompt so its
 *  keyword judgment + fixes stay consistent with what we actually measured. */
export function atsFactsBlock(kw, checks, sem) {
  const L = [];
  if (kw && kw.rate != null) {
    L.push("KEYWORD MATCH vs the JD requirements (deterministic): " + kw.rate + "% overall" + (kw.hardRate != null ? ", " + kw.hardRate + "% of hard skills" : "") + ".");
    if (kw.missing && kw.missing.length)
      L.push("MISSING JD KEYWORDS, highest-value first (weave in ONLY where the real experience supports them; never fabricate): " + kw.missing.slice(0, 14).map(function (m) { return m.term; }).join(", ") + ".");
    if (kw.matched && kw.matched.length)
      L.push("ALREADY COVERED (do NOT list these as missing): " + kw.matched.slice(0, 16).map(function (m) { return m.term; }).join(", ") + ".");
  }
  if (sem != null) L.push("SEMANTIC / CONTEXT FIT (résumé vs JD, lexical cosine): " + sem + "% — higher = the résumé echoes the JD's domain language; lift it by mirroring the JD's real responsibilities + terms truthfully.");
  if (checks && checks.length) {
    const flags = checks.filter(function (c) { return c.status !== "pass"; }).map(function (c) { return c.label + (c.note ? " (" + c.note + ")" : ""); });
    if (flags.length) L.push("STRUCTURE FLAGS measured from the résumé (address precisely; don't invent issues that aren't here): " + flags.join("; ") + ".");
  }
  if (!L.length) return "";
  return "\n\nMEASURED SIGNALS \u2014 computed deterministically from the résumé + JD. TRUST THESE over your own estimate; make your keyword call and your fixes CONSISTENT with them, and target the missing keywords:\n" + L.map(function (x) { return "- " + x; }).join("\n");
}

// ---- P3: semantic-fit (lexical). Ontology-weighted TF-cosine between résumé and JD ----
// A reproducible, no-infra proxy for the embedding-similarity that enterprise rankers use:
// skills are canonicalized + weighted (so react.js≡react and hard skills dominate), generic
// terms count too. Neural embeddings would be a drop-in upgrade behind a proxy /embed route.
export function atsSemanticFit(resumeText, jd) {
  if (!String(jd || "").trim() || !String(resumeText || "").trim()) return null;
  function vec(text) {
    const idx = atsResumeIndex(text);
    const v = new Map();
    idx.canon.forEach(function (cnt, canon) { v.set("s:" + canon, (1 + Math.log(cnt)) * (atsWeight(canon) || 2)); });
    idx.stems.forEach(function (cnt, stem) { if (stem.length >= 3) v.set("t:" + stem, 1 + Math.log(cnt)); });
    return v;
  }
  const a = vec(resumeText), b = vec(jd);
  if (!a.size || !b.size) return null;
  let dot = 0, na = 0, nb = 0;
  a.forEach(function (wa, k) { na += wa * wa; if (b.has(k)) dot += wa * b.get(k); });
  b.forEach(function (wb) { nb += wb * wb; });
  const cos = (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  return Math.round(cos * 100);
}

// ---- P2: positional parse-fidelity from pdf.js coordinates ----
// Real parse-killers (columns, header/footer contact) are invisible once the PDF is
// flattened to a string. These use each text item's geometry (x,y,w top-down per page)
// to detect what a strict/legacy ATS would actually do to the résumé.
const _EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const _PHONE_RE = /\+?\d[\d\s().\-]{7,}\d/;

function _detectColumns(items, pageW) {
  if (!items.length || !pageW || items.length < 10) return { columns: 1, channelX: null };
  let best = null;
  for (let f = 0.30; f <= 0.70; f += 0.02) {
    const cx = pageW * f;
    let straddle = 0, left = 0, right = 0;
    for (const it of items) {
      const x0 = it.x, x1 = it.x + (it.w || 0);
      if (x0 < cx && x1 > cx) straddle++;
      else if (x1 <= cx) left++; else right++;
    }
    // a true column gutter: almost nothing straddles cx, and both sides are well populated
    if (straddle <= Math.max(1, items.length * 0.02) && left >= items.length * 0.22 && right >= items.length * 0.22) {
      if (!best || Math.abs(f - 0.5) < Math.abs(best.f - 0.5)) best = { f: f, cx: cx };
    }
  }
  return best ? { columns: 2, channelX: Math.round(best.cx) } : { columns: 1, channelX: null };
}

function _headerFooterContact(pages) {
  for (const pg of pages) {
    const H = pg.height || 792;
    for (const it of (pg.items || [])) {
      if (!it.str) continue;
      if ((it.y < H * 0.08 || it.y > H * 0.92) && (_EMAIL_RE.test(it.str) || _PHONE_RE.test(it.str))) return true;
    }
  }
  return false;
}

// Reconstruct the columns-BLIND reading order a strict parser produces: sort every item
// top→bottom then left→right, grouping into visual rows. For a 2-column résumé this
// interleaves the columns row-by-row — i.e. the jumble the ATS actually ingests.
function _linearize(pages) {
  const out = [];
  for (const pg of pages) {
    const items = (pg.items || []).filter(function (it) { return it.str && it.str.trim(); }).slice();
    if (!items.length) continue;
    items.sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });
    const tol = 5;
    let lines = [], cur = [], prevY = null;
    for (const it of items) {
      if (prevY !== null && it.y - prevY > tol) { lines.push(cur); cur = []; }
      cur.push(it); prevY = it.y;
    }
    if (cur.length) lines.push(cur);
    lines.forEach(function (ln) { ln.sort(function (a, b) { return a.x - b.x; }); out.push(ln.map(function (i) { return i.str; }).join(" ").replace(/\s+/g, " ").trim()); });
  }
  return out.join("\n");
}

/**
 * Analyze a PDF's positional layout.
 * pages: [{ width, height, items:[{ str, x, y, w, h }] }]  (y top-down).
 * Returns { columns, channelX, headerFooterRisk, linearized, flags:[{label,note}], itemCount }.
 */
export function atsParseLayout(pages) {
  pages = pages || [];
  const all = [];
  let pageW = 0;
  pages.forEach(function (pg) { pageW = Math.max(pageW, pg.width || 0); (pg.items || []).forEach(function (it) { if (it.str && it.str.trim()) all.push(it); }); });
  const col = _detectColumns(all, pageW || 612);
  const hf = _headerFooterContact(pages);
  const flags = [];
  if (col.columns === 2) flags.push({ label: "Multi-column layout", note: "a strict/legacy parser reads across the columns and scrambles the order \u2014 single-column is safest" });
  if (hf) flags.push({ label: "Contact in header/footer", note: "many parsers skip header/footer regions \u2014 move name, email, phone into the body" });
  return { columns: col.columns, channelX: col.channelX, headerFooterRisk: hf, linearized: _linearize(pages), flags: flags, itemCount: all.length };
}
