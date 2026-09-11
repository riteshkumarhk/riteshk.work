import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { deckVisibility, setDeckVisibility, publicDeckPayload } from "./src/js/slide-merge-visibility.mjs";
import { prepareStudioPublication, nativePublicDeck } from "./src/js/slide-studio-publication.mjs";
import { restoreStudioOwnerCopies, hasStudioOwnerCopies } from "./src/js/slide-studio-owner.mjs";

test("publishing preserves unopened private legacy decks and only clears explicitly emptied decks", async () => {
  const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  const start = source.indexOf("async function encryptDecksForPublish(pubData)");
  const end = source.indexOf("  // ---------- per-image protected media", start);
  const encrypt = runInNewContext(`(${source.slice(start, end)})`);
  const sealed = { work: [{ study: { slidesEnc: { ct: "private-deck", wraps: { owner: "owner-only-key" } } } }] };
  const original = structuredClone(sealed);
  await encrypt(sealed);
  assert.deepEqual(sealed, original);
  const emptied = structuredClone(sealed);
  emptied.work[0].study.slides = [];
  await encrypt(emptied);
  assert.equal(emptied.work[0].study.slidesEnc, undefined);
});

test("fresh-device recovery reuses the existing owner key for every deck and case-study copy", () => {
  const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  const start = source.indexOf("function firstOwnerWrap()"), end = source.indexOf("async function ensureRecoveryPass()", start);
  for (const key of ["slidesEnc", "slidesOwnerEnc", "nativeDeckEnc", "authorSectionsEnc", "enc"]) {
    const owner = { salt: "existing-owner-key" }, data = { work: [{ study: { [key]: { wraps: { owner } } } }] };
    const find = runInNewContext(`(${source.slice(start, end)})`, { data });
    assert.deepEqual(find(), owner);
  }
});

test("visibility defaults private and preserves existing public intent", () => {
  assert.equal(deckVisibility(null), "private");
  assert.equal(deckVisibility({}), "private");
  assert.equal(deckVisibility({ slidesPublic: true }), "public");
  assert.equal(deckVisibility({ slidesPublic: "true" }), "private");
});

test("visibility changes only draft intent without changing slides or publication state", () => {
  const original = { title:"Deck", selected:"one", publishedVisibility:"private", slides:[{ id:"one", notes:"Private notes", scene:{ files:{ media:{ dataURL:"original bytes" } } } }] };
  const next = setDeckVisibility(original, "public");
  assert.equal(next.slidesPublic, true);
  assert.equal(next.publishedVisibility, "private");
  assert.deepEqual(next.slides, original.slides);
  assert.equal(original.slidesPublic, undefined);
  assert.equal(deckVisibility(setDeckVisibility(next, "private")), "private");
  assert.throws(() => setDeckVisibility(original, "everyone"), /Invalid/);
});

function fixture() {
  return { slidesPublic:true, title:"Deck", ownerEmail:"private@example.com", source:{ id:"private-source" }, slides:[
    { id:"secret-slide-id", title:"Public title", notes:"PRIVATE NOTES", fixture:"owner-fixture", scene:{ version:1,
      appState:{viewBackgroundColor:"#ffffff", selectedElementIds:{secret:true}, scrollX:100}, libraryItems:[{secret:"LIBRARY"}],
      elements:[
        {id:"lab-slide", type:"frame", x:0, y:0, width:1280, height:720, customData:{slideSettings:{transition:"push", guides:{internal:"PRIVATE"}}}},
        {id:"source-text", type:"text", text:"Visible copy", originalText:"OLD PRIVATE COPY", frameId:"lab-slide", groupIds:["private-group"], customData:{source:{id:"secret"}, labCorners:{mode:"squircle",radius:12,secret:"PRIVATE"}}, boundElements:[{id:"removed",type:"text"}]},
        {id:"photo", type:"image", fileId:"source-file", frameId:"lab-slide", link:"https://private.example.com/token"},
        {id:"removed", type:"text", text:"DELETED", isDeleted:true},
        {id:"hidden-layer", type:"text", text:"HIDDEN", customData:{labLayerHidden:{opacity:100}}}
      ], files:{"source-file":{id:"source-file",mimeType:"image/png",dataURL:"data:image/png;base64,AQID",source:"private-path",created:123}, unused:{dataURL:"UNUSED"}} } },
    {id:"hidden", hidden:true, notes:"SKIPPED", confidential:true, scene:null}
  ] };
}

