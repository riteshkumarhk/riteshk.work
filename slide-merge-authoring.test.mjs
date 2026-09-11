import test from "node:test";
import assert from "node:assert/strict";
import { compositionCatalog, compileComposition, validateComposition } from "./src/js/slide-merge-composition.mjs";
import { authoringEvidence } from "./src/js/slide-merge-authoring.mjs";
import { fitAuthoredText } from "./src/js/slide-merge-authoring-fit.mjs";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";

const options = { plain: String, fontFamily: 2 };
const data = { work: [{ id: "case", title: "Case", study: { blocks: [{ type: "gallery", heading: "A simpler path", items: [{ src: "original.png", caption: "Two steps instead of five" }] }, { type: "metrics", items: [{ value: "20%", label: "Completion increase" }] }] } }] };
const slide = sourceIds => ({ id: "decision", kind: "authored", layout: "split", sourceIds, headline: "Reduce the decision burden", kicker: "DESIGN DECISION", body: "A shorter path helps users finish.", notes: "Verify the causal wording with the source.", components: [sourceIds[0]] });

async function textAdapters(fetch, usage = []) {
  const source = await readFile(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  return runInNewContext(`(() => {
    ${source.slice(source.indexOf("function aiIsModelErr"), source.indexOf("// Pick the first working model and stream it"))}
    return { aiChatOnce, aiStream };
  })()`, {
    fetch,
    aiUsageFromJson: (provider, result) => result.usage ? { in: result.usage.input_tokens, out: result.usage.output_tokens } : null,
    aiUsageRecord: (...record) => usage.push(record),
    TextDecoder
  });
}

test("authoring composes editable copy and intact source components without mutating sources", async () => {
  const before = structuredClone(data), catalog = await compositionCatalog(data, options);
  const spec = { version: 2, title: "A clear path", slides: [slide(catalog.map(source => source.sourceId))] };
  const compiled = await compileComposition(spec, data, options);
  assert.ok(compiled.slides[0].elements.some(element => element.type === "text" && element.text === spec.slides[0].headline));
  assert.deepEqual(compiled.slides[0].elements.find(element => element.customData?.sectionComponent).customData.sectionComponent, data.work[0].study.blocks[0]);
  assert.equal(compiled.slides[0].provenance.sources.length, 2);
  assert.equal(compiled.warnings[0].code, "factual-review");
  assert.deepEqual(data, before);
});
test("authored contracts reject unsupported layouts, scripts, missing components and invented source IDs", async () => {
  const catalog = await compositionCatalog(data, options), base = slide(catalog.map(source => source.sourceId));
  for (const change of [{ layout: "html" }, { headline: "<script>bad</script>" }, { components: [] }, { sourceIds: [] }, { arbitrary: true }]) {
    assert.throws(() => validateComposition({ version: 2, title: "Test", slides: [{ ...base, ...change }] }));
  }
  await assert.rejects(() => compileComposition({ version: 2, title: "Test", slides: [{ ...base, sourceIds: ["invented"], components: ["invented"] }] }, data, options), /unavailable/);
});
test("authoring evidence includes nested metrics and captions but no media URLs", () => {
  const evidence = authoringEvidence({ items: [{ value: "20%", caption: "Two steps", src: "https://secret.example/image.png" }] }, String);
  assert.match(evidence, /20%/); assert.match(evidence, /Two steps/); assert.doesNotMatch(evidence, /https|secret/);
});

test("authored text fits without truncation and rejects unreadable overflow", () => {
  const element = { type: "text", text: "Long presentation copy ".repeat(8).trim(), fontSize: 30, lineHeight: 1.25, width: 400, height: 260 };
  const fitted = fitAuthoredText(element, (text, size) => text.length * size * .5);
  assert.equal(fitted.text.replace(/\s/g, ""), element.text.replace(/\s/g, ""));
  assert.ok(fitted.fontSize >= 18 && fitted.text.split("\n").length * fitted.fontSize * 1.25 <= element.height);
  assert.throws(() => fitAuthoredText({ ...element, height: 1 }, (text, size) => text.length * size), /too dense/);
});
test("deck and general text generation use the shared orchestrator instead of family rankings", async () => {
  const source = await readFile(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  await transform(source, { loader: "js" });
  const oneShot = source.slice(source.indexOf("async function aiText(cfg"), source.indexOf("function aiKeyModal"));
  assert.match(oneShot, /aiRunTask/);
  assert.match(oneShot, /opts\.deckAuthoring/);
  const stream = source.slice(source.indexOf("async function aiTextStream"), source.indexOf("async function aiText(cfg"));
  assert.match(stream, /aiRunTask/);
  assert.doesNotMatch(source, /deckModelCandidates|slide-merge-authoring-models/);
  assert.doesNotMatch(source, /AI_MODEL_RANK|AI_TEXT_FALLBACK|AI_VISION_MODEL|AI_IMG_FALLBACK|AI_DEFAULT_MODEL/);
  assert.doesNotMatch(source, /if \(!parsed\) parsed = csgenParse\(await aiText\(cfg, sys, user, sopts\)\)/);
  assert.doesNotMatch(source, /aiSupportsImages/);
  const author = source.slice(source.indexOf("draftSlides: async function"));
  assert.match(author, /const proposal = parseCompositionResponse\(text, catalog\);\s*if \(proposal\.version !== 2\) throw/);
});

test("multimodal adapters preserve image bytes across providers and use declared reasoning metadata", async () => {
  const bodies = [], adapters = await textAdapters(async (url, options) => { bodies.push(JSON.parse(options.body)); return Response.json({ content: [{ text: "Result" }], candidates: [{ content: { parts: [{ text: "Result" }] } }], choices: [{ message: { content: "Result" } }] }); });
  for (const provider of ["anthropic", "gemini", "openai"]) {
    const result = await adapters.aiChatOnce({ provider, key: "synthetic", base: "https://provider.test", routingModel: { reasoning: true } }, "arbitrary-new-model", "System", [{ type: "text", text: "Look at this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAECAw==" } }], { maxTokens: 500, json: true });
    assert.equal(result.text, "Result");
  }
  assert.equal(bodies[0].messages[0].content[1].source.data, "AAECAw==");
  assert.equal(bodies[1].contents[0].parts[1].inlineData.data, "AAECAw==");
  assert.equal(bodies[2].messages[1].content[1].image_url.url, "data:image/png;base64,AAECAw==");
  assert.equal(bodies[2].max_completion_tokens, 500); assert.equal(bodies[2].max_tokens, undefined);
});

test("streaming accepts a proxy JSON response without another call and surfaces SSE errors after partial output", async () => {
  let calls = 0;
  const adapters = await textAdapters(async () => { calls++; return Response.json({ choices: [{ message: { content: "Complete result" } }] }); });
  const result = await adapters.aiStream({ provider: "custom", key: "synthetic", base: "https://provider.test" }, "selected", "System", "Prompt", {}, () => {});
  assert.equal(result.text, "Complete result"); assert.equal(calls, 1);
  const stream = await textAdapters(async () => new Response('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\ndata: {"error":{"message":"Service interrupted"}}\n\n', { headers: { "content-type": "text/event-stream" } }));
  const failure = await stream.aiStream({ provider: "openai", key: "synthetic", base: "https://provider.test" }, "selected", "System", "Prompt", {}, () => {});
  assert.equal(failure.ok, false); assert.equal(failure.emitted, true); assert.equal(failure.err, "Service interrupted");
});

test("deck AI retries a deprecated temperature on the same model without changing the request", async () => {
  const requests = [], usage = [];
  const adapters = await textAdapters(async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return requests.length === 1
      ? new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "`temperature` is deprecated for this model." } }), { status: 400 })
      : new Response(JSON.stringify({ content: [{ text: "Generated deck" }], usage: { input_tokens: 10, output_tokens: 20 } }));
  }, usage);
  const controller = new AbortController();
  const config = { provider: "anthropic", model: "claude-opus-4-6", key: "synthetic-test-key", base: "https://ai.test/anthropic" };
  const options = { json: true, maxTokens: 12000, temperature: 0.3, deckAuthoring: true, signal: controller.signal };
  const result = await adapters.aiChatOnce(config, config.model, "System instructions", "Case-study material", options);
  assert.equal(result.ok, true, result.err);
  assert.equal(result.text, "Generated deck");
  assert.equal(requests.length, 2);
  const expected = structuredClone(requests[0].body); delete expected.temperature;
  assert.deepEqual(requests[1].body, expected);
  assert.equal(requests[1].url, requests[0].url);
  assert.deepEqual(requests[1].headers, requests[0].headers);
  assert.equal(requests[1].signal, controller.signal);
  assert.equal(usage.length, 1);
  await adapters.aiChatOnce(config, config.model, "System instructions", "Another case study", options);
  assert.equal(requests.length, 3);
  assert.equal(Object.hasOwn(requests[2].body, "temperature"), false, "Remember the selected model's rejected parameter for this session");
  assert.equal(options.temperature, 0.3, "Do not alter the caller's requested settings");
});

