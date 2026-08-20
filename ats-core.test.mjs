import { atsKeywordMatch, atsExtractJdTerms, atsResumeIndex, atsTokens, atsStem, atsNormalize, atsModelChecks, atsFactsBlock, atsParseLayout, atsSemanticFit, atsBlendScore, atsParseScore, atsStructFromChecks, atsBand } from "./src/js/ats-core.js";

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.log("FAIL  " + name + (extra ? "  -> " + JSON.stringify(extra) : "")); } }

const JD = `Senior Product Designer, Identity
About the role: join our team.
Requirements:
- 8+ years of product design experience shipping end-to-end
- Expert in Figma and design systems (design tokens, component library)
- Strong user research and usability testing background
- Experience with accessibility (WCAG) and responsive design
- A/B testing and data-informed decisions
- Experience in fintech or payments is a plus
- Excellent stakeholder management and cross-functional collaboration`;

const RESUME_STRONG = `Ritesh Kumar — Product Designer
Led UX for identity and authentication products.
- Built and scaled a design system with design tokens adopted across 6 teams
- Ran user research and moderated usability studies with 40+ participants
- Shipped accessible (a11y / WCAG) sign-in flows, responsive across mobile and web
- Drove A/B testing that lifted conversion; partnered with stakeholders and cross-functional teams across engineering
- Expert in Figma; prototyping in Framer
Financial services (payments) domain across 3 roles.`;

const RESUME_WEAK = `Ritesh Kumar — Graphic Designer
- Made posters and brochures in Photoshop and Illustrator
- Worked on branding and print layouts
- Collaborated with the marketing team on campaigns`;

// 1) Synonym / acronym equivalence
(() => {
  const idx = atsResumeIndex("Led UX for the product; expert in React.js and design tokens.");
  check("UX canonicalizes to user experience", idx.canon.has("user experience"));
  check("React.js canonicalizes to react", idx.canon.has("react"));
  check("design tokens -> design system", idx.canon.has("design system"));
})();

// 2) JD extraction pulls the real requirement skills
(() => {
  const terms = atsExtractJdTerms(JD);
  const keys = new Set(terms.map(t => t.key));
  check("JD term: figma", keys.has("figma"));
  check("JD term: design system", keys.has("design system"));
  check("JD term: user research", keys.has("user research"));
  check("JD term: accessibility", keys.has("accessibility"));
  check("JD term: a/b testing", keys.has("a/b testing"));
  check("JD term: fintech (via 'fintech'/'payments')", keys.has("fintech"));
  check("JD term: stakeholder management", keys.has("stakeholder management"));
  check("JD terms are capped/sane (<=28)", terms.length <= 28 && terms.length >= 6, { n: terms.length });
})();

// 3) Strong résumé → high match; weak résumé → low match
(() => {
  const strong = atsKeywordMatch(RESUME_STRONG, JD);
  const weak = atsKeywordMatch(RESUME_WEAK, JD);
  check("strong résumé match rate >= 75", strong.rate >= 75, { rate: strong.rate });
  check("weak résumé match rate <= 30", weak.rate <= 30, { rate: weak.rate });
  check("strong > weak", strong.rate > weak.rate, { strong: strong.rate, weak: weak.rate });
  // accessibility present in strong, missing in weak
  check("strong matched includes accessibility", strong.matched.some(m => m.term === "accessibility"));
  check("weak missing includes figma", weak.missing.some(m => m.term === "figma"));
  check("weak missing includes design system", weak.missing.some(m => m.term === "design system"));
  // missing sorted high-value first
  if (weak.missing.length > 1) check("missing sorted by weight desc", weak.missing[0].weight >= weak.missing[weak.missing.length - 1].weight);
})();

// 4) Synonym domain match: résumé says "financial services / payments", JD says "fintech"
(() => {
  const m = atsKeywordMatch("Worked in financial services and payments for 5 years.", "Requirements: experience in fintech is required.");
  check("fintech matched via 'financial services'/'payments'", m.matched.some(x => x.term === "fintech"), m);
})();

// 5) Reproducibility — same input, identical output
(() => {
  const a = JSON.stringify(atsKeywordMatch(RESUME_STRONG, JD));
  const b = JSON.stringify(atsKeywordMatch(RESUME_STRONG, JD));
  check("deterministic / reproducible", a === b);
})();

// 6) Tokenizer edge cases
(() => {
  check("a/b normalized to ab", atsNormalize("A/B testing").includes("ab testing"));
  check("react.js kept as token", atsTokens("I use React.js daily").includes("react.js"));
  check("stem: designing -> design", atsStem("designing") === "design");
  check("stem: systems -> system", atsStem("systems") === "system");
})();