test("public payload is allowlisted, editable, immutable and preserves original media bytes", () => {
  const deck = fixture(), before = structuredClone(deck);
  const payload = publicDeckPayload(deck, {reviewedSources:true});
  const serialized = JSON.stringify(payload), scene = payload.slides[0].scene;
  for (const secret of ["PRIVATE", "DELETED", "HIDDEN", "UNUSED", "SKIPPED", "private", "owner", "source-text", "source-file", "libraryItems", "notes"]) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(payload.slides.length, 1);
  assert.equal(scene.elements.length, 3);
  assert.equal(scene.elements[1].text, "Visible copy");
  assert.equal(scene.elements[1].originalText, "Visible copy");
  assert.deepEqual(scene.elements[1].customData.labCorners, {mode:"squircle",radius:12});
  assert.equal(scene.elements[0].customData.slideSettings.transition, "push");
  assert.equal(scene.files[scene.elements[2].fileId].dataURL, deck.slides[0].scene.files["source-file"].dataURL);
  assert.deepEqual(deck, before);
});

test("public generation requires intent, fresh explicit review and included content", () => {
  assert.throws(() => publicDeckPayload(setDeckVisibility(fixture(), "private"), {reviewedSources:true}), /Owner-only/);
  assert.throws(() => publicDeckPayload(fixture()), /Review/);
  assert.throws(() => publicDeckPayload({slidesPublic:true, slides:[]}, {reviewedSources:true}), /No included/);
});

test("protected included sources, remote media and unsupported embeds fail closed", () => {
  for (const change of [
    deck => { deck.slides[0].source = {locked:true}; },
    deck => { deck.slides[0].scene.elements[1].customData.source = {protected:true}; },
    deck => { deck.slides[0].scene.files["source-file"].dataURL = "https://media.example.com/signed?token=private"; },
    deck => { deck.slides[0].scene.elements[1].type = "embeddable"; },
    deck => { delete deck.slides[0].scene.files["source-file"]; }
  ]) {
    const deck = fixture(); change(deck);
    assert.throws(() => publicDeckPayload(deck, {reviewedSources:true}));
  }
});

test("render fields cannot carry arbitrary nested metadata", () => {
  const deck = fixture();
  deck.slides[0].scene.elements[1].text = {unexpected:"metadata"};
  assert.throws(() => publicDeckPayload(deck, {reviewedSources:true}), /Unsupported rendering field/);
});

test("transition identities survive reordered slides without exposing source ids", () => {
  const deck = fixture(), second = structuredClone(deck.slides[0]);
  second.id = "second";
  second.scene.elements = [second.scene.elements[0], second.scene.elements[2], second.scene.elements[1]];
  deck.slides.push(second);
  const slides = publicDeckPayload(deck, {reviewedSources:true}).slides;
  assert.equal(slides[0].scene.elements[1].id, slides[1].scene.elements[2].id);
  assert.notEqual(slides[0].scene.elements[1].id, "source-text");
});

test("reviewed original SVG bytes survive separately from the rendering copy", () => {
  const deck = fixture();
  const original = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><title>Reviewed original</title></svg>').toString("base64");
  const rendered = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64");
  deck.slides[0].scene.files["source-file"] = {mimeType:"image/svg+xml",dataURL:rendered,originalDataURL:original};
  const scene = publicDeckPayload(deck,{reviewedSources:true}).slides[0].scene;
  const file = scene.files[scene.elements.find(element=>element.type === "image").fileId];
  assert.equal(file.dataURL,rendered);
  assert.equal(file.originalDataURL,original);
  deck.slides[0].scene.files["source-file"].originalDataURL = "https://private.example.com/source.svg";
  assert.throws(()=>publicDeckPayload(deck,{reviewedSources:true}),/original inline bytes/);
});

test("native sections cannot silently become empty shapes in a public payload", () => {
  const deck = fixture();
  deck.slides[0].scene.elements[1] = { id: "section", type: "rectangle", customData: { sectionComponent: { type: "gallery", items: [{ src: "original.png" }] } } };
  assert.throws(() => publicDeckPayload(deck, { reviewedSources: true }), /public component renderer/);
});

