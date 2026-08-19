import { atsKeywordMatch, atsExtractJdTerms, atsResumeIndex, atsTokens, atsStem, atsNormalize, atsModelChecks, atsFactsBlock } from "./src/js/ats-core.js";

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
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
