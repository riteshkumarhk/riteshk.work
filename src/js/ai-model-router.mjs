export const AI_TASKS = Object.freeze({
  analysis: { label: "Analytical", output: "text", reasoning: 8, speed: 1 },
  creative: { label: "Creative", output: "text", reasoning: 4, speed: 1 },
  writing: { label: "Text generation", output: "text", reasoning: 1, speed: 3 },
  vision: { label: "Visual analysis", output: "text", images: true, reasoning: 5, speed: 1 },
  coding: { label: "Code generation", output: "text", reasoning: 6, speed: 1 },
  image: { label: "Image generation", output: "image", reasoning: 0, speed: 1 }
});

function supported(value) {
  if (typeof value === "boolean") return value;
  return typeof value?.supported === "boolean" ? value.supported : null;
}
function positive(value) { return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null; }
function released(value) {
  if (!value) return null;
  const time = typeof value === "number" ? value < 1e12 ? value * 1000 : value : Date.parse(value);
  return Number.isFinite(time) && time > 0 ? time : null;
}
function modalities(value) { return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === "string").map(item => item.toLowerCase()))] : null; }

export function normalizeAiModel(provider, raw, reference = {}) {
  if (typeof raw === "string") raw = { id: raw };
  const id = raw?.id || (typeof raw?.name === "string" ? raw.name.replace(/^models\//, "") : "");
  if (typeof id !== "string" || !id.trim() || id.length > 512) return null;
  const capabilities = raw.capabilities || {}, methods = raw.supportedGenerationMethods || raw.supported_generation_methods;
  const input = modalities(raw.input_modalities || raw.modalities?.input || reference.modalities?.input);
  let output = modalities(raw.output_modalities || raw.modalities?.output || reference.modalities?.output);
  if (!output && provider === "anthropic") output = ["text"];
  if (!output && Array.isArray(methods) && !methods.includes("generateContent")) output = [];
  const pricing = raw.pricing || reference.cost || {};
  const price = value => Number.isFinite(value) && value >= 0 ? value : null;
  const referencePriceKnown = !!raw.pricing || positive(pricing.input) || positive(pricing.output);
  return {
    provider, id, name: raw.display_name || raw.displayName || reference.name || id,
    releasedAt: released(raw.created_at || raw.release_date || reference.release_date || raw.created),
    input, output, imageInput: supported(capabilities.image_input) ?? (input ? input.includes("image") : null),
    reasoning: supported(capabilities.thinking) ?? supported(capabilities.reasoning) ?? supported(raw.reasoning) ?? supported(reference.reasoning),
    effortLevels: supported(capabilities.effort) === true ? ["low", "medium", "high", "xhigh", "max"].filter(level => supported(capabilities.effort[level]) === true) : [],
    structured: supported(capabilities.structured_outputs) ?? supported(raw.structured_output) ?? supported(reference.structured_output),
    contextWindow: positive(raw.context_window || reference.limit?.context),
    maxInputTokens: positive(raw.max_input_tokens || raw.inputTokenLimit || reference.limit?.input),
    maxOutputTokens: positive(raw.max_tokens || raw.outputTokenLimit || reference.limit?.output),
    methods: Array.isArray(methods) ? [...methods] : null,
    pricing: { input: referencePriceKnown ? price(pricing.input_per_million ?? pricing.input) : null, output: referencePriceKnown ? price(pricing.output_per_million ?? pricing.output) : null,
      image: raw.pricing ? price(pricing.per_image) : null },
    sources: ["provider", ...(Object.keys(reference).length ? ["reference catalog"] : [])]
  };
}

export function estimateAiCost(model, inputTokens, outputTokens, task = "writing") {
  if (task === "image") return model.pricing?.image ?? null;
  if (model.pricing?.input == null || model.pricing?.output == null) return null;
  return (Math.max(0, inputTokens || 0) * model.pricing.input + Math.max(0, outputTokens || 0) * model.pricing.output) / 1e6;
}

export function rankAiModels(models, task = "writing", options = {}) {
  const profile = Object.hasOwn(AI_TASKS, task) ? AI_TASKS[task] : null;
  if (!profile) throw new Error("Unsupported AI task");
  const now = options.now ?? Date.now(), observations = options.observations || [];
  const inputTokens = Math.max(0, options.inputTokens || 0), requestedOutputTokens = Math.max(0, options.outputTokens || 0);
  const requiresImages = !!(profile.images || options.images), choices = [];
  for (const model of models) {
    if (!model?.id || !model.provider) continue;
    const reasoningTokens = model.reasoning === true ? Math.max(0, Math.min(options.reasoningTokens || 0,
      (model.maxOutputTokens || requestedOutputTokens) - requestedOutputTokens,
      model.contextWindow ? model.contextWindow - inputTokens - requestedOutputTokens : Infinity)) : 0;
    const outputTokens = requestedOutputTokens + reasoningTokens;
    const explicit = model.sources?.includes("configured model");
    if (!model.output && !explicit) continue;
    if (model.output && !model.output.includes(profile.output)) continue;
    if (requiresImages && model.imageInput !== true && !explicit) continue;
    if (requiresImages && model.imageInput === false) continue;
    if (options.structured === "required" && model.structured !== true) continue;
    if (model.contextWindow && model.contextWindow < inputTokens + outputTokens) continue;
    if (model.maxInputTokens && model.maxInputTokens < inputTokens) continue;
    if (model.maxOutputTokens && model.maxOutputTokens < outputTokens) continue;
    if (!explicit && (inputTokens && !model.contextWindow && !model.maxInputTokens || outputTokens && !model.maxOutputTokens)) continue;
    if (model.provider === "gemini" && model.methods && !model.methods.includes("generateContent")) continue;
    const history = observations.filter(item => item.provider === model.provider && item.modelId === model.id &&
      (!options.scope || item.scope === options.scope) && Number.isFinite(item.at) && item.at <= now && now - item.at < 90 * 86400000 &&
      (!model.releasedAt || item.at >= model.releasedAt));
    if (history.some(item => item.status === "unavailable" && now - item.at < 15 * 60000)) continue;
    if (history.some(item => item.status === "unsupported" && item.task === task && item.requirements === options.requirements && now - item.at < 15 * 60000)) continue;
    const estimatedCost = estimateAiCost(model, inputTokens, outputTokens, task);
    if (options.maxCost != null && (estimatedCost == null || estimatedCost > options.maxCost)) continue;
    const ratings = history.filter(item => item.task === task && Number.isFinite(item.quality) && item.quality >= 0 && item.quality <= 1);
    const weight = item => Math.exp(-(now - item.at) / (30 * 86400000)) * Math.min(20, Math.max(1, item.samples || 1)) * (item.source === "accepted" ? 0.25 : 1);
    const ratedWeight = ratings.reduce((sum, item) => sum + weight(item), 0);
    const quality = (1 + ratings.reduce((sum, item) => sum + item.quality * weight(item), 0)) / (2 + ratedWeight);
    const qualitySamples = ratings.filter(item => item.source !== "accepted").reduce((sum, item) => sum + Math.min(20, Math.max(1, item.samples || 1)), 0);
    const outcomes = history.filter(item => item.task === task && ["success", "invalid", "unsupported", "unavailable"].includes(item.status));
    const reliability = (2 + outcomes.filter(item => item.status === "success").length) / (3 + outcomes.length);
    const timings = history.filter(item => item.task === task && item.status === "success" && positive(item.latencyMs));
    const latency = timings.length ? timings.reduce((sum, item) => sum + item.latencyMs, 0) / timings.length : null;
    const unknown = [];
    if (!model.output) unknown.push("output capability");
    if (requiresImages && model.imageInput == null) unknown.push("image input");
    if (options.structured === "required" && model.structured == null) unknown.push("structured output");
    if (inputTokens && !model.contextWindow && !model.maxInputTokens) unknown.push("context limit");
    if (outputTokens && !model.maxOutputTokens) unknown.push("output limit");
    if (options.requireKnown && unknown.length) continue;
    const age = model.releasedAt ? Math.max(0, now - model.releasedAt) / 86400000 : null;
    const score = quality * 75 + reliability * 12 + (model.reasoning ? profile.reasoning : 0) +
      (options.structured && model.structured ? 3 : 0) + (age == null ? 0 : 2 * Math.exp(-age / 365)) -
      unknown.length * 2 - (latency == null ? 0 : Math.min(profile.speed * 3, latency / 30000 * profile.speed)) -
      (estimatedCost == null ? 0 : Math.min(3, estimatedCost));
    const confidence = qualitySamples >= 3 ? "evaluated" : qualitySamples ? "limited" : "provisional";
    const reasons = [qualitySamples ? `${qualitySamples} task-specific quality rating${qualitySamples === 1 ? "" : "s"}` : "No task-quality evaluations yet"];
    const accepted = ratings.filter(item => item.source === "accepted").length;
    if (accepted) reasons.push(accepted + " accepted results used as a weak signal");
    for (const rubric of new Set(ratings.filter(item => item.rubric).map(item => item.rubric))) reasons.push("Evidence rubric: " + rubric);
    if (model.reasoning && profile.reasoning > 1) reasons.push("Declared reasoning support");
    if (reasoningTokens) reasons.push("Output allowance: " + outputTokens.toLocaleString("en-US") + " tokens including reasoning headroom");
    if (options.structured && model.structured) reasons.push("Declared structured output support");
    if (requiresImages && model.imageInput === true) reasons.push("Declared image input support");
    if (unknown.length) reasons.push("Unverified: " + unknown.join(", "));
    reasons.push("Release date is a minor signal, not a quality rating");
    const recentFailures = history.filter(item => item.task === task && ["output-limit", "context-limit", "invalid"].includes(item.status)).sort((first, second) => second.at - first.at).slice(0, 3).map(item => ({
      failure: item.status,
      outputTokens: Number.isSafeInteger(item.outputTokens) && item.outputTokens >= 0 ? item.outputTokens : null,
      thinkingTokens: Number.isSafeInteger(item.thinkingTokens) && item.thinkingTokens >= 0 && item.thinkingTokens <= item.outputTokens ? item.thinkingTokens : null,
      effort: ["low", "medium", "high", "xhigh", "max"].includes(item.effort) ? item.effort : null
    }));
    choices.push({ model, task, score, quality, confidence, reasons, estimatedCost, qualitySamples, unknown, outputTokens, reasoningTokens, recentFailures });
  }
  choices.sort((first, second) => second.score - first.score || (second.model.releasedAt || 0) - (first.model.releasedAt || 0) || first.model.id.localeCompare(second.model.id));
  const incumbent = choices.find(choice => choice.model.id === options.incumbent);
  if (incumbent) {
    const challenger = choices.find(choice => choice.model.id !== incumbent.model.id && choice.qualitySamples >= 3 && choice.quality > incumbent.quality + 0.03);
    const preferred = challenger || incumbent;
    preferred.reasons.push(challenger ? "Task evaluations support promotion" : "Retained the established model until a challenger is evaluated");
    choices.splice(choices.indexOf(preferred), 1); choices.unshift(preferred);
  }
  return choices;
}