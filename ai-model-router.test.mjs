import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAiModel, rankAiModels, estimateAiCost } from "./src/js/ai-model-router.mjs";
import { createAiCatalog, AI_REFERENCE_URL } from "./src/js/ai-model-catalog.mjs";
import { createAiOrchestrator } from "./src/js/ai-orchestrator.mjs";
import { aiEvaluationSuite } from "./src/js/ai-model-evaluations.mjs";

const now = Date.parse("2026-09-11T12:00:00Z");
const model = (id, extra = {}) => normalizeAiModel("test", { id, input_modalities: ["text", "image"], output_modalities: ["text"], max_input_tokens: 100000, max_tokens: 16000, created_at: "2026-08-01", ...extra });
const rating = (modelId, task, quality) => ({ provider: "test", modelId, task, quality, at: now - 1000 });

test("one catalogue routes analytical and creative tasks differently without model-name rankings", () => {
  const models = [model("model-one"), model("model-two")];
  const observations = [rating("model-one", "analysis", 0.95), rating("model-one", "creative", 0.2), rating("model-two", "analysis", 0.4), rating("model-two", "creative", 0.95)];
  assert.equal(rankAiModels(models, "analysis", { observations, now })[0].model.id, "model-one");
  assert.equal(rankAiModels(models, "creative", { observations, now })[0].model.id, "model-two");
  const renamed = models.map((entry, index) => ({ ...entry, id: `unknown-family-${index}` }));
  const renamedRatings = observations.map(entry => ({ ...entry, modelId: entry.modelId === "model-one" ? "unknown-family-0" : "unknown-family-1" }));
  assert.equal(rankAiModels(renamed, "creative", { observations: renamedRatings, now })[0].model.id, "unknown-family-1");
});

test("capability, context, output and budget requirements filter ineligible models", () => {
  const models = [model("eligible", { pricing: { input_per_million: 2, output_per_million: 8 } }), model("text-only", { input_modalities: ["text"] }), model("too-small", { max_tokens: 1000 }), model("wrong-output", { output_modalities: ["audio"] })];
  assert.deepEqual(rankAiModels(models, "vision", { now, inputTokens: 8000, outputTokens: 4000 }).map(entry => entry.model.id), ["eligible"]);
  assert.equal(estimateAiCost(models[0], 8000, 4000), 0.048);
  assert.equal(rankAiModels(models, "vision", { now, inputTokens: 8000, outputTokens: 4000, maxCost: 0.01 }).length, 0);
  assert.equal(rankAiModels([model("small-context", { context_window: 1000 })], "writing", { inputTokens: 900, outputTokens: 200, now }).length, 0);
  assert.equal(rankAiModels([model("separate-limits", { max_input_tokens: 1000 })], "writing", { inputTokens: 900, outputTokens: 200, now }).length, 1);
});

test("new models enter without a code change but cannot displace an incumbent on recency alone", () => {
  const known = model("established"), newcomer = model("unseen-model", { created_at: "2026-09-10" });
  const fresh = rankAiModels([known, newcomer], "creative", { now, incumbent: "established" });
  assert.equal(fresh[0].model.id, "established");
  assert.equal(fresh.find(choice => choice.model.id === "unseen-model").confidence, "provisional");
  const observations = Array.from({ length: 4 }, () => rating("unseen-model", "creative", 0.95));
  const evaluated = rankAiModels([known, newcomer], "creative", { now, observations, incumbent: "established" });
  assert.equal(evaluated[0].model.id, "unseen-model");
  assert.equal(evaluated[0].confidence, "evaluated");
});