test("discovered Anthropic reasoning models send a minimal body without optional sampling", async () => {
  const requests = [];
  const adapters = await textAdapters(async (url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (Object.hasOwn(body, "temperature")) return Response.json({ error: { type: "invalid_request_error", message: "Invalid body" } }, { status: 400 });
    return Response.json({ content: [{ type: "text", text: "A complete answer" }], stop_reason: "end_turn" });
  });
  const cfg = { provider: "anthropic", key: "synthetic", base: "https://provider.test", routingModel: { reasoning: true } };
  for (const operation of ["aiChatOnce", "aiStream"]) {
    const result = await adapters[operation](cfg, "arbitrary-current-model", "System", "Case", { maxTokens: 12000, temperature: 0.3 });
    assert.equal(result.ok, true, result.err);
    assert.equal(result.text, "A complete answer");
  }
  assert.equal(requests.length, 2, "Do not send known-incompatible parameters and depend on a retry");
  assert.ok(requests.every(body => !Object.hasOwn(body, "temperature")));
});

test("invalid-body errors distinguish HTTP rejection from stream failure without exposing source data", async () => {
  for (const streamed of [false, true]) {
    const payload = { error: { type: "invalid_request_error", message: "Invalid body" } };
    const adapters = await textAdapters(async () => streamed
      ? new Response("data: " + JSON.stringify(payload) + "\n\n", { headers: { "content-type": "text/event-stream", "request-id": "req-test" } })
      : Response.json(payload, { status: 400, headers: { "request-id": "req-test" } }));
    const result = await adapters.aiStream({ provider: "anthropic", key: "PRIVATE KEY", base: "https://provider.test" }, "selected", "System", "PRIVATE PROMPT", {});
    assert.equal(result.ok, false);
    assert.equal(result.status, streamed ? 200 : 400);
    assert.equal(result.phase, streamed ? "stream" : "request");
    assert.equal(result.errorType, "invalid_request_error");
    assert.equal(result.requestId, "req-test");
    assert.match(result.err, /HTTP/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY|PRIVATE PROMPT/);
  }
});

