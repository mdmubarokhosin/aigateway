/**
 * Normalize token usage from different provider response shapes into one
 * consistent object used across the whole API.
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    prompt_tokens: usage.prompt_tokens ?? usage.promptTokenCount ?? null,
    completion_tokens: usage.completion_tokens ?? usage.candidatesTokenCount ?? null,
    total_tokens: usage.total_tokens ?? usage.totalTokenCount ?? null,
  };
}
