/**
 * FACTORY: OpenAI-compatible chat-completions provider.
 *
 * A huge portion of AI providers speak the OpenAI protocol
 * (POST {base}/chat/completions). This factory turns a small config object
 * into a fully working provider with auth, timeout, error mapping, model
 * resolution and usage normalization — so adding such a provider costs
 * ~15 lines (see openrouter.js / groq.js).
 */
import { ApiError, upstreamError } from '../core/errors.js';
import { postJson, getJson } from '../utils/http.js';
import { buildOpenAIMessages, normalizeUsage } from './base.js';

/**
 * FREE-MODEL FILTER — used by providers whose catalog must be reduced to
 * their free tier. Matches the two conventions used in the wild:
 *   - OpenRouter style:  "z-ai/glm-5.2:free"      (colon suffix)
 *   - OpenCode Zen style: "deepseek-v4-flash-free" (dash suffix)
 */
export function isFreeModelId(modelId) {
  return /(:free|-free)$/i.test(String(modelId || '').trim());
}

/**
 * @param {Object} spec
 * @param {string} spec.id                 - Provider id ("openrouter").
 * @param {string} spec.label              - Display name ("OpenRouter").
 * @param {string} spec.description        - For GET /api/v1/providers.
 * @param {string|null} spec.defaultBaseUrl - Fixed base URL (or null when baseUrlEnvKey used).
 * @param {string|null} [spec.baseUrlEnvKey] - Env var holding a custom base URL.
 * @param {string} spec.envKey             - Env var holding the API key.
 * @param {boolean} [spec.apiKeyOptional]  - Allow endpoints without a key (e.g. Ollama).
 * @param {string} spec.modelEnvKey        - Env var overriding the default model.
 * @param {string[]} [spec.extraModelEnvKeys] - Legacy/alternative env aliases.
 * @param {string|null} spec.defaultModel  - Fallback model id.
 * @param {string[]} [spec.models]         - Informational model list.
 * @param {boolean} [spec.freeOnly]        - When true, GET /api/v1/models only
 *                                           lists this provider's FREE models
 *                                           (ids ending in ":free" or "-free").
 * @param {boolean} [spec.allowPublicModels] - Provider's /models endpoint is public,
 *                                           so its catalog is listed even when no
 *                                           API key is configured (chat still needs the key).
 * @param {boolean} [spec.modelsRequireKey] - Upstream /models needs auth (default:
 *                                           try with key when available; public
 *                                           endpoints work without one).
 * @param {Function} [spec.extraHeadersFn] - (env) => extra request headers.
 * @param {boolean} [spec.supportsMaxTokens] - Send max_tokens upstream (default true).
 */
