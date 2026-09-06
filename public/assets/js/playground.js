/**
 * Playground logic:
 *  - talks to the AUTO-DETECTED base URL (window.AIGW.apiBase()) — works on
 *    localhost, *.pages.dev, or any custom domain with zero configuration
 *  - loads providers from GET /api/v1/providers (fallback: static list)
 *  - "Auto" provider mode (default): the gateway fails over automatically —
 *    if one provider errors, the next one is tried until a response arrives
 *  - builds the request body from the form (simple OR multi-turn mode)
 *  - POSTs to /api/v1/chat, renders reply / typed error / failover chain
 *  - keeps the last 8 requests in an expandable history
 *  - supports URL prefill: /playground/?provider=poolside&model=…&message=…
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var form = $('pg-form');
  var providerSel = $('f-provider');
  var modelInput = $('f-model');
  var modelList = $('model-list');
  var systemField = $('field-system');
  var systemInput = $('f-system');
  var messageField = $('field-message');
  var messageInput = $('f-message');
  var multiturnField = $('field-multiturn');
  var multiturnToggle = $('f-multiturn');
  var messagesJson = $('f-messages-json');
  var tempInput = $('f-temp');
  var tempVal = $('temp-val');
  var maxTokensInput = $('f-maxtokens');
  var sendBtn = $('send-btn');
  var sendLabel = $('send-label');
  var banner = $('pg-banner');
  var respArea = $('resp-area');
  var respChips = $('resp-chips');
  var providerHint = $('provider-hint');
  var msgCount = $('msg-count');
  var histWrap = $('hist-wrap');
  var histList = $('hist-list');

  function api(path) {
    return (window.AIGW && window.AIGW.apiBase ? window.AIGW.apiBase() : window.location.origin) + path;
  }

  var FALLBACK_PROVIDERS = [
    { id: 'openrouter', label: 'OpenRouter', description: 'Unified gateway to 200+ models.', defaultModel: 'z-ai/glm-5.2:free', models: ['z-ai/glm-5.2:free', 'deepseek/deepseek-chat-v3-0324:free', 'meta-llama/llama-3.3-70b-instruct:free'], requiredEnvKeys: ['OPENROUTER_API_KEY'], configured: true },
    { id: 'poolside', label: 'Poolside AI', description: 'Laguna code-intelligence models.', defaultModel: 'poolside/laguna-s-2.1', models: ['poolside/laguna-s-2.1'], requiredEnvKeys: ['POOLSIDE_API_KEY'], configured: true },
    { id: 'custom', label: 'Custom (OpenAI-compatible)', description: 'Any OpenAI-compatible endpoint.', defaultModel: null, models: [], requiredEnvKeys: ['CUSTOM_BASE_URL'], configured: false }
  ];
  var PROVIDER_META = {};
  var history = [];
  var inFlight = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function chip(text, cls) {
    return '<span class="meta-chip' + (cls ? ' ' + cls : '') + '">' + escapeHtml(text) + '</span>';
  }

  function offlineBanner() {
    banner.innerHTML =
      '<div class="alert alert-warn">' +
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></svg>' +
      '<span><strong>API unreachable.</strong> The playground needs the live gateway (deployed on Cloudflare Pages, or <code class="code-inline">npm start</code> locally). Requests will still be attempted on send.</span></div>';
  }

  /* ---------- provider loading ---------- */
  function renderProviderOptions(providers, defaultProvider) {
    var options =
      '<option value="">&#9889; Auto — smart failover (recommended)</option>' +
      providers
        .map(function (p) {
          PROVIDER_META[p.id] = p;
          var state = p.configured === false ? ' — key not set' : '';
          return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.label) + ' (' + escapeHtml(p.id) + ')' + state + '</option>';
        })
        .join('');
    providerSel.innerHTML = options;

    var pre = new URLSearchParams(location.search).get('provider');
    if (pre && PROVIDER_META[pre]) providerSel.value = pre;
    else if (pre === 'auto') providerSel.value = '';
    else if (defaultProvider && PROVIDER_META[defaultProvider] && new URLSearchParams(location.search).get('auto') === '0') {
      providerSel.value = defaultProvider;
    } else {
      providerSel.value = ''; // Auto mode by default
    }
    onProviderChange();
  }

  function onProviderChange() {
    if (!providerSel.value) {
      providerHint.innerHTML =
        'The gateway tries your default provider first and <strong>automatically fails over</strong> to the next configured provider on any error — retrying until a response arrives.';
      return;
    }
    var meta = PROVIDER_META[providerSel.value] || {};
    modelList.innerHTML = (meta.models || [])
      .map(function (m) { return '<option value="' + escapeHtml(m) + '"></option>'; })
      .join('');
    var keys = (meta.requiredEnvKeys || []).join(', ');
    providerHint.innerHTML = meta.configured === false
      ? '<span style="color:var(--warn)">Needs env var(s): <code class="code-inline">' + escapeHtml(keys) + '</code> — set them on the server first. Auto-failover still covers this provider.</span>'
      : (keys ? 'Server key: <code class="code-inline">' + escapeHtml(keys) + '</code> · if this provider errors, the gateway auto-fails over to the next one.' : '');
    // Upgrade the datalist with the LIVE catalog (auto-fetched from the provider)
    fetchLiveModels(providerSel.value);
  }

  /** Fill the model datalist from GET /api/v1/models (live, respects free-only policy). */
  function fetchLiveModels(providerId) {
    if (!providerId) return;
    fetch(api('/api/v1/models?provider=' + encodeURIComponent(providerId)), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.data) || !data.data.length) return;
        var block = (data.providers || []).find(function (p) { return p.id === providerId; });
        if (!block || block.status !== 'ok') return;
        modelList.innerHTML = block.models
          .map(function (m) { return '<option value="' + escapeHtml(m.id) + '"></option>'; })
          .join('');
        if (block.freeOnly && block.totalBeforeFilter > block.total) {
          providerHint.innerHTML += ' <span class="meta-chip ok">live: ' + block.total + ' free models auto-fetched</span>';
        } else {
          providerHint.innerHTML += ' <span class="meta-chip ok">live: ' + block.total + ' models auto-fetched</span>';
        }
      })
      .catch(function () { /* static list stays */ });
  }

  providerSel.addEventListener('change', onProviderChange);

  fetch(api('/api/v1/providers'))
    .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then(function (data) {
      renderProviderOptions(data.providers && data.providers.length ? data.providers : FALLBACK_PROVIDERS, data.defaultProvider);
    })
    .catch(function (err) {
      if (err && err.message === '401') {
        banner.innerHTML =
          '<div class="alert alert-warn">' +
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
          '<span><strong>This gateway is protected with <code class="code-inline">API_SECRET_KEY</code>.</strong> Browser clients cannot authenticate, so the playground cannot send requests. Remove that env var (and redeploy) if you want the playground usable publicly.</span></div>';
      } else {
        offlineBanner();
      }
      renderProviderOptions(FALLBACK_PROVIDERS, null);
    });

  /* Show the server-side confirmed base URL (from GET /api/v1/config). */
  function revealServerBase(cfg) {
    var wrap = document.querySelector('.server-base-wrap');
    if (wrap && cfg && cfg.apiBaseUrl) wrap.style.display = '';
  }
  document.addEventListener('aigw:config', function (e) { revealServerBase(e.detail); });
  if (window.AIGW && window.AIGW.SERVER_BASE) revealServerBase({ apiBaseUrl: window.AIGW.SERVER_BASE });

  /* ---------- form wiring ---------- */
  tempInput.addEventListener('input', function () {
    tempVal.textContent = Number(tempInput.value).toFixed(1);
  });

  messageInput.addEventListener('input', function () {
    msgCount.textContent = String(messageInput.value.length);
  });

  multiturnToggle.addEventListener('change', function () {
    var on = multiturnToggle.checked;
    multiturnField.style.display = on ? '' : 'none';
    messageField.style.display = on ? 'none' : '';
    systemField.style.display = on ? 'none' : '';
  });

  /* URL prefill */
  (function prefill() {
    var params = new URLSearchParams(location.search);
    var model = params.get('model');
    var message = params.get('message');
    if (model) modelInput.value = model;
    if (message) { messageInput.value = message; msgCount.textContent = String(message.length); }
  })();

  /* ---------- request building ---------- */
  function buildBody() {
    var body = {};
    if (providerSel.value) body.provider = providerSel.value; // empty = Auto (failover)
    var model = modelInput.value.trim();
    if (model) body.model = model;
    var temp = Number(tempInput.value);
    body.temperature = temp;

    var maxTokens = parseInt(maxTokensInput.value, 10);
    if (!Number.isNaN(maxTokens) && maxTokens >= 1 && maxTokens <= 8192) body.max_tokens = maxTokens;

    if (multiturnToggle.checked) {
      var parsed = JSON.parse(messagesJson.value); // throws -> caught in submit
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('"messages" must be a non-empty JSON array.');
      }
      body.messages = parsed;
    } else {
      var msg = messageInput.value.trim();
      if (!msg) throw new Error('Please type a message first.');
      body.message = msg;
      var sys = systemInput.value.trim();
      if (sys) body.system_prompt = sys;
    }
    return body;
  }

  /* ---------- rendering ---------- */
  function renderLoading() {
    respChips.innerHTML = '';
    respArea.innerHTML =
      '<div class="pg-loading"><span class="spinner" aria-hidden="true"></span><span>Waiting for the provider' +
      (providerSel.value ? '' : 's (auto-failover active)') + '…</span></div>';
  }

  function failoverChainLine(data) {
    var f = data && data.failover;
    if (!f || !f.attempts || !f.attempts.length) return '';
    var steps = f.attempts.map(function (a) {
      return escapeHtml(a.provider) + ' <span style="color:var(--warn)">✗ ' + escapeHtml(a.code || 'error') + '</span>';
    });
    steps.push('<strong>' + escapeHtml(data.provider) + ' ✓</strong>');
    return (
      '<div class="codeblock" style="margin:14px 0 0"><div class="codeblock-head"><span>failover chain</span></div>' +
      '<pre style="white-space:normal"><code>' + steps.join(' &nbsp;&rarr;&nbsp; ') +
      '</code></pre></div>'
    );
  }

  function renderSuccess(data, latencyMs, rawJson) {
    var f = data && data.failover ? data.failover : {};
    var attemptCount = f.attempts ? f.attempts.length : 0;
    respChips.innerHTML =
      chip(data.provider || '—') +
      chip(data.model || '—') +
      chip(latencyMs + ' ms') +
      (data.usage && data.usage.total_tokens ? chip(data.usage.total_tokens + ' tokens') : '') +
      (attemptCount > 0 ? chip('failover: ' + attemptCount + ' failed attempt' + (attemptCount > 1 ? 's' : ''), 'warn') : '') +
      chip('200 OK', 'ok');

    var reply = document.createElement('div');
    reply.className = 'resp-body';
    reply.textContent = data.reply || '(empty reply)';

    respArea.innerHTML = '';
    respArea.appendChild(reply);
    respArea.insertAdjacentHTML('beforeend', failoverChainLine(data));

    var raw = document.createElement('details');
    raw.style.marginTop = '14px';
    raw.innerHTML =
      '<summary style="cursor:pointer;color:var(--muted);font-size:.88rem">Show raw JSON</summary>' +
      '<div class="codeblock" style="margin-bottom:0"><div class="codeblock-head"><span>raw response</span>' +
      '<button class="copy-btn" type="button">Copy</button></div><pre><code>' +
      escapeHtml(rawJson) + '</code></pre></div>';
    respArea.appendChild(raw);
  }

  function renderError(payload, status) {
    var err = (payload && payload.error) || {};
    var attempts = (err.details && err.details.attempts) || [];
    respChips.innerHTML = chip(String(status), 'err') + chip(err.code || 'UNKNOWN');

    var lines = [
      'HTTP ' + status + '  ' + (err.code || 'UNKNOWN_ERROR'),
      '',
      err.message || 'Request failed without a message.'
    ];
    if (attempts.length) {
      lines.push('');
      lines.push('failover attempts:');
      attempts.forEach(function (a, i) {
        lines.push('  ' + (i + 1) + '. ' + a.provider + ' — ' + (a.code || a.reason || 'error') + (a.message ? ' (' + a.message + ')' : ''));
      });
    }
    if (err.details && err.details.chain) {
      lines.push('');
      lines.push('chain: ' + err.details.chain.join(' → '));
    }
    if (err.code === 'PROVIDER_NOT_CONFIGURED' || err.code === 'UPSTREAM_AUTH_ERROR') {
      lines.push('');
      lines.push('Fix: set the provider env var(s) on the server — see /custom-provider/.');
    }
    var block = document.createElement('div');
    block.className = 'resp-err-block';
    block.textContent = lines.join('\n');
    respArea.innerHTML = '';
    respArea.appendChild(block);
  }

  function renderLocalError(message) {
    respChips.innerHTML = '';
    var block = document.createElement('div');
    block.className = 'resp-err-block';
    block.textContent = message;
    respArea.innerHTML = '';
    respArea.appendChild(block);
  }

  /* ---------- history ---------- */
  function pushHistory(entry) {
    history.unshift(entry);
    history = history.slice(0, 8);
    renderHistory();
  }

  function renderHistory() {
    if (!history.length) { histWrap.style.display = 'none'; return; }
    histWrap.style.display = '';
    histList.innerHTML = history
      .map(function (h, i) {
        var head =
          '<span class="meta-chip">' + escapeHtml(h.provider) + '</span>' +
          (h.ok ? chip(h.latencyMs + ' ms') : chip('error', 'err')) +
          '<span class="hist-msg">' + escapeHtml(h.preview) + '</span>' +
          '<span class="small muted mono">' + escapeHtml(h.time) + '</span>';
        var body =
          '<div class="' + (h.ok ? 'resp-body' : 'resp-err-block') + '">' + escapeHtml(h.detail) + '</div>';
        return '<div class="hist-item" data-i="' + i + '"><div class="hist-head" role="button" tabindex="0">' + head + '</div><div class="hist-body">' + body + '</div></div>';
      })
      .join('');
  }

  histList.addEventListener('click', function (event) {
    var head = event.target.closest('.hist-head');
    if (head) head.parentElement.classList.toggle('open');
  });
  histList.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var head = event.target.closest('.hist-head');
    if (head) { event.preventDefault(); head.parentElement.classList.toggle('open'); }
  });
  $('hist-clear').addEventListener('click', function () {
    history = [];
    renderHistory();
  });

  /* ---------- submit ---------- */
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (inFlight) return;

    var body;
    try {
      body = buildBody();
    } catch (buildErr) {
      renderLocalError(buildErr.message);
      return;
    }

    inFlight = true;
    sendBtn.disabled = true;
    sendLabel.textContent = 'Sending…';
    renderLoading();

    var started = Date.now();
    fetch(api('/api/v1/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        var latencyMs = Date.now() - started;
        return res
          .json()
          .catch(function () { return { success: false, error: { code: 'BAD_RESPONSE', message: 'Non-JSON response from gateway.' } }; })
          .then(function (payload) { return { status: res.status, payload: payload, latencyMs: latencyMs }; });
      })
      .then(function (result) {
        var rawJson = JSON.stringify(result.payload, null, 2);
        if (result.payload && result.payload.success) {
          renderSuccess(result.payload, result.latencyMs, rawJson);
          var served = result.payload.provider || body.provider || 'auto';
          pushHistory({
            provider: served, ok: true, latencyMs: result.latencyMs,
            preview: body.messages ? '[multi-turn: ' + body.messages.length + ' turns]' : body.message,
            detail: result.payload.reply || '', time: new Date().toLocaleTimeString(),
          });
        } else {
          renderError(result.payload, result.status);
          var err = result.payload && result.payload.error ? result.payload.error : {};
          pushHistory({
            provider: body.provider || 'auto', ok: false, latencyMs: result.latencyMs,
            preview: body.messages ? '[multi-turn]' : body.message,
            detail: 'HTTP ' + result.status + ' ' + (err.code || '') + '\n' + (err.message || ''), time: new Date().toLocaleTimeString(),
          });
        }
      })
      .catch(function (netErr) {
        renderLocalError(
          'Network error: could not reach the gateway at ' + api('/api/v1/chat') + '\n\n' + netErr.message +
          '\n\nDeploy the project first (see the Integration Guide) or run `npm start` locally and open the playground there.'
        );
      })
      .finally(function () {
        inFlight = false;
        sendBtn.disabled = false;
        sendLabel.textContent = 'Send request';
      });
  });

  document.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !inFlight) {
      form.requestSubmit();
    }
  });
})();
