import { sectionTextFields, sectionTextVisibility } from "./src/js/slide-merge-section-component.mjs";
test('section visibility exposes present text roles and stores only explicit hidden flags', () => {
  const block = {type:'gallery',heading:'Title',kicker:'Context',items:[{src:'image.png',caption:'Caption'}]}, before = structuredClone(block);
  assert.deepEqual(sectionTextFields(block).map(field=>field.key),['heading','kicker','caption']);
  assert.deepEqual(sectionTextFields({...block,body:'Description'}).map(field=>field.key),['heading','kicker','description','caption']);
  assert.deepEqual(sectionTextFields({encStub:true,heading:'Not an unlocked field'}),[]);
  assert.deepEqual(sectionTextVisibility({heading:false,kicker:true,caption:'false',description:false,private:'secret'}),{heading:false,description:false});
  assert.deepEqual(block,before);
});
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSectionReference, sectionComponentPlan } from "./src/js/slide-merge-section-component.mjs";

test("protected inserts persist only a bounded source reference, never decrypted content", () => {
  const reference = { version: 1, caseStudyId: "private-case", sectionId: "section-123", secret: "never-copy-this" };
  for (const block of [{type:"gallery",locked:true,vaultBlock:"private-vault-key"},{type:"text",locked:true,heading:"Private heading",body:"Private prose",items:[{src:"vault:private-original"}]}]) {
    const before = structuredClone(block);
    const plan = sectionComponentPlan(block, String, "protected", {sectionReference:reference,customIcons:{private:"secret-svg"}});
    assert.equal(plan.title, "Protected section");
    assert.equal(plan.notes, "");
    assert.deepEqual(plan.elements[0].customData, {sectionReference:{version:1,caseStudyId:"private-case",sectionId:"section-123"}});
    assert.doesNotMatch(JSON.stringify(plan), /Private heading|Private prose|vault:|private-vault-key|secret-svg|never-copy-this/);
    assert.deepEqual(block, before);
  }
  for (const invalid of [{}, {...reference,version:2}, {...reference,sectionId:"../vault/key"}, {...reference,caseStudyId:""}]) {
    assert.equal(normalizeSectionReference(invalid), null);
    assert.throws(() => sectionComponentPlan({type:"text",locked:true},String,"invalid",{sectionReference:invalid}), /not available/);
  }
});

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