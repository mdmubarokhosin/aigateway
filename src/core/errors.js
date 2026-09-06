/**
 * Typed application errors + upstream provider error mapping.
 *
 * Every failure anywhere in the app becomes an ApiError, which the
 * centralized error handler (middleware/error-handler.js) converts into
 * ONE consistent JSON envelope:
 *
 *   { "success": false, "error": { "code": "...", "message": "...", "details": ... } }
 */

export class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status to respond with.
   * @param {string} message    - Human-readable message (safe to expose).
   * @param {string} code       - Machine-readable error code.
   * @param {*} [details]       - Optional structured details.
   */
  constructor(statusCode, message, code = 'INTERNAL_ERROR', details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // expected, trusted error (vs. a code bug)
  }
}

/** Extract a readable message from an upstream JSON body (any provider shape). */
function extractUpstreamMessage(data) {
  const msg = data?.error?.message || data?.message;
  if (msg) return String(msg);
  try {
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return 'Unknown upstream error';
  }
}

/** Parse a Retry-After style value ('5', '5s', '500ms') into whole seconds. */
function parseRetrySeconds(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  const num = Number.parseFloat(raw);
  if (Number.isNaN(num)) return null;
  if (raw.endsWith('ms')) return Math.max(1, Math.ceil(num / 1000));
  return Math.max(1, Math.ceil(num)); // '5', '5s', seconds by default
}

/**
 * Convert any upstream provider failure into a typed ApiError.
 *
 * @param {string} providerLabel - Human provider name, e.g. "OpenRouter".
 * @param {Object} input
 * @param {Error}  [input.error]  - Thrown error (abort/network).
 * @param {number} [input.status] - Upstream HTTP status.
 * @param {*}      [input.data]   - Upstream parsed JSON body.
 * @param {Headers|null} [input.headers] - Upstream response headers.
 * @returns {ApiError}
 */
export function upstreamError(providerLabel, { error, status, data, headers } = {}) {
  // --- Transport-level failures ---
  if (error) {
    if (error.name === 'AbortError') {
      return new ApiError(504, `Request to ${providerLabel} timed out.`, 'UPSTREAM_TIMEOUT');
    }
    if (error instanceof TypeError) {
      return new ApiError(
        502,
        `Cannot reach ${providerLabel}. Check network connectivity or base URL.`,
        'NETWORK_ERROR'
      );
    }
    return new ApiError(502, `Unexpected error while contacting ${providerLabel}.`, 'UPSTREAM_ERROR');
  }

  // --- HTTP-level failures ---
  const upstreamMsg = extractUpstreamMessage(data);

  switch (status) {
    case 401:
    case 403:
      // The provider key is invalid/revoked. Report 500 so the CLIENT knows
      // it is a server-side configuration issue, not their fault.
      return new ApiError(
        500,
        `${providerLabel} rejected the API key. Verify the provider key configured on the server.`,
        'UPSTREAM_AUTH_ERROR'
      );
    case 402:
      return new ApiError(402, `${providerLabel} credits/quota exhausted.`, 'UPSTREAM_CREDITS_EXHAUSTED');
    case 404:
      return new ApiError(
        502,
        `${providerLabel} could not find the requested model or endpoint: ${upstreamMsg}`,
        'UPSTREAM_ERROR'
      );
    case 429: {
      // Surface any retry hint so clients can back off intelligently.
      const metaRetry = data?.error?.metadata?.retry_after_seconds;
      const retryAfter =
        parseRetrySeconds(headers?.get?.('retry-after')) ??
        parseRetrySeconds(metaRetry) ??
        5;
      return new ApiError(
        429,
        `${providerLabel} rate limit reached (free tiers throttle temporarily). Retry shortly.`,
        'UPSTREAM_RATE_LIMIT',
        { retryAfterSeconds: retryAfter }
      );
    }
    case 502:
    case 503:
      return new ApiError(503, `${providerLabel} is temporarily unavailable. Retry later.`, 'UPSTREAM_UNAVAILABLE');
    default:
      return new ApiError(502, `${providerLabel} error: ${upstreamMsg}`, 'UPSTREAM_ERROR');
  }
}
