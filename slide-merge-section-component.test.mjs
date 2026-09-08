import test from "node:test";
import assert from "node:assert/strict";
import { sectionComponentPlan } from "./src/js/slide-merge-section-component.mjs";

test("inserting a section retains every carousel item and its component configuration", () => {
  const block = { type: "gallery", heading: "Chrome onboarding", layout: "carousel", items: Array.from({ length: 5 }, (_, index) => ({ src: `original-${index}.png`, caption: `Screen ${index}` })) };
  const plan = sectionComponentPlan(block, String, "insert");
  assert.equal(plan.elements.length, 1);
  assert.equal(plan.elements[0].type, "rectangle");
  assert.equal(plan.elements[0].link, null);
  assert.deepEqual(plan.elements[0].customData.sectionComponent, block);
  assert.notEqual(plan.elements[0].customData.sectionComponent, block);
  block.items.pop();
  assert.equal(plan.elements[0].customData.sectionComponent.items.length, 5);
});

test("nested components, rich content and original bytes survive scene serialization", () => {
  const block = { type: "columns", items: [{ body: "<b>Real content</b>", items: [{ src: "data:image/png;base64,b3JpZ2luYWw=" }] }, { value: "42%" }] };
  const plan = sectionComponentPlan(block, String, "insert");
  assert.deepEqual(JSON.parse(JSON.stringify(plan)).elements[0].customData.sectionComponent, block);
});

test("protected nested components reject insertion without altering source", () => {
  for (const marker of ["locked", "encStub", "vaultBlock", "off", "private", "confidential"]) {
    const block = { type: "gallery", items: [{ [marker]: true, src: "secret.png" }] };
    const before = structuredClone(block);
    assert.throws(() => sectionComponentPlan(block, String, "insert"), /not available/);
    assert.deepEqual(block, before);
  }
});

test("every current case-study component remains a whole component, not an excerpt", () => {
  for (const type of ["text", "statement", "metrics", "steps", "media", "split", "faq", "cards", "cloud", "gallery", "figure", "columns", "rows", "compare", "stickies", "voices", "workflow", "mediagrid", "device", "isolayers", "focus", "gen"]) {
    const block = { type, items: [{ body: "First" }, { body: "Second" }], spec: { version: 2 } };
    assert.deepEqual(sectionComponentPlan(block, String, type).elements[0].customData.sectionComponent, block);
  }
});

test("generated specs preserve their structure and only referenced custom icons", () => {
  const block = { type: "gen", spec: { version: 2, root: { type: "showpiece", children: [{ type: "icon", name: "custom-mark", fx: "orbit" }, { type: "stat", value: "42%" }] } } };
  const icons = { "custom-mark": '<path d="M2 2h20v20H2z"/>', unused: '<circle cx="12" cy="12" r="10"/>' };
  const component = sectionComponentPlan(block, String, "gen", { customIcons: icons }).elements[0].customData;
  assert.deepEqual(component.sectionComponent, block);
  assert.deepEqual(component.sectionIcons, { "custom-mark": icons["custom-mark"] });
});