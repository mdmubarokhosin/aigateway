/**
 * Landing page live data:
 *  - hero status pill      <- GET /api/v1/health (auto-detected base URL)
 *  - provider cards        <- GET /api/v1/providers
 *  - stats band + counters <- /health + /providers + /models
 *  - models marquee        <- GET /api/v1/models
 * Degrades gracefully when the API is offline (e.g. static-only preview).
 */
(function () {
  'use strict';

  var statusPill = document.getElementById('hero-status');
  var statusText = document.getElementById('hero-status-text');
  var grid = document.getElementById('providers-grid');
  var marqueeTrack = document.getElementById('marquee-track');

  function api(path) {
    return (window.AIGW && window.AIGW.apiBase ? window.AIGW.apiBase() : window.location.origin) + path;
  }

  function ux() {
    return window.AIGW_UX || {};
  }

  function reveal(root) {
    if (ux().reveal) ux().reveal(root || document);
  }

  function setPill(state, text) {
    if (!statusPill) return;
    statusPill.classList.remove('sdot-ok', 'sdot-warn', 'sdot-err');
    statusPill.classList.add(state);
    if (statusText) statusText.textContent = text;
  }

  /* ---------- animated count-up for the stats band ---------- */
  function countUp(el, target, suffix, duration) {
    if (!el) return;
    var start = null;
    var from = 0;
    duration = duration || 1100;
    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (target - from) * eased) + (suffix || '');
      if (p < 1) window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
  }

  function setStats(models, providers) {
    var modelsEl = document.getElementById('stat-models');
    var providersEl = document.getElementById('stat-providers');
    if (modelsEl && models > 0) countUp(modelsEl, models, '+');
    else if (modelsEl) modelsEl.textContent = '50+';
    if (providersEl && providers > 0) countUp(providersEl, providers, '+', 800);
    else if (providersEl) providersEl.textContent = '3+';
    var codesEl = document.getElementById('stat-codes');
    if (codesEl) countUp(codesEl, 16, '', 900);
  }

  /* ---------- models marquee ---------- */
  var MARQUEE_FALLBACK = [
    'z-ai/glm-5.2:free', 'deepseek-v4-flash-free', 'poolside/laguna-s-2.1',
    'meta-llama/llama-4-maverick:free', 'qwen/qwen3-coder:free', 'mistralai/mistral-small-3.2',
    'google/gemini-2.5-flash', 'openai/gpt-oss-120b:free', 'deepseek/deepseek-chat-v4',
  ];

  function fillMarquee(modelIds) {
    if (!marqueeTrack) return;
    var items = modelIds && modelIds.length ? modelIds.slice(0, 22) : MARQUEE_FALLBACK;
    // two copies -> seamless -50% translate loop
    var html = '';
    for (var copy = 0; copy < 2; copy += 1) {
      for (var i = 0; i < items.length; i += 1) {
        html += '<span class="marquee-item"><span class="sdot" style="background:var(--primary)"></span>' +
          String(items[i]).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
      }
    }
    marqueeTrack.innerHTML = html;
  }

  fetch(api('/api/v1/health'))
    .then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then(function (data) {
      setPill('sdot-ok', 'API online' + (data.version ? ' · v' + data.version : ''));
    })
    .catch(function () {
      setPill('sdot-warn', 'API offline — deploy to go live (docs: /guide/)');
    });

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function providerCard(p) {
    var configured = Boolean(p.configured);
    var badge = configured
      ? '<span class="meta-chip ok">configured</span>'
      : '<span class="meta-chip">key not set</span>';
    var meta = (window.AIGW && window.AIGW.PROVIDERS_META) || {};
    var desc = p.tagline || '';
    if (!desc && meta.providers && meta.providers[p.id] && meta.providers[p.id].tagline) {
      desc = meta.providers[p.id].tagline;
    }
    if (!desc && meta.taglines && meta.taglines[p.id]) desc = meta.taglines[p.id];
    if (!desc) desc = p.description || '';
    var model = p.defaultModel
      ? '<span class="provider-model">' + escapeHtml(p.defaultModel) + '</span>'
      : '<span class="provider-model">set CUSTOM_MODEL per request/env</span>';
    var env = p.requiredEnvKeys && p.requiredEnvKeys.length
      ? '<span class="small muted mono">env: ' + escapeHtml(p.requiredEnvKeys.join(', ')) + '</span>'
      : '';
    return (
      '<div class="card card-hover provider-card">' +
      '<div class="provider-head"><span class="provider-name">' + escapeHtml(p.label) + '</span>' + badge + '</div>' +
      '<span class="provider-id">id: ' + escapeHtml(p.id) + '</span>' +
      '<p class="provider-desc">' + escapeHtml(desc) + '</p>' +
      model + env +
      '<div style="margin-top:6px"><a class="small" href="/playground/?provider=' + encodeURIComponent(p.id) + '">Try in Playground →</a></div>' +
      '</div>'
    );
  }

  /** Honor the admin-editable display order + hidden list (config/providers.json). */
  function orderProviders(providers) {
    var meta = (window.AIGW && window.AIGW.PROVIDERS_META) || {};
    var hidden = Array.isArray(meta.hidden) ? meta.hidden : [];
    var order = Array.isArray(meta.order) ? meta.order : [];
    var rank = function (id) {
      var i = order.indexOf(id);
      return i === -1 ? order.length + 99 : i;
    };
    var isHidden = function (p) {
      if (hidden.indexOf(p.id) !== -1) return true;
      return Boolean(meta.providers && meta.providers[p.id] && meta.providers[p.id].hidden);
    };
    return providers
      .filter(function (p) { return !isHidden(p); })
      .sort(function (a, b) { return rank(a.id) - rank(b.id); });
  }

  fetch(api('/api/v1/providers'))
    .then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then(function (data) {
      if (!grid) return;
      var providers = orderProviders(data.providers || []);
      if (!providers.length) {
        grid.innerHTML = '<div class="card"><p class="muted small">No providers reported.</p></div>';
        return;
      }
      grid.innerHTML = providers.map(providerCard).join('');
      reveal(grid);
    })
    .catch(function () {
      if (grid) {
        grid.innerHTML =
          '<div class="card card-hover"><h3 style="font-size:1.02rem">OpenRouter</h3>' +
          '<p class="provider-desc">Unified gateway to 200+ models with free-tier options. id: <code class="code-inline">openrouter</code> · key: <code class="code-inline">OPENROUTER_API_KEY</code></p></div>' +
          '<div class="card card-hover"><h3 style="font-size:1.02rem">OpenCode Zen</h3>' +
          '<p class="provider-desc">opencode.ai coding models; free tier auto-listed. id: <code class="code-inline">opencodezen</code> · key: <code class="code-inline">OPENCODEZEN_API_KEY</code></p></div>' +
          '<div class="card card-hover"><h3 style="font-size:1.02rem">Poolside AI</h3>' +
          '<p class="provider-desc">Laguna code-intelligence models for software engineering. id: <code class="code-inline">poolside</code> · key: <code class="code-inline">POOLSIDE_API_KEY</code></p></div>' +
          '<div class="card card-hover"><h3 style="font-size:1.02rem">Custom (OpenAI-compatible)</h3>' +
          '<p class="provider-desc">Any OpenAI-compatible endpoint via CUSTOM_BASE_URL / CUSTOM_API_KEY / CUSTOM_MODEL. id: <code class="code-inline">custom</code></p></div>';
        reveal(grid);
      }
    });

  /* stats band: models total + provider count from the live catalog */
  fetch(api('/api/v1/models'))
    .then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then(function (data) {
      var total = Number(data.total) || (data.data ? data.data.length : 0);
      var providerCount = data.providers
        ? data.providers.filter(function (b) { return b.status !== 'error'; }).length
        : 0;
      setStats(total, providerCount);
      var ids = (data.data || []).map(function (m) { return m.id; }).filter(Boolean);
      fillMarquee(ids);
    })
    .catch(function () {
      setStats(0, 0);
      fillMarquee(null);
    });
})();