test("provider facts override reference metadata and unknown capabilities stay explicit", () => {
  const normalized = normalizeAiModel("anthropic", { id: "arbitrary-id", capabilities: { image_input: { supported: false }, thinking: { supported: true }, structured_outputs: { supported: true } }, created_at: "1970-01-01T00:00:00Z", max_input_tokens: 10000, max_tokens: 2000 }, { modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 1000000, output: 128000 }, cost: { input: 5, output: 25 } });
  assert.equal(normalized.imageInput, false);
  assert.equal(normalized.maxInputTokens, 10000);
  assert.equal(normalized.contextWindow, 1000000);
  assert.equal(rankAiModels([normalized], "writing", { now, inputTokens: 11000 }).length, 0);
  assert.equal(normalized.maxOutputTokens, 2000);
  assert.equal(normalized.releasedAt, null);
  assert.equal(normalized.reasoning, true);
  assert.equal(rankAiModels([normalized], "vision", { now }).length, 0);
  const unknown = normalizeAiModel("test", { id: "new" });
  assert.equal(rankAiModels([unknown], "vision", { now, requireKnown: true }).length, 0);
  assert.equal(rankAiModels([unknown], "vision", { now }).length, 0);
  assert.ok(rankAiModels([{ ...unknown, sources: ["configured model"] }], "vision", { now })[0].unknown.includes("image input"));
  assert.equal(rankAiModels([model("unknown-format")], "writing", { now, structured: "required" }).length, 0);
  assert.equal(rankAiModels([unknown], "writing", { now, maxCost: 1 }).length, 0);
});

test("observations are endpoint-scoped and incompatibility cools down only the matching task", () => {
  const models = [model("first"), model("second")];
  const observations = [{ ...rating("first", "creative", 1), scope: "other-endpoint" }, { provider: "test", modelId: "first", task: "creative", scope: "current-endpoint", status: "unsupported", requirements: "text-json", at: now - 1000 }];
  assert.equal(rankAiModels(models, "creative", { observations, now, scope: "current-endpoint", requirements: "text-json" })[0].model.id, "second");
  assert.equal(rankAiModels(models, "writing", { observations, now, scope: "current-endpoint", requirements: "text-json" }).length, 2);
  assert.equal(rankAiModels(models, "creative", { observations, now: now + 16 * 60000, scope: "current-endpoint", requirements: "text-json" }).length, 2);
  assert.throws(() => rankAiModels(models, "invented"), /Unsupported AI task/);
});

test("discovery paginates live access and supplements only accessible IDs without exposing credentials", async () => {
  const requests = [];
  const catalogue = createAiCatalog({ now: () => now, fetch: async (url, options) => {
    requests.push({ url, options });
    if (url === AI_REFERENCE_URL) return Response.json({ anthropic: { models: { first: { modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 200000 }, cost: { input: 2, output: 8 } }, inaccessible: { name: "Not available" } } } });
    return Response.json(new URL(url).searchParams.has("after_id") ? { data: [{ id: "second", capabilities: { image_input: { supported: false } } }], has_more: false } : { data: [{ id: "first", max_tokens: 16000 }], has_more: true, last_id: "first" });
  } });
  const config = { provider: "anthropic", base: "https://provider.test/v1", key: "synthetic-secret" };
  const result = await catalogue.discover(config);
  assert.deepEqual(result.models.map(item => item.id), ["first", "second"]);
  assert.equal(result.models[0].imageInput, true);
  assert.equal(result.models[0].contextWindow, 200000);
  assert.equal(result.models[1].imageInput, false);
  assert.equal(requests[2].url, AI_REFERENCE_URL);
  assert.equal(requests[2].options.headers, undefined);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/);
  result.models.pop();
  assert.equal((await catalogue.discover(config)).models.length, 2);
  assert.equal(requests.length, 3);
});

