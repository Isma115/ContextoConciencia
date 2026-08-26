function lineAt(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function localReference(value) {
  const reference = String(value || '').trim().replace(/^['"]|['"]$/g, '').split('#', 1)[0].split('?', 1)[0];
  if (!reference || reference.startsWith('/') || reference.startsWith('//')) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)/i.test(reference)) return null;
  return reference;
}

function analyseCss(source) {
  const text = String(source || '');
  const references = [];
  const symbols = [];
  const seen = new Set();
  const importPattern = /@import\s+(?:url\(\s*)?(["']?)([^"'\s)]+)\1\s*\)?/gi;
  let match;
  while ((match = importPattern.exec(text))) {
    const path = localReference(match[2]);
    if (!path) continue;
    const key = `imports-style:${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({ kind: 'imports-style', source: path, line: lineAt(text, match.index) });
  }
  const urlPattern = /url\(\s*(["']?)([^"')\s]+)\1\s*\)/gi;
  while ((match = urlPattern.exec(text))) {
    const path = localReference(match[2]);
    if (!path) continue;
    const key = `references-style:${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({ kind: 'references-style', source: path, line: lineAt(text, match.index) });
  }
  const variablePattern = /(^|[;{\s])(\-\-[A-Za-z0-9_-]+)\s*:/gm;
  while ((match = variablePattern.exec(text))) {
    symbols.push({ name: match[2], kind: 'variable', range: { startLine: lineAt(text, match.index), endLine: lineAt(text, match.index) } });
  }
  return { language: 'css', symbols, references, warnings: [] };
}

module.exports = { analyseCss, analyzeCss: analyseCss, localReference };
