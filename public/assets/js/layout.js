/**
 * Shared site layout: navbar, footer, theme toggle (light default),
 * LANGUAGE TOGGLE (bn/en via I18N), announcement banner.
 * Loaded on every page. Pages declare: <body data-page="docs"> and
 * placeholders <div id="site-header"></div> / <div id="site-footer"></div>.
 *
 * Version branding comes from window.AIGW (assets/js/app-config.js), which
 * is regenerated at build time from APP_VERSION / APP_NAME env vars — change
 * them once in .env and EVERY page updates. After boot we also refresh from
 * GET /api/v1/config so the running server's live env values win.
 *
 * Base URL auto-detection: elements with class "live-base" are filled with
 * the detected API base URL (window origin, or the API_BASE_URL override).
 *
 * Theme: "light" is the default. Choosing dark persists to localStorage
 * under "aigw-theme"; the inline <script> in each page's <head> applies it
 * before first paint to avoid flashing.
 *
 * Language: I18N (i18n.js + i18n-dict.js) drives every label. Switching the
 * language re-renders the header/footer and fires "aigw:lang" for widgets.
 */
(function () {
  'use strict';


  /* Nav items use i18n keys so the language toggle re-labels them. */
  var NAV_MAIN = [
    { id: 'docs', href: '/docs/', key: 'nav.docs' },
    { id: 'endpoints', href: '/endpoints/', key: 'nav.endpoints' },
    { id: 'models', href: '/models/', key: 'nav.models' },
    { id: 'playground', href: '/playground/', key: 'nav.playground' },
    { id: 'guide', href: '/guide/', key: 'nav.guide' },
    { id: 'status', href: '/status/', key: 'nav.status' },
  ];

  var NAV_MORE = [
    { id: 'custom-provider', href: '/custom-provider/', key: 'nav.custom' },
    { id: 'telegram', href: '/telegram/', key: 'nav.telegram' },
    { id: 'env-setup', href: '/env-setup/', key: 'nav.envsetup' },
    { id: 'admin', href: '/admin/', key: 'nav.admin' },
    { id: 'changelog', href: '/changelog/', key: 'nav.changelog' },
  ];

  var LOGO_SVG =
    '<svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true">' +
    '<defs><linearGradient id="lgLogo" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#d946ef"/>' +
    '</linearGradient></defs>' +
    '<rect width="64" height="64" rx="14" fill="url(#lgLogo)"/>' +
    '<path d="M35.5 9 L17 37.5 h11.5 L25 55 L47 26 H34.5 Z" fill="#fff"/></svg>';

  var SUN_SVG =
    '<svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON_SVG =
    '<svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
  var BURGER_SVG =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var GLOBE_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>';
  var SEARCH_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  var GITHUB_SVG =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.69 1.25 3.35.95.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18.92-.26 1.9-.38 2.88-.39.98.01 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56C20.22 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z"/></svg>';
  var TELEGRAM_SVG =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.94 4.3c.28-1.32-.53-1.9-1.4-1.55L2.6 9.9c-1.28.5-1.26 1.2-.22 1.51l4.63 1.45 1.75 5.36c.21.6.38.83.99.83.46 0 .67-.21.93-.46l2.24-2.18 4.65 3.43c.86.47 1.47.23 1.68-.79l3.05-14.4ZM8.4 12.66l9.44-5.96c.47-.29.9-.13.55.18l-8.09 7.3-.31 3.36-1.59-4.88Z"/></svg>';
  var BOOK_SVG =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>';
  var HOME_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/></svg>';
  var ARROW_UP_SVG =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';
  var STAR_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/></svg>';
  var BELL_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  var CHAT_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>';
  var COPY_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
  var SUN_SMALL_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON_SMALL_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
  var GITHUB_URL = 'https://github.com/mdmubarokhosin/aigateway';

  function currentPage() {
    return document.body.getAttribute('data-page') || '';
  }

  function t(key) {
    return window.I18N ? window.I18N.t(key) : key;
  }

  function aigw() {
    return window.AIGW || { APP_VERSION: '1.4.0', APP_NAME: 'AI Gateway API', apiBase: function () { return window.location.origin; } };
  }

  function escapeHtmlText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buildAnnouncement() {
    var site = (window.AIGW && window.AIGW.SITE) || {};
    var ann = site.announcement || {};
    if (!ann.enabled || !ann.text) return '';
    var key = 'aigw-ann-dismissed';
    try {
      if (sessionStorage.getItem(key) === ann.text) return '';
    } catch (e) { /* session storage unavailable - keep the banner */ }
    return (
      '<div class="ann-banner" id="ann-banner" role="status">' +
      '<div class="container ann-inner">' +
      '<span class="ann-text">' + escapeHtmlText(ann.text) + '</span>' +
      (ann.link
        ? '<a class="ann-link" href="' + escapeHtmlText(ann.link) + '" target="_blank" rel="noopener">' + escapeHtmlText(ann.linkLabel || 'Learn more') + ' &rarr;</a>'
        : '') +
      '<button class="ann-close" id="ann-close" type="button" aria-label="Dismiss announcement">&times;</button>' +
      '</div></div>'
    );
  }

  function initAnnouncement() {
    var banner = document.getElementById('ann-banner');
    if (!banner) return;
    var closeBtn = document.getElementById('ann-close');
    closeBtn.addEventListener('click', function () {
      banner.remove();
      try {
        var site = window.AIGW && window.AIGW.SITE;
        var text = site && site.announcement ? site.announcement.text : '';
        sessionStorage.setItem('aigw-ann-dismissed', text || 'x');
      } catch (e) { /* ignore */ }
    });
  }

  function navLink(item, page, className) {
    var active = item.id === page ? ' class="' + className + ' active" aria-current="page"' : ' class="' + className + '"';
    return '<a href="' + item.href + '"' + active + '>' + escapeHtmlText(t(item.key)) + '</a>';
  }

  function langToggleLabel() {
    // When the site is in Bangla the button offers English, and vice versa.
    var lang = window.I18N ? window.I18N.getLang() : 'bn';
    return lang === 'bn' ? 'EN' : 'বাং';
  }

  function buildHeader() {
    var page = currentPage();
    var links = NAV_MAIN.map(function (item) {
      var active = item.id === page ? ' class="active" aria-current="page"' : '';
      return '<li><a href="' + item.href + '"' + active + '>' + escapeHtmlText(t(item.key)) + '</a></li>';
    }).join('');

    var moreActive = NAV_MORE.some(function (i) { return i.id === page; });

    var mobileLinks = NAV_MAIN.concat(NAV_MORE).map(function (item) {
      return navLink(item, page, 'mob-link');
    }).join('');

    var moreItems = NAV_MORE.map(function (item) {
      return '<a href="' + item.href + '"' + (item.id === page ? ' class="active"' : '') + '>' + escapeHtmlText(t(item.key)) + '</a>';
    }).join('');

    return (
      '<nav class="navbar" aria-label="Main navigation"><div class="container nav-inner">' +
      '<a class="nav-logo" href="/" aria-label="AI Gateway API home">' +
      LOGO_SVG +
      '<span>AI&nbsp;Gateway</span><span class="logo-chip">API&nbsp;v<span id="nav-version">' + aigw().APP_VERSION + '</span></span></a>' +
      '<ul class="nav-links">' +
      links +
      '<li class="nav-more' + (moreActive ? ' has-active' : '') + '">' +
      '<button class="nav-more-btn" id="nav-more-btn" type="button" aria-haspopup="true" aria-expanded="false">' +
      escapeHtmlText(t('nav.more')) +
      ' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
      '</button>' +
      '<div class="nav-more-menu" id="nav-more-menu" role="menu">' + moreItems + '</div>' +
      '</li>' +
      '</ul>' +
      '<div class="nav-right">' +
      '<button class="pal-btn" id="pal-open" type="button" aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)">' +
      SEARCH_SVG + '<span class="pk">Ctrl K</span>' +
      '</button>' +
      '<button class="lang-toggle" id="lang-toggle" type="button" aria-label="Switch language / ভাষা পরিবর্তন" title="English / বাংলা">' +
      GLOBE_SVG + '<span id="lang-toggle-label">' + langToggleLabel() + '</span>' +
      '</button>' +
      '<button class="theme-toggle" id="theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">' +
      SUN_SVG +
      MOON_SVG +
      '</button>' +
      '<a class="btn btn-primary btn-sm nav-cta" href="/playground/">' + escapeHtmlText(t('nav.openPlayground')) + '</a>' +
      '<button class="nav-toggle" id="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false">' +
      BURGER_SVG +
      '</button>' +
      '</div></div>' +
      '<div class="mobile-menu" id="mobile-menu">' +
      mobileLinks +
      '</div>' +
      '</nav>' +
      buildAnnouncement()
    );
  }

  function footerLink(href, key, extra) {
    return (
      '<li><a href="' + href + '">' + escapeHtmlText(t(key)) + (extra || '') +
      '<span class="flink-arrow" aria-hidden="true">→</span></a></li>'
    );
  }

  function buildFooter() {
    var year = new Date().getFullYear();
    var dark = document.documentElement.classList.contains('dark');
    return (
      '<footer class="footer"><div class="container">' +
      '<div class="footer-grid">' +
      '<div class="footer-brand">' +
      '<a class="nav-logo" href="/">' + LOGO_SVG + '<span>AI&nbsp;Gateway</span><span class="logo-chip">API</span></a>' +
      '<p class="footer-about" data-i18n="footer.about">' + escapeHtmlText(t('footer.about')) + '</p>' +
      '<div class="footer-social">' +
      '<a class="fsoc" href="' + GITHUB_URL + '" target="_blank" rel="noopener" aria-label="GitHub" title="GitHub">' + GITHUB_SVG + '</a>' +
      '<a class="fsoc" href="/telegram/" aria-label="Telegram" title="Telegram">' + TELEGRAM_SVG + '</a>' +
      '<a class="fsoc" href="/docs/" aria-label="API docs" title="API Docs">' + BOOK_SVG + '</a>' +
      '</div>' +
      '<span class="footer-status" id="footer-status"><span class="fsdot"></span><span id="footer-status-text">' + escapeHtmlText(t('footer.statusChecking')) + '</span></span>' +
      '</div>' +
      '<div class="footer-col"><div class="footer-h">' + escapeHtmlText(t('footer.product')) + '</div><ul>' +
      footerLink('/docs/', 'nav.docs') +
      footerLink('/endpoints/', 'nav.endpoints') +
      footerLink('/models/', 'nav.models') +
      footerLink('/playground/', 'nav.playground') +
      footerLink('/status/', 'nav.status') +
      '</ul></div>' +
      '<div class="footer-col"><div class="footer-h">' + escapeHtmlText(t('footer.resources')) + '</div><ul>' +
      footerLink('/guide/', 'nav.guide') +
      footerLink('/custom-provider/', 'nav.custom') +
      footerLink('/telegram/', 'nav.telegram') +
      footerLink('/env-setup/', 'nav.envsetup') +
      footerLink('/admin/', 'nav.admin') +
      footerLink('/changelog/', 'nav.changelog') +
      '</ul></div>' +
      '<div class="footer-col"><div class="footer-h">' + escapeHtmlText(t('footer.api')) + '</div><ul>' +
      '<li><code>GET /api/v1/health</code></li>' +
      '<li><code>GET /api/v1/models</code></li>' +
      '<li><code><a href="/ask?prompt=Hello">/ask?prompt=…</a></code></li>' +
      '<li><code>POST /api/v1/chat</code></li>' +
      '</ul>' +
      '<div class="footer-upd">' +
      '<div class="fu-title" data-i18n="footer.updTitle">' + escapeHtmlText(t('footer.updTitle')) + '</div>' +
      '<div class="fu-sub" data-i18n="footer.updSub">' + escapeHtmlText(t('footer.updSub')) + '</div>' +
      '<div class="fu-actions">' +
      '<a class="fu-btn" href="' + GITHUB_URL + '" target="_blank" rel="noopener">' + STAR_SVG + '<span data-i18n="footer.updStar">' + escapeHtmlText(t('footer.updStar')) + '</span></a>' +
      '<a class="fu-btn" href="/telegram/">' + BELL_SVG + '<span data-i18n="footer.updTg">' + escapeHtmlText(t('footer.updTg')) + '</span></a>' +
      '</div></div>' +
      '</div>' +
      '</div>' +
      '<div class="footer-bottom">' +
      '<div>' +
      '<span>© ' + year + ' AI Gateway API · MIT License · v<span id="footer-version">' + aigw().APP_VERSION + '</span></span>' +
      '<div class="footer-legal">' +
      '<a href="/privacy/" data-i18n="footer.privacy">' + escapeHtmlText(t('footer.privacy')) + '</a><span class="sep">·</span>' +
      '<a href="/terms/" data-i18n="footer.terms">' + escapeHtmlText(t('footer.terms')) + '</a><span class="sep">·</span>' +
      '<a href="/changelog/" data-i18n="footer.changelog">' + escapeHtmlText(t('footer.changelog')) + '</a><span class="sep">·</span>' +
      '<span data-i18n="footer.built">' + escapeHtmlText(t('footer.built')) + '</span>' +
      '</div></div>' +
      '<div class="footer-controls">' +
      '<button class="fctl" id="foot-theme" type="button" aria-label="Toggle dark mode" title="Light / dark">' + (dark ? SUN_SMALL_SVG : MOON_SMALL_SVG) + '</button>' +
      '<button class="fctl" id="foot-lang" type="button" aria-label="Switch language" title="English / বাংলা">' + langToggleLabel() + '</button>' +
      '<button class="fctl" id="foot-top" type="button" aria-label="Back to top" title="' + escapeHtmlText(t('pal.toTop')) + '">' + ARROW_UP_SVG + '</button>' +
      '</div>' +
      '</div></div></footer>'
    );
  }

  /* ========================================================================
     v1.3.0 UX ENGINE
     - shared theme toggle (navbar + footer)
     - footer live status pill (GET /api/v1/health)
     - scroll reveal (IntersectionObserver, stagger per grid)
     - navbar glass on scroll + back-to-top + reading progress (one listener)
     - Ctrl/⌘+K command palette (pages + quick actions)
     - FAQ accordion (event delegation, survives language re-renders)
     ===================================================================== */

  function toggleTheme() {
    var dark = document.documentElement.classList.toggle('dark');
    try {
      localStorage.setItem('aigw-theme', dark ? 'dark' : 'light');
    } catch (e) {
      /* storage unavailable — theme still toggles for this visit */
    }
    var footBtn = document.getElementById('foot-theme');
    if (footBtn) footBtn.innerHTML = dark ? SUN_SMALL_SVG : MOON_SMALL_SVG;
    return dark;
  }

  function initTheme() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', toggleTheme);
  }

  function initLangToggle() {
    var btn = document.getElementById('lang-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (window.I18N) window.I18N.toggle();
    });
  }

  function initMoreMenu() {
    var btn = document.getElementById('nav-more-btn');
    var menu = document.getElementById('nav-more-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (event) {
      if (!menu.contains(event.target) && !btn.contains(event.target)) {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function initMobileMenu() {
    var toggle = document.getElementById('nav-toggle');
    var menu = document.getElementById('mobile-menu');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (event) {
      if (!menu.contains(event.target) && !toggle.contains(event.target)) {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function initFooterControls() {
    var themeBtn = document.getElementById('foot-theme');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    var langBtn = document.getElementById('foot-lang');
    if (langBtn) langBtn.addEventListener('click', function () { if (window.I18N) window.I18N.toggle(); });
    var topBtn = document.getElementById('foot-top');
    if (topBtn) topBtn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  /* ---- footer live status ---- */
  var footStatus = null; // cache: { ok: Boolean, version: String }

  function applyFooterStatus() {
    var el = document.getElementById('footer-status');
    var txt = document.getElementById('footer-status-text');
    if (!el || !txt) return;
    if (!footStatus) { txt.textContent = t('footer.statusChecking'); return; }
    el.classList.remove('ok', 'down');
    el.classList.add(footStatus.ok ? 'ok' : 'down');
    txt.textContent = footStatus.ok
      ? t('footer.statusOk') + (footStatus.version ? ' · v' + footStatus.version : '')
      : t('footer.statusDown');
  }

  function fetchFooterStatus() {
    if (footStatus) { applyFooterStatus(); return; }
    var base = aigw().apiBase ? aigw().apiBase() : window.location.origin;
    fetch(base + '/api/v1/health', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (d) {
        footStatus = { ok: true, version: d && d.version ? String(d.version).replace(/^v/i, '') : '' };
        applyFooterStatus();
      })
      .catch(function () {
        footStatus = { ok: false, version: '' };
        applyFooterStatus();
      });
  }

  /* ---- scroll reveal ---- */
  var REVEAL_SEL = '.section-head, .card-hover, .endpoint-row, .faq-item, .stat-cell, ' +
    '.cta-band, .model-card, .tst-card, .alert, .status-banner, ' +
    /* v1.4.0: docs-style content blocks join the motion system */
    '.codeblock, .callout, .table-wrap, .doc-section > h2, .step-card, .gen-box';
  /* wide blocks + headings fade in without translateY (keeps anchors stable) */
  var REVEAL_FADE_SEL = '.table-wrap, .doc-section > h2';
  var revealObserver = null;

  /** Tag elements inside `root` for reveal-on-scroll. Exposed for widgets. */
  function enhanceReveals(root) {
    root = root || document;
    var nodes = root.querySelectorAll(REVEAL_SEL);
    if (!('IntersectionObserver' in window)) {
      for (var k = 0; k < nodes.length; k += 1) nodes[k].classList.add('reveal', 'in');
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            revealObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -7% 0px', threshold: 0.05 });
    }
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (el.classList.contains('reveal') || el.classList.contains('reveal-fade')) continue;
      /* headings + wide tables: fade only — no transform, anchor jumps stay exact */
      var fade = el.matches(REVEAL_FADE_SEL);
      el.classList.add(fade ? 'reveal-fade' : 'reveal');
      var parent = el.parentElement;
      if (parent) {
        var sibs = parent.querySelectorAll('.reveal, .reveal-fade');
        for (var j = 0; j < sibs.length; j += 1) {
          if (sibs[j] === el) {
            el.style.setProperty('--rd', Math.min(j, 7) * 70 + 'ms');
            break;
          }
        }
      }
      revealObserver.observe(el);
    }
  }

  /* ---- v1.4.0 reveal safety net ----
     If IntersectionObserver never fires (bots, print, exotic browsers,
     restored scroll positions), nothing may stay invisible. */
  function revealSweep() {
    var pending = document.querySelectorAll('.reveal:not(.in), .reveal-fade:not(.in)');
    for (var i = 0; i < pending.length; i += 1) {
      var rect = pending[i].getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) pending[i].classList.add('in');
    }
  }

  function revealAll() {
    var pending = document.querySelectorAll('.reveal:not(.in), .reveal-fade:not(.in)');
    for (var i = 0; i < pending.length; i += 1) pending[i].classList.add('in');
  }

  /* ---- v1.4.0: give EVERY page the home hero decoration ----
     .page-hero sections get floating orbs; .hero sections also get hero-bg. */
  function decoratePageHero() {
    var heroes = document.querySelectorAll('main .page-hero, main .hero');
    for (var h = 0; h < heroes.length; h += 1) {
      var hero = heroes[h];
      var isHero = hero.classList.contains('hero');
      if (isHero && !hero.querySelector('.hero-bg')) {
        var bg = document.createElement('div');
        bg.className = 'hero-bg';
        bg.setAttribute('aria-hidden', 'true');
        hero.insertBefore(bg, hero.firstChild);
      }
      if (!hero.querySelector('.hero-orb')) {
        for (var o = 1; o <= 5; o += 1) {
          var orb = document.createElement('span');
          orb.className = 'hero-orb o' + o;
          orb.setAttribute('aria-hidden', 'true');
          hero.appendChild(orb);
        }
      }
    }
  }

  /* ---- one global scroll listener: navbar glass + to-top + progress ---- */
  var globalScrollBound = false;

  function bindGlobalScroll() {
    if (globalScrollBound) return;
    globalScrollBound = true;
    var onScroll = function () {
      var nav = document.querySelector('.navbar');
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 8);
      var tt = document.getElementById('to-top');
      if (tt) tt.classList.toggle('show', window.scrollY > 460);
      var bar = document.getElementById('scroll-progress');
      if (bar) {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function ensureFixedLayer() {
    if (!document.getElementById('to-top')) {
      var top = document.createElement('button');
      top.id = 'to-top';
      top.className = 'to-top';
      top.type = 'button';
      top.setAttribute('aria-label', t('pal.toTop'));
      top.title = t('pal.toTop');
      top.innerHTML = ARROW_UP_SVG;
      top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
      document.body.appendChild(top);
    }
    if (!document.getElementById('scroll-progress')) {
      var bar = document.createElement('div');
      bar.id = 'scroll-progress';
      bar.className = 'scroll-progress';
      document.body.appendChild(bar);
    }
  }

  /* ---- toast (tiny, dependency-free) ---- */
  function toast(msg) {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:130;' +
      'background:var(--surface);color:var(--text);border:1px solid var(--border);' +
      'box-shadow:var(--shadow-lg);padding:10px 20px;border-radius:12px;font-size:0.88rem;' +
      'max-width:86vw;text-align:center;opacity:1;transition:opacity .35s ease;';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(function () { d.style.opacity = '0'; }, 1900);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 2350);
  }

  function copyApiBase() {
    var base = aigw().apiBase();
    var done = function () { toast(t('pal.copied')); };
    var fail = function () {
      var ta = document.createElement('textarea');
      ta.value = base;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* clipboard unavailable */ }
      if (ta.parentNode) ta.parentNode.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(base).then(done, fail);
    } else fail();
  }

  /* ---- command palette (Ctrl/⌘ + K) ---- */
  var pal = { overlay: null, input: null, list: null, items: [], sel: 0 };

  function palActions() {
    var dark = document.documentElement.classList.contains('dark');
    return [
      { label: t('pal.actTheme'), sub: t('pal.actThemeSub'), icon: dark ? SUN_SMALL_SVG : MOON_SMALL_SVG, run: toggleTheme },
      { label: t('pal.actLang'), sub: t('pal.actLangSub'), icon: GLOBE_SVG, run: function () { if (window.I18N) window.I18N.toggle(); } },
      { label: t('pal.actCopy'), sub: aigw().apiBase(), icon: COPY_SVG, run: copyApiBase },
      {
        label: t('pal.actChat'), sub: t('pal.actChatSub'), icon: CHAT_SVG,
        run: function () {
          var launcher = document.querySelector('.cb-launcher');
          if (launcher) launcher.click();
          else window.location.href = '/playground/';
        },
      },
    ];
  }

  function palData() {
    return [
      { label: t('pal.home'), sub: t('pal.homeSub'), icon: HOME_SVG, href: '/' },
      { label: t('nav.docs'), sub: t('pal.docsSub'), icon: BOOK_SVG, href: '/docs/' },
      { label: t('nav.endpoints'), sub: t('pal.epSub'), icon: COPY_SVG, href: '/endpoints/' },
      { label: t('nav.models'), sub: t('pal.modelsSub'), icon: BOOK_SVG, href: '/models/' },
      { label: t('nav.playground'), sub: t('pal.pgSub'), icon: CHAT_SVG, href: '/playground/' },
      { label: t('nav.guide'), sub: t('pal.guideSub'), icon: BOOK_SVG, href: '/guide/' },
      { label: t('nav.status'), sub: t('pal.statusSub'), icon: HOME_SVG, href: '/status/' },
      { label: t('nav.custom'), sub: t('pal.customSub'), icon: BOOK_SVG, href: '/custom-provider/' },
      { label: t('nav.telegram'), sub: t('pal.tgSub'), icon: CHAT_SVG, href: '/telegram/' },
      { label: t('nav.envsetup'), sub: t('pal.envSub'), icon: COPY_SVG, href: '/env-setup/' },
      { label: t('nav.admin'), sub: t('pal.adminSub'), icon: CHAT_SVG, href: '/admin/' },
      { label: t('nav.changelog'), sub: t('pal.clSub'), icon: BELL_SVG, href: '/changelog/' },
      { label: t('footer.privacy'), sub: t('pal.privacySub'), icon: BOOK_SVG, href: '/privacy/' },
      { label: t('footer.terms'), sub: t('pal.termsSub'), icon: BOOK_SVG, href: '/terms/' },
    ].concat(palActions());
  }

  function palRender() {
    var q = (pal.input.value || '').toLowerCase();
    pal.items = palData().filter(function (item) {
      if (!q) return true;
      return (item.label + ' ' + item.sub + ' ' + (item.href || '')).toLowerCase().indexOf(q) !== -1;
    });
    pal.sel = 0;
    if (!pal.items.length) {
      pal.list.innerHTML = '<li class="pal-empty">' + escapeHtmlText(t('pal.empty')) + '</li>';
      return;
    }
    pal.list.innerHTML = pal.items.map(function (item, i) {
      return (
        '<li class="pal-item' + (i === 0 ? ' sel' : '') + '" data-i="' + i + '">' +
        '<span class="pi-icon">' + item.icon + '</span>' +
        '<span class="pi-main">' + escapeHtmlText(item.label) +
        '<span class="pi-sub">' + escapeHtmlText(item.sub || '') + '</span></span>' +
        '</li>'
      );
    }).join('');
  }

  function palHighlight() {
    var rows = pal.list.querySelectorAll('.pal-item');
    for (var i = 0; i < rows.length; i += 1) {
      rows[i].classList.toggle('sel', i === pal.sel);
    }
    var selRow = rows[pal.sel];
    if (selRow && selRow.scrollIntoView) selRow.scrollIntoView({ block: 'nearest' });
  }

  function palRun(i) {
    var item = pal.items[i];
    if (!item) return;
    closePalette();
    if (item.run) item.run();
    else if (item.href) window.location.href = item.href;
  }

  function openPalette() {
    palRender();
    pal.overlay.classList.add('open');
    pal.input.value = '';
    palRender();
    setTimeout(function () { pal.input.focus(); }, 20);
  }

  function closePalette() {
    pal.overlay.classList.remove('open');
  }

  function ensurePalette() {
    if (pal.overlay) return;
    pal.overlay = document.createElement('div');
    pal.overlay.className = 'pal-overlay';
    pal.overlay.id = 'pal-overlay';
    pal.overlay.innerHTML =
      '<div class="pal-box" role="dialog" aria-modal="true" aria-label="Quick navigation">' +
      '<div class="pal-input-row">' + SEARCH_SVG +
      '<input class="pal-input" id="pal-input" type="text" autocomplete="off" spellcheck="false" placeholder="' + escapeHtmlText(t('pal.placeholder')) + '" />' +
      '<span class="pal-kbd">ESC</span>' +
      '</div>' +
      '<ul class="pal-list" id="pal-list"></ul>' +
      '<div class="pal-foot"><span>↑↓ ' + escapeHtmlText(t('pal.navHint')) + '</span><span>↵ ' + escapeHtmlText(t('pal.openHint')) + '</span><span style="margin-left:auto">AI Gateway · Ctrl K</span></div>' +
      '</div>';
    document.body.appendChild(pal.overlay);
    pal.input = pal.overlay.querySelector('#pal-input');
    pal.list = pal.overlay.querySelector('#pal-list');

    pal.overlay.addEventListener('click', function (event) {
      if (event.target === pal.overlay) closePalette();
    });
    pal.list.addEventListener('click', function (event) {
      var row = event.target.closest ? event.target.closest('.pal-item') : null;
      if (!row) return;
      palRun(parseInt(row.getAttribute('data-i'), 10));
    });
    pal.list.addEventListener('mousemove', function (event) {
      var row = event.target.closest ? event.target.closest('.pal-item') : null;
      if (!row) return;
      pal.sel = parseInt(row.getAttribute('data-i'), 10);
      palHighlight();
    });
    pal.input.addEventListener('input', palRender);
    pal.input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); pal.sel = Math.min(pal.sel + 1, pal.items.length - 1); palHighlight(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); pal.sel = Math.max(pal.sel - 1, 0); palHighlight(); }
      else if (event.key === 'Enter') { event.preventDefault(); palRun(pal.sel); }
      else if (event.key === 'Escape') { closePalette(); }
    });
  }

  function initPalette() {
    ensurePalette();
    var openBtn = document.getElementById('pal-open');
    if (openBtn) openBtn.addEventListener('click', openPalette);
  }

  function initPaletteKeys() {
    document.addEventListener('keydown', function (event) {
      var mod = event.ctrlKey || event.metaKey;
      if (mod && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        if (pal.overlay.classList.contains('open')) closePalette();
        else openPalette();
        return;
      }
      if (event.key === 'Escape') closePalette();
    });
  }

  /* ---- FAQ accordion (delegated: survives language re-renders) ---- */
  function initFaqDelegation() {
    document.addEventListener('click', function (event) {
      var q = event.target.closest ? event.target.closest('.faq-q') : null;
      if (!q) return;
      var item = q.parentElement;
      var ans = item.querySelector('.faq-a');
      if (!ans) return;
      var open = item.classList.toggle('open');
      ans.style.maxHeight = open ? ans.scrollHeight + 'px' : '0px';
    });
  }

  function refitOpenFaqs() {
    var open = document.querySelectorAll('.faq-item.open .faq-a');
    for (var i = 0; i < open.length; i += 1) open[i].style.maxHeight = open[i].scrollHeight + 'px';
  }

  /* ---- PWA manifest + theme color (injected once, works on every page) ---- */
  function injectMeta() {
    try {
      if (!document.querySelector('link[rel="manifest"]')) {
        var mf = document.createElement('link');
        mf.rel = 'manifest';
        mf.href = '/manifest.webmanifest';
        document.head.appendChild(mf);
      }
      if (!document.querySelector('meta[name="theme-color"]')) {
        var mt = document.createElement('meta');
        mt.name = 'theme-color';
        mt.content = '#7c3aed';
        document.head.appendChild(mt);
      }
    } catch (e) { /* head unavailable (very old browser) — ignore */ }
  }

  /** Replace <span class="live-base">…</span> placeholders with the detected base URL. */
  function fillLiveBaseUrls() {
    var base = aigw().apiBase();
    var nodes = document.querySelectorAll('.live-base');
    for (var i = 0; i < nodes.length; i += 1) nodes[i].textContent = base;
  }

  /**
   * Refresh version/app name from the LIVE server (GET /api/v1/config).
   * This is what makes an .env change propagate to every page: the Cloudflare
   * Function reads the current env at request time and every page updates.
   */
  function refreshFromServerConfig() {
    if (!aigw().fetchServerConfig) return;
    aigw()
      .fetchServerConfig()
      .then(function (cfg) {
        if (cfg && cfg.version) {
          window.AIGW.APP_VERSION = String(cfg.version).replace(/^v/i, '');
          var v = window.AIGW.APP_VERSION;
          var nav = document.getElementById('nav-version');
          var foot = document.getElementById('footer-version');
          if (nav) nav.textContent = v;
          if (foot) foot.textContent = v;
          document.querySelectorAll('.js-app-version').forEach(function (el) {
            el.textContent = 'v' + v;
          });
        }
        if (cfg && cfg.apiBaseUrl) {
          window.AIGW.SERVER_BASE = cfg.apiBaseUrl;
          document.querySelectorAll('.server-base').forEach(function (el) {
            el.textContent = cfg.apiBaseUrl;
          });
        }
        document.dispatchEvent(new CustomEvent('aigw:config', { detail: cfg }));
      })
      .catch(function () {
        /* API offline — build-time values stay displayed */
      });
  }

  /** Everything that must (re)bind after a header/footer re-render. */
  function bindHeaderFooter() {
    initTheme();
    initLangToggle();
    initMoreMenu();
    initMobileMenu();
    initAnnouncement();
    initFooterControls();
    initPalette();
    applyFooterStatus();
  }

  function boot() {
    var header = document.getElementById('site-header');
    var footer = document.getElementById('site-footer');
    if (header) header.outerHTML = buildHeader();
    if (footer) footer.outerHTML = buildFooter();
    fillLiveBaseUrls();
    bindHeaderFooter();
    injectMeta();
    ensureFixedLayer();
    bindGlobalScroll();
    initPaletteKeys();
    initFaqDelegation();
    fetchFooterStatus();
    decoratePageHero();
    enhanceReveals(document);
    /* safety net: reveal anything the observer missed (bots, print, odd
       browsers, bfcache restores) — burst of sweeps, then on print */
    var sweeps = 0;
    var sweepTimer = setInterval(function () {
      revealSweep();
      sweeps += 1;
      if (sweeps >= 8) clearInterval(sweepTimer);
    }, 1200);
    window.addEventListener('beforeprint', revealAll);
    window.addEventListener('pageshow', revealSweep);
    refreshFromServerConfig();
    /* translate any data-i18n node rendered after i18n.js's first pass
       (footer/about text was English-on-first-load before v1.3.0 — fixed) */
    if (window.I18N) window.I18N.apply(document);
  }

  /* Language switch -> re-render header/footer with new labels.
     NOTE: after boot the #site-header/#site-footer placeholders are GONE
     (replaced via outerHTML), so target the live .navbar / footer elements. */
  document.addEventListener('aigw:lang', function () {
    var navbar = document.querySelector('.navbar');
    var footer = document.querySelector('footer.footer');
    if (navbar) navbar.outerHTML = buildHeader();
    if (footer) footer.outerHTML = buildFooter();
    fillLiveBaseUrls();
    bindHeaderFooter();
    refitOpenFaqs();
  });

  /* Public hooks for widgets (home.js injects cards after fetch). */
  window.AIGW_UX = {
    reveal: enhanceReveals,
    revealAll: revealAll,
    toast: toast,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
