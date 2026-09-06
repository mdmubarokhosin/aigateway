/**
 * I18N ENGINE — Bangla (bn) + English (en) across the whole site.
 *
 * How it works:
 *   - The dictionary lives in assets/js/i18n-dict.js (window.I18N_DICT).
 *   - Static HTML marks translatable nodes:
 *       data-i18n="key"          -> textContent
 *       data-i18n-html="key"     -> innerHTML   (trusted dictionary content)
 *       data-i18n-ph="key"       -> placeholder
 *       data-i18n-aria="key"     -> aria-label
 *   - layout.js and every widget (chatbot, admin, ...) call I18N.t('key').
 *   - The navbar toggle button switches language; the choice persists in
 *     localStorage ("aigw-lang"). Default: Bangla (site owner's audience),
 *     or the browser language when it starts with "en".
 *   - Every switch updates <html lang> (which also tightens Bengali line
 *     height via CSS) and fires the "aigw:lang" event for dynamic widgets.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'aigw-lang';
  var SUPPORTED = ['bn', 'en'];

  function stored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.indexOf(v) !== -1 ? v : null;
    } catch (e) {
      return null;
    }
  }

  function guess() {
    // Site policy: Bangla is the default audience language. Visitors (and the
    // owner) can switch to English with the navbar toggle; the choice persists.
    return 'bn';
  }

  var lang = stored() || guess();

  function dict() {
    return (window.I18N_DICT && window.I18N_DICT[lang]) || (window.I18N_DICT && window.I18N_DICT.en) || {};
  }

  /** Translate a key. {name} placeholders are replaced from vars. */
  function t(key, vars) {
    var table = dict();
    var value = table[key];
    if (value === undefined) value = (window.I18N_DICT && window.I18N_DICT.en && window.I18N_DICT.en[key]);
    if (value === undefined) value = key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        value = value.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return value;
  }

  /** Current language code. */
  function getLang() {
    return lang;
  }

  /** Apply translations to all marked nodes under root (default: document). */
  function apply(root) {
    root = root || document;
    var i, nodes;

    nodes = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < nodes.length; i += 1) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));

    nodes = root.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < nodes.length; i += 1) nodes[i].innerHTML = t(nodes[i].getAttribute('data-i18n-html'));

    nodes = root.querySelectorAll('[data-i18n-ph]');
    for (i = 0; i < nodes.length; i += 1) nodes[i].setAttribute('placeholder', t(nodes[i].getAttribute('data-i18n-ph')));

    nodes = root.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < nodes.length; i += 1) nodes[i].setAttribute('aria-label', t(nodes[i].getAttribute('data-i18n-aria')));
  }

  /** Switch language, persist, re-render everything. */
  function setLang(next) {
    if (SUPPORTED.indexOf(next) === -1 || next === lang) return;
    lang = next;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) { /* private mode */ }
    document.documentElement.setAttribute('lang', lang);
    apply(document);
    var event = new CustomEvent('aigw:lang', { detail: { lang: lang } });
    document.dispatchEvent(event);
  }

  /** Toggle between bn/en (used by the navbar pill). */
  function toggle() {
    setLang(lang === 'bn' ? 'en' : 'bn');
  }

  // Set <html lang> as early as possible (FOUC-free typography).
  document.documentElement.setAttribute('lang', lang);

  window.I18N = { t: t, apply: apply, setLang: setLang, getLang: getLang, toggle: toggle };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply(document); });
  } else {
    apply(document);
  }
})();
