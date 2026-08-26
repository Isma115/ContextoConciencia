const crypto = require('node:crypto');
const { analyseJavaScript } = require('./analyzers/javascript');
const { analyseHtml } = require('./analyzers/html');
const { analyseCss } = require('./analyzers/css');
const { createResolver } = require('./resolver');
const { sharedCache } = require('./cache');

const ANALYZERS = {
  javascript: analyseJavaScript,
  typescript: analyseJavaScript,
  html: analyseHtml,
  css: analyseCss
};

function fileId(relativePath) { return `file:${relativePath}`; }
function packageId(name) { return `package:${name}`; }
function normaliseEntry(entryFile) { return String(entryFile || '').replaceAll('\\', '/').replace(/^\.\//, ''); }

function createFingerprint(files) {
  return crypto.createHash('sha1').update(files.map((file) => `${file.path}:${file.size}:${file.mtimeMs}`).join('\n')).digest('hex');
}

function symbolId(filePath, name, index) {
  return `symbol:${filePath}:${name}${index > 1 ? `#${index}` : ''}`;
}

function attachSymbols(file, analysis) {
  const counts = new Map();
  const symbolByName = new Map();
  const symbols = (analysis.symbols || []).map((symbol) => {
    const count = (counts.get(symbol.name) || 0) + 1;
    counts.set(symbol.name, count);
    const id = symbolId(file.path, symbol.name, count);
    const result = {
      id,
      kind: symbol.kind || 'symbol',
      name: symbol.name,
      exported: Boolean(symbol.exported),
      range: symbol.range || { startLine: 1, endLine: 1 }
    };
    for (const key of ['imported', 'source', 'owner', 'extendsName']) if (symbol[key] != null) result[key] = symbol[key];
    if (!symbolByName.has(symbol.name)) symbolByName.set(symbol.name, result);
    return result;
  });
  return { symbols, symbolByName };
}

function symbolFor(fileAnalysis, name) {
  if (!name) return null;
  return fileAnalysis.symbolByName.get(name) || fileAnalysis.symbols.find((symbol) => symbol.name === name || symbol.name.split('#')[0] === name) || null;
}

function exportedSymbolFor(fileAnalysis, name) {
  if (!fileAnalysis || !name) return null;
  const exported = (fileAnalysis.exports || []).find((item) => item.exported === name || (name === 'default' && item.exported === 'default'));
  return symbolFor(fileAnalysis, exported?.local || name) || (name === 'default' ? fileAnalysis.symbols.find((symbol) => symbol.exported) : null);
}

function addWarning(fileAnalysis, warning) {
  const value = { line: warning.line || 1, message: warning.message, ...(warning.request ? { request: warning.request } : {}) };
  fileAnalysis.warnings.push(value);
}

function relationBase(kind, from, to, extras = {}) {
  return { kind, from, to, fromSymbol: null, toSymbol: null, resolved: Boolean(to), ...extras };
}

function compareRelations(first, second) {
  return `${first.from}\u0000${first.kind}\u0000${first.to || ''}\u0000${first.line || 0}\u0000${first.request || ''}`.localeCompare(`${second.from}\u0000${second.kind}\u0000${second.to || ''}\u0000${second.line || 0}\u0000${second.request || ''}`);
}

function calculateCycles(filePaths, relations) {
  const adjacency = new Map(filePaths.map((filePath) => [fileId(filePath), []]));
  relations.forEach((relation) => {
    const from = relationFileId(relation, adjacency);
    const to = relation.to && String(relation.to).startsWith('file:') ? relation.to : null;
    if (from && to && adjacency.has(from) && adjacency.has(to)) adjacency.get(from).push(to);
  });
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  let index = 0;
  let cycles = 0;

  function visit(node) {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of new Set(adjacency.get(node) || [])) {
      if (!indices.has(next)) {
        visit(next);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(next)));
      } else if (onStack.has(next)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(next)));
      }
    }
    if (lowLinks.get(node) !== indices.get(node)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      component.push(current);
    } while (current !== node);
    if (component.length > 1 || (component.length === 1 && (adjacency.get(component[0]) || []).includes(component[0]))) cycles += 1;
  }

  for (const node of adjacency.keys()) if (!indices.has(node)) visit(node);
  return cycles;
}

function relationFileId(relation, adjacency) {
  if (String(relation.from || '').startsWith('file:')) return relation.from;
  if (String(relation.from || '').startsWith('symbol:')) {
    const value = String(relation.from).slice('symbol:'.length);
    const separator = value.lastIndexOf(':');
    if (separator >= 0) {
      const candidate = `file:${value.slice(0, separator)}`;
      if (adjacency.has(candidate)) return candidate;
    }
  }
  return null;
}

