export const AI_TEXT_REQUEST_ATTEMPTS = 2;

export function aiEmbeddingInput(value) {
  let input = value?.input;
  if (typeof input === 'string') input = [input];
  if (!Array.isArray(input)) return null;
  input = input.slice(0, 16).map(item => String(item == null ? '' : item).replace(/\s+/g, ' ').trim().slice(0, 8000)).filter(Boolean);
  return input.length ? input : null;
}
