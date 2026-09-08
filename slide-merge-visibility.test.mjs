import test from "node:test";
import assert from "node:assert/strict";
import { deckVisibility, setDeckVisibility, publicDeckPayload } from "./src/js/slide-merge-visibility.mjs";

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