test("production audience payload keeps complete sections, embeds, media and used fonts without author metadata", () => {
  const deck = fixture();
  deck.slides[0].scene.elements[1].fontFamily = 1001;
  deck.fonts = [{ id: 1001, family: "Studio face", runtime: true, source: "PRIVATE", metrics: { unitsPerEm: 1000, ascender: 800, descender: -200, lineHeight: 1.2 }, faces: [{ uri: "https://media.riteshk.work/face.woff2", descriptors: { style: "normal", weight: "400", secret: "PRIVATE" } }] }];
  deck.slides[0].scene.elements.push(
    { id: "component", type: "rectangle", customData: { sectionComponent: { type: "gallery", heading: "The complete gallery", editorName: "PRIVATE", items: [{ src: "/assets/uploads/first.png", caption: "First" }, { src: "https://media.riteshk.work/second.png", caption: "Second" }], provenance: "PRIVATE" } } },
    { id: "embed", type: "rectangle", customData: { slideEmbed: { url: "https://youtu.be/dQw4w9WgXcQ", source: "PRIVATE" } } },
    { id: "video", type: "embeddable", customData: { sectionVideo: "https://media.riteshk.work/movie.mp4" } }
  );
  const before = structuredClone(deck);
  const payload = publicDeckPayload(deck, { reviewedSources: true, production: true });
  const serialized = JSON.stringify(payload), elements = payload.slides[0].scene.elements;
  assert.equal(payload.rendererVersion, 1);
  assert.equal(elements.find(element => element.customData.sectionComponent).customData.sectionComponent.items.length, 2);
  assert.equal(elements.find(element => element.customData.sectionComponent).customData.sectionComponent.items[0].src, "https://media.riteshk.work/first.png");
  assert.equal(elements.find(element => element.customData.slideEmbed).customData.slideEmbed.url, "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(elements.find(element => element.customData.sectionVideo).customData.sectionVideo, "https://media.riteshk.work/movie.mp4");
  assert.equal(payload.fonts[0].faces[0].uri, "https://media.riteshk.work/face.woff2");
  assert.doesNotMatch(serialized, /PRIVATE|SKIPPED|HIDDEN|DELETED|ownerEmail|provenance|notes/);
  assert.deepEqual(deck, before);
  deck.fonts[0].faces[0].uri = 'data:font/woff2;base64,AQID';
  assert.equal(publicDeckPayload(deck, { reviewedSources: true, production: true }).fonts[0].faces[0].uri, deck.fonts[0].faces[0].uri);
});

test("production audience export still blocks protected sections, signed media and unfinished embeds", () => {
  for (const customData of [
    { sectionComponent: { type: "gallery", items: [{ src: "https://media.riteshk.work/private.png?token=private" }] } },
    { sectionComponent: { type: "statement", body: "Private", locked: true } },
    { slideEmbed: { url: "https://example.com/document?sig=private" } },
    { pendingEmbed: true },
    { sectionVideo: "vault:original" }
  ]) {
    const deck = fixture();
    deck.slides[0].scene.elements.push({ id: "unsafe", type: "rectangle", customData });
    assert.throws(() => publicDeckPayload(deck, { reviewedSources: true, production: true }));
  }
});

test("shared publication keeps owner-only decks private and separates public notes and hidden case sections", async () => {
  const publicDeck = fixture(), privateDeck = setDeckVisibility(fixture(), "private"), encrypted = [];
  const draft = { work: [
    { id: "private", title: "Private deck", study: { nativeDeck: { schema: "rk-studio-native-deck", caseStudyId: "private", id: "private-ref" }, slidesPublic: true } },
    { id: "public", title: "Public case", study: { nativeDeck: { schema: "rk-studio-native-deck", caseStudyId: "public", id: "public-ref" }, blocks: [{ type: "statement", body: "Visible" }, { type: "statement", body: "UNPUBLISHED SECTION", off: true }] } },
    { id: "legacy", study: { slidesPublic: true, slides: [{ title: "Visible", notes: "PRIVATE LEGACY NOTES", durationMinutes: 3 }, { title: "SKIPPED LEGACY", hidden: true }] } }
  ] };
  const before = structuredClone(draft);
  const published = await prepareStudioPublication(draft, {
    loadDeck: async reference => ({ document: reference.caseStudyId === "private" ? privateDeck : publicDeck }),
    encryptOwner: async value => { encrypted.push(structuredClone(value)); return { ct: `cipher-${encrypted.length}`, wraps: { owner: "encrypted-owner-key" } }; },
    reviewedSources: true
  });
  assert.equal(nativePublicDeck(published.work[0]), null);
  assert.equal(published.work[0].study.slidesPublic, false);
  assert.equal(nativePublicDeck(published.work[1]).slides.length, 1);
  assert.equal(published.work[1].study.blocks.length, 1);
  assert.ok(published.work[0].study.nativeDeckEnc);
  assert.ok(published.work[1].study.nativeDeckEnc);
  assert.ok(published.work[1].study.authorSectionsEnc);
  assert.ok(published.work[2].study.slidesOwnerEnc);
  assert.doesNotMatch(JSON.stringify(published), /PRIVATE|SKIPPED|UNPUBLISHED SECTION|nativeDeck"|durationMinutes|notes/);
  assert.match(JSON.stringify(encrypted), /PRIVATE NOTES/);
  assert.match(JSON.stringify(encrypted), /UNPUBLISHED SECTION/);
  assert.deepEqual(draft, before);
});

test("unopened encrypted publications remain unchanged and unsafe native sources fail before encryption", async () => {
  const unopened = { work: [{ id: "case", study: { slidesPublic: true, slides: [{ title: "Public" }], slidesOwnerEnc: { ct: "original" }, authorSectionsEnc: { ct: "sections" }, blocks: [{ body: "Public section" }] } }, { encWork: true, ct: "whole-project" }] };
  assert.deepEqual(await prepareStudioPublication(unopened, { encryptOwner: () => { throw new Error("Must not rewrite unopened content"); } }), unopened);
  const deck = fixture(); deck.slides[0].source = { locked: true };
  let calls = 0;
  await assert.rejects(prepareStudioPublication({ work: [{ id: "case", study: { nativeDeck: { schema: "rk-studio-native-deck", caseStudyId: "case" } } }] }, { loadDeck: async () => ({ document: deck }), encryptOwner: async () => { calls++; }, reviewedSources: true }), /Protected source/);
  assert.equal(calls, 0);
});

test("owner presentation restores notes and hidden sections without changing the public document", async () => {
  const published = { id: "case", study: { slidesPublic: true, nativeDeckEnc: { ct: "deck", wraps: { owner: "key" } }, authorSectionsEnc: { ct: "sections", wraps: { owner: "key" } }, blocks: [{ body: "Public section" }] } };
  const before = structuredClone(published);
  assert.equal(hasStudioOwnerCopies(published), true);
  const restored = await restoreStudioOwnerCopies(published, async encrypted => encrypted.ct === "deck" ? { version: 1, caseStudyId: "case", document: fixture() } : { version: 1, caseStudyId: "case", blocks: [{ off: true, body: "Private draft section" }] });
  assert.equal(restored.study.nativeDeckDocument.slides[0].notes, "PRIVATE NOTES");
  assert.equal(restored.study.blocks[0].off, true);
  assert.deepEqual(published, before);
  await assert.rejects(restoreStudioOwnerCopies(published, async () => ({ version: 1, caseStudyId: "wrong-case", document: fixture() })), /invalid/);
  const missingMedia = fixture(); missingMedia.slides[0].scene.files['source-file'].dataURL = 'rkenc:missing-file';
  await assert.rejects(restoreStudioOwnerCopies({ id: 'case', study: { nativeDeckEnc: published.study.nativeDeckEnc } }, async () => ({ version: 1, caseStudyId: 'case', document: missingMedia })), /protected media file/);
  await assert.rejects(prepareStudioPublication({ work: [restored] }), /owner presentation copy/i);
});

test("disabled sections and hidden projects never move their private media to public hosting", async () => {
  const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  const start = source.indexOf("async function deVaultUnlockedForPublish("), end = source.indexOf("async function encryptStudioOwner", start);
  const data = { work: [
    { study: { blocks: [{ type: "media", off: true, vault: true, src: "vault:disabled" }] } },
    { hidden: true, study: { blocks: [{ type: "media", vault: true, src: "vault:hidden-project" }] } }
  ] };
  const before = structuredClone(data);
  const prepare = runInNewContext(`(${source.slice(start, end)})`, { data, adminSession: () => "synthetic-test", vaultSignedUrl: () => { throw new Error("Private media must not be requested"); } });
  await prepare("synthetic-test");
  assert.deepEqual(data, before);
});