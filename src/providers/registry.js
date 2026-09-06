/**
 * PROVIDER REGISTRY — DATA-DRIVEN (full CRUD from the Admin Panel).
 *
 * Every provider is instantiated from config/providers.json (via
 * src/providers/generated-data.js, regenerated on every build). That means
 * the Admin Panel can ADD / EDIT / DELETE providers and models, commit the
 * JSON to GitHub, and Cloudflare Pages rebuilds — the running API picks the
 * change up with ZERO code edits.
 *
 * Provider spec fields (all editable in /admin → AI Providers):
 *   id, label, description, tagline, docsUrl,
 *   baseUrl        - fixed OpenAI-compatible base URL (or null)
 *   baseUrlEnvKey  - env var holding the base URL (custom provider style)
 *   apiKeyEnv      - env var holding the secret key (NEVER stored here)
 *   apiKeyOptional - allow requests without a key (Ollama / LM Studio)
 *   modelEnvKey, extraModelEnvKeys, defaultModel
 *   models         - admin-curated model list [{id, label, default}]
 *   freeOnly       - catalog filter: list only ":free"/"-free" models
 *   allowPublicModels - list catalog even without a key configured
 *   openrouterHeaders - send HTTP-Referer/X-Title attribution headers
 *   supportsMaxTokens, enabled
 */
import { createOpenAICompatible } from './openai-compatible.js';
import { GENERATED_PROVIDERS_CONFIG } from './generated-data.js';

/** Legacy fallback (only used if config/providers.json was somehow emptied). */
const FALLBACK_SPECS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Unified gateway to 200+ models with free-tier options.',
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEnvKey: null,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    apiKeyOptional: false,
    modelEnvKey: 'OPENROUTER_MODEL',
    extraModelEnvKeys: ['MODEL_NAME'],
    defaultModel: 'z-ai/glm-5.2:free',
    freeOnly: true,
    allowPublicModels: false,
    openrouterHeaders: true,
    supportsMaxTokens: true,
    enabled: true,
    models: [{ id: 'z-ai/glm-5.2:free', label: 'GLM 5.2 (free)', default: true }],
  },
];

const CONFIG = GENERATED_PROVIDERS_CONFIG && typeof GENERATED_PROVIDERS_CONFIG === 'object'
  ? GENERATED_PROVIDERS_CONFIG
  : {};

const registry = new Map();
const specById = new Map();

function normalizeSpec(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  return {
    id: String(raw.id).trim().toLowerCase(),
    label: String(raw.label || raw.id).trim(),
    description: String(raw.description || '').trim(),
    tagline: String(raw.tagline || raw.description || '').trim(),
    docsUrl: String(raw.docsUrl || '').trim(),
    baseUrl: raw.baseUrl ? String(raw.baseUrl).trim() : null,
    baseUrlEnvKey: raw.baseUrlEnvKey ? String(raw.baseUrlEnvKey).trim() : null,
    apiKeyEnv: String(raw.apiKeyEnv || '').trim(),
    apiKeyOptional: Boolean(raw.apiKeyOptional),
    modelEnvKey: String(raw.modelEnvKey || `${raw.id}_MODEL`).trim(),
    extraModelEnvKeys: Array.isArray(raw.extraModelEnvKeys) ? raw.extraModelEnvKeys.map(String) : [],
    defaultModel: raw.defaultModel ? String(raw.defaultModel).trim() : null,
    freeOnly: Boolean(raw.freeOnly),
    allowPublicModels: Boolean(raw.allowPublicModels),
    openrouterHeaders: Boolean(raw.openrouterHeaders),
    supportsMaxTokens: raw.supportsMaxTokens !== false,
    enabled: raw.enabled !== false,
    hidden: Boolean(raw.hidden),
    models: Array.isArray(raw.models)
      ? raw.models
          .map((m) =>
            typeof m === 'string'
              ? { id: m, label: m, default: false }
              : m && m.id
                ? { id: String(m.id), label: String(m.label || m.id), default: Boolean(m.default) }
                : null
          )
          .filter(Boolean)
      : [],
  };
}

