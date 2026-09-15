import test from "node:test";
import assert from "node:assert/strict";
import { PROPERTY_LAYOUTS, layoutPlan, slideOwnsFocus, transitionMatch, isEmptyPlaceholder } from "./src/js/slide-merge-properties.mjs";
import { guidePosition, guideSnap } from "./src/js/slide-merge-guide-core.mjs";
import { COVER_FIELDS, COVER_DEFAULTS, coverPalette, coverSkeleton, coverValues, projectCoverData, linkedCoverValues, restorePresentationCover } from "./src/js/slide-merge-cover.mjs";
test("presentation restores linked cover originals without replacing authored geometry or saved data", async () => {
  const work = {id:"project", image:"original.png"};
  const cover = coverValues({title:"Keep this title", source:{caseStudyId:work.id}, crop:{x:100,y:0}, image:{fileId:"original",width:1600,height:900,source:"saved-original.png"}});
  const saved = {id:"first", scene:{elements:[...coverSkeleton(cover, 2), {id:"lab-slide",customData:{slideSettings:{cover}}}],files:{}}};
  const runtime = structuredClone(saved), sources = [];
  const file = {id:"original",width:1600,height:900,dataURL:"data:image/png;base64,b3JpZ2luYWw="};
  await restorePresentationCover(runtime, work, async source => {sources.push(source);return file;}, elements => elements);
  assert.deepEqual(sources, ["saved-original.png"]);
  assert.deepEqual(runtime.scene.elements, saved.scene.elements);
  assert.deepEqual(saved.scene.files, {});
  assert.equal(runtime.scene.files.original.dataURL, file.dataURL);
  await restorePresentationCover(runtime, work, () => assert.fail("Existing originals must not be fetched again"), elements => elements);
  await assert.rejects(restorePresentationCover(structuredClone(saved), work, async () => ({...file,id:"changed"}), elements => elements), /has changed/);
  await assert.rejects(restorePresentationCover(structuredClone(saved), work, async () => {throw new Error("Offline");}, elements => elements), /Offline/);
});
test("presentation fills an unloaded linked cover only inside its saved panel", async () => {
  const work = {id:"project",image:"original.png"};
  const cover = coverValues({title:"Unchanged",source:{caseStudyId:work.id},crop:{x:100,y:0}});
  const elements = [...coverSkeleton(cover, 2), {id:"lab-slide",customData:{slideSettings:{cover}}}];
  const panel = elements.find(element => element.customData?.slideCover === "media-panel");
  panel.y += 44; panel.height -= 44;
  const before = structuredClone(elements), slide = {id:"cover-slide",scene:{elements,files:{}}};
  await restorePresentationCover(slide, work, async () => ({id:"original",width:1600,height:900,dataURL:"original-bytes"}), items => items);
  const image = elements.find(element => element.customData?.slideCover === "image");
  assert.deepEqual(elements.filter(element => element !== image), before);
  assert.equal(image.x, panel.x + 48); assert.equal(image.y, panel.y + 48);
  assert.equal(image.width, panel.width - 48); assert.equal(image.height, panel.height - 48);
  assert.equal(image.crop.y, 0); assert.equal(image.fileId, "original");
  assert.equal(slide.scene.files.original.dataURL, "original-bytes");
});
test("presentation cover recovery respects visibility, overrides and source ownership", async () => {
  for (const variant of ["hidden", "layer", "deleted", "custom", "public", "other-project"]) {
    const cover = coverValues({source:{caseStudyId:"project"},image:{fileId:"original",width:1600,height:900}});
    if (variant === "hidden") cover.hidden = ["image"];
    if (variant === "custom") {cover.source.overrides = ["image"];delete cover.image;}
    if (variant === "public") delete cover.source;
    if (variant === "other-project") cover.source.caseStudyId = "other";
    const elements = [...coverSkeleton(cover, 2), {id:"lab-slide",customData:{slideSettings:{cover}}}];
    const image = elements.find(element => element.customData?.slideCover === "image");
    if (variant === "layer") image.customData.labLayerHidden = true;
    if (variant === "deleted") image.isDeleted = true;
    const slide = {id:"cover",scene:{elements,files:{}}}, before = structuredClone(slide);
    await restorePresentationCover(slide, {id:"project",image:"must-not-fetch.png"}, () => assert.fail(variant), items => items);
    assert.deepEqual(slide, before);
  }
});
test("linked cover sources use period, explicit status and scope without inferring or migrating dates", () => {
  const work = { id: "project", title: "Title", client: "Client", period: "2025 - Present", image: "original.png", brandLogo: "logo.png", study: { timeline: "2023 - 2024", team: "Design, Engineering", role: "Lead", scope: "Activation" } };
  const before = structuredClone(work), source = projectCoverData(work);
  assert.equal(source.status, "");
  assert.equal(source.duration, work.period);
  assert.equal(source.footnote, work.study.scope);
  assert.equal(source.image, work.image);
  assert.equal(source.logo, work.brandLogo);
  const cover = linkedCoverValues({ title: "Slide override", source: { caseStudyId: work.id, overrides: ["title"] }, background: "#123456" }, { ...source, status: "Launched" });
  assert.equal(cover.title, "Slide override");
  assert.equal(cover.status, "Launched");
  assert.equal(cover.background, "#123456");
  assert.deepEqual(work, before);
});
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
  assert.deepEqual(logo.customData.labCorners, { mode: "squircle", radius: logo.height / 4 });
  assert.ok(logo.width <= 54 && logo.height <= 54);
  assert.equal(withLogo.some(element => element.customData.slideCover === "mark"), false);
});
  test("cover insets, cropped squircle and flowing pills preserve readable source text", () => {
    const team = "1 Lead designer, 2 junior designers to work on high fidelity mocks, 1 Product Manager, 1 Engineer, 1 System Architect";
    const elements = coverSkeleton({ title: "Title", client: "Client", status: "Launched", team, role: "Lead", footnote: "Scope", image: { fileId: "original", width: 1600, height: 900 } }, 123);
    const role = key => elements.find(element => element.customData.slideCover === key);
    assert.equal(role("status-box").y, 48);
    assert.equal(role("title").x - role("rail").width, 48);
    assert.equal(1280 - role("title").x - role("title").width, 48);
    assert.equal(720 - role("footnote").y - role("footnote").height, 48);
    assert.equal(role("footnote").x, role("title").x);
    assert.equal(role("role").x, role("title").x);
    assert.equal(role("image").x - role("media-panel").x, 48);
    assert.equal(role("image").y - role("media-panel").y, 48);
    assert.equal(role("image").x + role("image").width, 1280);
    assert.equal(role("image").y + role("image").height, 720);
    assert.deepEqual(role("media-panel").customData.labCorners, { mode: "squircle", radius: 32, topRightCornerRadius: 0, bottomRightCornerRadius: 0, bottomLeftCornerRadius: 0 });
    assert.equal(role("media-panel").x + role("media-panel").width, 1280);
    assert.equal(role("media-panel").y + role("media-panel").height, 720);
    const chips = elements.filter(element => /^team-\d+$/.test(element.customData.slideCover));
    assert.equal(chips.map(element => element.text).join(" "), team.replaceAll(",", ""));
    assert.ok(chips.length > team.split(",").length, "Long entries continue in another chip");
    for (const chip of chips) {
      const box = role(chip.customData.slideCover.replace("team-", "team-box-"));
      assert.equal(chip.fontSize, 14);
      assert.equal(chip.text.includes("\n"), false);
      assert.equal(box.customData.labCorners.radius, box.height / 2);
      assert.ok(box.x >= 174 && box.x + box.width <= 481);
      if (box.x === 174) assert.equal(chip.x, role("role").x);
      assert.ok(box.y + box.height + 32 <= role("role-heading").y);
    }
    assert.ok(role("role").y + role("role").height + 24 <= role("footnote").y);
  });
