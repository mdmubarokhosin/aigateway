/**
 * /ask — SHORT CUSTOM ROUTE for the GET chat endpoint (Stage 7).
 *
 *   https://<your-domain>/ask?prompt=Hello%20world
 *
 * is rewritten internally to /api/v1/chat (the public GET chat handler in
 * src/routes/chat.js), so BOTH URLs share the exact same failover chain,
 * rate limits and JSON envelope. Supported query params are identical:
 *
 *   prompt  (required)  - the question (URL-encode it)
 *   provider / model / system_prompt / temperature / max_tokens / failover
 *   raw=1  -> plain text reply;  pretty=0 -> compact JSON
 *
 * Why a separate Function? Cloudflare Pages routes /api/* to functions/api/,
 * so /ask needs its own function file. Rewriting the URL and delegating to
 * the same Hono app avoids duplicating ANY logic.
 */
import app from '../src/index.js';

export const onRequest = (context) => {
  const url = new URL(context.request.url);
  url.pathname = '/api/v1/chat'; // keep query string (?prompt=...) untouched
  const request = new Request(url, context.request);
  return app.fetch(request, context.env, context.ctx);
};
