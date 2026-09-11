import { AI_TASKS, estimateAiCost, rankAiModels } from "./ai-model-router.mjs";
import { createAiCatalog } from "./ai-model-catalog.mjs";
import { aiEvaluationSuite } from "./ai-model-evaluations.mjs";

function emptyState() {
  return { version: 1, policy: { maxCost: null, evaluationDailyBudget: 0, autoEvaluate: false, useReference: true, providers: "selected" }, observations: [], decisions: [], incumbents: {}, evaluationDay: "", evaluationReserved: 0 };
}

export function createAiRoutingStore(indexedDB = globalThis.indexedDB) {
  async function transaction(write, change) {
    const database = await new Promise((resolve, reject) => {
      let failed = false;
      const request = indexedDB.open("rk-ai-orchestrator-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onerror = () => reject(request.error);
      request.onblocked = () => { failed = true; reject(new Error("Close other Studio tabs to open AI routing history")); };
      request.onsuccess = () => {
        if (failed) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close(); resolve(request.result);
      };
    });
    return new Promise((resolve, reject) => {
      let result, failure, current;
      try { current = database.transaction("state", write ? "readwrite" : "readonly"); }
      catch (error) { database.close(); reject(error); return; }
      current.oncomplete = () => { database.close(); resolve(result); };
      current.onabort = current.onerror = () => { database.close(); reject(failure || current.error || new Error("AI routing history was not saved")); };
      const store = current.objectStore("state"), request = store.get("router");
      request.onsuccess = () => {
        try {
          const state = request.result?.version === 1 ? request.result : emptyState();
          result = change(state);
          if (write) store.put(state, "router");
        } catch (error) { failure = error; current.abort(); }
      };
    });
  }
  return { read: () => transaction(false, state => state), update: change => transaction(true, change) };
}

export function aiFailureKind(result) {
  const status = Number(result?.status), message = String(result?.err || "");
  if (result?.emitted) return "partial-output";
  if (["output-limit", "context-limit", "refusal", "empty-output", "invalid-response", "incomplete-response", "incomplete-stream"].includes(result?.failure)) return result.failure;
  if (status === 401) return "authentication";
  if (status === 429) return "rate-limit";
  if (status >= 500 || !status) return "service";
  if (status === 404 || status === 403 && /model.*(?:access|permission|available)/i.test(message)) return "unavailable";
  if ([400, 422].includes(status) && /not.support|unsupported|not.available|unknown.model|model.*(?:not.found|retired|deprecated)|invalid.model/i.test(message)) return "unsupported";
  return "request";
}

function publicChoice(choice, id, scope, fallback, at) {
  return { id, at, scope, task: choice.task, provider: choice.model.provider, modelId: choice.model.id, modelName: choice.model.name,
    confidence: choice.confidence, reasons: [...choice.reasons], estimatedCost: choice.estimatedCost, outputTokens: choice.outputTokens, fallback, status: "running" };
}

export function createAiOrchestrator({ catalog = createAiCatalog(), store = createAiRoutingStore(), now = Date.now, randomId = () => crypto.randomUUID() } = {}) {
  async function record(decision, observation) {
    await store.update(state => {
      state.decisions = [...state.decisions.filter(item => item.id !== decision.id), decision].slice(-50);
      if (observation) state.observations = [...state.observations, observation].slice(-600);
      if (decision.status === "success" && !decision.evaluation && (!decision.agentRole || decision.agentRole === "result")) {
        state.incumbents[JSON.stringify([decision.scope, decision.task])] = decision.modelId;
        state.taskIncumbents ||= {};
        state.taskIncumbents[decision.task] = { scope: decision.scope, provider: decision.provider, modelId: decision.modelId };
      }
    });
  }
  async function selection(configs, task, options) {
    if (!Object.hasOwn(AI_TASKS, task)) throw new Error("Unsupported AI task");
    options.signal?.throwIfAborted();
    const state = await store.read(), choices = [], endpoints = new Map(), failures = [];
    for (const config of configs) {
      try {
        const discovered = await catalog.discover(config, { signal: options.signal, refresh: options.refresh, useReference: state.policy.useReference });
        endpoints.set(discovered.scope, config);
        const maxCost = options.maxCost ?? state.policy.maxCost;
        const ranked = rankAiModels(discovered.models, task, { ...options, maxCost, observations: state.observations, now: now(), scope: discovered.scope,
          incumbent: state.incumbents[JSON.stringify([discovered.scope, task])] });
        ranked.forEach((choice, index) => choices.push({ ...choice, scope: discovered.scope, preferred: index === 0 }));
      } catch (error) { options.signal?.throwIfAborted(); failures.push(error); }
    }
    options.signal?.throwIfAborted();
    choices.sort((first, second) => Number(second.preferred) - Number(first.preferred) || second.score - first.score);
    const established = state.taskIncumbents?.[task];
    const incumbent = established && choices.find(choice => choice.scope === established.scope && choice.model.id === established.modelId && choice.model.provider === established.provider);
    if (incumbent) {
      const challenger = choices.find(choice => choice !== incumbent && choice.qualitySamples >= 3 && choice.quality > incumbent.quality + 0.03);
      const preferred = challenger || incumbent;
      preferred.reasons.push(challenger ? "Task evidence supports selection across connected services" : "Retained the task incumbent across connected services");
      choices.splice(choices.indexOf(preferred), 1); choices.unshift(preferred);
    }
    if (options.target) {
      const target = options.target;
      const match = choices.find(choice => choice.scope === target.scope && choice.model.provider === target.provider && choice.model.id === target.modelId);
      choices.splice(0, choices.length, ...(match ? [match] : []));
    }
    if (!choices.length) {
      if (failures.length === configs.length && failures.length) throw failures[0];
      throw new Error("No available model meets this task's capabilities, limits and budget. Refresh models or review AI routing settings.");
    }
    return { choices, endpoints, state };
  }
  async function evaluationPlan(configs, task, options = {}) {
    const suite = aiEvaluationSuite(task), state = await store.read();
    if (!suite) throw new Error("This task needs owner-rated or imported evaluations; no automatic test suite is available");
    if (state.policy.evaluationDailyBudget <= 0) throw new Error("Set an evaluation budget before running paid model tests");
    const tokens = suite.fixtures.map(fixture => new TextEncoder().encode(fixture.system + fixture.user).length + 1024);
    const selected = await selection(configs, task, { ...options, inputTokens: Math.max(...tokens), outputTokens: 512, requireKnown: true,
      maxCost: Math.min(options.maxCost ?? Infinity, state.policy.maxCost ?? Infinity, state.policy.evaluationDailyBudget), structured: "preferred" });
    const choice = selected.choices.find(candidate => {
      const completed = new Set(state.observations.filter(item => item.scope === candidate.scope && item.provider === candidate.model.provider &&
        item.modelId === candidate.model.id && item.task === task && item.rubric === suite.id && item.at <= now() && now() - item.at < 30 * 86400000 &&
        ["success", "invalid"].includes(item.status) && (!candidate.model.releasedAt || item.at >= candidate.model.releasedAt)).map(item => item.fixture));
      return !suite.fixtures.every(fixture => completed.has(fixture.id)) && candidate.qualitySamples < 3;
    });
    if (!choice) throw new Error("No unevaluated eligible models in the refreshed catalogue");
    const costs = tokens.map(input => estimateAiCost(choice.model, input, 512));
    if (costs.some(cost => cost == null)) throw new Error("Known evaluation pricing is required");
    const estimatedCost = costs.reduce((sum, cost) => sum + cost, 0);
    if (estimatedCost > state.policy.evaluationDailyBudget || options.maxCost != null && estimatedCost > options.maxCost) throw new Error("The evaluation exceeds the approved budget");
    return { suite, choice, costs, estimatedCost, config: selected.endpoints.get(choice.scope) };
  }
  const api = {
    state: () => store.read(),
    async configure(values) {
      const allowed = ["maxCost", "evaluationDailyBudget", "autoEvaluate", "useReference", "providers"];
      if (Object.keys(values).some(key => !allowed.includes(key))) throw new Error("Unsupported routing setting");
      if (values.maxCost != null && (!Number.isFinite(values.maxCost) || values.maxCost <= 0)) throw new Error("Enter a positive request budget or leave it unset");
      if (Object.hasOwn(values, "evaluationDailyBudget") && (!Number.isFinite(values.evaluationDailyBudget) || values.evaluationDailyBudget < 0)) throw new Error("Enter a nonnegative evaluation budget");
      for (const key of ["autoEvaluate", "useReference"]) if (Object.hasOwn(values, key) && typeof values[key] !== "boolean") throw new Error("Invalid routing switch");
      if (Object.hasOwn(values, "providers") && !["selected", "connected"].includes(values.providers)) throw new Error("Invalid provider scope");
      return store.update(state => { Object.assign(state.policy, values); return structuredClone(state.policy); });
    },
    async choices(configs, task, options = {}) { return (await selection(configs, task, options)).choices; },
    async run(configs, task, options, invoke) {
      const selected = await selection(configs, task, options), maxCost = options.maxCost ?? selected.state.policy.maxCost;
      let committed = 0, lastFailure, previous;
      const notify = decision => { try { options.onRoute?.(structuredClone(decision)); } catch {} };
      for (const [index, choice] of selected.choices.slice(0, Math.max(1, Math.min(3, options.maxAttempts || 3))).entries()) {
        options.signal?.throwIfAborted();
        if (maxCost != null && (choice.estimatedCost == null || committed + choice.estimatedCost > maxCost)) break;
        committed += choice.estimatedCost || 0;
        const decision = publicChoice(choice, randomId(), choice.scope, index > 0, now());
        if (options.agent && /^[a-zA-Z0-9_-]{1,100}$/.test(options.agent.jobId || "") && ["coordinator", "delegate", "draft"].includes(options.agent.role)) {
          decision.agentJobId = options.agent.jobId; decision.agentRole = options.agent.role;
          decision.agentStep = Math.max(1, Math.min(16, Number(options.agent.step) || 1));
        }
        if (previous) decision.reasons.push("Previous attempt with " + previous.modelId + " failed: " + previous.failure);
        await record(decision);
        notify(decision);
        const start = now();
        let result;
        try { result = await invoke({ ...selected.endpoints.get(choice.scope), routingModel: choice.model, routingMaxTokens: choice.outputTokens || undefined }, choice.model.id, decision); }
        catch (error) {
          decision.status = options.signal?.aborted ? "cancelled" : "error";
          await record(decision).catch(() => {}); notify(decision); throw error;
        }
        if (options.signal?.aborted) {
          decision.status = "cancelled"; await record(decision).catch(() => {}); notify(decision); options.signal.throwIfAborted();
        }
        let success = result?.ok === true;
        if (success && options.validate) {
          try { await options.validate(result.text); }
          catch (error) { success = false; result = { ok: false, status: 422, err: error.message, validationFailed: true }; }
        }
        if (options.signal?.aborted) { decision.status = "cancelled"; await record(decision).catch(() => {}); notify(decision); options.signal.throwIfAborted(); }
        const kind = success ? "success" : result?.validationFailed ? "invalid" : aiFailureKind(result);
        decision.status = success ? "success" : "error"; decision.failure = success ? undefined : kind;
        if (Number.isInteger(result?.status) && result.status >= 100 && result.status <= 599) decision.httpStatus = result.status;
        if (["request", "stream", "transport"].includes(result?.phase)) decision.failurePhase = result.phase;
        if (["invalid_request_error", "authentication_error", "permission_error", "not_found_error", "request_too_large", "rate_limit_error", "api_error", "overloaded_error", "unknown"].includes(result?.errorType)) decision.errorType = result.errorType;
        if (typeof result?.requestId === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(result.requestId)) decision.requestId = result.requestId;
        if (["end_turn", "max_tokens", "model_context_window_exceeded", "refusal", "stop_sequence", "pause_turn", "tool_use", "unspecified", "unknown"].includes(result?.stopReason)) decision.stopReason = result.stopReason;
        if (Number.isSafeInteger(result?.outputTokens) && result.outputTokens >= 0) decision.usedOutputTokens = result.outputTokens;
        if (Number.isSafeInteger(result?.thinkingTokens) && result.thinkingTokens >= 0 && result.thinkingTokens <= result.outputTokens) decision.thinkingTokens = result.thinkingTokens;
        if (!success && decision.stopReason) decision.reasons.push("Provider stop: " + decision.stopReason + (decision.usedOutputTokens == null ? "" : "; " + decision.usedOutputTokens.toLocaleString("en-US") + " output tokens used"));
        try {
          await record(decision, { id: randomId(), at: now(), scope: choice.scope, task, provider: choice.model.provider, modelId: choice.model.id,
            status: kind, requirements: options.requirements || "", latencyMs: Math.max(0, now() - start), decisionId: decision.id,
            stopReason: decision.stopReason, outputTokens: decision.usedOutputTokens, thinkingTokens: decision.thinkingTokens,
            httpStatus: decision.httpStatus, errorType: decision.errorType, failurePhase: decision.failurePhase });
        } catch (failure) {
          decision.historySaved = false;
          decision.reasons.push("Routing history could not be saved; this result cannot receive a stored rating");
        }
        notify(decision);
        if (success) return { ...result, routing: decision };
        previous = decision;
        lastFailure = new Error(result?.err || "The AI request failed");
        lastFailure.failure = kind; lastFailure.routing = decision;
        if (!["unavailable", "unsupported"].includes(kind)) throw lastFailure;
      }
      throw lastFailure || new Error("The remaining routing budget cannot cover another model attempt");
    },
    async acceptAgentResult(decisionId, jobId) {
      return store.update(state => {
        const decision = state.decisions.find(item => item.id === decisionId && item.agentJobId === jobId && item.agentRole === "draft" && item.status === "success");
        if (!decision) throw new Error("The agent result is no longer in routing history");
        decision.agentRole = "result";
        state.incumbents[JSON.stringify([decision.scope, decision.task])] = decision.modelId;
        state.taskIncumbents ||= {};
        state.taskIncumbents[decision.task] = { scope: decision.scope, provider: decision.provider, modelId: decision.modelId };
        return structuredClone(decision);
      });
    },
    async feedback(decisionId, { quality, accepted = false, reason = "" } = {}) {
      if (quality != null && (!Number.isFinite(quality) || quality < 0 || quality > 1)) throw new Error("Invalid quality feedback");
      if (!["", "accuracy", "clarity", "design", "instructions"].includes(reason)) throw new Error("Invalid feedback category");
      return store.update(state => {
        const decision = state.decisions.find(item => item.id === decisionId && item.status === "success" && (!item.agentRole || item.agentRole === "result"));
        if (!decision) throw new Error("This completed AI result is no longer in routing history");
        state.observations = state.observations.filter(item => item.feedbackFor !== decisionId);
        state.observations.push({ id: randomId(), at: now(), scope: decision.scope, provider: decision.provider, modelId: decision.modelId, task: decision.task,
          source: accepted && quality == null ? "accepted" : "owner", quality: quality ?? (accepted ? 0.65 : undefined), samples: 1, reason, feedbackFor: decisionId });
        state.observations = state.observations.slice(-600);
      });
    },
    async importEvaluations(records) {
      if (!Array.isArray(records) || records.length > 200) throw new Error("Import up to 200 evaluation records");
      const checked = records.map(item => {
        if (!item || !Object.hasOwn(AI_TASKS, item.task) || typeof item.provider !== "string" || !item.provider.trim() || item.provider.length > 60 ||
          typeof item.modelId !== "string" || !item.modelId.trim() || item.modelId.length > 512 || typeof item.scope !== "string" || !item.scope || item.scope.length > 1024 ||
          !Number.isFinite(item.quality) || item.quality < 0 || item.quality > 1 || !Number.isInteger(item.samples) || item.samples < 1 || item.samples > 1000 ||
          !Number.isFinite(item.at) || item.at < 0 || item.at > now() || typeof item.rubric !== "string" || !item.rubric.trim() || item.rubric.length > 120) throw new Error("Invalid evaluation record");
        return { id: randomId(), provider: item.provider, modelId: item.modelId, scope: item.scope, task: item.task,
          quality: item.quality, samples: item.samples, at: item.at, rubric: item.rubric.trim(), source: "imported evaluation" };
      });
      return store.update(state => {
        const key = item => JSON.stringify([item.provider, item.modelId, item.scope, item.task, item.rubric, item.at]);
        for (const item of checked) {
          state.observations = state.observations.filter(previous => previous.source !== "imported evaluation" || key(previous) !== key(item));
          state.observations.push(item);
        }
        state.observations = state.observations.slice(-600); return checked.length;
      });
    },
    async planEvaluation(configs, task, options = {}) {
      const plan = await evaluationPlan(configs, task, options);
      return { task, provider: plan.choice.model.provider, modelId: plan.choice.model.id, scope: plan.choice.scope, estimatedCost: plan.estimatedCost,
        calls: plan.suite.fixtures.length, rubric: plan.suite.id, objective: plan.suite.objective };
    },
    async evaluate(configs, task, options = {}, invoke) {
      if (options.automatic && !(await store.read()).policy.autoEvaluate) throw new Error("Automatic evaluations are disabled");
      options.signal?.throwIfAborted();
      const plan = await evaluationPlan(configs, task, options);
      if (options.approval && (options.approval.modelId !== plan.choice.model.id || options.approval.provider !== plan.choice.model.provider ||
        options.approval.scope !== plan.choice.scope || plan.estimatedCost > options.approval.estimatedCost)) throw new Error("The evaluation selection changed; review it again");
      const reservation = await api.reserveEvaluation(plan.estimatedCost, JSON.stringify([plan.choice.scope, plan.choice.model.id, task, plan.suite.id]));
      let committed = 0;
      const results = [];
      try {
        for (const [index, fixture] of plan.suite.fixtures.entries()) {
          options.signal?.throwIfAborted();
          if (reservation.day !== new Date(now()).toISOString().slice(0, 10)) throw new Error("The evaluation budget day changed; review and restart the tests");
          const current = await store.read(), policy = current.policy;
          if (policy.evaluationDailyBudget <= 0 || current.evaluationReserved > policy.evaluationDailyBudget || options.automatic && !policy.autoEvaluate) throw new Error("Model tests were disabled or their budget was reduced");
          const decision = { ...publicChoice(plan.choice, randomId(), plan.choice.scope, false, now()), evaluation: plan.suite.id, fixture: fixture.id };
          await record(decision);
          const timeout = AbortSignal.timeout(120000), signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
          signal.throwIfAborted();
          committed += plan.costs[index];
          const start = now();
          let result;
          try { result = await invoke({ ...plan.config, routingModel: plan.choice.model }, plan.choice.model.id, fixture, { signal, maxTokens: fixture.maxTokens, json: true, temperature: 0 }); }
          catch (error) {
            decision.status = signal.aborted ? "cancelled" : "error";
            await record(decision);
            throw error;
          }
          if (signal.aborted) { decision.status = "cancelled"; await record(decision); signal.throwIfAborted(); }
          const score = result?.ok ? fixture.grade(result.text || "") : 0;
          decision.status = result?.ok ? "success" : "error";
          decision.checkScore = score;
          await record(decision, { id: randomId(), at: now(), scope: decision.scope, task, provider: decision.provider, modelId: decision.modelId,
            source: "representative test", rubric: plan.suite.id, fixture: fixture.id, samples: 1, quality: plan.suite.objective && result?.ok ? score : undefined,
            checkScore: score, status: result?.ok ? score ? "success" : "invalid" : aiFailureKind(result), latencyMs: Math.max(0, now() - start), decisionId: decision.id });
          results.push({ decision, score, text: result?.ok ? result.text : "" });
          options.onProgress?.({ completed: results.length, total: plan.suite.fixtures.length, modelId: decision.modelId });
          if (!result?.ok) throw new Error(result?.err || "The evaluation request failed");
        }
        return { task, provider: plan.choice.model.provider, modelId: plan.choice.model.id, rubric: plan.suite.id, objective: plan.suite.objective, estimatedCost: committed, results };
      } finally { await api.releaseEvaluation(reservation, Math.max(0, reservation.amount - committed)); }
    },
    async reserveEvaluation(amount, key = "") {
      if (!Number.isFinite(amount) || amount < 0) throw new Error("Known evaluation pricing is required");
      return store.update(state => {
        const day = new Date(now()).toISOString().slice(0, 10);
        if (state.evaluationDay !== day) { state.evaluationDay = day; state.evaluationReserved = 0; state.evaluationReservations = []; }
        state.evaluationReservations ||= [];
        if (state.evaluationReservations.length >= 30 || key && state.evaluationReservations.some(item => item.key === key && !item.settled)) throw new Error("This evaluation is already reserved or the daily test limit is reached");
        if (state.policy.evaluationDailyBudget <= 0 || state.evaluationReserved + amount > state.policy.evaluationDailyBudget) throw new Error("Evaluation budget is disabled or exhausted");
        state.evaluationReserved += amount;
        const reservation = { id: randomId(), day, amount, key, settled: false };
        state.evaluationReservations.push(reservation);
        return structuredClone(reservation);
      });
    },
    async releaseEvaluation(reservation, unused) {
      if (!reservation || !Number.isFinite(unused) || unused < 0 || unused > reservation.amount) throw new Error("Invalid evaluation reservation");
      return store.update(state => {
        const saved = state.evaluationReservations?.find(item => item.id === reservation.id && item.day === reservation.day && item.amount === reservation.amount);
        if (!saved || saved.settled || state.evaluationDay !== saved.day) return false;
        saved.settled = true;
        state.evaluationReserved = Math.max(0, state.evaluationReserved - unused);
        return true;
      });
    }
  };
  return api;
}