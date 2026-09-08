import test from "node:test";
import assert from "node:assert/strict";
import { COMPOSITION_CAPABILITIES, compositionCatalog, compileComposition, validateComposition } from "./src/js/slide-merge-composition.mjs";

const options = { plain: value => String(value ?? ""), fontFamily: 5 };
const data = () => ({ work: [{ id: "study", study: { blocks: [
  { type: "text", heading: "Context", body: "Observed evidence." },
  { type: "metrics", heading: "Outcome", items: [{ value: "42%", label: "Measured growth" }] },
  { type: "gallery", heading: "The work", items: [{ src: "data:image/png;base64,b3JpZ2luYWw=", kind: "image" }] }
] } }] });
const spec = () => ({ version: 1, title: "Evidence and outcome", slides: [
  { id: "context", kind: "section", sourceId: '["study",0]' },
  { id: "outcome", kind: "section", sourceId: '["study",1]' },
  { id: "work", kind: "section", sourceId: '["study",2]' }
] });

async function groundedSpec(source) {
  const catalog = await compositionCatalog(source, options);
  const composition = spec();
  composition.slides.forEach((slide, index) => { slide.sourceId = catalog[index].sourceId; });
  return composition;
}

test("catalog includes generated sections without exposing media URLs or protected content", async () => {
  const source = data();
  source.work[0].study.blocks.push({ type: "text", body: "secret", items: [{ locked: true }] }, { type: "gen", body: "unsupported" });
  const catalog = await compositionCatalog(source, options);
  assert.equal(catalog.length, 4);
  assert.equal(catalog[2].hasMedia, true);
  assert.equal(catalog[3].type, "gen");
  assert.doesNotMatch(JSON.stringify(catalog), /base64|secret/);
  for (const marker of ["locked", "encStub", "vaultBlock", "private", "requiresReview", "confidential"]) {
    const restricted = data(); restricted.work[0][marker] = true;
    assert.equal((await compositionCatalog(restricted, options)).length, 0);
  }
});

test("strict contract rejects unknown capabilities, injected fields and duplicate IDs", () => {
  assert.ok(Object.isFrozen(COMPOSITION_CAPABILITIES.kinds));
  assert.deepEqual(validateComposition(spec()), spec());
  for (const invalid of [
    { ...spec(), version: 2 }, { ...spec(), slides: [] }, { ...spec(), html: "<script>" },
    { ...spec(), slides: [{ ...spec().slides[0], kind: "iframe" }] },
    { ...spec(), slides: [{ ...spec().slides[0], url: "https://example.com" }] },
    { ...spec(), slides: [spec().slides[0], spec().slides[0]] },
    { ...spec(), slides: Array.from({ length: 25 }, (_, index) => ({ ...spec().slides[0], id: `slide-${index}` })) }
  ]) assert.throws(() => validateComposition(invalid));
});

test("compilation is deterministic, editable and leaves source/spec unchanged", async () => {
  const source = data(), composition = await groundedSpec(source);
  const before = structuredClone({ source, composition });
  const compiled = await compileComposition(composition, source, options);
  assert.deepEqual(compiled, await compileComposition(composition, source, options));
  assert.deepEqual({ source, composition }, before);
  assert.equal(compiled.slides[1].elements[0].customData.sectionComponent.items[0].value, "42%");
  assert.equal(compiled.slides[2].elements[0].customData.sectionComponent.items[0].src, source.work[0].study.blocks[2].items[0].src);
  assert.ok(compiled.slides.flatMap(slide => slide.elements).every(element => element.type === "rectangle" && element.link == null && element.frameId === "lab-slide"));
  const ids = compiled.slides.flatMap(slide => slide.elements.map(element => element.id));
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(compiled.slides[0].provenance.workId, "study");
});

test("compiler rechecks access and fails atomically on unavailable references", async () => {
  const source = data();
  const composition = await groundedSpec(source);
  source.work[0].study.blocks[1].locked = true;
  await assert.rejects(() => compileComposition(composition, source, options), /unavailable source/);
  const missing = await groundedSpec(data()); missing.slides[2].sourceId = '["study",99]';
  await assert.rejects(() => compileComposition(missing, data(), options), /unavailable source/);
});

test("quality warnings retain full notes and flag repeated sources", async () => {
  const source = data(); source.work[0].study.blocks[0].body = "Evidence. ".repeat(100);
  const composition = await groundedSpec(source); composition.slides.push({ ...composition.slides[0], id: "repeat" });
  const compiled = await compileComposition(composition, source, options);
  assert.equal(compiled.slides[0].notes, source.work[0].study.blocks[0].body);
  assert.ok(compiled.warnings.some(warning => warning.code === "component-review"));
  assert.ok(compiled.warnings.some(warning => warning.code === "repeated-source"));
});

test("source edits and reorder invalidate stale model references", async () => {
  const source = data(), composition = await groundedSpec(source);
  source.work[0].study.blocks.reverse();
  await assert.rejects(() => compileComposition(composition, source, options), /unavailable source/);
  source.work[0].study.blocks.reverse();
  source.work[0].study.blocks[0].body = "Updated evidence";
  await assert.rejects(() => compileComposition(composition, source, options), /unavailable source/);
});

test("catalog excludes protected URLs while retaining section-owned embeds and direct media", async () => {
  const source = data();
  source.work.unshift(null);
  source.work[1].study.blocks.push(
    { type: "gallery", heading: "Protected", items: [{ src: "/assets/protected/private.png" }] },
    { type: "gallery", heading: "Embed", items: [{ src: "https://example.com/player", kind: "iframe" }] },
    { type: "gallery", heading: "Video", items: [{ src: "https://media.example.com/original.mov" }] }
  );
  const catalog = await compositionCatalog(source, options);
  assert.deepEqual(catalog.map(item => item.title), ["Context", "Outcome", "The work", "Embed", "Video"]);
  const composition = { version: 1, title: "Video", slides: [{ id: "video", kind: "section", sourceId: catalog.at(-1).sourceId }] };
  const compiled = await compileComposition(composition, source, options);
  assert.equal(compiled.slides[0].elements[0].customData.sectionComponent.items[0].src, "https://media.example.com/original.mov");
});

test("duplicate source IDs and cyclic content fail closed", async () => {
  const duplicate = data(); duplicate.work.push(structuredClone(duplicate.work[0]));
  await assert.rejects(() => compositionCatalog(duplicate, options), /Duplicate/);
  const cyclic = data(); cyclic.work[0].study.blocks[0].self = cyclic.work[0].study.blocks[0];
  await assert.rejects(() => compositionCatalog(cyclic, options), /Cyclic/);
});

test("long multiline content is preserved inside the component for runtime layout", async () => {
  const source = data(); source.work[0].study.blocks[0].body = "Line\n".repeat(90);
  const compiled = await compileComposition(await groundedSpec(source), source, options);
  assert.equal(compiled.slides[0].elements[0].customData.sectionComponent.body, source.work[0].study.blocks[0].body);
  assert.equal(compiled.slides[0].notes, source.work[0].study.blocks[0].body);
});