// 7) No-JD guard
(() => {
  const m = atsKeywordMatch(RESUME_STRONG, "");
  check("empty JD → rate null (no crash)", m.rate === null && m.matched.length === 0);
})();

// 8) Model checks — strong structured model passes, weak one flags
(() => {
  const strongModel = {
    name: "Ritesh Kumar", title: "Senior Product Designer", summary: "Lead UX designer with 11 years.",
    contact: { email: "a@b.com", phone: "+1 555 123 4567", location: "Hyderabad", links: [{ label: "linkedin.com/in/x" }] },
    sections: [
      { heading: "Experience", kind: "experience", items: [{ role: "Designer", org: "Microsoft", dates: "03/2020 - Present", bullets: ["Lifted conversion by 12% across 3M users", "Shipped design system to 6 teams"] }] },
      { heading: "Skills", kind: "skills", groups: [{ label: "Design", items: ["Figma"] }] },
      { heading: "Education", kind: "education", items: [{ school: "NIFT", credential: "B.Des", dates: "2010 - 2014" }] }
    ]
  };
  const r = atsModelChecks(strongModel, { level: "senior", pages: 2 });
  check("strong model structureScore >= 85", r.structureScore >= 85, { s: r.structureScore, fails: r.checks.filter(c=>c.status!=='pass') });
  check("strong model no fails", r.checks.every(c => c.status !== "fail"));

  const weakModel = {
    name: "Ritesh", title: "",
    contact: { email: "", phone: "", location: "" },
    sections: [ { heading: "What I Did", kind: "experience", items: [{ role: "Designer", org: "X", dates: "", bullets: ["I made posters", "my branding work"] }] } ]
  };
  const w = atsModelChecks(weakModel, { level: "senior", pages: 4 });
  const byLabel = {}; w.checks.forEach(c => byLabel[c.label] = c.status);
  check("weak: no title flagged", byLabel["Target title present"] === "fail");
  check("weak: non-standard heading warned", byLabel["Standard section headings"] === "warn");
  check("weak: no skills section failed", byLabel["Dedicated Skills list"] === "fail");
  check("weak: first-person flagged", byLabel["No first-person voice"] === "fail");
  check("weak: over length flagged", w.checks.some(c => /Length/.test(c.label) && c.status === "fail"));
  check("weak structureScore < 55", w.structureScore < 55, { s: w.structureScore });
})();

// 9) Facts block for the prompt
(() => {
  const kw = atsKeywordMatch(RESUME_WEAK, JD);
  const fb = atsFactsBlock(kw, atsModelChecks({ sections: [] }, {}).checks);
  check("facts block mentions keyword match %", /KEYWORD MATCH/.test(fb) && /%/.test(fb));
  check("facts block lists missing keywords", /MISSING JD KEYWORDS/.test(fb));
  check("facts block empty when no signals", atsFactsBlock({ rate: null }, []) === "");
  check("facts block includes semantic fit when passed", /SEMANTIC \/ CONTEXT FIT/.test(atsFactsBlock(kw, [], 42)));
})();

// 10) Semantic fit (lexical cosine) — strong > weak, reproducible, guarded
(() => {
  const strong = atsSemanticFit(RESUME_STRONG, JD);
  const weak = atsSemanticFit(RESUME_WEAK, JD);
  check("semantic fit strong in range", strong > 0 && strong <= 100, { strong });
  check("semantic fit strong > weak", strong > weak, { strong, weak });
  check("semantic fit reproducible", atsSemanticFit(RESUME_STRONG, JD) === strong);
  check("semantic fit null on empty JD", atsSemanticFit(RESUME_STRONG, "") === null);
})();

