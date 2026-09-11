import { AI_TASKS } from "./ai-model-router.mjs";

export function mountAiRoutingPanel(panel, { router, catalog, configurations, invoke, confirm, escape, icons, onPolicy, evaluationState, stopEvaluation }) {
  let controller = null, disposed = false, refreshSequence = 0;
  const money = amount => amount == null ? "Unknown price" : "$" + amount.toFixed(5);
  panel.classList.add("aiuse", "airoute");
  panel.setAttribute("aria-label", "Model routing");
  panel.innerHTML = '<div class="aiuse__head"><span class="aiuse__ttl">Model routing</span><button type="button" class="btn btn--ghost airoute__icon" data-route-refresh title="Refresh accessible models" aria-label="Refresh accessible models">' + icons.refresh + '</button></div>' +
    '<div class="aiuse__note">Device-local settings and evidence</div>' +
    '<div class="airoute__fields"><label class="airoute__field">Provider scope<select data-route-policy="providers"><option value="selected">Selected service</option><option value="connected">All connected services</option></select></label>' +
    '<label class="airoute__field">Task<select data-route-task>' + Object.entries(AI_TASKS).map(([id, task]) => '<option value="' + id + '">' + task.label + '</option>').join("") + '</select></label>' +
    '<label class="airoute__field">Request limit (estimated USD)<input data-route-policy="maxCost" type="number" min="0.00001" step="0.01" placeholder="No limit" /></label>' +
    '<label class="airoute__field">Daily test budget (estimated USD)<input data-route-policy="evaluationDailyBudget" type="number" min="0" step="0.01" /></label></div>' +
    '<label class="chk" title="Anonymous metadata request; no credentials or prompts are sent"><input type="checkbox" data-route-policy="useReference" /> models.dev capability and pricing metadata</label>' +
    '<label class="chk"><input type="checkbox" data-route-policy="autoEvaluate" /> Automatic newcomer tests (paid)</label>' +
    '<div class="aiuse__note" data-route-budget></div><div class="aiuse__note" data-route-catalog role="status"></div>' +
    '<div data-route-choices></div><div class="airoute__tools"><button type="button" class="btn btn--ghost" data-route-evaluate>' + icons.spark + ' Evaluate newcomer</button>' +
    '<button type="button" class="btn btn--ghost" data-route-stop hidden>' + icons.close + ' Stop tests</button>' +
    '<button type="button" class="btn btn--ghost" data-route-import>' + icons.upload + ' Import evaluations</button><input type="file" accept="application/json,.json" data-route-file hidden /></div>' +
    '<p class="pass__err" data-route-error role="alert"></p><div data-route-results></div><div class="aiuse__sub">Recent selections</div><div data-route-history></div>';
  const task = panel.querySelector("[data-route-task]"), error = panel.querySelector("[data-route-error]");
  task.value = "creative";
  const report = failure => { if (!disposed) error.textContent = failure?.message || String(failure); };
  function disclosures(host) {
    host.querySelectorAll("summary").forEach(summary => {
      const icon = document.createElement("span"); icon.className = "airoute__chevron"; icon.innerHTML = icons.chevron; summary.prepend(icon);
    });
  }
  function feedbackControls(decision, observation) {
    if (decision.status !== "success") return "";
    return '<div class="airoute__rating" data-route-rating="' + escape(decision.id) + '"><label class="airoute__field">Quality<select data-route-quality aria-label="Rate ' + escape(decision.modelId) + '"><option value="">Not rated</option>' +
      [[0.95, "Excellent"], [0.8, "Useful"], [0.3, "Needs work"], [0.05, "Rejected"]].map(([value, label]) => '<option value="' + value + '"' + (observation?.quality === value ? " selected" : "") + '>' + label + '</option>').join("") + '</select></label>' +
      '<label class="airoute__field">Category<select data-route-reason><option value="instructions">Instructions</option><option value="accuracy">Accuracy</option><option value="clarity">Clarity</option><option value="design">Design</option></select></label>' +
      '<button type="button" class="btn btn--ghost" data-route-feedback>Save rating</button></div>';
  }
  async function history(fill = false) {
    const state = await router.state();
    if (disposed) return;
    if (fill) panel.querySelectorAll("[data-route-policy]").forEach(input => {
      const value = state.policy[input.dataset.routePolicy];
      if (input.type === "checkbox") input.checked = !!value;
      else input.value = value ?? "";
    });
    const today = new Date().toISOString().slice(0, 10);
    panel.querySelector("[data-route-budget]").textContent = "Tests today: " + money(state.evaluationDay === today ? state.evaluationReserved : 0) + " / " + money(state.policy.evaluationDailyBudget) + ". Estimates are not provider billing caps.";
    const host = panel.querySelector("[data-route-history]");
    host.innerHTML = state.decisions.slice(-8).reverse().map(decision => {
      const feedback = state.observations.find(item => item.feedbackFor === decision.id);
      return '<details class="airoute__entry"><summary>' + escape(decision.modelName || decision.modelId) + ' / ' + escape(AI_TASKS[decision.task]?.label || decision.task) + '</summary>' +
        '<p class="aiuse__note">' + escape([decision.provider, decision.confidence, decision.status, decision.fallback ? "Fallback" : "", decision.evaluation ? "Synthetic evaluation" : "", decision.failure || ""].filter(Boolean).join(" / ")) + '</p>' +
        '<ul>' + decision.reasons.map(reason => '<li>' + escape(reason) + '</li>').join("") + '</ul>' +
        '<p class="aiuse__note">' + escape(new Date(decision.at).toLocaleString()) + ' / ' + money(decision.estimatedCost) + (feedback ? ' / Feedback saved' : '') + '</p>' + feedbackControls(decision, feedback) + '</details>';
    }).join("") || '<p class="aiuse__note">No selections recorded.</p>';
    disclosures(host);
    host.querySelectorAll("[data-route-feedback]").forEach(button => button.addEventListener("click", async () => {
      const row = button.closest("[data-route-rating]"), quality = row.querySelector("[data-route-quality]").value;
      if (!quality) { report(new Error("Choose a quality rating first")); return; }
      button.disabled = true;
      try {
        await router.feedback(row.dataset.routeRating, { quality: Number(quality), reason: row.querySelector("[data-route-reason]").value });
        button.textContent = "Rating saved"; error.textContent = "";
        await loadModels();
      } catch (failure) { report(failure); }
      finally { if (!disposed) button.disabled = false; }
    }));
  }
  async function loadModels(refresh = false) {
    const sequence = ++refreshSequence, label = panel.querySelector("[data-route-catalog]");
    label.textContent = "Discovering accessible models...";
    try {
      const configs = await configurations(), state = await router.state();
      const discovered = await Promise.all(configs.map(config => catalog.discover(config, { refresh, useReference: state.policy.useReference })));
      const choices = await router.choices(configs, task.value, { inputTokens: 4096, outputTokens: 2048 });
      if (disposed || sequence !== refreshSequence) return;
      label.textContent = discovered.reduce((count, entry) => count + entry.models.length, 0) + " accessible models / updated " + new Date(Math.max(...discovered.map(entry => entry.updatedAt))).toLocaleTimeString();
      panel.querySelector("[data-route-choices]").innerHTML = choices.slice(0, 3).map(choice => '<details class="airoute__entry"><summary>' + escape(choice.model.name) + ' / ' + choice.confidence + '</summary><p class="aiuse__note">' + escape(choice.model.provider) + ' / ' + money(choice.estimatedCost) + ' at 4,096 input + 2,048 output tokens</p><ul>' + choice.reasons.map(reason => '<li>' + escape(reason) + '</li>').join("") + '</ul></details>').join("");
      disclosures(panel.querySelector("[data-route-choices]"));
    } catch (failure) {
      if (disposed || sequence !== refreshSequence) return;
      label.textContent = failure.message;
      panel.querySelector("[data-route-choices]").replaceChildren();
    }
  }
  panel.querySelectorAll("[data-route-policy]").forEach(input => input.addEventListener("change", async () => {
    const key = input.dataset.routePolicy, previous = (await router.state()).policy[key];
    const value = input.type === "checkbox" ? input.checked : input.type === "number" ? input.value === "" && key === "maxCost" ? null : Number(input.value) : input.value;
    input.disabled = true;
    try {
      if (key === "providers" && value === "connected" && !await confirm({ title: "Route across connected services?", sub: "Future AI requests may send their content to any connected provider. Your selected service remains the only destination until you allow this.", cta: "Allow", cancel: "Keep selected" })) { input.value = previous; return; }
      if (key === "autoEvaluate" && value && !await confirm({ title: "Enable paid model tests?", sub: "Newcomer tests send up to three synthetic prompts per evaluation within your daily estimated budget. No case-study content is used. Price estimates are not provider billing caps.", cta: "Enable tests", cancel: "Cancel" })) { input.checked = previous; return; }
      await router.configure({ [key]: value });
      error.textContent = "";
      onPolicy?.(key, value);
      await history(); await loadModels();
    } catch (failure) { if (input.type === "checkbox") input.checked = previous; else input.value = previous ?? ""; report(failure); }
    finally { if (!disposed) input.disabled = false; }
  }));
  panel.querySelector("[data-route-refresh]").addEventListener("click", () => loadModels(true));
  task.addEventListener("change", () => loadModels());
  const evaluate = panel.querySelector("[data-route-evaluate]"), stop = panel.querySelector("[data-route-stop]");
  function showEvaluation(result) {
    if (!result || disposed) return;
    panel.querySelector("[data-route-results]").innerHTML = '<div class="aiuse__sub">' + escape(result.modelId) + ' / ' + result.results.filter(item => item.score === 1).length + ' of ' + result.results.length + ' checks passed</div>' + result.results.map(item => '<details class="airoute__entry"><summary>Trial ' + item.decision.fixture + ' / ' + (item.score === 1 ? "Checks passed" : "Checks failed") + '</summary><pre>' + escape(item.text) + '</pre></details>').join("");
    disclosures(panel.querySelector("[data-route-results]"));
  }
  const automaticChanged = () => {
    if (disposed) return;
    const state = evaluationState?.();
    if (!state || controller) return;
    evaluate.disabled = state.running; stop.hidden = !state.running;
    if (state.running) evaluate.textContent = "Testing a newcomer...";
    else { evaluate.innerHTML = icons.spark + " Evaluate newcomer"; showEvaluation(state.result); if (state.error) report(state.error); history().catch(report); }
  };
  evaluate.addEventListener("click", async () => {
    if (evaluationState?.().running) { report(new Error("Automatic tests are already running")); return; }
    const pending = new AbortController(); controller = pending;
    evaluate.disabled = true; stop.hidden = false; error.textContent = "";
    try {
      const configs = await configurations(), selectedTask = task.value;
      const approval = await router.planEvaluation(configs, selectedTask, { signal: pending.signal });
      if (!await confirm({ title: "Evaluate " + approval.modelId + "?", sub: approval.calls + " synthetic requests. Reserve " + money(approval.estimatedCost) + " from the daily test budget. " + (approval.objective ? "Scores basic reasoning checks only." : "Checks copy constraints; creative quality still needs your rating."), cta: "Run paid tests", cancel: "Cancel" })) return;
      pending.signal.throwIfAborted();
      const result = await router.evaluate(configs, selectedTask, { approval, signal: pending.signal, onProgress: progress => { if (!disposed) evaluate.textContent = progress.completed + " / " + progress.total + " tested"; } }, invoke);
      if (disposed) return;
      showEvaluation(result);
      await history(); await loadModels();
    } catch (failure) { if (!pending.signal.aborted) report(failure); else if (!disposed) error.textContent = "Tests stopped. Started requests remain reserved."; }
    finally { if (controller === pending) controller = null; if (!disposed) { evaluate.disabled = false; evaluate.innerHTML = icons.spark + " Evaluate newcomer"; stop.hidden = true; await history().catch(report); } }
  });
  stop.addEventListener("click", () => { controller?.abort(); stopEvaluation?.(); });
  const file = panel.querySelector("[data-route-file]");
  panel.querySelector("[data-route-import]").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    try {
      const selected = file.files[0]; if (!selected) return;
      if (selected.size > 256000) throw new Error("Evaluation imports must be under 256 KB");
      const count = await router.importEvaluations(JSON.parse(await selected.text()));
      error.textContent = ""; panel.querySelector("[data-route-results]").textContent = count + " evaluation records imported.";
      await history(); await loadModels();
    } catch (failure) { report(failure); }
    finally { file.value = ""; }
  });
  const changed = () => history().catch(report);
  window.addEventListener("rk:ai-route", changed);
  window.addEventListener("rk:ai-evaluation", automaticChanged);
  const observer = new MutationObserver(() => { if (!panel.isConnected) cleanup(); else if (panel.closest("[hidden]")) controller?.abort(); });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  function cleanup() { if (disposed) return; disposed = true; controller?.abort(); observer.disconnect(); window.removeEventListener("rk:ai-route", changed); window.removeEventListener("rk:ai-evaluation", automaticChanged); }
  history(true).then(() => loadModels()).catch(report);
  automaticChanged();
  return cleanup;
}