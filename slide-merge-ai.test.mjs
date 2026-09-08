import test from "node:test";
import assert from "node:assert/strict";
import { compositionRequest, parseCompositionResponse, draftComposition, compositionDeck, selectedCompositionCatalog } from "./src/js/slide-merge-ai.mjs";

const catalog = [{ sourceId: "source-a", title: "Context", excerpt: "Evidence", type: "gen", hasMedia: true, secret: "never-send" }];
const proposal = { version: 1, title: "Our story", slides: [{ id: "context", kind: "section", sourceId: "source-a" }] };

test("contextual drafting uses only selected sections and keeps original source positions", async () => {
  const blocks = [{ type: "text", heading: "Not selected", body: "Omit" }, { type: "text", heading: "Selected", body: "Use" }, { type: "gen", heading: "Protected", private: true }];
  const data = { work: [{ id: "study", study: { blocks } }] };
  const options = { plain: String, fontFamily: 1 };
  const sources = await selectedCompositionCatalog(data, "study", blocks.slice(1), options);
  assert.equal(sources.length, 1);
  assert.equal(JSON.parse(sources[0].sourceId)[1], 1);
  assert.equal(sources[0].title, "Selected");
  await assert.rejects(() => selectedCompositionCatalog(data, "study", [], options));
  await assert.rejects(() => selectedCompositionCatalog(data, "study", [{ type: "text" }], options));
});

test("AI prompt sends only catalog fields and a bounded brief", () => {
  const prompt = compositionRequest(catalog, "Explain the decision");
  assert.equal(JSON.parse(prompt.user).sources[0].type, "gen");
  assert.doesNotMatch(prompt.user, /secret|never-send/);
  assert.throws(() => compositionRequest([], "Brief"));
  assert.throws(() => compositionRequest(catalog, " "));
  assert.throws(() => compositionRequest(catalog, "x".repeat(2001)));
});

test("AI proposal rejects malformed output, unsupported fields and invented sources", () => {
  assert.deepEqual(parseCompositionResponse(JSON.stringify(proposal), catalog), proposal);
  for (const value of ["not JSON", JSON.stringify({ ...proposal, publish: true }), JSON.stringify({ ...proposal, slides: [{ ...proposal.slides[0], sourceId: "invented" }] })]) assert.throws(() => parseCompositionResponse(value, catalog));
});

test("cancelled drafts cannot produce an applicable proposal, including late responses", async () => {
  const controller = new AbortController();
  await assert.rejects(() => draftComposition(catalog, "Brief", async () => { controller.abort(); return JSON.stringify(proposal); }, controller.signal), { name: "AbortError" });
  let called = false;
  await assert.rejects(() => draftComposition(catalog, "Brief", async () => { called = true; }, controller.signal), { name: "AbortError" });
  assert.equal(called, false);
});

test("apply planning preserves current content on append and visibility on replacement", () => {
  const deck = { title: "Original", selected: "old", slidesPublic: false, slides: [{ id: "old", notes: "Private notes", hidden: true }] };
  const slides = [{ id: "new", scene: { elements: [{ id: "component" }] } }];
  const before = structuredClone({ deck, slides });
  const appended = compositionDeck(deck, slides, "Proposal", "append");
  assert.equal(appended.slides.length, 2); assert.equal(appended.slides[0].notes, "Private notes"); assert.equal(appended.title, "Original");
  const replaced = compositionDeck(deck, slides, "Proposal", "replace");
  assert.equal(replaced.slides.length, 1); assert.equal(replaced.title, "Proposal"); assert.equal(replaced.slidesPublic, false);
  assert.deepEqual({ deck, slides }, before);
  assert.throws(() => compositionDeck(deck, slides, "Proposal", "publish"));
  assert.throws(() => compositionDeck(deck, [], "Proposal", "replace"));
});