import { validateAssessmentPlan } from './resume-assessment-pilot.mjs';

export async function createAssessmentBudgetClient({ request, budget, signal }) {
  if (typeof request !== 'function' || budget?.scope !== 'server' || budget.approved !== true || budget.id !== 'candidate-review') throw new Error('Explicit central assessment budget approval is required.');
  const maximum = budget.maxCost;
  let status;
  const accept = value => {
    value = structuredClone(value);
    if (value?.version !== 1 || value.scope !== 'server' || value.id !== 'candidate-review' || value.approved !== true || value.maxCost !== maximum ||
        !Number.isFinite(value.reserved) || value.reserved < 0 || value.reserved > maximum) throw new Error('The server budget acknowledgement is invalid. No browser fallback is allowed.');
    status = value;
  };
  accept(await request('approve', { confirmed: true, maxCost: maximum }, signal));
  return {
    budget: () => structuredClone(status),
    async refresh() {
      accept(await request('budget', undefined, signal));
      return structuredClone(status);
    },
    async reserve(plan) {
      validateAssessmentPlan(plan);
      const value = await request('reserve', structuredClone(plan), signal);
      if (value.id !== plan.id || value.amount !== plan.amount) throw new Error('The central phase reservation was not acknowledged exactly.');
      accept(value.budget);
      return { id: value.id, amount: value.amount };
    },
    async invoke(reservationId, input) {
      const { provider, model, stage, system, user, maxTokens, responseContract } = input;
      const value = await request('execute', { reservationId, provider, model, stage, system, user, maxTokens,
        ...(responseContract === undefined ? {} : { responseContract }) }, input.signal);
      accept(value.budget);
      return structuredClone(value.receipt);
    }
  };
}