test("temperature compatibility preserves OpenAI-compatible and Gemini request formats", async () => {
  for (const provider of ["openai", "custom", "gemini"]) {
    const requests = [];
    const adapters = await textAdapters(async (url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      if (requests.length === 1) return new Response(JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0.3 with this model. Only the default (1) value is supported." } }), { status: 422 });
      return new Response(JSON.stringify(provider === "gemini" ? { candidates: [{ content: { parts: [{ text: "Generated deck" }] } }] } : { choices: [{ message: { content: "Generated deck" } }] }));
    });
    const result = await adapters.aiChatOnce({ provider, key: "synthetic", base: "https://ai.test/v1" }, "future-model", "System", "Source", { temperature: 0.3, maxTokens: 12000, json: true, deckAuthoring: true });
    assert.equal(result.ok, true, provider);
    assert.equal(requests.length, 2, provider);
    const expected = structuredClone(requests[0]);
    delete (provider === "gemini" ? expected.generationConfig : expected).temperature;
    assert.deepEqual(requests[1], expected, provider);
  }
});

test("Anthropic reasoning-only exhaustion reports its stop reason without exposing reasoning or retrying", async () => {
  let calls = 0;
  const usage = [];
  const adapters = await textAdapters(async () => {
    calls++;
    return Response.json({ type: "message", role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE REASONING", signature: "PRIVATE SIGNATURE" }], stop_reason: "max_tokens", usage: { input_tokens: 200, output_tokens: 12000 } });
  }, usage);
  const result = await adapters.aiChatOnce({ provider: "anthropic", key: "synthetic", base: "https://provider.test" }, "discovered-reasoning-model", "System", "Case study", { maxTokens: 12000, json: true, deckAuthoring: true });
  assert.equal(result.ok, false);
  assert.equal(result.stopReason, "max_tokens");
  assert.equal(result.failure, "output-limit");
  assert.match(result.err, /output limit.*before.*(?:answer|text)/i);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE REASONING|PRIVATE SIGNATURE/);
  assert.equal(calls, 1);
  assert.deepEqual(usage, [["anthropic", "discovered-reasoning-model", 200, 12000]]);
});

test("long Anthropic deck requests stream through hidden reasoning to the complete final answer", async () => {
  const requests = [], usage = [], encoder = new TextEncoder();
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 200 } } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "PRIVATE REASONING" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "PRIVATE SIGNATURE" } },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "A " } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "complete deck" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12500, output_tokens_details: { thinking_tokens: 11000 } } },
    { type: "message_stop" }
  ];
  const payload = events.map(event => `data: ${JSON.stringify(event)}`).join("\r\n\r\n");
  const adapters = await textAdapters(async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(new ReadableStream({ start(controller) { for (let offset = 0; offset < payload.length; offset += 19) controller.enqueue(encoder.encode(payload.slice(offset, offset + 19))); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
  }, usage);
  const result = await adapters.aiChatOnce({ provider: "anthropic", key: "synthetic", base: "https://provider.test", routingMaxTokens: 24000 }, "arbitrary-discovered-model", "System", "Case study", { maxTokens: 12000, json: true, deckAuthoring: true });
  assert.equal(result.ok, true, result.err);
  assert.equal(result.text, "A complete deck");
  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.outputTokens, 12500);
  assert.equal(result.thinkingTokens, 11000);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].stream, true);
  assert.equal(requests[0].max_tokens, 24000);
  assert.equal(requests[0].thinking, undefined, "Do not disable or expose provider reasoning");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE REASONING|PRIVATE SIGNATURE/);
  assert.deepEqual(usage, [["anthropic", "arbitrary-discovered-model", 200, 12500]]);
});