function instantiate(spec) {
  const provider = createOpenAICompatible({
    id: spec.id,
    label: spec.label,
    description: spec.description,
    defaultBaseUrl: spec.baseUrl,
    baseUrlEnvKey: spec.baseUrlEnvKey,
    envKey: spec.apiKeyEnv || 'UNUSED_API_KEY',
    apiKeyOptional: spec.apiKeyOptional || !spec.apiKeyEnv,
    modelEnvKey: spec.modelEnvKey,
    extraModelEnvKeys: spec.extraModelEnvKeys,
    defaultModel: spec.defaultModel,
    models: spec.models.map((m) => m.id),
    freeOnly: spec.freeOnly,
    allowPublicModels: spec.allowPublicModels,
    supportsMaxTokens: spec.supportsMaxTokens,
    extraHeadersFn: spec.openrouterHeaders
      ? (env) => ({
          'HTTP-Referer': env.APP_URL || 'http://localhost:5000',
          'X-Title': 'AI Gateway API',
        })
      : null,
  });
  // Attach curated metadata for the public endpoints + admin panel.
  provider.tagline = spec.tagline;
  provider.docsUrl = spec.docsUrl;
  provider.curatedModels = spec.models;
  provider.hidden = spec.hidden;
  return provider;
}

/** Build the registry from the generated data (order[] wins over object order). */
(function buildRegistry() {
  const providersMap = CONFIG.providers && typeof CONFIG.providers === 'object' ? CONFIG.providers : {};
  let specs = Object.values(providersMap)
    .map(normalizeSpec)
    .filter(Boolean);

  if (specs.length === 0) specs = FALLBACK_SPECS.map(normalizeSpec).filter(Boolean);

  const order = Array.isArray(CONFIG.order) && CONFIG.order.length
    ? CONFIG.order.map((s) => String(s).trim().toLowerCase())
    : specs.map((s) => s.id);

  const ordered = [];
  const seen = new Set();
  order.forEach((id) => {
    const spec = specs.find((s) => s.id === id);
    if (spec && !seen.has(id) && spec.enabled !== false) {
      ordered.push(spec);
      seen.add(id);
    }
  });
  specs.forEach((spec) => {
    if (!seen.has(spec.id) && spec.enabled !== false) ordered.push(spec);
  });

  ordered.forEach((spec) => {
    specById.set(spec.id, spec);
    registry.set(spec.id, instantiate(spec));
  });
})();

/**
 * Register a provider at runtime (exposed for extensibility/plugins).
 * @param {Object} provider - Object matching the contract in providers/base.js
 */
export function registerProvider(provider) {
  if (!provider?.id || typeof provider.chat !== 'function') {
    throw new Error('registerProvider: invalid provider (needs id + chat()).');
  }
  if (registry.has(provider.id)) {
    throw new Error(`registerProvider: duplicate provider id "${provider.id}".`);
  }
  registry.set(provider.id, provider);
}

/** Raw admin-managed spec for one provider (or null). */
export function getProviderSpec(id) {
  return specById.get(String(id || '').trim().toLowerCase()) || null;
}

/** All raw specs (admin panel / docs). */
export function getProviderSpecs() {
  return [...specById.values()];
}

/** Look up a provider by id (case-insensitive, trims input). */
export function getProvider(id) {
  return registry.get(String(id || '').trim().toLowerCase()) || null;
}

/** All registered provider ids. */
export function getProviderIds() {
  return [...registry.keys()];
}

/**
 * All CONFIGURED providers, in registry order.
 * Used by the automatic failover engine to build the retry chain.
 */
export function getConfiguredProviders(env = {}) {
  return [...registry.values()].filter((p) => Boolean(p.isConfigured?.(env)));
}

/**
 * Providers whose model catalog should appear in GET /api/v1/models:
 * every configured provider PLUS providers whose /models endpoint is public
 * (allowPublicModels) even when their chat key is not set yet.
 */
export function getModelSourceProviders(env = {}) {
  return [...registry.values()].filter(
    (p) => Boolean(p.isConfigured?.(env)) || p.allowPublicModels === true
  );
}

/** Public metadata list for GET /api/v1/providers. */
export function listProviders(env = {}) {
  return [...registry.values()].map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    tagline: p.tagline || '',
    docsUrl: p.docsUrl || '',
    defaultModel: p.defaultModel,
    models: p.models,
    curatedModels: p.curatedModels || [],
    requiredEnvKeys: p.requiredEnvKeys,
    configured: Boolean(p.isConfigured?.(env)),
  }));
}
