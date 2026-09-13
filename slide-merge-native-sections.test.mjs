import test from "node:test";
import assert from "node:assert/strict";
import { nativeSectionElement, nativeSectionLayers } from "./src/js/slide-merge-native-sections.mjs";

test("native sections migrate without links or losing source and geometry", () => {
  const old = { id: "section", type: "embeddable", link: "https://slide-lab.invalid/section-component", x: 64, y: 36, width: 1152, height: 648, angle: .2, customData: { sectionComponent: { type: "gallery", items: [{ src: "original.png" }] } } };
  const next = nativeSectionElement(old);
  assert.equal(next.type, "rectangle"); assert.equal(next.link, null);
  assert.equal(next.backgroundColor, "rgba(0, 0, 0, 0)");
  assert.equal(next.customData, old.customData); assert.equal(next.angle, .2);
  assert.equal(old.type, "embeddable"); assert.equal(nativeSectionElement(next), next);
  const external = { type: "embeddable", link: "https://example.com" };
  assert.equal(nativeSectionElement(external), external);
});

test("section layers follow scene geometry and omit hidden or deleted objects", () => {
  const section = { id: "section", x: 100, y: 50, width: 400, height: 200, angle: .5, opacity: 60, customData: { sectionComponent: { type: "text" } } };
  const layers = nativeSectionLayers([section, { ...section, isDeleted: true }, { ...section, customData: { ...section.customData, labLayerHidden: true } }], { zoom: { value: .5 }, scrollX: -20, scrollY: 10 });
  assert.equal(layers.length, 1);
  assert.deepEqual(layers[0].style, { left: 40, top: 30, width: 200, height: 100, transform: "rotate(0.5rad)", opacity: .6 });
});

test("section clipping follows the owning frame through zoom and scroll", () => {
  const frame = { id: "frame", type: "frame", x: 0, y: 0, width: 1280, height: 720 };
  const section = { frameId: "frame", x: -100, y: -100, width: 1500, height: 900, angle: .4, customData: { sectionComponent: { type: "gallery" } } };
  const state = { zoom: { value: .5 }, scrollX: 20, scrollY: 40 };
  assert.equal(nativeSectionLayers([frame, section], state)[0].clipStyle.clipPath, "polygon(10px 20px, 650px 20px, 650px 380px, 10px 380px)");
  assert.equal(nativeSectionLayers([frame, section], { ...state, frameRendering: { clip: false } })[0].clipStyle, undefined);
  assert.equal(nativeSectionLayers([frame, { ...section, frameId: null }], state)[0].frame, frame);
});

test("foreground objects remain in scene order between native sections", () => {
  const section = { id: "section", x: 0, y: 0, width: 100, height: 100, customData: { sectionComponent: { type: "text" } } };
  const label = { id: "label", type: "text" }, top = { id: "top", type: "rectangle" };
  const layers = nativeSectionLayers([section, label, { ...section, id: "second" }, top], { zoom: { value: 1 }, scrollX: 0, scrollY: 0 });
  assert.deepEqual(layers.map(layer => layer.foreground.map(element => element.id)), [["label"], ["top"]]);
});

test("protected references use the same geometry, clipping and scene order without plaintext", () => {
  const reference = {version:1,caseStudyId:'case',sectionId:'section-stable'};
  const element = nativeSectionElement({id:'private',type:'embeddable',x:20,y:30,width:500,height:280,angle:0,customData:{sectionReference:reference}});
  const layers = nativeSectionLayers([element,{id:'label',type:'text'},{...element,id:'second'}],{zoom:{value:1},scrollX:0,scrollY:0});
  assert.equal(element.type,'rectangle');
  assert.equal(layers.length,2);
  assert.deepEqual(layers[0].foreground.map(item=>item.id),['label']);
  assert.deepEqual(layers[0].element.customData,{sectionReference:reference});
});