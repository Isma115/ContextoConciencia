const fs = require('node:fs');
const path = require('node:path');
const { insideRoot, normaliseRelative, SUPPORTED_EXTENSIONS } = require('./file-discovery');

const RESOLUTION_EXTENSIONS = [...SUPPORTED_EXTENSIONS.keys()];

function readJson(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function packageName(request) {
  if (request.startsWith('@')) return request.split('/').slice(0, 2).join('/');
  return request.split('/')[0];
}

function loadCompilerConfig(root) {
  const packageJson = readJson(path.join(root, 'package.json'));
  const packageImports = Object.entries(packageJson.imports || {}).map(([key, value]) => ({
    key,
    values: Array.isArray(value) ? value.filter((item) => typeof item === 'string') : typeof value === 'string' ? [value] : []
  })).filter((item) => item.values.length);
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const candidate = path.join(root, name);
    if (!fs.existsSync(candidate)) continue;
    const config = readJson(candidate);
    const compilerOptions = config.compilerOptions && typeof config.compilerOptions === 'object' ? config.compilerOptions : {};
    const baseUrl = typeof compilerOptions.baseUrl === 'string' ? path.resolve(root, compilerOptions.baseUrl) : root;
    const paths = Object.entries(compilerOptions.paths || {}).filter(([key, values]) => typeof key === 'string' && Array.isArray(values)).map(([key, values]) => ({ key, values: values.filter((value) => typeof value === 'string').slice(0, 20) }));
    return { baseUrl: insideRoot(root, baseUrl) ? baseUrl : root, paths, imports: packageImports, source: name };
  }
  return { baseUrl: root, paths: [], imports: packageImports, source: null };
}

function aliasesFor(request, config) {
  const matches = [];
  for (const alias of config.paths) {
    const wildcard = alias.key.indexOf('*');
    if (wildcard < 0) {
      if (request !== alias.key) continue;
      alias.values.forEach((value) => matches.push(value));
      continue;
    }
    const prefix = alias.key.slice(0, wildcard);
    const suffix = alias.key.slice(wildcard + 1);
    if (!request.startsWith(prefix) || (suffix && !request.endsWith(suffix))) continue;
    const end = suffix ? request.length - suffix.length : request.length;
    const replacement = request.slice(prefix.length, end);
    alias.values.forEach((value) => matches.push(value.replaceAll('*', replacement)));
  }
  return matches;
}

function stripQuery(request) {
  return String(request || '').split(/[?#]/, 1)[0];
}

function createResolver(root, fileRecords = []) {
  const fileByRelative = new Map(fileRecords.map((file) => [normaliseRelative(file.path), file]));
  const fileByRealPath = new Map(fileRecords.map((file) => [file.absolutePath, file]));
  const compiler = loadCompilerConfig(root);

  function findFile(candidate) {
    const normalized = path.normalize(candidate);
    if (!insideRoot(root, normalized)) return { outsideRoot: true };
    let real;
    try { real = fs.realpathSync(normalized); } catch { return null; }
    if (!insideRoot(root, real)) return { outsideRoot: true };
    return fileByRealPath.get(real) || fileByRelative.get(normaliseRelative(path.relative(root, real))) || null;
  }

  function candidatesFor(base) {
    const candidates = [base];
    if (!path.extname(base)) RESOLUTION_EXTENSIONS.forEach((extension) => candidates.push(`${base}${extension}`));
    for (const extension of RESOLUTION_EXTENSIONS) candidates.push(path.join(base, `index${extension}`));
    return [...new Set(candidates)];
  }

  function tryResolve(base) {
    for (const candidate of candidatesFor(base)) {
      const result = findFile(candidate);
      if (result?.outsideRoot) return result;
      if (result) return result;
    }
    return null;
  }

  function resolve(importerPath, request, { relativePath = false } = {}) {
    const rawRequest = stripQuery(request);
    if (!rawRequest) return { status: 'unresolved', request: rawRequest, reason: 'Ruta vacía' };
    const aliases = aliasesFor(rawRequest, { paths: [...compiler.paths, ...(compiler.imports || [])] });
    for (const alias of aliases) {
      const aliasResult = tryResolve(path.resolve(compiler.baseUrl, alias));
      if (aliasResult && !aliasResult.outsideRoot) return { status: 'resolved', file: aliasResult, request: rawRequest, via: 'alias' };
    }
    const isRelative = relativePath || rawRequest.startsWith('.') || rawRequest.startsWith('/');
    if (isRelative) {
      const base = rawRequest.startsWith('/') ? path.resolve(root, `.${rawRequest}`) : path.resolve(root, path.dirname(importerPath), rawRequest);
      const result = tryResolve(base);
      if (result?.outsideRoot) return { status: 'unresolved', request: rawRequest, reason: 'La ruta queda fuera de la raíz del proyecto' };
      if (result) return { status: 'resolved', file: result, request: rawRequest };
      return { status: 'unresolved', request: rawRequest, reason: 'No existe un fichero compatible en la ruta indicada' };
    }
    return { status: 'external', request: rawRequest, packageName: packageName(rawRequest) };
  }

  return { resolve, compiler, fileByRelative, fileByRealPath };
}

module.exports = { createResolver, loadCompilerConfig, packageName, aliasesFor, stripQuery };
