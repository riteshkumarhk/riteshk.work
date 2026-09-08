import test from "node:test";
import assert from "node:assert/strict";
import { fitPlaceholder, placeholderBounds } from "./src/js/slide-merge-placeholder-fit.mjs";
test("uses the full text content slot despite native single-line text measurement", () => {
  const slot = {x:100,y:100,width:400,height:34,customData:{slidePlaceholder:{kind:"text",height:60}}};
  assert.equal(placeholderBounds(slot).height,432);
  const [fitted] = fitPlaceholder([{x:0,y:0,width:200,height:200}],slot);
  assert.deepEqual([fitted.width,fitted.height,fitted.y],[200,200,216]);
});

test("fits content into the chosen slot without changing IDs, bindings or source media", () => {
  const elements = [{ id:"text", x:0, y:0, width:400, height:80, fontSize:40, groupIds:["group"] }, { id:"image", x:0, y:100, width:400, height:200, fileId:"original", customData:{sectionVideo:"original-url"} }];
  const fitted = fitPlaceholder(elements, {x:500,y:100,width:200,height:150});
  assert.deepEqual(fitted.map(element => [element.x,element.y,element.width,element.height]), [[500,100,200,40],[500,150,200,100]]);
  assert.equal(fitted[0].fontSize,20);
  assert.equal(fitted[1].fileId,"original");
  assert.equal(fitted[1].customData.sectionVideo,"original-url");
  assert.deepEqual(fitted[0].groupIds,["group"]);
  assert.equal(elements[0].fontSize,40);
});
test("centers small content without enlarging text and leaves untargeted inserts alone", () => {
  const elements = [{id:"text",x:240,y:280,width:100,height:40,fontSize:28}];
  assert.equal(fitPlaceholder(elements,null),elements);
  const [fitted] = fitPlaceholder(elements,{x:500,y:100,width:300,height:200});
  assert.deepEqual([fitted.x,fitted.y,fitted.fontSize],[600,180,28]);
});