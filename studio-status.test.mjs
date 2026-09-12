import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import postcss from "postcss";
import { selectStudioDraft, studioDraftContent } from "./src/js/studio-draft-recovery.mjs";
import { completeStudioBackup } from "./src/js/studio-content-backup.mjs";
import { AI_SESSION_KEY, createAiSession } from "./src/js/ai-session.mjs";
import { availableStudies } from "./src/js/slide-merge-sections.mjs";

const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
const styles = postcss.parse(readFileSync(new URL("./css/admin.css", import.meta.url), "utf8"));
function declarations(selector) {
  const result = {};
  styles.walkRules(rule => {
    if (rule.selector === selector) rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
}

test("Edit lands on the furthest populated project stage, not an empty slideshow reference", () => {
  const start = source.indexOf("function studyHasSlides(w)"), end = source.indexOf("var L2_TABS", start);
  const { studyHasSlides, studyLandingTab } = runInNewContext(`(() => { ${source.slice(start, end)} return { studyHasSlides, studyLandingTab }; })()`);
  assert.equal(studyLandingTab({}), "details");
  assert.equal(studyLandingTab({ title: "Project", desc: "Configured details" }), "details");
  for (const study of [{ tagline: "An outcome" }, { skim: { hook: "Overview" } }, { skim: { points: [{ value: "10", label: "Tests" }] } }, { skim: { beats: [{}] } }, { skim: { media: [{}] } }]) assert.equal(studyLandingTab({ study }), "highlights");
  const study = { skim: { hook: "Overview" }, blocks: [{ type: "text" }], nativeDeck: { slideCount: 0 } };
  assert.equal(studyLandingTab({ study }), "story");
  assert.equal(studyHasSlides({ study }), false);
  assert.equal(studyLandingTab({ study: { ...study, nativeDeck: { slideCount: 16 } } }), "slides");
  assert.equal(studyLandingTab({ study: { slides: [{ title: "Legacy" }] } }), "slides");
  assert.equal(studyLandingTab({ study: { slidesEnc: { ct: "sealed" } } }), "slides");
  assert.equal(studyHasSlides({ study: { nativeDeck: { slideCount: 0 }, slidesEnc: { ct: "stale" } } }), false);
  assert.equal(studyHasSlides({ study: { slides: [], slidesEnc: { ct: "stale" } } }), false);
});

test("project card actions expose only populated visitor previews and keep Edit as the authoring entry", () => {
  const start = source.indexOf("function studyHasSlides(w)"), end = source.indexOf("var L2_TABS", start);
  const cardStart = source.indexOf("function studyToggle(w, i)"), cardEnd = source.indexOf("function setStudyUnlock", cardStart);
  const { studyToggle, studyVisitorUrl } = runInNewContext(`(() => { ${source.slice(start, end)} ${source.slice(cardStart, cardEnd)} return { studyToggle, studyVisitorUrl }; })()`, {
    URLSearchParams, openStudy: -1, IC: { edit: "", ext: "", board: "" }, escHtml: value => value.replace(/&/g, "&amp;")
  });
  const empty = studyToggle({ id: "case", study: { nativeDeck: { slideCount: 0 }, blocks: [] } }, 0);
  assert.match(empty, /data-act="study-toggle"[^>]*> Edit<\/button>/);
  assert.doesNotMatch(empty, /study-preview|study-slideshow-preview/);
  const full = studyToggle({ id: "case with space", study: { blocks: [{ type: "text" }], nativeDeck: { slideCount: 1 } } }, 0);
  assert.match(full, /data-act="study-preview"/);
  assert.match(full, /data-act="study-slideshow-preview"/);
  assert.ok(full.indexOf("study__previewbtn") < full.indexOf("study__slidesbtn"));
  const url = new URL(studyVisitorUrl({ id: "case with space" }, true), "https://site.test");
  assert.equal(url.searchParams.get("work"), "case with space");
  assert.equal(url.searchParams.get("draft"), "1");
  assert.equal(url.searchParams.get("slideshow"), "1");
  assert.doesNotMatch(url.href, /token|session|key/);
});

test("draft recovery keeps older work available without replacing newer published content", () => {
  const published = { work: [{ id: "case", title: "New published version" }] };
  const draft = { work: [{ id: "case", title: "Unfinished local work", study: { nativeDeck: { id: "original-deck" } } }] };
  for (const signature of ["older-version", ""]) {
    const selection = selectStudioDraft(published, draft, "published-version", signature);
    assert.deepEqual(selection.data, published);
    assert.deepEqual(selection.recovery, draft);
    selection.recovery.work[0].title = "Reviewed copy";
    assert.equal(draft.work[0].title, "Unfinished local work");
  }
  assert.deepEqual(selectStudioDraft(published, draft, "same", "same"), { data: draft, recovery: null });
  assert.deepEqual(selectStudioDraft(published, null, "same", ""), { data: published, recovery: null });
});

test("Studio navigation reserves action space and keeps narrow tabs on a separate row", () => {
  const desktopTabs = styles.nodes.find(node => node.type === "rule" && node.selector === ".adm__tabswrap");
  assert.equal(desktopTabs.nodes.find(node => node.prop === "flex").value, "1 1 0");
  assert.equal(declarations(".adm__actions").flex, "0 0 auto");
  assert.equal(declarations(".adm__tabs")["overflow-x"], "auto");
  const narrow = styles.nodes.find(node => node.type === "atrule" && node.params === "(max-width: 1023px)");
  const narrowTabs = narrow.nodes.find(node => node.selector === ".adm__tabswrap");
  assert.equal(narrowTabs.nodes.find(node => node.prop === "flex").value, "1 1 100%");
  assert.equal(narrowTabs.nodes.find(node => node.prop === "order").value, "3");
});

test("shared Studio shell separates working controls from bottom document status", () => {
  const shell = source.slice(source.indexOf("function buildShell()"));
  const workbar = shell.slice(shell.indexOf('<div class="adm__workbar">'), shell.indexOf('<div class="adm__main">'));
  const footer = shell.slice(shell.indexOf('<footer class="adm__statusbar"'), shell.indexOf("'</footer>'"));
  for (const marker of ["data-l2-back", "data-hist", "data-l2tabs", "data-native-slide-toolbar", "data-prevtoggle", "data-dev-wrap", "data-newtab"]) assert.ok(workbar.includes(marker));
  assert.ok(workbar.indexOf('data-l2-back') < workbar.indexOf('data-hist'));
  assert.equal((shell.match(/data-l2-back aria-label=/g) || []).length, 0);
  for (const marker of ["adm__status\"", "data-draftmeter", 'data-act="logs-rec"']) {
    assert.ok(footer.includes(marker));
    assert.ok(!workbar.includes(marker));
  }
  assert.ok(shell.indexOf('<footer class="adm__statusbar"') > shell.indexOf('data-casestage'));
  assert.match(source, /function pubBar\(\) \{ return root && root.querySelector\("\.adm__statusbar"\)/);
  assert.match(source, /s\.title = msg/);
  assert.match(source, /s\.title = s\.textContent/);
  assert.match(source, /s\.title = label/);
});

test("draft storage is a plain status item in normal and warning states", () => {
  const meter = declarations(".adm__dmeter");
  assert.equal(meter.border, "0");
  assert.equal(meter["border-radius"], "0");
  assert.equal(meter.background, "transparent");
  for (const level of ["mid", "hi"]) {
    const warning = declarations(`.adm__dmeter[data-lvl="${level}"]`);
    assert.ok(warning.color);
    assert.equal(warning.background, undefined);
    assert.equal(warning["border-color"], undefined);
  }
});

test("Studio footer is compact and preview controls align right without absolute centering", () => {
  assert.equal(declarations(".adm__statusbar").height, "32px");
  assert.equal(declarations(".adm__statusbar :is(.adm__logs-btn,.adm__dmeter)").height, "24px");
  assert.equal(declarations(".adm__statusbar .adm__status").flex, "1");
  assert.equal(declarations(".adm__statusbar .adm__status").display, "block");
  assert.doesNotMatch(readFileSync(new URL("./css/admin.css", import.meta.url), "utf8"), /\.adm\.is-(?:prevoff|noprev) \.adm__logs-btn/);
  assert.equal(declarations(".adm__statusbar .adm__status")["max-width"], "none");
  assert.equal(declarations(".adm__prevgroup")["margin-left"], "auto");
  assert.equal(declarations(".adm__prevgroup").position, undefined);
  assert.equal(declarations(".adm__prevgroup").transform, undefined);
});

test("saving a different slide selection does not create unpublished content", () => {
  const published = { work: [{ study: { nativeDeck: { id: "deck", revision: 1, documentHash: "same-content" } } }] };
  const selection = structuredClone(published); selection.work[0].study.nativeDeck.revision = 2;
  assert.deepEqual(studioDraftContent(selection), studioDraftContent(published));
  selection.work[0].study.nativeDeck.documentHash = "changed-notes";
  assert.notDeepEqual(studioDraftContent(selection), studioDraftContent(published));
  assert.equal(published.work[0].study.nativeDeck.revision, 1);
});

test("shared backup retains original hosted media and owner content without altering the draft", async () => {
  const image = new Blob([new Uint8Array([0, 12, 255, 64])], { type: "image/png" });
  const draft = { work: [{ id: "case", image: "https://media.riteshk.work/original.png", study: { blocks: [{ type: "gallery", items: [{ src: "https://media.riteshk.work/original.png" }] }], authorSectionsEnc: { ct: "owner-content" } } }] };
  const before = structuredClone(draft), reads = [];
  const backup = await completeStudioBackup(draft, {
    decryptOwner: async () => ({ version: 1, caseStudyId: "case", blocks: [{ type: "gallery", off: true, items: [{ src: "https://media.riteshk.work/original.png" }] }, { type: "embed", src: "https://www.youtube-nocookie.com/embed/example" }] }),
    readAsset: async reference => { reads.push(reference); return image; }
  });
  assert.equal(backup.work[0].image, "data:image/png;base64,AAz/QA==");
  assert.equal(backup.work[0].study.blocks[0].items[0].src, backup.work[0].image);
  assert.equal(backup.work[0].study.blocks[0].off, true);
  assert.equal(backup.work[0].study.blocks[1].src, "https://www.youtube-nocookie.com/embed/example");
  assert.equal(reads.length, 1);
  assert.deepEqual(draft, before);
  await assert.rejects(completeStudioBackup({ work: [{ image: "https://media.riteshk.work/missing.png" }] }, { readAsset: async () => { throw new Error("Media missing"); } }), /Media missing/);
});

test("project tabs remain in the shared workbar on the Slideshow surface", () => {
  const tabs = source.slice(source.indexOf("var L2_TABS"), source.indexOf("function l2BarScroll"));
  assert.match(tabs, /\["gen", "AI Options"\]/);
  assert.match(tabs, /\["story", "Case study"\]/);
  assert.match(tabs, /\["slides", "Slideshow"\]/);
  assert.match(tabs, /tb\.innerHTML = show \? l2TabsHtml\(\) : ""; tb\.hidden = !show/);
  assert.match(source.slice(source.indexOf("function revert()"), source.indexOf("function pickImage")), /aiSession\.end\(\)/);
  const styles = readFileSync(new URL("./css/slide-studio.css", import.meta.url), "utf8");
  assert.doesNotMatch(styles, /workbar > :not\(\[data-native-slide-toolbar\]\)/);
  assert.match(source, /openPreview: \(\) => openStudyPresentation\(data\.work\.indexOf\(work\)\)/);
});

test("session AI usage survives refresh, deduplicates calls and never persists streamed content", () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let sequence = 0;
  const session = createAiSession({ storage, randomId: () => "id-" + ++sequence });
  const first = session.begin("creative"), second = session.begin("vision");
  session.route(first.id, { id: "call-1", provider: "provider", modelId: "discovered-model", agentRole: "draft", status: "running" });
  session.output(first.id, "call-1", "PRIVATE STREAMED CONTENT");
  assert.equal(session.state().phase, "answering");
  session.recordUsage(100, 250, { sessionId: first.sessionId, jobId: first.id, callId: "call-1" });
  session.recordUsage(100, 250, { sessionId: first.sessionId, jobId: first.id, callId: "call-1" });
  session.recordUsage(40, 60, { sessionId: second.sessionId, jobId: second.id, callId: "call-2" });
  session.recordUsage(999, 999, { estimated: true });
  assert.equal(session.state().totalTokens, 450);
  assert.equal(session.state().jobs[0].outputTokens, 250);
  assert.doesNotMatch(values.get(AI_SESSION_KEY), /PRIVATE|discovered-model|provider/);
  const refreshed = createAiSession({ storage });
  assert.equal(refreshed.state().totalTokens, 450);
  assert.deepEqual(refreshed.state().jobs, []);
  session.finish(first.id, "complete");
  assert.equal(session.state().phase, "working");
  session.end();
  assert.equal(second.signal.aborted, true);
  assert.equal(session.state().totalTokens, 0);
  assert.equal(storage.getItem(AI_SESSION_KEY), undefined);
  session.recordUsage(500, 500, { sessionId: first.sessionId, jobId: first.id, callId: "late" });
  session.output(first.id, "call-1", "LATE CONTENT");
  assert.equal(session.state().totalTokens, 0);
  assert.deepEqual(session.state().jobs, []);
});

test("cancelling a session job immediately ends activity and rejects late answer chunks", () => {
  const session = createAiSession(), job = session.begin("writing");
  session.output(job.id, "request", "Partial answer");
  session.cancel(job.id);
  assert.equal(job.signal.aborted, true);
  assert.equal(session.state().active, 0);
  assert.equal(session.state().phase, "idle");
  session.route(job.id, { id: "request", status: "running" });
  session.output(job.id, "request", "SHOULD NOT APPEAR");
  session.finish(job.id, "complete");
  assert.equal(session.state().jobs[0].status, "cancelled");
  assert.equal(session.state().jobs[0].outputs[0].text, "Partial answer");
});

test("embedding usage keeps historical estimates separate from the actual session counter", async () => {
  for (const reported of [false, true]) {
    const session = createAiSession(), historical = [];
    const start = source.indexOf("async function atsEmbed(texts)"), end = source.indexOf("async function atsSemNeural", start);
    const embed = runInNewContext(`(${source.slice(start, end).trim()})`, {
      aiSession: session, aiSess: () => "synthetic", aiMode: () => "cf", ADMIN_WORKER: "https://synthetic.test", aiProxy: () => ({}), aiGet: () => "openai", aiScope: () => "txt",
      fetch: async () => Response.json({ embeddings: [[1]], ...(reported ? { usage: { input: 7, output: 0 } } : {}) }),
      aiUsageFromJson: (provider, response) => response.usage ? { in: response.usage.input, out: response.usage.output } : null,
      aiUsageRecord: (provider, model, input, output, context) => { historical.push({ input, output, estimated: !!context.estimated }); session.recordUsage(input, output, context); }
    });
    assert.equal((await embed(["Synthetic evidence"])).embeddings.length, 1);
    assert.equal(session.state().totalTokens, reported ? 7 : 0);
    assert.equal(session.state().jobs[0].status, "complete");
    assert.equal(historical.length, 1);
    assert.equal(historical[0].estimated, !reported);
  }
});

test("a sealed legacy visitor preview must unlock before the renderer can generate fallback sections", async () => {
  const project = readFileSync(new URL("./src/js/project.js", import.meta.url), "utf8");
  const start = project.indexOf("function presentDeck(w, opts)"), end = project.indexOf("if (window.RK)", start);
  const work = { id: "private-case", study: { slidesEnc: { ct: "sealed" }, blocks: [{}] } };
  let unlocked = false, calls = 0;
  const present = runInNewContext(`(${project.slice(start, end).trim()})`, {
    hasNativeDeck: () => false, window: { RK: { requestOwnerPresentation: async () => unlocked } },
    workById: () => ({ id: work.id, study: { slides: [{ title: "Unlocked deck" }] } }),
    presentDeckWithRenderer: owner => { calls++; return owner.study.slides.length; }, presentationFailure: error => { throw error; },
    renderPjSlide: null, pjDeckSlides: null, pjSlideTitle: null, pjNotesHtml: null, fitSections: null, enhanceStudyBlocks: null
  });
  assert.equal(await present(work, { draft: true, audienceOnly: true }), null);
  assert.equal(calls, 0);
  unlocked = true;
  assert.equal(await present(work, { draft: true, audienceOnly: true }), 1);
  assert.equal(calls, 1);
});

test("case-study privacy lives in the shared footer and preserves saved visibility", () => {
  const start = source.indexOf("function caseVisibilityHtml(work, index)"), end = source.indexOf("function paintCaseVisibility()", start);
  const render = runInNewContext(`(${source.slice(start, end)})`, { IC:{lock:"CLOSED_LOCK", unlock:"OPEN_LOCK"} });
  assert.match(render({}, 0), /Case study visibility: public draft/);
  assert.match(render({}, 0), /OPEN_LOCK/);
  assert.doesNotMatch(render({}, 0), / checked/);
  assert.match(render({hidden:true}, 1), /CLOSED_LOCK/);
  assert.match(render({hidden:true}, 1), /data-index="1" checked/);
  assert.match(render({featured:true}, 0), / disabled/);
  assert.match(render({hidden:true, featured:true}, 0), /OPEN_LOCK/);
  const cards = source.slice(source.indexOf("const eyeTitle = featd"), source.indexOf("aboutpage()", source.indexOf("const eyeTitle = featd")));
  assert.doesNotMatch(cards, /work-hidden|Make private: shown only via a ticket/);
  const shell = source.slice(source.indexOf("function buildShell()"));
  assert.ok(shell.indexOf('data-case-visibility') > shell.indexOf('<footer class="adm__statusbar"'));
  assert.ok(shell.indexOf('data-case-visibility') < shell.indexOf('data-act="logs-rec"'));
});

test("AI Options gate slide generation and preparation on available case-study sections", () => {
  const start = source.indexOf("function caseAiReady(work)"), end = source.indexOf("async function caseAiSlides", start);
  const { caseAiReady, caseAiOptions } = runInNewContext(`(() => { ${source.slice(start, end)} return {caseAiReady, caseAiOptions}; })()`, {availableStudies, csgenPanel:() => "CASE_GENERATOR", IC:{spark:""}});
  for (const work of [{}, {study:{}}, {study:{blocks:[]}}, {study:{blocks:[{type:"text",off:true}]}}, {study:{blocks:[{type:"text",locked:true}]}}, {study:{blocks:[{encStub:true}]}}]) {
    assert.equal(caseAiReady(work), false);
    assert.equal((caseAiOptions(work, 0).match(/ disabled/g) || []).length, 4);
  }
  const work = {study:{blocks:[{type:"text",body:"Case-study source"}]}};
  assert.equal(caseAiReady(work), true);
  const panel = caseAiOptions(work, 2);
  assert.doesNotMatch(panel, / disabled/);
  for (const label of ["CASE_GENERATOR", "Generate slides", "Review feedback", "Interview prep", "Design storyteller"]) assert.ok(panel.includes(label));
});