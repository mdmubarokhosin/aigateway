/**
 * AI GATEWAY API — the single Hono application, runtime-agnostic.
 *
 * The SAME app object is mounted by:
 *   - Cloudflare Pages Functions (functions/api/[[route]].js and functions/health.js)
 *   - Node.js (server.node.js via @hono/node-server)
 *
 * Middleware pipeline (order matters):
 *   1. config        - resolve effective config for every request
 *   2. secureHeaders - security HTTP headers
 *   3. cors          - allow-list based CORS (hand-rolled, runtime-agnostic)
 *   4. rate limit    - global soft cap on /api/v1/*
 *   5. routes        - public /health, protected /api/v1 group
 *   6. notFound/onError - centralized JSON errors
 */
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { getConfig } from './config.js';
import { rateLimit } from './middleware/rate-limit.js';
import { apiKeyAuth } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthCheck } from './routes/health.js';
import { configHandler } from './routes/config.js';
import { listProvidersHandler } from './routes/providers.js';
import { modelsHandlerFactory } from './routes/models.js';
import { chatHandler, getChatHandler } from './routes/chat.js';

const app = new Hono();

// ---- 1) Per-request config (works with Cloudflare env AND process.env) ----
app.use('*', async (c, next) => {
  c.set('config', getConfig(c.env || {}));
  await next();
});

// ---- 2) Security headers ---------------------------------------------------
app.use('*', secureHeaders());

// ---- 3) CORS (config-driven allow-list; '*' by default) ---------------------
app.use('*', async (c, next) => {
  const cfg = c.get('config');
  const origin = c.req.header('Origin');
  const allowAll = cfg.allowedOrigins.includes('*');
  const allowed = allowAll || (origin && cfg.allowedOrigins.includes(origin));

  if (origin && allowed) {
    c.header('Access-Control-Allow-Origin', allowAll ? '*' : origin);
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
    c.header('Access-Control-Max-Age', '86400');
    if (!allowAll) c.header('Vary', 'Origin');
  }

  // Handle CORS preflight everywhere.
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

// ---- 4) Rate limiting (global soft cap) -------------------------------------
app.use(
  '/api/v1/*',
  rateLimit({
    getWindowMs: (cfg) => cfg.rateLimit.global.windowMs,
    getMax: (cfg) => cfg.rateLimit.global.max,
    message: 'Too many requests from this IP. Please try again later.',
  })
);

// ---- 5) Public probes: liveness + runtime config (no auth) -----------------
app.get('/api/v1/health', healthCheck);
app.get('/health', healthCheck);
app.get('/api/v1/config', configHandler);

// ---- 5b) PUBLIC GET chat — browser-clickable, no API key needed -------------
// Registered BEFORE the protected /api/v1 group, so GET /api/v1/chat?prompt=…
// (and the /ask shortcut, which rewrites to this route) works straight from a
// URL — no headers, no body, keys stay server-side. POST /api/v1/chat below
// keeps its optional X-API-Key auth.
app.get(
  '/api/v1/chat',
  rateLimit({
    getWindowMs: (cfg) => cfg.rateLimit.chat.windowMs,
    getMax: (cfg) => cfg.rateLimit.chat.max,
    message: 'Chat rate limit exceeded. Please slow down.',
  }),
  getChatHandler
);

// ---- 6) Protected API v1 group ----------------------------------------------
const v1 = new Hono();
v1.use('*', apiKeyAuth());

v1.get('/providers', listProvidersHandler);
v1.get('/models', modelsHandlerFactory());
v1.post(
  '/chat',
  rateLimit({
    getWindowMs: (cfg) => cfg.rateLimit.chat.windowMs,
    getMax: (cfg) => cfg.rateLimit.chat.max,
    message: 'Chat rate limit exceeded. Please slow down.',
  }),
  chatHandler
);

app.route('/api/v1', v1);

// ---- 7) Centralized JSON errors (must be last) -------------------------------
app.notFound(notFoundHandler);
app.onError(errorHandler);

export default app;