test("Anthropic stop reasons and malformed responses never become usable drafts", async () => {
  for (const [body, failure] of [
    [{ content: [{ type: "text", text: '{"partial":true}' }], stop_reason: "max_tokens" }, "output-limit"],
    [{ content: [], stop_reason: "model_context_window_exceeded" }, "context-limit"],
    [{ content: [], stop_reason: "refusal" }, "refusal"],
    [{ content: [], stop_reason: "pause_turn" }, "incomplete-response"],
    [{ content: [], stop_reason: "end_turn" }, "empty-output"],
    [{ unexpected: "PRIVATE RESPONSE" }, "invalid-response"]
  ]) {
    let calls = 0;
    const adapters = await textAdapters(async () => { calls++; return Response.json(body); });
    for (const operation of ["aiChatOnce", "aiStream"]) {
      const result = await adapters[operation]({ provider: "anthropic", key: "synthetic", base: "https://provider.test" }, "discovered-model", "System", "Case", { maxTokens: 12000 }, () => { throw new Error("Incomplete output must not be displayed"); });
      assert.equal(result.ok, false);
      assert.equal(result.failure, failure);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE RESPONSE|partial/);
    }
    assert.equal(calls, 2, "Exactly one request per operation");
  }
});

test("Anthropic stream exhaustion and early EOF are failures, not empty or partial success", async () => {
  for (const reason of ["max_tokens", null]) {
    const usage = [], deltas = [];
    const events = [{ type: "message_start", message: { usage: { input_tokens: 10 } } }, { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "PRIVATE REASONING" } }];
    if (reason) events.push({ type: "message_delta", delta: { stop_reason: reason }, usage: { output_tokens: 24000, output_tokens_details: { thinking_tokens: 24000 } } });
    const adapters = await textAdapters(async () => new Response(events.map(event => `data: ${JSON.stringify(event)}`).join("\n\n"), { headers: { "content-type": "text/event-stream" } }), usage);
    const result = await adapters.aiStream({ provider: "anthropic", key: "synthetic", base: "https://provider.test" }, "discovered-model", "System", "Case", { maxTokens: 24000 }, text => deltas.push(text));
    assert.equal(result.ok, false);
    assert.equal(result.failure, reason ? "output-limit" : "incomplete-stream");
    assert.deepEqual(deltas, []);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE REASONING/);
    if (reason) assert.deepEqual(usage, [["anthropic", "discovered-model", 10, 24000]]);
  }
});