// 10) Positional layout parse (P2)
(() => {
  // Two-column page: left col x=50, right col x=350, contact email in the header band
  const twoCol = [{ width: 600, height: 800, items: [
    { str: "me@x.com", x: 50, y: 20, w: 90, h: 10 },   // header contact (risk)
    { str: "Skills", x: 50, y: 120, w: 60, h: 12 },
    { str: "Figma", x: 50, y: 140, w: 50, h: 12 },
    { str: "Sketch", x: 50, y: 160, w: 55, h: 12 },
    { str: "Research", x: 50, y: 180, w: 70, h: 12 },
    { str: "Experience", x: 350, y: 120, w: 90, h: 12 },
    { str: "Designer at Microsoft", x: 350, y: 140, w: 180, h: 12 },
    { str: "Led identity design", x: 350, y: 160, w: 160, h: 12 },
    { str: "Shipped passkeys", x: 350, y: 180, w: 150, h: 12 },
    { str: "Scaled design system", x: 350, y: 200, w: 170, h: 12 }
  ] }];
  const r = atsParseLayout(twoCol);
  check("2-column detected", r.columns === 2, { cols: r.columns, ch: r.channelX });
  check("header/footer contact flagged", r.headerFooterRisk === true);
  check("columns-blind linearization interleaves", /Skills\s+Experience/.test(r.linearized), { lin: r.linearized.slice(0, 60) });
  check("layout flags include multi-column", r.flags.some(f => /Multi-column/.test(f.label)));

  // Single-column page: all items on the left, contact in body
  const oneCol = [{ width: 600, height: 800, items: [
    { str: "Ritesh Kumar", x: 50, y: 60, w: 140, h: 14 },
    { str: "me@x.com | +1 555 123 4567", x: 50, y: 80, w: 260, h: 12 },
    { str: "Experience", x: 50, y: 140, w: 90, h: 12 },
    { str: "Senior Product Designer", x: 50, y: 160, w: 200, h: 12 },
    { str: "Led identity and design systems", x: 50, y: 180, w: 240, h: 12 },
    { str: "Shipped accessible sign-in", x: 50, y: 200, w: 210, h: 12 },
    { str: "Education", x: 50, y: 240, w: 90, h: 12 },
    { str: "NIFT Bangalore", x: 50, y: 260, w: 130, h: 12 },
    { str: "Skills: Figma, Sketch", x: 50, y: 300, w: 180, h: 12 },
    { str: "Prototyping and research", x: 50, y: 320, w: 190, h: 12 }
  ] }];
  const s = atsParseLayout(oneCol);
  check("single-column detected", s.columns === 1, { cols: s.columns });
  check("single-column: no header/footer contact risk (contact in body)", s.headerFooterRisk === false);
  check("single-column: no layout flags", s.flags.length === 0);
})();

// 12) Hybrid score — blends measured sub-scores + content; MUST move when keyword rises
(() => {
  const before = atsBlendScore({ keyword: 55, semantic: 40, structure: 80, parse: 100, content: 70 });
  const after = atsBlendScore({ keyword: 85, semantic: 55, structure: 88, parse: 100, content: 72 });
  check("blend in range", before.score > 0 && before.score <= 100, { s: before.score });
  check("blend RISES when keyword+structure improve", after.score > before.score + 3, { before: before.score, after: after.score });
  check("blend breakdown lists components", before.breakdown.length === 5);
  check("band Strong at 82", atsBand(82) === "Strong");
  check("band Good at 70", atsBand(70) === "Good");
  check("band Needs work at 50", atsBand(50) === "Needs work");
  // renormalize when no JD (keyword/semantic absent)
  const noJd = atsBlendScore({ structure: 90, content: 80 });
  check("blend renormalizes with missing components", noJd.score >= 80 && noJd.score <= 90, { s: noJd.score });
  // parse penalty from layout flags
  check("parse score penalizes multi-column", atsParseScore({ flags: [{ label: "Multi-column layout" }] }) === 75);
  check("parse score 100 when no layout flags", atsParseScore({ flags: [] }) === 100);
  // structure from LLM checks
  check("struct from checks: all pass = 100", atsStructFromChecks({ checks: [{ status: "pass" }, { status: "pass" }] }) === 100);
  check("struct from checks: half warn < 100", atsStructFromChecks({ checks: [{ status: "warn" }, { status: "fail" }] }) < 60);
})();

// 13) Bad/verbose rewrites LOWER structure (score can FALL — realism)
(() => {
  const concise = { title: "Designer", contact: { email: "a@b.com", phone: "+1 555 123 4567", location: "X" }, sections: [
    { heading: "Experience", kind: "experience", items: [{ role: "D", org: "M", dates: "03/2020 - Present", bullets: ["Lifted conversion 12% across 3M users", "Shipped design system to 6 teams"] }] },
    { heading: "Skills", kind: "skills", groups: [{ label: "D", items: ["Figma"] }] },
    { heading: "Education", kind: "education", items: [{ school: "NIFT", credential: "B.Des", dates: "2010 - 2014" }] }
  ] };
  const bloated = JSON.parse(JSON.stringify(concise));
  bloated.sections[0].items[0].bullets = [
    "Spearheaded and orchestrated a synergistic cross-functional user-centered design systems initiative leveraging agile methodologies and stakeholder alignment to holistically drive scalable best-in-class experiences across the entire product ecosystem from end to end at massive scale",
    "Utilized a plethora of cutting-edge tools and frameworks to ideate conceptualize and operationalize innovative paradigm-shifting solutions that truly moved the needle"
  ];
  const cs = atsModelChecks(concise, { level: "senior" }).structureScore;
  const bs = atsModelChecks(bloated, { level: "senior" }).structureScore;
  check("verbose/stuffed bullets LOWER structure than concise", bs < cs, { concise: cs, bloated: bs });
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
