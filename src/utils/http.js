/**
 * Runtime-agnostic HTTP utility built on the global fetch API.
 * Works identically on Cloudflare Workers and Node.js 18+.
 * (This replaces axios, which is unreliable on the Workers runtime.)
 */

/**
 * POST JSON and return a normalized result (never throws for HTTP errors;
 * transport errors propagate to the caller for mapping).
 *
 * @param {string} url
 * @param {Object} options
 * @param {Object} options.headers   - Request headers.
 * @param {*}      options.body      - JSON-serializable body.
 * @param {number} options.timeoutMs - Abort the request after this many ms.
 * @returns {Promise<{ok: boolean, status: number, headers: Headers, data: *}>}
 */
export async function postJson(url, { headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      // Non-JSON body (HTML error page, empty body, ...) -> data stays null.
    }

    return { ok: response.ok, status: response.status, headers: response.headers, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET JSON and return a normalized result (never throws for HTTP errors;
 * transport errors propagate to the caller for mapping).
 *
 * @param {string} url
 * @param {Object} options
 * @param {Object} [options.headers] - Request headers.
 * @param {number} [options.timeoutMs] - Abort the request after this many ms.
 * @returns {Promise<{ok: boolean, status: number, headers: Headers, data: *}>}
 */
export async function getJson(url, { headers, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(headers || {}) },
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      // Non-JSON body (HTML error page, empty body, ...) -> data stays null.
    }

    return { ok: response.ok, status: response.status, headers: response.headers, data };
  } finally {
    clearTimeout(timer);
  }
}
