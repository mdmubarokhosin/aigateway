/**
 * GET /api/v1/models — LIVE MODEL CATALOG, AUTO-FETCHED from every provider.
 *
 * What it does:
 *   1. Takes every CONFIGURED provider (registry order).
 *   2. Calls each provider's own GET {baseUrl}/models endpoint IN PARALLEL.
 *   3. Applies the per-provider FREE-ONLY policy:
 *        - openrouter    -> only models ending in ":free"   (e.g. z-ai/glm-5.2:free)
 *        - opencodezen   -> only models ending in "-free"   (e.g. deepseek-v4-flash-free)
 *        - everyone else -> the FULL catalog (e.g. poolside, custom)
 *   4. Caches the merged result in memory for MODELS_CACHE_TTL_MS (default 6 h)
 *      so the upstreams are not hammered on every page view.
 *
 * Query params:
 *   ?refresh=1  bypass the cache and re-fetch from all providers now
 *               (used by the Models page refresh button and the admin panel).
 *   ?provider=x limit the response to one provider id.
 *
 * One provider failing NEVER fails the whole endpoint: its error is reported
 * inside `providers[].error` while the other providers still return data.
 *
 * No auth required (read-only, no keys exposed) but still behind the global
 * rate limiter.
 */
import { getModelSourceProviders } from '../providers/registry.js';
import { isFreeModelId } from '../providers/openai-compatible.js';

/** Module-level cache. Lives for the isolate/is lifetime (CF) or process (Node). */
const cache = {
  key: null, // fingerprint of env+registry that produced the payload
  updatedAt: 0,
  payload: null,
  inflight: null, // promise — de-dupes concurrent refreshes
};

function fingerprint(providers, env) {
  // Re-fetch automatically when the set of configured providers or their
  // base URLs/keys change (e.g. after an admin adds a key in Cloudflare).
  return providers
    .map((p) => `${p.id}:${String(env[Object.keys(env).find((k) => p.requiredEnvKeys?.includes(k))] || '').length}`)
    .join('|');
}

function copyModel(model, providerId) {
  return {
    id: model.id,
    object: 'model',
    owned_by: model.owned_by,
    provider: providerId,
    free: Boolean(model.free),
  };
}

/**
 * Admin-curated models (config/providers.json → providers[].models) are
 * ALWAYS included: they power the "Admin pinned" badges on the Models page
 * and survive upstream catalog outages. Live-fetched models are merged on
 * top (duplicates keep the curated row).
 */
function curatedRows(provider) {
  return (provider.curatedModels || []).map((m) => ({
    id: m.id,
    object: 'model',
    owned_by: m.label || provider.label,
    provider: provider.id,
    free: isFreeModelId(m.id),
    curated: true,
    default: Boolean(m.default),
  }));
}

async function fetchFromProviders(configured, env, config) {
  const results = await Promise.allSettled(
    configured.map(async (provider) => {
      const fetched = await provider.fetchModels(env, config);
      return { provider, fetched };
    })
  );

  const providerBlocks = [];
  const data = [];

  results.forEach((res, index) => {
    const provider = configured[index];
    const curated = curatedRows(provider);
    const curatedIds = new Set(curated.map((m) => m.id));

    if (res.status === 'fulfilled') {
      const { fetched } = res.value;
      const live = fetched.models.filter((m) => !curatedIds.has(m.id));
      const merged = [...curated, ...live.map((m) => copyModel(m, provider.id))];
      providerBlocks.push({
        id: provider.id,
        label: provider.label,
        status: 'ok',
        freeOnly: Boolean(provider.freeOnly),
        total: merged.length,
        totalBeforeFilter: fetched.totalBeforeFilter + curated.length,
        curatedCount: curated.length,
        models: merged,
      });
      data.push(...merged);
    } else {
      const err = res.reason || {};
      providerBlocks.push({
        id: provider.id,
        label: provider.label,
        status: 'error',
        freeOnly: Boolean(provider.freeOnly),
        total: curated.length,
        totalBeforeFilter: curated.length,
        curatedCount: curated.length,
        models: curated,
        error: {
          code: err.code || 'UPSTREAM_ERROR',
          message: err.message || String(err),
        },
      });
      data.push(...curated);
    }
  });

  return { providerBlocks, data };
}

export function modelsHandlerFactory() {
  return async function listModelsHandler(c) {
    const cfg = c.get('config');
    const env = c.env || {};
    const configured = getModelSourceProviders(env);

    if (configured.length === 0) {
      return c.json({
        success: true,
        object: 'list',
        data: [],
        total: 0,
        providers: [],
        cache: { hit: false, updatedAt: null, ttlMs: 0, nextRefreshAt: null },
        note: 'No provider is configured on the server yet — set at least one provider API key.',
      });
    }

    const forceRefresh = ['1', 'true', 'yes'].includes(String(c.req.query('refresh') || '').toLowerCase());
    const providerFilter = (c.req.query('provider') || '').trim().toLowerCase();
    const fp = fingerprint(configured, env);
    const ttlMs = cfg.models.cacheTtlMs;
    const now = Date.now();

    const cacheFresh = cache.payload && cache.key === fp && now - cache.updatedAt < ttlMs;
    if (!forceRefresh && cacheFresh) {
      const payload = filterPayload(cache.payload, providerFilter);
      return c.json({ ...payload, cache: { hit: true, updatedAt: new Date(cache.updatedAt).toISOString(), ttlMs, nextRefreshAt: new Date(cache.updatedAt + ttlMs).toISOString() } });
    }

    // De-dupe concurrent refreshes inside the same isolate.
    if (!cache.inflight || forceRefresh || cache.key !== fp) {
      cache.key = fp;
      cache.inflight = fetchFromProviders(configured, env, cfg)
        .then(({ providerBlocks, data }) => {
          cache.payload = {
            success: true,
            object: 'list',
            total: data.length,
            freeOnlyPolicy: providerBlocks.map((b) => ({ provider: b.id, freeOnly: b.freeOnly })),
            providers: providerBlocks,
            data,
          };
          cache.updatedAt = Date.now();
        })
        .finally(() => {
          cache.inflight = null;
        });
    }

    await cache.inflight;

    const payload = filterPayload(cache.payload, providerFilter);
    return c.json({
      ...payload,
      cache: {
        hit: false,
        updatedAt: new Date(cache.updatedAt).toISOString(),
        ttlMs,
        nextRefreshAt: new Date(cache.updatedAt + ttlMs).toISOString(),
      },
    });
  };
}

/** Apply the ?provider= filter on either a fresh or a cached payload. */
function filterPayload(payload, providerFilter) {
  if (!providerFilter) return payload;
  const blocks = payload.providers.filter((b) => b.id === providerFilter);
  const data = payload.data.filter((m) => m.provider === providerFilter);
  return {
    ...payload,
    total: data.length,
    providers: blocks,
    data,
    note: blocks.length === 0 ? `No provider id "${providerFilter}" in the live catalog.` : undefined,
  };
}