test("malformed Anthropic JSON never exposes response fragments in errors", async () => {
  const adapters = await textAdapters(async () => new Response('{"thinking":"PRIVATE RESPONSE FRAGMENT",', { headers: { "content-type": "application/json" } }));
  for (const operation of ["aiChatOnce", "aiStream"]) {
    const result = await adapters[operation]({ provider: "anthropic", key: "synthetic", base: "https://provider.test" }, "discovered-model", "System", "Case", { maxTokens: 12000 });
    assert.equal(result.ok, false);
    assert.equal(result.failure, "invalid-response");
    assert.match(result.err, /unreadable/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE RESPONSE FRAGMENT/);
  }
});

test("temperature compatibility never retries unrelated errors or loops on repeated rejection", async () => {
  for (const [status, message, expectedCalls] of [
    [401, "Invalid API key", 1], [403, "Model access denied", 1], [429, "Rate limit exceeded", 1],
    [500, "temperature is unsupported", 1], [400, "max_tokens is deprecated for this model", 1],
    [400, "temperature must be between 0 and 2", 1], [400, "temperature is deprecated for this model", 2]
  ]) {
    let calls = 0;
    const adapters = await textAdapters(async () => { calls++; return new Response(JSON.stringify({ error: { message } }), { status }); });
    const result = await adapters.aiChatOnce({ provider: "anthropic", key: "synthetic", base: "https://ai.test" }, "model", "System", "Source", { temperature: 0.3 });
    assert.equal(result.ok, false);
    assert.equal(result.status, status);
    assert.equal(result.err, message);
    assert.equal(calls, expectedCalls, message);
  }
});

test("temperature retry respects cancellation and keeps compatible model and endpoint settings", async () => {
  const requests = [];
  const adapters = await textAdapters(async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, body });
    return body.model === "restricted" && Object.hasOwn(body, "temperature")
      ? new Response(JSON.stringify({ error: { message: "temperature is deprecated for this model" } }), { status: 400 })
      : new Response(JSON.stringify({ content: [{ text: "Done" }] }));
  });
  const config = { provider: "anthropic", key: "synthetic", base: "https://first.test" };
  await adapters.aiChatOnce(config, "restricted", "System", "Source", { temperature: 0.3 });
  await adapters.aiChatOnce(config, "compatible", "System", "Source", { temperature: 0.5 });
  assert.equal(requests[2].body.temperature, 0.5);
  await adapters.aiChatOnce({ ...config, base: "https://second.test" }, "restricted", "System", "Source", { temperature: 0.3 });
  assert.equal(requests[3].body.temperature, 0.3, "Capabilities must not leak between endpoints");
  const controller = new AbortController(); let cancelledCalls = 0;
  const cancelled = await textAdapters(async () => {
    cancelledCalls++; controller.abort(new Error("Cancelled by owner"));
    return new Response(JSON.stringify({ error: { message: "temperature is deprecated for this model" } }), { status: 400 });
  });
  await assert.rejects(cancelled.aiChatOnce(config, "restricted", "System", "Source", { signal: controller.signal }), /Cancelled by owner/);
  assert.equal(cancelledCalls, 1);
});

