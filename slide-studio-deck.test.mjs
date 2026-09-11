import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { rkDecWithSek, rkUnwrapSek } from "./src/js/admin-core.js";
import { assertStudioDeckPublishable, createStudioDeck, STUDIO_DECK_SCHEMA } from "./src/js/slide-studio-deck.mjs";
import { AI_AGENT_SYSTEM } from "./src/js/ai-task-agent.mjs";
import { COMPOSITION_RESPONSE_SCHEMA } from "./src/js/slide-merge-ai.mjs";

async function waitForRoutingPolicy(page, key, value) {
  await page.evaluate(() => { window.__routingPolicyProbe = { pending: false, matches: false }; });
  await page.waitForFunction(({ key, value }) => {
    const probe = window.__routingPolicyProbe;
    if (!probe.pending) {
      probe.pending = true;
      window.__RKStudio.aiRouting.state().then(state => { probe.matches = state.policy[key] === value; probe.pending = false; }, () => { probe.pending = false; });
    }
    return probe.matches;
  }, { key, value });
  await page.evaluate(() => { delete window.__routingPolicyProbe; });
}

test("new production decks are empty and have no demonstration content", () => {
  assert.deepEqual(createStudioDeck("Case-study slides"), { version: 1, title: "Case-study slides", selected: null, slides: [] });
});

test("slideshow routing defaults to native while preserving unopened legacy protection", () => {
  const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  const start = source.indexOf("function nativeSlidesEnabled(work)"), end = source.indexOf("async function saveNativeWork", start);
  const usesNative = runInNewContext(`(${source.slice(start, end)})`);
  assert.equal(usesNative({ id: "new-case" }), true);
  assert.equal(usesNative({ study: { slides: [{ layout: "title" }] } }), true);
  assert.equal(usesNative({ study: { slidesEnc: { ct: "sealed" } } }), false);
  assert.equal(usesNative({ study: { slidesEnc: { ct: "sealed" }, slides: [] } }), false);
  for (const key of ["nativeDeck", "nativeDeckEnc", "nativeDeckPublic"]) assert.equal(usesNative({ study: { [key]: { id: "existing-native-deck" }, slidesEnc: { ct: "sealed-legacy" } } }), true);
  assert.equal(usesNative({ encWork: true, study: { nativeDeck: { id: "private" } } }), false);
  assert.equal(usesNative(null), false);
});

test("native pilot references and inline native scenes stop publishing without changing the draft", () => {
  for (const study of [
    { nativeDeck: { schema: STUDIO_DECK_SCHEMA, version: 1, id: "deck-one", revision: 2 } },
    { nativeDeck: null },
    { slidesPublic: true, slides: [{ scene: { elements: [] }, notes: "PRIVATE NOTES" }] }
  ]) {
    const data = { work: [{ id: "case-one", study }] }, original = structuredClone(data);
    assert.throws(() => assertStudioDeckPublishable(data), { name: "StudioDeckPublishError" });
    assert.deepEqual(data, original);
  }
});

test("legacy and unopened encrypted decks pass through the pilot guard unchanged", () => {
  const data = { work: [{ study: { slides: [{ layout: "title", slots: { title: "Legacy slide" } }] } }, { study: { slidesEnc: { ct: "sealed-deck", wraps: { owner: "sealed-key" } } } }, { encWork: "sealed-work" }] };
  const original = structuredClone(data);
  assert.doesNotThrow(() => assertStudioDeckPublishable(data));
  assert.deepEqual(data, original);
});

