import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import postcss from "postcss";
import { selectStudioDraft, studioDraftContent } from "./src/js/studio-draft-recovery.mjs";
import { completeStudioBackup } from "./src/js/studio-content-backup.mjs";
import { AI_SESSION_KEY, createAiSession } from "./src/js/ai-session.mjs";
import { availableStudies } from "./src/js/slide-merge-sections.mjs";
import { prepareBrief, prepareBriefWorks } from "./src/js/prepare-brief.mjs";
import { contentRevision, publicationConflict, gitContentRevision } from "./src/js/content-revision.mjs";
import { createRefreshGate } from "./src/js/studio-refresh.mjs";
import { agentRequestOptions } from "./src/js/ai-task-agent.mjs";
import { normalizeAiModel, rankAiModels } from "./src/js/ai-model-router.mjs";

const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
const styles = postcss.parse(readFileSync(new URL("./css/admin.css", import.meta.url), "utf8"));
function interviewHelpers(data = {}) {
  const start = source.indexOf('function iprepStrip('), end = source.indexOf('async function iprepResolveJd', start);
  const briefStart = source.indexOf('function prepBriefEvidence('), briefEnd = source.indexOf('var _prepSaveT', briefStart);
  return runInNewContext(`(() => { ${source.slice(start,end)} ${source.slice(briefStart,briefEnd)} return {iprepContext,iprepAiContext,prepBriefEvidence,iprepCheckInput,iprepReadQuestions,iprepSystem,iprepAnsSystem}; })()`, {data,prepareBriefWorks});
}

function storytellerHelpers() {
  const start = source.indexOf('function iprepStrip('), end = source.indexOf('async function iprepResolveJd',start);
  const storyStart = source.indexOf('  var STORY_DUR ='), storyEnd = source.indexOf('  function storyRenderThemes(',storyStart);
  const questionStart = source.indexOf('  var STORY_ROLES ='), questionEnd = source.indexOf('  function storyRenderQuestions(',questionStart);
  return runInNewContext(`(() => { ${source.slice(start,end)} ${source.slice(storyStart,storyEnd)} ${source.slice(questionStart,questionEnd)} return {storyContext,storyThemesSystem,storyTellSystem,storyQSystem,storyQAnsSystem}; })()`,{data:{},localStorage:{getItem:()=>null}});
}

test('Storyteller complete sources preserve late evidence and reject protected visuals and oversized inputs', () => {
  const {storyContext} = storytellerHelpers();
  const work = {title:'Fixture',study:{blocks:[{type:'text',body:'Earlier detail. '.repeat(850)},{type:'rows',items:[{cells:[{body:'Seven steps became four; customer results are pending.'}]}]},{type:'media',locked:true,caption:'SECRET_VISUAL'},{type:'gallery',items:[{locked:true,caption:'SECRET_ITEM'},{caption:'Permitted visual'}]}]}};
  const before = JSON.stringify(work), text = storyContext(work);
  assert.match(text,/Seven steps became four; customer results are pending/);
  assert.match(text,/Permitted visual/); assert.doesNotMatch(text,/SECRET/);
  assert.throws(()=>storyContext({...work,locked:true}),/No available/);
  assert.throws(()=>storyContext(work,'x'.repeat(120000)),/nothing was truncated or sent/);
  assert.equal(JSON.stringify(work),before);
});

test('Storyteller separates four target levels and audience without upgrading source claims', () => {
  const helpers = storytellerHelpers();
  assert.match(helpers.storyThemesSystem('staff','5 min'),/Maturity applies even to a one-word beat/);
  assert.match(helpers.storyThemesSystem('staff','5 min'),/descriptive topics already present in the source/);
  assert.match(helpers.storyThemesSystem('staff','5 min'),/contributing factor into a root cause/);
  assert.doesNotMatch(helpers.storyThemesSystem('staff','5 min'),/high-impact STORY|metric that redirected the roadmap/);
  for (const [level,guide] of Object.entries({senior:'concrete design judgment',staff:'system boundaries',leader:'Head/Director',vp:'investment judgment'})) {
    for (const audience of ['portfolio','design','partners']) {
      for (const prompt of [helpers.storyThemesSystem(level,'5 min',audience),helpers.storyTellSystem(level,'5 min',5,audience),helpers.storyQSystem(level,'any',10,audience),helpers.storyQAnsSystem(level,'Engineering',audience)]) {
        assert.ok(prompt.includes(guide)); assert.match(prompt,/Listening audience:/);
        assert.match(prompt,/Status precedence/); assert.match(prompt,/Evidence strength must not increase/);
        assert.match(prompt,/explicit candidate contribution/); assert.match(prompt,/Target seniority and listening audience are separate/);
        assert.doesNotMatch(prompt,/seven-to-four|25M|Delight First|Setup First/);
      }
    }
  }
});

