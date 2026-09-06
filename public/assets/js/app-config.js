/**
 * FRONTEND RUNTIME CONFIG — single source of truth for page chrome.
 *
 * scripts/build.mjs REGENERATES this file into out/assets/js/app-config.js
 * from environment variables at build time:
 *
 *   APP_VERSION   -> window.AIGW.APP_VERSION   (default: 1.0.0)
 *   APP_NAME      -> window.AIGW.APP_NAME      (default: AI Gateway API)
 *   API_BASE_URL  -> window.AIGW.API_BASE      (default: "" = auto-detect)
 *
 * API_BASE auto-detection: when empty, every page talks to the API on the
 * SAME origin it is being served from (localhost, *.pages.dev, or a custom
 * domain) — so one build works everywhere with zero configuration.
 *
 * Pages additionally refresh these values at runtime from
 * GET /api/v1/config (see layout.js), so changing APP_VERSION in the
 * Cloudflare dashboard and redeploying updates EVERY page automatically.
 */
(function () {
  'use strict';
  var AIGW = {
    APP_NAME: 'AI Gateway API',
    APP_VERSION: '1.0.0',
    API_BASE: '',

    // Admin-editable site config (config/site.json in the GitHub repo —
    // injected for real by scripts/build.mjs at build time).
    SITE: {
      appName: 'AI Gateway API',
      tagline: 'One AI API. Every provider.',
      description: '',
      announcement: { enabled: false, text: '', link: '', linkLabel: 'Learn more' },
      chatbot: {
        enabled: true,
        name: 'Gateway Assistant',
        welcome: 'Hi! Ask me anything about this API.',
        quickQuestions: [],
        temperature: 0.3,
        maxTokens: 900,
      },
    },
    PROVIDERS_META: { order: [], hidden: [], taglines: {} },

    /** Auto-detected API base URL (respects the API_BASE_URL build override). */
    apiBase: function () {
      if (this.API_BASE) return String(this.API_BASE).replace(/\/+$/, '');
      return window.location.origin;
    },

    /** GET {apiBase}/api/v1/config — resolves with the live server config. */
    fetchServerConfig: function () {
      return fetch(this.apiBase() + '/api/v1/config', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    },
  };

  window.AIGW = AIGW;
})();