test("the shared publish builder validates native references before preparing owner and audience copies", () => {
  const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  assert.match(source, /async function buildPublishJson\(token, publication = \{\}\) \{\s*assertStudioDeckPublishable\(data, \{ supportedNative: true \}\);/);
  for (const entry of ['publish', 'ghPublish', 'publishManual']) assert.match(source, new RegExp('function ' + entry + '\\([^)]*\\) \\{(?:\\s*if \\(publishing\\) return;)?\\s*if \\(!slidePublishReady\\(\\)\\) return;'));
  assert.throws(() => assertStudioDeckPublishable({}, { activeEditor: true }), { name: 'StudioDeckPublishError' });
  const supported = { work: [{ id: 'case', study: { nativeDeck: { schema: STUDIO_DECK_SCHEMA, version: 1, caseStudyId: 'case', id: 'deck', revision: 1 } } }] };
  assert.doesNotThrow(() => assertStudioDeckPublishable(supported, { supportedNative: true }));
  assert.match(source, /prepareStudioPublication\(snapshot/);
});

for (const { width, mode } of [{ width: 1440, mode: "complete" }, { width: 390, mode: "complete" }, { width: 1440, mode: "summary-fallback" }, { width: 390, mode: "summary-fallback" }, { width: 1440, mode: "exhausted" }, { width: 1440, mode: "invalid-body" }, { width: 1440, mode: "schema-error" }, { width: 1440, mode: "invalid-draft" }, { width: 1440, mode: "revision" }, { width: 390, mode: "revision" }, { width: 390, mode: "cancelled" }]) test("Draft entire deck with AI delegates, checks and streams progress at " + width + "px (" + mode + ")", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: width < 600, isMobile: width < 600 });
  const requests = [], errors = [];
  const needsRevision = mode === "revision" || mode === "invalid-draft";
  const expectedSlideCount = mode === "complete" ? 16 : 1;
  const finalBody = "Place the next action beside the relevant content.";
  const schemaFailure = "output_config.format.schema: Unsupported regex feature in pattern field: Cannot apply a range quantifier to this regex.";
  let exhaustResponse = mode === "exhausted", rejectBody = mode === "invalid-body", releaseSpecialist;
  const specialistGate = new Promise(resolve => { releaseSpecialist = resolve; });
  const capabilities = { thinking: { supported: true }, structured_outputs: { supported: true }, effort: { supported: true, low: { supported: true }, medium: { supported: true } } };
  const published = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  published.work = [{ id: "temperature-case", title: "A clearer product flow", client: "Studio test", study: { blocks: [{ type: "text", heading: "A clearer next step", body: "The redesigned flow places the next action beside the relevant content." }] } }];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      localStorage.setItem("rk:dev:stub", "1");
      localStorage.setItem("rk:ai:mode", "local"); localStorage.setItem("rk:ai:same", "0");
      localStorage.setItem("rk:ai:txt:provider", "anthropic"); localStorage.setItem("rk:ai:txt:key", "synthetic-test-key");
    });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith("/content.json")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(published) });
      if (url.hostname === "models.dev") return route.fulfill({ contentType: "application/json", body: "{}" });
      if (url.hostname === "api.anthropic.com") {
        if (url.pathname.endsWith("/models")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [
          { id: "studio-creative-a", output_modalities: ["text"], max_input_tokens: 100000, max_tokens: 128000, capabilities, pricing: { input: 2, output: 8 } },
          { id: "studio-coordinator", output_modalities: ["text"], max_input_tokens: 100000, max_tokens: 8192, capabilities, pricing: { input: 0.1, output: 0.2 } },
          { id: "studio-evidence", output_modalities: ["text"], max_input_tokens: 100000, max_tokens: 8192, capabilities, pricing: { input: 1, output: 2 } }
        ] }) });
        if (url.pathname.endsWith("/messages")) {
          const body = request.postDataJSON(); requests.push(body);
          if (Object.hasOwn(body, "temperature")) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { type: "invalid_request_error", message: "Invalid body" } }) });
          if (body.system === AI_AGENT_SYSTEM) {
            const input = JSON.parse(body.messages[0].content), evidence = input.work.find(item => item.kind === "delegate" && item.valid);
            assert.equal(body.output_config?.format?.type, "json_schema", "A capable coordinator must receive an enforced action schema");
            const schema = body.output_config.format.schema;
            assert.deepEqual(schema.required, ["decision"]);
            assert.equal(schema.additionalProperties, false);
            assert.deepEqual(schema.properties.decision.anyOf[0].properties.modelRef.enum, input.catalogue.map(item => item.ref));
            assert.deepEqual(schema.properties.decision.anyOf.find(branch => branch.properties.action.enum[0] === "draft")?.properties.modelRef.enum, input.draftModels.length ? input.draftModels : undefined);
            assert.equal(body.max_tokens, 2048, "The schema must keep coordination bounded without an arbitrary token increase");
            const action = input.candidate ? { action: "finish", summary: "The draft preserves the source and meets the presentation contract" }
              : input.revision ? { action: "revise", workId: input.revision.workId, modelRef: input.catalogue.find(item => item.id === "studio-creative-a").ref, task: "creative", effort: "medium", instruction: "", inputs: [], summary: "Revising only the rejected body" }
              : evidence ? { action: "draft", modelRef: input.catalogue.find(item => item.id === "studio-creative-a").ref, task: "creative", effort: "medium", instruction: "Use the checked source facts", inputs: [evidence.id], summary: "Writing the deck with the creative model" }
              : { action: "delegate", modelRef: input.catalogue.find(item => item.id === "studio-evidence").ref, task: "analysis", effort: "medium", purpose: "evidence", instruction: "Check the supplied source facts", inputs: [], summary: "Checking the case-study evidence" };
            if (mode === "summary-fallback") {
              if (action.action === "delegate") delete action.summary;
              else action.summary = action.action === "draft" ? "OVERLONG PROGRESS SUMMARY ".repeat(30) : null;
            }
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ decision: action }) }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 } }) });
          }
          if (body.model === "studio-evidence") {
            await specialistGate;
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: "PRIVATE SPECIALIST FINDINGS: The supplied case places the next action beside relevant content; do not invent results." }], stop_reason: "end_turn" }) });
          }
          if (rejectBody) return route.fulfill({ status: 400, contentType: "application/json", headers: { "request-id": "req-browser-check" }, body: JSON.stringify({ error: { type: "invalid_request_error", message: "Invalid body" } }) });
          if (mode === "schema-error") return route.fulfill({ status: 400, contentType: "application/json", headers: { "request-id": "req-schema-check", "access-control-expose-headers": "request-id" }, body: JSON.stringify({ error: { type: "invalid_request_error", message: schemaFailure } }) });
          if (body.output_config?.format?.schema?.properties?.updates) {
            const revision = JSON.parse(body.messages[0].content);
            assert.deepEqual(revision.fields.map(({ ref, field, maxLength }) => ({ ref, field, maxLength })), [{ ref: "f0", field: "body", maxLength: 180 }]);
            assert.equal(body.max_tokens, 1024);
            assert.equal(body.output_config.effort, "medium");
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ updates: [{ fieldRef: "f0", text: mode === "invalid-draft" ? "A".repeat(181) : finalBody }] }) }], stop_reason: "end_turn", usage: { input_tokens: 200, output_tokens: 100 } }) });
          }
          const content = body.messages[0].content;
          const source = JSON.parse(Array.isArray(content) ? content[0].text : content).sources[0];
          assert.match(JSON.stringify(content), /PRIVATE SPECIALIST FINDINGS/);
          const proposal = { version: 2, title: "A grounded deck", slides: [{ id: "opening", kind: "authored", layout: "statement", sourceIds: [source.sourceId], headline: "A clearer next step", kicker: "DESIGN DECISION", body: "Place the next action beside the relevant content.", notes: "Discuss the redesigned flow.", components: [] }] };
          if (needsRevision) Object.assign(proposal.slides[0], { layout: "evidence", components: [source.sourceId], body: "A".repeat(200) });
          if (expectedSlideCount > 1) proposal.slides = Array.from({ length: expectedSlideCount }, (_, index) => ({ ...structuredClone(proposal.slides[0]), id: "slide-" + index, headline: "A clearer next step " + (index + 1) }));
          const events = [
            { type: "message_start", message: { usage: { input_tokens: 200 } } },
            { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "PRIVATE REASONING SIGNATURE" } },
            ...(exhaustResponse ? [] : [{ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: JSON.stringify(proposal) } }]),
            { type: "message_delta", delta: { stop_reason: exhaustResponse ? "max_tokens" : "end_turn" }, usage: { output_tokens: exhaustResponse ? 24000 : 12500, output_tokens_details: { thinking_tokens: exhaustResponse ? 24000 : 11000 } } },
            { type: "message_stop" }
          ];
          return route.fulfill({ contentType: "text/event-stream", body: events.map(event => "data: " + JSON.stringify(event)).join("\n\n") });
        }
        return route.abort();
      }
      if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/studio/?devstub");
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(maxCost => {
      const draftSlides = window.__RKStudio.draftSlides;
      window.__RKStudio.draftSlides = (catalog, brief, options = {}) => draftSlides(catalog, brief, { ...options, maxCost: Math.min(maxCost, options.maxCost ?? Infinity) });
    }, needsRevision ? 0.3 : 0.5);
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.adm__tab[data-tab="work"]').click();
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.locator(".merge-empty-actions").waitFor();
    await page.getByRole("button", { name: "Draft entire deck with AI", exact: true }).click();
    await page.getByRole("log", { name: "Agent activity", exact: true }).getByText(mode === "summary-fallback" ? "Delegating specialist work" : "Checking the case-study evidence", { exact: true }).waitFor();
    await page.getByRole("log", { name: "Agent activity", exact: true }).getByText(/studio-evidence/).waitFor();
    assert.equal(requests.filter(request => request.model === "studio-creative-a").length, 0);
    assert.equal(await page.getByRole("button", { name: "Append slides", exact: true }).count(), 0);
    await page.screenshot({ path: join(tmpdir(), "rk-ai-agent-working-" + width + ".png") });
    if (mode === "cancelled") {
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      releaseSpecialist();
      await page.locator(".merge-ai").waitFor({ state: "detached" });
      assert.equal(requests.length, 2);
      assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck?.slideCount || 0), 0);
      return;
    }
    releaseSpecialist();
    if (mode === "schema-error") {
      await page.locator('.merge-ai [role="alert"]').filter({ hasText: schemaFailure }).waitFor();
      assert.equal(requests.length, 4, "An application schema rejection must stop before another coordinator or model request");
      assert.equal(await page.getByRole("button", { name: "Append slides", exact: true }).count(), 0);
      const state = await page.evaluate(() => window.__RKStudio.aiRouting.state());
      assert.equal(state.decisions.at(-1).failure, "request-format");
      assert.equal(state.decisions.at(-1).failurePhase, "request");
      assert.equal(state.decisions.at(-1).httpStatus, 400);
      assert.equal(state.decisions.at(-1).requestId, "req-schema-check");
      assert.ok(state.decisions.reduce((cost, decision) => cost + decision.estimatedCost, 0) <= 0.5);
      const study = await page.evaluate(() => window.__RKStudio.getDraft().work[0].study);
      assert.deepEqual(study.blocks, published.work[0].study.blocks);
      assert.equal(study.nativeDeck?.slideCount || 0, 0);
      assert.deepEqual(errors, []);
      return;
    }
    if (mode === "invalid-draft") {
      await page.locator('.merge-ai [role="alert"]').filter({ hasText: /draft limit.*Last draft validation: Invalid body: 181 characters exceeds the 180-character limit/ }).waitFor();
      await page.getByRole("log", { name: "Agent activity", exact: true }).getByText("Draft validation: Invalid body: 200 characters exceeds the 180-character limit", { exact: true }).waitFor();
      assert.equal(requests.length, 6, "Do not call another model after the bounded revision fails the original contract");
      assert.equal(await page.getByRole("button", { name: "Append slides", exact: true }).count(), 0);
      const state = await page.evaluate(() => window.__RKStudio.aiRouting.state());
      assert.equal(state.decisions.at(-1).failurePhase, "validation");
      assert.ok(state.decisions.reduce((cost, decision) => cost + decision.estimatedCost, 0) <= 0.3);
      assert.doesNotMatch(JSON.stringify(state), /Invalid body: (200|181)|PRIVATE SPECIALIST FINDINGS/);
      const study = await page.evaluate(() => window.__RKStudio.getDraft().work[0].study);
      assert.deepEqual(study.blocks, published.work[0].study.blocks);
      assert.equal(study.nativeDeck?.slideCount || 0, 0);
      assert.deepEqual(errors, []);
      return;
    }
    if (mode === "exhausted" || mode === "invalid-body") {
      await page.locator('.merge-ai [role="alert"]').filter({ hasText: mode === "exhausted" ? "output limit before returning answer text" : "rejected the request body (HTTP 400" }).waitFor();
      assert.equal(requests.length, 4, "Do not retry a charged or generically rejected response automatically");
      const failed = await page.evaluate(() => window.__RKStudio.aiRouting.state());
      if (mode === "exhausted") {
        assert.equal(failed.decisions.at(-1).failure, "output-limit");
        assert.equal(failed.decisions.at(-1).stopReason, "max_tokens");
        assert.equal(failed.decisions.at(-1).usedOutputTokens, 24000);
      } else {
        assert.equal(failed.decisions.at(-1).httpStatus, 400);
        assert.equal(failed.decisions.at(-1).errorType, "invalid_request_error");
        assert.equal(failed.decisions.at(-1).failurePhase, "request");
      }
      assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck?.slideCount || 0), 0);
      assert.equal(await page.getByRole("button", { name: "Append slides", exact: true }).count(), 0);
      exhaustResponse = false; rejectBody = false;
      await page.getByRole("button", { name: "Retry", exact: true }).click();
    }
    await page.locator(".merge-ai h3").waitFor();
    assert.equal(await page.locator(".merge-ai h3").innerText(), "A grounded deck");
    assert.equal(await page.locator('.merge-ai [role="alert"]').count(), 0);
    assert.equal(requests.length, mode === "exhausted" || mode === "invalid-body" ? 9 : mode === "revision" ? 7 : 5);
    assert.deepEqual([...new Set(requests.map(request => request.model))], ["studio-coordinator", "studio-evidence", "studio-creative-a"]);
    const drafts = requests.filter(request => request.model === "studio-creative-a" && !request.output_config?.format?.schema?.properties?.updates);
    assert.ok(drafts.every(request => request.stream === true && request.max_tokens === 24000));
    if (mode === "revision") assert.equal(drafts.length, 1, "The bounded revision must not generate a second whole deck");
    assert.ok(requests.filter(request => request.model === "studio-creative-a").every(request => request.output_config?.effort === "medium"), "The agent's chosen effort must reach the final model");
    for (const request of drafts) assert.deepEqual(request.output_config?.format, { type: "json_schema", schema: COMPOSITION_RESPONSE_SCHEMA });
    assert.ok(requests.every(request => !Object.hasOwn(request, "temperature")));
    assert.ok(requests.filter(request => request.model === "studio-coordinator").every(request => request.output_config?.effort === "low"));
    await page.locator(".merge-ai-activity > summary").click();
    await page.getByRole("log", { name: "Agent activity", exact: true }).locator('li[data-status="complete"]').getByText(mode === "summary-fallback" ? "Producing the draft" : "Writing the deck with the creative model", { exact: true }).waitFor();
    if (mode === "summary-fallback") assert.doesNotMatch(await page.locator(".merge-ai").innerText(), /OVERLONG PROGRESS SUMMARY|HTTP 422|needs a short progress summary/);
    assert.match(await page.getByLabel("Model selection", { exact: true }).innerText(), /studio-creative-a.*provisional/);
    await page.getByRole("button", { name: "Draft needs work", exact: true }).click();
    await page.getByLabel("Feedback category", { exact: true }).selectOption("design");
    await page.getByText("Feedback saved", { exact: true }).waitFor();
    const overflow = await page.locator(".merge-ai").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll("button,select,summary")].filter(control => control.getClientRects().length).map(control => ({ label: control.textContent, left: control.getBoundingClientRect().left, right: control.getBoundingClientRect().right })).filter(control => control.left < bounds.left - 1 || control.right > bounds.right + 1);
    });
    assert.deepEqual(overflow, []);
    await page.screenshot({ path: join(tmpdir(), "rk-ai-proposal-" + width + ".png") });
    const routing = await page.evaluate(() => window.__RKStudio.aiRouting.state());
    for (const jobId of new Set(routing.decisions.map(decision => decision.agentJobId))) assert.ok(routing.decisions.filter(decision => decision.agentJobId === jobId).reduce((cost, decision) => cost + decision.estimatedCost, 0) <= 0.5);
    if (mode === "summary-fallback") assert.ok(routing.decisions.every(decision => decision.status === "success"), "Cosmetic summaries must never trigger repair requests");
    const accepted = routing.decisions.find(decision => decision.agentRole === "result");
    assert.equal(accepted.task, "creative");
    assert.equal(accepted.stopReason, "end_turn");
    assert.equal(accepted.usedOutputTokens, mode === "revision" ? 100 : 12500);
    assert.equal(accepted.thinkingTokens, mode === "revision" ? undefined : 11000);
    if (mode === "revision") {
      assert.equal(accepted.agentOperation, "revision");
      assert.ok(routing.decisions.reduce((cost, decision) => cost + decision.estimatedCost, 0) <= 0.3);
      await page.getByRole("log", { name: "Agent activity", exact: true }).getByText("Revising only the rejected body", { exact: true }).waitFor();
    }
    assert.equal(routing.observations.find(item => item.feedbackFor)?.quality, 0.25);
    assert.doesNotMatch(JSON.stringify(routing), /synthetic-test-key|Place the next action|Discuss the redesigned flow|PRIVATE REASONING SIGNATURE|PRIVATE SPECIALIST FINDINGS/);
    await page.getByRole("button", { name: "Append slides", exact: true }).click();
    await page.waitForFunction(count => window.__RKStudio.getDraft().work[0].study.nativeDeck?.slideCount === count, expectedSlideCount);
    await page.waitForFunction(count => {
      const thumbnails = [...document.querySelectorAll('.merge-thumbnail')];
      return thumbnails.length === count && thumbnails.every(thumbnail => thumbnail.querySelector('.merge-section-thumbnail-svg > svg text'));
    }, expectedSlideCount, { timeout: 10000 });
    await page.locator("[data-l2-back]").click();
    await page.locator(".merge-shell").waitFor({ state: "detached" });
    const study = await page.evaluate(() => window.__RKStudio.getDraft().work[0].study);
    assert.deepEqual(study.blocks, published.work[0].study.blocks);
    assert.notEqual(study.slidesPublic, true);
    assert.doesNotMatch(JSON.stringify(study), /aiRouting|modelId|feedbackFor|agentRole|agentJobId/);
    assert.deepEqual(errors, []);
  } finally { releaseSpecialist(); await browser.close(); }
});

