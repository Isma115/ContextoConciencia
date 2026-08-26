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

function collectFiles(inputPath, files = []) {
  if (files.length >= MAX_FILES) return files;
  const absolute = path.resolve(inputPath);
  const stats = fs.statSync(absolute);
  if (stats.isFile()) {
    if (DOCUMENT_SUPPORTED.has(path.extname(absolute).toLowerCase())) files.push(absolute);
    return files;
  }
  if (!stats.isDirectory()) return files;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    collectFiles(path.join(absolute, entry.name), files);
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

function readFileDocument(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const type = SUPPORTED.get(extension);
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_FILE_BYTES) {
    throw new Error(`El archivo supera el límite de ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const baseName = path.basename(filePath, extension);
  let metadata = {
    extension: extension.slice(1),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString()
  };
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

function importLocalSource(db, source, { prune = false } = {}) {
  const config = parseJson(source.config_json);
  const inputs = Array.isArray(config.paths) ? config.paths : [];
  const files = [];
  const errors = [];
  for (const input of inputs) {
    try {
      collectFiles(input, files);
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
        const result = upsertDocument(db, source.id, readFileDocument(filePath));
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
