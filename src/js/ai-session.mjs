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

export function mountAiSession(root, session, icons) {
  const trigger = root.querySelector("[data-ai-session-toggle]"), panel = root.querySelector("[data-ai-session-panel]");
  const document = root.ownerDocument;
  let scheduled = 0;
  panel.innerHTML = '<header class="adm__ai-head"><h2>AI activity</h2><button type="button" class="adm__ai-close" data-ai-close aria-label="Close AI activity" title="Close AI activity">' + icons.close + '</button></header><div class="adm__ai-total" data-ai-total></div><div class="adm__ai-jobs" data-ai-jobs></div>';
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
    panel.querySelector("[data-ai-total]").textContent = state.inputTokens.toLocaleString("en-US") + " input / " + state.outputTokens.toLocaleString("en-US") + " output tokens";
    const list = panel.querySelector("[data-ai-jobs]"), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    const existing = new Map([...list.children].map(element => [element.dataset.jobId, element]));
    if (!state.jobs.length) { list.textContent = "No AI requests in this view."; return; }
    if (!list.querySelector("[data-job-id]")) list.replaceChildren();
    for (const job of state.jobs) {
      let entry = existing.get(job.id);
      if (!entry) {
        entry = document.createElement("article"); entry.className = "adm__ai-job"; entry.dataset.jobId = job.id;
        entry.innerHTML = '<div class="adm__ai-jobhead"><h3></h3><button type="button" class="adm__ai-stop" aria-label="Stop AI request" title="Stop AI request">' + icons.stop + '</button></div><p data-ai-jobstatus role="status"></p><ol data-ai-steps></ol><div data-ai-outputs></div><p data-ai-error role="alert"></p>';
        entry.querySelector("button").onclick = () => session.cancel(job.id); list.append(entry);
      }
      existing.delete(job.id);
      entry.querySelector("h3").textContent = job.label;
      const stop = entry.querySelector("button"); stop.hidden = job.status !== "running";
      entry.querySelector("[data-ai-jobstatus]").textContent = [job.status === "running" ? job.phase === "answering" ? "Answering" : "Working" : job.status === "complete" ? "Complete" : job.status === "cancelled" ? "Cancelled" : "Failed", job.inputTokens + job.outputTokens ? (job.inputTokens + job.outputTokens).toLocaleString("en-US") + " tokens" : ""].filter(Boolean).join(" / ");
      const steps = entry.querySelector("[data-ai-steps]"); steps.replaceChildren();
      for (const request of job.requests) {
        const item = document.createElement("li"); item.textContent = [request.role, request.model, request.status].filter(Boolean).join(" / "); steps.append(item);
      }
      for (const activity of job.activity) { const item = document.createElement("li"); item.textContent = activity.summary; steps.append(item); }
      const outputs = entry.querySelector("[data-ai-outputs]");
      for (const output of job.outputs) {
        let pre = [...outputs.children].find(element => element.dataset.callId === output.id);
        if (!pre) { pre = document.createElement("pre"); pre.dataset.callId = output.id; pre.tabIndex = 0; pre.setAttribute("aria-label", "Generated output"); outputs.append(pre); }
        pre.textContent = output.text + (output.truncated ? "\n[Display limit reached]" : "");
      }
      entry.querySelector("[data-ai-error]").textContent = job.error || "";
    }
    for (const entry of existing.values()) entry.remove();
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
  function schedule() { if (!scheduled) scheduled = requestAnimationFrame(render); }
  trigger.onclick = () => { panel.hidden = !panel.hidden; trigger.setAttribute("aria-expanded", String(!panel.hidden)); render(); if (!panel.hidden) panel.querySelector("[data-ai-close]").focus(); };
  panel.querySelector("[data-ai-close]").onclick = () => close();
  const escape = event => { if (event.key === "Escape" && !panel.hidden && ![...document.querySelectorAll('.pass,[role="dialog"][aria-modal="true"]')].some(dialog => dialog.getClientRects().length)) { event.preventDefault(); close(); } };
  document.addEventListener("keydown", escape);
  const unsubscribe = session.subscribe(schedule); render();
  return { close, dispose() { unsubscribe(); cancelAnimationFrame(scheduled); document.removeEventListener("keydown", escape); } };
}