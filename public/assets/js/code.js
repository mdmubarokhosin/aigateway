/**
 * Shared page utilities: copy-to-clipboard for code blocks + tab groups.
 *
 * Copy:  <div class="codeblock" data-lang="bash">…<button class="copy-btn">Copy</button>…
 *        The button copies the text of the <pre><code> inside the same block.
 * Tabs:  <div data-tabs>
 *          <div class="tab-list" role="tablist">
 *            <button class="tab is-active" data-tab="curl">cURL</button>…
 *          </div>
 *          <div class="tab-panel is-active" data-panel="curl">…</div>…
 *        </div>
 */
(function () {
  'use strict';

  function copyText(text, done) {
    if (navigator.clipboard && window.isSecureContext !== false) {
      navigator.clipboard.writeText(text).then(done, function () {
        legacyCopy(text);
        done();
      });
    } else {
      legacyCopy(text);
      done();
    }
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      /* best effort */
    }
    document.body.removeChild(ta);
  }

  function bindCopyButtons() {
    document.addEventListener('click', function (event) {
      var btn = event.target.closest('.copy-btn');
      if (!btn) return;
      var block = btn.closest('.codeblock, pre');
      if (!block) return;
      var code = block.querySelector('pre code, code');
      if (!code) return;
      var original = btn.textContent;
      copyText(code.textContent, function () {
        btn.textContent = 'Copied!';
        btn.disabled = true;
        setTimeout(function () {
          btn.textContent = original;
          btn.disabled = false;
        }, 1400);
      });
    });
  }

  function bindTabs() {
    document.addEventListener('click', function (event) {
      var tab = event.target.closest('.tab');
      if (!tab) return;
      var group = tab.closest('[data-tabs]');
      if (!group) return;
      var key = tab.getAttribute('data-tab');
      group.querySelectorAll('.tab').forEach(function (t) {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      group.querySelectorAll('.tab-panel').forEach(function (p) {
        p.classList.toggle('is-active', p.getAttribute('data-panel') === key);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindCopyButtons();
      bindTabs();
    });
  } else {
    bindCopyButtons();
    bindTabs();
  }
})();
