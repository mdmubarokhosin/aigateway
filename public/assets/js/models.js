/**
 * Models page — renders the LIVE catalog from GET /api/v1/models.
 *
 * The endpoint auto-fetches every provider's own /models catalog:
 *   - openrouter  : only ":free" models
 *   - opencodezen : only "-free" models
 *   - others      : full catalog
 * Search + provider filter chips + refresh (?refresh=1) + copy buttons.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var contentEl = $('models-content');
  var metaEl = $('models-meta-cache');
  var chipsEl = $('provider-chips');
  var alertEl = $('models-alert');
  var searchEl = $('models-search');
  var refreshBtn = $('models-refresh');

  var payload = null; // full response from /api/v1/models
  var activeProvider = ''; // '' = all

  function api(path) {
    return (window.AIGW && window.AIGW.apiBase ? window.AIGW.apiBase() : window.location.origin) + path;
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function orderProviders(blocks) {
    var meta = (window.AIGW && window.AIGW.PROVIDERS_META) || {};
    var order = Array.isArray(meta.order) ? meta.order : [];
    var rank = function (id) {
      var i = order.indexOf(id);
      return i === -1 ? order.length + 99 : i;
    };
    return blocks.slice().sort(function (a, b) { return rank(a.id) - rank(b.id); });
  }

  function renderChips() {
    if (!payload) return;
    var counts = {};
    payload.providers.forEach(function (p) { counts[p.id] = p.total; });
    var chips =
      '<button class="chip-btn' + (activeProvider === '' ? ' active' : '') + '" data-p="">All providers (' + payload.total + ')</button>' +
      orderProviders(payload.providers)
        .map(function (p) {
          return (
            '<button class="chip-btn' + (activeProvider === p.id ? ' active' : '') + '" data-p="' + esc(p.id) + '">' +
            esc(p.label) + ' (' + p.total + ')' +
            '</button>'
          );
        })
        .join('');
    chipsEl.innerHTML = chips;
  }

  function taglineFor(id) {
    var meta = (window.AIGW && window.AIGW.PROVIDERS_META) || {};
    if (meta.providers && meta.providers[id] && meta.providers[id].tagline) {
      return meta.providers[id].tagline;
    }
    return meta.taglines && meta.taglines[id] ? meta.taglines[id] : '';
  }

  function render() {
    if (!payload) return;
    renderChips();

    var q = (searchEl.value || '').trim().toLowerCase();
    var blocks = orderProviders(payload.providers).filter(function (p) {
      return !activeProvider || p.id === activeProvider;
    });

    if (!blocks.length) {
      contentEl.innerHTML = '<div class="alert alert-warn">No provider matches this filter.</div>';
      return;
    }

    var html = '';
    blocks.forEach(function (p) {
      var models = p.models.filter(function (m) {
        return !q || m.id.toLowerCase().indexOf(q) !== -1 || (m.owned_by || '').toLowerCase().indexOf(q) !== -1;
      });

      html += '<section class="model-group">';
      html += '<div class="model-group-head">';
      html += '<h3>' + esc(p.label) + '</h3>';
      html += '<code class="code-inline">' + esc(p.id) + '</code>';
      if (p.freeOnly) html += '<span class="badge free">free tier only</span>';
      else html += '<span class="badge info">full catalog</span>';
      if (p.status === 'error') html += '<span class="badge err">fetch error</span>';
      html += '</div>';
      html += '<p class="model-group-sub">' + esc(taglineFor(p.id)) + (p.freeOnly ? '' : '') + '</p>';

      if (p.status === 'error') {
        html +=
          '<div class="alert alert-warn"><strong>Could not fetch this provider\'s catalog.</strong> ' +
          esc(p.error && p.error.code ? p.error.code : '') + ' — ' + esc(p.error && p.error.message ? p.error.message : '') +
          ' Chat may still work; check the <a href="/status/">status page</a>.</div>';
      } else if (!models.length) {
        html += '<div class="alert alert-warn">' +
          (q ? 'No models match “' + esc(q) + '” in this provider.' : 'No models available right now.') +
          (p.freeOnly ? ' This provider lists free models only — the upstream currently exposes none.' : '') +
          '</div>';
      } else {
        html += '<div class="models-grid">';
        models.forEach(function (m) {
          html +=
            '<div class="model-card">' +
            '<span class="model-id" title="' + esc(m.id) + '">' + esc(m.id) + '</span>' +
            (m.free ? '<span class="badge free">free</span>' : '') +
            '<button class="copy-model" type="button" data-model="' + esc(m.id) + '" title="Copy model id" aria-label="Copy model id">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
            '</button></div>';
        });
        html += '</div>';
        if (p.freeOnly && p.totalBeforeFilter > p.total) {
          html += '<p class="small muted" style="margin-top:8px">Showing ' + p.total + ' free models (filtered out ' + (p.totalBeforeFilter - p.total) + ' paid models).</p>';
        }
      }
      html += '</section>';
    });

    contentEl.innerHTML = html;
  }

  function renderMeta(data) {
    var cache = data.cache || {};
    var parts = [];
    parts.push('<strong>' + data.total + '</strong> models from ' + payload.providers.length + ' provider(s)');
    if (cache.updatedAt) {
      parts.push('updated ' + new Date(cache.updatedAt).toLocaleTimeString());
    }
    if (cache.ttlMs) {
      var mins = Math.round(cache.ttlMs / 60000);
      parts.push('cache TTL ' + (mins >= 60 ? Math.round(mins / 60) + ' h' : mins + ' min') + ' (MODELS_CACHE_TTL_MS)');
    }
    parts.push('policy: openrouter + opencodezen → free only · others → all models');
    metaEl.innerHTML = parts.map(function (p) { return '<span>' + p + '</span>'; }).join(' · ');
  }

  function load(refresh) {
    refreshBtn.disabled = true;
    if (refresh) {
      contentEl.innerHTML =
        '<div class="pg-loading" style="padding:34px 0"><span class="spinner" aria-hidden="true"></span><span>Re-fetching catalogs from every provider…</span></div>';
    }
    fetch(api('/api/v1/models') + (refresh ? '?refresh=1' : ''), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        payload = data;
        render();
        renderMeta(data);
        alertEl.innerHTML = '';
      })
      .catch(function (err) {
        contentEl.innerHTML = '';
        alertEl.innerHTML =
          '<div class="alert alert-err" style="margin-top:14px"><strong>Could not load the model catalog.</strong> ' +
          esc(err && err.message ? err.message : 'Network error') +
          ' — the gateway may be offline or protected with API_SECRET_KEY. Check the <a href="/status/">status page</a>.</div>';
        metaEl.textContent = 'unavailable';
      })
      .finally(function () {
        refreshBtn.disabled = false;
      });
  }

  chipsEl.addEventListener('click', function (event) {
    var btn = event.target.closest('.chip-btn');
    if (!btn) return;
    activeProvider = btn.getAttribute('data-p') || '';
    render();
  });

  searchEl.addEventListener('input', function () {
    // debounce
    clearTimeout(searchEl._t);
    searchEl._t = setTimeout(render, 160);
  });

  refreshBtn.addEventListener('click', function () { load(true); });

  contentEl.addEventListener('click', function (event) {
    var btn = event.target.closest('.copy-model');
    if (!btn) return;
    var id = btn.getAttribute('data-model');
    var done = function () {
      var old = btn.innerHTML;
      btn.innerHTML = '<span style="color:var(--ok);font-size:.72rem;font-weight:700">COPIED</span>';
      setTimeout(function () { btn.innerHTML = old; }, 1100);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(id).then(done, done);
    } else {
      done();
    }
  });

  load(false);
})();
