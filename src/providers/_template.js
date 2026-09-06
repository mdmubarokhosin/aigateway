/**
 * PROVIDER TEMPLATE — copy this file, rename it, fill in the TODOs,
 * then register it in src/providers/registry.js. That's it.
 *
 * Example: adding "Mistral"
 *   1. cp _template.js mistral.js
 *   2. If Mistral is OpenAI-compatible -> prefer createOpenAICompatible()
 *      (see groq.js — it is only ~20 lines).
 *   3. Otherwise implement chat() below like gemini.js does.
 *   4. In registry.js: import + add to the built-in list.
 */
import { ApiError, upstreamError } from '../core/errors.js';
import { postJson } from '../utils/http.js';
import { normalizeUsage } from './normalize.js';

export const templateProvider = {
  // TODO: unique lowercase id clients will pass as {"provider": "..."}
  id: 'template',

  // TODO: display name
  label: 'Template Provider',

  // TODO: one-line description (shown on GET /api/v1/providers)
  description: 'Skeleton provider — copy me and build your own integration.',

  // TODO: fallback model when neither env nor request specifies one
  defaultModel: null,

  // TODO: informational list for the /providers page
  models: [],

  // TODO: env vars that must be set for this provider to be usable
  requiredEnvKeys: ['TEMPLATE_API_KEY'],

  isConfigured(env = {}) {
    return Boolean(env.TEMPLATE_API_KEY && env.TEMPLATE_API_KEY.trim());
  },

  /**
   * TODO: implement the upstream call.
   * @param {Object} payload - normalized by src/core/validate.js:
   *   { provider, model, message, messages, systemPrompt, temperature, maxTokens }
   * @param {Object} ctx - { env, config } (config.providerTimeoutMs available)
   * @returns {Promise<{reply: string, model: string, usage: object|null}>}
   */
  async chat(payload, { env = {}, config }) {
    if (!this.isConfigured(env)) {
      throw new ApiError(
        500,
        'Provider "Template" is not configured. Set TEMPLATE_API_KEY.',
        'PROVIDER_NOT_CONFIGURED'
      );
    }

    const model = payload.model || this.defaultModel;

    // --- Example upstream call (adapt to your provider's protocol) ---
    let result;
    try {
      result = await postJson('https://api.example.com/v1/chat/completions', {
        headers: { Authorization: `Bearer ${env.TEMPLATE_API_KEY}` },
        body: {
          model,
          messages: [
            ...(payload.systemPrompt ? [{ role: 'system', content: payload.systemPrompt }] : []),
            { role: 'user', content: payload.message },
          ],
          temperature: payload.temperature,
        },
        timeoutMs: config.providerTimeoutMs,
      });
    } catch (error) {
      throw upstreamError('Template Provider', { error });
    }
    if (!result.ok) {
      throw upstreamError('Template Provider', {
        status: result.status,
        data: result.data,
        headers: result.headers,
      });
    }

    const reply = result.data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string') {
      throw new ApiError(502, 'Template Provider returned a malformed response.', 'MALFORMED_UPSTREAM_RESPONSE');
    }

    return { reply, model: result.data?.model || model, usage: normalizeUsage(result.data?.usage) };
  },
};
