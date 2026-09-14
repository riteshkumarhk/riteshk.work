import test from "node:test";
import assert from "node:assert/strict";
import { PROPERTY_LAYOUTS, layoutPlan, slideOwnsFocus, transitionMatch, isEmptyPlaceholder } from "./src/js/slide-merge-properties.mjs";
import { guidePosition, guideSnap } from "./src/js/slide-merge-guide-core.mjs";
import { COVER_FIELDS, COVER_DEFAULTS, coverPalette, coverSkeleton, coverValues } from "./src/js/slide-merge-cover.mjs";
test("new covers resolve site colour tokens without overwriting saved palettes", () => {
  const tokens = { "--bg": " #f2eee6 ", "--bg-2": "#eae5db", "--bg-elev": "#e2dcd0", "--text": "#1b1915", "--text-dim": "#5c5850" };
  const palette = coverPalette({ getPropertyValue: token => tokens[token] });
  assert.deepEqual(palette, { background: "#f2eee6", rail: "#eae5db", panel: "#e2dcd0", text: "#1b1915", muted: "#5c5850" });
  const saved = coverValues({ ...palette, background: "#735d4d", rail: "#302319" });
  assert.equal(coverValues(saved).background, "#735d4d");
  assert.equal(coverValues(saved).rail, "#302319");
  assert.equal(coverPalette({ getPropertyValue: () => "" }).background, COVER_DEFAULTS.background);
});
test("fixed cover fields preserve geometry, originals and independent instances", () => {
  const source = { title: "Reinventing Edge Onboarding Journey", client: "Microsoft AI", mark: "MAI", status: "In development", duration: "2025 - Current", team: "1 designer\n1 product manager\n3 engineers\n1 content designer\nData Science\nPrivacy", role: "Led onboarding vision", footnote: "First Run Experience", image: { fileId: "original", width: 1600, height: 900, name: "original.png" } };
  const before = structuredClone(source), first = coverSkeleton(source, 123, "one"), second = coverSkeleton({ ...source, title: "Another project" }, 123, "two");
  assert.deepEqual(source, before);
  assert.ok(first.every(element => element.locked && element.frameId === "lab-slide" && element.customData.slideCover));
  assert.deepEqual(first.map(({ x, y, width, height }) => ({ x, y, width, height })), second.map(({ x, y, width, height }) => ({ x, y, width, height })));
  assert.ok(first.every(element => !second.some(other => other.id === element.id)));
  assert.equal(first.find(element => element.customData.slideCover === "title").text, source.title);
  const image = first.find(element => element.type === "image");
  assert.equal(image.fileId, "original");
  assert.equal(image.crop.width / image.crop.height, image.width / image.height);
  assert.equal(first.filter(element => /^team-\d/.test(element.customData.slideCover)).length, 6);
  assert.equal(coverSkeleton({ ...source, team: source.team.replaceAll('\n', ', ') }, 123).filter(element => /^team-\d/.test(element.customData.slideCover)).length, 6);
  assert.equal(coverSkeleton({}, 123).some(element => element.type === "image"), false);
  assert.equal(coverValues({ background: "url(https://invalid)", image: { fileId: "bad", width: 0, height: 3 } }).background, COVER_DEFAULTS.background);
  assert.equal(coverValues({ image: { fileId: "bad", width: 0, height: 3 } }).image, undefined);
  assert.equal(COVER_FIELDS.some(([key]) => key === "mark"), false);
  const withLogo = coverSkeleton({ ...source, logo: { fileId: "logo-original", width: 240, height: 120, name: "brand.png" } }, 123);
  const logo = withLogo.find(element => element.customData.slideCover === "logo");
  assert.equal(logo.fileId, "logo-original");
  assert.equal(logo.width / logo.height, 2);
  assert.ok(logo.width <= 54 && logo.height <= 54);
  assert.equal(withLogo.some(element => element.customData.slideCover === "mark"), false);
});
test("nine layouts preserve real content, locks and groups; placeholders do not accumulate", () => {
  assert.equal(PROPERTY_LAYOUTS.length,9);
  const source = [{id:"text",type:"text",text:"Keep me",x:2,y:3,width:100,height:20}, {id:"locked",type:"text",locked:true,text:"Stay"}, {id:"group",type:"text",groupIds:["group"]}, {id:"bound",type:"text",containerId:"shape"}];
  for (const layout of PROPERTY_LAYOUTS) {
    const plan = layoutPlan(source,layout.id,123,"new");
    assert.ok(plan.updates.every(update=>update.id==="text"));
    assert.ok(plan.additions.every(element=>element.x>=0&&element.y>=0&&element.x+element.width<=1280.01&&element.y+element.height<=720.01));
    assert.deepEqual(plan.removed,[]);
  }
  const first=layoutPlan([],"title",123,"new").additions;
  assert.equal(layoutPlan(first,"titlecontent",123,"next").removed.length,3);
  assert.equal(isEmptyPlaceholder({...first[0],originalText:"Edited"}),false);
  assert.equal(source[0].x,2);
});
test("media keeps aspect ratio and blank never deletes real content", () => {
  const image={id:"image",type:"image",width:1600,height:900,fileId:"original"};
  const plan=layoutPlan([image],"picturecaption",123,"test");
  assert.equal(plan.updates[0].width/plan.updates[0].height,1600/900);
  assert.deepEqual(layoutPlan([image],"blank",123,"test"),{updates:[],additions:[],removed:[]});
});
test("slide focus excludes selections and drawing, accepts frame and hand", () => {
  const elements=[{id:"lab-slide"},{id:"object"}], state={activeTool:{type:"selection"},selectedElementIds:{}};
  assert.equal(slideOwnsFocus(elements,state),true);
  assert.equal(slideOwnsFocus(elements,{...state,selectedElementIds:{"lab-slide":true}}),true);
  assert.equal(slideOwnsFocus(elements,{...state,selectedElementIds:{object:true}}),false);
  assert.equal(slideOwnsFocus(elements,{...state,activeTool:{type:"text"}}),false);
  assert.equal(slideOwnsFocus(elements,{...state,activeTool:{type:"hand"}}),true);
});
test("Magic Move matches identity or content once", () => {
  const old=[{id:"a",type:"text",text:"Shared"},{id:"image",type:"image",fileId:"bytes"}];
  const next=[{id:"b",type:"text",text:"Shared"},{id:"c",type:"text",text:"Shared"},{id:"d",type:"image",fileId:"bytes"}];
  assert.deepEqual(transitionMatch(old,next).map(match=>match.previous?.id),["a",undefined,"image"]);
});
test("guide dragging accounts for zoom/pan and removes out-of-slide drops", () => {
  assert.equal(guidePosition(250,50,.5,1280),400);
  assert.equal(guidePosition(40,50,.5,1280),null);
  assert.equal(guidePosition(800,50,.5,1280),null);
});
test("guide snapping uses edges/centres and a screen-pixel tolerance", () => {
  const bounds={x:100,y:100,width:200,height:100};
  assert.deepEqual(guideSnap(bounds,[{axis:"x",position:203},{axis:"y",position:198}],1),{x:3,y:-2});
  assert.deepEqual(guideSnap(bounds,[{axis:"x",position:207}],1),{x:0,y:0});
  assert.deepEqual(guideSnap(bounds,[{axis:"x",position:207}],.5),{x:7,y:0});
});