test('Whiteboard scoring preserves constraint scope and exact candidate evidence IDs', () => {
  const start = source.indexOf('  function wbScoreSystem()'), end = source.indexOf('  function wbScoreUser(',start);
  const prompt = runInNewContext(source.slice(start,end)+';wbScoreSystem()');
  assert.match(prompt,/additional resources does not mean existing resources are absent/);
  assert.match(prompt,/only credit an acknowledgement actually present/);
  assert.match(prompt,/Copy evidence IDs exactly from the id field/);
  assert.match(prompt,/An untested skill is not a weakness/);
});

test("Interview request budgets reserve reasoning separately and scale with the question count", () => {
  const questionOptions = source.match(/iprepQUser\(ctx, jd, n\), (\{[^\n]+\})\)/)[1];
  const answerOptions = source.match(/iprepAnsUser\(q\.q, sourceSnapshot\.text, sourceSnapshot\.jd\), (\{[^\n]+\})\)/)[1];
  const model = normalizeAiModel('test',{id:'reasoning-fixture',input_modalities:['text'],output_modalities:['text'],reasoning:true,max_tokens:16000,max_input_tokens:100000,pricing:{input:2,output:10}});
  const signal = new AbortController().signal;
  const budgets = [];
  for (const count of [6,10,14]) {
    const options = runInNewContext('('+questionOptions+')',{n:count,signal});
    assert.equal(options.signal,signal);
    assert.equal(options.json,true);
    assert.ok(options.maxTokens >= count * 320);
    assert.equal(options.reasoningTokens,4096);
    budgets.push(options.maxTokens);
    const request = agentRequestOptions('System','Complete source and job description',options);
    const choice = rankAiModels([model],'analysis',request)[0];
    assert.equal(choice.outputTokens,options.maxTokens+4096);
    assert.equal(rankAiModels([{...model,reasoning:false}],'analysis',request)[0].outputTokens,options.maxTokens);
    assert.equal(rankAiModels([model],'analysis',{...request,maxCost:choice.estimatedCost-0.000001}).length,0);
  }
  assert.ok(budgets[2]>budgets[0]);
  const answer = runInNewContext('('+answerOptions+')',{signal});
  assert.equal(answer.maxTokens,900);
  assert.equal(answer.reasoningTokens,4096);
  assert.equal(answer.signal,signal);
});

test("Interview complete sources retain late caveats and nested cells without changing legacy extraction", () => {
  const work = {id:'fictional',title:'Onboarding',study:{role:'Led the design',blocks:[
    {type:'text',body:'Earlier decisions. '.repeat(700)},
    {type:'rows',items:[{cells:[{heading:'Design change',body:'Reduced seven steps to four.'}]}]},
    {type:'text',body:'Customer results are still pending.'}
  ]}};
  const before = JSON.stringify(work);
  const {iprepContext,iprepAiContext} = interviewHelpers({work:[work]});
  for (const text of [iprepContext(work,'study',true),iprepAiContext([work],false,true)]) {
    assert.ok(text.length > 9000);
    assert.match(text,/Reduced seven steps to four\./);
    assert.match(text,/Customer results are still pending\./);
    assert.match(text,/My role: Led the design/);
  }
  assert.equal(iprepContext(work,'study').length,9001);
  assert.equal(iprepAiContext([work],false).length,9001);
  assert.equal(JSON.stringify(work),before);
});

