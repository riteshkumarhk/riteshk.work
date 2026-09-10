import test from "node:test";
import assert from "node:assert/strict";
import { availableStudies, caseStudyMedia, sectionMediaUrl, sectionPlan } from "./src/js/slide-merge-sections.mjs";
import { embedDescriptor } from "./src/js/slide-merge-embeds.mjs";
const plain = value => String(value ?? "");
test("case-study media includes cover, overview and nested media once, excluding private content", () => {
  const work = { image:"/assets/uploads/cover.svg", study:{skim:{media:[{src:"clip.mp4",kind:"video"}]},blocks:[{items:[{src:"photo.png"},{src:"photo.png"},{src:"secret.png",locked:true}]},{locked:true,items:[{src:"hidden.png"}]},{body:"Text",url:"https://example.com/article"},{src:"/assets/protected/private.png"},{items:[{cells:[{media:{src:"deep.webp"}}]}]}]}};
  const media = caseStudyMedia(work);
  assert.deepEqual(media.map(item=>item.kind),["image","video","image","image"]);
  assert.equal(media[0].url,"https://media.riteshk.work/cover.svg");
  assert.equal(caseStudyMedia({...work,locked:true}).length,0);
  assert.equal(availableStudies({work:[{image:"cover.png"}]},true)[0].media.length,1);
});
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
test("media inventory excludes web embeds but retains original vector and video URLs", () => {
  const media=caseStudyMedia({study:{blocks:[{items:[{kind:"frame",src:"https://example.com/embed"},{src:"https://www.youtube.com/embed/123"},{src:"https://youtu.be/123"},{kind:"video",src:"https://media.example.com/original.mov"},{kind:"image",src:"https://media.example.com/original.svg"}]}]}});
  assert.deepEqual(media.map(item=>item.url),["https://media.example.com/original.mov","https://media.example.com/original.svg"]);
  assert.deepEqual(media.map(item=>item.kind),["video","image"]);
});

test("comparison and split media are available without losing either source", () => {
  const media = caseStudyMedia({ study: { blocks: [{ type: "compare", beforeSrc: "/assets/uploads/before.png", afterSrc: "/assets/uploads/after.png" }, { type: "split", leftImg: "left.png", rightImg: "right.png" }] } });
  assert.deepEqual(media.map(item => item.url), ["https://media.riteshk.work/before.png", "https://media.riteshk.work/after.png", "https://riteshk.work/left.png", "https://riteshk.work/right.png"]);
});

test("embedded links normalize supported providers and reject unsafe schemes", () => {
  assert.equal(embedDescriptor("https://youtu.be/dQw4w9WgXcQ").src,"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(embedDescriptor("https://vimeo.com/12345").src,"https://player.vimeo.com/video/12345");
  assert.equal(embedDescriptor("https://example.com/video.mp4").kind,"video");
  assert.equal(embedDescriptor("https://example.com/image.png").kind,"image");
  assert.equal(embedDescriptor("https://example.com/document.pdf").title,"PDF document");
  for (const value of ["javascript:alert(1)","data:text/html,test","file:///test","http://example.com","https://user:password@example.com","not a URL"]) assert.throws(()=>embedDescriptor(value));
});