export function createOpenAICompatible(spec) {
  const {
    id,
    label,
    description,
    defaultBaseUrl,
    baseUrlEnvKey = null,
    envKey,
    apiKeyOptional = false,
    modelEnvKey,
    extraModelEnvKeys = [],
    defaultModel,
    models = [],
    freeOnly = false,
    allowPublicModels = false,
    extraHeadersFn = null,
    supportsMaxTokens = true,
  } = spec;

  const requiredEnvKeys = [
    ...(baseUrlEnvKey ? [baseUrlEnvKey] : []),
    ...(!apiKeyOptional ? [envKey] : []),
  ];

  function resolveModel(env) {
    for (const key of [modelEnvKey, ...extraModelEnvKeys]) {
      if (env[key] && env[key].trim()) return env[key].trim();
    }
    return defaultModel;
  }

  return {
    id,
    label,
    description,
    defaultModel,
    models,
    freeOnly,
    allowPublicModels,
    requiredEnvKeys,
    // Exposed for the deep failover engine: it needs to enumerate candidate
    // models per provider (env default first, then curated + live catalog).
    modelEnvKey,
    extraModelEnvKeys,
    resolveModel,

    isConfigured(env = {}) {
      if (baseUrlEnvKey && !env[baseUrlEnvKey]) return false;
      if (!defaultBaseUrl && !baseUrlEnvKey) return false;
      if (!apiKeyOptional && !env[envKey]) return false;
      return true;
    },

    async chat(payload, { env = {}, config }) {
      // --- Configuration checks with actionable error messages ---
      if (!this.isConfigured(env)) {
        throw new ApiError(
          500,
          `Provider "${label}" is not configured on the server. Set ${requiredEnvKeys.join(', ') || envKey}.`,
          'PROVIDER_NOT_CONFIGURED'
        );
      }
      const model = payload.model || resolveModel(env);
      if (!model) {
        throw new ApiError(
          500,
          `Provider "${label}" needs a model. Set ${modelEnvKey} or pass "model" in the request.`,
          'PROVIDER_NOT_CONFIGURED'
        );
      }

      const baseUrl = String(baseUrlEnvKey ? env[baseUrlEnvKey] : defaultBaseUrl).replace(/\/+$/, '');

      // --- Build the OpenAI-compatible request ---
      const body = {
        model,
        messages: buildOpenAIMessages(payload),
        temperature: payload.temperature,
      };
      if (supportsMaxTokens && payload.maxTokens) {
        body.max_tokens = payload.maxTokens;
      }

      const apiKey = env[envKey];
      const headers = {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(extraHeadersFn ? extraHeadersFn(env) : {}),
      };

      // --- Call upstream + map failures into typed ApiErrors ---
      let result;
      try {
        result = await postJson(`${baseUrl}/chat/completions`, {
          headers,
          body,
          timeoutMs: config.providerTimeoutMs,
        });
      } catch (error) {
        throw upstreamError(label, { error });
      }
      if (!result.ok) {
        throw upstreamError(label, { status: result.status, data: result.data, headers: result.headers });
      }

      // --- Extract the reply ---
      const reply = result.data?.choices?.[0]?.message?.content;
      if (typeof reply !== 'string') {
        throw new ApiError(
          502,
          `${label} returned a malformed response (missing choices[0].message.content).`,
          'MALFORMED_UPSTREAM_RESPONSE'
        );
      }

      return {
        reply,
        model: result.data?.model || model,
        usage: normalizeUsage(result.data?.usage),
      };
    },

    /**
     * AUTO-FETCH the live model catalog from {baseUrl}/models.
     * Used by GET /api/v1/models (the site's Models page + admin panel).
     * Applies the freeOnly filter for providers configured with it.
     *
     * @returns {Promise<{models: Array<{id: string, owned_by: string, free: boolean}>, total: number}>}
     */
    async fetchModels(env = {}, config) {
      if (!defaultBaseUrl && !baseUrlEnvKey) {
        throw new ApiError(500, `Provider "${label}" has no base URL configured.`, 'PROVIDER_NOT_CONFIGURED');
      }
      const baseUrl = String(baseUrlEnvKey ? env[baseUrlEnvKey] : defaultBaseUrl).replace(/\/+$/, '');
      const apiKey = env[envKey];

      let result;
      try {
        result = await getJson(`${baseUrl}/models`, {
          headers: {
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            ...(extraHeadersFn ? extraHeadersFn(env) : {}),
          },
          timeoutMs: Math.min(config?.providerTimeoutMs || 15000, 20000),
        });
      } catch (error) {
        throw upstreamError(label, { error });
      }
      if (!result.ok) {
        throw upstreamError(label, { status: result.status, data: result.data, headers: result.headers });
      }

      const rows = Array.isArray(result.data?.data)
        ? result.data.data
        : Array.isArray(result.data?.models)
          ? result.data.models
          : [];

      const all = rows
        .map((row) => {
          const id = typeof row === 'string' ? row : row?.id;
          if (!id) return null;
          return {
            id: String(id),
            owned_by: String(typeof row === 'object' && row.owned_by ? row.owned_by : id.split('/')[0] || label),
            free: isFreeModelId(id),
          };
        })
        .filter(Boolean);

      const filtered = freeOnly ? all.filter((m) => m.free) : all;
      return { models: filtered, total: filtered.length, totalBeforeFilter: all.length };
    },
  };
}
