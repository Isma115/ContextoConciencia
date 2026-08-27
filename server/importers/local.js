const fs = require('node:fs');
const path = require('node:path');
const { parseJson } = require('../database/db');
const { upsertDocument } = require('../services/documents');

const SUPPORTED = new Map([
  ['.json', 'json'],
  ['.csv', 'csv'],
  ['.txt', 'text'],
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.html', 'html'],
  ['.htm', 'html'],
  ['.nxd', 'diagram'],
  // Estos tipos se conservan para el visor HTML, pero no se importan como documentación.
  ['.css', 'css'],
  ['.js', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript']
]);
const DOCUMENT_SUPPORTED = new Map([...SUPPORTED].filter(([, type]) => !['css', 'javascript'].includes(type)));
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 2000;
const BINARY_SAMPLE_BYTES = 8192;

function collectFiles(inputPath, files = [], options = {}) {
  const scanOptions = options.skipDirectories instanceof Set
    ? options
    : { ...options, skipDirectories: new Set((options.skipDirectories || []).map((value) => String(value).toLowerCase())) };
  if (files.length >= MAX_FILES) return files;
  const absolute = path.resolve(inputPath);
  let stats;
  try {
    stats = fs.statSync(absolute);
  } catch (error) {
    if (scanOptions.ignoreErrors) return files;
    throw error;
  }
  if (stats.isFile()) {
    if (scanOptions.includeUnsupported || DOCUMENT_SUPPORTED.has(path.extname(absolute).toLowerCase())) files.push(absolute);
    return files;
  }
  if (!stats.isDirectory()) return files;
  let entries;
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch (error) {
    if (scanOptions.ignoreErrors) return files;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && scanOptions.skipDirectories.has(entry.name.toLowerCase())) continue;
    if (entry.isSymbolicLink() && scanOptions.followSymlinks === false) continue;
    try {
      collectFiles(path.join(absolute, entry.name), files, scanOptions);
    } catch (error) {
      if (!scanOptions.ignoreErrors) throw error;
    }
    if (files.length >= MAX_FILES) break;
  }
  return files;
}

function parseCsvSummary(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { columns: [], rows: 0 };
  const columns = lines[0].split(',').map((column) => column.trim().replace(/^"|"$/g, '')).slice(0, 30);
  return { columns, rows: Math.max(lines.length - 1, 0) };
}

function isProbablyBinary(buffer) {
  const sample = buffer.subarray(0, BINARY_SAMPLE_BYTES);
  if (!sample.length) return false;
  let controlBytes = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if ((byte < 7 || (byte > 14 && byte < 32)) && byte !== 9 && byte !== 10 && byte !== 13) controlBytes += 1;
  }
  return controlBytes / sample.length > 0.1;
}

function readFileDocument(filePath, { allowLargeMetadata = false } = {}) {
  const extension = path.extname(filePath).toLowerCase();
  const type = SUPPORTED.get(extension) || (extension ? extension.slice(1) : 'file');
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_FILE_BYTES && !allowLargeMetadata) {
    throw new Error(`El archivo supera el límite de ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  const baseName = path.basename(filePath, extension);
  let metadata = {
    extension: extension.slice(1),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString()
  };
  let content = '';
  if (stats.size > MAX_FILE_BYTES) {
    metadata = { ...metadata, contentSkipped: 'too-large', searchTitleOnly: true };
  } else {
    const buffer = fs.readFileSync(filePath);
    if (isProbablyBinary(buffer)) {
      metadata = { ...metadata, binary: true, searchTitleOnly: true };
    } else {
      content = buffer.toString('utf8');
    }
  }
  if (type === 'json') {
    try {
      const parsed = JSON.parse(content);
      metadata = { ...metadata, jsonKind: Array.isArray(parsed) ? 'array' : 'object', keys: parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 50) : [] };
    } catch {
      metadata = { ...metadata, parseError: 'JSON no válido' };
    }
  }
  if (type === 'csv') metadata = { ...metadata, ...parseCsvSummary(content) };
  return {
    externalId: filePath,
    title: baseName.replace(/[-_]+/g, ' '),
    content,
    type,
    path: filePath,
    metadata
  };
}

function importLocalSource(db, source, { prune = false, includeUnsupported = true } = {}) {
  const config = parseJson(source.config_json);
  const inputs = Array.isArray(config.paths) ? config.paths : [];
  const files = [];
  const errors = [];
  const scanOptions = {
    skipDirectories: config.excludeDirectories,
    ignoreErrors: config.ignoreErrors === true,
    followSymlinks: config.followSymlinks,
    includeUnsupported
  };
  for (const input of inputs) {
    try {
      collectFiles(input, files, scanOptions);
    } catch (error) {
      errors.push({ path: input, message: error.message });
    }
  }
  const uniqueFiles = [...new Set(files)].slice(0, MAX_FILES);
  let created = 0;
  let updated = 0;
  db.transaction(() => {
    for (const filePath of uniqueFiles) {
      try {
        const result = upsertDocument(db, source.id, readFileDocument(filePath, { allowLargeMetadata: scanOptions.includeUnsupported }));
        if (result.updated) updated += 1;
        else created += 1;
      } catch (error) {
        errors.push({ path: filePath, message: error.message });
      }
    }
    if (prune) {
      const placeholders = uniqueFiles.map(() => '?').join(', ');
      const params = [source.id, ...uniqueFiles];
      db.run(
        `DELETE FROM documents WHERE source_id = ?${placeholders ? ` AND external_id NOT IN (${placeholders})` : ''}`,
        ...params
      );
    }
  });
  return { created, updated, total: created + updated, errors, files: uniqueFiles.length };
}

module.exports = { SUPPORTED, DOCUMENT_SUPPORTED, MAX_FILE_BYTES, MAX_FILES, collectFiles, readFileDocument, importLocalSource };
