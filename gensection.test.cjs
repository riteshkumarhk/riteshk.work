/* Unit tests for the RKGen guardrail engine (src/js/gensection.js).
   Run: node gensection.test.cjs
   Focus: the v2 "strict" guardrails — showpiece fence, depth cap, flatten,
   children cap — and that v1 legacy specs stay permissive (non-breaking). */
const RKGen = require("./src/js/gensection.js");

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; } else { fail++; console.error("  FAIL: " + name); } }
function maxDepth(n) { return (!n || !n.children || !n.children.length) ? 0 : 1 + Math.max.apply(null, n.children.map(maxDepth)); }

// 1. v2: freeform style OUTSIDE a showpiece is dropped (token-only by default)
let s = RKGen.clean({ version: 2, root: { type: "card", props: {}, style: "background: red", children: [{ type: "heading", text: "Hi" }] } });
ok(!s.root.style, "v2: card style outside showpiece is dropped");

// 2. v2: freeform style INSIDE a showpiece is kept (fenced bespoke zone)
s = RKGen.clean({ version: 2, root: { type: "showpiece", props: {}, children: [{ type: "card", props: {}, style: "background: red", children: [{ type: "heading", text: "x" }] }] } });
ok(/background/.test(s.root.children[0].style || ""), "v2: card style inside showpiece is kept");

// 3. v2: token props survive even when freeform style is stripped
s = RKGen.clean({ version: 2, root: { type: "stack", props: { bg: "elev", gap: "lg" }, style: "background: red", children: [{ type: "pill", text: "UX", tone: "accent" }] } });
ok(!s.root.style && s.root.props.bg === "elev" && s.root.props.gap === "lg", "v2: token props kept, freeform style dropped");

// 4. v1: legacy specs stay permissive (don't break existing sections / mockups)
s = RKGen.clean({ version: 1, root: { type: "card", props: {}, style: "box-shadow: 18px 18px 40px rgba(0,0,0,.5)", children: [{ type: "media", src: "" }] } });
ok(/box-shadow/.test(s.root.style || "") && s.version === 1, "v1: legacy mockup style preserved (permissive)");

// 5. depth cap: nesting beyond MAX_DEPTH (6) is dropped
function cardChain(d) { let node = { type: "text", text: "leaf" }; for (let i = 0; i < d; i++) node = { type: "card", props: {}, children: [node, { type: "text", text: "sib" }] }; return node; }
s = RKGen.clean({ version: 2, root: cardChain(10) });
ok(maxDepth(s.root) <= 6, "depth capped at 6 (deep nesting dropped)");

// 6. flatten: a pointless single-child default stack collapses to its child
s = RKGen.clean({ version: 2, root: { type: "card", props: {}, children: [{ type: "stack", props: {}, children: [{ type: "heading", text: "solo" }] }] } });
ok(s.root.children[0].type === "heading", "single-child default stack flattened away");

// 7. children cap: a container keeps at most 24 children
const kids = []; for (let i = 0; i < 40; i++) kids.push({ type: "text", text: "t" + i });
s = RKGen.clean({ version: 2, root: { type: "stack", props: {}, children: kids } });
ok(s.root.children.length === 24, "children capped at 24");

// 8. fx is fenced to showpiece too
s = RKGen.clean({ version: 2, root: { type: "card", props: {}, fx: "tilt", children: [{ type: "heading", text: "x" }] } });
ok(!s.root.fx, "v2: fx outside showpiece dropped");
s = RKGen.clean({ version: 2, root: { type: "showpiece", props: {}, fx: "tilt", children: [{ type: "heading", text: "x" }] } });
ok(s.root.fx === "tilt", "v2: fx on a showpiece kept");

// 9. the root single-child stack is NOT flattened (keeps isEmpty valid)
s = RKGen.clean({ version: 2, root: { type: "stack", props: {}, children: [{ type: "heading", text: "only" }] } });
ok(s.root.type === "stack" && !RKGen.isEmpty(s), "root single-child stack preserved (not flattened)");

// 10. showpiece renders its own class + blankSpec is now strict (v2)
ok(/gs-showpiece/.test(RKGen.renderHtml({ version: 2, root: { type: "showpiece", props: {}, children: [{ type: "heading", text: "Hero" }] } })), "showpiece renders .gs-showpiece");
ok(RKGen.blankSpec().version === 2, "blankSpec emits a strict (v2) spec");

console.log((fail ? "\u2717" : "\u2713") + " gensection guardrails: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
