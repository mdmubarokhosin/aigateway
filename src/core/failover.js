/**
 * DEEP MODEL-LEVEL PROVIDER FAILOVER — the resilience heart of the gateway.
 *
 * Behavior (this is the DEFAULT for every /api/v1/chat request):
 *
 *   1. Build a chain of CONFIGURED providers:
 *        - the preferred provider first (request "provider" field, else
 *          DEFAULT_PROVIDER env), then every other configured provider in
 *          registry order.
 *   2. For EACH provider, build an ordered candidate MODEL list:
 *        a) the model requested by the caller (payload.model), if any
 *        b) the provider's env/default model ({PROVIDER}_MODEL)
 *        c) the admin-curated models (config/providers.json → models[])
 *        d) the LIVE auto-fetched catalog (GET {baseUrl}/models — cached
 *           in-memory for 10 min, freeOnly policy already applied)
 *        → de-duplicated, recently-failed models skipped (5-min blacklist),
 *          capped at FAILOVER_MODELS_MAX (default 6) to bound latency.
 *   3. Try the provider's models ONE BY ONE. A model error (bad key, quota,
 *      rate limit, timeout, outage, malformed reply, ...) records the attempt,
 *      blacklists that model for 5 minutes and moves to the NEXT model of the
 *      SAME provider.
 *   4. When every model of a provider failed → the request moves to the NEXT
 *      provider and the whole model walk repeats there — and so on through the
 *      entire chain, for up to FAILOVER_MAX_ROUNDS full passes.
 *   5. A hard cap FAILOVER_MAX_ATTEMPTS (default 12) bounds the total number
 *      of upstream calls per request so worst-case latency stays sane.
 *   6. Smart rounds: providers whose last error was PERMANENT (invalid key,
 *      not configured) are not retried on later rounds; only TRANSIENT
 *      failures (rate limit / timeout / outage / network) are.
 *   7. Success response reports which provider + model served it plus the
 *      full attempt log; total failure returns 502 ALL_PROVIDERS_FAILED with
 *      the same log for debugging.
 *
 * Disable per request with {"failover": false} (pins the preferred provider
 * AND its primary model) or globally with FAILOVER_ENABLED=false.
 */
import { ApiError } from './errors.js';

