import test from "node:test";
import assert from "node:assert/strict";
import { availableStudies, sectionMediaUrl, sectionPlan } from "./src/js/slide-merge-sections.mjs";
const plain = value => String(value ?? "");
test("section picker excludes private, locked and disabled material", () => {
  const data = {work:[{id:"public",study:{blocks:[{type:"text",body:"Hello"},{locked:true},{encStub:true},{vaultBlock:true},{off:true}]}},{locked:true,study:{blocks:[{body:"secret"}]}}]};
  assert.equal(availableStudies(data).length, 1);
  assert.equal(availableStudies(data)[0].blocks.length, 1);
  assert.throws(() => sectionPlan({locked:true,body:"secret"}, plain, 2, "section"), /not available/);
});
test("source conversion creates editable text and preserves full prose in notes", () => {
  const body = "Long content. ".repeat(100);
  const plan = sectionPlan({type:"text",heading:"Context",body}, plain, 5, "source");
  assert.equal(plan.notes, body);
  assert.ok(plan.elements[1].text.length <= 500);
  assert.ok(plan.elements[1].text.endsWith("..."));
  assert.ok(plan.elements.every(element => element.type === "text" && element.fontFamily === 5 && element.frameId === "lab-slide"));
  assert.equal(sectionPlan({type:"metrics",items:[{value:"42%",label:"Growth"}]}, plain, 5, "metric").elements[0].text,"42%");
  assert.equal(sectionPlan({type:"voices",items:[{quote:"Useful",who:"Alex"}]}, plain, 5, "quote").elements[1].text,"Alex");
});
test("media uses original source URLs and rejects executable or vault URLs", () => {
  assert.equal(sectionMediaUrl("media/original.png"), "https://riteshk.work/media/original.png");
  assert.equal(sectionMediaUrl("/assets/uploads/original.webp"), "https://media.riteshk.work/original.webp");
  assert.equal(sectionMediaUrl("https://riteshk.work/assets/uploads/original.webp?v=1"), "https://media.riteshk.work/original.webp?v=1");
  for (const value of ["javascript:alert(1)","http://example.com/image.png","https://example.com/vault/image", "https://user:pass@example.com/a", "/assets/protected/image.png", "private.enc", "rkenc:secret"]) assert.equal(sectionMediaUrl(value),null);
  const plan = sectionPlan({type:"gallery",heading:"Screens",items:[{src:"media/original.png"}]}, plain, 5, "image");
  assert.equal(plan.media.width,1100);
  assert.equal(plan.media.url,"https://riteshk.work/media/original.png");
  assert.equal(plan.elements[0].text,"Screens");
  assert.throws(() => sectionPlan({type:"unknown"}, plain, 5, "empty"), /no supported/);
});