test("Interview complete brief sources retain permitted late evidence without broadening permissions", () => {
  const work = {id:'fictional',title:'Onboarding',study:{blocks:[
    {type:'text',body:'Earlier decisions. '.repeat(700)},
    {type:'text',body:'LATE_PERMITTED_CAVEAT'},
    {type:'text',locked:true,body:'LOCKED_EVIDENCE'}
  ]}};
  const privateWork = {id:'private',hidden:true,study:{blocks:[{type:'text',body:'PRIVATE_EVIDENCE'}]}};
  const data = {work:[work,privateWork]}, before = JSON.stringify(data);
  const {prepBriefEvidence} = interviewHelpers(data);
  const brief = prepareBrief({projectMode:'all',includePrivate:false});
  const complete = prepBriefEvidence(brief,null,true);
  assert.match(complete.text,/LATE_PERMITTED_CAVEAT/);
  assert.doesNotMatch(complete.text,/LOCKED_EVIDENCE|PRIVATE_EVIDENCE|Source excerpt/);
  assert.deepEqual(Array.from(complete.works,entry=>entry.id),['fictional']);
  assert.doesNotMatch(prepBriefEvidence(brief).text,/LATE_PERMITTED_CAVEAT/);
  assert.equal(JSON.stringify(data),before);
});

test("Interview complete sources exclude unavailable sections, items and cells on direct paths", () => {
  const work = {id:'fictional',study:{blocks:[
    {type:'text',body:'Visible evidence'},
    ...['locked','off','encStub','vaultBlock'].map(flag=>({type:'text',[flag]:true,body:'EXCLUDED_'+flag})),
    {type:'rows',items:[{locked:true,body:'EXCLUDED_ITEM'},{cells:[{body:'Included cell'},{locked:true,body:'EXCLUDED_CELL'}]}]}
  ]}};
  const {iprepContext,iprepAiContext} = interviewHelpers();
  for (const text of [iprepContext(work,'study',true),iprepAiContext([work],false,true)]) {
    assert.match(text,/Visible evidence/);
    assert.match(text,/Included cell/);
    assert.doesNotMatch(text,/EXCLUDED/);
  }
  assert.match(iprepContext(work,'study'),/EXCLUDED_locked/);
  assert.equal(iprepAiContext([{...work,encWork:true}],false,true),'');
});

test("Interview quality input limits fail explicitly and prompts preserve attribution and maturity at each level", () => {
  const {iprepCheckInput,iprepSystem,iprepAnsSystem} = interviewHelpers();
  assert.doesNotThrow(()=>iprepCheckInput('source'.repeat(19000),'job description'));
  assert.throws(()=>iprepCheckInput('source'.repeat(20000),'extra'),/nothing was truncated or sent/);
  assert.throws(()=>iprepCheckInput('  '),/No available case-study text/);
  const guides = {senior:'concrete design judgment',staff:'system boundaries',leader:'Head/Director',vp:'investment judgment'};
  for (const [level,guide] of Object.entries(guides)) {
    for (const prompt of [iprepSystem(level),iprepAnsSystem(level)]) {
      assert.ok(prompt.includes(guide));
      assert.doesNotMatch(prompt,/seven-to-four|25M|Delight First/);
      for (const rule of ['untrusted data','late caveats','explicit candidate contribution','results remain pending','Target seniority and listening audience are separate']) assert.ok(prompt.includes(rule),rule);
    }
    assert.match(iprepSystem(level),/how would you/);
    assert.match(iprepSystem(level),/questions and why/);
    assert.match(iprepAnsSystem(level),/first sentence/);
    assert.match(iprepAnsSystem(level),/No bracketed placeholders/);
    assert.doesNotMatch(iprepAnsSystem(level),/\[add the metric\]/);
  }
});