test("cover status hugs measured text at the duration size and wraps badges without colliding with title", () => {
  for (const status of ["Worldwide experimentation - Canary state", "W".repeat(40)]) {
    const measure = (text, size) => text.length * size * .8;
    const elements = coverSkeleton({status, duration:"2025 - Current", role:"Lead"},123,"cover",measure);
    const role = key => elements.find(element => element.customData.slideCover === key);
    assert.equal(role("status").fontSize, role("duration").fontSize);
    assert.equal(role("status-box").width, Math.ceil(measure(status,18))+24);
    assert.ok(role("duration-box").x+role("duration-box").width <= 1232);
    assert.ok(role("title").y > role("duration-box").y+36);
  }
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
test("linked cover visibility, crop and depth preserve originals and strip source metadata from rendered objects", () => {
  const cover = { title: "Original", team: "Design, Engineering", role: "Lead", duration: "2025", source: { caseStudyId: "owner", overrides: [] }, hidden: ["team", "role", "duration"], image: { fileId: "original", width: 1600, height: 900 }, crop: { x: 100, y: 0 }, depth: { fileId: "depth", source: "private-source", strength: .04, focus: .4, softness: .01, zoom: 1.1 } };
  const before = structuredClone(cover), elements = coverSkeleton(cover, 123);
  const image = elements.find(element => element.type === "image");
  assert.equal(elements.some(element => /^(team-|role|duration)/.test(element.customData.slideCover)), false);
  assert.ok(Math.abs(image.crop.x - (1600 - image.crop.width)) < 1e-9);
  assert.equal(image.crop.y, 0);
  assert.deepEqual(image.customData.slideDepth, { fileId: "depth", strength: .04, softness: .01, focus: .4, zoom: 1.1 });
  assert.equal(coverSkeleton({ ...cover, motion: false }, 123).some(element => element.customData.slideDepth), false);
  assert.equal(coverSkeleton({ ...cover, source: { ...cover.source, overrides: ["image"] } }, 123).some(element => element.customData.slideDepth), false);
  assert.deepEqual(cover, before);
});