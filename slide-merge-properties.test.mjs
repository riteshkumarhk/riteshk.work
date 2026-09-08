import test from "node:test";
import assert from "node:assert/strict";
import { PROPERTY_LAYOUTS, layoutPlan, slideOwnsFocus, transitionMatch, isEmptyPlaceholder } from "./src/js/slide-merge-properties.mjs";
import { guidePosition, guideSnap } from "./src/js/slide-merge-guide-core.mjs";
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