test("Interview revision distinguishes maturity and conditional premises without case-specific fixes", () => {
  const {iprepSystem,iprepAnsSystem} = interviewHelpers();
  for (const level of ['senior','staff','leader','vp']) {
    for (const prompt of [iprepSystem(level),iprepAnsSystem(level)]) {
      assert.match(prompt,/Status precedence: explicit development/);
      assert.match(prompt,/Headings such as Impact, Shipping Experience or Production UX are not evidence of release/);
      assert.match(prompt,/alignment on a broad initiative does not establish endorsement of a particular variant/);
      assert.match(prompt,/two alternatives do not establish a control arm/);
      assert.match(prompt,/Collaboration does not imply resistance/);
      assert.match(prompt,/ENTIRE situation conditional/);
      assert.match(prompt,/Evidence strength must not increase in paraphrase/);
      assert.match(prompt,/Preserve a metric definition exactly or omit its definition/);
      assert.match(prompt,/NOT "I shipped the concept"/);
      assert.match(prompt,/NOT "Research showed clearer choices were effective"/);
      assert.doesNotMatch(prompt,/seven-to-four|25M|Delight First|Setup First|Edge|BSoM/);
    }
    assert.match(iprepSystem(level),/every past-tense clause in q and why/);
    assert.match(iprepSystem(level),/false either\/or/);
    assert.match(iprepAnsSystem(level),/Correct mistaken assumptions conversationally/);
    assert.match(iprepAnsSystem(level),/Remove unsupported additions even when the same paragraph contains a caveat/);
    assert.match(iprepAnsSystem(level),/A claimed research finding needs an explicit finding/);
  }
});

test("Interview quality rejects incomplete, empty and duplicate questions without repairing model output", () => {
  const {iprepReadQuestions} = interviewHelpers();
  for (const count of [6,10,14]) {
    const questions = Array.from({length:count},(_,index)=>({q:'Decision '+index+'?',category:'Decisions',why:'Reasoning'}));
    assert.equal(iprepReadQuestions({questions},count).length,count);
    assert.throws(()=>iprepReadQuestions({questions:questions.slice(1)},count),/instead of/);
    assert.throws(()=>iprepReadQuestions({questions:questions.map((item,index)=>index ? item : {q:'  '})},count),/empty or duplicate/);
    questions[1].q = '  DECISION   0! ';
    assert.throws(()=>iprepReadQuestions({questions},count),/duplicate/);
  }
  assert.throws(()=>iprepReadQuestions(null,6),/No new set was saved/);
  assert.equal(iprepReadQuestions(['A valid legacy-shaped question?'],1)[0].q,'A valid legacy-shaped question?');
});