test("discovery refreshes on expiry, explicit refresh or changed credentials, never caches a failure", async () => {
  let time = now, calls = 0, fail = true;
  const catalogue = createAiCatalog({ now: () => time, ttl: 1000, fetch: async () => {
    calls++;
    if (fail) { fail = false; return Response.json({}, { status: 401 }); }
    return Response.json({ data: [{ id: "model-" + calls, created: time / 1000 }] });
  } });
  const config = { provider: "openai", base: "https://provider.test/v1", key: "first-key" };
  await assert.rejects(catalogue.discover(config, { useReference: false }), /HTTP 401/);
  assert.equal((await catalogue.discover(config, { useReference: false })).models[0].id, "model-2");
  await catalogue.discover(config, { useReference: false }); assert.equal(calls, 2);
  time += 1001; await catalogue.discover(config, { useReference: false }); assert.equal(calls, 3);
  await catalogue.discover(config, { useReference: false, refresh: true }); assert.equal(calls, 4);
  await catalogue.discover({ ...config, key: "second-key" }, { useReference: false }); assert.equal(calls, 5);
});

test("Gemini and explicit custom models preserve their API conventions without guessed fallbacks", async () => {
  const requests = [];
  const catalogue = createAiCatalog({ fetch: async url => {
    requests.push(url);
    return Response.json(new URL(url).searchParams.has("pageToken") ? { models: [{ name: "models/second", supportedGenerationMethods: ["generateContent"], output_modalities: ["text"] }] } : { models: [{ name: "models/embedding", supportedGenerationMethods: ["embedContent"] }], nextPageToken: "next-page" });
  } });
  const gemini = await catalogue.discover({ provider: "gemini", base: "https://provider.test/v1beta", key: "synthetic" }, { useReference: false });
  assert.deepEqual(rankAiModels(gemini.models, "writing").map(choice => choice.model.id), ["second"]);
  assert.equal(new URL(requests[1]).searchParams.get("pageToken"), "next-page");
  const custom = await catalogue.discover({ provider: "custom", base: "https://custom.test/v1", key: "synthetic", model: "my-configured-model" });
  assert.equal(custom.models[0].id, "my-configured-model");
  assert.equal(custom.explicit, true); assert.equal(requests.length, 2);
  const zeroPlaceholder = normalizeAiModel("test", { id: "new" }, { cost: { input: 0, output: 0 } });
  assert.equal(estimateAiCost(zeroPlaceholder, 1000, 1000), null);
});

test("cancelled or malformed discovery cannot populate the catalogue", async () => {
  const controller = new AbortController(); let calls = 0;
  const catalogue = createAiCatalog({ fetch: async () => { calls++; controller.abort(); return Response.json({ data: [{ id: "late" }] }); } });
  await assert.rejects(catalogue.discover({ provider: "openai", base: "https://provider.test", key: "synthetic" }, { signal: controller.signal, useReference: false }), { name: "AbortError" });
  assert.equal(calls, 1);
  const invalid = createAiCatalog({ fetch: async () => Response.json({ unexpected: [] }) });
  await assert.rejects(invalid.discover({ provider: "openai", base: "https://provider.test", key: "synthetic" }, { useReference: false }), /invalid model catalogue/);
});

function memoryRoutingStore() {
  let state = { version: 1, policy: { maxCost: null, evaluationDailyBudget: 0, autoEvaluate: false, useReference: false, providers: "selected" }, observations: [], decisions: [], incumbents: {}, evaluationDay: "", evaluationReserved: 0 };
  let queue = Promise.resolve();
  return { read: async () => structuredClone(state), update: change => {
    const operation = queue.then(() => { const next = structuredClone(state), result = change(next); state = next; return result; });
    queue = operation.catch(() => {}); return operation;
  } };
}

function orchestratorFixture(models = [model("first"), model("second")]) {
  const store = memoryRoutingStore(); let sequence = 0;
  const catalog = { discover: async config => ({ scope: config.base, models: models.map(item => ({ ...item, provider: config.provider })) }) };
  const orchestrator = createAiOrchestrator({ catalog, store, now: () => now, randomId: () => String(++sequence) });
  return { store, orchestrator, config: { provider: "test", base: "https://provider.test", key: "DO-NOT-STORE-KEY" } };
}

