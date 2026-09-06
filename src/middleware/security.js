/**
 * Security middleware: protects YOUR API with an optional shared key.
 *
 * Behavior:
 *   - API_SECRET_KEY unset  -> open access (dev / internal use).
 *   - API_SECRET_KEY set    -> requests must send:
 *         X-API-Key: <key>        (preferred)
 *         Authorization: Bearer <key>   (also accepted)
 *
 * /health stays public (uptime monitors); this middleware is applied only
 * to the protected /api/v1 group in src/index.js.
 *
 * Comparison is constant-time to avoid timing attacks.
 */

/** Length-independent constant-time string comparison. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1; // still compare full length
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function apiKeyAuth() {
  return async (c, next) => {
    const cfg = c.get('config');

    // No key configured -> API is open.
    if (!cfg.apiSecretKey) {
      return next();
    }

    const provided =
      c.req.header('X-API-Key') ||
      (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim() ||
      '';

    if (!provided || !safeEqual(provided, cfg.apiSecretKey)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or missing API key. Send it in the "X-API-Key" header.',
          },
        },
        401
      );
    }

    c.set('authenticated', true);
    await next();
  };
}