function declarations(selector) {
  const result = {};
  styles.walkRules(rule => {
    if (rule.selector === selector) rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
}

test("Studio refresh coalesces automatic reads, expires freshness and retries failures", async () => {
  let clock = 0, calls = 0, fail = false;
  const refresh = createRefreshGate(async () => { calls++; if (fail) throw new Error("Offline"); return true; }, { now: () => clock });
  await Promise.all([refresh("owner"), refresh("owner"), refresh("owner")]);
  assert.equal(calls, 1);
  clock = 59999; await refresh("owner"); assert.equal(calls, 1);
  clock = 60000; await refresh("owner"); assert.equal(calls, 2);
  await refresh("owner", { force: true }); assert.equal(calls, 3);
  fail = true; await refresh("owner", { force: true });
  fail = false; await refresh("owner"); assert.equal(calls, 5);
  await refresh("other-owner"); assert.equal(calls, 6);
});

test("Studio refresh queues one post-mutation read and never replays an old session", async () => {
  const requests = [];
  const refresh = createRefreshGate(key => new Promise(resolve => requests.push({ key, resolve })));
  const initial = refresh("owner"); await Promise.resolve();
  const forced = refresh("owner", { force: true });
  assert.equal(refresh("owner", { force: true }), forced);
  requests[0].resolve(true); await initial; await Promise.resolve();
  assert.equal(requests.length, 2); requests[1].resolve(true); await forced;
  const old = refresh("owner", { force: true }); await Promise.resolve();
  const replay = refresh("owner", { force: true });
  const replacement = refresh("new-owner"); await Promise.resolve();
  requests[2].resolve(true); requests[3].resolve(true);
  await Promise.all([old, replay, replacement]);
  assert.equal(requests.length, 4);
});

test("Studio list loaders reject old filters and sessions and refetch after an in-flight mutation", async () => {
  const requests = [], context = {
    createRefreshGate, ADMIN_WORKER: 'https://synthetic.test', session: 'owner',
    adminSession: () => context.session, activeTab: 'work', renderBody: () => {}, accSyncBadges: () => {}, updateBookBadge: () => {},
    accReqCache: [], accGrantCache: [], accShowDeclined: false, accLoading: false, bookCache: [], bookLoading: false, bookLoaded: false,
    fetch: url => new Promise(resolve => requests.push({ url, resolve }))
  };
  const bookings = source.slice(source.indexOf('  const refreshBookings ='), source.indexOf('  async function bookDo('));
  const access = source.slice(source.indexOf('  const refreshAccessRequests ='), source.indexOf('  // Foldable curation dialog'));
  const loaders = runInNewContext(`(() => { ${bookings}\n${access}\nreturn { loadBookings, loadAccessData }; })()`, context);
  const pending = loaders.loadAccessData(false, false); await Promise.resolve();
  context.accShowDeclined = true;
  const declined = loaders.loadAccessData(false, false); await Promise.resolve();
  context.accShowDeclined = false;
  const latest = loaders.loadAccessData(false, false); await Promise.resolve();
  requests[2].resolve(Response.json({ requests: ['current'] })); await latest;
  requests[0].resolve(Response.json({ requests: ['old pending'] }));
  requests[1].resolve(Response.json({ requests: ['old declined'] }));
  await Promise.all([pending, declined]);
  assert.deepEqual(context.accReqCache, ['current']);
  const old = loaders.loadBookings(false); await Promise.resolve();
  context.session = 'new-owner';
  const replacement = loaders.loadBookings(false); await Promise.resolve();
  requests[4].resolve(Response.json({ bookings: ['new owner'] })); await replacement;
  requests[3].resolve(Response.json({ bookings: ['old owner'] })); await old;
  assert.deepEqual(context.bookCache, ['new owner']);
  const initial = loaders.loadBookings(); await Promise.resolve();
  const forced = loaders.loadBookings();
  requests[5].resolve(Response.json({ bookings: ['before mutation'] })); await initial; await Promise.resolve();
  assert.equal(requests.length, 7);
  requests[6].resolve(Response.json({ bookings: ['after mutation'] })); await forced;
  assert.deepEqual(context.bookCache, ['after mutation']);
  const failed = loaders.loadBookings(); await Promise.resolve();
  requests[7].resolve(new Response(null, { status: 503 })); await failed;
  assert.equal(context.bookLoading, false);
  const retry = loaders.loadBookings(false); await Promise.resolve();
  requests[8].resolve(Response.json({ bookings: ['retry'] })); await retry;
  assert.deepEqual(context.bookCache, ['retry']);
});

test("Studio progress stays above the status bar without intercepting controls", () => {
  const progress = declarations(".adm__statusbar::after");
  assert.equal(progress.top, "-2px");
  assert.equal(progress.bottom, undefined);
  assert.equal(progress.height, "2px");
  assert.equal(progress["pointer-events"], "none");
  assert.equal(declarations(".adm__statusbar.is-publishing::after").width, "var(--pub-pct, 0)");
});

function publicationClient(fetch) {
  const start = source.indexOf("async function ghCommitViaGitData("), end = source.indexOf("function jsonByteLen(", start);
  return runInNewContext(`(() => { ${source.slice(start, end)} return { putContentR2, ghCommitViaGitData }; })()`, {
    fetch, contentRevision, publicationConflict, gitContentRevision, AbortSignal,
    ADMIN_WORKER: "https://worker.test", ghHeaders: () => ({ Authorization: "Bearer synthetic" }),
    ghApiRoot: () => "https://git.test", GH_OWNER: "owner", GH_REPO: "repo", GH_BRANCH: "main", b64: value => Buffer.from(value).toString("base64")
  });
}

test("live resume export preserves every bullet at all density levels", () => {
  const start = source.indexOf("function atsRbBuild("), end = source.indexOf("\n  }", start) + 4;
  const render = runInNewContext(`(${source.slice(start, end)})`, {
    atsRbSize: () => ({ fmt: "a4", w: 210, h: 297 }), atsRbTpl: () => ({ head: "plain" }),
    RB_FONTS: { sans: { pdf: "helvetica" } }, atsRbFont: "sans", atsRbMarginCfg: () => ({ mm: 14 }),
    atsRbAccentRgb: () => [100, 100, 100], rpdfPlain: value => String(value || ""), atsRbLayout: "single", atsRbKeepWhole: true, RB_ICON_CACHE: {}, rbHex: () => "#000000"
  });
  const bullets = Array.from({ length: 100 }, (_, index) => "Preserved achievement " + index);
  for (const density of [1.08, 1, 0.9, 0.72]) {
    const drawn = []; let pages = 1;
    function Pdf() { return new Proxy({}, { get: (target, key) => key === "splitTextToSize" ? value => [value] : key === "getTextWidth" ? value => value.length : key === "getNumberOfPages" ? () => pages : key === "addPage" ? () => pages++ : key === "text" ? value => drawn.push(...(Array.isArray(value) ? value : [value])) : () => {} }); }
    render(Pdf, { name: "Synthetic", sections: [{ kind: "experience", heading: "Experience", items: [{ role: "Designer", bullets }] }] }, { k: density, maxBul: 3 });
    for (const bullet of bullets) assert.equal(drawn.filter(text => text === bullet).length, 1);
    assert.ok(pages > 1);
  }
});

test("live resume PDF cache signature includes margins", () => {
  const start = source.indexOf("function rbPdfSig()"), end = source.indexOf("\n", start);
  const context = { working: { name: "Synthetic" }, atsRbTplId: "classic", atsRbSizeId: "a4", atsRbAccent: "", atsRbFont: "inter", atsRbDensity: "normal", atsRbLayout: "single", atsRbKeepWhole: true, atsRbMargin: "normal" };
  const original = runInNewContext(`${source.slice(start, end)}; rbPdfSig()`, context);
  const narrow = runInNewContext(`${source.slice(start, end)}; rbPdfSig()`, { ...context, atsRbMargin: "narrow" });
  assert.notEqual(original, narrow);
  assert.equal(original, runInNewContext(`${source.slice(start, end)}; rbPdfSig()`, context));
});

test("live resume recheck cannot save into an edited, closed or different document", async () => {
  const start = source.indexOf("async function rbRecheck("), end = source.indexOf("\n    function rbSetBadge", start);
  for (const change of ["none", "edit", "close", "abort", "review", "session", "design", "job"]) {
    let resolve, calls = 0, saves = 0;
    const review = { res: { score: 12 }, level: "staff", company: "Example", jd: "" }, working = { name: "Original" };
    const context = {
      rbRecheckPending: false, rbLifetime: new AbortController(), modal: { isConnected: true }, atsLast: review, atsRbSessId: "original", working, docEl: {},
      rbReadEditor: () => context.working, rbDesignSnap: () => ({ margin: context.margin }), margin: "normal", rbToPlainText: value => value.name,
      atsRbLayout: "single", atsLevel: "staff", atsState: {}, atsRbPages: 1, btnBusy: () => "Check", btnIdle: () => {},
      atsModelChecks: () => ({ checks: [], structureScore: 90 }), aiCfg: () => ({}), atsSystem: () => "", atsUser: () => "", atsFactsBlock: () => "",
      csgenParse: value => value, aiText: () => { calls++; return new Promise(done => { resolve = done; }); },
      atsBlendScore: () => ({ score: 90, band: "Strong" }), dirty: true, paintSide: () => {}, rbSaveWorkspace: () => saves++, status: () => {}
    };
    const run = runInNewContext(`(${source.slice(start, end)})`, context);
    const button = { isConnected: true }, pending = run(button);
    await run(button);
    assert.equal(calls, 1);
    if (change === "edit") context.working = { name: "New edit" };
    if (change === "close") context.modal.isConnected = false;
    if (change === "abort") context.rbLifetime.abort();
    if (change === "review") context.atsLast = { res: { score: 34 } };
    if (change === "session") context.atsRbSessId = "new-session";
    if (change === "design") context.margin = "narrow";
    if (change === "job") review.jd = "New role";
    resolve({ score: 99 }); await pending;
    assert.equal(saves, change === "none" ? 1 : 0, change);
    assert.equal(review.res.score, change === "none" ? 90 : 12, change);
    assert.equal(context.dirty, change !== "none", change);
  }
});

test("Studio publication sends the loaded revision and preserves conflicts without fallback writes", async () => {
  const requests = [], baseline = await contentRevision({ title: "Loaded" });
  const client = publicationClient(async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method !== "POST") return Response.json({ conditional: true, protocol: 1 });
    return Response.json({ error: "Another device published. Your draft is kept." }, { status: 412 });
  });
  await assert.rejects(client.putContentR2('{"title":"Draft"}', "session", baseline), { conflict: true, http: 412 });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.headers["X-Content-Base"], baseline);
  assert.equal(requests[1].options.body, '{"title":"Draft"}');
  const oldRequests = [];
  const old = publicationClient(async (url, options = {}) => { oldRequests.push(options); return new Response(null, { status: 405 }); });
  await assert.rejects(old.putContentR2("{}", "session", baseline), /not enabled conflict protection/);
  assert.equal(oldRequests.length, 1);
  assert.equal(oldRequests[0].method, undefined);
});

