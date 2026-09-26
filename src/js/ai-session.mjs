import { AI_TASKS } from "./ai-model-router.mjs";

export const AI_SESSION_KEY = "rk:ai:admin-session";
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function createAiSession({ storage, now = Date.now, randomId = () => crypto.randomUUID() } = {}) {
  let id = null, inputTokens = 0, outputTokens = 0, jobs = [];
  const listeners = new Set(), controllers = new Map(), usage = new Map();
  try {
    const saved = JSON.parse(storage?.getItem(AI_SESSION_KEY) || "null");
    if (saved?.version === 1 && typeof saved.id === "string") {
      id = saved.id; inputTokens = count(saved.inputTokens); outputTokens = count(saved.outputTokens);
      for (const item of (Array.isArray(saved.usage) ? saved.usage : []).slice(-300)) if (typeof item.id === "string") usage.set(item.id, { input: count(item.input), output: count(item.output) });
    }
  } catch {}
  function persist() {
    if (!id) return;
    try { storage?.setItem(AI_SESSION_KEY, JSON.stringify({ version: 1, id, inputTokens, outputTokens, usage: [...usage].slice(-300).map(([id, item]) => ({ id, ...item })) })); } catch {}
  }
  function state() {
    const active = jobs.filter(job => job.status === "running");
    return { id, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, active: active.length,
      phase: active.some(job => job.phase === "answering") ? "answering" : active.length ? "working" : "idle", jobs: structuredClone(jobs) };
  }
  function changed(save = false) { if (save) persist(); for (const listener of listeners) { try { listener(); } catch {} } }
  function start() { if (!id) { id = randomId(); persist(); } return id; }
  function update(jobId, action) {
    const job = jobs.find(job => job.id === jobId);
    if (!job || job.sessionId !== id) return;
    action(job); changed();
  }
  return {
    start, state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    begin(task, label) {
      const sessionId = start(), jobId = randomId(), controller = new AbortController();
      jobs.push({ id: jobId, sessionId, task, label: label || AI_TASKS[task]?.label || "AI request", status: "running", phase: "working", at: now(), inputTokens: 0, outputTokens: 0, requests: [], activity: [], outputs: [] });
      if (jobs.length > 30) {
        const removable = jobs.findIndex(job => job.status !== "running");
        if (removable >= 0) jobs.splice(removable, 1);
      }
      controllers.set(jobId, controller); changed();
      return { id: jobId, sessionId, signal: controller.signal };
    },
    route(jobId, route) {
      update(jobId, job => {
        const item = { id: route.id, role: route.agentOperation || route.agentRole || "request", provider: route.provider, model: route.modelName || route.modelId, status: route.status, task: route.task };
        const index = job.requests.findIndex(request => request.id === item.id);
        if (index < 0) job.requests.push(item); else job.requests[index] = item;
        if (route.status === "running" && job.status === "running") job.phase = "working";
      });
    },
    activity(jobId, event) {
      update(jobId, job => {
        if (typeof event.summary !== "string" || !event.summary.trim()) return;
        const item = { id: event.id, summary: event.summary.slice(0, 240), status: event.status };
        const index = job.activity.findIndex(entry => entry.id === item.id);
        if (index < 0) job.activity.push(item); else job.activity[index] = item;
        job.activity = job.activity.slice(-24);
      });
    },
    output(jobId, callId, text) {
      if (typeof text !== "string" || !text) return;
      update(jobId, job => {
        if (job.status !== "running") return;
        let output = job.outputs.find(item => item.id === callId);
        if (!output) { output = { id: callId, text: "", truncated: false }; job.outputs.push(output); }
        const available = Math.max(0, 64000 - job.outputs.reduce((total, item) => total + item.text.length, 0));
        output.text += text.slice(0, available); output.truncated ||= text.length > available;
        job.phase = "answering";
      });
    },
    recordUsage(input, output, context = {}) {
      if (context.estimated || context.sessionId && context.sessionId !== id) return;
      start();
      const callId = context.callId || randomId(), previous = usage.get(callId) || { input: 0, output: 0 };
      const next = { input: Math.max(previous.input, count(input)), output: Math.max(previous.output, count(output)) };
      const addedInput = next.input - previous.input, addedOutput = next.output - previous.output;
      if (!addedInput && !addedOutput) return;
      inputTokens += addedInput; outputTokens += addedOutput; usage.set(callId, next);
      const job = jobs.find(job => job.id === context.jobId && job.sessionId === id);
      if (job) { job.inputTokens += addedInput; job.outputTokens += addedOutput; }
      changed(true);
    },
    finish(jobId, status, error = "") {
      update(jobId, job => { job.status = job.status === "cancelled" ? "cancelled" : ["complete", "error", "cancelled"].includes(status) ? status : "error"; job.phase = "idle"; job.error = String(error || "").slice(0, 500); job.finishedAt = now(); });
      controllers.delete(jobId);
    },
    cancel(jobId) {
      const controller = controllers.get(jobId);
      if (!controller) return;
      controller.abort();
      update(jobId, job => { job.status = "cancelled"; job.phase = "idle"; });
    },
    end() {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear(); usage.clear(); jobs = []; id = null; inputTokens = 0; outputTokens = 0;
      try { storage?.removeItem(AI_SESSION_KEY); } catch {}
      changed();
    }
  };
}

