/**
 * ADMIN PANEL — GitHub-backed configuration manager with FULL CRUD.
 *
 * Flow:
 *   1. Owner signs in with (a) repo name, (b) branch, (c) fine-grained GitHub
 *      PAT with "Contents: Read and write" on that ONE repository.
 *   2. The panel LOADS config/site.json + config/providers.json +
 *      config/knowledge.json FROM the repo via the GitHub Contents API
 *      (everything the panel shows comes from the GitHub repo — the single
 *      source of truth).
 *   3. Every SAVE commits the updated file straight back to the repo via the
 *      same API (PUT /contents with the file sha). Cloudflare Pages detects
 *      the push, re-runs `npm run build` (which regenerates the backend
 *      provider registry from providers.json) and redeploys automatically.
 *
 * CRUD surfaces (all client-side until committed):
 *   - AI Providers : add / edit / delete / reorder providers (id, label,
 *                    baseUrl, key env name, default model, free-only policy,
 *                    public-catalog policy, enabled…)
 *   - AI Models    : per-provider curated model list (add / edit / delete /
 *                    mark default) merged into the live catalog
 *   - Knowledge    : chatbot + Telegram bot knowledge entries (markdown)
 *   - Site         : branding, announcement banner, chatbot settings
 *   - Raw JSON     : power-user direct editing of all three files
 *
 * Security model:
 *   - The token lives in sessionStorage (this browser tab ONLY, gone on close).
 *   - The token is sent ONLY to https://api.github.com — never to the gateway.
 *   - Provider API keys are NOT editable here (they are Cloudflare env secrets).
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function t(key) {
    return window.I18N ? window.I18N.t(key) : key;
  }

  var state = {
    token: '',
    repo: '', // owner/name
    branch: 'main',
    user: null,
    site: null,
    providers: null,
    knowledge: null,
    siteSha: null,
    providersSha: null,
    knowledgeSha: null,
    providerOrder: [],
    // local-edit state
    editingProviderId: null, // string = editing, undefined/'__new__' = new
    editingModelIndex: -1,
    editingKnowledgeIndex: -1,
    modelsSelectedProvider: '',
  };

  var DEFAULT_SITE = {
    appName: 'AI Gateway API',
    tagline: 'One AI API. Every provider.',
    description: '',
    announcement: { enabled: false, text: '', link: '', linkLabel: 'Learn more' },
    chatbot: { enabled: true, name: 'Gateway Assistant', welcome: 'Hi! Ask me anything about this API.', quickQuestions: [], temperature: 0.3, maxTokens: 900 },
  };
  var DEFAULT_PROVIDERS = { version: 2, order: [], hidden: [], providers: {} };
  var DEFAULT_KNOWLEDGE = { version: 1, entries: [] };

  /* ---------------- helpers ---------------- */

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(message, isError) {
    var toastEl = $('toast');
    toastEl.textContent = message;
    toastEl.classList.toggle('err', Boolean(isError));
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 4200);
  }

  function alertBox(targetId, html, kind) {
    var el = $(targetId);
    if (!html) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="alert ' + (kind === 'err' ? 'alert-err' : 'alert-warn') + '">' + html + '</div>';
  }

  function parseRepo(input) {
    var raw = String(input || '').trim();
    if (!raw) return '';
    raw = raw.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    var m = raw.match(/^([\w.-]+)\/([\w.-]+)$/);
    return m ? m[1] + '/' + m[2] : '';
  }

  function gh(path, options) {
    options = options || {};
    return fetch('https://api.github.com' + path, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + state.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          var msg = (data && data.message) || 'HTTP ' + res.status;
          if (res.status === 401) msg = 'Bad credentials — the token is invalid or expired. (GitHub said: ' + msg + ')';
          if (res.status === 403 && String(res.headers.get('X-RateLimit-Remaining')) === '0') msg = 'GitHub API rate limit exhausted for this token. Try again later.';
          var err = new Error(msg);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function b64encode(str) {
    // UTF-8 safe base64
    return btoa(unescape(encodeURIComponent(str)));
  }

  function b64decode(b64) {
    try {
      return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
    } catch (e) {
      return '';
    }
  }

  function getFile(path) {
    return gh('/repos/' + state.repo + '/contents/' + path + '?ref=' + encodeURIComponent(state.branch))
      .then(function (data) {
        return { sha: data.sha, content: b64decode(data.content || ''), exists: true };
      })
      .catch(function (err) {
        if (err.status === 404) return { sha: null, content: '', exists: false };
        throw err;
      });
  }

  function commitFile(path, content, sha, message) {
    var body = { message: message, content: b64encode(content), branch: state.branch };
    if (sha) body.sha = sha;
    return gh('/repos/' + state.repo + '/contents/' + path, { method: 'PUT', body: body });
  }

  /* ---------------- connect / disconnect ---------------- */

  function connect() {
    var repo = parseRepo($('gh-repo').value);
    var branch = ($('gh-branch').value || 'main').trim();
    var token = $('gh-token').value.trim();

    if (!repo) {
      alertBox('connect-alert', t('admin.errRepo'), 'err');
      return;
    }
    if (!token) {
      alertBox('connect-alert', t('admin.errToken'), 'err');
      return;
    }

    state.token = token;
    state.repo = repo;
    state.branch = branch;

    var btn = $('connect-btn');
    btn.disabled = true;
    btn.textContent = '…';
    alertBox('connect-alert', '');

    Promise.all([
      gh('/repos/' + repo),
      gh('/user').catch(function () { return null; }),
    ])
      .then(function (results) {
        state.user = results[1];
        try {
          sessionStorage.setItem('aigw-admin', JSON.stringify({ repo: repo, branch: branch, token: token }));
        } catch (e) { /* ignore */ }
        alertBox('connect-alert', '');
        enterDashboard();
      })
      .catch(function (err) {
        var hint = err.status === 404 ? t('admin.errRepo404') : err.message;
        alertBox('connect-alert', '<strong>' + esc(t('admin.connectFailed')) + '</strong> ' + esc(hint), 'err');
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = t('admin.connect.cta');
      });
  }

  function disconnect() {
    state.token = '';
    state.site = null;
    state.providers = null;
    state.knowledge = null;
    try { sessionStorage.removeItem('aigw-admin'); } catch (e) { /* ignore */ }
    $('dashboard').style.display = 'none';
    $('connect-card').style.display = '';
    $('gh-token').value = '';
  }

  /* ---------------- dashboard ---------------- */

  function enterDashboard() {
    $('connect-card').style.display = 'none';
    $('dashboard').style.display = '';
    $('st-repo').textContent = state.repo;
    $('st-branch').textContent = 'branch: ' + state.branch;
    $('st-user').textContent = state.user && state.user.login ? '@' + state.user.login : '';
    $('st-open-repo').href = 'https://github.com/' + state.repo + '/tree/' + encodeURIComponent(state.branch);
    loadAllFiles();
  }

  function loadAllFiles() {
    alertBox('admin-alert', '');

    getFile('config/site.json')
      .then(function (f) {
        state.siteSha = f.sha;
        state.site = f.exists ? JSON.parse(f.content) : null;
        if (!state.site) {
          state.site = JSON.parse(JSON.stringify(DEFAULT_SITE));
          toast(t('admin.createdSite'));
        }
        fillSiteForm();
        syncRawEditors();
      })
      .catch(function (err) {
        alertBox('admin-alert', '<strong>config/site.json:</strong> ' + esc(err.message), 'err');
        state.site = JSON.parse(JSON.stringify(DEFAULT_SITE));
        fillSiteForm();
      });

    getFile('config/providers.json')
      .then(function (f) {
        state.providersSha = f.sha;
        state.providers = f.exists ? JSON.parse(f.content) : null;
        if (!state.providers) {
          state.providers = JSON.parse(JSON.stringify(DEFAULT_PROVIDERS));
          toast(t('admin.createdProviders'));
        }
        migrateProviders();
        fillProvidersCrud();
        syncRawEditors();
      })
      .catch(function (err) {
        alertBox('admin-alert', '<strong>config/providers.json:</strong> ' + esc(err.message), 'err');
        state.providers = JSON.parse(JSON.stringify(DEFAULT_PROVIDERS));
        migrateProviders();
        fillProvidersCrud();
      });

    getFile('config/knowledge.json')
      .then(function (f) {
        state.knowledgeSha = f.sha;
        state.knowledge = f.exists ? JSON.parse(f.content) : null;
        if (!state.knowledge) {
          state.knowledge = JSON.parse(JSON.stringify(DEFAULT_KNOWLEDGE));
          toast(t('admin.createdKnowledge'));
        }
        if (!Array.isArray(state.knowledge.entries)) state.knowledge.entries = [];
        fillKnowledgeCrud();
        syncRawEditors();
      })
      .catch(function (err) {
        alertBox('admin-alert', '<strong>config/knowledge.json:</strong> ' + esc(err.message), 'err');
        state.knowledge = JSON.parse(JSON.stringify(DEFAULT_KNOWLEDGE));
        fillKnowledgeCrud();
      });

    loadActivity();
  }

  /** Support the legacy {order, hidden, taglines} shape. */
  function migrateProviders() {
    var p = state.providers;
    if (!p || typeof p !== 'object') p = {};
    if (!p.providers || typeof p.providers !== 'object') p.providers = {};
    if (!Array.isArray(p.order)) p.order = Object.keys(p.providers);
    // Migrate legacy taglines into provider objects.
    if (p.taglines && typeof p.taglines === 'object') {
      Object.keys(p.taglines).forEach(function (id) {
        if (p.providers[id] && !p.providers[id].tagline) p.providers[id].tagline = p.taglines[id];
      });
      delete p.taglines;
    }
    // Migrate legacy hidden list.
    if (Array.isArray(p.hidden) && p.hidden.length) {
      p.hidden.forEach(function (id) {
        if (p.providers[id]) p.providers[id].hidden = true;
      });
      p.hidden = [];
    }
    p.version = 2;
    state.providers = p;
    state.providerOrder = p.order.slice();
  }

  function loadActivity() {
    var list = $('commit-list');
    gh('/repos/' + state.repo + '/commits?sha=' + encodeURIComponent(state.branch) + '&path=config&per_page=12')
      .then(function (commits) {
        if (!Array.isArray(commits) || !commits.length) {
          list.innerHTML = '<p class="small muted">' + esc(t('admin.noCommits')) + '</p>';
          return;
        }
        list.innerHTML = commits
          .map(function (commit) {
            var date = commit.commit && commit.commit.author ? new Date(commit.commit.author.date).toLocaleString() : '';
            return (
              '<div class="commit-item">' +
              '<span class="commit-sha">' + esc((commit.sha || '').slice(0, 7)) + '</span>' +
              '<span class="commit-msg">' + esc(commit.commit && commit.commit.message ? commit.commit.message.split('\n')[0] : '') + '</span>' +
              '<span class="commit-date">' + esc(date) + '</span>' +
              '</div>'
            );
          })
          .join('');
      })
      .catch(function (err) {
        list.innerHTML = '<p class="small muted">' + esc(t('admin.commitsError')) + ' ' + esc(err.message) + '</p>';
      });
  }

  /* ---------------- site form ---------------- */

  function fillSiteForm() {
    var s = state.site;
    var ann = s.announcement || {};
    var bot = s.chatbot || {};
    $('site-appname').value = s.appName || '';
    $('site-tagline').value = s.tagline || '';
    $('site-description').value = s.description || '';
    $('site-ann-enabled').checked = Boolean(ann.enabled);
    $('site-ann-text').value = ann.text || '';
    $('site-ann-link').value = ann.link || '';
    $('site-ann-label').value = ann.linkLabel || 'Learn more';
    $('bot-enabled').checked = bot.enabled !== false;
    $('bot-name').value = bot.name || 'Gateway Assistant';
    $('bot-welcome').value = bot.welcome || '';
    $('bot-quick').value = Array.isArray(bot.quickQuestions) ? bot.quickQuestions.join('\n') : '';
    $('bot-temp').value = typeof bot.temperature === 'number' ? bot.temperature : 0.3;
    $('bot-maxtokens').value = typeof bot.maxTokens === 'number' ? bot.maxTokens : 900;
    markDirty('site', false);
  }

  function collectSite() {
    var quick = $('bot-quick').value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 6);
    var temp = Number($('bot-temp').value);
    var maxTokens = parseInt($('bot-maxtokens').value, 10);
    if (Number.isNaN(temp) || temp < 0 || temp > 2) throw new Error(t('admin.errTemp'));
    if (Number.isNaN(maxTokens) || maxTokens < 100 || maxTokens > 4096) throw new Error(t('admin.errMaxTokens'));
    return {
      appName: ($('site-appname').value || '').trim() || 'AI Gateway API',
      tagline: ($('site-tagline').value || '').trim(),
      description: ($('site-description').value || '').trim(),
      announcement: {
        enabled: $('site-ann-enabled').checked,
        text: ($('site-ann-text').value || '').trim(),
        link: ($('site-ann-link').value || '').trim(),
        linkLabel: ($('site-ann-label').value || '').trim() || 'Learn more',
      },
      chatbot: {
        enabled: $('bot-enabled').checked,
        name: ($('bot-name').value || '').trim() || 'Gateway Assistant',
        welcome: ($('bot-welcome').value || '').trim(),
        quickQuestions: quick,
        temperature: temp,
        maxTokens: maxTokens,
      },
    };
  }

  function saveSite() {
    var json;
    try { json = collectSite(); } catch (err) { toast(err.message, true); return; }
    var pretty = JSON.stringify(json, null, 2) + '\n';
    setSaving('save-site', true);
    commitFile('config/site.json', pretty, state.siteSha, 'chore(admin): update site config (site.json)')
      .then(function (res) {
        state.siteSha = res && res.content ? res.content.sha : state.siteSha;
        state.site = JSON.parse(pretty);
        syncRawEditors();
        markDirty('site', false);
        toast(t('admin.committed'));
        loadActivity();
      })
      .catch(function (err) {
        toast(t('admin.commitFailed') + ' ' + err.message, true);
      })
      .finally(function () { setSaving('save-site', false); });
  }

  /* ================= PROVIDERS CRUD ================= */

  function providerById(id) {
    return (state.providers.providers || {})[id] || null;
  }

  function fillProvidersCrud() {
    renderProviderCrudList();
    fillModelsProviderSelect();
    markDirty('providers', false);
    markDirty('models', false);
  }

  function renderProviderCrudList() {
    var wrap = $('provider-crud-list');
    var ids = state.providerOrder.filter(function (id) { return providerById(id); });
    Object.keys(state.providers.providers || {}).forEach(function (id) {
      if (ids.indexOf(id) === -1) ids.push(id);
    });

    if (!ids.length) {
      wrap.innerHTML = '<p class="small muted">' + esc(t('admin.providers.none')) + '</p>';
      return;
    }

    wrap.innerHTML = ids
      .map(function (id, index) {
        var p = providerById(id) || {};
        var badges = [];
        if (p.enabled === false) badges.push('<span class="crud-badge off">' + esc(t('admin.badgeDisabled')) + '</span>');
        if (p.freeOnly) badges.push('<span class="crud-badge">free-only</span>');
        if (p.allowPublicModels) badges.push('<span class="crud-badge">public-catalog</span>');
        if (p.apiKeyOptional) badges.push('<span class="crud-badge">key-optional</span>');
        return (
          '<div class="crud-row" data-id="' + esc(id) + '">' +
          '<div class="crud-row-main">' +
          '<div class="crud-row-title"><span class="crud-order mono">' + (index + 1) + '.</span> <strong>' + esc(p.label || id) + '</strong> <code class="code-inline">' + esc(id) + '</code>' + badges.join('') + '</div>' +
          '<div class="crud-row-sub small muted">' +
          esc(p.baseUrl || p.baseUrlEnvKey || '—') + ' · <span class="mono">' + esc(p.apiKeyEnv || '(no key env)') + '</span>' +
          (p.defaultModel ? ' · <span class="mono">' + esc(p.defaultModel) + '</span>' : '') +
          '</div>' +
          '</div>' +
          '<div class="crud-row-actions">' +
          '<button class="btn btn-ghost btn-sm p-up" type="button" title="Move up" ' + (index === 0 ? 'disabled' : '') + '>↑</button>' +
          '<button class="btn btn-ghost btn-sm p-down" type="button" title="Move down" ' + (index === ids.length - 1 ? 'disabled' : '') + '>↓</button>' +
          '<button class="btn btn-ghost btn-sm p-edit" type="button">' + esc(t('common.edit')) + '</button>' +
          '<button class="btn btn-ghost btn-sm p-del crud-danger" type="button">' + esc(t('common.delete')) + '</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function openProviderForm(id) {
    state.editingProviderId = id || null;
    var p = id ? providerById(id) || {} : {};
    $('pf-id').value = id || '';
    $('pf-id').disabled = Boolean(id);
    $('pf-label').value = p.label || '';
    $('pf-desc').value = p.description || '';
    $('pf-tagline').value = p.tagline || '';
    $('pf-baseurl').value = p.baseUrl || '';
    $('pf-baseurlenv').value = p.baseUrlEnvKey || '';
    $('pf-keyenv').value = p.apiKeyEnv || '';
    $('pf-modelenv').value = p.modelEnvKey || '';
    $('pf-defaultmodel').value = p.defaultModel || '';
    $('pf-docsurl').value = p.docsUrl || '';
    $('pf-enabled').checked = p.enabled !== false;
    $('pf-freeonly').checked = Boolean(p.freeOnly);
    $('pf-publicmodels').checked = Boolean(p.allowPublicModels);
    $('pf-orheaders').checked = Boolean(p.openrouterHeaders);
    $('pf-keyoptional').checked = Boolean(p.apiKeyOptional);
    $('provider-form-title').textContent = id
      ? t('admin.providers.editTitle') + ' — ' + id
      : t('admin.providers.addTitle');
    $('provider-form-note').textContent = '';
    $('provider-form').style.display = '';
    $('provider-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeProviderForm() {
    $('provider-form').style.display = 'none';
    state.editingProviderId = null;
  }

  function saveProviderForm() {
    var id = ($('pf-id').value || '').trim().toLowerCase();
    var isNew = !state.editingProviderId;

    if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(id)) {
      $('provider-form-note').textContent = t('admin.providers.errId');
      return;
    }
    if (isNew && providerById(id)) {
      $('provider-form-note').textContent = t('admin.providers.errExists');
      return;
    }

    var baseUrl = ($('pf-baseurl').value || '').trim();
    var baseUrlEnvKey = ($('pf-baseurlenv').value || '').trim();
    var apiKeyEnv = ($('pf-keyenv').value || '').trim();

    if (!baseUrl && !baseUrlEnvKey) {
      $('provider-form-note').textContent = t('admin.providers.errBaseUrl');
      return;
    }
    if (!apiKeyEnv && !$('pf-keyoptional').checked) {
      $('provider-form-note').textContent = t('admin.providers.errKeyEnv');
      return;
    }

    var prev = providerById(id) || {};
    var spec = {
      id: id,
      label: ($('pf-label').value || '').trim() || id,
      description: ($('pf-desc').value || '').trim(),
      tagline: ($('pf-tagline').value || '').trim(),
      docsUrl: ($('pf-docsurl').value || '').trim(),
      baseUrl: baseUrl || null,
      baseUrlEnvKey: baseUrlEnvKey || null,
      apiKeyEnv: apiKeyEnv,
      apiKeyOptional: $('pf-keyoptional').checked,
      modelEnvKey: ($('pf-modelenv').value || '').trim() || (id.toUpperCase() + '_MODEL'),
      extraModelEnvKeys: Array.isArray(prev.extraModelEnvKeys) ? prev.extraModelEnvKeys : [],
      defaultModel: ($('pf-defaultmodel').value || '').trim() || null,
      freeOnly: $('pf-freeonly').checked,
      allowPublicModels: $('pf-publicmodels').checked,
      openrouterHeaders: $('pf-orheaders').checked,
      supportsMaxTokens: prev.supportsMaxTokens !== false,
      enabled: $('pf-enabled').checked,
      models: Array.isArray(prev.models) ? prev.models : [],
    };

    state.providers.providers[id] = spec;
    if (state.providerOrder.indexOf(id) === -1) state.providerOrder.push(id);
    state.providers.order = state.providerOrder.slice();

    closeProviderForm();
    renderProviderCrudList();
    fillModelsProviderSelect();
    syncRawEditors();
    markDirty('providers', true);
    markDirty('models', true);
    toast(t('admin.providers.savedLocal') + ' — ' + id);
  }

  function deleteProvider(id) {
    if (!window.confirm(t('admin.providers.confirmDelete') + ' "' + id + '"?')) return;
    delete state.providers.providers[id];
    state.providerOrder = state.providerOrder.filter(function (x) { return x !== id; });
    state.providers.order = state.providerOrder.slice();
    if (state.modelsSelectedProvider === id) state.modelsSelectedProvider = '';
    renderProviderCrudList();
    fillModelsProviderSelect();
    syncRawEditors();
    markDirty('providers', true);
    markDirty('models', true);
    toast(t('admin.providers.deletedLocal') + ' — ' + id);
  }

  function moveProvider(id, dir) {
    var index = state.providerOrder.indexOf(id);
    var next = index + dir;
    if (index === -1 || next < 0 || next >= state.providerOrder.length) return;
    state.providerOrder.splice(next, 0, state.providerOrder.splice(index, 1)[0]);
    state.providers.order = state.providerOrder.slice();
    renderProviderCrudList();
    syncRawEditors();
    markDirty('providers', true);
  }

  function saveProvidersFile() {
    var pretty = JSON.stringify(state.providers, null, 2) + '\n';
    setSaving('save-providers', true);
    commitFile('config/providers.json', pretty, state.providersSha, 'feat(admin): update AI providers (full CRUD) — providers.json')
      .then(function (res) {
        state.providersSha = res && res.content ? res.content.sha : state.providersSha;
        syncRawEditors();
        markDirty('providers', false);
        markDirty('models', false);
        toast(t('admin.committed'));
        loadActivity();
      })
      .catch(function (err) {
        toast(t('admin.commitFailed') + ' ' + err.message, true);
      })
      .finally(function () { setSaving('save-providers', false); });
  }

  /* ================= MODELS CRUD ================= */

  function fillModelsProviderSelect() {
    var select = $('models-provider');
    var ids = state.providerOrder.filter(function (id) { return providerById(id); });
    Object.keys(state.providers.providers || {}).forEach(function (id) {
      if (ids.indexOf(id) === -1) ids.push(id);
    });
    if (ids.indexOf(state.modelsSelectedProvider) === -1) {
      state.modelsSelectedProvider = ids[0] || '';
    }
    select.innerHTML = ids
      .map(function (id) {
        var p = providerById(id) || {};
        return '<option value="' + esc(id) + '"' + (id === state.modelsSelectedProvider ? ' selected' : '') + '>' +
          esc(p.label || id) + ' (' + esc(id) + ')</option>';
      })
      .join('');
    renderModelsCrudList();
  }

  function renderModelsCrudList() {
    var wrap = $('models-crud-list');
    var id = state.modelsSelectedProvider;
    var p = id ? providerById(id) : null;
    if (!p) {
      wrap.innerHTML = '<p class="small muted">' + esc(t('admin.models.none')) + '</p>';
      return;
    }
    var models = Array.isArray(p.models) ? p.models : [];
    if (!models.length) {
      wrap.innerHTML = '<p class="small muted">' + esc(t('admin.models.empty')) + '</p>';
      return;
    }
    wrap.innerHTML = models
      .map(function (m, index) {
        return (
          '<div class="crud-row" data-index="' + index + '">' +
          '<div class="crud-row-main">' +
          '<div class="crud-row-title"><code class="code-inline">' + esc(m.id) + '</code>' +
          (m.default ? ' <span class="crud-badge default">' + esc(t('admin.badgeDefault')) + '</span>' : '') +
          '</div>' +
          '<div class="crud-row-sub small muted">' + esc(m.label || m.id) + '</div>' +
          '</div>' +
          '<div class="crud-row-actions">' +
          '<button class="btn btn-ghost btn-sm m-edit" type="button">' + esc(t('common.edit')) + '</button>' +
          '<button class="btn btn-ghost btn-sm m-del crud-danger" type="button">' + esc(t('common.delete')) + '</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function saveModelForm() {
    var id = state.modelsSelectedProvider;
    var p = id ? providerById(id) : null;
    if (!p) return;

    var modelId = ($('mf-id').value || '').trim();
    var label = ($('mf-label').value || '').trim();
    var makeDefault = $('mf-default').checked;
    if (!modelId) {
      toast(t('admin.models.errId'), true);
      return;
    }
    if (!Array.isArray(p.models)) p.models = [];

    var entry = { id: modelId, label: label || modelId, default: makeDefault };

    if (state.editingModelIndex >= 0) {
      p.models[state.editingModelIndex] = entry;
      state.editingModelIndex = -1;
      $('model-add').innerHTML = '＋ <span>' + esc(t('admin.models.add')) + '</span>';
    } else {
      if (p.models.some(function (m) { return m.id === modelId; })) {
        toast(t('admin.models.errExists'), true);
        return;
      }
      p.models.push(entry);
    }
    if (makeDefault) {
      p.models.forEach(function (m) { m.default = m.id === modelId; });
      if (p.defaultModel !== modelId) p.defaultModel = modelId;
    }

    $('mf-id').value = '';
    $('mf-label').value = '';
    $('mf-default').checked = false;

    renderModelsCrudList();
    renderProviderCrudList();
    syncRawEditors();
    markDirty('models', true);
    markDirty('providers', true);
  }

  function editModel(index) {
    var p = providerById(state.modelsSelectedProvider);
    if (!p || !p.models[index]) return;
    var m = p.models[index];
    state.editingModelIndex = index;
    $('mf-id').value = m.id;
    $('mf-label').value = m.label || '';
    $('mf-default').checked = Boolean(m.default);
    $('mf-id').focus();
  }

  function deleteModel(index) {
    var p = providerById(state.modelsSelectedProvider);
    if (!p || !p.models[index]) return;
    if (!window.confirm(t('admin.models.confirmDelete') + ' "' + p.models[index].id + '"?')) return;
    p.models.splice(index, 1);
    renderModelsCrudList();
    renderProviderCrudList();
    syncRawEditors();
    markDirty('models', true);
    markDirty('providers', true);
  }

  /* ================= KNOWLEDGE CRUD ================= */

  function fillKnowledgeCrud() {
    renderKnowledgeCrudList();
    markDirty('knowledge', false);
  }

  function renderKnowledgeCrudList() {
    var wrap = $('knowledge-crud-list');
    var entries = state.knowledge.entries || [];
    if (!entries.length) {
      wrap.innerHTML = '<p class="small muted">' + esc(t('admin.knowledge.none')) + '</p>';
      return;
    }
    wrap.innerHTML = entries
      .map(function (entry, index) {
        return (
          '<div class="crud-row" data-index="' + index + '">' +
          '<div class="crud-row-main">' +
          '<div class="crud-row-title"><strong>' + esc(entry.topic || '(no topic)') + '</strong>' +
          (Array.isArray(entry.tags) && entry.tags.length
            ? ' ' + entry.tags.map(function (tag) { return '<span class="crud-badge">' + esc(tag) + '</span>'; }).join('')
            : '') +
          '</div>' +
          '<div class="crud-row-sub small muted">' + esc(String(entry.answer || '').replace(/\s+/g, ' ').slice(0, 140)) + '…</div>' +
          '</div>' +
          '<div class="crud-row-actions">' +
          '<button class="btn btn-ghost btn-sm k-edit" type="button">' + esc(t('common.edit')) + '</button>' +
          '<button class="btn btn-ghost btn-sm k-del crud-danger" type="button">' + esc(t('common.delete')) + '</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function saveKnowledgeForm() {
    var topic = ($('kf-topic').value || '').trim();
    var answer = ($('kf-answer').value || '').trim();
    var tags = ($('kf-tags').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!topic) { toast(t('admin.knowledge.errTopic'), true); return; }
    if (!answer) { toast(t('admin.knowledge.errAnswer'), true); return; }

    var entry = { topic: topic, tags: tags, answer: answer };
    if (state.editingKnowledgeIndex >= 0) {
      state.knowledge.entries[state.editingKnowledgeIndex] = entry;
      state.editingKnowledgeIndex = -1;
      $('knowledge-add').innerHTML = '＋ <span>' + esc(t('admin.knowledge.add')) + '</span>';
      $('knowledge-edit-cancel').style.display = 'none';
    } else {
      state.knowledge.entries.push(entry);
    }

    $('kf-topic').value = '';
    $('kf-tags').value = '';
    $('kf-answer').value = '';

    renderKnowledgeCrudList();
    syncRawEditors();
    markDirty('knowledge', true);
  }

  function editKnowledge(index) {
    var entry = state.knowledge.entries[index];
    if (!entry) return;
    state.editingKnowledgeIndex = index;
    $('kf-topic').value = entry.topic || '';
    $('kf-tags').value = Array.isArray(entry.tags) ? entry.tags.join(', ') : '';
    $('kf-answer').value = entry.answer || '';
    $('knowledge-add').innerHTML = '✓ <span>' + esc(t('admin.knowledge.update')) + '</span>';
    $('knowledge-edit-cancel').style.display = '';
    $('kf-topic').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function cancelKnowledgeEdit() {
    state.editingKnowledgeIndex = -1;
    $('knowledge-add').innerHTML = '＋ <span>' + esc(t('admin.knowledge.add')) + '</span>';
    $('knowledge-edit-cancel').style.display = 'none';
    $('kf-topic').value = '';
    $('kf-tags').value = '';
    $('kf-answer').value = '';
  }

  function deleteKnowledge(index) {
    var entry = state.knowledge.entries[index];
    if (!entry) return;
    if (!window.confirm(t('admin.knowledge.confirmDelete') + ' "' + (entry.topic || '') + '"?')) return;
    state.knowledge.entries.splice(index, 1);
    renderKnowledgeCrudList();
    syncRawEditors();
    markDirty('knowledge', true);
  }

  function saveKnowledgeFile() {
    var pretty = JSON.stringify(state.knowledge, null, 2) + '\n';
    setSaving('save-knowledge', true);
    commitFile('config/knowledge.json', pretty, state.knowledgeSha, 'feat(admin): update chatbot knowledge base (knowledge.json)')
      .then(function (res) {
        state.knowledgeSha = res && res.content ? res.content.sha : state.knowledgeSha;
        syncRawEditors();
        markDirty('knowledge', false);
        toast(t('admin.committed'));
        loadActivity();
      })
      .catch(function (err) {
        toast(t('admin.commitFailed') + ' ' + err.message, true);
      })
      .finally(function () { setSaving('save-knowledge', false); });
  }

  /* ---------------- raw editors ---------------- */

  function syncRawEditors() {
    if (state.site) $('raw-site').value = JSON.stringify(state.site, null, 2);
    if (state.providers) $('raw-providers').value = JSON.stringify(state.providers, null, 2);
    if (state.knowledge) $('raw-knowledge').value = JSON.stringify(state.knowledge, null, 2);
  }

  function saveRaw(which) {
    var map = {
      site: { el: 'raw-site', path: 'config/site.json', sha: 'siteSha', msg: 'chore(admin): update site config via raw editor' },
      providers: { el: 'raw-providers', path: 'config/providers.json', sha: 'providersSha', msg: 'feat(admin): update providers via raw editor' },
      knowledge: { el: 'raw-knowledge', path: 'config/knowledge.json', sha: 'knowledgeSha', msg: 'feat(admin): update knowledge via raw editor' },
    };
    var conf = map[which];
    var json;
    try {
      json = JSON.parse($(conf.el).value);
    } catch (err) {
      toast(t('admin.invalidJson') + ' ' + err.message, true);
      return;
    }
    var pretty = JSON.stringify(json, null, 2) + '\n';
    setSaving('save-raw-' + which, true);
    commitFile(conf.path, pretty, state[conf.sha], conf.msg)
      .then(function (res) {
        state[conf.sha] = res && res.content ? res.content.sha : state[conf.sha];
        if (which === 'site') { state.site = json; fillSiteForm(); }
        if (which === 'providers') { state.providers = json; migrateProviders(); fillProvidersCrud(); }
        if (which === 'knowledge') { state.knowledge = json; if (!Array.isArray(state.knowledge.entries)) state.knowledge.entries = []; fillKnowledgeCrud(); }
        syncRawEditors();
        toast(t('admin.committed'));
        loadActivity();
      })
      .catch(function (err) {
        toast(t('admin.commitFailed') + ' ' + err.message, true);
      })
      .finally(function () { setSaving('save-raw-' + which, false); });
  }

  /* ---------------- PUSH ALL — one button pushes every change ---------------- */

  /** Order-independent stringify so unchanged files are never re-committed. */
  function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value && typeof value === 'object') {
      var keys = Object.keys(value).sort();
      return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + stableStringify(value[k]); }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function currentJsonFor(which) {
    if (which === 'site') return collectSite();     // built live from the Site form
    if (which === 'providers') return state.providers; // provider/model CRUD mutates state directly
    return state.knowledge;                            // knowledge CRUD mutates state directly
  }

  function pushAll() {
    var files = [
      { which: 'site',      path: 'config/site.json',      sha: 'siteSha',      msg: 'feat(admin): PUSH — update site config (site.json)' },
      { which: 'providers', path: 'config/providers.json', sha: 'providersSha', msg: 'feat(admin): PUSH — update AI providers + models (providers.json)' },
      { which: 'knowledge', path: 'config/knowledge.json', sha: 'knowledgeSha', msg: 'feat(admin): PUSH — update knowledge base (knowledge.json)' },
    ];

    var dirty = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var json;
      try { json = currentJsonFor(f.which); } catch (err) { toast(err.message, true); return; }
      if (!json) continue;
      if (stableStringify(json) !== stableStringify(state[f.which])) {
        dirty.push({ conf: f, pretty: JSON.stringify(json, null, 2) + '\n', json: json });
      }
    }

    if (dirty.length === 0) { toast(t('admin.pushNothing')); return; }

    var btn = $('push-all-btn');
    var oldLabel = btn.textContent;
    var done = 0;
    var failures = [];
    btn.disabled = true;

    function next() {
      if (done >= dirty.length) {
        btn.disabled = false;
        btn.textContent = oldLabel;
        if (failures.length === 0) {
          toast(t('admin.pushed').replace('{n}', String(dirty.length)));
        } else {
          toast(t('admin.pushPartial') + ' ' + failures.join(' | '), true);
        }
        loadActivity();
        return;
      }
      btn.textContent = t('admin.pushing').replace('{i}', String(done + 1)).replace('{n}', String(dirty.length));
      var entry = dirty[done];
      commitFile(entry.conf.path, entry.pretty, state[entry.conf.sha], entry.conf.msg)
        .then(function (res) {
          state[entry.conf.sha] = res && res.content ? res.content.sha : state[entry.conf.sha];
          if (entry.conf.which === 'site') { state.site = entry.json; fillSiteForm(); markDirty('site', false); }
          if (entry.conf.which === 'providers') { state.providers = entry.json; fillProvidersCrud(); }
          if (entry.conf.which === 'knowledge') { state.knowledge = entry.json; markDirty('knowledge', false); }
          syncRawEditors();
          done += 1;
          next();
        })
        .catch(function (err) {
          failures.push(entry.conf.path + ': ' + err.message);
          done += 1;
          next();
        });
    }
    next();
  }

  /* ---------------- misc ui ---------------- */

  function setSaving(btnId, saving) {
    var btn = $(btnId);
    if (!btn) return;
    if (saving) {
      btn.disabled = true;
      btn.dataset.label = btn.textContent;
      btn.textContent = 'Committing…';
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
    }
  }

  function markDirty(which, dirty) {
    var map = { site: 'site-dirty-note', providers: 'providers-dirty-note', models: 'models-dirty-note', knowledge: 'knowledge-dirty-note' };
    var note = $(map[which]);
    if (note) note.textContent = dirty ? t('admin.unsaved') : t('admin.noChanges');
  }

  document.querySelectorAll('.admin-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.admin-tab').forEach(function (tabEl) { tabEl.classList.remove('active'); });
      document.querySelectorAll('.admin-pane').forEach(function (pane) { pane.classList.remove('active'); });
      tab.classList.add('active');
      var pane = $('pane-' + tab.getAttribute('data-tab'));
      if (pane) pane.classList.add('active');
    });
  });

  ['site-appname', 'site-tagline', 'site-description', 'site-ann-enabled', 'site-ann-text', 'site-ann-link', 'site-ann-label', 'bot-enabled', 'bot-name', 'bot-welcome', 'bot-quick', 'bot-temp', 'bot-maxtokens'].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('input', function () { markDirty('site', true); });
  });

  /* ---------------- event delegation (CRUD lists) ---------------- */

  $('provider-crud-list').addEventListener('click', function (event) {
    var row = event.target.closest('.crud-row');
    if (!row) return;
    var id = row.getAttribute('data-id');
    if (event.target.closest('.p-up')) moveProvider(id, -1);
    else if (event.target.closest('.p-down')) moveProvider(id, 1);
    else if (event.target.closest('.p-edit')) openProviderForm(id);
    else if (event.target.closest('.p-del')) deleteProvider(id);
  });

  $('models-crud-list').addEventListener('click', function (event) {
    var row = event.target.closest('.crud-row');
    if (!row) return;
    var index = Number(row.getAttribute('data-index'));
    if (event.target.closest('.m-edit')) editModel(index);
    else if (event.target.closest('.m-del')) deleteModel(index);
  });

  $('knowledge-crud-list').addEventListener('click', function (event) {
    var row = event.target.closest('.crud-row');
    if (!row) return;
    var index = Number(row.getAttribute('data-index'));
    if (event.target.closest('.k-edit')) editKnowledge(index);
    else if (event.target.closest('.k-del')) deleteKnowledge(index);
  });

  /* ---------------- wire up ---------------- */

  $('connect-btn').addEventListener('click', connect);
  $('gh-token').addEventListener('keydown', function (e) { if (e.key === 'Enter') connect(); });
  $('signout-btn').addEventListener('click', disconnect);
  $('st-reload').addEventListener('click', function () { loadAllFiles(); toast(t('admin.reloaded')); });

  $('save-site').addEventListener('click', saveSite);
  $('save-providers').addEventListener('click', saveProvidersFile);
  $('save-models').addEventListener('click', saveProvidersFile);
  $('save-knowledge').addEventListener('click', saveKnowledgeFile);

  $('provider-add').addEventListener('click', function () { openProviderForm(null); });
  $('provider-form-save').addEventListener('click', saveProviderForm);
  $('provider-form-cancel').addEventListener('click', closeProviderForm);

  $('models-provider').addEventListener('change', function () {
    state.modelsSelectedProvider = this.value;
    state.editingModelIndex = -1;
    renderModelsCrudList();
  });
  $('model-add').addEventListener('click', saveModelForm);

  $('knowledge-add').addEventListener('click', saveKnowledgeForm);
  $('knowledge-edit-cancel').addEventListener('click', cancelKnowledgeEdit);

  $('save-raw-site').addEventListener('click', function () { saveRaw('site'); });
  $('save-raw-providers').addEventListener('click', function () { saveRaw('providers'); });
  $('save-raw-knowledge').addEventListener('click', function () { saveRaw('knowledge'); });
  $('push-all-btn').addEventListener('click', pushAll);

  // Auto-restore this tab's session (sessionStorage survives reloads).
  (function restore() {
    try {
      var raw = sessionStorage.getItem('aigw-admin');
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && saved.repo && saved.token) {
        state.token = saved.token;
        state.repo = saved.repo;
        state.branch = saved.branch || 'main';
        $('gh-repo').value = saved.repo;
        $('gh-branch').value = state.branch;
        gh('/repos/' + state.repo)
          .then(function () { enterDashboard(); })
          .catch(function () { sessionStorage.removeItem('aigw-admin'); });
      }
    } catch (e) { /* ignore */ }
  })();
})();
