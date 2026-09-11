import { AI_TASKS } from "./ai-model-router.mjs";

export function mountAiRoutingPanel(panel, { router, catalog, configurations, invoke, confirm, escape, icons, onPolicy, evaluationState, stopEvaluation }) {
  let disposed = false, refreshSequence = 0;
  const money = amount => amount == null ? "Unknown price" : "$" + amount.toFixed(5);
  panel.classList.add("aiuse", "airoute");
  panel.setAttribute("aria-label", "AI orchestration");
  panel.innerHTML = '<div class="aiuse__head"><span class="aiuse__ttl">AI orchestration</span><button type="button" class="btn btn--ghost airoute__icon" data-route-refresh title="Refresh accessible models" aria-label="Refresh accessible models">' + icons.refresh + '</button></div>' +
    '<div class="aiuse__note">Agent-led</div>' +
    '<div class="airoute__fields"><label class="airoute__field">Allowed services<select data-route-policy="providers"><option value="selected">Selected service</option><option value="connected">All connected services</option></select></label>' +
    '<label class="airoute__field">Job limit (estimated USD)<input data-route-policy="maxCost" type="number" min="0.00001" step="0.01" placeholder="No limit" /></label></div>' +
    '<div class="aiuse__note" data-route-catalog role="status"></div>' +
    '<details class="airoute__entry airoute__advanced"><summary>Diagnostics and evaluation limits</summary><div class="airoute__fields">' +
    '<label class="airoute__field">Daily test budget (estimated USD)<input data-route-policy="evaluationDailyBudget" type="number" min="0" step="0.01" /></label></div>' +
    '<label class="chk" title="Anonymous metadata request; no credentials or prompts are sent"><input type="checkbox" data-route-policy="useReference" /> models.dev capability and pricing metadata</label>' +
    '<label class="chk"><input type="checkbox" data-route-policy="autoEvaluate" /> Automatic newcomer tests (paid)</label>' +
    '<div class="aiuse__note" data-route-budget></div><div class="aiuse__note" data-route-eval-status role="status"></div>' +
    '<div class="airoute__tools">' +
    '<button type="button" class="btn btn--ghost" data-route-stop hidden>' + icons.close + ' Stop tests</button>' +
    '<button type="button" class="btn btn--ghost" data-route-import>' + icons.upload + ' Import evaluations</button><input type="file" accept="application/json,.json" data-route-file hidden /></div>' +
    '<div data-route-results></div></details><p class="pass__err" data-route-error role="alert"></p><div class="aiuse__sub">Recent agent activity</div><div data-route-history></div>';
  const error = panel.querySelector("[data-route-error]");
  const report = failure => { if (!disposed) error.textContent = failure?.message || String(failure); };
  function disclosures(host) {
    host.querySelectorAll("summary").forEach(summary => {
      const icon = document.createElement("span"); icon.className = "airoute__chevron"; icon.innerHTML = icons.chevron; summary.prepend(icon);
    });
  }
  function feedbackControls(decision, observation) {
    if (decision.status !== "success" || decision.agentRole && decision.agentRole !== "result") return "";
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
        '<p class="aiuse__note">' + escape([decision.agentRole, decision.provider, decision.confidence, decision.status, decision.fallback ? "Fallback" : "", decision.evaluation ? "Synthetic evaluation" : "", decision.failure || "", decision.httpStatus ? "HTTP " + decision.httpStatus : "", decision.errorType, decision.failurePhase].filter(Boolean).join(" / ")) + '</p>' +
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
      if (disposed || sequence !== refreshSequence) return;
      label.textContent = discovered.reduce((count, entry) => count + entry.models.length, 0) + " accessible models / updated " + new Date(Math.max(...discovered.map(entry => entry.updatedAt))).toLocaleTimeString();
    } catch (failure) {
      if (disposed || sequence !== refreshSequence) return;
      label.textContent = failure.message;
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
  const stop = panel.querySelector("[data-route-stop]");
  function showEvaluation(result) {
    if (!result || disposed) return;
    panel.querySelector("[data-route-results]").innerHTML = '<div class="aiuse__sub">' + escape(result.modelId) + ' / ' + result.results.filter(item => item.score === 1).length + ' of ' + result.results.length + ' checks passed</div>' + result.results.map(item => '<details class="airoute__entry"><summary>Trial ' + item.decision.fixture + ' / ' + (item.score === 1 ? "Checks passed" : "Checks failed") + '</summary><pre>' + escape(item.text) + '</pre></details>').join("");
    disclosures(panel.querySelector("[data-route-results]"));
  }
  const automaticChanged = () => {
    if (disposed) return;
    const state = evaluationState?.();
    if (!state) return;
    stop.hidden = !state.running;
    panel.querySelector("[data-route-eval-status]").textContent = state.running ? "Background model tests running" : "";
    if (!state.running) { showEvaluation(state.result); if (state.error) report(state.error); history().catch(report); }
  };
  stop.addEventListener("click", () => stopEvaluation?.());
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
  const observer = new MutationObserver(() => { if (!panel.isConnected) cleanup(); });
  observer.observe(document.body, { childList: true, subtree: true });
  function cleanup() { if (disposed) return; disposed = true; observer.disconnect(); window.removeEventListener("rk:ai-route", changed); window.removeEventListener("rk:ai-evaluation", automaticChanged); }
  disclosures(panel.querySelector(".airoute__advanced"));
  history(true).then(() => loadModels()).catch(report);
  automaticChanged();
  return cleanup;
}