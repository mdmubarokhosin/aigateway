/**
 * Centralized configuration.
 *
 * Reads environment variables from whatever runtime the app is on:
 *   - Cloudflare Pages/Workers: `c.env` (dashboard environment variables)
 *   - Node.js: process.env (passed into app.fetch by server.node.js)
 *
 * Every value has a safe default so the API works out of the box.
 *
 * SINGLE SOURCE OF TRUTH: change APP_VERSION / APP_NAME / FAILOVER_* in
 * your .env (or the Cloudflare Pages dashboard) and every surface — health,
 * config endpoint, docs site navbar/footer, status page — reflects it.
 */

const DEFAULT_APP_VERSION = '1.4.0';
const DEFAULT_APP_NAME = 'AI Gateway API';

/** Normalize a version string: trims and strips one leading "v"/"V". */
function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

/** Parse a comma-separated string into a trimmed, non-empty array. */
function splitList(value) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Parse an integer env var with a fallback default. */
function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Build the effective configuration for one request.
 * @param {Record<string, string>} env - Runtime environment variables.
 */
export function getConfig(env = {}) {
  const origins = splitList(env.ALLOWED_ORIGINS);

  return {
    env,
    // Env-driven so one .env change updates every surface (redeploy applies it).
    appName: (env.APP_NAME || DEFAULT_APP_NAME).trim(),
    version: normalizeVersion(env.APP_VERSION) || DEFAULT_APP_VERSION,

    // Provider used when the request body has no "provider" field.
    defaultProvider: (env.DEFAULT_PROVIDER || 'openrouter').trim(),

    // Automatic provider failover: when a provider errors, the gateway
    // transparently retries the next configured provider (rotating the chain
    // each round) until a response is produced or every option is exhausted.
    // DEEP MODEL-LEVEL FAILOVER: inside each provider, EVERY available model
    // (requested → env default → admin-curated → live catalog) is tried one
    // by one before the gateway moves on to the next provider.
    failover: {
      enabled: env.FAILOVER_ENABLED === undefined ? true : String(env.FAILOVER_ENABLED).trim() !== 'false',
      maxRounds: Math.min(Math.max(toInt(env.FAILOVER_MAX_ROUNDS, 3), 1), 20),
      retryDelayMs: Math.max(toInt(env.FAILOVER_RETRY_DELAY_MS, 800), 0),
      // Max models tried per provider in one request (caps latency).
      modelsMax: Math.min(Math.max(toInt(env.FAILOVER_MODELS_MAX, 6), 1), 25),
      // Hard cap on total upstream attempts per request across the chain.
      maxAttempts: Math.min(Math.max(toInt(env.FAILOVER_MAX_ATTEMPTS, 12), 1), 60),
    },

    // When set, clients must send: X-API-Key: <value>
    apiSecretKey:
      env.API_SECRET_KEY && env.API_SECRET_KEY.trim() ? env.API_SECRET_KEY.trim() : null,

    // CORS allow-list. ['*'] means every origin is allowed.
    allowedOrigins: origins.length > 0 ? origins : ['*'],

    rateLimit: {
      global: {
        windowMs: toInt(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
        max: toInt(env.RATE_LIMIT_MAX, 100),
      },
      chat: {
        windowMs: toInt(env.CHAT_RATE_LIMIT_WINDOW_MS, 60 * 1000),
        max: toInt(env.CHAT_RATE_LIMIT_MAX, 15),
      },
    },

    validation: {
      maxMessageLength: toInt(env.MAX_MESSAGE_LENGTH, 8000),
      maxMessages: toInt(env.MAX_MESSAGES, 50),
      maxTokensLimit: toInt(env.MAX_TOKENS_LIMIT, 8192),
    },

    // Max time (ms) to wait for an upstream provider response.
    providerTimeoutMs: toInt(env.PROVIDER_TIMEOUT_MS, 60000),

    // How long the merged live model catalog (GET /api/v1/models) is cached
    // before the next request re-fetches it from the providers.
    models: {
      cacheTtlMs: Math.max(toInt(env.MODELS_CACHE_TTL_MS, 6 * 60 * 60 * 1000), 60_000),
    },

    isProduction: (env.NODE_ENV || 'development') === 'production',
  };
}

export { DEFAULT_APP_VERSION, DEFAULT_APP_NAME };