export function siteAiSession(host = window) {
  if (!host.__rkAiSession) {
    let storage;
    try { storage = host.sessionStorage; } catch {}
    Object.defineProperty(host, "__rkAiSession", { value: createAiSession({ storage }), configurable: true });
  }
  return host.__rkAiSession;
}

export function aiOutputPreview(text) {
  const source = String(text || "").trim();
  if (!source) return { kind: "pending" };
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)(?:\n```)?$/.exec(source);
  const candidate = fenced ? fenced[1] : source;
  if (/^[\[{]/.test(candidate)) {
    try { return { kind: "structured", value: JSON.parse(candidate) }; }
    catch { return { kind: "pending" }; }
  }
  if (/^```/.test(source)) return { kind: "pending" };
  return { kind: "text", value: text };
}

export function mountAiSession(root, session, icons, { onSettings } = {}) {
  const trigger = root.querySelector("[data-ai-session-toggle]"), panel = root.querySelector("[data-ai-session-panel]");
  const document = root.ownerDocument;
  const renderedOutputs = new WeakMap();
  let scheduled = 0;
  panel.innerHTML = '<header class="adm__ai-head"><h2>AI activity</h2>' + (onSettings ? '<button type="button" class="adm__ai-close" data-ai-settings aria-label="AI settings" title="AI settings">' + icons.settings + '</button>' : '') + '<button type="button" class="adm__ai-close" data-ai-close aria-label="Close AI activity" title="Close AI activity">' + icons.close + '</button></header><div class="adm__ai-total" data-ai-total></div><div class="adm__ai-jobs" data-ai-jobs></div>';
  function fieldLabel(key) {
    return ({ q: "Question", why: "Focus", a: "Answer" })[key] || key.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase());
  }
  function readableValue(value, depth = 0, budget = { remaining: 400 }) {
    const element = document.createElement(value && typeof value === "object" ? Array.isArray(value) ? "ol" : "dl" : "p");
    if (depth > 8 || --budget.remaining < 0) { element.textContent = "More content in Original response."; return element; }
    if (Array.isArray(value)) {
      element.className = "adm__ai-items";
      for (const item of value) {
        const row = document.createElement("li"); row.append(readableValue(item, depth + 1, budget)); element.append(row);
        if (budget.remaining < 0) break;
      }
    } else if (value && typeof value === "object") {
      element.className = "adm__ai-fields";
      for (const [key, item] of Object.entries(value)) {
        const label = document.createElement("dt"), content = document.createElement("dd");
        label.textContent = fieldLabel(key); content.append(readableValue(item, depth + 1, budget)); element.append(label, content);
        if (budget.remaining < 0) break;
      }
    } else element.textContent = value === null ? "Not specified" : String(value);
    return element;
  }
  function close(focus = true) { panel.hidden = true; trigger.setAttribute("aria-expanded", "false"); if (focus && trigger.isConnected) trigger.focus(); }
  function render() {
    scheduled = 0;
    const state = session.state(), formatter = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
    trigger.dataset.aiState = state.phase;
    trigger.querySelector("[data-ai-session-count]").textContent = formatter.format(state.totalTokens) + " tokens";
    trigger.title = state.totalTokens.toLocaleString("en-US") + " tokens this session (" + state.inputTokens.toLocaleString("en-US") + " input, " + state.outputTokens.toLocaleString("en-US") + " output)";
    trigger.setAttribute("aria-label", "AI activity: " + state.totalTokens.toLocaleString("en-US") + " tokens this session" + (state.active ? ", " + state.phase : ""));
    if (!state.id) {
      panel.querySelector("[data-ai-jobs]").replaceChildren();
      panel.querySelector("[data-ai-total]").textContent = "";
    }
    if (panel.hidden) return;
    const total = panel.querySelector("[data-ai-total]");
    if (!total.children.length) total.innerHTML = '<span>Session tokens</span><dl><div><dt>Input</dt><dd data-ai-input-count></dd></div><div><dt>Output</dt><dd data-ai-output-count></dd></div></dl>';
    total.querySelector("[data-ai-input-count]").textContent = state.inputTokens.toLocaleString("en-US");
    total.querySelector("[data-ai-output-count]").textContent = state.outputTokens.toLocaleString("en-US");
    const list = panel.querySelector("[data-ai-jobs]"), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    const existing = new Map([...list.children].map(element => [element.dataset.jobId, element]));
    if (!state.jobs.length) { list.textContent = "No AI requests in this view."; return; }
    if (!list.querySelector("[data-job-id]")) list.replaceChildren();
    for (const job of state.jobs) {
      let entry = existing.get(job.id);
      if (!entry) {
        entry = document.createElement("article"); entry.className = "adm__ai-job"; entry.dataset.jobId = job.id;
        entry.innerHTML = '<div class="adm__ai-jobhead"><h3></h3><button type="button" class="adm__ai-stop" aria-label="Stop AI request" title="Stop AI request">' + icons.stop + '</button></div><p data-ai-jobstatus role="status"></p><p class="adm__ai-current" data-ai-current></p><div data-ai-outputs></div><details class="adm__ai-details" data-ai-request-details><summary>Request details</summary><ol data-ai-steps></ol></details><p data-ai-error role="alert"></p>';
        entry.querySelector("button").onclick = () => session.cancel(job.id); list.append(entry);
      }
      existing.delete(job.id);
      entry.dataset.status = job.status;
      entry.querySelector("h3").textContent = job.label;
      const stop = entry.querySelector("button"); stop.hidden = job.status !== "running";
      const status = job.status === "running" ? job.phase === "answering" ? "Drafting" : "Working" : job.status === "complete" ? "Complete" : job.status === "cancelled" ? "Stopped" : "Failed";
      const statusElement = entry.querySelector("[data-ai-jobstatus]");
      if (statusElement.textContent !== status) statusElement.textContent = status;
      const current = entry.querySelector("[data-ai-current]");
      current.textContent = job.activity.at(-1)?.summary || (job.status === "running" ? "Waiting for the response" : "");
      current.hidden = !current.textContent;
      const steps = entry.querySelector("[data-ai-steps]"); steps.replaceChildren();
      for (const request of job.requests) {
        const item = document.createElement("li"); item.textContent = [request.role, request.model, request.status].filter(Boolean).join(" / "); steps.append(item);
      }
      for (const activity of job.activity) { const item = document.createElement("li"); item.textContent = activity.summary; steps.append(item); }
      const outputs = entry.querySelector("[data-ai-outputs]");
      for (const output of job.outputs) {
        let section = [...outputs.children].find(element => element.dataset.callId === output.id);
        if (!section) {
          section = document.createElement("section"); section.className = "adm__ai-output"; section.dataset.callId = output.id;
          section.innerHTML = '<div class="adm__ai-outputhead"><h4></h4><span data-ai-output-state></span></div><div class="adm__ai-readable" aria-label="Generated output" tabindex="0"></div><p class="adm__ai-receiving" data-ai-receiving></p><details class="adm__ai-details"><summary>Original response</summary><pre aria-label="Original response" tabindex="0"></pre></details>';
          outputs.append(section);
        }
        const request = job.requests.find(item => item.id === output.id);
        section.querySelector("h4").textContent = request?.role === "delegate" ? "Supporting notes" : request?.role === "revision" ? "Revised draft" : "Draft";
        section.querySelector("[data-ai-output-state]").textContent = job.status === "error" || job.status === "cancelled" ? "Partial" : request?.status === "running" && job.status === "running" ? "In progress" : "Received";
        const previous = renderedOutputs.get(section);
        if (previous?.text !== output.text || previous?.status !== job.status || previous?.truncated !== output.truncated) {
          const preview = aiOutputPreview(output.text), readable = section.querySelector(".adm__ai-readable"), receiving = section.querySelector("[data-ai-receiving]");
          readable.replaceChildren();
          if (preview.kind === "structured") readable.append(readableValue(preview.value));
          else if (preview.kind === "text") readable.textContent = preview.value;
          readable.hidden = preview.kind === "pending";
          receiving.hidden = preview.kind !== "pending" && !output.truncated;
          receiving.textContent = output.truncated ? "Preview limit reached. The request can continue." : preview.kind === "pending" ? (job.status === "running" ? "Receiving structured draft" : "Structured preview unavailable") + " · " + output.text.length.toLocaleString("en-US") + " characters" : "";
          section.querySelector("pre").textContent = output.text + (output.truncated ? "\n[Display limit reached]" : "");
          renderedOutputs.set(section, { text: output.text, status: job.status, truncated: output.truncated });
        }
      }
      entry.querySelector("[data-ai-error]").textContent = job.error || "";
    }
    for (const entry of existing.values()) entry.remove();
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
  function schedule() { if (!scheduled) scheduled = requestAnimationFrame(render); }
  trigger.onclick = () => { panel.hidden = !panel.hidden; trigger.setAttribute("aria-expanded", String(!panel.hidden)); render(); if (!panel.hidden) panel.querySelector("[data-ai-close]").focus(); };
  panel.querySelector("[data-ai-close]").onclick = () => close();
  if (onSettings) panel.querySelector("[data-ai-settings]").onclick = () => { close(false); onSettings(); };
  const escape = event => { if (event.key === "Escape" && !panel.hidden && ![...document.querySelectorAll('.pass,[role="dialog"][aria-modal="true"]')].some(dialog => dialog.getClientRects().length)) { event.preventDefault(); close(); } };
  document.addEventListener("keydown", escape);
  const unsubscribe = session.subscribe(schedule); render();
  return { close, dispose() { unsubscribe(); cancelAnimationFrame(scheduled); document.removeEventListener("keydown", escape); } };
}