test("orchestration explains fallback and stores metadata rather than credentials or source content", async () => {
  const { orchestrator, store, config } = orchestratorFixture(), calls = [], choices = [];
  const result = await orchestrator.run([config], "creative", { onRoute: choice => choices.push(choice) }, async (selected, modelId) => {
    assert.equal(selected.key, config.key); calls.push(modelId);
    return calls.length === 1 ? { ok: false, status: 404, err: "Model not found" } : { ok: true, text: "PRIVATE GENERATED CONTENT" };
  });
  assert.deepEqual(calls, ["first", "second"]);
  assert.equal(result.routing.fallback, true);
  assert.equal(result.routing.modelId, "second");
  assert.equal(choices.at(-1).status, "success");
  assert.doesNotMatch(JSON.stringify(await store.read()), /DO-NOT-STORE|PRIVATE GENERATED/);
  await orchestrator.feedback(result.routing.id, { quality: 0.9, reason: "design" });
  await orchestrator.feedback(result.routing.id, { quality: 0.8, reason: "clarity" });
  assert.equal((await store.read()).observations.filter(item => item.feedbackFor === result.routing.id).length, 1);
});

test("authentication, rate limits, partial output and cancellation never trigger model hopping", async () => {
  for (const failure of [{ status: 401, err: "Authentication failed" }, { status: 429, err: "Rate limit" }, { status: 503, err: "Unavailable service" }, { status: 400, err: "Unsupported request", emitted: true }]) {
    const { orchestrator, config } = orchestratorFixture(); let calls = 0;
    await assert.rejects(orchestrator.run([config], "analysis", {}, async () => { calls++; return { ok: false, ...failure }; }), new RegExp(failure.err));
    assert.equal(calls, 1);
  }
  const { orchestrator, config } = orchestratorFixture(), controller = new AbortController(); let calls = 0;
  await assert.rejects(orchestrator.run([config], "writing", { signal: controller.signal }, async () => { calls++; controller.abort(); return { ok: false, status: 404 }; }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("job budgets include fallback attempts and evaluation budgets reserve atomically", async () => {
  const { orchestrator, config, store } = orchestratorFixture([model("first", { pricing: { input: 10, output: 10 } }), model("second", { pricing: { input: 10, output: 10 } })]);
  await orchestrator.configure({ maxCost: 0.025 });
  let calls = 0;
  await assert.rejects(orchestrator.run([config], "writing", { inputTokens: 1000, outputTokens: 1000 }, async () => { calls++; return { ok: false, status: 404, err: "Model unavailable" }; }), /Model unavailable/);
  assert.equal(calls, 1);
  await assert.rejects(orchestrator.reserveEvaluation(0.01), /disabled or exhausted/);
  await orchestrator.configure({ evaluationDailyBudget: 0.03 });
  const results = await Promise.allSettled([orchestrator.reserveEvaluation(0.02), orchestrator.reserveEvaluation(0.02)]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal((await store.read()).evaluationReserved, 0.02);
  await assert.rejects(orchestrator.configure({ maxCost: -1 }), /positive request budget/);
});

test("imported task evaluations retain provenance and can change the preferred model", async () => {
  const { orchestrator, config, store } = orchestratorFixture();
  await orchestrator.run([config], "analysis", {}, async () => ({ ok: true, text: "Result" }));
  await orchestrator.importEvaluations([{ provider: "test", modelId: "second", task: "analysis", scope: config.base, quality: 0.95, samples: 6, at: now - 1000, rubric: "approved-analysis-suite-v1", prompt: "MUST NOT PERSIST" }]);
  assert.equal((await orchestrator.choices([config], "analysis"))[0].model.id, "second");
  assert.doesNotMatch(JSON.stringify(await store.read()), /MUST NOT PERSIST/);
  await assert.rejects(orchestrator.importEvaluations([{ task: "made-up" }]), /Invalid evaluation record/);
});

test("evaluation reservations cannot be released twice or forged", async () => {
  const { orchestrator, store } = orchestratorFixture();
  await orchestrator.configure({ evaluationDailyBudget: 0.1 });
  const first = await orchestrator.reserveEvaluation(0.03), second = await orchestrator.reserveEvaluation(0.04);
  assert.equal(await orchestrator.releaseEvaluation(first, 0.02), true);
  assert.equal(await orchestrator.releaseEvaluation(first, 0.02), false);
  assert.equal(await orchestrator.releaseEvaluation({ ...second, id: "forged" }, 0.04), false);
  assert.ok(Math.abs((await store.read()).evaluationReserved - 0.05) < 1e-10);
});

test("newcomer tests have explicit budgets, bounded calls, real rubrics and no stored generated content", async () => {
  const { orchestrator, config, store } = orchestratorFixture([model("first", { pricing: { input: 2, output: 8 } }), model("second", { pricing: { input: 2, output: 8 } })]);
  let calls = 0;
  const invoke = async (selected, modelId, fixture, options) => {
    calls++;
    assert.equal(options.maxTokens, 512);
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(selected.key, config.key);
    return { ok: true, text: ['{"percent":75}', '["A","C","B"]', '{"supported":false,"revenue":null}'][Number(fixture.id) - 1] };
  };
  await assert.rejects(orchestrator.evaluate([config], "analysis", {}, invoke), /evaluation budget/);
  assert.equal(calls, 0);
  await orchestrator.configure({ evaluationDailyBudget: 1 });
  const approval = await orchestrator.planEvaluation([config], "analysis");
  assert.equal(approval.calls, 3);
  assert.equal(calls, 0);
  const result = await orchestrator.evaluate([config], "analysis", { approval }, invoke);
  assert.equal(calls, 3);
  assert.ok(result.results.every(item => item.score === 1));
  const state = await store.read();
  assert.equal(state.observations.filter(item => item.source === "representative test").length, 3);
  assert.deepEqual(state.incumbents, {});
  assert.doesNotMatch(JSON.stringify(state), /DO-NOT-STORE|percent|PRIVATE GENERATED/);
  assert.equal((await orchestrator.choices([config], "analysis"))[0].confidence, "evaluated");
  await assert.rejects(orchestrator.evaluate([config], "analysis", { automatic: true }, invoke), /disabled/);
});

test("creative fixture conformance does not pretend to score creative quality and cancellation refunds only unstarted calls", async () => {
  const { orchestrator, config, store } = orchestratorFixture([model("first", { pricing: { input: 2, output: 8 } }), model("second", { pricing: { input: 2, output: 8 } })]);
  await orchestrator.configure({ evaluationDailyBudget: 1 });
  const result = await orchestrator.evaluate([config], "creative", {}, async () => ({ ok: true, text: '{"headline":"A clearer path","body":"Related settings now belong together."}' }));
  assert.ok(result.results.every(item => item.score === 1));
  assert.equal((await orchestrator.choices([config], "creative"))[0].confidence, "provisional");
  assert.ok((await store.read()).observations.every(item => item.quality == null));
  const controller = new AbortController(), approval = await orchestrator.planEvaluation([config], "coding");
  const before = (await store.read()).evaluationReserved;
  await assert.rejects(orchestrator.evaluate([config], "coding", { signal: controller.signal }, async () => { controller.abort(); throw controller.signal.reason; }), { name: "AbortError" });
  const spent = (await store.read()).evaluationReserved - before;
  assert.ok(spent > 0 && spent < approval.estimatedCost);
});

test("image generation never estimates a request from text-token prices", () => {
  const image = model("image", { output_modalities: ["image"], pricing: { input: 1, output: 4 } });
  assert.equal(estimateAiCost(image, 100, 1, "image"), null);
  assert.equal(rankAiModels([image], "image", { maxCost: 1 }).length, 0);
  const priced = model("priced-image", { output_modalities: ["image"], pricing: { per_image: 0.04 } });
  assert.equal(rankAiModels([priced], "image", { maxCost: 0.05 })[0].estimatedCost, 0.04);
});

test("provider pagination fails closed when the next page is missing", async () => {
  const catalogue = createAiCatalog({ fetch: async () => Response.json({ data: [{ id: "incomplete" }], has_more: true }) });
  await assert.rejects(catalogue.discover({ provider: "openai", key: "synthetic", base: "https://provider.test" }, { useReference: false }), /incomplete model pagination/);
});

test("a newly connected provider must meet the same evidence threshold before promotion", async () => {
  const store = memoryRoutingStore(), first = { provider: "first", base: "https://first.test", key: "synthetic" }, second = { provider: "second", base: "https://second.test", key: "synthetic" };
  const catalog = { discover: async config => ({ scope: config.base, models: [{ ...model(config.provider, { reasoning: config.provider === "second" }), provider: config.provider }] }) };
  const orchestrator = createAiOrchestrator({ store, catalog, now: () => now });
  await orchestrator.run([first], "analysis", {}, async () => ({ ok: true, text: "First result" }));
  assert.equal((await orchestrator.choices([first, second], "analysis"))[0].model.id, "first");
  await orchestrator.importEvaluations([{ provider: "second", modelId: "second", scope: second.base, task: "analysis", quality: 0.98, samples: 5, at: now, rubric: "reviewed-analysis-v1" }]);
  assert.equal((await orchestrator.choices([first, second], "analysis"))[0].model.id, "second");
});

test("async validation failures are not successes, and a history quota error does not lose a generated result", async () => {
  const { orchestrator, config, store } = orchestratorFixture();
  await assert.rejects(orchestrator.run([config], "creative", { validate: async () => { throw new Error("Invalid authored contract"); } }, async () => ({ ok: true, text: "bad proposal" })), /Invalid authored contract/);
  assert.equal((await store.read()).observations[0].status, "invalid");
  assert.deepEqual((await store.read()).incumbents, {});
  const update = store.update; let writes = 0;
  store.update = change => ++writes === 2 ? Promise.reject(new Error("Quota exceeded")) : update(change);
  const result = await orchestrator.run([config], "writing", { onRoute: () => { throw new Error("Broken view callback"); } }, async () => ({ ok: true, text: "Keep this result" }));
  assert.equal(result.text, "Keep this result");
  assert.equal(result.routing.historySaved, false);
});

test("importing the same evidence twice cannot manufacture additional samples", async () => {
  const { orchestrator, config, store } = orchestratorFixture();
  const evidence = { provider: "test", modelId: "second", scope: config.base, task: "creative", at: now, samples: 1, quality: 0.95, rubric: "reviewed-fixture-v1" };
  await orchestrator.importEvaluations([evidence, evidence]);
  await orchestrator.importEvaluations([evidence]);
  assert.equal((await store.read()).observations.length, 1);
  assert.equal((await orchestrator.choices([config], "creative"))[0].qualitySamples, 1);
  await assert.rejects(orchestrator.importEvaluations([null]), /Invalid evaluation record/);
});

test("evaluation grading ignores JSON key order and incomplete tests remain eligible", async () => {
  assert.equal(aiEvaluationSuite("analysis").fixtures[2].grade('{"revenue":null,"supported":false}'), 1);
  const { orchestrator, config } = orchestratorFixture([model("only-model", { pricing: { input: 2, output: 8 } })]);
  await orchestrator.configure({ evaluationDailyBudget: 1 });
  const controller = new AbortController();
  await assert.rejects(orchestrator.evaluate([config], "creative", { signal: controller.signal }, async () => {
    controller.abort(); return { ok: true, text: '{"headline":"A clearer path","body":"Keep related settings together."}' };
  }), { name: "AbortError" });
  const plan = await orchestrator.planEvaluation([config], "creative");
  assert.equal(plan.modelId, "only-model");
  const retry = await orchestrator.evaluate([config], "creative", { approval: plan }, async () => ({ ok: true, text: '{"headline":"A clearer path","body":"Keep related settings together."}' }));
  assert.equal(retry.results.length, 3);
});