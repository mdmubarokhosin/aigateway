#!/usr/bin/env node
/**
 * TELEGRAM BOT — LOCAL POLLING VERSION (no Cloudflare, no dependencies).
 *
 * Runs anywhere Node.js 18+ runs (your laptop, a VPS, GitHub Actions cron…).
 * It LONG-POLLS Telegram for new messages and answers them by calling YOUR
 * deployed gateway's public GET endpoint (/ask?prompt=...) — so all provider
 * keys stay on Cloudflare; this script holds NO provider secrets.
 *
 * Usage:
 *   1. Get a token from @BotFather
 *   2. export TELEGRAM_BOT_TOKEN="123456:ABC..."     (Windows: set TELEGRAM_BOT_TOKEN=...)
 *   3. export GATEWAY_BASE="https://aigatewaybd.pages.dev"   (your deployment)
 *   4. node examples/telegram-bot-poller.mjs
 *
 * Stop with Ctrl+C.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const GATEWAY = (process.env.GATEWAY_BASE || 'https://aigatewaybd.pages.dev').replace(/\/+$/, '');
const API = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN env var. Get one from @BotFather on Telegram.');
  process.exit(1);
}

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error(`[tg:${method}]`, data.description || res.status);
  return data;
}

/** Ask the gateway via the public GET shortcut (plain text mode). */
async function ask(prompt) {
  const url = `${GATEWAY}/ask?prompt=${encodeURIComponent(prompt)}&raw=1`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text);
      return `⚠ Gateway error ${res.status} (${j?.error?.code || 'UNKNOWN'}): ${j?.error?.message || ''}`;
    } catch {
      return `⚠ Gateway error ${res.status}.`;
    }
  }
  return text || '(empty reply)';
}

/** Telegram messages are capped at 4096 chars — split politely. */
function chunk(text, size = 3800) {
  const parts = [];
  let rest = String(text);
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

const WELCOME = [
  '👋 Hi! I am the AI Gateway bot (polling mode).',
  'Send any message and I will answer via the AI gateway.',
  `Gateway: ${GATEWAY}`,
].join('\n');

let offset = 0;

async function loop() {
  try {
    const res = await tg('getUpdates', {
      offset,
      timeout: 25,
      allowed_updates: ['message'],
    });
    for (const update of res.result || []) {
      offset = update.update_id + 1;
      const msg = update.message;
      const text = msg && typeof msg.text === 'string' ? msg.text.trim() : '';
      const chatId = msg && msg.chat && msg.chat.id;
      if (!text || chatId === undefined) continue;

      if (/^\/(start|help)$/i.test(text)) {
        await tg('sendMessage', { chat_id: chatId, text: WELCOME });
        continue;
      }

      console.log(`[>] ${text.slice(0, 80)}`);
      const answer = await ask(text);
      for (const part of chunk(answer)) {
        await tg('sendMessage', { chat_id: chatId, text: part, disable_web_page_preview: true });
      }
      console.log('[<] replied');
    }
  } catch (err) {
    console.error('[poll error]', err.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
  loop();
}

console.log(`🤖 Polling bot started.\n   Gateway: ${GATEWAY}\n   Press Ctrl+C to stop.`);
tg('deleteWebhook', { drop_pending_updates: false }).then(() => loop());
