/**
 * Rate limiting middleware (dependency-free, sliding window).
 *
 * IMPORTANT (Cloudflare): Workers/Pages Functions run across many isolates,
 * so this is a PER-ISOLATE limiter — a soft cap that is perfect for basic
 * abuse protection. For hard, exact limits at scale use Cloudflare WAF rate
 * limiting rules or a KV/Durable Object counter (see README > Roadmap).
 */
const MAX_TRACKED_KEYS = 5000;

function clientKey(c) {
  return (
    c.req.header('CF-Connecting-IP') || // real client IP on Cloudflare
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || // behind a proxy
    'local'
  );
}

function sweepStore(store, now) {
  for (const [key, hits] of store) {
    if (hits.length === 0 || now - hits[hits.length - 1] > 30 * 60 * 1000) {
      store.delete(key);
    }
  }
}

/**
 * @param {Object} options
 * @param {(cfg: Object) => number} options.getWindowMs - window from config
 * @param {(cfg: Object) => number} options.getMax      - max hits from config
 * @param {string} options.message - human message for 429 responses
 */
export function rateLimit({ getWindowMs, getMax, message }) {
  // IMPORTANT: each limiter instance owns its OWN store — the global and
  // chat limiters must count independently.
  const store = new Map();

  return async (c, next) => {
    const cfg = c.get('config');
    const windowMs = getWindowMs(cfg);
    const max = getMax(cfg);
    const now = Date.now();
    const key = clientKey(c);

    const hits = (store.get(key) || []).filter((t) => now - t < windowMs);

    if (hits.length >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message,
            details: { retryAfterSeconds, limit: max, windowMs },
          },
        },
        429
      );
    }

    hits.push(now);
    store.set(key, hits);

    // Standard informational headers.
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - hits.length)));

    // Prevent unbounded memory growth (very chatty attackers).
    if (store.size > MAX_TRACKED_KEYS) sweepStore(store, now);

    await next();
  };
}