test("AI routing settings discover models, require spending consent and keep evidence private", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const requests = [], discoveries = [], errors = [], created = new Date(Date.now() - 86400000).toISOString();
  let includeNewcomer = false;
  const published = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  published.work = [];
  const metadata = id => ({ id, input_modalities: ["text", "image"], output_modalities: ["text"], max_input_tokens: 100000, max_tokens: 16000,
    created_at: created, capabilities: { thinking: { supported: true }, structured_outputs: { supported: true } }, pricing: { input: 2, output: 8 } });
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      localStorage.setItem("rk:dev:stub", "1"); localStorage.setItem("rk:ai:mode", "local"); localStorage.setItem("rk:ai:same", "0");
      for (const [scope, provider] of [["txt", "anthropic"], ["img", "openai"]]) {
        localStorage.setItem("rk:ai:" + scope + ":provider", provider); localStorage.setItem("rk:ai:" + scope + ":key", "synthetic-routing-key");
      }
    });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith("/content.json")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(published) });
      if (url.hostname === "models.dev") { assert.equal(request.headers().authorization, undefined); return route.fulfill({ contentType: "application/json", body: "{}" }); }
      if (["api.anthropic.com", "api.openai.com"].includes(url.hostname)) {
        if (url.pathname.endsWith("/models")) {
          discoveries.push(url.hostname);
          const models = url.hostname === "api.openai.com" ? [metadata("connected-model")] : [metadata("baseline-a"), metadata("baseline-b"), ...(includeNewcomer ? [metadata("fresh-catalogue-entry")] : [])];
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: models }) });
        }
        if (request.method() === "POST") {
          const body = request.postDataJSON(); requests.push({ provider: url.hostname, body });
          if (body.system === AI_AGENT_SYSTEM) {
            const input = JSON.parse(body.messages[0].content);
            const selected = input.catalogue.find(item => item.id === "fresh-catalogue-entry" && item.evidence.samples >= 3) || input.catalogue[0];
            const action = input.candidate ? { action: "finish", summary: "The copy meets the requested outcome" } : { action: "draft", modelRef: selected.ref, task: "writing", instruction: "", inputs: [], summary: "Improving the supplied copy" };
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(action) }], stop_reason: "end_turn" }) });
          }
          const text = String(body.system || "").startsWith("Complete this small evaluation") ? '{"headline":"Related settings belong together","body":"The team grouped related controls to make settings easier to find."}' : "Refined copy.";
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 15, output_tokens: 20 } }) });
        }
        return route.abort();
      }
      if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/studio/?devstub");
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    const original = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator("[data-opensettings]").click();
    await page.locator('[data-act="settings-cat"][data-cat="ai"]').click();
    const panel = page.locator("[data-ai-routing]");
    assert.equal(await panel.count(), 0, "The AI overview must not duplicate routing settings");
    assert.equal(await page.locator("[data-aiuse-reset]").count(), 1, "Token usage stays on the overview");
    assert.equal(discoveries.length, 0, "The overview must not mount a hidden discovery panel");
    await page.getByRole("button", { name: "Open AI settings", exact: true }).click();
    await panel.getByText(/2 accessible models/).waitFor();
    assert.equal(await panel.count(), 1, "Routing has one home inside the full AI settings");
    assert.equal(await panel.getByText("Agent-led", { exact: true }).count(), 1);
    assert.equal(await panel.locator("[data-route-task], [data-route-choices], [data-route-evaluate]").count(), 0, "Model/task selection and manual evaluation are not the user workflow");
    assert.equal(await panel.locator(".airoute__advanced").getAttribute("open"), null);
    assert.equal(requests.length, 0);
    assert.ok(discoveries.every(provider => provider === "api.anthropic.com"));
    assert.equal(await panel.locator('[data-route-policy="autoEvaluate"]').isChecked(), false);
    assert.equal(await panel.locator('[data-route-policy="evaluationDailyBudget"]').inputValue(), "0");
    assert.equal(await panel.locator('[data-route-import] svg').count(), 1);
    includeNewcomer = true;
    await panel.getByRole("button", { name: "Refresh accessible models", exact: true }).click();
    await panel.getByText(/3 accessible models/).waitFor();
    await panel.locator('[data-route-policy="maxCost"]').fill("0.00001");
    await panel.locator('[data-route-policy="maxCost"]').press("Tab");
    await waitForRoutingPolicy(page, "maxCost", 0.00001);
    const blocked = await page.evaluate(async () => { try { await window.__RKStudio.improveText("PRIVATE ROUTING COPY", {}); return "unexpected success"; } catch (error) { return error.message; } });
    assert.match(blocked, /No available model/); assert.equal(requests.length, 0);
    await panel.locator('[data-route-policy="maxCost"]').fill("");
    await panel.locator('[data-route-policy="maxCost"]').press("Tab");
    await waitForRoutingPolicy(page, "maxCost", null);
    await panel.locator('[data-route-policy="providers"]').selectOption("connected");
    await page.getByRole("button", { name: "Keep selected", exact: true }).click();
    assert.equal((await page.evaluate(() => window.__RKStudio.aiRouting.state())).policy.providers, "selected");
    await panel.locator('[data-route-policy="providers"]').selectOption("connected");
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await panel.getByText(/4 accessible models/).waitFor();
    assert.ok(discoveries.includes("api.openai.com"));
    await panel.locator('[data-route-policy="providers"]').selectOption("selected");
    await panel.getByText("Diagnostics and evaluation limits", { exact: true }).click();
    await panel.locator('[data-route-policy="evaluationDailyBudget"]').fill("1");
    await panel.locator('[data-route-policy="evaluationDailyBudget"]').press("Tab");
    await waitForRoutingPolicy(page, "evaluationDailyBudget", 1);
    assert.equal(requests.length, 0);
    assert.equal(await page.evaluate(() => window.__RKStudio.improveText("PRIVATE ROUTING COPY", {})), "Refined copy.");
    assert.equal(requests.length, 3);
    const tested = await page.evaluate(() => window.__RKStudio.aiRouting.state());
    assert.equal(tested.decisions.length, 3); assert.ok(tested.observations.every(item => item.quality == null));
    assert.equal(tested.evaluationReserved, 0, "An agentic task does not silently enable background benchmarks");
    assert.deepEqual(tested.decisions.map(item => item.agentRole), ["coordinator", "result", "coordinator"]);
    const imported = [{ provider: "anthropic", modelId: "fresh-catalogue-entry", scope: tested.decisions[0].scope, task: "writing", at: Date.now(), quality: 0.98, samples: 6, rubric: "owner-reviewed-copy-v1", prompt: "NEVER STORE IMPORTED CONTENT" }];
    await panel.locator("[data-route-file]").setInputFiles({ name: "evaluations.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
    await panel.getByText("1 evaluation records imported.", { exact: true }).waitFor();
    await panel.locator('[data-route-policy="autoEvaluate"]').check();
    const darkConfirmation = await page.getByRole("button", { name: "Cancel", exact: true }).evaluate(button => getComputedStyle(button.closest(".pass__box")).backgroundColor);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await page.evaluate(() => window.__RKStudio.aiRouting.state())).policy.autoEvaluate, false);
    await page.evaluate(() => { document.documentElement.dataset.appearance = "light"; });
    await panel.locator('[data-route-policy="autoEvaluate"]').check();
    const lightConfirmation = await page.getByRole("button", { name: "Cancel", exact: true }).evaluate(button => getComputedStyle(button.closest(".pass__box")).backgroundColor);
    assert.notEqual(lightConfirmation, darkConfirmation);
    await page.screenshot({ path: join(tmpdir(), "rk-ai-confirmation-light.png") });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => { document.documentElement.dataset.appearance = "dark"; });
    await panel.locator('[data-route-policy="autoEvaluate"]').check();
    await page.getByRole("button", { name: "Enable tests", exact: true }).click();
    await waitForRoutingPolicy(page, "autoEvaluate", true);
    assert.equal(await page.evaluate(async () => {
      const completed = new Promise(resolve => {
        const observe = async () => {
          const state = await window.__RKStudio.aiRouting.state();
          if (state.decisions.filter(item => item.evaluation && item.task === "writing" && item.status === "success").length === 3) {
            window.removeEventListener("rk:ai-evaluation", observe); resolve();
          }
        };
        window.addEventListener("rk:ai-evaluation", observe);
      });
      const result = await window.__RKStudio.improveText("PRIVATE ROUTING COPY", {});
      await completed;
      return result;
    }), "Refined copy.");
    await panel.locator('[data-route-policy="autoEvaluate"]').uncheck();
    await waitForRoutingPolicy(page, "autoEvaluate", false);
    assert.equal(requests.length, 9);
    const saved = await page.evaluate(() => window.__RKStudio.aiRouting.state());
    assert.equal(saved.decisions.filter(item => item.agentRole === "result").at(-1).modelId, "fresh-catalogue-entry", "The coordinator receives imported task evidence and can choose a new model without human model selection");
    assert.ok(saved.evaluationReserved > 0 && saved.evaluationReserved < 1);
    assert.doesNotMatch(JSON.stringify(saved), /synthetic-routing-key|PRIVATE ROUTING COPY|Related settings belong|NEVER STORE IMPORTED CONTENT/);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft())), original);
    const routingBundle = await build({ entryPoints: [fileURLToPath(new URL("./src/js/ai-orchestrator.mjs", import.meta.url))], bundle: true, format: "iife", globalName: "RoutingStoreTest", write: false });
    const other = await page.context().newPage();
    try {
      await other.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/404.html");
      for (const target of [page, other]) await target.addScriptTag({ content: routingBundle.outputFiles[0].text });
      await page.evaluate(async budget => window.RoutingStoreTest.createAiOrchestrator().configure({ evaluationDailyBudget: budget }), saved.evaluationReserved + 0.03);
      const reservations = await Promise.allSettled([page.evaluate(() => window.RoutingStoreTest.createAiOrchestrator().reserveEvaluation(0.02)), other.evaluate(() => window.RoutingStoreTest.createAiOrchestrator().reserveEvaluation(0.02))]);
      assert.equal(reservations.filter(result => result.status === "fulfilled").length, 1);
      const accepted = reservations.find(result => result.status === "fulfilled").value;
      assert.equal(await page.evaluate(reservation => window.RoutingStoreTest.createAiOrchestrator().releaseEvaluation(reservation, 0.01), accepted), true);
      assert.equal(await other.evaluate(reservation => window.RoutingStoreTest.createAiOrchestrator().releaseEvaluation(reservation, 0.01), accepted), false);
      assert.ok(Math.abs((await page.evaluate(() => window.__RKStudio.aiRouting.state())).evaluationReserved - saved.evaluationReserved - 0.01) < 1e-9);
    } finally { await other.close(); }
    const expectedPolicy = (await page.evaluate(() => window.__RKStudio.aiRouting.state())).policy;
    await page.locator('[data-act="set-back"]').click();
    assert.equal(await panel.count(), 0);
    assert.equal(await page.locator("[data-aiuse-reset]").count(), 1);
    assert.deepEqual((await page.evaluate(() => window.__RKStudio.aiRouting.state())).policy, expectedPolicy, "Back must not reset routing settings");
    await page.reload();
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    assert.deepEqual((await page.evaluate(() => window.__RKStudio.aiRouting.state())).policy, expectedPolicy);
    await page.locator("[data-opensettings]").click();
    await page.locator('[data-act="settings-cat"][data-cat="ai"]').click();
    assert.equal(await panel.count(), 0);
    await page.getByRole("button", { name: "Open AI settings", exact: true }).click();
    await panel.getByText(/3 accessible models/).waitFor();
    assert.equal(await panel.count(), 1);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await panel.evaluate(element => {
      const style = getComputedStyle(element), family = style.getPropertyValue("--sans").split(",")[0].replace(/["']/g, "").trim();
      return style.fontFamily.includes(family) && [...document.fonts].some(face => face.family.replace(/["']/g, "") === family && face.status === "loaded");
    }), true, "The routing panel must use the loaded Studio body font");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await panel.locator('[data-route-refresh]').scrollIntoViewIfNeeded();
      const bounds = await panel.evaluate(element => {
        const rectangle = element.getBoundingClientRect();
        return { panel: [rectangle.left, rectangle.right], viewport: innerWidth, overflow: [...element.querySelectorAll('input:not([hidden]),select,button:not([hidden])')].filter(control => control.getClientRects().length).map(control => ({ left: control.getBoundingClientRect().left, right: control.getBoundingClientRect().right, label: control.getAttribute('aria-label') || control.textContent })).filter(control => control.left < rectangle.left - 1 || control.right > rectangle.right + 1) };
      });
      assert.ok(bounds.panel[0] >= 0 && bounds.panel[1] <= bounds.viewport + 1, JSON.stringify(bounds));
      assert.deepEqual(bounds.overflow, []);
      await page.screenshot({ path: join(tmpdir(), "rk-ai-routing-" + width + ".png") });
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("native deck storage commits original assets and rejects stale or misrouted saves", { timeout: 30000 }, async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./src/js/slide-studio-deck.mjs", import.meta.url))], bundle: true, format: "iife", globalName: "StudioDeckStorage", write: false });
  const recoveryBundle = await build({ entryPoints: [fileURLToPath(new URL("./src/js/studio-draft-recovery.mjs", import.meta.url))], bundle: true, format: "iife", globalName: "StudioRecovery", write: false });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage();
  try {
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/404.html");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.addScriptTag({ content: recoveryBundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const { createStudioDeck, studioDeckReference, saveStudioDeck, loadStudioDeck, studioDeckBackup, restoreStudioDeckBackup } = window.StudioDeckStorage;
      const first = studioDeckReference("case-one"), second = studioDeckReference("case-two");
      const document = createStudioDeck("Original deck");
      document.slides = [{ id: "slide-one", title: "Slide", notes: "Private notes", durationMinutes: 1.5, scene: { version: 1, elements: [{ id: "image", type: "image", fileId: "original" }], files: { original: { id: "original", mimeType: "image/svg+xml", dataURL: "data:image/svg+xml;base64,PHN2Zy8+", originalDataURL: "data:image/svg+xml;base64,PHN2Zz48dGl0bGU+T3JpZ2luYWw8L3RpdGxlPjwvc3ZnPg==" } } } }];
      document.selected = "slide-one";
      const original = JSON.stringify(document);
      const saved = await saveStudioDeck(first, document);
      const restored = await loadStudioDeck(saved);
      const revision = await saveStudioDeck(saved, { ...document, title: "Updated deck" });
      const failures = {};
      for (const [key, operation] of Object.entries({ stale: () => saveStudioDeck(saved, document), wrongCase: () => loadStudioDeck({ ...saved, caseStudyId: "case-two" }), closed: () => saveStudioDeck(revision, document, { isCurrent: () => false }) })) {
        try { await operation(); } catch (error) { failures[key] = error.name + ": " + error.message; }
      }
      const other = await saveStudioDeck(second, createStudioDeck("Other case"));
      const backup = await studioDeckBackup({ work: [{ id: "case-one", title: "Case", study: { nativeDeck: saved } }, { id: "case-two", study: { nativeDeck: other } }] });
      const recovered = await restoreStudioDeckBackup(JSON.parse(JSON.stringify(backup)), ["case-one"]);
      const recoveredReference = recovered.work[0].study.nativeDeck;
      const archive = await window.StudioRecovery.archiveStudioDraft(backup, "previous-publish");
      await window.StudioRecovery.archiveStudioDraft(backup, "previous-publish");
      await window.StudioRecovery.saveStudioPublishedDraft("published-revision", recovered);
      const baseline = await window.StudioRecovery.studioPublishedDraft("published-revision");
      const archived = await window.StudioRecovery.studioDraftRecoveries(archive.id);
      const archives = await window.StudioRecovery.studioDraftRecoveries();
      const broken = structuredClone(backup); delete broken.nativeDecksBackup;
      try { await restoreStudioDeckBackup(broken, ["case-one"]); } catch (error) { failures.backup = error.message; }
      return { roundtrip: JSON.stringify(restored.document) === original, originalUnchanged: JSON.stringify(document) === original, firstTitle: (await loadStudioDeck(saved)).document.title, latestTitle: (await loadStudioDeck(saved, { latest: true })).document.title, otherTitle: (await loadStudioDeck(other)).document.title, failures, revision: revision.revision,
        recovery: { count: archives.length, cases: archives[0].cases, roundtrip: JSON.stringify(archived.backup) === JSON.stringify(backup), metadataOnly: !Object.hasOwn(archives[0], "backup"), baseline: JSON.stringify(baseline) === JSON.stringify(recovered), differentRevision: await window.StudioRecovery.studioPublishedDraft("unknown-revision") },
        backup: { documents: backup.nativeDecksBackup.documents.length, newIdentity: recoveredReference.id !== saved.id, title: (await loadStudioDeck(recoveredReference)).document.title, originalMedia: (await loadStudioDeck(recoveredReference)).document.slides[0].scene.files.original.originalDataURL, unchangedOther: recovered.work[1].study.nativeDeck.id === other.id, noEnvelope: !Object.hasOwn(recovered, "nativeDecksBackup") } };
    });
    assert.equal(result.roundtrip, true);
    assert.equal(result.originalUnchanged, true);
    assert.equal(result.firstTitle, "Original deck");
    assert.equal(result.latestTitle, "Updated deck");
    assert.equal(result.otherTitle, "Other case");
    assert.equal(result.revision, 2);
    assert.match(result.failures.stale, /StudioDeckConflictError/);
    assert.match(result.failures.wrongCase, /another case study/);
    assert.match(result.failures.closed, /session has changed/);
    assert.match(result.failures.backup, /missing the native deck/);
    assert.equal(result.backup.documents, 2);
    assert.equal(result.backup.newIdentity, true);
    assert.equal(result.backup.title, "Updated deck");
    assert.equal(result.backup.originalMedia, "data:image/svg+xml;base64,PHN2Zz48dGl0bGU+T3JpZ2luYWw8L3RpdGxlPjwvc3ZnPg==");
    assert.equal(result.backup.unchangedOther, true);
    assert.equal(result.backup.noEnvelope, true);
    assert.deepEqual(result.recovery, { count: 1, cases: 2, roundtrip: true, metadataOnly: true, baseline: true, differentRevision: null });
  } finally { await browser.close(); }
});

test("Studio preserves an older draft through recovery failure, cancel and selective restore", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.addInitScript(() => localStorage.setItem("rk:dev:stub", "1"));
    await page.route("**/*", route => {
      const request = route.request();
      if (!["127.0.0.1", "localhost"].includes(new URL(request.url()).hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/studio/?devstub");
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    const original = await page.evaluate(() => {
      const draft = structuredClone(window.RK.published || window.RK.data);
      draft.work = [{ id: "recovery-case", title: "Unfinished case study", study: { blocks: [{ type: "statement", body: "Keep this draft" }] } }];
      const serialized = JSON.stringify(draft);
      localStorage.setItem("rk:content:draft", serialized); localStorage.setItem("rk:content:draft:sig", "older-published-version");
      window.recoveryTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...options) {
        if (this.name === "rk-studio-draft-recovery-v1" && mode === "readwrite") throw new DOMException("Test recovery quota", "QuotaExceededError");
        return window.recoveryTransaction.call(this, stores, mode, ...options);
      };
      window.__rkDevStudio(); return serialized;
    });
    await page.getByRole("dialog", { name: "Draft recovery paused" }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("rk:content:draft")), original);
    await page.evaluate(() => { IDBDatabase.prototype.transaction = window.recoveryTransaction; document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()); });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.locator(".bkr [data-go]").waitFor();
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work.some(work => work.id === "recovery-case")), false);
    await page.locator(".bkr [data-cancel]").click();
    await page.locator("[data-opensettings]").click();
    await page.locator('[data-act="settings-cat"][data-cat="backup"]').click();
    await page.locator('[data-act="draft-recovery"]').click();
    await page.getByRole("button", { name: "Review draft", exact: true }).click();
    await page.locator(".bkr [data-go]").click();
    await page.waitForSelector(".bkr", { state: "detached" });
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work.find(work => work.id === "recovery-case")?.study.blocks[0].body), "Keep this draft");
    const archives = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("rk-studio-draft-recovery-v1", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, count = database.transaction("drafts", "readonly").objectStore("drafts").count();
        count.onsuccess = () => { database.close(); resolve(count.result); };
        count.onerror = () => { database.close(); reject(count.error); };
      };
    }));
    assert.equal(archives, 1);
    const concurrent = await page.evaluate(async () => {
      const older = window.__RKStudio.getDraft();
      localStorage.setItem('rk:content:draft', JSON.stringify(older));
      localStorage.setItem('rk:content:draft:sig', 'older-again');
      const newer = structuredClone(older); newer.work[0].title = 'Newer work from another tab';
      const put = IDBObjectStore.prototype.put;
      let changed = false;
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (!changed && this.transaction.db.name === 'rk-studio-draft-recovery-v1') {
          changed = true;
          localStorage.setItem('rk:content:draft', JSON.stringify(newer));
          localStorage.setItem('rk:content:draft:sig', window.RK.publishedSig);
        }
        return request;
      };
      try {
        await window.__RKStudio.open();
        return { changed, kept: window.__RKStudio.getDraft().work[0].title === newer.work[0].title, stored: localStorage.getItem('rk:content:draft') === JSON.stringify(newer) };
      } finally { IDBObjectStore.prototype.put = put; }
    });
    assert.deepEqual(concurrent, { changed: true, kept: true, stored: true }, 'Archiving an old draft must not erase a newer save from another tab');
  } finally { await browser.close(); }
});

