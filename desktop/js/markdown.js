(function exposeMarkdownRenderer(root) {
  'use strict';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));

  function safeHref(value) {
    const href = String(value || '').trim();
    if (/^(https?:|mailto:)/i.test(href) || href.startsWith('#')) return escapeHtml(href);
    return '';
  }

  function renderInline(value) {
    const tokens = [];
    const token = (html) => {
      const index = tokens.push(html) - 1;
      return `\u0000${index}\u0000`;
    };

    let text = String(value ?? '');
    text = text.replace(/`([^`\n]+)`/g, (_match, code) => token(`<code>${escapeHtml(code)}</code>`));
    text = text.replace(/(!?)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, image, label, url) => {
      const href = safeHref(url);
      const safeLabel = escapeHtml(label);
      if (!href) return image ? safeLabel : token(safeLabel);
      if (image) return token(`<a href="${href}" target="_blank" rel="noreferrer">${safeLabel}</a>`);
      return token(`<a href="${href}" target="_blank" rel="noreferrer">${safeLabel}</a>`);
    });
    text = escapeHtml(text)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    return text.replace(/\u0000(\d+)\u0000/g, (_match, index) => tokens[Number(index)] || '');
  }

  function isTableDivider(line) {
    const cells = line.trim().replace(/^\||\|$/g, '').split('|');
    return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
  }

  function tableCells(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  }

  function startsBlock(lines, index) {
    const line = lines[index] || '';
    return !line.trim()
      || /^\s*```/.test(line)
      || /^\s{0,3}#{1,6}\s+/.test(line)
      || /^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)
      || /^\s{0,3}>\s?/.test(line)
      || /^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line)
      || (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1]));
  }

  function renderMarkdown(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }

      const fence = line.match(/^\s*```\s*([\w-]+)?\s*$/);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
        if (index < lines.length) index += 1;
        const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : '';
        output.push(`<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const level = heading[1].length;
        output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) {
        output.push('<hr>');
        index += 1;
        continue;
      }

      if (/^\s{0,3}>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
          quote.push(lines[index++].replace(/^\s{0,3}>\s?/, ''));
        }
        output.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
        continue;
      }

      const listItem = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
      if (listItem) {
        const ordered = /^\d/.test(listItem[1]);
        const tag = ordered ? 'ol' : 'ul';
        const items = [];
        while (index < lines.length) {
          const item = lines[index].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
          if (!item || /^\d/.test(item[1]) !== ordered) break;
          const task = item[2].match(/^\[([ xX])\]\s+(.+)$/);
          items.push(task
            ? `<li class="task-item"><input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> ${renderInline(task[2])}</li>`
            : `<li>${renderInline(item[2])}</li>`);
          index += 1;
        }
        output.push(`<${tag}>${items.join('')}</${tag}>`);
        continue;
      }

      if (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1])) {
        const headers = tableCells(line);
        index += 2;
        const rows = [];
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
          rows.push(tableCells(lines[index++]));
        }
        output.push(`<div class="markdown-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_header, cellIndex) => `<td>${renderInline(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && !startsBlock(lines, index)) paragraph.push(lines[index++].trim());
      output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    }

    return output.join('\n') || '<p class="markdown-empty">Documento vacío</p>';
  }

  const api = { render: renderMarkdown };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NexusMarkdown = api;
}(typeof window !== 'undefined' ? window : globalThis));