test("direct Git publication refuses a stale baseline and never blindly retries a ref conflict", async () => {
  const baseline = { title: "Loaded" }, expected = await contentRevision(baseline), requests = [];
  let content = { title: "Newer remote" };
  const client = publicationClient(async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === "PATCH") return Response.json({ message: "Not a fast forward" }, { status: 422 });
    if (options.method === "POST") return Response.json({ sha: "created" });
    if (url.includes("/git/ref/")) return Response.json({ object: { sha: "head" } });
    if (url.includes("/git/commits/")) return Response.json({ tree: { sha: "tree" } });
    if (url.includes("/git/trees/")) return Response.json({ tree: [{ path: "content.json", type: "blob", sha: "blob" }] });
    return Response.json({ encoding: "base64", content: Buffer.from(JSON.stringify(content)).toString("base64") });
  });
  await assert.rejects(client.ghCommitViaGitData("token", "{}", "Synthetic", expected), { conflict: true });
  assert.ok(requests.every(request => !request.options.method));
  requests.length = 0; content = baseline;
  await assert.rejects(client.ghCommitViaGitData("token", "{}", "Synthetic", expected), { conflict: true });
  assert.equal(requests.filter(request => request.url.includes("/git/ref/heads/")).length, 1);
  const updates = requests.filter(request => request.options.method === "PATCH");
  assert.equal(updates.length, 1);
  assert.equal(JSON.parse(updates[0].options.body).force, false);
});

