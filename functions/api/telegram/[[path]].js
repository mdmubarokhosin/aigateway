/**
 * TELEGRAM BOT WEBHOOK — functional serverless Telegram bot on this gateway.
 *
 * SETUP (2 minutes, full walkthrough on the /telegram page):
 *   1. Create a bot with @BotFather → get TELEGRAM_BOT_TOKEN.
 *   2. Add to Cloudflare Pages → Variables and secrets:
 *        TELEGRAM_BOT_TOKEN        = 123456:ABC-DEF...
 *        TELEGRAM_WEBHOOK_SECRET   = any-random-string   (recommended)
 *   3. Register the webhook ONCE:
 *        curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://aigatewaybd.pages.dev/api/telegram/<SECRET>"
 *   4. Message your bot — replies come from THIS gateway's provider chain.
 *
 * SECURITY:
 *   - If TELEGRAM_WEBHOOK_SECRET is set, updates whose path suffix does not
 *     match are rejected (403) — Telegram's own secret_token could also be
 *     used, but the secret path works everywhere with zero extra headers.
 *   - Per-chat rate limit guards against loops (Telegram retry storms).
 *   - Provider keys stay server-side; the bot never exposes them.
 *
 * OPTIONAL env vars: TELEGRAM_BOT_USERNAME (display), TELEGRAM_MAX_TOKENS
 * (reply cap, default 1200), TELEGRAM_SYSTEM_PROMPT (override personality).
 */
import { getConfig } from '../../../src/config.js';
import { parseChatPayload } from '../../../src/core/validate.js';
import { executeChat } from '../../../src/routes/chat.js';
import { GENERATED_KNOWLEDGE } from '../../../src/providers/generated-data.js';

const TG_API = 'https://api.telegram.org';
const MAX_TEXT = 3800; // Telegram hard limit is 4096 chars per message
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_CHAT = 12;

