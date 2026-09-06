/**
 * PROVIDER CONTRACT — read this before adding a new provider.
 *
 * A provider is a plain object with the following shape:
 *
 * {
 *   id: string                  // unique, lowercase (e.g. "openrouter")
 *   label: string               // human-readable name (e.g. "OpenRouter")
 *   description: string         // shown on GET /api/v1/providers
 *   defaultModel: string|null   // used when the request/env has no model
 *   models: string[]            // informational list for the /providers page
 *   requiredEnvKeys: string[]   // env vars needed to be "configured"
 *   isConfigured(env): boolean  // true when all required env vars are set
 *   chat(payload, ctx): Promise<{ reply: string, model: string, usage: object|null }>
 *       payload : normalized output of core/validate.js (see that file)
 *       ctx     : { env, config } — runtime env + effective config
 * }
 *
 * Rules of thumb:
 *   - NEVER throw raw errors: use ApiError and upstreamError() from
 *     core/errors.js so clients always receive the standard envelope.
 *   - Use utils/http.js postJson() (global fetch) — NOT axios — so the
 *     provider runs on both Cloudflare Workers and Node.js.
 *   - Normalize usage to { prompt_tokens, completion_tokens, total_tokens }.
 *
 * To register a provider, add it to the array in providers/registry.js.
 * See _template.js for a ready-to-copy skeleton.
 */
import { normalizeUsage } from './normalize.js';

/**
 * Build an OpenAI-style `messages` array from a normalized payload.
 * Used by every OpenAI-compatible provider (OpenRouter, Groq, custom, ...).
 */
export function buildOpenAIMessages(payload) {
  if (Array.isArray(payload.messages) && payload.messages.length > 0) {
    return payload.messages.map((m) => ({ role: m.role, content: m.content }));
  }
  const messages = [];
  if (payload.systemPrompt) {
    messages.push({ role: 'system', content: payload.systemPrompt });
  }
  messages.push({ role: 'user', content: payload.message });
  return messages;
}

export { normalizeUsage };
