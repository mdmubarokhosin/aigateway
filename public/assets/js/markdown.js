/**
 * MD — tiny safe Markdown -> HTML renderer for AI replies (no dependencies).
 *
 * Pipeline: escape ALL HTML first, then parse markdown on top — so model
 * output can never inject markup. Supported:
 *   # … ######   headings          **bold** / *italic* / `inline code`
 *   ```lang … ``` code blocks (+ per-block copy button, language label)
 *   - / * / 1. lists (nested by 2-space indent)
 *   > blockquotes (multi-line)
 *   tables  | a | b |  with --- separator row
 *   --- horizontal rule
 *   [text](https://…) links (http/https/mailto only, target=_blank)
 *   paragraphs + hard line breaks
 *
 * Usage:  element.innerHTML = window.MD.render(text);
 *         window.MD.enhance(container);  // wires code copy buttons
 */
(function () {
  'use strict';

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(url) {
    var u = String(url || '').trim();
    return /^(https?:\/\/|mailto:|\/|#)/i.test(u) ? u : '#';
  }

  /** Inline rules (run on already-escaped text). */
  function inline(text) {
    return text
      // images are NOT allowed (model output should not embed remote images)
      .replace(/`([^`\n]+)`/g, function (_, code) { return '<code class="md-icode">' + code + '</code>'; })
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
        var u = safeUrl(url);
        if (u === '#') return label;
        var external = /^https?:\/\//i.test(u);
        return '<a href="' + u + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + label + '</a>';
      });
  }

  function render(src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;

    function isTableSep(line) {
      return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.indexOf('-') !== -1;
    }

    while (i < lines.length) {
      var line = lines[i];

      // ---- fenced code block ----
      var fence = line.match(/^\s*```([\w+#.-]*)\s*$/);
      if (fence) {
        var lang = fence[1] || '';
        var code = [];
        i += 1;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1; // skip closing fence
        out.push(
          '<div class="md-code">' +
          '<div class="md-code-head"><span>' + esc(lang || 'code') + '</span>' +
          '<button type="button" class="md-copy" aria-label="Copy code">Copy</button></div>' +
          '<pre><code>' + esc(code.join('\n')) + '</code></pre>' +
          '</div>'
        );
        continue;
      }

      // ---- heading ----
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        var level = h[1].length;
        out.push('<h' + level + ' class="md-h">' + inline(esc(h[2].replace(/\s#+\s*$/, ''))) + '</h' + level + '>');
        i += 1;
        continue;
      }

      // ---- horizontal rule ----
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
        out.push('<hr class="md-hr" />');
        i += 1;
        continue;
      }

      // ---- table ----
      if (line.indexOf('|') !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        var parseRow = function (row) {
          return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
        };
        var headCells = parseRow(line);
        i += 2;
        var bodyRows = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') {
          bodyRows.push(parseRow(lines[i]));
          i += 1;
        }
        var table = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
        headCells.forEach(function (cell) { table += '<th>' + inline(esc(cell)) + '</th>'; });
        table += '</tr></thead><tbody>';
        bodyRows.forEach(function (row) {
          table += '<tr>';
          row.forEach(function (cell) { table += '<td>' + inline(esc(cell)) + '</td>'; });
          table += '</tr>';
        });
        table += '</tbody></table></div>';
        out.push(table);
        continue;
      }

      // ---- blockquote ----
      if (/^\s*>\s?/.test(line)) {
        var quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        out.push('<blockquote class="md-quote">' + inline(esc(quote.join('\n'))).replace(/\n/g, '<br />') + '</blockquote>');
        continue;
      }

      // ---- lists (unordered / ordered, one nesting level) ----
      var ulMatch = /^\s*[-*+]\s+/;
      var olMatch = /^\s*\d+[.)]\s+/;
      if (ulMatch.test(line) || olMatch.test(line)) {
        var ordered = olMatch.test(line);
        var tag = ordered ? 'ol' : 'ul';
        var items = [];
        while (i < lines.length) {
          if (ulMatch.test(lines[i]) || olMatch.test(lines[i])) {
            items.push(lines[i].replace(ordered ? olMatch : ulMatch, ''));
            i += 1;
          } else if (lines[i].match(/^\s{2,}\S/) && items.length) {
            // continuation line of the previous item
            items[items.length - 1] += ' ' + lines[i].trim();
            i += 1;
          } else {
            break;
          }
        }
        out.push(
          '<' + tag + ' class="md-list">' +
          items.map(function (item) { return '<li>' + inline(esc(item)) + '</li>'; }).join('') +
          '</' + tag + '>'
        );
        continue;
      }

      // ---- blank line ----
      if (line.trim() === '') {
        i += 1;
        continue;
      }

      // ---- paragraph (until blank line / block start) ----
      var para = [line];
      i += 1;
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^\s*```/.test(lines[i]) &&
        !/^(#{1,6})\s+/.test(lines[i]) &&
        !ulMatch.test(lines[i]) &&
        !olMatch.test(lines[i]) &&
        !/^\s*>\s?/.test(lines[i])
      ) {
        para.push(lines[i]);
        i += 1;
      }
      out.push('<p class="md-p">' + inline(esc(para.join('\n'))).replace(/\n/g, '<br />') + '</p>');
    }

    return out.join('\n');
  }

  /** Wire copy buttons inside code blocks (call after setting innerHTML). */
  function enhance(root) {
    var scope = root || document;
    scope.querySelectorAll('.md-copy').forEach(function (btn) {
      if (btn.dataset.mdWired) return;
      btn.dataset.mdWired = '1';
      btn.addEventListener('click', function () {
        var code = btn.closest('.md-code');
        var text = code && code.querySelector('code') ? code.querySelector('code').textContent : '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
        } else {
          var ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (e) { /* ignore */ }
          ta.remove();
        }
        var old = btn.textContent;
        btn.textContent = window.I18N ? window.I18N.t('common.copied') : 'Copied!';
        setTimeout(function () { btn.textContent = old; }, 1600);
      });
    });
  }

  window.MD = { render: render, enhance: enhance, esc: esc, inline: inline };
})();