/** Best-effort per-isolate rate limiter (per chat id). */
const rateMap = new Map(); // chatId -> [timestamps]
function rateLimited(chatId) {
  const now = Date.now();
  const arr = (rateMap.get(chatId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX_PER_CHAT) {
    rateMap.set(chatId, arr);
    return true;
  }
  arr.push(now);
  rateMap.set(chatId, arr);
  return false;
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function tgCall(token, method, body) {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error */
  }
  return { ok: res.ok, data };
}

/** Split long text into Telegram-sized chunks (on newlines when possible). */
function chunkText(text) {
  const out = [];
  let rest = String(text || '');
  while (rest.length > MAX_TEXT) {
    let cut = rest.lastIndexOf('\n', MAX_TEXT);
    if (cut < MAX_TEXT * 0.5) cut = MAX_TEXT;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out.length ? out : ['(empty reply)'];
}

async function sendReply(token, chatId, text) {
  const chunks = chunkText(text);
  for (const chunk of chunks) {
    const html = escapeHtml(chunk);
    let res = await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    // Fallback: some clients choke on entities — resend plain.
    if (!res.ok) {
      res = await tgCall(token, 'sendMessage', {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      });
    }
    if (!res.ok) break; // give up silently; returning 200 stops Telegram retries
  }
}

function knowledgeBlock() {
  const entries = Array.isArray(GENERATED_KNOWLEDGE?.entries) ? GENERATED_KNOWLEDGE.entries : [];
  if (!entries.length) return '';
  return (
    '\nSITE KNOWLEDGE (use these facts when relevant):\n' +
    entries
      .slice(0, 12)
      .map((e) => `- ${e.topic}: ${String(e.answer || '').replace(/\s+/g, ' ').slice(0, 500)}`)
      .join('\n')
  );
}

function systemPrompt(env) {
  return (
    (env.TELEGRAM_SYSTEM_PROMPT && env.TELEGRAM_SYSTEM_PROMPT.trim()) ||
    [
      'You are a helpful assistant running inside a Telegram bot, powered by "AI Gateway API" (a multi-provider AI gateway on Cloudflare Pages).',
      'Reply in the SAME language the user writes in (Bangla or English or any other).',
      'Be concise and friendly — Telegram is a chat app: short paragraphs, bullet lists, no huge markdown tables.',
      'Keep replies under ~350 words unless the user explicitly asks for more.',
      knowledgeBlock(),
    ]
      .filter(Boolean)
      .join('\n')
  );
}

function welcomeText(env) {
  const name = env.TELEGRAM_BOT_USERNAME ? ` @${env.TELEGRAM_BOT_USERNAME}` : '';
  return [
    `👋 Hi! I am the AI Gateway bot${name}.`,
    '',
    "Send me ANY message and I will answer through the gateway's AI providers (with automatic failover).",
    '',
    'Try:',
    '• "Explain DNS in simple words"',
    '• "বাংলায় একটি কবিতা লেখো"',
    '• "Write a Go function that reads a file"',
    '',
    'Useful links:',
    '• Site: https://aigatewaybd.pages.dev/',
    '• GET shortcut: /ask?prompt=your+question',
  ].join('\n');
}

/* ------------------------------------------------------------------------ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = env.TELEGRAM_BOT_TOKEN || '';

  // --- GET: friendly status probe (no secrets) ---
  if (request.method === 'GET') {
    return json({
      service: 'telegram-bot-webhook',
      ok: true,
      tokenConfigured: Boolean(token),
      secretRequired: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
      usage: 'POST Telegram updates here; set the webhook with setWebhook (see /telegram page).',
    });
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed. Use POST (Telegram webhook) or GET (status).' }, 405);
  }

  // --- Secret path check ---
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const expected = `/api/telegram/${env.TELEGRAM_WEBHOOK_SECRET}`;
    if (url.pathname !== expected) {
      return json({ ok: false, error: 'Wrong webhook path.' }, 403);
    }
  }

  if (!token) {
    // 200 so Telegram does not retry-storm; the problem is configuration.
    return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured on the server.' });
  }

  // --- Parse the Telegram update ---
  let update;
  try {
    update = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON update.' }, 400);
  }

  // Only plain private/group text messages are handled; everything else 200s.
  const msg = update && (update.message || update.edited_message);
  const text = msg && typeof msg.text === 'string' ? msg.text.trim() : '';
  const chatId = msg && msg.chat && msg.chat.id;
  if (!msg || !text || chatId === undefined) {
    return json({ ok: true, ignored: true });
  }

  if (rateLimited(chatId)) {
    await sendReply(token, chatId, '⏳ Too many messages — please wait a minute.');
    return json({ ok: true, rateLimited: true });
  }

  // Commands
  if (/^\/(start|help)(@\w+)?$/i.test(text)) {
    await sendReply(token, chatId, welcomeText(env));
    return json({ ok: true, command: true });
  }

  // --- Ask the gateway (same failover core as the website chatbot) ---
  const cfg = getConfig(env);
  const maxTokens = Number.parseInt(env.TELEGRAM_MAX_TOKENS, 10);
  const body = {
    message: text.slice(0, cfg.validation.maxMessageLength),
    system_prompt: systemPrompt(env),
    temperature: 0.6,
    max_tokens: Number.isNaN(maxTokens) ? 1200 : Math.min(Math.max(maxTokens, 100), cfg.validation.maxTokensLimit),
  };

  let replyText;
  try {
    const payload = parseChatPayload(body, cfg);
    const r = await executeChat({ payload, cfg, env });
    replyText = r.reply;
  } catch (err) {
    const code = err && err.code ? err.code : 'ERROR';
    replyText =
      `⚠ Could not answer right now (${code}).\n${(err && err.message) || 'Unknown error'}\n\n` +
      'All providers may be busy — please try again in a moment.';
  }

  await sendReply(token, chatId, replyText);
  return json({ ok: true });
}
