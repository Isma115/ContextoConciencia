function lineAt(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function localReference(value) {
  const reference = String(value || '').trim().split('#', 1)[0].split('?', 1)[0];
  if (!reference || reference.startsWith('#') || reference.startsWith('/') || reference.startsWith('//')) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)/i.test(reference)) return null;
  return reference;
}

function analyseHtml(source) {
  const text = String(source || '');
  const references = [];
  const symbols = [];
  const warnings = [];
  const seen = new Set();
  const tagPattern = /<([a-z][\w:-]*)\b[^>]*>/gi;
  let match;
  while ((match = tagPattern.exec(text))) {
    const tag = match[1].toLowerCase();
    const attributes = match[0];
    const script = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(attributes);
    const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(attributes);
    const rel = /\brel\s*=\s*(["'])(.*?)\1/i.exec(attributes);
    const candidate = tag === 'script' ? script?.[2] : tag === 'link' && /(?:^|\s)stylesheet(?:\s|$)/i.test(rel?.[2] || '') ? href?.[2] : null;
    const path = localReference(candidate);
    if (path) {
      const kind = tag === 'script' ? 'references-script' : 'references-style';
      const key = `${kind}:${path}`;
      if (!seen.has(key)) {
        seen.add(key);
        references.push({ kind, source: path, line: lineAt(text, match.index), attribute: tag === 'script' ? 'src' : 'href' });
      }
    }
    if (tag === 'script' && !script && /\btype\s*=\s*(["'])module\1/i.test(attributes)) {
      // Los imports del script inline requieren un parser de JavaScript; quedan fuera del MVP.
      warnings.push({ line: lineAt(text, match.index), message: 'El script inline no se sigue como dependencia de fichero' });
    }
    if (['script', 'link', 'style', 'base'].includes(tag)) {
      symbols.push({ name: `${tag}:${lineAt(text, match.index)}`, kind: 'element', range: { startLine: lineAt(text, match.index), endLine: lineAt(text, match.index) } });
    }
  }
  return { language: 'html', symbols, references, warnings };
}

module.exports = { analyseHtml, analyzeHtml: analyseHtml, localReference };
