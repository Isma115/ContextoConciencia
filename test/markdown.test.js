const test = require('node:test');
const assert = require('node:assert/strict');
const markdown = require('../desktop/js/markdown');

test('renderiza la estructura principal de Markdown', () => {
  const html = markdown.render('# Título\n\nTexto con **negrita**.\n\n- Uno\n- Dos\n\n```js\nconst ok = true;\n```');
  assert.match(html, /<h1>Título<\/h1>/);
  assert.match(html, /<strong>negrita<\/strong>/);
  assert.match(html, /<ul><li>Uno<\/li><li>Dos<\/li><\/ul>/);
  assert.match(html, /<pre><code class="language-js">const ok = true;<\/code><\/pre>/);
});

test('escapa HTML y rechaza enlaces con protocolos inseguros', () => {
  const html = markdown.render('<script>alert(1)</script>\n\n[abrir](javascript:alert(1))');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href=/);
  assert.doesNotMatch(html, /javascript:/);
});

test('renderiza tablas, citas y tareas', () => {
  const html = markdown.render('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> Nota\n\n- [x] Hecho');
  assert.match(html, /<table>/);
  assert.match(html, /<blockquote><p>Nota<\/p><\/blockquote>/);
  assert.match(html, /type="checkbox" disabled checked/);
});
