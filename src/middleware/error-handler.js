/**
 * Centralized error handling.
 *
 * app.onError + app.notFound are registered LAST in src/index.js, so every
 * thrown/failed request funnels into ONE consistent JSON envelope:
 *
 *   { "success": false, "error": { "code": "...", "message": "...", "details": ... } }
 *
 * Unexpected (non-ApiError) bugs are masked as generic 500s in production;
 * stack traces are attached only outside production for debugging.
 */
import { ApiError } from '../core/errors.js';

/** 404 for unmatched routes (JSON, not HTML). */
export function notFoundHandler(c) {
  return c.json(
    {
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Route not found: ${c.req.method} ${c.req.path}`,
      },
    },
    404
  );
}

/**
 * Hono error handler. Signature is (error, context).
 */
export function errorHandler(err, c) {
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details;

  if (err instanceof ApiError) {
    // Expected, operational errors: safe to expose everything.
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (!(c.get('config')?.isProduction)) {
    // Unknown bug outside production: show the real message to help debugging.
    message = err?.message || message;
  }

  // Server-side log (visible in `wrangler pages dev` and CF tail logs).
  if (statusCode >= 500) {
    console.error(`[ERROR] ${c.req.method} ${c.req.path} -> ${statusCode}:`, err?.message || err);
  }

  const payload = { success: false, error: { code, message } };
  if (details) payload.error.details = details;
  const cfg = c.get('config');
  if (cfg && !cfg.isProduction && err?.stack) {
    payload.error.stack = err.stack.split('\n');
  }

  return c.json(payload, statusCode);
}