function buildCodeMap({ root, discovery, scope = 'project', entryFile = '', includeExternalPackages = false, maxRelations = 20000, cache = sharedCache } = {}) {
  const startedAt = Date.now();
  const files = discovery.files || [];
  const resolver = createResolver(root, files);
  const analyses = new Map();
  const warnings = [...(discovery.warnings || [])];

  for (const file of files) {
    const analyzer = ANALYZERS[file.language];
    const analysis = analyzer
      ? cache.get(file, analyzer)
      : { symbols: [], imports: [], exports: [], calls: [], extendsRelations: [], references: [], warnings: [] };
    const attached = attachSymbols(file, analysis);
    analyses.set(file.path, { file, ...analysis, ...attached, warnings: [...(analysis.warnings || [])] });
  }

  const pendingRelations = [];
  const externalPackages = new Map();

  function addUnresolved(fileAnalysis, relation, reason) {
    pendingRelations.push({ ...relation, to: null, resolved: false, reason });
    addWarning(fileAnalysis, { line: relation.line, request: relation.request, message: `${reason}${relation.request ? `: ${relation.request}` : ''}` });
  }

  function resolveReference(fileAnalysis, reference, kind = reference.kind || 'imports') {
    const requested = reference.source || reference.request;
    const from = fileId(fileAnalysis.file.path);
    if (reference.unresolved || !requested) {
      addUnresolved(fileAnalysis, relationBase(kind, from, null, { line: reference.line, request: requested }), 'Referencia dinámica no literal');
      return { status: 'unresolved', request: requested, reason: 'Referencia dinámica no literal' };
    }
    const result = resolver.resolve(fileAnalysis.file.path, requested, { relativePath: ['references-script', 'references-style', 'imports-style'].includes(kind) });
    if (result.status === 'resolved') {
      const target = analyses.get(result.file.path);
      const relation = relationBase(kind, from, fileId(result.file.path), { line: reference.line, request: reference.source });
      relation.resolved = true;
      relation.to = fileId(result.file.path);
      relation.toFile = result.file.path;
      relation.via = result.via;
      if (reference.specifiers?.length && target) {
        const first = reference.specifiers.find((specifier) => specifier.imported && specifier.imported !== '*');
        const targetSymbol = exportedSymbolFor(target, first?.imported);
        const sourceSymbol = symbolFor(fileAnalysis, first?.local);
        relation.fromSymbol = sourceSymbol?.id || null;
        relation.toSymbol = targetSymbol?.id || null;
      }
      pendingRelations.push(relation);
      return result;
    }
    if (result.status === 'external') {
      const packageEntry = externalPackages.get(result.packageName) || { id: packageId(result.packageName), name: result.packageName, kind: 'package' };
      externalPackages.set(result.packageName, packageEntry);
      const relation = relationBase(kind, from, includeExternalPackages ? packageEntry.id : null, { line: reference.line, request: reference.source, externalPackage: result.packageName, resolved: false });
      if (!includeExternalPackages) relation.reason = 'Paquete externo no inspeccionado';
      pendingRelations.push(relation);
      if (!includeExternalPackages) addWarning(fileAnalysis, { line: reference.line, request: reference.source, message: 'Paquete externo no inspeccionado' });
      return result;
    }
    addUnresolved(fileAnalysis, relationBase(kind, from, null, { line: reference.line, request: reference.source }), result.reason || 'Referencia no resuelta');
    return result;
  }

  for (const fileAnalysis of analyses.values()) {
    for (const reference of [...(fileAnalysis.imports || []), ...(fileAnalysis.references || [])]) resolveReference(fileAnalysis, reference, reference.kind || 'imports');
    for (const exportReference of (fileAnalysis.exports || []).filter((item) => item.source)) {
      resolveReference(fileAnalysis, { source: exportReference.source, line: exportReference.line, specifiers: [{ imported: exportReference.local, local: exportReference.local }] }, 'imports');
    }
    for (const exported of fileAnalysis.exports || []) {
      if (exported.local === '*') continue;
      const symbol = symbolFor(fileAnalysis, exported.local);
      if (!symbol) continue;
      symbol.exported = true;
      symbol.exportedName = exported.exported;
      pendingRelations.push({ ...relationBase('exports', fileId(fileAnalysis.file.path), symbol.id, { line: exported.line }), fromSymbol: null, toSymbol: symbol.id, resolved: true });
    }
  }

  const importBindings = new Map();
  for (const fileAnalysis of analyses.values()) {
    const bindings = new Map();
    for (const item of fileAnalysis.imports || []) {
      const result = resolver.resolve(fileAnalysis.file.path, item.source);
      if (result.status === 'resolved') {
        for (const specifier of item.specifiers || []) bindings.set(specifier.local, { target: analyses.get(result.file.path), imported: specifier.imported });
      }
    }
    importBindings.set(fileAnalysis.file.path, bindings);
  }

  for (const fileAnalysis of analyses.values()) {
    const bindings = importBindings.get(fileAnalysis.file.path) || new Map();
    for (const call of fileAnalysis.calls || []) {
      const sourceSymbol = symbolFor(fileAnalysis, call.fromName);
      const binding = bindings.get(call.targetName);
      const targetFileAnalysis = binding?.target || fileAnalysis;
      const targetSymbol = exportedSymbolFor(targetFileAnalysis, binding?.imported === '*' ? call.targetName : binding?.imported || call.targetName) || symbolFor(targetFileAnalysis, call.targetName);
      if (!targetSymbol) continue;
      pendingRelations.push({ ...relationBase('calls', sourceSymbol?.id || fileId(fileAnalysis.file.path), targetSymbol.id, { line: call.line }), fromSymbol: sourceSymbol?.id || null, toSymbol: targetSymbol.id, resolved: true });
    }
    for (const item of fileAnalysis.extendsRelations || []) {
      const binding = bindings.get(item.targetName);
      const targetFileAnalysis = binding?.target || fileAnalysis;
      const targetSymbol = exportedSymbolFor(targetFileAnalysis, binding?.imported || item.targetName) || symbolFor(targetFileAnalysis, item.targetName);
      const sourceSymbol = symbolFor(fileAnalysis, item.fromName);
      if (!sourceSymbol || !targetSymbol) continue;
      pendingRelations.push({ ...relationBase('extends', sourceSymbol.id, targetSymbol.id, { line: item.line }), fromSymbol: sourceSymbol.id, toSymbol: targetSymbol.id, resolved: true });
    }
  }

  const allFilePaths = files.map((file) => file.path);
  const entry = normaliseEntry(entryFile);
  if (scope === 'entry' && !analyses.has(entry)) throw new Error('El fichero raíz no pertenece al proyecto global o no es compatible');
  const reachable = new Set(scope === 'entry' ? [entry] : allFilePaths);
  if (scope === 'entry') {
    const adjacency = new Map();
    for (const relation of pendingRelations) {
      if (!relation.resolved || !String(relation.to || '').startsWith('file:')) continue;
      const from = relationFileId(relation, new Map(allFilePaths.map((value) => [fileId(value), true])));
      const to = String(relation.to).slice('file:'.length);
      if (!from || !analyses.has(to)) continue;
      const fromPath = from.slice('file:'.length);
      if (!adjacency.has(fromPath)) adjacency.set(fromPath, []);
      adjacency.get(fromPath).push(to);
    }
    const queue = [entry];
    while (queue.length) {
      const current = queue.shift();
      for (const next of new Set(adjacency.get(current) || [])) {
        if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
      }
    }
  }

  const selectedFiles = files.filter((file) => reachable.has(file.path));
  const selectedFileIds = new Set(selectedFiles.map((file) => fileId(file.path)));
  const selectedSymbolIds = new Set(selectedFiles.flatMap((file) => (analyses.get(file.path)?.symbols || []).map((symbol) => symbol.id)));
  let relations = pendingRelations.filter((relation) => {
    const fromFile = relationFileId(relation, new Map(allFilePaths.map((value) => [fileId(value), true])));
    const toFile = String(relation.to || '').startsWith('file:') ? relation.to : null;
    const fromSelected = fromFile ? selectedFileIds.has(fromFile) : selectedSymbolIds.has(relation.from);
    const toSelected = !toFile || selectedFileIds.has(toFile) || selectedSymbolIds.has(relation.to) || String(relation.to || '').startsWith('package:');
    return fromSelected && toSelected;
  }).sort(compareRelations);
  const relationLimit = Math.min(Math.max(Number(maxRelations) || 20000, 1), 100000);
  if (relations.length > relationLimit) {
    relations = relations.slice(0, relationLimit);
    warnings.push({ path: '', message: `Se alcanzó el límite de ${relationLimit} relaciones` });
  }
  relations = relations.map((relation, index) => {
    const { toFile, ...result } = relation;
    return { id: `relation:${index + 1}`, ...result };
  });

  const fileModels = selectedFiles.map((file) => {
    const analysis = analyses.get(file.path);
    return {
      id: fileId(file.path),
      path: file.path,
      language: file.language,
      size: file.size,
      modifiedAt: file.modifiedAt,
      symbols: analysis.symbols,
      warnings: analysis.warnings
    };
  });
  const selectedWarnings = [...warnings, ...fileModels.flatMap((file) => file.warnings.map((warning) => ({ path: file.path, ...warning })))]
    .sort((first, second) => `${first.path || ''}:${first.line || 0}:${first.message}`.localeCompare(`${second.path || ''}:${second.line || 0}:${second.message}`));
  const symbols = fileModels.reduce((total, file) => total + file.symbols.length, 0);
  const cycles = calculateCycles(selectedFiles.map((file) => file.path), relations);
  return {
    schemaVersion: 1,
    project: {
      root,
      scope,
      entryFile: scope === 'entry' ? entry : null,
      fingerprint: createFingerprint(files)
    },
    files: fileModels,
    relations,
    externalPackages: includeExternalPackages ? [...externalPackages.values()].sort((first, second) => first.name.localeCompare(second.name)) : [],
    warnings: selectedWarnings,
    summary: {
      files: fileModels.length,
      symbols,
      relations: relations.length,
      cycles,
      durationMs: Date.now() - startedAt,
      truncated: Boolean(discovery.truncated || warnings.some((warning) => /límite|profundidad máxima/i.test(warning.message || ''))),
      cache: cache.stats()
    }
  };
}

module.exports = { ANALYZERS, buildCodeMap, calculateCycles, createFingerprint, fileId, symbolId };