test("Studio Publish shares private/public deck, case-section, retry and owner-reopen workflows", { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage(), errors = [], uploads = new Map(), writes = [], publicUploads = [];
  const base = process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510", passphrase = "synthetic-publish-test-only";
  let failNext = false, latest, holdWrite = false, releaseWrite;
  const source = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  source.specialViews = []; source.work = [{ id: "publish-case", title: "Shared publishing", client: "Studio", featured: true, study: { blocks: [{ type: "statement", body: "Published section" }] } }];
  latest = structuredClone(source);
  const routes = async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith("/content.json")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(latest) });
    if (url.pathname.includes("/assets/protected/")) {
      const assetPath = "/assets/protected/" + url.pathname.split("/assets/protected/")[1];
      if (request.method() === "PUT") {
        uploads.set(assetPath, Buffer.from(request.postDataJSON().content, "base64"));
        return route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
      }
      if (uploads.has(assetPath)) return route.fulfill({ contentType: "application/octet-stream", body: uploads.get(assetPath) });
    }
    if (url.pathname === "/admin/content") {
      const value = request.postDataJSON(); writes.push(value);
      if (failNext) { failNext = false; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic publish failure" }) }); }
      if (holdWrite) { holdWrite = false; await new Promise(resolve => { releaseWrite = resolve; }); }
      latest = value;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, git: { ok: true } }) });
    }
    if (url.pathname === "/admin/media/put") {
      publicUploads.push(request.postDataBuffer());
      return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
    }
    if (url.hostname === "rk-ai-proxy.riteshkumarhk.workers.dev") return route.fulfill({ contentType: "application/json", body: url.pathname.includes("publish") ? '{"enabled":false}' : "{}" });
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
    return route.continue();
  };
  await context.route("**/*", routes);
  await context.addInitScript(() => {
    localStorage.setItem("rk:dev:stub", "1");
    localStorage.setItem("rk:admin:sess", JSON.stringify({ token: "synthetic-local-test", exp: Date.now() + 3600000 }));
    localStorage.setItem("rk:trust", JSON.stringify({ token: "synthetic-local-test", exp: Date.now() + 3600000 }));
    localStorage.setItem("rk:autopub:on", "0");
    navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException("Denied in test", "NotAllowedError"));
  });
  page.on("pageerror", error => errors.push(error.message));
  const reopenStudio = async target => {
    await target.goto(base + "/studio/?devstub&nativeSlides=1");
    await target.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await target.evaluate(() => window.__rkDevStudio());
    await target.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await target.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    await target.locator('.adm__tab[data-tab="work"]').click();
  };
  try {
    await page.goto(base + "/studio/slide-merge-lab/");
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector(".merge-layout-toggle")?.disabled);
    const document = await page.evaluate(() => {
      const deck = window.__slideMerge.deck(); deck.slides = [deck.slides[0]]; deck.title = "Shared publishing"; deck.slidesPublic = false;
      deck.slides[0].notes = "PRIVATE INITIAL NOTES";
      const shape = deck.slides[0].scene.elements.find(element => element.type === "rectangle");
      const original = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#24ba98"/></svg>');
      deck.slides[0].scene.files = { original: { id: "original", mimeType: "image/svg+xml", dataURL: original, originalDataURL: original, created: 1 } };
      deck.slides[0].scene.elements.push({ ...shape, id: "original-image", type: "image", fileId: "original", status: "saved", scale: [1, 1], x: 920, y: 480, width: 200, height: 120, boundElements: null, groupIds: [] });
      const hidden = structuredClone(deck.slides[0]); hidden.id = "hidden-slide"; hidden.title = "HIDDEN SLIDE"; hidden.hidden = true; hidden.notes = "HIDDEN NOTES";
      deck.slides.push(hidden); return deck;
    });
    await reopenStudio(page);
    const bundle = await build({ entryPoints: [fileURLToPath(new URL("./src/js/slide-studio-deck.mjs", import.meta.url))], bundle: true, format: "iife", globalName: "StudioDeckStorage", write: false });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async document => {
      const storage = window.StudioDeckStorage;
      const reference = await storage.saveStudioDeck(storage.studioDeckReference("publish-case"), document);
      window.__rkDevEdit("work.0.study.nativeDeck", { ...reference, slideCount: document.slides.length });
      window.__rkDevEdit("work.0.study.blocks", [{ type: "statement", body: "Visible shared section" }, { type: "statement", body: "UNPUBLISHED CASE SECTION", off: true }]);
    }, document);
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector(".merge-notes-input")?.textContent === "PRIVATE INITIAL NOTES");
    await page.locator('.merge-slide').nth(1).click();
    await page.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'HIDDEN NOTES');
    await page.locator('.merge-slide').first().click();
    await page.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'PRIVATE INITIAL NOTES');
    await page.locator(".merge-notes-input").fill("PRIVATE CURRENT NOTES");
    await page.locator("[data-publish]").click();
    await page.locator('.pass--lock input[type="password"]').first().fill(passphrase);
    const confirmation = page.locator(".pass--lock [data-confirm]"); if (await confirmation.count()) await confirmation.fill(passphrase);
    await page.locator(".pass--lock [data-go]").click();
    await page.waitForFunction(() => document.querySelector(".adm__statusbar")?.classList.contains("is-pub-done"));
    assert.equal(writes.length, 1); assert.equal(publicUploads.length, 0, "Private assets must never be uploaded to public hosting");
    assert.equal(latest.work[0].study.nativeDeckPublic, undefined);
    assert.doesNotMatch(JSON.stringify(latest), /PRIVATE CURRENT NOTES|UNPUBLISHED CASE SECTION|HIDDEN SLIDE|nativeDeck"/);
    const privateEnvelope = latest.work[0].study.nativeDeckEnc;
    const savedOwner = await rkDecWithSek(await rkUnwrapSek(passphrase, privateEnvelope.wraps.owner), privateEnvelope);
    assert.equal(savedOwner.document.slides[0].notes, "PRIVATE CURRENT NOTES");
    assert.equal(savedOwner.document.slides.length, 2);
    assert.match(savedOwner.document.slides[0].scene.files.original.originalDataURL, /^rkenc:/);
    await page.locator(".merge-visibility summary").click();
    assert.match(await page.locator(".merge-visibility-status").innerText(), /owner-only/);
    await page.getByRole("checkbox", { name: "Public slideshow", exact: true }).click();
    await page.getByRole("button", { name: "Set public draft", exact: true }).click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.slidesPublic === true);
    const previousPublished = JSON.stringify(latest);
    failNext = true;
    await page.locator("[data-publish]").click();
    await page.waitForFunction(() => document.querySelector(".adm__statusbar")?.classList.contains("is-pub-error"));
    assert.equal(JSON.stringify(latest), previousPublished, "A failed publish must keep the previously live version");
    assert.equal(await page.locator(".merge-notes-input").innerText(), "PRIVATE CURRENT NOTES");
    await page.locator("[data-publish]").click();
    await page.waitForFunction(() => document.querySelector(".adm__statusbar")?.classList.contains("is-pub-done"));
    assert.equal(latest.work[0].study.nativeDeckPublic.slides.length, 1);
    assert.ok(publicUploads.some(bytes => bytes.equals(Buffer.from(document.slides[0].scene.files.original.originalDataURL.split(',')[1], 'base64'))), "Public upload must preserve original SVG bytes");
    assert.doesNotMatch(JSON.stringify(latest.work[0].study.nativeDeckPublic), /PRIVATE|HIDDEN|notes|durationMinutes/);
    assert.equal(latest.work[0].study.blocks.length, 1);
    await page.locator('.merge-slide').nth(1).click();
    await page.waitForFunction(() => document.querySelector('[data-publish]')?.hidden === true, null, { timeout: 5000 }).catch(async error => {
      const changes = await page.evaluate(async () => {
        const current = window.__RKStudio.getDraft().work[0].study.nativeDeck, published = window.RK.studioPublished.work[0].study.nativeDeck;
        const before = await window.StudioDeckStorage.loadStudioDeck(published), after = await window.StudioDeckStorage.loadStudioDeck(current);
        const differences = [];
        const scan = (first, second, path = '') => {
          if (JSON.stringify(first) === JSON.stringify(second)) return;
          if (first && second && typeof first === 'object' && typeof second === 'object') for (const key of new Set([...Object.keys(first), ...Object.keys(second)])) scan(first[key], second[key], path + '.' + key);
          else if (!/appState|versionNonce|updated|\.version$|\.selected$/.test(path)) differences.push({ path, before: first, after: second });
        };
        scan(before.document, after.document);
        return { current, published, differences };
      });
      throw new Error('Navigation changed published content: ' + JSON.stringify(changes), { cause: error });
    });
    assert.match(await page.locator('[data-native-slide-status]').innerText(), /all changes published/);
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached' });
    await page.reload(); await page.waitForFunction(() => typeof window.__rkDevStudio === 'function' && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio()); await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    assert.match(await page.locator('.adm__status').innerText(), /Published|All changes published/);
    const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await fresh.route('**/*', routes);
    await fresh.addInitScript(() => localStorage.setItem('rk:dev:stub', '1'));
    const newDevice = await fresh.newPage();
    try {
      await reopenStudio(newDevice);
      await newDevice.locator('[data-act="study-slides"][data-index="0"]').click();
      await newDevice.locator('.pass--lock input[type="password"]').fill(passphrase);
      assert.equal(await newDevice.locator('.pass--lock [data-confirm]').count(), 0, 'Existing deck protection must not create a new recovery passphrase');
      await newDevice.locator('.pass--lock [data-go]').click();
      await newDevice.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'PRIVATE CURRENT NOTES');
      assert.equal(await newDevice.evaluate(() => window.__RKStudio.getDraft().work[0].study.blocks[1].body), 'UNPUBLISHED CASE SECTION');
      await newDevice.locator('.merge-notes-input').fill('Private change on new device');
      await newDevice.locator('[data-l2-back]').click();
      await newDevice.waitForSelector('.merge-shell', { state: 'detached' });
      assert.ok(await newDevice.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck?.revision > 0));
    } finally { await fresh.close(); }
    await page.evaluate(() => document.querySelectorAll('.pass--lock').forEach(dialog => dialog.remove()));
    await page.locator('.adm__tab[data-tab="work"]').click();
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => !!document.querySelector('.merge-visibility summary') && document.querySelector('.merge-layout-toggle')?.disabled === false);
    await page.locator('.merge-visibility summary').click();
    await page.getByRole('checkbox', { name: 'Public slideshow', exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.slidesPublic === false);
    const publishedNotes = await page.locator('.merge-notes-input').innerText();
    const publicUploadCount = publicUploads.length;
    holdWrite = true;
    await page.locator('[data-publish]').click();
    await page.locator('.pass--lock input[type="password"]').fill(passphrase);
    await page.locator('.pass--lock [data-go]').click();
    await page.waitForFunction(() => document.querySelector('.adm__status')?.textContent.includes('Publishing your content'));
    const newNotes = 'NEWER UNPUBLISHED PRIVATE NOTES';
    await page.locator('.merge-notes-input').fill(newNotes);
    await page.locator('.merge-notes-input').press('Tab');
    assert.ok(releaseWrite, 'The mocked service must be holding the current publication');
    releaseWrite();
    await page.waitForFunction(() => document.querySelector('.adm__statusbar')?.classList.contains('is-pub-done'));
    await page.waitForFunction(() => document.querySelector('[data-native-slide-status]')?.textContent.includes('unpublished'));
    assert.equal(latest.work[0].study.slidesPublic, false);
    assert.equal(latest.work[0].study.nativeDeckPublic, undefined);
    assert.equal(publicUploads.length, publicUploadCount, 'Returning to owner-only must not upload any public deck assets');
    const privateAgain = latest.work[0].study.nativeDeckEnc;
    const publishedOwner = await rkDecWithSek(await rkUnwrapSek(passphrase, privateAgain.wraps.owner), privateAgain);
    assert.equal(publishedOwner.document.slides.find(slide => slide.id === publishedOwner.document.selected).notes, publishedNotes);
    assert.doesNotMatch(JSON.stringify(publishedOwner), /NEWER UNPUBLISHED PRIVATE NOTES/);
    assert.equal(await page.locator('.merge-notes-input').innerText(), newNotes);
    assert.equal(await page.locator('[data-publish]').isVisible(), true);
    await page.evaluate(() => Object.defineProperty(window, 'documentPictureInPicture', { value: undefined, configurable: true }));
    for (const mounted of [true, false]) {
      if (!mounted) { await page.locator('[data-l2-back]').click(); await page.waitForSelector('.merge-shell', { state: 'detached' }); }
      await page.evaluate(async () => { window.hostPlayer = await window.RK.presentDeck(window.__RKStudio.getDraft().work[0], { autoStart: false }); });
      const waiting = page.waitForEvent('popup');
      await page.getByRole('button', { name: 'Open presenter window', exact: true }).click();
      const presenter = await waiting;
      const note = mounted ? 'Host presenter with editor' : 'Host presenter without editor';
      await presenter.locator('[data-pp-notes]').fill(note);
      await presenter.locator('[data-pp-notes]').press('Tab');
      await presenter.waitForFunction(() => document.querySelector('[data-pp-save]')?.textContent.includes('Saved to deck'));
      await presenter.locator('[data-pp="exit"]').click();
      await page.waitForSelector('.pjp', { state: 'detached' });
      const savedNote = await page.evaluate(() => new Promise((resolve, reject) => {
        const reference = window.__RKStudio.getDraft().work[0].study.nativeDeck;
        const request = indexedDB.open('rk-studio-slide-decks-v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result, document = database.transaction('documents').objectStore('documents').get([reference.id, reference.revision]);
          document.onsuccess = () => { database.close(); resolve(document.result.document.slides.find(slide => !slide.hidden).notes); };
          document.onerror = () => { database.close(); reject(document.error); };
        };
      }));
      assert.equal(savedNote, note);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("hosted editor loads empty, uses its save adapter and disposes without lab globals", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/404.html");
    await page.evaluate(async () => {
      const container = document.createElement("div"); container.id = "pilot";
      document.body.replaceChildren(container);
      const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/studio/slide-lab/assets/editor.css"; document.head.append(link);
      window.__RKStudio = { getDraft: () => ({ work: [{ id: "host-case", title: "Host case", study: { blocks: [{ type: "statement", body: "Host-owned section" }] } }] }) };
      window.hostSaves = [];
      const { mountSlideEditor } = await import("/studio/slide-lab/assets/editor.js");
      window.hostedEditor = mountSlideEditor(container, { caseStudyId: "host-case", title: "Host slides", load: async () => null, save: async document => { if (window.deferHostSave) await new Promise(resolve => { window.releaseHostSave = resolve; }); window.hostSaves.push(structuredClone(document)); } });
      await window.hostedEditor.ready;
    });
    await page.locator(".merge-empty-actions button").first().click();
    await page.waitForFunction(() => window.hostSaves.at(-1)?.slides.length === 1);
    await page.getByRole("textbox", { name: "Speaker notes", exact: true }).fill("Host notes, flushed before leaving");
    await page.evaluate(() => window.hostedEditor.flush());
    assert.equal(await page.evaluate(() => window.hostSaves.at(-1).slides[0].notes), "Host notes, flushed before leaving");
    assert.equal(await page.evaluate(() => typeof window.__slideMerge), "undefined");
    assert.equal(await page.locator(".merge-header").count(), 0);
    await page.getByRole("button", { name: "Sections", exact: true }).click();
    await page.locator(".merge-section-choices button").first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Host case", exact: true }).count(), 0, "The active case study must not need choosing again");
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.evaluate(() => { window.deferHostSave = true; });
    await page.getByRole('textbox', { name: 'Speaker notes', exact: true }).fill('A queued host write');
    await page.waitForFunction(() => typeof window.releaseHostSave === 'function');
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);
    await page.evaluate(() => { window.deferHostSave = false; window.releaseHostSave(); });
    await page.evaluate(() => window.hostedEditor.flush());
    await page.evaluate(() => window.hostedEditor.dispose());
    assert.equal(await page.locator(".merge-shell").count(), 0);
    const failure = await page.evaluate(async () => {
      const { mountSlideEditor } = await import("/studio/slide-lab/assets/editor.js");
      const editor = mountSlideEditor(document.querySelector("#pilot"), { caseStudyId: "failed", load: async () => { throw new Error("Missing deck revision"); }, save: async () => {} });
      try { await editor.ready; return "unexpected success"; } catch (error) { return error.message; } finally { editor.dispose(); }
    });
    assert.equal(failure, "Missing deck revision");
  } finally { await browser.close(); }
});

