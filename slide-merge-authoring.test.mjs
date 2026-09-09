import test from "node:test";
import assert from "node:assert/strict";
import { compositionCatalog, compileComposition, validateComposition } from "./src/js/slide-merge-composition.mjs";
import { authoringEvidence } from "./src/js/slide-merge-authoring.mjs";
import { fitAuthoredText } from "./src/js/slide-merge-authoring-fit.mjs";
import { deckModelCandidates } from "./src/js/slide-merge-authoring-models.mjs";
import { readFile } from "node:fs/promises";

const options = { plain: String, fontFamily: 2 };
const data = { work: [{ id: "case", title: "Case", study: { blocks: [{ type: "gallery", heading: "A simpler path", items: [{ src: "original.png", caption: "Two steps instead of five" }] }, { type: "metrics", items: [{ value: "20%", label: "Completion increase" }] }] } }] };
const slide = sourceIds => ({ id: "decision", kind: "authored", layout: "split", sourceIds, headline: "Reduce the decision burden", kicker: "DESIGN DECISION", body: "A shorter path helps users finish.", notes: "Verify the causal wording with the source.", components: [sourceIds[0]] });

test("authoring composes editable copy and intact source components without mutating sources", async () => {
  const before = structuredClone(data), catalog = await compositionCatalog(data, options);
  const spec = { version: 2, title: "A clear path", slides: [slide(catalog.map(source => source.sourceId))] };
  const compiled = await compileComposition(spec, data, options);
  assert.ok(compiled.slides[0].elements.some(element => element.type === "text" && element.text === spec.slides[0].headline));
  assert.deepEqual(compiled.slides[0].elements.find(element => element.customData?.sectionComponent).customData.sectionComponent, data.work[0].study.blocks[0]);
  assert.equal(compiled.slides[0].provenance.sources.length, 2);
  assert.equal(compiled.warnings[0].code, "factual-review");
  assert.deepEqual(data, before);
});
test("authored contracts reject unsupported layouts, scripts, missing components and invented source IDs", async () => {
  const catalog = await compositionCatalog(data, options), base = slide(catalog.map(source => source.sourceId));
  for (const change of [{ layout: "html" }, { headline: "<script>bad</script>" }, { components: [] }, { sourceIds: [] }, { arbitrary: true }]) {
    assert.throws(() => validateComposition({ version: 2, title: "Test", slides: [{ ...base, ...change }] }));
  }
  await assert.rejects(() => compileComposition({ version: 2, title: "Test", slides: [{ ...base, sourceIds: ["invented"], components: ["invented"] }] }, data, options), /unavailable/);
});
test("authoring evidence includes nested metrics and captions but no media URLs", () => {
  const evidence = authoringEvidence({ items: [{ value: "20%", caption: "Two steps", src: "https://secret.example/image.png" }] }, String);
  assert.match(evidence, /20%/); assert.match(evidence, /Two steps/); assert.doesNotMatch(evidence, /https|secret/);
});

test("authored text fits without truncation and rejects unreadable overflow", () => {
  const element = { type: "text", text: "Long presentation copy ".repeat(8).trim(), fontSize: 30, lineHeight: 1.25, width: 400, height: 260 };
  const fitted = fitAuthoredText(element, (text, size) => text.length * size * .5);
  assert.equal(fitted.text.replace(/\s/g, ""), element.text.replace(/\s/g, ""));
  assert.ok(fitted.fontSize >= 18 && fitted.text.split("\n").length * fitted.fontSize * 1.25 <= element.height);
  assert.throws(() => fitAuthoredText({ ...element, height: 1 }, (text, size) => text.length * size), /too dense/);
});
test("deck model routing ranks suitable accessible models without changing custom configuration", () => {
  assert.deepEqual(deckModelCandidates("anthropic", ["claude-haiku-4", "claude-sonnet-4-5", "claude-opus-4-6"], ["claude-sonnet-4"]), ["claude-opus-4-6", "claude-sonnet-4-5", "claude-haiku-4", "claude-sonnet-4"]);
  assert.equal(deckModelCandidates("openai", ["gpt-image-1", "gpt-5-mini", "gpt-5.2", "gpt-5.1"], [])[0], "gpt-5.2");
  assert.deepEqual(deckModelCandidates("custom", ["unrequested"], ["configured"]), ["configured"]);
});

test("candidate override is scoped to the actual one-shot adapter", async () => {
  const source = await readFile(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  const oneShot = source.slice(source.indexOf("async function aiText(cfg"), source.indexOf("function aiKeyModal"));
  assert.match(oneShot, /opts\.candidates \|\| await aiModelCandidates/);
  assert.match(oneShot, /opts\.deckAuthoring/);
  const stream = source.slice(source.indexOf("async function aiTextStream"), source.indexOf("async function aiText(cfg"));
  assert.doesNotMatch(stream, /opts\.candidates/);
});