test("streamed AI retries temperature only before output and records successful usage once", async () => {
  const requests = [], usage = [], deltas = [];
  const adapters = await textAdapters(async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ ...options, body });
    if (requests.length === 1) return new Response(JSON.stringify({ error: { message: "`temperature` is deprecated for this model." } }), { status: 400 });
    return new Response([
      { type: "message_start", message: { usage: { input_tokens: 10 } } },
      { type: "content_block_delta", delta: { text: "Generated deck" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } }
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
  }, usage);
  const controller = new AbortController();
  const result = await adapters.aiStream({ provider: "anthropic", key: "synthetic", base: "https://ai.test" }, "restricted", "System", "Source", { temperature: 0.3, maxTokens: 12000, signal: controller.signal }, text => deltas.push(text));
  assert.equal(result.ok, true);
  assert.equal(result.text, "Generated deck");
  assert.deepEqual(deltas, ["Generated deck"]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.stream, true);
  assert.equal(requests[1].body.max_tokens, 12000);
  assert.equal(Object.hasOwn(requests[1].body, "temperature"), false);
  assert.equal(requests[1].signal, controller.signal);
  assert.deepEqual(usage, [["anthropic", "restricted", 10, 20]]);
});

test("agent coordination effort is sent only when the model declares that effort level", async () => {
  const requests = [], adapters = await textAdapters(async (url, options) => { requests.push(JSON.parse(options.body)); return Response.json({ content: [{ type: "text", text: "Done" }], stop_reason: "end_turn" }); });
  for (const effortLevels of [["low", "medium"], [], ["high"]]) {
    await adapters.aiChatOnce({ provider: "anthropic", key: "synthetic", base: "https://provider.test", routingModel: { reasoning: true, effortLevels } }, "arbitrary-model", "System", "Job", { maxTokens: 2048, effort: "low" });
  }
  assert.deepEqual(requests[0].output_config, { effort: "low" });
  assert.equal(requests[1].output_config, undefined);
  assert.equal(requests[2].output_config, undefined);
  assert.ok(requests.every(request => !Object.hasOwn(request, "temperature")));
});

test("one-shot invalid-body errors retain safe HTTP diagnostics on every provider adapter", async () => {
  const adapters = await textAdapters(async () => Response.json({ error: { type: "invalid_request_error", message: "Invalid body" } }, { status: 400, headers: { "request-id": "req-small" } }));
  for (const provider of ["anthropic", "openai", "gemini", "custom"]) {
    const result = await adapters.aiChatOnce({ provider, key: "synthetic", base: "https://provider.test" }, "selected", "System", "Job", { maxTokens: 1000 });
    assert.equal(result.status, 400);
    assert.equal(result.errorType, "invalid_request_error");
    assert.equal(result.phase, "request");
    assert.equal(result.requestId, "req-small");
  }
});

test("image generation uses the agent's guidance and preserves its source image", async () => {
  const source = await readFile(new URL("./src/js/admin-studio.js", import.meta.url), "utf8"), calls = [], controller = new AbortController();
  const start = source.indexOf("async function aiImage(cfg"), end = source.indexOf("async function aiImageOpenAI", start);
  const generate = runInNewContext("(" + source.slice(start, end).trim() + ")", {
    dataUriParts: async () => ({ mime: "image/png", b64: "AAECAw==" }),
    aiRunTask: async (config, task, system, user, options, invoke) => {
      assert.equal(task, "image");
      assert.equal(user[1].image_url.url, "data:image/png;base64,AAECAw==");
      return invoke(config, "agent-selected-image-model", { user: [...user, { type: "text", text: "Use the specialist findings" }], options: { signal: controller.signal } });
    },
    aiImageOpenAI: async (config, prompt, original) => { calls.push({ config, prompt, original }); return "data:image/png;base64,RESULT"; }
  });
  assert.equal(await generate({ provider: "openai" }, "Original prompt", "original.png"), "data:image/png;base64,RESULT");
  assert.match(calls[0].prompt, /Original prompt[\s\S]*Use the specialist findings/);
  assert.equal(calls[0].original, "original.png");
  assert.equal(calls[0].config.signal, controller.signal);
});