const fs = require('node:fs');
const path = require('node:path');
const { buildCodeMap, createFingerprint } = require('./graph-builder');
const {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FILES,
  discoverFiles,
  insideRoot,
  isTextBuffer,
  normaliseRelative,
  supportedLanguage
} = require('./file-discovery');

const CODE_MAP_SCHEMA_VERSION = 1;
const MAX_ANALYSIS_FILES = 10000;
const MAX_EXCLUDES = 100;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

function safeRoot(projectRoot) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) throw new Error('No hay una raíz de proyecto global válida');
  let root;
  try { root = fs.realpathSync(path.resolve(projectRoot)); } catch { throw new Error('La raíz del proyecto global no existe'); }
  try {
    if (!fs.statSync(root).isDirectory()) throw new Error('La raíz del proyecto global debe ser una carpeta');
  } catch (error) {
    if (error.message === 'La raíz del proyecto global debe ser una carpeta') throw error;
    throw new Error('La raíz del proyecto global no se puede leer');
  }
  return root;
}

function optionsFrom(input = {}) {
  if (input.scope != null && !['project', 'entry', 'folder'].includes(input.scope)) throw new Error('El alcance del mapa no es válido');
  const scope = ['entry', 'folder'].includes(input.scope) ? input.scope : 'project';
  const excludes = Array.isArray(input.excludes)
    ? input.excludes.filter((value) => typeof value === 'string' && value.trim()).slice(0, MAX_EXCLUDES).map((value) => value.trim())
    : [];
  const maxFiles = Math.min(Math.max(Number(input.maxFiles) || DEFAULT_MAX_FILES, 1), MAX_ANALYSIS_FILES);
  const maxFileBytes = Math.min(Math.max(Number(input.maxFileBytes) || DEFAULT_MAX_FILE_BYTES, 1024), 20 * 1024 * 1024);
  const maxRelations = Math.min(Math.max(Number(input.maxRelations) || 20000, 1), 100000);
  return {
    scope,
    entryFile: normaliseRelative(input.entryFile),
    entryFolder: normaliseRelative(input.entryFolder),
    includeExternalPackages: input.includeExternalPackages === true,
    excludes,
    maxFiles,
    maxFileBytes,
    maxRelations,
    maxDepth: Math.min(Math.max(Number(input.maxDepth) || 80, 1), 200)
  };
}

function resolveScopePath(root, requestedPath, expectedType) {
  const raw = String(requestedPath || '').trim();
  const relative = normaliseRelative(raw);
  if (!relative || path.isAbsolute(raw) || path.win32.isAbsolute(raw) || relative.split('/').includes('..')) {
    throw new Error(`La ruta de ${expectedType === 'file' ? 'fichero' : 'carpeta'} no es válida`);
  }
  const candidate = path.resolve(root, relative);
  if (!insideRoot(root, candidate)) throw new Error('La ruta queda fuera del proyecto global');
  let realPath;
  try { realPath = fs.realpathSync(candidate); } catch { throw new Error(`La ${expectedType === 'file' ? 'ruta del fichero' : 'carpeta'} indicada no existe`); }
  if (!insideRoot(root, realPath)) throw new Error('La ruta queda fuera del proyecto global');
  let stats;
  try { stats = fs.statSync(realPath); } catch { throw new Error('La ruta seleccionada no se puede leer'); }
  if (expectedType === 'file' && !stats.isFile()) throw new Error('La ruta seleccionada no es un fichero');
  if (expectedType === 'directory' && !stats.isDirectory()) throw new Error('La ruta seleccionada no es una carpeta');
  return normaliseRelative(path.relative(root, realPath));
}

function isPathInFolder(filePath, folderPath) {
  const folder = normaliseRelative(folderPath).replace(/\/$/, '');
  return !folder || filePath === folder || filePath.startsWith(`${folder}/`);
}

function folderPaths(files) {
  const folders = new Set();
  for (const file of files) {
    const parts = file.path.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      folders.add(current);
    }
  }
  return [...folders].sort((first, second) => first.localeCompare(second));
}

function listCodeMapFiles(projectRoot, input = {}) {
  const root = safeRoot(projectRoot);
  const options = optionsFrom(input);
  const discovery = discoverFiles(root, options);
  return {
    schemaVersion: CODE_MAP_SCHEMA_VERSION,
    project: { root, fingerprint: createFingerprint(discovery.files) },
    files: discovery.files.map((file) => ({ path: file.path, language: file.language, extension: file.extension, size: file.size, modifiedAt: file.modifiedAt })),
    folders: folderPaths(discovery.files),
    warnings: discovery.warnings,
    excludedDirectories: discovery.excludedDirectories,
    limits: discovery.limits,
    truncated: discovery.truncated
  };
}

function analyzeCodeMap(projectRoot, input = {}) {
  const root = safeRoot(projectRoot);
  const options = optionsFrom(input);
  if (options.scope === 'entry' && !options.entryFile) throw new Error('Selecciona un fichero raíz para el análisis parcial');
  if (options.scope === 'folder' && !options.entryFolder) throw new Error('Selecciona una carpeta raíz para el análisis');
  const discovery = discoverFiles(root, options);
  if (options.scope === 'entry') {
    options.entryFile = resolveScopePath(root, options.entryFile, 'file');
    if (!discovery.files.some((file) => file.path === options.entryFile)) throw new Error('El fichero seleccionado no es compatible o supera los límites del análisis');
  }
  if (options.scope === 'folder') {
    options.entryFolder = resolveScopePath(root, options.entryFolder, 'directory');
    if (!discovery.files.some((file) => isPathInFolder(file.path, options.entryFolder))) throw new Error('La carpeta seleccionada no contiene ficheros compatibles');
  }
  const result = buildCodeMap({ root, discovery, ...options });
  result.schemaVersion = CODE_MAP_SCHEMA_VERSION;
  return result;
}

function getCodeMapFile(projectRoot, requestedPath, requestedLine = null) {
  const root = safeRoot(projectRoot);
  const relative = normaliseRelative(requestedPath);
  if (!relative || path.isAbsolute(requestedPath || '') || relative.split('/').includes('..')) throw new Error('La ruta del fichero no es válida');
  const candidate = path.resolve(root, relative);
  if (!insideRoot(root, candidate)) throw new Error('La ruta queda fuera del proyecto global');
  let realPath;
  try { realPath = fs.realpathSync(candidate); } catch { throw new Error('El fichero indicado no existe'); }
  if (!insideRoot(root, realPath)) throw new Error('La ruta queda fuera del proyecto global');
  const stats = fs.statSync(realPath);
  if (!stats.isFile()) throw new Error('La ruta indicada no es un fichero');
  const language = supportedLanguage(realPath);
  if (!language) throw new Error('El fichero no tiene una extensión compatible');
  if (stats.size > MAX_SOURCE_BYTES) throw new Error('El fichero supera el límite de lectura del visor');
  const buffer = fs.readFileSync(realPath);
  if (!isTextBuffer(buffer)) throw new Error('El fichero no contiene texto legible');
  const content = buffer.toString('utf8');
  const line = Number.isFinite(Number(requestedLine)) ? Math.max(1, Math.floor(Number(requestedLine))) : null;
  return {
    path: normaliseRelative(path.relative(root, realPath)),
    language,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    line,
    content
  };
}

module.exports = {
  CODE_MAP_SCHEMA_VERSION,
  MAX_SOURCE_BYTES,
  analyzeCodeMap,
  analyseCodeMap: analyzeCodeMap,
  getCodeMapFile,
  listCodeMapFiles,
  optionsFrom,
  safeRoot
};
