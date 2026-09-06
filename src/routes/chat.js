/**
 * CHAT ENDPOINTS — one shared failover core, THREE entry points:
 *
 *   1. POST /api/v1/chat          (full JSON API; auth when API_SECRET_KEY set)
 *   2. GET  /api/v1/chat?prompt=… (browser-clickable, NO auth, JSON out)
 *   3. GET  /ask?prompt=…         (custom short route → same core, see
 *                                    functions/ask.js — it rewrites /ask to
 *                                    /api/v1/chat so this handler serves both)
 *
 * The GET style exists so the API can be integrated ANYWHERE a URL can be
 * pasted: browser address bar, <img>, QR codes, n8n/Make webhooks, Telegram
 * bots, spreadsheets... The provider keys stay server-side — callers never
 * need credentials.
 */
import { ApiError } from '../core/errors.js';
import { parseChatPayload } from '../core/validate.js';
import {
  getProvider,
  getProviderIds,
  getConfiguredProviders,
  listProviders,
} from '../providers/registry.js';
import { chatWithFailover } from '../core/failover.js';

/* --------------------------------------------------------------------------
 * SHARED CORE — runs a validated payload through the failover chain.
 * ----------------------------------------------------------------------- */
export async function executeChat({ payload, cfg, env }) {
  if (payload.provider && !getProvider(payload.provider)) {
    throw new ApiError(400, `Unknown provider "${payload.provider}".`, 'UNKNOWN_PROVIDER', {
      availableProviders: getProviderIds(),
    });
  }

  const providers = listProviders(env || {});
  const providerMap = new Map(getProviderIds().map((id) => [id, getProvider(id)]));
  const { result, providerId, attempts, rounds, servedOnRound } = await chatWithFailover(payload, {
    env: env || {},
    config: cfg,
    providers: providerMap,
    configured: getConfiguredProviders(env || {}),
  });

  return {
    providerId,
    reply: result.reply,
    model: result.model,
    usage: result.usage,
    attempts,
    rounds,
    servedOnRound,
    requestedProvider: payload.provider || null,
    configuredProviders: providers.filter((p) => p.configured).map((p) => p.id),
    failoverEnabled: payload.failover === null ? cfg.failover.enabled : payload.failover,
    attemptsHeader: String(attempts.length + 1),
  };
}

/* --------------------------------------------------------------------------
 * 1) POST /api/v1/chat
 * ----------------------------------------------------------------------- */
export async function chatHandler(c) {
  // 1) Parse body
  let body;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, 'Request body contains invalid JSON.', 'INVALID_JSON');
  }

  // 2) Validate + normalize
  const cfg = c.get('config');
  const payload = parseChatPayload(body, cfg);

  // 3) Shared failover core
  const r = await executeChat({ payload, cfg, env: c.env });

  return c.json(
    {
      success: true,
      provider: r.providerId,
      reply: r.reply,
      model: r.model,
      usage: r.usage,
      failover: {
        enabled: r.failoverEnabled,
        attempts: r.attempts,
        rounds: r.rounds,
        servedOnRound: r.servedOnRound,
        requestedProvider: r.requestedProvider,
        configuredProviders: r.configuredProviders,
      },
    },
    200,
    {
      'X-AI-Gateway-Provider': r.providerId,
      'X-AI-Gateway-Attempts': r.attemptsHeader,
    }
  );
}

/* --------------------------------------------------------------------------
 * 2) GET /api/v1/chat?prompt=...   (+ the /ask shortcut via rewrite)
 *
 * Query params:
 *   prompt (required, aliases: q, text, message, msg, p)
 *   provider / model / system_prompt|system / temperature|temp /
 *   max_tokens|maxtokens / failover=true|false
 *   raw=1        -> plain-text reply only (Content-Type: text/plain)
 *   pretty=0     -> compact JSON (default is pretty-printed for browsers)
 * ----------------------------------------------------------------------- */

/** Helpful 400 for a missing/empty prompt (with usage examples). */
function missingPromptError(c) {
  const base = new URL(c.req.url).origin;
  return c.json(
    {
      success: false,
      error: {
        code: 'MISSING_PROMPT',
        message:
          'Add a prompt in the URL, e.g. ' + base + '/api/v1/chat?prompt=Hello%20world (URL-encode spaces as %20).',
        usage: {
          method: 'GET',
          examples: [
            `${base}/api/v1/chat?prompt=What+is+an+API+gateway%3F`,
            `${base}/ask?prompt=Write+a+haiku+about+clouds&raw=1`,
            `${base}/api/v1/chat?prompt=Go+channels+in+one+line&provider=poolside`,
          ],
          optionalParams: {
            provider: 'openrouter | opencodezen | poolside | custom (default: server default)',
            model: 'any model id from GET /api/v1/models',
            system_prompt: 'instruction for the AI',
            temperature: '0 - 2 (default 0.7)',
            max_tokens: 'integer cap on reply length',
            failover: 'true | false (false pins the chosen provider)',
            raw: '1 = plain text reply instead of JSON',
            pretty: '0 = compact JSON',
          },
        },
      },
    },
    400
  );
}

export async function getChatHandler(c) {
  const q = c.req.query.bind(c.req);

  const prompt =
    q('prompt') ?? q('q') ?? q('text') ?? q('message') ?? q('msg') ?? q('p') ?? '';
  if (!String(prompt).trim()) return missingPromptError(c);

  const num = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };
  const bool = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
  };

  const body = {
    message: prompt,
    provider: q('provider') || undefined,
    model: q('model') || undefined,
    system_prompt: q('system_prompt') || q('system') || q('sys') || undefined,
    temperature: num(q('temperature') ?? q('temp')),
    max_tokens: num(q('max_tokens') ?? q('maxtokens')),
    failover: bool(q('failover')),
  };
  // Remove undefined keys so parseChatPayload defaults apply.
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

  const cfg = c.get('config');

  let payload;
  try {
    payload = parseChatPayload(body, cfg);
  } catch (err) {
    // Re-wrap validation errors with GET-friendly guidance.
    if (err instanceof ApiError) {
      return c.json(
        {
          success: false,
          error: {
            code: err.code,
            message: err.message + '  (check the URL query parameters)',
          },
        },
        err.statusCode || 400
      );
    }
    throw err;
  }

  const r = await executeChat({ payload, cfg, env: c.env });

  const headers = {
    'X-AI-Gateway-Provider': r.providerId,
    'X-AI-Gateway-Attempts': r.attemptsHeader,
  };

  // raw=1 -> plain text (great for <img> alt pipelines / scripts / spreadsheets)
  if (bool(q('raw') ?? q('plain'))) {
    return c.body(String(r.reply), 200, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
  }

  const envelope = {
    success: true,
    provider: r.providerId,
    reply: r.reply,
    model: r.model,
    usage: r.usage,
    failover: {
      enabled: r.failoverEnabled,
      attempts: r.attempts,
      rounds: r.rounds,
      servedOnRound: r.servedOnRound,
      requestedProvider: r.requestedProvider,
      configuredProviders: r.configuredProviders,
    },
  };

  const compact = ['1', 'true', 'yes'].includes(String(q('pretty') ?? '').toLowerCase()) === false;
  const text = JSON.stringify(envelope, null, compact ? 0 : 2);
  return c.body(text + (compact ? '' : '\n'), 200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
}