test("Content Studio opens native slides without a preview flag and preserves case drafts", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.addInitScript(() => localStorage.setItem("rk:dev:stub", "1"));
    await page.route("**/*", route => {
      const request = route.request();
      if (!["127.0.0.1", "localhost"].includes(new URL(request.url()).hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/studio/?devstub");
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__rkDevEdit && document.querySelector(".adm.is-open"));
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    await page.evaluate(() => window.__rkDevEdit("work", [
      { id: "native-first", title: "Native first case", study: { blocks: [{ type: "statement", body: "First case section" }], slides: [{ layout: "title", slots: { title: "Disposable v0 slide" } }] } },
      { id: "native-second", title: "Native second case", study: { blocks: [{ type: "statement", body: "Second case section" }] } }
    ]));
    await page.locator('.adm__tab[data-tab="work"]').click();
    const hostStyle = await page.locator('.adm__tab[data-tab="work"]').evaluate(element => {
      const style = getComputedStyle(element); return { font: style.fontFamily, fontSize: style.fontSize, radius: style.borderRadius, height: element.getBoundingClientRect().height };
    });
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.locator(".merge-empty-actions button").first().waitFor();
    assert.equal(await page.locator(".merge-header").count(), 0);
    assert.equal(await page.locator("[data-native-slide-toolbar] .merge-editor-bar:visible").count(), 1);
    assert.equal(await page.locator("[data-native-slide-status] .merge-status:visible").count(), 1);
    assert.equal(await page.getByRole('contentinfo', { name: 'Document status', exact: true }).count(), 1);
    assert.equal(await page.locator(".slides__nav:visible,.slides__props:visible").count(), 0);
    await page.locator(".merge-empty-actions button").first().click();
    await page.getByRole('button', { name: 'Text (T)', exact: true }).click();
    await page.locator('.excalidraw__canvas.interactive').click({ position: { x: 600, y: 230 } });
    await page.keyboard.type('Native canvas content');
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached' });
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector('.merge-slide-list')?.textContent.includes('Untitled slide'));
    const savedText = await page.evaluate(async () => {
      const reference = window.__RKStudio.getDraft().work[0].study.nativeDeck;
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('rk-studio-slide-decks-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => { const request = database.transaction('documents').objectStore('documents').get([reference.id, reference.revision]); request.onsuccess = () => resolve(request.result.document.slides[0].scene.elements.filter(element => element.type === 'text').map(element => element.text)); request.onerror = () => reject(request.error); }); } finally { database.close(); }
    });
    assert.deepEqual(savedText, ['Native canvas content'], 'Leaving flushes an active native text editor');
    await page.getByRole("textbox", { name: "Speaker notes", exact: true }).fill("FIRST PRIVATE NOTE");
    await page.locator("[data-l2-back]").click();
    await page.waitForSelector(".merge-shell", { state: "detached" });
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    await page.locator("[data-l2-back]").click();
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector(".merge-notes-input")?.textContent === "FIRST PRIVATE NOTE");
    await page.locator("[data-l2-back]").click();
    await page.waitForSelector(".merge-shell", { state: "detached" });
    await page.locator('[data-act="study-slides"][data-index="1"]').click();
    await page.locator(".merge-empty-actions button").first().waitFor();
    await page.locator(".merge-empty-actions button").first().click();
    await page.getByRole("textbox", { name: "Speaker notes", exact: true }).fill("SECOND PRIVATE NOTE");
    await page.locator("[data-l2-back]").click();
    await page.waitForSelector(".merge-shell", { state: "detached" });
    const references = await page.evaluate(() => window.__RKStudio.getDraft().work.map(work => work.study.nativeDeck));
    assert.notEqual(references[0].id, references[1].id);
    assert.equal(references[0].caseStudyId, "native-first");
    assert.equal(references[1].caseStudyId, "native-second");
    assert.equal(await page.evaluate(() => localStorage.getItem("rk:content:draft").includes("PRIVATE NOTE")), false);
    await page.reload();
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    await page.locator('.adm__tab[data-tab="work"]').click();
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector(".merge-notes-input")?.textContent === "FIRST PRIVATE NOTE");
    assert.equal(await page.evaluate(() => typeof window.__slideMerge), "undefined");
    await page.locator('.merge-notes-input').press('Tab');
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('.merge-notes-input').innerText(), 'FIRST PRIVATE NOTE', 'Empty native Undo must not step host history');
    for (const width of [1440, 1060, 1024, 1023, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.evaluate(() => {
        const shell = document.querySelector('.merge-shell').getBoundingClientRect(), main = document.querySelector('.adm__main').getBoundingClientRect(), bar = document.querySelector('.adm__workbar').getBoundingClientRect(), footer = document.querySelector('.adm__statusbar').getBoundingClientRect();
        const brand = document.querySelector('.adm__brand').getBoundingClientRect(), tabs = document.querySelector('.adm__tabswrap').getBoundingClientRect(), actions = document.querySelector('.adm__actions').getBoundingClientRect(), nav = document.querySelector('.adm__tabs');
        return { shell: shell.toJSON(), main: main.toJSON(), bar: bar.toJSON(), footer: footer.toJSON(), overflow: document.documentElement.scrollWidth > innerWidth, brand: brand.toJSON(), tabs: tabs.toJSON(), actions: actions.toJSON(), tabOverflow: nav.scrollWidth - nav.clientWidth > 2, flippers: [...document.querySelectorAll('[data-tabflip]')].map(button => !button.hidden) };
      });
      if (width >= 1024) {
        assert.ok(Math.abs((geometry.brand.top + geometry.brand.bottom - geometry.actions.top - geometry.actions.bottom) / 2) < 1, 'Brand and actions must share one row');
        assert.ok(Math.abs((geometry.tabs.top + geometry.tabs.bottom - geometry.actions.top - geometry.actions.bottom) / 2) < 1, 'Tabs must remain beside the actions');
        assert.ok(geometry.brand.right <= geometry.tabs.left && geometry.tabs.right <= geometry.actions.left, 'The nav groups must not overlap');
      } else assert.ok(geometry.tabs.top >= Math.max(geometry.brand.bottom, geometry.actions.bottom), 'Narrow screens keep a separate tabs row');
      assert.deepEqual(geometry.flippers, [geometry.tabOverflow, geometry.tabOverflow]);
      assert.ok(geometry.shell.height > 400 && geometry.shell.width > width - 50, JSON.stringify(geometry));
      assert.ok(geometry.shell.top >= geometry.bar.bottom && geometry.shell.bottom <= geometry.footer.top + 1, JSON.stringify(geometry));
      assert.ok(geometry.shell.top - geometry.bar.bottom < 80, 'The host title row must not retain the old inspector padding');
      assert.equal(geometry.overflow, false);
      await page.screenshot({ path: join(tmpdir(), `rk-studio-native-pilot-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      window.originalDeckTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (names, mode, ...options) {
        if (this.name === 'rk-studio-slide-decks-v1' && mode === 'readwrite') throw new DOMException('Test storage quota', 'QuotaExceededError');
        return window.originalDeckTransaction.call(this, names, mode, ...options);
      };
    });
    await page.getByRole('textbox', { name: 'Speaker notes', exact: true }).fill('Pending notes must stay open');
    await page.locator('[data-l2-back]').click();
    await page.waitForFunction(() => document.querySelector('[data-native-slide-status]')?.textContent.includes('Not saved'));
    assert.equal(await page.locator('.merge-notes-input').innerText(), 'Pending notes must stay open');
    assert.equal(await page.locator('.merge-shell').count(), 1);
    await page.evaluate(() => { IDBDatabase.prototype.transaction = window.originalDeckTransaction; delete window.originalDeckTransaction; });
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached' });
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'Pending notes must stay open');
    await page.locator('.merge-visibility summary').click();
    assert.equal(await page.getByRole('checkbox', { name: 'Public slideshow', exact: true }).isChecked(), false);
    assert.equal(await page.getByRole('checkbox', { name: 'Public slideshow', exact: true }).isEnabled(), true);
    assert.match(await page.locator('.merge-visibility-status').innerText(), /not published/);
    await page.keyboard.press('Escape');
    await page.locator('[data-opensettings]').click();
    await page.locator('[data-act="settings-cat"][data-cat="backup"]').click();
    const downloading = page.waitForEvent('download');
    await page.locator('[data-act="backup-dl"]').click();
    const download = await downloading;
    const downloaded = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(downloaded.nativeDecksBackup.documents.length, 2);
    assert.ok(downloaded.nativeDecksBackup.documents.some(record => record.document.slides[0].notes === 'Pending notes must stay open'));
    const choosingFile = page.waitForEvent('filechooser');
    await page.locator('[data-act="backup-restore"]').click();
    await (await choosingFile).setFiles({ name: 'private-native-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(downloaded)) });
    await page.locator('[data-bkr-work="native-second"]').uncheck();
    await page.locator('.bkr [data-go]').click();
    await page.waitForSelector('.bkr', { state: 'detached' });
    const recoveredReferences = await page.evaluate(() => window.__RKStudio.getDraft().work.map(work => work.study.nativeDeck));
    assert.notEqual(recoveredReferences[0].id, references[0].id);
    assert.equal(recoveredReferences[1].id, references[1].id);
    await page.locator('.adm__tab[data-tab="work"]').focus();
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck.id), references[0].id, 'Undo recovery must restore the previous native deck identity');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck.id), recoveredReferences[0].id, 'Redo recovery must reinstate the recovered native deck');
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'Pending notes must stay open');
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached' });
    assert.equal(await page.locator('link[href*="assets/editor.css"]').count(), 0, 'Editor styles must unload when the workspace closes');
    assert.deepEqual(await page.locator('.adm__tab[data-tab="work"]').evaluate(element => {
      const style = getComputedStyle(element); return { font: style.fontFamily, fontSize: style.fontSize, radius: style.borderRadius, height: element.getBoundingClientRect().height };
    }), hostStyle, 'The native editor must not alter the host navigation after unmount');
    await page.locator('[data-act="work-dup"][data-index="0"]').click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work.length === 3);
    const duplicate = await page.evaluate(() => { const [original, copied] = window.__RKStudio.getDraft().work; return { original: original.study.nativeDeck.id, copied: copied.study.nativeDeck.id, caseId: copied.id, owner: copied.study.nativeDeck.caseStudyId, hidden: copied.hidden }; });
    assert.notEqual(duplicate.copied, duplicate.original);
    assert.equal(duplicate.owner, duplicate.caseId);
    assert.equal(duplicate.hidden, true);
    await page.evaluate(() => window.__rkDevEdit('work.0.study.nativeDeck', { schema: 'rk-studio-native-deck', version: 1, caseStudyId: 'native-first', id: 'missing-native-deck', revision: 3 }));
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector('[data-native-slide-status]')?.textContent.includes('not available on this device'));
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached', timeout: 4000 });
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck.id), 'missing-native-deck');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});