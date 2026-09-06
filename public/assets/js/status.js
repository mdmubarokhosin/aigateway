/**
 * Live status monitoring:
 *  - auto-detects the API base URL (window.AIGW.apiBase()) and shows it
 *  - loads GET /api/v1/config -> base URL, failover mode, default provider
 *  - polls GET /api/v1/health every 10 s (toggleable) -> banner, tiles, sparkline
 *  - loads GET /api/v1/providers -> provider cards with live "Test" buttons
 *  - Test sends POST /api/v1/chat {message:"Reply with the single word OK",
 *    max_tokens: 8, temperature: 0.2, failover: false} — failover is DISABLED
 *    for the per-provider probe so the result reflects THAT provider only.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var banner = $('status-banner');
  var bannerTitle = $('status-title');
  var bannerSub = $('status-sub');
  var statLatency = $('stat-latency');
  var statAvg = $('stat-avg');
  var statChecks = $('stat-checks');
  var statVersion = $('stat-version');
  var spark = $('spark');
  var sparkNote = $('spark-wrap').nextElementSibling;
  var sparkUpdated = $('spark-updated');
  var autoBox = $('auto-refresh');
  var refreshBtn = $('refresh-now');
  var grid = $('providers-grid');

  var latencies = [];      // last 40 health latencies (null on failure)
  var checks = 0;
  var timer = null;
  var POLL_MS = 10000;

  function api(path) {
    return (window.AIGW && window.AIGW.apiBase ? window.AIGW.apiBase() : window.location.origin) + path;
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------------- runtime config (base URL, failover) ---------------- */
  function loadConfig() {
    var failoverEl = $('status-failover');
    var defaultEl = $('status-default-provider');
    fetch(api('/api/v1/config'), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (cfg) {
        if (failoverEl) {
          var on = cfg.failover && cfg.failover.enabled;
          var rounds = cfg.failover && cfg.failover.maxRounds ? cfg.failover.maxRounds : 3;
          failoverEl.textContent = on ? 'ON · up to ' + rounds + ' rounds' : 'OFF';
          failoverEl.className = 'meta-chip ' + (on ? 'ok' : '');
        }
        if (defaultEl && cfg.defaultProvider) defaultEl.textContent = cfg.defaultProvider;
        if (cfg.version) statVersion.textContent = 'v' + String(cfg.version).replace(/^v/i, '');
      })
      .catch(function () {
        if (failoverEl) { failoverEl.textContent = 'unknown (API offline)'; failoverEl.className = 'meta-chip'; }
      });
  }

  /* ---------------- health polling ---------------- */
  function setBanner(state, title, sub) {
    banner.classList.remove('ok', 'warn', 'err');
    banner.classList.add(state);
    bannerTitle.textContent = title;
    bannerSub.textContent = sub;
  }

  function drawSpark() {
    if (latencies.length < 2) {
      if (sparkNote) sparkNote.style.display = '';
      spark.innerHTML = '';
      return;
    }
    if (sparkNote) sparkNote.style.display = 'none';

    var w = 600, h = 130, pad = 8;
    var valid = latencies.filter(function (v) { return v !== null; });
    var max = Math.max.apply(null, valid.concat([50])) * 1.15;
    var stepX = (w - pad * 2) / (latencies.length - 1);

    var points = latencies.map(function (v, i) {
      var x = pad + i * stepX;
      var y = v === null ? h - pad : h - pad - (v / max) * (h - pad * 2);
      return { x: x, y: y, v: v };
    });

    var line = points.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var area = pad + ',' + (h - pad) + ' ' + line + ' ' + (w - pad) + ',' + (h - pad);
    var avg = Math.round(valid.reduce(function (a, b) { return a + b; }, 0) / valid.length);
    var avgY = h - pad - (avg / max) * (h - pad * 2);

    spark.innerHTML =
      '<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="var(--primary)" stop-opacity=".28"/>' +
      '<stop offset="1" stop-color="var(--primary)" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<polygon points="' + area + '" fill="url(#sg)"/>' +
      '<line x1="' + pad + '" x2="' + (w - pad) + '" y1="' + avgY.toFixed(1) + '" y2="' + avgY.toFixed(1) +
      '" stroke="var(--muted)" stroke-dasharray="5 6" stroke-width="1" opacity=".55"/>' +
      '<polyline points="' + line + '" fill="none" stroke="var(--primary)" stroke-width="2.4" ' +
      'stroke-linejoin="round" stroke-linecap="round"/>' +
      points.slice(-1).map(function (p) {
        return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4.5" fill="var(--primary)"/>';
      }).join('');
  }

  function checkHealth() {
    var started = Date.now();
    bannerSub.textContent = 'GET /api/v1/health — checking…';

    fetch(api('/api/v1/health'), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var ms = Date.now() - started;
        checks += 1;
        latencies.push(ms);
        if (latencies.length > 40) latencies.shift();

        setBanner('ok', 'All systems operational', 'GET /api/v1/health · 200 OK · ' + ms + ' ms · ' + new Date().toLocaleTimeString());
        statLatency.textContent = ms + ' ms';
        statLatency.classList.add('ok');
        var valid = latencies.filter(function (v) { return v !== null; });
        statAvg.textContent = Math.round(valid.reduce(function (a, b) { return a + b; }, 0) / valid.length) + ' ms';
        statChecks.textContent = String(checks);
        if (data.version) statVersion.textContent = 'v' + data.version;
        sparkUpdated.textContent = 'updated ' + new Date().toLocaleTimeString();
        drawSpark();
      })
      .catch(function () {
        checks += 1;
        latencies.push(null);
        if (latencies.length > 40) latencies.shift();
        setBanner('err', 'Gateway unreachable', 'GET /api/v1/health failed at ' + new Date().toLocaleTimeString());
        statLatency.textContent = '—';
        statLatency.classList.remove('ok');
        statChecks.textContent = String(checks);
        drawSpark();
      });
  }

  function startAuto() {
    if (timer) clearInterval(timer);
    timer = setInterval(checkHealth, POLL_MS);
  }

  autoBox.addEventListener('change', function () {
    if (autoBox.checked) { checkHealth(); startAuto(); }
    else if (timer) { clearInterval(timer); timer = null; }
  });

  refreshBtn.addEventListener('click', function () {
    checkHealth();
    loadProviders();
  });

  /* ---------------- providers ---------------- */
  function testResultLine(ok, text) {
    return '<div class="test-result ' + (ok ? 'ok' : 'err') + '">' + escapeHtml(text) + '</div>';
  }

  function loadProviders() {
    fetch(api('/api/v1/providers'), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('offline'); return r.json(); })
      .then(function (data) { renderProviders(data.providers || []); })
      .catch(function () {
        grid.innerHTML =
          '<div class="card"><p class="muted small">Provider list unavailable — the API is offline. Deploy the gateway or run <code class="code-inline">npm start</code>, then refresh.</p></div>';
      });
  }

  function renderProviders(providers) {
    if (!providers.length) {
      grid.innerHTML = '<div class="card"><p class="muted small">No providers reported.</p></div>';
      return;
    }
    grid.innerHTML = providers
      .map(function (p) {
        var configuredBadge = p.configured
          ? '<span class="meta-chip ok">configured</span>'
          : '<span class="meta-chip">key not set</span>';
        var model = p.defaultModel
          ? '<span class="provider-model">' + escapeHtml(p.defaultModel) + '</span>'
          : '<span class="provider-model">via CUSTOM_MODEL env / request</span>';
        var testBtn = p.configured
          ? '<button class="btn btn-primary btn-sm" type="button" data-test="' + escapeHtml(p.id) + '">Test provider</button>'
          : '<button class="btn btn-ghost btn-sm" type="button" disabled title="Set the env var(s) first">Test unavailable</button>';
        return (
          '<div class="card provider-card">' +
          '<div class="provider-head"><span class="provider-name">' + escapeHtml(p.label) + '</span>' + configuredBadge + '</div>' +
          '<span class="provider-id">id: ' + escapeHtml(p.id) + '</span>' +
          '<p class="provider-desc">' + escapeHtml(p.description || '') + '</p>' +
          model +
          '<div class="test-slot" id="test-' + escapeHtml(p.id) + '" style="display:none"></div>' +
          '<div style="display:flex;align-items:center;gap:10px;margin-top:4px">' + testBtn +
          '<a class="small" href="/playground/?provider=' + encodeURIComponent(p.id) + '">Open in Playground →</a></div>' +
          '</div>'
        );
      })
      .join('');
  }

  grid.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-test]');
    if (!btn || btn.disabled) return;
    var id = btn.getAttribute('data-test');
    var slot = document.getElementById('test-' + id);
    btn.disabled = true;
    var original = btn.textContent;
    btn.textContent = 'Testing…';
    if (slot) { slot.style.display = ''; slot.innerHTML = '<div class="test-result ok" style="background:var(--surface-2);border-color:var(--border)">sending test request…</div>'; }

    var started = Date.now();
    fetch(api('/api/v1/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: id,
        failover: false, // probe THIS provider only — no automatic fallback
        message: 'Reply with the single word: OK',
        max_tokens: 8,
        temperature: 0.2,
      }),
    })
      .then(function (res) {
        var ms = Date.now() - started;
        return res
          .json()
          .catch(function () { return { success: false, error: { code: 'BAD_RESPONSE', message: 'non-JSON reply' } }; })
          .then(function (data) { return { data: data, ms: ms }; });
      })
      .then(function (r) {
        if (r.data && r.data.success) {
          slot.innerHTML = testResultLine(true, '✓ ' + r.ms + ' ms — reply: "' + String(r.data.reply || '').slice(0, 60) + '"');
        } else {
          var err = (r.data && r.data.error) || {};
          var hint = '';
          if (err.code === 'UPSTREAM_RATE_LIMIT') hint = ' (provider busy — the chain works, retry shortly)';
          if (err.code === 'UPSTREAM_AUTH_ERROR') hint = ' (check the provider key on the server)';
          if (err.code === 'UPSTREAM_CREDITS_EXHAUSTED') hint = ' (top up the provider account)';
          slot.innerHTML = testResultLine(false, '✗ HTTP ' + (r.data && r.data.error ? '' : '?') + err.code + ': ' + (err.message || 'failed') + hint);
        }
      })
      .catch(function (netErr) {
        slot.innerHTML = testResultLine(false, '✗ network error: ' + netErr.message);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = original;
      });
  });

  /* ---------------- boot ---------------- */
  checkHealth();
  startAuto();
  loadProviders();
  loadConfig();
})();
