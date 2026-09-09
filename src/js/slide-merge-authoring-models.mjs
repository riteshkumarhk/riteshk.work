export function deckModelCandidates(provider, available = [], fallback = []) {
  if (provider === "custom") return [...new Set(fallback)];
  const ranks = {
    anthropic: [/claude.*opus/i, /claude.*sonnet/i, /claude.*haiku/i],
    openai: [/^gpt-5(?!.*(?:mini|nano|chat|codex))/i, /^o3(?:$|-)/i, /^gpt-4\.1(?!.*(?:mini|nano))/i, /^gpt-4o(?:$|-20)/i],
    gemini: [/gemini.*pro(?!.*image)/i, /gemini.*flash(?!.*(?:lite|image))/i]
  }[provider] || [];
  const rank = model => { const index = ranks.findIndex(pattern => pattern.test(model)); return index < 0 ? ranks.length : index; };
  const usable = available.filter(model => typeof model === "string" && !/embed|audio|image|vision|tts|whisper|moderation|realtime/i.test(model));
  usable.sort((first, second) => rank(first) - rank(second) || second.localeCompare(first, "en", { numeric: true }));
  return [...new Set([...usable, ...fallback])];
}