test("Prepare sync retries failed writes and keeps deletion tombstones against stale cloud lists", async () => {
  const values = new Map(), requests = [];
  let fail = true, holdWrite = false, releaseWrite, remoteId = 'saved', releaseRead;
  const start = source.indexOf('var PREP_HIST_KEY'), end = source.indexOf('var PREP_TOOLS',start);
  const store = runInNewContext(`(() => { ${source.slice(start,end)} return {put:prepPut,remove:prepDel,retry:prepRetryStorage,pull:prepCloudPull,list:prepList}; })()`, {
    Map, Date, Object, JSON, AbortSignal, queueMicrotask, setTimeout, clearTimeout,
    clone:structuredClone, window:{addEventListener(){}}, document:{querySelector:()=>null,querySelectorAll:()=>[]}, adminSession:()=>'test-session', ADMIN_WORKER:'https://worker.test',
    localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},
    fetch:async (url,options={}) => { requests.push({url,body:options.body}); if(url.includes('/list?')) return Response.json({items:[{id:remoteId,at:9999999999999}]}); if (url.includes('/get?')) return new Promise(resolve => { releaseRead = entry => resolve(Response.json(entry)); }); if (holdWrite && url.endsWith('/put')) { holdWrite = false; await new Promise(resolve => { releaseWrite = resolve; }); } return new Response('',{status:fail?503:200}); }
  });
  store.put('iprep',{id:'saved',tool:'iprep',payload:{questions:[{q:'Preserved question'}]}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.list('iprep').length,1);
  assert.equal(Object.keys(JSON.parse(values.get('rk:prep:sync'))).length,1);
  fail=false; await store.retry();
  assert.equal(Object.keys(JSON.parse(values.get('rk:prep:sync'))).length,0);
  store.remove('iprep','saved');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.parse(values.get('rk:prep:sync'))['iprep/saved'].acknowledged,true);
  store.pull('iprep',()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.list('iprep').length,0);
  assert.equal(requests.filter(request=>request.url.includes('/get?')).length,0);
  holdWrite = true;
  store.put('iprep',{id:'concurrent',tool:'iprep',payload:{draft:'first'}});
  await new Promise(resolve=>setImmediate(resolve));
  store.put('iprep',{id:'concurrent',tool:'iprep',payload:{draft:'latest'}});
  store.put('story',{id:'next-tool',tool:'story',payload:{draft:'also queued'}});
  releaseWrite();
  await new Promise(resolve=>setImmediate(resolve));
  const writes = requests.filter(request=>request.url.endsWith('/put')).map(request=>JSON.parse(request.body));
  assert.deepEqual(writes.filter(entry=>entry.id==='concurrent').map(entry=>entry.payload.draft),['first','latest']);
  assert.ok(writes.some(entry=>entry.id==='next-tool'));
  assert.equal(Object.values(JSON.parse(values.get('rk:prep:sync'))).filter(item=>!item.acknowledged).length,0);
  remoteId = 'concurrent'; store.pull('iprep',()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  store.remove('iprep','concurrent');
  await new Promise(resolve=>setImmediate(resolve));
  releaseRead({id:'concurrent',tool:'iprep',at:9999999999999,payload:{draft:'stale response'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.list('iprep').length,0);
});

test("shared preparation briefs select explicit evidence without changing portfolio data", () => {
  const source = {work:[{id:'first',study:{blocks:[{type:'text',body:'Public evidence'},{type:'text',locked:true,body:'Protected evidence'}]}},{id:'second',hidden:true,study:{blocks:[{type:'text',body:'Private project'}]}},{id:'sealed',encWork:true,study:{blocks:[{body:'Sealed'}]}}]};
  const before = structuredClone(source), brief = prepareBrief({company:'Example',projectMode:'selected',projectIds:['first','first','second']});
  assert.deepEqual(brief.projectIds,['first','second']);
  const selected = prepareBriefWorks(brief,source);
  assert.deepEqual(selected.map(work=>work.id),['first']);
  assert.equal(selected[0].study.blocks.length,1);
  assert.deepEqual(prepareBriefWorks({...brief,includePrivate:true},source).map(work=>work.id),['first','second']);
  assert.deepEqual(prepareBriefWorks({projectMode:'selected',projectIds:[]},source),[]);
  const restricted = {...brief,projectIds:['first'],includePrivate:true};
  assert.deepEqual(prepareBriefWorks(restricted,source,['first','second']).map(work=>work.id),['first']);
  assert.deepEqual(prepareBriefWorks(restricted,source,['second']),[]);
  assert.deepEqual(prepareBriefWorks(restricted,source,[]),[]);
  assert.equal(prepareBrief({level:'invalid'}).level,'staff');
  assert.deepEqual(source,before);
});

test("Work card Edit uses the shared primary variant without overriding its colours", () => {
  assert.ok(source.includes('class="btn btn--primary study__editbtn"'));
  assert.deepEqual(declarations('.study__editbtn'), { flex: '1', 'text-align': 'center' });
  assert.deepEqual(declarations('.study__editbtn:hover'), {});
  assert.ok(source.includes('class="btn btn--ghost study__previewbtn"'));
  assert.ok(source.includes('class="btn study__editbtn is-open"'));
});

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
  assert.match(tabs, /tb\.innerHTML = journeyOpen \? \["about", "journey", "stories", "photos", "more"\]\.map/);
  assert.match(tabs, /\}\)\.join\(""\) : show \? l2TabsHtml\(\) : ""; tb\.hidden = !show && !journeyOpen/);
  assert.match(tabs, /tb\.setAttribute\("aria-label", journeyOpen \? "About editor" : "Project editor"\)/);
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