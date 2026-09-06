/**
 * AI GATEWAY CHATBOT WIDGET — floating agent on every page.
 *
 * What it does:
 *   1. Answers visitors' questions about THIS site as a knowledge agent:
 *      it is briefed with (a) the site facts, (b) LIVE provider data from
 *      GET /api/v1/providers, and (c) the admin-editable knowledge base
 *      (config/knowledge.json → window.AIGW.KNOWLEDGE — CRUD in /admin).
 *   2. Runs ON this gateway itself (POST /api/v1/chat with auto-failover),
 *      so every reply is a live proof that the API works end-to-end.
 *      Each assistant bubble shows provider · model · ms · failover chips.
 *   3. Renders replies as rich Markdown (headings, lists, tables, code
 *      blocks with copy buttons) via assets/js/markdown.js.
 *
 * Config: window.AIGW.SITE.chatbot (config/site.json — editable in /admin).
 * Privacy: conversation history stays in sessionStorage (this tab only).
 * i18n: all chrome labels follow the site language (I18N); the bot itself
 * replies in the language the visitor writes in.
 */
(function () {
  'use strict';

  var site = (window.AIGW && window.AIGW.SITE) || {};
  var botCfg = site.chatbot || {};
  if (botCfg.enabled === false) return; // admin can disable the widget

  var STORAGE_KEY = 'aigw-chat-history';
  var MAX_CONTEXT_TURNS = 8; // multi-turn memory sent upstream
  var MAX_STORED = 40;

  var apiBase = function () {
    return window.AIGW && window.AIGW.apiBase ? window.AIGW.apiBase() : window.location.origin;
  };

  function t(key) {
    return window.I18N ? window.I18N.t(key) : key;
  }

  function botName() { return botCfg.name || t('cb.name'); }
  function welcomeText() { return botCfg.welcome || t('cb.welcome'); }
  function temperature() { return typeof botCfg.temperature === 'number' ? botCfg.temperature : 0.3; }
  function maxTokens() { return typeof botCfg.maxTokens === 'number' ? botCfg.maxTokens : 900; }
  function quickQuestions() {
    if (Array.isArray(botCfg.quickQuestions) && botCfg.quickQuestions.length) {
      return botCfg.quickQuestions.slice(0, 6);
    }
    return ['cb.quick1', 'cb.quick2', 'cb.quick3', 'cb.quick4', 'cb.quick5', 'cb.quick6'].map(t);
  }

  /* ---------- state ---------- */
  var turns = []; // [{role, content, meta?}] — meta only on assistant rows (display-only)
  var providersContext = ''; // compact provider facts fetched once
  var busy = false;

  function loadHistory() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) turns = JSON.parse(raw) || [];
    } catch (e) {
      turns = [];
    }
    if (!Array.isArray(turns)) turns = [];
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-MAX_STORED)));
    } catch (e) { /* storage unavailable */ }
  }

  /* ---------- DOM ---------- */
  var CHAT_ICON =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 9.5h8M8 13h5"/></svg>';
  var CLOSE_ICON =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var SEND_ICON =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
  var COPY_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  function buildDom() {
    var root = document.createElement('div');
    root.className = 'cb-root';
    root.innerHTML =
      // launcher
      '<button class="cb-launcher" id="cb-launcher" type="button" aria-label="' + esc(t('cb.open')) + '" aria-expanded="false">' +
      CHAT_ICON +
      '<span class="cb-launcher-dot" aria-hidden="true"></span>' +
      '</button>' +
      // panel
      '<section class="cb-panel" id="cb-panel" role="dialog" aria-label="' + esc(botName()) + '" aria-hidden="true">' +
      '<header class="cb-head">' +
      '<span class="cb-avatar" aria-hidden="true">' + botAvatar() + '</span>' +
      '<div class="cb-head-text"><strong>' + esc(botName()) + '</strong>' +
      '<span class="cb-head-sub"><span class="sdot" aria-hidden="true"></span> ' + esc(t('cb.subtitle')) + '</span></div>' +
      '<button class="cb-clear" id="cb-clear" type="button" title="' + esc(t('cb.clear')) + '" aria-label="' + esc(t('cb.clear')) + '">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
      '</button>' +
      '<button class="cb-close" id="cb-close" type="button" aria-label="' + esc(t('common.close')) + '">' + CLOSE_ICON + '</button>' +
      '</header>' +
      '<div class="cb-msgs" id="cb-msgs" aria-live="polite"></div>' +
      '<div class="cb-quick" id="cb-quick"></div>' +
      '<form class="cb-input-row" id="cb-form">' +
      '<textarea class="cb-input" id="cb-input" rows="1" placeholder="' + esc(t('cb.placeholder')) + '" aria-label="Your question"></textarea>' +
      '<button class="cb-send" id="cb-send" type="submit" aria-label="Send message">' + SEND_ICON + '</button>' +
      '</form>' +
      '</section>';
    document.body.appendChild(root);
    return root;
  }

  function botAvatar() {
    return (
      '<svg width="17" height="17" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="cbLg" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#d946ef"/></linearGradient></defs>' +
      '<rect width="64" height="64" rx="14" fill="url(#cbLg)"/>' +
      '<path d="M35.5 9 L17 37.5 h11.5 L25 55 L47 26 H34.5 Z" fill="#fff"/></svg>'
    );
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- rendering ---------- */
  function el(id) {
    return document.getElementById(id);
  }

  function renderAll() {
    var wrap = el('cb-msgs');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (turns.length === 0) {
      wrap.appendChild(bubble('bot', welcomeText(), null));
    }
    turns.forEach(function (turn) {
      wrap.appendChild(turn.role === 'user' ? bubble('user', turn.content, null) : bubble('bot', turn.content, turn.meta));
    });
    wrap.scrollTop = wrap.scrollHeight;
  }

  function bubble(kind, text, meta) {
    var row = document.createElement('div');
    row.className = 'cb-row cb-' + kind;
    var av = kind === 'bot' ? '<span class="cb-bubble-avatar" aria-hidden="true">' + botAvatar() + '</span>' : '';
    var body = document.createElement('div');
    body.className = 'cb-bubble';
    var content = document.createElement('div');
    content.className = 'cb-bubble-text';

    if (kind === 'bot' && !(meta && meta.error) && window.MD) {
      // Rich markdown rendering for assistant replies.
      content.innerHTML = window.MD.render(String(text || ''));
      window.MD.enhance(content);
    } else {
      content.textContent = text;
    }
    body.appendChild(content);

    if (kind === 'bot' && meta) {
      var chips = document.createElement('div');
      chips.className = 'cb-chips';
      var html = '';
      if (meta.provider) html += '<span class="meta-chip">' + esc(meta.provider) + '</span>';
      if (meta.model) html += '<span class="meta-chip">' + esc(meta.model) + '</span>';
      if (meta.ms) html += '<span class="meta-chip">' + esc(meta.ms + ' ms') + '</span>';
      if (meta.failover) html += '<span class="meta-chip warn">failover</span>';
      chips.innerHTML = html;
      body.appendChild(chips);

      // Copy-full-reply action
      var actions = document.createElement('div');
      actions.className = 'cb-actions';
      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'cb-copy-reply';
      copyBtn.innerHTML = COPY_ICON + '<span>' + esc(t('common.copy')) + '</span>';
      copyBtn.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(String(text || ''));
        }
        var label = copyBtn.querySelector('span');
        var old = label.textContent;
        label.textContent = t('common.copied');
        setTimeout(function () { label.textContent = old; }, 1500);
      });
      actions.appendChild(copyBtn);
      body.appendChild(actions);
    }
    if (kind === 'bot' && meta && meta.error) {
      body.classList.add('cb-bubble-err');
    }

    row.innerHTML = av;
    row.appendChild(body);
    return row;
  }

  function renderQuick() {
    var box = el('cb-quick');
    if (!box) return;
    var quick = quickQuestions();
    if (!quick.length) {
      box.style.display = 'none';
      return;
    }
    box.innerHTML = quick.map(function (q) {
      return '<button class="cb-quick-btn" type="button">' + esc(q) + '</button>';
    }).join('');
  }

  function showTyping() {
    var wrap = el('cb-msgs');
    var row = document.createElement('div');
    row.className = 'cb-row cb-bot';
    row.id = 'cb-typing';
    row.innerHTML =
      '<span class="cb-bubble-avatar" aria-hidden="true">' + botAvatar() + '</span>' +
      '<div class="cb-bubble cb-typing-bubble"><span class="cb-dot"></span><span class="cb-dot"></span><span class="cb-dot"></span></div>';
    wrap.appendChild(row);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function hideTyping() {
    var typing = el('cb-typing');
    if (typing) typing.remove();
  }

  /* ---------- agent context: providers + knowledge base ---------- */
  function loadProviderContext() {
    return fetch(apiBase() + '/api/v1/providers')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.providers) return;
        var rows = data.providers
          .map(function (p) {
            return (
              '- ' + p.id + ' (' + p.label + ')' +
              (p.defaultModel ? ', default model: ' + p.defaultModel : '') +
              (p.freeOnly ? ' [model listing policy: FREE models only]' : '') +
              (p.configured === false ? ' [not configured yet on the server]' : ' [configured]')
            );
          })
          .join('\n');
        providersContext =
          'Providers currently registered on this gateway (id — label):\n' + rows +
          '\nDefault provider: ' + (data.defaultProvider || 'auto');
      })
      .catch(function () { providersContext = ''; });
  }

  function knowledgeBlock() {
    var entries = (window.AIGW && window.AIGW.KNOWLEDGE && window.AIGW.KNOWLEDGE.entries) || [];
    if (!entries.length) return '';
    return (
      'SITE KNOWLEDGE BASE (verified facts about this website — prefer these over guessing; ' +
      'quote them when the question matches, and link the relevant page with markdown when helpful):\n' +
      entries
        .slice(0, 14)
        .map(function (entry) {
          return '### ' + entry.topic + '\n' + String(entry.answer || '').slice(0, 700);
        })
        .join('\n\n')
    );
  }

  function systemPrompt() {
    return [
      'You are the friendly support assistant embedded on the website of "AI Gateway API" — a multi-provider AI gateway deployed on Cloudflare Pages.',
      'Your job: answer visitor questions about THIS site clearly and concisely (short paragraphs, bullet lists when helpful). You have access to the whole site knowledge below, so you can explain every page, endpoint, provider and setup step.',
      'Reply in the SAME language the visitor writes in: Bangla (বাংলা) or English.',
      'FORMAT: your replies are rendered as Markdown. Use **bold** for key terms, bullet lists, `inline code` for ids/params, and ```bash code blocks for commands. Keep code blocks short.',
      '',
      'FACTS you know (do NOT invent anything beyond these):',
      '- Base URL: ' + apiBase() + ' (auto-detected from the browser address bar; also served at GET /api/v1/config)',
      '- Endpoints: GET /api/v1/health (public liveness), GET /api/v1/config (runtime config, public), GET /api/v1/providers (provider discovery, auth), GET /api/v1/models (live model catalog auto-fetched from every provider, auth), POST /api/v1/chat (chat completion, auth).',
      '- GET-STYLE CHAT (no auth, works by opening a link): GET /api/v1/chat?prompt=your+question and the short custom route GET /ask?prompt=your+question — both return JSON directly in the browser; add &raw=1 for plain text, &provider=poolside to pin a provider. Great for integrations anywhere a URL works.',
      '- POST /api/v1/chat body: {"message": "..."} or {"messages":[{role,content}...]}, optional: provider ("openrouter" | "opencodezen" | "poolside" | "custom"), model, system_prompt, temperature (0-2), max_tokens, failover (false pins one provider).',
      '- AUTOMATIC FAILOVER: default ON. If a provider errors (rate limit, timeout, outage...), the gateway automatically tries the next configured provider and keeps cycling (FAILOVER_MAX_ROUNDS, default 3) until a response arrives. Response includes which provider served it. {"failover": false} pins a single provider.',
      '- MODEL CATALOG POLICY: OpenRouter and OpenCode Zen list ONLY their free models (":free" / "-free" ids); other providers list their full catalog. GET /api/v1/models?refresh=1 forces a re-fetch; results are cached (default 6h). The admin can also pin curated models per provider from the Admin Panel.',
      providersContext ? '- ' + providersContext.replace(/\n/g, '\n  ') : '',
      '- Authentication: optional gateway key via env API_SECRET_KEY; clients send header X-API-Key. Provider keys (OPENROUTER_API_KEY, POOLSIDE_API_KEY, OPENCODEZEN_API_KEY...) live ONLY in server env vars (Cloudflare Pages Variables and secrets) — never exposed to browsers. The complete importable env file is documented on the /env-setup/ page.',
      '- Errors: one envelope {"success":false,"error":{"code","message"}} with typed codes (INVALID_JSON, VALIDATION_ERROR, UNKNOWN_PROVIDER, RATE_LIMITED, UPSTREAM_RATE_LIMIT, UPSTREAM_AUTH_ERROR, ALL_PROVIDERS_FAILED...). 429s include retryAfterSeconds.',
      '- Docs site pages: /docs/ (full reference), /endpoints/ (endpoint list), /models/ (live catalog), /playground/ (interactive tester), /guide/ (integration), /status/ (live monitoring), /custom-provider/ (add any OpenAI-compatible provider), /telegram/ (Telegram bot setup + code), /env-setup/ (complete Cloudflare env variables import guide), /admin/ (owner-only panel with full CRUD over providers, models, knowledge).',
      '- TELEGRAM BOT: the gateway ships a functional Telegram webhook at /api/telegram/<secret> plus a local polling script. Full setup guide: /telegram/ page.',
      '- ADMIN PANEL: /admin/ — GitHub-backed full CRUD: add/edit/delete AI Providers and their curated models, edit the chatbot knowledge base (this very knowledge), site branding, announcement banner and chatbot settings. Every save commits to the GitHub repo → Cloudflare Pages redeploys automatically.',
      '- Deployment: Cloudflare Pages, GitHub repo as source; build command npm run build, output dir "out".',
      '',
      knowledgeBlock(),
      '',
      'Style: helpful, honest, practical. If asked something unrelated to the API, answer briefly and steer back. Never reveal API keys or invent provider/model names not in the facts above.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /* ---------- send ---------- */
  function sendMessage(text) {
    if (busy) return;
    var content = String(text || '').trim();
    if (!content) return;

    turns.push({ role: 'user', content: content });
    renderAll();
    saveHistory();
    busy = true;
    var sendBtn = el('cb-send');
    if (sendBtn) sendBtn.disabled = true;
    showTyping();

    // Build multi-turn context (last MAX_CONTEXT_TURNS turns, strip meta)
    var context = turns
      .slice(-MAX_CONTEXT_TURNS)
      .map(function (turn) { return { role: turn.role, content: turn.content }; });
    // The just-pushed user message is the last item; drop it (sent as "message")
    var lastUser = context.pop();

    var body = {
      message: lastUser ? lastUser.content : content,
      system_prompt: systemPrompt(),
      temperature: temperature(),
      max_tokens: maxTokens(),
    };
    if (context.length) body.messages = context;

    var started = Date.now();
    fetch(apiBase() + '/api/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () { return { success: false, error: { code: 'BAD_RESPONSE', message: 'Non-JSON response from gateway.' } }; })
          .then(function (payload) { return { status: res.status, payload: payload, ms: Date.now() - started }; });
      })
      .then(function (result) {
        var p = result.payload;
        if (p && p.success) {
          turns.push({
            role: 'assistant',
            content: p.reply || t('cb.emptyReply'),
            meta: {
              provider: p.provider,
              model: p.model,
              ms: result.ms,
              failover: p.failover && p.failover.attempts && p.failover.attempts.length > 0,
            },
          });
        } else {
          var err = (p && p.error) || {};
          var msg =
            t('cb.errorPrefix') + ' (' + (err.code || 'HTTP ' + result.status) + ').\n' +
            (err.message || 'Unknown error') +
            '\n\n' + t('cb.errorHint');
          turns.push({ role: 'assistant', content: msg, meta: { error: true } });
        }
      })
      .catch(function (netErr) {
        turns.push({
          role: 'assistant',
          content:
            t('cb.networkError') + ' ' + apiBase() + '/api/v1/chat\n' + (netErr && netErr.message ? netErr.message : '') +
            '\n\n' + t('cb.networkHint'),
          meta: { error: true },
        });
      })
      .finally(function () {
        hideTyping();
        busy = false;
        if (sendBtn) sendBtn.disabled = false;
        renderAll();
        saveHistory();
      });
  }

  /* ---------- open/close ---------- */
  var open = false;

  function setOpen(next) {
    open = next;
    var panel = el('cb-panel');
    var launcher = el('cb-launcher');
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
    launcher.classList.toggle('hidden', open);
    document.body.classList.toggle('cb-open', open);
    if (open) {
      renderAll();
      setTimeout(function () { el('cb-input').focus(); }, 120);
    }
  }

  /* ---------- boot ---------- */
  function init() {
    loadHistory();
    buildDom();
    renderQuick();

    el('cb-launcher').addEventListener('click', function () { setOpen(true); });
    el('cb-close').addEventListener('click', function () { setOpen(false); });
    el('cb-clear').addEventListener('click', function () {
      turns = [];
      saveHistory();
      renderAll();
    });

    el('cb-quick').addEventListener('click', function (event) {
      var btn = event.target.closest('.cb-quick-btn');
      if (btn) sendMessage(btn.textContent);
    });

    var form = el('cb-form');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var input = el('cb-input');
      var text = input.value;
      input.value = '';
      input.style.height = 'auto';
      sendMessage(text);
    });

    var input = el('cb-input');
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && open) setOpen(false);
    });

    // Language switch -> re-translate chrome + quick chips + welcome.
    document.addEventListener('aigw:lang', function () {
      var launcher = el('cb-launcher');
      if (launcher) launcher.setAttribute('aria-label', t('cb.open'));
      var panel = el('cb-panel');
      if (panel) panel.setAttribute('aria-label', botName());
      var inputEl = el('cb-input');
      if (inputEl) inputEl.setAttribute('placeholder', t('cb.placeholder'));
      renderQuick();
      renderAll();
    });

    loadProviderContext();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
