const SONNET = 'claude-sonnet-5-5';
export function assessmentRequestPolicy(provider, model, reasoning = false) {
  if (provider === 'anthropic') return model === SONNET ? 'anthropic-sonnet-5-5-medium-v1'
    : reasoning ? 'anthropic-reasoning-default-v1' : 'anthropic-temperature-zero-v1';
  if (provider === 'openai') return reasoning ? 'openai-reasoning-v1' : 'openai-temperature-zero-v1';
  throw new Error('Unsupported assessment request provider.');
}
export function validateAssessmentRequestPolicy(value, provider, model) {
  const allowed = provider === 'anthropic'
    ? [assessmentRequestPolicy(provider, model, false), assessmentRequestPolicy(provider, model, true)]
    : provider === 'openai' ? ['openai-reasoning-v1', 'openai-temperature-zero-v1'] : [];
  if (!allowed.includes(value)) throw new Error('Unknown or incompatible assessment request policy.');
  return value;
}
export function assessmentRequestParameters(provider, model, reasoning = false) {
  const policy = assessmentRequestPolicy(provider, model, reasoning);
  if (policy === 'anthropic-sonnet-5-5-medium-v1') return { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } };
  return ['openai-reasoning-v1', 'anthropic-reasoning-default-v1'].includes(policy) ? {} : { temperature: 0 };
}
export function assessmentStructuredOutput(provider, model, configured) {
  if (configured !== undefined && typeof configured !== 'boolean') throw new Error('Structured-output support must be explicitly boolean.');
  return ['anthropic', 'openai'].includes(provider) && (configured ?? (provider === 'anthropic' && model === SONNET));
}