/** Error codes worth re-trying on a later round (transient problems). */
const RETRYABLE_CODES = new Set([
  'UPSTREAM_RATE_LIMIT',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_ERROR',
  'NETWORK_ERROR',
  'MALFORMED_UPSTREAM_RESPONSE',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------------------------------------------------
 * In-memory blacklists (per isolate/process — best effort, no persistence).
 * ----------------------------------------------------------------------- */

/** Recently failed models: "provider::model" → failedUntil (5 min). */
const recentModelFailures = new Map();
const MODEL_BLACKLIST_TTL_MS = 5 * 60 * 1000;
const MODEL_BLACKLIST_MAX = 500;

function blacklistModel(providerId, modelId) {
  const key = providerId + '::' + modelId;
  recentModelFailures.set(key, Date.now() + MODEL_BLACKLIST_TTL_MS);
  if (recentModelFailures.size > MODEL_BLACKLIST_MAX) {
    const now = Date.now();
    for (const [k, until] of recentModelFailures) {
      if (until <= now) recentModelFailures.delete(k);
    }
    if (recentModelFailures.size > MODEL_BLACKLIST_MAX) {
      // Still too big (all fresh) — drop the oldest entries.
      const first = recentModelFailures.keys().next().value;
      recentModelFailures.delete(first);
    }
  }
}

function isModelBlacklisted(providerId, modelId) {
  const until = recentModelFailures.get(providerId + '::' + modelId);
  return Boolean(until && Date.now() < until);
}

/** Live catalog cache per provider: id → { at, ids[] } (10 min TTL). */
const liveCatalogCache = new Map();
const LIVE_CATALOG_TTL_MS = 10 * 60 * 1000;

/* --------------------------------------------------------------------------
 * Model candidate builder
 * ----------------------------------------------------------------------- */

/**
 * Build the ordered model candidate list for one provider.
 * Order: requested → env/default → curated → live catalog (dedup, capped).
 * @returns {Promise<string[]>}
 */
async function buildModelCandidates(provider, payload, env, config, cap) {
  const list = [];
  const push = (value) => {
    const id = String(value || '').trim();
    if (id && !list.includes(id)) list.push(id);
  };

  // a) caller-requested model always comes first
  push(payload.model);

  // b) the provider's own env/default model
  try {
    push(provider.resolveModel ? provider.resolveModel(env) : provider.defaultModel);
  } catch {
    push(provider.defaultModel);
  }

  // c) admin-curated models (config/providers.json)
  (provider.models || []).forEach(push);

  // d) live catalog (auto-fetched, freeOnly policy applied inside fetchModels)
  if (list.length < cap && typeof provider.fetchModels === 'function') {
    try {
      const now = Date.now();
      let entry = liveCatalogCache.get(provider.id);
      if (!entry || now - entry.at > LIVE_CATALOG_TTL_MS || !entry.ids.length) {
        const fetched = await provider.fetchModels(env, config);
        entry = { at: now, ids: (fetched?.models || []).map((m) => String(m.id)) };
        liveCatalogCache.set(provider.id, entry);
      }
      entry.ids.forEach(push);
    } catch {
      // Catalog fetch failed — curated + default candidates are enough.
    }
  }

  // Skip models that just failed recently — but ALWAYS keep the first
  // candidate so the caller's explicit request is honored no matter what.
  const filtered = list.filter((id, index) => index === 0 || !isModelBlacklisted(provider.id, id));
  return filtered.slice(0, Math.max(cap, 1));
}

/* --------------------------------------------------------------------------
 * Provider chain (unchanged semantics)
 * ----------------------------------------------------------------------- */

/**
 * Build the ordered failover chain for one request.
 *
 * @param {string|null} preferredId - Requested provider id (or default).
 * @param {Array}  configured       - Configured providers (registry order).
 * @param {Object} allProviders     - Map id -> provider for skip-recording.
 * @param {boolean} pinPreferred    - When true (failover disabled), the chain
 *                                    holds ONLY the preferred provider.
 * @returns {{ chain: Array, skipped: Array }}
 */
function buildChain(preferredId, configured, allProviders, pinPreferred) {
  const chain = [];
  const skipped = [];
  const preferred = preferredId ? allProviders.get(String(preferredId).toLowerCase()) : null;

  if (pinPreferred) {
    // Failover explicitly disabled: exactly one provider may serve this.
    if (preferred && configured.some((p) => p.id === preferred.id)) {
      chain.push(preferred);
    } else if (preferred) {
      skipped.push({
        provider: preferred.id,
        status: 'skipped',
        reason: 'PROVIDER_NOT_CONFIGURED',
        message: `Provider "${preferred.label}" is registered but its env key(s) are missing on the server.`,
      });
    }
    return { chain, skipped };
  }

  if (preferred) {
    if (configured.some((p) => p.id === preferred.id)) chain.push(preferred);
    else
      skipped.push({
        provider: preferred.id,
        status: 'skipped',
        reason: 'PROVIDER_NOT_CONFIGURED',
        message: `Provider "${preferred.label}" is registered but its env key(s) are missing on the server.`,
      });
  }

  for (const p of configured) {
    if (!chain.some((c) => c.id === p.id)) chain.push(p);
  }
  return { chain, skipped };
}

/* --------------------------------------------------------------------------
 * The failover engine
 * ----------------------------------------------------------------------- */

/**
 * Run a chat payload through the deep model-level failover chain.
 *
 * @param {Object} payload  - Normalized payload from core/validate.js
 * @param {Object} ctx      - { env, config, providers (Map), configured (Array) }
 * @returns {{ result: Object, providerId: string, model: string, attempts: Array, rounds: number, servedOnRound: number }}
 * @throws {ApiError} ALL_PROVIDERS_FAILED / NO_PROVIDER_CONFIGURED
 */
export async function chatWithFailover(payload, { env, config, providers, configured }) {
  const failoverEnabled = payload.failover === null ? config.failover.enabled : payload.failover;
  const preferredId = payload.provider || config.defaultProvider;
  const { chain, skipped } = buildChain(preferredId, configured, providers, !failoverEnabled);

  const attempts = [...skipped];

  if (chain.length === 0) {
    throw new ApiError(
      500,
      'No AI provider is configured on the server. Set at least one of: OPENROUTER_API_KEY, POOLSIDE_API_KEY, or CUSTOM_BASE_URL (+CUSTOM_MODEL).',
      'NO_PROVIDER_CONFIGURED',
      { attempts }
    );
  }

  const maxRounds = failoverEnabled ? config.failover.maxRounds : 1;
  const modelsCap = failoverEnabled ? config.failover.modelsMax : 1;
  const maxAttempts = failoverEnabled ? config.failover.maxAttempts : 1;

  let round = 0;
  let totalAttempts = 0;

  while (round < maxRounds && totalAttempts < maxAttempts) {
    if (round > 0 && config.failover.retryDelayMs > 0) {
      await sleep(config.failover.retryDelayMs);
    }

    for (let offset = 0; offset < chain.length && totalAttempts < maxAttempts; offset += 1) {
      // Rotate the starting provider each round so no single dead provider
      // keeps consuming the first attempt.
      const provider = chain[(offset + round) % chain.length];

      // Look at the MOST RECENT attempt of this provider (model-level walk
      // can produce several attempts per provider in one round).
      const prior = [...attempts].reverse().find((a) => a.provider === provider.id && a.round);
      if (prior && !RETRYABLE_CODES.has(prior.code)) {
        continue; // permanent failure — do not waste another round on it
      }

      // --- walk every candidate model of THIS provider ---
      const models = await buildModelCandidates(provider, payload, env, config, modelsCap);
      if (models.length === 0) {
        attempts.push({
          provider: provider.id,
          model: null,
          status: 'skipped',
          code: 'NO_MODEL_CANDIDATE',
          message: `${provider.label} exposed no model (no env model, curated list, or live catalog).`,
          round: round + 1,
        });
        continue;
      }

      for (const model of models) {
        if (totalAttempts >= maxAttempts) break;
        totalAttempts += 1;

        const started = Date.now();
        try {
          const result = await provider.chat({ ...payload, model }, { env, config });
          return {
            result,
            providerId: provider.id,
            model: result.model || model,
            attempts,
            rounds: round + 1,
            servedOnRound: round + 1,
            modelsTried: totalAttempts,
          };
        } catch (error) {
          const apiError =
            error instanceof ApiError
              ? error
              : new ApiError(502, `Unexpected error while contacting ${provider.label}.`, 'UPSTREAM_ERROR');
          attempts.push({
            provider: provider.id,
            model,
            status: 'failed',
            code: apiError.code,
            http: apiError.statusCode,
            message: apiError.message,
            durationMs: Date.now() - started,
            round: round + 1,
          });
          blacklistModel(provider.id, model);
        }
      }
      // every model of this provider failed → next provider takes over
    }

    round += 1;

    // Stop early when nothing retryable is left in the chain.
    const retryableLeft = chain.some((p) => {
      const last = [...attempts].reverse().find((a) => a.provider === p.id);
      return !last || RETRYABLE_CODES.has(last.code);
    });
    if (!retryableLeft) break;
  }

  const lastFailure = attempts[attempts.length - 1];
  throw new ApiError(
    502,
    `All ${chain.length} configured provider(s) failed after ${attempts.length} attempt(s). Last error: ${
      lastFailure ? `${lastFailure.code} — ${lastFailure.message}` : 'unknown'
    }`,
    'ALL_PROVIDERS_FAILED',
    { attempts, chain: chain.map((p) => p.id), roundsTried: round }
  );
}
